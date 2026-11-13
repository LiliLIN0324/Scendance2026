import {createApi} from './api.ts';
import type {Backend} from './backend.ts';
import type {Env,Fetcher} from './http.ts';

/** Strict route boundary for the dedicated conversation deployment. */
export function createConversationApi(backend:Backend,env:Env,fetcher:Fetcher=fetch) {
 // These overrides are scoped to this handler; the existing scene-api keeps
 // its own environment and all existing BRIEF_REQUEST_GUARD behavior.
 // The configured ordinary MiniMax adapter owns this deployment when selected.
 // Do not let stale product-Bailian flags override it or retry unrelated providers.
 const minimax=env('AGENT_CHAT_PROFILE')==='minimax';
 const enabledApi=createApi(backend,key=>{
  if(['BRIEF_CONVERSATION_ENABLED','ASSISTANT_CHAT_ENABLED'].includes(key))return '1';
  if(minimax&&key==='BAILIAN_PRODUCT_ENABLED')return '0';
  if(minimax&&['TOKENDANCE_API_KEY','DEEPSEEK_API_KEY'].includes(key))return '';
  return env(key);
 },fetcher);
 const disabledApi=createApi(backend,key=>key==='ASSISTANT_CHAT_ENABLED'?'0':env(key),fetcher);
 return async(request:Request):Promise<Response>=>{
  const url=new URL(request.url),prefix='/functions/v1/conversation-api';
  let path=url.pathname;
  if(path===prefix||path.startsWith(prefix+'/'))path=path.slice(prefix.length);
  else if(path==='/conversation-api'||path.startsWith('/conversation-api/'))path=path.slice('/conversation-api'.length);
  if(path.endsWith('/'))path=path.slice(0,-1);
  if(path!=='/brief/extract'&&path!=='/assistant/chat')return new Response(null,{status:404,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
  if(request.method!=='POST'&&request.method!=='OPTIONS')return new Response(null,{status:405,headers:{'Allow':'POST, OPTIONS','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
  url.pathname=path;
  // For disabled requests use the already authenticated, no-provider chat
  // branch as a probe, including its origin/guard handling. It does not parse
  // or send the request body. Do not replace configured request guards.
  if(request.method==='POST'&&env('CONVERSATION_API_ENABLED')!=='1'){
   url.pathname='/assistant/chat';
   const response=await disabledApi(new Request(url,request));
   if(response.status!==200)return response;
   const headers=new Headers(response.headers);
   return new Response(JSON.stringify({error:{code:'CONVERSATION_API_DISABLED'}}),{status:503,headers});
  }
  const response=await enabledApi(new Request(url,request));
  if(request.method!=='OPTIONS'||response.status!==204)return response;
  const headers=new Headers(response.headers);headers.set('Access-Control-Allow-Methods','POST, OPTIONS');
  return new Response(null,{status:response.status,headers});
 };
}
