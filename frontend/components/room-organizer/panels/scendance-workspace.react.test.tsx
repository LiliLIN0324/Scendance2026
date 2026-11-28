// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createRef, type ComponentProps, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryStorage } from '@/lib/test-support-memory-storage';
import { RoomEditorProvider, type RoomEditorContextValue } from '../contexts/room-editor-context';
import { SelectionProvider, type SelectionContextValue } from '../contexts/selection-context';
import { layoutStore } from '../hooks/use-layout-store';
import { makeItem, makeLayout, makeViewSettings } from '../lib/__testfixtures__/fixtures';
import { rememberAholoAsset } from '../lib/aholo-assets';
import { loadStoredAholoCatalogItem } from '../lib/aholo-model-placement';
import { EDITOR_ITEM_LIMIT } from '../lib/item-limits';
import { buildOnlineModelIndex, loadOnlineModels } from '../lib/online-models';
import { ensureGlbAsset } from '../three/glb-assets';
import { MaterialDrawerHandle, ScendanceLibrary, ScendanceViewTools } from './scendance-workspace';
import type { SitePlanData } from '../../../../supabase/functions/_shared/site-plan';
import type { OnlineModel } from '../lib/online-models';
import type { CatalogItem, FurnitureItem } from '../lib/types';
import type { ViewSettings } from '../lib/types';

// The shelf keeps its real browser component; only catalogue/GLB network loads
// are stubbed, so losing a mounted filter, reveal window or download is visible.
vi.mock('../lib/online-models', async importOriginal => ({
  ...(await importOriginal<typeof import('../lib/online-models')>()),
  loadOnlineModels: vi.fn(),
}));
vi.mock('../lib/aholo-model-placement', () => ({ loadStoredAholoCatalogItem: vi.fn() }));
vi.mock('../three/glb-assets', async importOriginal => ({
  ...(await importOriginal<typeof import('../three/glb-assets')>()),
  ensureGlbAsset: vi.fn(),
}));
// jsdom 里没有真实 canvas/图片解码，自绘贴地底图必然拿不到瓦片；这里固定成「拿不到」，
// 让贴地逻辑走它本来就有的高德兜底分支（自绘本身的投影/拼图在 plan-ground-capture.test.ts 里测）。
vi.mock('../lib/plan-ground-capture', async importOriginal => ({
  ...(await importOriginal<typeof import('../lib/plan-ground-capture')>()),
  capturePlanGround: vi.fn().mockResolvedValue(null),
}));

const MODELS: OnlineModel[] = Array.from({ length: 30 }, (_, index) => ({
  slug: `rehearsal-${index}`, name: `Rehearsal Model ${index}`, bucket: 'seating',
  subcategory: '演练', width: 0.5, depth: 0.6, height: 0.9,
  bytes: 1024, triangles: 120, downloads: 1,
  thumb: `https://cdn.3dassets.dev/rehearsal-${index}/thumb.webp`,
  glb: `https://cdn.3dassets.dev/rehearsal-${index}/model.glb`,
  page: `https://3dassets.dev/rehearsal-${index}`,
}));

const GENERATED_ID = '4165e104-e2c1-4f5e-b2a4-46602bf9f932';
const GENERATED: CatalogItem = {
  type: 'glb-asset', name: '一张白色圆桌', width: 1.2, depth: 1.2, height: 0.75,
  color: '#ffffff', icon: '◇', price: 0, category: 'decor', source: 'generated',
  materialId: 'asset', assetId: GENERATED_ID, glbUrl: `http://127.0.0.1:3199/asset/${GENERATED_ID}.glb`,
};

let mem: MemoryStorage;
beforeEach(() => {
  mem = new MemoryStorage();
  vi.stubGlobal('Storage', MemoryStorage);
  vi.stubGlobal('localStorage', mem);
  window.localStorage = mem;
  vi.mocked(loadOnlineModels).mockResolvedValue(buildOnlineModelIndex(MODELS));
  vi.mocked(ensureGlbAsset).mockResolvedValue(undefined);
});afterEach(() => { cleanup(); mem?.clear(); vi.resetAllMocks(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function contexts(layout = makeLayout(), view = makeViewSettings(), plan: SitePlanData | null = null) {
  const selectOnly = vi.fn();
  const actions = { applyLayout: vi.fn(), replaceItems: vi.fn() };
  const history = { canUndo: true, canRedo: true, undo: vi.fn(), redo: vi.fn() };
  const setView = vi.fn(), toggle = vi.fn();
  const editor = { layout, activeFloor: layout.floors[0]!, activeFloorIndex: 0,
    view, actions, history, setView, toggle, outdoorPlan: plan } as unknown as RoomEditorContextValue;
  const selection = { selectedItemId: null, selectedItem: null,
    allSelectedIds: new Set<string>(), extraSelectedIds: new Set<string>(),
    setSelectedItemId: vi.fn(), setExtraSelectedIds: vi.fn(), selectOnly } as SelectionContextValue;
  return { editor, selection, actions, history, setView, toggle, selectOnly };
}


function Providers({ values, children }: { values: ReturnType<typeof contexts>; children: ReactNode }): JSX.Element {
  return <RoomEditorProvider value={values.editor}><SelectionProvider value={values.selection}>{children}</SelectionProvider></RoomEditorProvider>;
}

function librarySetup(options: { plan?: SitePlanData | null; legacyItems?: FurnitureItem[] } = {}) {
  const layout = makeLayout({ id: 'rehearsal-activity', name: '素材架独立演练' });
  if (options.legacyItems) layout.floors[0]!.items = options.legacyItems;
  layoutStore.setState({ layout, activeFloorIndex: 0 });
  const values = contexts(layout, undefined, options.plan ?? null);
  const placeCatalogItem = vi.fn((item: CatalogItem) => layoutStore.getState().actions.addCatalogItem(item)), onLoadPreset = vi.fn(), onClose = vi.fn();
  const assertCurrent = vi.fn(), dispose = vi.fn();
  const capturePlacement = vi.fn(() => ({ assertCurrent, dispose }));
  const props: ComponentProps<typeof ScendanceLibrary> = { placeCatalogItem, onClose, capturePlacement };
  let open = true;
  const node = (view: ViewSettings) => <Providers values={{ ...values, editor: { ...values.editor, view } }}>
    <div id="workbench-material-shelf" hidden={!open}><ScendanceLibrary {...props}/></div>
  </Providers>;
  const rendered = render(node(values.editor.view));
  return { ...values, props, layout, placeCatalogItem, onLoadPreset, onClose, capturePlacement, assertCurrent, dispose,
    update: ({ hidden = !open, view = values.editor.view }: { hidden?: boolean; view?: ViewSettings } = {}) => {
      open = !hidden; rendered.rerender(node(view));
    }, container: rendered.container };
}

const tiles = () => screen.getAllByRole('button', { name: /^添加Rehearsal Model/ });

describe('ScendanceLibrary shelf lifecycle', () => {
  it('stays on materials and leaves templates, environment and the icon strip off this shelf', async () => {
    const test = librarySetup(), before = JSON.stringify(test.layout);
    await screen.findByRole('button', { name: '添加Rehearsal Model 0' });
    expect(screen.getByRole('button', { name: '生成物料' })).toBeTruthy();
    expect(screen.queryByRole('tab', { name: '场景模板' })).toBeNull();
    expect(screen.queryByRole('tab', { name: '环境预览' })).toBeNull();
    expect(screen.queryByRole('tab', { name: '生成物件' })).toBeNull();
    expect(screen.queryByRole('tab', { name: '物料库' })).toBeNull();
    expect(screen.queryByRole('tab', { name: '图层' })).toBeNull();
    expect(screen.queryByRole('combobox', { name: '现场灯光' })).toBeNull();
    expect(test.placeCatalogItem).not.toHaveBeenCalled();
    expect(test.onLoadPreset).not.toHaveBeenCalled();
    expect(test.actions.applyLayout).not.toHaveBeenCalled();
    expect(JSON.stringify(test.layout)).toBe(before);
    expect(loadOnlineModels).toHaveBeenCalledTimes(1);
  });

  it('把本机生成的物件留在同一条物料里，点「生成」后仍走原来的摆放', async () => {
    localStorage.clear();
    rememberAholoAsset({ assetId: GENERATED_ID, kind: 'glb', name: '一张白色圆桌', bytes: 6_433_368, savedAt: 1, taskid: '4475964' });
    rememberAholoAsset({ assetId: '00000000-0000-4000-8000-000000000000', kind: 'spz', name: '场地扫描', bytes: 20_000_000, savedAt: 2 });
    vi.mocked(loadStoredAholoCatalogItem).mockResolvedValue(GENERATED);
    const test = librarySetup();
    await screen.findByRole('button', { name: '添加Rehearsal Model 0' });
    fireEvent.click(screen.getByRole('button', { name: /^生成 / }));
    fireEvent.click(await screen.findByRole('button', { name: '添加一张白色圆桌' }));
    await waitFor(() => expect(test.placeCatalogItem).toHaveBeenCalledWith(GENERATED));
    expect(loadStoredAholoCatalogItem).toHaveBeenCalledWith(GENERATED_ID);
    expect(test.selectOnly).toHaveBeenCalledWith(test.placeCatalogItem.mock.results[0]!.value, { keepPanel: true });
    // 场景点云是环境，不是能摆的物料。
    expect(screen.queryByRole('button', { name: '添加场地扫描' })).toBeNull();
    expect(screen.queryByRole('button', { name: '添加Rehearsal Model 0' })).toBeNull();
  });

  it('keeps category, search, pagination and the scrolling row through tabs, collapse and 2D', async () => {
    const test = librarySetup();
    await screen.findByRole('button', { name: '添加Rehearsal Model 0' });
    fireEvent.click(screen.getByRole('button', { name: /^家具/ }));
    expect(screen.getByRole('button', { name: /^家具/ }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.change(screen.getByRole('textbox', { name: /搜索/ }), { target: { value: 'Rehearsal Model' } });
    fireEvent.click(screen.getByRole('button', { name: /^再显示/ }));
    expect(tiles()).toHaveLength(30);
    const input = screen.getByRole('textbox', { name: /搜索/ }) as HTMLInputElement;
    const row = test.container.querySelector('.sc-material-rail')!;
    row.scrollLeft = 175;
    test.update({ hidden: true, view: makeViewSettings({ view2D: true }) });
    expect(test.container.querySelector('.sc-material-rail')).toBe(row);
    test.update({ hidden: false, view: makeViewSettings({ view2D: true }) });
    expect(screen.getByRole('textbox', { name: /搜索/ })).toBe(input);
    expect(input.value).toBe('Rehearsal Model');
    expect(row.scrollLeft).toBe(175);
    expect(tiles()).toHaveLength(30);
    expect(test.container.querySelectorAll('.sc-library-materials')).toHaveLength(1);
    expect(loadOnlineModels).toHaveBeenCalledTimes(1);
    expect(test.placeCatalogItem).not.toHaveBeenCalled();
  });

  it('keeps one in-flight download while hidden and adds through the original placement callback', async () => {
    let finish!: () => void;
    vi.mocked(ensureGlbAsset).mockReturnValue(new Promise<void>(resolve => { finish = resolve; }));
    const test = librarySetup();
    const tile = await screen.findByRole('button', { name: '添加Rehearsal Model 0' });
    fireEvent.click(tile);
    // A pending download no longer disables further clicks; those clicks queue.
    expect((tile as HTMLButtonElement).disabled).toBe(false);
    test.update({ hidden: true });
    test.update({ hidden: false });
    expect(screen.getByRole('button', { name: '添加Rehearsal Model 0' })).toBe(tile);
    expect((tile as HTMLButtonElement).disabled).toBe(false);
    expect(loadOnlineModels).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(ensureGlbAsset).toHaveBeenCalledTimes(1));
    await act(async () => { finish(); });
    await waitFor(() => expect(test.placeCatalogItem).toHaveBeenCalledTimes(1));
    // 放置只选中，不掀属性面板（keepPanel）。
    expect(test.selectOnly).toHaveBeenCalledWith(test.placeCatalogItem.mock.results[0]!.value, { keepPanel: true });
    expect(test.capturePlacement).toHaveBeenCalledTimes(1);
    expect(test.assertCurrent).toHaveBeenCalled();
    expect(test.dispose).toHaveBeenCalledTimes(1);
  });

  it('closes only through its supplied close callback', async () => {
    const test = librarySetup();
    await screen.findByRole('button', { name: '添加Rehearsal Model 0' });
    fireEvent.click(screen.getByRole('button', { name: '关闭物料库' }));
    expect(test.onClose).toHaveBeenCalledTimes(1);
    expect(test.placeCatalogItem).not.toHaveBeenCalled();
    expect(test.actions.applyLayout).not.toHaveBeenCalled();
    expect(test.onLoadPreset).not.toHaveBeenCalled();
  });

  it('raises the drawer from the grip and remembers how tall the user made it', () => {
    const test = librarySetup();
    const grip = screen.getByRole('separator', { name: '调整物料库高度' });
    expect(document.documentElement.style.getPropertyValue('--sc-shelf-height')).toBe('180px');
    fireEvent.keyDown(grip, { key: 'ArrowUp' });
    expect(document.documentElement.style.getPropertyValue('--sc-shelf-height')).toBe('204px');
    expect(window.localStorage.getItem('scendance-shelf-height')).toBe('204');
    fireEvent.keyDown(grip, { key: 'End' });
    expect(document.documentElement.style.getPropertyValue('--sc-shelf-height')).toBe('476px');
    fireEvent.keyDown(grip, { key: 'Home' });
    expect(window.localStorage.getItem('scendance-shelf-height')).toBe('156');
    expect(test.placeCatalogItem).not.toHaveBeenCalled();
    window.localStorage.clear();
  });
});


describe('ScendanceViewTools design column', () => {



  // 2026-11-12 统一 2D/3D 后沿用菜单语义：抓手/选择仍是一把真开关，只是经由菜单切换。







  it('改过天气也不会再长出氛围条（该 UI 已退役）', () => {
    // 旧行为是「开了雨就不许藏」，前提是 UI 还在。现在整条退役：任何 view 状态都不再渲染它。
    const values = contexts(makeLayout(), makeViewSettings({ weather: 'rain', timeOfDay: 21 }));
    render(<Providers values={values}><ScendanceViewTools onZoom={vi.fn()}/></Providers>);
    expect(screen.queryByRole('button', { name: /氛围/ })).toBeNull();
    expect(document.getElementById('tool-weather')).toBeNull();
    expect(document.getElementById('tool-time')).toBeNull();
    expect(document.getElementById('tool-lighting')).toBeNull();
  });

  it('keeps rail wheel browsing from reaching the canvas zoom handler', () => {
    const values = contexts(), onCanvasWheel = vi.fn();
    render(<Providers values={values}><div onWheel={onCanvasWheel}><ScendanceViewTools onZoom={vi.fn()}/></div></Providers>);
    fireEvent.wheel(screen.getByRole('navigation', { name: '工具' }), { deltaY: 80 });
    expect(onCanvasWheel).not.toHaveBeenCalled();
  });
});

describe('ScendanceViewTools 底图开关已退役（#38）', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('普通室内房间本来就没有这两颗钮', () => {
    render(<Providers values={contexts()}><ScendanceViewTools onZoom={vi.fn()}/></Providers>);
    expect(document.getElementById('tool-satellite')).toBeNull();
    expect(document.getElementById('tool-map-type')).toBeNull();
  });

  // 退役前这一组是「地图选址场地 → 自动补卫星图 → 写 layout 字节」的主路。
  // 现在两钮整体删掉，且不应再有任何自动拉图请求：图只从 `plan.ground` 读。
  it('地图选址场地既不出钮，也不再自动拉图写 layout', () => {
    vi.stubEnv('NEXT_PUBLIC_AMAP_KEY', 'js-key');
    vi.stubEnv('NEXT_PUBLIC_AMAP_STATIC_KEY', 'test-static');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const image = 'http://127.0.0.1:3199/amap-static?west=120.5300000&south=30.4000000&east=120.5400000&north=30.4100000&x-ref=satellite-ground-ref';
    const layout = makeLayout({
      name: '盐官潮乐之城 · 规划区 12×8m',
      satelliteGroundRef: true,
      floorPlanImage: image,
      mapGroundPolygon: [
        { lng: 120.53, lat: 30.40 }, { lng: 120.54, lat: 30.40 }, { lng: 120.54, lat: 30.41 },
      ],
    });
    const values = contexts(layout);
    render(<Providers values={values}><ScendanceViewTools onZoom={vi.fn()}/></Providers>);
    expect(screen.queryByRole('button', { name: /卫星贴地/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /地图类型/ })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(values.actions.applyLayout).not.toHaveBeenCalled();
  });
});


describe('ScendanceViewTools outdoor Google Maps rail', () => {
  function outdoorActions() {
    return {
      canUndo: true, canRedo: true, undo: vi.fn(), redo: vi.fn(), zoomBy: vi.fn(),
      view: '2d' as const, onToggleView: vi.fn(), resetNorth: vi.fn(),
    };
  }

  it('keeps the Google control order and folds our planning tools into a hideable dock', () => {
    const values = contexts();
    const outdoor = outdoorActions();
    const focus = vi.fn();
    render(<Providers values={values}><ScendanceViewTools onZoom={vi.fn()} outdoorActions={outdoor} onFocusVenue={focus}/></Providers>);
    const stack = screen.getByRole('group', { name: '地图控制' });
    expect(within(stack).getAllByRole('button').map(button => button.getAttribute('aria-label'))).toEqual([
      '罗盘：点击回正北',
      '当前 2D 平面，点击切到 3D 场景',
      '回到框选场地',
      '放大',
      '缩小',
      '第一人称漫游',
      '干净看图：隐藏全部浮层',
    ]);
    fireEvent.click(within(stack).getByRole('button', { name: '放大' }));
    expect(outdoor.zoomBy).toHaveBeenCalledWith(1);
    fireEvent.click(within(stack).getByRole('button', { name: '回到框选场地' }));
    expect(focus).toHaveBeenCalledTimes(1);
    // 底栏默认收起，只留贴底把手；展开后规划工具才出现，地图控制列始终不受影响。
    expect(screen.queryByRole('button', { name: '撤销' })).toBeNull();
    expect(screen.getByRole('button', { name: '展开工具条' }).getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: '展开工具条' }));
    expect(screen.getByRole('button', { name: '撤销' })).toBeTruthy();
    // 展开态只有工具这一行，收起交给左端岛核（⌄）；Esc 只是快捷键。
    expect(screen.queryByRole('button', { name: '展开工具条' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /收起工具条/ }));
    expect(screen.queryByRole('button', { name: '撤销' })).toBeNull();
    // 再开一次，验证 Esc 也能收。
    fireEvent.click(screen.getByRole('button', { name: '展开工具条' }));
    expect(screen.getByRole('button', { name: '撤销' })).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('button', { name: '撤销' })).toBeNull();
    expect(within(stack).getByRole('button', { name: '放大' })).toBeTruthy();
  });

  it('keeps the planning dock open on outside pointerdown; only the island core / Esc close it', () => {
    const values = contexts();
    const outdoor = outdoorActions();
    render(<Providers values={values}><ScendanceViewTools onZoom={vi.fn()} outdoorActions={outdoor} /></Providers>);
    fireEvent.click(screen.getByRole('button', { name: '展开工具条' }));
    expect(screen.getByRole('button', { name: '撤销' })).toBeTruthy();
    fireEvent.pointerDown(document.body);
    fireEvent.pointerDown(screen.getByRole('group', { name: '地图控制' }));
    expect(screen.getByRole('button', { name: '撤销' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /收起工具条/ }));
    expect(screen.queryByRole('button', { name: '撤销' })).toBeNull();
  });

  it('closes the annotation card together with the dock so no anchored panel is orphaned', () => {
    const values = contexts();
    const setInspector = vi.fn();
    const outdoor = { ...outdoorActions(), setInspector, inspectorTabs: { measure: false, annotate: true, selection: false } };
    render(<Providers values={values}><ScendanceViewTools onZoom={vi.fn()} outdoorActions={outdoor} /></Providers>);
    fireEvent.click(screen.getByRole('button', { name: '展开工具条' }));
    fireEvent.click(screen.getByRole('button', { name: /收起工具条/ }));
    expect(setInspector).toHaveBeenCalledWith('annotate');
  });
});

describe('MaterialDrawerHandle', () => {
  it('labels the bottom handle MATERIALS and toggles independently', () => {
    const onToggle = vi.fn();
    const buttonRef = createRef<HTMLButtonElement>();
    const { rerender } = render(<MaterialDrawerHandle open={false} onToggle={onToggle} buttonRef={buttonRef}/>);
    const button = screen.getByRole('button', { name: '展开物料库' });
    expect(buttonRef.current).toBe(button);
    // 底条是分区切换：主视觉是物料图标（图标体系已迁到 Material Symbol 蒙版 span，不再是 svg），中文名留在 aria-label。
    expect(button.querySelector('.sc-material-symbol')).toBeTruthy();
    expect(button.textContent ?? '').not.toMatch(/物料/);
    expect(button.getAttribute('aria-controls')).toBe('workbench-material-shelf');
    fireEvent.click(button);
    expect(onToggle).toHaveBeenCalledTimes(1);
    rerender(<MaterialDrawerHandle open onToggle={onToggle} buttonRef={buttonRef}/>);
    expect(screen.getByRole('button', { name: '收起物料库' }).getAttribute('aria-expanded')).toBe('true');
  });
});

// 2026-11-16 合并 ff63f8dc 回归：户外那颗 #tool-walk 丢了「只走 outdoor.toggleWalk 并就地返回」的分支。
// 室内漫游退役后共用 onToggleWalkthrough 已删除，只剩 outdoor.toggleWalk 一条出口。
describe('ScendanceViewTools 户外漫游入口', () => {
  function renderOutdoorWalk(overrides: { walkIn3D?: boolean; walkActive?: boolean } = {}) {
    const values = contexts(makeLayout(), makeViewSettings());
    const toggleWalk = vi.fn(), onZoom = vi.fn();
    const outdoorActions = {
      canUndo: false, canRedo: false, undo: vi.fn(), redo: vi.fn(), zoomBy: vi.fn(),
      view: '2d' as const, onToggleView: vi.fn(), resetNorth: vi.fn(), focusVenue: vi.fn(),
      walkActive: false, walkIn3D: true, toggleWalk,
      ...overrides,
    };
    render(<Providers values={values}><ScendanceViewTools onZoom={onZoom} outdoorActions={outdoorActions}/></Providers>);
    return { toggleWalk };
  }

  it('户外 2D 平面点漫游钮也直接调 toggleWalk，由它自己接管 3D 场地', () => {
    const { toggleWalk } = renderOutdoorWalk({ walkIn3D: false });
    const button = screen.getByRole('button', { name: '第一人称漫游' }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    expect(toggleWalk).toHaveBeenCalledWith(true);
  });

  it('3D 接管态点漫游只调 outdoor.toggleWalk', () => {
    const { toggleWalk } = renderOutdoorWalk({ walkIn3D: true });
    const button = screen.getByRole('button', { name: '第一人称漫游' }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    expect(toggleWalk).toHaveBeenCalledWith(true);
  });

  it('漫游激活态再点一次交给同一个 toggleWalk 退出', () => {
    const { toggleWalk } = renderOutdoorWalk({ walkIn3D: true, walkActive: true });
    fireEvent.click(screen.getByRole('button', { name: '退出漫游' }));
    expect(toggleWalk).toHaveBeenCalledWith(false);
  });

  it('漫游钮套用与其余地图控件相同的 44px 圆钮类，激活时保持黄人图标', () => {
    const { toggleWalk } = renderOutdoorWalk({ walkIn3D: true, walkActive: true });
    const button = screen.getByRole('button', { name: '退出漫游' });
    expect(button.className).toContain('oc-gm-round');
    expect(button.className).toContain('oc-gm-walk');
    expect(button.className).toContain('is-walk');
    expect(button.className).toContain('is-active');
    expect(button.getAttribute('data-tip')).toBe('退出漫游');
    const figure = button.querySelector('svg');
    expect(figure?.getAttribute('width')).toBe('20');
    expect(figure?.querySelector('g')?.getAttribute('fill')).toBe('#FBBF0A');
    expect(figure?.querySelector('circle')?.getAttribute('r')).toBe('2.6');
    expect(button.querySelector('.walk-figure')).toBeNull();
    fireEvent.click(button);
    expect(toggleWalk).toHaveBeenCalledWith(false);
  });

  it('漫游悬停只拎起图标，按钮色保持 #fbbc04，没有 walk-v7 光和踏步', () => {
    // autocrlf 检出时磁盘是 CRLF，读原始字节会让所有含换行的断言永远失配——先归一化。
    const globals = readFileSync(resolve(process.cwd(), 'app/globals.css'), 'utf8').replace(/\r\n/g, '\n');
    expect(globals).toContain('button.is-walk > svg { transition: transform .18s ease; }');
    expect(globals).toContain('button.is-walk:hover > svg { transform: translateY(-2px) rotate(-9deg); }');
    // 左轨收窄批次给选择器补了祖先前缀（.sc-workbench .sc-tool-column .oc-cluster.oc-gmaps），
    // 断言跟上前缀；验的仍是同一件事：50% 圆 + #fbbc04、激活同色、未与 oc-gm-round 合并。
    expect(globals).toContain('.sc-workbench .sc-tool-column .oc-cluster.oc-gmaps button.oc-gm-walk {\n  border-radius: 50%; color: #fbbc04;\n}');
    expect(globals).toContain('.sc-workbench .sc-tool-column .oc-cluster.oc-gmaps button.oc-gm-walk.is-active { color: #fbbc04; }');
    expect(globals).not.toContain('walk-figure');
    expect(globals).not.toContain('button.oc-gm-round.oc-gm-walk');
    expect(globals).not.toMatch(/button\.is-walk:hover,\s*\n[^}]*translateY\(-2px\);/);
  });
});

describe('物料上限守卫当前计数双读回落（S4 C-2）', () => {
  const fullLegacyItems = (): FurnitureItem[] =>
    Array.from({ length: EDITOR_ITEM_LIMIT }, (_, index) => makeItem({ id: `legacy-${index}` }));
  const fullPlan = (): SitePlanData =>
    ({ facilities: Array.from({ length: EDITOR_ITEM_LIMIT }, (_, index) => ({ id: `f-${index}` })) }) as unknown as SitePlanData;

  async function setupGuard(options: { plan?: SitePlanData | null; legacyItems?: FurnitureItem[] }) {
    const test = librarySetup(options);
    await screen.findByRole('button', { name: '添加Rehearsal Model 0' });
    return test;
  }

  it('legacy 草稿态满员：物料库禁用并显示上限提示', async () => {
    await setupGuard({ plan: null, legacyItems: fullLegacyItems() });
    expect(screen.getByText(/已达到 .* 件物料上限/)).toBeTruthy();
    expect((screen.getByRole('button', { name: '添加Rehearsal Model 0' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('bound 态 plan facilities 满员：物料库禁用（legacy 空数组）', async () => {
    await setupGuard({ plan: fullPlan() });
    expect(screen.getByText(/已达到 .* 件物料上限/)).toBeTruthy();
  });

  it('bound 态 plan 未满：即使 legacy floor 堆满也不禁用（plan 计数优先）', async () => {
    await setupGuard({ plan: { facilities: [] } as unknown as SitePlanData, legacyItems: fullLegacyItems() });
    expect(screen.queryByText(/已达到 .* 件物料上限/)).toBeNull();
    expect((screen.getByRole('button', { name: '添加Rehearsal Model 0' }) as HTMLButtonElement).disabled).toBe(false);
  });
});
