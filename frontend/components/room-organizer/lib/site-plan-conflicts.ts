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
 * 1. route-crossing   设施上人车交叉：人行 × 车辆/后勤动线严格穿越且**交点落在设施占地上**才算冲突（2026-11-16 用户：人车交叉本身不算问题）；
 *    at = 交点；两条动线都引用的共享出入口节点位置的触碰豁免（声明允许的共享节点）。
 * 2. route-collinear  共线重叠：同对动线沿同一直线重叠 ≥ 最小长度（单独分类，与交叉互斥）。
 * 3. route-facility-collision  通行带与设施占地相交：宽度已知（widthM）的动线走廊
 *    （半宽 = widthM/2）触到设施占地角点/中心；at = 通行带上距设施最近的点。
 * 4. route-missing-width       缺宽度：车辆/后勤动线未设置 widthM →「通行带未评估」
 *    缺失项（不虚构宽度）；人行动线不强制宽度（自由通行），但宽度已知时同样参与规则 3。
 * 5. capacity-unverified       容量待核实：观众区按面积 ÷ 人均占地估算容量，
 *    规划假设常量（非法规口径），结果一律标「待核实」。
 *
 * 2026-11-15 用户：「很多人就是从场地外面挪进来的」——动线本来就是把人从场外带进场内的，
 * 顶点落在边界外是**正常写法**（观众从马路边/集合点走过来），所以取消了动线越界这条规则。
 * 分区/设施/人员的越界仍由 site-plan-editing / 各自问题层单独管，不受这里影响。
 *
 * 每条问题带 status（conflict / missing / unverified）、可定位点 at、关联对象
 * （routeIds / facilityId / zoneId）——画布标记与面板清单共用本层输出。
 */

import {
  planRingAreaM2,
  routeCarrier,
  type PlanFacility,
  type PlanPoint,
  type PlanRoute,
  type SitePlanData,
} from '../../../../supabase/functions/_shared/site-plan';
// 2026-11-20 审计 K7：设施互相重叠（允许叠放的类别已在那个模块里排除）。
import { facilityOverlapPairs } from './plan-facility-overlap';
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
  | 'route-missing-width'
  | 'capacity-unverified'
  // 2026-11-20 审计 K7：物料压物料（两顶帐篷、两个展位叠在一起）。
  | 'facility-overlap';

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
  'route-crossing': '设施上人车交叉',
  'route-collinear': '动线共线',
  'route-facility-collision': '通行带压设施',
  'route-missing-width': '缺宽度',
  'capacity-unverified': '容量待核实',
  'facility-overlap': '设施重叠',
};

/**
 * 状态严重度（合并徽章取组内最高，颜色与明细顺序都按它）。
 */
export const PLAN_CONFLICT_STATUS_PRIORITY: Record<PlanConflictStatus, number> = {
  conflict: 2,
  missing: 1,
  unverified: 0,
};

/** 画布默认只画这两类（2026-11-15 用户：默认只显示冲突红 / 缺宽度橙，「容量待核实」先收起）。 * 默认上图的状态：2026-11-16 用户「场地上又出现感叹号，不知道为什么」之后收窄为**只有真冲突**。
 * 「缺宽度」「容量待核实」属于提示项，仍进问题清单，但要手动开关才上图（否则每加一条车行/后勤线就冒一颗橙点）。
 */
export const PLAN_CONFLICT_DEFAULT_STATUSES: readonly PlanConflictStatus[] = ['conflict'];

/**
 * 合并后的画布标记：同一条动线（或同一个分区）的多条问题合成一枚徽章。
 *
 * 为什么合并：一条线上同时命中「缺宽度 + 越界 + 两次交叉」就会在线上撒四枚叹号，
 * 看上去像四处故障，实际是同一件事的四个侧面（用户 2026-11-15 反馈）。
 */
export interface PlanConflictCluster {
  /** 稳定 key：`route:<id>` / `zone:<id>` / `issue:<key>`。 */
  key: string;
  /** 组内最严重状态（决定徽章颜色）。 */
  status: PlanConflictStatus;
  /** 徽章落点 = 组内最严重那条问题的定位点。 */
  at: PlanPoint;
  routeIds: string[];
  zoneId?: string;
  /** 组内问题，按严重度降序（点开明细的顺序）。 */
  issues: PlanConflictIssue[];
  /** 组内条数：>1 时徽章画数字，1 条时画「!」。 */
  count: number;
}

/**
 * 按关联对象合并问题：动线按 `routeIds[0]`，只关联分区的按 `zoneId`，
 * 其余（理论上没有）单独一组。人车交叉只挂在前一条动线上，不在另一条上重复出现。
 */
export function groupConflictIssues(issues: readonly PlanConflictIssue[]): PlanConflictCluster[] {
  const buckets = new Map<string, PlanConflictIssue[]>();
  for (const issue of issues) {
    const key = issue.routeIds[0]
      ? `route:${issue.routeIds[0]}`
      : issue.zoneId
        ? `zone:${issue.zoneId}`
        : `issue:${issue.key}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(issue);
    else buckets.set(key, [issue]);
  }
  const clusters: PlanConflictCluster[] = [];
  for (const [key, bucket] of buckets) {
    const sorted = [...bucket].sort((a, b) => PLAN_CONFLICT_STATUS_PRIORITY[b.status] - PLAN_CONFLICT_STATUS_PRIORITY[a.status]);
    const worst = sorted[0]!;
    clusters.push({
      key,
      status: worst.status,
      at: worst.at,
      routeIds: worst.routeIds,
      ...(worst.zoneId !== undefined ? { zoneId: worst.zoneId } : {}),
      issues: sorted,
      count: sorted.length,
    });
  }
  return clusters;
}

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

/**
 * 「人车对」判定（2026-11-16 改按载体）：载体不同才可能互相干扰——步行×推车、
 * 步行×机动车、推车×机动车都算一对，同载体（步行×步行）不算。
 *
 * 这样后勤里的人和车各按各的算：推车要人工标 carrier='trolley' 才会跟人流报交叉，
 * 不再是「凡是后勤一律当车」。存量数据全吃默认步行，彼此不构成人车对。
 */
function isPedestrianVehiclePair(a: PlanRoute, b: PlanRoute): boolean {
  return routeCarrier(a) !== routeCarrier(b);
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

/** 交叉点落在哪个设施占地上（含边界）；都不覆盖则 null。 */
function facilityCoveringPoint(
  pt: PlanPoint,
  facilities: readonly PlanFacility[],
): PlanFacility | null {
  for (const facility of facilities) {
    const ring = facilityFootprintRing(facility as Pick<PlanFacility, 'position' | 'rotationDeg' | 'size'>);
    if (ring.length >= 3 && planPointInRing(pt, ring)) return facility;
  }
  return null;
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
 * 顺序稳定：人车交叉 → 共线 → 通行带压设施 → 缺宽度 → 容量待核实。
 */
export function planConflictIssues(plan: PlanConflictInput): PlanConflictIssue[] {
  const issues: PlanConflictIssue[] = [];
  const routes = plan.routes;

  // 1) 人车中心线交叉（i<j 全对，仅人行 × 车辆类；严格穿越，端点触碰不算；且交点要落在设施占地上）。
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
          // 2026-11-16 用户：「人车交叉没问题。除非是踩在设施上了」——
          // 平面上人车交叉是设计常态（出入口、货口、红毯口），不再单独报；
          // 只有交叉点落在设施占地里（设施上人车混行）才算真冲突。
          const covering = facilityCoveringPoint(at, plan.facilities);
          if (!covering) continue;
          issues.push({
            key: `crossing:${a.id}:${b.id}:${si - 1}:${sj - 1}`,
            category: 'route-crossing',
            status: 'conflict',
            message: `「${a.name}」与「${b.name}」在设施「${covering.name}」占地上交叉（设施上人车混行，请确认分流）。`,
            at,
            routeIds: [a.id, b.id],
            facilityId: covering.id,
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

  // 4) 动线越界：2026-11-15 用户拍掉这条规则——「很多人就是从场地外面挪进来的」。
  // 动线的正常用途就是把场外的人流带进场内（马路边仓库、集合点、接驳车落客点），
  // 顶点落在边界外是设计意图而不是错误；继续报红只会盖住真正要看的冲突。
  // 越界判定仍保留给分区/设施/人员（各自问题层），动线不再产生这类问题。

  // 5) 缺宽度：车辆/后勤动线未设置 widthM →「未评估」缺失项（不虚构宽度）。
  for (const route of routes) {
    // 宽度要求跟着载体走：只有步行不需要报「缺宽度」（推车/机动车都要）。
    if (routeCarrier(route) === 'walk' || route.widthM !== undefined) continue;
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

  // 7) 设施互相重叠（K7）：允许叠放的类别（地毯/桌布/桌椅/隔离栏）不报；
  //    其余真重叠按「待核实」提示，「几乎完全重合」按冲突报（看起来像重复摆放）。
  for (const pair of facilityOverlapPairs(plan.facilities)) {
    const percent = Math.round(pair.ratio * 100);
    issues.push({
      key: `overlap:${pair.a.id}:${pair.b.id}`,
      category: 'facility-overlap',
      status: pair.nearDuplicate ? 'conflict' : 'unverified',
      message: pair.nearDuplicate
        ? `「${pair.a.name}」与「${pair.b.name}」几乎完全重合（约 ${percent}%），像是重复摆放。`
        : `「${pair.a.name}」与「${pair.b.name}」占地重叠（约 ${percent}%），确认是否真的要叠着摆。`,
      at: pair.at,
      routeIds: [],
      facilityId: pair.a.id,
    });
  }

  return issues;
}

/** 冲突/缺失条数（面板角标与统计条用）。 */
export function planConflictCount(plan: PlanConflictInput): number {
  return planConflictIssues(plan).length;
}
