/**
 * P2-j 几何编辑单测：网格吸附 + 环边命中。
 *
 * 这里锁的是「手感」而不是像素：吸附必须是「靠近才吸、远了不吸」，
 * 边命中必须按屏幕距离判定（不同缩放下米制半径的手感完全不同）。
 */
import { describe, expect, it } from 'vitest';

import { planMetersPerPixel, planPointToPixel, type PlanViewport } from './outdoor-plan-canvas';
import { nearestRingEdge, planGridStepM, SNAP_GRID_TOL_PX, snapPointToGrid } from './site-plan-snap';

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