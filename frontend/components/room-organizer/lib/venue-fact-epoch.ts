'use client';
import {useCallback,useMemo,useSyncExternalStore} from 'react';
import type {layoutStore} from '../hooks/use-layout-store';
import {venueScaleBasis} from './venue-scale-basis';
import type {BriefMemory} from './brief-agent';
type Store=Pick<typeof layoutStore,'getState'|'subscribe'>;
export type VenueFactToken=Readonly<{generation:string;epoch:number}>;
let serial=0;
/** Each observation lifetime has a fresh generation; every changed basis increments synchronously. */
export function createVenueFactTracker(store:Store){
 const generation=`${Date.now().toString(36)}-${(++serial).toString(36)}-${Math.random().toString(36).slice(2)}`;
 let basis=venueScaleBasis(store.getState().layout),epoch=0,unsubscribe:(()=>void)|null=null,token:VenueFactToken|null=null;
 const listeners=new Set<()=>void>();
 const publish=()=>{token=unsubscribe?Object.freeze({generation,epoch}):null;for(const listener of listeners)listener();};
 const observe=()=>{const next=venueScaleBasis(store.getState().layout);if(next!==basis){basis=next;epoch++;publish();}};
 const start=()=>{if(unsubscribe)return;unsubscribe=store.subscribe(observe);observe();if(!token)publish();};
 const stop=()=>{if(!unsubscribe)return;unsubscribe();unsubscribe=null;epoch++;token=null;};
 const listen=(listener:()=>void)=>{listeners.add(listener);start();return()=>{listeners.delete(listener);if(!listeners.size)stop();};};
 const capture=()=>token;
 const isCurrent=(value:VenueFactToken|null|undefined)=>!!unsubscribe&&!!value&&value.generation===generation&&value.epoch===epoch&&basis===venueScaleBasis(store.getState().layout);
 /** Only call on a source event that is known to be relevant to this active scope. */
 const invalidateSource=()=>{if(!unsubscribe)return;epoch++;publish();};
 return {listen,capture,isCurrent,invalidateSource};
}
const trackers=new WeakMap<object,ReturnType<typeof createVenueFactTracker>>();
export function venueFactTrackerFor(store:Store){let tracker=trackers.get(store);if(!tracker){tracker=createVenueFactTracker(store);trackers.set(store,tracker);}return tracker;}
export function isVenueFactMemoryCurrent(memory:BriefMemory|null|undefined,store:Store):boolean{
 if(!memory)return true;
 if(memory.lengthM===null&&memory.widthM===null&&memory.areaM2===null)return true;
 return venueFactTrackerFor(store).isCurrent(memory.venueFactToken);
}
export function useVenueFactTracker(store:Store){
 const tracker=useMemo(()=>venueFactTrackerFor(store),[store]);
 const subscribe=useCallback((listener:()=>void)=>tracker.listen(listener),[tracker]);
 const token=useSyncExternalStore(subscribe,tracker.capture,()=>null);
 return {token,capture:tracker.capture,isCurrent:tracker.isCurrent,invalidateSource:tracker.invalidateSource};
}
