// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BackendSession, getBackendConfig } from '@/lib/backend-session';
import { CATALOG_DRAG_MIME } from '../lib/catalog-drag';
import { buildOnlineModelIndex, loadOnlineModels } from '../lib/online-models';
import { ensureGlbAsset } from '../three/glb-assets';
import { OnlineModelLibrary, onlineModelDisplayName } from './online-model-library';
import type { OnlineModel } from '../lib/online-models';

// Only the network boundary is stubbed: `createGlbCatalogItem` stays real so these
// specs pin the actual catalogue item the library hands to the scene. Vitest hoists
// `vi.mock` above the imports, so the factories still replace the real modules.
vi.mock('../three/glb-assets', async importOriginal => ({
  ...(await importOriginal<typeof import('../three/glb-assets')>()),
  ensureGlbAsset: vi.fn(),
}));
vi.mock('../lib/online-models', async importOriginal => ({
  ...(await importOriginal<typeof import('../lib/online-models')>()),
  loadOnlineModels: vi.fn(),
}));

function model(slug: string, name: string, bucket: string): OnlineModel {
  return {
    slug,
    name,
    bucket,
    subcategory: '测试',
    width: 0.5,
    depth: 0.6,
    height: 0.9,
    bytes: 2048,
    triangles: 120,
    downloads: 1,
    thumb: `https://cdn.3dassets.dev/${slug}/thumb.webp`,
    glb: `https://cdn.3dassets.dev/${slug}/model.glb`,
    page: `https://3dassets.dev/${slug}`,
  };
}

const CATALOGUE = [
  model('seating-chaise', 'Lounge Chaise (Airport Lounge)', 'seating'),
  model('stage-tower', 'Lighting Tower', 'stage'),
  model('plants-hedge', 'Box Hedge', 'plants'),
];
const INDEX = buildOnlineModelIndex(CATALOGUE);

function setup({ disabled = false } = {}) {
  const onAdd = vi.fn();
  render(<OnlineModelLibrary disabled={disabled} onAdd={onAdd} />);
  return { onAdd };
}

const tiles = (): HTMLElement[] => screen.getAllByRole('button', { name: /^添加/ });

beforeEach(() => {
  vi.mocked(loadOnlineModels).mockResolvedValue(INDEX);
  vi.mocked(ensureGlbAsset).mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.mocked(loadOnlineModels).mockReset();
  vi.mocked(ensureGlbAsset).mockReset();
});

describe('onlineModelDisplayName', () => {
  it('shows the subject without the trailing collection, and never a blank label', () => {
    expect(onlineModelDisplayName(model('a', 'Lounge Chaise (Airport Lounge)', 'seating'))).toBe('Lounge Chaise');
    expect(onlineModelDisplayName(model('b', 'Lighting Tower', 'stage'))).toBe('Lighting Tower');
    expect(onlineModelDisplayName(model('c', '(Only Parens)', 'decor'))).toBe('(Only Parens)');
  });
});

describe('OnlineModelLibrary', () => {
  it('starts a catalogue drag using a known model identity without placing it', async () => {
    const { onAdd } = setup();
    const tile = await screen.findByRole('button', { name: '添加Lounge Chaise' });
    const dataTransfer = { setData: vi.fn(), effectAllowed: '' };
    expect(tile.draggable).toBe(true);
    fireEvent.dragStart(tile, { dataTransfer });
    expect(dataTransfer.setData).toHaveBeenCalledWith(CATALOG_DRAG_MIME, 'online:seating-chaise');
    expect(onAdd).not.toHaveBeenCalled();
  });
  it('scrolls categories horizontally with a mouse wheel without changing the filter', async () => {
    await act(async () => { setup(); });
    const rail = screen.getByRole('group', { name: '线上模型分类' });
    Object.defineProperties(rail, { scrollWidth: { value: 900 }, clientWidth: { value: 240 } });
    expect(fireEvent.wheel(rail, { deltaY: 100 })).toBe(false);
    expect(rail.scrollLeft).toBe(100);
    expect(fireEvent.wheel(rail, { deltaY: -40 })).toBe(false);
    expect(rail.scrollLeft).toBe(60);
    expect(screen.getByRole('button', { name: /^全部/ }).getAttribute('aria-pressed')).toBe('true');
    expect(tiles()).toHaveLength(3);
  });

  it('leaves horizontal trackpad scrolling and browser zoom to the browser', async () => {
    await act(async () => { setup(); });
    const rail = screen.getByRole('group', { name: '线上模型分类' });
    Object.defineProperties(rail, { scrollWidth: { value: 900 }, clientWidth: { value: 240 } });
    expect(fireEvent.wheel(rail, { deltaX: 80, deltaY: 10 })).toBe(true);
    expect(fireEvent.wheel(rail, { deltaY: 100, ctrlKey: true })).toBe(true);
    expect(rail.scrollLeft).toBe(0);
  });

  it('normalizes line and page wheels and releases scrolling at either end', async () => {
    await act(async () => { setup(); });
    const rail = screen.getByRole('group', { name: '线上模型分类' });
    Object.defineProperties(rail, { scrollWidth: { value: 900 }, clientWidth: { value: 240 } });
    expect(fireEvent.wheel(rail, { deltaY: -100 })).toBe(true);
    fireEvent.wheel(rail, { deltaY: 3, deltaMode: 1 });
    expect(rail.scrollLeft).toBe(48);
    fireEvent.wheel(rail, { deltaY: 1, deltaMode: 2 });
    expect(rail.scrollLeft).toBe(288);
    fireEvent.wheel(rail, { deltaY: 1000 });
    expect(rail.scrollLeft).toBe(660);
    expect(fireEvent.wheel(rail, { deltaY: 100 })).toBe(true);
  });

  it('does not intercept the wheel when all categories fit', async () => {
    await act(async () => { setup(); });
    const rail = screen.getByRole('group', { name: '线上模型分类' });
    Object.defineProperties(rail, { scrollWidth: { value: 240 }, clientWidth: { value: 240 } });
    expect(fireEvent.wheel(rail, { deltaY: 100 })).toBe(true);
    expect(rail.scrollLeft).toBe(0);
  });

  it('authorizes a registered model for a signed-in user and passes its real ID into the scene', async () => {
    const assetId = '10000000-0000-4000-8000-000000000001';
    vi.mocked(loadOnlineModels).mockResolvedValue(buildOnlineModelIndex([{ ...CATALOGUE[0]!, assetId }]));
    const controller = new BackendSession(getBackendConfig({ url: '', anonKey: '' }));
    vi.spyOn(controller, 'getSnapshot').mockReturnValue({ ...controller.getSnapshot(), user: { id: 'member' } });
    const authorize = vi.spyOn(controller, 'authorizeAsset').mockResolvedValue({ id: assetId, name: 'Chair', url: 'https://storage.example/chair.glb?token=short' });
    const onAdd = vi.fn();
    render(<OnlineModelLibrary controller={controller} onAdd={onAdd} />);
    fireEvent.click(await screen.findByRole('button', { name: '添加Lounge Chaise' }));
    await waitFor(() => expect(onAdd).toHaveBeenCalledOnce());
    expect(authorize).toHaveBeenCalledWith(assetId);
    expect(ensureGlbAsset).toHaveBeenCalledWith(assetId, 'https://storage.example/chair.glb?token=short');
    expect(onAdd.mock.calls[0]![0]).toMatchObject({ assetId, materialId: 'asset', source: 'public_library' });
    controller.dispose();
  });
  it('reports the load, then lists the catalogue', async () => {
    setup();
    expect(screen.getByRole('status').textContent).toContain('正在载入');
    expect(await screen.findByRole('button', { name: '添加Lounge Chaise' })).toBeTruthy();
    expect(tiles()).toHaveLength(3);
  });

  it('quotes each tile’s real footprint and file size, and keeps the full name on hover', async () => {
    setup();
    const tile = await screen.findByRole('button', { name: '添加Lounge Chaise' });
    expect(tile.textContent).toContain('0.5 × 0.6 × 0.9 m');
    expect(tile.textContent).toContain('2 KB');
    expect(tile.getAttribute('title')).toBe('Lounge Chaise (Airport Lounge)');
  });

  it('downloads the GLB first, then places it as an online-library asset', async () => {
    const { onAdd } = setup();
    fireEvent.click(await screen.findByRole('button', { name: '添加Lounge Chaise' }));
    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1));
    expect(vi.mocked(ensureGlbAsset).mock.calls[0]).toEqual([
      'https://cdn.3dassets.dev/seating-chaise/model.glb',
      'https://cdn.3dassets.dev/seating-chaise/model.glb',
    ]);
    expect(onAdd.mock.calls[0]![0]).toMatchObject({
      type: 'glb-asset',
      name: 'Lounge Chaise (Airport Lounge)',
      glbUrl: 'https://cdn.3dassets.dev/seating-chaise/model.glb',
      source: 'public_library',
      width: 0.5,
      depth: 0.6,
      height: 0.9,
    });
  });

  it('says so when the download fails, and places nothing', async () => {
    vi.mocked(ensureGlbAsset).mockRejectedValue(new Error('网络不可达'));
    const { onAdd } = setup();
    fireEvent.click(await screen.findByRole('button', { name: '添加Lounge Chaise' }));
    expect((await screen.findByRole('alert')).textContent).toContain('网络不可达');
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('offers a retry when the catalogue itself will not load', async () => {
    vi.mocked(loadOnlineModels).mockRejectedValueOnce(new Error('索引损坏'));
    setup();
    expect((await screen.findByRole('alert')).textContent).toContain('索引损坏');
    fireEvent.click(screen.getByRole('button', { name: '重新载入' }));
    expect(await screen.findByRole('button', { name: '添加Lounge Chaise' })).toBeTruthy();
    expect(vi.mocked(loadOnlineModels)).toHaveBeenCalledTimes(2);
  });

  it('narrows the grid to the family whose chip was pressed', async () => {
    setup();
    await screen.findByRole('button', { name: '添加Lounge Chaise' });
    fireEvent.click(screen.getByRole('button', { name: /^舞台/ }));
    await waitFor(() => expect(tiles()).toHaveLength(1));
    expect(tiles()[0]!.getAttribute('aria-label')).toBe('添加Lighting Tower');
  });

  it('searches the catalogue as you type, and says when nothing matches', async () => {
    setup();
    await screen.findByRole('button', { name: '添加Lounge Chaise' });
    fireEvent.change(screen.getByLabelText('搜索线上模型'), { target: { value: 'hedge' } });
    await waitFor(() => expect(tiles()).toHaveLength(1));
    expect(tiles()[0]!.getAttribute('aria-label')).toBe('添加Box Hedge');
    fireEvent.change(screen.getByLabelText('搜索线上模型'), { target: { value: 'zzz' } });
    expect(await screen.findByText(/没有匹配的线上模型/)).toBeTruthy();
  });

  it('refuses to place anything while the active floor is full', async () => {
    const { onAdd } = setup({ disabled: true });
    const tile = await screen.findByRole('button', { name: '添加Lounge Chaise' });
    expect((tile as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(tile);
    expect(onAdd).not.toHaveBeenCalled();
    expect(vi.mocked(ensureGlbAsset)).not.toHaveBeenCalled();
  });

  it('reveals the catalogue in bounded steps instead of requesting every thumbnail at once', async () => {
    const many = Array.from({ length: 30 }, (_, index) => model(`bulk-${index}`, `Model ${index}`, 'seating'));
    vi.mocked(loadOnlineModels).mockResolvedValue(buildOnlineModelIndex(many));
    setup();
    await screen.findByRole('button', { name: '添加Model 0' });
    expect(tiles()).toHaveLength(24);
    fireEvent.click(screen.getByRole('button', { name: /^再显示/ }));
    await waitFor(() => expect(tiles()).toHaveLength(30));
  });
});
