/**
 * V-4a（2026-11-13）：子出入口提案（纯函数，预览不落盘）。
 *
 * 用户草图（图4）口径：每个分区 1–2 个子出入口，用区内驳线接到主流线上——
 * 主流线走场地边路，人流从区边的子口进出。输入当前 plan（分区+流线+既有节点），
 * 产出 { routes, nodes } 草案（与 RouteProposal 同形，复用流线确认卡与 applyRoutes 通道）：
 * - 每分区取「分区边界上离最近流线点最近的点」立子节点（kind 'both'）；
 * - 驳线 = 子节点 → 流线最近点（两点直线，类别随被接流线）；
 * - 流线离分区太远（>120m）的分区跳过；与既有节点 15m 内重复的不再立。
 *
 * 2026-11-17（死结 4，正式站走查实测）：「与既有节点 15m 内重复就不再立」这条规则
 * 曾把**整个分区**放弃掉——两个分区贴在一起时，邻区的子口落在共边中点附近
 * （实测「签到台」距「观众区口」仅 4m），本区的可用样本全被去重挡掉 → 该区永远拿不到驳线；
 * 岗位阶段随后报「尚无同时满足入场与出场的后勤接驳，请先安排子流线/子入口」，
 * 而这条补救路径**实际不成立**（重跑子动线仍是同样的跳过）。
 * 新口径：既有口就在旁边时，本区**接驳到那个口**（短线接驳，不重复立口），而不是整区放弃。
 */

import type { PlanNode, PlanPoint, PlanRoute, PlanZone, SitePlanData } from '../../../../supabase/functions/_shared/site-plan';

import { outdoorCorridorStrips, outdoorRingsOverlap } from './outdoor-event-logic';
import { facilityFootprintRing, facilityPlacementIssues } from './site-plan-facilities';
import { planPointInRing } from './site-plan-editing';

/** 流线离分区太远（米）就跳过该分区。 */
const MAX_SPUR_M = 120;
/** 与既有节点太近（米）就不重复立子口。 */
const NODE_DEDUPE_M = 15;
/** 子出入口总数上限。 */
const NODE_CAP = 12;

/** 点到线段最近点（参数截断到段内）。 */
function nearestPointOnSegment(point: PlanPoint, a: PlanPoint, b: PlanPoint): PlanPoint {
  const dx = b.x - a.x; const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy || 1e-9;
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / len2));
  return { x: a.x + t * dx, y: a.y + t * dy };
}

/** 折线上离 point 最近的点。 */
function nearestPointOnPolyline(point: PlanPoint, polyline: PlanPoint[]): { point: PlanPoint; dist: number } {
  let best: { point: PlanPoint; dist: number } | null = null;
  for (let i = 0; i < polyline.length - 1; i += 1) {
    const candidate = nearestPointOnSegment(point, polyline[i]!, polyline[i + 1]!);
    const dist = Math.hypot(candidate.x - point.x, candidate.y - point.y);
    if (!best || dist < best.dist) best = { point: candidate, dist };
  }
  return best ?? { point: polyline[0]!, dist: Math.hypot(polyline[0]!.x - point.x, polyline[0]!.y - point.y) };
}

/** 「补子出入口」类说法 → 生成指令；删除不劫持。 */
export function matchSubEntranceCommand(text: string): 'auto' | null {
  const trimmed = text.trim();
  if (trimmed.length < 3 || trimmed.length > 60) return null;
  if (/(?:删除|删了|删掉|清空|移除|去掉)/u.test(trimmed) && /(?:子)?(?:出入口|入口|驳线)/u.test(trimmed)) return null;
  if (/子(?:出入口|入口)|补(?:一下)?(?:子口|出入口|入口)|加(?:一下)?(?:子口|子出入口|驳线)|驳线/u.test(trimmed)) return 'auto';
  return null;
}

export interface SubEntranceProposal {
  routes: PlanRoute[];
  nodes: PlanNode[];
  summary: { spurs: number; zones: number; skippedFar: number };
}

/** 本次提案要读的 plan 字段。 */
export type SpurPlanInput = Pick<SitePlanData, 'zones' | 'routes' | 'nodes'> &
  Partial<Pick<SitePlanData, 'boundary' | 'facilities'>>;

/** 分区用途 → 这条驳线服务谁（与岗位 audience 口径一致：后勤人员有自己的线）。 */
export function spurAudiencesFor(
  zone: PlanZone,
  extra?: NonNullable<PlanRoute['audiences']>[number],
): NonNullable<PlanRoute['audiences']> {
  const base: NonNullable<PlanRoute['audiences']> =
    zone.purpose === 'performance'
      ? ['performers', 'staff', 'security']
      : zone.purpose === 'service'
        ? ['service', 'staff', 'security']
        : ['visitors', 'staff', 'security'];
  return extra && !base.includes(extra) ? [...base, extra] : base;
}

/** 一条候选驳线：分区边界上的落点 → 接驳目标。 */
type Spur = {
  nodePos: PlanPoint;
  routePoint: PlanPoint;
  dist: number;
  route: PlanRoute;
  /** 复用既有口（邻区子口/已确认出入口）时带上它；否则新立子口。 */
  portal?: PlanNode;
};

/** 节点是否落在某条人行流线上（否则「接驳到它」也走不了）。 */
function pedestrianRouteThrough(node: PlanNode, routes: readonly PlanRoute[]): PlanRoute | null {
  for (const route of routes) {
    if (route.kind !== 'pedestrian') continue;
    for (let i = 0; i < route.points.length; i += 1) {
      const a = route.points[i]!;
      const b = route.points[i + 1] ?? a;
      const hit = nearestPointOnSegment(node.position, a, b);
      if (Math.hypot(hit.x - node.position.x, hit.y - node.position.y) <= 1) return route;
    }
  }
  return null;
}

/** 驳线几何护栏：出红线 / 压物件 / 穿表演或展览分区 / 压车行或后勤路——都不放行。 */
function spurAllowed(plan: SpurPlanInput, zone: PlanZone, points: PlanPoint[]): boolean {
  const strips = outdoorCorridorStrips(points, 2);
  if (plan.boundary && strips.some((strip) => facilityPlacementIssues(strip, plan.boundary!).length))
    return false;
  if (
    (plan.facilities ?? []).some((f) =>
      strips.some((strip) => outdoorRingsOverlap(strip, facilityFootprintRing(f))),
    )
  )
    return false;
  if (
    plan.zones.some(
      (other) =>
        other.id !== zone.id &&
        ['performance', 'exhibition'].includes(other.purpose ?? '') &&
        strips.some((strip) => outdoorRingsOverlap(strip, other.polygon)),
    )
  )
    return false;
  if (
    plan.routes.some(
      (r) =>
        r.kind !== 'pedestrian' &&
        outdoorCorridorStrips(r.points, (r.widthM ?? 4) + 2).some((road) =>
          strips.some((strip) => outdoorRingsOverlap(strip, road)),
        ),
    )
  )
    return false;
  return true;
}

/** 节点是否贴在分区环上（1m 内）。 */
function onRing(node: PlanNode, polygon: readonly PlanPoint[]): boolean {
  return polygon.some((a, i) => {
    const hit = nearestPointOnSegment(node.position, a, polygon[(i + 1) % polygon.length]!);
    return Math.hypot(hit.x - node.position.x, hit.y - node.position.y) <= 1;
  });
}

/** 分区边界采样：边中点先、顶点后——几何平局时中点胜出（子口落在边中央=居中门位）。 */
function zoneEdgeSamples(polygon: readonly PlanPoint[]): PlanPoint[] {
  const samples: PlanPoint[] = [];
  for (let i = 0; i < polygon.length; i += 1) {
    const next = polygon[(i + 1) % polygon.length]!;
    samples.push({ x: (polygon[i]!.x + next.x) / 2, y: (polygon[i]!.y + next.y) / 2 }, polygon[i]!);
  }
  return samples;
}

const round1 = (v: number) => Math.round(v * 10) / 10;

/**
 * 给一个分区找一条驳线。找不到返回 null。
 * - `pendingNodes`：本次提案里已经立好的子口（跨分区去重要看它们）。
 * - `audiences`：覆盖这条驳线服务的人群（默认按分区用途）。
 */
export function buildZoneSpur(
  plan: SpurPlanInput,
  zone: PlanZone,
  idFactory: () => string = () =>
    (typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `s-${Math.random().toString(36).slice(2)}`),
  opts: {
    audiences?: NonNullable<PlanRoute['audiences']>;
    pendingNodes?: readonly PlanNode[];
    /**
     * 只允许复用既有口（不新立子口）。
     * 岗位阶段用它：那里只能把岗位挂到**已经确认过的**出入口上——
     * 自己发明一个新门会让「单向流线只出不能入」这类区看起来也连通（既有守卫会被绕开）。
     */
    requireExistingPortal?: boolean;
  } = {},
): { route: PlanRoute; node: PlanNode | null } | null {
  const pendingNodes = opts.pendingNodes ?? [];
  const samples = zoneEdgeSamples(zone.polygon);
  // 区内已有确认节点就复用该节点；旧口径只认「贴在环边 1m 内」的节点，
  // 节点落在分区里面（例如主入口就在区边内侧）时 boundaryNodes 为空 → 整区被跳过。
  const boundaryNodes = plan.nodes.filter((n) => n.verification !== 'unverified' && onRing(n, zone.polygon));
  const insideConfirmed = plan.nodes.filter(
    (n) =>
      n.verification === 'user-confirmed' &&
      (onRing(n, zone.polygon) || planPointInRing(n.position, zone.polygon)),
  );
  const zonePortals = [...new Map([...boundaryNodes, ...insideConfirmed].map((n) => [n.id, n])).values()];
  const portalAt = (p: PlanPoint) =>
    zonePortals.find((n) => Math.hypot(n.position.x - p.x, n.position.y - p.y) <= 1);
  const verifiedIndoor = zonePortals.filter((n) => n.verification === 'user-confirmed');
  if (zone.environment === 'indoor' && !verifiedIndoor.length) return null;

  const findSpur = (list: readonly PlanPoint[]): Spur | null => {
    let best: Spur | null = null;
    for (const sample of list) {
      const blocker =
        !portalAt(sample) && zone.environment !== 'indoor'
          ? [...plan.nodes, ...pendingNodes].find(
              (n) => Math.hypot(n.position.x - sample.x, n.position.y - sample.y) <= NODE_DEDUPE_M,
            )
          : null;
      for (const route of plan.routes) {
        if (route.kind !== 'pedestrian') continue; // 不把观众驳线接到车行/装卸线上。
        if (blocker) {
          // 2026-11-17 死结 4：既有口就在旁边 → 本区接驳到那个口，而不是整区放弃。
          // 那个口必须自己在人行流线上，否则接过去也走不了；护栏照旧全走一遍。
          const owner = pedestrianRouteThrough(blocker, plan.routes);
          if (!owner) continue;
          const points = [sample, blocker.position];
          if (!spurAllowed(plan, zone, points)) continue;
          const dist = Math.hypot(blocker.position.x - sample.x, blocker.position.y - sample.y);
          if (!best || dist < best.dist)
            best = { nodePos: sample, routePoint: blocker.position, dist, route: owner, portal: blocker };
          continue;
        }
        const hit = nearestPointOnPolyline(sample, route.points);
        if (hit.dist < 0.1) continue;
        const points = [sample, hit.point];
        if (!spurAllowed(plan, zone, points)) continue;
        if (!best || hit.dist < best.dist)
          best = { nodePos: sample, routePoint: hit.point, dist: hit.dist, route };
      }
    }
    return best;
  };

  // 区内已有确认口恰好落在人行主线上时（驳线退化为零长），
  // 「太近就跳过」会让整区拿不到驳线，报「没有可连通的2m人行支线」——已有入口反而变成没有入口。
  // 口径：先试已确认口（户外优先复用它），全都不可用再回退分区边界采样；室内仍需已核实的门，不回退。
  const preferredSamples =
    zone.environment === 'indoor'
      ? verifiedIndoor.map((n) => n.position)
      : zonePortals.map((n) => n.position);
  let bestSpur = findSpur(preferredSamples);
  if (!bestSpur && zone.environment !== 'indoor') bestSpur = findSpur(samples);
  if (!bestSpur || bestSpur.dist > MAX_SPUR_M) return null;

  // 与既有节点太近不重复立口；接驳到既有口时（bestSpur.portal）复用它。
  const tooClose = [...plan.nodes, ...pendingNodes].some(
    (node) => Math.hypot(node.position.x - bestSpur!.nodePos.x, node.position.y - bestSpur!.nodePos.y) <= NODE_DEDUPE_M,
  );
  const reuse = portalAt(bestSpur.nodePos) ?? bestSpur.portal ?? null;
  if (tooClose && !reuse) return null;
  if (opts.requireExistingPortal && !reuse) return null;

  const label = zone.name.slice(0, 40);
  const nodeId = reuse?.id ?? idFactory();
  const node: PlanNode | null = reuse
    ? null
    : {
        id: nodeId,
        verification: 'user-confirmed',
        kind: 'both',
        name: `${label}口`,
        position: { x: round1(bestSpur.nodePos.x), y: round1(bestSpur.nodePos.y) },
        notes: '活动子口位置提案（不是地图上的实体建筑门）：分区边界接驳主流线（V-4a）',
      };
  const route: PlanRoute = {
    id: idFactory(),
    kind: bestSpur.route.kind,
    startNodeId: nodeId,
    audiences: opts.audiences ?? spurAudiencesFor(zone),
    name: `${label}驳线`,
    points: [
      { x: round1(bestSpur.nodePos.x), y: round1(bestSpur.nodePos.y) },
      { x: round1(bestSpur.routePoint.x), y: round1(bestSpur.routePoint.y) },
    ],
    oneWay: false,
    widthM: Math.min(bestSpur.route.widthM ?? 2, 2),
    notes: bestSpur.portal
      ? 'AI 驳线提案：分区接驳到相邻子口（V-4a 死结 4 修正，不重复立口）'
      : 'AI 驳线提案：分区子口连接主流线（V-4a）',
  };
  return { route, node };
}

/**
 * 分区 → 子出入口 + 驳线草案。没有分区或没有流线回 null（调用方提示先排流线/分区）。
 */
export function buildSubEntranceProposal(
  plan: SpurPlanInput,
  idFactory: () => string = () =>
    (typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `s-${Math.random().toString(36).slice(2)}`),
): SubEntranceProposal | null {
  if (plan.zones.length === 0 || plan.routes.length === 0) return null;
  const routes: PlanRoute[] = [];
  const nodes: PlanNode[] = [];
  let skippedFar = 0;
  let spurs = 0;
  for (const zone of plan.zones.slice(0, NODE_CAP)) {
    if (nodes.length >= NODE_CAP) break;
    const built = buildZoneSpur(plan, zone, idFactory, { pendingNodes: nodes });
    if (!built) {
      skippedFar += 1;
      continue;
    }
    routes.push(built.route);
    if (built.node) nodes.push(built.node);
    spurs += 1;
  }
  if (routes.length === 0) return null;
  return { routes, nodes, summary: { spurs, zones: plan.zones.length, skippedFar } };
}
