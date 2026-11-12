/**
 * V-4b（2026-11-13，用户点卡口径=2D 流动动画 v1）：流线上的行人/车流步进引擎。
 *
 * 纯函数步进：按流线折线弧长布「行人点」，匀速前进（1.0–1.3 m/s 个体差）、双向对开、
 * 到端点回绕——模拟是预览性质，不写 plan、不参与统计。密度=每 10m 折线上的点数，
 * 画布据此给流线着色深浅。3D 真行走（person-route 户外化）是后置增强，接口面留这。
 */

import type { PlanRoute } from '../../../../supabase/functions/_shared/site-plan';

export interface FlowWalker {
  /** 第几条流线（对齐传入 routes 数组下标）。 */
  routeIndex: number;
  /** 沿折线已走弧长（米），到端点按方向回绕。 */
  dist: number;
  /** 行进方向：1 顺点序，-1 逆序（双向对开）。 */
  dir: 1 | -1;
  /** 个体速度 m/s（1.0–1.3 假随机，固定种子=下标，保证可复现）。 */
  speed: number;
}

/** 每条流线布点数：按长度每 8m 一个，夹在 2–12；车行/后勤减半。 */
export function walkerCountFor(route: PlanRoute): number {
  const length = polylineLength(route.points);
  const base = Math.round(length / 8);
  const cap = route.kind === 'pedestrian' ? 12 : 6;
  return Math.max(2, Math.min(cap, base || 2));
}

/** 伪随机（确定性）：种子=整数，输出 0–1。 */
function pseudoRandom(seed: number): number {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/** 按流线布 walkers（双向对开：偶数下标顺向、奇数逆向）。 */
export function createFlowWalkers(routes: readonly PlanRoute[]): FlowWalker[] {
  const walkers: FlowWalker[] = [];
  routes.forEach((route, routeIndex) => {
    const count = walkerCountFor(route);
    const total = polylineLength(route.points);
    for (let i = 0; i < count; i += 1) {
      const seed = routeIndex * 100 + i;
      walkers.push({
        routeIndex,
        dist: total * (i / count) + pseudoRandom(seed) * 4,
        dir: i % 2 === 0 ? 1 : -1,
        speed: 1.0 + pseudoRandom(seed + 7) * 0.3,
      });
    }
  });
  return walkers;
}

/** 折线总弧长（米）。 */
export function polylineLength(points: readonly { x: number; y: number }[]): number {
  let total = 0;
  for (let i = 0; i < points.length - 1; i += 1) {
    total += Math.hypot(points[i + 1]!.x - points[i]!.x, points[i + 1]!.y - points[i]!.y);
  }
  return total;
}

/** 弧长 t 处的坐标（沿折线插值；t<0 或超长夹紧回绕由调用方 step 处理）。 */
export function pointAtDistance(points: readonly { x: number; y: number }[], t: number): { x: number; y: number } {
  let remaining = t;
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i]!;
    const b = points[i + 1]!;
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    if (remaining <= seg) {
      const ratio = seg === 0 ? 0 : remaining / seg;
      return { x: a.x + (b.x - a.x) * ratio, y: a.y + (b.y - a.y) * ratio };
    }
    remaining -= seg;
  }
  return points[points.length - 1]!;
}

/** 步进一帧：按 dt 秒推进每个 walker，端点回绕（双向）。返回新数组（不 mutations）。 */
export function stepFlowWalkers(walkers: readonly FlowWalker[], routes: readonly PlanRoute[], dt: number): FlowWalker[] {
  return walkers.map((walker, index) => {
    const route = routes[walker.routeIndex];
    if (!route) return walker;
    const total = polylineLength(route.points);
    if (total <= 0) return walker;
    let dist = walker.dist + walker.dir * walker.speed * dt;
    if (dist > total) dist = dist - total;
    if (dist < 0) dist = dist + total;
    // 回绕时保持方向（环形巡游语义；折返语义留给 3D 真行走引擎）
    void index;
    return { ...walker, dist };
  });
}

/** 每条流线的密度（人/10m）：供画布按深浅着色。 */
export function routeDensity(walkers: readonly FlowWalker[], routes: readonly PlanRoute[]): number[] {
  const counts = routes.map(() => 0);
  for (const walker of walkers) counts[walker.routeIndex] = (counts[walker.routeIndex] ?? 0) + 1;
  return routes.map((route, index) => {
    const length = polylineLength(route.points);
    if (length <= 0) return 0;
    return (counts[index]! / length) * 10;
  });
}

/** walkers 的当前坐标（画布画点用）。 */
export function walkerPoints(walkers: readonly FlowWalker[], routes: readonly PlanRoute[]): { x: number; y: number }[] {
  return walkers.map(walker => {
    const route = routes[walker.routeIndex];
    return route ? pointAtDistance(route.points, walker.dist) : { x: 0, y: 0 };
  });
}
