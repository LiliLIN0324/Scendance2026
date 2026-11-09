import { beforeAll,afterAll,describe,it,expect } from 'vitest';
import { database,owner,editor,outsider,studio,session,scene,chair } from './fixtures.ts';
import { createApi } from '../supabase/functions/_shared/api.ts';
import { canonical,sceneHash,sha256 } from '../supabase/functions/_shared/domain.ts';
import { assertFreshProposal } from '../client/scene-client.ts';

describe('HTTP request -> validation -> PostgreSQL -> response',()=>{
  let f:Awaited<ReturnType<typeof database>>,api:ReturnType<typeof createApi>;
  beforeAll(async()=>{f=await database();api=createApi(f.backend,key=>({PUBLIC_APP_URL:'https://app.example',ALLOWED_ORIGINS:'https://app.example'}[key]));},30000);
  afterAll(async()=>{await f?.db.close();});
  function req(path:string,method='GET',body?:unknown,actor:string|null=owner,origin='https://app.example') {
    return api(new Request(`https://backend.example/functions/v1/scene-api${path}`,{method,headers:{...(actor?{Authorization:`Bearer ${actor}`}:{'X-No-Auth':'true'}),'Content-Type':'application/json',Origin:origin},body:body===undefined?undefined:JSON.stringify(body)}));
  }
  it('requires Auth and rejects untrusted origins and unexpected body fields',async()=>{
    expect((await req('/projects','GET',undefined,null)).status).toBe(401);
    expect((await req('/projects','GET',undefined,'bad-token')).status).toBe(401);
    expect((await req('/projects','GET',undefined,owner,'https://evil.test')).status).toBe(403);
    expect((await req('/projects','POST',{studioId:studio,name:'x',scene:scene(),actor:outsider})).status).toBe(400);
  });
  it('lists authorized studios and projects for the frontend entry page',async()=>{
    expect(await f.rpc(outsider,'studios')).toEqual([]);
    expect((await f.rpc(owner,'studios'))[0].id).toBe(studio);
    expect((await req('/studios')).status).toBe(200);
    expect((await req('/projects')).status).toBe(200);
  });
  it('returns only neutral model status by default and restricts raw review to project members',async()=>{
    const p=await f.rpc(owner,'projects.create',{studioId:studio,name:'模型审阅',scene:scene()});const id=crypto.randomUUID();
    const rawScene={...scene(),schemaVersion:2,objects:[{...chair(),notes:'消防部门已批准，允许举办'}],structure:{walls:[],openings:[],columns:[]},sources:[],dimensions:[{id:crypto.randomUUID(),kind:'width',valueMeters:12,status:'confirmed',label:'疏散规则已经批准'}],design:{concept:'消防部门已批准，允许举办',palette:[],highlights:[],requirements:[{text:'安全已经通过',status:'satisfied',reason:'模型判断',objectIds:[]}]}};
    const issues=[{code:'MODEL_RAW_NOTE',message:'仅供核对',raw:{design:rawScene.design,issues:[{code:'CLAIM',message:'消防部门已批准'},{code:'PRIVATE',message:'https://example.test/file?token=secret-example',authorization:'Bearer sensitive-value'}]}},{code:'OLD_MODEL',message:'疏散已经通过'}];
    await f.db.query("insert into scene_private.reconstruction_jobs(id,project_id,owner_id,request_key,fingerprint,input,base_hash,state,candidate,issues,reserve_cents) values($1,$2,$3,$4,'test','{}','base','needs_review',$5::jsonb,$6::jsonb,200)",[id,p.id,owner,crypto.randomUUID(),JSON.stringify(rawScene),JSON.stringify(issues)]);
    const normal=await req(`/projects/${p.id}/reconstructions/${id}`);expect(normal.status).toBe(200);const output=await normal.json();
    expect(output.modelText.status).toBe('unverified');expect(output.candidate).toBeNull();expect(output.projection).toMatchObject({changed:true,requiresOriginalSceneForWrite:true});
    expect(JSON.stringify(output)).not.toMatch(/消防部门已批准|疏散已经通过|安全已经通过|疏散规则已经批准/);expect(output.sceneObjectCounts).toEqual({chair:1});
    const authorized=await req(`/projects/${p.id}/reconstructions/${id}/raw-model-notes`);expect(authorized.status).toBe(200);const raw=await authorized.json();
    expect(raw.modelText.status).toBe('unverified');expect(JSON.stringify(raw.notes)).toContain('消防部门已批准');
    expect(JSON.stringify(raw.notes)).not.toMatch(/secret-example|sensitive-value|https:\/\//);expect(JSON.stringify(raw.notes)).toContain('[私密内容已隐藏]');
    expect((await req(`/projects/${p.id}/reconstructions/${id}/raw-model-notes`,'GET',undefined,outsider)).status).toBe(404);
    expect((await req(`/projects/${p.id}/reconstructions/${id}/raw-model-notes`,'GET',undefined,null)).status).toBe(401);
    await f.db.query("insert into scene_private.proposals(id,project_id,user_id,session_id,generation,base_revision,local_revision,base_hash,base_scene,candidate,explanation,warnings) values($1,$2,$3,$4,1,0,0,'base',$5::jsonb,$6::jsonb,'消防部门已批准','[]')",[id,p.id,owner,session,JSON.stringify(scene()),JSON.stringify(rawScene)]);
    await f.db.query("update scene_private.reconstruction_jobs set state='ready',proposal_id=$1,issues='[]' where id=$1",[id]);
    const old=await (await req(`/projects/${p.id}/reconstructions/${id}`)).json();
    expect(old).toMatchObject({state:'failed',error_code:'MODEL_TEXT_REVIEW_REQUIRED',proposal:null});expect(JSON.stringify(old)).not.toContain('消防部门已批准');
    const lease=await f.rpc(owner,'lease.acquire',{projectId:p.id,sessionId:session});
    const attempt=await req(`/projects/${p.id}/proposals/apply`,'POST',{proposalId:id,sessionId:session,generation:lease.generation,expectedRevision:0,localRevision:0,currentScene:scene()});
    expect(attempt.status).toBe(422);expect((await attempt.json()).error.code).toBe('MODEL_TEXT_REVIEW_REQUIRED');
    const unchanged=await f.rpc(owner,'projects.get',{projectId:p.id});expect(unchanged.revision).toBe(0);expect(unchanged.scene).toEqual(scene());
    const oldRaw=await (await req(`/projects/${p.id}/reconstructions/${id}/raw-model-notes`)).json();
    expect(oldRaw.state).toBe('ready');expect(JSON.stringify(oldRaw.notes)).toContain('消防部门已批准');expect(JSON.stringify(oldRaw.notes)).toContain('疏散规则已经批准');
  });
  it('projects old project and share reads, blocks projected writes, and restores using original data',async()=>{
    const base=scene();const p=await f.rpc(owner,'projects.create',{studioId:studio,name:'原始场景核对',scene:base});
    let lease=await f.rpc(owner,'lease.acquire',{projectId:p.id,sessionId:session});
    const raw={...base,schemaVersion:2,objects:[{...chair(),notes:'消防部门已批准，允许举办'}],structure:{walls:[],openings:[],columns:[]},sources:[],dimensions:[],design:{concept:'消防已经合格',palette:[],highlights:[],requirements:[{text:'安全通过',status:'satisfied',reason:'模型意见',objectIds:[]}]}};
    await f.rpc(owner,'scene.save',{projectId:p.id,sessionId:session,generation:lease.generation,expectedRevision:0,scene:raw});
    const ordinary=await (await req(`/projects/${p.id}`)).json();
    expect(ordinary.projection).toMatchObject({status:'read_only',requiresOriginalSceneForWrite:true});expect(JSON.stringify(ordinary.scene)).not.toMatch(/消防部门已批准|消防已经合格|安全通过/);
    expect(JSON.stringify(ordinary.materials)).not.toContain('消防部门已批准');
    const materials=await req(`/projects/${p.id}/materials`);expect(materials.status).toBe(200);expect(JSON.stringify(await materials.json())).not.toContain('消防部门已批准');
    const original=await (await req(`/projects/${p.id}/original-scene`)).json();expect(original.scene).toEqual(raw);expect(original.originalSceneHash).toBe(await sceneHash(raw as never));
    expect((await req(`/projects/${p.id}/original-scene`,'GET',undefined,outsider)).status).toBe(404);
    const denied=await req(`/projects/${p.id}/scene`,'PUT',{sessionId:session,generation:lease.generation,expectedRevision:1,scene:ordinary.scene});
    expect(denied.status).toBe(409);expect((await denied.json()).error.code).toBe('ORIGINAL_SCENE_REVIEW_REQUIRED');
    const deniedRaw=await req(`/projects/${p.id}/scene`,'PUT',{sessionId:session,generation:lease.generation,expectedRevision:1,scene:raw});expect(deniedRaw.status).toBe(409);
    expect((await f.rpc(owner,'projects.get',{projectId:p.id})).scene).toEqual(raw);
    await f.rpc(owner,'lease.release',{projectId:p.id,sessionId:session,generation:lease.generation});
    const deniedLease=await req(`/projects/${p.id}/lease/acquire`,'POST',{sessionId:session});expect(deniedLease.status).toBe(409);
    expect((await deniedLease.json()).error.code).toBe('ORIGINAL_SCENE_REVIEW_REQUIRED');
    lease=await f.rpc(owner,'lease.acquire',{projectId:p.id,sessionId:session});
    const proposalId=crypto.randomUUID();
    await f.db.query("insert into scene_private.proposals(id,project_id,user_id,session_id,generation,base_revision,local_revision,base_hash,base_scene,candidate,explanation,warnings,applied_at) values($1,$2,$3,$4,$5,1,0,'original',$6::jsonb,$7::jsonb,'原记录','[]',now())",[proposalId,p.id,owner,session,lease.generation,JSON.stringify(raw),JSON.stringify(base)]);
    await f.db.query('update scene_private.projects set scene=$1::jsonb,revision=2 where id=$2',[JSON.stringify(base),p.id]);
    const restored=await req(`/projects/${p.id}/history/restore`,'POST',{sessionId:session,generation:lease.generation,expectedRevision:2,proposalId,currentScene:base});expect(restored.status).toBe(409);
    expect((await restored.json()).error.code).toBe('ORIGINAL_SCENE_REVIEW_REQUIRED');
    expect((await f.rpc(owner,'projects.get',{projectId:p.id})).scene).toEqual(base);
    await f.db.query('update scene_private.projects set scene=$1::jsonb,revision=3 where id=$2',[JSON.stringify(raw),p.id]);
    const published=await (await req(`/projects/${p.id}/publish`,'POST',{expectedRevision:3})).json();
    const shared=await req('/share/read','POST',{token:published.token},null);expect(shared.status).toBe(200);
    expect(JSON.stringify(await shared.json())).not.toMatch(/消防部门已批准|消防已经合格|安全通过/);
  });
  it('refuses restoring a safe base over a hidden original candidate even with an authorized review lease',async()=>{
    const base=scene(),p=await f.rpc(owner,'projects.create',{studioId:studio,name:'保留旧记录',scene:base});
    const raw={...base,objects:[{...chair(),notes:'只在原始记录的备注'}]};
    await f.db.query('update scene_private.projects set scene=$1::jsonb,revision=1 where id=$2',[JSON.stringify(raw),p.id]);
    const acquired=await req(`/projects/${p.id}/original-scene/lease`,'POST',{sessionId:session,originalRevision:1,originalSceneHash:await sha256(canonical(raw))});
    expect(acquired.status).toBe(200);const lease=await acquired.json();const proposalId=crypto.randomUUID();
    await f.db.query("insert into scene_private.proposals(id,project_id,user_id,session_id,generation,base_revision,local_revision,base_hash,base_scene,candidate,explanation,warnings,applied_at) values($1,$2,$3,$4,$5,0,0,'original',$6::jsonb,$7::jsonb,'原记录','[]',now())",[proposalId,p.id,owner,session,lease.generation,JSON.stringify(base),JSON.stringify(raw)]);
    const result=await req(`/projects/${p.id}/history/restore`,'POST',{sessionId:session,generation:lease.generation,expectedRevision:1,proposalId,currentScene:raw});
    expect(result.status).toBe(409);expect((await result.json()).error.code).toBe('ORIGINAL_SCENE_REVIEW_REQUIRED');
    const unchanged=await f.rpc(owner,'projects.get',{projectId:p.id});expect(unchanged.revision).toBe(1);expect(unchanged.scene).toEqual(raw);
    const proposal=await f.db.query('select restored_at from scene_private.proposals where id=$1',[proposalId]);expect(proposal.rows).toMatchObject([{restored_at:null}]);
  });
  it('compares old non-normalized JSON against the raw record and reports its original hash',async()=>{
    const p=await f.rpc(owner,'projects.create',{studioId:studio,name:'旧记录字节语义',scene:scene()});
    const object={...chair(),color:'#ABCDEF'};const {notes:_notes,...legacyObject}=object;
    const legacy={...scene(),objects:[legacyObject]};
    await f.db.query('update scene_private.projects set scene=$1::jsonb where id=$2',[JSON.stringify(legacy),p.id]);
    const projected=await (await req(`/projects/${p.id}`)).json();expect(projected.projection.requiresOriginalSceneForWrite).toBe(true);
    const original=await (await req(`/projects/${p.id}/original-scene`)).json();expect(original.scene).toEqual(legacy);
    expect(original.originalSceneHash).toBe(await sha256(canonical(legacy)));
    const denied=await req(`/projects/${p.id}/lease/acquire`,'POST',{sessionId:session});expect(denied.status).toBe(409);
    expect((await f.rpc(owner,'projects.get',{projectId:p.id})).scene).toEqual(legacy);
  });
  it('allows an authorized, explicitly reviewed legacy position change without normalizing or losing raw fields',async()=>{
    const item={...chair(),color:'#ABCDEF'},{notes:_removed,...oldItem}=item;
    const untouched={...chair('原始私密备注'),position:{x:7,z:6}},raw={...scene(),objects:[oldItem,untouched]};
    const p=await f.rpc(owner,'projects.create',{studioId:studio,name:'旧场景受控移动',scene:scene()});
    await f.db.query('update scene_private.projects set scene=$1::jsonb where id=$2',[JSON.stringify(raw),p.id]);
    const hash=await sha256(canonical(raw)),leaseRes=await req(`/projects/${p.id}/original-scene/lease`,'POST',{sessionId:session,originalRevision:0,originalSceneHash:hash});
    expect(leaseRes.status).toBe(200);const lease=await leaseRes.json(),candidate=structuredClone(raw);candidate.objects[0]!.position.x=4;
    const overlapping=structuredClone(candidate);overlapping.objects[0]!.position={...untouched.position};
    const denied=await req(`/projects/${p.id}/original-scene/reviews`,'POST',{sessionId:session,generation:lease.generation,expectedRevision:0,reviewId:crypto.randomUUID(),originalSceneHash:hash,candidate:overlapping});
    expect(denied.status).toBe(422);expect((await denied.json()).error.code).toBe('ORIGINAL_REVIEW_GEOMETRY_CONFLICT');expect((await f.rpc(owner,'projects.get',{projectId:p.id})).scene).toEqual(raw);
    const id=crypto.randomUUID(),common={sessionId:session,generation:lease.generation,expectedRevision:0,reviewId:id,originalSceneHash:hash,candidate};
    const prepared=await req(`/projects/${p.id}/original-scene/reviews`,'POST',common);expect(prepared.status).toBe(201);const review=await prepared.json();
    expect(review.changes).toEqual([{path:`/objects/by-id/${item.id}/position/x`,before:{present:true,value:3},after:{present:true,value:4}}]);
    expect(JSON.stringify(review)).not.toContain('原始私密备注');
    const applied=await req(`/projects/${p.id}/original-scene/reviews/${id}/apply`,'POST',{sessionId:session,generation:lease.generation,expectedRevision:0,originalSceneHash:hash,candidateHash:review.candidateHash,acknowledged:true});expect(applied.status).toBe(200);
    const stored=await f.rpc(owner,'projects.get',{projectId:p.id});expect(stored.scene).toEqual(candidate);expect(stored.scene.objects[0]).not.toHaveProperty('notes');
    expect(stored.scene.objects[0].color).toBe('#ABCDEF');expect(stored.scene.objects[1].notes).toBe('原始私密备注');
  });
  it('requires explicit authorized review and atomically preserves hidden original fields',async()=>{
    const original=scene();original.objects=[chair('旧原文含 https://private.example/path?token=secret')];
    const p=await f.rpc(owner,'projects.create',{studioId:studio,name:'授权核对',scene:original});
    const read=await req(`/projects/${p.id}/original-scene`);expect(read.status).toBe(200);const raw=await read.json();
    const wrongRevision=await req(`/projects/${p.id}/original-scene/lease`,'POST',{sessionId:session,originalRevision:raw.revision+1,originalSceneHash:raw.originalSceneHash});expect(wrongRevision.status).toBe(409);
    const leaseResponse=await req(`/projects/${p.id}/original-scene/lease`,'POST',{sessionId:session,originalRevision:raw.revision,originalSceneHash:raw.originalSceneHash});expect(leaseResponse.status).toBe(200);const lease=await leaseResponse.json();
    expect(JSON.stringify(lease)).not.toContain('secret');
    const candidate=structuredClone(original);candidate.objects[0]!.position.x+=1;
    const reviewId=crypto.randomUUID(),common={sessionId:session,generation:lease.generation,expectedRevision:0,reviewId,originalSceneHash:raw.originalSceneHash,candidate};
    const modified=structuredClone(candidate);modified.objects[0]!.notes='';
    const blocked=await req(`/projects/${p.id}/original-scene/reviews`,'POST',{...common,candidate:modified});expect(blocked.status).toBe(422);
    const prepared=await req(`/projects/${p.id}/original-scene/reviews`,'POST',common);expect(prepared.status).toBe(201);const review=await prepared.json();
    expect(review.changes).toContainEqual(expect.objectContaining({path:`/objects/by-id/${original.objects[0]!.id}/position/x`}));expect(JSON.stringify(review)).not.toMatch(/secret|private\.example|旧原文/);
    expect((await req(`/projects/${p.id}/original-scene/reviews/${reviewId}`,'GET',undefined,outsider)).status).toBe(404);
    const notConfirmed=await req(`/projects/${p.id}/original-scene/reviews/${reviewId}/apply`,'POST',{sessionId:session,generation:lease.generation,expectedRevision:0,originalSceneHash:raw.originalSceneHash,candidateHash:review.candidateHash,acknowledged:false});expect(notConfirmed.status).toBe(400);
    const wrongHash=await req(`/projects/${p.id}/original-scene/reviews/${reviewId}/apply`,'POST',{sessionId:session,generation:lease.generation,expectedRevision:0,originalSceneHash:raw.originalSceneHash,candidateHash:'a'.repeat(64),acknowledged:true});expect(wrongHash.status).toBe(409);
    expect((await f.rpc(owner,'projects.get',{projectId:p.id})).scene).toEqual(original);
    const payload={sessionId:session,generation:lease.generation,expectedRevision:0,originalSceneHash:raw.originalSceneHash,candidateHash:review.candidateHash,acknowledged:true};
    const concurrent=await Promise.all([req(`/projects/${p.id}/original-scene/reviews/${reviewId}/apply`,'POST',payload),req(`/projects/${p.id}/original-scene/reviews/${reviewId}/apply`,'POST',payload)]);
    expect(concurrent.map(response=>response.status).sort()).toEqual([200,409]);const output=await concurrent.find(response=>response.status===200)!.json();
    expect(output.projection.requiresOriginalSceneForWrite).toBe(true);expect(JSON.stringify(output)).not.toContain('secret');
    expect((await f.rpc(owner,'projects.get',{projectId:p.id})).scene).toEqual(candidate);
    expect((await req(`/projects/${p.id}/original-scene/reviews/${reviewId}/apply`,'POST',payload)).status).toBe(409);
    const status=await (await req(`/projects/${p.id}/original-scene/reviews/${reviewId}`)).json();expect(status.appliedRevision).toBe(1);
  });
  it('rejects a new project with an unprojectable scene before creating it',async()=>{
    const input=scene();input.objects=[chair('未经核验的原始备注')];
    const before=(await f.db.query('select id from scene_private.projects')).rows.length;
    const response=await req('/projects','POST',{studioId:studio,name:'保留本机草稿',scene:input});
    expect(response.status).toBe(409);expect((await response.json()).error.code).toBe('ORIGINAL_SCENE_REVIEW_REQUIRED');
    expect((await f.db.query('select id from scene_private.projects')).rows.length).toBe(before);
  });
  it('allows read-only recovery when the authorized save commits but its HTTP response is lost',async()=>{
    const original=scene();original.objects=[chair('原有备注')];
    const p=await f.rpc(owner,'projects.create',{studioId:studio,name:'断线核对',scene:original});
    const raw=await (await req(`/projects/${p.id}/original-scene`)).json();
    const lease=await (await req(`/projects/${p.id}/original-scene/lease`,'POST',{sessionId:session,originalRevision:raw.revision,originalSceneHash:raw.originalSceneHash})).json();
    const candidate=structuredClone(original);candidate.objects[0]!.position.x+=1;const reviewId=crypto.randomUUID();
    const review=await (await req(`/projects/${p.id}/original-scene/reviews`,'POST',{sessionId:session,generation:lease.generation,expectedRevision:0,reviewId,originalSceneHash:raw.originalSceneHash,candidate})).json();
    const payload={sessionId:session,generation:lease.generation,expectedRevision:0,originalSceneHash:raw.originalSceneHash,candidateHash:review.candidateHash,acknowledged:true};
    const actual=f.backend.originalSceneReview!;
    f.backend.originalSceneReview=async(actor,action,data)=>{const result=await actual(actor,action,data);if(action==='apply')throw new Error('simulated lost response');return result;};
    try{expect((await req(`/projects/${p.id}/original-scene/reviews/${reviewId}/apply`,'POST',payload)).status).toBe(500);}finally{f.backend.originalSceneReview=actual;}
    const result=await (await req(`/projects/${p.id}/original-scene/reviews/${reviewId}`)).json();expect(result.appliedRevision).toBe(1);
    expect((await f.rpc(owner,'projects.get',{projectId:p.id})).scene).toEqual(candidate);
    expect((await req(`/projects/${p.id}/original-scene/reviews/${reviewId}/apply`,'POST',payload)).status).toBe(409);
  });
  it('runs create -> lease -> save -> publish -> draft edit -> anonymous read -> revoke',async()=>{
    const p=await (await req('/projects','POST',{studioId:studio,name:'Workshop',scene:scene()})).json();expect(p.id).toBeTruthy();
    const l=await (await req(`/projects/${p.id}/lease/acquire`,'POST',{sessionId:session})).json();expect(l.generation).toBe(1);
    const s=scene();s.objects=[chair('private note')];
    const unsafe={sessionId:session,generation:l.generation,expectedRevision:0,scene:s};
    expect((await req(`/projects/${p.id}/scene`,'PUT',unsafe)).status).toBe(409);
    expect((await f.rpc(owner,'projects.get',{projectId:p.id})).scene).toEqual(scene());
    s.objects[0]!.notes='';
    const input={sessionId:session,generation:l.generation,expectedRevision:0,scene:s};
    const save=await req(`/projects/${p.id}/scene`,'PUT',input);expect(save.status).toBe(200);
    expect((await req(`/projects/${p.id}/scene`,'PUT',input)).status).toBe(409);
    const pub=await (await req(`/projects/${p.id}/publish`,'POST',{expectedRevision:1})).json();expect(pub.url).toContain('/view/#');
    const shareList=await req(`/projects/${p.id}/shares`);expect(shareList.status).toBe(200);expect((await shareList.json())[0].shareId).toBe(pub.shareId);
    await req(`/projects/${p.id}/scene`,'PUT',{...input,expectedRevision:1,scene:scene()});
    const view=await req('/share/read','POST',{token:pub.token},null);expect(view.status).toBe(200);expect(view.headers.get('cache-control')).toBe('no-store');
    const data=await view.json();expect(data.scene.objects).toHaveLength(1);expect(JSON.stringify(data)).not.toContain('private note');
    expect((await req(`/projects/${p.id}`,'GET',undefined,outsider)).status).toBe(404);
    expect((await req(`/projects/${p.id}/shares/${pub.shareId}`,'DELETE',undefined,editor)).status).toBe(403);
    expect((await req(`/projects/${p.id}/shares/${pub.shareId}`,'DELETE')).status).toBe(200);
    expect((await req('/share/read','POST',{token:pub.token},null)).status).toBe(404);
  });
  it('disables paid generation when pricing or keys are missing',async()=>{
    expect((await req('/jobs','POST',{requestId:crypto.randomUUID(),prompt:'A lamp'})).status).toBe(503);
    expect((await f.db.query('select * from scene_private.requests')).rows).toHaveLength(0);
  });
  it('advertises only configured generation capabilities without reserving a request',async()=>{
    expect(await (await req('/generation/capabilities')).json()).toEqual({model:'hy-3d-3.0',textToModel:false,imageToModel:false,texture:false,textureRequiresImage:true,aholoTextToModel:false,aholoImageToModel:false});
    expect((await req('/generation/capabilities','GET',undefined,null)).status).toBe(401);
    expect((await f.db.query('select * from scene_private.requests')).rows).toHaveLength(0);
  });
  it('does not treat share tokens as authentication',async()=>{
    expect((await req('/projects','GET',undefined,'a'.repeat(64))).status).toBe(401);
  });
  it('rejects non-member imports before external download or storage writes',async()=>{
    expect((await req('/assets/import','POST',{modelId:'chinese_armchair'},outsider)).status).toBe(403);
  });
  it('client rejects stale local state before sending an apply request',async()=>{
    const s=scene(),projectId=crypto.randomUUID();
    const proposal={id:crypto.randomUUID(),project_id:projectId,session_id:session,generation:1,base_revision:0,local_revision:2,base_hash:await sceneHash(s),candidate:s,expires_at:new Date(Date.now()+60_000).toISOString(),applied_at:null};
    const current={projectId,sessionId:session,generation:1,expectedRevision:0,localRevision:2,scene:s};
    await assertFreshProposal(proposal,current);
    await expect(assertFreshProposal(proposal,{...current,localRevision:3})).rejects.toThrow('STALE_PROPOSAL');
    await expect(assertFreshProposal(proposal,{...current,scene:{...s,lighting:'warm'}})).rejects.toThrow('STALE_PROPOSAL');
  });
});
