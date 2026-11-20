import { beforeAll,afterAll,describe,it,expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { database,owner,editor,outsider,studio,session,scene,chair } from './fixtures.ts';
import { createApi } from '../supabase/functions/_shared/api.ts';
import { canonical, sha256 } from '../supabase/functions/_shared/domain.ts';
import {
  archiveUploadSchema,
  archiveMime,
  caseWriteSchema,
  completeSaveSchema,
  completeShareSchema,
} from '../supabase/functions/_shared/cloud-storage-contract.ts';

/**
 * 云存储/完整保存/官方案例（Task A · 2026-11-20 审核 SQL）专项测试。
 *
 * 审核草案在 supabase/review/202611200001_cloud_storage.sql，不进自动迁移链；
 * 这里在 PGlite 夹具上显式 db.exec 应用它，等价模拟「人审通过后」的后端；
 * 未应用的独立夹具用例同时验证能力缺失时 503 失效（CLOUD_STORAGE_UNAVAILABLE）。
 * 全部为本机模拟验证，不代表线上已部署或已授权。
 */

const reviewSqlPath = fileURLToPath(new URL('../supabase/review/202611200001_cloud_storage.sql', import.meta.url));

  function requestJson() {
    return { 'Content-Type': 'application/json', Origin: 'https://app.example' };
  }
  void requestJson;

describe('cloud storage with review SQL applied',()=>{
  let f:Awaited<ReturnType<typeof database>>,api:ReturnType<typeof createApi>;
  beforeAll(async()=>{
    f=await database();
    api=createApi(f.backend,key=>({PUBLIC_APP_URL:'https://app.example',ALLOWED_ORIGINS:'https://app.example'}[key]));
    await f.db.exec(readFileSync(reviewSqlPath,'utf8'));
  },30000);
  afterAll(async()=>{await f?.db.close();});
  function req(path:string,method='GET',body?:unknown,actor:string|null=owner) {
    return api(new Request(`https://backend.example/functions/v1/scene-api${path}`,{
      method,
      headers:{...(actor?{Authorization:`Bearer ${actor}`}:{'X-No-Auth':'true'}),...(body!==undefined||method!=='GET'?{'Content-Type':'application/json'}:{}) ,Origin:'https://app.example'},
      body:body===undefined?undefined:JSON.stringify(body),
    }));
  }
  async function json(response:Response) { return await response.json() as Record<string,unknown>; }
  function expectCode(response:Response,code:string) { expect(response.status).toBeGreaterThanOrEqual(400); return json(response).then(body=>expect((body.error as {code?:string}).code).toBe(code)); }
  const requestId=()=>crypto.randomUUID();
  // RPC 直调时指纹由调用方给出（与 Edge 一致：canonical(含 requestId) 的 SHA-256）。
  const fingerprintOf=async(input:Record<string,unknown>)=>sha256(canonical(input));

  it('allows every contracted archive MIME in the deployed bucket configuration', async () => {
    const result = await f.db.query<{ allowed_mime_types: string[] }>("select allowed_mime_types from storage.buckets where id = 'scene-assets'");
    expect(result.rows[0]!.allowed_mime_types).toEqual(expect.arrayContaining([...new Set(Object.values(archiveMime))]));
  });

  it('grants the first platform admin only through the reviewed server-side table',async()=>{
    // 未授权前：owner 也只是普通用户。
    const before=await json(await req('/cloud/capabilities'));
    expect(before).toMatchObject({version:1,superAdmin:false,officialStudioId:null});
    // 非管理员调用管理动作 → PLATFORM_ADMIN_REQUIRED。
    await expectCode(await req('/cloud/cases/manage','GET',undefined,editor),'PLATFORM_ADMIN_REQUIRED');
    // 首授：人工在库内执行（模拟审核后的手工 insert，不猜 UUID，用夹具账号）。
    await f.db.query('insert into scene_private.platform_admins(user_id,note) values ($1,$2)',[owner,'首次授权（夹具模拟）']);
    expect(await json(await req('/cloud/capabilities'))).toMatchObject({version:1,superAdmin:true});
  });

  it('binds the official workspace and enforces admin-only official uploads',async()=>{
    await f.db.query('insert into scene_private.official_workspace(studio_id,enabled_by) values ($1,$2) on conflict (id) do nothing',[studio,owner]);
    const capabilities=await json(await req('/cloud/capabilities'));
    expect(capabilities).toMatchObject({superAdmin:true,officialStudioId:studio});
    // 未配置官方工作区前 editor 已被闸住；配置后 editor 仍非管理员 → FORBIDDEN。
    const denied=await req('/cloud/uploads','POST',{requestId:requestId(),name:'官方扫描',kind:'scan',format:'spz',byteSize:1024,sha256:'a'.repeat(64),studioId:studio},editor);
    expect(denied.status).toBe(403);
    const allowed=await req('/cloud/uploads','POST',{requestId:requestId(),name:'官方扫描',kind:'scan',format:'spz',byteSize:1024,sha256:'a'.repeat(64),studioId:studio});
    expect(allowed.status).toBe(201);
    expect(await json(allowed)).toMatchObject({state:'pending',uploadUrl:expect.stringContaining('storage.example'),storagePath:expect.stringContaining(`${owner}/`)});
  });

  it('grants and revokes admin through the audited RPC; revocation is immediate',async()=>{
    // grant/revoke 走 cloud_storage_rpc 的幂等写动作（HTTP 口随后续接入；先验证服务端语义）。
    const grant=await f.rpc(owner,'cloud.admin.grant',{requestId:requestId(),targetUserId:editor,fingerprint:await fingerprintOf({target:editor,op:'grant'}),note:'测试授权'});
    expect(grant).toMatchObject({targetUserId:editor,granted:true});
    const editorCaps=await json(await req('/cloud/capabilities','GET',undefined,editor));
    expect(editorCaps).toMatchObject({superAdmin:true});
    const revoked=await f.rpc(owner,'cloud.admin.revoke',{requestId:requestId(),targetUserId:editor,fingerprint:await fingerprintOf({target:editor,op:'revoke'})});
    expect(revoked).toMatchObject({targetUserId:editor,revoked:true});
    const editorAfter=await json(await req('/cloud/capabilities','GET',undefined,editor));
    expect(editorAfter).toMatchObject({superAdmin:false});
    const audit=await f.db.query('select action,target from scene_private.platform_admin_audit order by at');
    expect(audit.rows).toEqual([{action:'grant',target:editor},{action:'revoke',target:editor}]);
  });

  it('archives a scan end to end: prepare, direct upload, integrity check, register, list, url',async()=>{
    const bytes=new Uint8Array(2048).fill(7);
    const digest=await crypto.subtle.digest('SHA-256',bytes);
    const sha256=[...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');
    const input=archiveUploadSchema.parse({requestId:requestId(),name:'西湖外场扫描',kind:'scan',format:'spz',byteSize:bytes.length,sha256});
    const prepared=await json(await req('/cloud/uploads','POST',input));
    const uploadId=String(prepared.uploadId);
    expect(prepared).toMatchObject({state:'pending'});
    expect(String(prepared.uploadUrl)).toContain('storage.example');
    // 同 requestId 同内容重试：同一 uploadId（幂等对账），地址可新鲜签发。
    const retry=await json(await req('/cloud/uploads','POST',input));
    expect(String(retry.uploadId)).toBe(uploadId);
    // 同 requestId 不同内容 → IDEMPOTENCY_CONFLICT。
    const conflicting=await req('/cloud/uploads','POST',{...input,sha256:'b'.repeat(64)});
    await expectCode(conflicting,'IDEMPOTENCY_CONFLICT');
    // 未上传对象就 complete → UPLOAD_OBJECT_MISSING。
    await expectCode(await req(`/cloud/uploads/${uploadId}/complete`,'POST',{}),'UPLOAD_OBJECT_MISSING');
    // 模拟浏览器直传成功后再登记。
    f.objects.set(String(prepared.storagePath),bytes);
    const registered=await json(await req(`/cloud/uploads/${uploadId}/complete`,'POST',{}));
    expect(registered).toMatchObject({name:'西湖外场扫描',kind:'scan',format:'spz',byteSize:bytes.length,sha256,integrity:'full',ownerId:owner});
    expect(registered.reused).toBe(false);
    // 再次 complete → 幂等返回同一资产。
    const again=await json(await req(`/cloud/uploads/${uploadId}/complete`,'POST',{}));
    expect(again).toMatchObject({id:registered.id,reused:true});
    // 大小被篡改的直传 → UPLOAD_INTEGRITY_FAILED。
    const badInput=archiveUploadSchema.parse({requestId:requestId(),name:'坏扫描',kind:'scan',format:'ply',byteSize:100,sha256:'c'.repeat(64)});
    const badPrepared=await json(await req('/cloud/uploads','POST',badInput));
    f.objects.set(String(badPrepared.storagePath),new Uint8Array(99));
    await expectCode(await req(`/cloud/uploads/${String(badPrepared.uploadId)}/complete`,'POST',{}),'UPLOAD_INTEGRITY_FAILED');
    // 列表与取地址。
    const list=await json(await req('/cloud/assets')) as unknown;
    expect(Array.isArray(list)).toBe(true);
    expect((list as Record<string,unknown>[]).some(asset=>asset.id===registered.id)).toBe(true);
    const url=await json(await req(`/cloud/assets/${registered.id}/url`,'POST'));
    expect(url).toMatchObject({id:registered.id,expiresIn:300});
    expect(String(url.url)).toContain('storage.example/signed');
    // 内部存储路径不出网。
    expect(JSON.stringify(list)).not.toContain('storagePath');
  });

  it('saves the complete project under lease + revision CAS and rejects conflicts',async()=>{
    const project=await f.rpc(owner,'projects.create',{studioId:studio,name:'完整项目',scene:scene()});
    const projectId=String((project as Record<string,unknown>).id);
    const lease=await f.rpc(owner,'lease.acquire',{projectId,sessionId:session});
    const manifest={version:1 as const,scene:scene(),outdoor:{stages:1},sources:{},dependencies:[]};
    const saveInput=completeSaveSchema.parse({requestId:requestId(),sessionId:session,generation:Number((lease as Record<string,unknown>).generation),expectedRevision:0,manifest});
    const saved=await json(await req(`/cloud/projects/${projectId}`,'PUT',saveInput));
    expect(saved).toMatchObject({projectId,revision:0,dependencyCount:0});
    expect(String(saved.confirmedAt)).toBeTruthy();
    // 同 requestId 同内容重试 → 原确认。
    const retry=await json(await req(`/cloud/projects/${projectId}`,'PUT',saveInput));
    expect(retry).toMatchObject({projectId,revision:0});
    // 版本冲突：expectedRevision 过期 → REVISION_CONFLICT。
    const stale=await req(`/cloud/projects/${projectId}`,'PUT',{...saveInput,requestId:requestId(),expectedRevision:5});
    await expectCode(stale,'REVISION_CONFLICT');
    // 租约丢失：无租约 → LEASE_LOST。
    const noLease=await req(`/cloud/projects/${projectId}`,'PUT',{...saveInput,requestId:requestId(),sessionId:crypto.randomUUID(),generation:99,expectedRevision:0});
    await expectCode(noLease,'LEASE_LOST');
    // 未归档依赖 → DEPENDENCY_INCOMPLETE。
    const ghost=await req(`/cloud/projects/${projectId}`,'PUT',{...saveInput,requestId:requestId(),manifest:{...manifest,dependencies:[{assetId:crypto.randomUUID(),visibility:'published' as const}]}});
    await expectCode(ghost,'DEPENDENCY_INCOMPLETE');
    // 读取完整版本。
    const read=await json(await req(`/cloud/projects/${projectId}`));
    expect(read).toMatchObject({projectId,revision:0,dependencyCount:0});
    expect((read.manifest as Record<string,unknown>).outdoor).toEqual({stages:1});
  });

  it('does not let an outsider publish another account\'s private archive by inserting its ID into a personal manifest', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const digest = await sha256(bytes);
    const prepared = await json(await req('/cloud/uploads', 'POST', { requestId: requestId(), name: '私有归档', kind: 'attachment', format: 'txt', byteSize: bytes.length, sha256: digest }));
    f.objects.set(String(prepared.storagePath), bytes);
    const asset = await json(await req(`/cloud/uploads/${prepared.uploadId}/complete`, 'POST', {}));
    const personalStudio = crypto.randomUUID();
    await f.db.query('insert into scene_private.studios(id,name) values ($1,$2)', [personalStudio, '普通用户个人工作室']);
    await f.db.query("insert into scene_private.members(studio_id,user_id,role,display_name) values ($1,$2,'owner','普通用户')", [personalStudio, outsider]);
    const project = await f.rpc(outsider, 'projects.create', { studioId: personalStudio, name: '个人项目', scene: scene() });
    const lease = await f.rpc(outsider, 'lease.acquire', { projectId: project.id, sessionId: session });
    const response = await req(`/cloud/projects/${project.id}`, 'PUT', { requestId: requestId(), sessionId: session, generation: lease.generation, expectedRevision: 0, manifest: { version: 1, scene: scene(), outdoor: null, sources: {}, dependencies: [{ assetId: asset.id, visibility: 'published' }] } }, outsider);
    expect(response.status).toBe(404);
    await expectCode(response, 'ASSET_NOT_FOUND');
  });

  it('publishes a case only with archived published deps and switches the public entry atomically',async()=>{
    // 准备：注册一个场景 GLB 资产（依赖）并放进场景。
    const assetBytes=new Uint8Array(64).fill(1);
    const assetDigest=await crypto.subtle.digest('SHA-256',assetBytes);
    const assetSha=[...new Uint8Array(assetDigest)].map(b=>b.toString(16).padStart(2,'0')).join('');
    const assetId=crypto.randomUUID();
    await f.rpc(owner,'assets.register',{id:assetId,name:'舞台桁架',source:'upload',license:{type:'user-upload'},storagePath:`${owner}/${assetId}/${assetSha}.glb`,format:'glb',byteSize:assetBytes.length,sha256:assetSha,metadata:{}});
    const project=await f.rpc(owner,'projects.create',{studioId:studio,name:'官方案例底稿',scene:scene()});
    const projectId=String((project as Record<string,unknown>).id);
    const lease=await f.rpc(owner,'lease.acquire',{projectId,sessionId:session});
    const object={...chair(),materialId:'asset' as const,assetId};
    const sceneWithAsset={...scene(),objects:[object]};
    const save=async(visibility:'private'|'published')=>completeSaveSchema.parse({
      requestId:requestId(),sessionId:session,generation:Number((lease as Record<string,unknown>).generation),expectedRevision:0,
      manifest:{version:1 as const,scene:sceneWithAsset,outdoor:{walkways:2},sources:{registration:'world-file'},dependencies:[{assetId,visibility}]},
    });
    // scene 所需 asset 未列入 published 依赖 → 拒发。
    await req(`/cloud/projects/${projectId}`,'PUT',await save('private'));
    const caseInput=caseWriteSchema.parse({requestId:requestId(),expectedVersion:0,title:'西湖户外案例',description:'示例',category:'outdoor',coverAssetId:null,sortOrder:1,projectId,provenance:'官方采集'});
    const draft=await json(await req('/cloud/cases/cn-westlake-demo','PUT',caseInput));
    expect(draft).toMatchObject({stableId:'cn-westlake-demo',version:0,status:'unpublished',projectId});
    const blocked=await req('/cloud/cases/cn-westlake-demo/publish','POST',{requestId:requestId(),expectedVersion:0,expectedRevision:0});
    await expectCode(blocked,'DEPENDENCY_INCOMPLETE');
    // 公众此刻什么都看不到。
    const emptyList=await json(await req('/cloud/cases','GET',undefined,null));
    expect(emptyList).toEqual([]);
    // 重新保存为 published 依赖，并再次 upsert 刷新草稿（草稿只在 upsert 时跟随完整清单；
    // 刷新是新的主动操作，必须用新的 requestId，同内容复用旧号会命中幂等原确认）。
    await f.rpc(owner,'lease.renew',{projectId,sessionId:session,generation:Number((lease as Record<string,unknown>).generation)});
    await req(`/cloud/projects/${projectId}`,'PUT',await save('published'));
    const refreshed=await json(await req('/cloud/cases/cn-westlake-demo','PUT',{...caseInput,requestId:requestId()}));
    expect(refreshed).toMatchObject({stableId:'cn-westlake-demo',version:0,status:'unpublished'});
    const published=await json(await req('/cloud/cases/cn-westlake-demo/publish','POST',{requestId:requestId(),expectedVersion:0,expectedRevision:0}));
    expect(published).toMatchObject({stableId:'cn-westlake-demo',version:1,status:'published'});
    const publicationId=String(published.publicationId);
    // 公开目录与读取（匿名）：含户外 payload 与已发布资产签名地址；私有 sources 不出网。
    const list=await json(await req('/cloud/cases','GET',undefined,null));
    expect(Array.isArray(list)).toBe(true);
    expect(list[0]).toMatchObject({id:'cn-westlake-demo',title:'西湖户外案例',version:1});
    const read=await json(await req('/cloud/cases/cn-westlake-demo','GET',undefined,null));
    expect(read).toMatchObject({publicationId,revision:0});
    const manifest=read.manifest as Record<string,unknown>;
    expect(manifest).toMatchObject({version:1,outdoor:{walkways:2}});
    expect((manifest.dependencies as Array<{assetId:string;visibility:string}>)).toEqual([{assetId,visibility:'published'}]);
    expect(Object.hasOwn(manifest,'sources')).toBe(false);
    const assets=read.assets as Array<Record<string,unknown>>;
    expect(assets).toHaveLength(1);
    expect(String(assets[0].url)).toContain('storage.example/signed');
    expect(JSON.stringify(read)).not.toContain('storagePath');
    expect(JSON.stringify(read)).not.toContain('world-file');
    // 期望版本过期 → CASE_VERSION_CONFLICT；发布失败不动公众入口。
    const stalePublish=await req('/cloud/cases/cn-westlake-demo/publish','POST',{requestId:requestId(),expectedVersion:0,expectedRevision:0});
    await expectCode(stalePublish,'CASE_VERSION_CONFLICT');
    // 下架 → 目录与入口同时失效。
    const unpublished=await json(await req('/cloud/cases/cn-westlake-demo/unpublish','POST',{requestId:requestId(),expectedVersion:1}));
    expect(unpublished).toMatchObject({status:'unpublished',version:1});
    expect(await json(await req('/cloud/cases','GET',undefined,null))).toEqual([]);
    await expectCode(await req('/cloud/cases/cn-westlake-demo','GET',undefined,null),'CASE_NOT_FOUND');
    // 版本历史可查（含 unpublish 流水），恢复历史版本生成新版本号、不改旧发布。
    const versions=await json(await req('/cloud/cases/cn-westlake-demo/versions')) as unknown;
    const rows=versions as Array<Record<string,unknown>>;
    expect(rows.map(row=>row.action)).toEqual(['unpublish','publish']);
    const restored=await json(await req('/cloud/cases/cn-westlake-demo/restore','POST',{requestId:requestId(),expectedVersion:1,publicationId}));
    expect(restored).toMatchObject({version:2,status:'published',publicationId});
    const publicAfter=await json(await req('/cloud/cases/cn-westlake-demo','GET',undefined,null));
    expect(publicAfter).toMatchObject({publicationId,revision:0});
  });

  it('allows an ordinary user to save dependencies of a public case in an independent project', async () => {
    const read = await json(await req('/cloud/cases/cn-westlake-demo', 'GET', undefined, null));
    const studioId = crypto.randomUUID();
    await f.db.query('insert into scene_private.studios(id,name) values ($1,$2)', [studioId, '案例副本工作室']);
    await f.db.query("insert into scene_private.members(studio_id,user_id,role,display_name) values ($1,$2,'owner','普通用户')", [studioId, outsider]);
    const project = await f.rpc(outsider, 'projects.create', { studioId, name: '案例独立副本', scene: scene() });
    const lease = await f.rpc(outsider, 'lease.acquire', { projectId: project.id, sessionId: session });
    const response = await req(`/cloud/projects/${project.id}`, 'PUT', { requestId: requestId(), sessionId: session, generation: lease.generation, expectedRevision: 0, manifest: { ...(read.manifest as object), sources: {} } }, outsider);
    expect(response.status).toBe(200);
  });

  it('keeps case management admin-only and public reads anonymous-safe',async()=>{
    // 非管理员无法看到草稿列表，也不能读未公开案例的内容。
    await expectCode(await req('/cloud/cases/manage','GET',undefined,editor),'PLATFORM_ADMIN_REQUIRED');
    // 匿名请求管理口 → 401。
    const anonymous=await req('/cloud/cases/manage','GET',undefined,null);
    expect(anonymous.status).toBe(401);
    // 普通用户可匿名读公开目录（本用例此时至少 0 条，形状为数组）。
    const list=await req('/cloud/cases','GET',undefined,null);
    expect(list.status).toBe(200);
    expect(Array.isArray(await json(list))).toBe(true);
  });

  it('creates, reads and revokes a complete share; tokens are issued exactly once',async()=>{
    const project=await f.rpc(owner,'projects.create',{studioId:studio,name:'受控完整分享',scene:scene()});
    const projectId=String((project as Record<string,unknown>).id);
    const lease=await f.rpc(owner,'lease.acquire',{projectId,sessionId:session});
    const saveInput=completeSaveSchema.parse({requestId:requestId(),sessionId:session,generation:Number((lease as Record<string,unknown>).generation),expectedRevision:0,manifest:{version:1 as const,scene:scene(),outdoor:null,sources:{},dependencies:[]}});
    // 未保存完整清单 → DEPENDENCY_INCOMPLETE。
    await expectCode(await req(`/cloud/projects/${projectId}/shares`,'POST',completeShareSchema.parse({requestId:requestId(),expectedRevision:0})),'DEPENDENCY_INCOMPLETE');
    await req(`/cloud/projects/${projectId}`,'PUT',saveInput);
    const requestIdValue=requestId();
    const share=await json(await req(`/cloud/projects/${projectId}/shares`,'POST',completeShareSchema.parse({requestId:requestIdValue,expectedRevision:0})));
    const token=String(share.token);
    expect(share).toMatchObject({publicationId:expect.any(String),revision:0});
    expect(token).toMatch(/^[a-f0-9]{64}$/);
    // 同 requestId 重试：同一确认但 token=null（服务端仅存哈希，不二次发令牌）。
    const retry=await json(await req(`/cloud/projects/${projectId}/shares`,'POST',completeShareSchema.parse({requestId:requestIdValue,expectedRevision:0})));
    expect(retry.token).toBeNull();
    expect(String(retry.shareId)).toBe(String(share.shareId));
    // 匿名读取受控分享：内容形状与公开案例一致。
    const read=await json(await req('/cloud/shares/read','POST',{token},null));
    expect(read).toMatchObject({publicationId:String(share.publicationId),revision:0});
    expect((read.manifest as Record<string,unknown>).outdoor).toBeNull();
    // 撤销走既有项目 shares 口；撤销后读取被拒。
    const revoked=await req(`/projects/${projectId}/shares/${String(share.shareId)}`,'DELETE',{});
    expect(revoked.status).toBe(200);
    await expectCode(await req('/cloud/shares/read','POST',{token},null),'SHARE_NOT_FOUND');
    // 无关用户不能对他人项目创建完整分享。
    const other=await req(`/cloud/projects/${projectId}/shares`,'POST',completeShareSchema.parse({requestId:requestId(),expectedRevision:0}),outsider);
    expect(other.status).toBe(404);
  });
});

describe('cloud routes without the review SQL deployed',()=>{
  let f:Awaited<ReturnType<typeof database>>,api:ReturnType<typeof createApi>;
  beforeAll(async()=>{
    f=await database();
    api=createApi(f.backend,key=>({PUBLIC_APP_URL:'https://app.example',ALLOWED_ORIGINS:'https://app.example'}[key]));
  },30000);
  afterAll(async()=>{await f?.db.close();});
  function req(path:string,method='GET',actor:string|null=owner) {
    return api(new Request(`https://backend.example/functions/v1/scene-api${path}`,{
      method,headers:{...(actor?{Authorization:`Bearer ${actor}`}:{'X-No-Auth':'true'}),Origin:'https://app.example'},
    }));
  }
  it('reports 503 CLOUD_STORAGE_UNAVAILABLE for capability probes and admin reads',async()=>{
    const capabilities=await req('/cloud/capabilities');
    expect(capabilities.status).toBe(503);
    expect(await capabilities.json()).toMatchObject({error:{code:'CLOUD_STORAGE_UNAVAILABLE'}});
    const drafts=await req('/cloud/cases/manage');
    expect(drafts.status).toBe(503);
    const list=await req('/cloud/cases','GET',null);
    expect(list.status).toBe(503);
  });
  it('still requires authentication for authenticated cloud routes',async()=>{
    const response=await req('/cloud/capabilities','GET',null);
    expect(response.status).toBe(401);
  });
});
