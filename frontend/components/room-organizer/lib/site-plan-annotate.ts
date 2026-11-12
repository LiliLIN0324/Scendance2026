/**
 * 2026-11-11 用户指令：自由标注纯函数层（OnePlan 工具栏 T + 形状同款）。
 *
 * 口径（与测量 H3-a 同构，本层不碰画布/DOM）：
 * - 五类：文本（note）+ 四种形状（矩形 rect / 圆形 circle / 三角形 triangle / 线段 line）；
 * - 交互：矩形=拖对角（Shift 正方形）、圆形=中心拖半径、三角形=单击 3 点、
 *   线段=拖拽或两点、文本=点一下放置就地输入（Enter 提交 / Esc 取消）；
 * - 标注是标注不是实体：不参与冲突判定与派生统计，图形一律从米制 ENU 现算；
 * - 点位口径（与契约 planAnnotationSchema 一致）：note/circle 恰好 1 点（锚点/圆心，
 *   circle 另带 radiusM）、rect/line 恰好 2 点（对角/两端）、triangle 恰好 3 点。
 */

import {
  planAnnotationKindLabels,
  type PlanAnnotation,
  type PlanPoint,
} from '../../../../supabase/functions/_shared/site-plan';
import {
  planPointDistanceM,
  planPointInRing,
  type PlanEditIssue,
  type PlanEditResult,
} from './site-plan-editing';

export type PlanAnnotationKind = PlanAnnotation['kind'];
/** 形状四类（note 是文本，不走形状草稿）。 */
export type PlanShapeKind = Exclude<PlanAnnotationKind, 'note'>;
export const PLAN_SHAPE_KINDS: readonly PlanShapeKind[] = ['rect', 'circle', 'triangle', 'line'];
/** 形状描边档位：thin 细线 / thick 粗线；旧数据缺省按细线。 */
export type PlanAnnotationStrokeWidth = NonNullable<PlanAnnotation['strokeWidth']>;
export const PLAN_ANNOTATION_STROKE_WIDTHS: readonly PlanAnnotationStrokeWidth[] = ['thin', 'thick'];

/** 形状草稿收齐所需点数：rect/circle/line 2 点、triangle 3 点（与契约口径同源）。 */
export function planShapeDraftTarget(kind: PlanShapeKind): number {
  return kind === 'triangle' ? 3 : 2;
}

/** 契约平面点范围（±5000 m），与 site-plan planPointSchema 同源。 */
const PLAN_COORD_LIMIT_M = 5000;
/** 形状最小尺寸（米）：与测量同口径，防止拖出退化图形。 */
export const PLAN_ANNOTATION_MIN_SIZE_M = 0.5;

function pointInRange(pt: PlanPoint): boolean {
  return Number.isFinite(pt.x) && Number.isFinite(pt.y)
    && Math.abs(pt.x) <= PLAN_COORD_LIMIT_M && Math.abs(pt.y) <= PLAN_COORD_LIMIT_M;
}

/** 矩形对角两点 → ENU 轴对齐四点环（渲染/命中共用）；square=true 时张成正方形。 */
export function annotationRectRing(a: PlanPoint, b: PlanPoint, square = false): PlanPoint[] {
  let dx = b.x - a.x;
  let dy = b.y - a.y;
  if (square) {
    const side = Math.max(Math.abs(dx), Math.abs(dy));
    dx = (dx >= 0 ? 1 : -1) * side;
    dy = (dy >= 0 ? 1 : -1) * side;
  }
  const x0 = Math.min(a.x, a.x + dx);
  const x1 = Math.max(a.x, a.x + dx);
  const y0 = Math.min(a.y, a.y + dy);
  const y1 = Math.max(a.y, a.y + dy);
  return [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
}

/** 标注几何校验：点位数随类型、相邻不重合、范围内、圆形带正半径、文本非空。 */
function annotationGeometryIssues(input: {
  kind: PlanAnnotationKind;
  points: readonly PlanPoint[];
  radiusM?: number;
  text?: string;
}): PlanEditIssue[] {
  const issues: PlanEditIssue[] = [];
  const need: Record<PlanAnnotationKind, number> = { note: 1, circle: 1, rect: 2, line: 2, triangle: 3 };
  if (input.points.length !== need[input.kind]) {
    issues.push({ code: 'bad-vertex-count', message: `${planAnnotationKindLabels[input.kind]}标注需要 ${need[input.kind]} 个点（当前 ${input.points.length} 个）。` });
    return issues;
  }
  if (input.kind === 'circle' && !(input.radiusM !== undefined && Number.isFinite(input.radiusM) && input.radiusM > 0)) {
    issues.push({ code: 'bad-radius', message: '圆形标注需要一个大于 0 的半径。' });
  }
  if (input.kind === 'circle' && input.radiusM !== undefined && input.radiusM < PLAN_ANNOTATION_MIN_SIZE_M) {
    issues.push({ code: 'too-small', message: `圆形太小（半径 <${PLAN_ANNOTATION_MIN_SIZE_M} m），按住拖大一点再松手。` });
  }
  if ((input.kind === 'rect' || input.kind === 'line') && input.points.length === 2) {
    const [a, b] = input.points;
    if (planPointDistanceM(a!, b!) < PLAN_ANNOTATION_MIN_SIZE_M) {
      issues.push({ code: 'too-small', message: `拖出的${planAnnotationKindLabels[input.kind]}太小（<${PLAN_ANNOTATION_MIN_SIZE_M} m），按住拖长一点再松手。` });
    }
    if (input.kind === 'rect') {
      const w = Math.abs(a!.x - b!.x);
      const h = Math.abs(a!.y - b!.y);
      if (w < PLAN_ANNOTATION_MIN_SIZE_M || h < PLAN_ANNOTATION_MIN_SIZE_M) {
        issues.push({ code: 'too-small', message: `拖出的矩形太小（宽和高都要 ≥${PLAN_ANNOTATION_MIN_SIZE_M} m）。` });
      }
    }
  }
  if (input.kind === 'note' && (input.text ?? '').trim().length === 0) {
    issues.push({ code: 'empty-text', message: '文本标注内容不能为空。' });
  }
  for (let i = 1; i < input.points.length; i++) {
    if (planPointDistanceM(input.points[i - 1]!, input.points[i]!) === 0) {
      issues.push({ code: 'duplicate-vertex', message: `标注第 ${i}、${i + 1} 点重合，先移动开再提交。`, at: input.points[i] });
      break;
    }
  }
  for (const pt of input.points) {
    if (!pointInRange(pt)) {
      issues.push({ code: 'out-of-range', message: '标注点位超出场地坐标系 ±5000 m 范围。', at: pt });
      break;
    }
  }
  return issues;
}

export interface BuildAnnotationInput {
  kind: PlanAnnotationKind;
  name: string;
  points: readonly PlanPoint[];
  radiusM?: number;
  text?: string;
  color?: string;
  strokeWidth?: PlanAnnotationStrokeWidth;
  notes?: string;
  id?: string;
}

/** 建立一条自由标注：几何按五类口径全部合法才提交；渲染/读数一律现算不落盘。 */
export function buildAnnotation(input: BuildAnnotationInput): PlanEditResult<PlanAnnotation> {
  const issues = annotationGeometryIssues(input);
  if (issues.length > 0) return { ok: false, issue: issues[0]! };
  const annotation: PlanAnnotation = {
    id: input.id ?? crypto.randomUUID(),
    kind: input.kind,
    name: input.name,
    points: input.points.map(p => ({ x: p.x, y: p.y })),
    text: input.text ?? '',
    notes: input.notes ?? '',
    ...(input.kind === 'circle' ? { radiusM: input.radiusM } : {}),
    ...(input.color ? { color: input.color } : {}),
    ...(input.strokeWidth ? { strokeWidth: input.strokeWidth } : {}),
  };
  return { ok: true, value: annotation };
}

/* ---------------- 命中测试（米制 ENU；组件把像素容差换算成米） ---------------- */

/** 点到线段的最短距离（米）。 */
function pointToSegmentM(p: PlanPoint, a: PlanPoint, b: PlanPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return planPointDistanceM(p, a);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return planPointDistanceM(p, { x: a.x + t * dx, y: a.y + t * dy });
}

/**
 * 点到标注图形的最短距离（米）：note=到锚点；line=到线段；circle=到圆周（内部为 0）；
 * rect/triangle=内部为 0，否则到最近边。供画布命中测试（容差由像素换算）。
 */
export function annotationDistanceM(pt: PlanPoint, annotation: Pick<PlanAnnotation, 'kind' | 'points' | 'radiusM'>): number {
  const pts = annotation.points;
  if (annotation.kind === 'note') return planPointDistanceM(pt, pts[0]!);
  if (annotation.kind === 'circle') {
    const d = planPointDistanceM(pt, pts[0]!);
    const r = annotation.radiusM ?? 0;
    return d <= r ? 0 : d - r;
  }
  if (annotation.kind === 'line') return pointToSegmentM(pt, pts[0]!, pts[1]!);
  const ring = annotation.kind === 'rect' ? annotationRectRing(pts[0]!, pts[1]!) : pts;
  if (planPointInRing(pt, ring)) return 0;
  let best = Infinity;
  for (let i = 0; i < ring.length; i++) {
    best = Math.min(best, pointToSegmentM(pt, ring[i]!, ring[(i + 1) % ring.length]!));
  }
  return best;
}
