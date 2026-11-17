import { useEffect, useSyncExternalStore } from 'react';
import { ensureRecoverableGlbAsset, publicAssetLocalUrl } from '@/lib/public-asset-recovery';
import { aholoAssetUrl, listAholoAssets } from '../lib/aholo-assets';
import { presetModelUrl } from '../lib/scene-presets';
import {
  ensureGlbAsset,
  getGlbAssetRevision,
  getGlbAssetState,
  glbAssetKey,
  holdVisibleGlbAssets,
  releaseHiddenGlbAssetLater,
  subscribeGlbAssets,
} from '../three/glb-assets';
import type { RoomLayout } from '../lib/types';

const serverRevision = () => 0;

function scheduleIdleLoad(run: () => void): number | ReturnType<typeof setTimeout> {
  if (typeof requestIdleCallback === 'function') {
    return requestIdleCallback(() => run(), { timeout: 2_000 });
  }
  return setTimeout(run, 0);
}

function cancelIdleLoad(id: number | ReturnType<typeof setTimeout>): void {
  if (typeof requestIdleCallback === 'function' && typeof id === 'number') {
    cancelIdleCallback(id);
    return;
  }
  clearTimeout(id as ReturnType<typeof setTimeout>);
}

/** Loading never changes the document. A late completion only refreshes objects still in the scene. */
export function useGlbAssets(layout: RoomLayout, activeFloorIndex = 0, showAllFloors = false): number {
  const revision = useSyncExternalStore(subscribeGlbAssets, getGlbAssetRevision, serverRevision);
  useEffect(() => {
    if (layout.scenePreset) {
      const url = presetModelUrl(layout.scenePreset);
      if (getGlbAssetState(url).status === 'idle') void ensureGlbAsset(url, url).catch(() => {});
    }
    // 落盘过的产物在图纸里只留资产号，本机地址由注册表换回，优先于图纸残留的旧链接。
    const stashed = new Map(listAholoAssets().map(asset => [asset.assetId, aholoAssetUrl(asset)]));
    const queueItem = (item: (typeof layout.floors)[number]['items'][number]) => {
      const key = glbAssetKey(item);
      const url = (item.assetId ? stashed.get(item.assetId) : undefined) ?? item.glbUrl;
      if (!key || (!url && !publicAssetLocalUrl(item.assetId)) || getGlbAssetState(key).status !== 'idle') return;
      void ensureRecoverableGlbAsset(key, item.assetId, url).catch(() => { /* Error remains in the queryable cache state. */ });
    };
    const floorCount = layout.floors.length;
    const visibleIndexes = new Set<number>();
    if (showAllFloors) layout.floors.forEach((_, index) => visibleIndexes.add(index));
    else if (floorCount > 0) visibleIndexes.add(Math.min(Math.max(activeFloorIndex, 0), floorCount - 1));
    const visibleItems = layout.floors.flatMap((floor, index) => (visibleIndexes.has(index) ? floor.items : []));
    const hiddenItems = layout.floors.flatMap((floor, index) => (visibleIndexes.has(index) ? [] : floor.items));
    visibleItems.forEach(queueItem);
    const visibleKeys = visibleItems.flatMap(item => {
      const key = glbAssetKey(item);
      return key ? [key] : [];
    });
    const visibleKeySet = new Set(visibleKeys);
    const releaseHold = holdVisibleGlbAssets(visibleKeys);
    let cancelled = false;
    let idleId: number | ReturnType<typeof setTimeout> | undefined;
    const pending = hiddenItems.slice();
    const pump = () => {
      if (cancelled) return;
      const item = pending.shift();
      if (!item) return;
      queueItem(item);
      const key = glbAssetKey(item);
      if (key && !visibleKeySet.has(key)) releaseHiddenGlbAssetLater(key);
      if (pending.length > 0) idleId = scheduleIdleLoad(pump);
    };
    if (pending.length > 0) idleId = scheduleIdleLoad(pump);
    return () => {
      cancelled = true;
      if (idleId !== undefined) cancelIdleLoad(idleId);
      releaseHold();
    };
  }, [layout.floors, layout.scenePreset, activeFloorIndex, showAllFloors, revision]);
  return revision;
}
