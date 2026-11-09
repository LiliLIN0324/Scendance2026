import {createHash} from 'node:crypto';
import {ZodError} from 'zod';
import {BRIEF_CONVERSATION_PROMPT,briefConversationRequestSchema,parseBriefConversation} from '../supabase/functions/_shared/brief-extract-contract.ts';
import {ASSISTANT_CHAT_PROMPT} from '../supabase/functions/_shared/assistant-chat.ts';
import {assistantChatRequestSchema} from '../supabase/functions/_shared/assistant-chat-contract.ts';
import {AGENT_SYSTEM_PROMPT,MINIMAX_AGENT_SYSTEM_PROMPT} from '../supabase/functions/_shared/agent-runner.ts';
import {parseAgentModelReply} from '../supabase/functions/_shared/agent-model-reply.ts';
import {parseMiniMaxToolTurn} from '../supabase/functions/_shared/minimax-tool-adapter.ts';
import {parseBriefModelJson} from '../supabase/functions/_shared/brief-model-json.ts';
import {diagnoseBriefEvidenceMismatch,type EvidenceDiagnostic} from './local-brief-evidence-diagnostic.ts';
import {diagnoseBriefSchemaIssues,type SchemaDiagnostic} from './local-brief-schema-diagnostic.ts';

// The proxy validates the declared tool surface; availability and permissions
// remain the runner's responsibility. It does not itself execute any tool.
const trialAgentTools=new Set(['get_scene','search_resources','search_places','inspect_zone','find_free_areas','prepare_seating_candidate','prepare_shared_seating_candidate','create_parametric_model','inspect_materials','customize_material','get_bom','validate_candidate','submit_candidates','start_lux3d_model']);

export type TrialState='ready'|'running'|'awaiting_user'|'failed';
export type TrialFailureCode='http_error'|'timeout'|'cancelled_or_upstream_timeout'|'network_error'|'response_too_large'|'response_empty'|'response_encoding'|'provider_non_json'|'provider_envelope_invalid'|'provider_reported_error'|'provider_incomplete'|'provider_tool_call'|'model_non_json'|'model_schema_invalid'|'model_evidence_mismatch'|'model_execution_claim'|'model_text_invalid'|'unknown_error';
export type TrialDiagnostic={code:TrialFailureCode;httpStatus?:number;abortSource?:'caller_timeout'|'caller_abort'|'unknown';evidence?:EvidenceDiagnostic;schema?:SchemaDiagnostic};
class TrialFailure extends Error {
 constructor(readonly diagnostic:TrialDiagnostic){super('试用请求失败');}
}
/** Read a clone only up to the bound; cancel both tee branches if it fails. */
async function validationBody(response:Response,maximum:number):Promise<string>{
 const clone=response.clone();
 const cancel=()=>{void clone.body?.cancel().catch(()=>{});void response.body?.cancel().catch(()=>{});};
 if(Number(clone.headers.get('content-length'))>maximum){cancel();throw new TrialFailure({code:'response_too_large'});}
 const reader=clone.body?.getReader();if(!reader){void response.body?.cancel().catch(()=>{});throw new TrialFailure({code:'response_empty'});}
 const chunks:Uint8Array[]=[];let size=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>maximum)throw new TrialFailure({code:'response_too_large'});chunks.push(value);}}
 catch(error){void reader.cancel().catch(()=>{});void response.body?.cancel().catch(()=>{});throw error instanceof TrialFailure?error:new TrialFailure({code:'network_error'});}finally{reader.releaseLock();}
 const all=new Uint8Array(size);let offset=0;for(const chunk of chunks){all.set(chunk,offset);offset+=chunk.length;}
 try{return new TextDecoder('utf-8',{fatal:true}).decode(all);}catch{throw new TrialFailure({code:'response_encoding'});}
}

/** Process-scoped fence, not an account spending limit or cross-process idempotency. */
export function createChatTrialProvider(transport:typeof fetch,notify:(used:number,state:TrialState,diagnostic:TrialDiagnostic|null)=>void=()=>{},timeoutMs=110_000,enableAgentTools=false,profile?:{provider:'bailian-qwen';model:string}){
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>110_000)throw Error('试用时限无效。');
 if(profile&&!/^qwen[a-z0-9.-]{1,80}$/i.test(profile.model))throw Error('百炼模型配置无效。');
 let used=0,running=false,disabled=false;const seen=new Set<string>();
 const report=(state:TrialState,diagnostic:TrialDiagnostic|null=null)=>{try{notify(used,state,diagnostic);}catch{/* observer is not authoritative */}};
 const deny=(error:string)=>Response.json({error},{status:503});
 const fetcher:typeof fetch=async(input,init)=>{
  if(disabled)return deny('session_stopped');if(running)return deny('request_busy');
  const url=typeof input==='string'?input:input instanceof URL?input.href:input.url;
  if(url!==(profile?'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions':'https://api.minimax.cn/v1/chat/completions')||init?.method!=='POST'||typeof init.body!=='string'||new TextEncoder().encode(init.body).length>(enableAgentTools?220_000:50_000))return deny('unsupported_request');
  if(init.signal?.aborted)return deny('cancelled_before_dispatch');
  let mode:'conversation'|'chat'|'agent',original='',offeredNames:string[]=[];
  try{
   const body=JSON.parse(init.body) as {model?:unknown;messages?:Array<{role?:unknown;content?:unknown}>;temperature?:unknown;response_format?:unknown;max_tokens?:unknown;enable_thinking?:unknown;max_completion_tokens?:unknown;reasoning_split?:unknown;reasoning_effort?:unknown;tools?:Array<{type?:unknown;function?:{name?:unknown}}>;tool_choice?:unknown};
   if(enableAgentTools&&Array.isArray(body?.messages)&&body.messages[0]?.role==='system'&&body.messages[0]?.content===(profile?AGENT_SYSTEM_PROMPT:MINIMAX_AGENT_SYSTEM_PROMPT)){
    const allowed=profile?['model','messages','max_tokens','enable_thinking','tools','tool_choice']:['model','messages','max_completion_tokens','reasoning_split','reasoning_effort','tools','tool_choice'];
    if(Object.keys(body).some(key=>!allowed.includes(key))||(profile?(body.model!==profile.model||body.enable_thinking!==false||body.max_tokens!==7000):(body.model!=='MiniMax-M3.1-Flash'||body.reasoning_split!==true||body.max_completion_tokens!==7000))||body.messages.length<2||body.messages.length>80||!Array.isArray(body.tools)||body.tools.length<1||body.tools.length>trialAgentTools.size)return deny('unsupported_request');
    if(body.reasoning_effort!==undefined&&(typeof body.reasoning_effort!=='string'||!['low','medium','high','xhigh','max'].includes(body.reasoning_effort)))return deny('unsupported_request');
    for(const tool of body.tools){if(tool?.type!=='function'||typeof tool.function?.name!=='string'||!trialAgentTools.has(tool.function.name))return deny('unsupported_request');offeredNames.push(tool.function.name);}
    if(new Set(offeredNames).size!==offeredNames.length||!offeredNames.includes('submit_candidates'))return deny('unsupported_request');
    mode='agent';
   }else{
   const allowed=profile?['model','messages','max_tokens','enable_thinking','temperature','response_format']:['model','messages','max_completion_tokens','reasoning_split','reasoning_effort'];
   const limit=profile?body.max_tokens:body.max_completion_tokens;
   if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>!allowed.includes(key))||(profile?(body.model!==profile.model||body.enable_thinking!==false):(body.model!=='MiniMax-M3.1-Flash'||body.reasoning_split!==true))||!Number.isSafeInteger(limit)||Number(limit)<1||Number(limit)>2048||(body.reasoning_effort!==undefined&&(typeof body.reasoning_effort!=='string'||!['low','medium','high','xhigh','max'].includes(body.reasoning_effort)))||!Array.isArray(body.messages)||body.messages.length!==2||body.messages.some(item=>!item||typeof item!=='object'||Object.keys(item).some(key=>!['role','content'].includes(key)))||body.messages[0]?.role!=='system'||body.messages[1]?.role!=='user'||typeof body.messages[1]?.content!=='string')return deny('unsupported_request');
   const system=body.messages[0].content;mode=system===BRIEF_CONVERSATION_PROMPT?'conversation':system===ASSISTANT_CHAT_PROMPT?'chat':(()=>{throw Error('unsupported');})();
   if(profile&&((body.temperature!==undefined&&body.temperature!==0)||(body.response_format!==undefined&&JSON.stringify(body.response_format)!=='{"type":"json_object"}')))return deny('unsupported_request');
   const data=JSON.parse(body.messages[1].content) as {message?:unknown;history?:unknown};
   if(mode==='conversation'){const parsed=briefConversationRequestSchema.parse({...data,responseMode:'conversation_v1'});original=parsed.message;}
   else {const parsed=assistantChatRequestSchema.parse(data);original=parsed.message;}
   }
  }catch{return deny('unsupported_request');}
  const fingerprint=createHash('sha256').update(init.body).digest('hex');if(seen.has(fingerprint))return deny('duplicate_request');
  // Reserve synchronously before dispatch. Every sent attempt consumes one slot.
  seen.add(fingerprint);used++;running=true;report('running');
  const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined,abortReason:'timeout'|'cancelled_or_upstream_timeout'|null=null;
  let abortSource:TrialDiagnostic['abortSource'];
  const abort=()=>{if(!abortReason){abortReason='cancelled_or_upstream_timeout';const reason=init.signal?.reason;const name=reason&&typeof reason==='object'&&'name' in reason?reason.name:undefined;abortSource=name==='TimeoutError'?'caller_timeout':name==='AbortError'?'caller_abort':'unknown';}controller.abort();};init.signal?.addEventListener('abort',abort,{once:true});if(init.signal?.aborted)abort();
  const abortDiagnostic=():TrialDiagnostic=>({code:abortReason??'cancelled_or_upstream_timeout',...(abortReason==='cancelled_or_upstream_timeout'?{abortSource:abortSource??'unknown'}:{})});
  try{
   if(controller.signal.aborted)throw new TrialFailure(abortDiagnostic());
   const timeout=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{abortReason='timeout';controller.abort();reject(new TrialFailure({code:'timeout'}));},timeoutMs);});
   const cancelled=new Promise<never>((_,reject)=>{controller.signal.addEventListener('abort',()=>reject(new TrialFailure(abortDiagnostic())),{once:true});if(controller.signal.aborted)reject(new TrialFailure(abortDiagnostic()));});
   const operation=(async()=>{
    let response:Response;try{response=await transport(url,{...init,redirect:'error',signal:controller.signal});}catch{throw new TrialFailure(abortReason?abortDiagnostic():{code:'network_error'});}
    if(!response.ok){void response.body?.cancel().catch(()=>{});const status=response.status;throw new TrialFailure({code:'http_error',...(Number.isInteger(status)&&status>=100&&status<=599?{httpStatus:status}:{})});}
    const text=await validationBody(response,mode==='agent'?150_000:100_000);
    let raw:{base_resp?:{status_code?:unknown};choices?:Array<{finish_reason?:unknown;message?:{content?:unknown;tool_calls?:unknown;function_call?:unknown}}>};
    try{raw=JSON.parse(text);}catch{throw new TrialFailure({code:'provider_non_json'});}
    if(!raw||typeof raw!=='object'||Array.isArray(raw)||!Array.isArray(raw.choices)||raw.choices.length!==1||!raw.choices[0]||typeof raw.choices[0]!=='object'||!raw.choices[0].message||typeof raw.choices[0].message!=='object'||(raw.base_resp!==undefined&&(!raw.base_resp||typeof raw.base_resp!=='object'||!Number.isSafeInteger(raw.base_resp.status_code))))throw new TrialFailure({code:'provider_envelope_invalid'});
    const choice=raw.choices?.[0],content=choice?.message?.content;
    if(raw.base_resp?.status_code!==undefined&&raw.base_resp.status_code!==0)throw new TrialFailure({code:'provider_reported_error'});
    if(mode==='agent'){
      try{if(profile){const parsed=parseAgentModelReply(raw);if(parsed.toolCalls.some(call=>!offeredNames.includes(call.function.name)))throw Error('unsupported tool');}else parseMiniMaxToolTurn(raw,offeredNames,new Set(),false,true);}catch{throw new TrialFailure({code:'provider_envelope_invalid'});}
      return response;
    }
    if(choice?.finish_reason!=='stop')throw new TrialFailure({code:'provider_incomplete'});
    if(choice.message?.tool_calls!==undefined||choice.message?.function_call!==undefined)throw new TrialFailure({code:'provider_tool_call'});
    if(typeof content!=='string'||!content.trim()||content.length>100_000||/<\/?think>/i.test(content))throw new TrialFailure({code:'model_text_invalid'});
    if(mode==='conversation'){
      let result:unknown;try{result=parseBriefModelJson(content);}catch{throw new TrialFailure({code:'model_non_json'});}
      try{parseBriefConversation(result,original);}catch(error){
        if(error instanceof ZodError){const schema=diagnoseBriefSchemaIssues(error.issues);throw new TrialFailure({code:'model_schema_invalid',...(schema?{schema}:{})});}
        if(error instanceof Error&&error.message==='MODEL_EVIDENCE_MISMATCH'){
          const evidence=diagnoseBriefEvidenceMismatch(result,original);
          throw new TrialFailure({code:'model_evidence_mismatch',...(evidence?{evidence}:{})});
        }
        if(error instanceof Error&&error.message==='MODEL_INVALID_RESPONSE')throw new TrialFailure({code:'model_execution_claim'});
        throw new TrialFailure({code:'unknown_error'});
      }
    }else if(content.length>3000||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(content))throw new TrialFailure({code:'model_text_invalid'});
    return response;
   })();
   const result=await Promise.race([operation,timeout,cancelled]);if(controller.signal.aborted)throw new TrialFailure(abortDiagnostic());report('ready');return result;
  }catch(error){
   const diagnostic=abortReason?abortDiagnostic():error instanceof TrialFailure?error.diagnostic:{code:'unknown_error' as const};
   // A fully received, semantically invalid answer is rejected. Its fingerprint
   // stays reserved, so only a distinct later request can be dispatched.
   if(['model_non_json','model_schema_invalid','model_evidence_mismatch','model_execution_claim','model_text_invalid'].includes(diagnostic.code)){
    report('ready',diagnostic);return deny('model_response_invalid');
   }
   disabled=true;report('failed',diagnostic);return deny('request_result_unknown');
  }
  finally{if(timer!==undefined)clearTimeout(timer);init.signal?.removeEventListener('abort',abort);running=false;}
 };
 return {fetcher,used:()=>used,resume:()=>false};
}
