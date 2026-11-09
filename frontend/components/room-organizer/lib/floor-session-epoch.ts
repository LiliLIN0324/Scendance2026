'use client';
import {useCallback,useMemo,useSyncExternalStore} from 'react';
import type {layoutStore} from '../hooks/use-layout-store';
import {activityScope} from './activity-session-epoch';

type Store=Pick<typeof layoutStore,'getState'|'subscribe'>;
export type FloorSessionToken=Readonly<{scope:string;floorIndex:number;floorId:string;epoch:number}>;
let nextEpoch=0;

/** Each store notification is observed synchronously, including same-batch A→B→A. */
export function createFloorSessionTracker(store:Store){
 let unsubscribe:(()=>void)|null=null,token:FloorSessionToken|null=null;
 let observed:{scope:string;floorIndex:number;floorId:string|null}|null=null;
 const listeners=new Set<()=>void>();
 function current(){
  const state=store.getState(),floorIndex=state.activeFloorIndex;
  const id=Number.isSafeInteger(floorIndex)&&floorIndex>=0?state.layout.floors[floorIndex]?.id:undefined;
  return {scope:activityScope(state.layout.id),floorIndex,floorId:typeof id==='string'&&id.trim()?id:null};
 }
 function update(force=false){
  const next=current();
  if(!force&&observed&&next.scope===observed.scope&&next.floorIndex===observed.floorIndex&&next.floorId===observed.floorId)return;
  observed=next;const epoch=++nextEpoch;
  token=unsubscribe&&next.floorId!==null?Object.freeze({scope:next.scope,floorIndex:next.floorIndex,floorId:next.floorId,epoch}):null;
  for(const listener of listeners)listener();
 }
 function start(){if(unsubscribe)return;unsubscribe=store.subscribe(()=>update());update(true);}
 function stop(){if(!unsubscribe)return;unsubscribe();unsubscribe=null;token=null;observed=null;++nextEpoch;}
 function capture(){return token;}
 function isCurrent(candidate:FloorSessionToken|null|undefined){
  if(!unsubscribe||!candidate||candidate!==token)return false;
  const next=current();return candidate.scope===next.scope&&candidate.floorIndex===next.floorIndex&&candidate.floorId===next.floorId;
 }
 function listen(listener:()=>void){listeners.add(listener);return()=>{listeners.delete(listener);};}
 return {start,stop,capture,isCurrent,listen};
}

const sharedTrackers=new WeakMap<Store,{tracker:ReturnType<typeof createFloorSessionTracker>;references:number}>();
function sharedTracker(store:Store){
 let entry=sharedTrackers.get(store);
 if(!entry){entry={tracker:createFloorSessionTracker(store),references:0};sharedTrackers.set(store,entry);}
 return entry;
}

/** No live subscription or valid token is created until React commits. */
export function useFloorSessionTracker(store:Store){
 const entry=useMemo(()=>sharedTracker(store),[store]),tracker=entry.tracker;
 const subscribe=useCallback((listener:()=>void)=>{
  const remove=tracker.listen(listener);entry.references++;if(entry.references===1)tracker.start();
  let removed=false;return()=>{if(removed)return;removed=true;remove();entry.references--;if(entry.references===0)tracker.stop();};
 },[entry,tracker]);
 const token=useSyncExternalStore(subscribe,tracker.capture,()=>null);
 return {token,capture:tracker.capture,isCurrent:tracker.isCurrent};
}
