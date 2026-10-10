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
import { ScendanceLibrary, ScendanceViewTools } from './scendance-workspace';
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
    expect(screen.getByRole('combobox', { name: '灯光氛围' })).toBeTruthy();
    expect(test.placeCatalogItem).not.toHaveBeenCalled();
    expect(test.onLoadPreset).not.toHaveBeenCalled();
    expect(loadScenePreset).not.toHaveBeenCalled();
    expect(test.actions.applyLayout).not.toHaveBeenCalled();
    expect(JSON.stringify(test.layout)).toBe(before);
    fireEvent.click(screen.getByRole('tab', { name: '物料库' }));
    test.props.openTabRequest = { serial: 1, tab: 'presets' };
    test.update();
    expect(screen.getByRole('tab', { name: '物料库' }).getAttribute('aria-selected')).toBe('true');
    test.props.openTabRequest = { serial: 2, tab: 'layers' };
    test.update();
    expect(screen.getByRole('region', { name: '方案与图层' })).toBeTruthy();
    expect(loadOnlineModels).toHaveBeenCalledTimes(1);
  });

  it('keeps category, search, pagination and the scrolling row through tabs, collapse and 2D', async () => {
    const test = librarySetup();
    await screen.findByRole('button', { name: '添加Rehearsal Model 0' });
    fireEvent.click(screen.getByRole('button', { name: /^座椅/ }));
    fireEvent.click(screen.getByRole('tab', { name: '图层' }));
    fireEvent.click(screen.getByRole('tab', { name: '物料库' }));
    expect(screen.getByRole('button', { name: /^座椅/ }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.change(screen.getByRole('textbox', { name: /搜索/ }), { target: { value: 'Rehearsal Model' } });
    fireEvent.click(screen.getByRole('button', { name: /^再显示/ }));
    expect(tiles()).toHaveLength(30);
    const input = screen.getByRole('textbox', { name: /搜索/ }) as HTMLInputElement;
    const row = test.container.querySelector('.sc-material-grid')!;
    row.scrollLeft = 175;
    fireEvent.click(screen.getByRole('tab', { name: '场景模板' }));
    test.update({ hidden: true, view: makeViewSettings({ view2D: true }) });
    expect(test.container.querySelector('.sc-material-grid')).toBe(row);
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
    expect(test.selectOnly).toHaveBeenCalledWith('placed-rehearsal-item');
    expect(test.capturePlacement).toHaveBeenCalledTimes(1);
    expect(test.assertCurrent).toHaveBeenCalled();
    expect(test.dispose).toHaveBeenCalledTimes(1);
  });

  it('closes only through its supplied close callback', async () => {
    const test = librarySetup();
    await screen.findByRole('button', { name: '添加Rehearsal Model 0' });
    fireEvent.click(screen.getByRole('button', { name: '关闭素材架' }));
    expect(test.onClose).toHaveBeenCalledTimes(1);
    expect(test.placeCatalogItem).not.toHaveBeenCalled();
    expect(test.actions.applyLayout).not.toHaveBeenCalled();
    expect(test.onLoadPreset).not.toHaveBeenCalled();
  });
});

describe('ScendanceViewTools material toggle', () => {
  it('keeps the shelf toggle independent from view, history and screenshot actions', () => {
    const values = contexts(), onToggleMaterials = vi.fn();
    const onApplyPreset = vi.fn(), onFit = vi.fn(), onZoom = vi.fn(), onScreenshot = vi.fn();
    const materialsButtonRef = createRef<HTMLButtonElement>();
    const node = (materialsOpen: boolean) => <Providers values={values}><ScendanceViewTools {...{ onApplyPreset, onFit, onZoom, onScreenshot, onToggleMaterials, materialsButtonRef, materialsOpen }}/></Providers>;
    const { rerender, container } = render(node(false));
    const button = screen.getByRole('button', { name: '打开素材架' });
    expect(materialsButtonRef.current).toBe(button);
    expect(button.textContent).toContain('素材');
    expect(button.getAttribute('aria-controls')).toBe('workbench-material-shelf');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(button);
    expect(onToggleMaterials).toHaveBeenCalledTimes(1);
    expect(values.setView).not.toHaveBeenCalled();
    expect(values.toggle).not.toHaveBeenCalled();
    expect(onApplyPreset).not.toHaveBeenCalled();
    expect(values.history.undo).not.toHaveBeenCalled();
    rerender(node(true));
    expect(screen.getByRole('button', { name: '收起素材架' }).getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: '撤销' }));
    fireEvent.click(screen.getByRole('button', { name: '重做' }));
    fireEvent.click(screen.getByRole('button', { name: '导出当前画面' }));
    fireEvent.click(screen.getByRole('button', { name: '俯视' }));
    fireEvent.click(screen.getByRole('button', { name: '2D' }));
    fireEvent.click(screen.getByRole('button', { name: '缩小' }));
    fireEvent.click(screen.getByRole('button', { name: '适应场地' }));
    fireEvent.click(screen.getByRole('button', { name: '放大' }));
    fireEvent.click(screen.getByRole('button', { name: '网格吸附' }));
    fireEvent.click(screen.getByRole('button', { name: '显示尺寸' }));
    expect(values.history.undo).toHaveBeenCalledTimes(1);
    expect(values.history.redo).toHaveBeenCalledTimes(1);
    expect(onScreenshot).toHaveBeenCalledTimes(1);
    expect(onApplyPreset).toHaveBeenCalledWith('top');
    expect(values.setView).toHaveBeenCalledTimes(1);
    const update = values.setView.mock.calls[0]![0] as (view: ViewSettings) => ViewSettings;
    expect(update(makeViewSettings({ view2D: true })).view2D).toBe(false);
    expect(values.toggle.mock.calls).toEqual([['view2D'], ['snapToGrid'], ['showMeasurements']]);
    expect(onZoom.mock.calls).toEqual([['-'], ['+']]);
    expect(onFit).toHaveBeenCalledTimes(1);
    expect(onToggleMaterials).toHaveBeenCalledTimes(1);
    expect(container.querySelectorAll('.sc-view-tools')).toHaveLength(1);
  });

  it('preserves callers that provide no shelf control and disables zoom in 2D', () => {
    const values = contexts(makeLayout(), makeViewSettings({ view2D: true }));
    render(<Providers values={values}><ScendanceViewTools onApplyPreset={vi.fn()} onFit={vi.fn()} onZoom={vi.fn()}/></Providers>);
    expect(screen.queryByRole('button', { name: /素材架/ })).toBeNull();
    for (const name of ['缩小', '适应场地', '放大']) {
      expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true);
    }
    expect(screen.getByRole('button', { name: '2D' }).className).toContain('is-active');
  });
});
