import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {createApi} from '../supabase/functions/_shared/api.ts';
import {agentRunRequestSchema,agentRunSchema} from '../supabase/functions/_shared/agent-contract.ts';
import {database,owner,scene,session,studio} from './fixtures.ts';

const env=(key:string)=>({AGENT_CHAT_PROFILE:'minimax',MINIMAX_AGENT_TOOLS_ENABLED:'1',AGENT_CHAT_BASE_URL:'https://api.minimax.cn/v1',AGENT_CHAT_KEY:'fixture',AGENT_CHAT_MODEL:'MiniMax-M3.1-Flash'} as Record<string,string>)[key];
const call=(name:string,args:unknown)=>({id:crypto.randomUUID(),type:'function',index:0,function:{name,arguments:JSON.stringify(args)}});
const reply=(name:string,args:unknown)=>Response.json({base_resp:{status_code:0},choices:[{finish_reason:'tool_calls',message:{role:'assistant',content:null,tool_calls:[call(name,args)]}}]});
const candidate=()=>({title:'桌子草案',explanation:'本次尝试摆放一张桌子，现场待核验。',commands:[{op:'add',materialId:'table',position:{x:2,z:3},rotation:0,color:'#ffffff'}]});
const response=(body:any)=>JSON.parse(body.messages.filter((m:any)=>m.role==='tool').at(-1).content);

describe('run-local validated candidate handles',()=>{
 let fixture:Awaited<ReturnType<typeof database>>;
 beforeAll(async()=>{fixture=await database();},30000);afterAll(async()=>{await fixture.db.close();});
 async function setup(){const initial=scene(),project=await fixture.rpc(owner,'projects.create',{studioId:studio,name:'验证句柄测试',scene:initial});
  const lease=await fixture.rpc(owner,'lease.acquire',{projectId:project.id,sessionId:session});
  return {initial,project,input:agentRunRequestSchema.parse({requestId:crypto.randomUUID(),sessionId:session,generation:lease.generation,expectedRevision:0,localRevision:0,scene:initial,selectedIds:[],instruction:'请摆一张桌子',executionMode:'preview'})};}
 async function run(i:Awaited<ReturnType<typeof setup>>,fetcher:typeof fetch){const result=await createApi(fixture.backend,env,fetcher)(new Request(`https://api.test/projects/${i.project.id}/agent-runs`,{method:'POST',headers:{authorization:`Bearer ${owner}`,'content-type':'application/json'},body:JSON.stringify(i.input)}));expect(result.status).toBe(202);return agentRunSchema.parse(await result.json());}
 it('exposes alternatives to the model and submits the validated candidate without a second copy',async()=>{
  const i=await setup();let observation:any;
  const fetcher=vi.fn(async(_url:RequestInfo|URL,init?:RequestInit)=>{const body=JSON.parse(String(init?.body));
   if(fetcher.mock.calls.length===1){const submit=body.tools.find((v:any)=>v.function.name==='submit_candidates');
    const json=JSON.stringify(submit.function.parameters);expect(json).toContain('validatedId');expect(json).toContain('preparedId');expect(json).toContain('commands');return reply('validate_candidate',candidate());}
   observation=response(body);return reply('submit_candidates',{candidates:[{validatedId:observation.validatedId}]});
  });
  const result=await run(i,fetcher);expect(observation.valid).toBe(true);expect(observation.validatedId).toMatch(/^[0-9a-f-]{36}$/i);
  expect(result.state).toBe('complete');expect(result.candidates[0]!.proposal.candidate.objects).toHaveLength(1);
  expect(result.candidates[0]!.proposal.candidate.objects[0]).toMatchObject({materialId:'table',position:{x:2,z:3}});
  expect(result.candidates[0]!.proposal.warnings).toContainEqual({code:'SAFETY_CHECKS_UNKNOWN',ids:[]});expect(i.initial.objects).toHaveLength(0);
  const saved=await fixture.rpc(owner,'projects.get',{projectId:i.project.id});expect(saved.revision).toBe(0);expect(saved.scene).toEqual(i.initial);
 });
 it('rejects extra handle fields but permits the unchanged handle on repair',async()=>{
  const i=await setup();let handle='',code='';
  const fetcher=vi.fn(async(_url:RequestInfo|URL,init?:RequestInit)=>{const body=JSON.parse(String(init?.body));
   if(fetcher.mock.calls.length===1)return reply('validate_candidate',candidate());
   const previous=response(body);if(fetcher.mock.calls.length===2){handle=previous.validatedId;return reply('submit_candidates',{candidates:[{validatedId:handle,explanation:'伪造'}]});}
   code=previous.errors?.[0]?.code;return reply('submit_candidates',{candidates:[{validatedId:handle}]});
  });const result=await run(i,fetcher);expect(code).toBe('INVALID_TOOL_INPUT');expect(result.candidates[0]!.proposal.explanation).not.toContain('伪造');
 });
 it('rejects a handle from a different run',async()=>{
  const first=await setup();let foreign='';const f1=vi.fn(async(_url:RequestInfo|URL,init?:RequestInit)=>{
   if(f1.mock.calls.length===1)return reply('validate_candidate',candidate());foreign=response(JSON.parse(String(init?.body))).validatedId;
   return reply('submit_candidates',{candidates:[{validatedId:foreign}]});});await run(first,f1);expect(foreign).toBeTruthy();
  const second=await setup();let code='';const f2=vi.fn(async(_url:RequestInfo|URL,init?:RequestInit)=>{
   if(f2.mock.calls.length===1)return reply('submit_candidates',{candidates:[{validatedId:foreign}]});
   code=response(JSON.parse(String(init?.body))).errors?.[0]?.code;return reply('submit_candidates',{candidates:[{title:'说明',explanation:'候选不可复用。',commands:[]}]});});
  await run(second,f2);expect(code).toBe('VALIDATED_CANDIDATE_NOT_FOUND');
 });
 it('marks one unvalidated command candidate before treating it as checked',async()=>{
  const i=await setup();
  const fetcher=vi.fn(async()=>reply('submit_candidates',{candidates:[candidate()]}));
  const result=await run(i,fetcher);
  expect(result.state).toBe('complete');expect(result.candidates).toHaveLength(1);
  expect(result.candidates[0]!.proposal.candidate.objects).toHaveLength(1);
  expect(result.candidates[0]!.proposal.warnings).toContainEqual({code:'CANDIDATE_NOT_VALIDATED',ids:[]});
  expect(result.candidates[0]!.proposal.warnings).not.toContainEqual({code:'DEADLINE_UNVALIDATED',ids:[]});
  expect((await fixture.rpc(owner,'projects.get',{projectId:i.project.id})).scene).toEqual(i.initial);
 });
 it('flags a deadline submit that skips further validation instead of dropping it',async()=>{
  const i=await setup();
  const fetcher=vi.fn(async()=>fetcher.mock.calls.length<6?reply('get_scene',{}):reply('submit_candidates',{candidates:[candidate()]}));
  const result=await run(i,fetcher);expect(result.state).toBe('complete');expect(result.candidates).toHaveLength(1);
  expect(result.candidates[0]!.proposal.candidate.objects).toHaveLength(1);
  expect(result.candidates[0]!.proposal.warnings).toContainEqual({code:'DEADLINE_UNVALIDATED',ids:[]});
  expect((await fixture.rpc(owner,'projects.get',{projectId:i.project.id})).scene).toEqual(i.initial);
 });
 it('never issues a handle for an invalid geometry and retains a validated sibling',async()=>{
  const i=await setup();let invalid:any,good='';
  const fetcher=vi.fn(async(_url:RequestInfo|URL,init?:RequestInit)=>{const body=JSON.parse(String(init?.body));
   if(fetcher.mock.calls.length===1)return reply('validate_candidate',candidate());
   if(fetcher.mock.calls.length===2){good=response(body).validatedId;return reply('validate_candidate',{...candidate(),commands:[{...candidate().commands[0],position:{x:0,z:0}}]});}
   invalid=response(body);return reply('submit_candidates',{candidates:[{validatedId:crypto.randomUUID()},{validatedId:good}]});
  });const result=await run(i,fetcher);expect(invalid.valid).toBe(false);expect(invalid.validatedId).toBeUndefined();expect(result.state).toBe('complete');expect(result.candidates).toHaveLength(1);
  expect(result.candidates[0]!.proposal.candidate.objects[0]).toMatchObject({position:{x:2,z:3}});
 });
});
