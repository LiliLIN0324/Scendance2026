import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {database,owner,editor,outsider,studio,session,scene} from './fixtures.ts';
import {createApi} from '../supabase/functions/_shared/api.ts';
import {agentRunRequestSchema,agentRunSchema} from '../supabase/functions/_shared/agent-contract.ts';
import {sceneHash} from '../supabase/functions/_shared/domain.ts';

const env=(key:string)=>({DEEPSEEK_API_KEY:'fixture',TOKENDANCE_API_KEY:'fixture',HY3_RETIRED:'true'}[key]);
const plan={title:'布局 A',explanation:'已规划桌子，待程序应用。',commands:[{op:'add',materialId:'table',position:{x:2,z:3},rotation:0,color:'#ffffff'}]};
const tool=(name:string,args:unknown,id:string=crypto.randomUUID())=>({id,type:'function',function:{name,arguments:JSON.stringify(args)}});
const completion=(calls:ReturnType<typeof tool>[])=>new Response(JSON.stringify({choices:[{finish_reason:'tool_calls',message:{content:null,tool_calls:calls}}],usage:{total_tokens:10}}));

describe('append-only agent event log',()=>{
 let f:Awaited<ReturnType<typeof database>>;
 beforeAll(async()=>{f=await database();},30000);afterAll(async()=>{await f.db.close();});
 async function input(){
  const base=scene(),p=await f.rpc(owner,'projects.create',{studioId:studio,name:'Event test',scene:base});
  const lease=await f.rpc(owner,'lease.acquire',{projectId:p.id,sessionId:session});
  return {projectId:p.id,...agentRunRequestSchema.parse({requestId:crypto.randomUUID(),sessionId:session,
    generation:lease.generation,expectedRevision:0,localRevision:0,scene:base,selectedIds:[],
    instruction:'直接添加桌子',executionMode:'direct'})};
 }
 function send(api:ReturnType<typeof createApi>,i:Awaited<ReturnType<typeof input>>){
  const {projectId,...body}=i;
  return api(new Request(`https://api.test/projects/${projectId}/agent-runs`,{method:'POST',
    headers:{authorization:`Bearer ${owner}`,'content-type':'application/json'},body:JSON.stringify(body)}));
 }
 async function events(i:Awaited<ReturnType<typeof input>>,runId:string){
  return f.backend.agent!(owner,'events',{projectId:i.projectId,id:runId}) as Promise<{seq:number;action:string;state:string;detail:Record<string,unknown>}[]>;
 }

 it('records each state transition in order with compact detail and no prompts or scene payloads',async()=>{
  const i=await input(),fetcher=vi.fn(async()=>fetcher.mock.calls.length===1?completion([tool('get_scene',{})]):completion([tool('submit_candidates',{candidates:[plan]})]));
  const run=agentRunSchema.parse(await (await send(createApi(f.backend,env,fetcher),i)).json());
  expect(run.state).toBe('complete');
  const log=await events(i,run.id);
  expect(log.map(entry=>entry.action)).toEqual(['create','start','step','usage','progress','usage','step','usage','progress','checkpoint','usage','finish']);
  expect(log.map(entry=>entry.seq)).toEqual(log.map((_,index)=>index+1));
  expect(log[0]).toMatchObject({action:'create',state:'queued',detail:{executionMode:'direct'}});
  expect(log.filter(entry=>entry.action==='step').map(entry=>entry.detail.callCount)).toEqual([1,2]);
  expect(log.find(entry=>entry.action==='checkpoint')).toMatchObject({state:'running',detail:{candidateCount:1}});
  expect(log.at(-1)).toMatchObject({action:'finish',state:'complete',detail:{candidateCount:1,hasEvaluation:false}});
  expect(JSON.stringify(log)).not.toContain('直接添加桌子');
  expect(JSON.stringify(log)).not.toContain('"scene"');
 });

 it('does not append a second create event for an idempotent replay and stops logging after a refused action',async()=>{
  const i=await input(),fetcher=vi.fn(async()=>completion([tool('submit_candidates',{candidates:[plan]})]));
  const api=createApi(f.backend,env,fetcher),run=agentRunSchema.parse(await (await send(api,i)).json());
  const before=await events(i,run.id);
  const replay=await send(api,i);
  expect(replay.status).toBe(200);expect((await replay.json()).id).toBe(run.id);
  expect(await events(i,run.id)).toHaveLength(before.length);
  await expect(f.backend.agent!(owner,'step',{projectId:i.projectId,id:run.id,claim:crypto.randomUUID()})).rejects.toThrow('AGENT_RUN_STOPPED');
  expect(await events(i,run.id)).toHaveLength(before.length);
 });

 it('appends the apply transition once a user accepts an agent candidate',async()=>{
  const i=await input(),fetcher=vi.fn(async()=>completion([tool('submit_candidates',{candidates:[plan]})]));
  const run=agentRunSchema.parse(await (await send(createApi(f.backend,env,fetcher),i)).json());
  const before=await events(i,run.id),proposal=run.candidates[0]!.proposal;
  await f.rpc(owner,'proposals.apply',{...i,proposalId:proposal.id,baseHash:await sceneHash(i.scene)});
  const after=await events(i,run.id);
  expect(after).toHaveLength(before.length+1);
  expect(after.at(-1)).toMatchObject({action:'apply',seq:before.length+1,state:'complete',detail:{proposalId:proposal.id}});
 });

 it('keeps the log readable by the run owner only',async()=>{
  const i=await input(),fetcher=vi.fn(async()=>completion([tool('submit_candidates',{candidates:[plan]})]));
  const run=agentRunSchema.parse(await (await send(createApi(f.backend,env,fetcher),i)).json());
  expect((await events(i,run.id)).length).toBeGreaterThan(0);
  // The run protocol itself is owner-scoped; another studio member cannot inspect its audit trail.
  await expect(f.backend.agent!(editor,'events',{projectId:i.projectId,id:run.id})).rejects.toThrow('AGENT_RUN_NOT_FOUND');
  await expect(f.backend.agent!(outsider,'events',{projectId:i.projectId,id:run.id})).rejects.toThrow('AGENT_RUN_NOT_FOUND');
 });

 it('records a terminal fail transition with its error code',async()=>{
  const i=await input(),api=createApi(f.backend,env,vi.fn(async()=>new Response('{}',{status:503})));
  const run=agentRunSchema.parse(await (await send(api,i)).json());
  expect(run.state).toBe('failed');
  const log=await events(i,run.id);
  expect(log.map(entry=>entry.action)).toEqual(['create','start','step','fail']);
  expect(log.at(-1)).toMatchObject({state:'failed',detail:{errorCode:'PROVIDER_HTTP_ERROR'}});
 });

 it('rejects updates, deletes and duplicate sequence numbers at the database boundary',async()=>{
  const i=await input(),fetcher=vi.fn(async()=>completion([tool('submit_candidates',{candidates:[plan]})]));
  const run=agentRunSchema.parse(await (await send(createApi(f.backend,env,fetcher),i)).json());
  const count=(await events(i,run.id)).length;
  await expect(f.db.exec(`update scene_private.agent_events set state='queued' where run_id='${run.id}'`)).rejects.toThrow('AGENT_EVENTS_APPEND_ONLY');
  await expect(f.db.exec(`delete from scene_private.agent_events where run_id='${run.id}'`)).rejects.toThrow('AGENT_EVENTS_APPEND_ONLY');
  await expect(f.db.query('insert into scene_private.agent_events(run_id,owner_id,project_id,seq,action,state) values($1,$2,$3,1,$4,$5)',
    [run.id,owner,i.projectId,'create','queued'])).rejects.toThrow();
  expect(await events(i,run.id)).toHaveLength(count);
 });
});
