import { canonical, sha256 } from './domain.ts';

/** Design draft only: not called by the API and not an account/budget guarantee. */
export async function briefRequestFingerprint(input:{url:string;body:string;accountRef:string;credentialVersion:string;headers:Record<string,string>}):Promise<string>{
  if(typeof input.url!=='string'||typeof input.body!=='string'||new TextEncoder().encode(input.body).length>256_000||
    typeof input.accountRef!=='string'||!input.accountRef.trim()||input.accountRef.length>128||typeof input.credentialVersion!=='string'||!input.credentialVersion.trim()||input.credentialVersion.length>128)throw new Error('INVALID_PROVIDER_CONFIG');
  const url=new URL(input.url);
  if((url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)))||url.username||url.password||url.search||url.hash)throw new Error('INVALID_PROVIDER_CONFIG');
  if(!input.headers||typeof input.headers!=='object'||Array.isArray(input.headers))throw new Error('INVALID_PROVIDER_CONFIG');
  const headers:Record<string,string>=Object.create(null);
  for(const [rawKey,value] of Object.entries(input.headers)){
    const key=rawKey.toLowerCase();
    if(!/^[a-z0-9-]+$/.test(key)||Object.hasOwn(headers,key)||typeof value!=='string'||value.length>2048||/authorization|token|secret|cookie|api.key/i.test(key))throw new Error('INVALID_PROVIDER_CONFIG');
    headers[key]=value;
  }
  return sha256(canonical({version:1,method:'POST',url:url.href,body:input.body,accountRef:input.accountRef,credentialVersion:input.credentialVersion,headers}));
}

type Prepared={url:string;body:string;accountRef:string;credentialVersion:string;headers:Record<string,string>};
type Action='reserve'|'dispatch'|'complete'|'unknown'|'cancel_before_dispatch';
type RecordState={state:string;created:boolean;dispatch:boolean};
/** Caller must own authenticated actor, create `prepared` from actual dispatch, and await each RPC commit. */
export async function runGuardedBriefDraft(input:{requestId:string;prepared:Prepared;
  store:{call(action:Action,id:string,fingerprint:string):Promise<RecordState>};
  send(prepared:Prepared,signal?:AbortSignal):Promise<unknown>;signal?:AbortSignal}) {
  const prepared=structuredClone(input.prepared);Object.freeze(prepared.headers);Object.freeze(prepared);
  const fingerprint=await briefRequestFingerprint(prepared);
  if(input.signal?.aborted)return {state:'not_dispatched' as const};
  const reservation=await input.store.call('reserve',input.requestId,fingerprint);
  if(!reservation.created)return {state:reservation.state==='completed'?'completed_before' as const:'not_dispatched' as const};
  if(input.signal?.aborted){await input.store.call('cancel_before_dispatch',input.requestId,fingerprint);return {state:'not_dispatched' as const};}
  const dispatch=await input.store.call('dispatch',input.requestId,fingerprint);
  if(!dispatch.dispatch)return {state:'not_dispatched' as const};
  try{
    if(input.signal?.aborted)throw new Error('cancelled after dispatch');
    let onAbort:(()=>void)|undefined;
    const cancelled=new Promise<never>((_resolve,reject)=>{onAbort=()=>reject(new Error('cancelled after dispatch'));input.signal?.addEventListener('abort',onAbort,{once:true});if(input.signal?.aborted)onAbort();});
    let result:unknown;
    try{result=await Promise.race([input.send(prepared,input.signal),cancelled]);}finally{if(onAbort)input.signal?.removeEventListener('abort',onAbort);}
    if(input.signal?.aborted)throw new Error('cancelled after dispatch');
    const completed=await input.store.call('complete',input.requestId,fingerprint);
    if(completed.state!=='completed')throw new Error('completion unknown');
    return {state:'completed' as const,result};
  }catch{
    await input.store.call('unknown',input.requestId,fingerprint).catch(()=>{});
    return {state:'unknown' as const};
  }
}
