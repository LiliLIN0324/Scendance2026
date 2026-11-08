import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {createApi} from '../supabase/functions/_shared/api.ts';
import {agentRunSchema} from '../supabase/functions/_shared/agent-contract.ts';
import {chatRequest} from '../supabase/functions/_shared/providers.ts';
import {BRIEF_CONVERSATION_PROMPT} from '../supabase/functions/_shared/brief-extract-contract.ts';
import {createChatTrialProvider} from '../scripts/local-chat-trial-provider.ts';
import {syntheticBailianTransport} from '../scripts/local-chat-trial-synthetic.ts';
import {database,owner,scene,session,studio} from './fixtures.ts';

const config:Record<string,string>={AGENT_CHAT_BASE_URL:'https://dashscope.aliyuncs.com/compatible-mode/v1',AGENT_CHAT_KEY:'synthetic-only',AGENT_CHAT_MODEL:'qwen-example',AGENT_CHAT_PROFILE:'bailian-qwen'};
const trial=(transport:typeof fetch=syntheticBailianTransport)=>createChatTrialProvider(transport,()=>{},110_000,true,{provider:'bailian-qwen',model:'qwen-example'});

describe('isolated Bailian trial using synthetic transport',()=>{
 let fixture:Awaited<ReturnType<typeof database>>;
 beforeAll(async()=>{fixture=await database();},30000);
 afterAll(async()=>{await fixture.db.close();});
 it('accepts a conversation and receives a fixture answer',async()=>{
  const provider=trial();
  const {url,init}=chatRequest(key=>config[key],{messages:[{role:'system',content:BRIEF_CONVERSATION_PROMPT},{role:'user',content:JSON.stringify({message:'我们有80把椅子',history:[]})}],temperature:0,max_tokens:2048,response_format:{type:'json_object'}},{purpose:'brief'});
  const result=await provider.fetcher(url,init);expect(result.status).toBe(200);
  expect((await result.json()).choices[0].message.content).toContain('80把椅子');expect(provider.used()).toBe(1);
 });
 it('calls scene tools and stores only a preview',async()=>{
  const draft=scene(),project=await fixture.rpc(owner,'projects.create',{studioId:studio,name:'合成百炼活动',scene:draft});
  const lease=await fixture.rpc(owner,'lease.acquire',{projectId:project.id,sessionId:session});
  const provider=trial(),api=createApi(fixture.backend,key=>config[key],provider.fetcher);
  const response=await api(new Request(`https://api.test/projects/${project.id}/agent-runs`,{method:'POST',headers:{authorization:`Bearer ${owner}`,'content-type':'application/json'},body:JSON.stringify({requestId:crypto.randomUUID(),sessionId:session,generation:lease.generation,expectedRevision:0,localRevision:0,scene:draft,selectedIds:[],instruction:'在合成场地中预览一把示意椅',executionMode:'preview'})}));
  expect(response.status).toBe(202);const run=agentRunSchema.parse(await response.json());
  expect(run.state).toBe('complete');expect(provider.used()).toBe(3);expect(run.candidates[0]!.proposal.candidate.objects).toHaveLength(1);
  expect((await fixture.rpc(owner,'projects.get',{projectId:project.id})).scene).toEqual(draft);
 },30000);
 it('rejects wrong region without dispatch and never retries a failed request',async()=>{
  const transport=vi.fn(async()=>new Response('error',{status:503}));const provider=trial(transport);
  const {url,init}=chatRequest(key=>config[key],{messages:[{role:'system',content:BRIEF_CONVERSATION_PROMPT},{role:'user',content:JSON.stringify({message:'我们有80把椅子',history:[]})}],temperature:0,max_tokens:2048,response_format:{type:'json_object'}},{purpose:'brief'});
  expect((await provider.fetcher(url.replace('dashscope.aliyuncs.com','dashscope-intl.aliyuncs.com'),init)).status).toBe(503);expect(transport).not.toHaveBeenCalled();
  expect((await provider.fetcher(url,init)).status).toBe(503);expect((await provider.fetcher(url,init)).status).toBe(503);expect(transport).toHaveBeenCalledTimes(1);
  expect(()=>createChatTrialProvider(syntheticBailianTransport,()=>{},110_000,true,{provider:'bailian-qwen',model:''})).toThrow();
 });
});
