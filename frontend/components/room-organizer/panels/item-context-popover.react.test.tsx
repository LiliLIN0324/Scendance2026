// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RoomEditorProvider, type RoomEditorContextValue } from '../contexts/room-editor-context';
import { SelectionProvider, type SelectionContextValue } from '../contexts/selection-context';
import { ItemContextPopover } from './item-context-popover';
import type { FurnitureItem } from '../lib/types';

function placed(overrides: Partial<FurnitureItem> = {}): FurnitureItem {
  return {
    id: 'placed-1',
    type: 'glb-asset',
    name: 'Lounge Chaise (Airport Lounge)',
    width: 0.78,
    depth: 0.9,
    height: 0.72,
    color: '#ffffff',
    icon: '◇',
    ...overrides,
  };
}

function setup(selected: FurnitureItem): void {
  const editor = {
    actions: { setLocked: vi.fn(), resizeItem: vi.fn(), moveItem: vi.fn(), setRotation: vi.fn(), setColor: vi.fn(), updateItem: vi.fn() },
    pushColor: vi.fn(),
    activeFloor: { items: [] },
  } as unknown as RoomEditorContextValue;
  const selection: SelectionContextValue = {
    selectedItemId: selected.id,
    setSelectedItemId: vi.fn(),
    selectedItem: selected,
    extraSelectedIds: new Set<string>(),
    setExtraSelectedIds: vi.fn(),
    allSelectedIds: new Set<string>(),
    selectOnly: vi.fn(),
  };
  render(
    <RoomEditorProvider value={editor}>
      <SelectionProvider value={selection}>
        <ItemContextPopover hasCollision={false} onRemove={vi.fn()} onDuplicate={vi.fn()}
          onRotate={vi.fn()} onToggleCameraBracket={vi.fn()} onClose={vi.fn()} />
      </SelectionProvider>
    </RoomEditorProvider>
  );
}

const origin = (): string | null =>
  screen.getByText(/云端模型资产|本地 GLB 验证样例|内置活动物料/).textContent;

describe('catalogItemOrigin', () => {
  afterEach(cleanup);

  it('calls an online-library model a cloud asset even though it carries no assetId', () => {
    setup(placed({ source: 'public_library', glbUrl: 'https://cdn.3dassets.dev/assets/33803/v1/model.glb' }));
    expect(origin()).toBe('云端模型资产');
  });

  it('still calls an archived cloud asset a cloud asset', () => {
    setup(placed({ source: 'public_library', assetId: '11111111-1111-4111-8111-111111111111', glbUrl: 'https://cdn.example.com/a.glb' }));
    expect(origin()).toBe('云端模型资产');
  });

  it('leaves the local verification sample as a local sample', () => {
    setup(placed({ source: 'local_sample', glbUrl: '/assets/models/table.glb' }));
    expect(origin()).toBe('本地 GLB 验证样例');
  });

  it('reads an item with no GLB as a built-in material', () => {
    setup(placed({ source: 'builtin', type: 'chair' }));
    expect(origin()).toBe('内置活动物料');
  });
});
