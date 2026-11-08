import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {agentRunRequestSchema,agentRunSchema} from '../supabase/functions/_shared/agent-contract.ts';
import {processGeneration} from '../supabase/functions/_shared/worker.ts';
import {createChatTrialProvider} from '../scripts/local-chat-trial-provider.ts';
import {SYNTHETIC_LUX3D_CONFIG,syntheticLux3dFetch} from '../scripts/local-lux3d-synthetic.ts';
import {scene,owner,session,studio} from './fixtures.ts';
import {startLocalServer,testPublicKey} from './local-server.ts';

describe('synthetic activity Agent to local Lux3D job',()=>{
 let server:Awaited<ReturnType<typeof startLocalServer>>,token:string;
 let calls=0;
 const fakeModel=vi.fn(async(_url:RequestInfo|URL,_init?:RequestInit)=>{
  calls++;const name=calls===1?'start_lux3d_model':'submit_candidates';
  const args=calls===1?{prompt:'虚构木讲台'}:{candidates:[{title:'待生成物料',explanation:'模型任务已提交，完成后由用户自行查看和选择。',commands:[]}]};
  return Response.json({base_resp:{status_code:0},choices:[{finish_reason:'tool_calls',message:{role:'assistant',content:null,tool_calls:[{id:crypto.randomUUID(),type:'function',index:0,function:{name,arguments:JSON.stringify(args)}}]}}]});
 });
 beforeAll(async()=>{
  const provider=createChatTrialProvider(fakeModel,()=>{},110000,true);
  const config:Record<string,string>={...SYNTHETIC_LUX3D_CONFIG,AGENT_CHAT_BASE_URL:'https://api.minimax.cn/v1',AGENT_CHAT_KEY:'synthetic-only',AGENT_CHAT_MODEL:'MiniMax-M3.1-Flash',AGENT_CHAT_PROFILE:'minimax',MINIMAX_AGENT_TOOLS_ENABLED:'1'};
  server=await startLocalServer(0,provider.fetcher,{env:key=>config[key],lux3dTextOnly:true});
  const login=await fetch(`${server.url}/auth/v1/token?grant_type=password`,{method:'POST',headers:{apikey:testPublicKey,'content-type':'application/json'},body:JSON.stringify({email:'owner@scendance.test',password:'local-integration-only'})});token=(await login.json() as {access_token:string}).access_token;
 },30000);
 afterAll(async()=>{await server?.close();});
 it('creates one task through the tool, then a local worker archives its fixture asset without changing the scene',async()=>{
  const initial=scene(),project=await server.rpc(owner,'projects.create',{studioId:studio,name:'隔离模拟',scene:initial});
  const lease=await server.rpc(owner,'lease.acquire',{projectId:project.id,sessionId:session});
  const input=agentRunRequestSchema.parse({requestId:crypto.randomUUID(),sessionId:session,generation:lease.generation,expectedRevision:0,localRevision:0,scene:initial,selectedIds:[],instruction:'请为虚构活动创建一个木讲台模型',executionMode:'preview'});
  const api=`${server.url}/functions/v1/scene-api`,headers={authorization:`Bearer ${token}`,apikey:testPublicKey,'content-type':'application/json'};
  const response=await fetch(`${api}/projects/${project.id}/agent-runs`,{method:'POST',headers,body:JSON.stringify(input)});expect(response.status).toBe(202);
  const run=agentRunSchema.parse(await response.json());expect(run.state).toBe('complete');expect(calls).toBe(2);
  const jobs=await(await fetch(`${api}/jobs`,{headers})).json() as Array<{id:string;state:string}>;expect(jobs).toHaveLength(1);expect(jobs[0]!.state).toBe('queued');
  await processGeneration(server.backend,server.env,syntheticLux3dFetch);
  await server.db.query('update scene_private.generation_jobs set next_poll_at=now() where id=$1',[jobs[0]!.id]);
  await processGeneration(server.backend,server.env,syntheticLux3dFetch);
  const result=await(await fetch(`${api}/jobs/${jobs[0]!.id}`,{headers})).json();expect(result).toMatchObject({state:'ready'});
  const original=await server.rpc(owner,'projects.get',{projectId:project.id});expect(original.revision).toBe(0);expect(original.scene).toEqual(initial);
 },30000);
});
