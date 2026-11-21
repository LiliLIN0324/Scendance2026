// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import catalogue from '../../../../assets/library/merged.json';
import { BackendSession, getBackendConfig } from '@/lib/backend-session';
import { MemoryStorage } from '@/lib/test-support-memory-storage';
import { normalizeOnlineModels, buildOnlineModelIndex, loadOnlineModels } from '../lib/online-models';
import { ensureGlbAsset } from '../three/glb-assets';
import { OnlineModelLibrary } from './online-model-library';

vi.mock('../three/glb-assets', async importOriginal => ({
  ...(await importOriginal<typeof import('../three/glb-assets')>()),
  ensureGlbAsset: vi.fn(),
}));
vi.mock('../lib/online-models', async importOriginal => ({
  ...(await importOriginal<typeof import('../lib/online-models')>()),
  loadOnlineModels: vi.fn(),
}));

let mem: MemoryStorage;
beforeEach(() => {
  mem = new MemoryStorage();
  vi.stubGlobal('Storage', MemoryStorage);
  vi.stubGlobal('localStorage', mem);
  window.localStorage = mem;
});
afterEach(() => { cleanup(); mem?.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('clicking the reported floodlight arms placement even when cloud authorization would return ASSET_NOT_FOUND', async () => {
  const lamp = normalizeOnlineModels(catalogue).find(model => model.name === '四头泛光照明灯杆')!;
  vi.mocked(loadOnlineModels).mockResolvedValue(buildOnlineModelIndex([lamp]));
  vi.mocked(ensureGlbAsset).mockResolvedValue(undefined);
  const controller = new BackendSession(getBackendConfig({ url: '', anonKey: '' }));
  vi.spyOn(controller, 'getSnapshot').mockReturnValue({ ...controller.getSnapshot(), user: { id: 'member' } });
  const authorize = vi.spyOn(controller, 'authorizeAsset').mockRejectedValue(new Error('ASSET_NOT_FOUND'));
  const onArm = vi.fn(), onAdd = vi.fn();
  try {
    render(<OnlineModelLibrary controller={controller} onAdd={onAdd} onArmCatalogItem={onArm}/>);
    fireEvent.click(await screen.findByRole('button', { name: '添加四头泛光照明灯杆' }));
    await waitFor(() => expect(onArm).toHaveBeenCalledOnce());
    expect(onArm.mock.calls[0]![0]).toMatchObject({ name: lamp.name, assetId: lamp.assetId, glbUrl: lamp.glb });
    expect(ensureGlbAsset).toHaveBeenCalledWith(lamp.assetId, lamp.glb);
    expect(authorize).not.toHaveBeenCalled();
    expect(onAdd).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).toBeNull();
  } finally { controller.dispose(); }
});
