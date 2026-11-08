import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {createApi} from '../supabase/functions/_shared/api.ts';
import {agentRunSchema} from '../supabase/functions/_shared/agent-contract.ts';
import {createChatTrialProvider} from '../scripts/local-chat-trial-provider.ts';
import {syntheticChatTransport} from '../scripts/local-chat-trial-synthetic.ts';
import {database,owner,scene,session,studio} from './fixtures.ts';

describe('isolated chat provider through the actual agent runner',()=>{
 let fixture:Awaited<ReturnType<typeof database>>;
 beforeAll(async()=>{fixture=await database();},30000);
 afterAll(async()=>{await fixture.db.close();});
 it('reads the scene, uses a returned empty position, and stores a preview',async()=>{
  const draft=scene(),project=await fixture.rpc(owner,'projects.create',{studioId:studio,name:'模拟活动',scene:draft});
  const lease=await fixture.rpc(owner,'lease.acquire',{projectId:project.id,sessionId:session});
  const observed:Array<{role:string;content?:string}[]>=[];
  const transport:typeof fetch=(input,init)=>{observed.push(JSON.parse(String(init?.body)).messages);return syntheticChatTransport(input,init);};
  const provider=createChatTrialProvider(transport,()=>{},110_000,true);
  const config:Record<string,string>={AGENT_CHAT_BASE_URL:'https://api.minimax.cn/v1',AGENT_CHAT_KEY:'synthetic-only',AGENT_CHAT_MODEL:'MiniMax-M3.1-Flash',AGENT_CHAT_PROFILE:'minimax',MINIMAX_AGENT_TOOLS_ENABLED:'1',AGENT_CHAT_REASONING_EFFORT:'low'};
  const api=createApi(fixture.backend,key=>config[key],provider.fetcher);
  const response=await api(new Request(`https://api.test/projects/${project.id}/agent-runs`,{method:'POST',headers:{authorization:`Bearer ${owner}`,'content-type':'application/json'},body:JSON.stringify({requestId:crypto.randomUUID(),sessionId:session,generation:lease.generation,expectedRevision:0,localRevision:0,scene:draft,selectedIds:[],instruction:'在合成场地中预览一把示意椅',executionMode:'preview'})}));
  expect(response.status).toBe(202);
  const run=agentRunSchema.parse(await response.json());
  expect(run.state).toBe('complete');expect(provider.used(),JSON.stringify(observed.at(-1)?.filter(message=>message.role==='tool'))).toBe(3);
  expect(run.candidates).toHaveLength(1);
  expect(run.candidates[0]!.proposal.candidate.objects).toHaveLength(1);
  expect(run.candidates[0]!.proposal.warnings).toEqual(expect.arrayContaining([expect.objectContaining({code:'SAFETY_CHECKS_UNKNOWN'})]));
  expect((await fixture.rpc(owner,'projects.get',{projectId:project.id})).scene).toEqual(draft);
 },30000);
});
