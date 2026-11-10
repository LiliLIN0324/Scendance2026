/**
 * 冲突与缺失规则纯函数层（H3-b）——评审稿 §8 功能矩阵「冲突与缺失检查」/ §9.1 步骤 10。
 *
 * 口径（评审稿原文）：
 * - 「规划规则先检查人车中心线交叉、共线、越界和未连接。声明允许的共享节点；
 *   宽度已知时增加通行带与设施占地相交检查」；
 * - 「人车交叉有可定位标记，共用入口有单独分类，场外合法接驳可声明，
 *   缺宽度显示未评估该项。相交发现仅表示潜在问题」；
 * - 「容量与安全状态保留待核实」（评审稿 §5 问题列：显示规则、位置、对象、依据与处理状态）。
 *
 * 规则清单（全部派生现算，不落盘、不改契约）：
 * 1. route-crossing   人车中心线交叉：人行 × 车辆/后勤动线严格穿越相交（潜在问题），
 *    at = 交点；两条动线都引用的共享出入口节点位置的触碰豁免（声明允许的共享节点）。
 * 2. route-collinear  共线重叠：同对动线沿同一直线重叠 ≥ 最小长度（单独分类，与交叉互斥）。
 * 3. route-facility-collision  通行带与设施占地相交：宽度已知（widthM）的动线走廊
 *    （半宽 = widthM/2）触到设施占地角点/中心；at = 通行带上距设施最近的点。
 * 4. route-out-of-boundary     动线越界：顶点落在边界外，或（凸界内点不出界的兜底）
 *    非凸边界下边穿出（严格穿越）；贴边界（顶点在边界上）不算越界。
 * 5. route-missing-width       缺宽度：车辆/后勤动线未设置 widthM →「通行带未评估」
 *    缺失项（不虚构宽度）；人行动线不强制宽度（自由通行），但宽度已知时同样参与规则 3。
 * 6. capacity-unverified       容量待核实：观众区按面积 ÷ 人均占地估算容量，
 *    规划假设常量（非法规口径），结果一律标「待核实」。
 *
 * 每条问题带 status（conflict / missing / unverified）、可定位点 at、关联对象
 * （routeIds / facilityId / zoneId）——画布标记与面板清单共用本层输出。
 */

import {
  planRingAreaM2,
  type PlanFacility,
  type PlanPoint,
  type PlanRoute,
  type SitePlanData,
} from '../../../../supabase/functions/_shared/site-plan';
import {
  planPointDistanceM,
  planPointInRing,
  planSegmentsCrossStrict,
} from './site-plan-editing';
import { facilityFootprintRing } from './site-plan-facilities';

/** 共线重叠的最小长度（m）：低于它视为设计内的短暂并行，不提示。 */
export const PLAN_COLLINEAR_MIN_LENGTH_M = 0.5;
/** 交叉点豁免半径（m）：与共享节点位置距离小于该值视为声明内触碰。与顶点最小间距同值。 */
export const PLAN_SHARED_NODE_TOLERANCE_M = 0.5;
/** 观众区人均占地（m²/人）：站立观演常见规划假设，**非法规口径**，估算结果标「待核实」。 */
export const PLAN_AUDIENCE_AREA_PER_PERSON_M2 = 1.0;

const EPS = 1e-9;

export type PlanConflictCategory =
  | 'route-crossing'
  | 'route-collinear'
  | 'route-facility-collision'
  | 'route-out-of-boundary'
  | 'route-missing-width'
  | 'capacity-unverified';

export type PlanConflictStatus = 'conflict' | 'missing' | 'unverified';

/** 冲突/缺失问题：可定位（at）+ 关联对象（画布标记点击定位用）。 */
export interface PlanConflictIssue {
  /** 稳定 key：React 列表 key 与画布标记高亮共用。 */
  key: string;
  category: PlanConflictCategory;
  status: PlanConflictStatus;
  message: string;
  at: PlanPoint;
  routeIds: string[];
  facilityId?: string;
  zoneId?: string;
  zoneName?: string;
}

/** 类别中文名（面板清单与定位提示共用）。 */
export const PLAN_CONFLICT_CATEGORY_LABELS: Record<PlanConflictCategory, string> = {
  'route-crossing': '人车交叉',
  'route-collinear': '动线共线',
  'route-facility-collision': '通行带压设施',
  'route-out-of-boundary': '动线越界',
  'route-missing-width': '缺宽度',
  'capacity-unverified': '容量待核实',
};

/* ---------------- 内部几何工具 ---------------- */

function sub(a: PlanPoint, b: PlanPoint): PlanPoint {
  return { x: a.x - b.x, y: a.y - b.y };
}

function cross(a: PlanPoint, b: PlanPoint): number {
  return a.x * b.y - a.y * b.x;
}

function dot(a: PlanPoint, b: PlanPoint): number {
  return a.x * b.x + a.y * b.y;
}

function addScaled(p: PlanPoint, dir: PlanPoint, s: number): PlanPoint {
  return { x: p.x + dir.x * s, y: p.y + dir.y * s };
}

/**
 * 两线段严格穿越相交的交点（planSegmentsCrossStrict 为真时才调用）。
 * 参数化求解 s ∈ (0,1)：a1 + s·d1 = b1 + t·d2。
 */
function strictCrossingPoint(a1: PlanPoint, a2: PlanPoint, b1: PlanPoint, b2: PlanPoint): PlanPoint {
  const d1 = sub(a2, a1);
  const d2 = sub(b2, b1);
  const denom = cross(d1, d2);
  // 严格穿越已排除平行（denom ≠ 0），EPS 兜底防御。
  if (Math.abs(denom) < EPS) return { x: (a1.x + a2.x) / 2, y: (a1.y + a2.y) / 2 };
  const s = cross(sub(b1, a1), d2) / denom;
  return addScaled(a1, d1, s);
}

/** 两线段是否共线且重叠段长度 ≥ minLength；命中返回重叠段中点。 */
function collinearOverlapMidpoint(
  a1: PlanPoint,
  a2: PlanPoint,
  b1: PlanPoint,
  b2: PlanPoint,
  minLength: number,
): PlanPoint | null {
  const d1 = sub(a2, a1);
  const d2 = sub(b2, b1);
  const len1Sq = dot(d1, d1);
  if (len1Sq < EPS * EPS) return null;
  // 平行 + 共线：B 所在直线与 A 同线（取 b1、b2 双点验证，斜率相同且截距相同）。
  if (Math.abs(cross(d1, d2)) > EPS * Math.max(len1Sq, dot(d2, d2))) return null;
  if (Math.abs(cross(sub(b1, a1), d1)) > EPS * Math.sqrt(len1Sq)) return null;
  // B 端点投影到 A 的参数区间，与 [0,1] 求交。
  const inv = 1 / len1Sq;
  const s1 = dot(sub(b1, a1), d1) * inv;
  const s2 = dot(sub(b2, a1), d1) * inv;
  const lo = Math.max(0, Math.min(s1, s2));
  const hi = Math.min(1, Math.max(s1, s2));
  const overlapLen = (hi - lo) * Math.sqrt(len1Sq);
  if (overlapLen < minLength) return null;
  return addScaled(a1, d1, (lo + hi) / 2);
}

/** 点到线段最近点（米制；通行带相交定位用）。 */
function closestPointOnSegment(p: PlanPoint, a: PlanPoint, b: PlanPoint): PlanPoint {
  const d = sub(b, a);
  const len2 = dot(d, d);
  if (len2 < EPS * EPS) return { x: a.x, y: a.y };
  const t = Math.max(0, Math.min(1, dot(sub(p, a), d) / len2));
  return addScaled(a, d, t);
}

/** 点到折线最近点。 */
function closestPointOnPolyline(p: PlanPoint, points: readonly PlanPoint[]): PlanPoint {
  let best = points[0]!;
  let bestDist = Infinity;
  for (let i = 1; i < points.length; i++) {
    const candidate = closestPointOnSegment(p, points[i - 1]!, points[i]!);
    const dist = planPointDistanceM(p, candidate);
    if (dist < bestDist) {
      bestDist = dist;
      best = candidate;
    }
  }
  return best;
}

/** 「人车对」判定：一条人行 + 一条车辆类（车辆/后勤）动线。 */
function isPedestrianVehiclePair(a: PlanRoute, b: PlanRoute): boolean {
  const veh = (r: PlanRoute) => r.kind === 'vehicle' || r.kind === 'service';
  return (a.kind === 'pedestrian' && veh(b)) || (veh(a) && b.kind === 'pedestrian');
}

/** 两条动线共同引用的出入口节点位置（声明允许的共享节点，交叉豁免）。 */
function declaredSharedNodePositions(a: PlanRoute, b: PlanRoute, nodes: readonly { id: string; position: PlanPoint }[]): PlanPoint[] {
  const refsOf = (route: PlanRoute) => new Set([route.startNodeId, route.endNodeId].filter(Boolean) as string[]);
  const aRefs = refsOf(a);
  const bRefs = refsOf(b);
  const shared: PlanPoint[] = [];
  for (const node of nodes) {
    if (aRefs.has(node.id) && bRefs.has(node.id)) shared.push(node.position);
  }
  return shared;
}

function nearAny(pt: PlanPoint, targets: readonly PlanPoint[], tolerance: number): boolean {
  return targets.some(t => planPointDistanceM(pt, t) <= tolerance);
}

/** 折线中点顶点（缺宽度标记的定位点，与画布折线标注同口径）。 */
function polylineMidVertex(points: readonly PlanPoint[]): PlanPoint {
  return points[Math.floor(points.length / 2)]!;
}

/* ---------------- 主规则 ---------------- */

export type PlanConflictInput = Pick<SitePlanData, 'boundary' | 'zones' | 'facilities' | 'routes' | 'nodes'>;

/**
 * 全案冲突/缺失检查（评审稿「随编辑实时跑」）：输入一份数据，输出可定位问题清单。
 * 顺序稳定：人车交叉 → 共线 → 通行带压设施 → 越界 → 缺宽度 → 容量待核实。
 */
export function planConflictIssues(plan: PlanConflictInput): PlanConflictIssue[] {
  const issues: PlanConflictIssue[] = [];
  const routes = plan.routes;
  const boundary = plan.boundary;
  const boundaryUsable = boundary.length >= 3;

  // 1) 人车中心线交叉（i<j 全对，仅人行 × 车辆类；严格穿越，端点触碰不算）。
  for (let i = 0; i < routes.length; i++) {
    for (let j = i + 1; j < routes.length; j++) {
      const a = routes[i]!;
      const b = routes[j]!;
      if (!isPedestrianVehiclePair(a, b)) continue;
      const sharedNodes = declaredSharedNodePositions(a, b, plan.nodes);
      for (let si = 1; si < a.points.length; si++) {
        for (let sj = 1; sj < b.points.length; sj++) {
          const a1 = a.points[si - 1]!;
          const a2 = a.points[si]!;
          const b1 = b.points[sj - 1]!;
          const b2 = b.points[sj]!;
          if (!planSegmentsCrossStrict(a1, a2, b1, b2)) continue;
          const at = strictCrossingPoint(a1, a2, b1, b2);
          if (nearAny(at, sharedNodes, PLAN_SHARED_NODE_TOLERANCE_M)) continue;
          issues.push({
            key: `crossing:${a.id}:${b.id}:${si - 1}:${sj - 1}`,
            category: 'route-crossing',
            status: 'conflict',
            message: `「${a.name}」与「${b.name}」中心线交叉（潜在问题，请确认分流）。`,
            at,
            routeIds: [a.id, b.id],
          });
        }
      }
      // 2) 共线重叠（与交叉互斥：共线不严格穿越）。
      for (let si = 1; si < a.points.length; si++) {
        for (let sj = 1; sj < b.points.length; sj++) {
          const mid = collinearOverlapMidpoint(a.points[si - 1]!, a.points[si]!, b.points[sj - 1]!, b.points[sj]!, PLAN_COLLINEAR_MIN_LENGTH_M);
          if (!mid) continue;
          issues.push({
            key: `collinear:${a.id}:${b.id}:${si - 1}:${sj - 1}`,
            category: 'route-collinear',
            status: 'conflict',
            message: `「${a.name}」与「${b.name}」沿同一直线重叠（共用走廊，请确认是否分离）。`,
            at: mid,
            routeIds: [a.id, b.id],
          });
        }
      }
    }
  }

  // 3) 通行带与设施占地相交（宽度已知的动线走廊 vs 设施占地角点/中心）。
  for (const route of routes) {
    if (route.widthM === undefined) continue;
    const halfWidth = route.widthM / 2;
    for (const facility of plan.facilities) {
      const footprint = facilityFootprintRing(facility as Pick<PlanFacility, 'position' | 'rotationDeg' | 'size'>);
      const probes = [...footprint, facility.position];
      const hit = probes.some(probe => {
        for (let i = 1; i < route.points.length; i++) {
          if (planPointDistanceM(probe, closestPointOnSegment(probe, route.points[i - 1]!, route.points[i]!)) <= halfWidth + EPS) return true;
        }
        return false;
      });
      if (!hit) continue;
      issues.push({
        key: `corridor:${route.id}:${facility.id}`,
        category: 'route-facility-collision',
        status: 'conflict',
        message: `「${route.name}」的通行带（宽 ${route.widthM} m）与设施「${facility.name}」占地相交。`,
        at: closestPointOnPolyline(facility.position, route.points),
        routeIds: [route.id],
        facilityId: facility.id,
      });
    }
  }

  // 4) 动线越界：顶点出界优先报顶点；顶点都在界内时兜底查边穿出（非凸边界）。
  for (const route of routes) {
    if (!boundaryUsable) continue;
    const outsideVertex = route.points.find(pt => !planPointInRing(pt, boundary));
    if (outsideVertex) {
      issues.push({
        key: `route-out:${route.id}:vertex`,
        category: 'route-out-of-boundary',
        status: 'conflict',
        message: `「${route.name}」有顶点落在场地边界之外。`,
        at: outsideVertex,
        routeIds: [route.id],
      });
      continue;
    }
    let flagged = false;
    for (let i = 1; i < route.points.length && !flagged; i++) {
      for (let j = 0; j < boundary.length; j++) {
        const b1 = boundary[j]!;
        const b2 = boundary[(j + 1) % boundary.length]!;
        if (!planSegmentsCrossStrict(route.points[i - 1]!, route.points[i]!, b1, b2)) continue;
        issues.push({
          key: `route-out:${route.id}:edge:${i - 1}:${j}`,
          category: 'route-out-of-boundary',
          status: 'conflict',
          message: `「${route.name}」有边穿出场地边界。`,
          at: strictCrossingPoint(route.points[i - 1]!, route.points[i]!, b1, b2),
          routeIds: [route.id],
        });
        flagged = true;
        break;
      }
    }
  }

  // 5) 缺宽度：车辆/后勤动线未设置 widthM →「未评估」缺失项（不虚构宽度）。
  for (const route of routes) {
    if (route.kind === 'pedestrian' || route.widthM !== undefined) continue;
    issues.push({
      key: `no-width:${route.id}`,
      category: 'route-missing-width',
      status: 'missing',
      message: `「${route.name}」未设置宽度，通行带与设施占地相交检查未评估该项。`,
      at: polylineMidVertex(route.points),
      routeIds: [route.id],
    });
  }

  // 6) 容量待核实：观众区按面积估算（规划假设常量，非法规口径）。
  for (const zone of plan.zones) {
    if (zone.semantic !== 'audience' || zone.polygon.length < 3) continue;
    const areaM2 = planRingAreaM2(zone.polygon);
    const estimate = Math.floor(areaM2 / PLAN_AUDIENCE_AREA_PER_PERSON_M2);
    const anchorA = zone.polygon[0]!;
    const anchorB = zone.polygon[1]!;
    issues.push({
      key: `capacity:${zone.id}`,
      category: 'capacity-unverified',
      status: 'unverified',
      message: `观众区「${zone.name}」容量估算约 ${estimate} 人（面积 ${Math.round(areaM2)} m² ÷ ${PLAN_AUDIENCE_AREA_PER_PERSON_M2} m²/人，规划假设，待核实）。`,
      at: { x: (anchorA.x + anchorB.x) / 2, y: (anchorA.y + anchorB.y) / 2 },
      routeIds: [],
      zoneId: zone.id,
      zoneName: zone.name,
    });
  }

  return issues;
}

/** 冲突/缺失条数（面板角标与统计条用）。 */
export function planConflictCount(plan: PlanConflictInput): number {
  return planConflictIssues(plan).length;
}
