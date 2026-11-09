import { describe, expect, it } from 'vitest';
import type { FurnitureItem, RoomLayout } from '../components/room-organizer/lib/types';
import {
  applyLayoutCommand,
  applyLayoutCommandWithRefusals,
  completeLayoutError,
  executeSceneCommand,
  moveItemCommand,
  placeItemCommand,
  removeItemCommand,
  summarizeCommand,
  swapAssetCommand,
  updateItemCommand,
  validateCommandPreconditions,
  validateCommandShape,
} from './build-command';
import { layoutFingerprint } from './layout-fingerprint';

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
  it('整体应用遇到拒绝的物件时必须报错，不能把部分候选当作确认结果', () => {
    const before = makeLayout({ width: 10, height: 8, items: [] });
    const candidate = makeLayout({ width: 10, height: 8, items: [
      makeItem({ id: 'a', name: '桌一', position: { x: -2, z: 0 } }),
      makeItem({ id: 'b', name: '桌二', position: { x: -2, z: 0 } }),
    ] });
    const result = applyLayoutCommandWithRefusals(applyLayoutCommand({ layout: candidate }), { layout: before });
    expect(result.refused.length).toBeGreaterThan(0);
    expect(completeLayoutError(result)).toContain('未应用');
    expect(before.floors[0]!.items).toEqual([]);
  });
  it('保留墙线上的门洞标记，不把结构当作越界家具拒绝', () => {
    const marker = makeItem({ id: 'door', name: '门洞', type: 'door', width: 1, depth: 0.16,
      position: { x: 0, z: -4 }, structuralOpeningId: 'opening' });
    const before = makeLayout({ width: 10, height: 8, items: [] });
    const candidate = makeLayout({ width: 10, height: 8, items: [marker] });
    const result = applyLayoutCommandWithRefusals(applyLayoutCommand({ layout: candidate }), { layout: before });
    expect(completeLayoutError(result)).toBeNull();
    expect(result.nextLayout.floors[0]!.items).toContainEqual(marker);
  });
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

/* ---------------- executeSceneCommand ---------------- */

describe('executeSceneCommand', () => {
  it('1. 形状非法（坐标 NaN）→ ok=false、nextLayout 引用等于 ctx.layout、不抛', () => {
    const layout = makeLayout({ width: 10, height: 10, items: [] });
    const cmd = placeItemCommand({
      floorIndex: 0,
      item: makeItem({ id: 'a', name: '坏件', position: { x: NaN, z: 0 } }),
    });
    const result = executeSceneCommand(cmd, { layout });
    expect(result.ok).toBe(false);
    expect(result.nextLayout).toBe(layout);
    expect(result.shapeIssues.length).toBeGreaterThan(0);
    expect(result.refused).toEqual([]);
  });

  it('2. place-item 合法 → ok=true、items 多 1 件、原 layout 不变', () => {
    const layout = makeLayout({ width: 10, height: 10, items: [] });
    const cmd = placeItemCommand({
      floorIndex: 0,
      item: makeItem({ id: 'a', name: '桌', position: { x: 2, z: 2 } }),
    });
    const result = executeSceneCommand(cmd, { layout });
    expect(result.ok).toBe(true);
    expect(result.nextLayout.floors[0]!.items.length).toBe(1);
    expect(result.nextLayout.floors[0]!.items[0]!.id).toBe('a');
    expect(layout.floors[0]!.items.length).toBe(0);
  });

  it('3. place-item 与已有家具重叠 → ok=false、refused 1 条、nextLayout 引用等于原 layout', () => {
    const layout = makeLayout({
      width: 10,
      height: 10,
      items: [makeItem({ id: 'a', name: '桌', position: { x: 0, z: 0 } })],
    });
    const cmd = placeItemCommand({
      floorIndex: 0,
      item: makeItem({ id: 'b', name: '另桌', position: { x: 0.2, z: 0.2 } }),
    });
    const result = executeSceneCommand(cmd, { layout });
    expect(result.ok).toBe(false);
    expect(result.nextLayout).toBe(layout);
    expect(result.refused.length).toBe(1);
    expect(result.refused[0]!.itemId).toBe('b');
  });

  it('4. 没有真实通道标注时，不能把场地中线假定为通道并硬拒绝', () => {
    const table = makeItem({ id: 't', name: '桌', type: 'table', position: { x: -3, z: 0 } });
    const layout = makeLayout({ width: 12, height: 12, items: [table] });
    const cmd = moveItemCommand({ floorIndex: 0, itemId: 't', position: { x: 0, z: 0 } });
    const result = executeSceneCommand(cmd, { layout });
    expect(result.ok).toBe(true);
    expect(result.nextLayout.floors[0]!.items[0]!.position).toEqual({ x: 0, z: 0 });
  });

  it('5. move-item 到合法位 → position 改了、其他件不动', () => {
    const table = makeItem({ id: 't', name: '桌', position: { x: -3, z: 0 } });
    const other = makeItem({ id: 'o', name: '柜', position: { x: 3, z: 3 } });
    const layout = makeLayout({ width: 12, height: 12, items: [table, other] });
    const cmd = moveItemCommand({ floorIndex: 0, itemId: 't', position: { x: -4, z: 2 } });
    const result = executeSceneCommand(cmd, { layout });
    expect(result.ok).toBe(true);
    const moved = result.nextLayout.floors[0]!.items.find((it) => it.id === 't');
    expect(moved?.position).toEqual({ x: -4, z: 2 });
    const unchanged = result.nextLayout.floors[0]!.items.find((it) => it.id === 'o');
    expect(unchanged?.position).toEqual({ x: 3, z: 3 });
  });

  it('6a. remove-item happy path：指定件被过滤掉', () => {
    const layout = makeLayout({
      width: 10,
      height: 10,
      items: [makeItem({ id: 'a', name: 'A' }), makeItem({ id: 'b', name: 'B' })],
    });
    const result = executeSceneCommand(removeItemCommand({ itemId: 'a' }), { layout });
    expect(result.ok).toBe(true);
    expect(result.nextLayout.floors[0]!.items.map((i) => i.id)).toEqual(['b']);
  });

  it('6b. remove-item itemId 不存在 → ok=false、nextLayout 引用等于原 layout', () => {
    const layout = makeLayout({ width: 10, height: 10, items: [makeItem({ id: 'a', name: 'A' })] });
    const result = executeSceneCommand(removeItemCommand({ itemId: 'ghost' }), { layout });
    expect(result.ok).toBe(false);
    expect(result.nextLayout).toBe(layout);
    expect(result.preconditions[0]?.code).toBe('ITEM_NOT_FOUND');
  });

  it('6c. update-item happy path：按 patch 浅合并，不动 id/position', () => {
    const layout = makeLayout({
      width: 10,
      height: 10,
      items: [makeItem({ id: 'a', name: 'A', color: '#aaa' })],
    });
    const result = executeSceneCommand(
      updateItemCommand({ itemId: 'a', patch: { color: '#bbb', id: 'hack' } as Partial<FurnitureItem> }),
      { layout },
    );
    expect(result.ok).toBe(true);
    const updated = result.nextLayout.floors[0]!.items[0]!;
    expect(updated.color).toBe('#bbb');
    expect(updated.id).toBe('a'); // id 不许被 patch 改掉
  });

  it('6d. update-item itemId 不存在 → ok=false', () => {
    const layout = makeLayout({ width: 10, height: 10, items: [makeItem({ id: 'a', name: 'A' })] });
    const result = executeSceneCommand(
      updateItemCommand({ itemId: 'ghost', patch: { color: '#fff' } }),
      { layout },
    );
    expect(result.ok).toBe(false);
    expect(result.preconditions[0]?.code).toBe('ITEM_NOT_FOUND');
  });

  it('6e. swap-asset happy path：assetId/glbUrl/name/type/width/depth/height 被换', () => {
    const layout = makeLayout({
      width: 10,
      height: 10,
      items: [makeItem({ id: 'a', name: 'A', type: 'table' })],
    });
    const result = executeSceneCommand(
      swapAssetCommand({
        itemId: 'a',
        nextAsset: { assetId: 'g1', glbUrl: 'new.glb', name: '新沙发', type: 'sofa', width: 2, depth: 1, height: 0.8 },
      }),
      { layout },
    );
    expect(result.ok).toBe(true);
    const updated = result.nextLayout.floors[0]!.items[0]!;
    expect(updated.assetId).toBe('g1');
    expect(updated.name).toBe('新沙发');
    expect(updated.type).toBe('sofa');
    expect(updated.width).toBe(2);
  });

  it('6f. swap-asset itemId 不存在 → ok=false', () => {
    const layout = makeLayout({ width: 10, height: 10, items: [makeItem({ id: 'a', name: 'A' })] });
    const result = executeSceneCommand(
      swapAssetCommand({
        itemId: 'ghost',
        nextAsset: { assetId: 'g1', glbUrl: 'x', name: 'y', type: 'sofa', width: 1, depth: 1, height: 1 },
      }),
      { layout },
    );
    expect(result.ok).toBe(false);
    expect(result.preconditions[0]?.code).toBe('ITEM_NOT_FOUND');
  });

  it('7. apply-layout baseFingerprint 不匹配 → BASE_FINGERPRINT_MISMATCH、ok=false', () => {
    const layout = makeLayout({ width: 10, height: 10, items: [] });
    const candidate = makeLayout({ width: 10, height: 10, items: [makeItem({ id: 'x', name: 'X' })] });
    const cmd = applyLayoutCommand({ layout: candidate, baseFingerprint: 'deadbeef-deadbeef' });
    const result = executeSceneCommand(cmd, { layout });
    expect(result.ok).toBe(false);
    expect(result.preconditions[0]?.code).toBe('BASE_FINGERPRINT_MISMATCH');
    expect(result.nextLayout).toBe(layout);
  });

  it('8. applyLayoutCommandWithRefusals：5 件候选、2 件被拒、3 件进 nextLayout', () => {
    // 构造：a 合法；b 与 a 重叠 → 拒；c 越界 → 拒；d 合法；e 合法。
    const a = makeItem({ id: 'a', name: 'A桌', type: 'table', position: { x: -3, z: -3 }, width: 1, depth: 1 });
    const b = makeItem({ id: 'b', name: 'B桌', type: 'table', position: { x: -3.2, z: -3.2 }, width: 1, depth: 1 });
    const c = makeItem({ id: 'c', name: 'C桌', type: 'table', position: { x: 8, z: 0 }, width: 1, depth: 1 });
    const d = makeItem({ id: 'd', name: 'D椅', type: 'chair', position: { x: 3, z: 3 }, width: 0.5, depth: 0.5 });
    const e = makeItem({ id: 'e', name: 'E沙发', type: 'sofa', position: { x: 3, z: -3 }, width: 1, depth: 1 });
    const candidate = makeLayout({ width: 10, height: 10, items: [a, b, c, d, e] });

    // 当前画布为空，baseFingerprint 取自空 layout，保证指纹门通过。
    const emptyLayout = makeLayout({ width: 10, height: 10, items: [] });
    const cmd = applyLayoutCommand({ layout: candidate, baseFingerprint: layoutFingerprint(emptyLayout) });
    const result = applyLayoutCommandWithRefusals(cmd, { layout: emptyLayout });

    expect(result.ok).toBe(true);
    const nextIds = result.nextLayout.floors[0]!.items.map((i) => i.id).sort();
    expect(nextIds).toEqual(['a', 'd', 'e']);
    expect(result.refused.length).toBe(2);
    const refusedIds = result.refused.map((r) => r.itemId).sort();
    expect(refusedIds).toEqual(['b', 'c']);
    // 越界件 code 应为 OUT_OF_BOUNDS，重叠件 code 落到 BBOX_OVERLAP。
    const cRefusal = result.refused.find((r) => r.itemId === 'c');
    expect(cRefusal?.code).toBe('OUT_OF_BOUNDS');
  });

  it('9. 不可变性：执行后原 ctx.layout 的结构不被改动', () => {
    const original = makeLayout({
      width: 10,
      height: 10,
      items: [makeItem({ id: 'a', name: 'A', position: { x: 0, z: 0 } })],
    });
    const snapshot = {
      floorCount: original.floors.length,
      itemCount: original.floors[0]!.items.length,
      firstItem: { ...original.floors[0]!.items[0]! },
    };
    const cmd = placeItemCommand({
      floorIndex: 0,
      item: makeItem({ id: 'b', name: 'B', position: { x: 3, z: 3 } }),
    });
    executeSceneCommand(cmd, { layout: original });
    expect(original.floors.length).toBe(snapshot.floorCount);
    expect(original.floors[0]!.items.length).toBe(snapshot.itemCount);
    expect(original.floors[0]!.items[0]!.id).toBe(snapshot.firstItem.id);
    expect(original.floors[0]!.items[0]!.position).toEqual(snapshot.firstItem.position);
  });
});
