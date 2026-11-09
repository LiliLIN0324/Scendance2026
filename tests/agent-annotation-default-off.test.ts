import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {database,owner,studio,session,scene} from './fixtures.ts';
import {createApi} from '../supabase/functions/_shared/api.ts';
import {agentRunRequestSchema} from '../supabase/functions/_shared/agent-contract.ts';
import {agentExecutionMode} from '../supabase/functions/_shared/agent-runner.ts';
import {ApiError,sceneHash} from '../supabase/functions/_shared/domain.ts';

describe('annotation rollout remains opt-in',()=>{
 let f:Awaited<ReturnType<typeof database>>;
 beforeAll(async()=>{f=await database();},30000);afterAll(async()=>{await f.db.close();});
 const env=(key:string)=>({DEEPSEEK_API_KEY:'fixture'} as Record<string,string>)[key];
 it('forces annotation-bearing direct requests to preview',()=>{
  const request=agentRunRequestSchema.parse({requestId:crypto.randomUUID(),sessionId:session,generation:1,expectedRevision:0,localRevision:0,scene:scene(),selectedIds:[],instruction:'直接添加椅子',executionMode:'direct',context:{brief:'',acceptedDecisions:[],recentMessages:[],annotationObservation:{status:'unavailable'}}});
  expect(agentExecutionMode(request)).toBe('preview');
 });
 it.each(['missing','wrong-version','wrong-capability'] as const)('refuses %s database guard before storing or sending a model request',async mode=>{
  const base=scene(),project=await f.rpc(owner,'projects.create',{studioId:studio,name:'guard readiness',scene:base});
  const lease=await f.rpc(owner,'lease.acquire',{projectId:project.id,sessionId:session});
  const input=agentRunRequestSchema.parse({requestId:crypto.randomUUID(),sessionId:session,generation:lease.generation,expectedRevision:0,localRevision:0,scene:base,selectedIds:[],instruction:'预览',context:{annotationObservation:{status:'unavailable'}}});
  const backend={...f.backend,scene:async(actor:string|null,action:string,data:Record<string,unknown>={})=>{
   if(action==='annotations.readiness'){
    if(mode==='missing')throw new ApiError('UNKNOWN_ACTION',400);
    return {capability:mode==='wrong-capability'?'other':'annotation_preview_guard',version:mode==='wrong-version'?0:1};
   }
   return f.backend.scene(actor,action,data);
  }};
  const fetcher=vi.fn<typeof fetch>(),config:Record<string,string>={DEEPSEEK_API_KEY:'fixture',AGENT_ANNOTATION_OBSERVATION_ENABLED:'1'};
  const response=await createApi(backend,key=>config[key],fetcher)(new Request(`https://api.test/projects/${project.id}/agent-runs`,{method:'POST',headers:{authorization:`Bearer ${owner}`,'content-type':'application/json'},body:JSON.stringify(input)}));
  expect(response.status).toBe(503);expect(await response.json()).toMatchObject({error:{code:'AGENT_ANNOTATION_GUARD_UNAVAILABLE'}});
  expect(fetcher).not.toHaveBeenCalled();expect((await f.db.query('select id from scene_private.agent_runs where project_id=$1',[project.id])).rows).toHaveLength(0);
 });
 it('rejects disabled annotations before creating a run or calling the provider',async()=>{
  const project=await f.rpc(owner,'projects.create',{studioId:studio,name:'synthetic opt-in',scene:scene()});
  const lease=await f.rpc(owner,'lease.acquire',{projectId:project.id,sessionId:session});
  const input={requestId:crypto.randomUUID(),sessionId:session,generation:lease.generation,expectedRevision:0,localRevision:0,scene:scene(),selectedIds:[],instruction:'fixture',executionMode:'preview',context:{brief:'',acceptedDecisions:[],recentMessages:[],annotationObservation:{status:'unavailable'}}};
  const fetcher=vi.fn<typeof fetch>(),api=createApi(f.backend,env,fetcher);
  const response=await api(new Request(`https://api.test/projects/${project.id}/agent-runs`,{method:'POST',headers:{authorization:`Bearer ${owner}`,'content-type':'application/json'},body:JSON.stringify(input)}));
  expect(response.status).toBe(503);expect(fetcher).not.toHaveBeenCalled();
  const rows=await f.db.query('select id from scene_private.agent_runs where project_id=$1',[project.id]);expect(rows.rows).toHaveLength(0);
 });
 it('rejects annotation in the legacy workflow even when the experiment is enabled',async()=>{
  const project=await f.rpc(owner,'projects.create',{studioId:studio,name:'synthetic legacy mode',scene:scene()});
  const lease=await f.rpc(owner,'lease.acquire',{projectId:project.id,sessionId:session});
  const input={requestId:crypto.randomUUID(),sessionId:session,generation:lease.generation,expectedRevision:0,localRevision:0,scene:scene(),selectedIds:[],instruction:'fixture',executionMode:'preview',context:{brief:'',acceptedDecisions:[],recentMessages:[],annotationObservation:{status:'unavailable'}}};
  const fetcher=vi.fn<typeof fetch>(),settings:Record<string,string>={DEEPSEEK_API_KEY:'fixture',AGENT_ANNOTATION_OBSERVATION_ENABLED:'1',DEEPSEEK_AGENT_MODE:'legacy'};
  const response=await createApi(f.backend,key=>settings[key],fetcher)(new Request(`https://api.test/projects/${project.id}/agent-runs`,{method:'POST',headers:{authorization:`Bearer ${owner}`,'content-type':'application/json'},body:JSON.stringify(input)}));
  expect(response.status).toBe(503);expect(fetcher).not.toHaveBeenCalled();
  expect((await f.db.query('select id from scene_private.agent_runs where project_id=$1',[project.id])).rows).toHaveLength(0);
 });
 it('uses stored proposal warning rather than a client assertion, while old unmarked proposals remain usable',async()=>{
  async function setup(marked:boolean){
   const base=scene(),project=await f.rpc(owner,'projects.create',{studioId:studio,name:'synthetic proposal',scene:base});
   const lease=await f.rpc(owner,'lease.acquire',{projectId:project.id,sessionId:session}),proposalId=crypto.randomUUID();
   await f.rpc(owner,'proposals.store',{projectId:project.id,sessionId:session,generation:lease.generation,expectedRevision:0,localRevision:0,id:proposalId,baseHash:await sceneHash(base),scene:base,candidate:base,explanation:'fixture',warnings:marked?[{code:'ANNOTATION_PREVIEW_ONLY',ids:[]}]:[]});
   return {projectId:project.id,body:{proposalId,sessionId:session,generation:lease.generation,expectedRevision:0,localRevision:0,currentScene:base}};
  }
  const api=createApi(f.backend,env,vi.fn<typeof fetch>()),request=(projectId:string,body:unknown)=>api(new Request(`https://api.test/projects/${projectId}/proposals/apply`,{method:'POST',headers:{authorization:`Bearer ${owner}`,'content-type':'application/json'},body:JSON.stringify(body)}));
  const marked=await setup(true);expect((await request(marked.projectId,{...marked.body,warnings:[]})).status).toBe(400);
  const blocked=await request(marked.projectId,marked.body);expect(blocked.status).toBe(409);expect(await blocked.json()).toMatchObject({error:{code:'ANNOTATION_PREVIEW_ONLY'}});
  expect((await f.rpc(owner,'projects.get',{projectId:marked.projectId})).revision).toBe(0);
  const old=await setup(false);expect((await request(old.projectId,old.body)).status).toBe(200);
 });
 it('keeps the Bailian chat profile during an enabled annotation run',async()=>{
  const base=scene(),project=await f.rpc(owner,'projects.create',{studioId:studio,name:'synthetic qwen run',scene:base});
  const lease=await f.rpc(owner,'lease.acquire',{projectId:project.id,sessionId:session});
  const input={requestId:crypto.randomUUID(),sessionId:session,generation:lease.generation,expectedRevision:0,localRevision:0,scene:base,selectedIds:[],instruction:'直接添加椅子',executionMode:'direct',context:{brief:'',acceptedDecisions:[],recentMessages:[],annotationObservation:{status:'unavailable'}}};
  const config:Record<string,string>={AGENT_ANNOTATION_OBSERVATION_ENABLED:'1',AGENT_CHAT_PROFILE:'bailian-qwen',AGENT_CHAT_BASE_URL:'https://dashscope.aliyuncs.com/compatible-mode/v1',AGENT_CHAT_KEY:'fixture-only',AGENT_CHAT_MODEL:'qwen-example'};
  const tool=(name:string,args:unknown)=>({id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}});
  const fetcher=vi.fn<typeof fetch>().mockImplementation(async()=>Response.json({choices:[{finish_reason:'tool_calls',message:{content:null,tool_calls:[fetcher.mock.calls.length===1?tool('get_scene',{}):tool('submit_candidates',{candidates:[{title:'讨论草案',explanation:'待核验。',commands:[]}]})]}}]}));
  const response=await createApi(f.backend,key=>config[key],fetcher)(new Request(`https://api.test/projects/${project.id}/agent-runs`,{method:'POST',headers:{authorization:`Bearer ${owner}`,'content-type':'application/json'},body:JSON.stringify(input)}));
  const run=await response.json();expect(response.status).toBe(202);expect(run.executionMode).toBe('preview');expect(run.state).toBe('complete');
  expect(fetcher).toHaveBeenCalledTimes(2);expect(String(fetcher.mock.calls[0]![0])).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions');
  expect(JSON.parse(String(fetcher.mock.calls[0]![1]?.body))).toMatchObject({model:'qwen-example',enable_thinking:false});
  expect(run.candidates[0].proposal.warnings).toContainEqual({code:'ANNOTATION_PREVIEW_ONLY',ids:[]});
 });
});
