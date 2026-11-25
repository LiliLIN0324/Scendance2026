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
import { makeLayout, makeViewSettings } from '../lib/__testfixtures__/fixtures';
import { rememberAholoAsset } from '../lib/aholo-assets';
import { loadStoredAholoCatalogItem } from '../lib/aholo-model-placement';
import { buildOnlineModelIndex, loadOnlineModels } from '../lib/online-models';
import { ensureGlbAsset } from '../three/glb-assets';
import { readPlanGroundMode, readPlanGroundSource, writePlanGroundMode, writePlanGroundSource } from '../lib/plan-basemap-source';
import { pinMapSource, readMapSlots, resetMapSlotsCacheForTest } from '../lib/map-source-slots';
import { MaterialDrawerHandle, ScendanceLibrary, ScendanceViewTools } from './scendance-workspace';
import type { OnlineModel } from '../lib/online-models';
import type { CatalogItem } from '../lib/types';
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

function contexts(layout = makeLayout(), view = makeViewSettings()) {
  const selectOnly = vi.fn();
  const actions = { applyLayout: vi.fn(), replaceItems: vi.fn() };
  const history = { canUndo: true, canRedo: true, undo: vi.fn(), redo: vi.fn() };
  const setView = vi.fn(), toggle = vi.fn();
  const editor = { layout, activeFloor: layout.floors[0]!, activeFloorIndex: 0,
    view, actions, history, setView, toggle } as unknown as RoomEditorContextValue;
  const selection = { selectedItemId: null, selectedItem: null,
    allSelectedIds: new Set<string>(), extraSelectedIds: new Set<string>(),
    setSelectedItemId: vi.fn(), setExtraSelectedIds: vi.fn(), selectOnly } as SelectionContextValue;
  return { editor, selection, actions, history, setView, toggle, selectOnly };
}

/** 取一次 setView 的 updater 返回值，用来断言工具开关切换后的 view。 */
function applyView(values: ReturnType<typeof contexts>, base: ReturnType<typeof makeViewSettings>) {
  expect(values.setView).toHaveBeenCalledTimes(1);
  const updater = values.setView.mock.calls[0]![0] as (view: ReturnType<typeof makeViewSettings>) => ReturnType<typeof makeViewSettings>;
  return updater(base);
}

function Providers({ values, children }: { values: ReturnType<typeof contexts>; children: ReactNode }): JSX.Element {
  return <RoomEditorProvider value={values.editor}><SelectionProvider value={values.selection}>{children}</SelectionProvider></RoomEditorProvider>;
}

function librarySetup() {
  const layout = makeLayout({ id: 'rehearsal-activity', name: '素材架独立演练' });
  layoutStore.setState({ layout, activeFloorIndex: 0 });
  const values = contexts(layout);
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
  function renderTools(view = makeViewSettings(), onExportImage = vi.fn(), onExportAlbum?: (options: { scale: number }) => Promise<{ ok: boolean; count: number }>) {
    const values = contexts(makeLayout(), view), onZoom = vi.fn();
    render(<Providers values={values}><ScendanceViewTools showAtmosphere onZoom={onZoom} onExportImage={onExportImage} {...(onExportAlbum ? { onExportAlbum } : {})}/></Providers>);
    return { values, onZoom, onExportImage, rail: screen.getByRole('navigation', { name: '工具' }) };
  }

  it('renders one right-edge island of flat round tools with no more-ellipsis', () => {
    const { values, rail } = renderTools();
    expect(rail.id).toBe('tool-column');
    // 楼层切换另有两个按钮；其余工具保持可访问。
    expect(within(screen.getByRole('group', { name: /楼层切换/ })).getAllByRole('button')).toHaveLength(2);
    // 室内常驻：分享 / 画布工具（抓手·选择）/ 2D·3D / 第一人称漫游 / 网格 / 撤销 / 重做 / 缩小 / 放大 / 导出 / 氛围 + 楼层切换上下两钮。尺寸标注收进账户中心设置分区；卫星只在户外。
    expect(within(rail).getAllByRole('button')).toHaveLength(12);
    expect(within(rail).getAllByRole('button', { name: '分享' })).toHaveLength(1);
    // 2026-11-13 定稿：户外 2D/3D 走左下胶囊，右轨这颗只在纯室内兜底平面/立体，aria-label 报「当前 2D 平面 / 3D 场景」。
    for (const name of ['分享', '选择工具', /当前 (2D 平面|3D 场景)/, '网格吸附', '撤销', '重做', '缩小', '放大', '导出效果图'] as (string | RegExp)[]) {
      expect(within(rail).getByRole('button', { name })).toBeTruthy();
    }
    // 选择是开关而不是禁用：默认激活，但按钮可点，菜单里切抓手/选择。
    const selectButton = within(rail).getByRole('button', { name: '选择工具' }) as HTMLButtonElement;
    expect(selectButton.disabled).toBe(false);
    expect(selectButton.getAttribute('aria-pressed')).toBe('true');
    expect(rail.querySelector('#tool-satellite')).toBeNull();
    expect(rail.querySelector('#tool-map-type')).toBeNull();
    // 省略号没了：撤销/重做/缩放/导出全是一级圆钮；看全场也删掉了。
    expect(rail.querySelector('#tool-more')).toBeNull();
    expect(rail.querySelector('#tool-fit')).toBeNull();
    for (const id of ['tool-undo', 'tool-redo', 'tool-zoom-out', 'tool-zoom-in', 'tool-export']) {
      expect(rail.querySelector(`#${id}`)).toBeTruthy();
    }
    expect(rail.querySelector('#tool-grid')).toBeTruthy();
    expect(rail.querySelector('#tool-dims')).toBeNull();
    // 视角轮换钮已移除，机位只保留在导出选项与机位册里。
    expect(rail.querySelector('#tool-preset')).toBeNull();
    // 机位不再拆成两颗一级钮。
    expect(rail.querySelector('#tool-top')).toBeNull();
    expect(rail.querySelector('#tool-front')).toBeNull();
    // 室内漫游已退役：右轨不再有 #tool-walk（户外漫游钮在画布右下工具簇）。
    expect(rail.querySelector('#tool-walk')).toBeNull();
    const order = [...rail.querySelectorAll('button')].map(button => button.id);
    // 撤销/重做在工具组之后，缩小/放大在导出前面。
    expect(order.indexOf('tool-undo')).toBeGreaterThan(order.indexOf('tool-grid'));
    expect(order.indexOf('tool-zoom-in')).toBeLessThan(order.indexOf('tool-export'));
    expect(screen.queryByRole('menuitemcheckbox', { name: '第一人称漫游' })).toBeNull();
    expect(screen.queryByRole('menuitemcheckbox', { name: '漫游' })).toBeNull();
    expect(screen.getByRole('button', { name: /氛围/ }).getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: /氛围/ }));
    expect(screen.getByRole('button', { name: /氛围/ }).getAttribute('aria-expanded')).toBe('true');
    // 氛围四条在竖列 rail 的弹出菜单里。
    expect(rail.querySelector('.sc-atmosphere-group')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /物料库|素材架/ })).toBeNull();
    const dimension = within(rail).getByRole('button', { name: /当前 (2D 平面|3D 场景)/ });
    // 图标体系已迁到 Material Symbol 蒙版 span（sc-material-symbol），不再是 svg。
    expect(dimension.querySelector('.sc-material-symbol')).toBeTruthy();
    expect(dimension.textContent).not.toMatch(/2D|3D/);
    fireEvent.click(dimension);
    expect(values.toggle).toHaveBeenCalledWith('view2D');
  });

  // 2026-11-11 OnePlan 画布工具菜单：抓手 H / 选择 S。
  it('2026-11-11 OnePlan 画布工具菜单：抓手 H / 选择 S', () => {
    const { values, rail } = renderTools();
    const select = within(rail).getByRole('button', { name: '选择工具' }) as HTMLButtonElement;
    expect(select.disabled).toBe(false);
    expect(select.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(select);
    const handItem = screen.getByRole('menuitemradio', { name: /抓手工具/ });
    expect(handItem.getAttribute('aria-checked')).toBe('false');
    expect(screen.getByRole('menuitemradio', { name: /选择工具/ }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(handItem);
    expect(applyView(values, makeViewSettings())).toMatchObject({ selectMode: false });
  });

  // 2026-11-12 统一 2D/3D 后沿用菜单语义：抓手/选择仍是一把真开关，只是经由菜单切换。
  it('toggles 选择工具 via the canvas-tool menu instead of disabling it', () => {
    const { values, rail } = renderTools();
    const select = within(rail).getByRole('button', { name: '选择工具' }) as HTMLButtonElement;
    expect(select.disabled).toBe(false);
    expect(select.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(select);
    fireEvent.click(screen.getByRole('menuitemradio', { name: /抓手工具/ }));
    expect(applyView(values, makeViewSettings())).toMatchObject({ selectMode: false });
    cleanup();
    // 关掉之后是「抓手浏览」：仍然可点，菜单里再点「选择工具」就是重新启用。
    const off = contexts(makeLayout(), makeViewSettings({ selectMode: false }));
    render(<Providers values={off}><ScendanceViewTools showAtmosphere onZoom={vi.fn()}/></Providers>);
    const offSelect = screen.getByRole('button', { name: '抓手工具' }) as HTMLButtonElement;
    expect(offSelect.disabled).toBe(false);
    expect(offSelect.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(offSelect);
    const selectItem = screen.getByRole('menuitemradio', { name: /选择工具/ });
    expect(selectItem.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(selectItem);
    expect(applyView(off, makeViewSettings({ selectMode: false }))).toMatchObject({ selectMode: true });
  });

  it('keeps 撤销 / 重做 / 缩放 / 导出 on the rail and closes the export popover on Escape', () => {
    const { values, rail, onZoom, onExportImage } = renderTools();
    fireEvent.click(within(rail).getByRole('button', { name: '网格吸附' }));
    expect(values.toggle).toHaveBeenCalledWith('snapToGrid');
    fireEvent.click(within(rail).getByRole('button', { name: '撤销' }));
    fireEvent.click(within(rail).getByRole('button', { name: '重做' }));
    fireEvent.click(within(rail).getByRole('button', { name: '缩小' }));
    fireEvent.click(within(rail).getByRole('button', { name: '放大' }));
    expect(values.history.undo).toHaveBeenCalledTimes(1);
    expect(values.history.redo).toHaveBeenCalledTimes(1);
    expect(onZoom.mock.calls).toEqual([['-'], ['+']]);
    expect(values.toggle.mock.calls).toEqual([['snapToGrid']]);
    expect(onExportImage).not.toHaveBeenCalled();
    // 导出是一级钮，点开只有一层选项弹层；Esc 收起。
    fireEvent.click(within(rail).getByRole('button', { name: '导出效果图' }));
    expect(within(rail).getByRole('button', { name: '导出效果图' }).getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('dialog', { name: '导出效果图选项' })).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: '导出效果图选项' })).toBeNull();
    expect(within(rail).getByRole('button', { name: '导出效果图' }).getAttribute('aria-expanded')).toBe('false');
  });

  it('exports a render from the 导出 popover with the chosen frame and quality', async () => {
    const onExportImage = vi.fn().mockResolvedValue(true);
    const { rail } = renderTools(makeViewSettings(), onExportImage);
    fireEvent.click(within(rail).getByRole('button', { name: '导出效果图' }));
    const dialog = screen.getByRole('dialog', { name: '导出效果图选项' });
    expect(dialog.textContent).toContain('导出效果图');
    fireEvent.click(screen.getByRole('button', { name: '整体' }));
    // 画质钮 aria-label = 提示（档位）：EXPORT_SCALES 三档 1080p/4K/6K。
    fireEvent.click(screen.getByRole('button', { name: '5760×3240（6K）' }));
    fireEvent.click(screen.getByRole('button', { name: '导出 PNG' }));
    await waitFor(() => expect(onExportImage).toHaveBeenCalledWith({ view: 'iso', scale: 3 }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '导出效果图选项' })).toBeNull());
  });

  it('defaults to the current view at 1080p and marks the choices active', async () => {
    const onExportImage = vi.fn().mockResolvedValue(true);
    const { rail } = renderTools(makeViewSettings(), onExportImage);
    fireEvent.click(within(rail).getByRole('button', { name: '导出效果图' }));
    expect((screen.getByRole('button', { name: '跟随当前' }) as HTMLButtonElement).getAttribute('aria-pressed')).toBe('true');
    // 交付默认档改为 1080p（1×），4K/6K 是加档而不是默认。
    expect((screen.getByRole('button', { name: '1920×1080（1080p）' }) as HTMLButtonElement).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: '导出 PNG' }));
    await waitFor(() => expect(onExportImage).toHaveBeenCalledWith({ view: 'current', scale: 1 }));
  });

  it('exports the album of stable camera angles once and keeps it out of 2D', async () => {
    const onExportAlbum = vi.fn().mockResolvedValue({ ok: true, count: 4 });
    const { rail } = renderTools(makeViewSettings(), vi.fn(), onExportAlbum);
    fireEvent.click(within(rail).getByRole('button', { name: '导出效果图' }));
    const album = screen.getByRole('button', { name: '机位册' });
    expect(album.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(album);
    expect(album.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: '导出机位册' }));
    await waitFor(() => expect(onExportAlbum).toHaveBeenCalledWith({ scale: 1 }));
  });

  it('keeps the album out of the 2D plan', () => {
    const onExportAlbum = vi.fn(async (_options: { scale: number }) => ({ ok: true, count: 0 }));
    const { rail } = renderTools(makeViewSettings({ view2D: true }), vi.fn(), onExportAlbum);
    fireEvent.click(within(rail).getByRole('button', { name: '导出效果图' }));
    expect((screen.getByRole('button', { name: '机位册' }) as HTMLButtonElement).disabled).toBe(true);
    expect(onExportAlbum).not.toHaveBeenCalled();
  });

  it('disables zoom in 2D and hides atmosphere when requested', () => {
    const values = contexts(makeLayout(), makeViewSettings({ view2D: true }));
    render(<Providers values={values}><ScendanceViewTools showAtmosphere={false} onZoom={vi.fn()}/></Providers>);
    const rail = screen.getByRole('navigation', { name: '工具' });
    for (const name of ['缩小', '放大']) {
      expect((within(rail).getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true);
    }
    expect(screen.queryByRole('group', { name: '氛围' })).toBeNull();
    // 室内漫游随 Viewport 退役，右轨不再有「第一人称漫游」钮。
    expect(within(rail).queryByRole('button', { name: '第一人称漫游' })).toBeNull();
  });

  it('keeps the atmosphere controls in view once something is actually changed', () => {
    // 收起只收「没在用的」：开了雨就不许藏，否则找不到地方关掉。
    const values = contexts(makeLayout(), makeViewSettings({ weather: 'rain' }));
    render(<Providers values={values}><ScendanceViewTools showAtmosphere onZoom={vi.fn()}/></Providers>);
    expect(screen.getByRole('button', { name: /氛围/ }).getAttribute('aria-expanded')).toBe('true');
    // 天气按钮嵌在氛围弹层里，显示当前天气「降雨」
    expect(screen.getByRole('menuitem', { name: '降雨' })).toBeTruthy();
  });

  it('keeps rail wheel browsing from reaching the canvas zoom handler', () => {
    const values = contexts(), onCanvasWheel = vi.fn();
    render(<Providers values={values}><div onWheel={onCanvasWheel}><ScendanceViewTools onZoom={vi.fn()}/></div></Providers>);
    fireEvent.wheel(screen.getByRole('navigation', { name: '工具' }), { deltaY: 80 });
    expect(onCanvasWheel).not.toHaveBeenCalled();
  });
});

describe('ScendanceViewTools atmosphere menus', () => {
  it('wires 天气 / 时段 in 氛围（人群已随室内 NPC 退役）', () => {
    const values = contexts();
    render(<Providers values={values}><ScendanceViewTools showAtmosphere onZoom={vi.fn()}/></Providers>);
    fireEvent.click(screen.getByRole('button', { name: /氛围/ }));
    expect(screen.queryByRole('menuitemcheckbox', { name: '第一人称漫游' })).toBeNull();
    expect(screen.queryByRole('menuitemcheckbox', { name: '漫游' })).toBeNull();
    expect(screen.queryByRole('menuitemcheckbox', { name: '人群' })).toBeNull();
    // 天气弹层嵌在氛围弹层里：先点天气按钮展开子弹层（默认显示「晴朗」）
    fireEvent.click(screen.getByRole('menuitem', { name: '晴朗' }));
    fireEvent.click(screen.getByRole('option', { name: '降雨' }));
    const weather = values.setView.mock.calls.at(-1)![0] as (view: ViewSettings) => ViewSettings;
    expect(weather(makeViewSettings()).weather).toBe('rain');
    // 时段子弹层（默认显示「正午」，弹层还开着所以不用重开）
    fireEvent.click(screen.getByRole('menuitem', { name: '正午' }));
    fireEvent.click(screen.getByRole('option', { name: /黄昏/ }));
    const time = values.setView.mock.calls.at(-1)![0] as (view: ViewSettings) => ViewSettings;
    expect(time(makeViewSettings()).timeOfDay).toBe(18);
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

describe('ScendanceViewTools 地图切换四槽位', () => {
  beforeEach(() => {
    localStorage.clear();
    resetMapSlotsCacheForTest();
    writePlanGroundSource('amap-streets');
    writePlanGroundMode('map');
  });

  it('四个快捷位与 2D 面板共用 map-source-slots：2D 置顶后 3D 菜单立刻同步', () => {
    render(<Providers values={contexts()}><ScendanceViewTools onZoom={vi.fn()} geoGroundActive /></Providers>);
    fireEvent.click(document.getElementById('tool-ground-source')!);

    const list = screen.getByRole('listbox', { name: '地理瓦片图源' });
    expect(within(list).getAllByRole('option')).toHaveLength(4);
    expect(screen.getByTestId('ground-slot-satellite').textContent).toContain('高德卫星');
    expect(screen.getByTestId('ground-slot-streets').textContent).toContain('高德街道');
    expect(screen.getByTestId('ground-slot-tone').textContent).toContain('Carto 浅色');
    expect(screen.getByTestId('ground-slot-none').textContent).toContain('无');

    // 2D 面板那边置顶 Carto 深色（同一个 store）→ 三维「单色」行当场换成深色。
    act(() => {
      pinMapSource('carto-dark');
    });
    expect(readMapSlots().tone).toBe('carto-dark');
    expect(screen.getByTestId('ground-slot-tone').textContent).toContain('Carto 深色');

    // 点格子真正换底面：写图源 + 地图形态（从纸面回来也认）。
    fireEvent.click(screen.getByTestId('ground-slot-tone'));
    expect(readPlanGroundSource()).toBe('carto-dark');
    expect(readPlanGroundMode()).toBe('map');

    // 「无」= 纸面：不铺瓦片，与 2D 面板的「无」同一份偏好。
    fireEvent.click(document.getElementById('tool-ground-source')!);
    fireEvent.click(screen.getByTestId('ground-slot-none'));
    expect(readPlanGroundMode()).toBe('paper');
    // 纸面态下触发钮标题改成「纸面（无底图）」，不再冒充某个图源。
    expect(document.getElementById('tool-ground-source')!.getAttribute('aria-label')).toContain('纸面（无底图）');
  });

  it('槽位里置顶了天地图（2D 专用）时，三维回落到该格缺省并明说', () => {
    act(() => {
      pinMapSource('img');
    });
    render(<Providers values={contexts()}><ScendanceViewTools onZoom={vi.fn()} geoGroundActive /></Providers>);
    fireEvent.click(document.getElementById('tool-ground-source')!);
    const row = screen.getByTestId('ground-slot-satellite');
    expect(row.textContent).toContain('高德卫星');
    expect(row.textContent).toContain('三维用缺省');
    fireEvent.click(row);
    expect(readPlanGroundSource()).toBe('amap-satellite');
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
    render(<Providers values={values}><ScendanceViewTools showAtmosphere onZoom={onZoom} outdoorActions={outdoorActions}/></Providers>);
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
