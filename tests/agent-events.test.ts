import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {createApi} from '../supabase/functions/_shared/api.ts';
import {agentEventOutcome} from '../supabase/functions/_shared/agent-events.ts';
import {agentRunRequestSchema} from '../supabase/functions/_shared/agent-contract.ts';
import {database,editor,owner,outsider,scene,session,studio} from './fixtures.ts';

describe('bounded agent execution observations',()=>{
 let f:Awaited<ReturnType<typeof database>>;
 beforeAll(async()=>{f=await database();},30000);afterAll(async()=>{await f.db.close();});
 async function setup(){
  const project=await f.rpc(owner,'projects.create',{studioId:studio,name:'事件测试',scene:scene()});
  const lease=await f.rpc(owner,'lease.acquire',{projectId:project.id,sessionId:session});
  const input=agentRunRequestSchema.parse({requestId:crypto.randomUUID(),sessionId:session,generation:lease.generation,expectedRevision:0,localRevision:0,scene:scene(),selectedIds:[],instruction:'检查虚构场景',executionMode:'preview'});
  const run=await f.backend.agent!(owner,'create',{projectId:project.id,input,fingerprint:'event-fixture',baseHash:'event-fixture',executionMode:'preview'}).catch(e=>{throw new Error('create run',{cause:e});});
  const start=await f.backend.agent!(owner,'start',{projectId:project.id,id:run.id}).catch(e=>{throw new Error('start run',{cause:e});});
  return {project,run,claim:start.claim,generation:lease.generation};
 }
 it('allows only the owner to read and only a claimed run to append, with ordered pages and a fixed shape',async()=>{
  const {project,run,claim}=await setup(),id=run.id,projectId=project.id;
  const started={tool:'find_free_areas',stage:'started',outcome:null,errorCode:null};
  const finished={tool:'find_free_areas',stage:'finished',outcome:'success',errorCode:null};
  await expect(f.backend.agentEvents!(editor,'list',{projectId,id,after:0})).rejects.toBeTruthy();
  await expect(f.backend.agentEvents!(outsider,'list',{projectId,id,after:0})).rejects.toBeTruthy();
  await expect(f.backend.agentEvents!(owner,'append',{projectId,id,claim:crypto.randomUUID(),event:started})).rejects.toBeTruthy();
  await expect(f.backend.agentEvents!(owner,'append',{projectId,id,claim,event:{...started,arguments:'PRIVATE'}})).rejects.toBeTruthy();
  await f.backend.agentEvents!(owner,'append',{projectId,id,claim,event:started}).catch(e=>{throw new Error('append started',{cause:e});});
  await f.backend.agentEvents!(owner,'append',{projectId,id,claim,event:finished});
  const api=createApi(f.backend,()=>undefined);
  const res=await api(new Request(`https://local.test/projects/${projectId}/agent-runs/${id}/events?after=0`,{headers:{authorization:`Bearer ${owner}`}}));
  expect(res.status).toBe(200);expect(await res.json()).toEqual({events:[{seq:1,...started},{seq:2,...finished}],nextCursor:2,mayBeIncomplete:true});
  const empty=await f.backend.agentEvents!(owner,'list',{projectId,id,after:2});expect(empty).toEqual({events:[],nextCursor:2,mayBeIncomplete:true});
  const denied=await api(new Request(`https://local.test/projects/${projectId}/agent-runs/${id}/events?after=0`,{headers:{authorization:`Bearer ${editor}`}}));expect(denied.status).toBe(404);
  const malformed=await api(new Request(`https://local.test/projects/${projectId}/agent-runs/${id}/events?after=1&after=2`,{headers:{authorization:`Bearer ${owner}`}}));expect(malformed.status).toBe(422);
  await f.backend.agent!(owner,'cancel',{projectId,id});
 });
 it('never treats a rejected candidate or zero accepted candidates as success',()=>{
  expect(agentEventOutcome('validate_candidate',{valid:false,code:'STRUCTURAL_COLLISION',details:'PRIVATE'})).toEqual({outcome:'failed',errorCode:'STRUCTURAL_COLLISION'});
  expect(agentEventOutcome('submit_candidates',{accepted:0,errors:[{code:'INVALID_TOOL_INPUT',details:'PRIVATE'}]})).toEqual({outcome:'failed',errorCode:'INVALID_TOOL_INPUT'});
  expect(agentEventOutcome('submit_candidates',{accepted:1,partial:true})).toEqual({outcome:'unknown',errorCode:null});
  expect(agentEventOutcome('submit_candidates',{accepted:1,expected:3})).toEqual({outcome:'unknown',errorCode:null});
  expect(agentEventOutcome('submit_candidates',{accepted:2,expected:3})).toEqual({outcome:'unknown',errorCode:null});
  expect(agentEventOutcome('submit_candidates',{accepted:1})).toEqual({outcome:'unknown',errorCode:null});
  expect(agentEventOutcome('submit_candidates',{accepted:1},3)).toEqual({outcome:'unknown',errorCode:null});
  expect(agentEventOutcome('submit_candidates',{accepted:1},1)).toEqual({outcome:'success',errorCode:null});
  expect(agentEventOutcome('submit_candidates',{accepted:3,expected:3})).toEqual({outcome:'success',errorCode:null});
  expect(agentEventOutcome('prepare_shared_seating_candidate',{shortfall:1,preparedId:'fixture'})).toEqual({outcome:'unknown',errorCode:null});
  expect(agentEventOutcome('prepare_shared_seating_candidate',{shortfall:0,preparedId:null})).toEqual({outcome:'unknown',errorCode:null});
  expect(agentEventOutcome('prepare_shared_seating_candidate',{shortfall:0,preparedId:'10000000-0000-4000-8000-000000000001'})).toEqual({outcome:'success',errorCode:null});
  expect(agentEventOutcome('get_scene',{code:'PRIVATE'})).toEqual({outcome:'failed',errorCode:null});
 });
 it('paginates after the cursor and enforces the per-run observation bound',async()=>{
  const {project,run,claim}=await setup(),projectId=project.id,id=run.id;
  const event={tool:'get_scene',stage:'started',outcome:null,errorCode:null};
  for(let i=0;i<128;i++)await f.backend.agentEvents!(owner,'append',{projectId,id,claim,event});
  await expect(f.backend.agentEvents!(owner,'append',{projectId,id,claim,event})).rejects.toBeTruthy();
  const first=await f.backend.agentEvents!(owner,'list',{projectId,id,after:0});
  const second=await f.backend.agentEvents!(owner,'list',{projectId,id,after:first.nextCursor});
  const third=await f.backend.agentEvents!(owner,'list',{projectId,id,after:second.nextCursor});
  expect([first.events.length,second.events.length,third.events.length]).toEqual([50,50,28]);
  expect([first.nextCursor,second.nextCursor,third.nextCursor]).toEqual([50,100,128]);
  expect(first.mayBeIncomplete).toBe(true);
  await f.backend.agent!(owner,'cancel',{projectId,id});
  await expect(f.backend.agentEvents!(owner,'append',{projectId,id,claim,event})).rejects.toBeTruthy();
 });
 it('rejects the old worker after release, transfer, expiry and A→B→A even if its claim is known',async()=>{
  const {project,run,claim,generation}=await setup(),projectId=project.id,id=run.id;
  const event={tool:'get_scene',stage:'started',outcome:null,errorCode:null};
  await f.backend.agentEvents!(owner,'append',{projectId,id,claim,event});
  await f.rpc(owner,'lease.release',{projectId,sessionId:session,generation});
  await expect(f.backend.agentEvents!(owner,'append',{projectId,id,claim,event})).rejects.toBeTruthy();
  const otherSession=crypto.randomUUID();
  const other=await f.rpc(editor,'lease.acquire',{projectId,sessionId:otherSession});
  await expect(f.backend.agentEvents!(owner,'append',{projectId,id,claim,event})).rejects.toBeTruthy();
  await f.rpc(editor,'lease.release',{projectId,sessionId:otherSession,generation:other.generation});
  const restored=await f.rpc(owner,'lease.acquire',{projectId,sessionId:session});
  expect(restored.generation).not.toBe(generation);
  await expect(f.backend.agentEvents!(owner,'append',{projectId,id,claim,event})).rejects.toBeTruthy();
  const history=await f.backend.agentEvents!(owner,'list',{projectId,id,after:0});expect(history.events).toHaveLength(1);
  await f.backend.agent!(owner,'cancel',{projectId,id});
 });
 it('rejects an expired lease even before a different worker claims it',async()=>{
  const {project,run,claim}=await setup(),projectId=project.id,id=run.id;
  await f.db.query("update scene_private.projects set lease_expires=clock_timestamp()-interval '1 second' where id=$1",[projectId]);
  await expect(f.backend.agentEvents!(owner,'append',{projectId,id,claim,event:{tool:'get_scene',stage:'started',outcome:null,errorCode:null}})).rejects.toBeTruthy();
  await f.backend.agent!(owner,'cancel',{projectId,id});
 });
 it('serializes telemetry with lease release and leaves history readable',async()=>{
  const {project,run,claim,generation}=await setup(),projectId=project.id,id=run.id;
  const event={tool:'get_scene',stage:'started',outcome:null,errorCode:null};
  const outcomes=await Promise.allSettled([
   f.backend.agentEvents!(owner,'append',{projectId,id,claim,event}),
   f.rpc(owner,'lease.release',{projectId,sessionId:session,generation}),
  ]);
  expect(outcomes[1]?.status).toBe('fulfilled');
  await expect(f.backend.agentEvents!(owner,'append',{projectId,id,claim,event})).rejects.toBeTruthy();
  const history=await f.backend.agentEvents!(owner,'list',{projectId,id,after:0});
  expect(history.events.length).toBeLessThanOrEqual(1);
  await f.backend.agent!(owner,'cancel',{projectId,id});
 });
 it('records a real model tool loop without exposing arguments or model content',async()=>{
  const project=await f.rpc(owner,'projects.create',{studioId:studio,name:'运行事件测试',scene:scene()});
  const lease=await f.rpc(owner,'lease.acquire',{projectId:project.id,sessionId:session});
  const input=agentRunRequestSchema.parse({requestId:crypto.randomUUID(),sessionId:session,generation:lease.generation,expectedRevision:0,localRevision:0,scene:scene(),selectedIds:[],instruction:'PRIVATE REQUEST',executionMode:'preview'});
  const call=(name:string,args:unknown)=>({id:crypto.randomUUID(),type:'function',index:0,function:{name,arguments:JSON.stringify(args)}});
  const reply=(name:string,args:unknown)=>Response.json({base_resp:{status_code:0},choices:[{finish_reason:'tool_calls',message:{role:'assistant',content:null,tool_calls:[call(name,args)]}}]});
  const fetcher=vi.fn(async()=>fetcher.mock.calls.length===1
   ?reply('validate_candidate',{title:'PRIVATE',explanation:'PRIVATE',commands:[{op:'add',materialId:'chair',position:{x:100,z:100},rotation:0,color:'#ffffff'}]})
   :reply('submit_candidates',{candidates:[{title:'示意',explanation:'待核对',commands:[]}]}));
  const env=(key:string)=>({AGENT_CHAT_PROFILE:'minimax',MINIMAX_AGENT_TOOLS_ENABLED:'1',AGENT_CHAT_BASE_URL:'https://api.minimax.cn/v1',AGENT_CHAT_KEY:'fixture',AGENT_CHAT_MODEL:'MiniMax-M3.1-Flash'} as Record<string,string>)[key];
  const api=createApi(f.backend,env,fetcher);
  const response=await api(new Request(`https://local.test/projects/${project.id}/agent-runs`,{method:'POST',headers:{authorization:`Bearer ${owner}`,'content-type':'application/json'},body:JSON.stringify(input)}));
  expect(response.status).toBe(202);const run=await response.json();
  const observed=await f.backend.agentEvents!(owner,'list',{projectId:project.id,id:run.id,after:0});
  expect(observed.events).toContainEqual(expect.objectContaining({tool:'validate_candidate',stage:'finished',outcome:'failed'}));
  expect(observed.events).toContainEqual(expect.objectContaining({tool:'submit_candidates',stage:'finished',outcome:'success'}));
  expect(JSON.stringify(observed)).not.toContain('PRIVATE');
 });
 it('does not block a valid candidate when event storage fails',async()=>{
  const project=await f.rpc(owner,'projects.create',{studioId:studio,name:'事件故障测试',scene:scene()});
  const lease=await f.rpc(owner,'lease.acquire',{projectId:project.id,sessionId:session});
  const input=agentRunRequestSchema.parse({requestId:crypto.randomUUID(),sessionId:session,generation:lease.generation,expectedRevision:0,localRevision:0,scene:scene(),selectedIds:[],instruction:'虚构预览',executionMode:'preview'});
  const fetcher=vi.fn(async()=>Response.json({base_resp:{status_code:0},choices:[{finish_reason:'tool_calls',message:{role:'assistant',content:null,tool_calls:[{id:crypto.randomUUID(),type:'function',index:0,function:{name:'submit_candidates',arguments:JSON.stringify({candidates:[{title:'示意',explanation:'待核对',commands:[]}]})}}]}}]}));
  const env=(key:string)=>({AGENT_CHAT_PROFILE:'minimax',MINIMAX_AGENT_TOOLS_ENABLED:'1',AGENT_CHAT_BASE_URL:'https://api.minimax.cn/v1',AGENT_CHAT_KEY:'fixture',AGENT_CHAT_MODEL:'MiniMax-M3.1-Flash'} as Record<string,string>)[key];
  const api=createApi({...f.backend,agentEvents:async()=>{throw Error('storage unavailable');}},env,fetcher);
  const res=await api(new Request(`https://local.test/projects/${project.id}/agent-runs`,{method:'POST',headers:{authorization:`Bearer ${owner}`,'content-type':'application/json'},body:JSON.stringify(input)}));
  expect(res.status).toBe(202);expect((await res.json()).state).toBe('complete');
 });
});
