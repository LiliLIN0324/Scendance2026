import { outdoorCorridorStrips, outdoorRingsOverlap } from './outdoor-event-logic';
import { facilityFootprintRing, facilityPlacementIssues } from './site-plan-facilities';
/**
 * V-4a（2026-11-13）：子出入口提案（纯函数，预览不落盘）。
 *
 * 用户草图（图4）口径：每个分区 1–2 个子出入口，用区内驳线接到主流线上——
 * 主流线走场地边路，人流从区边的子口进出。输入当前 plan（分区+流线+既有节点），
 * 产出 { routes, nodes } 草案（与 RouteProposal 同形，复用流线确认卡与 applyRoutes 通道）：
 * - 每分区取「分区边界上离最近流线点最近的点」立子节点（kind 'both'）；
 * - 驳线 = 子节点 → 流线最近点（两点直线，类别随被接流线）；
 * - 流线离分区太远（>120m）的分区跳过；与既有节点 15m 内重复的不再立。
 */

import type { PlanNode, PlanPoint, PlanRoute, SitePlanData } from '../../../../supabase/functions/_shared/site-plan';

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

/**
 * 分区 → 子出入口 + 驳线草案。没有分区或没有流线回 null（调用方提示先排流线/分区）。
 */
export function buildSubEntranceProposal(
  plan: Pick<SitePlanData, 'zones' | 'routes' | 'nodes'> & Partial<Pick<SitePlanData, 'boundary' | 'facilities'>>,
  idFactory: () => string = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `s-${Math.random().toString(36).slice(2)}`),
): SubEntranceProposal | null {
  if (plan.zones.length === 0 || plan.routes.length === 0) return null;
  const routes: PlanRoute[] = [];
  const nodes: PlanNode[] = [];
  let skippedFar = 0;
  let spurs = 0;
  for (const zone of plan.zones.slice(0, NODE_CAP)) {
    if (nodes.length >= NODE_CAP) break;
    // 分区边界采样：边中点先、顶点后——几何平局时中点胜出（子口落在边中央=居中门位，
    // 不会钉在角上）；取离最近流线最近者作子口位置。
    let bestSpur: { nodePos: PlanPoint; routePoint: PlanPoint; dist: number; route: PlanRoute } | null = null;
    const samples: PlanPoint[] = [];
    const boundaryNodes=plan.nodes.filter(n=>n.verification!=='unverified'&&zone.polygon.some((a,i)=>{const hit=nearestPointOnSegment(n.position,a,zone.polygon[(i+1)%zone.polygon.length]!);return Math.hypot(hit.x-n.position.x,hit.y-n.position.y)<=1;}));
    const verifiedIndoor=boundaryNodes.filter(n=>n.verification==='user-confirmed');
    if(zone.environment==='indoor'&&!verifiedIndoor.length){skippedFar++;continue;}
    for (let i = 0; i < zone.polygon.length; i += 1) {
      const next = zone.polygon[(i + 1) % zone.polygon.length]!;
      samples.push({ x: (zone.polygon[i]!.x + next.x) / 2, y: (zone.polygon[i]!.y + next.y) / 2 }, zone.polygon[i]!);
    }
    for (const sample of zone.environment==='indoor'?verifiedIndoor.map(n=>n.position):boundaryNodes.length?boundaryNodes.map(n=>n.position):samples) {
      for (const route of plan.routes) {
        if (route.kind !== 'pedestrian') continue; // 不把观众驳线接到车行/装卸线上。
        if(!boundaryNodes.length&&zone.environment!=='indoor'&&[...plan.nodes,...nodes].some(n=>Math.hypot(n.position.x-sample.x,n.position.y-sample.y)<=NODE_DEDUPE_M))continue;
        const hit = nearestPointOnPolyline(sample, route.points);
        if(hit.dist<0.1)continue;
        const points = [sample, hit.point];
        const strips = outdoorCorridorStrips(points, 2);
        if (plan.boundary && strips.some(strip => facilityPlacementIssues(strip, plan.boundary!).length)) continue;
        if ((plan.facilities ?? []).some(f => strips.some(strip => outdoorRingsOverlap(strip, facilityFootprintRing(f))))) continue;
        if(plan.zones.some(other=>other.id!==zone.id&&['performance','exhibition'].includes(other.purpose??'')&&strips.some(strip=>outdoorRingsOverlap(strip,other.polygon))))continue;
        if (plan.routes.some(r => r.kind !== 'pedestrian' && outdoorCorridorStrips(r.points, (r.widthM ?? 4) + 2).some(road => strips.some(strip => outdoorRingsOverlap(strip, road))))) continue;
        if (!bestSpur || hit.dist < bestSpur.dist) {
          bestSpur = { nodePos: sample, routePoint: hit.point, dist: hit.dist, route };
        }
      }
    }
    if (!bestSpur || bestSpur.dist > MAX_SPUR_M) { skippedFar += 1; continue; }
    // 与既有节点太近不重复立
    const tooClose = [...plan.nodes, ...nodes].some(node => Math.hypot(node.position.x - bestSpur.nodePos.x, node.position.y - bestSpur.nodePos.y) <= NODE_DEDUPE_M);
    const reuse=boundaryNodes.find(n=>Math.hypot(n.position.x-bestSpur.nodePos.x,n.position.y-bestSpur.nodePos.y)<=1);
    if (tooClose&&!reuse) continue;
    const label = zone.name.slice(0, 40);
    const nodeId=reuse?.id??idFactory();
    if(!reuse)nodes.push({
      id: nodeId,
      verification: 'user-confirmed',
      kind: 'both',
      name: `${label}口`,
      position: { x: Math.round(bestSpur.nodePos.x * 10) / 10, y: Math.round(bestSpur.nodePos.y * 10) / 10 },
      notes: '活动子口位置提案（不是地图上的实体建筑门）：分区边界接驳主流线（V-4a）',
    });
    routes.push({
      id: idFactory(),
      kind: bestSpur.route.kind,
      startNodeId:nodeId,
      audiences:zone.purpose==='performance'?['performers','staff','security']:zone.purpose==='service'?['service','staff','security']:['visitors','staff','security'],
      name: `${label}驳线`,
      points: [
        { x: Math.round(bestSpur.nodePos.x * 10) / 10, y: Math.round(bestSpur.nodePos.y * 10) / 10 },
        { x: Math.round(bestSpur.routePoint.x * 10) / 10, y: Math.round(bestSpur.routePoint.y * 10) / 10 },
      ],
      oneWay: false,
      widthM: Math.min(bestSpur.route.widthM ?? 2, 2),
      notes: 'AI 驳线提案：分区子口连接主流线（V-4a）',
    });
    spurs += 1;
  }
  if (routes.length === 0) return null;
  return { routes, nodes, summary: { spurs, zones: plan.zones.length, skippedFar } };
}
