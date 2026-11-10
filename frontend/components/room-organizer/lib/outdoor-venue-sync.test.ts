import { describe, expect, it } from 'vitest';
import { MAX_ROOM_DIMENSION } from './constants';
import {
  planBoundaryToShellVenue,
  samePlanRing,
  shellVenuePatchFromPlanBoundary,
  shellVenueToPlanBoundary,
  nextOutdoorBoundarySync,
  seededPlanFromLayout,
  seededPlanFromVenue,
  SHELL_RING_LIMIT,
  SHELL_SIZE_LIMIT_M,
} from './outdoor-venue-sync';

/** 一个 20×10 m 的方环：x 0..20（东），y 0..10（北）。 */
const square = [
  { x: 0, y: 0 },
  { x: 20, y: 0 },
  { x: 20, y: 10 },
  { x: 0, y: 10 },
];

describe('planBoundaryToShellVenue', () => {
  it('把 ENU 边界投影成 0..width × 0..depth 的壳体多边形（北落到 z=0）', () => {
    const venue = planBoundaryToShellVenue(square)!;
    expect(venue.width).toBe(20);
    expect(venue.depth).toBe(10);
    expect(venue.scale).toBe(1);
    // (0,0) 在西南角 → 壳体里 x=0、z=depth（南）；(0,10) 在西北角 → z=0。
    expect(venue.polygon).toEqual([
      { x: 0, z: 10 },
      { x: 20, z: 10 },
      { x: 20, z: 0 },
      { x: 0, z: 0 },
    ]);
  });

  it('平移到正象限：负坐标的边界照样落到 0 起点', () => {
    const shifted = square.map(point => ({ x: point.x - 500, y: point.y - 300 }));
    const venue = planBoundaryToShellVenue(shifted)!;
    expect(venue.width).toBe(20);
    expect(venue.depth).toBe(10);
    expect(venue.polygon.every(point => point.x >= 0 && point.x <= 20 && point.z >= 0 && point.z <= 10)).toBe(true);
  });

  it('超上限的大场地按比例缩到 3D 壳体可承载的尺寸', () => {
    const huge = [
      { x: 0, y: 0 },
      { x: 800, y: 0 },
      { x: 800, y: 400 },
      { x: 0, y: 400 },
    ];
    const venue = planBoundaryToShellVenue(huge)!;
    expect(venue.scale).toBeLessThan(1);
    expect(venue.width).toBeLessThanOrEqual(SHELL_SIZE_LIMIT_M);
    expect(venue.depth).toBeLessThanOrEqual(SHELL_SIZE_LIMIT_M);
    // 上限必须跟 3D 编辑器实际可用的场地尺寸对齐，否则 applyLayout 会裁尺寸、
    // 多边形顶点却留在原范围，落到壳体外。
    expect(SHELL_SIZE_LIMIT_M).toBe(MAX_ROOM_DIMENSION);
    expect(venue.width / venue.depth).toBeCloseTo(2, 1);
    expect(venue.polygon.every(point => point.x <= venue.width && point.z <= venue.depth)).toBe(true);
  });

  it('顶点超过 32 个时削到契约上限，外形仍是闭合环', () => {
    const circle = Array.from({ length: 80 }, (_, index) => {
      const angle = (index / 80) * Math.PI * 2;
      return { x: 30 + Math.cos(angle) * 20, y: 30 + Math.sin(angle) * 20 };
    });
    const venue = planBoundaryToShellVenue(circle)!;
    expect(venue.simplified).toBe(true);
    expect(venue.polygon.length).toBe(SHELL_RING_LIMIT);
    expect(venue.polygon.length).toBeLessThan(circle.length);
  });

  it('退化输入返回 null（点数不够 / 面积为零）', () => {
    expect(planBoundaryToShellVenue([{ x: 0, y: 0 }, { x: 1, y: 1 }])).toBeNull();
    expect(planBoundaryToShellVenue([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }])).toBeNull();
  });
});

describe('shellVenueToPlanBoundary', () => {
  it('壳体多边形逆变换回 ENU 边界，和原边界同形', () => {
    const venue = planBoundaryToShellVenue(square)!;
    const back = shellVenueToPlanBoundary(venue);
    expect(back).toEqual(square);
    expect(samePlanRing(back, square)).toBe(true);
  });

  it('没有多边形时退回矩形四角', () => {
    const ring = shellVenueToPlanBoundary({ width: 8, depth: 6 });
    expect(ring).toEqual([
      { x: 0, y: 6 }, { x: 8, y: 6 }, { x: 8, y: 0 }, { x: 0, y: 0 },
    ]);
  });
});

describe('samePlanRing', () => {
  it('起点轮转、绕向相反都算同一圈', () => {
    expect(samePlanRing(square, [square[2]!, square[3]!, square[0]!, square[1]!])).toBe(true);
    expect(samePlanRing(square, [...square].reverse())).toBe(true);
  });

  it('点数不同或某点挪动超容差就不算同一圈', () => {
    expect(samePlanRing(square, square.slice(0, 3))).toBe(false);
    expect(samePlanRing(square, [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 10 }, { x: 0, y: 12 }])).toBe(false);
  });

  it('亚米级抖动仍算同一圈（避免编辑抖动反复写回 3D）', () => {
    const jittered = square.map(point => ({ x: point.x + 0.2, y: point.y - 0.2 }));
    expect(samePlanRing(square, jittered)).toBe(true);
  });
});

describe('shellVenuePatchFromPlanBoundary', () => {
  const layout = {
    backendVenue: {
      shape: 'rectangle' as const,
      width: 40,
      depth: 20,
      height: 4,
      entrances: [
        // 旧矩形正中间 (20,10)：在 40×20 场地里是室内中心；落到新 20×10 场地后是内部点，
        // 不落在边界上，venueSchema 会整份拒绝，所以要清掉。
        { id: '11111111-1111-4111-8111-111111111111', position: { x: 10, z: 5 }, width: 2 },
      ],
    },
  };

  it('写出 polygon + width/height，并清掉已不在新边界上的出入口', () => {
    const patch = shellVenuePatchFromPlanBoundary(layout, square)!;
    expect(patch.width).toBe(20);
    expect(patch.height).toBe(10);
    expect(patch.backendVenue.shape).toBe('polygon');
    expect(patch.backendVenue.polygon).toHaveLength(4);
    expect(patch.backendVenue.entrances).toEqual([]);
    // 层高沿用原场地，不被平面编辑带跑。
    expect(patch.backendVenue.height).toBe(4);
  });

  it('仍落在新边界上的出入口保留', () => {
    const onEdge = {
      backendVenue: {
        ...layout.backendVenue,
        entrances: [{ id: '22222222-2222-4222-8222-222222222222', position: { x: 10, z: 0 }, width: 2 }],
      },
    };
    const patch = shellVenuePatchFromPlanBoundary(onEdge, square)!;
    expect(patch.backendVenue.entrances).toHaveLength(1);
  });

  it('没有旧壳体时默认 3 m 层高', () => {
    const patch = shellVenuePatchFromPlanBoundary({}, square)!;
    expect(patch.backendVenue.height).toBe(3);
  });
});

describe('nextOutdoorBoundarySync', () => {
  it('初次载入只记基线，不写 3D', () => {
    const first = nextOutdoorBoundarySync({ baseline: null }, { boundary: square });
    expect(first.apply).toBe(false);
    expect(first.state.baseline).toEqual(square);
  });

  it('边界没变不写；真改了才写一次', () => {
    const synced = nextOutdoorBoundarySync({ baseline: square }, { boundary: square });
    expect(synced.apply).toBe(false);
    const changed = nextOutdoorBoundarySync({ baseline: square }, { boundary: [...square.slice(0, 3), { x: 0, y: 14 }] });
    expect(changed.apply).toBe(true);
    expect(changed.state.baseline).toEqual([...square.slice(0, 3), { x: 0, y: 14 }]);
  });
});

describe('seededPlanFromVenue', () => {
  it('3D 场地轮廓直接成为 2D 起步边界，锚点写进 plan.anchor', () => {
    const plan = seededPlanFromVenue(
      {
        width: 20,
        depth: 10,
        shape: 'polygon',
        polygon: [{ x: 0, z: 0 }, { x: 20, z: 0 }, { x: 20, z: 10 }, { x: 0, z: 10 }],
      },
      { lng: 120.1413, lat: 30.2545 },
    )!;
    expect(plan.boundary).toHaveLength(4);
    expect(plan.boundary).toContainEqual({ x: 0, y: 10 });
    expect(plan.anchor).toEqual({ lng: 120.1413, lat: 30.2545, crs: 'gcj-02', source: 'asset-geo' });
    expect(plan.zones).toEqual([]);
  });

  it('没有锚点时只播种边界，不编造 plan.anchor', () => {
    const plan = seededPlanFromVenue({ width: 20, depth: 10 }, null)!;
    expect(plan.anchor).toBeUndefined();
    expect(plan.boundary).toHaveLength(4);
  });

  it('退化/缺失的壳体不播种（留给起步矩形）', () => {
    expect(seededPlanFromVenue(null, null)).toBeNull();
    expect(seededPlanFromVenue({ width: 0, depth: 0 }, null)).toBeNull();
    expect(seededPlanFromVenue({ width: Number.NaN, depth: 10 }, null)).toBeNull();
  });

  it('往返一致：播种出的边界再投影回壳体，尺寸不变', () => {
    const plan = seededPlanFromVenue({ width: 20, depth: 10 }, null)!;
    const venue = planBoundaryToShellVenue(plan.boundary)!;
    expect(venue.width).toBe(20);
    expect(venue.depth).toBe(10);
    expect(venue.scale).toBe(1);
  });
});

describe('seededPlanFromLayout', () => {
  it('模板场景只有宽高：按 layout.width/height 播种矩形边界', () => {
    const plan = seededPlanFromLayout({ width: 23.8, height: 16.1 })!;
    const xs = plan.boundary.map(point => point.x);
    const ys = plan.boundary.map(point => point.y);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(23.8, 1);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(16.1, 1);
  });

  it('backendVenue 多边形落在壳体内时采信多边形，而不是退化成矩形', () => {
    const plan = seededPlanFromLayout({
      width: 20,
      height: 10,
      backendVenue: {
        shape: 'polygon',
        polygon: [{ x: 0, z: 0 }, { x: 20, z: 0 }, { x: 10, z: 10 }],
      },
    })!;
    expect(plan.boundary).toHaveLength(3);
  });

  it('多边形和宽高尺度不一致（顶点跑到壳体外）时退回矩形，不种出越界边界', () => {
    const plan = seededPlanFromLayout({
      width: 20,
      height: 10,
      backendVenue: {
        shape: 'polygon',
        polygon: [{ x: 0, z: 0 }, { x: 200, z: 0 }, { x: 200, z: 133 }, { x: 0, z: 133 }],
      },
    })!;
    const xs = plan.boundary.map(point => point.x);
    expect(Math.max(...xs)).toBeLessThanOrEqual(20);
  });

  it('尺寸退化时不播种', () => {
    expect(seededPlanFromLayout({ width: 0, height: 10 })).toBeNull();
    expect(seededPlanFromLayout({ width: Number.NaN, height: 10 })).toBeNull();
  });

  it('有活动点位时把锚点带进 plan.anchor（source=asset-geo）', () => {
    const plan = seededPlanFromLayout({ width: 20, height: 10, mapLngLat: { lng: 120.15, lat: 30.25 } })!;
    expect(plan.anchor).toEqual({ lng: 120.15, lat: 30.25, crs: 'gcj-02', source: 'asset-geo' });
  });
});