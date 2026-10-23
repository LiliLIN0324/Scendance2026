// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createRef, type ComponentProps, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RoomEditorProvider, type RoomEditorContextValue } from '../contexts/room-editor-context';
import { SelectionProvider, type SelectionContextValue } from '../contexts/selection-context';
import { makeLayout, makeViewSettings } from '../lib/__testfixtures__/fixtures';
import { buildOnlineModelIndex, loadOnlineModels } from '../lib/online-models';
import { ensureGlbAsset } from '../three/glb-assets';
import { loadScenePreset } from '../three/scene-presets';
import { MaterialDrawerHandle, ScendanceLibrary, ScendanceViewTools } from './scendance-workspace';
import type { OnlineModel } from '../lib/online-models';
import type { ViewSettings } from '../lib/types';

// The shelf keeps its real browser component; only catalogue/GLB network loads
// are stubbed, so losing a mounted filter, reveal window or download is visible.
vi.mock('../lib/online-models', async importOriginal => ({
  ...(await importOriginal<typeof import('../lib/online-models')>()),
  loadOnlineModels: vi.fn(),
}));
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

beforeEach(() => {
  vi.mocked(loadOnlineModels).mockResolvedValue(buildOnlineModelIndex(MODELS));
  vi.mocked(ensureGlbAsset).mockResolvedValue(undefined);
});
afterEach(() => { cleanup(); vi.resetAllMocks(); });

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
  const props: ComponentProps<typeof ScendanceLibrary> = { placeCatalogItem, onLoadPreset, onClose, capturePlacement };
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
  it('opens the requested template tab without applying a template or changing the activity', async () => {
    const test = librarySetup(), before = JSON.stringify(test.layout);
    await screen.findByRole('button', { name: '添加Rehearsal Model 0' });
    test.props.openTabRequest = { serial: 1, tab: 'presets' };
    test.update();
    expect(screen.getByRole('tab', { name: '场景模板' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('combobox', { name: '现场灯光' })).toBeTruthy();
    expect(test.placeCatalogItem).not.toHaveBeenCalled();
    expect(test.onLoadPreset).not.toHaveBeenCalled();
    expect(loadScenePreset).not.toHaveBeenCalled();
    expect(test.actions.applyLayout).not.toHaveBeenCalled();
    expect(JSON.stringify(test.layout)).toBe(before);
    fireEvent.click(screen.getByRole('tab', { name: '物料库' }));
    test.props.openTabRequest = { serial: 1, tab: 'presets' };
    test.update();
    expect(screen.getByRole('tab', { name: '物料库' }).getAttribute('aria-selected')).toBe('true');
    // 图层不适合当前页面，抽屉里只剩「物料库 / 场景模板」两档。
    expect(screen.queryByRole('tab', { name: '图层' })).toBeNull();
    expect(loadOnlineModels).toHaveBeenCalledTimes(1);
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
  it('renders the tool column plus the atmosphere strip and keeps materials outside both', () => {
    const values = contexts(), onApplyPreset = vi.fn(), onFit = vi.fn(), onZoom = vi.fn(), onExportImage = vi.fn();
    render(<Providers values={values}><ScendanceViewTools showAtmosphere onApplyPreset={onApplyPreset} onFit={onFit} onZoom={onZoom} onExportImage={onExportImage}/></Providers>);
    const rail = screen.getByRole('navigation', { name: '视角与编辑工具' });
    expect(rail.id).toBe('tool-column');
    for (const name of ['撤销', '重做', '导出效果图', '网格吸附', '显示尺寸', '全屏', '缩小', '放大', '漫游', '人群', '晴朗', '正午']) {
      expect(screen.getByRole('button', { name })).toBeTruthy();
    }
    // 氛围四条不在竖列里，否则工具列会一路压到抽屉上。
    expect(rail.querySelector('.sc-atmosphere-group')).toBeNull();
    expect(screen.queryByRole('button', { name: /物料库|素材架/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '撤销' }));
    fireEvent.click(screen.getByRole('button', { name: '重做' }));
    fireEvent.click(screen.getByRole('button', { name: '视角：整体 / 俯视 / 人视' }));
    fireEvent.click(screen.getByRole('option', { name: '俯视' }));
    expect(values.history.undo).toHaveBeenCalledTimes(1);
    expect(values.history.redo).toHaveBeenCalledTimes(1);
    expect(onApplyPreset).toHaveBeenCalledWith('top');
    fireEvent.click(screen.getByRole('button', { name: '2D / 3D' }));
    fireEvent.click(screen.getByRole('button', { name: '缩小' }));
    fireEvent.click(screen.getByRole('button', { name: '全屏' }));
    fireEvent.click(screen.getByRole('button', { name: '放大' }));
    fireEvent.click(screen.getByRole('button', { name: '网格吸附' }));
    fireEvent.click(screen.getByRole('button', { name: '显示尺寸' }));
    expect(values.toggle.mock.calls).toEqual([['view2D'], ['snapToGrid'], ['showMeasurements']]);
    expect(onZoom.mock.calls).toEqual([['-'], ['+']]);
    expect(onFit).toHaveBeenCalledTimes(1);
    expect(onExportImage).not.toHaveBeenCalled();
  });

  it('exports a render from the popover with the chosen frame and quality', async () => {
    const values = contexts(), onExportImage = vi.fn().mockResolvedValue(true);
    render(<Providers values={values}><ScendanceViewTools showAtmosphere onApplyPreset={vi.fn()} onFit={vi.fn()} onZoom={vi.fn()} onExportImage={onExportImage}/></Providers>);
    fireEvent.click(screen.getByRole('button', { name: '导出效果图' }));
    const dialog = screen.getByRole('dialog', { name: '导出效果图选项' });
    expect(dialog.textContent).toContain('导出效果图');
    fireEvent.click(screen.getByRole('button', { name: '整体' }));
    fireEvent.click(screen.getByRole('button', { name: '超清 3×' }));
    fireEvent.click(screen.getByRole('button', { name: '导出 PNG' }));
    await waitFor(() => expect(onExportImage).toHaveBeenCalledWith({ view: 'iso', scale: 3 }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '导出效果图选项' })).toBeNull());
  });

  it('defaults to the current view at 2× and marks the choices active', async () => {
    const values = contexts(), onExportImage = vi.fn().mockResolvedValue(true);
    render(<Providers values={values}><ScendanceViewTools showAtmosphere onApplyPreset={vi.fn()} onFit={vi.fn()} onZoom={vi.fn()} onExportImage={onExportImage}/></Providers>);
    fireEvent.click(screen.getByRole('button', { name: '导出效果图' }));
    expect((screen.getByRole('button', { name: '跟随当前' }) as HTMLButtonElement).getAttribute('aria-pressed')).toBe('true');
    expect((screen.getByRole('button', { name: '高清 2×' }) as HTMLButtonElement).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: '导出 PNG' }));
    await waitFor(() => expect(onExportImage).toHaveBeenCalledWith({ view: 'current', scale: 2 }));
  });

  it('disables zoom in 2D and hides atmosphere when requested', () => {
    const values = contexts(makeLayout(), makeViewSettings({ view2D: true }));
    render(<Providers values={values}><ScendanceViewTools showAtmosphere={false} onApplyPreset={vi.fn()} onFit={vi.fn()} onZoom={vi.fn()}/></Providers>);
    for (const name of ['缩小', '全屏', '放大']) {
      expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true);
    }
    expect(screen.queryByRole('group', { name: '氛围' })).toBeNull();
    expect(screen.queryByRole('button', { name: '漫游' })).toBeNull();
  });

  it('keeps rail wheel browsing from reaching the canvas zoom handler', () => {
    const values = contexts(), onCanvasWheel = vi.fn();
    render(<Providers values={values}><div onWheel={onCanvasWheel}><ScendanceViewTools onApplyPreset={vi.fn()} onFit={vi.fn()} onZoom={vi.fn()}/></div></Providers>);
    fireEvent.wheel(screen.getByRole('navigation', { name: '视角与编辑工具' }), { deltaY: 80 });
    expect(onCanvasWheel).not.toHaveBeenCalled();
  });
});

describe('ScendanceViewTools atmosphere menus', () => {
  it('wires 漫游 / 人群 / 天气 / 时段', () => {
    const values = contexts();
    render(<Providers values={values}><ScendanceViewTools showAtmosphere onApplyPreset={vi.fn()} onFit={vi.fn()} onZoom={vi.fn()}/></Providers>);
    fireEvent.click(screen.getByRole('button', { name: '漫游' }));
    const walk = values.setView.mock.calls.at(-1)![0] as (view: ViewSettings) => ViewSettings;
    expect(walk(makeViewSettings()).walkthroughMode).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '人群' }));
    expect(values.toggle).toHaveBeenCalledWith('showNpcs');
    fireEvent.click(screen.getByRole('button', { name: '晴朗' }));
    fireEvent.click(screen.getByRole('option', { name: '降雨' }));
    const weather = values.setView.mock.calls.at(-1)![0] as (view: ViewSettings) => ViewSettings;
    expect(weather(makeViewSettings()).weather).toBe('rain');
    fireEvent.click(screen.getByRole('button', { name: '正午' }));
    fireEvent.click(screen.getByRole('option', { name: '室外时段 黄昏' }));
    const time = values.setView.mock.calls.at(-1)![0] as (view: ViewSettings) => ViewSettings;
    expect(time(makeViewSettings()).timeOfDay).toBe(18);
  });
});

describe('MaterialDrawerHandle', () => {
  it('labels the bottom handle 物料库 and toggles independently', () => {
    const onToggle = vi.fn();
    const buttonRef = createRef<HTMLButtonElement>();
    const { rerender } = render(<MaterialDrawerHandle open={false} onToggle={onToggle} buttonRef={buttonRef}/>);
    const button = screen.getByRole('button', { name: '展开物料库' });
    expect(buttonRef.current).toBe(button);
    expect(button.textContent).toContain('物料库');
    expect(button.getAttribute('aria-controls')).toBe('workbench-material-shelf');
    fireEvent.click(button);
    expect(onToggle).toHaveBeenCalledTimes(1);
    rerender(<MaterialDrawerHandle open onToggle={onToggle} buttonRef={buttonRef}/>);
    expect(screen.getByRole('button', { name: '收起物料库' }).getAttribute('aria-expanded')).toBe('true');
  });
});
