import { existsSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import catalogue from '../../../../assets/library/merged.json';
import { BackendSession, getBackendConfig } from '@/lib/backend-session';
import { publicAssetLocalUrl } from '@/lib/public-asset-recovery';
import { ensureGlbAsset } from '../three/glb-assets';
import { normalizeOnlineModels } from './online-models';
import { loadOnlineCatalogItem } from './online-model-placement';

vi.mock('../three/glb-assets', async importOriginal => ({
  ...(await importOriginal<typeof import('../three/glb-assets')>()),
  ensureGlbAsset: vi.fn(),
}));

const models = normalizeOnlineModels(catalogue);
const lamp = models.find(model => model.name === '四头泛光照明灯杆')!;

function signedInSession() {
  const controller = new BackendSession(getBackendConfig({ url: '', anonKey: '' }));
  vi.spyOn(controller, 'getSnapshot').mockReturnValue({ ...controller.getSnapshot(), user: { id: 'member' } });
  const authorize = vi.spyOn(controller, 'authorizeAsset').mockRejectedValue(new Error('ASSET_NOT_FOUND'));
  return { controller, authorize };
}

beforeEach(() => { vi.mocked(ensureGlbAsset).mockReset(); });

describe('public catalogue placement', () => {
  it('loads every shipped catalogue entry while signed in without depending on cloud registration', async () => {
    const { controller, authorize } = signedInSession();
    try {
      expect(models.length).toBeGreaterThan(500);
      expect(lamp.assetId).toBeTruthy();
      for (const model of models) {
        const url = publicAssetLocalUrl(model.assetId) ?? model.glb;
        if (url.startsWith('/showcase/')) {
          expect(existsSync(new URL(`../../../../${url.slice('/showcase/'.length)}`, import.meta.url)), model.slug).toBe(true);
        }
        const item = await loadOnlineCatalogItem(model, controller);
        expect(item, model.slug).toMatchObject({ name: model.name, glbUrl: url, source: 'public_library' });
        expect(item.assetId, model.slug).toBe(model.assetId);
        expect(ensureGlbAsset).toHaveBeenLastCalledWith(model.assetId ?? model.glb, url);
      }
      expect(authorize).not.toHaveBeenCalled();
    } finally { controller.dispose(); }
  });

  it('still requires authorization for IDs outside the shipped public registry', async () => {
    const { controller, authorize } = signedInSession();
    try {
      const privateModel = { ...lamp, assetId: '10000000-0000-4000-8000-000000000001' };
      await expect(loadOnlineCatalogItem(privateModel, controller)).rejects.toThrow('ASSET_NOT_FOUND');
      expect(authorize).toHaveBeenCalledWith(privateModel.assetId);
      expect(ensureGlbAsset).not.toHaveBeenCalled();
    } finally { controller.dispose(); }
  });

  it('does not arm a public model when its actual file fails to load', async () => {
    vi.mocked(ensureGlbAsset).mockRejectedValueOnce(new Error('模型下载失败（HTTP 404）。'));
    await expect(loadOnlineCatalogItem(lamp)).rejects.toThrow('HTTP 404');
  });

  it('rejects a late completion after the active project changes', async () => {
    const { controller } = signedInSession();
    try {
      const snapshot = controller.getSnapshot();
      vi.mocked(ensureGlbAsset).mockImplementationOnce(async () => {
        vi.mocked(controller.getSnapshot).mockReturnValue({ ...snapshot, user: { id: 'other-member' } });
      });
      await expect(loadOnlineCatalogItem(lamp, controller)).rejects.toThrow('项目或登录状态已变化');
    } finally { controller.dispose(); }
  });
});
