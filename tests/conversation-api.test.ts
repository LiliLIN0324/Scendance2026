import {describe,expect,it,vi} from 'vitest';
import {createConversationApi} from '../supabase/functions/_shared/conversation-api.ts';
import {createApi} from '../supabase/functions/_shared/api.ts';
import type {Backend} from '../supabase/functions/_shared/backend.ts';

const settings:Record<string,string>={CONVERSATION_API_ENABLED:'1',BRIEF_CONVERSATION_ENABLED:'0',ASSISTANT_CHAT_ENABLED:'0',BAILIAN_PRODUCT_ENABLED:'1',AGENT_CHAT_PROFILE:'bailian-qwen',BAILIAN_PRODUCT_BASE_URL:'https://dashscope.aliyuncs.com/compatible-mode/v1',BAILIAN_PRODUCT_KEY:'fixture-secret',BAILIAN_PRODUCT_MODEL:'qwen-example',ALLOWED_ORIGINS:'https://example.test'};
const env=(key:string)=>settings[key];
const make=(path:string,body:unknown,auth=true,origin='https://example.test')=>new Request(`https://edge.test${path}`,{method:'POST',headers:{'content-type':'application/json',origin,...(auth?{authorization:'Bearer fixture'}:{})},body:JSON.stringify(body)});
const completion=(content:string)=>Response.json({choices:[{finish_reason:'stop',message:{content}}]});
describe('narrow conversation Edge route',()=>{
 it('preserves authentication and allows only configured CORS origins',async()=>{
  const backend={user:vi.fn(async()=> 'user')} as unknown as Backend,fetcher=vi.fn<typeof fetch>(),api=createConversationApi(backend,env,fetcher);
  expect((await api(make('/functions/v1/conversation-api/brief/extract',{message:'30人'},false))).status).toBe(401);
  expect((await api(make('/functions/v1/conversation-api/brief/extract',{message:'30人'},true,'https://other.test'))).status).toBe(403);
  const preflight=await api(new Request('https://edge.test/functions/v1/conversation-api/assistant/chat',{method:'OPTIONS',headers:{origin:'https://example.test','access-control-request-method':'POST'}}));
  expect(preflight.status).toBe(204);expect(preflight.headers.get('access-control-allow-origin')).toBe('https://example.test');expect(preflight.headers.get('access-control-allow-methods')).toBe('POST, OPTIONS');expect(fetcher).not.toHaveBeenCalled();
  const scene=createApi(backend,env,fetcher);
  for(const origin of ['https://cd61e48a.scendance-scene-planner-ewz.pages.dev','https://codex-production-conversatio.scendance-scene-planner-ewz.pages.dev','https://scendance-scene-planner-ewz.pages.dev','https://scendance.lilicoding.space']){
   const conversationPreflight=await api(new Request('https://edge.test/functions/v1/conversation-api/brief/extract',{method:'OPTIONS',headers:{origin,'access-control-request-method':'POST'}}));
   expect(conversationPreflight.status).toBe(204);expect(conversationPreflight.headers.get('access-control-allow-origin')).toBe(origin);expect(conversationPreflight.headers.get('access-control-allow-methods')).toBe('POST, OPTIONS');
   const scenePreflight=await scene(new Request('https://edge.test/functions/v1/scene-api/studios',{method:'OPTIONS',headers:{origin,'access-control-request-method':'GET'}}));
   expect(scenePreflight.status).toBe(204);expect(scenePreflight.headers.get('access-control-allow-origin')).toBe(origin);
  }
  for(const origin of ['https://evil.pages.dev','https://a.b.scendance-scene-planner-ewz.pages.dev','https://cd61e48a.scendance-scene-planner-ewz.pages.dev.evil.test','http://cd61e48a.scendance-scene-planner-ewz.pages.dev','https://user:pass@cd61e48a.scendance-scene-planner-ewz.pages.dev']){
   expect((await api(new Request('https://edge.test/functions/v1/conversation-api/brief/extract',{method:'OPTIONS',headers:{origin}}))).status).toBe(403);
   expect((await scene(new Request('https://edge.test/functions/v1/scene-api/projects',{method:'OPTIONS',headers:{origin}}))).status).toBe(403);
  }
 });
 it('rejects scene writes, lookalike paths, unsupported methods and unknown preflights',async()=>{
  const backend={user:vi.fn(async()=> 'user'),scene:vi.fn()} as unknown as Backend,fetcher=vi.fn<typeof fetch>(),api=createConversationApi(backend,env,fetcher);
  for(const path of ['/functions/v1/conversation-api/projects/x/scene','/functions/v1/conversation-api/brief/extract/extra','/functions/v1/scene-api/brief/extract','/functions/v1/conversation-api%2Fbrief/extract'])expect((await api(make(path,{}))).status).toBe(404);
  expect((await api(new Request('https://edge.test/functions/v1/conversation-api/brief/extract',{method:'GET'}))).status).toBe(405);
  expect((await api(new Request('https://edge.test/functions/v1/conversation-api/projects',{method:'OPTIONS'}))).status).toBe(404);
  expect(backend.user).not.toHaveBeenCalled();expect(backend.scene).not.toHaveBeenCalled();expect(fetcher).not.toHaveBeenCalled();
 });
 it('passes real conversation request shapes to the existing Bailian brief profile',async()=>{
  const backend={user:vi.fn(async()=> 'user')} as unknown as Backend;
  const output={extraction:{headcount:30},reply:'先按30人讨论。',unhandled:[],factEvidence:[{key:'headcount',evidence:'30人'}]};
  const fetcher=vi.fn<typeof fetch>().mockResolvedValueOnce(completion(JSON.stringify(output))).mockResolvedValueOnce(completion('可以先核对场地。'));
  const api=createConversationApi(backend,env,fetcher);
  const brief=await api(make('/functions/v1/conversation-api/brief/extract',{message:'30人',responseMode:'conversation_v1',history:[]}));
  expect(await brief.json()).toEqual({enabled:true,...output});expect(brief.headers.get('access-control-allow-origin')).toBe('https://example.test');
  const chat=await api(make('/functions/v1/conversation-api/assistant/chat',{message:'怎么安排签到？',history:[]}));
  expect(await chat.json()).toEqual({status:'ok',answer:'可以先核对场地。'});expect(fetcher).toHaveBeenCalledTimes(2);
  for(const [url,init] of fetcher.mock.calls){expect(String(url)).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions');expect(JSON.parse(String(init?.body))).toMatchObject({model:'qwen-example',enable_thinking:false});}
 });
 it.each([
  {message:'你好，请用一句话告诉我你能怎样帮我规划户外活动。',answer:'我可以协助核对活动范围、分区与设施方案，确认后才应用。'},
  {message:'先搜IN77候选，不默认商场轮廓是活动范围。',answer:JSON.stringify({action:'search',query:'IN77',reply:'先搜索候选，活动边界待你核对。',references:[],facts:{}})},
 ])('accepts documented Bailian text completion with null tool metadata: $message',async({message,answer})=>{
  const backend={user:vi.fn(async()=> 'user'),scene:vi.fn()} as unknown as Backend;
  const fetcher=vi.fn<typeof fetch>().mockResolvedValue(Response.json({choices:[{finish_reason:'stop',index:0,message:{role:'assistant',content:answer,function_call:null,tool_calls:null}}],usage:{prompt_tokens:22,completion_tokens:18,total_tokens:40}}));
  const result=await createConversationApi(backend,env,fetcher)(make('/functions/v1/conversation-api/assistant/chat',{message,history:[]}));
  expect(result.status).toBe(200);const body=await result.json();expect(body).toEqual({status:'ok',answer});expect(fetcher).toHaveBeenCalledOnce();expect(backend.scene).not.toHaveBeenCalled();
  const sent=JSON.parse(String(fetcher.mock.calls[0]![1]?.body));expect(sent).toMatchObject({model:'qwen-example',enable_thinking:false,max_tokens:1024});expect(sent.tools).toBeUndefined();expect(sent.response_format).toBeUndefined();
  if(message.includes('IN77'))expect(JSON.parse(body.answer)).toMatchObject({action:'search',query:'IN77',references:[]});
 });
 it('defaults closed after authentication while preserving CORS and never dispatching',async()=>{
  const backend={user:vi.fn(async()=> 'user')} as unknown as Backend,fetcher=vi.fn<typeof fetch>();
  const config={...settings};delete config.CONVERSATION_API_ENABLED;
  const disabled=createConversationApi(backend,key=>config[key],fetcher);
  for(const [path,body] of [['/conversation-api/brief/extract',{message:'30人'}],['/conversation-api/brief/extract',{message:'30人',responseMode:'conversation_v1',history:[]}],['/conversation-api/assistant/chat',{message:'问题',history:[]}]] as const){
   const response=await disabled(make(path,body));expect(response.status).toBe(503);expect(response.headers.get('access-control-allow-origin')).toBe('https://example.test');expect(await response.json()).toMatchObject({error:{code:'CONVERSATION_API_DISABLED'}});
  }
  expect((await disabled(make('/conversation-api/brief/extract',{message:'30人'},false))).status).toBe(401);expect(fetcher).not.toHaveBeenCalled();
 });
 it('does not bypass the existing configured request guard',async()=>{
  const backend={user:vi.fn(async()=> 'user')} as unknown as Backend,fetcher=vi.fn<typeof fetch>();
  const blocked=createConversationApi(backend,key=>({...settings,BRIEF_REQUEST_GUARD:'enforce'} as Record<string,string>)[key],fetcher);
  const response=await blocked(make('/brief/extract',{message:'30人'}));expect(response.status).toBe(503);expect(await response.json()).toMatchObject({error:{code:'BRIEF_GUARD_NOT_READY'}});expect(fetcher).not.toHaveBeenCalled();
  const disabled=createConversationApi(backend,key=>({...settings,CONVERSATION_API_ENABLED:'0',BRIEF_REQUEST_GUARD:'enforce'} as Record<string,string>)[key],fetcher);
  expect(await (await disabled(make('/assistant/chat',{message:'问题',history:[]}))).json()).toMatchObject({error:{code:'BRIEF_GUARD_NOT_READY'}});expect(fetcher).not.toHaveBeenCalled();
 });
 it('does not enable conversation on the existing scene-api handler',async()=>{
  const backend={user:vi.fn(async()=> 'user')} as unknown as Backend,fetcher=vi.fn<typeof fetch>();
  const old=createApi(backend,env,fetcher);
  expect(await (await old(make('/functions/v1/scene-api/brief/extract',{message:'30人',responseMode:'conversation_v1',history:[]}))).json()).toMatchObject({enabled:false,extraction:null});
  expect(await (await old(make('/functions/v1/scene-api/assistant/chat',{message:'问题',history:[]}))).json()).toEqual({status:'disabled',answer:null});expect(fetcher).not.toHaveBeenCalled();
 });
});
