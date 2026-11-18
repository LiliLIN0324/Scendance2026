import { describe, expect, it } from 'vitest';
import type { PlanViewport } from './outdoor-plan-canvas';
import { planMetersPerPixel } from './outdoor-plan-canvas';
import {
  WALL_SNAP_TOLERANCE_PX,
  resolveDrawnWall,
  snapWallPointToIndoorEdge,
  wallLengthM,
  wallSegmentFromPoints,
} from './plan-wall-draw';

const viewport: PlanViewport = { lng: 120.15, lat: 30.25, zoom: 19, canvasW: 1200, canvasH: 800 };
const pxToMeters = (px: number) => px * planMetersPerPixel(viewport);

/** 20×14 的室内分区，形心在 (10,7)。 */
const indoor = {
  id: '3f1c1a9e-0d6b-4c1a-9a51-2b7f0c5e8d31',
  environment: 'indoor' as const,
  polygon: [
    { x: 0, y: 0 },
    { x: 20, y: 0 },
    { x: 20, y: 14 },
    { x: 0, y: 14 },
  ],
};

const outdoor = {
  id: 'b2b3c4d5-0000-4000-8000-00000000beef',
  environment: 'outdoor' as const,
  polygon: [
    { x: 40, y: 0 },
    { x: 60, y: 0 },
    { x: 60, y: 14 },
    { x: 40, y: 14 },
  ],
};

describe('snapWallPointToIndoorEdge', () => {
  it('离边 5px 时吸到边上，端点正好落在边线', () => {
    const snap = snapWallPointToIndoorEdge({
      pt: { x: 10, y: pxToMeters(5) },
      zones: [indoor],
      viewport,
    });
    expect(snap).not.toBeNull();
    expect(snap!.point.y).toBeCloseTo(0, 6);
    expect(snap!.point.x).toBeCloseTo(10, 6);
    expect(snap!.zoneId).toBe(indoor.id);
    expect(snap!.distanceM).toBeCloseTo(pxToMeters(5), 6);
    // 命中的那条边也带出来，画布贴边高亮直接用。
    expect(snap!.edge).toEqual([{ x: 0, y: 0 }, { x: 20, y: 0 }]);
  });

  it('超过 10px 不吸：不是「总是吸」，够不着就返回 null 让端点落在指针处', () => {
    const snap = snapWallPointToIndoorEdge({
      pt: { x: 10, y: pxToMeters(11) },
      zones: [indoor],
      viewport,
    });
    expect(snap).toBeNull();
  });

  it('阈值可覆盖：放大后才吸得上', () => {
    // 分区下方 30px：到最近的下边是 30px，上边在 14 m 外。
    const pt = { x: 10, y: -pxToMeters(30) };
    expect(snapWallPointToIndoorEdge({ pt, zones: [indoor], viewport })).toBeNull();
    const loose = snapWallPointToIndoorEdge({ pt, zones: [indoor], viewport, tolerancePx: 40 });
    expect(loose!.point.y).toBeCloseTo(0, 6);
    expect(loose!.point.x).toBeCloseTo(10, 6);
  });

  it('掉在角落外侧时投影到顶点，不会滑出线段外', () => {
    const snap = snapWallPointToIndoorEdge({
      pt: { x: -pxToMeters(3), y: -pxToMeters(3) },
      zones: [indoor],
      viewport,
    });
    expect(snap!.point).toEqual({ x: 0, y: 0 });
  });

  it('只吸室内：室外分区再近也不吸', () => {
    // 点离外区左边 2px、离内区右边 6px。
    const snap = snapWallPointToIndoorEdge({
      pt: { x: 40 - pxToMeters(2), y: 7 },
      zones: [outdoor],
      viewport,
    });
    expect(snap).toBeNull();

    const mixed = snapWallPointToIndoorEdge({
      pt: { x: 20 + pxToMeters(6), y: 7 },
      zones: [outdoor, indoor],
      viewport,
    });
    expect(mixed!.zoneId).toBe(indoor.id);
    expect(mixed!.point.x).toBeCloseTo(20, 6);
  });

  it('旧数据没有 environment 时按 semantic 认室内', () => {
    const legacy = {
      id: 'legacy-zone',
      semantic: 'indoor',
      polygon: indoor.polygon,
    };
    const snap = snapWallPointToIndoorEdge({
      pt: { x: 10, y: pxToMeters(4) },
      zones: [legacy],
      viewport,
    });
    expect(snap!.zoneId).toBe('legacy-zone');
  });

  it('退化的分区（少于 3 点）直接跳过，不抛错', () => {
    const broken = { id: 'z', environment: 'indoor' as const, polygon: [{ x: 0, y: 0 }, { x: 1, y: 0 }] };
    expect(snapWallPointToIndoorEdge({ pt: { x: 0, y: 0 }, zones: [broken], viewport })).toBeNull();
    expect(snapWallPointToIndoorEdge({ pt: { x: 0, y: 0 }, zones: [], viewport })).toBeNull();
  });
});

describe('wallSegmentFromPoints', () => {
  it('默认按「人画的室内墙」落：3.5 m 高、0.16 m 厚、interior、confirmed', () => {
    const result = wallSegmentFromPoints({
      a: { x: 0, y: 0 },
      b: { x: 6, y: 0 },
      id: '44c4f3e2-1111-4222-8333-944455556666',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lengthM).toBeCloseTo(6, 6);
    expect(result.wall.points).toEqual([{ x: 0, y: 0 }, { x: 6, y: 0 }]);
    expect(result.wall.thicknessM).toBeCloseTo(0.16, 6);
    expect(result.wall.heightM).toBeCloseTo(3.5, 6);
    expect(result.wall.kind).toBe('interior');
    expect(result.wall.status).toBe('confirmed');
    // 没吸到分区就不写 zoneId，别凭空编一个归属。
    expect(result.wall.zoneId).toBeUndefined();
  });

  it('太短（< 0.2 m）拒绝：0 长的墙在 3D 里是空几何', () => {
    expect(wallSegmentFromPoints({
      a: { x: 1, y: 1 },
      b: { x: 1.1, y: 1 },
      id: '44c4f3e2-1111-4222-8333-944455556666',
    })).toEqual({ ok: false, reason: 'too-short' });

    expect(wallSegmentFromPoints({
      a: { x: 1, y: 1 },
      b: { x: 1, y: 1 },
      id: '44c4f3e2-1111-4222-8333-944455556666',
    })).toEqual({ ok: false, reason: 'too-short' });
  });

  it('坐标取到厘米，厚度/高度夹进 schema 范围', () => {
    const result = wallSegmentFromPoints({
      a: { x: 1.23456, y: 2.34567 },
      b: { x: 5.6789, y: 2.34567 },
      id: '44c4f3e2-1111-4222-8333-944455556666',
      thicknessM: 9,
      heightM: 0.1,
    });
    if (!result.ok) throw new Error(result.reason);
    expect(result.wall.points[0]).toEqual({ x: 1.23, y: 2.35 });
    expect(result.wall.points[1]).toEqual({ x: 5.68, y: 2.35 });
    expect(result.wall.thicknessM).toBe(5);
    expect(result.wall.heightM).toBe(0.5);
  });

  it('zoneId 只在是 uuid 时写入（schema 是 z.uuid）', () => {
    const withUuid = wallSegmentFromPoints({
      a: { x: 0, y: 0 },
      b: { x: 3, y: 0 },
      id: '44c4f3e2-1111-4222-8333-944455556666',
      zoneId: indoor.id,
    });
    if (!withUuid.ok) throw new Error(withUuid.reason);
    expect(withUuid.wall.zoneId).toBe(indoor.id);

    const withName = wallSegmentFromPoints({
      a: { x: 0, y: 0 },
      b: { x: 3, y: 0 },
      id: '44c4f3e2-1111-4222-8333-944455556666',
      zoneId: '贵宾室',
    });
    if (!withName.ok) throw new Error(withName.reason);
    expect(withName.wall.zoneId).toBeUndefined();
  });

  it('不改入参：画布传进来的落点对象还要继续用在预览里', () => {
    const a = { x: 0, y: 0 };
    const b = { x: 4, y: 0 };
    wallSegmentFromPoints({ a, b, id: '44c4f3e2-1111-4222-8333-944455556666' });
    expect(a).toEqual({ x: 0, y: 0 });
    expect(b).toEqual({ x: 4, y: 0 });
  });
});

describe('resolveDrawnWall', () => {
  it('两端各吸一条边：画出来正好压在分区边线上，长度按两端点算', () => {
    const result = resolveDrawnWall({
      // 左端离左边 4px，右端离下边 4px：各吸各的那条边。
      a: { x: pxToMeters(4), y: 7 },
      b: { x: 10, y: pxToMeters(4) },
      zones: [indoor],
      viewport,
      id: '44c4f3e2-1111-4222-8333-944455556666',
    });
    if (!result.ok) throw new Error(result.reason);
    expect(result.snappedA).not.toBeNull();
    expect(result.snappedB).not.toBeNull();
    expect(result.wall.points).toEqual([
      { x: 0, y: 7 },
      { x: 10, y: 0 },
    ]);
    expect(result.lengthM).toBeCloseTo(Math.hypot(10, 7), 2);
    expect(result.wall.zoneId).toBe(indoor.id);
  });

  it('够不着的一端保持原样，snapped 为 null（画布据此不画贴边高亮）', () => {
    const result = resolveDrawnWall({
      a: { x: 2, y: pxToMeters(4) },
      b: { x: 8, y: 6 },
      zones: [indoor],
      viewport,
      id: '44c4f3e2-1111-4222-8333-944455556666',
    });
    if (!result.ok) throw new Error(result.reason);
    expect(result.snappedA).not.toBeNull();
    expect(result.snappedB).toBeNull();
    expect(result.wall.points[1]).toEqual({ x: 8, y: 6 });
  });

  it('两端都够不着时不吸，也不报错——墙就是随手画的', () => {
    const result = resolveDrawnWall({
      a: { x: 3, y: 5 },
      b: { x: 9, y: 5 },
      zones: [indoor],
      viewport,
      id: '44c4f3e2-1111-4222-8333-944455556666',
    });
    if (!result.ok) throw new Error(result.reason);
    expect(result.snappedA).toBeNull();
    expect(result.snappedB).toBeNull();
    expect(result.wall.kind).toBe('interior');
    expect(result.wall.zoneId).toBeUndefined();
  });

  it('吸完之后仍然太短就拒绝（两端吸到同一个顶点）', () => {
    const result = resolveDrawnWall({
      // 两个点都离左上角几个像素，吸完都变成 (0,14)。
      a: { x: -pxToMeters(3), y: 14 + pxToMeters(3) },
      b: { x: -pxToMeters(2), y: 14 + pxToMeters(2) },
      zones: [indoor],
      viewport,
      id: '44c4f3e2-1111-4222-8333-944455556666',
    });
    expect(result).toEqual({ ok: false, reason: 'too-short' });
  });
});

describe('墙长与阈值常量', () => {
  it('wallLengthM 按米算', () => {
    expect(wallLengthM({ x: 0, y: 0 }, { x: 3, y: 4 })).toBeCloseTo(5, 6);
    expect(wallLengthM({ x: 2, y: 2 }, { x: 2, y: 2 })).toBe(0);
  });

  it('吸附阈值与门吸同一口径：10px', () => {
    expect(WALL_SNAP_TOLERANCE_PX).toBe(10);
  });
});

describe('墙与墙互吸（2026-11-18 用户「墙体之间也需要互相吸附」）', () => {
  const existing = {
    id: '6f2c9a10-2222-4333-8444-555566667777',
    points: [{ x: 2, y: 4 }, { x: 8, y: 4 }] as const,
  };

  it('靠近已有墙的端点时吸到同一个点：第二段直接接龙', () => {
    const snap = snapWallPointToIndoorEdge({
      pt: { x: 8 + pxToMeters(3), y: 4 + pxToMeters(2) },
      zones: [],
      walls: [existing],
      viewport,
    });
    expect(snap).not.toBeNull();
    expect(snap!.source).toBe('wall');
    expect(snap!.wallId).toBe(existing.id);
    expect(snap!.point).toEqual({ x: 8, y: 4 });
  });

  it('靠近墙身（不在端点）时垂直吸到墙上', () => {
    const snap = snapWallPointToIndoorEdge({
      pt: { x: 5, y: 4 + pxToMeters(4) },
      zones: [],
      walls: [existing],
      viewport,
    })!;
    expect(snap.source).toBe('wall');
    expect(snap.point).toEqual({ x: 5, y: 4 });
  });

  it('墙优先于分区边：两者都在阈值内也选墙', () => {
    // 分区下边在 y=0，已有墙在 y=0.4；点在 y=0.2，两边都 0.2 左右。
    const wall = { id: existing.id, points: [{ x: 2, y: 0.4 }, { x: 8, y: 0.4 }] as const };
    const snap = snapWallPointToIndoorEdge({
      pt: { x: 5, y: 0.2 },
      zones: [indoor],
      walls: [wall],
      viewport,
    })!;
    expect(snap.source).toBe('wall');
    expect(snap.wallId).toBe(existing.id);
    expect(snap.point.y).toBeCloseTo(0.4, 6);
  });

  it('两段墙都近时取更近的那段', () => {
    const near = { id: 'near-wall', points: [{ x: 2, y: 6 }, { x: 8, y: 6 }] as const };
    const snap = snapWallPointToIndoorEdge({
      pt: { x: 5, y: 6 - pxToMeters(2) },
      zones: [],
      walls: [existing, near],
      viewport,
    })!;
    expect(snap.wallId).toBe('near-wall');
  });

  it('第二段从第一段端点起笔时，两段共用同一个点', () => {
    const first = resolveDrawnWall({
      a: { x: 2, y: 4 },
      b: { x: 8, y: 4 },
      id: '44c4f3e2-1111-4222-8333-944455556666',
      zones: [],
      viewport,
    });
    if (!first.ok) throw new Error(first.reason);
    const second = resolveDrawnWall({
      a: { x: 8 + pxToMeters(3), y: 4 + pxToMeters(3) },
      b: { x: 8, y: 9 },
      id: '44c4f3e2-2222-4222-8333-944455556666',
      zones: [],
      walls: [{ id: first.wall.id, points: [first.wall.points[0]!, first.wall.points[1]!] }],
      viewport,
    });
    if (!second.ok) throw new Error(second.reason);
    expect(second.snappedA?.source).toBe('wall');
    expect(second.wall.points[0]).toEqual(first.wall.points[1]);
  });
});
