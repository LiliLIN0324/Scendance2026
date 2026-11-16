import {describe,expect,it,vi} from 'vitest';
import {createApi} from '../supabase/functions/_shared/api.ts';
import {answerAssistantChat} from '../supabase/functions/_shared/assistant-chat.ts';
import type {Backend} from '../supabase/functions/_shared/backend.ts';

const values:Record<string,string>={ASSISTANT_CHAT_ENABLED:'1',AGENT_CHAT_BASE_URL:'https://model.example/v1',AGENT_CHAT_KEY:'private-fixture',AGENT_CHAT_MODEL:'fixture'};
const env=(name:string)=>values[name];
const backend={user:vi.fn(async()=> 'fixture-user')} as unknown as Backend;
const input={message:'签到怎么安排？',history:[{role:'user',text:'大约30人'}]};
const sse=(body:string)=>new Response(body,{headers:{'Content-Type':'text/event-stream'}});
const chunk=(value:Record<string,unknown>)=>`data: ${JSON.stringify(value)}\n\n`;
const streamBody=[
  chunk({choices:[{delta:{reasoning_content:'PRIVATE REASONING'}}]}),
  chunk({choices:[{delta:{content:'先确认入场方式，'}}]}),
  chunk({choices:[{delta:{content:'再安排签到位置。'},finish_reason:'stop'}]}),
  'data: [DONE]\n\n',
].join('');
const request=(path:string,value:unknown,auth=true)=>new Request(`http://localhost/scene-api${path}`,{method:'POST',headers:{'Content-Type':'application/json',...(auth?{Authorization:'Bearer fixture'}:{})},body:JSON.stringify(value)});

describe('流式只读活动聊天',()=>{
 it('forwards visible content deltas in order and never exposes provider reasoning',async()=>{
  const deltas:string[]=[];
  const fetcher=vi.fn<typeof fetch>().mockResolvedValue(sse(streamBody));
  const result=await answerAssistantChat({...input,enabled:true,env,fetcher,onDelta:text=>deltas.push(text)});
  expect(result).toEqual({status:'ok',answer:'先确认入场方式，再安排签到位置。'});
  expect(deltas).toEqual(['先确认入场方式，','再安排签到位置。']);
  const sent=JSON.parse(String(fetcher.mock.calls[0]![1]?.body));
  expect(sent.stream).toBe(true);
  expect(JSON.stringify({result,deltas})).not.toContain('PRIVATE');
 });
 it('reports a truncated or empty stream as provider_error without a partial answer',async()=>{
  const truncated=vi.fn<typeof fetch>().mockResolvedValue(sse(chunk({choices:[{delta:{content:'半个答案'},finish_reason:'length'}]})));
  expect((await answerAssistantChat({...input,enabled:true,env,fetcher:truncated,onDelta:()=>{}})).status).toBe('provider_error');
  const empty=vi.fn<typeof fetch>().mockResolvedValue(sse('data: [DONE]\n\n'));
  expect((await answerAssistantChat({...input,enabled:true,env,fetcher:empty,onDelta:()=>{}})).status).toBe('provider_error');
 });
 it('streams the same contract over the SSE route with a done frame',async()=>{
  const fetcher=vi.fn<typeof fetch>().mockResolvedValue(sse(streamBody));
  const response=await createApi(backend,env,fetcher)(request('/assistant/chat/stream',input));
  expect(response.status).toBe(200);
  expect(response.headers.get('Content-Type')).toContain('text/event-stream');
  const text=await response.text();
  expect(text).toContain('event: delta');
  expect(text).toContain('"text":"先确认入场方式，"');
  expect(text).toContain('event: done');
  expect(text).toContain('"status":"ok"');
  expect(text).not.toContain('PRIVATE');
 });
 it('streams only the outdoor thought string before the structured turn is ready',async()=>{
  const encoder=new TextEncoder();
  let upstream!:ReadableStreamDefaultController<Uint8Array>;
  const provider=new ReadableStream<Uint8Array>({start(controller){upstream=controller;}});
  const fetcher=vi.fn<typeof fetch>().mockResolvedValue(new Response(provider));
  const response=await createApi(backend,env,fetcher)(request('/assistant/chat/stream',{...input,responseMode:'outdoor_v1',includeThought:true}));
  const reader=response.body!.getReader();
  const decode=new TextDecoder();
  upstream.enqueue(encoder.encode(chunk({choices:[{delta:{reasoning_content:'PRIVATE REASONING',content:'{"thought":"先核对\\u573'}}]})));
  expect(decode.decode((await reader.read()).value)).toContain('"text":"先核对"');
  upstream.enqueue(encoder.encode(chunk({choices:[{delta:{content:'a地，再确认入口。","action":"ask","reply":"请确认入口。"}'},finish_reason:'stop'}]})));
  upstream.close();
  let rest='';
  for(;;){
   const {value,done}=await reader.read();
   if(done)break;
   rest+=decode.decode(value);
  }
  expect(rest).toContain('event: thought');
  expect(rest).toContain('"text":"场地，再确认入口。"');
  expect(rest).toContain('event: done');
  expect(rest).toContain('"status":"ok"');
  expect(rest).not.toContain('event: delta');
  expect(rest).not.toContain('PRIVATE');
 });
 it('keeps the authentication, disabled and guard behavior of the JSON route',async()=>{
  const fetcher=vi.fn<typeof fetch>();
  const api=createApi(backend,env,fetcher);
  expect((await api(request('/assistant/chat/stream',input,false))).status).toBe(401);
  const disabled=await createApi(backend,()=>undefined,fetcher)(request('/assistant/chat/stream',input));
  expect(await disabled.text()).toContain('"status":"disabled"');
  expect(fetcher).not.toHaveBeenCalled();
  const guarded=await createApi(backend,key=>key==='BRIEF_REQUEST_GUARD'?'enforce':env(key),fetcher)(request('/assistant/chat/stream',input));
  expect(guarded.status).toBe(503);
  expect(fetcher).not.toHaveBeenCalled();
 });
});
