import type { VenuePhoto } from './venue-photos-panel';

/** In-memory only: retained across editor unmounts within this page, never marked as persisted. */
export interface UnsavedSourceDraft { scope: string; image: VenuePhoto; ready: boolean }
const drafts = new Map<string, UnsavedSourceDraft>();
const listeners = new Set<() => void>();
let warningInstalled = false;
const keyOf = (scope:string,id:string) => JSON.stringify([scope,id]);
function warnBeforeUnload(event: BeforeUnloadEvent): void { if (drafts.size) { event.preventDefault(); event.returnValue = ''; } }
function changed():void {
  if(typeof window!=='undefined'){
    if(drafts.size&&!warningInstalled){window.addEventListener('beforeunload',warnBeforeUnload);warningInstalled=true;}
    if(!drafts.size&&warningInstalled){window.removeEventListener('beforeunload',warnBeforeUnload);warningInstalled=false;}
  }
  for(const listener of listeners)listener();
}
export function rememberUnsavedSource(scope:string,image:VenuePhoto,ready:boolean):void {
  drafts.set(keyOf(scope,image.id),{scope,image,ready});changed();
}
/** An older successful save cannot erase a newer edit of the same image. */
export function markSourceDraftSaved(scope:string,image:VenuePhoto):void {
  if(drafts.get(keyOf(scope,image.id))?.image!==image)return;
  drafts.delete(keyOf(scope,image.id));changed();
}
export function removeSourceDraft(scope:string,id:string):void {if(drafts.delete(keyOf(scope,id)))changed();}
export function unsavedSourceDrafts(scope?:string):UnsavedSourceDraft[] {return [...drafts.values()].filter(item=>scope===undefined||item.scope===scope);}
export function subscribeUnsavedSourceDrafts(listener:()=>void):()=>void {listeners.add(listener);return ()=>{listeners.delete(listener);};}
/** Test isolation only; production discards an individual file through explicit removal. */
export function clearUnsavedSourceDraftsForTests():void {drafts.clear();changed();}
