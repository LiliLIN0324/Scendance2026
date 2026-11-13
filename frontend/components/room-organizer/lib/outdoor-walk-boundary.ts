/**
 * 户外第一人称漫游（一期）的边界判定纯函数。
 *
 * 坐标系口径（与 `components/outdoor-plan-3d.tsx`、`three/plan-basemap-tiles.ts` 一致）：
 *  - 规划 ENU：x = 东向米，y = 北向米（`PlanPoint`）。
 *  - three 世界：x = 东，y = 上，z = -北。
 *  因此世界点 `(wx, wz)` 折回 ENU 是 `(ex = wx, ny = -wz)`，反向 `z = -ny`。
 *
 * 本模块不依赖 WebGL / three，可直接单测。一期不做设施占地 / 墙线段碰撞，
 * 这里只负责「人不能走出 `plan.boundary` 多边形」；boundary 不足 3 点（未画起步）
 * 时不做越界判定，位置原样放行。
 */

/** 边界环上的一个 ENU 米制点（结构兼容 `PlanPoint`）。 */
export interface WalkBoundaryPoint {
  x: number;
  y: number;
}

/** 边界环点数不足此值时视为未画起步，不做越界判定。 */
export const MIN_BOUNDARY_POINTS = 3;

/** 边上 / 顶点判定容差（米）。 */
const EDGE_EPSILON = 1e-6;

/** three 世界 `(wx, wz)` → 规划 ENU `(ex, ny)`。 */
export function worldToEnu(wx: number, wz: number): WalkBoundaryPoint {
  return { x: wx, y: -wz };
}

/** 规划 ENU `(ex, ny)` → three 世界 `{ x, z }`。 */
export function enuToWorld(ex: number, ny: number): { x: number; z: number } {
  return { x: ex, z: -ny };
}

/** 点到线段的最短距离（米），ENU 平面。 */
function distanceToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const vx = bx - ax;
  const vy = by - ay;
  const lengthSquared = vx * vx + vy * vy;
  if (lengthSquared < 1e-12) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / lengthSquared));
  return Math.hypot(px - (ax + t * vx), py - (ay + t * vy));
}

/** 点是否落在任一条边界边（含顶点）上。 */
function onBoundaryEdge(point: WalkBoundaryPoint, ring: readonly WalkBoundaryPoint[]): boolean {
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    if (distanceToSegment(point.x, point.y, a.x, a.y, b.x, b.y) <= EDGE_EPSILON) return true;
  }
  return false;
}

/**
 * 点是否在边界多边形内或边上。
 *
 * - ring 为空 / 不足 3 点：未画起步，返回 `true`（不做越界判定）。
 * - 边上、顶点按「在内」处理（站边界线上不被推出）。
 * 射线法（ray casting），顺时针 / 逆时针环都成立。
 */
export function pointInBoundaryRing(
  point: WalkBoundaryPoint,
  ring: readonly WalkBoundaryPoint[],
): boolean {
  if (ring.length < MIN_BOUNDARY_POINTS) return true;
  if (onBoundaryEdge(point, ring)) return true;

  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const a = ring[i]!;
    const b = ring[j]!;
    const crossesY = a.y > point.y !== b.y > point.y;
    if (!crossesY) continue;
    const xIntersect = ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
    if (point.x < xIntersect) inside = !inside;
  }
  return inside;
}

/** 边界环质心（ENU 米）；空环返回 `null`。 */
export function boundaryCentroid(
  ring: readonly WalkBoundaryPoint[],
): WalkBoundaryPoint | null {
  if (ring.length === 0) return null;
  let sumX = 0;
  let sumY = 0;
  for (const point of ring) {
    sumX += point.x;
    sumY += point.y;
  }
  return { x: sumX / ring.length, y: sumY / ring.length };
}

/**
 * 把一帧步行步进约束在边界内：`from → to`，先单独试 x 轴再单独试 y 轴，
 * 某一轴的候选落点在环外就回退到该轴的旧值——贴着边界边滑动而不是被钉死。
 *
 * 返回新的 three 世界 `{ x, z }`。ring 不足 3 点时原样返回 `to`。
 */
export function constrainWorldToBoundary(
  from: Readonly<{ x: number; z: number }>,
  to: Readonly<{ x: number; z: number }>,
  ring: readonly WalkBoundaryPoint[],
): { x: number; z: number } {
  if (ring.length < MIN_BOUNDARY_POINTS) return { x: to.x, z: to.z };

  const fromEnu = worldToEnu(from.x, from.z);
  const toEnu = worldToEnu(to.x, to.z);

  const tryX = { x: toEnu.x, y: fromEnu.y };
  const keptX = pointInBoundaryRing(tryX, ring) ? toEnu.x : fromEnu.x;

  const tryY = { x: keptX, y: toEnu.y };
  const keptY = pointInBoundaryRing(tryY, ring) ? toEnu.y : fromEnu.y;

  return enuToWorld(keptX, keptY);
}
