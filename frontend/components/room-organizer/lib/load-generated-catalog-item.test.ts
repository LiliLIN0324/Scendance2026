// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryStorage } from '@/lib/test-support-memory-storage';
import * as glbAssets from '../three/glb-assets';
import { loadGeneratedCatalogItem, loadStoredAholoCatalogItem } from './aholo-model-placement';

const ASSET_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

let mem: MemoryStorage;
describe('云端生成物落位', () => {
  beforeEach(() => {
    mem = new MemoryStorage();
    vi.stubGlobal('Storage', MemoryStorage);
    vi.stubGlobal('localStorage', mem);
    window.localStorage = mem;
  });
  afterEach(() => {
    mem?.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('本机没有这份 GLB 时，向账户授权一次再摆，不另开生成', async () => {
    const authorize = vi.fn().mockResolvedValue({
      id: ASSET_ID, url: 'https://cdn.example.test/chair.glb', name: '户外折叠椅 1',
    });
    vi.spyOn(glbAssets, 'ensureGlbAsset').mockResolvedValue(undefined);
    vi.spyOn(glbAssets, 'getGlbAssetState').mockReturnValue({
      status: 'ready', dimensions: { width: 0.5, depth: 0.5, height: 0.88 },
    });
    await expect(loadStoredAholoCatalogItem(ASSET_ID)).rejects.toThrow('本机已经没有这个模型');
    const item = await loadGeneratedCatalogItem(ASSET_ID, authorize);
    expect(authorize).toHaveBeenCalledTimes(1);
    expect(authorize).toHaveBeenCalledWith(ASSET_ID);
    expect(item).toMatchObject({
      assetId: ASSET_ID, name: '户外折叠椅 1', source: 'generated',
      glbUrl: 'https://cdn.example.test/chair.glb', width: 0.5, depth: 0.5, height: 0.88,
    });
  });
});
