import { afterAll,beforeAll,describe,expect,it } from 'vitest';
import { database,owner,editor,outsider } from './fixtures.ts';
import { createApi } from '../supabase/functions/_shared/api.ts';

type Row = { id:string; fromUserId:string; toUserId:string; body:string; createdAt:string; readAt:string|null };

describe('team direct messages',()=>{
  let f:Awaited<ReturnType<typeof database>>,api:ReturnType<typeof createApi>;
  beforeAll(async()=>{f=await database();api=createApi(f.backend,key=>key==='ALLOWED_ORIGINS'?'https://app.example':undefined);},30000);
  afterAll(async()=>{await f?.db.close();});
  function req(path:string,method='GET',body?:unknown,actor:string|null=owner) {
    return api(new Request(`https://backend.example/functions/v1/scene-api${path}`,{method,
      headers:{...(actor?{Authorization:`Bearer ${actor}`}:{'X-No-Auth':'true'}),'Content-Type':'application/json',Origin:'https://app.example'},
      body:body===undefined?undefined:JSON.stringify(body)}));
  }
  // 每个用例开一间只有丽丽和终树的团队，免得上一条留下的未读影响这一条的计数。
  async function teamStudio(name:string) {
    const studioId=crypto.randomUUID();
    expect((await req('/studios','POST',{requestId:studioId,name,displayName:'丽丽'})).status).toBe(201);
    expect((await req(`/studios/${studioId}/members/${editor}`,'PUT',{displayName:'终树'})).status).toBe(200);
    return studioId;
  }
  const send=(studioId:string,peerId:string,body:string,actor=owner,requestId=crypto.randomUUID())=>
    req(`/studios/${studioId}/messages`,'POST',{requestId,peerId,body},actor);
  const thread=(studioId:string,peerId:string,actor=owner)=>req(`/studios/${studioId}/messages?peerId=${peerId}`,'GET',undefined,actor);
  const unread=(studioId:string,actor=owner)=>req(`/studios/${studioId}/messages/unread`,'GET',undefined,actor);

  it('lets an editor write to the owner and both read the same thread',async()=>{
    const studioId=await teamStudio('对话工作室');
    const first=await send(studioId,owner,'在吗，方案改了两版',editor);
    expect(first.status).toBe(201);
    expect(await first.json()).toMatchObject({fromUserId:editor,toUserId:owner,body:'在吗，方案改了两版',readAt:null});
    expect((await send(studioId,editor,'收到，我看下')).status).toBe(201);
    const seen=(await (await thread(studioId,editor,owner)).json()) as Row[];
    expect(seen.map(message=>[message.fromUserId,message.body])).toEqual([[editor,'在吗，方案改了两版'],[owner,'收到，我看下']]);
    expect(new Set(seen.map(message=>message.toUserId))).toEqual(new Set([owner,editor]));
    expect(await (await thread(studioId,owner,editor)).json()).toEqual(seen);
    expect(await (await unread(studioId)).json()).toEqual([{userId:editor,count:1}]);
    expect(await (await unread(studioId,editor)).json()).toEqual([{userId:owner,count:1}]);
    expect(await (await req(`/studios/${studioId}/messages/read`,'POST',{peerId:editor})).json()).toEqual({marked:1});
    const after=(await (await thread(studioId,editor,owner)).json()) as Row[];
    expect(after.find(message=>message.fromUserId===editor)?.readAt).toEqual(expect.any(String));
    expect(after.find(message=>message.fromUserId===owner)?.readAt).toBeNull();
    expect(await (await unread(studioId)).json()).toEqual([]);
    expect(await (await unread(studioId,editor)).json()).toEqual([{userId:owner,count:1}]);
    expect(await (await req(`/studios/${studioId}/messages/read`,'POST',{peerId:editor})).json()).toEqual({marked:0});
  });
  it('treats a note to myself as already read',async()=>{
    const studioId=await teamStudio('给自己留言');
    const response=await send(studioId,owner,'明天记得问终树要尺寸');
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({fromUserId:owner,toUserId:owner,readAt:expect.any(String)});
    expect(await (await thread(studioId,owner)).json()).toHaveLength(1);
    expect(await (await unread(studioId)).json()).toEqual([]);
  });
  it('reuses a retried send and rejects a changed request id',async()=>{
    const studioId=await teamStudio('重发保护');
    const requestId=crypto.randomUUID();
    const sent=await (await send(studioId,editor,'渲染好了',owner,requestId)).json();
    expect(await (await send(studioId,editor,'渲染好了',owner,requestId)).json()).toEqual(sent);
    expect(await (await thread(studioId,editor)).json()).toHaveLength(1);
    expect((await send(studioId,editor,'渲染好了吗',owner,requestId)).status).toBe(409);
    expect((await send(studioId,editor,'渲染好了',editor,requestId)).status).toBe(409);
  });
  it('keeps messages inside the team',async()=>{
    const studioId=await teamStudio('外人进不来');
    expect((await send(studioId,owner,'偷看',outsider)).status).toBe(404);
    expect((await thread(studioId,owner,outsider)).status).toBe(404);
    expect((await unread(studioId,outsider)).status).toBe(404);
    expect((await send(studioId,outsider,'不在团队的人')).status).toBe(404);
    const other=crypto.randomUUID();
    expect((await req('/studios','POST',{requestId:other,name:'只有丽丽的团队',displayName:'丽丽'},outsider)).status).toBe(201);
    expect((await send(other,owner,'跨团队',outsider)).status).toBe(404);
    expect((await send(studioId,owner,'   ')).status).toBe(400);
    expect((await send(studioId,owner,'x'.repeat(2001))).status).toBe(400);
    expect((await req(`/studios/${studioId}/messages?peerId=${owner}`,'GET',undefined,null)).status).toBe(401);
  });
});
