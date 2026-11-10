/**
 * 几何编辑的纯函数层（P2-j）——网格吸附 + 环边命中。
 *
 * 口径：
 * - 网格步长按「屏幕上好看」选：让一格大约 20px，再从 0.5/1/2/5/10/20/… 里取最接近的
 *   整数米步长。这样城市级视图不会出现 0.3px 一格的隐形网格（会把拖动量化到 10m 跳），
 *   放大后也不会有 3px 一格的花屏。
 * - 吸附是「靠近才吸」：指针离网格线 ≤ SNAP_GRID_TOL_PX 才落到网格，否则保留原始位置。
 *   一格约 20px、容差 6px，所以格中心附近留了自由区（不会被网格钉死）。
 * - 边命中在**屏幕像素空间**做投影：命中半径与用户看到的手感一致，
 *   而不是在米制空间里做（不同缩放下米制半径在屏幕上大小完全不同）。
 *
 * 放这里而不是放进组件，是为了能用单测锁住几何行为（组件只负责接线与绘制）。
 */

import { planMetersPerPixel, planPointToPixel, type PlanViewport } from './outdoor-plan-canvas';
import type { PlanPoint } from '../../../../supabase/functions/_shared/site-plan';

/** 吸附容差（CSS px）：指针离网格线这么近才吸，避免「一动就跳」。 */
export const SNAP_GRID_TOL_PX = 6;

/** 网格目标屏格宽（CSS px）：一格大约这么宽，读起来才不密不疏。 */
const GRID_TARGET_PX = 20;

/** 网格步长候选（米）：只取这些「人类整数字」，读数才好看。 */
const GRID_STEPS_M = [0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000] as const;

/** 吸附网格步长（米）：让一格 ≈ GRID_TARGET_PX，取最接近的整数米候选。 */
export function planGridStepM(viewport: PlanViewport): number {
  const mpp = planMetersPerPixel(viewport);
  if (!Number.isFinite(mpp) || mpp <= 0) return 1;
  const raw = mpp * GRID_TARGET_PX;
  let best: number = GRID_STEPS_M[0];
  let bestDiff = Math.abs(Math.log(raw / best));
  for (const step of GRID_STEPS_M) {
    const diff = Math.abs(Math.log(raw / step));
    if (diff < bestDiff) {
      best = step;
      bestDiff = diff;
    }
  }
  return best;
}

/**
 * 把点吸到网格上：x、y 各自判定（允许只吸一个方向）。
 * 只在离网格线 ≤ SNAP_GRID_TOL_PX 时吸，否则保持原值。
 */
export function snapPointToGrid(pt: PlanPoint, viewport: PlanViewport): PlanPoint {
  const step = planGridStepM(viewport);
  const mpp = planMetersPerPixel(viewport);
  if (!Number.isFinite(mpp) || mpp <= 0) return pt;
  const gx = Math.round(pt.x / step) * step;
  const gy = Math.round(pt.y / step) * step;
  const withinX = Math.abs(gx - pt.x) / mpp <= SNAP_GRID_TOL_PX;
  const withinY = Math.abs(gy - pt.y) / mpp <= SNAP_GRID_TOL_PX;
  return { x: withinX ? gx : pt.x, y: withinY ? gy : pt.y };
}

export type RingEdgeHit = {
  /** 边起点在环里的序号（插入顶点时插在它后面）。 */
  index: number;
  /** 指针在边上的投影点（米制 ENU）。 */
  point: PlanPoint;
  /** 指针到边的屏幕距离（CSS px）。 */
  distPx: number;
};

/**
 * 环上离指针最近的那条边（返回边起点序号 + 投影点）。
 * 投影在屏幕像素空间做，命中半径才与「屏幕上看到的距离」一致。
 */
export function nearestRingEdge(
  ring: readonly PlanPoint[],
  px: { x: number; y: number },
  viewport: PlanViewport,
): RingEdgeHit | null {
  if (ring.length < 2) return null;
  let best: RingEdgeHit | null = null;
  for (let i = 0; i < ring.length; i += 1) {
    const from = ring[i]!;
    const to = ring[(i + 1) % ring.length]!;
    const a = planPointToPixel(from, viewport);
    const b = planPointToPixel(to, viewport);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px.x - a.x) * dx + (px.y - a.y) * dy) / len2));
    const sx = a.x + dx * t;
    const sy = a.y + dy * t;
    const distPx = Math.hypot(px.x - sx, px.y - sy);
    if (best === null || distPx < best.distPx) {
      best = { index: i, point: { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t }, distPx };
    }
  }
  return best;
}