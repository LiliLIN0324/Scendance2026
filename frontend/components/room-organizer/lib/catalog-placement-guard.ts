import { layoutStore } from '../hooks/use-layout-store';
import { sameRecoveryFormValue } from '@/lib/recovery-form-value';
import type { BackendSession, BackendSnapshot } from '@/lib/backend-session';

export interface CatalogPlacementGuard {
  assertCurrent(): void;
  dispose(): void;
}

export type CatalogPlacementResult = {status:'placed';id:string}|{status:'pending'}|{status:'failed';message?:string};
export interface CatalogPlacementBatchGuard extends CatalogPlacementGuard {
  /** Only a verified, synchronous single-object insertion can advance the batch baseline. */
  runOwnMutation(action:()=>CatalogPlacementResult|void):CatalogPlacementResult|void;
}

function sameIdentity(left: BackendSnapshot | undefined, right: BackendSnapshot | undefined): boolean {
  return left?.user?.id === right?.user?.id && left?.project?.id === right?.project?.id &&
    left?.sessionId === right?.sessionId && left?.lease?.projectId === right?.lease?.projectId &&
    left?.lease?.sessionId === right?.lease?.sessionId && left?.lease?.generation === right?.lease?.generation;
}

/** Downloads belong to the layout and editor identity that started them, even after a switch back. */
export function captureCatalogPlacement(controller?: BackendSession, getIdentityEpoch?: () => number): CatalogPlacementGuard {
  const { layout, activeFloorIndex } = layoutStore.getState();
  const floorId = layout.floors[activeFloorIndex]?.id;
  const identity = controller?.getSnapshot(), apiUrl = controller?.config.apiUrl;
  const epoch = getIdentityEpoch?.();
  let invalid = false, disposed = false;
  const matches = () => {
    const current = layoutStore.getState();
    return current.layout === layout && current.activeFloorIndex === activeFloorIndex &&
      current.layout.floors[current.activeFloorIndex]?.id === floorId &&
      sameIdentity(identity, controller?.getSnapshot()) && controller?.config.apiUrl === apiUrl &&
      getIdentityEpoch?.() === epoch;
  };
  // Subscribe synchronously: batched A → B → A must not be rescued by the final React render.
  const observe = () => { if (!matches()) invalid = true; };
  const stopLayout = layoutStore.subscribe(observe), stopSession = controller?.subscribe(observe);
  return {
    assertCurrent() {
      observe();
      if (invalid || disposed) throw new Error('场景、楼层或登录状态已变化，请重新添加模型。');
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      stopLayout();
      stopSession?.();
    },
  };
}

/** A serial batch survives only its own verified insertions, never unrelated edits or an ABA scope change. */
export function captureCatalogPlacementBatch(controller?:BackendSession,getIdentityEpoch?:()=>number):CatalogPlacementBatchGuard {
  const initial=layoutStore.getState(), activityId=initial.layout.id, floorIndex=initial.activeFloorIndex;
  const floorId=initial.layout.floors[floorIndex]?.id,identity=controller?.getSnapshot(),apiUrl=controller?.config.apiUrl,epoch=getIdentityEpoch?.();
  let baseline=initial.layout,invalid=false,disposed=false,inOwnMutation=false;
  const observe=()=>{
    const current=layoutStore.getState();
    if(current.layout.id!==activityId||current.activeFloorIndex!==floorIndex||current.layout.floors[floorIndex]?.id!==floorId||
      !sameIdentity(identity,controller?.getSnapshot())||controller?.config.apiUrl!==apiUrl||getIdentityEpoch?.()!==epoch)invalid=true;
    if(!inOwnMutation&&current.layout!==baseline)invalid=true;
  };
  const stopLayout=layoutStore.subscribe(observe),stopSession=controller?.subscribe(observe);
  const assertCurrent=()=>{observe();if(invalid||disposed)throw new Error('场景、楼层或登录状态已变化，剩余物料未添加。');};
  const dispose=()=>{if(disposed)return;disposed=true;stopLayout();stopSession?.();};
  const runOwnMutation=(action:()=>CatalogPlacementResult|void)=>{
    assertCurrent();const before=baseline;inOwnMutation=true;
    let outcome:CatalogPlacementResult|void;
    try{outcome=action();}
    catch(error){
      if(layoutStore.getState().layout!==before){invalid=true;throw new Error('本次放置结果尚未确认，请查看画布；剩余物料未添加。');}
      throw error;
    }finally{inOwnMutation=false;}
    const current=layoutStore.getState(),after=current.layout;
    // Verify the callback really inserted only its reported object; never rebase over an unrelated edit.
    if(after!==before){
      if(!outcome||outcome.status!=='placed'||!outcome.id){invalid=true;}
      else {
        const id=outcome.id;
        if(before.floors.some(f=>f.items.some(item=>item.id===id)))invalid=true;
        let removed=0;
        const stripped={...after,floors:after.floors.map(f=>({...f,items:f.items.filter(item=>{
          if(item.id!==id)return true;removed++;return false;
        })}))};
        if(removed!==1||!sameRecoveryFormValue(before,stripped))invalid=true;
      }
    }else if(outcome?.status==='placed')invalid=true;
    if(!invalid)baseline=after;
    try{assertCurrent();}catch{throw new Error('放置后的场景变化无法核对，请查看画布；剩余物料未添加。');}
    return outcome;
  };
  return {assertCurrent,dispose,runOwnMutation};
}
