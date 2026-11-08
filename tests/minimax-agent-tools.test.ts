import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {createApi} from '../supabase/functions/_shared/api.ts';
import {agentRunRequestSchema,agentRunSchema} from '../supabase/functions/_shared/agent-contract.ts';
import {database,owner,scene,session,studio} from './fixtures.ts';

const settings:Record<string,string>={AGENT_CHAT_PROFILE:'minimax',MINIMAX_AGENT_TOOLS_ENABLED:'1',AGENT_CHAT_BASE_URL:'https://api.minimax.cn/v1',AGENT_CHAT_KEY:'fixture',AGENT_CHAT_MODEL:'MiniMax-M3.1-Flash'};
const tool=(id:string,name:string,args:unknown)=>({id,type:'function',index:0,function:{name,arguments:JSON.stringify(args)}});
const reply=(calls:ReturnType<typeof tool>[],reasoning='private reasoning')=>new Response(JSON.stringify({base_resp:{status_code:0},choices:[{finish_reason:'tool_calls',message:{role:'assistant',content:null,reasoning_content:reasoning,tool_calls:calls}}],usage:{total_tokens:10}}));

describe('opt-in MiniMax agent tool loop',()=>{
 let fixture:Awaited<ReturnType<typeof database>>;
 beforeAll(async()=>{fixture=await database();},30000);
 afterAll(async()=>{await fixture.db.close();});
 async function setup(){
  const base=scene(),project=await fixture.rpc(owner,'projects.create',{studioId:studio,name:'MiniMax tool test',scene:base}),lease=await fixture.rpc(owner,'lease.acquire',{projectId:project.id,sessionId:session});
  const input=agentRunRequestSchema.parse({requestId:crypto.randomUUID(),sessionId:session,generation:lease.generation,expectedRevision:0,localRevision:0,scene:base,selectedIds:[],instruction:'直接放一把椅子',executionMode:'direct'});
  return {base,project,input};
 }
 async function run(i:Awaited<ReturnType<typeof setup>>,fetcher:typeof fetch,config=settings){
  const api=createApi(fixture.backend,key=>config[key],fetcher);
  return api(new Request(`https://api.test/projects/${i.project.id}/agent-runs`,{method:'POST',headers:{authorization:`Bearer ${owner}`,'content-type':'application/json'},body:JSON.stringify(i.input)}));
 }
 it('feeds actual tool results and the complete assistant message back, then saves only a preview',async()=>{
  const i=await setup();let site:{x:number;z:number}|undefined;
  const fetcher=vi.fn(async(_url:RequestInfo|URL,init?:RequestInit)=>{
   const body=JSON.parse(String(init?.body));
   expect(body.model).toBe(settings.AGENT_CHAT_MODEL);expect(body.reasoning_split).toBe(true);expect(body.max_completion_tokens).toBe(7000);
   expect(body.tools.map((t:{function:{name:string}})=>t.function.name)).not.toContain('start_lux3d_model');
   if(fetcher.mock.calls.length===1)return reply([tool('call-1','get_scene',{})]);
   const assistant=body.messages.find((m:{role:string})=>m.role==='assistant');
   expect(assistant.reasoning_content).toBe('private reasoning');expect(assistant.tool_calls[0].id).toBe('call-1');expect(assistant.tool_calls[0].index).toBe(0);
   if(fetcher.mock.calls.length===2){
    const result=JSON.parse(body.messages.find((m:{role:string})=>m.role==='tool').content);expect(result.scene).toEqual(i.base);
    return reply([tool('call-2','find_free_areas',{width:0.5,depth:0.5,clearance:0.1})]);
   }
   const result=JSON.parse(body.messages.filter((m:{role:string})=>m.role==='tool').at(-1).content);site=result.sites[0];expect(site).toBeDefined();
   return reply([tool('call-3','submit_candidates',{candidates:[{title:'椅子方案',explanation:'位置来自空位查询；出口和现场条件待确认。',commands:[{op:'add',materialId:'chair',position:{x:site!.x,z:site!.z},rotation:0,color:'#ffffff'}]}]})]);
  });
  const response=await run(i,fetcher);expect(response.status).toBe(202);const result=agentRunSchema.parse(await response.json());
  expect(result.state).toBe('complete');expect(result.executionMode).toBe('preview');expect(result.candidates[0]!.proposal.candidate.objects).toHaveLength(1);
  expect(result.candidates[0]!.proposal.warnings).toContainEqual({code:'SAFETY_CHECKS_UNKNOWN',ids:[]});
  expect((await fixture.rpc(owner,'projects.get',{projectId:i.project.id})).scene).toEqual(i.base);
  expect(fetcher).toHaveBeenCalledTimes(3);expect(JSON.stringify(result)).not.toContain('private reasoning');
  const stored=await fixture.db.query<{run:string}>('select row_to_json(r)::text as run from scene_private.agent_runs r where id=$1',[result.id]);
  expect(stored.rows[0]!.run).not.toContain('private reasoning');
 },30000);
 it('rejects an unadvertised paid or writing tool before any batch action',async()=>{
  const i=await setup(),fetcher=vi.fn(async()=>reply([tool('call-a','get_scene',{}),tool('call-b','start_lux3d_model',{prompt:'椅子'})]));
  const response=await run(i,fetcher),result=agentRunSchema.parse(await response.json());
  expect(result.state).toBe('failed');expect(result.errorCode).toBe('MINIMAX_INVALID_TOOL_RESPONSE');expect(fetcher).toHaveBeenCalledTimes(1);
  expect((await fixture.rpc(owner,'projects.get',{projectId:i.project.id})).scene).toEqual(i.base);
 },30000);
 it('returns invalid parameters to the model, executes no partial batch, and accepts a corrected candidate',async()=>{
  const i=await setup();let priorProblems:Array<{code:string}>=[];
  const empty={title:'不修改',explanation:'请先确认场地。',commands:[]};
  const fetcher=vi.fn(async(_url:RequestInfo|URL,init?:RequestInit)=>{
   const body=JSON.parse(String(init?.body));
   if(fetcher.mock.calls.length===1)return reply([tool('submit-before','submit_candidates',{candidates:[empty]}),tool('invalid','find_free_areas',{width:-1,depth:1})]);
   if(fetcher.mock.calls.length===2){
    priorProblems=body.messages.filter((m:{role:string})=>m.role==='tool').map((m:{content:string})=>JSON.parse(m.content));
    const rows=await fixture.db.query<{count:number}>('select count(*)::integer as count from scene_private.agent_proposals p join scene_private.agent_runs r on p.run_id=r.id where r.project_id=$1',[i.project.id]);
    expect(rows.rows[0]!.count).toBe(0);
    return reply([tool('corrected','find_free_areas',{width:0.5,depth:0.5})]);
   }
   return reply([tool('submit-after','submit_candidates',{candidates:[empty]})]);
  });
  const response=await run(i,fetcher),result=agentRunSchema.parse(await response.json());
  expect(priorProblems.map(problem=>problem.code)).toEqual(['AGENT_BATCH_NOT_EXECUTED','INVALID_TOOL_INPUT']);
  expect(result.state).toBe('complete');expect(result.candidates).toHaveLength(1);expect(fetcher).toHaveBeenCalledTimes(3);
  expect((await fixture.rpc(owner,'projects.get',{projectId:i.project.id})).scene).toEqual(i.base);
 },30000);
 it('returns an ordinary malformed JSON argument as a repairable tool error',async()=>{
  const i=await setup();let errorCode='';
  const malformed=tool('bad-json','find_free_areas',{});malformed.function.arguments='{"width":';
  const fetcher=vi.fn(async(_url:RequestInfo|URL,init?:RequestInit)=>{
   if(fetcher.mock.calls.length===1)return reply([malformed]);
   const messages=JSON.parse(String(init?.body)).messages;
   errorCode=JSON.parse(messages.find((m:{role:string})=>m.role==='tool').content).code;
   return reply([tool('fixed','submit_candidates',{candidates:[{title:'待核验',explanation:'需要更多信息。',commands:[]}]})]);
  });
  const response=await run(i,fetcher),result=agentRunSchema.parse(await response.json());
  expect(errorCode).toBe('INVALID_TOOL_INPUT');expect(result.state).toBe('complete');expect(fetcher).toHaveBeenCalledTimes(2);
 },30000);
 it('warns the model after the same invalid parameters fail twice',async()=>{
  const i=await setup();let finalError:Record<string,unknown>={};
  const fetcher=vi.fn(async(_url:RequestInfo|URL,init?:RequestInit)=>{
   if(fetcher.mock.calls.length<=2)return reply([tool(`bad-${fetcher.mock.calls.length}`,'find_free_areas',{width:-1,depth:1})]);
   const messages=JSON.parse(String(init?.body)).messages;
   finalError=JSON.parse(messages.filter((m:{role:string})=>m.role==='tool').at(-1).content);
   return reply([tool('done','submit_candidates',{candidates:[{title:'待核验',explanation:'需要更多信息。',commands:[]}]})]);
  });
  const response=await run(i,fetcher),result=agentRunSchema.parse(await response.json());
  expect(finalError).toMatchObject({code:'INVALID_TOOL_INPUT',repeat:2,stop:true});expect(result.state).toBe('complete');expect(fetcher).toHaveBeenCalledTimes(3);
 },30000);
 it('checks opt-in provider configuration before creating a run',async()=>{
  const i=await setup(),fetcher=vi.fn<typeof fetch>(),{AGENT_CHAT_KEY:_,...incomplete}=settings;
  const response=await run(i,fetcher,incomplete);expect(response.status).toBe(503);expect(fetcher).not.toHaveBeenCalled();
  const rows=await fixture.db.query<{count:number}>('select count(*)::integer as count from scene_private.agent_runs where project_id=$1',[i.project.id]);expect(rows.rows[0]!.count).toBe(0);
 },30000);
});
