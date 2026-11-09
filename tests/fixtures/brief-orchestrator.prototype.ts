import {prototypeBriefFingerprint} from './brief-request-fingerprint.prototype.ts';

/** Local experiment; no production caller, pricing guarantee or provider integration. */
export async function runPrototypeBrief(input:{requestId:string;prepared:{url:string;body:string;accountRef:string;credentialVersion:string;headers:Record<string,string>};
  store:{call(action:'reserve'|'dispatch'|'complete'|'unknown'|'cancel_before_dispatch',id:string,fingerprint:string):Promise<{state:string;created:boolean;dispatch:boolean}>};
  send(prepared:{url:string;body:string;accountRef:string;credentialVersion:string;headers:Record<string,string>},signal?:AbortSignal):Promise<unknown>;signal?:AbortSignal}) {
  const prepared=structuredClone(input.prepared);Object.freeze(prepared.headers);Object.freeze(prepared);
  const fingerprint=await prototypeBriefFingerprint(prepared);
  if(input.signal?.aborted)return {state:'not_dispatched' as const};
  const reservation=await input.store.call('reserve',input.requestId,fingerprint);
  if(!reservation.created)return {state:reservation.state==='completed'?'completed_before' as const:'not_dispatched' as const};
  if(input.signal?.aborted){await input.store.call('cancel_before_dispatch',input.requestId,fingerprint);return {state:'not_dispatched' as const};}
  const dispatch=await input.store.call('dispatch',input.requestId,fingerprint);
  if(!dispatch.dispatch)return {state:'not_dispatched' as const};
  try {
    if(input.signal?.aborted)throw new Error('cancelled after dispatch');
    let onAbort:(()=>void)|undefined;
    const cancelled=new Promise<never>((_resolve,reject)=>{onAbort=()=>reject(new Error('cancelled after dispatch'));input.signal?.addEventListener('abort',onAbort,{once:true});if(input.signal?.aborted)onAbort();});
    let result:unknown;
    try{result=await Promise.race([input.send(prepared,input.signal),cancelled]);}
    finally{if(onAbort)input.signal?.removeEventListener('abort',onAbort);}
    if(input.signal?.aborted)throw new Error('cancelled after dispatch');
    const completed=await input.store.call('complete',input.requestId,fingerprint);
    if(completed.state!=='completed')throw new Error('completion unknown');
    return {state:'completed' as const,result};
  } catch {
    // A provider call may have billed even if the local request was aborted.
    // If this update fails, 'dispatched' remains a conservative no-retry fence.
    await input.store.call('unknown',input.requestId,fingerprint).catch(()=>{});
    return {state:'unknown' as const};
  }
}
