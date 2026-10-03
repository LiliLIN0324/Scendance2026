// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RoomEditorProvider, type RoomEditorContextValue } from '../contexts/room-editor-context';
import { SelectionProvider, type SelectionContextValue } from '../contexts/selection-context';
import { INITIAL_LAYOUT } from '../lib/initial-layout';
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

function setup(selected: FurnitureItem) {
  const editor = {
    layout: INITIAL_LAYOUT,
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
  return editor;
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

describe('selected summary and colour', () => {
  afterEach(cleanup);

  it('edits Z elevation and Y ground position without changing the stored coordinate convention', () => {
    const editor = setup(placed({ position: { x: 2, z: 3 }, elevation: 0.75 }));
    const input = screen.getByRole('spinbutton', { name: 'Z / m' });
    expect((input as HTMLInputElement).value).toBe('0.75');
    fireEvent.change(input, { target: { value: '1.25' } });
    expect(editor.actions.updateItem).toHaveBeenCalledWith('placed-1', { elevation: 1.25 });
    const ground = screen.getByRole('spinbutton', { name: 'Y / m' });
    expect((ground as HTMLInputElement).value).toBe('3');
    fireEvent.change(ground, { target: { value: '3.2' } });
    expect(editor.actions.moveItem).toHaveBeenCalledWith('placed-1', 2, 3.2);
    expect(screen.queryByRole('spinbutton', { name: '宽' })).toBeNull();
    expect(screen.getByRole('button', { name: '旋转 90°' }).closest('section')?.textContent).toContain('位置与角度');
  });

  it('shows an online model’s real thumbnail instead of the stand-in glyph', () => {
    setup(placed({ source: 'public_library', glbUrl: 'https://cdn.3dassets.dev/assets/33803/v1/model.glb' }));
    expect(document.querySelector('.sc-selected-thumb')?.getAttribute('src'))
      .toBe('https://cdn.3dassets.dev/assets/33803/v1/thumb.webp');
  });

  it('keeps the glyph for a model with no catalogue thumbnail', () => {
    setup(placed({ source: 'local_sample', glbUrl: '/assets/models/table.glb' }));
    expect(document.querySelector('.sc-selected-thumb')).toBeNull();
  });

  it('replaces the unusable colour swatches with a note on a GLB model', () => {
    setup(placed({ source: 'public_library', glbUrl: 'https://cdn.3dassets.dev/assets/33803/v1/model.glb' }));
    // Every swatch was disabled for GLB items, so the section was dead UI.
    expect(document.querySelector('.sc-color-swatches')).toBeNull();
    expect(screen.getByText('该模型保留自身材质，暂不支持改色。')).toBeTruthy();
  });

  it('still offers colours for a built-in material', () => {
    setup(placed({ source: 'builtin', type: 'chair' }));
    expect(document.querySelector('.sc-color-swatches')).toBeTruthy();
    expect(document.querySelectorAll('.sc-color-swatches button')).toHaveLength(8);
  });
});
