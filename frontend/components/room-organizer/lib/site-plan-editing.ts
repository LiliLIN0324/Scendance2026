/**
 * SitePlan 编辑操作纯函数层（H2-b）——边界绘制与语义分区的校验、顶点编辑、问题检测。
 *
 * 口径（评审稿 §8 功能矩阵 / §9.1 步骤 3–4）：
 * - 边界：至少 3 顶点、相邻顶点不重合、**拒绝自交提交**、面积不得低于下限；
 *   顶点移动/插入/删除后仍需整环复验，不合法即拒绝并给原因。
 * - 分区：**自交/退化阻止提交；越界允许提交但出提示**（评审稿「阻止自交提交，
 *   允许编辑后显示越界问题」）；分区贴着边界内沿（共边/顶点落在边界上）不算越界，
 *   两个分区贴边相邻不算重叠。
 * - 几何全部在局部米制 ENU（x 东、y 北）上运算，与 site-plan 契约同一坐标口径；
 *   派生量（面积）直接复用契约的 planRingAreaM2，不在本层另立公式。
 */

import { planRingAreaM2, planZoneSemanticLabels, type PlanPoint, type PlanZone } from '../../../../supabase/functions/_shared/site-plan';
import { PLANNING_ZONE_COLORS, PLANNING_ZONE_OPACITY, type PlanningZoneSemantic } from '@/lib/outdoor-plan-tokens';

/** 场地边界最小面积（m²）：户外市集起步尺度，低于它视为误点（可调常量，验收锚 200×120=24,000 m²）。 */
export const PLAN_MIN_BOUNDARY_AREA_M2 = 100;
/** 单个功能分区最小面积（m²）：允许小而有效的签到/医疗点区域。 */
export const PLAN_MIN_ZONE_AREA_M2 = 1;
/** 顶点最小间距（m）：更近视为重复点击，忽略。与室内圈画 MIN_VERTEX_GAP_M 同值。 */
export const PLAN_MIN_VERTEX_GAP_M = 0.5;
/** 环顶点上限：与 site-plan 契约 planRingSchema 一致。 */
export const PLAN_RING_MAX_VERTICES = 64;
/** 越界/重叠提示列表的最大条数（面板展示截断，计算不截断）。 */
export const PLAN_ISSUE_LIST_LIMIT = 8;

const EPS = 1e-9;

/** 编辑问题：可定位（at 为问题点的 ENU 坐标，可选）。 */
export interface PlanEditIssue {
  code: 'too-few-vertices' | 'duplicate-vertex' | 'self-intersection' | 'area-below-min' | 'too-many-vertices' | 'out-of-boundary' | 'zones-overlap' | 'bad-index' | 'out-of-range' | 'unknown-template' | 'unknown-node' | 'unknown-zone' | 'unconnected-node'
    // 2026-11-11 用户指令：自由标注校验新增的四种问题码。
    | 'bad-vertex-count' | 'bad-radius' | 'too-small' | 'empty-text';
  message: string;
  at?: PlanPoint;
}

export type PlanEditResult<T> = { ok: true; value: T; issues?: PlanEditIssue[] } | { ok: false; issue: PlanEditIssue };

/* ---------------- 基础几何（PlanPoint，米制 ENU） ---------------- */

/** 两点距离（米）。 */
export function planPointDistanceM(a: PlanPoint, b: PlanPoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function planOrient(p: PlanPoint, q: PlanPoint, r: PlanPoint): number {
  const value = (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  return value > EPS ? 1 : value < -EPS ? -1 : 0;
}

function planOnSegment(p: PlanPoint, q: PlanPoint, r: PlanPoint): boolean {
  return (
    q.x >= Math.min(p.x, r.x) - EPS && q.x <= Math.max(p.x, r.x) + EPS
    && q.y >= Math.min(p.y, r.y) - EPS && q.y <= Math.max(p.y, r.y) + EPS
  );
}

/** 两线段是否相交（含共线重叠与端点触碰；用于「同一环内」的自交判定——环内任何非相邻接触都算退化）。 */
function planSegmentsTouch(a1: PlanPoint, a2: PlanPoint, b1: PlanPoint, b2: PlanPoint): boolean {
  const o1 = planOrient(a1, a2, b1);
  const o2 = planOrient(a1, a2, b2);
  const o3 = planOrient(b1, b2, a1);
  const o4 = planOrient(b1, b2, a2);
  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && planOnSegment(a1, b1, a2)) return true;
  if (o2 === 0 && planOnSegment(a1, b2, a2)) return true;
  if (o3 === 0 && planOnSegment(b1, a1, b2)) return true;
  if (o4 === 0 && planOnSegment(b1, a2, b2)) return true;
  return false;
}

/** 两线段是否严格穿越相交（共线重叠、共享端点、贴边触碰都不算；用于跨环的越界/重叠判定）。 */
export function planSegmentsCrossStrict(a1: PlanPoint, a2: PlanPoint, b1: PlanPoint, b2: PlanPoint): boolean {
  const o1 = planOrient(a1, a2, b1);
  const o2 = planOrient(a1, a2, b2);
  const o3 = planOrient(b1, b2, a1);
  const o4 = planOrient(b1, b2, a2);
  return o1 * o2 < 0 && o3 * o4 < 0;
}

/**
 * 闭合环是否自交：任两条非相邻边接触（含共线重叠）即为退化。
 * 相邻边共享端点豁免；首尾边同样相邻。
 */
export function planRingSelfIntersects(ring: readonly PlanPoint[]): boolean {
  const n = ring.length;
  if (n < 4) return false;
  for (let i = 0; i < n; i++) {
    const a1 = ring[i]!;
    const a2 = ring[(i + 1) % n]!;
    for (let j = i + 1; j < n; j++) {
      if ((j + 1) % n === i || j === (i + 1) % n) continue;
      const b1 = ring[j]!;
      const b2 = ring[(j + 1) % n]!;
      if (planSegmentsTouch(a1, a2, b1, b2)) return true;
    }
  }
  return false;
}

/** 点是否在闭合环内（边界上视为在内——分区贴边界内沿合法）。射线法 + 边界 epsilon。 */
export function planPointInRing(pt: PlanPoint, ring: readonly PlanPoint[]): boolean {
  let inside = false;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    // 边界命中：点落在该边上。
    if (planOrient(a, b, pt) === 0 && planOnSegment(a, pt, b)) return true;
    if ((a.y > pt.y) !== (b.y > pt.y)) {
      const xAtY = a.x + (pt.y - a.y) * (b.x - a.x) / (b.y - a.y);
      if (xAtY > pt.x + EPS) inside = !inside;
    }
  }
  return inside;
}

/** 点是否在闭合环的严格内部（边界上视为不在——分区共边相邻不算重叠）。 */
function planPointInRingInterior(pt: PlanPoint, ring: readonly PlanPoint[]): boolean {
  return planPointInRing(pt, ring) && !isOnRingEdge(pt, ring);
}

function isOnRingEdge(pt: PlanPoint, ring: readonly PlanPoint[]): boolean {
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    if (planOrient(a, b, pt) === 0 && planOnSegment(a, pt, b)) return true;
  }
  return false;
}

/** 两环是否有面积交集（严格判定：共边/顶点触碰不算重叠）。 */
export function planRingsOverlap(a: readonly PlanPoint[], b: readonly PlanPoint[]): boolean {
  for (const pt of a) if (planPointInRingInterior(pt, b)) return true;
  for (const pt of b) if (planPointInRingInterior(pt, a)) return true;
  for (let i = 0; i < a.length; i++) {
    const a1 = a[i]!;
    const a2 = a[(i + 1) % a.length]!;
    for (let j = 0; j < b.length; j++) {
      const b1 = b[j]!;
      const b2 = b[(j + 1) % b.length]!;
      if (planSegmentsCrossStrict(a1, a2, b1, b2)) return true;
    }
  }
  return false;
}

/** inner 环是否整体在 outer 环内的判定已内联进 zoneOutsideBoundaryIssue（需返回问题位置）。 */

/* ---------------- 边界校验与顶点编辑 ---------------- */

/** 边界/分区环的基础校验：顶点数、相邻重复、自交、面积下限。 */
export function checkPlanRing(
  ring: readonly PlanPoint[],
  minAreaM2: number,
  label: string,
): { ok: true; areaM2: number } | { ok: false; issue: PlanEditIssue } {
  if (ring.length < 3) {
    return { ok: false, issue: { code: 'too-few-vertices', message: `${label}至少要 3 个顶点，现在有 ${ring.length} 个。` } };
  }
  if (ring.length > PLAN_RING_MAX_VERTICES) {
    return { ok: false, issue: { code: 'too-many-vertices', message: `${label}顶点超过上限 ${PLAN_RING_MAX_VERTICES} 个。` } };
  }
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    if (planPointDistanceM(a, b) < PLAN_MIN_VERTEX_GAP_M) {
      return { ok: false, issue: { code: 'duplicate-vertex', message: `${label}存在重合顶点（位置 ${a.x.toFixed(1)}, ${a.y.toFixed(1)}）。`, at: a } };
    }
  }
  if (planRingSelfIntersects(ring)) {
    return { ok: false, issue: { code: 'self-intersection', message: `${label}自相交了（边和边交叉），请按顺序描一圈。` } };
  }
  const areaM2 = planRingAreaM2(ring);
  if (areaM2 < minAreaM2) {
    return { ok: false, issue: { code: 'area-below-min', message: `${label}面积太小（约 ${areaM2.toFixed(1)} m²），下限 ${minAreaM2} m²。` } };
  }
  return { ok: true, areaM2 };
}

/** 场地边界校验（面积下限 = PLAN_MIN_BOUNDARY_AREA_M2）。 */
export function checkBoundaryRing(ring: readonly PlanPoint[]): { ok: true; areaM2: number } | { ok: false; issue: PlanEditIssue } {
  return checkPlanRing(ring, PLAN_MIN_BOUNDARY_AREA_M2, '场地边界');
}

function revalidateRing(ring: readonly PlanPoint[], minAreaM2: number, label: string): PlanEditResult<PlanPoint[]> {
  const check = checkPlanRing(ring, minAreaM2, label);
  return check.ok ? { ok: true, value: [...ring] } : { ok: false, issue: check.issue };
}

/** 移动第 index 个顶点；移动后整环复验（重合/自交/面积），不合法即拒绝。 */
export function moveRingVertex(
  ring: readonly PlanPoint[],
  index: number,
  next: PlanPoint,
  opts: { minAreaM2?: number; label?: string } = {},
): PlanEditResult<PlanPoint[]> {
  const label = opts.label ?? '场地边界';
  const minAreaM2 = opts.minAreaM2 ?? PLAN_MIN_BOUNDARY_AREA_M2;
  if (!Number.isInteger(index) || index < 0 || index >= ring.length) {
    return { ok: false, issue: { code: 'bad-index', message: `${label}顶点序号越界（${index}）。` } };
  }
  if (!Number.isFinite(next.x) || !Number.isFinite(next.y)) {
    return { ok: false, issue: { code: 'duplicate-vertex', message: `${label}新顶点坐标无效。` } };
  }
  const moved = ring.map((p, i) => (i === index ? { x: next.x, y: next.y } : p));
  return revalidateRing(moved, minAreaM2, label);
}

/** 在第 edgeIndex 条边（v[edgeIndex] → v[edgeIndex+1]）上插入顶点。 */
export function insertRingVertex(
  ring: readonly PlanPoint[],
  edgeIndex: number,
  point: PlanPoint,
  opts: { minAreaM2?: number; label?: string } = {},
): PlanEditResult<PlanPoint[]> {
  const label = opts.label ?? '场地边界';
  const minAreaM2 = opts.minAreaM2 ?? PLAN_MIN_BOUNDARY_AREA_M2;
  if (!Number.isInteger(edgeIndex) || edgeIndex < 0 || edgeIndex >= ring.length) {
    return { ok: false, issue: { code: 'bad-index', message: `${label}边序号越界（${edgeIndex}）。` } };
  }
  if (ring.length >= PLAN_RING_MAX_VERTICES) {
    return { ok: false, issue: { code: 'too-many-vertices', message: `${label}顶点已达上限 ${PLAN_RING_MAX_VERTICES} 个。` } };
  }
  const inserted = [...ring.slice(0, edgeIndex + 1), { x: point.x, y: point.y }, ...ring.slice(edgeIndex + 1)];
  return revalidateRing(inserted, minAreaM2, label);
}

/** 删除第 index 个顶点；删除后仍须 ≥3 顶点且不自交、面积达标。 */
export function removeRingVertex(
  ring: readonly PlanPoint[],
  index: number,
  opts: { minAreaM2?: number; label?: string } = {},
): PlanEditResult<PlanPoint[]> {
  const label = opts.label ?? '场地边界';
  const minAreaM2 = opts.minAreaM2 ?? PLAN_MIN_BOUNDARY_AREA_M2;
  if (!Number.isInteger(index) || index < 0 || index >= ring.length) {
    return { ok: false, issue: { code: 'bad-index', message: `${label}顶点序号越界（${index}）。` } };
  }
  if (ring.length <= 3) {
    return { ok: false, issue: { code: 'too-few-vertices', message: `${label}至少保留 3 个顶点，不能再删。` } };
  }
  const removed = ring.filter((_, i) => i !== index);
  return revalidateRing(removed, minAreaM2, label);
}

/* ---------------- 语义分区 ---------------- */

/** 分区语义默认色（未显式指定 color 时使用）。 */
export function defaultZoneColor(semantic: PlanningZoneSemantic): string {
  return PLANNING_ZONE_COLORS[semantic];
}

/** 分区填充透明度：显式 opacity 优先，缺省取 tokens 默认值；夹在可编辑区间内。 */
export function planZoneFillAlpha(zone: { opacity?: number | undefined }): number {
  const raw = zone.opacity ?? PLANNING_ZONE_OPACITY.default;
  return Math.min(PLANNING_ZONE_OPACITY.max, Math.max(PLANNING_ZONE_OPACITY.min, raw));
}

/** 分区多边形相对场地边界的越界问题；贴边（顶点落在边界上/共边）不算越界。
    2026-11-11：边界未画（<3 点，新草稿零边界起步）时不判越界——没有基准就没有「出界」。 */
export function zoneOutsideBoundaryIssue(
  polygon: readonly PlanPoint[],
  boundary: readonly PlanPoint[],
): PlanEditIssue | null {
  if (boundary.length < 3) return null;
  for (const pt of polygon) {
    if (!planPointInRing(pt, boundary)) {
      return { code: 'out-of-boundary', message: '分区越界：有顶点落在场地边界之外。', at: pt };
    }
  }
  for (let i = 0; i < polygon.length; i++) {
    const p1 = polygon[i]!;
    const p2 = polygon[(i + 1) % polygon.length]!;
    for (let j = 0; j < boundary.length; j++) {
      const b1 = boundary[j]!;
      const b2 = boundary[(j + 1) % boundary.length]!;
      if (planSegmentsCrossStrict(p1, p2, b1, b2)) {
        return { code: 'out-of-boundary', message: '分区越界：边穿出了场地边界。', at: p2 };
      }
    }
  }
  return null;
}

/** 两个分区是否有面积交集（共边/触碰不算）。 */
export function planZonesOverlap(a: readonly PlanPoint[], b: readonly PlanPoint[]): boolean {
  return planRingsOverlap(a, b);
}

export interface PlanZoneIssue {
  zoneId: string;
  zoneName: string;
  issue: PlanEditIssue;
  /** 重叠问题标注对侧分区名。 */
  otherZoneName?: string;
}

/** 全案分区问题：越界（逐区）+ 重叠（逐对），顺序稳定（按分区原序/对序）。 */
export function planZoneIssues(
  plan: { boundary: readonly PlanPoint[]; zones: readonly { id: string; name: string; polygon: readonly PlanPoint[] }[] },
): PlanZoneIssue[] {
  const issues: PlanZoneIssue[] = [];
  for (const zone of plan.zones) {
    if (zone.polygon.length < 3) continue;
    const outside = zoneOutsideBoundaryIssue(zone.polygon, plan.boundary);
    if (outside) issues.push({ zoneId: zone.id, zoneName: zone.name, issue: outside });
  }
  for (let i = 0; i < plan.zones.length; i++) {
    for (let j = i + 1; j < plan.zones.length; j++) {
      const a = plan.zones[i]!;
      const b = plan.zones[j]!;
      if (a.polygon.length < 3 || b.polygon.length < 3) continue;
      if (planZonesOverlap(a.polygon, b.polygon)) {
        issues.push({ zoneId: a.id, zoneName: a.name, issue: { code: 'zones-overlap', message: `与「${b.name}」面积重叠。` }, otherZoneName: b.name });
      }
    }
  }
  return issues;
}

export interface BuildZoneInput {
  semantic: PlanningZoneSemantic;
  name: string;
  polygon: readonly PlanPoint[];
  color?: string;
  opacity?: number;
  notes?: string;
  id?: string;
}

/**
 * 建立一个语义分区并提交进全案：自交/退化（<3 点、重合顶点、面积 < 1 m²）阻止提交；
 * 越界允许提交但随结果返回提示（评审稿口径「阻止自交提交，允许编辑后显示越界问题」）。
 */
export function buildZone(
  input: BuildZoneInput,
  boundary: readonly PlanPoint[],
  existingZones: readonly { id: string; name: string; polygon: readonly PlanPoint[] }[] = [],
): PlanEditResult<PlanZone> {
  const label = `分区「${input.name}」`;
  const check = checkPlanRing(input.polygon, PLAN_MIN_ZONE_AREA_M2, label);
  if (!check.ok) return { ok: false, issue: check.issue };
  const issues: PlanEditIssue[] = [];
  const outside = zoneOutsideBoundaryIssue(input.polygon, boundary);
  if (outside) issues.push(outside);
  for (const other of existingZones) {
    if (other.polygon.length < 3) continue;
    if (planZonesOverlap(input.polygon, other.polygon)) {
      issues.push({ code: 'zones-overlap', message: `与已有分区「${other.name}」面积重叠。` });
    }
  }
  const zone: PlanZone = {
    id: input.id ?? crypto.randomUUID(),
    semantic: input.semantic,
    name: input.name,
    polygon: input.polygon.map(p => ({ x: p.x, y: p.y })),
    color: input.color ?? defaultZoneColor(input.semantic),
    ...(input.opacity !== undefined ? { opacity: input.opacity } : {}),
    notes: input.notes ?? '',
  };
  return { ok: true, value: zone, issues };
}

/** 分区语义与文案一致性守卫：tokens 的语义集必须与契约九类完全对齐（防两处漂移）。 */
export function zoneSemanticsAlignedWithContract(contractSemantics: readonly string[]): boolean {
  const tokenSemantics = Object.keys(PLANNING_ZONE_COLORS);
  if (tokenSemantics.length !== contractSemantics.length) return false;
  for (const semantic of contractSemantics) {
    if (!tokenSemantics.includes(semantic)) return false;
    if (!(semantic in planZoneSemanticLabels)) return false;
  }
  return true;
}
