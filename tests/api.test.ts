import { beforeAll,afterAll,describe,it,expect } from 'vitest';
import { database,owner,editor,outsider,studio,session,scene,chair } from './fixtures.ts';
import { createApi } from '../supabase/functions/_shared/api.ts';
import { sceneHash } from '../supabase/functions/_shared/domain.ts';
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
  it('runs create -> lease -> save -> publish -> draft edit -> anonymous read -> revoke',async()=>{
    const p=await (await req('/projects','POST',{studioId:studio,name:'Workshop',scene:scene()})).json();expect(p.id).toBeTruthy();
    const l=await (await req(`/projects/${p.id}/lease/acquire`,'POST',{sessionId:session})).json();expect(l.generation).toBe(1);
    const s=scene();s.objects=[chair('private note')];
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
