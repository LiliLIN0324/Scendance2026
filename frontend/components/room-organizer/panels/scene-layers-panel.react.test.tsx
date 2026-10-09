// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { RoomEditorProvider, SelectionProvider, type RoomEditorContextValue, type SelectionContextValue } from '../contexts';
import { layoutStore, useLayout } from '../hooks/use-layout-store';
import { INITIAL_LAYOUT } from '../lib/initial-layout';
import { addDesign } from '../lib/scene-layers';
import { ensureGlbAsset, getGlbAssetState } from '../three/glb-assets';
import { SceneLayersPanel } from './scene-layers-panel';
import type { RoomLayout } from '../lib/types';
import type { BackendSession } from '@/lib/backend-session';

vi.mock('../three/glb-assets', () => ({ ensureGlbAsset: vi.fn(async () => {}), getGlbAssetState: vi.fn(() => ({ status: 'idle' })), glbAssetKey: (item: {assetId?:string;glbUrl?:string}) => item.assetId ?? item.glbUrl }));

function Workspace({ onPreview, onSelection, controller }: { onPreview?: (layout: RoomLayout | null) => void; onSelection?: SelectionContextValue['selectOnly']; controller?: BackendSession }) {
  const layout = useLayout();
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [extraSelectedIds, setExtraSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const allSelectedIds = new Set(extraSelectedIds); if (selectedItemId) allSelectedIds.add(selectedItemId);
  const editor = { layout, activeFloor: layout.floors[0], activeFloorIndex: 0, actions: layoutStore.getState().actions,
    history: { canUndo: false, undo: vi.fn() } } as unknown as RoomEditorContextValue;
  return <RoomEditorProvider value={editor}><SelectionProvider value={{ selectedItemId, setSelectedItemId, extraSelectedIds, setExtraSelectedIds, allSelectedIds,
    selectedItem: layout.floors[0]!.items.find(i => i.id === selectedItemId) ?? null, selectOnly: (id, options) => { onSelection?.(id, options); setSelectedItemId(id); setExtraSelectedIds(new Set()); } }}><SceneLayersPanel {...(onPreview ? { onPreview } : {})} {...(controller ? { controller } : {})}/></SelectionProvider></RoomEditorProvider>;
}
beforeEach(() => {
  layoutStore.setState({ layout: INITIAL_LAYOUT, activeFloorIndex: 0 });
  vi.mocked(ensureGlbAsset).mockReset().mockResolvedValue(undefined);
  vi.mocked(getGlbAssetState).mockReset().mockReturnValue({ status: 'idle' });
});
afterEach(cleanup);

const modelId = '70000000-0000-4000-8000-000000000001';
function savedModelDesign() {
  const model = { ...INITIAL_LAYOUT, floors: [{ ...INITIAL_LAYOUT.floors[0]!, items: [
    { ...INITIAL_LAYOUT.floors[0]!.items[0]!, type: 'glb-asset' as const, assetId: modelId },
    { ...INITIAL_LAYOUT.floors[0]!.items[1]!, type: 'glb-asset' as const, assetId: modelId },
  ] }] };
  const base = addDesign(model, { ...INITIAL_LAYOUT, floors: [{ ...INITIAL_LAYOUT.floors[0]!, items: [] }] });
  layoutStore.setState({ layout: base });
  const snapshot = { user: { id: 'test-owner' }, project: { id: 'scene-project' }, sessionId: 'test-session' };
  const listeners = new Set<() => void>();
  const controller = { config: { apiUrl: 'https://scene.example.test' }, getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    authorizeAsset: vi.fn(async () => ({ id: modelId, name: '演练模型', url: 'https://models.example.test/authorized.glb' })) };
  return { base, snapshot, controller, notify: () => { for (const listener of listeners) listener(); } };
}

it('loads an asset-ID-only saved model once before adopting its design', async () => {
  const f = savedModelDesign();
  let finish!: () => void;
  vi.mocked(ensureGlbAsset).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  render(<Workspace controller={f.controller as unknown as BackendSession}/>);
  fireEvent.click(screen.getByRole('button', { name: '原始方案切换' }));
  await waitFor(() => expect(ensureGlbAsset).toHaveBeenCalledOnce());
  expect(f.controller.authorizeAsset).toHaveBeenCalledExactlyOnceWith(modelId);
  expect(layoutStore.getState().layout).toBe(f.base);
  await act(async () => finish());
  await waitFor(() => expect(layoutStore.getState().layout.designBook?.activeId).toBe('original'));
  expect(layoutStore.getState().layout.floors[0]!.items.every(item => item.glbUrl === 'https://models.example.test/authorized.glb')).toBe(true);
});

it.each(['authorization', 'model-load'] as const)('retains the current design on %s failure', async stage => {
  const f = savedModelDesign();
  if (stage === 'authorization') f.controller.authorizeAsset.mockRejectedValue(new Error('无模型访问权限'));
  else vi.mocked(ensureGlbAsset).mockRejectedValue(new Error('模型下载失败'));
  render(<Workspace controller={f.controller as unknown as BackendSession}/>);
  fireEvent.click(screen.getByRole('button', { name: '原始方案切换' }));
  await screen.findByText(stage === 'authorization' ? '无模型访问权限' : '模型下载失败');
  expect(layoutStore.getState().layout).toBe(f.base);
  if (stage === 'authorization') expect(ensureGlbAsset).not.toHaveBeenCalled();
});

it.each(['idle', 'ready'] as const)('uses only an already loaded model when offline, cache=%s', async status => {
  const f = savedModelDesign();vi.mocked(getGlbAssetState).mockReturnValue({ status });
  render(<Workspace/>);
  fireEvent.click(screen.getByRole('button', { name: '原始方案切换' }));
  if (status === 'idle') {
    await screen.findByText(/请先登录有权访问模型的账号/);
    expect(layoutStore.getState().layout).toBe(f.base);
  } else {
    await waitFor(() => expect(layoutStore.getState().layout.designBook?.activeId).toBe('original'));
    expect(layoutStore.getState().layout.floors[0]!.items.every(item => !item.glbUrl)).toBe(true);
  }
  expect(ensureGlbAsset).not.toHaveBeenCalled();
});

it.each(['layout', 'account-roundtrip', 'project', 'controller'] as const)('rejects delayed model completion after %s changes', async change => {
  const f = savedModelDesign();let finish!: () => void;
  vi.mocked(ensureGlbAsset).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const view = render(<Workspace controller={f.controller as unknown as BackendSession}/>);
  fireEvent.click(screen.getByRole('button', { name: '原始方案切换' }));
  await waitFor(() => expect(ensureGlbAsset).toHaveBeenCalledOnce());
  if (change === 'layout') act(() => layoutStore.getState().actions.setName('演练后续编辑'));
  else if (change === 'account-roundtrip') {
    f.snapshot.user.id = 'other-owner';f.notify();f.snapshot.user.id = 'test-owner';f.notify();
  } else if (change === 'project') { f.snapshot.project.id = 'other-project';f.notify(); }
  else view.rerender(<Workspace controller={{ ...f.controller } as unknown as BackendSession}/>);
  await act(async () => finish());
  expect(layoutStore.getState().layout.designBook?.activeId).toBe(f.base.designBook!.activeId);
  if (change === 'layout') expect(layoutStore.getState().layout.name).toBe('演练后续编辑');
  else expect(screen.queryByRole('status')).toBeNull();
});

it('uses the one saved URL even if only a later instance carries it, without duplicate downloads', async () => {
  const f = savedModelDesign();
  f.base.designBook!.variants[0]!.layout.floors[0]!.items[1]!.glbUrl = '/assets/example.glb';
  render(<Workspace/>);fireEvent.click(screen.getByRole('button', { name: '原始方案切换' }));
  await waitFor(() => expect(layoutStore.getState().layout.designBook?.activeId).toBe('original'));
  expect(ensureGlbAsset).toHaveBeenCalledExactlyOnceWith(modelId, '/assets/example.glb');
  expect(layoutStore.getState().layout.floors[0]!.items.every(item => item.glbUrl === '/assets/example.glb')).toBe(true);
});

it('rejects conflicting saved URLs for an unloaded offline model', async () => {
  const f = savedModelDesign();
  f.base.designBook!.variants[0]!.layout.floors[0]!.items.forEach((item, index) => { item.glbUrl = `/assets/model-${index}.glb`; });
  render(<Workspace/>);fireEvent.click(screen.getByRole('button', { name: '原始方案切换' }));
  await screen.findByText(/同一模型的来源不一致/);
  expect(ensureGlbAsset).not.toHaveBeenCalled();expect(layoutStore.getState().layout).toBe(f.base);
});

it('keeps category and single-member layer selection in the tools, but lets a material row open properties', () => {
  const id = INITIAL_LAYOUT.floors[0]!.items[2]!.id, onSelection = vi.fn();
  layoutStore.setState({ layout: { ...INITIAL_LAYOUT, itemLayers: [{ id: 'one-chair', name: '单椅演练组', itemIds: [id] }] } });
  render(<Workspace onSelection={onSelection}/>);
  fireEvent.click(screen.getByRole('button', { name: /全部椅子/ }));
  expect(onSelection).toHaveBeenLastCalledWith(id, { keepPanel: true });
  expect(screen.getByText('批量编辑 · 已选 2 件')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /^单椅演练组/ }));
  expect(onSelection).toHaveBeenLastCalledWith(id, { keepPanel: true });
  expect(screen.getByText('批量编辑 · 已选 1 件')).toBeTruthy();
  const material = screen.getAllByRole('button', { name: /1\. 活动座椅/, hidden: true })[0]!;
  fireEvent.click(material);
  expect(onSelection).toHaveBeenLastCalledWith(id, undefined);
});

it('previews horizontal Y and vertical Z without saving, then applies the displayed displacement once', () => {
  const onPreview = vi.fn();
  const base = layoutStore.getState().layout;
  render(<Workspace onPreview={onPreview}/>);
  fireEvent.click(screen.getByRole('button', { name: /全部椅子/ }));
  fireEvent.change(screen.getByLabelText('图层 Y 位移'), { target: { value: '0.2' } });
  fireEvent.change(screen.getByLabelText('图层 Z 位移'), { target: { value: '0.5' } });
  const preview = onPreview.mock.lastCall?.[0] as RoomLayout;
  expect(preview).toBeTruthy();
  const chairs = preview.floors[0]!.items.filter(i => i.type === 'chair');
  expect(chairs[0]).toMatchObject({ position: { x: -1.4, z: 1.2 }, elevation: 0.5 });
  expect(chairs[1]).toMatchObject({ position: { x: 1.4, z: 1.2 }, elevation: 0.5 });
  expect(layoutStore.getState().layout).toBe(base);
  fireEvent.click(screen.getByRole('button', { name: '移动已选物料' }));
  expect(layoutStore.getState().layout.floors[0]!.items).toEqual(preview.floors[0]!.items);
  expect(onPreview).toHaveBeenLastCalledWith(null);
  expect((screen.getByLabelText('图层 Y 位移') as HTMLInputElement).value).toBe('0');
  expect((screen.getByRole('button', { name: '移动已选物料' }) as HTMLButtonElement).disabled).toBe(true);
});

it('updates from the original positions and cancels on selection, document changes and unmount', () => {
  const onPreview = vi.fn();
  const base = layoutStore.getState().layout;
  const rendered = render(<Workspace onPreview={onPreview}/>);
  const selectChairs = () => fireEvent.click(screen.getByRole('button', { name: /全部椅子/ }));
  const move = (value: string) => fireEvent.change(screen.getByLabelText('图层 X 位移'), { target: { value } });
  selectChairs(); move('0.2'); move('0.3');
  expect(onPreview.mock.lastCall?.[0].floors[0].items.find((i: { type: string }) => i.type === 'chair').position.x).toBeCloseTo(-1.1);
  fireEvent.click(screen.getByRole('button', { name: '取消移动预览' }));
  expect(onPreview).toHaveBeenLastCalledWith(null);
  expect(layoutStore.getState().layout).toBe(base);
  move('0.2');
  fireEvent.click(screen.getByRole('button', { name: /全部桌子/ }));
  expect(onPreview).toHaveBeenLastCalledWith(null);
  selectChairs();
  expect((screen.getByLabelText('图层 X 位移') as HTMLInputElement).value).toBe('0');
  move('0.2');
  act(() => layoutStore.getState().actions.setName('changed elsewhere'));
  expect(onPreview).toHaveBeenLastCalledWith(null);
  expect((screen.getByLabelText('图层 X 位移') as HTMLInputElement).value).toBe('0');
  move('0.2'); rendered.unmount();
  expect(onPreview).toHaveBeenLastCalledWith(null);
});

it('rejects boundary and height violations, but accepts negative horizontal movement and skips locks', () => {
  const onPreview = vi.fn();
  const base = { ...INITIAL_LAYOUT, floors: [{ ...INITIAL_LAYOUT.floors[0]!, items: INITIAL_LAYOUT.floors[0]!.items.map(i => i.position?.x === -1.4 ? { ...i, locked: true } : i) }] };
  layoutStore.setState({ layout: base });
  render(<Workspace onPreview={onPreview}/>);
  fireEvent.click(screen.getByRole('button', { name: /全部椅子/ }));
  const move = (axis: string, value: string) => fireEvent.change(screen.getByLabelText(`图层 ${axis} 位移`), { target: { value } });
  move('Y', '100');
  expect(screen.getByRole('alert').textContent).toContain('场地边界');
  expect(onPreview.mock.lastCall?.[0]).toBeNull();
  expect((screen.getByRole('button', { name: '移动已选物料' }) as HTMLButtonElement).disabled).toBe(true);
  move('Y', '0'); move('Z', '-1');
  expect(screen.getByRole('alert').textContent).toContain('高度');
  move('Z', '0'); move('Y', '');
  expect(onPreview.mock.lastCall?.[0]).toBeNull();
  move('Y', '-0.2');
  const preview = onPreview.mock.lastCall?.[0] as RoomLayout;
  expect(preview.floors[0]!.items[2]).toEqual(base.floors[0]!.items[2]);
  expect(preview.floors[0]!.items[3]!.position!.z).toBeCloseTo(0.8);
  expect(preview.floors[0]!.items[3]!.elevation).toBeUndefined();
  expect(layoutStore.getState().layout).toBe(base);
  fireEvent.click(screen.getByRole('button', { name: '移动已选物料' }));
  expect(layoutStore.getState().layout.floors[0]!.items).toEqual(preview.floors[0]!.items);
});

it('creates a custom layer from all chairs, moves them together and applies a shared colour', () => {
  render(<Workspace/>);
  fireEvent.click(screen.getByRole('button', { name: /全部椅子/ }));
  fireEvent.change(screen.getByLabelText('新图层名称'), { target: { value: '交流区' } });
  fireEvent.click(screen.getByRole('button', { name: '用已选物料创建' }));
  expect(layoutStore.getState().layout.itemLayers?.[0]?.itemIds).toHaveLength(2);
  fireEvent.change(screen.getByLabelText('图层 X 位移'), { target: { value: '0.2' } });
  fireEvent.click(screen.getByRole('button', { name: '移动已选物料' }));
  fireEvent.change(screen.getByLabelText('图层颜色'), { target: { value: '#123456' } });
  fireEvent.click(screen.getByRole('button', { name: '应用颜色' }));
  const chairs = layoutStore.getState().layout.floors[0]!.items.filter(i => i.type === 'chair');
  expect(chairs.map(i => i.color)).toEqual(['#123456', '#123456']);
  expect(chairs[0]!.position!.x).toBeCloseTo(-1.2);
  expect(chairs[1]!.position!.x).toBeCloseTo(1.6);
  fireEvent.click(screen.getByRole('button', { name: '删除图层 交流区' }));
  expect(layoutStore.getState().layout.itemLayers).toEqual([]);
  expect(layoutStore.getState().layout.floors[0]!.items).toHaveLength(5);
});

it('switches independent saved designs through the actual layout store', async () => {
  const empty = { ...INITIAL_LAYOUT, floors: [{ ...INITIAL_LAYOUT.floors[0]!, items: [] }] };
  layoutStore.setState({ layout: addDesign(INITIAL_LAYOUT, empty) });
  render(<Workspace/>);
  fireEvent.click(screen.getByRole('button', { name: '原始方案切换' }));
  await waitFor(() => expect(layoutStore.getState().layout.floors[0]!.items).toHaveLength(5));
  fireEvent.click(screen.getByRole('button', { name: 'AI 方案 A切换' }));
  await waitFor(() => expect(layoutStore.getState().layout.floors[0]!.items).toHaveLength(0));
});
