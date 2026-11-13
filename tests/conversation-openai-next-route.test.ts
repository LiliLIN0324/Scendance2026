import {describe,it,expect,vi} from 'vitest';
import {createConversationApi} from '../supabase/functions/_shared/conversation-api.ts';
import type {Backend} from '../supabase/functions/_shared/backend.ts';

const settings:Record<string,string>={CONVERSATION_API_ENABLED:'1',OPENAI_NEXT_API_KEY:'onk-fixture',OPENAI_NEXT_MODEL:'deepseek-v4.1-flash',AGENT_CHAT_PROFILE:'minimax',AGENT_CHAT_BASE_URL:'https://api.minimax.io/v1',AGENT_CHAT_MODEL:'MiniMax-M3.1-Flash',AGENT_CHAT_KEY:'minimax-fixture',ALLOWED_ORIGINS:'https://example.test'};
const request=(path='/assistant/chat',body:unknown={message:'先搜IN77候选，不默认商场是活动范围。',history:[]})=>new Request('https://edge.test/functions/v1/conversation-api'+path,{method:'POST',headers:{origin:'https://example.test','content-type':'application/json',authorization:'Bearer fixture'},body:JSON.stringify(body)});
const backend={user:vi.fn(async()=> 'fixture-user')} as unknown as Backend;
const completion=(content:string)=>Response.json({choices:[{finish_reason:'stop',message:{content,tool_calls:null,function_call:null}}]});

describe('OpenAI Next conversation default',()=>{
 it('uses the documented OpenAI Next completions path for outdoor turns without MiniMax fields',async()=>{
  const answer=JSON.stringify({action:'search',reply:'先找场地候选。',query:'杭州IN77',references:[],facts:{}});
  const fetcher=vi.fn<typeof fetch>().mockResolvedValue(completion(answer));
  const result=await createConversationApi(backend,k=>settings[k],fetcher)(request('/assistant/chat',{message:'杭州IN77办45人讲座',history:[],responseMode:'outdoor_v1'}));
  expect(await result.json()).toEqual({status:'ok',answer});
  expect(fetcher).toHaveBeenCalledOnce();
  expect(String(fetcher.mock.calls[0]![0])).toBe('https://api.openai-next.com/v1/chat/completions');
  const body=JSON.parse(String(fetcher.mock.calls[0]![1]?.body));
  expect(body).toMatchObject({model:'deepseek-v4.1-flash',thinking:{type:'disabled'},max_tokens:4096,response_format:{type:'json_object'}});
  expect(body.reasoning_split).toBeUndefined();
  expect(body.max_completion_tokens).toBeUndefined();
  expect(JSON.stringify(body)).not.toContain('minimax-fixture');
  expect(JSON.stringify(body)).not.toContain('onk-fixture');
 });
 it('does not silently retry MiniMax when the default OpenAI Next slot fails',async()=>{
  const fetcher=vi.fn<typeof fetch>().mockResolvedValue(new Response('quota',{status:429}));
  const result=await createConversationApi(backend,k=>settings[k],fetcher)(request());
  expect(await result.json()).toEqual({status:'provider_error',answer:null});
  expect(fetcher).toHaveBeenCalledOnce();
  expect(String(fetcher.mock.calls[0]![0])).toBe('https://api.openai-next.com/v1/chat/completions');
 });
 it('still uses MiniMax when that slot is explicitly selected',async()=>{
  const fetcher=vi.fn<typeof fetch>().mockResolvedValue(completion('先核对候选，不应用。'));
  const result=await createConversationApi(backend,k=>settings[k],fetcher)(request('/assistant/chat',{message:'先搜IN77候选，不默认商场是活动范围。',history:[],provider:'minimax'}));
  expect(await result.json()).toEqual({status:'ok',answer:'先核对候选，不应用。'});
  expect(fetcher).toHaveBeenCalledOnce();
  expect(fetcher.mock.calls[0]![0]).toBe('https://api.minimax.io/v1/chat/completions');
  const body=JSON.parse(String(fetcher.mock.calls[0]![1]?.body));
  expect(body).toMatchObject({model:'MiniMax-M3.1-Flash',max_completion_tokens:1024,reasoning_split:true});
  expect(body.thinking).toBeUndefined();
 });
});
