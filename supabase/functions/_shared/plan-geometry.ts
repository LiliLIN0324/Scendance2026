/**
 * 户外平面几何纯函数子集（edge 安全，无 DOM/Storage 依赖）。
 *
 * 坐标口径与 site-plan.ts 一致：局部米制 ENU（x 东、y 北）。
 * 几何判定从前端 site-plan-editing.ts 摘出的无界面子集，供 Agent 户外工具校验复用；
 * 视口换算、画布手柄、tokens 配色等仍留在前端，不进 edge。
 */
import type { PlanPoint } from './site-plan.ts';

const EPS = 1e-9;

/** 两点距离（米）。 */
export function planPointDistanceM(a: PlanPoint, b: PlanPoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function planOrient(p: PlanPoint, q: PlanPoint, r: PlanPoint): number {
  const value = (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  return value > EPS ? 1 : value < -EPS ? -1 : 0;
}

function planOnSegment(p: PlanPoint, q: PlanPoint, r: PlanPoint): boolean {
  return (
    q.x >= Math.min(p.x, r.x) - EPS && q.x <= Math.max(p.x, r.x) + EPS
    && q.y >= Math.min(p.y, r.y) - EPS && q.y <= Math.max(p.y, r.y) + EPS
  );
}

/** 两线段是否严格穿越相交（共线重叠、共享端点、贴边触碰都不算；用于跨环越界/重叠判定）。 */
export function planSegmentsCrossStrict(a1: PlanPoint, a2: PlanPoint, b1: PlanPoint, b2: PlanPoint): boolean {
  const o1 = planOrient(a1, a2, b1);
  const o2 = planOrient(a1, a2, b2);
  const o3 = planOrient(b1, b2, a1);
  const o4 = planOrient(b1, b2, a2);
  return o1 * o2 < 0 && o3 * o4 < 0;
}

function planSegmentsTouch(a1: PlanPoint, a2: PlanPoint, b1: PlanPoint, b2: PlanPoint): boolean {
  const o1 = planOrient(a1, a2, b1);
  const o2 = planOrient(a1, a2, b2);
  const o3 = planOrient(b1, b2, a1);
  const o4 = planOrient(b1, b2, a2);
  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && planOnSegment(a1, b1, a2)) return true;
  if (o2 === 0 && planOnSegment(a1, b2, a2)) return true;
  if (o3 === 0 && planOnSegment(b1, a1, b2)) return true;
  if (o4 === 0 && planOnSegment(b1, a2, b2)) return true;
  return false;
}

/** 闭合环是否自交：任两条非相邻边接触（含共线重叠）即为退化。 */
export function planRingSelfIntersects(ring: readonly PlanPoint[]): boolean {
  const n = ring.length;
  if (n < 4) return false;
  for (let i = 0; i < n; i++) {
    const a1 = ring[i]!;
    const a2 = ring[(i + 1) % n]!;
    for (let j = i + 1; j < n; j++) {
      if ((j + 1) % n === i || j === (i + 1) % n) continue;
      const b1 = ring[j]!;
      const b2 = ring[(j + 1) % n]!;
      if (planSegmentsTouch(a1, a2, b1, b2)) return true;
    }
  }
  return false;
}

/** 点是否在闭合环内（边界上视为在内——分区贴边界内沿合法）。射线法 + 边界 epsilon。 */
export function planPointInRing(pt: PlanPoint, ring: readonly PlanPoint[]): boolean {
  let inside = false;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    if (planOrient(a, b, pt) === 0 && planOnSegment(a, pt, b)) return true;
    if ((a.y > pt.y) !== (b.y > pt.y)) {
      const xAtY = a.x + (pt.y - a.y) * (b.x - a.x) / (b.y - a.y);
      if (xAtY > pt.x + EPS) inside = !inside;
    }
  }
  return inside;
}

function isOnRingEdge(pt: PlanPoint, ring: readonly PlanPoint[]): boolean {
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    if (planOrient(a, b, pt) === 0 && planOnSegment(a, pt, b)) return true;
  }
  return false;
}

function planPointInRingInterior(pt: PlanPoint, ring: readonly PlanPoint[]): boolean {
  return planPointInRing(pt, ring) && !isOnRingEdge(pt, ring);
}

/** 两环是否有面积交集（严格判定：共边/顶点触碰不算重叠）。 */
export function planRingsOverlap(a: readonly PlanPoint[], b: readonly PlanPoint[]): boolean {
  for (const pt of a) if (planPointInRingInterior(pt, b)) return true;
  for (const pt of b) if (planPointInRingInterior(pt, a)) return true;
  for (let i = 0; i < a.length; i++) {
    const a1 = a[i]!;
    const a2 = a[(i + 1) % a.length]!;
    for (let j = 0; j < b.length; j++) {
      const b1 = b[j]!;
      const b2 = b[(j + 1) % b.length]!;
      if (planSegmentsCrossStrict(a1, a2, b1, b2)) return true;
    }
  }
  return false;
}
