/** Local trial only. Configuration is explicit; no price or terms review is inferred. */
import type {Fetcher} from '../supabase/functions/_shared/http.ts';
import {processGeneration} from '../supabase/functions/_shared/worker.ts';
import type {Backend} from '../supabase/functions/_shared/backend.ts';
import type {Env} from '../supabase/functions/_shared/http.ts';

export interface LocalLux3dLiveInput {key:string;termsUrl:string;reviewedAt:string;reservationCents:string}
export function localLux3dLiveConfig(input:LocalLux3dLiveInput):Record<string,string> {
 if(typeof input.key!=='string'||!input.key||input.key.length>4096||/[^\x21-\x7e]/.test(input.key))throw Error('local Lux3D credential unavailable');
 let url:URL;try{url=new URL(input.termsUrl);}catch{throw Error('local Lux3D terms configuration unavailable');}
 if(url.protocol!=='https:'||url.username||url.password||url.port||url.search||url.hash||!(url.hostname==='aholo3d.cn'||url.hostname.endsWith('.aholo3d.cn')))throw Error('local Lux3D terms configuration unavailable');
 const date=/^\d{4}-\d{2}-\d{2}$/.test(input.reviewedAt)?new Date(`${input.reviewedAt}T00:00:00Z`):new Date(NaN);
 if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==input.reviewedAt||date.getTime()>Date.now())throw Error('local Lux3D terms review unavailable');
 if(!/^[1-9]\d{0,8}$/.test(input.reservationCents)||!Number.isSafeInteger(Number(input.reservationCents)))throw Error('local Lux3D reservation unavailable');
 return {LUX3D_API_KEY:input.key,LUX3D_BASE_URL:'https://api.aholo3d.cn',LUX3D_TERMS_URL:url.href,LUX3D_TERMS_REVIEWED_AT:input.reviewedAt,GENERATION_MAX_TASK_CENTS:input.reservationCents};
}

/** Text creation and polling go only to the official China endpoint; downloaded assets receive no key. */
export function localLux3dChinaFetch(key:string,transport:Fetcher=fetch):Fetcher {
 return async(input,init)=>{
  const raw=typeof input==='string'?input:input instanceof URL?input.href:null;
  if(!raw)throw Error('local Lux3D route denied');
  let url:URL;try{url=new URL(raw);}catch{throw Error('local Lux3D route denied');}
  if(url.protocol!=='https:'||url.username||url.password||url.port)throw Error('local Lux3D route denied');
  const method=(init?.method??'GET').toUpperCase();
  if(url.origin==='https://api.aholo3d.cn'){
   const isCreate=method==='POST'&&url.pathname==='/lux3d/v1/generate/text-to-3d/task/create'&&!url.search;
   const isQuery=method==='GET'&&url.pathname==='/lux3d/v1/generate/task/get'&&url.searchParams.size===1&&/^\d+$/.test(url.searchParams.get('taskid')??'');
   const headers=new Headers(init?.headers);if((!isCreate&&!isQuery)||headers.get('authorization')!==key)throw Error('local Lux3D route denied');
   const safeHeaders=new Headers({Authorization:key});if(isCreate)safeHeaders.set('Content-Type','application/json');
   return transport(url.href,{...init,headers:safeHeaders,redirect:'error'});
  }
  const hosts=['.kujiale.com','.myqcloud.com','.tencentcos.cn','.tencentcos.com'];
  const allowed=hosts.some(suffix=>url.hostname.endsWith(suffix)&&url.hostname.length>suffix.length);
  if(method!=='GET'||!allowed||new Headers(init?.headers).has('authorization'))throw Error('local Lux3D route denied');
  return transport(url.href,{method:'GET',redirect:'error',...(init?.signal?{signal:init.signal}:{})});
 };
}

/** Runs only in the disposable local database; production claim/idempotency remains authoritative. */
export function startLocalLux3dWorker(backend:Backend,env:Env,fetcher:Fetcher,intervalMs=5000){
 let stopped=false,inFlight:Promise<unknown>|null=null,timer:ReturnType<typeof setTimeout>|null=null;
 const run=()=>{
  if(stopped||inFlight)return;
  inFlight=processGeneration(backend,env,fetcher).catch(()=>{/* no raw vendor errors or credentials in logs */}).finally(()=>{
   inFlight=null;if(!stopped)timer=setTimeout(run,intervalMs);
  });
 };
 timer=setTimeout(run,0);
 return {async stop(){stopped=true;if(timer)clearTimeout(timer);await inFlight;}};
}
