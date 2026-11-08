'use client';
import {useCallback,useMemo,useSyncExternalStore} from 'react';
import type { layoutStore } from '../hooks/use-layout-store';

type Store=Pick<typeof layoutStore,'getState'|'subscribe'>;
export type ActivitySessionToken=Readonly<{scope:string;epoch:number}>;
export function activityScope(id:string|undefined):string{return id?`activity:${id}`:'draft:unidentified';}

/** Subscribe synchronously before issuing tokens; stopped trackers always reject old tokens. */
export function createActivitySessionTracker(store:Store){
 let scope=activityScope(store.getState().layout.id),epoch=0,unsubscribe:(()=>void)|null=null;
 let token:ActivitySessionToken|null=null;
 const listeners=new Set<()=>void>();
 const publish=()=>{token=unsubscribe?Object.freeze({scope,epoch}):null;for(const listener of listeners)listener();};
 const observe=(next:string)=>{if(next!==scope){scope=next;epoch++;publish();}};
 const start=()=>{
  if(unsubscribe)return;
  unsubscribe=store.subscribe(state=>observe(activityScope(state.layout.id)));
  observe(activityScope(store.getState().layout.id));
  if(!token)publish();
 };
 const stop=()=>{if(!unsubscribe)return;unsubscribe();unsubscribe=null;epoch++;token=null;};
 const capture=():ActivitySessionToken|null=>token;
 const isCurrent=(token:ActivitySessionToken|null|undefined):boolean=>!!unsubscribe&&!!token&&token.scope===scope&&token.epoch===epoch&&scope===activityScope(store.getState().layout.id);
 const listen=(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener);};};
 return {start,stop,capture,isCurrent,listen};
}

/** React subscribes after commit; no tokens or store subscriptions are created during render. */
export function useActivitySessionTracker(store:Store){
 const tracker=useMemo(()=>createActivitySessionTracker(store),[store]);
 const subscribe=useCallback((listener:()=>void)=>{const unlisten=tracker.listen(listener);tracker.start();return()=>{unlisten();tracker.stop();};},[tracker]);
 const token=useSyncExternalStore(subscribe,tracker.capture,()=>null);
 return {token,isCurrent:tracker.isCurrent};
}
