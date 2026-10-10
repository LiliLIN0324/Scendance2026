// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BackendSession, getBackendConfig } from '@/lib/backend-session';
import { RoomEditorProvider, SelectionProvider, useRoomEditor, useSelection, type RoomEditorContextValue } from '../contexts';
import { layoutStore, useActiveFloor, useActiveFloorIndex, useLayout } from '../hooks/use-layout-store';
import { makeLayout, makeViewSettings } from '../lib/__testfixtures__/fixtures';
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
const originalLayoutState = layoutStore.getState();

function PlacementConsumer() {
  const { actions } = useRoomEditor();
  const { selectOnly, selectedItemId } = useSelection();
  return <><OnlineModelLibrary onAdd={item => selectOnly(actions.addCatalogItem(item))}/><output aria-label="选中物料编号">{selectedItemId}</output></>;
}

function PlacementWorkspace({ hidden = false }: { hidden?: boolean }) {
  const layout = useLayout(), activeFloor = useActiveFloor(), activeFloorIndex = useActiveFloorIndex();
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [extraSelectedIds, setExtraSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const [view, setView] = useState(makeViewSettings());
  const [catalogQuery, setCatalogQuery] = useState('');
  const [gameMode, setGameMode] = useState<RoomEditorContextValue['gameMode']>('build');
  const [autoCycleLighting, setAutoCycleLighting] = useState(false);
  const editor: RoomEditorContextValue = { layout, activeFloor, activeFloorIndex, actions: layoutStore.getState().actions,
    view, setView, toggle: key => setView(current => ({ ...current, [key]: !current[key] })),
    collidingIds: new Set(), highlightedIds: new Set(), catalogQuery, setCatalogQuery,
    recentColors: [], pushColor: () => {}, playCue: () => {},
    history: { canUndo: false, canRedo: false, undo: () => {}, redo: () => {}, clear: () => {}, commitNow: () => {}, truncateTo: () => {} },
    isReady: true, error: null, gameMode, setGameMode, autoCycleLighting, setAutoCycleLighting };
  const allSelectedIds = new Set(extraSelectedIds); if (selectedItemId) allSelectedIds.add(selectedItemId);
  return <RoomEditorProvider value={editor}><SelectionProvider value={{ selectedItemId, setSelectedItemId,
    selectedItem: activeFloor.items.find(item => item.id === selectedItemId) ?? null,
    extraSelectedIds, setExtraSelectedIds, allSelectedIds, selectOnly: id => { setSelectedItemId(id); setExtraSelectedIds(new Set()); } }}>
    <div hidden={hidden}><PlacementConsumer/></div>
  </SelectionProvider></RoomEditorProvider>;
}

function setup({ disabled = false } = {}) {
  const onAdd = vi.fn();
  render(<OnlineModelLibrary disabled={disabled} onAdd={onAdd} />);
  return { onAdd };
}

const tiles = (): HTMLElement[] => screen.getAllByRole('button', { name: /^添加/ });

beforeEach(() => {
  layoutStore.setState({ layout: makeLayout({ id: 'rehearsal-activity-a' }), activeFloorIndex: 0 });
  vi.mocked(loadOnlineModels).mockResolvedValue(INDEX);
  vi.mocked(ensureGlbAsset).mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  layoutStore.setState(originalLayoutState);
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
  it('does not place a late download after local A → B → A in one act, without an intermediate React render', async () => {
    let release!: () => void;
    vi.mocked(ensureGlbAsset).mockImplementation(() => new Promise<void>(resolve => { release = resolve; }));
    render(<PlacementWorkspace/>);
    fireEvent.click(await screen.findByRole('button', { name: '添加Lounge Chaise' }));
    await waitFor(() => expect(ensureGlbAsset).toHaveBeenCalledOnce());
    const original = layoutStore.getState().layout;
    act(() => {
      layoutStore.getState().actions.applyLayout(makeLayout({ id: 'rehearsal-activity-b' }));
      layoutStore.getState().actions.applyLayout(original);
    });
    await act(async () => { release(); });
    expect(layoutStore.getState().layout.floors[0]!.items).toHaveLength(0);
    expect(screen.getByLabelText('选中物料编号').textContent).toBe('');
    expect(screen.getByRole('alert').textContent).toMatch(/变化.*重新添加/);
  });

  it('keeps a pending placement through ordinary filters and a hidden shelf, then adds and selects exactly once', async () => {
    let release!: () => void;
    vi.mocked(ensureGlbAsset).mockImplementation(() => new Promise<void>(resolve => { release = resolve; }));
    const page = render(<PlacementWorkspace/>);
    fireEvent.click(await screen.findByRole('button', { name: '添加Lounge Chaise' }));
    await waitFor(() => expect(ensureGlbAsset).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole('button', { name: /^舞台/ }));
    fireEvent.change(screen.getByLabelText('搜索全库线上模型'), { target: { value: 'hedge' } });
    page.rerender(<PlacementWorkspace hidden/>);
    page.rerender(<PlacementWorkspace/>);
    await act(async () => { release(); });
    const items = layoutStore.getState().layout.floors[0]!.items;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ type: 'glb-asset', name: CATALOGUE[0]!.name, source: 'public_library', glbUrl: CATALOGUE[0]!.glb });
    expect(screen.getByLabelText('选中物料编号').textContent).toBe(items[0]!.id);
    expect((screen.getByLabelText('搜索全库线上模型') as HTMLInputElement).value).toBe('hedge');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(ensureGlbAsset).toHaveBeenCalledOnce();
  });

  it('does not place or select after switching the floor away and back while the same layout object stays active', async () => {
    const layout = makeLayout({ id: 'rehearsal-activity-a', floors: [makeLayout().floors[0]!, { ...makeLayout().floors[0]!, id: 'upper' }] });
    layoutStore.setState({ layout, activeFloorIndex: 0 });
    let release!: () => void;
    vi.mocked(ensureGlbAsset).mockImplementation(() => new Promise<void>(resolve => { release = resolve; }));
    render(<PlacementWorkspace/>);
    fireEvent.click(await screen.findByRole('button', { name: '添加Lounge Chaise' }));
    await waitFor(() => expect(ensureGlbAsset).toHaveBeenCalledOnce());
    act(() => { layoutStore.getState().actions.setActiveFloorIndex(1); layoutStore.getState().actions.setActiveFloorIndex(0); });
    expect(layoutStore.getState().layout).toBe(layout);
    await act(async () => { release(); });
    expect(layoutStore.getState().layout.floors.every(floor => floor.items.length === 0)).toBe(true);
    expect(screen.getByLabelText('选中物料编号').textContent).toBe('');
    expect(screen.getByRole('alert').textContent).toMatch(/楼层.*变化/);
  });

  it('disposes the request guard on unmount and never places a completed abandoned download', async () => {
    let release!: () => void;
    vi.mocked(ensureGlbAsset).mockImplementation(() => new Promise<void>(resolve => { release = resolve; }));
    const guard = { assertCurrent: vi.fn(), dispose: vi.fn() }, onAdd = vi.fn();
    const page = render(<OnlineModelLibrary onAdd={onAdd} capturePlacement={() => guard}/>);
    fireEvent.click(await screen.findByRole('button', { name: '添加Lounge Chaise' }));
    await waitFor(() => expect(ensureGlbAsset).toHaveBeenCalledOnce());
    page.unmount();
    expect(guard.dispose).toHaveBeenCalledOnce();
    await act(async () => { release(); });
    expect(guard.assertCurrent).not.toHaveBeenCalled();
    expect(onAdd).not.toHaveBeenCalled();
    expect(guard.dispose).toHaveBeenCalledOnce();
  });

  it('rejects a controller switch back after rendered identity changes even when no root factory was supplied', async () => {
    const first = new BackendSession(getBackendConfig({ url: '', anonKey: '' }));
    const second = new BackendSession(getBackendConfig({ url: '', anonKey: '' }));
    let release!: () => void;
    vi.mocked(ensureGlbAsset).mockImplementation(() => new Promise<void>(resolve => { release = resolve; }));
    const onAdd = vi.fn(), page = render(<OnlineModelLibrary controller={first} onAdd={onAdd}/>);
    fireEvent.click(await screen.findByRole('button', { name: '添加Lounge Chaise' }));
    await waitFor(() => expect(ensureGlbAsset).toHaveBeenCalledOnce());
    page.rerender(<OnlineModelLibrary controller={second} onAdd={onAdd}/>);
    page.rerender(<OnlineModelLibrary controller={first} onAdd={onAdd}/>);
    await act(async () => { release(); });
    expect(onAdd).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toMatch(/变化.*重新添加/);
    first.dispose(); second.dispose();
  });

  it('uses the current placement callback and floor-full state when a download finishes', async () => {
    let release!: () => void;
    vi.mocked(ensureGlbAsset).mockImplementation(() => new Promise<void>(resolve => { release = resolve; }));
    const oldAdd = vi.fn(), newAdd = vi.fn();
    const page = render(<OnlineModelLibrary onAdd={oldAdd}/>);
    fireEvent.click(await screen.findByRole('button', { name: '添加Lounge Chaise' }));
    await waitFor(() => expect(ensureGlbAsset).toHaveBeenCalledOnce());
    page.rerender(<OnlineModelLibrary onAdd={newAdd}/>);
    await act(async () => { release(); });
    expect(oldAdd).not.toHaveBeenCalled();
    expect(newAdd).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: '添加Lounge Chaise' }));
    page.rerender(<OnlineModelLibrary onAdd={newAdd} disabled/>);
    await act(async () => { release(); });
    expect(newAdd).toHaveBeenCalledOnce();
    expect(screen.getByRole('alert').textContent).toContain('物料已满');
  });
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

  it('supports horizontal card browsing with a wheel and focused rail navigation, without adding', async () => {
    const { onAdd } = setup();
    await screen.findByRole('button', { name: '添加Lounge Chaise' });
    const rail = screen.getByRole('group', { name: '线上模型，横向浏览' });
    Object.defineProperties(rail, { scrollWidth: { value: 900 }, clientWidth: { value: 240 } });
    expect(fireEvent.wheel(rail, { deltaY: 100 })).toBe(false);
    expect(rail.scrollLeft).toBe(100);
    fireEvent.keyDown(rail, { key: 'ArrowRight' });
    expect(rail.scrollLeft).toBe(280);
    fireEvent.keyDown(rail, { key: 'Home' });
    expect(rail.scrollLeft).toBe(0);
    fireEvent.keyDown(screen.getByRole('button', { name: '添加Lounge Chaise' }), { key: 'ArrowRight' });
    expect(rail.scrollLeft).toBe(0);
    expect(onAdd).not.toHaveBeenCalled();
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

  it('quotes each tile’s real footprint and keeps file size and the full name on hover', async () => {
    setup();
    const tile = await screen.findByRole('button', { name: '添加Lounge Chaise' });
    expect(tile.textContent).toContain('0.5 × 0.6 × 0.9 m');
    expect(tile.textContent).not.toContain('2 KB');
    expect(tile.getAttribute('title')).toContain('Lounge Chaise (Airport Lounge) · 2 KB');
  });

  it('reports a failed preview while keeping the original model available to place', async () => {
    const { onAdd } = setup();
    const tile = await screen.findByRole('button', { name: '添加Lounge Chaise' });
    const thumbnail = tile.querySelector('img')!;
    expect(thumbnail.getAttribute('src')).toBe(CATALOGUE[0]!.thumb);
    fireEvent.error(thumbnail);
    expect(tile.textContent).toContain('预览未载入');
    expect(tile.querySelector('img')).toBeNull();
    expect(tile.draggable).toBe(true);
    fireEvent.click(tile);
    await waitFor(() => expect(onAdd).toHaveBeenCalledOnce());
    expect(onAdd.mock.calls[0]![0]).toMatchObject({ name: CATALOGUE[0]!.name, glbUrl: CATALOGUE[0]!.glb });
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
    const tile = await screen.findByRole('button', { name: '添加Lounge Chaise' });
    const rail = screen.getByRole('group', { name: '线上模型，横向浏览' });
    rail.scrollLeft = 420;
    fireEvent.click(tile);
    expect((await screen.findByRole('alert')).textContent).toContain('网络不可达');
    expect(rail.scrollLeft).toBe(0);
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
    fireEvent.change(screen.getByLabelText('搜索全库线上模型'), { target: { value: 'hedge' } });
    await waitFor(() => expect(tiles()).toHaveLength(1));
    expect(tiles()[0]!.getAttribute('aria-label')).toBe('添加Box Hedge');
    fireEvent.change(screen.getByLabelText('搜索全库线上模型'), { target: { value: 'zzz' } });
    expect(await screen.findByText(/没有匹配的线上模型/)).toBeTruthy();
  });

  it('searches across a previously chosen family, then a category click clears the query', async () => {
    setup();
    await screen.findByRole('button', { name: '添加Lounge Chaise' });
    fireEvent.click(screen.getByRole('button', { name: /^舞台/ }));
    fireEvent.change(screen.getByLabelText('搜索全库线上模型'), { target: { value: 'hedge' } });
    expect(await screen.findByRole('button', { name: '添加Box Hedge' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '添加Lighting Tower' })).toBeNull();
    expect(screen.getByRole('button', { name: /^舞台/ }).getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: /^座椅/ }));
    expect((screen.getByLabelText('搜索全库线上模型') as HTMLInputElement).value).toBe('');
    expect(await screen.findByRole('button', { name: '添加Lounge Chaise' })).toBeTruthy();
    expect(tiles()).toHaveLength(1);
    fireEvent.change(screen.getByLabelText('搜索全库线上模型'), { target: { value: 'tower' } });
    fireEvent.click(screen.getByRole('button', { name: /^全部/ }));
    expect((screen.getByLabelText('搜索全库线上模型') as HTMLInputElement).value).toBe('');
    expect(tiles()).toHaveLength(3);
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
