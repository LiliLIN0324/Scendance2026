import { describe, expect, it } from 'vitest';
import type { FurnitureItem, InteriorWall, RoomLayout } from '../components/room-organizer/lib/types';
import { collectViolations, isPlacementLegal, itemCorners } from './placement-rules';

/** 构造一件家具，缺省值是 1m × 1m、高 0.75m 的桌子，放在原点。 */
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

/** 构造一份极简布局：以原点为中心，宽度 width、深度 height，多 floor。 */
function makeLayout(opts: {
  width: number;
  height: number;
  floors: Array<{ id: string; items: FurnitureItem[]; interiorWalls?: InteriorWall[] }>;
}): RoomLayout {
  return {
    name: 'test-layout',
    width: opts.width,
    height: opts.height,
    floors: opts.floors.map((f) => {
      const floor: RoomLayout['floors'][number] = {
        id: f.id,
        name: f.id,
        items: f.items,
        floorColor: '#ffffff',
      };
      if (f.interiorWalls) floor.interiorWalls = f.interiorWalls;
      return floor;
    }),
  };
}

describe('itemCorners', () => {
  it('45° 旋转的 1m 桌 AABB 半宽 ≈ 0.707（即 √2/2）', () => {
    const item = makeItem({
      id: 't',
      name: '斜桌',
      width: 1,
      depth: 1,
      rotation: Math.PI / 4,
      position: { x: 0, z: 0 },
    });
    const corners = itemCorners(item);
    const maxAbsX = Math.max(...corners.map((c) => Math.abs(c.x)));
    const maxAbsZ = Math.max(...corners.map((c) => Math.abs(c.z)));
    expect(corners.length).toBe(4);
    expect(maxAbsX).toBeCloseTo(Math.SQRT1_2, 5);
    expect(maxAbsZ).toBeCloseTo(Math.SQRT1_2, 5);
  });
});

describe('collectViolations', () => {
  it('合法布局：几件桌子放在场地中央、互不重叠、不越界、不穿墙 → 空 violations', () => {
    const layout = makeLayout({
      width: 10,
      height: 8,
      floors: [
        {
          id: 'f0',
          items: [
            makeItem({ id: 't1', name: '餐桌A', position: { x: -2, z: 0 } }),
            makeItem({ id: 't2', name: '餐桌B', position: { x: 2, z: 1 } }),
            makeItem({ id: 't3', name: '餐桌C', position: { x: 1.5, z: -2 } }),
          ],
        },
      ],
    });
    expect(collectViolations(layout)).toEqual([]);
  });

  it('越界：1m 桌中心挪到 x = width/2 边缘 → OUT_OF_BOUNDS', () => {
    const layout = makeLayout({
      width: 10,
      height: 8,
      floors: [
        {
          id: 'f0',
          items: [makeItem({ id: 't1', name: '越界桌', width: 1, depth: 1, position: { x: 5, z: 0 } })],
        },
      ],
    });
    const vs = collectViolations(layout);
    const oob = vs.filter((v) => v.code === 'OUT_OF_BOUNDS');
    expect(oob.length).toBe(1);
    expect(oob[0]?.itemId).toBe('t1');
  });

  it('重叠：两件 1m 桌中心距离 0.5m → BBOX_OVERLAP，targetId 指向对方', () => {
    const layout = makeLayout({
      width: 10,
      height: 8,
      floors: [
        {
          id: 'f0',
          items: [
            makeItem({ id: 't1', name: '桌A', position: { x: 0, z: 0 } }),
            makeItem({ id: 't2', name: '桌B', position: { x: 0.5, z: 0 } }),
          ],
        },
      ],
    });
    const vs = collectViolations(layout);
    const overlaps = vs.filter((v) => v.code === 'BBOX_OVERLAP');
    // 同一对家具只报一次；itemId 字典序较小的一方挂记录。
    expect(overlaps.length).toBe(1);
    expect(overlaps[0]?.itemId).toBe('t1');
    expect(overlaps[0]?.targetId).toBe('t2');
  });

  it('低矮件豁免：rug（height 0.02）压在桌子上不算 BBOX_OVERLAP', () => {
    const layout = makeLayout({
      width: 10,
      height: 8,
      floors: [
        {
          id: 'f0',
          items: [
            makeItem({ id: 't1', name: '餐桌', position: { x: 1.5, z: 0 } }),
            makeItem({
              id: 'r1',
              name: '地毯',
              type: 'rug',
              height: 0.02,
              width: 3,
              depth: 3,
              position: { x: 0, z: 0 },
            }),
          ],
        },
      ],
    });
    const vs = collectViolations(layout);
    expect(vs.filter((v) => v.code === 'BBOX_OVERLAP')).toEqual([]);
    // 低矮件自身仍要查越界；此处没越界，整体应为空。
    expect(vs).toEqual([]);
  });

  it('穿内墙：家具压在 interiorWalls 线段上 → WALL_INTERSECTION，targetId = wall.id', () => {
    const wall: InteriorWall = { id: 'wall-1', x1: -5, z1: 0, x2: 5, z2: 0 };
    const layout = makeLayout({
      width: 10,
      height: 8,
      floors: [
        {
          id: 'f0',
          interiorWalls: [wall],
          items: [makeItem({ id: 't1', name: '压墙桌', position: { x: 0, z: 0 } })],
        },
      ],
    });
    const vs = collectViolations(layout);
    const hit = vs.filter((v) => v.code === 'WALL_INTERSECTION');
    expect(hit.length).toBe(1);
    expect(hit[0]?.itemId).toBe('t1');
    expect(hit[0]?.targetId).toBe('wall-1');
  });

  it('旋转件：45° 桌在未旋转 AABB 内、但旋转后 AABB 出界时能正确识别（不按未旋转 AABB 误判）', () => {
    // 1m 桌半边长 0.5；45° 旋转后 AABB 半宽 ≈ 0.707。
    // x=4.4：未旋转 maxX=4.9（在 ±5 内），旋转后 maxX≈5.107（出界）。
    const layout = makeLayout({
      width: 10,
      height: 8,
      floors: [
        {
          id: 'f0',
          items: [
            makeItem({
              id: 't1',
              name: '斜桌',
              width: 1,
              depth: 1,
              rotation: Math.PI / 4,
              position: { x: 4.4, z: 0 },
            }),
          ],
        },
      ],
    });
    const vs = collectViolations(layout);
    const oob = vs.filter((v) => v.code === 'OUT_OF_BOUNDS');
    expect(oob.length).toBe(1);
    expect(oob[0]?.itemId).toBe('t1');
  });

  it('缺省扫所有 floor；传 floorIndex 只扫指定层', () => {
    const layout = makeLayout({
      width: 10,
      height: 8,
      floors: [
        { id: 'f0', items: [makeItem({ id: 't-f0', name: '越界桌0', position: { x: 9, z: 0 } })] },
        { id: 'f1', items: [makeItem({ id: 't-f1', name: '越界桌1', position: { x: 9, z: 0 } })] },
      ],
    });
    const all = collectViolations(layout);
    expect(all.filter((v) => v.code === 'OUT_OF_BOUNDS').length).toBe(2);

    const onlyF0 = collectViolations(layout, { floorIndex: 0 });
    expect(onlyF0.filter((v) => v.code === 'OUT_OF_BOUNDS').length).toBe(1);
    expect(onlyF0[0]?.itemId).toBe('t-f0');
  });

  it('空布局（无 items）返回空 violations', () => {
    const layout = makeLayout({
      width: 10,
      height: 8,
      floors: [{ id: 'f0', items: [] }],
    });
    expect(collectViolations(layout)).toEqual([]);
  });
});

describe('isPlacementLegal', () => {
  it('自比：candidate 已在 floor.items 里，不把它自己当重叠对手', () => {
    const item = makeItem({ id: 't1', name: '桌', position: { x: 1.5, z: 0 } });
    const layout = makeLayout({
      width: 10,
      height: 8,
      floors: [{ id: 'f0', items: [item] }],
    });
    // 同一 item 重新判一次：应合法（无自重叠、无越界）。
    expect(isPlacementLegal(layout, 0, item)).toBe(true);
  });

  it('候选家具压到已有家具上 → 不合法', () => {
    const layout = makeLayout({
      width: 10,
      height: 8,
      floors: [
        {
          id: 'f0',
          items: [makeItem({ id: 't1', name: '桌A', position: { x: 0, z: 0 } })],
        },
      ],
    });
    const candidate = makeItem({ id: 't-new', name: '新桌', position: { x: 0.4, z: 0 } });
    expect(isPlacementLegal(layout, 0, candidate)).toBe(false);
  });

  it('候选家具越界 → 不合法', () => {
    const layout = makeLayout({
      width: 10,
      height: 8,
      floors: [{ id: 'f0', items: [] }],
    });
    const candidate = makeItem({ id: 't-new', name: '边桌', position: { x: 5.5, z: 0 } });
    expect(isPlacementLegal(layout, 0, candidate)).toBe(false);
  });
});

describe('M3-B 主通道与孤岛椅', () => {
  it('桌子压在主通道带上（x=0，z=0，1m×1m 桌子）→ 报 MAIN_AISLE_BLOCKED', () => {
    const layout = makeLayout({
      width: 10,
      height: 8,
      floors: [
        { id: 'f0', items: [makeItem({ id: 't1', name: '长桌', position: { x: 0, z: 0 } })] },
      ],
    });
    const vs = collectViolations(layout);
    const blocked = vs.filter((v) => v.code === 'MAIN_AISLE_BLOCKED');
    expect(blocked.length).toBe(1);
    expect(blocked[0]?.itemId).toBe('t1');
  });

  it('椅子摆在主通道带上（x=0，z=0，chair 0.5m×0.5m）→ 不报 MAIN_AISLE_BLOCKED（椅子豁免）', () => {
    const chair = makeItem({
      id: 'c1',
      name: '椅子',
      type: 'chair',
      width: 0.5,
      depth: 0.5,
      position: { x: 0, z: 0 },
    });
    const layout = makeLayout({
      width: 10,
      height: 8,
      floors: [{ id: 'f0', items: [chair] }],
    });
    const vs = collectViolations(layout);
    expect(vs.filter((v) => v.code === 'MAIN_AISLE_BLOCKED')).toEqual([]);
    // 椅子压在通道内，离通道距离为 0，也不应触发 CHAIR_ISLAND。
    expect(vs.filter((v) => v.code === 'CHAIR_ISLAND')).toEqual([]);
    expect(vs).toEqual([]);
  });

  it('大件（backdrop 3m×0.3m）压通道 → 报 MAIN_AISLE_BLOCKED', () => {
    const backdrop = makeItem({
      id: 'b1',
      name: '背景板',
      type: 'backdrop',
      width: 3,
      depth: 0.3,
      position: { x: 0, z: 0 },
    });
    const layout = makeLayout({
      width: 10,
      height: 8,
      floors: [{ id: 'f0', items: [backdrop] }],
    });
    const vs = collectViolations(layout);
    const blocked = vs.filter((v) => v.code === 'MAIN_AISLE_BLOCKED');
    expect(blocked.length).toBe(1);
    expect(blocked[0]?.itemId).toBe('b1');
  });

  it('椅子被 3 件桌子围合在 1.5m 内、且离通道 >0.6m → 报 CHAIR_ISLAND', () => {
    const chair = makeItem({
      id: 'c1',
      name: '孤椅',
      type: 'chair',
      width: 0.5,
      depth: 0.5,
      position: { x: 2.0, z: 0 },
    });
    const t1 = makeItem({ id: 't1', name: '桌A', width: 1, depth: 1, position: { x: 2.0, z: 1.2 } });
    const t2 = makeItem({ id: 't2', name: '桌B', width: 1, depth: 1, position: { x: 2.0, z: -1.2 } });
    const t3 = makeItem({ id: 't3', name: '桌C', width: 1, depth: 1, position: { x: 3.2, z: 0 } });
    const layout = makeLayout({
      width: 10,
      height: 8,
      floors: [{ id: 'f0', items: [chair, t1, t2, t3] }],
    });
    const vs = collectViolations(layout);
    const islands = vs.filter((v) => v.code === 'CHAIR_ISLAND');
    expect(islands.length).toBe(1);
    expect(islands[0]?.itemId).toBe('c1');
  });

  it('椅子离通道近（x=1.0，即距通道边 0.4m）→ 不报 CHAIR_ISLAND', () => {
    const chair = makeItem({
      id: 'c1',
      name: '椅子',
      type: 'chair',
      width: 0.5,
      depth: 0.5,
      position: { x: 1.0, z: 0 },
    });
    const layout = makeLayout({
      width: 10,
      height: 8,
      floors: [{ id: 'f0', items: [chair] }],
    });
    const vs = collectViolations(layout);
    expect(vs.filter((v) => v.code === 'CHAIR_ISLAND')).toEqual([]);
    expect(vs.filter((v) => v.code === 'MAIN_AISLE_BLOCKED')).toEqual([]);
    expect(vs).toEqual([]);
  });

  it('椅子周围只有 2 件家具（<3）→ 不报 CHAIR_ISLAND', () => {
    const chair = makeItem({
      id: 'c1',
      name: '椅子',
      type: 'chair',
      width: 0.5,
      depth: 0.5,
      position: { x: 2.0, z: 0 },
    });
    const t1 = makeItem({ id: 't1', name: '桌A', width: 1, depth: 1, position: { x: 2.0, z: 1.2 } });
    const t2 = makeItem({ id: 't2', name: '桌B', width: 1, depth: 1, position: { x: 2.0, z: -1.2 } });
    const layout = makeLayout({
      width: 10,
      height: 8,
      floors: [{ id: 'f0', items: [chair, t1, t2] }],
    });
    const vs = collectViolations(layout);
    expect(vs.filter((v) => v.code === 'CHAIR_ISLAND')).toEqual([]);
  });
});
