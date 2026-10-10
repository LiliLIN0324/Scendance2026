import { layoutStore } from '../hooks/use-layout-store';
import type { BackendSession, BackendSnapshot } from '@/lib/backend-session';

export interface CatalogPlacementGuard {
  assertCurrent(): void;
  dispose(): void;
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
