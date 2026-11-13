/**
 * 设施模板与放置纯函数层（H2-c）——模板目录、占地几何、放置校验、命名与问题清单。
 *
 * 口径（评审稿 §8 基础设施规划 / §9.1 步骤 5「设施模板拖放」）：
 * - 模板只提供默认宽深与名称；放置生成的实例独立落库（契约 planFacilitySchema），
 *   改名/改尺寸不影响模板默认值；
 * - 占地 = 以 position 为中心、宽深按 rotationDeg 旋转的矩形（米制 ENU）。
 *   旋转矩阵与 outdoor-plan-canvas 的设施渲染一致：rotationDeg 以东为零、逆时针为正
 *   （+90° 时宽边从东转向北；屏幕系 y 向下，渲染时取负角，两者等价，见 drawFacilityLayer）；
 * - 越界允许放置但随结果返回提示（与分区同策略「放行 + 提示」）；
 *   位置超出契约 ±5000 m 或模板不存在时拒绝；
 * - 放置即选中、删除、改名由画布组件接线，本层提供 contains 判定与全案问题清单。
 */

import {
  planFacilitySchema,
  planRingAreaM2,
  type PlanFacility,
  type PlanPoint,
} from '../../../../supabase/functions/_shared/site-plan';
import { planMetersPerPixel, planPointToPixel, type PlanViewport } from './outdoor-plan-canvas';
import {
  planPointInRing,
  planRingSelfIntersects,
  planSegmentsCrossStrict,
  type PlanEditIssue,
  type PlanEditResult,
} from './site-plan-editing';

/** 设施模板：面板目录项（templateId 对应契约 planFacilitySchema.templateId）。 */
export interface PlanFacilityTemplate {
  templateId: string;
  name: string;
  /** 未旋转时占地宽度（东西向，米）。 */
  width: number;
  /** 未旋转时占地深度（南北向，米）。 */
  depth: number;
  /** 用途说明（面板 title 提示）。 */
  note: string;
  /** 2026-11-12 活动包模板：放置时落到 facility.color 的物件主题色（可选）。 */
  color?: string;
}

/**
 * 设施模板目录（H2-c）：户外市集/活动常用八类，尺寸取实操尺度，
 * 全部落在契约 size 上限 100 m 内；templateId 与 H2-a 样例的 booth-2x2/tent-3x3 对齐。
 */
export const PLAN_FACILITY_TEMPLATES: readonly PlanFacilityTemplate[] = [
  { templateId: 'booth-2x2', name: '市集摊位', width: 2, depth: 2, note: '标准市集摊位' },
  { templateId: 'tent-3x3', name: '后勤帐篷', width: 3, depth: 3, note: '物料 / 休息' },
  { templateId: 'food-truck-6x2.5', name: '餐车', width: 6, depth: 2.5, note: '餐饮售卖' },
  { templateId: 'stage-platform-8x6', name: '舞台台面', width: 8, depth: 6, note: '演出舞台' },
  { templateId: 'toilet-2.4x1.2', name: '移动洗手间', width: 2.4, depth: 1.2, note: '单体厕位' },
  { templateId: 'medical-tent-4x3', name: '医疗帐篷', width: 4, depth: 3, note: '急救点' },
  { templateId: 'security-post-1.5x1.5', name: '安保岗亭', width: 1.5, depth: 1.5, note: '固定岗' },
  { templateId: 'trash-point-1.2x1.2', name: '垃圾收集点', width: 1.2, depth: 1.2, note: '分类回收' },
];

/** 按 templateId 查模板；不存在返回 null。 */
export function findFacilityTemplate(templateId: string): PlanFacilityTemplate | null {
  return PLAN_FACILITY_TEMPLATES.find(t => t.templateId === templateId) ?? null;
}

/** 契约平面点范围（±5000 m），与 site-plan planPointSchema 同源。 */
const PLAN_COORD_LIMIT_M = 5000;

/**
 * 设施占地四角环（局部米制 ENU）：无自交的闭合矩形。
 * 旋转矩阵与画布渲染一致（见文件头说明）。
 */
export function facilityFootprintRing(facility: {
  position: PlanPoint;
  rotationDeg: number;
  size: { width: number; depth: number };
}): PlanPoint[] {
  const theta = (facility.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const hw = facility.size.width / 2;
  const hd = facility.size.depth / 2;
  // 局部角点（宽向 u、深向 v）：SW → SE → NE → NW。
  const local: readonly [number, number][] = [
    [-hw, -hd],
    [hw, -hd],
    [hw, hd],
    [-hw, hd],
  ];
  return local.map(([lx, ly]) => ({
    x: facility.position.x + lx * cos - ly * sin,
    y: facility.position.y + lx * sin + ly * cos,
  }));
}

/** 世界点 → 设施局部坐标（u 沿宽、v 沿深，米）：占地判定的逆旋转变换。 */
export function facilityLocalPoint(
  pt: PlanPoint,
  facility: { position: PlanPoint; rotationDeg: number },
): { u: number; v: number } {
  const theta = (facility.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const dx = pt.x - facility.position.x;
  const dy = pt.y - facility.position.y;
  // 顺向矩阵的转置（正交旋转的逆）。
  return { u: dx * cos + dy * sin, v: -dx * sin + dy * cos };
}

/** 点是否落在设施占地内（含边界，命中容差 1e-9）；选中点选命中用。 */
export function facilityContainsPoint(
  pt: PlanPoint,
  facility: { position: PlanPoint; rotationDeg: number; size: { width: number; depth: number } },
): boolean {
  const { u, v } = facilityLocalPoint(pt, facility);
  const eps = 1e-9;
  return Math.abs(u) <= facility.size.width / 2 + eps && Math.abs(v) <= facility.size.depth / 2 + eps;
}

/** 占地盒几何入参（结构与 PlanFacility 的占地字段一致）。 */
export interface FacilityFootprintBox {
  position: PlanPoint;
  rotationDeg: number;
  size: { width: number; depth: number };
}

/** 旋转矩形的局部边方向单位向量（u 沿宽、v 沿深）。 */
function footprintAxes(rotationDeg: number): readonly PlanPoint[] {
  const theta = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  return [
    { x: cos, y: sin },
    { x: -sin, y: cos },
  ];
}

/** 占地盒在给定单位轴上的投影区间；marginM 沿局部 u/v 各外扩该米数。 */
function projectFootprint(box: FacilityFootprintBox, marginM: number, axis: PlanPoint): { min: number; max: number } {
  const hw = box.size.width / 2 + marginM;
  const hd = box.size.depth / 2 + marginM;
  const [u, v] = footprintAxes(box.rotationDeg);
  let min = Infinity;
  let max = -Infinity;
  for (const [lu, lv] of [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]] as const) {
    const wx = box.position.x + lu * u.x + lv * v.x;
    const wy = box.position.y + lu * u.y + lv * v.y;
    const d = wx * axis.x + wy * axis.y;
    if (d < min) min = d;
    if (d > max) max = d;
  }
  return { min, max };
}

/**
 * 两个设施占地矩形是否相交（SAT 分离轴定理，覆盖任意旋转的凸矩形）。
 * 替代旧的「角点/中心 probe 落入对方」点-矩形近似，避免十字重叠漏判、贴边误判。
 * marginM > 0 时把盒 a 沿自身宽/深方向各外扩该米数，作为所需安全间距；0 为纯占地相交。
 */
export function facilitiesFootprintsIntersect(a: FacilityFootprintBox, b: FacilityFootprintBox, marginM = 0): boolean {
  const ma = Math.max(0, marginM);
  const eps = 1e-9;
  const axes = [...footprintAxes(a.rotationDeg), ...footprintAxes(b.rotationDeg)];
  for (const axis of axes) {
    const pa = projectFootprint(a, ma, axis);
    const pb = projectFootprint(b, 0, axis);
    // 任一分离轴上投影不重叠即不相交；eps 与 facilityContainsPoint 同口径（含边界）。
    if (pa.max < pb.min - eps || pb.max < pa.min - eps) return false;
  }
  return true;
}

/** 设施占地相对场地边界的问题清单；边界点/贴边不算越界（与分区同口径）。 */
export function facilityPlacementIssues(
  footprint: readonly PlanPoint[],
  boundary: readonly PlanPoint[],
): PlanEditIssue[] {
  const issues: PlanEditIssue[] = [];
  // 2026-11-11 零边界起步：边界未画（<3 点）时不判设施越界——没有基准就没有「出界」。
  if (boundary.length < 3) return issues;
  for (const pt of footprint) {
    if (!planPointInRing(pt, boundary)) {
      issues.push({ code: 'out-of-boundary', message: '设施越界：占地有角点落在场地边界之外。', at: pt });
      return issues;
    }
  }
  // 角点全在界内但边界边穿入占地（非凸边界/尖角）的兜底判定。
  for (let i = 0; i < footprint.length; i++) {
    const f1 = footprint[i]!;
    const f2 = footprint[(i + 1) % footprint.length]!;
    for (let j = 0; j < boundary.length; j++) {
      const b1 = boundary[j]!;
      const b2 = boundary[(j + 1) % boundary.length]!;
      if (planSegmentsCrossStrict(f1, f2, b1, b2)) {
        issues.push({ code: 'out-of-boundary', message: '设施越界：场地边界穿过了设施占地。', at: f2 });
        return issues;
      }
    }
  }
  return issues;
}

/** 同模板实例的自动命名：市集摊位 1、市集摊位 2……（只数同 templateId）。 */
export function nextFacilityName(
  template: Pick<PlanFacilityTemplate, 'name' | 'templateId'>,
  existing: readonly { templateId: string }[],
): string {
  const count = existing.filter(f => f.templateId === template.templateId).length;
  return `${template.name} ${count + 1}`;
}

export interface BuildFacilityInput {
  templateId: string;
  position: PlanPoint;
  rotationDeg?: number;
  /** 缺省按模板名 + 序号自动命名。 */
  name?: string;
  zoneId?: string;
  color?: string;
  notes?: string;
  id?: string;
  /**
   * P2-h：物件库来的「动态模板」——清单里 549 件贴纸不是 8 个内置模板之一，
   * 尺寸/名称由库条目给定。不传仍走 `findFacilityTemplate`（语义不变）。
   */
  template?: PlanFacilityTemplate;
}

/**
 * 放置一个设施实例：模板缺失 / 位置超 ±5000 m 拒绝；越界允许提交并返回提示
 * （与 buildZone 同策略「放行 + 提示」，面积/尺寸合法性由模板目录与契约保证）。
 */
export function buildFacility(
  input: BuildFacilityInput,
  boundary: readonly PlanPoint[],
  existing: readonly { templateId: string }[] = [],
): PlanEditResult<PlanFacility> {
  const template = input.template ?? findFacilityTemplate(input.templateId);
  if (!template) {
    return { ok: false, issue: { code: 'unknown-template', message: `设施模板「${input.templateId}」不存在。` } };
  }
  if (!Number.isFinite(input.position.x) || !Number.isFinite(input.position.y)
    || Math.abs(input.position.x) > PLAN_COORD_LIMIT_M || Math.abs(input.position.y) > PLAN_COORD_LIMIT_M) {
    return { ok: false, issue: { code: 'out-of-range', message: '设施位置超出平面范围（±5000 m），请先放大地图再放置。' } };
  }
  const rawRotation = input.rotationDeg ?? 0;
  if (!Number.isFinite(rawRotation)) {
    return { ok: false, issue: { code: 'out-of-range', message: '设施旋转角度无效。' } };
  }
  const rotationDeg = Math.max(-360, Math.min(360, rawRotation));
  const size = { width: template.width, depth: template.depth };
  const footprint = facilityFootprintRing({ position: input.position, rotationDeg, size });
  const issues = facilityPlacementIssues(footprint, boundary);
  const facility: PlanFacility = {
    id: input.id ?? crypto.randomUUID(),
    templateId: template.templateId,
    name: input.name ?? nextFacilityName(template, existing),
    position: { x: input.position.x, y: input.position.y },
    rotationDeg,
    size,
    ...(input.zoneId !== undefined ? { zoneId: input.zoneId } : {}),
    // 显式入参优先；活动包模板自带主题色作为缺省（用户在 Bench 里仍可改）。
    ...(input.color !== undefined ? { color: input.color } : template.color !== undefined ? { color: template.color } : {}),
    notes: input.notes ?? '',
  };
  return { ok: true, value: facility, issues };
}

/** 全案设施问题：越界（占地角点/边超出边界），顺序稳定（按设施原序）。 */
export interface PlanFacilityIssue {
  facilityId: string;
  facilityName: string;
  issue: PlanEditIssue;
}

export function planFacilityIssues(plan: {
  boundary: readonly PlanPoint[];
  facilities: readonly { id: string; name: string; position: PlanPoint; rotationDeg: number; size: { width: number; depth: number } }[];
}): PlanFacilityIssue[] {
  const issues: PlanFacilityIssue[] = [];
  for (const facility of plan.facilities) {
    const footprint = facilityFootprintRing(facility);
    const found = facilityPlacementIssues(footprint, plan.boundary);
    if (found.length > 0) {
      issues.push({ facilityId: facility.id, facilityName: facility.name, issue: found[0]! });
    }
  }
  return issues;
}

/* ---------------- 测试与调用方共用的守卫 ---------------- */

/** 模板目录守卫：尺寸在契约范围内、宽深为正、id/name 合法（目录收敛时防漂移）。 */
export function facilityTemplatesValid(
  templates: readonly PlanFacilityTemplate[] = PLAN_FACILITY_TEMPLATES,
): boolean {
  const ids = new Set<string>();
  for (const t of templates) {
    if (!/^[a-z0-9][a-z0-9.-]*$/.test(t.templateId) || t.templateId.length > 64) return false;
    if (ids.has(t.templateId)) return false;
    ids.add(t.templateId);
    if (!(t.width > 0 && t.width <= 100) || !(t.depth > 0 && t.depth <= 100)) return false;
    if (t.name.length < 1 || t.name.length > 60) return false;
  }
  return templates.length > 0;
}

/** 放置结果应能原样通过契约校验（含 notes 默认值与 UUID 形态）。 */
export function facilityPassesContract(facility: PlanFacility): boolean {
  return planFacilitySchema.safeParse(facility).success;
}

/* ---------------- P2-i：画布编辑手柄（纯函数，画布与测试共用） ---------------- */

/** 选中设施的手柄视觉半径（CSS px）：四角方柄边长、旋转圆柄直径同值。 */
export const FACILITY_HANDLE_PX = 8;
/** 手柄命中半径（CSS px）比视觉大一圈，方便鼠标抓取。 */
export const FACILITY_HANDLE_HIT_PX = 12;
/** 旋转柄离占地顶边的距离（CSS px，屏幕上恒定）：设施缩小时不会被压进本体。 */
export const FACILITY_ROTATE_GAP_PX = 26;
/**
 * 手柄盒的最小屏幕尺寸（CSS px）：占地比这还小时手柄画在「虚拟外扩盒」上（OnePlan/画布工具
 * 通用做法）——z19 上限下 2 m 级物件只有 ~7px，没有虚拟盒的话小物件永远够不到缩放/旋转柄。
 * 拖拽数学不变：虚拟柄位置换算回本地坐标后照常走单面/角点拉伸。
 */
export const FACILITY_HANDLE_MIN_FOOTPRINT_PX = 20;

/** 屏幕像素坐标（CSS px）。 */
export type PlanPixelPoint = { x: number; y: number };

export type FacilityHandles = {
  /** 占地四角（CSS px，顺序同 facilityFootprintRing：SW→SE→NE→NW）。 */
  corners: PlanPixelPoint[];
  /** 四边中点（CSS px，序：0=南 1=东 2=北 3=西）——单边拉伸柄（2026-11-11「多个面」编辑）。 */
  sides: PlanPixelPoint[];
  /** 顶边（北侧边）中点：旋转柄连线的起点（CSS px）。 */
  topMid: PlanPixelPoint;
  /** 旋转柄圆心（顶边中点沿北向法线外推 FACILITY_ROTATE_GAP_PX，CSS px）。 */
  rotate: PlanPixelPoint;
};

/** 边序（与 handles.sides 一致）：0=南 1=东 2=北 3=西。 */
export type FacilitySideIndex = 0 | 1 | 2 | 3;

/**
 * 设施在屏幕上是否大到直接挂「真实」手柄（不够大时 facilityHandles 走虚拟外扩盒）。
 */
export function facilityHandlesUsable(
  facility: { size: { width: number; depth: number } },
  viewport: PlanViewport,
): boolean {
  const mpp = planMetersPerPixel(viewport);
  if (!Number.isFinite(mpp) || mpp <= 0) return false;
  return Math.max(facility.size.width, facility.size.depth) / mpp >= FACILITY_HANDLE_MIN_FOOTPRINT_PX;
}

/**
 * 选中设施的编辑手柄坐标（CSS px）：四角=改尺寸，四边中点=单面拉伸（2026-11-11「多个面」），北侧外推=旋转。
 *
 * `minFootprintPx`：占地最大边在屏幕上小于该值时，手柄画在「虚拟外扩盒」上——把宽深等比放大到
 * 盒子达到 minFootprintPx（OnePlan/画布工具对小物件的标准做法；z19 上限下 2 m 物件只有 ~7px，
 * 没有虚拟盒就永远够不到手柄）。虚拟柄的命中坐标换算回本地坐标后照常走拉伸/旋转数学。
 *
 * 方向口径：旋转柄必须和 topMid（NE/NW 中点，即北侧边）落在同一侧，
 * 否则连线会横穿本体、鼠标永远抓不到（P2-i 实测 bug 的根因）。
 * 北向单位向量在 plan 系里是 (0, +1)，按占地同一套旋转矩阵得到 (-sinθ, +cosθ)。
 */
export function facilityHandles(
  facility: { position: PlanPoint; rotationDeg: number; size: { width: number; depth: number } },
  viewport: PlanViewport,
  minFootprintPx = 0,
): FacilityHandles {
  const mpp = planMetersPerPixel(viewport);
  let ring = facilityFootprintRing(facility);
  let rotateGapFacility = facility;
  if (minFootprintPx > 0 && Number.isFinite(mpp) && mpp > 0) {
    const maxSidePx = Math.max(facility.size.width, facility.size.depth) / mpp;
    if (maxSidePx < minFootprintPx) {
      const scale = minFootprintPx / Math.max(1e-6, maxSidePx);
      rotateGapFacility = {
        ...facility,
        size: { width: facility.size.width * scale, depth: facility.size.depth * scale },
      };
      ring = facilityFootprintRing(rotateGapFacility);
    }
  }
  const theta = (facility.rotationDeg * Math.PI) / 180;
  // 旋转柄间距用屏幕像素折算成米：放大时柄跟着走远，缩小时也不至于落到本体上。
  const gap = rotateGapFacility.size.depth / 2 + FACILITY_ROTATE_GAP_PX * planMetersPerPixel(viewport);
  const rotatePt = {
    x: facility.position.x - gap * Math.sin(theta),
    y: facility.position.y + gap * Math.cos(theta),
  };
  const corners = ring.map(pt => planPointToPixel(pt, viewport));
  const sides = corners.map((pt, i) => {
    const next = corners[(i + 1) % corners.length]!;
    return { x: (pt.x + next.x) / 2, y: (pt.y + next.y) / 2 };
  });
  return {
    corners,
    sides,
    topMid: { x: (corners[2]!.x + corners[3]!.x) / 2, y: (corners[2]!.y + corners[3]!.y) / 2 },
    rotate: planPointToPixel(rotatePt, viewport),
  };
}

export type FacilityHandleHit =
  | { kind: 'rotate'; corner: null; side: null }
  | { kind: 'resize'; corner: number; side: null }
  | { kind: 'side'; corner: null; side: FacilitySideIndex };

/**
 * 命中判定：旋转柄 → 四边中点单面拉伸柄（2026-11-11「多个面」编辑）→ 四角改尺寸柄。
 * 小物件走虚拟外扩盒（minFootprintPx），命中的就是虚拟柄坐标。
 * 与画布 mousedown 的接管顺序保持一致（旋转 > 单边 > 角 > 拖本体）。
 */
export function facilityHandleAt(
  facility: { position: PlanPoint; rotationDeg: number; size: { width: number; depth: number } },
  viewport: PlanViewport,
  px: PlanPixelPoint,
  minFootprintPx = 0,
): FacilityHandleHit | null {
  const handles = facilityHandles(facility, viewport, minFootprintPx);
  if (Math.hypot(px.x - handles.rotate.x, px.y - handles.rotate.y) <= FACILITY_HANDLE_HIT_PX) {
    return { kind: 'rotate', corner: null, side: null };
  }
  for (let i = 0; i < handles.sides.length; i += 1) {
    const side = handles.sides[i]!;
    if (Math.hypot(px.x - side.x, px.y - side.y) <= FACILITY_HANDLE_HIT_PX) {
      return { kind: 'side', corner: null, side: i as FacilitySideIndex };
    }
  }
  for (let i = 0; i < handles.corners.length; i += 1) {
    const corner = handles.corners[i]!;
    if (Math.hypot(px.x - corner.x, px.y - corner.y) <= FACILITY_HANDLE_HIT_PX) {
      return { kind: 'resize', corner: i, side: null };
    }
  }
  return null;
}

/** 等比缩放系数统一夹取：保证两条边乘 k 后都落在 [minM, maxM]，且严格保持宽高比。 */
function clampUniformScale(width: number, depth: number, k0: number, bounds: { minM: number; maxM: number }): number {
  // 非法系数（异常指针产生的 NaN/Infinity）退回不缩放；负系数由 kMin 顶回正的最小缩放，杜绝翻转。
  const kRequested = Number.isFinite(k0) ? k0 : 1;
  const kMin = Math.max(bounds.minM / width, bounds.minM / depth);
  const kMax = Math.min(bounds.maxM / width, bounds.maxM / depth);
  return Math.max(kMin, Math.min(kMax, kRequested));
}

/**
 * 单边等比拉伸（#51 方案甲，锁宽高比）：拖动序号为 side 的面，对面固定，
 * 先由指针在该面法向轴上的期望尺寸求出缩放系数，再同一系数作用于两条边，
 * 中心只沿法向轴平移（对面中点不动）。边序：0=南 1=东 2=北 3=西（与 handles.sides 一致）。
 */
export function facilitySideResize(
  anchor: { position: PlanPoint; rotationDeg: number; size: { width: number; depth: number } },
  side: FacilitySideIndex,
  pointer: PlanPoint,
  bounds: { minM: number; maxM: number },
): { position: PlanPoint; size: { width: number; depth: number } } {
  const local = facilityLocalPoint(pointer, anchor);
  const theta = (anchor.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const halfW = anchor.size.width / 2;
  const halfD = anchor.size.depth / 2;
  // 指针在被拖面法向轴上的期望尺寸 → 统一缩放系数（两条边同乘，锁宽高比）。
  let k0 = 1;
  if (side === 0) k0 = (halfD - local.v) / anchor.size.depth; // 北面固定在 +halfD
  else if (side === 1) k0 = (local.u + halfW) / anchor.size.width; // 西面固定在 -halfW
  else if (side === 2) k0 = (local.v + halfD) / anchor.size.depth; // 南面固定在 -halfD
  else k0 = (halfW - local.u) / anchor.size.width; // 东面固定在 +halfW
  const k = clampUniformScale(anchor.size.width, anchor.size.depth, k0, bounds);
  const width = anchor.size.width * k;
  const depth = anchor.size.depth * k;
  // 对面固定：中心只沿法向轴平移，切向不动。
  let u1 = 0;
  let v1 = 0;
  if (side === 0) v1 = halfD - depth / 2;
  else if (side === 1) u1 = -halfW + width / 2;
  else if (side === 2) v1 = -halfD + depth / 2;
  else u1 = halfW - width / 2;
  return {
    position: {
      x: anchor.position.x + u1 * cos - v1 * sin,
      y: anchor.position.y + u1 * sin + v1 * cos,
    },
    size: { width, depth },
  };
}

/** 角柄索引（与 facilityHandles 的 corners 顺序一致：0 起顺时针）。 */
export type FacilityCornerIndex = 0 | 1 | 2 | 3;

/**
 * 对角固定的等比角缩放（#51 方案甲）：被拖角的对角点 opp 纹丝不动，指针在两条本地轴上
 * 各自给出一个缩放比，取均值作为统一系数（沿对角方向拖时两比相等），宽深同乘该系数，
 * 新中心由固定对角点回推。宽深夹取由 clampUniformScale 统一保证且不破宽高比。
 */
export function facilityUniformCornerResize(
  anchor: { position: PlanPoint; rotationDeg: number; size: { width: number; depth: number } },
  corner: FacilityCornerIndex,
  pointer: PlanPoint,
  bounds: { minM: number; maxM: number },
): { position: PlanPoint; size: { width: number; depth: number } } {
  const local = facilityLocalPoint(pointer, anchor);
  const theta = (anchor.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const halfW = anchor.size.width / 2;
  const halfD = anchor.size.depth / 2;
  const signX = corner === 1 || corner === 2 ? 1 : -1;
  const signY = corner >= 2 ? 1 : -1;
  // 固定对角点 opp 的本地坐标 = (-signX·halfW, -signY·halfD)，先转世界坐标。
  const oppU = -signX * halfW;
  const oppV = -signY * halfD;
  const oppX = anchor.position.x + oppU * cos - oppV * sin;
  const oppY = anchor.position.y + oppU * sin + oppV * cos;
  // 指针相对 opp 的本地向量（opp 到被拖角跨越整条边长，故 localX 对应新 full width）。
  const localX = local.u + signX * halfW;
  const localY = local.v + signY * halfD;
  const kU = Math.abs(localX) / anchor.size.width;
  const kV = Math.abs(localY) / anchor.size.depth;
  const k = clampUniformScale(anchor.size.width, anchor.size.depth, (kU + kV) / 2, bounds);
  const width = anchor.size.width * k;
  const depth = anchor.size.depth * k;
  return {
    position: {
      x: oppX + signX * (width / 2) * cos - signY * (depth / 2) * sin,
      y: oppY + signX * (width / 2) * sin + signY * (depth / 2) * cos,
    },
    size: { width, depth },
  };
}

/** 占地环自检：面积恒等于宽深乘积、永不自交（任意旋转角）。 */
export function footprintSelfCheck(
  facility: { position: PlanPoint; rotationDeg: number; size: { width: number; depth: number } },
): { areaM2: number; selfIntersects: boolean } {
  const ring = facilityFootprintRing(facility);
  return { areaM2: planRingAreaM2(ring), selfIntersects: planRingSelfIntersects(ring) };
}

/* ---------------- 2026-11-12 OnePlan Selection tool（框选多选） ---------------- */

/** 平面轴对齐矩形（米制，plan 坐标系）。 */
export interface PlanRect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** 组选包围盒：全部选中件足迹环的轴对齐外接矩形；空组返回 null。 */
export function facilityGroupBounds(
  facilities: readonly { position: PlanPoint; rotationDeg: number; size: { width: number; depth: number } }[],
): PlanRect | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const facility of facilities) {
    for (const point of facilityFootprintRing(facility)) {
      if (point.x < minX) minX = point.x;
      if (point.y < minY) minY = point.y;
      if (point.x > maxX) maxX = point.x;
      if (point.y > maxY) maxY = point.y;
    }
  }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
}

/** 框选命中：设施中心在矩形内，或足迹环任一顶点在矩形内（与 OnePlan 框选相交语义一致）。 */
export function facilityInRect(
  facility: { position: PlanPoint; rotationDeg: number; size: { width: number; depth: number } },
  rect: PlanRect,
): boolean {
  const inRect = (p: PlanPoint) => p.x >= rect.minX && p.x <= rect.maxX && p.y >= rect.minY && p.y <= rect.maxY;
  if (inRect(facility.position)) return true;
  return facilityFootprintRing(facility).some(inRect);
}

/**
 * 组等比缩放（B3 角柄）：绕固定锚点等比缩放每件位置，尺寸乘同一系数后逐件夹紧
 * （minM/maxM 同画布口径；某件顶到夹紧界不回推系数——整组形变优先于绝对一致）。
 * rotation 不变；factor ≤ 0 或非有限直接原样返回。
 */
export function facilityGroupScale<T extends { position: PlanPoint; rotationDeg: number; size: { width: number; depth: number } }>(
  items: readonly T[],
  anchor: PlanPoint,
  factor: number,
  bounds: { minM: number; maxM: number },
): T[] {
  if (!Number.isFinite(factor) || factor <= 0) return [...items];
  return items.map(facility => ({
    ...facility,
    position: {
      x: anchor.x + (facility.position.x - anchor.x) * factor,
      y: anchor.y + (facility.position.y - anchor.y) * factor,
    },
    size: {
      width: Math.max(bounds.minM, Math.min(bounds.maxM, facility.size.width * factor)),
      depth: Math.max(bounds.minM, Math.min(bounds.maxM, facility.size.depth * factor)),
    },
  }));
}

/* ---------------- 2026-11-12 组对齐/等距（室内多选胶囊 SelectionChip 移植到户外 2D） ---------------- */

export type FacilityAlignMode = 'min-x' | 'center-x' | 'max-x' | 'min-y' | 'center-y' | 'max-y';

/**
 * 组对齐：把每件足迹环的对应边/中线对到组包围盒的边/中线（位移只沿轴，rotation/尺寸不变）。
 * plan y 北=屏上，故「上对齐」= max-y、「下对齐」= min-y（调用方映射标签）。
 */
export function facilityGroupAlign<T extends { position: PlanPoint; rotationDeg: number; size: { width: number; depth: number } }>(
  items: readonly T[],
  mode: FacilityAlignMode,
): T[] {
  const group = facilityGroupBounds(items);
  if (!group) return [...items];
  return items.map(item => {
    const own = facilityGroupBounds([item])!;
    let dx = 0;
    let dy = 0;
    if (mode === 'min-x') dx = group.minX - own.minX;
    else if (mode === 'center-x') dx = (group.minX + group.maxX) / 2 - (own.minX + own.maxX) / 2;
    else if (mode === 'max-x') dx = group.maxX - own.maxX;
    else if (mode === 'min-y') dy = group.minY - own.minY;
    else if (mode === 'center-y') dy = (group.minY + group.maxY) / 2 - (own.minY + own.maxY) / 2;
    else dy = group.maxY - own.maxY;
    return { ...item, position: { x: item.position.x + dx, y: item.position.y + dy } };
  });
}

/** 组等距：按足迹中心沿轴在首尾之间均匀分布（保序；少于 3 件原样返回）。 */
export function facilityGroupDistribute<T extends { position: PlanPoint; rotationDeg: number; size: { width: number; depth: number } }>(
  items: readonly T[],
  axis: 'x' | 'y',
): T[] {
  if (items.length < 3) return [...items];
  const centerOf = (item: T) => {
    const rect = facilityGroupBounds([item])!;
    return axis === 'x' ? (rect.minX + rect.maxX) / 2 : (rect.minY + rect.maxY) / 2;
  };
  const sorted = [...items].sort((a, b) => centerOf(a) - centerOf(b));
  const first = centerOf(sorted[0]!);
  const last = centerOf(sorted[sorted.length - 1]!);
  const step = (last - first) / (sorted.length - 1);
  const targetByItem = new Map<T, number>();
  sorted.forEach((item, rank) => targetByItem.set(item, first + rank * step));
  return items.map(item => {
    const delta = targetByItem.get(item)! - centerOf(item);
    return axis === 'x'
      ? { ...item, position: { x: item.position.x + delta, y: item.position.y } }
      : { ...item, position: { x: item.position.x, y: item.position.y + delta } };
  });
}
