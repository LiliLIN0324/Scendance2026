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

/** 设施占地相对场地边界的问题清单；边界点/贴边不算越界（与分区同口径）。 */
export function facilityPlacementIssues(
  footprint: readonly PlanPoint[],
  boundary: readonly PlanPoint[],
): PlanEditIssue[] {
  const issues: PlanEditIssue[] = [];
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
    ...(input.color !== undefined ? { color: input.color } : {}),
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
/** 占地最大边小于这个像素时不挂手柄：此时手柄会盖满本体，直接拖本体移动更顺手。 */
export const FACILITY_HANDLE_MIN_FOOTPRINT_PX = 34;

/** 屏幕像素坐标（CSS px）。 */
export type PlanPixelPoint = { x: number; y: number };

export type FacilityHandles = {
  /** 占地四角（CSS px，顺序同 facilityFootprintRing：SW→SE→NE→NW）。 */
  corners: PlanPixelPoint[];
  /** 顶边（北侧边）中点：旋转柄连线的起点（CSS px）。 */
  topMid: PlanPixelPoint;
  /** 旋转柄圆心（顶边中点沿北向法线外推 FACILITY_ROTATE_GAP_PX，CSS px）。 */
  rotate: PlanPixelPoint;
};

/** 设施在屏幕上够大才挂手柄（够小时手柄会盖住本体，反而不如直接拖动）。 */
export function facilityHandlesUsable(
  facility: { size: { width: number; depth: number } },
  viewport: PlanViewport,
): boolean {
  const mpp = planMetersPerPixel(viewport);
  if (!Number.isFinite(mpp) || mpp <= 0) return false;
  return Math.max(facility.size.width, facility.size.depth) / mpp >= FACILITY_HANDLE_MIN_FOOTPRINT_PX;
}

/**
 * 选中设施的编辑手柄坐标（CSS px）：四角=改尺寸，北侧边中点外推=旋转。
 *
 * 方向口径：旋转柄必须和 topMid（NE/NW 中点，即北侧边）落在同一侧，
 * 否则连线会横穿本体、鼠标永远抓不到（P2-i 实测 bug 的根因）。
 * 北向单位向量在 plan 系里是 (0, +1)，按占地同一套旋转矩阵得到 (-sinθ, +cosθ)。
 */
export function facilityHandles(
  facility: { position: PlanPoint; rotationDeg: number; size: { width: number; depth: number } },
  viewport: PlanViewport,
): FacilityHandles {
  const ring = facilityFootprintRing(facility);
  const theta = (facility.rotationDeg * Math.PI) / 180;
  // 旋转柄间距用屏幕像素折算成米：放大时柄跟着走远，缩小时也不至于落到本体上。
  const gap = facility.size.depth / 2 + FACILITY_ROTATE_GAP_PX * planMetersPerPixel(viewport);
  const rotatePt = {
    x: facility.position.x - gap * Math.sin(theta),
    y: facility.position.y + gap * Math.cos(theta),
  };
  const corners = ring.map(pt => planPointToPixel(pt, viewport));
  return {
    corners,
    topMid: { x: (corners[2]!.x + corners[3]!.x) / 2, y: (corners[2]!.y + corners[3]!.y) / 2 },
    rotate: planPointToPixel(rotatePt, viewport),
  };
}

export type FacilityHandleHit = { kind: 'rotate'; corner: null } | { kind: 'resize'; corner: number };

/**
 * 命中判定：先旋转柄、再四角改尺寸柄；拿到即返回，屏幕外/手柄不挂时返回 null。
 * 与画布 mousedown 的接管顺序保持一致（旋转 > 改尺寸 > 拖本体）。
 */
export function facilityHandleAt(
  facility: { position: PlanPoint; rotationDeg: number; size: { width: number; depth: number } },
  viewport: PlanViewport,
  px: PlanPixelPoint,
): FacilityHandleHit | null {
  if (!facilityHandlesUsable(facility, viewport)) return null;
  const handles = facilityHandles(facility, viewport);
  if (Math.hypot(px.x - handles.rotate.x, px.y - handles.rotate.y) <= FACILITY_HANDLE_HIT_PX) {
    return { kind: 'rotate', corner: null };
  }
  for (let i = 0; i < handles.corners.length; i += 1) {
    const corner = handles.corners[i]!;
    if (Math.hypot(px.x - corner.x, px.y - corner.y) <= FACILITY_HANDLE_HIT_PX) {
      return { kind: 'resize', corner: i };
    }
  }
  return null;
}

/** 占地环自检：面积恒等于宽深乘积、永不自交（任意旋转角）。 */
export function footprintSelfCheck(
  facility: { position: PlanPoint; rotationDeg: number; size: { width: number; depth: number } },
): { areaM2: number; selfIntersects: boolean } {
  const ring = facilityFootprintRing(facility);
  return { areaM2: planRingAreaM2(ring), selfIntersects: planRingSelfIntersects(ring) };
}
