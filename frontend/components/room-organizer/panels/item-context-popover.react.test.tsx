// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RoomEditorProvider, type RoomEditorContextValue } from '../contexts/room-editor-context';
import { SelectionProvider, type SelectionContextValue } from '../contexts/selection-context';
import { INITIAL_LAYOUT } from '../lib/initial-layout';
import { MAX_ITEM_DIMENSION, MIN_ITEM_FOOTPRINT, MIN_ITEM_HEIGHT } from '../lib/constants';
import { ENTRANCE_DOOR_ID } from '../lib/street';
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

function setup(selected: FurnitureItem, embedded = false) {
  const floor = { ...INITIAL_LAYOUT.floors[0]!, items: [selected] };
  const editor = {
    layout: { ...INITIAL_LAYOUT, floors: [floor] },
    actions: { setLocked: vi.fn(), resizeItem: vi.fn(), moveItem: vi.fn(), setRotation: vi.fn(), setColor: vi.fn(), updateItem: vi.fn() },
    pushColor: vi.fn(),
    activeFloor: floor,
    activeFloorIndex: 0,
    history: { commitNow: vi.fn() },
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
  const tree = (current: FurnitureItem, currentEditor: RoomEditorContextValue) => (
    <RoomEditorProvider value={currentEditor}>
      <SelectionProvider value={{ ...selection, selectedItemId: current.id, selectedItem: current }}>
        <ItemContextPopover embedded={embedded} hasCollision={false} onRemove={vi.fn()} onDuplicate={vi.fn()}
          onRotate={vi.fn()} onToggleCameraBracket={vi.fn()} onClose={vi.fn()} />
      </SelectionProvider>
    </RoomEditorProvider>
  );
  const view = render(tree(selected, editor));
  return { ...editor, rerenderSelected(current: FurnitureItem) {
    const nextFloor = { ...floor, items: [current] };
    view.rerender(tree(current, { ...editor, layout: { ...editor.layout, floors: [nextFloor] }, activeFloor: nextFloor }));
  } };
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
    expect((screen.getByRole('spinbutton', { name: '宽 / 米' }) as HTMLInputElement).value).toBe('0.78');
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

describe('embedded selected properties', () => {
  afterEach(cleanup);

  it('keeps the original editing fields and callbacks inside the materials panel', () => {
    const editor = setup(placed({ name: '测试椅', source: 'builtin', type: 'chair', position: { x: 2, z: 3 }, notes: '原备注' }), true);
    const properties = screen.getByRole('complementary', { name: '测试椅属性' });
    expect(properties.classList.contains('is-embedded')).toBe(true);
    fireEvent.change(screen.getByRole('spinbutton', { name: 'X / m' }), { target: { value: '2.5' } });
    expect(editor.actions.moveItem).toHaveBeenCalledWith('placed-1', 2.5, 3);
    fireEvent.change(screen.getByRole('textbox', { name: '物料备注' }), { target: { value: '现场核对备注' } });
    expect(editor.actions.updateItem).toHaveBeenCalledWith('placed-1', { notes: '现场核对备注' });
    fireEvent.click(screen.getByRole('button', { name: '允许编辑 · 点击锁定' }));
    expect(editor.actions.setLocked).toHaveBeenCalledWith('placed-1', true);
    expect(properties.contains(screen.getByRole('spinbutton', { name: 'Z / m' }))).toBe(true);
  });

  it.each([true,false])('points a registered cloud model to material previews with or without a loading URL (%s)',hasUrl=>{
    setup(placed({source:'generated',...(hasUrl?{glbUrl:'https://storage.example/model.glb'}:{}),assetId:'91000000-0000-4000-8000-000000000001'}));
    expect(document.querySelector('.sc-color-swatches')).toBeNull();
    expect(screen.getByText('该模型保留原材质。需要调整时，请到“资料 → 物料工具 → 材质调整”核对材质槽并预览新版本。')).toBeTruthy();
  });

  it('preserves locked restrictions and offers the original explicit unlock action', () => {
    const editor = setup(placed({ locked: true }), true);
    for (const name of ['宽 / 米', '深 / 米', '高 / 米', 'X / m', 'Y / m', 'Z / m', '旋转 / °']) {
      expect((screen.getByRole('spinbutton', { name }) as HTMLInputElement).disabled).toBe(true);
    }
    expect((screen.getByRole('textbox', { name: '物料备注' }) as HTMLTextAreaElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: '旋转 90°' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: '删除物料' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '已锁定 · 点击解锁' }));
    expect(editor.actions.setLocked).toHaveBeenCalledWith('placed-1', false);
    expect(editor.actions.moveItem).not.toHaveBeenCalled(); expect(editor.actions.updateItem).not.toHaveBeenCalled();
  });
});

describe('manual selected item dimensions', () => {
  afterEach(cleanup);

  it.each([
    ['宽 / 米', 'width', '6.25'], ['深 / 米', 'depth', '6.1'], ['高 / 米', 'height', '4.2345'],
  ] as const)('shows the current %s and submits one built-in dimension only after leaving the field', (name, dimension, value) => {
    const editor = setup(placed({ source: 'builtin', type: 'table' }));
    const input = screen.getByRole('spinbutton', { name }) as HTMLInputElement;
    expect(input.value).toBe(String(editor.activeFloor.items[0]![dimension]));
    expect(input.max).toBe(String(MAX_ITEM_DIMENSION));
    expect(input.min).toBe(String(dimension === 'height' ? MIN_ITEM_HEIGHT : MIN_ITEM_FOOTPRINT));
    const original = JSON.stringify(editor.layout);
    fireEvent.change(input, { target: { value } });
    expect(editor.actions.resizeItem).not.toHaveBeenCalled(); expect(editor.history.commitNow).not.toHaveBeenCalled();
    fireEvent.blur(input); fireEvent.blur(input);
    expect(editor.actions.resizeItem).toHaveBeenCalledExactlyOnceWith('placed-1', dimension, Number(value));
    expect(editor.history.commitNow).toHaveBeenCalledOnce(); expect(JSON.stringify(editor.layout)).toBe(original);
  });

  it('submits Enter once, ignores its following blur, and keeps the one-centimetre height boundary', () => {
    const editor = setup(placed({ source: 'builtin', type: 'carpet', height: MIN_ITEM_HEIGHT }));
    const input = screen.getByRole('spinbutton', { name: '高 / 米' });
    expect((input as HTMLInputElement).value).toBe(String(MIN_ITEM_HEIGHT));
    fireEvent.change(input, { target: { value: '0.01234' } });
    fireEvent.keyDown(input, { key: 'Enter' }); fireEvent.blur(input);
    expect(editor.actions.resizeItem).toHaveBeenCalledExactlyOnceWith('placed-1', 'height', 0.01234);
    expect(editor.history.commitNow).toHaveBeenCalledOnce();
  });

  it('keeps focus and the same input after Enter applies a value, without another resize on blur, and refills external undo', () => {
    const selected = placed(), editor = setup(selected), input = screen.getByRole('spinbutton', { name: '宽 / 米' }) as HTMLInputElement;
    input.focus(); fireEvent.change(input, { target: { value: '1.8' } }); fireEvent.keyDown(input, { key: 'Enter' });
    editor.rerenderSelected({ ...selected, width: 1.8 });
    expect(screen.getByRole('spinbutton', { name: '宽 / 米' })).toBe(input); expect(document.activeElement).toBe(input);
    expect(input.value).toBe('1.8'); input.blur();
    expect(editor.actions.resizeItem).toHaveBeenCalledExactlyOnceWith('placed-1', 'width', 1.8);
    editor.rerenderSelected(selected);
    expect(screen.getByRole('spinbutton', { name: '宽 / 米' })).toBe(input); expect(input.value).toBe(String(selected.width));
    expect(editor.actions.resizeItem).toHaveBeenCalledOnce();
  });

  it.each(['', '0', '-1', 'Infinity', '51', '0.001'])('does not submit an empty, non-finite or out-of-range width (%s)', value => {
    const editor = setup(placed()); const input = screen.getByRole('spinbutton', { name: '宽 / 米' });
    fireEvent.change(input, { target: { value } }); fireEvent.blur(input); fireEvent.keyDown(input, { key: 'Enter' });
    expect(editor.actions.resizeItem).not.toHaveBeenCalled(); expect(editor.history.commitNow).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain(`${MIN_ITEM_FOOTPRINT}～${MAX_ITEM_DIMENSION}`);
  });

  it('does not create a resize or history entry for an unchanged value, and lets an invalid draft be corrected', () => {
    const editor = setup(placed()); const input = screen.getByRole('spinbutton', { name: '宽 / 米' });
    fireEvent.blur(input); expect(editor.actions.resizeItem).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: '' } }); fireEvent.blur(input); expect(screen.getByRole('alert')).toBeTruthy();
    fireEvent.change(input, { target: { value: '1.45' } }); fireEvent.blur(input);
    expect(screen.queryByRole('alert')).toBeNull(); expect(editor.actions.resizeItem).toHaveBeenCalledExactlyOnceWith('placed-1', 'width', 1.45);
  });

  it.each([
    { source: 'public_library', assetId: '11111111-1111-4111-8111-111111111111', glbUrl: 'https://cdn.example.com/a.glb' },
    { source: 'local_sample', glbUrl: '/scene-presets/gym/gym.glb', glbNode: 'Preset_Object_0' },
  ] as const)('resizes a GLB instance while preserving its model reference (%j)', references => {
    const selected = placed(references), editor = setup(selected), original = JSON.stringify(editor.layout);
    fireEvent.change(screen.getByRole('spinbutton', { name: '高 / 米' }), { target: { value: '1.3' } });
    fireEvent.blur(screen.getByRole('spinbutton', { name: '高 / 米' }));
    expect(editor.actions.resizeItem).toHaveBeenCalledExactlyOnceWith('placed-1', 'height', 1.3);
    expect(editor.actions.updateItem).not.toHaveBeenCalled(); expect(JSON.stringify(editor.layout)).toBe(original);
    expect(screen.getByText(/只调整当前物件尺寸，原模型保持不变/)).toBeTruthy();
  });

  it.each([
    { type: 'door', structuralOpeningId: 'measured-door' }, { type: 'window', structuralOpeningId: 'measured-window' },
    { type: 'column', structuralColumnId: 'measured-column' }, { venueEntranceId: 'main-entrance' }, { id: ENTRANCE_DOOR_ID, type: 'door' },
  ])('disables structural dimensions and points to their own editing entry (%j)', marker => {
    const editor = setup(placed(marker));
    for (const name of ['宽 / 米', '深 / 米', '高 / 米']) {
      const input = screen.getByRole('spinbutton', { name }); expect((input as HTMLInputElement).disabled).toBe(true);
      fireEvent.change(input, { target: { value: '1.2' } }); fireEvent.blur(input);
    }
    expect(screen.getByText(/结构微调|补充尺寸/)).toBeTruthy(); expect(editor.actions.resizeItem).not.toHaveBeenCalled();
  });

  it('does not commit a locked dimension even when an input event is simulated', () => {
    const editor = setup(placed({ locked: true })), input = screen.getByRole('spinbutton', { name: '宽 / 米' });
    fireEvent.change(input, { target: { value: '1.2' } }); fireEvent.blur(input); fireEvent.keyDown(input, { key: 'Enter' });
    expect(editor.actions.resizeItem).not.toHaveBeenCalled(); expect(editor.history.commitNow).not.toHaveBeenCalled();
  });

  it('discards an A draft when selection switches to B, including A→B→A and late blur', () => {
    const a = placed({ id: 'item-a' }), b = placed({ id: 'item-b', width: 1.1 }), editor = setup(a);
    const oldInput = screen.getByRole('spinbutton', { name: '宽 / 米' }); fireEvent.change(oldInput, { target: { value: '2.8' } });
    editor.rerenderSelected(b); fireEvent.blur(oldInput);
    expect((screen.getByRole('spinbutton', { name: '宽 / 米' }) as HTMLInputElement).value).toBe('1.1');
    expect(editor.actions.resizeItem).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole('spinbutton', { name: '宽 / 米' }), { target: { value: '1.4' } });
    fireEvent.blur(screen.getByRole('spinbutton', { name: '宽 / 米' }));
    expect(editor.actions.resizeItem).toHaveBeenCalledExactlyOnceWith('item-b', 'width', 1.4);
    editor.rerenderSelected(a); fireEvent.blur(oldInput);
    expect((screen.getByRole('spinbutton', { name: '宽 / 米' }) as HTMLInputElement).value).toBe('0.78');
    expect(editor.actions.resizeItem).toHaveBeenCalledOnce();
  });

  it('reports a resize refused by the existing scene boundary instead of submitting a silent no-op', () => {
    const editor = setup(placed({ source: 'builtin', type: 'table', position: { x: 0, z: 0 } }));
    const original = JSON.stringify(editor.layout), input = screen.getByRole('spinbutton', { name: '宽 / 米' });
    fireEvent.change(input, { target: { value: '12' } }); fireEvent.blur(input);
    expect(screen.getByRole('alert').textContent).toContain('这个尺寸无法应用');
    expect(editor.actions.resizeItem).not.toHaveBeenCalled(); expect(editor.history.commitNow).not.toHaveBeenCalled();
    expect(JSON.stringify(editor.layout)).toBe(original);
  });
});
