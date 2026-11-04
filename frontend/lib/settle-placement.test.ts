import { describe, expect, it } from 'vitest';
import type { FurnitureItem, InteriorWall, RoomLayout } from '../components/room-organizer/lib/types';
import { settlePlacement } from './settle-placement';

/** 造一件家具，缺省 0.5m × 0.5m、高 0.45m 的椅子。 */
function makeItem(
  partial: Partial<FurnitureItem> & Pick<FurnitureItem, 'id' | 'name'>,
): FurnitureItem {
  return {
    type: 'chair',
    width: 0.5,
    depth: 0.5,
    height: 0.45,
    position: { x: 0, z: 0 },
    rotation: 0,
    color: '#cccccc',
    icon: '',
    ...partial,
  };
}

/** 造一份极简布局：4m × 6m 场地（x∈[-2,2], z∈[-3,3]），原点居中。 */
function makeLayout(opts: {
  width?: number;
  height?: number;
  floors?: Array<{ id: string; items: FurnitureItem[]; interiorWalls?: InteriorWall[] }>;
}): RoomLayout {
  const width = opts.width ?? 4;
  const height = opts.height ?? 6;
  const floors = opts.floors ?? [{ id: 'f0', items: [] }];
  return {
    name: 'test-layout',
    width,
    height,
    floors: floors.map((f) => {
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

describe('settlePlacement — 基础判据', () => {
  it('1. 空场地 → 0 违规、0 遍、converged', () => {
    const layout = makeLayout({});
    const report = settlePlacement(layout);
    expect(report.remainingViolations).toHaveLength(0);
    expect(report.iterations).toBe(0);
    expect(report.converged).toBe(true);
  });

  it('2. 空 items 数组的 floor 也返回 0 遍', () => {
    const layout = makeLayout({ floors: [{ id: 'f0', items: [] }] });
    const report = settlePlacement(layout);
    expect(report.iterations).toBe(0);
  });

  it('3. 单把椅子压主通道带 (x=0,z=0) → AISLE_TOUCH，收敛后被移出通道', () => {
    const chair = makeItem({ id: 'c1', name: '椅' });
    const layout = makeLayout({ floors: [{ id: 'f0', items: [chair] }] });
    const report = settlePlacement(layout);
    const aisle = report.remainingViolations.filter((v) => v.kind === 'AISLE_TOUCH');
    // 收敛后不应再压通道
    expect(aisle).toHaveLength(0);
    // moved 至少 1 步
    const totalMoved = report.steps.reduce((s, st) => s + st.moved.length, 0);
    expect(totalMoved).toBeGreaterThanOrEqual(1);
    // 椅子最终 |x| > 0.6 + 半宽
    const finalChair = report.layout.floors[0].items.find((i) => i.id === 'c1')!;
    expect(Math.abs(finalChair.position!.x)).toBeGreaterThan(0.6);
  });

  it('4. 越界件 (x=2.5) → OUT_OF_BOUNDS，收敛器内移回场内', () => {
    const chair = makeItem({ id: 'c1', name: '椅', position: { x: 2.5, z: 0 } });
    const layout = makeLayout({ floors: [{ id: 'f0', items: [chair] }] });
    const report = settlePlacement(layout);
    const oob = report.remainingViolations.filter((v) => v.kind === 'OUT_OF_BOUNDS');
    expect(oob).toHaveLength(0);
    const finalChair = report.layout.floors[0].items.find((i) => i.id === 'c1')!;
    // 场地半宽 2，椅子半宽 0.25，最终 |x|+0.25 ≤ 2
    expect(Math.abs(finalChair.position!.x) + 0.25).toBeLessThanOrEqual(2 + 1e-6);
  });

  it('5. 两件重叠椅子 → OVERLAP，收敛器把其中一件推开', () => {
    const c1 = makeItem({ id: 'c1', name: '椅1', position: { x: 0, z: 0 } });
    const c2 = makeItem({ id: 'c2', name: '椅2', position: { x: 0.1, z: 0.1 } });
    const layout = makeLayout({ floors: [{ id: 'f0', items: [c1, c2] }] });
    const report = settlePlacement(layout);
    const overlap = report.remainingViolations.filter((v) => v.kind === 'OVERLAP');
    expect(overlap).toHaveLength(0);
  });

  it('6. 4 把椅子在空地上（z≈2.5, x=±1.0/±1.5）→ 无 ISLAND、无 AISLE_TOUCH', () => {
    const items = [
      makeItem({ id: 'c1', name: '椅1', position: { x: -1.5, z: 2.5 } }),
      makeItem({ id: 'c2', name: '椅2', position: { x: -1.0, z: 2.5 } }),
      makeItem({ id: 'c3', name: '椅3', position: { x: 1.0, z: 2.5 } }),
      makeItem({ id: 'c4', name: '椅4', position: { x: 1.5, z: 2.5 } }),
    ];
    const layout = makeLayout({ floors: [{ id: 'f0', items }] });
    const report = settlePlacement(layout);
    const island = report.remainingViolations.filter((v) => v.kind === 'ISLAND');
    expect(island).toHaveLength(0);
    const aisle = report.remainingViolations.filter((v) => v.kind === 'AISLE_TOUCH');
    expect(aisle).toHaveLength(0);
  });

  it('7. 围合孤岛：椅子被西/北/南桌围在 x≈1.5 处 → 初始含 ISLAND', () => {
    const chair = makeItem({ id: 'c1', name: '椅', position: { x: 1.5, z: 0 } });
    const westTable = makeItem({
      id: 't1',
      name: '西桌',
      type: 'table',
      width: 0.4,
      depth: 0.8,
      height: 0.75,
      position: { x: 0.9, z: 0 },
    });
    const northTable = makeItem({
      id: 't2',
      name: '北桌',
      type: 'table',
      width: 0.8,
      depth: 0.4,
      height: 0.75,
      position: { x: 1.5, z: -0.9 },
    });
    const southTable = makeItem({
      id: 't3',
      name: '南桌',
      type: 'table',
      width: 0.8,
      depth: 0.4,
      height: 0.75,
      position: { x: 1.5, z: 0.9 },
    });
    const layout = makeLayout({
      floors: [{ id: 'f0', items: [chair, westTable, northTable, southTable] }],
    });
    const report = settlePlacement(layout);
    // 第一遍的违规里必须有 ISLAND
    const firstStep = report.steps[0];
    expect(firstStep).toBeDefined();
    const island = firstStep.violations.filter((v) => v.kind === 'ISLAND');
    expect(island.length).toBeGreaterThanOrEqual(1);
    // 遍数不超过上界 2N+4 = 2*4+4 = 12
    expect(report.iterations).toBeLessThanOrEqual(12);
  });
});

describe('settlePlacement — 收敛器行为', () => {
  it('8. 不可变：收敛前后原 layout.floors[0].items 引用与坐标未被改', () => {
    const chair = makeItem({ id: 'c1', name: '椅', position: { x: 0, z: 0 } });
    const layout = makeLayout({ floors: [{ id: 'f0', items: [chair] }] });
    const origItems = layout.floors[0].items;
    const origPos = { ...origItems[0].position! };
    settlePlacement(layout);
    // 原数组引用不变
    expect(layout.floors[0].items).toBe(origItems);
    // 原椅子坐标不变
    expect(layout.floors[0].items[0].position!.x).toBe(origPos.x);
    expect(layout.floors[0].items[0].position!.z).toBe(origPos.z);
  });

  it('9. 修不动的件（四面包夹）→ remainingViolations 含该件、件仍在 layout 里', () => {
    // 椅子在东墙边 (1.9,0)，西桌挡西，北/南桌堵 z，东墙越界 —— 所有试探都失败
    const chair = makeItem({ id: 'c1', name: '椅', position: { x: 1.9, z: 0 } });
    const westTable = makeItem({
      id: 't1',
      name: '西桌',
      type: 'table',
      width: 0.4,
      depth: 1.0,
      height: 0.75,
      position: { x: 1.2, z: 0 },
    });
    const northTable = makeItem({
      id: 't2',
      name: '北桌',
      type: 'table',
      width: 1.0,
      depth: 0.4,
      height: 0.75,
      position: { x: 1.9, z: -0.8 },
    });
    const southTable = makeItem({
      id: 't3',
      name: '南桌',
      type: 'table',
      width: 1.0,
      depth: 0.4,
      height: 0.75,
      position: { x: 1.9, z: 0.8 },
    });
    const layout = makeLayout({
      floors: [{ id: 'f0', items: [chair, westTable, northTable, southTable] }],
    });
    const report = settlePlacement(layout);
    // 椅子仍在最终 layout 里（不被删）
    const finalChair = report.layout.floors[0].items.find((i) => i.id === 'c1');
    expect(finalChair).toBeDefined();
    // remainingViolations 至少含一条（ISLAND 或 AISLE_TOUCH 或 OOB）
    expect(report.remainingViolations.length).toBeGreaterThanOrEqual(1);
  });

  it('10. iterations 不超过 2N+4 硬上界（N=座椅类件数）', () => {
    // 5 把椅子都在通道带内，上界 = 2*5+4 = 14
    const items = Array.from({ length: 5 }, (_, i) =>
      makeItem({ id: `c${i}`, name: `椅${i}`, position: { x: 0, z: -2 + i } }),
    );
    const layout = makeLayout({ floors: [{ id: 'f0', items }] });
    const report = settlePlacement(layout);
    expect(report.iterations).toBeLessThanOrEqual(14);
  });

  it('11. moved 轨迹逐遍递增记录（steps 非空时每步含 moved 数组）', () => {
    const chair = makeItem({ id: 'c1', name: '椅', position: { x: 0, z: 0 } });
    const layout = makeLayout({ floors: [{ id: 'f0', items: [chair] }] });
    const report = settlePlacement(layout);
    expect(report.steps.length).toBe(report.iterations);
    for (const st of report.steps) {
      expect(Array.isArray(st.moved)).toBe(true);
      expect(Array.isArray(st.violations)).toBe(true);
    }
  });

  it('12. 振荡防护：上一遍 from→to 的反向不被立即采纳（不无限跳）', () => {
    // 构造两个候选位置来回跳的场景：两把椅子在通道带边缘，互相推
    const c1 = makeItem({ id: 'c1', name: '椅1', position: { x: 0, z: -1.0 } });
    const c2 = makeItem({ id: 'c2', name: '椅2', position: { x: 0, z: 1.0 } });
    const layout = makeLayout({ floors: [{ id: 'f0', items: [c1, c2] }] });
    const report = settlePlacement(layout);
    // 必须收敛（不能因为振荡跑到上界）
    expect(report.converged).toBe(true);
    expect(report.iterations).toBeLessThanOrEqual(2 * 2 + 4);
  });
});

describe('settlePlacement — BFS / 几何细节', () => {
  it('13. 旋转 45° 的椅子 AABB 被展开（不再用未旋转 width/depth 矩形）', () => {
    // 旋转 45° 的椅子 AABB 半宽 = 0.25*√2 ≈ 0.354（不是 0.25）。
    // x=-0.9 时 AABB maxX = -0.9+0.354 = -0.546 > -0.6，仍触通道 → 3 步上界内无合法落点。
    // 关键判据：若收敛器误用未旋转 AABB（半宽 0.25），x=-0.9 时 maxX=-0.65<-0.6 不触通道，
    // 椅子会被移到 x=-0.9。但实际用旋转 AABB，椅子 3 步内无法移出通道 → 位置不变。
    const chair = makeItem({
      id: 'c1',
      name: '斜椅',
      rotation: Math.PI / 4,
      position: { x: 0, z: 0 },
    });
    const layout = makeLayout({ floors: [{ id: 'f0', items: [chair] }] });
    const report = settlePlacement(layout);
    // 3 步内找不到合法落点，椅子位置不变
    const finalChair = report.layout.floors[0].items.find((i) => i.id === 'c1')!;
    expect(finalChair.position!.x).toBe(0);
    expect(finalChair.position!.z).toBe(0);
    // 残留 AISLE_TOUCH（3 步上界不够把旋转椅完全移出）
    const aisle = report.remainingViolations.filter((v) => v.kind === 'AISLE_TOUCH');
    expect(aisle.length).toBeGreaterThanOrEqual(1);
  });

  it('14. 多 floor 只处理指定 floor（默认 floorIndex=0）', () => {
    const f0Chair = makeItem({ id: 'c0', name: '一楼椅', position: { x: 0, z: 0 } });
    const f1Chair = makeItem({ id: 'c1', name: '二楼椅', position: { x: 0, z: 0 } });
    const layout = makeLayout({
      floors: [
        { id: 'f0', items: [f0Chair] },
        { id: 'f1', items: [f1Chair] },
      ],
    });
    const report = settlePlacement(layout, 0);
    // 一楼椅子被移动
    const finalF0 = report.layout.floors[0].items.find((i) => i.id === 'c0')!;
    expect(Math.abs(finalF0.position!.x)).toBeGreaterThan(0.6);
    // 二楼椅子没动（仍是 x=0）
    const finalF1 = report.layout.floors[1].items.find((i) => i.id === 'c1')!;
    expect(finalF1.position!.x).toBe(0);
  });

  it('15. 装饰件（花瓶/灯）不参与 ISLAND 判定，但参与障碍物占位', () => {
    // 椅子在 (0,0) 通道带，旁边一盏灯不挡 BFS（灯不是 seatingLike），但灯的膨胀框会占空间
    const chair = makeItem({ id: 'c1', name: '椅', position: { x: 0, z: 0 } });
    const vase = makeItem({
      id: 'v1',
      name: '花瓶',
      type: 'vase',
      width: 0.3,
      depth: 0.3,
      height: 0.6,
      position: { x: 1.5, z: 0 },
    });
    const layout = makeLayout({ floors: [{ id: 'f0', items: [chair, vase] }] });
    const report = settlePlacement(layout);
    // 花瓶不应该被报 ISLAND
    const islandOnVase = report.remainingViolations.filter(
      (v) => v.kind === 'ISLAND' && v.itemId === 'v1',
    );
    expect(islandOnVase).toHaveLength(0);
    // 椅子的 AISLE_TOUCH 应被收敛掉
    const aisle = report.remainingViolations.filter((v) => v.kind === 'AISLE_TOUCH');
    expect(aisle).toHaveLength(0);
  });

  it('16. 椅子与内墙相交 → WALL 违规被识别', () => {
    const wall: InteriorWall = {
      id: 'w1',
      x1: -1.0,
      z1: 0.5,
      x2: 1.0,
      z2: 0.5,
    };
    // 椅子在 z=0.5 与内墙重叠
    const chair = makeItem({ id: 'c1', name: '椅', position: { x: 0, z: 0.5 } });
    const layout = makeLayout({
      floors: [{ id: 'f0', items: [chair], interiorWalls: [wall] }],
    });
    const report = settlePlacement(layout);
    // 初始违规里应含 WALL
    const firstStep = report.steps[0];
    expect(firstStep).toBeDefined();
    const wallViolation = firstStep.violations.filter((v) => v.kind === 'WALL');
    expect(wallViolation.length).toBeGreaterThanOrEqual(1);
  });

  it('17. 收敛器把通道带内的椅子推出时不引入 OVERLAP', () => {
    // 椅子在通道带，东边 1.2m 处有一张桌挡着，椅子应被推向西方而非东方
    const chair = makeItem({ id: 'c1', name: '椅', position: { x: 0, z: 0 } });
    const table = makeItem({
      id: 't1',
      name: '东桌',
      type: 'table',
      width: 0.5,
      depth: 1.0,
      height: 0.75,
      position: { x: 1.5, z: 0 },
    });
    const layout = makeLayout({ floors: [{ id: 'f0', items: [chair, table] }] });
    const report = settlePlacement(layout);
    const overlap = report.remainingViolations.filter((v) => v.kind === 'OVERLAP');
    expect(overlap).toHaveLength(0);
    const aisle = report.remainingViolations.filter((v) => v.kind === 'AISLE_TOUCH');
    expect(aisle).toHaveLength(0);
    // 椅子最终应在 x < 0（被推向西方）
    const finalChair = report.layout.floors[0].items.find((i) => i.id === 'c1')!;
    expect(finalChair.position!.x).toBeLessThan(0);
  });

  it('18. 越界件被内移后位置合法（|x|+半宽 ≤ 场地半宽）', () => {
    const chair = makeItem({ id: 'c1', name: '椅', position: { x: 2.4, z: 1.5 } });
    const layout = makeLayout({ floors: [{ id: 'f0', items: [chair] }] });
    const report = settlePlacement(layout);
    const finalChair = report.layout.floors[0].items.find((i) => i.id === 'c1')!;
    expect(Math.abs(finalChair.position!.x) + 0.25).toBeLessThanOrEqual(2 + 1e-6);
    expect(Math.abs(finalChair.position!.z) + 0.25).toBeLessThanOrEqual(3 + 1e-6);
    expect(report.remainingViolations.filter((v) => v.kind === 'OUT_OF_BOUNDS')).toHaveLength(0);
  });

  it('19. 收敛后 steps 最后一遍的 moved 应为空（终止于空遍）', () => {
    const chair = makeItem({ id: 'c1', name: '椅', position: { x: 0, z: 0 } });
    const layout = makeLayout({ floors: [{ id: 'f0', items: [chair] }] });
    const report = settlePlacement(layout);
    if (report.converged) {
      const lastStep = report.steps[report.steps.length - 1];
      expect(lastStep.moved).toHaveLength(0);
    }
  });

  it('20. 无违规的正常布局（椅子在空地 x=1.5,z=0）→ 0 遍、不修改', () => {
    const chair = makeItem({ id: 'c1', name: '椅', position: { x: 1.5, z: 0 } });
    const layout = makeLayout({ floors: [{ id: 'f0', items: [chair] }] });
    const report = settlePlacement(layout);
    expect(report.iterations).toBe(0);
    expect(report.remainingViolations).toHaveLength(0);
  });

  it('21. 指定 floorIndex=1 处理二楼，一楼不动', () => {
    const f0Item = makeItem({ id: 'c0', name: '一楼椅', position: { x: 0, z: 0 } });
    const f1Item = makeItem({ id: 'c1', name: '二楼椅', position: { x: 0, z: 0 } });
    const layout = makeLayout({
      floors: [
        { id: 'f0', items: [f0Item] },
        { id: 'f1', items: [f1Item] },
      ],
    });
    const report = settlePlacement(layout, 1);
    const finalF1 = report.layout.floors[1].items.find((i) => i.id === 'c1')!;
    expect(Math.abs(finalF1.position!.x)).toBeGreaterThan(0.6);
    const finalF0 = report.layout.floors[0].items.find((i) => i.id === 'c0')!;
    expect(finalF0.position!.x).toBe(0);
  });

  it('22. 不可变：返回的 layout.floors 数组是新引用，但未动的 floor 保留原引用', () => {
    const chair = makeItem({ id: 'c1', name: '椅', position: { x: 0, z: 0 } });
    const layout = makeLayout({
      floors: [
        { id: 'f0', items: [chair] },
        { id: 'f1', items: [] },
      ],
    });
    const f1Ref = layout.floors[1];
    const report = settlePlacement(layout, 0);
    expect(report.layout.floors[1]).toBe(f1Ref);
  });
});
