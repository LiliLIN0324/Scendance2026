/**
 * P2-j 几何编辑单测：网格吸附 + 环边命中。
 *
 * 这里锁的是「手感」而不是像素：吸附必须是「靠近才吸、远了不吸」，
 * 边命中必须按屏幕距离判定（不同缩放下米制半径的手感完全不同）。
 */
import { describe, expect, it } from 'vitest';

import { planMetersPerPixel, planPointToPixel, type PlanViewport } from './outdoor-plan-canvas';
import { planPointInRing } from './site-plan-editing';
import { clampRingMoveToBoundary, nearestRingEdge, nearestRouteSnapPoint, planGridStepM, SNAP_GRID_TOL_PX, snapPointToGrid, stickPointToBoundary } from './site-plan-snap';

const VIEW: PlanViewport = { lng: 120.146, lat: 30.252, zoom: 19, canvasW: 1000, canvasH: 700 };

describe('planGridStepM', () => {
  it('一格约 20px，且只取整数米候选（放大更细、缩小更粗）', () => {
    const near = planGridStepM({ ...VIEW, zoom: 21 });
    const mid = planGridStepM({ ...VIEW, zoom: 19 });
    const far = planGridStepM({ ...VIEW, zoom: 13 });
    expect(near).toBeLessThan(mid);
    expect(mid).toBeLessThan(far);
    for (const step of [near, mid, far]) {
      expect(Number.isFinite(step)).toBe(true);
      expect(step).toBeGreaterThan(0);
    }
  });

  it('网格在屏幕上的格宽落在 10–40px 之间（不会密成花屏、也不会疏到看不见）', () => {
    for (const zoom of [13, 15, 17, 19, 21]) {
      const viewport = { ...VIEW, zoom };
      const cellPx = planGridStepM(viewport) / planMetersPerPixel(viewport);
      expect(cellPx).toBeGreaterThanOrEqual(10);
      expect(cellPx).toBeLessThanOrEqual(40);
    }
  });
});

describe('snapPointToGrid', () => {
  it('离网格线很近时吸到网格', () => {
    const step = planGridStepM(VIEW);
    const mpp = planMetersPerPixel(VIEW);
    // 偏 2px（小于容差）→ 必须吸回最近的网格线。
    const snapped = snapPointToGrid({ x: step * 6 + mpp * 2, y: step * 3 - mpp * 2 }, VIEW);
    expect(snapped.x).toBeCloseTo(step * 6, 6);
    expect(snapped.y).toBeCloseTo(step * 3, 6);
  });

  it('离网格线很远时保持原位（不能被网格钉死）', () => {
    const step = planGridStepM(VIEW);
    const mpp = planMetersPerPixel(VIEW);
    const offsetM = (SNAP_GRID_TOL_PX + 2) * mpp;
    const far = { x: step * 6 + offsetM, y: step * 3 + offsetM };
    const snapped = snapPointToGrid(far, VIEW);
    expect(snapped.x).toBeCloseTo(far.x, 6);
    expect(snapped.y).toBeCloseTo(far.y, 6);
  });

  it('x、y 各自独立判定：只吸一个方向也可以', () => {
    const step = planGridStepM(VIEW);
    const mpp = planMetersPerPixel(VIEW);
    const snapped = snapPointToGrid({ x: step * 6 + mpp * 2, y: step * 3 + (SNAP_GRID_TOL_PX + 4) * mpp }, VIEW);
    expect(snapped.x).toBeCloseTo(step * 6, 6);
    expect(snapped.y).not.toBeCloseTo(step * 3, 6);
  });
});

describe('nearestRingEdge', () => {
  // 20×20 m 的方形环（ENU 米制），屏幕位置一律用 planPointToPixel 求，不假设画布原点。
  const ring = [
    { x: 0, y: 0 },
    { x: 20, y: 0 },
    { x: 20, y: 20 },
    { x: 0, y: 20 },
  ];

  it('指针落在某条边附近 → 返回该边序号与投影点', () => {
    const mpp = planMetersPerPixel(VIEW);
    // 第 0 条边（(0,0)→(20,0)）中点往北偏 3px（北=+y 米制方向）。
    const probe = planPointToPixel({ x: 10, y: 3 * mpp }, VIEW);
    const hit = nearestRingEdge(ring, probe, VIEW);
    expect(hit).not.toBeNull();
    expect(hit!.index).toBe(0);
    expect(hit!.point.x).toBeCloseTo(10, 6);
    expect(hit!.point.y).toBeCloseTo(0, 6);
    expect(hit!.distPx).toBeCloseTo(3, 6);
  });

  it('指针在环中心 → 返回最近的一条边（距离 10 m 对应的像素）', () => {
    const mpp = planMetersPerPixel(VIEW);
    const hit = nearestRingEdge(ring, planPointToPixel({ x: 10, y: 10 }, VIEW), VIEW);
    expect(hit).not.toBeNull();
    expect(hit!.distPx).toBeCloseTo(10 / mpp, 3);
  });

  it('少于 2 个点 → 没有边可命中', () => {
    expect(nearestRingEdge([{ x: 0, y: 0 }], { x: 0, y: 0 }, VIEW)).toBeNull();
  });
});

describe('贴边：接近场地边缘就不许越界（2026-11-16 用户）', () => {
  // 「这个挪到接近场地边缘的时候，老是识别超出场地，能不能直接设计成贴边去设计」。
  const BOUNDARY = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 0, y: 100 },
  ];

  it('场外的点被拉回最近的边界上（不再产生越界）', () => {
    const stuck = stickPointToBoundary({ x: 130, y: 50 }, BOUNDARY, VIEW);
    expect(stuck.stuck).toBe(true);
    expect(stuck.point.x).toBeCloseTo(100, 6);
    expect(stuck.point.y).toBeCloseTo(50, 6);
    // 顶点真的落在边界上：既不算界外，也不会被判越界。
    expect(planPointInRing(stuck.point, BOUNDARY)).toBe(true);
  });

  it('界内但离边 ≤14 px 的点吸到边界上（描着墙画）', () => {
    const mpp = planMetersPerPixel(VIEW);
    const near = stickPointToBoundary({ x: 100 - 6 * mpp, y: 50 }, BOUNDARY, VIEW);
    expect(near.stuck).toBe(true);
    expect(near.point.x).toBeCloseTo(100, 6);
  });

  it('离边界远的点一个不动（不影响细微调整）', () => {
    const mpp = planMetersPerPixel(VIEW);
    const far = stickPointToBoundary({ x: 100 - 40 * mpp, y: 50 }, BOUNDARY, VIEW);
    expect(far.stuck).toBe(false);
    expect(far.point.x).toBeCloseTo(100 - 40 * mpp, 6);
  });

  it('边界没画完（<3 点）→ 不做任何贴边', () => {
    const pt = { x: 130, y: 50 };
    expect(stickPointToBoundary(pt, [], VIEW)).toEqual({ point: pt, stuck: false });
  });

  it('整体拖动撞墙就停：整个分区不会被推出场地', () => {
    const base = [
      { x: 10, y: 10 },
      { x: 40, y: 10 },
      { x: 40, y: 40 },
      { x: 10, y: 40 },
    ];
    const moved = base.map(p => ({ x: p.x + 200, y: p.y }));
    const clamped = clampRingMoveToBoundary(base, moved, BOUNDARY);
    // 停在边界上：最右顶点不越过 x=100，而且确实动了（不是被钉在原位）。
    expect(Math.max(...clamped.map(p => p.x))).toBeLessThanOrEqual(100 + 1e-6);
    expect(Math.max(...clamped.map(p => p.x))).toBeGreaterThan(99);
    expect(clamped.every(p => planPointInRing(p, BOUNDARY))).toBe(true);
  });

  it('没碰到边界时整体拖动原样通过', () => {
    const base = [
      { x: 10, y: 10 },
      { x: 40, y: 10 },
      { x: 40, y: 40 },
      { x: 10, y: 40 },
    ];
    const moved = base.map(p => ({ x: p.x + 5, y: p.y + 5 }));
    expect(clampRingMoveToBoundary(base, moved, BOUNDARY)).toEqual(moved);
  });

  it('本来就在界外的顶点不会把整块分区锁死（历史数据可继续编辑）', () => {
    const base = [
      { x: 10, y: 10 },
      { x: 120, y: 10 },
      { x: 120, y: 40 },
      { x: 10, y: 40 },
    ];
    const moved = base.map(p => ({ x: p.x + 5, y: p.y }));
    expect(clampRingMoveToBoundary(base, moved, BOUNDARY)).toEqual(moved);
  });
});

describe('nearestRouteSnapPoint（手放的出入口吸到动线上）', () => {
  // 2026-11-15 用户：「出入口移到流线上时自动吸附在线上，挪开也没问题」——软吸附，不粘住。
  const route = { points: [{ x: 0, y: 0 }, { x: 40, y: 0 }] };

  it('指针离动线 3 px → 吸到线上投影点', () => {
    const mpp = planMetersPerPixel(VIEW);
    const snapped = nearestRouteSnapPoint(planPointToPixel({ x: 20, y: 3 * mpp }, VIEW), [route], VIEW);
    expect(snapped).not.toBeNull();
    expect(snapped!.x).toBeCloseTo(20, 4);
    expect(snapped!.y).toBeCloseTo(0, 6);
  });

  it('离得远（>12 px）→ 不吸，返回 null（挪开就脱开）', () => {
    const mpp = planMetersPerPixel(VIEW);
    expect(nearestRouteSnapPoint(planPointToPixel({ x: 20, y: 20 * mpp }, VIEW), [route], VIEW)).toBeNull();
  });

  it('多条动线都够近 → 吸到最近的那条', () => {
    const mpp = planMetersPerPixel(VIEW);
    const far = { points: [{ x: 0, y: 8 * mpp }, { x: 40, y: 8 * mpp }] };
    const snapped = nearestRouteSnapPoint(planPointToPixel({ x: 20, y: 3 * mpp }, VIEW), [far, route], VIEW);
    expect(snapped).not.toBeNull();
    expect(snapped!.y).toBeCloseTo(0, 6);
  });

  it('没有动线 → null（不影响普通拖放）', () => {
    expect(nearestRouteSnapPoint({ x: 0, y: 0 }, [], VIEW)).toBeNull();
  });
});