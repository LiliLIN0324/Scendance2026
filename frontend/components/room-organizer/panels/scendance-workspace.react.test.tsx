// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createRef, type ComponentProps, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RoomEditorProvider, type RoomEditorContextValue } from '../contexts/room-editor-context';
import { SelectionProvider, type SelectionContextValue } from '../contexts/selection-context';
import { makeLayout, makeViewSettings } from '../lib/__testfixtures__/fixtures';
import { rememberAholoAsset } from '../lib/aholo-assets';
import { loadStoredAholoCatalogItem } from '../lib/aholo-model-placement';
import { buildOnlineModelIndex, loadOnlineModels } from '../lib/online-models';
import { ensureGlbAsset } from '../three/glb-assets';
import { loadScenePreset } from '../three/scene-presets';
import { createVenueFromPick } from '../lib/amap-venue';
import { MaterialDrawerHandle, ScendanceLibrary, ScendanceViewTools } from './scendance-workspace';
import type { SplatPreviewState } from '../hooks/use-splat-preview';
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
vi.mock('../three/scene-presets', () => ({ loadScenePreset: vi.fn() }));

const MODELS: OnlineModel[] = Array.from({ length: 30 }, (_, index) => ({
  slug: `rehearsal-${index}`, name: `Rehearsal Model ${index}`, bucket: 'seating',
  subcategory: '演练', width: 0.5, depth: 0.6, height: 0.9,
  bytes: 1024, triangles: 120, downloads: 1,
  thumb: `https://cdn.3dassets.dev/rehearsal-${index}/thumb.webp`,
  glb: `https://cdn.3dassets.dev/rehearsal-${index}/model.glb`,
  page: `https://3dassets.dev/rehearsal-${index}`,
}));

const GENERATED_ID = '4165e104-e2c1-4f5e-b2a4-46602bf9f932';
const SCENE_ID = '00000000-0000-4000-8000-000000000000';
const GENERATED: CatalogItem = {
  type: 'glb-asset', name: '一张白色圆桌', width: 1.2, depth: 1.2, height: 0.75,
  color: '#ffffff', icon: '◇', price: 0, category: 'decor', source: 'generated',
  materialId: 'asset', assetId: GENERATED_ID, glbUrl: `http://127.0.0.1:3199/asset/${GENERATED_ID}.glb`,
};

beforeEach(() => {
  vi.mocked(loadOnlineModels).mockResolvedValue(buildOnlineModelIndex(MODELS));
  vi.mocked(ensureGlbAsset).mockResolvedValue(undefined);
});afterEach(() => { cleanup(); vi.resetAllMocks(); });

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

function Providers({ values, children }: { values: ReturnType<typeof contexts>; children: ReactNode }): JSX.Element {
  return <RoomEditorProvider value={values.editor}><SelectionProvider value={values.selection}>{children}</SelectionProvider></RoomEditorProvider>;
}

function librarySetup() {
  const layout = makeLayout({ id: 'rehearsal-activity', name: '素材架独立演练' });
  const values = contexts(layout);
  const placeCatalogItem = vi.fn(() => 'placed-rehearsal-item'), onLoadPreset = vi.fn(), onClose = vi.fn();
  const assertCurrent = vi.fn(), dispose = vi.fn();
  const capturePlacement = vi.fn(() => ({ assertCurrent, dispose }));
  const environment = { preview: { status: 'idle', assetId: '', name: '' } as SplatPreviewState, onStart: vi.fn(), onStop: vi.fn() };
  const props: ComponentProps<typeof ScendanceLibrary> = { placeCatalogItem, onLoadPreset, onClose, capturePlacement, environment };
  let open = true;
  const node = (view: ViewSettings) => <Providers values={{ ...values, editor: { ...values.editor, view } }}>
    <div id="workbench-material-shelf" hidden={!open}><ScendanceLibrary {...props}/></div>
  </Providers>;
  const rendered = render(node(values.editor.view));
  return { ...values, props, layout, environment, placeCatalogItem, onLoadPreset, onClose, capturePlacement, assertCurrent, dispose,
    update: ({ hidden = !open, view = values.editor.view }: { hidden?: boolean; view?: ViewSettings } = {}) => {
      open = !hidden; rendered.rerender(node(view));
    }, container: rendered.container };
}

const tiles = () => screen.getAllByRole('button', { name: /^添加Rehearsal Model/ });

describe('ScendanceLibrary shelf lifecycle', () => {
  it('opens the requested template tab without applying a template or changing the activity', async () => {
    const test = librarySetup(), before = JSON.stringify(test.layout);
    await screen.findByRole('button', { name: '添加Rehearsal Model 0' });
    test.props.openTabRequest = { serial: 1, tab: 'presets' };
    test.update();
    expect(screen.getByRole('tab', { name: '场景模板' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.queryByRole('combobox', { name: '现场灯光' })).toBeNull();
    expect(test.placeCatalogItem).not.toHaveBeenCalled();
    expect(test.onLoadPreset).not.toHaveBeenCalled();
    expect(loadScenePreset).not.toHaveBeenCalled();
    expect(test.actions.applyLayout).not.toHaveBeenCalled();
    expect(JSON.stringify(test.layout)).toBe(before);
    fireEvent.click(screen.getByRole('tab', { name: '物料库' }));
    test.props.openTabRequest = { serial: 1, tab: 'presets' };
    test.update();
    expect(screen.getByRole('tab', { name: '物料库' }).getAttribute('aria-selected')).toBe('true');
    // 图层不适合当前页面，抽屉里只有「物料库 / 生成物件 / 环境预览 / 场景模板」四档。
    expect(screen.queryByRole('tab', { name: '图层' })).toBeNull();
    expect(loadOnlineModels).toHaveBeenCalledTimes(1);
  });

  it('生成物件图标只列本机模型，点击后与线上物料走同一条摆放', async () => {
    localStorage.clear();
    rememberAholoAsset({ assetId: GENERATED_ID, kind: 'glb', name: '一张白色圆桌', bytes: 6_433_368, savedAt: 1, taskid: '4475964' });
    rememberAholoAsset({ assetId: '00000000-0000-4000-8000-000000000000', kind: 'spz', name: '场地扫描', bytes: 20_000_000, savedAt: 2 });
    vi.mocked(loadStoredAholoCatalogItem).mockResolvedValue(GENERATED);
    const test = librarySetup();
    await screen.findByRole('button', { name: '添加Rehearsal Model 0' });
    fireEvent.click(screen.getByRole('tab', { name: '生成物件' }));
    expect(screen.getByRole('tab', { name: '生成物件' }).getAttribute('aria-selected')).toBe('true');
    fireEvent.click(await screen.findByRole('button', { name: '添加一张白色圆桌' }));
    await waitFor(() => expect(test.placeCatalogItem).toHaveBeenCalledWith(GENERATED));
    expect(loadStoredAholoCatalogItem).toHaveBeenCalledWith(GENERATED_ID);
    expect(test.selectOnly).toHaveBeenCalledWith('placed-rehearsal-item', { keepPanel: true });
    // 场景点云是环境，不是能摆的物料。
    expect(screen.queryByRole('button', { name: '添加场地扫描' })).toBeNull();
  });

  it('环境预览图标只列本机 3DGS 场景，点击交给预览并把正在预览的那条标出来', async () => {
    localStorage.clear();
    rememberAholoAsset({ assetId: SCENE_ID, kind: 'spz', name: '午后咖啡馆', bytes: 20_000_000, savedAt: 1 });
    rememberAholoAsset({ assetId: GENERATED_ID, kind: 'glb', name: '一张白色圆桌', bytes: 6_433_368, savedAt: 2 });
    const test = librarySetup();
    await screen.findByRole('button', { name: '添加Rehearsal Model 0' });
    fireEvent.click(screen.getByRole('tab', { name: '环境预览' }));
    const card = await screen.findByRole('button', { name: '预览午后咖啡馆' });
    // 物件模型有自己的入口，不该混进环境列表。
    expect(screen.queryByRole('button', { name: '预览一张白色圆桌' })).toBeNull();
    // 仓库留档的那几段场景不读浏览器记录，换一台机器也还在这一格里。
    expect(screen.getByRole('button', { name: '预览小型发布会场地（样例·非本场）' })).not.toBeNull();
    // 还没预览就不许出现「退出预览」，也不许有一条假装成功的状态行。
    expect(screen.queryByRole('button', { name: '退出预览' })).toBeNull();
    expect(card.getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(card);
    expect(test.environment.onStart).toHaveBeenCalledWith(SCENE_ID);

    test.environment.preview = { status: 'ready', assetId: SCENE_ID, name: '午后咖啡馆', splats: 1_234_567 };
    test.update();
    expect(screen.getByRole('button', { name: '预览午后咖啡馆' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('status').textContent).toContain('1,234,567 个高斯点');
    fireEvent.click(screen.getByRole('button', { name: '退出预览' }));
    expect(test.environment.onStop).toHaveBeenCalled();
  });

  it('keeps category, search, pagination and the scrolling row through tabs, collapse and 2D', async () => {
    const test = librarySetup();
    await screen.findByRole('button', { name: '添加Rehearsal Model 0' });
    fireEvent.click(screen.getByRole('button', { name: /^座椅/ }));
    fireEvent.click(screen.getByRole('tab', { name: '物料库' }));
    expect(screen.getByRole('button', { name: /^座椅/ }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.change(screen.getByRole('textbox', { name: /搜索/ }), { target: { value: 'Rehearsal Model' } });
    fireEvent.click(screen.getByRole('button', { name: /^再显示/ }));
    expect(tiles()).toHaveLength(30);
    const input = screen.getByRole('textbox', { name: /搜索/ }) as HTMLInputElement;
    const row = test.container.querySelector('.sc-material-rail')!;
    row.scrollLeft = 175;
    fireEvent.click(screen.getByRole('tab', { name: '场景模板' }));
    test.update({ hidden: true, view: makeViewSettings({ view2D: true }) });
    expect(test.container.querySelector('.sc-material-rail')).toBe(row);
    test.update({ hidden: false, view: makeViewSettings({ view2D: true }) });
    fireEvent.click(screen.getByRole('tab', { name: '物料库' }));
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
    expect((tile as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('tab', { name: '场景模板' }));
    test.update({ hidden: true });
    test.update({ hidden: false });
    fireEvent.click(screen.getByRole('tab', { name: '物料库' }));
    expect(screen.getByRole('button', { name: '添加Rehearsal Model 0' })).toBe(tile);
    expect((tile as HTMLButtonElement).disabled).toBe(true);
    expect(loadOnlineModels).toHaveBeenCalledTimes(1);
    expect(ensureGlbAsset).toHaveBeenCalledTimes(1);
    await act(async () => { finish(); });
    await waitFor(() => expect(test.placeCatalogItem).toHaveBeenCalledTimes(1));
    // 放置只选中，不掀属性面板（keepPanel）。
    expect(test.selectOnly).toHaveBeenCalledWith('placed-rehearsal-item', { keepPanel: true });
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
    expect(document.documentElement.style.getPropertyValue('--sc-shelf-height')).toBe('212px');
    fireEvent.keyDown(grip, { key: 'ArrowUp' });
    expect(document.documentElement.style.getPropertyValue('--sc-shelf-height')).toBe('236px');
    expect(window.localStorage.getItem('scendance-shelf-height')).toBe('236');
    fireEvent.keyDown(grip, { key: 'End' });
    expect(document.documentElement.style.getPropertyValue('--sc-shelf-height')).toBe('476px');
    fireEvent.keyDown(grip, { key: 'Home' });
    expect(window.localStorage.getItem('scendance-shelf-height')).toBe('176');
    expect(test.placeCatalogItem).not.toHaveBeenCalled();
    window.localStorage.clear();
  });
});


describe('ScendanceViewTools design column', () => {
  function renderTools(view = makeViewSettings(), onExportImage = vi.fn()) {
    const values = contexts(makeLayout(), view), onApplyPreset = vi.fn(), onFit = vi.fn(), onZoom = vi.fn();
    render(<Providers values={values}><ScendanceViewTools showAtmosphere onApplyPreset={onApplyPreset} onFit={onFit} onZoom={onZoom} onExportImage={onExportImage}/></Providers>);
    return { values, onApplyPreset, onFit, onZoom, onExportImage, rail: screen.getByRole('navigation', { name: '工具' }) };
  }

  it('renders one right-edge island of five round tools and tucks the rest into 视图', () => {
    const { values, rail } = renderTools();
    expect(rail.id).toBe('tool-column');
    // 室内常驻：选择 / 2D·3D / 看全场 / 俯视 / 人视 / 尺寸 / 网格 / 更多 / 氛围。卫星只在户外。
    expect(within(rail).getAllByRole('button')).toHaveLength(9);
    for (const name of ['选择：点击物料并框选', '2D / 3D', '看全场', '俯视', '人视', '尺寸标注', '网格吸附', '更多工具']) {
      expect(within(rail).getByRole('button', { name })).toBeTruthy();
    }
    expect(rail.querySelector('#tool-satellite')).toBeNull();
    expect(within(rail).getByRole('button', { name: '更多工具' }).getAttribute('aria-expanded')).toBe('false');
    // 撤销/重做/缩放/导出和整体在省略号里；俯视、人视、网格在右轨。
    for (const id of ['tool-undo', 'tool-zoom-out', 'tool-export']) {
      expect(rail.querySelector(`#${id}`)).toBeNull();
    }
    expect(rail.querySelector('#tool-grid')).toBeTruthy();
    expect(rail.querySelector('#tool-top')).toBeTruthy();
    expect(rail.querySelector('#tool-front')).toBeTruthy();
    expect(rail.querySelector('#tool-more')).toBeTruthy();
    // 氛围条仍是收起的一颗，点开才铺出四条。
    expect(screen.queryByRole('menuitemcheckbox', { name: '漫游' })).toBeNull();
    expect(screen.getByRole('button', { name: /氛围/ }).getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: /氛围/ }));
    expect(screen.getByRole('button', { name: /氛围/ }).getAttribute('aria-expanded')).toBe('true');
    // 氛围四条在竖列 rail 的弹出菜单里。
    expect(rail.querySelector('.sc-atmosphere-group')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /物料库|素材架/ })).toBeNull();
    const dimension = within(rail).getByRole('button', { name: '2D / 3D' });
    expect(dimension.querySelector('svg')).toBeTruthy();
    expect(dimension.textContent).not.toMatch(/2D|3D/);
    fireEvent.click(dimension);
    expect(values.toggle).toHaveBeenCalledWith('view2D');
  });

  it('still reaches every tucked tool through 视图 and closes it on Escape', () => {
    const { values, rail, onApplyPreset, onFit, onZoom, onExportImage } = renderTools();
    // 看全场、尺寸是常驻圆钮；其余收进「视图」菜单。
    fireEvent.click(within(rail).getByRole('button', { name: '看全场' }));
    expect(onFit).toHaveBeenCalledTimes(1);
    fireEvent.click(within(rail).getByRole('button', { name: '尺寸标注' }));
    expect(values.toggle).toHaveBeenCalledWith('showMeasurements');
    fireEvent.click(within(rail).getByRole('button', { name: '俯视' }));
    expect(onApplyPreset).toHaveBeenCalledWith('top');
    fireEvent.click(within(rail).getByRole('button', { name: '人视' }));
    expect(onApplyPreset).toHaveBeenCalledWith('front');
    fireEvent.click(within(rail).getByRole('button', { name: '网格吸附' }));
    expect(values.toggle).toHaveBeenCalledWith('snapToGrid');
    fireEvent.click(within(rail).getByRole('button', { name: '更多工具' }));
    expect(within(rail).getByRole('button', { name: '更多工具' }).getAttribute('aria-expanded')).toBe('true');
    expect(within(rail).getByRole('menuitemradio', { name: '整体' })).toBeTruthy();
    expect(within(rail).queryByRole('menuitemradio', { name: '人视' })).toBeNull();
    for (const name of ['撤销', '重做', '缩小', '放大', '导出效果图']) {
      expect(within(rail).getByRole('menuitem', { name })).toBeTruthy();
    }
    expect(within(rail).queryByRole('menuitemradio', { name: '俯视' })).toBeNull();
    expect(within(rail).queryByRole('menuitemcheckbox', { name: '网格吸附' })).toBeNull();
    fireEvent.click(within(rail).getByRole('menuitem', { name: '撤销' }));
    fireEvent.click(within(rail).getByRole('menuitem', { name: '重做' }));
    fireEvent.click(within(rail).getByRole('menuitem', { name: '缩小' }));
    fireEvent.click(within(rail).getByRole('menuitem', { name: '放大' }));
    expect(values.history.undo).toHaveBeenCalledTimes(1);
    expect(values.history.redo).toHaveBeenCalledTimes(1);
    expect(onZoom.mock.calls).toEqual([['-'], ['+']]);
    expect(values.toggle.mock.calls).toEqual([['showMeasurements'], ['snapToGrid']]);
    expect(onExportImage).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(within(rail).queryByRole('menuitem', { name: '撤销' })).toBeNull();
    expect(within(rail).getByRole('button', { name: '更多工具' }).getAttribute('aria-expanded')).toBe('false');
  });

  it('exports a render from the 视图 popover with the chosen frame and quality', async () => {
    const onExportImage = vi.fn().mockResolvedValue(true);
    const { rail } = renderTools(makeViewSettings(), onExportImage);
    fireEvent.click(within(rail).getByRole('button', { name: '更多工具' }));
    fireEvent.click(within(rail).getByRole('menuitem', { name: '导出效果图' }));
    const dialog = screen.getByRole('dialog', { name: '导出效果图选项' });
    expect(dialog.textContent).toContain('导出效果图');
    fireEvent.click(screen.getByRole('button', { name: '整体' }));
    fireEvent.click(screen.getByRole('button', { name: '超清 3×' }));
    fireEvent.click(screen.getByRole('button', { name: '导出 PNG' }));
    await waitFor(() => expect(onExportImage).toHaveBeenCalledWith({ view: 'iso', scale: 3 }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '导出效果图选项' })).toBeNull());
  });

  it('defaults to the current view at 2× and marks the choices active', async () => {
    const onExportImage = vi.fn().mockResolvedValue(true);
    const { rail } = renderTools(makeViewSettings(), onExportImage);
    fireEvent.click(within(rail).getByRole('button', { name: '更多工具' }));
    fireEvent.click(within(rail).getByRole('menuitem', { name: '导出效果图' }));
    expect((screen.getByRole('button', { name: '跟随当前' }) as HTMLButtonElement).getAttribute('aria-pressed')).toBe('true');
    expect((screen.getByRole('button', { name: '高清 2×' }) as HTMLButtonElement).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: '导出 PNG' }));
    await waitFor(() => expect(onExportImage).toHaveBeenCalledWith({ view: 'current', scale: 2 }));
  });

  it('disables zoom in 2D and hides atmosphere when requested', () => {
    const values = contexts(makeLayout(), makeViewSettings({ view2D: true }));
    render(<Providers values={values}><ScendanceViewTools showAtmosphere={false} onApplyPreset={vi.fn()} onFit={vi.fn()} onZoom={vi.fn()}/></Providers>);
    const rail = screen.getByRole('navigation', { name: '工具' });
    expect((within(rail).getByRole('button', { name: '看全场' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(rail).getByRole('button', { name: '更多工具' }));
    for (const name of ['缩小', '放大']) {
      expect((within(rail).getByRole('menuitem', { name }) as HTMLButtonElement).disabled).toBe(true);
    }
    expect(screen.queryByRole('group', { name: '氛围' })).toBeNull();
    expect(screen.queryByRole('button', { name: '漫游' })).toBeNull();
  });

  it('keeps the atmosphere controls in view once something is actually changed', () => {
    // 收起只收「没在用的」：开了雨就不许藏，否则找不到地方关掉。
    const values = contexts(makeLayout(), makeViewSettings({ weather: 'rain' }));
    render(<Providers values={values}><ScendanceViewTools showAtmosphere onApplyPreset={vi.fn()} onFit={vi.fn()} onZoom={vi.fn()}/></Providers>);
    expect(screen.getByRole('button', { name: /氛围/ }).getAttribute('aria-expanded')).toBe('true');
    // 天气按钮嵌在氛围弹层里，显示当前天气「降雨」
    expect(screen.getByRole('menuitem', { name: '降雨' })).toBeTruthy();
  });

  it('keeps rail wheel browsing from reaching the canvas zoom handler', () => {
    const values = contexts(), onCanvasWheel = vi.fn();
    render(<Providers values={values}><div onWheel={onCanvasWheel}><ScendanceViewTools onApplyPreset={vi.fn()} onFit={vi.fn()} onZoom={vi.fn()}/></div></Providers>);
    fireEvent.wheel(screen.getByRole('navigation', { name: '工具' }), { deltaY: 80 });
    expect(onCanvasWheel).not.toHaveBeenCalled();
  });
});

describe('ScendanceViewTools atmosphere menus', () => {
  it('wires 漫游 / 人群 / 天气 / 时段', () => {
    const values = contexts();
    render(<Providers values={values}><ScendanceViewTools showAtmosphere onApplyPreset={vi.fn()} onFit={vi.fn()} onZoom={vi.fn()}/></Providers>);
    fireEvent.click(screen.getByRole('button', { name: /氛围/ }));
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: '漫游' }));
    const walk = values.setView.mock.calls.at(-1)![0] as (view: ViewSettings) => ViewSettings;
    expect(walk(makeViewSettings()).walkthroughMode).toBe(true);
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: '人群' }));
    expect(values.toggle).toHaveBeenCalledWith('showNpcs');
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

describe('ScendanceViewTools satellite ground', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  function legacySaltShell() {
    const polygon = [
      { lng: 120.53, lat: 30.40 },
      { lng: 120.548, lat: 30.40 },
      { lng: 120.548, lat: 30.409 },
      { lng: 120.53, lat: 30.409 },
    ];
    const { layout } = createVenueFromPick(makeLayout(), {
      name: '盐官潮乐之城', location: '海宁盐官', polygon,
    });
    const legacy = { ...layout };
    delete legacy.satelliteGroundRef;
    delete legacy.floorPlanImage;
    delete legacy.mapGroundPolygon;
    return legacy;
  }

  it('does not put a satellite button on an ordinary indoor room', () => {
    render(<Providers values={contexts()}><ScendanceViewTools onApplyPreset={vi.fn()} onFit={vi.fn()} onZoom={vi.fn()}/></Providers>);
    expect(screen.queryByRole('button', { name: /卫星贴地/ })).toBeNull();
  });

  it('shows tool-satellite for a planning-zone title even when the shell is not a polygon', async () => {
    vi.stubEnv('NEXT_PUBLIC_AMAP_KEY', '');
    vi.stubEnv('NEXT_PUBLIC_AMAP_STATIC_KEY', '');
    const layout = makeLayout({ name: '盐官潮乐之城 · 规划区 84.6×100m（真实范围 846×1000m）' });
    const values = contexts(layout);
    render(<Providers values={values}><ScendanceViewTools onApplyPreset={vi.fn()} onFit={vi.fn()} onZoom={vi.fn()}/></Providers>);
    const button = screen.getByRole('button', { name: /卫星贴地，已打开/ });
    expect(button.id).toBe('tool-satellite');
    expect(button.getAttribute('aria-pressed')).toBe('true');
    await waitFor(() => expect(values.actions.applyLayout).toHaveBeenCalled());
    const applied = values.actions.applyLayout.mock.calls.at(-1)![0] as typeof layout;
    expect(applied.satelliteGroundRef).toBe(true);
    expect(String(applied.floorPlanImage)).toContain('satellite-ground-ref');
  });

  it('keeps tool-satellite visible when the layer was explicitly turned off', () => {
    const layout = makeLayout({ name: '盐官潮乐之城 · 规划区 84.6×100m', satelliteGroundRef: false });
    render(<Providers values={contexts(layout)}><ScendanceViewTools onApplyPreset={vi.fn()} onFit={vi.fn()} onZoom={vi.fn()}/></Providers>);
    const button = screen.getByRole('button', { name: /卫星贴地，已关闭/ });
    expect(button.id).toBe('tool-satellite');
    expect(button.getAttribute('aria-pressed')).toBe('false');
  });

  it('defaults the satellite toggle on for a map shell and fills a missing image', async () => {
    vi.stubEnv('NEXT_PUBLIC_AMAP_KEY', 'js-key');
    vi.stubEnv('NEXT_PUBLIC_AMAP_STATIC_KEY', 'test-static');
    const bytes = new Uint8Array(120);
    bytes[0] = 0xff;
    bytes[1] = 0xd8;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => 'image/jpeg' },
      arrayBuffer: async () => bytes.buffer,
    }));
    const previousAmap = window.AMap;
    window.AMap = {
      PlaceSearch: class {
        search(_query: string, cb: (status: string, result: unknown) => void) {
          cb('complete', { poiList: { pois: [{ location: { lng: 120.54, lat: 30.405 } }] } });
        }
      },
    };
    try {
    const values = contexts(legacySaltShell());
    render(<Providers values={values}><ScendanceViewTools onApplyPreset={vi.fn()} onFit={vi.fn()} onZoom={vi.fn()}/></Providers>);
    const button = screen.getByRole('button', { name: /卫星贴地，已打开/ });
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(button.classList.contains('is-active')).toBe(true);
    await waitFor(() => expect(values.actions.applyLayout).toHaveBeenCalled());
    const applied = values.actions.applyLayout.mock.calls.at(-1)![0] as ReturnType<typeof legacySaltShell>;
    expect(applied.satelliteGroundRef).toBe(true);
    expect(applied.floorPlanImage).toContain('127.0.0.1:3199/amap-static');
    expect(applied.floorPlanImage).toContain('satellite-ground-ref');
    expect(applied.floorPlanImage).not.toContain('test-static');
    expect(applied.mapGroundPolygon?.length).toBeGreaterThanOrEqual(3);
    } finally {
      if (previousAmap) window.AMap = previousAmap;
      else delete window.AMap;
    }
  });

  it('turns satellite off to a plain ground flag and back on without dropping the image', () => {
    const image = 'http://127.0.0.1:3199/amap-static?location=120.54,30.405&zoom=16&size=768*768&scale=2&x-ref=satellite-ground-ref';
    const on = { ...legacySaltShell(), satelliteGroundRef: true as const, floorPlanImage: image, mapGroundPolygon: [
      { lng: 120.53, lat: 30.40 }, { lng: 120.54, lat: 30.40 }, { lng: 120.54, lat: 30.41 },
    ] };
    const values = contexts(on);
    const { rerender } = render(<Providers values={values}><ScendanceViewTools onApplyPreset={vi.fn()} onFit={vi.fn()} onZoom={vi.fn()}/></Providers>);
    fireEvent.click(screen.getByRole('button', { name: /卫星贴地，已打开/ }));
    const hidden = values.actions.applyLayout.mock.calls.at(-1)![0] as typeof on;
    expect(hidden.satelliteGroundRef).toBe(false);
    expect(hidden.floorPlanImage).toBe(image);
    const offValues = contexts(hidden);
    rerender(<Providers values={offValues}><ScendanceViewTools onApplyPreset={vi.fn()} onFit={vi.fn()} onZoom={vi.fn()}/></Providers>);
    const offButton = screen.getByRole('button', { name: /卫星贴地，已关闭/ });
    expect(offButton.getAttribute('aria-pressed')).toBe('false');
    expect(offButton.classList.contains('is-active')).toBe(false);
    fireEvent.click(offButton);
    const restored = offValues.actions.applyLayout.mock.calls.at(-1)![0] as typeof on;
    expect(restored.satelliteGroundRef).toBe(true);
    expect(restored.floorPlanImage).toBe(image);
  });
});

describe('MaterialDrawerHandle', () => {
  it('labels the bottom handle MATERIALS and toggles independently', () => {
    const onToggle = vi.fn();
    const buttonRef = createRef<HTMLButtonElement>();
    const { rerender } = render(<MaterialDrawerHandle open={false} onToggle={onToggle} buttonRef={buttonRef}/>);
    const button = screen.getByRole('button', { name: '展开物料库' });
    expect(buttonRef.current).toBe(button);
    // 底条是分区切换：主视觉是物料图标，中文名留在 aria-label。
    expect(button.querySelector('svg')).toBeTruthy();
    expect(button.textContent ?? '').not.toMatch(/物料/);
    expect(button.getAttribute('aria-controls')).toBe('workbench-material-shelf');
    fireEvent.click(button);
    expect(onToggle).toHaveBeenCalledTimes(1);
    rerender(<MaterialDrawerHandle open onToggle={onToggle} buttonRef={buttonRef}/>);
    expect(screen.getByRole('button', { name: '收起物料库' }).getAttribute('aria-expanded')).toBe('true');
  });
});
