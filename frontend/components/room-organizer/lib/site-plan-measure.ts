/**
 * 米制测量与派生统计纯函数层（H3-a）。
 *
 * 口径（评审稿 §8 功能矩阵「测量与计算」/ §9.1 步骤 9 / §4 顶栏规划信息）：
 * - 测量标注三类：距离（2 点段长）、面积（≥3 点闭合环）、路径（≥2 点折线）；
 *   公式不另立——距离/路径复用契约 planRouteLengthM，面积复用 planRingAreaM2，
 *   「3–4–5 m 距离显示 5 m、10×10 m 区域显示 100 m²、两段各 10 m 折线显示 20 m」，
 *   且读数来自米制 ENU 真值，缩放后结果一致。
 * - 临时测量 = 画布草稿的实时读数（measureDraftReadout，不落盘，Esc 丢弃）；
 *   固定测量 = buildMeasurement 提交进 plan.measurements（面板可删，不参与冲突判定）。
 * - 派生统计 planOverviewStats：全案顶层计数与长度汇总，全部现算不落盘；
 *   只看数据不看图层可见性——隐藏图层不改变全案统计（评审稿 §4 口径）。
 */

import {
  planRingAreaM2,
  planRouteLengthM,
  type PlanMeasurement,
  type PlanPoint,
  type SitePlanData,
} from '../../../../supabase/functions/_shared/site-plan';
import {
  planPointDistanceM,
  planRingSelfIntersects,
  planZoneIssues,
  type PlanEditIssue,
  type PlanEditResult,
} from './site-plan-editing';
import { planFacilityIssues } from './site-plan-facilities';
import { planNodeIssues, planWorkerIssues } from './site-plan-routes';
import { planConflictIssues } from './site-plan-conflicts';

/** 测量顶点上限：与契约 planMeasurementSchema.points.max 一致。 */
export const PLAN_MEASURE_MAX_VERTICES = 64;

/** 契约平面点范围（±5000 m），与 site-plan planPointSchema 同源。 */
const PLAN_COORD_LIMIT_M = 5000;

export type PlanMeasureKind = PlanMeasurement['kind'];

function pointInRange(pt: PlanPoint): boolean {
  return Number.isFinite(pt.x) && Number.isFinite(pt.y)
    && Math.abs(pt.x) <= PLAN_COORD_LIMIT_M && Math.abs(pt.y) <= PLAN_COORD_LIMIT_M;
}

/** 测量几何校验：点数按三类口径、相邻不重合、范围内、面积环不自交。 */
function measureGeometryIssues(kind: PlanMeasureKind, points: readonly PlanPoint[]): PlanEditIssue[] {
  const issues: PlanEditIssue[] = [];
  if (kind === 'distance') {
    if (points.length < 2) issues.push({ code: 'too-few-vertices', message: '距离测量需要 2 个点（起点和终点）。' });
    if (points.length > 2) issues.push({ code: 'too-many-vertices', message: '距离测量只要 2 个点，多段请用路径测量。' });
  }
  if (kind === 'area' && points.length < 3) {
    issues.push({ code: 'too-few-vertices', message: '面积测量至少要 3 个点才能围出区域。' });
  }
  if (kind === 'path' && points.length < 2) {
    issues.push({ code: 'too-few-vertices', message: '路径测量至少要 2 个点。' });
  }
  if (points.length > PLAN_MEASURE_MAX_VERTICES) {
    issues.push({ code: 'too-many-vertices', message: `测量顶点超过上限 ${PLAN_MEASURE_MAX_VERTICES} 个。` });
  }
  for (let i = 1; i < points.length; i++) {
    if (planPointDistanceM(points[i - 1]!, points[i]!) === 0) {
      issues.push({ code: 'duplicate-vertex', message: `测量第 ${i}、${i + 1} 点重合，先移动开再提交。`, at: points[i] });
      break;
    }
  }
  if (kind === 'area' && points.length >= 3 && planRingSelfIntersects(points)) {
    issues.push({ code: 'self-intersection', message: '面积测量轮廓自相交了（边和边交叉），请按顺序描一圈。' });
  }
  for (const pt of points) {
    if (!pointInRange(pt)) {
      issues.push({ code: 'out-of-range', message: '测量顶点超出场地坐标系 ±5000 m 范围。', at: pt });
      break;
    }
  }
  return issues;
}

export interface BuildMeasurementInput {
  kind: PlanMeasureKind;
  name: string;
  points: readonly PlanPoint[];
  notes?: string;
  id?: string;
}

/** 建立一条固定测量：几何按三类口径全部合法才提交；读数不落盘、渲染时现算。 */
export function buildMeasurement(input: BuildMeasurementInput): PlanEditResult<PlanMeasurement> {
  const issues = measureGeometryIssues(input.kind, input.points);
  if (issues.length > 0) return { ok: false, issue: issues[0]! };
  const measurement: PlanMeasurement = {
    id: input.id ?? crypto.randomUUID(),
    kind: input.kind,
    name: input.name,
    points: input.points.map(p => ({ x: p.x, y: p.y })),
    notes: input.notes ?? '',
  };
  return { ok: true, value: measurement };
}

/** 测量读数：距离/路径 = 折线总长（m）；面积 = 闭合环面积（m²）。公式复用契约派生原语。 */
export function measureValue(measurement: { kind: PlanMeasureKind; points: readonly PlanPoint[] }): number {
  return measurement.kind === 'area'
    ? planRingAreaM2(measurement.points)
    : planRouteLengthM(measurement.points);
}

/** 数值格式化：整数不带小数、最多 1 位小数（5 → '5'，4.25 → '4.3'）。 */
function trimNumber(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

export function formatLengthM(meters: number): string {
  return `${trimNumber(meters)} m`;
}

export function formatAreaM2(m2: number): string {
  return `${trimNumber(m2)} m²`;
}

/**
 * 画布草稿实时读数（临时测量）：距离 = 当前段长；路径 = 已收点 + 指针的总长；
 * 面积 = 按已收点 + 指针闭合的预览环面积。点数不够时返回 null（不画读数）。
 */
export function measureDraftReadout(
  kind: PlanMeasureKind,
  points: readonly PlanPoint[],
  cursor?: PlanPoint,
): string | null {
  if (kind === 'distance') {
    const a = points[0];
    const b = points.length === 2 ? points[1] : cursor;
    if (!a || !b) return null;
    return formatLengthM(planPointDistanceM(a, b));
  }
  if (kind === 'path') {
    const hasLive = points.length >= 1 && cursor;
    if (points.length < 2 && !hasLive) return null;
    let total = planRouteLengthM(points);
    if (cursor && points.length >= 1) {
      total += planPointDistanceM(points[points.length - 1]!, cursor);
    }
    return formatLengthM(total);
  }
  // area：按已收点 + 指针闭合的预览环。
  const ring = cursor ? [...points, cursor] : [...points];
  if (ring.length < 3) return null;
  return formatAreaM2(planRingAreaM2(ring));
}

/* ---------------- 派生统计（全案顶层口径，现算不落盘） ---------------- */

export interface PlanOverviewStats {
  /** 场地边界面积（m²）。 */
  boundaryAreaM2: number;
  zoneCount: number;
  facilityCount: number;
  routeCount: number;
  /** 三类动线长度汇总（m）：隐藏图层不影响统计。 */
  routeLengthMByKind: { pedestrian: number; vehicle: number; service: number };
  routeLengthTotalM: number;
  nodeCount: number;
  /** 人员点位数（posts）与人数合计（count 求和）。 */
  workerPostCount: number;
  workerTotalCount: number;
  /** 固定测量标注数。 */
  measurementCount: number;
  /** 待处理问题数：现有四类问题清单（分区/设施/节点/人员）条数合计。 */
  issueCount: number;
  /** H3-b 冲突/缺失条数（人车交叉/共线/通行带压设施/越界/缺宽度/容量待核实）。 */
  conflictCount: number;
}

/** 全案派生统计：评审稿顶栏「场地面积、区域数、设施数、各类流线长度、待处理问题」的数据源。 */
export function planOverviewStats(plan: SitePlanData): PlanOverviewStats {
  const routeLengthMByKind = { pedestrian: 0, vehicle: 0, service: 0 };
  let routeLengthTotalM = 0;
  for (const route of plan.routes) {
    const length = planRouteLengthM(route.points);
    routeLengthMByKind[route.kind] += length;
    routeLengthTotalM += length;
  }
  const measurements = plan.measurements ?? [];
  const conflicts = planConflictIssues(plan);
  const issueCount = planZoneIssues(plan).length
    + planFacilityIssues(plan).length
    + planNodeIssues(plan).length
    + planWorkerIssues(plan).length;
  return {
    boundaryAreaM2: planRingAreaM2(plan.boundary),
    zoneCount: plan.zones.length,
    facilityCount: plan.facilities.length,
    routeCount: plan.routes.length,
    routeLengthMByKind,
    routeLengthTotalM,
    nodeCount: plan.nodes.length,
    workerPostCount: plan.workers.length,
    workerTotalCount: plan.workers.reduce((sum, w) => sum + w.count, 0),
    measurementCount: measurements.length,
    issueCount,
    conflictCount: conflicts.length,
  };
}
