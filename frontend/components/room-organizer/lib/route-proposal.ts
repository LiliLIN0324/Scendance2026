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
import { enuToLngLat } from './outdoor-plan-canvas';
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
export function matchRouteCommand(text: string, standalone = false): 'auto' | null {
  const trimmed = text.trim();
  if (trimmed.length < 3 || trimmed.length > 60) return null;
  if (/(?:删除|去掉|清空|移除)(?:全部)?流线/u.test(trimmed)) return null;
  const command = trimmed.match(/排(?:一下)?流线|画(?:出)?流线|生成流线|自动排流线|流线怎么排|排(?:一下)?线|自动排(?:一下)?(?:入口|出入口)/u);
  if (!command) return null;
  if (!standalone) return 'auto';
  const unwrapped = trimmed.replace(/^(?:请\s*)?(?:帮我\s*)?/u, '').replace(/[。！!？?\s]+$/u, '');
  const routeAndAccess = command[0].includes('流线')
    && command[0] === unwrapped.replace(/(?:和|与|及|以及)(?:出)?入口$/u, '');
  return command[0] === unwrapped || routeAndAccess ? 'auto' : null;
}

/** Liang–Barsky 线段裁剪：两端都在框外但穿过场地的稀疏 OSM 道路也要保留。 */
function clipRunsToBBox(points: PlanPoint[], bbox: { west: number; south: number; east: number; north: number }): PlanPoint[][] {
  const runs: PlanPoint[][] = [];
  let current: PlanPoint[] = [];
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1]!; const b = points[i]!;
    const dx = b.x - a.x; const dy = b.y - a.y;
    let lo = 0; let hi = 1; let valid = true;
    for (const [p, q] of [[-dx, a.x - bbox.west], [dx, bbox.east - a.x], [-dy, a.y - bbox.south], [dy, bbox.north - a.y]] as [number, number][]) {
      if (Math.abs(p) < 1e-9) { if (q < 0) valid = false; continue; }
      const t = q / p;
      if (p < 0) lo = Math.max(lo, t); else hi = Math.min(hi, t);
      if (lo > hi) valid = false;
    }
    if (!valid) { if (current.length > 1) runs.push(current); current = []; continue; }
    const start = { x: a.x + lo * dx, y: a.y + lo * dy };
    const end = { x: a.x + hi * dx, y: a.y + hi * dy };
    const tail = current[current.length - 1];
    if (tail && Math.hypot(tail.x - start.x, tail.y - start.y) > 0.01) { if (current.length > 1) runs.push(current); current = []; }
    if (!current.length) current.push(start);
    if (Math.hypot(start.x - end.x, start.y - end.y) > 0.01) current.push(end);
    if (hi < 1) { if (current.length > 1) runs.push(current); current = []; }
  }
  if (current.length > 1) runs.push(current);
  return runs;
}

/** 线段相交（参数法），返回交点；共线/端点搭接不算入口交点。 */
function segmentIntersection(a1: PlanPoint, a2: PlanPoint, b1: PlanPoint, b2: PlanPoint): PlanPoint | null {
  const d1x = a2.x - a1.x; const d1y = a2.y - a1.y;
  const d2x = b2.x - b1.x; const d2y = b2.y - b1.y;
  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < 1e-9) return null;
  const t = ((b1.x - a1.x) * d2y - (b1.y - a1.y) * d2x) / denom;
  const u = ((b1.x - a1.x) * d1y - (b1.y - a1.y) * d1x) / denom;
  if (t < -1e-8 || t > 1 + 1e-8 || u < -1e-8 || u > 1 + 1e-8) return null;
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
  if (out[out.length - 1] !== points[points.length - 1]) out.push(points[points.length - 1]!);
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

/**
 * 用户这一轮原话里的「路」意图（#3 改口生效，2026-11-18）。
 *
 * 根因：选路一直是纯几何的——同类里按「落在范围内的长度」排序，所以「主通道改走
 * 仁和路、别沿湖滨路走」这种明确改口，无论模型听懂没有，提案都会照旧挑湖滨路，
 * 入口候选也就永远只有那条路上的口。这里把原话接进选路口径。
 *
 * 三条硬规矩：
 *   1) **路名必须在路网里存在**才算数——不猜、不按方位硬选；
 *   2) **否定只覆盖否定词到本小句结束**（或到下一个「改走/换成」为止），
 *      所以「别沿湖滨路走，改走仁和路」不会把仁和路一起排除；
 *   3) 同一路既说要又要说不要 → 以「不要」为准（用户最后一句通常是否定）。
 */

/** 否定词：别/不要/不用/避开/绕开/不走… */
const NEGATION = /(?:别|不要|不用|勿|避开|绕开|不走|不沿|不经过|不靠|不再)/u;
/** 否定句里的转折点：到这里为止，后面的路名不再算被否定。 */
const SWITCH = /(?:改走|换成|改成|改用|换到|另走|再改|但改|或者改|而是)/u;
/** 肯定语气：这一句确实在谈走哪条路。 */
const AFFIRM = /(?:走|沿|用|经过|按|排|接|改)/u;
/** 「从 X 改到 Y」这种明确的两头：X 不要，Y 要。 */
const FROM_TO = /(?:从|由)([^，,。；;、]{1,12}?)(?:改到|改走|换到|换成|移到|走到|挪到|挪进|到)([^，,。；;、]{1,12})/u;
/** 句子里出现了「像路名的词」。 */
const ROAD_WORD = /(?:大道|路|街|巷|弄|胡同)/u;

export interface RoadIntent {
  /** 点名要走：同类里排在前面。 */
  prefer: ReadonlySet<string>;
  /** 明确不要：不选。 */
  avoid: ReadonlySet<string>;
  /** 原话点了路，但这一带路网里没有同名路。 */
  notFound: boolean;
}

/**
 * 从一句原话里读出「点名要走」与「明确不要」的路。
 *
 * 按小句（逗号/句号/分号）切分：每个小句单独判极性，否定小句里的路名进 avoid，
 * 否定之后的转折部分（「改走仁和路」）重新算肯定。
 */
export function roadIntentFromRequest(
  request: string | undefined,
  roadNames: readonly string[],
): RoadIntent {
  const prefer = new Set<string>();
  const avoid = new Set<string>();
  const usable = roadNames.filter((name) => name.length >= 2);
  if (!request || !usable.length) return { prefer, avoid, notFound: false };
  const mentioned = usable.filter((name) => request.includes(name));
  for (const clause of request.split(/[，,。；;、\n]/u)) {
    const text = clause.trim();
    if (!text) continue;
    // 「从 X 改到 Y」两头都点名了：X 明确不要，Y 明确要走。
    const fromTo = FROM_TO.exec(text);
    if (fromTo) {
      const from = fromTo[1] ?? '';
      const to = fromTo[2] ?? '';
      for (const name of mentioned) {
        if (from.includes(name)) avoid.add(name);
        else if (to.includes(name)) prefer.add(name);
      }
      continue;
    }
    const negated = NEGATION.exec(text);
    if (!negated) {
      if (AFFIRM.test(text)) for (const name of mentioned) if (text.includes(name)) prefer.add(name);
      continue;
    }
    const start = negated.index;
    const rest = text.slice(start + negated[0].length);
    const switched = SWITCH.exec(rest);
    const end = switched ? start + negated[0].length + switched.index : text.length;
    for (const name of mentioned) {
      if (text.slice(start, end).includes(name)) avoid.add(name);
      else if (AFFIRM.test(text.slice(end)) && text.slice(end).includes(name)) prefer.add(name);
    }
  }
  // 又要又不要 → 以「不要」为准。
  for (const name of avoid) prefer.delete(name);
  return {
    prefer,
    avoid,
    // 原话里像是在说某条路，但路网里一条同名路都没有 → 如实说「没找到」，不装作听懂了。
    notFound: ROAD_WORD.test(request) && mentioned.length === 0,
  };
}

/** 这一轮按原话改了选路口径时，写下改了什么（给卡片如实说明用）。 */
export interface RouteIntentReport {
  /** 点名要走、且真的选上的路。 */
  preferred: string[];
  /** 明确不要、且真的没选的路。 */
  excluded: string[];
  /** 想排除、但这一带路网里只有它，只好先留着（如实说明）。 */
  keptExcluded: string[];
  /** 原话点了路，但这一带路网里没有同名路。 */
  notFound: boolean;
}

/**
 * 卡片上那句「按你点名的路排的」（#3）。
 * 没按原话改过就返回 null——调用方那句老口径（「按道路等级挑」）才不算说谎。
 */
export function routeIntentNote(intent: RouteIntentReport | undefined): string | null {
  if (!intent) return null;
  const parts: string[] = [];
  if (intent.preferred.length) parts.push(`按你点名的「${intent.preferred.join('、')}」排的到场候选。`);
  if (intent.excluded.length) parts.push(`按你说的没有用「${intent.excluded.join('、')}」。`);
  if (intent.keptExcluded.length)
    parts.push(
      `「${intent.keptExcluded.join('、')}」你想排除，但这一带路网里只有它，先留着候选，核对时可以在画布上改。`,
    );
  if (intent.notFound)
    parts.push("你点名的路这一带路网里没找到，仍按道路等级挑了到场候选；也可以自己在画布上画一条。");
  return parts.length ? parts.join("") : null;
}

export interface RouteProposal {
  routes: PlanRoute[];
  nodes: PlanNode[];
  summary: { pedestrian: number; vehicle: number; service: number; entrances: number };
  /** 有按原话改选路口径时才在（没改就不给，免得卡片多话）。 */
  intent?: RouteIntentReport;
}

/** 2026-11-14 测试修正：路网请求以「边界的真实地理位置」为基准取 bbox——
 *  边界可以画在离锚点很远的地方（框选任意处），以锚点为圆心会整个错过边界，
 *  裁剪后全部道路被丢，回「路网暂时拿不到」。 */
export function roadFetchPlanForBoundary(
  boundary: PlanPoint[],
  anchor: { lng: number; lat: number },
): { center: { lng: number; lat: number }; spanM: number } {
  let west = Infinity; let south = Infinity; let east = -Infinity; let north = -Infinity;
  for (const point of boundary) {
    const geo = enuToLngLat(point.x, point.y, anchor.lng, anchor.lat);
    west = Math.min(west, geo.lng); east = Math.max(east, geo.lng);
    south = Math.min(south, geo.lat); north = Math.max(north, geo.lat);
  }
  const spanLat = (north - south) * 111132.92;
  const spanLng = (east - west) * metersPerDegreeLng((south + north) / 2);
  return {
    center: { lng: (west + east) / 2, lat: (south + north) / 2 },
    spanM: Math.round(Math.max(spanLat, spanLng) * 0.75 + 300),
  };
}

export interface BuildRouteProposalInput {
  boundary: PlanPoint[];
  anchor: { lng: number; lat: number };
  roads: RoadSegment[];
  /**
   * 用户这一轮的原话（可选）：用来把「点名要走」与「明确不要」的路挑出来。
   * 不给就退回旧口径（同类按长度），行为与以前一字不差。
   */
  request?: string;
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
    for (const run of clipRunsToBBox(enu, bbox)) for (let i = 1; i < run.length; i += 1) {
      lengthM += Math.hypot(run[i]!.x - run[i - 1]!.x, run[i]!.y - run[i - 1]!.y);
    }
    if (lengthM < 5) continue;
    byClass[routeClass].push({ road, enu, lengthM });
  }
  const picked: { road: RoadSegment; enu: PlanPoint[]; routeClass: RouteClass }[] = [];
  // 2026-11-18（#3）：先按用户原话定「点名要走 / 明确不要」，再按长度兜底。
  const intent = roadIntentFromRequest(
    input.request,
    [...new Set(roads.map((road) => road.name).filter(Boolean))],
  );
  const avoided = intent.avoid;
  for (const routeClass of ['vehicle', 'service', 'pedestrian'] as RouteClass[]) {
    // 类内按「落在范围内的折线总长」降序；点名的路排最前，明确不要的直接不选。
    byClass[routeClass].sort((a, b) => {
      const rank = (entry: { road: RoadSegment }) =>
        intent.prefer.has(entry.road.name) ? 0 : 1;
      const diff = rank(a) - rank(b);
      return diff !== 0 ? diff : b.lengthM - a.lengthM;
    });
    for (const entry of byClass[routeClass]) {
      if (avoided.has(entry.road.name)) continue;
      if (picked.filter((item) => item.routeClass === routeClass).length >= CLASS_CAP[routeClass]) break;
      picked.push({ road: entry.road, enu: entry.enu, routeClass });
    }
  }
  // 明确不要的路被全部排除后一条都不剩 → 这一带真的只有它：先留着候选，如实说明，
  // 不静默把用户排除掉的路塞回去，也不让整轮直接空掉。
  const keptExcluded: string[] = [];
  if (picked.length === 0 && intent.avoid.size > 0) {
    for (const routeClass of ['vehicle', 'service', 'pedestrian'] as RouteClass[]) {
      byClass[routeClass].sort((a, b) => b.lengthM - a.lengthM);
      for (const entry of byClass[routeClass].slice(0, CLASS_CAP[routeClass])) {
        picked.push({ road: entry.road, enu: entry.enu, routeClass });
        if (!keptExcluded.includes(entry.road.name)) keptExcluded.push(entry.road.name);
      }
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
        // 路网来自真实道路：车行/后勤都是车能走的路面，显式写 vehicle，
        // 不让 OSM 车行道吃「默认步行」的布点密度。
        carrier: routeClass === 'pedestrian' ? 'walk' : 'vehicle',
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
        if (nodes.some(node => Math.hypot(node.position.x - crossing.x, node.position.y - crossing.y) < NODE_DEDUPE_M)) continue;
        const nodeName = `${road.name || label}口`;
        nodes.push({
          id: idFactory(),
          kind: 'both',
          name: nodeName.slice(0, 60),
          position: { x: Math.round(crossing.x * 10) / 10, y: Math.round(crossing.y * 10) / 10 },
          notes: 'AI 提案出入口：道路与用地红线交点',
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
        carrier: bestRoad.routeClass === 'pedestrian' ? 'walk' : 'vehicle',
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
  const pickedNames = new Set(picked.map((entry) => entry.road.name));
  const preferred = [...intent.prefer].filter((name) => pickedNames.has(name));
  const report: RouteIntentReport = {
    preferred,
    excluded: [...intent.avoid].filter((name) => !pickedNames.has(name)),
    keptExcluded,
    // 点名的路一条都没选上（多在界外、界内太短、或被同类上限挤掉）也按「没找到」如实说，
    // 不能让用户以为改口被采纳了。
    notFound: intent.notFound || (intent.prefer.size > 0 && preferred.length === 0),
  };
  const hasIntent =
    report.preferred.length > 0 ||
    report.excluded.length > 0 ||
    report.keptExcluded.length > 0 ||
    report.notFound;
  return {
    routes,
    nodes,
    summary: {
      pedestrian: routes.filter(route => route.kind === 'pedestrian').length,
      vehicle: routes.filter(route => route.kind === 'vehicle').length,
      service: routes.filter(route => route.kind === 'service').length,
      entrances: nodes.length,
    },
    ...(hasIntent ? { intent: report } : {}),
  };
}
