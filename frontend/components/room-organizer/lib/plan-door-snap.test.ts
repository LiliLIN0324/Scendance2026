import { describe, expect, it } from 'vitest';
import type { PlanViewport } from './outdoor-plan-canvas';
import { planMetersPerPixel } from './outdoor-plan-canvas';
import { DOOR_SNAP_TOLERANCE_PX, doorSnapWalls, snapDoorToIndoorEdge } from './plan-door-snap';

const viewport: PlanViewport = { lng: 120.15, lat: 30.25, zoom: 19, canvasW: 1200, canvasH: 800 };

/** 20×14 的室内分区，形心在 (10,7)。 */
const indoor = {
  id: 'zone-indoor',
  environment: 'indoor' as const,
  polygon: [
    { x: 0, y: 0 },
    { x: 20, y: 0 },
    { x: 20, y: 14 },
    { x: 0, y: 14 },
  ],
};

/** 把「离边多少像素」换成米（吸附阈值是像素，落点是米，这里要换算）。 */
const pxToMeters = (px: number) => px * planMetersPerPixel(viewport);

describe('snapDoorToIndoorEdge', () => {
  it('离边 5px 时吸到边上，坐标正好落在边线', () => {
    const snap = snapDoorToIndoorEdge({
      pt: { x: 10, y: pxToMeters(5) },
      zones: [indoor],
      viewport,
    });
    expect(snap).not.toBeNull();
    expect(snap!.point.y).toBeCloseTo(0, 6);
    expect(snap!.point.x).toBeCloseTo(10, 6);
    expect(snap!.zoneId).toBe('zone-indoor');
  });

  it('角度等于墙的走向（下边 = 0°），门横条压在墙上', () => {
    const snap = snapDoorToIndoorEdge({
      pt: { x: 10, y: pxToMeters(5) },
      zones: [indoor],
      viewport,
    })!;
    // 下边从 (0,0) 走到 (20,0)：门的长边就沿 +X，不是垂直墙面。
    expect(snap.rotationDeg).toBeCloseTo(0, 5);
    // 朝外法线仍然算出来，但只给高亮刻度用。
    expect(snap.normalDeg).toBeCloseTo(-90, 5);
  });

  it('换到右边时角度跟着转（走向 +Y = 90°），法线仍朝外 0°', () => {
    const snap = snapDoorToIndoorEdge({
      pt: { x: 20 - pxToMeters(4), y: 7 },
      zones: [indoor],
      viewport,
    })!;
    expect(snap.point.x).toBeCloseTo(20, 6);
    expect(snap.rotationDeg).toBeCloseTo(90, 5);
    expect(snap.normalDeg).toBeCloseTo(0, 5);
  });

  it('斜边上的门角度取斜边的走向，不是法线', () => {
    // 45° 斜边：(0,0) → (10,10)，形心在斜边另一侧，让法线朝外。
    const triangle = {
      id: 'zone-diagonal',
      environment: 'indoor' as const,
      polygon: [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ],
    };
    const snap = snapDoorToIndoorEdge({
      // 落在斜边内侧 0.2 m 处（斜边法线方向 (−1,1)/√2）。
      pt: { x: 5 + 0.14, y: 5 - 0.14 },
      zones: [triangle],
      viewport,
    })!;
    expect(snap.rotationDeg).toBeCloseTo(45, 5);
    // 形心在斜边左上，朝外就是右下 (−45°)。
    expect(snap.normalDeg).toBeCloseTo(-45, 5);
  });

  it('离边刚好 10px 仍吸；11px 就不吸了', () => {
    const at10 = snapDoorToIndoorEdge({
      pt: { x: 10, y: pxToMeters(DOOR_SNAP_TOLERANCE_PX) },
      zones: [indoor],
      viewport,
    });
    const at11 = snapDoorToIndoorEdge({
      pt: { x: 10, y: pxToMeters(11) },
      zones: [indoor],
      viewport,
    });
    expect(at10).not.toBeNull();
    expect(at11).toBeNull();
  });

  it('室外分区不吸（只有室内才有墙）', () => {
    const snap = snapDoorToIndoorEdge({
      pt: { x: 10, y: pxToMeters(3) },
      zones: [{ ...indoor, id: 'zone-outdoor', environment: 'outdoor' }],
      viewport,
    });
    expect(snap).toBeNull();
  });

  it('室内外未知的分区也不吸（不猜）', () => {
    const snap = snapDoorToIndoorEdge({
      pt: { x: 10, y: pxToMeters(3) },
      zones: [{ ...indoor, environment: 'unknown' }],
      viewport,
    });
    expect(snap).toBeNull();
  });

  it('只有语义 indoor、没有 environment 的旧分区也吸（2026-11-18）', () => {
    const { environment: _drop, ...legacy } = indoor;
    const snap = snapDoorToIndoorEdge({
      pt: { x: 10, y: pxToMeters(4) },
      zones: [{ ...legacy, semantic: 'indoor' }],
      viewport,
    });
    expect(snap).not.toBeNull();
    expect(snap!.point.y).toBeCloseTo(0, 6);
    expect(snap!.rotationDeg).toBeCloseTo(0, 5);
  });

  it('显式标成室外的分区，即使语义写 indoor 也不吸（显式优先）', () => {
    const snap = snapDoorToIndoorEdge({
      pt: { x: 10, y: pxToMeters(3) },
      zones: [{ ...indoor, environment: 'outdoor', semantic: 'indoor' }],
      viewport,
    });
    expect(snap).toBeNull();
  });

  it('多条边都在阈值内时取最近那条', () => {
    // 角落附近：(0.4, 0.3) 米，离下边 0.3 m、离左边 0.4 m。
    const snap = snapDoorToIndoorEdge({
      pt: { x: 0.4, y: 0.3 },
      zones: [indoor],
      viewport,
    })!;
    expect(snap.point.y).toBeCloseTo(0, 6);
    expect(snap.point.x).toBeCloseTo(0.4, 6);
  });

  it('退化分区（不足三点）不参与吸附', () => {
    const snap = snapDoorToIndoorEdge({
      pt: { x: 0, y: 0 },
      zones: [{ id: 'z', environment: 'indoor', polygon: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }],
      viewport,
    });
    expect(snap).toBeNull();
  });
});

describe('snapDoorToIndoorEdge（手画的墙，2026-11-18 用户口径）', () => {
  /** 分区内一条 10 m 的独立隔墙，与分区边线无关。 */
  const drawnWall = {
    id: '6f2c9a10-2222-4333-8444-555566667777',
    points: [{ x: 5, y: 7 }, { x: 15, y: 7 }] as const,
  };

  it('门离墙 4px 时贴在墙线上，角度沿墙走', () => {
    const snap = snapDoorToIndoorEdge({
      pt: { x: 10, y: 7 + pxToMeters(4) },
      zones: [indoor],
      walls: [drawnWall],
      viewport,
    });
    expect(snap).not.toBeNull();
    expect(snap!.wallId).toBe(drawnWall.id);
    expect(snap!.zoneId).toBeUndefined();
    expect(snap!.point).toEqual({ x: 10, y: 7 });
    expect(snap!.rotationDeg).toBeCloseTo(0, 5);
  });

  it('墙优先于分区边：分区边更近也选墙', () => {
    // 门离下边（分区边）1px，离墙 5px：按旧逻辑会吸分区边，现在吸墙。
    const wall = { id: drawnWall.id, points: [{ x: 5, y: 0.5 }, { x: 15, y: 0.5 }] as const };
    const snap = snapDoorToIndoorEdge({
      pt: { x: 10, y: pxToMeters(1) },
      zones: [indoor],
      walls: [wall],
      viewport,
    })!;
    expect(snap.wallId).toBe(wall.id);
    expect(snap.point.y).toBeCloseTo(0.5, 6);
  });

  it('墙够不着时退回分区边（不因为传了墙就永远不吸边）', () => {
    const snap = snapDoorToIndoorEdge({
      pt: { x: 10, y: pxToMeters(3) },
      zones: [indoor],
      walls: [drawnWall],
      viewport,
    })!;
    expect(snap.wallId).toBeUndefined();
    expect(snap.zoneId).toBe(indoor.id);
    expect(snap.point.y).toBeCloseTo(0, 6);
  });

  it('法线朝门来的一侧：墙上方 +90°、下方 −90°', () => {
    const above = snapDoorToIndoorEdge({
      pt: { x: 10, y: 7 + pxToMeters(3) },
      zones: [],
      walls: [drawnWall],
      viewport,
    })!;
    expect(above.normalDeg).toBeCloseTo(90, 5);
    const below = snapDoorToIndoorEdge({
      pt: { x: 10, y: 7 - pxToMeters(3) },
      zones: [],
      walls: [drawnWall],
      viewport,
    })!;
    expect(below.normalDeg).toBeCloseTo(-90, 5);
  });

  it('墙也能吸在端点之外的位置：投影 clamp 在段内', () => {
    const snap = snapDoorToIndoorEdge({
      pt: { x: 4.9, y: 7 + pxToMeters(3) },
      zones: [],
      walls: [drawnWall],
      viewport,
    })!;
    expect(snap.point).toEqual({ x: 5, y: 7 });
  });

  it('多段墙取最近的那段', () => {
    const near = { id: 'near', points: [{ x: 0, y: 3 }, { x: 20, y: 3 }] as const };
    const snap = snapDoorToIndoorEdge({
      pt: { x: 10, y: 3 + pxToMeters(4) },
      zones: [],
      walls: [drawnWall, near],
      viewport,
    })!;
    expect(snap.wallId).toBe('near');
  });

  it('doorSnapWalls 只收正好两点的段（退化的直接跳过）', () => {
    const walls = doorSnapWalls([
      { id: 'ok', points: [{ x: 0, y: 0 }, { x: 1, y: 0 }] },
      { id: 'short', points: [{ x: 0, y: 0 }] },
      { id: 'long', points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }] },
    ]);
    expect(walls.map(wall => wall.id)).toEqual(['ok']);
    expect(doorSnapWalls(undefined)).toEqual([]);
  });
});
