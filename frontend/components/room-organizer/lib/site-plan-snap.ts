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
import { planPointInRing } from './site-plan-editing';
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
export function snapPointToGrid(pt: PlanPoint, viewport: PlanViewport, stepM?: number): PlanPoint {
  const step = stepM && stepM > 0 ? stepM : planGridStepM(viewport);
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
 * 2026-11-16 用户：「这个挪到接近场地边缘的时候，老是识别超出场地，能不能直接设计成贴边去设计」。
 *
 * 口径（按人类直觉）：场地边界是一道**墙**。
 * - 指针跑到场外 → 顶点直接吸到边界上（沿最近边投影），永远是「贴边」而不是「越界」；
 * - 指针在场内但离边 ≤14 px → 也吸到边界上，因为这时候用户想的就是描着墙走；
 * - 远离边界的点一个不动，不影响正常的细微调整。
 */
export const BOUNDARY_STICK_TOL_PX = 14;

export interface BoundaryStickResult {
  point: PlanPoint;
  /** 真的被边界“抱”住了（调用方据此提示一句）。 */
  stuck: boolean;
}

/** 把点贴到场地边界上：界外一律拉回边界，界内靠近边界时软吸。 */
export function stickPointToBoundary(
  pt: PlanPoint,
  ring: readonly PlanPoint[],
  viewport: PlanViewport,
  tolerancePx: number = BOUNDARY_STICK_TOL_PX,
): BoundaryStickResult {
  if (ring.length < 3) return { point: pt, stuck: false };
  const edge = nearestRingEdge(ring, planPointToPixel(pt, viewport), viewport);
  if (!edge) return { point: pt, stuck: false };
  const inside = planPointInRing(pt, ring);
  if (!inside) return { point: edge.point, stuck: edge.distPx > 0.5 };
  if (edge.distPx <= tolerancePx) {
    const sameX = Math.abs(edge.point.x - pt.x) < 1e-6;
    const sameY = Math.abs(edge.point.y - pt.y) < 1e-6;
    return { point: edge.point, stuck: !(sameX && sameY) };
  }
  return { point: pt, stuck: false };
}

/**
 * 整体拖动一个环（分区）时，别让它从墙上穿出去：
 * 按比例把位移缩到「第一个碰到边界的瞬间」就停住（有点像推箱子撞墙）。
 * 本来就在界外的顶点不作为约束（历史数据不因此被锁死）。
 */
export function clampRingMoveToBoundary(
  base: readonly PlanPoint[],
  moved: readonly PlanPoint[],
  ring: readonly PlanPoint[],
): PlanPoint[] {
  const source = [...moved];
  if (base.length !== moved.length || ring.length < 3) return source;
  const insideAt = (t: number): boolean =>
    base.every((from, index) => {
      if (!planPointInRing(from, ring)) return true;
      const to = moved[index]!;
      return planPointInRing({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t }, ring);
    });
  if (insideAt(1)) return source;
  let lo = 0;
  let hi = 1;
  for (let step = 0; step < 12; step += 1) {
    const mid = (lo + hi) / 2;
    if (insideAt(mid)) lo = mid;
    else hi = mid;
  }
  return base.map((from, index) => {
    const to = moved[index]!;
    return { x: from.x + (to.x - from.x) * lo, y: from.y + (to.y - from.y) * lo };
  });
}

/**
 * 环上离指针最近的那条边（返回边起点序号 + 投影点）。
 * 投影在屏幕像素空间做，命中半径才与「屏幕上看到的距离」一致。
 */
export function nearestRingEdge(
  ring: readonly PlanPoint[],
  px: { x: number; y: number },
  viewport: PlanViewport,
): RingEdgeHit | null {
  return nearestEdgeOn(ring, px, viewport, true);
}

/**
 * 2026-11-15 用户指令「路线和分区一样，可以在线上加点」：动线是**开放折线**，
 * 只有 points.length - 1 条边，不能像环那样把末点接回首点——否则点在线外侧时
 * 会被「虚幻的首尾连线」抢走命中，插出来的点落到线外去。
 */
export function nearestPolylineEdge(
  points: readonly PlanPoint[],
  px: { x: number; y: number },
  viewport: PlanViewport,
): RingEdgeHit | null {
  return nearestEdgeOn(points, px, viewport, false);
}

function nearestEdgeOn(
  points: readonly PlanPoint[],
  px: { x: number; y: number },
  viewport: PlanViewport,
  closed: boolean,
): RingEdgeHit | null {
  if (points.length < 2) return null;
  let best: RingEdgeHit | null = null;
  const edgeCount = closed ? points.length : points.length - 1;
  for (let i = 0; i < edgeCount; i += 1) {
    const from = points[i]!;
    const to = points[(i + 1) % points.length]!;
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

/**
 * 拖动顶点时找「够近可以吞掉」的目标顶点（排除自己）。
 * 用屏幕像素判，不用米：手感与缩放级别无关，放大时不会因为 0.3 m 就误吸。
 */export function nearestMergeTarget(
  ring: readonly PlanPoint[],
  dragIndex: number,
  px: { x: number; y: number },
  viewport: PlanViewport,
  thresholdPx = 12,
): number | null {
  let best: number | null = null;
  let bestDist = thresholdPx;
  for (let i = 0; i < ring.length; i += 1) {
    if (i === dragIndex) continue;
    const p = planPointToPixel(ring[i]!, viewport);
    const d = Math.hypot(p.x - px.x, p.y - px.y);
    if (d <= bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

/**
 * 2026-11-15 用户：「手放的出入口移到流线上时自动吸附在线上，挪开也没问题」。
 * 所以这里只做**软吸附**：指针离某条动线 ≤12 px 时把节点吸到线的投影点上，
 * 离开就自然脱开（不做硬约束、不把节点「粘」在线上）。
 * 多条动线都够近时取最近的那条；都不够近返回 null，调用方保持原落点。
 */
export function nearestRouteSnapPoint(
  px: { x: number; y: number },
  routes: readonly { points: readonly PlanPoint[] }[],
  viewport: PlanViewport,
  thresholdPx = 12,
): PlanPoint | null {
  let best: { point: PlanPoint; distPx: number } | null = null;
  for (const route of routes) {
    const hit = nearestPolylineEdge(route.points, px, viewport);
    if (!hit || hit.distPx > thresholdPx) continue;
    if (best === null || hit.distPx < best.distPx) best = { point: hit.point, distPx: hit.distPx };
  }
  return best ? best.point : null;
}