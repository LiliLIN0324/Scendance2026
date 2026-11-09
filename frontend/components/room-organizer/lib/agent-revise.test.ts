import { describe, expect, it } from 'vitest';
import { revisePlan, type RevisionProposal } from './agent-proposal';
import { parseRevisionRequest } from './workbench-agent';
import { makeFloor, makeItem, makeLayout } from './__testfixtures__/fixtures';
import type { FurnitureItem, RoomLayout } from './types';

const stage = makeItem({
  id: 'stage-1', type: 'stage-platform', name: '舞台平台',
  // 层高 3m：舞台留出余量，缩放测试才不会因为高过屋顶被几何闸挡下。
  width: 5, depth: 1.2, height: 2.4, position: { x: 0, z: -6 }, rotation: 0,
});
const chairA = makeItem({ id: 'chair-a', type: 'chair', name: '椅子 A', width: 0.5, depth: 0.5, height: 0.9, position: { x: -3, z: 2 } });
const chairB = makeItem({ id: 'chair-b', type: 'chair', name: '椅子 B', width: 0.5, depth: 0.5, height: 0.9, position: { x: 3, z: 2 } });
const tree = makeItem({ id: 'tree-1', type: 'tree', name: '景观树', width: 1, depth: 1, height: 3, position: { x: 9, z: 0 } });

const base: RoomLayout = makeLayout({
  width: 24, height: 16,
  floors: [makeFloor({ items: [stage, chairA, chairB, tree] })],
});

const finalOf = (plan: RevisionProposal): RoomLayout => plan.layouts[plan.layouts.length - 1]!;
const itemsOf = (layout: RoomLayout): FurnitureItem[] => layout.floors[0]!.items;
const byId = (layout: RoomLayout, id: string): FurnitureItem | undefined => itemsOf(layout).find(item => item.id === id);

describe('plan.revise — 只改目标物件', () => {
  it('targets the real stage instead of a backdrop, including the registered asset after cloud reload', () => {
    const backdrop = makeItem({ id: 'backdrop', type: 'backdrop', materialId: 'backdrop', name: '舞台背景板', position: { x: 0, z: -6 } });
    const platform = makeItem({ id: 'platform', type: 'glb-asset', materialId: 'asset', assetId: '2476e655-516e-5563-baad-aa821272acb7', name: '社区会堂舞台模块', position: { x: 0, z: -3 } });
    const layout = makeLayout({ width: 24, height: 16, floors: [makeFloor({ items: [backdrop, platform] })] });
    const plan = revisePlan({ base: layout, floorIndex: 0, ops: parseRevisionRequest('删除舞台')!.ops });
    expect(plan.removing).toBe(1);
    expect(byId(finalOf(plan), 'backdrop')).toEqual(backdrop);
    expect(byId(finalOf(plan), 'platform')).toBeUndefined();
    const onlyBackdrop = makeLayout({ floors: [makeFloor({ items: [backdrop] })] });
    expect(revisePlan({ base: onlyBackdrop, floorIndex: 0, ops: parseRevisionRequest('删除舞台')!.ops }).applied).toBe(0);
  });

  it('asks which object when a role matches several items, including locked ones', () => {
    const locked = { ...chairA, locked: true };
    const layout = makeLayout({ width: 24, height: 16, floors: [makeFloor({ items: [locked, chairB] })] });
    const plan = revisePlan({ base: layout, floorIndex: 0, ops: parseRevisionRequest('删除椅子')!.ops });
    expect(plan.applied).toBe(0);
    expect(plan.conflicts[0]).toMatchObject({ code: 'TARGET_AMBIGUOUS', message: expect.stringContaining('说明左右位置') });
    expect(finalOf(plan)).toEqual(layout);
    const selectedLocked = revisePlan({ base: layout, floorIndex: 0, ops: parseRevisionRequest('把左边椅子删掉')!.ops });
    expect(selectedLocked.applied).toBe(0);
    expect(selectedLocked.conflicts[0]?.code).toBe('LOCKED');
  });

  it.each([false,true])('refuses leftmost selection with unknown positions and preserves locked objects: locked=%s', locked => {
    const {position: _missing, ...unknown} = {...chairA, locked};
    const layout = makeLayout({width:24,height:16,floors:[makeFloor({items:[unknown,chairB]})]});
    for (const text of ['把左边椅子删掉','把左边椅子往左挪1米']) {
      const proposal=revisePlan({base:layout,floorIndex:0,ops:parseRevisionRequest(text)!.ops});
      expect(proposal.applied).toBe(0);
      expect(proposal.conflicts[0]?.code).toBe('TARGET_AMBIGUOUS');
      expect(finalOf(proposal)).toEqual(layout);
    }
  });
  it('refuses side selection when any candidate has a non-finite position', () => {
    const layout=makeLayout({width:24,height:16,floors:[makeFloor({items:[{...chairA,position:{x:NaN,z:0}},chairB]})]});
    const proposal=revisePlan({base:layout,floorIndex:0,ops:parseRevisionRequest('把左边椅子删掉')!.ops});
    expect(proposal.applied).toBe(0);expect(proposal.conflicts[0]?.code).toBe('TARGET_AMBIGUOUS');
  });
  it.each([['把椅子放大5倍',5],['把椅子缩小到0.2倍',0.2]])('retains the exact scale boundary for %s', (text, factor) => {
    expect(parseRevisionRequest(text)?.ops[0]).toMatchObject({kind:'scale',factor});
  });
  it.each([0.19,5.01,10,Number.POSITIVE_INFINITY])('rejects out-of-range scale %s without clamping', factor => {
    const proposal=revisePlan({base,floorIndex:0,ops:[{kind:'scale',itemId:'chair-a',factor}]});
    expect(proposal.applied).toBe(0);
    expect(proposal.conflicts[0]?.message).toContain('超出支持范围');
    expect(finalOf(proposal)).toEqual(base);
  });
  it('does not select an arbitrary anchor or a tied leftmost item', () => {
    const sameX = { ...chairB, position: { x: chairA.position!.x, z: 5 } };
    const layout = makeLayout({ width: 24, height: 16, floors: [makeFloor({ items: [chairA, sameX] })] });
    const plan = revisePlan({ base: layout, floorIndex: 0, ops: parseRevisionRequest('把左边椅子删掉')!.ops });
    expect(plan.conflicts[0]?.code).toBe('TARGET_AMBIGUOUS');
    const anchor = revisePlan({ base: layout, floorIndex: 0, ops: [{ kind: 'add', assetId: 'lamp', anchor: { role: '椅子', sides: 'both' } }] });
    expect(anchor.conflicts[0]?.code).toBe('TARGET_AMBIGUOUS');
    expect(anchor.applied).toBe(0);
  });
  it('按 itemId 挪舞台：其它物件引用与位置都不动', () => {
    const plan = revisePlan({ base, floorIndex: 0, ops: [{ kind: 'move', itemId: 'stage-1', delta: { x: -1.5, z: 0 } }] });
    const final = finalOf(plan);
    expect(plan.applied).toBe(1);
    expect(plan.moved).toBe(1);
    expect(plan.removing).toBe(0);
    expect(plan.added).toBe(0);
    expect(byId(final, 'stage-1')!.position).toEqual({ x: -1.5, z: -6 });
    // 增量修改不是清场重摆：其它物件还是原来那个对象。
    expect(byId(final, 'chair-a')).toBe(chairA);
    expect(byId(final, 'chair-b')).toBe(chairB);
    expect(byId(final, 'tree-1')).toBe(tree);
    expect(itemsOf(final)).toHaveLength(4);
  });

  it('一句话「挪舞台 + 两侧加灯」只动这两处，灯朝观众席', () => {
    const request = parseRevisionRequest('把舞台往西挪 1.5 米，在舞台两侧各加一盏灯，朝向观众席');
    expect(request).not.toBeNull();
    const plan = revisePlan({ base, floorIndex: 0, ops: request!.ops, bands: request!.bands });
    expect(plan.applied).toBe(3);
    expect(plan.moved).toBe(1);
    expect(plan.added).toBe(2);
    expect(plan.removing).toBe(0);
    expect(plan.conflicts).toEqual([]);
    expect(plan.layouts).toHaveLength(3);

    const final = finalOf(plan);
    expect(itemsOf(final)).toHaveLength(6);
    expect(byId(final, 'stage-1')!.position).toEqual({ x: -1.5, z: -6 });
    expect(byId(final, 'chair-a')).toBe(chairA);
    expect(byId(final, 'chair-b')).toBe(chairB);
    expect(byId(final, 'tree-1')).toBe(tree);

    const lamps = itemsOf(final).filter(item => item.type === 'lamp');
    expect(lamps).toHaveLength(2);
    expect(lamps.every(lamp => lamp.rotation === 0)).toBe(true);
    expect(lamps.every(lamp => lamp.position!.z === -6)).toBe(true);
    // 两盏灯分别落在舞台移后的左右两侧，不压舞台包围盒。
    expect(lamps.every(lamp => Math.abs(lamp.position!.x - -1.5) > 2.5)).toBe(true);
    expect(lamps.some(lamp => lamp.position!.x < -1.5)).toBe(true);
    expect(lamps.some(lamp => lamp.position!.x > -1.5)).toBe(true);
  });

  it('按 itemId 删除只少这一件', () => {
    const plan = revisePlan({ base, floorIndex: 0, ops: [{ kind: 'remove', itemId: 'chair-a' }] });
    const final = finalOf(plan);
    expect(plan.removing).toBe(1);
    expect(plan.applied).toBe(1);
    expect(byId(final, 'chair-a')).toBeUndefined();
    expect(byId(final, 'chair-b')).toBe(chairB);
    expect(byId(final, 'stage-1')).toBe(stage);
    expect(itemsOf(final)).toHaveLength(3);
  });

  it('旋转与缩放也只改目标件', () => {
    const plan = revisePlan({
      base, floorIndex: 0,
      ops: [{ kind: 'rotate', itemId: 'chair-a', deltaDeg: 90 }, { kind: 'scale', itemId: 'stage-1', factor: 1.2 }],
    });
    const final = finalOf(plan);
    const rotated = byId(final, 'chair-a')!;
    const scaled = byId(final, 'stage-1')!;
    expect(rotated.rotation).toBeCloseTo(Math.PI / 2, 6);
    expect(scaled.width).toBeCloseTo(6, 6);
    expect(scaled.depth).toBeCloseTo(1.44, 6);
    expect(byId(final, 'chair-b')).toBe(chairB);
    expect(byId(final, 'tree-1')).toBe(tree);
    expect(plan.applied).toBe(2);
  });

  it('「左边第二张桌子往右移 1 米」只动第二张', () => {
    const tableA = makeItem({ id: 'table-a', type: 'table', name: '桌子 A', width: 1.2, depth: 0.8, height: 0.75, position: { x: -4, z: 3 } });
    const tableB = makeItem({ id: 'table-b', type: 'table', name: '桌子 B', width: 1.2, depth: 0.8, height: 0.75, position: { x: 2, z: 3 } });
    const layout = makeLayout({ width: 24, height: 16, floors: [makeFloor({ items: [tableA, tableB] })] });
    const request = parseRevisionRequest('把左边第二张桌子往右移 1 米')!;
    expect(request.ops[0]).toMatchObject({ kind: 'move', role: '桌子', ordinal: 2, side: 'left', delta: { x: 1, z: 0 } });
    const plan = revisePlan({ base: layout, floorIndex: 0, ops: request.ops });
    expect(plan.applied).toBe(1);
    expect(byId(finalOf(plan), 'table-b')!.position).toEqual({ x: 3, z: 3 });
    expect(byId(finalOf(plan), 'table-a')).toBe(tableA);
  });

  it('换颜色只改目标件的 color', () => {
    const request = parseRevisionRequest('把舞台换成蓝色')!;
    expect(request.ops[0]).toMatchObject({ kind: 'recolor', role: '舞台', color: '#3b6fd4' });
    const plan = revisePlan({ base, floorIndex: 0, ops: request.ops });
    expect(plan.applied).toBe(1);
    expect(byId(finalOf(plan), 'stage-1')!.color).toBe('#3b6fd4');
    expect(byId(finalOf(plan), 'chair-a')).toBe(chairA);
  });

  it('锁着的物件不动，并报出来', () => {
    const locked = { ...stage, locked: true };
    const layout = makeLayout({ width: 24, height: 16, floors: [makeFloor({ items: [locked, chairA] })] });
    const plan = revisePlan({ base: layout, floorIndex: 0, ops: [{ kind: 'move', itemId: 'stage-1', delta: { x: -1.5, z: 0 } }] });
    expect(plan.applied).toBe(0);
    expect(plan.conflicts[0]).toMatchObject({ code: 'LOCKED' });
    expect(plan.skipped).toContain('舞台平台');
    expect(byId(finalOf(plan), 'stage-1')!.position).toEqual({ x: 0, z: -6 });
  });
});

describe('plan.revise — 边界约束与替代位置', () => {
  it('加灯落在既有物件包围盒里：不进候选，给替代位置', () => {
    const plan = revisePlan({ base, floorIndex: 0, ops: [{ kind: 'add', assetId: 'lamp', position: { x: 0, z: -6 } }] });
    expect(plan.added).toBe(0);
    expect(plan.applied).toBe(0);
    expect(plan.conflicts[0]).toMatchObject({
      code: 'BBOX_OVERLAP', requested: { x: 0, z: -6 }, message: '压在「舞台平台」的包围盒里',
    });
    expect(plan.conflicts[0]!.alternative).toBeTruthy();
    expect(itemsOf(finalOf(plan)).some(item => item.type === 'lamp')).toBe(false);
  });

  it('加灯越过湖侧景观带：标冲突并给替代位置', () => {
    const bands = [{ side: 'west' as const, depth: 3, label: '西侧景观带' }];
    const plan = revisePlan({ base, floorIndex: 0, ops: [{ kind: 'add', assetId: 'lamp', position: { x: -10.5, z: 0 } }], bands });
    expect(plan.added).toBe(0);
    expect(plan.conflicts[0]).toMatchObject({ code: 'KEEP_OUT_BAND', message: '越过西侧景观带' });
    expect(plan.conflicts[0]!.alternative).toBeTruthy();
    expect(itemsOf(finalOf(plan)).some(item => item.type === 'lamp')).toBe(false);
  });

  it('加灯不压东西也不越带：正常落位', () => {
    const bands = [{ side: 'west' as const, depth: 3, label: '西侧景观带' }];
    const plan = revisePlan({ base, floorIndex: 0, ops: [{ kind: 'add', assetId: 'lamp', position: { x: -8, z: 2 } }], bands });
    expect(plan.conflicts).toEqual([]);
    expect(plan.added).toBe(1);
    const lamp = itemsOf(finalOf(plan)).find(item => item.type === 'lamp')!;
    expect(lamp.position).toEqual({ x: -8, z: 2 });
    expect(byId(finalOf(plan), 'chair-a')).toBe(chairA);
  });

  it('按 assetId 带尺寸添加未知资产：不使用 8 类物料也能落位', () => {
    const plan = revisePlan({
      base, floorIndex: 0,
      ops: [{ kind: 'add', assetId: 'lux3d-stage-prop', name: '灯柱', width: 0.4, depth: 0.4, height: 3, position: { x: 7, z: 4 } }],
    });
    expect(plan.added).toBe(1);
    const added = itemsOf(finalOf(plan)).find(item => item.assetId === 'lux3d-stage-prop')!;
    expect(added.type).toBe('glb-asset');
    expect(added.position).toEqual({ x: 7, z: 4 });
  });

  it('找不到 assetId 又没给尺寸：报 UNKNOWN_ASSET，不硬加', () => {
    const plan = revisePlan({ base, floorIndex: 0, ops: [{ kind: 'add', assetId: 'no-such-asset' }] });
    expect(plan.added).toBe(0);
    expect(plan.conflicts[0]).toMatchObject({ code: 'UNKNOWN_ASSET' });
  });
});

describe('parseRevisionRequest — 和普通加物料分开', () => {
  it('「加两把椅子」仍走物料请求，不被增量命令抢走', () => {
    expect(parseRevisionRequest('加两把椅子')).toBeNull();
  });

  it('读出西移量与距离', () => {
    const request = parseRevisionRequest('把舞台往西挪 1.5 米');
    expect(request!.ops[0]).toMatchObject({ kind: 'move', role: '舞台', delta: { x: -1.5, z: 0 } });
    expect(request!.bands).toEqual([]);
  });

  it('读出两侧各一盏与朝向', () => {
    const request = parseRevisionRequest('在舞台两侧各加一盏灯，朝向观众席');
    expect(request!.ops[0]).toMatchObject({
      kind: 'add', assetId: 'lamp', anchor: { role: '舞台', sides: 'both' }, facing: 'south',
    });
  });

  it('读出删除与旋转', () => {
    expect(parseRevisionRequest('删掉背景板')!.ops[0]).toMatchObject({ kind: 'remove', role: '背景板' });
    expect(parseRevisionRequest('把舞台顺时针旋转 90 度')!.ops[0]).toMatchObject({ kind: 'rotate', role: '舞台', deltaDeg: 90 });
  });

  it('湖侧景观带从这句话里读出来', () => {
    const request = parseRevisionRequest('在湖边西侧留 3 米景观带，把灯往东挪 2 米');
    expect(request!.bands).toEqual([{ side: 'west', depth: 3, label: '西侧景观带' }]);
  });
});
