/**
 * 动线 / 出入口节点 / 人员编辑纯函数层（H2-d）。
 *
 * 口径（评审稿 §8 功能矩阵「入口、出口、流线」「人员布点」/ §9.1 步骤 6–7）：
 * - 三类动线（人行/车辆/后勤）有方向与用途；**出入口节点是动线的唯一端点来源**：
 *   移动节点后引用路线的端点坐标随动（movePlanNode）；反转方向（reverseRoute）
 *   交换起终点引用、保留 oneWay 语义；删除节点时剥离引用但保留路线几何
 *   （deletePlanNode），绝不留下悬空 nodeId（契约 superRefine 也会拒绝悬空引用）。
 * - 人员布点是设施清单旁的轻量图层：岗位、人数、点位、所属区（zoneId）；
 *   不传 zoneId 时按落点所在分区自动归属（inferWorkerZoneId）；落点越界放行 + 提示
 *   （与分区/设施同一「放行 + 提示」策略）；按区 / 按岗汇总均为纯函数现算，
 *   隐藏人员层只影响绘制，不影响汇总与设施统计。
 * - 几何全部在局部米制 ENU（x 东、y 北）上运算，契约坐标范围 ±5000 m；
 *   本层不产生新公式，距离/包含判定复用 site-plan-editing 的基础几何。
 */

import {
  type PlanNode,
  type PlanPoint,
  type PlanRoute,
  type PlanVehicle,
  type PlanVehicleType,
  type PlanWorker,
  type SitePlanData,
  planVehicleTypes,
} from '../../../../supabase/functions/_shared/site-plan';
import {
  planPointDistanceM,
  planPointInRing,
  type PlanEditIssue,
  type PlanEditResult,
} from './site-plan-editing';
import { autoNodeName, isAutoNodeName } from './site-plan-node-names';

/** 契约平面点范围（±5000 m），与 site-plan planPointSchema 同源。 */
const PLAN_COORD_LIMIT_M = 5000;

/** 路线顶点上限：与契约 planRouteSchema.points.max 一致。 */
export const PLAN_ROUTE_MAX_VERTICES = 128;

/** 动线/节点/人员实体共用的编辑问题（code 语义见 PlanEditIssue）。 */
export type PlanRouteEditResult<T> = PlanEditResult<T>;

/* ---------------- 动线 ---------------- */

export interface BuildRouteInput {
  kind: PlanRoute['kind'];
  name: string;
  points: readonly PlanPoint[];
  oneWay?: boolean;
  /** 载体（可选）：缺省步行，写入时补齐 'walk'（2026-11-16）。 */
  carrier?: PlanRoute['carrier'];
  widthM?: number;
  startNodeId?: string;
  endNodeId?: string;
  notes?: string;
  id?: string;
}

function pointInRange(pt: PlanPoint): boolean {
  return Number.isFinite(pt.x) && Number.isFinite(pt.y)
    && Math.abs(pt.x) <= PLAN_COORD_LIMIT_M && Math.abs(pt.y) <= PLAN_COORD_LIMIT_M;
}

function routeGeometryIssues(points: readonly PlanPoint[]): PlanEditIssue[] {
  const issues: PlanEditIssue[] = [];
  if (points.length < 2) {
    issues.push({ code: 'too-few-vertices', message: '动线至少要 2 个点（起点和终点）。' });
    return issues;
  }
  if (points.length > PLAN_ROUTE_MAX_VERTICES) {
    issues.push({ code: 'too-many-vertices', message: `动线顶点超过上限 ${PLAN_ROUTE_MAX_VERTICES} 个。` });
  }
  for (let i = 1; i < points.length; i++) {
    if (planPointDistanceM(points[i - 1]!, points[i]!) === 0) {
      issues.push({ code: 'duplicate-vertex', message: `动线第 ${i}、${i + 1} 点重合，先移动开再提交。`, at: points[i] });
      break;
    }
  }
  for (const pt of points) {
    if (!pointInRange(pt)) {
      issues.push({ code: 'out-of-range', message: '动线顶点超出场地坐标系 ±5000 m 范围。', at: pt });
      break;
    }
  }
  return issues;
}

function nodeReferenceIssues(input: Pick<BuildRouteInput, 'startNodeId' | 'endNodeId'>, nodes: readonly PlanNode[]): PlanEditIssue[] {
  const issues: PlanEditIssue[] = [];
  const nodeIds = new Set(nodes.map(n => n.id.toLowerCase()));
  if (input.startNodeId && !nodeIds.has(input.startNodeId.toLowerCase())) {
    issues.push({ code: 'unknown-node', message: '起点引用的出入口节点不存在。' });
  }
  if (input.endNodeId && !nodeIds.has(input.endNodeId.toLowerCase())) {
    issues.push({ code: 'unknown-node', message: '终点引用的出入口节点不存在。' });
  }
  return issues;
}

/**
 * 建立一条动线：几何（≥2 点、无相邻重合、范围内）与端点引用（节点存在）都合法才提交。
 * 调用方负责先把端点吸附到节点（吸附逻辑在画布交互层）。
 */
export function buildRoute(input: BuildRouteInput, nodes: readonly PlanNode[] = []): PlanRouteEditResult<PlanRoute> {
  const issues = [...routeGeometryIssues(input.points), ...nodeReferenceIssues(input, nodes)];
  if (issues.length > 0) return { ok: false, issue: issues[0]! };
  const route: PlanRoute = {
    id: input.id ?? crypto.randomUUID(),
    kind: input.kind,
    name: input.name,
    points: input.points.map(p => ({ x: p.x, y: p.y })),
    oneWay: input.oneWay ?? false,
    // 新写入一律带上载体，不再让「没这个字段」在库里漂着；旧数据读出时由 routeCarrier 兜底。
    carrier: input.carrier ?? 'walk',
    ...(input.widthM !== undefined ? { widthM: input.widthM } : {}),
    ...(input.startNodeId !== undefined ? { startNodeId: input.startNodeId } : {}),
    ...(input.endNodeId !== undefined ? { endNodeId: input.endNodeId } : {}),
    notes: input.notes ?? '',
  };
  return { ok: true, value: route };
}

/** 反转动线方向：点列倒序 + 起终点引用互换；oneWay 语义保留（方向由点列表达）。 */
export function reverseRoute(route: PlanRoute): PlanRoute {
  return {
    ...route,
    points: [...route.points].reverse(),
    startNodeId: route.endNodeId,
    endNodeId: route.startNodeId,
  };
}

/* ---------------- 动线折点编辑（加点 / 减点 / 挪点 / 并点） ---------------- */

/** 动线最少顶点数：与契约 planRouteSchema.points.min 一致（起点 + 终点）。 */
export const PLAN_ROUTE_MIN_VERTICES = 2;

/** 单条动线折点几何是否可提交：非法时返回第一条问题（空值表示合法）。 */
export function routeVertexEditIssue(points: readonly PlanPoint[]): PlanEditIssue | null {
  return routeGeometryIssues(points)[0] ?? null;
}

/**
 * 2026-11-15 用户指令「路线和分区一样，在线上可以加点、减点、挪动合并点」：
 * 三条纯函数把动线折点编辑的口径固定下来，画布交互只负责命中与提交。
 *
 * 共同约束（契约同源）：≥2 个点、无相邻重合、坐标不越 ±5000 m、不超过 128 点。
 * 端点语义：动线起终点可能引用出入口节点（startNodeId / endNodeId），
 * 删掉被引用的端点时必须**同步解除引用**——否则会留下「引用节点但几何已不在节点上」
 * 的悬空引用（契约 superRefine 会拒，面板也会误报未连接）。
 */

/** 在第 edgeIndex 条边（v[edgeIndex] → v[edgeIndex+1]）上插入一个折点。 */
export function insertRouteVertex(
  route: PlanRoute,
  edgeIndex: number,
  point: PlanPoint,
): PlanRouteEditResult<PlanRoute> {
  if (!Number.isInteger(edgeIndex) || edgeIndex < 0 || edgeIndex >= route.points.length - 1) {
    return { ok: false, issue: { code: 'bad-index', message: `动线边序号越界（${edgeIndex}）。` } };
  }
  if (route.points.length >= PLAN_ROUTE_MAX_VERTICES) {
    return { ok: false, issue: { code: 'too-many-vertices', message: `动线顶点已达上限 ${PLAN_ROUTE_MAX_VERTICES} 个。` } };
  }
  const points = [
    ...route.points.slice(0, edgeIndex + 1),
    { x: point.x, y: point.y },
    ...route.points.slice(edgeIndex + 1),
  ];
  const issue = routeVertexEditIssue(points);
  if (issue) return { ok: false, issue };
  // 插点在边中间，首末两点不动 → 起终点引用仍然有效，不需要解绑。
  return { ok: true, value: { ...route, points } };
}

/** 删除第 index 个折点；删的是端点时同步解除对应的节点引用。 */
export function removeRouteVertex(route: PlanRoute, index: number): PlanRouteEditResult<PlanRoute> {
  if (!Number.isInteger(index) || index < 0 || index >= route.points.length) {
    return { ok: false, issue: { code: 'bad-index', message: `动线折点序号越界（${index}）。` } };
  }
  if (route.points.length <= PLAN_ROUTE_MIN_VERTICES) {
    return { ok: false, issue: { code: 'too-few-vertices', message: '动线至少保留 2 个点（起点和终点），不能再删。' } };
  }
  const points = route.points.filter((_, i) => i !== index);
  const issue = routeVertexEditIssue(points);
  if (issue) return { ok: false, issue };
  const next: PlanRoute = { ...route, points };
  if (index === 0) delete next.startNodeId;
  if (index === route.points.length - 1) delete next.endNodeId;
  return { ok: true, value: next };
}

/** 把第 index 个折点挪到 point（移动后仍需几何合法）。 */
export function moveRouteVertex(
  route: PlanRoute,
  index: number,
  point: PlanPoint,
): PlanRouteEditResult<PlanRoute> {
  if (!Number.isInteger(index) || index < 0 || index >= route.points.length) {
    return { ok: false, issue: { code: 'bad-index', message: `动线折点序号越界（${index}）。` } };
  }
  const points = route.points.map((p, i) => (i === index ? { x: point.x, y: point.y } : p));
  const issue = routeVertexEditIssue(points);
  if (issue) return { ok: false, issue };
  return { ok: true, value: { ...route, points } };
}

/* ---------------- 动线穿边 → 自动出入口 ---------------- */

/** 交点/去重容差（m）：与顶点最小间距、共享节点豁免半径同值。 */
export const PLAN_CROSSING_NODE_DEDUPE_M = 0.5;

/** 两线段交点（含端点/共线端点触碰）；不相交返回 null。 */
function segmentIntersection(a1: PlanPoint, a2: PlanPoint, b1: PlanPoint, b2: PlanPoint): PlanPoint | null {
  const d1x = a2.x - a1.x;
  const d1y = a2.y - a1.y;
  const d2x = b2.x - b1.x;
  const d2y = b2.y - b1.y;
  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < 1e-12) return null;
  const t = ((b1.x - a1.x) * d2y - (b1.y - a1.y) * d2x) / denom;
  const u = ((b1.x - a1.x) * d1y - (b1.y - a1.y) * d1x) / denom;
  if (t < -1e-8 || t > 1 + 1e-8 || u < -1e-8 || u > 1 + 1e-8) return null;
  return { x: a1.x + t * d1x, y: a1.y + t * d1y };
}

export interface RouteBoundaryCrossing {
  point: PlanPoint;
  /** 沿动线走向经过该交点：true = 从界外进场，false = 从界内离场。 */
  entering: boolean;
}

/**
 * 2026-11-15 用户：「如果是单向的流线，那么对应的进去的就是入口，出来的就是出口。
 * 如果是双向的流线，对应的就是出入口」。
 *
 * 所以交点不能只给位置，还要知道“这一下是进还是出”：沿动线走向在交点前后各采一个点，
 * 前在外、后在内 → 进场；前在内、后在外 → 离场。单向线据此判入口/出口，双向线一律出入口。
 */
export function routeBoundaryCrossingEntries(
  points: readonly PlanPoint[],
  boundary: readonly PlanPoint[],
): RouteBoundaryCrossing[] {
  if (points.length < 2 || boundary.length < 3) return [];
  // 累计弧长：用来按“沿线的距离”采样，比按段索引采样稳（顶点附近也不会采样到线外）。
  const arcs: number[] = [0];
  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1]!;
    const next = points[i]!;
    arcs.push(arcs[i - 1]! + Math.hypot(next.x - prev.x, next.y - prev.y));
  }
  const total = arcs[points.length - 1]!;
  const pointAtArc = (s: number): PlanPoint => {
    const clamped = Math.max(0, Math.min(total, s));
    let i = 1;
    while (i < points.length - 1 && arcs[i]! < clamped) i += 1;
    const a = points[i - 1]!;
    const b = points[i]!;
    const span = arcs[i]! - arcs[i - 1]!;
    const t = span <= 0 ? 0 : (clamped - arcs[i - 1]!) / span;
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  };

  const hits: { point: PlanPoint; arc: number }[] = [];
  for (let i = 1; i < points.length; i += 1) {
    const from = points[i - 1]!;
    const to = points[i]!;
    for (let j = 0; j < boundary.length; j += 1) {
      const hit = segmentIntersection(from, to, boundary[j]!, boundary[(j + 1) % boundary.length]!);
      if (!hit) continue;
      if (hits.some(item => Math.hypot(item.point.x - hit.x, item.point.y - hit.y) < PLAN_CROSSING_NODE_DEDUPE_M)) continue;
      // 沿动线的位置：段序号 + 段内插值（只用于排序，不需要是真实弧长）。
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const len2 = dx * dx + dy * dy;
      const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((hit.x - from.x) * dx + (hit.y - from.y) * dy) / len2));
      hits.push({ point: hit, arc: arcs[i - 1]! + t * (arcs[i]! - arcs[i - 1]!) });
    }
  }

  return hits
    .sort((a, b) => a.arc - b.arc)
    .map(({ point, arc }) => {
      // 采样步长 0.2 m，但不超过交点到两端的一半，避免越过线头把方向采反。
      const probe = Math.min(0.2, Math.max(0.05, arc / 2), Math.max(0.05, (total - arc) / 2));
      const insideBefore = planPointInRing(pointAtArc(arc - probe), boundary);
      const insideAfter = planPointInRing(pointAtArc(arc + probe), boundary);
      return { point, entering: !insideBefore && insideAfter };
    });
}

/**
 * 2026-11-15 用户：「从场地外的线到场地边界的时候，交界处会自动变成入口/出口/出入口」。
 * 这里先算出折线与边界环的所有交点（沿动线顺序、按 0.5 m 去重）。
 * 排序按动线走向算参数（段序号 + 段内位置），不依赖边界边的遍历顺序——
 * 否则“先出后进”的场次会把左、右两个交点的先后弄反。
 * 边界不足 3 点（没画完）时返回空——没有边界就没有「交界处」。
 */
export function routeBoundaryCrossings(
  points: readonly PlanPoint[],
  boundary: readonly PlanPoint[],
): PlanPoint[] {
  return routeBoundaryCrossingEntries(points, boundary).map(crossing => crossing.point);
}

/**
 * 自动交界出入口的 notes 前缀：用来认出「这是自动建的」，用户手放的节点不会被误删。
 *
 * 2026-11-15 用户反馈「微调后原先的出入口没消失，又多了几个」：只“看到交点就新建” 是错的，
 * 线一微调交点就漂，每次都剩下一只旧节点（还带红点）。改成“同一条动线自己那几只节点跟着交点走”。
 */
export const AUTO_CROSSING_NODE_NOTE = '动线与用地红线自动交点';

/**
 * 2026-11-16 改名前的旧前缀（“场地边界”）：只用来识别存量自动节点。
 * 库里已有的自动出入口是用旧字符串写的，识别不到就会被当成“用户手放的”永不被回收——
 * 所以新节点写新前缀，旧节点两个前缀都认。
 */
const LEGACY_AUTO_CROSSING_NODE_NOTE = '动线与场地边界自动交点';

/** 自动节点的归属标记：notes 里带上建它的动线 id。 */
function autoCrossingRouteTag(routeId: string): string {
  return `route:${routeId}`;
}

/** 这节点是不是「动线穿边自动生成」的交界出入口。 */
export function isAutoCrossingNode(node: PlanNode): boolean {
  return node.notes.startsWith(AUTO_CROSSING_NODE_NOTE) || node.notes.startsWith(LEGACY_AUTO_CROSSING_NODE_NOTE);
}

/**
 * 2026-11-15 用户：「如果是单向的流线，那么对应的进去的就是入口，出来的就是出口。
 * 如果是双向的流线，对应的就是出入口」。
 * 单向（oneWay=true）时 points 的先后就是行进方向：进场 → 入口，离场 → 出口；
 * 双向 / 未声明单向 → 出入口。
 */
export function crossingNodeKind(oneWay: boolean | undefined, entering: boolean): PlanNode['kind'] {
  if (!oneWay) return 'both';
  return entering ? 'entry' : 'exit';
}

/** 自动判型结果写在 notes 里，用来认出“用户是不是自己改过类型”。 */
function autoKindTag(kind: PlanNode['kind']): string {
  return `（kind:${kind}）`;
}

function taggedAutoKind(notes: string): PlanNode['kind'] | null {
  const match = /（kind:(entry|exit|both)）/.exec(notes);
  return match ? (match[1] as PlanNode['kind']) : null;
}

/**
 * 让自动节点跟上“这次该是入口/出口/出入口”：
 * - 用户手动改过类型（notes 里的自动值与当前 kind 不一致）→ 一律不碰，尊重用户；
 * - 名字仍是自动名 → 跟着重命名（出入口 1 → 入口 1，编号取目标类型最小空号）；
 * - 只改 kind / name / notes，位置由调用方处理。
 * 没有任何变化时返回 null（保持引用不变，方便幂等）。
 */
function retypeCrossingNode(
  node: PlanNode,
  desired: PlanNode['kind'],
  others: readonly PlanNode[],
): PlanNode | null {
  const tagged = taggedAutoKind(node.notes);
  if (tagged && node.kind !== tagged) return null;
  const name = node.kind !== desired && isAutoNodeName(node.name)
    ? autoNodeName(desired, others.filter(other => other.id !== node.id))
    : node.name;
  const notes = tagged
    ? node.notes.replace(/（kind:(entry|exit|both)）/, autoKindTag(desired))
    : `${node.notes}${autoKindTag(desired)}`;
  if (node.kind === desired && node.name === name && node.notes === notes) return null;
  return { ...node, kind: desired, name, notes };
}

/**
 * 2026-11-15：删掉一条动线时，把它自己建的交界节点一起收走（否则剩一堆「未连接」红点）。
 * 保留：别的动线引用的、用户改过名字的。
 */
export function removeAutoCrossingNodesOfRoute(
  routeId: string,
  plan: {
    nodes: readonly PlanNode[];
    routes: readonly Pick<PlanRoute, 'id' | 'startNodeId' | 'endNodeId'>[];
  },
): PlanNode[] {
  const tag = autoCrossingRouteTag(routeId);
  const referenced = new Set<string>();
  for (const route of plan.routes) {
    if (route.id === routeId) continue;
    if (route.startNodeId) referenced.add(route.startNodeId);
    if (route.endNodeId) referenced.add(route.endNodeId);
  }
  return plan.nodes.filter(node => {
    if (!isAutoCrossingNode(node) || !node.notes.includes(tag)) return true;
    if (referenced.has(node.id)) return true;
    return !isAutoNodeName(node.name);
  });
}

/** 自动节点跟交点走的最大距离（m）：再远就不认领（避免把别的动线的节点抢过来）。 */
export const PLAN_CROSSING_NODE_REUSE_M = 5;

/** 点到折线的最短距离（m）。 */
function distancePointToPolylineM(pt: PlanPoint, points: readonly PlanPoint[]): number {
  let best = Infinity;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / len2));
    const d = Math.hypot(pt.x - (a.x + dx * t), pt.y - (a.y + dy * t));
    if (d < best) best = d;
  }
  return best;
}

export interface CrossingNodeReconcile {
  /** 处理后的节点列表（可能含新增/位置更新/删除）。 */
  nodes: PlanNode[];
  added: PlanNode[];
  /** 跟着交点挪了位置的自动节点（同一只，不是新建）。 */
  moved: PlanNode[];
  /** 类型跟着单向/双向重新判过的自动节点（入口 ↔ 出口 ↔ 出入口）。 */
  retyped: PlanNode[];
  removed: PlanNode[];
}

/**
 * 把一条动线的交界出入口重新对齐到它当前的边界交点上（2026-11-15 用户反馈后的正解）：
 * - 交点数量不变、只是位置微调 → **拖那只旧节点过去**，不新建（这才是“少一只不多一只”）；
 * - 交点变多 → 补新建（按动线方向判入口/出口，双向为出入口）；
 * - 单向/双向或走向变了 → 同一只节点重新判型（用户手动改过类型的除外）；
 * - 交点变少/线缩进场内 → 本动线自己的自动节点删掉（前提：没被任何动线引用、名字仍是自动名），
 *   用户在交点上手放的节点、改过名字的节点、被引用的节点一律不动；
 * - 交点 0.5 m 内已有节点（含用户手放、其他动线的）→ 不再叠一只。
 *
 * 归属：优先看 notes 里的 `route:<id>`（新版）；旧版自动节点没有标记，就按“贴着这条动线 5 m 内”认领。
 */
export function reconcileCrossingNodes(
  route: Pick<PlanRoute, 'points'> & { id?: string; oneWay?: boolean },
  plan: {
    boundary: readonly PlanPoint[];
    nodes: readonly PlanNode[];
    routes: readonly Pick<PlanRoute, 'id' | 'startNodeId' | 'endNodeId'>[];
  },
): CrossingNodeReconcile {
  const crossings = routeBoundaryCrossingEntries(route.points, plan.boundary);
  const referenced = new Set<string>();
  for (const other of plan.routes) {
    if (other.startNodeId) referenced.add(other.startNodeId);
    if (other.endNodeId) referenced.add(other.endNodeId);
  }
  const tag = route.id ? autoCrossingRouteTag(route.id) : null;
  const owned = (node: PlanNode): boolean => {
    if (!isAutoCrossingNode(node)) return false;
    if (tag && node.notes.includes(tag)) return true;
    return distancePointToPolylineM(node.position, route.points) <= PLAN_CROSSING_NODE_REUSE_M;
  };
  const ownedIds = new Set(
    plan.nodes.filter(node => owned(node) && !referenced.has(node.id)).map(node => node.id),
  );

  const working = [...plan.nodes];
  const usedIds = new Set<string>();
  const added: PlanNode[] = [];
  const moved: PlanNode[] = [];
  const retyped: PlanNode[] = [];

  for (const crossing of crossings) {
    // 2026-11-15 用户：「单向的流线，进去的就是入口，出来的就是出口；双向的就是出入口」。
    const desiredKind = crossingNodeKind(route.oneWay, crossing.entering);
    const target = { x: Math.round(crossing.point.x * 10) / 10, y: Math.round(crossing.point.y * 10) / 10 };
    // 交点位置上已经有节点：如果正好是本动线自己的自动节点 → 认作已对齐（标记 used，别当多余删掉），
    // 但要先把类型对齐（单向↔双向、进↔出改了就得跟着变）；是用户手放的 / 别的动线的 → 不动。
    const atTarget = working.filter(
      node => Math.hypot(node.position.x - target.x, node.position.y - target.y) < PLAN_CROSSING_NODE_DEDUPE_M,
    );
    const ownIndex = working.findIndex(node => atTarget.includes(node) && ownedIds.has(node.id));
    if (ownIndex >= 0) {
      const node = working[ownIndex]!;
      usedIds.add(node.id);
      const next = retypeCrossingNode(node, desiredKind, working) ?? node;
      if (next !== node) {
        working[ownIndex] = next;
        retyped.push(next);
      }
      continue;
    }
    if (atTarget.length > 0) continue;

    // 先找本动线自己的自动节点（最近的）拉过来。
    let candidateIndex = -1;
    let candidateDist = Infinity;
    working.forEach((node, index) => {
      if (!ownedIds.has(node.id) || usedIds.has(node.id)) return;
      const d = Math.hypot(node.position.x - target.x, node.position.y - target.y);
      if (d < candidateDist) {
        candidateDist = d;
        candidateIndex = index;
      }
    });
    if (candidateIndex >= 0 && candidateDist <= PLAN_CROSSING_NODE_REUSE_M) {
      const node = working[candidateIndex]!;
      usedIds.add(node.id);
      const positioned: PlanNode = candidateDist > 0.05 ? { ...node, position: target } : node;
      const next = retypeCrossingNode(positioned, desiredKind, working) ?? positioned;
      if (next !== node) {
        working[candidateIndex] = next;
        if (positioned !== node) moved.push(next);
        if (next.kind !== node.kind) retyped.push(next);
      }
      continue;
    }

    // 没有可复用的 → 新建一只，类型按这次的方向判。
    const node: PlanNode = {
      id: crypto.randomUUID(),
      kind: desiredKind,
      name: autoNodeName(desiredKind, working),
      position: target,
      notes: `${AUTO_CROSSING_NODE_NOTE}：按动线方向自动判进/出（单向：进场入口、离场出口；双向：出入口），可手动改类型${tag ? `（${tag}）` : ''}${autoKindTag(desiredKind)}`,
    };
    working.push(node);
    ownedIds.add(node.id);
    usedIds.add(node.id);
    added.push(node);
  }

  // 本动线剩下没对上任何交点的自动节点 → 删（用户改过名字的保留）。
  const removed: PlanNode[] = [];
  const nodes = working.filter(node => {
    if (!ownedIds.has(node.id) || usedIds.has(node.id)) return true;
    if (!isAutoNodeName(node.name)) return true;
    removed.push(node);
    return false;
  });

  return { nodes, added, moved, retyped, removed };
}

/* ---------------- 出入口节点 ---------------- */

/**
 * 按落点推断归属分区（第一个包含落点的分区；都不含返回 undefined）。
 * 2026-11-16 用户「物料这些物体要有归属意识」：设施/人员/出入口共用这一口径，
 * 放置/拖动后都落到同一个函数上，免得三套各算各的。
 */
export function inferZoneIdAt(pt: PlanPoint, zones: readonly { id: string; polygon: readonly PlanPoint[] }[]): string | undefined {
  return zones.find(zone => zone.polygon.length >= 3 && planPointInRing(pt, zone.polygon))?.id;
}

/** 按落点自动推断节点归属分区。口径与 inferWorkerZoneId / 设施归属一致。 */
export function inferNodeZoneId(pt: PlanPoint, zones: readonly { id: string; polygon: readonly PlanPoint[] }[]): string | undefined {
  return inferZoneIdAt(pt, zones);
}

export interface BuildNodeInput {
  kind: PlanNode['kind'];
  name?: string;
  position: PlanPoint;
  /** 不传时按落点自动归属分区（inferNodeZoneId）。 */
  zoneId?: string | undefined;
  levelId?: string | undefined;
  notes?: string;
  id?: string;
}

/**
 * 落一个出入口节点：类型/落点合法才提交；落点在边界外放行但随结果返回提示；
 * 自动归属按落点所在分区（显式 zoneId 优先且必须存在）。与 buildWorker 同一「放行 + 提示」策略。
 */
export function buildNode(
  input: BuildNodeInput,
  boundary: readonly PlanPoint[],
  zones: readonly { id: string; name: string; polygon: readonly PlanPoint[] }[] = [],
): PlanRouteEditResult<PlanNode> {
  if (!pointInRange(input.position)) {
    return { ok: false, issue: { code: 'out-of-range', message: '出入口节点超出场地坐标系 ±5000 m 范围。', at: input.position } };
  }
  const zoneId = input.zoneId ?? inferNodeZoneId(input.position, zones);
  if (zoneId && !zones.some(zone => zone.id === zoneId)) {
    return { ok: false, issue: { code: 'unknown-zone', message: '归属分区不存在。' } };
  }
  const issues: PlanEditIssue[] = [];
  if (boundary.length >= 3 && !planPointInRing(input.position, boundary)) {
    issues.push({ code: 'out-of-boundary', message: '出入口节点落在用地红线之外。', at: input.position });
  }
  const fallbackName = input.kind === 'exit' ? '出口' : input.kind === 'both' ? '出入口' : '入口';
  const name = (input.name ?? fallbackName).trim();
  if (name.length === 0) return { ok: false, issue: { code: 'unknown-zone', message: '节点名不能为空。' } };
  if (name.length > 60) return { ok: false, issue: { code: 'unknown-zone', message: '节点名过长（≤60 字）。' } };
  const node: PlanNode = {
    id: input.id ?? crypto.randomUUID(),
    kind: input.kind,
    name,
    position: { x: input.position.x, y: input.position.y },
    ...(zoneId !== undefined ? { zoneId } : {}),
    ...(input.levelId !== undefined ? { levelId: input.levelId } : {}),
    notes: input.notes ?? '',
  };
  return issues.length > 0 ? { ok: true, value: node, issues } : { ok: true, value: node };
}

export interface MoveNodeResult {
  node: PlanNode;
  /** 引用该节点的路线（端点坐标已随动到节点新位置）。 */
  routes: PlanRoute[];
}

/**
 * 移动出入口节点：引用它的路线端点坐标随动（评审稿「移动入口后引用路线随动」）。
 * 随动后若某条路线出现相邻重合（例如 2 点路线两端都引用同一节点）则拒绝并提示。
 */
export function movePlanNode(node: PlanNode, next: PlanPoint, routes: readonly PlanRoute[]): PlanRouteEditResult<MoveNodeResult> {
  if (!pointInRange(next)) {
    return { ok: false, issue: { code: 'out-of-range', message: '出入口节点超出场地坐标系 ±5000 m 范围。', at: next } };
  }
  const movedNode: PlanNode = { ...node, position: { x: next.x, y: next.y } };
  const movedRoutes = routes.map(route => {
    if (route.startNodeId !== node.id && route.endNodeId !== node.id) return route;
    const points = route.points.map((p, i) => {
      if (i === 0 && route.startNodeId === node.id) return { x: next.x, y: next.y };
      if (i === route.points.length - 1 && route.endNodeId === node.id) return { x: next.x, y: next.y };
      return p;
    });
    return { ...route, points };
  });
  for (const route of movedRoutes) {
    for (let i = 1; i < route.points.length; i++) {
      if (planPointDistanceM(route.points[i - 1]!, route.points[i]!) === 0) {
        return {
          ok: false,
          issue: { code: 'duplicate-vertex', message: `节点移动会让动线「${route.name}」两端重合，换个位置。`, at: next },
        };
      }
    }
  }
  return { ok: true, value: { node: movedNode, routes: movedRoutes } };
}

/**
 * 删除出入口节点对路线的影响：引用它的路线剥离 nodeId 引用（几何保留）。
 * 返回更新后的路线列表；节点本身由调用方从 plan.nodes 过滤。
 */
export function detachNodeFromRoutes(nodeId: string, routes: readonly PlanRoute[]): PlanRoute[] {
  return routes.map(route => {
    if (route.startNodeId !== nodeId && route.endNodeId !== nodeId) return route;
    const next: PlanRoute = { ...route };
    if (next.startNodeId === nodeId) delete next.startNodeId;
    if (next.endNodeId === nodeId) delete next.endNodeId;
    return next;
  });
}

/** 节点关联的路线（评审稿「出入口显示关联路线」）：起点引用 / 终点引用分列。 */
export function nodeRouteRefs(nodeId: string, routes: readonly PlanRoute[]): { startRoutes: PlanRoute[]; endRoutes: PlanRoute[] } {
  return {
    startRoutes: routes.filter(r => r.startNodeId === nodeId),
    endRoutes: routes.filter(r => r.endNodeId === nodeId),
  };
}

/* ---------------- 人员 ---------------- */

/** 按落点自动推断人员归属分区（第一个包含落点的分区；都不含返回 undefined）。 */
export function inferWorkerZoneId(pt: PlanPoint, zones: readonly { id: string; polygon: readonly PlanPoint[] }[]): string | undefined {
  return inferZoneIdAt(pt, zones);
}

export interface BuildWorkerInput {
  role: string;
  count: number;
  position: PlanPoint;
  /** 不传时按落点自动归属分区（inferWorkerZoneId）。 */
  zoneId?: string | undefined;
  color?: string;
  notes?: string;
  id?: string;
  /** 绑定的漫游人物代号（可选）：固定到具体角色。 */
  assetId?: string | undefined;
}

/**
 * 布一个人员点位：岗位/人数/落点合法才提交；落点在边界外放行但随结果返回提示；
 * 自动归属按落点所在分区（显式 zoneId 优先且必须存在）。
 */
export function buildWorker(
  input: BuildWorkerInput,
  boundary: readonly PlanPoint[],
  zones: readonly { id: string; name: string; polygon: readonly PlanPoint[] }[] = [],
): PlanRouteEditResult<PlanWorker> {
  const role = input.role.trim();
  if (role.length === 0) return { ok: false, issue: { code: 'unknown-zone', message: '岗位名不能为空。' } };
  if (role.length > 60) return { ok: false, issue: { code: 'unknown-zone', message: '岗位名过长（≤60 字）。' } };
  if (!Number.isInteger(input.count) || input.count < 1 || input.count > 9999) {
    return { ok: false, issue: { code: 'out-of-range', message: '人数要 1–9999 的整数。' } };
  }
  if (!pointInRange(input.position)) {
    return { ok: false, issue: { code: 'out-of-range', message: '人员点位超出场地坐标系 ±5000 m 范围。', at: input.position } };
  }
  const zoneId = input.zoneId ?? inferWorkerZoneId(input.position, zones);
  if (zoneId && !zones.some(zone => zone.id === zoneId)) {
    return { ok: false, issue: { code: 'unknown-zone', message: '归属分区不存在。' } };
  }
  const issues: PlanEditIssue[] = [];
  if (boundary.length >= 3 && !planPointInRing(input.position, boundary)) {
    issues.push({ code: 'out-of-boundary', message: '人员点位落在用地红线之外。', at: input.position });
  }
  const worker: PlanWorker = {
    id: input.id ?? crypto.randomUUID(),
    role,
    count: input.count,
    position: { x: input.position.x, y: input.position.y },
    ...(zoneId !== undefined ? { zoneId } : {}),
    ...(input.color !== undefined ? { color: input.color } : {}),
    ...(input.assetId ? { assetId: input.assetId } : {}),
    notes: input.notes ?? '',
  };
  return issues.length > 0 ? { ok: true, value: worker, issues } : { ok: true, value: worker };
}

/* ---------------- 车辆 ---------------- */

/** 按落点自动推断车辆归属分区（与人员同口径：第一个包含落点的分区；都不含返回 undefined）。 */
export function inferVehicleZoneId(pt: PlanPoint, zones: readonly { id: string; polygon: readonly PlanPoint[] }[]): string | undefined {
  return inferZoneIdAt(pt, zones);
}

export interface BuildVehicleInput {
  /** 车型：必须已登记（契约 planVehicleTypes 枚举）。 */
  type: PlanVehicleType;
  /** 台数：1–99（契约上限；3D 每实体最多摆 MAX_VEHICLE_INSTANCES 台，超出部分只在清单里计数）。 */
  count: number;
  position: PlanPoint;
  /** 不传时按落点自动归属分区（inferVehicleZoneId）。 */
  zoneId?: string | undefined;
  /** 物料库模型 slug：缺省 = 库内没有该车型 GLB，界面标「待补模型」，不借近似车型。 */
  modelSlug?: string | undefined;
  /** 挂载的动线 id（最多 20 条，契约上限）。 */
  routeIds?: readonly string[] | undefined;
  color?: string;
  notes?: string;
  id?: string;
}

/**
 * 落一台车（2026-11-17 #118 补录入 UI）。
 *
 * 与 `buildWorker` 同策略：车型/台数/落点合法才提交；落点在边界外放行但随结果返回提示；
 * 自动归属按落点所在分区（显式 zoneId 优先且必须存在）。
 *
 * 两处口径与人员**故意不同**：
 * - `modelSlug` 缺省就是「没有模型」，不回落登记表首项（#118 §3.5：回落会把待补显示成有模型）；
 * - 台数上限按契约的 99（人员是 9999）——车是有泊位/队列属性的实体，不是人头。
 */
export function buildVehicle(
  input: BuildVehicleInput,
  boundary: readonly PlanPoint[],
  zones: readonly { id: string; name: string; polygon: readonly PlanPoint[] }[] = [],
): PlanRouteEditResult<PlanVehicle> {
  if (!planVehicleTypes.includes(input.type)) {
    return { ok: false, issue: { code: 'unknown-zone', message: '车型未登记。' } };
  }
  if (!Number.isInteger(input.count) || input.count < 1 || input.count > 99) {
    return { ok: false, issue: { code: 'out-of-range', message: '台数要 1–99 的整数。' } };
  }
  if (!pointInRange(input.position)) {
    return { ok: false, issue: { code: 'out-of-range', message: '车辆落点超出场地坐标系 ±5000 m 范围。', at: input.position } };
  }
  const zoneId = input.zoneId ?? inferVehicleZoneId(input.position, zones);
  if (zoneId && !zones.some(zone => zone.id === zoneId)) {
    return { ok: false, issue: { code: 'unknown-zone', message: '归属分区不存在。' } };
  }
  const issues: PlanEditIssue[] = [];
  if (boundary.length >= 3 && !planPointInRing(input.position, boundary)) {
    issues.push({ code: 'out-of-boundary', message: '车辆落在用地红线之外。', at: input.position });
  }
  const routeIds = (input.routeIds ?? []).slice(0, 20);
  const vehicle: PlanVehicle = {
    id: input.id ?? crypto.randomUUID(),
    type: input.type,
    count: input.count,
    position: { x: input.position.x, y: input.position.y },
    ...(zoneId !== undefined ? { zoneId } : {}),
    ...(input.modelSlug ? { modelSlug: input.modelSlug } : {}),
    ...(routeIds.length > 0 ? { routeIds: [...routeIds] } : {}),
    ...(input.color !== undefined ? { color: input.color } : {}),
    notes: input.notes ?? '',
  };
  return issues.length > 0 ? { ok: true, value: vehicle, issues } : { ok: true, value: vehicle };
}

/* ---------------- 派生统计（现算，不落盘） ---------------- */

export interface WorkerZoneSummaryRow {
  /** null = 未归属任何分区。 */
  zoneId: string | null;
  zoneName: string;
  /** 区内人数总和。 */
  total: number;
  /** 区内点位数。 */
  posts: number;
}

/** 按区汇总人员：分区原序在前、未归属在末行。zones 只需 id/name（演示页与测试的简化分区即可用）。 */
export function workerZoneSummary(
  plan: { zones: readonly { id: string; name: string }[]; workers: readonly PlanWorker[] },
): WorkerZoneSummaryRow[] {
  const rows: WorkerZoneSummaryRow[] = plan.zones.map(zone => ({ zoneId: zone.id, zoneName: zone.name, total: 0, posts: 0 }));
  const byId = new Map(rows.map(row => [row.zoneId!, row]));
  const orphan: WorkerZoneSummaryRow = { zoneId: null, zoneName: '未归属分区', total: 0, posts: 0 };
  for (const worker of plan.workers) {
    const row = worker.zoneId ? byId.get(worker.zoneId) : undefined;
    const target = row ?? orphan;
    target.total += worker.count;
    target.posts += 1;
  }
  return orphan.posts > 0 ? [...rows, orphan] : rows;
}

export interface WorkerRoleSummaryRow {
  role: string;
  total: number;
  posts: number;
}

/** 按岗位汇总人员（评审稿验收：「东门 2 安保、装卸口 1 引导岗可汇总」）：按岗位首次出现顺序稳定。 */
export function workerRoleSummary(plan: Pick<SitePlanData, 'workers'>): WorkerRoleSummaryRow[] {
  const rows = new Map<string, WorkerRoleSummaryRow>();
  for (const worker of plan.workers) {
    const row = rows.get(worker.role) ?? { role: worker.role, total: 0, posts: 0 };
    row.total += worker.count;
    row.posts += 1;
    rows.set(worker.role, row);
  }
  return [...rows.values()];
}

/* ---------------- 全案问题清单（画布红点 / 面板提示） ---------------- */

export interface PlanNodeIssue {
  nodeId: string;
  nodeName: string;
  issue: PlanEditIssue;
}

/** 出入口节点问题：未被任何动线引用（未连接节点）。 */

/**
 * 2026-11-15 用户：「明明出入口已经在动线上了，还是显示未在动线上」。
 *
 * 交界处自动建的出入口本来就压在动线**中段**，它不是起终点引用（startNodeId / endNodeId），
 * 但物理上确实连着这条线。只按引用判定就会把这种节点误报成「未连接」，画布上还挂红点。
 *
 * 所以「已连接」= 作为起终点被引用 **或** 节点落在某条动线折线上（≤ 0.5 m，与吸附/去重同一容差）。
 */
export const PLAN_NODE_ON_ROUTE_M = PLAN_CROSSING_NODE_DEDUPE_M;

/** 哪些动线穿过（压着）这个点；端点引用不算在这里，只看几何。 */
export function nodeOnRoutes(
  position: PlanPoint,
  routes: readonly PlanRoute[],
  toleranceM: number = PLAN_NODE_ON_ROUTE_M,
): PlanRoute[] {
  return routes.filter(
    route => route.points.length >= 2 && distancePointToPolylineM(position, route.points) <= toleranceM,
  );
}

export function planNodeIssues(plan: Pick<SitePlanData, 'nodes' | 'routes'>): PlanNodeIssue[] {
  const issues: PlanNodeIssue[] = [];
  for (const node of plan.nodes) {
    const refs = nodeRouteRefs(node.id, plan.routes);
    if (refs.startRoutes.length > 0 || refs.endRoutes.length > 0) continue;
    // 压在动线中段也是连着（见 PLAN_NODE_ON_ROUTE_M 注释）。
    if (nodeOnRoutes(node.position, plan.routes).length > 0) continue;
    issues.push({ nodeId: node.id, nodeName: node.name, issue: { code: 'unconnected-node', message: '未连接任何动线。', at: node.position } });
  }
  return issues;
}

export interface PlanWorkerIssue {
  workerId: string;
  workerRole: string;
  issue: PlanEditIssue;
}

/** 人员点位问题：落在场地边界外（放行 + 提示口径）。 */
export function planWorkerIssues(plan: Pick<SitePlanData, 'boundary' | 'workers'>): PlanWorkerIssue[] {
  if (plan.boundary.length < 3) return [];
  const issues: PlanWorkerIssue[] = [];
  for (const worker of plan.workers) {
    if (!planPointInRing(worker.position, plan.boundary)) {
      issues.push({ workerId: worker.id, workerRole: worker.role, issue: { code: 'out-of-boundary', message: '点位在用地红线之外。', at: worker.position } });
    }
  }
  return issues;
}
