import { describe, expect, it } from 'vitest';
import type { FurnitureItem, RoomLayout } from '../components/room-organizer/lib/types';
import {
  applyLayoutCommand,
  moveItemCommand,
  placeItemCommand,
  removeItemCommand,
  summarizeCommand,
  swapAssetCommand,
  updateItemCommand,
  validateCommandPreconditions,
  validateCommandShape,
} from './build-command';

function makeItem(partial: Partial<FurnitureItem> & Pick<FurnitureItem, 'id' | 'name'>): FurnitureItem {
  return {
    type: 'table',
    width: 1,
    depth: 1,
    height: 0.75,
    position: { x: 0, z: 0 },
    rotation: 0,
    color: '#cccccc',
    icon: '',
    ...partial,
  };
}

function makeLayout(opts: { width: number; height: number; items: FurnitureItem[] }): RoomLayout {
  return {
    name: 'test',
    width: opts.width,
    height: opts.height,
    floors: [
      { id: 'f1', name: 'f1', items: opts.items, floorColor: '#fff' },
    ],
  } as RoomLayout;
}

describe('validateCommandShape', () => {
  it('place-item：合法形状通过', () => {
    const cmd = placeItemCommand({ floorIndex: 0, item: makeItem({ id: 'a', name: '桌', position: { x: 2, z: 1 } }) });
    expect(validateCommandShape(cmd)).toEqual([]);
  });

  it('place-item：负尺寸被拒', () => {
    const cmd = placeItemCommand({ floorIndex: 0, item: makeItem({ id: 'a', name: '桌', width: -1 }) });
    const issues = validateCommandShape(cmd);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.some((i) => i.path === 'item.width')).toBe(true);
  });

  it('place-item：坐标越界被拒', () => {
    const cmd = placeItemCommand({ floorIndex: 0, item: makeItem({ id: 'a', name: '桌', position: { x: 999, z: 0 } }) });
    expect(validateCommandShape(cmd).some((i) => i.path === 'item.position.x')).toBe(true);
  });

  it('move-item：空 itemId 被拒', () => {
    const cmd = moveItemCommand({ floorIndex: 0, itemId: '', position: { x: 0, z: 0 } });
    expect(validateCommandShape(cmd).some((i) => i.path === 'itemId')).toBe(true);
  });

  it('update-item：空 patch 被拒', () => {
    const cmd = updateItemCommand({ itemId: 'a', patch: {} });
    expect(validateCommandShape(cmd).some((i) => i.path === 'patch')).toBe(true);
  });

  it('remove-item：空 itemId 被拒', () => {
    expect(validateCommandShape(removeItemCommand({ itemId: '' })).length).toBeGreaterThan(0);
  });

  it('swap-asset：合法形状通过', () => {
    const cmd = swapAssetCommand({
      itemId: 'a',
      nextAsset: { assetId: 'g1', glbUrl: 'x', name: '新沙发', type: 'sofa', width: 2, depth: 1, height: 0.8 },
    });
    expect(validateCommandShape(cmd)).toEqual([]);
  });

  it('apply-layout：空 floors 被拒', () => {
    const cmd = applyLayoutCommand({ layout: { floors: [] } as unknown as RoomLayout });
    expect(validateCommandShape(cmd).some((i) => i.path === 'layout.floors')).toBe(true);
  });
});

describe('validateCommandPreconditions', () => {
  it('place-item：合法位置通过', () => {
    const layout = makeLayout({ width: 10, height: 10, items: [] });
    const cmd = placeItemCommand({ floorIndex: 0, item: makeItem({ id: 'a', name: '桌', position: { x: 2, z: 2 } }) });
    expect(validateCommandPreconditions(cmd, { layout })).toEqual([]);
  });

  it('place-item：与已有家具重叠被拒', () => {
    const layout = makeLayout({
      width: 10,
      height: 10,
      items: [makeItem({ id: 'a', name: '桌', position: { x: 0, z: 0 } })],
    });
    const cmd = placeItemCommand({ floorIndex: 0, item: makeItem({ id: 'b', name: '另桌', position: { x: 0.2, z: 0.2 } }) });
    const issues = validateCommandPreconditions(cmd, { layout });
    expect(issues[0]?.code).toBe('BBOX_OVERLAP');
  });

  it('move-item：目标 item 不存在被拒', () => {
    const layout = makeLayout({ width: 10, height: 10, items: [] });
    const cmd = moveItemCommand({ floorIndex: 0, itemId: 'ghost', position: { x: 0, z: 0 } });
    expect(validateCommandPreconditions(cmd, { layout })[0]?.code).toBe('ITEM_NOT_FOUND');
  });

  it('move-item：合法移动通过（自己不算重叠）', () => {
    const item = makeItem({ id: 'a', name: '桌', position: { x: -2, z: 0 } });
    const layout = makeLayout({ width: 10, height: 10, items: [item] });
    const cmd = moveItemCommand({ floorIndex: 0, itemId: 'a', position: { x: 2, z: 0 } });
    expect(validateCommandPreconditions(cmd, { layout })).toEqual([]);
  });

  it('apply-layout：baseFingerprint 不匹配返回 issue', () => {
    const layout = makeLayout({ width: 10, height: 10, items: [] });
    const cmd = applyLayoutCommand({ layout, baseFingerprint: 'deadbeef' });
    const issues = validateCommandPreconditions(cmd, { layout });
    expect(issues[0]?.code).toBe('BASE_FINGERPRINT_MISMATCH');
  });

  it('swap-asset：目标 item 不存在被拒', () => {
    const layout = makeLayout({ width: 10, height: 10, items: [] });
    const cmd = swapAssetCommand({
      itemId: 'ghost',
      nextAsset: { assetId: 'x', glbUrl: 'y', name: 'z', type: 'sofa', width: 1, depth: 1, height: 1 },
    });
    expect(validateCommandPreconditions(cmd, { layout })[0]?.code).toBe('ITEM_NOT_FOUND');
  });
});

describe('summarizeCommand', () => {
  it('place-item 出中文', () => {
    const cmd = placeItemCommand({ floorIndex: 0, item: makeItem({ id: 'a', name: '主桌' }) });
    expect(summarizeCommand(cmd)).toContain('主桌');
  });
  it('apply-layout 带件数', () => {
    const layout = makeLayout({ width: 10, height: 10, items: [makeItem({ id: 'a', name: 'x' })] });
    expect(summarizeCommand(applyLayoutCommand({ layout }))).toContain('1 件');
  });
});
