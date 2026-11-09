import {describe,expect,it,vi} from 'vitest';
import {createChatTrialProvider,type TrialDiagnostic} from '../scripts/local-chat-trial-provider.ts';
import {syntheticChatTransport} from '../scripts/local-chat-trial-synthetic.ts';
import {chatRequest} from '../supabase/functions/_shared/providers.ts';
import {BRIEF_CONVERSATION_PROMPT} from '../supabase/functions/_shared/brief-extract-contract.ts';
import {ASSISTANT_CHAT_PROMPT} from '../supabase/functions/_shared/assistant-chat.ts';
import {MINIMAX_AGENT_SYSTEM_PROMPT} from '../supabase/functions/_shared/agent-runner.ts';

const config:Record<string,string>={AGENT_CHAT_BASE_URL:'https://api.minimax.cn/v1',AGENT_CHAT_KEY:'fixture-not-a-key',AGENT_CHAT_MODEL:'MiniMax-M3.1-Flash',AGENT_CHAT_PROFILE:'minimax',AGENT_CHAT_REASONING_EFFORT:'low'};
function request(message:string,mode:'conversation'|'chat'='conversation'){
 const result=chatRequest(key=>config[key],{messages:[{role:'system',content:mode==='conversation'?BRIEF_CONVERSATION_PROMPT:ASSISTANT_CHAT_PROMPT},{role:'user',content:JSON.stringify({message,history:[]})}],max_completion_tokens:mode==='conversation'?2048:1024},{purpose:'brief'});
 return result;
}
describe('isolated chat trial provider fence',()=>{
 it('allows a single fenced conversation object and still rejects invented evidence',async()=>{
  const message='我们有80把椅子';const output={extraction:{inventoryMentions:[{evidence:'80把椅子'}]},reply:'可先核对椅子的规格与数量。',unhandled:[],factEvidence:[]};
  const response=(value:unknown)=>Response.json({choices:[{finish_reason:'stop',message:{content:'```json\n'+JSON.stringify(value)+'\n```'}}]});
  const transport=vi.fn<typeof fetch>().mockResolvedValue(response(output));const trial=createChatTrialProvider(transport),input=request(message);
  expect((await trial.fetcher(input.url,input.init)).ok).toBe(true);expect(transport).toHaveBeenCalledOnce();
  const bad={...output,extraction:{inventoryMentions:[{evidence:'100把椅子'}]}};const rejected=vi.fn<typeof fetch>().mockResolvedValue(response(bad));
  expect((await createChatTrialProvider(rejected).fetcher(input.url,input.init)).status).toBe(503);expect(rejected).toHaveBeenCalledOnce();
 });
 it('accepts the same-size fictional activity through the shared evidence contract',async()=>{
  const transport=vi.fn<typeof fetch>().mockImplementation(syntheticChatTransport),trial=createChatTrialProvider(transport);
  const input=request('为30人办室内讲座，场地长10米宽8米，采用课桌椅布局，生成方案');
  expect((await trial.fetcher(input.url,input.init)).ok).toBe(true);
  expect(trial.used()).toBe(1);expect(transport).toHaveBeenCalledOnce();
 });
 it('accepts the enabled Agent tool surface without itself executing tools',async()=>{
  const call={id:'call-1',type:'function',function:{name:'get_scene',arguments:'{}'}};
  const transport=vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({choices:[{finish_reason:'tool_calls',message:{role:'assistant',content:null,reasoning_content:'private',tool_calls:[call]}}]})).mockResolvedValueOnce(Response.json({choices:[{finish_reason:'tool_calls',message:{role:'assistant',content:null,tool_calls:[{id:'call-2',type:'function',function:{name:'submit_candidates',arguments:'{"candidates":[]}'}}]}}]})).mockResolvedValueOnce(Response.json({choices:[{finish_reason:'tool_calls',message:{role:'assistant',content:null,tool_calls:[{id:'call-3',type:'function',function:{name:'start_lux3d_model',arguments:'{"prompt":"讲台"}'}}]}}]}));
  const trial=createChatTrialProvider(transport,()=>{},110_000,true),url='https://api.minimax.cn/v1/chat/completions';
  const tools=['get_scene','submit_candidates'].map(name=>({type:'function',function:{name,parameters:{type:'object'}}}));
  const body={model:'MiniMax-M3.1-Flash',messages:[{role:'system',content:MINIMAX_AGENT_SYSTEM_PROMPT},{role:'user',content:'test scene'}],max_completion_tokens:7000,reasoning_split:true,tools,tool_choice:'auto'};
  const send=(value:unknown)=>trial.fetcher(url,{method:'POST',body:JSON.stringify(value)});
  expect((await send(body)).ok).toBe(true);
  expect((await send({...body,messages:[...body.messages,{role:'assistant',content:null,reasoning_content:'private',tool_calls:[call]},{role:'tool',tool_call_id:'call-1',content:'{"objects":[]}'}]})).ok).toBe(true);
  expect((await send({...body,tools:[...tools,{type:'function',function:{name:'create_parametric_model'}},{type:'function',function:{name:'customize_material'}},{type:'function',function:{name:'start_lux3d_model'}}]})).ok).toBe(true);
  expect((await send({...body,tools:[...tools,{type:'function',function:{name:'unknown_write'}}]})).status).toBe(503);
  expect(transport).toHaveBeenCalledTimes(3);expect(trial.used()).toBe(3);
  const disabled=createChatTrialProvider(transport);expect((await disabled.fetcher(url,{method:'POST',body:JSON.stringify(body)})).status).toBe(503);
 });
 it('passes malformed tool arguments for repair while rejecting unsafe JSON',async()=>{
  const response=(argumentsText:string)=>Response.json({choices:[{finish_reason:'tool_calls',message:{role:'assistant',tool_calls:[{id:'call-1',type:'function',function:{name:'get_scene',arguments:argumentsText}}]}}]});
  const url='https://api.minimax.cn/v1/chat/completions';
  const body={model:'MiniMax-M3.1-Flash',messages:[{role:'system',content:MINIMAX_AGENT_SYSTEM_PROMPT},{role:'user',content:'fixture'}],max_completion_tokens:7000,reasoning_split:true,tools:['get_scene','submit_candidates'].map(name=>({type:'function',function:{name}})),tool_choice:'auto'};
  const request={method:'POST',body:JSON.stringify(body)};
  const repairable=createChatTrialProvider(vi.fn<typeof fetch>().mockResolvedValue(response('{"x":')),()=>{},110_000,true);
  expect((await repairable.fetcher(url,request)).ok).toBe(true);
  const unsafe=createChatTrialProvider(vi.fn<typeof fetch>().mockResolvedValue(response('{"__proto__":{}}')),()=>{},110_000,true);
  expect((await unsafe.fetcher(url,request)).status).toBe(503);
 });
 it('allows only the fixed endpoint and exact prompt contracts',async()=>{
  const transport=vi.fn<typeof fetch>().mockImplementation(syntheticChatTransport),provider=createChatTrialProvider(transport);
  const input=request('30人，室内，签到尚未决定');
  expect((await provider.fetcher(input.url,input.init)).ok).toBe(true);
  const question=request('什么是活动动线？','chat');expect((await provider.fetcher(question.url,question.init)).ok).toBe(true);
  expect(transport).toHaveBeenCalledTimes(2);expect(provider.used()).toBe(2);
  expect((await provider.fetcher('https://other.example/v1/chat/completions',input.init)).status).toBe(503);
  const forged={...input.init,body:JSON.stringify({model:'MiniMax-M3.1-Flash',messages:[{role:'system',content:'arbitrary'},{role:'user',content:'x'}],max_completion_tokens:1024,reasoning_split:true})};
  expect((await provider.fetcher(input.url,forged)).status).toBe(503);expect(provider.used()).toBe(2);expect(transport).toHaveBeenCalledTimes(2);
 });
 it('rejects duplicates while allowing more than three distinct requests in this process',async()=>{
  const transport=vi.fn<typeof fetch>().mockImplementation(syntheticChatTransport),provider=createChatTrialProvider(transport);
  const first=request('第一句');expect((await provider.fetcher(first.url,first.init)).ok).toBe(true);expect((await provider.fetcher(first.url,first.init)).status).toBe(503);
  for(const message of ['第二句','第三句','第四句','第五句']){const next=request(message);expect((await provider.fetcher(next.url,next.init)).ok).toBe(true);}
  expect(provider.used()).toBe(5);expect(transport).toHaveBeenCalledTimes(5);
 });
 it('serializes simultaneous requests without consuming a slot for the denied call',async()=>{
  let release!:(response:Response)=>void;const transport=vi.fn<typeof fetch>().mockImplementation(()=>new Promise<Response>(resolve=>{release=resolve;}));
  const provider=createChatTrialProvider(transport),one=request('问题一','chat'),two=request('问题二','chat');
  const pending=provider.fetcher(one.url,one.init);expect((await provider.fetcher(two.url,two.init)).status).toBe(503);expect(provider.used()).toBe(1);
  release(Response.json({choices:[{finish_reason:'stop',message:{content:'请核对场地。'}}]}));expect((await pending).ok).toBe(true);expect(transport).toHaveBeenCalledOnce();
 });
 it('stops the session after provider error or incomplete output',async()=>{
  for(const result of [new Response('bad',{status:502}),Response.json({choices:[{finish_reason:'length',message:{content:'{}'}}]})]){
   const transport=vi.fn<typeof fetch>().mockResolvedValue(result),provider=createChatTrialProvider(transport),one=request('30人'),two=request('另一个问题');
   expect((await provider.fetcher(one.url,one.init)).status).toBe(503);expect((await provider.fetcher(two.url,two.init)).status).toBe(503);expect(transport).toHaveBeenCalledOnce();expect(provider.used()).toBe(1);
  }
 });
 it('rejects a complete invalid answer without retrying, then accepts a distinct user request',async()=>{
  const response=Response.json({choices:[{finish_reason:'stop',message:{content:'不是 JSON'}}]});
  const transport=vi.fn<typeof fetch>().mockResolvedValueOnce(response).mockImplementation(syntheticChatTransport);
  const events:Array<{state:string;diagnostic:TrialDiagnostic|null}>=[];
  const trial=createChatTrialProvider(transport,(_used,state,diagnostic)=>events.push({state,diagnostic}),110_000,true);
  const one=request('30人'),next=request('另一个活动问题','chat');
  expect((await trial.fetcher(one.url,one.init)).status).toBe(503);
  expect(events.at(-1)).toEqual({state:'ready',diagnostic:{code:'model_non_json'}});
  await Promise.resolve();expect(transport).toHaveBeenCalledOnce();expect(trial.used()).toBe(1);
  expect((await trial.fetcher(one.url,one.init)).status).toBe(503);expect(transport).toHaveBeenCalledOnce();
  expect((await trial.fetcher(next.url,next.init)).ok).toBe(true);expect(transport).toHaveBeenCalledTimes(2);expect(trial.used()).toBe(2);
  expect(trial.resume()).toBe(false);
 });
 it('fails closed on timeout even if transport ignores abort; no retry',async()=>{
  const transport=vi.fn<typeof fetch>().mockImplementation(()=>new Promise(()=>{})),provider=createChatTrialProvider(transport,()=>{},5),one=request('问题一','chat'),two=request('问题二','chat');
  expect((await provider.fetcher(one.url,one.init)).status).toBe(503);expect((await provider.fetcher(two.url,two.init)).status).toBe(503);expect(transport).toHaveBeenCalledOnce();
 });
 it('does not dispatch or count a request already cancelled',async()=>{
  const transport=vi.fn<typeof fetch>().mockImplementation(syntheticChatTransport),provider=createChatTrialProvider(transport),one=request('问题一','chat'),abort=new AbortController();abort.abort();
  expect((await provider.fetcher(one.url,{...one.init,signal:abort.signal})).status).toBe(503);expect(provider.used()).toBe(0);expect(transport).not.toHaveBeenCalled();
 });
 it('stops the session after cancellation during a dispatched request even if transport ignores it',async()=>{
  const transport=vi.fn<typeof fetch>().mockImplementation(()=>new Promise(()=>{})),provider=createChatTrialProvider(transport),one=request('问题一','chat'),two=request('问题二','chat'),abort=new AbortController();
  const pending=provider.fetcher(one.url,{...one.init,signal:abort.signal});abort.abort();expect((await pending).status).toBe(503);expect((await provider.fetcher(two.url,two.init)).status).toBe(503);expect(transport).toHaveBeenCalledOnce();
 });
 it('limits provider response before buffering and fails closed',async()=>{
  let cancelled=false;const body=new ReadableStream<Uint8Array>({pull(controller){controller.enqueue(new Uint8Array(100_001));},cancel(){cancelled=true;}});
  const transport=vi.fn<typeof fetch>().mockResolvedValue(new Response(body)),provider=createChatTrialProvider(transport),one=request('问题一','chat'),two=request('问题二','chat');
  expect((await provider.fetcher(one.url,one.init)).status).toBe(503);expect((await provider.fetcher(two.url,two.init)).status).toBe(503);expect(transport).toHaveBeenCalledOnce();expect(provider.used()).toBe(1);await vi.waitFor(()=>expect(cancelled).toBe(true));
 });
 it('validates the current inventory-mention evidence through the exact shared prompt',async()=>{
  const message='我们有80把椅子';const output={extraction:{inventoryMentions:[{evidence:'80把椅子'}]},reply:'可以先保留这条口述物料信息，规格和可用数量仍需核对。',unhandled:[],factEvidence:[]};
  const transport=vi.fn<typeof fetch>().mockResolvedValue(Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(output)}}]}));
  const trial=createChatTrialProvider(transport),input=request(message);expect((await trial.fetcher(input.url,input.init)).ok).toBe(true);expect(transport).toHaveBeenCalledOnce();
  const malformed={...output,extraction:{inventoryMentions:[{evidence:'100把椅子'}]}};const badTransport=vi.fn<typeof fetch>().mockResolvedValue(Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(malformed)}}]}));
  const badTrial=createChatTrialProvider(badTransport);expect((await badTrial.fetcher(input.url,input.init)).status).toBe(503);expect(badTrial.used()).toBe(1);
 });
 it('reports only fixed failure categories and safe HTTP status, never input, output, errors or credentials',async()=>{
  const secret='PRIVATE_RESPONSE_OR_KEY_9281',message='30人，敏感活动标题';
  const providerOutput=(content:string,finish='stop')=>Response.json({choices:[{finish_reason:finish,message:{content}}]});
  const common={extraction:{},reply:'建议先核对场地。',unhandled:[],factEvidence:[]};
  const cases:Array<{value?:Response;throwNetwork?:boolean;expected:TrialDiagnostic}>=[
   {value:new Response(secret,{status:429}),expected:{code:'http_error',httpStatus:429}},
   {throwNetwork:true,expected:{code:'network_error'}},
   {value:new Response(secret),expected:{code:'provider_non_json'}},
   {value:Response.json({bad:secret}),expected:{code:'provider_envelope_invalid'}},
   {value:Response.json({base_resp:{status_code:1001,status_msg:secret},choices:[{finish_reason:'stop',message:{content:'{}'}}]}),expected:{code:'provider_reported_error'}},
   {value:providerOutput(secret,'length'),expected:{code:'provider_incomplete'}},
   {value:Response.json({choices:[{finish_reason:'stop',message:{content:'{}',tool_calls:[{secret}]}}]}),expected:{code:'provider_tool_call'}},
   {value:providerOutput(secret),expected:{code:'model_non_json'}},
   {value:providerOutput(JSON.stringify({...common,reply:secret,extra:secret})),expected:{code:'model_schema_invalid',schema:{total:1,issues:[{code:'unrecognized_keys',path:'$'}]}}},
   {value:providerOutput(JSON.stringify({...common,extraction:{headcount:99},factEvidence:[{key:'headcount',evidence:'99人'}]})),expected:{code:'model_evidence_mismatch',evidence:{reason:'evidence_not_in_message',field:'headcount',count:1}}},
   {value:providerOutput(JSON.stringify({...common,reply:'已为你生成并摆放桌子。'})),expected:{code:'model_execution_claim'}},
  ];
  for(const test of cases){
   const events:Array<{state:string;diagnostic:TrialDiagnostic|null}>=[];
   const transport=vi.fn<typeof fetch>().mockImplementation(async()=>{if(test.throwNetwork)throw Error(secret);return test.value!;});
   const trial=createChatTrialProvider(transport,(_used,state,diagnostic)=>events.push({state,diagnostic}));const input=request(message);
   const recoverable=['model_non_json','model_schema_invalid','model_evidence_mismatch','model_execution_claim','model_text_invalid'].includes(test.expected.code);
   const failed=await trial.fetcher(input.url,input.init);expect(failed.status).toBe(503);expect(await failed.json()).toEqual({error:recoverable?'model_response_invalid':'request_result_unknown'});
   expect(events.at(-1)).toEqual({state:recoverable?'ready':'failed',diagnostic:test.expected});expect(transport).toHaveBeenCalledOnce();
   const data=JSON.stringify(events);expect(data).not.toContain(secret);expect(data).not.toContain(message);expect(data).not.toContain('fixture-not-a-key');
   expect((await trial.fetcher(input.url,input.init)).status).toBe(503);expect(transport).toHaveBeenCalledOnce();
   if(!recoverable){const next=request('另一个合成问题');expect((await trial.fetcher(next.url,next.init)).status).toBe(503);expect(transport).toHaveBeenCalledOnce();}
  }
 });
 it('distinguishes the internal timeout from cancellation without inspecting private errors',async()=>{
  const events:TrialDiagnostic[]=[];const transport=vi.fn<typeof fetch>().mockImplementation(()=>new Promise(()=>{}));
  const trial=createChatTrialProvider(transport,(_used,_state,diagnostic)=>{if(diagnostic)events.push(diagnostic);},5);const input=request('合成问题','chat');
  expect((await trial.fetcher(input.url,input.init)).status).toBe(503);expect(events).toEqual([{code:'timeout'}]);
 });
 it.each(['caller_timeout','caller_abort','unknown'] as const)('reports only a safe abort classification: %s',async expected=>{
  const events:TrialDiagnostic[]=[];const controller=new AbortController();
  const trial=createChatTrialProvider(vi.fn<typeof fetch>().mockImplementation(()=>new Promise(()=>{})),(_used,_state,diagnostic)=>{if(diagnostic)events.push(diagnostic);},500);
  const input=request('虚构问题','chat');const pending=trial.fetcher(input.url,{...input.init,signal:controller.signal});
  const reason=expected==='caller_timeout'?new DOMException('PRIVATE_TIMEOUT','TimeoutError'):expected==='caller_abort'?new DOMException('PRIVATE_ABORT','AbortError'):{name:'PRIVATE_UNKNOWN',secret:'PRIVATE_SECRET'};
  controller.abort(reason);expect((await pending).status).toBe(503);
  expect(events).toEqual([{code:'cancelled_or_upstream_timeout',abortSource:expected}]);expect(JSON.stringify(events)).not.toContain('PRIVATE_');
 });
});
