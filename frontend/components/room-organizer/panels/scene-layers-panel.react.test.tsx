// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { RoomEditorProvider, SelectionProvider, type RoomEditorContextValue } from '../contexts';
import { layoutStore, useLayout } from '../hooks/use-layout-store';
import { INITIAL_LAYOUT } from '../lib/initial-layout';
import { addDesign } from '../lib/scene-layers';
import { SceneLayersPanel } from './scene-layers-panel';

function Workspace() {
  const layout = useLayout();
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [extraSelectedIds, setExtraSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const allSelectedIds = new Set(extraSelectedIds); if (selectedItemId) allSelectedIds.add(selectedItemId);
  const editor = { layout, activeFloor: layout.floors[0], activeFloorIndex: 0, actions: layoutStore.getState().actions,
    history: { canUndo: false, undo: vi.fn() } } as unknown as RoomEditorContextValue;
  return <RoomEditorProvider value={editor}><SelectionProvider value={{ selectedItemId, setSelectedItemId, extraSelectedIds, setExtraSelectedIds, allSelectedIds,
    selectedItem: layout.floors[0]!.items.find(i => i.id === selectedItemId) ?? null, selectOnly: id => { setSelectedItemId(id); setExtraSelectedIds(new Set()); } }}><SceneLayersPanel/></SelectionProvider></RoomEditorProvider>;
}
beforeEach(() => layoutStore.setState({ layout: INITIAL_LAYOUT, activeFloorIndex: 0 }));
afterEach(cleanup);

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
