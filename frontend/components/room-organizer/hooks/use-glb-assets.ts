import { useEffect, useSyncExternalStore } from 'react';
import { ensureRecoverableGlbAsset, publicAssetLocalUrl } from '@/lib/public-asset-recovery';
import { presetModelUrl } from '../lib/scene-presets';
import { ensureGlbAsset, getGlbAssetRevision, getGlbAssetState, glbAssetKey, subscribeGlbAssets } from '../three/glb-assets';
import type { RoomLayout } from '../lib/types';

const serverRevision = () => 0;
/** Loading never changes the document. A late completion only refreshes objects still in the scene. */
export function useGlbAssets(layout: RoomLayout): number {
  const revision = useSyncExternalStore(subscribeGlbAssets, getGlbAssetRevision, serverRevision);
  useEffect(() => {
    if (layout.scenePreset) {
      const url = presetModelUrl(layout.scenePreset);
      if (getGlbAssetState(url).status === 'idle') void ensureGlbAsset(url, url).catch(() => {});
    }
    for (const floor of layout.floors) for (const item of floor.items) {
      const key = glbAssetKey(item);
      if (key && (item.glbUrl || publicAssetLocalUrl(item.assetId)) && getGlbAssetState(key).status === 'idle') {
        void ensureRecoverableGlbAsset(key, item.assetId, item.glbUrl).catch(() => { /* Error remains in the queryable cache state. */ });
      }
    }
  }, [layout.floors, layout.scenePreset, revision]);
  return revision;
}
