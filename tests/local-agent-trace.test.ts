import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {startLocalServer,testPublicKey} from './local-server.ts';
import {owner,scene,session,studio} from './fixtures.ts';
import {agentRunRequestSchema} from '../supabase/functions/_shared/agent-contract.ts';

describe('isolated local agent trace',()=>{
 let server:Awaited<ReturnType<typeof startLocalServer>>,disabled:Awaited<ReturnType<typeof startLocalServer>>;
 let projectId:string,runId:string,ownerToken:string,outsiderToken:string;
 const secret='FAKE_PRIVATE_TOKEN_AND_MODEL_OUTPUT_8382';
 async function login(base:string,email:string){
  const response=await fetch(`${base}/auth/v1/token?grant_type=password`,{method:'POST',headers:{apikey:testPublicKey,'content-type':'application/json'},body:JSON.stringify({email,password:'local-integration-only'})});
  expect(response.status).toBe(200);return (await response.json() as {access_token:string}).access_token;
 }
 beforeAll(async()=>{
  server=await startLocalServer(0,undefined,{agentTrace:true});disabled=await startLocalServer();
  ownerToken=await login(server.url,'owner@scendance.test');outsiderToken=await login(server.url,'outsider@scendance.test');
  const draft=scene(),project=await server.rpc(owner,'projects.create',{studioId:studio,name:'Trace fixture',scene:draft});projectId=project.id;
  const lease=await server.rpc(owner,'lease.acquire',{projectId,sessionId:session});
  const input=agentRunRequestSchema.parse({requestId:crypto.randomUUID(),sessionId:session,generation:lease.generation,expectedRevision:0,localRevision:0,scene:draft,selectedIds:[],instruction:'虚构活动',executionMode:'preview'});
  const run=await server.backend.agent!(owner,'create',{projectId,input,fingerprint:'a'.repeat(64),baseHash:'b'.repeat(64),executionMode:'preview'});runId=run.id;
  const usage=[{provider:'minimax',reasoning:secret},{tool:'get_scene',ok:true,arguments:secret},{tool:'find_free_areas',errorCode:'INVALID_TOOL_INPUT',arguments:secret},{tool:'prepare_seating_candidate',errorCode:'SEATING_ALLOCATION_CONFLICT',arguments:secret},{tool:'prepare_seating_candidate',errorCode:'SEATING_ALLOCATION_UNCONFIRMED',arguments:secret},{tool:'prepare_seating_candidate',errorCode:'SEATING_SPEC_CONFLICT',arguments:secret},{tool:'prepare_seating_candidate',errorCode:'SEATING_SPEC_UNCONFIRMED',arguments:secret},{tool:'submit_candidates',errorCode:secret},{tool:secret,ok:true}];
  await server.db.query('update scene_private.agent_runs set usage=$1::jsonb where id=$2',[JSON.stringify(usage),runId]);
  server.backend.agentTrialDiagnostic!(owner,projectId,runId,{tool:'validate_candidate',valid:false,errorCode:'CANDIDATE_GEOMETRY_CONFLICT'});
  server.backend.agentTrialDiagnostic!(owner,projectId,runId,{tool:'submit_candidates',accepted:0,expected:1,errorCodes:['INVALID_TOOL_INPUT',secret]});
  server.backend.agentTrialDiagnostic!(owner,projectId,runId,{tool:'model_round',turn:2,phase:'failed',remainingMs:0,elapsedMs:19000,privateData:secret} as never);
 },30000);
 afterAll(async()=>{await Promise.all([server?.close(),disabled?.close()]);});
 it('returns only whitelisted tool outcomes for the run owner',async()=>{
  const response=await fetch(`${server.url}/__test-agent-trace/${projectId}/${runId}`,{headers:{authorization:`Bearer ${ownerToken}`,apikey:testPublicKey}});
  expect(response.status).toBe(200);const body=await response.text();expect(body).not.toContain(secret);
  expect(JSON.parse(body)).toEqual({tools:[{tool:'get_scene',outcome:'succeeded'},{tool:'find_free_areas',outcome:'failed',errorCode:'INVALID_TOOL_INPUT'},{tool:'prepare_seating_candidate',outcome:'failed',errorCode:'SEATING_ALLOCATION_CONFLICT'},{tool:'prepare_seating_candidate',outcome:'failed',errorCode:'SEATING_ALLOCATION_UNCONFIRMED'},{tool:'prepare_seating_candidate',outcome:'failed',errorCode:'SEATING_SPEC_CONFLICT'},{tool:'prepare_seating_candidate',outcome:'failed',errorCode:'SEATING_SPEC_UNCONFIRMED'},{tool:'submit_candidates',outcome:'failed'}],business:[{tool:'validate_candidate',valid:false,errorCode:'CANDIDATE_GEOMETRY_CONFLICT'},{tool:'submit_candidates',accepted:0,expected:1,errorCodes:['INVALID_TOOL_INPUT']},{tool:'model_round',turn:2,phase:'failed',remainingMs:0,elapsedMs:19000}]});
 });
 it('cannot read another actor’s run or access without authentication',async()=>{
  const url=`${server.url}/__test-agent-trace/${projectId}/${runId}`;
  expect((await fetch(url,{headers:{authorization:`Bearer ${outsiderToken}`,apikey:testPublicKey}})).status).toBe(404);
  expect((await fetch(url,{headers:{apikey:testPublicKey}})).status).toBe(401);
  expect((await fetch(url,{headers:{authorization:`Bearer ${ownerToken}`}})).status).toBe(401);
 });
 it('does not expose the endpoint without explicit fixture opt in',async()=>{
  expect((await fetch(`${disabled.url}/__test-agent-trace/${projectId}/${runId}`)).status).toBe(404);
 });
});
