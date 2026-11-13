'use client';
import {useCallback,useMemo,useSyncExternalStore} from 'react';
import type { layoutStore } from '../hooks/use-layout-store';

type Store=Pick<typeof layoutStore,'getState'|'subscribe'>;
export type ActivitySessionToken=Readonly<{scope:string;epoch:number}>;
export function activityScope(id:string|undefined):string{return id?`activity:${id}`:'draft:unidentified';}

/**
 * 可注入的 scope 身份源（M3a）。默认从 layoutStore 影子派生；地图侧可换为
 * projectId 身份源，会话不再绑定室内 `layout.id`。source 缺省即旧行为。
 */
export interface ActivityScopeSource {
  getScope(): string;
  subscribe(listener: () => void): () => void;
}

function storeScopeSource(store: Store): ActivityScopeSource {
  return {
    getScope: () => activityScope(store.getState().layout.id),
    subscribe: (listener) => store.subscribe(listener),
  };
}

/** Subscribe synchronously before issuing tokens; stopped trackers always reject old tokens. */
export function createActivitySessionTracker(store:Store, source?:ActivityScopeSource){
 const scopeSrc=source??storeScopeSource(store);
 let scope=scopeSrc.getScope(),epoch=0,unsubscribe:(()=>void)|null=null;
 let token:ActivitySessionToken|null=null;
 const listeners=new Set<()=>void>();
 const publish=()=>{token=unsubscribe?Object.freeze({scope,epoch}):null;for(const listener of listeners)listener();};
 const observe=(next:string)=>{if(next!==scope){scope=next;epoch++;publish();}};
 const start=()=>{
  if(unsubscribe)return;
  unsubscribe=scopeSrc.subscribe(()=>observe(scopeSrc.getScope()));
  observe(scopeSrc.getScope());
  if(!token)publish();
 };
 const stop=()=>{if(!unsubscribe)return;unsubscribe();unsubscribe=null;epoch++;token=null;};
 const capture=():ActivitySessionToken|null=>token;
 const isCurrent=(token:ActivitySessionToken|null|undefined):boolean=>!!unsubscribe&&!!token&&token.scope===scope&&token.epoch===epoch&&scope===scopeSrc.getScope();
 const listen=(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener);};};
 return {start,stop,capture,isCurrent,listen};
}

/** React subscribes after commit; no tokens or store subscriptions are created during render. */
export function useActivitySessionTracker(store:Store, source?:ActivityScopeSource){
 const tracker=useMemo(()=>createActivitySessionTracker(store,source),[store,source]);
 const subscribe=useCallback((listener:()=>void)=>{const unlisten=tracker.listen(listener);tracker.start();return()=>{unlisten();tracker.stop();};},[tracker]);
 const token=useSyncExternalStore(subscribe,tracker.capture,()=>null);
 return {token,isCurrent:tracker.isCurrent};
}
