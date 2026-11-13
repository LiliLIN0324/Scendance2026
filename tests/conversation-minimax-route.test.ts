import {describe,it,expect,vi} from 'vitest';
import {createConversationApi} from '../supabase/functions/_shared/conversation-api.ts';
import type {Backend} from '../supabase/functions/_shared/backend.ts';
const settings:Record<string,string>={CONVERSATION_API_ENABLED:'1',BAILIAN_PRODUCT_ENABLED:'1',BAILIAN_PRODUCT_BASE_URL:'https://dashscope.aliyuncs.com/compatible-mode/v1',BAILIAN_PRODUCT_MODEL:'qwen-stale-fixture',BAILIAN_PRODUCT_KEY:'stale-fixture',AGENT_CHAT_PROFILE:'minimax',AGENT_CHAT_BASE_URL:'https://api.minimax.io/v1',AGENT_CHAT_MODEL:'MiniMax-M3.1-Flash',AGENT_CHAT_KEY:'minimax-fixture',TOKENDANCE_API_KEY:'stale-gateway-fixture',DEEPSEEK_API_KEY:'stale-deepseek-fixture',ALLOWED_ORIGINS:'https://example.test'};
const request=(path='/assistant/chat',body:unknown={message:'先搜IN77候选，不默认商场是活动范围。',history:[]},signal?:AbortSignal)=>new Request('https://edge.test/functions/v1/conversation-api'+path,{method:'POST',headers:{origin:'https://example.test','content-type':'application/json',authorization:'Bearer fixture'},body:JSON.stringify(body),signal});
const backend={user:vi.fn(async()=> 'fixture-user')} as unknown as Backend;
const completion=(content:string)=>Response.json({choices:[{finish_reason:'stop',message:{content,tool_calls:null,function_call:null}}]});
describe('explicit MiniMax conversation ownership',()=>{
 it('gives outdoor structured turns a bounded reasoning and JSON budget', async () => {
  const answer = JSON.stringify({ action: 'search', reply: '先找场地候选。', query: '杭州IN77', references: [], facts: {} });
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(completion(answer));
  const result = await createConversationApi(backend, k => settings[k], fetcher)(request('/assistant/chat', {
   message: '杭州IN77办45人讲座', history: [], responseMode: 'outdoor_v1',
  }));
  expect(await result.json()).toEqual({ status: 'ok', answer });
  const body = JSON.parse(String(fetcher.mock.calls[0]![1]?.body));
  expect(body.max_completion_tokens).toBe(4096);
  expect(body.reasoning_split).toBe(true);
  expect(fetcher).toHaveBeenCalledOnce();
 });
 it('still rejects truncated outdoor JSON without retrying', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ choices: [{ finish_reason: 'length', message: { content: '{"action":"search"' } }] }));
  const result = await createConversationApi(backend, k => settings[k], fetcher)(request('/assistant/chat', {
   message: '杭州IN77办45人讲座', history: [], responseMode: 'outdoor_v1',
  }));
  expect(await result.json()).toEqual({ status: 'provider_error', answer: null });
  expect(fetcher).toHaveBeenCalledOnce();
 });
 it('uses existing ordinary MiniMax adapter despite stale enabled Bailian config',async()=>{
  const fetcher=vi.fn<typeof fetch>().mockResolvedValue(completion('先核对候选，不应用。'));
  expect(await (await createConversationApi(backend,k=>settings[k],fetcher)(request())).json()).toEqual({status:'ok',answer:'先核对候选，不应用。'});
  expect(fetcher).toHaveBeenCalledOnce();expect(fetcher.mock.calls[0]![0]).toBe('https://api.minimax.io/v1/chat/completions');
  const body=JSON.parse(String(fetcher.mock.calls[0]![1]?.body));expect(body).toMatchObject({model:'MiniMax-M3.1-Flash',max_completion_tokens:1024,reasoning_split:true});for(const k of ['enable_thinking','max_tokens','tools','response_format'])expect(body[k]).toBeUndefined();
 });
 it('never falls back to stale Bailian, gateway or DeepSeek after a failed MiniMax chat',async()=>{
  const fetcher=vi.fn<typeof fetch>().mockResolvedValue(new Response('fixture-denied',{status:400}));
  expect(await (await createConversationApi(backend,k=>settings[k],fetcher)(request())).json()).toEqual({status:'provider_error',answer:null});expect(fetcher).toHaveBeenCalledOnce();expect(fetcher.mock.calls[0]![0]).toBe('https://api.minimax.io/v1/chat/completions');
 });
 it('fails closed when the selected MiniMax configuration is incomplete',async()=>{
  const config={...settings};delete config.AGENT_CHAT_KEY;const fetcher=vi.fn<typeof fetch>();
  expect(await (await createConversationApi(backend,k=>config[k],fetcher)(request())).json()).toEqual({status:'unavailable',answer:null});expect(fetcher).not.toHaveBeenCalled();
 });
 it('brief failure makes only one MiniMax attempt, even with all old provider credentials present',async()=>{
  const fetcher=vi.fn<typeof fetch>().mockResolvedValue(new Response('fixture-denied',{status:400}));
  const result=await (await createConversationApi(backend,k=>settings[k],fetcher)(request('/brief/extract',{message:'户外展览100人',responseMode:'conversation_v1',history:[]}))).json();expect(result.extraction).toBeNull();expect(fetcher).toHaveBeenCalledOnce();
  expect(fetcher.mock.calls[0]![0]).toBe('https://api.minimax.io/v1/chat/completions');const body=JSON.parse(String(fetcher.mock.calls[0]![1]?.body));expect(body.max_completion_tokens).toBe(2048);expect(body.reasoning_split).toBe(true);expect(body.enable_thinking).toBeUndefined();
 });
});
