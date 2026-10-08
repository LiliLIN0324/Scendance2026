// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { RoomEditorProvider, SelectionProvider, type RoomEditorContextValue, type SelectionContextValue } from '../contexts';
import { layoutStore, useLayout } from '../hooks/use-layout-store';
import { INITIAL_LAYOUT } from '../lib/initial-layout';
import { addDesign } from '../lib/scene-layers';
import { SceneLayersPanel } from './scene-layers-panel';
import type { RoomLayout } from '../lib/types';

function Workspace({ onPreview, onSelection }: { onPreview?: (layout: RoomLayout | null) => void; onSelection?: SelectionContextValue['selectOnly'] }) {
  const layout = useLayout();
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [extraSelectedIds, setExtraSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const allSelectedIds = new Set(extraSelectedIds); if (selectedItemId) allSelectedIds.add(selectedItemId);
  const editor = { layout, activeFloor: layout.floors[0], activeFloorIndex: 0, actions: layoutStore.getState().actions,
    history: { canUndo: false, undo: vi.fn() } } as unknown as RoomEditorContextValue;
  return <RoomEditorProvider value={editor}><SelectionProvider value={{ selectedItemId, setSelectedItemId, extraSelectedIds, setExtraSelectedIds, allSelectedIds,
    selectedItem: layout.floors[0]!.items.find(i => i.id === selectedItemId) ?? null, selectOnly: (id, options) => { onSelection?.(id, options); setSelectedItemId(id); setExtraSelectedIds(new Set()); } }}><SceneLayersPanel {...(onPreview ? { onPreview } : {})}/></SelectionProvider></RoomEditorProvider>;
}
beforeEach(() => layoutStore.setState({ layout: INITIAL_LAYOUT, activeFloorIndex: 0 }));
afterEach(cleanup);

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
