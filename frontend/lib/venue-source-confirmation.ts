import {localWriteCapabilityGuard,type LocalWriteCapability} from './local-write-lease';
import {readVenueSourceRevision,type VenueSourceRevision} from './venue-source-revision';
import {subscribeSourceScopeNotices} from './source-scope-notices';

/** Caller must supply a complete, cross-tab source observer; a notification channel alone is not a write lock. */
export interface VenueConfirmationContext {
 isSettled(scope:string):boolean;
 isCurrent(scope:string):boolean;
 subscribeInvalidation(listener:()=>void):()=>void;
}
/** Confirmation is fresh only while the actual ordinary write capability and observation stay valid. */
export function createVenueSourceConfirmation(capability:LocalWriteCapability,context:VenueConfirmationContext){
 const lease=localWriteCapabilityGuard(capability);lease.assertStillHeld();
 let epoch=0,closed=false;const listeners=new Set<()=>void>();
 const invalidate=()=>{epoch++;for(const listener of listeners)try{listener();}catch{/* one observer cannot suppress another */}};
 const off=context.subscribeInvalidation(invalidate);
 if(typeof off!=='function')throw new Error('场地资料监听不可用。');
 lease.signal.addEventListener('abort',invalidate);
 const current=(scope:string,version:number)=>{
  try{lease.assertStillHeld();return !lease.signal.aborted&&!closed&&epoch===version&&context.isCurrent(scope)&&context.isSettled(scope);}catch{return false;}
 };
 async function confirm(scope:string):Promise<VenueSourceRevision>{
  const version=epoch;if(!scope||!current(scope,version))return {status:'unknown'};
  const result=await readVenueSourceRevision(scope,{isSettled:()=>current(scope,version)});
  return result.status==='observed'&&result.scope===scope&&current(scope,version)?result:{status:'unknown'};
 }
 function guard(getConfirmed:(scope:string)=>VenueSourceRevision){return {
  getConfirmed,
  isSettled:(scope:string)=>current(scope,epoch),
  subscribeInvalidation(listener:()=>void){listeners.add(listener);return()=>{listeners.delete(listener);};},
 };}
 function dispose(){if(closed)return;closed=true;epoch++;lease.signal.removeEventListener('abort',invalidate);off();for(const listener of listeners)try{listener();}catch{/* notify the remaining observers */}listeners.clear();}
 return {confirm,guard,dispose};
}

/** The notices only invalidate; actual write exclusion and settled state must be supplied by the caller. */
export async function createObservedVenueSourceConfirmation(capability:LocalWriteCapability,scope:string,
 context:VenueConfirmationContext){
 let available=false,closed=false;const listeners=new Set<()=>void>();
 const invalidate=()=>{if(closed)return;for(const listener of listeners)try{listener();}catch{/* notify the remaining observers */}};
 const unsubscribe=await subscribeSourceScopeNotices(scope,notice=>{
  if(closed)return;available=notice.crossTabAvailable;invalidate();
 });
 let unsubscribeLocal:(()=>void)|undefined;
 try{
  unsubscribeLocal=context.subscribeInvalidation(invalidate);
  if(typeof unsubscribeLocal!=='function')throw new Error('本机资料状态监听不可用。');
  const service=createVenueSourceConfirmation(capability,{
   isCurrent:value=>value===scope&&context.isCurrent(value),
   isSettled:value=>available&&context.isSettled(value),
   subscribeInvalidation(listener){listeners.add(listener);return()=>{listeners.delete(listener);};},
  });
  return {confirm:service.confirm,guard:service.guard,dispose(){if(closed)return;closed=true;service.dispose();listeners.clear();unsubscribeLocal?.();unsubscribe();}};
 }catch(error){closed=true;unsubscribeLocal?.();unsubscribe();throw error;}
}
