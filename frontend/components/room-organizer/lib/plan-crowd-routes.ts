import { routeCarrier, type PlanPoint, type PlanRoute } from '../../../../supabase/functions/_shared/site-plan';
import { MIN_WAYPOINT_DISTANCE_M, routeLength } from './person-route';
import { planShellFrame } from './plan-footprint-geometry';
import type { CrowdShellPlacement, PlanSiteMetrics } from './plan-scene-placement';
import type { Vec2, WalkRoute } from './types';

function allowsWalking(route: PlanRoute): boolean {
  const carrier = routeCarrier(route);
  return carrier === 'walk' || carrier === 'mixed';
}

export function walkablePedestrianRoutes(routes: readonly PlanRoute[]): PlanRoute[] {
  return routes.filter(route => route.kind === 'pedestrian' && allowsWalking(route) && route.points.length >= 2);
}

function routePoints(points: readonly Vec2[], oneWay: boolean): WalkRoute | null {
  const filtered: Vec2[] = [];
  for (const point of points) {
    const last = filtered.at(-1);
    if (!last || Math.hypot(point.x - last.x, point.z - last.z) >= MIN_WAYPOINT_DISTANCE_M) filtered.push(point);
  }
  return filtered.length < 2 ? null : { points: filtered, loop: false, oneWay, pauseMs: 0 };
}

/** 预览路线直接用平面 ENU，保留红线外、设计范围内的路段。 */
export function worldPreviewRoute(route: PlanRoute): WalkRoute | null {
  return routePoints(route.points.map(({ x, y }) => ({ x, z: -y })), route.oneWay);
}

/** 正交投影到每段，返回最近接入点及其沿线距离。 */
export function nearestRouteEntry(points: readonly Vec2[], position: Vec2): { distance: number; along: number } {
  let nearest = { distance: Infinity, along: 0 };
  let traversed = 0;
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1]!;
    const end = points[index]!;
    const dx = end.x - start.x;
    const dz = end.z - start.z;
    const lengthSquared = dx * dx + dz * dz;
    if (!lengthSquared) continue;
    const length = Math.sqrt(lengthSquared);
    const fraction = Math.min(1, Math.max(0, ((position.x - start.x) * dx + (position.z - start.z) * dz) / lengthSquared));
    const distance = Math.hypot(position.x - start.x - fraction * dx, position.z - start.z - fraction * dz);
    if (distance < nearest.distance) nearest = { distance, along: traversed + fraction * length };
    traversed += length;
  }
  return nearest;
}

const CROWD_ENTRY_SPACING_M = 1.2;

export function assignCrowdWalkRoutes(
  placements: readonly CrowdShellPlacement[],
  routes: readonly PlanRoute[],
  boundary: readonly PlanPoint[],
  metrics: PlanSiteMetrics,
): Map<string, WalkRoute> {
  const frame = planShellFrame(boundary, metrics, { clampPoints: false });
  const toLocal = (point: PlanPoint): Vec2 => {
    const shell = frame?.toShell(point);
    return shell ? { x: shell.x - metrics.width / 2, z: shell.z - metrics.depth / 2 } : { x: point.x, z: -point.y };
  };
  const makeRoutes = (selection: readonly PlanRoute[]) => selection.flatMap(route => {
    const walk = routePoints(route.points.map(toLocal), route.oneWay);
    return walk ? [{ walk, length: routeLength(walk.points, false), used: [] as number[] }] : [];
  });
  const pedestrian = makeRoutes(walkablePedestrianRoutes(routes));
  const service = makeRoutes(routes.filter(route => route.kind === 'service' && allowsWalking(route)));
  const candidates = placements.flatMap(placement => {
    if (!placement.assetId) return [];
    const logistics = /后勤|物流|搬运|保洁|清洁|布场|配送|维修/.test(placement.role);
    const eligible = logistics && service.length > 0 ? service : pedestrian;
    const location = toLocal(placement.at);
    const entries = eligible.map(slot => ({ slot, ...nearestRouteEntry(slot.walk.points, location) }))
      .sort((a, b) => a.distance - b.distance);
    return entries.length ? [{ id: placement.id, entries }] : [];
  });
  candidates.sort((a, b) => a.entries[0]!.distance - b.entries[0]!.distance);
  const assigned = new Map<string, WalkRoute>();
  for (const { id, entries } of candidates) {
    for (const { slot, along } of entries) {
      // 同一入口挤满时，优先从最近的空位接入；短路线只能容下有限人物。
      const choices = [along, 0, slot.length, ...slot.used.flatMap(value =>
        [value - CROWD_ENTRY_SPACING_M, value + CROWD_ENTRY_SPACING_M])];
      const startDistance = choices
        .filter(value => value >= 0 && value <= slot.length && slot.used.every(used => Math.abs(used - value) >= CROWD_ENTRY_SPACING_M - 1e-6))
        .sort((a, b) => Math.abs(a - along) - Math.abs(b - along))[0];
      if (startDistance === undefined) continue;
      slot.used.push(startDistance);
      assigned.set(id, { ...slot.walk, startDistance });
      break;
    }
  }
  return assigned;
}
