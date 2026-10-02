import { createClient } from '@supabase/supabase-js';
import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { randomBytes, randomUUID } from 'node:crypto';

// This writes an evidence project/asset, but never calls an AI or generation endpoint.
if(!process.argv.includes('--write') || !process.argv.includes('--remote')) {
  console.error('Usage: node --env-file=.env.local scripts/smoke-cloud.mjs --write --remote');
  process.exit(1);
}
const check=(condition,label)=>{if(!condition)throw new Error(`QA: ${label}`);};
const edge=existsSync('.env.edge.local')?parseEnv(readFileSync('.env.edge.local','utf8')):{};
const required=name=>{check(!!process.env[name],`missing ${name}`);return process.env[name];};
let projectId,temporaryUserId,admin,ownerToken,editorToken;
const leases=[],shares=[],checks=[],cleanupIssues=[];
let request,failure;
try {
  const url=required('SUPABASE_URL').replace(/\/$/,'');
  check(new URL(url).protocol==='https:','remote Supabase URL must use HTTPS');
  const publishable=required('SUPABASE_PUBLISHABLE_KEY');
  const studioId=required('DEMO_STUDIO_ID');
  const origin=(edge.ALLOWED_ORIGINS??process.env.ALLOWED_ORIGINS??edge.PUBLIC_APP_URL??process.env.PUBLIC_APP_URL??'').split(',')[0].trim();
  check(!!origin && new URL(origin).origin===origin,'configure a valid allowed origin');
  const options={auth:{persistSession:false,autoRefreshToken:false}};
  admin=createClient(url,required('SUPABASE_SERVICE_ROLE_KEY'),options);
  const owner=createClient(url,publishable,options),editor=createClient(url,publishable,options);
  async function login(client,email,password) {
    const {data,error}=await client.auth.signInWithPassword({email,password});
    check(!error && !!data.session && !!data.user,'Auth password login');
    return {token:data.session.access_token,userId:data.user.id};
  }
  const ownerAuth=await login(owner,required('DEMO_OWNER_EMAIL'),required('DEMO_OWNER_PASSWORD'));
  const editorAuth=await login(editor,required('DEMO_EDITOR_EMAIL'),required('DEMO_EDITOR_PASSWORD'));
  ownerToken=ownerAuth.token;editorToken=editorAuth.token;
  check(ownerAuth.userId!==editorAuth.userId,'two distinct Auth accounts');checks.push('真实 Auth 双账号登录');
  request=async(path,{method='GET',body,token=ownerToken,requestOrigin=origin,contentType='application/json'}={})=>{
    const headers={Origin:requestOrigin};
    if(token)headers.Authorization=`Bearer ${token}`;
    if(body!==undefined)headers['Content-Type']=contentType;
    const response=await fetch(`${url}/functions/v1/scene-api${path}`,{
      method,headers,body:body===undefined?undefined:contentType==='application/json'?JSON.stringify(body):body,
      redirect:'error',signal:AbortSignal.timeout(30_000),
    });
    let data;try {data=await response.json();} catch {throw new Error('QA: API did not return JSON');}
    return {status:response.status,data};
  };
  check((await request('/health',{token:null})).status===200,'health');
  check((await request('/projects',{token:null})).status===401,'anonymous project request');
  check((await request('/projects',{requestOrigin:'https://forbidden-qa.invalid'})).status===403,'CORS rejection');
  for(const token of [ownerToken,editorToken]) {
    const result=await request('/studios',{token});
    check(result.status===200 && result.data.some(s=>s.id===studioId),'demo studio membership');
  }
  checks.push('健康、匿名鉴权、CORS、成员关系');
  const scene={schemaVersion:1,venue:{shape:'rectangle',width:12,depth:10,height:3,entrances:[]},objects:[],camera:'overview',lighting:'neutral'};
  const created=await request('/projects',{method:'POST',body:{studioId,name:`云端验收 ${new Date().toISOString()}`,scene}});
  check(created.status===201 && !!created.data.id,'project creation');projectId=created.data.id;
  const path=`/projects/${projectId}`;
  const email=`scene-qa-${randomUUID()}@example.com`,password=`Aa9!${randomBytes(24).toString('base64url')}`;
  const outsider=await admin.auth.admin.createUser({email,password,email_confirm:true});
  check(!outsider.error && !!outsider.data.user,'temporary non-member creation');temporaryUserId=outsider.data.user.id;
  const outsiderAuth=await login(createClient(url,publishable,options),email,password);
  check((await request(path,{token:outsiderAuth.token})).status===404,'non-member project isolation');checks.push('真实非成员账号隔离');
  const sessionIds=[randomUUID(),randomUUID()];
  const raced=await Promise.all(sessionIds.map(sessionId=>request(`${path}/lease/acquire`,{method:'POST',body:{sessionId}})));
  check(raced.filter(r=>r.status===200).length===1,'one lease winner across independent HTTP requests');
  const winner=raced.findIndex(r=>r.status===200),loser=raced[1-winner];
  check([409,429].includes(loser.status) && loser.data.error?.code==='LEASE_BUSY','second session rejected');
  const lease={sessionId:sessionIds[winner],generation:raced[winner].data.generation};
  leases.push({token:ownerToken,body:lease});
  const busy=await request(`${path}/lease/acquire`,{method:'POST',token:editorToken,body:{sessionId:randomUUID()}});
  check([409,429].includes(busy.status) && busy.data.error?.code==='LEASE_BUSY','second member rejected');
  check((await request(`${path}/lease/renew`,{method:'POST',body:lease})).status===200,'lease renewal');checks.push('双会话并发租约、第二成员冲突、续期');
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aA9sAAAAASUVORK5CYII=','base64');
  const upload=await request('/assets/floorplan',{method:'POST',body:png,contentType:'image/png'});
  check(upload.status===201 && !!upload.data.id,'private floorplan upload');
  const asset=upload.data;
  const signed=await request(`/assets/${asset.id}/url`,{method:'POST'});
  check(signed.status===200 && typeof signed.data.url==='string','asset URL authorization');
  const download=await fetch(signed.data.url,{redirect:'error',signal:AbortSignal.timeout(30_000)});
  check(download.ok && Buffer.from(await download.arrayBuffer()).equals(png),'real signed storage download bytes');
  const privatePath=`${ownerAuth.userId}/${asset.id}/${asset.sha256}.${asset.format}`;
  const unsigned=await fetch(`${url}/storage/v1/object/scene-assets/${privatePath}`,{headers:{apikey:publishable},redirect:'error',signal:AbortSignal.timeout(30_000)});
  check([400,401,403,404].includes(unsigned.status),'private storage must reject unsigned anonymous download');await unsigned.body?.cancel();
  check((await request(`/assets/${asset.id}/url`,{method:'POST',token:editorToken})).status===404,'unreferenced personal asset isolation');
  checks.push('私有 Storage 上传、真实签名字节下载、匿名拒绝');
  scene.venue.floorplanAssetId=asset.id;
  const privateNote=`internal-${randomUUID()}`;
  scene.objects=[{id:randomUUID(),materialId:'chair',position:{x:3,z:3},rotation:0,size:{width:0.5,depth:0.5,height:0.85},color:'#ffffff',locked:false,notes:privateNote}];
  const saveBody={...lease,expectedRevision:0,scene};
  check((await request(`${path}/scene`,{method:'PUT',body:saveBody,token:outsiderAuth.token})).status===404,'non-member cannot save');
  const saved=await request(`${path}/scene`,{method:'PUT',body:saveBody});
  check(saved.status===200 && saved.data.revision===1,'scene save');
  check((await request(`${path}/scene`,{method:'PUT',body:saveBody})).status===409,'old revision conflict');
  check((await request(`/assets/${asset.id}/url`,{method:'POST',token:editorToken})).status===200,'referenced project asset access');
  const reopened=await request(path,{token:editorToken});
  check(reopened.status===200 && reopened.data.scene.venue.floorplanAssetId===asset.id && reopened.data.materials[0]?.quantity===1,'cloud reopen and materials');checks.push('保存重开、旧版本拒绝、物料汇总、资产引用授权');
  const published=await request(`${path}/publish`,{method:'POST',body:{expectedRevision:1}});
  check(published.status===201 && !!published.data.shareId && !!published.data.token,'publication');shares.push(published.data.shareId);
  const shareBody={token:published.data.token};
  const shared=await request('/share/read',{method:'POST',token:null,body:shareBody});
  check(shared.status===200 && shared.data.scene.objects.length===1,'anonymous publication read');
  check(!JSON.stringify(shared.data).includes(privateNote) && !shared.data.scene.venue.floorplanAssetId && shared.data.assets.length===0,'private notes and floorplan omitted');
  const draft={...scene,objects:[]};
  check((await request(`${path}/scene`,{method:'PUT',body:{...lease,expectedRevision:1,scene:draft}})).status===200,'later draft save');
  const immutable=await request('/share/read',{method:'POST',token:null,body:shareBody});
  check(immutable.status===200 && immutable.data.revision===1 && immutable.data.scene.objects.length===1,'published snapshot remains immutable');checks.push('匿名发布、内部备注隐藏、发布版本与草稿隔离');
  check((await request(`${path}/lease/release`,{method:'POST',body:lease})).status===200,'owner lease release');leases.length=0;
  const editorSession=randomUUID();
  const acquired=await request(`${path}/lease/acquire`,{method:'POST',token:editorToken,body:{sessionId:editorSession}});
  check(acquired.status===200 && acquired.data.revision===2 && acquired.data.scene.objects.length===0,'handoff loads newest scene');
  const editorLease={sessionId:editorSession,generation:acquired.data.generation};leases.push({token:editorToken,body:editorLease});
  check((await request(`${path}/scene`,{method:'PUT',body:{...lease,expectedRevision:2,scene}})).status===409,'previous owner lease cannot save');
  const editorSaved=await request(`${path}/scene`,{method:'PUT',token:editorToken,body:{...editorLease,expectedRevision:2,scene}});
  check(editorSaved.status===200 && editorSaved.data.revision===3,'editor saves after handoff');checks.push('双账号交接与旧租约写入拒绝');
  check((await request(`${path}/shares/${published.data.shareId}`,{method:'DELETE'})).status===200,'share revocation');
  check((await request('/share/read',{method:'POST',token:null,body:shareBody})).status===404,'new reads rejected after revocation');checks.push('撤销后匿名新访问拒绝');
} catch(error) {
  failure=error instanceof Error && error.message.startsWith('QA: ')?error.message:'云端验收失败；已隐藏底层响应与凭据。';
} finally {
  for(const shareId of shares) {
    try {check((await request(`/projects/${projectId}/shares/${shareId}`,{method:'DELETE'})).status===200,'cleanup share');} catch {cleanupIssues.push('分享撤销失败');}
  }
  for(const lease of leases) {
    try {const result=await request(`/projects/${projectId}/lease/release`,{method:'POST',token:lease.token,body:lease.body});check(result.status===200 || result.status===409,'cleanup lease');} catch {cleanupIssues.push('租约释放失败（最长90秒后过期）');}
  }
  if(temporaryUserId) {
    try {const result=await admin.auth.admin.deleteUser(temporaryUserId);check(!result.error,'cleanup temporary user');} catch {cleanupIssues.push('临时非成员账号删除失败');}
  }
}
console.log(JSON.stringify({ok:!failure && !cleanupIssues.length,projectId,checks,error:failure,cleanupIssues,evidence:'验收项目与资产保留；未调用付费模型。'},null,2));
if(failure || cleanupIssues.length)process.exitCode=1;
