import {canonical} from '../../../../supabase/functions/_shared/domain';
import {venueScaleBasis} from './venue-scale-basis';
import type {RoomLayout} from './types';

type Store={getState():{layout:RoomLayout};subscribe(listener:()=>void):()=>void};
export type ReviewFactToken=Readonly<{generation:string;sequence:number}>;
let serial=0;
/** Relevant facts only; evidence/status edits do not themselves change the physical scene. */
function basis(layout:RoomLayout):string {
 return canonical({venue:venueScaleBasis(layout),productionPlan:layout.productionPlan??null,
  items:layout.floors.map(floor=>({id:floor.id,items:floor.items.map(({handoff:_handoff,...item})=>item)})),
  tasks:(layout.eventOperations?.tasks??[]).map(task=>({id:task.id,title:task.title,phase:task.phase,
    plannedStartAt:task.plannedStartAt,plannedEndAt:task.plannedEndAt,ownerName:task.ownerName,
    contractorName:task.contractorName,acceptance:task.acceptance,objectIds:task.objectIds}))});
}
/**
 * Isolated monotonic memory ledger: never carried by undo snapshots, never certifies source authority.
 * On stop/reload its generation is invalid. Not a cross-tab or durable ledger; production must fail closed.
 */
export function createReviewFactLedger(store:Store){
 const generation=`${Date.now().toString(36)}-${(++serial).toString(36)}-${Math.random().toString(36).slice(2)}`;
 let sequence=0,current=basis(store.getState().layout),active=true;
 const unsubscribe=store.subscribe(()=>{if(!active)return;const next=basis(store.getState().layout);if(next!==current){current=next;sequence++;}});
 return {
  capture():ReviewFactToken|null {return active?Object.freeze({generation,sequence}):null;},
  isCurrent(token:ReviewFactToken|null|undefined):boolean{return active&&!!token&&token.generation===generation&&token.sequence===sequence&&current===basis(store.getState().layout);},
  invalidateSource():void{if(active)sequence++;},
  stop():void{if(!active)return;active=false;unsubscribe();},
 };
}
