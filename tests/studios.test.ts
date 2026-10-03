import { afterAll,beforeAll,describe,expect,it } from 'vitest';
import { database,owner,editor,outsider,studio,session,scene } from './fixtures.ts';
import { createApi } from '../supabase/functions/_shared/api.ts';

describe('studio membership business API',()=>{
  let f:Awaited<ReturnType<typeof database>>,api:ReturnType<typeof createApi>;
  beforeAll(async()=>{f=await database();api=createApi(f.backend,key=>key==='ALLOWED_ORIGINS'?'https://app.example':undefined);},30000);
  afterAll(async()=>{await f?.db.close();});
  function req(path:string,method='GET',body?:unknown,actor:string|null=owner) {
    return api(new Request(`https://backend.example/functions/v1/scene-api${path}`,{method,
      headers:{...(actor?{Authorization:`Bearer ${actor}`}:{'X-No-Auth':'true'}),'Content-Type':'application/json',Origin:'https://app.example'},
      body:body===undefined?undefined:JSON.stringify(body)}));
  }
  it('lets an authenticated account create an isolated workspace with retry protection',async()=>{
    const input={requestId:crypto.randomUUID(),name:'另一工作室',displayName:'负责人'};
    const response=await req('/studios','POST',input,outsider);
    expect(response.status).toBe(201);
    const created=await response.json();expect(created).toEqual({id:input.requestId,name:input.name,role:'owner',displayName:input.displayName});
    expect(await (await req('/studios','POST',input,outsider)).json()).toEqual(created);
    expect((await f.rpc(outsider,'studios'))).toEqual([created]);
    expect((await req('/studios','POST',{...input,name:'changed'},outsider)).status).toBe(409);
    expect((await req('/studios','POST',input,owner)).status).toBe(409);
    const project=await f.rpc(outsider,'projects.create',{studioId:created.id,name:'独立项目',scene:scene()});
    await expect(f.rpc(owner,'projects.get',{projectId:project.id})).rejects.toThrow('PROJECT_NOT_FOUND');
    expect((await req(`/studios/${created.id}/members`)).status).toBe(404);
  });
  it('does not claim an existing studio without an owner',async()=>{
    const requestId=crypto.randomUUID();
    await f.db.query('insert into scene_private.studios(id,name) values($1,$2)',[requestId,'Existing']);
    await expect(f.rpc(owner,'studios.create',{requestId,name:'Existing',displayName:'Owner'})).rejects.toThrow('IDEMPOTENCY_CONFLICT');
  });
  it('only lets the owner add existing accounts and protects the owner membership',async()=>{
    await f.db.exec('revoke select on auth.users from service_role');
    const path=`/studios/${studio}/members`;
    expect((await req(`${path}/${outsider}`,'PUT',{displayName:'协作者'},editor)).status).toBe(403);
    expect((await req(`${path}/${outsider}`,'PUT',{displayName:'协作者'},outsider)).status).toBe(404);
    expect((await req(`${path}/${crypto.randomUUID()}`,'PUT',{displayName:'不存在'})).status).toBe(404);
    const added=await req(`${path}/${outsider}`,'PUT',{displayName:'协作者'});
    expect(added.status).toBe(200);expect(await added.json()).toEqual({userId:outsider,role:'editor',displayName:'协作者'});
    expect((await req(`${path}/${outsider}`,'PUT',{displayName:'新展示名'})).status).toBe(200);
    const members=await (await req(path,'GET',undefined,outsider)).json();
    expect(members).toHaveLength(3);expect(members).toContainEqual({userId:outsider,role:'editor',displayName:'新展示名'});
    for(const method of ['PUT','DELETE']) {
      const result=await req(`${path}/${owner}`,method,method==='PUT'?{displayName:'changed'}:undefined);
      expect((await result.json()).error.code).toBe('OWNER_PROTECTED');
    }
  });
  it('removes access and invalidates leases while preserving saved projects and publications',async()=>{
    const project=await f.rpc(outsider,'projects.create',{studioId:studio,name:'协作项目',scene:scene()});
    const lease=await f.rpc(outsider,'lease.acquire',{projectId:project.id,sessionId:session});
    const publication=await f.rpc(outsider,'publish',{projectId:project.id,expectedRevision:0,tokenHash:'c'.repeat(64)});
    const path=`/studios/${studio}/members/${outsider}`;
    expect((await req(path,'DELETE',undefined,editor)).status).toBe(403);
    expect(await (await req(path,'DELETE')).json()).toEqual({removed:true});
    expect((await req(path,'DELETE')).status).toBe(200);
    await expect(f.rpc(outsider,'projects.get',{projectId:project.id})).rejects.toThrow('PROJECT_NOT_FOUND');
    expect((await f.rpc(null,'share.read',{tokenHash:'c'.repeat(64)})).publicationId).toBe(publication.publicationId);
    const acquired=await f.rpc(owner,'lease.acquire',{projectId:project.id,sessionId:crypto.randomUUID()});
    expect(acquired.generation).toBeGreaterThan(lease.generation);
    await req(path,'PUT',{displayName:'返回成员'});
    await expect(f.rpc(outsider,'lease.renew',{projectId:project.id,sessionId:session,generation:lease.generation})).rejects.toThrow('LEASE_LOST');
    expect((await f.rpc(owner,'projects.get',{projectId:project.id})).revision).toBe(0);
  });
  it('rejects anonymous requests and caller-supplied roles or identities',async()=>{
    expect((await req('/studios','POST',{requestId:crypto.randomUUID(),name:'x',displayName:'x'},null)).status).toBe(401);
    expect((await req('/studios','POST',{requestId:crypto.randomUUID(),name:' ',displayName:'x'})).status).toBe(400);
    expect((await req('/studios','POST',{requestId:crypto.randomUUID(),name:'x',displayName:'x',actor:outsider})).status).toBe(400);
    expect((await req(`/studios/${studio}/members/${editor}`,'PUT',{displayName:'x',role:'owner'})).status).toBe(400);
    expect((await req(`/studios/${studio}/members/not-a-uuid`,'DELETE')).status).toBe(400);
    for(const role of ['anon','authenticated']) {
      await expect(f.db.transaction(async tx=>{await tx.exec(`set local role ${role}`);await tx.exec("select public.studio_rpc(null,'studios.create','{}')");})).rejects.toThrow(/permission denied/);
    }
    const fn=await f.db.query<{prosecdef:boolean}>("select prosecdef from pg_proc where proname='studio_rpc'");
    expect(fn.rows).toEqual([{prosecdef:false}]);
  });
});
