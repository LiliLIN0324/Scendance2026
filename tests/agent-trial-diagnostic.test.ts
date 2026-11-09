import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {createApi} from '../supabase/functions/_shared/api.ts';
import {agentRunRequestSchema,agentRunSchema} from '../supabase/functions/_shared/agent-contract.ts';
import {trialModelRoundDiagnostic,trialSubmissionDiagnostic,trialValidationDiagnostic,type AgentTrialDiagnostic} from '../supabase/functions/_shared/agent-trial-diagnostic.ts';
import {database,owner,scene,session,studio} from './fixtures.ts';

describe('isolated trial business diagnostics',()=>{
 let fixture:Awaited<ReturnType<typeof database>>;
 beforeAll(async()=>{fixture=await database();},30000);
 afterAll(async()=>{await fixture.db.close();});
 it('filters arbitrary data and malformed counts',()=>{
  const secret='FAKE_PRIVATE_CONTENT_42';
  expect(trialValidationDiagnostic({valid:false,code:'INVALID_TOOL_INPUT',arguments:secret})).toEqual({tool:'validate_candidate',valid:false,errorCode:'INVALID_TOOL_INPUT'});
  expect(trialSubmissionDiagnostic(0,1,[{code:'RESOURCE_NOT_FOUND',details:secret},{code:'VALIDATED_CANDIDATE_NOT_FOUND'},{code:secret}])).toEqual({tool:'submit_candidates',accepted:0,expected:1,errorCodes:['RESOURCE_NOT_FOUND','VALIDATED_CANDIDATE_NOT_FOUND']});
  expect(trialSubmissionDiagnostic(99,1,[])).toBeNull();
  expect(trialModelRoundDiagnostic(1,'start',12000)).toEqual({tool:'model_round',turn:1,phase:'start',remainingMs:12000});
  expect(trialModelRoundDiagnostic(1,'failed',0,12000)).toEqual({tool:'model_round',turn:1,phase:'failed',remainingMs:0,elapsedMs:12000});
  expect(trialModelRoundDiagnostic(7,'start',1)).toBeNull();expect(trialModelRoundDiagnostic(1,'start',-1)).toBeNull();expect(trialModelRoundDiagnostic(1,'failed',1,secret)).toBeNull();
  expect(trialModelRoundDiagnostic(1,{toString:()=> 'start',secret},1)).toBeNull();
 });
 it('records the real tool business failures even when transport returned normally',async()=>{
  const initial=scene(),project=await fixture.rpc(owner,'projects.create',{studioId:studio,name:'Diagnostic fixture',scene:initial});
  const lease=await fixture.rpc(owner,'lease.acquire',{projectId:project.id,sessionId:session});
  const input=agentRunRequestSchema.parse({requestId:crypto.randomUUID(),sessionId:session,generation:lease.generation,expectedRevision:0,localRevision:0,scene:initial,selectedIds:[],instruction:'虚构测试',executionMode:'preview'});
  const bad={title:'候选',explanation:'虚构测试',commands:[{op:'add',materialId:'table',position:{x:0,z:0},rotation:0,color:'#ffffff'}]};
  const seen:AgentTrialDiagnostic[]=[];
  const backend={...fixture.backend,agentTrialDiagnostic:(_actor:string,_project:string,_run:string,value:AgentTrialDiagnostic)=>seen.push(value)};
  let turn=0;const fetcher=vi.fn(async()=>{turn++;const name=turn===1?'validate_candidate':'submit_candidates';const args=turn===1?bad:{candidates:[bad]};
   return Response.json({choices:[{finish_reason:'tool_calls',message:{content:null,tool_calls:[{id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}]}}],usage:{total_tokens:10}});});
  const api=createApi(backend,key=>({DEEPSEEK_API_KEY:'fixture',TOKENDANCE_API_KEY:'fixture',HY3_RETIRED:'true'} as Record<string,string>)[key],fetcher);
  const response=await api(new Request(`https://api.test/projects/${project.id}/agent-runs`,{method:'POST',headers:{authorization:`Bearer ${owner}`,'content-type':'application/json'},body:JSON.stringify(input)}));
  expect(response.status).toBe(202);expect(agentRunSchema.parse(await response.json()).state).toBe('failed');
  const validation=seen.filter(value=>value.tool==='validate_candidate'),submissions=seen.filter(value=>value.tool==='submit_candidates'),rounds=seen.filter(value=>value.tool==='model_round');
  expect(validation[0]).toMatchObject({tool:'validate_candidate',valid:false,errorCode:'STRUCTURAL_COLLISION'});
  expect(submissions).toHaveLength(2);
  expect(submissions.every(value=>value.tool==='submit_candidates'&&value.accepted===0&&value.expected===1&&value.errorCodes.includes('STRUCTURAL_COLLISION'))).toBe(true);
  expect(rounds).toHaveLength(6);expect(rounds[0]).toMatchObject({tool:'model_round',turn:1,phase:'start'});expect(rounds[1]).toMatchObject({tool:'model_round',turn:1,phase:'response'});
  expect(JSON.stringify(seen)).not.toContain('999');
 },30000);
 it('records only bounded timing when a model request aborts',async()=>{
  const initial=scene(),project=await fixture.rpc(owner,'projects.create',{studioId:studio,name:'虚构计时测试',scene:initial});
  const lease=await fixture.rpc(owner,'lease.acquire',{projectId:project.id,sessionId:session});
  const input=agentRunRequestSchema.parse({requestId:crypto.randomUUID(),sessionId:session,generation:lease.generation,expectedRevision:0,localRevision:0,scene:initial,selectedIds:[],instruction:'虚构活动',executionMode:'preview'});
  const seen:AgentTrialDiagnostic[]=[];const backend={...fixture.backend,agentTrialDiagnostic:(_actor:string,_project:string,_run:string,value:AgentTrialDiagnostic)=>seen.push(value)};
  const fetcher=vi.fn<typeof fetch>().mockRejectedValue(new DOMException('PRIVATE_RESPONSE','TimeoutError'));
  const api=createApi(backend,key=>({DEEPSEEK_API_KEY:'fixture',TOKENDANCE_API_KEY:'fixture'} as Record<string,string>)[key],fetcher);
  const result=await api(new Request(`https://api.test/projects/${project.id}/agent-runs`,{method:'POST',headers:{authorization:`Bearer ${owner}`,'content-type':'application/json'},body:JSON.stringify(input)}));
  expect(result.status).toBe(202);expect(agentRunSchema.parse(await result.json()).state).toBe('failed');
  expect(seen).toHaveLength(2);expect(seen[0]).toMatchObject({tool:'model_round',turn:1,phase:'start'});expect(seen[1]).toMatchObject({tool:'model_round',turn:1,phase:'failed'});
  expect(JSON.stringify(seen)).not.toContain('PRIVATE_RESPONSE');expect(fetcher).toHaveBeenCalledOnce();
 },30000);
});
