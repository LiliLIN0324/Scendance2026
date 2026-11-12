/**
 * V-2c（2026-11-13）：路网 → 流线/出入口提案（纯函数，预览不落盘）。
 *
 * 输入场地边界（ENU）+ 路网折线（GCJ），产出走既有 planRouteSchema/planNodeSchema 的
 * 完整实体草案——人流/车流/后勤三类（契约天生三分）、出入口节点落在道路与边界交点。
 * 只产「提案」，应用由用户在气泡里确认（虚线预览 → 应用才 commitPlan，可撤销）。
 * v1 口径（用户拍板按常识出再调）：主/次干道=车行，支路街巷=后勤，步行道=人行。
 */

import { metersPerDegreeLng } from './tdt-probe-scale';
import { routeClassForHighway, routeClassLabel, type RoadSegment, type RouteClass } from './road-network';
import type { PlanNode, PlanPoint, PlanRoute } from '../../../../supabase/functions/_shared/site-plan';

/** 各类流线条数上限（提案保持克制，用户可手画补足）。 */
const CLASS_CAP: Record<RouteClass, number> = { pedestrian: 3, vehicle: 3, service: 2 };
/** 出入口节点上限（契约 ≤100，提案先克制）。 */
const NODE_CAP = 8;
/** 道路拾取范围：边界外扩这么多的 bbox（米）。 */
const BBOX_MARGIN_M = 150;
/** 出入口去重距离（米）。 */
const NODE_DEDUPE_M = 10;

/** 「排流线」「自动排入口」→ 生成指令；其余（删流线等）不劫持。 */
export function matchRouteCommand(text: string): 'auto' | null {
  const trimmed = text.trim();
  if (trimmed.length < 3 || trimmed.length > 60) return null;
  if (/(?:删除|去掉|清空|移除)(?:全部)?流线/u.test(trimmed)) return null;
  if (/排(?:一下)?流线|画(?:出)?流线|生成流线|自动排流线|流线怎么排|排(?:一下)?线|自动排(?:一下)?(?:入口|出入口)/u.test(trimmed)) return 'auto';
  return null;
}

/** 折线在 bbox（ENU 米）内的连续段：出界的点断开，不足 2 点的段丢弃。 */
function clipRunsToBBox(points: PlanPoint[], bbox: { west: number; south: number; east: number; north: number }): PlanPoint[][] {
  const runs: PlanPoint[][] = [];
  let current: PlanPoint[] = [];
  for (const point of points) {
    const inside = point.x >= bbox.west && point.x <= bbox.east && point.y >= bbox.south && point.y <= bbox.north;
    if (inside) current.push(point);
    else if (current.length > 0) { runs.push(current); current = []; }
  }
  if (current.length > 0) runs.push(current);
  return runs.filter(run => run.length >= 2);
}

/** 线段相交（参数法），返回交点；共线/端点搭接不算入口交点。 */
function segmentIntersection(a1: PlanPoint, a2: PlanPoint, b1: PlanPoint, b2: PlanPoint): PlanPoint | null {
  const d1x = a2.x - a1.x; const d1y = a2.y - a1.y;
  const d2x = b2.x - b1.x; const d2y = b2.y - b1.y;
  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < 1e-9) return null;
  const t = ((b1.x - a1.x) * d2y - (b1.y - a1.y) * d2x) / denom;
  const u = ((b1.x - a1.x) * d1y - (b1.y - a1.y) * d1x) / denom;
  if (t <= 0 || t >= 1 || u <= 0 || u >= 1) return null;
  return { x: a1.x + t * d1x, y: a1.y + t * d1y };
}

/** 道路折线与边界环的所有交点（沿道路顺序）。 */
function boundaryCrossings(road: PlanPoint[], boundary: PlanPoint[]): PlanPoint[] {
  const crossings: PlanPoint[] = [];
  for (let i = 0; i < road.length - 1; i += 1) {
    for (let j = 0; j < boundary.length; j += 1) {
      const next = boundary[(j + 1) % boundary.length]!;
      const hit = segmentIntersection(road[i]!, road[i + 1]!, boundary[j]!, next);
      if (hit) crossings.push(hit);
    }
  }
  return crossings;
}

function dedupePoints(points: PlanPoint[], epsM: number): PlanPoint[] {
  const out: PlanPoint[] = [];
  for (const point of points) {
    const last = out[out.length - 1];
    if (last && Math.hypot(last.x - point.x, last.y - point.y) <= epsM) continue;
    out.push(point);
  }
  return out;
}

/** 点列抽稀到上限（等步长；路网折线在服务端已简化过）。 */
function decimate(points: PlanPoint[], maxPoints = 128): PlanPoint[] {
  if (points.length <= maxPoints) return points;
  const stride = Math.ceil(points.length / maxPoints);
  const out: PlanPoint[] = [];
  for (let i = 0; i < points.length; i += stride) out.push(points[i]!);
  return out;
}

/** GCJ 折线 → ENU 米（相对锚点；与 enuToLngLat 同一套球面近似）。 */
function roadToEnu(road: RoadSegment, anchor: { lng: number; lat: number }): PlanPoint[] {
  const kx = metersPerDegreeLng(anchor.lat);
  return road.points.map(([lng, lat]) => ({ x: (lng - anchor.lng) * kx, y: (lat - anchor.lat) * 111132.92 }));
}

function ringBBox(boundary: readonly PlanPoint[]): { west: number; south: number; east: number; north: number } {
  let west = Infinity; let south = Infinity; let east = -Infinity; let north = -Infinity;
  for (const point of boundary) {
    west = Math.min(west, point.x); east = Math.max(east, point.x);
    south = Math.min(south, point.y); north = Math.max(north, point.y);
  }
  return { west: west - BBOX_MARGIN_M, south: south - BBOX_MARGIN_M, east: east + BBOX_MARGIN_M, north: north + BBOX_MARGIN_M };
}

function routeWidth(routeClass: RouteClass): number {
  return routeClass === 'vehicle' ? 6 : routeClass === 'service' ? 4 : 2;
}

export interface RouteProposal {
  routes: PlanRoute[];
  nodes: PlanNode[];
  summary: { pedestrian: number; vehicle: number; service: number; entrances: number };
}

export interface BuildRouteProposalInput {
  boundary: PlanPoint[];
  anchor: { lng: number; lat: number };
  roads: RoadSegment[];
}

/**
 * 路网 → 提案。没有可用道路（路网为空/全在范围外）回 null，调用方回「路网暂时拿不到」。
 */
export function buildRouteProposal(
  input: BuildRouteProposalInput,
  idFactory: () => string = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `r-${Math.random().toString(36).slice(2)}`),
): RouteProposal | null {
  const { boundary, anchor, roads } = input;
  if (boundary.length < 3 || roads.length === 0) return null;
  const bbox = ringBBox(boundary);

  // 分类拾取：类内按「落在范围内的折线总长」降序，超上限丢弃。
  const byClass: Record<RouteClass, { road: RoadSegment; enu: PlanPoint[]; lengthM: number }[]> = {
    pedestrian: [], vehicle: [], service: [],
  };
  for (const road of roads) {
    const routeClass = routeClassForHighway(road.highway);
    if (!routeClass) continue;
    const enu = roadToEnu(road, anchor);
    let lengthM = 0;
    for (let i = 0; i < enu.length - 1; i += 1) {
      const mx = (enu[i]!.x + enu[i + 1]!.x) / 2;
      const my = (enu[i]!.y + enu[i + 1]!.y) / 2;
      if (mx < bbox.west || mx > bbox.east || my < bbox.south || my > bbox.north) continue;
      lengthM += Math.hypot(enu[i + 1]!.x - enu[i]!.x, enu[i + 1]!.y - enu[i]!.y);
    }
    if (lengthM < 5) continue;
    byClass[routeClass].push({ road, enu, lengthM });
  }
  const picked: { road: RoadSegment; enu: PlanPoint[]; routeClass: RouteClass }[] = [];
  for (const routeClass of ['vehicle', 'service', 'pedestrian'] as RouteClass[]) {
    byClass[routeClass].sort((a, b) => b.lengthM - a.lengthM);
    for (const entry of byClass[routeClass].slice(0, CLASS_CAP[routeClass])) {
      picked.push({ road: entry.road, enu: entry.enu, routeClass });
    }
  }
  if (picked.length === 0) return null;

  const routes: PlanRoute[] = [];
  const nodes: PlanNode[] = [];
  const usedNames = new Set<string>();
  let crossingsTotal = 0;
  for (const { road, enu, routeClass } of picked) {
    const runs = clipRunsToBBox(enu, bbox);
    const label = routeClassLabel(routeClass);
    for (const run of runs) {
      const points = decimate(dedupePoints(run, 2), 128);
      if (points.length < 2) continue;
      let name = road.name ? `${label}流线（${road.name}）` : `${label}流线`;
      let suffix = 2;
      while (usedNames.has(name)) { name = `${label}流线（${road.name || label}）${suffix}`; suffix += 1; }
      usedNames.add(name);
      routes.push({
        id: idFactory(),
        kind: routeClass,
        name,
        points,
        oneWay: false,
        widthM: routeWidth(routeClass),
        notes: 'AI 路网提案：依据 OSM 道路自动排布，可在画布继续编辑',
      });
      // 入口：这条折线与边界的交点（沿路序，最多 2 个/条）
      const crossings = dedupePoints(boundaryCrossings(points, boundary), NODE_DEDUPE_M).slice(0, 2);
      for (const crossing of crossings) {
        if (nodes.length >= NODE_CAP) break;
        const nodeName = `${road.name || label}口`;
        nodes.push({
          id: idFactory(),
          kind: 'both',
          name: nodeName.slice(0, 60),
          position: { x: Math.round(crossing.x * 10) / 10, y: Math.round(crossing.y * 10) / 10 },
          notes: 'AI 提案出入口：道路与场地边界交点',
        });
        crossingsTotal += 1;
      }
    }
    if (nodes.length >= NODE_CAP) break;
  }

  // 一条入口都没有（路网绕场不进界）：从最近的路引一条接驳线到离它最近的边界顶点。
  if (crossingsTotal === 0 && picked.length > 0) {
    let bestRoad: { road: RoadSegment; routeClass: RouteClass; point: PlanPoint; vertex: PlanPoint; dist: number } | null = null;
    for (const entry of picked) {
      for (const point of entry.enu) {
        for (const vertex of boundary) {
          const dist = Math.hypot(point.x - vertex.x, point.y - vertex.y);
          if (!bestRoad || dist < bestRoad.dist) bestRoad = { road: entry.road, routeClass: entry.routeClass, point, vertex, dist };
        }
      }
    }
    if (bestRoad && bestRoad.dist <= BBOX_MARGIN_M * 2) {
      const label = routeClassLabel(bestRoad.routeClass);
      routes.push({
        id: idFactory(),
        kind: bestRoad.routeClass,
        name: `${label}接驳线（${bestRoad.road.name || label}）`,
        points: [
          { x: Math.round(bestRoad.point.x * 10) / 10, y: Math.round(bestRoad.point.y * 10) / 10 },
          { x: Math.round(bestRoad.vertex.x * 10) / 10, y: Math.round(bestRoad.vertex.y * 10) / 10 },
        ],
        oneWay: false,
        widthM: routeWidth(bestRoad.routeClass),
        notes: 'AI 提案接驳线：路网不进界时连接最近道路与场地',
      });
      nodes.push({
        id: idFactory(),
        kind: 'both',
        name: `${bestRoad.road.name || label}口`,
        position: { x: Math.round(bestRoad.vertex.x * 10) / 10, y: Math.round(bestRoad.vertex.y * 10) / 10 },
        notes: 'AI 提案出入口：接驳线落点',
      });
    }
  }

  if (routes.length === 0) return null;
  return {
    routes,
    nodes,
    summary: {
      pedestrian: routes.filter(route => route.kind === 'pedestrian').length,
      vehicle: routes.filter(route => route.kind === 'vehicle').length,
      service: routes.filter(route => route.kind === 'service').length,
      entrances: nodes.length,
    },
  };
}
