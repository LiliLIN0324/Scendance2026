/**
 * 设施占地 ↔ 3D 模型「锁宽高比」纯函数层（2026-11-12 #51 方案甲）。
 *
 * 本质背景：2D 占地框此前可被画成任意宽高比，再用 uniform contain 把固定比例的 GLB
 * 硬塞进框，只能保证最长边入框、短轴留空；斜俯视下高箱体相对贴地框外扩，肉眼「不对齐」。
 * 成熟规划产品（Planner 5D / Live Home 3D / OnePlan 等）的范式是：2D 框即模型真实
 * 水平外廓，物件自带权威尺寸、缩放锁宽高比。本层只做无 three / React 依赖的纯计算：
 *  - `facilityFootprintSpec`：templateId → 权威外廓（优先真实 GLB，其次库/内置声明尺寸）；
 *  - `normalizeFacilitySize`：把历史自由比例尺寸吸附到权威宽高比（保留长边与朝向、中心不动）；
 *  - `sizeWithMajor` / `sizeWithWidth` / `sizeWithDepth`：等比缩放时由一条边推另一条边。
 */

import { PLAN_PROP_SIZE, planPropKind } from './plan-footprint-geometry';
import { resolveFacilityModels } from './plan-facility-models';
import { resolveFacilityTemplate } from './plan-facility-catalog';
import type { SitePlanData } from '../../../../supabase/functions/_shared/site-plan';

const EPS = 1e-6;

/** 与画布 FACILITY_MIN/MAX_SIZE_M 同源的占地尺寸界（米）。 */
export const FACILITY_FOOTPRINT_BOUNDS = { minM: 0.5, maxM: 100 } as const;

export interface FacilityFootprintSpec {
  /** 权威外廓宽（米），对应 GLB/Three 的 X 轴；保留模型原始轴序，不把长边重排到 width。 */
  width: number;
  /** 权威外廓深（米），对应 GLB/Three 的 Z 轴。 */
  depth: number;
  /** 宽高比，恒取长边/短边（≥1，与横竖朝向无关）。 */
  aspect: number;
  /** 外廓是否来自真实 GLB（false = 库贴纸/内置类型的声明尺寸回落）。 */
  hasModel: boolean;
}

function finitePositive(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > EPS;
}

/**
 * 任意 templateId → 权威占地外廓。
 * 取值优先级：首选真实 GLB 的水平包围盒 → 物件库/内置模板声明尺寸 → 类型默认尺寸。
 */
export function facilityFootprintSpec(templateId: string): FacilityFootprintSpec {
  const candidates = resolveFacilityModels(templateId);
  const model = candidates[0];
  if (model && finitePositive(model.width) && finitePositive(model.depth)) {
    // 保留候选原始轴序（width↔GLB/Three X、depth↔Z），与 3D 落位映射一一对应；
    // aspect 只存长边/短边比例，横竖朝向由 rotationDeg 与字段谁大谁小表达。
    return {
      width: model.width,
      depth: model.depth,
      aspect: Math.max(model.width, model.depth) / Math.min(model.width, model.depth),
      hasModel: true,
    };
  }
  const template = resolveFacilityTemplate(templateId);
  if (template && finitePositive(template.width) && finitePositive(template.depth)) {
    return {
      width: template.width,
      depth: template.depth,
      aspect: Math.max(template.width, template.depth) / Math.min(template.width, template.depth),
      hasModel: false,
    };
  }
  const fallback = PLAN_PROP_SIZE[planPropKind(templateId)] ?? PLAN_PROP_SIZE.misc;
  return {
    width: fallback.width,
    depth: fallback.depth,
    aspect: Math.max(fallback.width, fallback.depth) / Math.min(fallback.width, fallback.depth),
    hasModel: false,
  };
}

function clampSize(value: number, minM: number, maxM: number): number {
  // NaN / Infinity 等非有限输入一律收敛到下界，杜绝 NaN 沿尺寸链污染落盘数据。
  if (!Number.isFinite(value)) return minM;
  return Math.max(minM, Math.min(maxM, value));
}

/** 统一缩放系数夹取：两条边乘 k 后都落在 [minM,maxM]，严格保持宽高比。 */
function clampScale(width: number, depth: number, k0: number, bounds: { minM: number; maxM: number }): number {
  // 非法系数（清空输入瞬间的 NaN、溢出 Infinity）退回不缩放，再做界内夹取。
  const kRequested = Number.isFinite(k0) ? k0 : 1;
  const kMin = Math.max(bounds.minM / width, bounds.minM / depth);
  const kMax = Math.min(bounds.maxM / width, bounds.maxM / depth);
  return Math.max(kMin, Math.min(kMax, kRequested));
}

/**
 * 把一个尺寸吸附到权威宽高比：以历史框长边长度为规模基准，字段归属跟随权威轴序
 * （width↔X、depth↔Z），不随自由框的横/竖交换宽深；矩形始终关于中心对称，无需改 position。
 * 极值下优先保证两轴都在界内且比例恒定。
 */
export function normalizeFacilitySize(
  size: { width: number; depth: number },
  templateId: string,
  bounds: { minM: number; maxM: number },
): { width: number; depth: number } {
  const spec = facilityFootprintSpec(templateId);
  let major = clampSize(Math.max(size.width, size.depth), bounds.minM, bounds.maxM);
  let minor = major / spec.aspect;
  if (minor < bounds.minM) {
    // 长边推算出的短边越下界：短边保下界，长边随比例回调（仍保 aspect）。
    minor = bounds.minM;
    major = minor * spec.aspect;
  }
  if (major > bounds.maxM) {
    major = bounds.maxM;
    minor = major / spec.aspect;
  }
  // 哪个字段是长边由权威轴序决定，而不是历史自由框当前谁长。
  return spec.width >= spec.depth ? { width: major, depth: minor } : { width: minor, depth: major };
}

/** 以当前尺寸为基准、按目标主轴尺寸求统一缩放系数（两轴同乘，锁比例且都在界内）。 */
function resizeUniform(
  base: { width: number; depth: number },
  targetAxisSize: number,
  axis: 'width' | 'depth',
  bounds: { minM: number; maxM: number },
): { width: number; depth: number } {
  const k0 = targetAxisSize / base[axis];
  const k = clampScale(base.width, base.depth, k0, bounds);
  return { width: base.width * k, depth: base.depth * k };
}

/** 以长边为锚等比给尺寸（保持当前横竖朝向，两轴同比例）。 */
export function sizeWithMajor(
  size: { width: number; depth: number },
  majorRequested: number,
  _templateId: string,
  bounds: { minM: number; maxM: number },
): { width: number; depth: number } {
  const axis = size.width >= size.depth ? 'width' : 'depth';
  return resizeUniform(size, majorRequested, axis, bounds);
}

/** 改宽度时等比推深度（统一系数，宽度夹取通过 k 作用于两轴）。 */
export function sizeWithWidth(
  widthRequested: number,
  size: { width: number; depth: number },
  _templateId: string,
  bounds: { minM: number; maxM: number },
): { width: number; depth: number } {
  return resizeUniform(size, widthRequested, 'width', bounds);
}

/** 改深度时等比推宽度（与 sizeWithWidth 对称）。 */
export function sizeWithDepth(
  depthRequested: number,
  size: { width: number; depth: number },
  _templateId: string,
  bounds: { minM: number; maxM: number },
): { width: number; depth: number } {
  return resizeUniform(size, depthRequested, 'depth', bounds);
}

/**
 * 载入历史计划时一次性吸附全部设施的占地宽高比（#51 方案甲存量自愈）：
 * 幂等——已合规的尺寸经 normalize 后不变；只改 size，中心/旋转/其余实体原样保留。
 */
export function normalizePlanFacilityFootprints(
  plan: SitePlanData,
  bounds: { minM: number; maxM: number } = FACILITY_FOOTPRINT_BOUNDS,
): SitePlanData {
  return {
    ...plan,
    facilities: plan.facilities.map(facility => ({
      ...facility,
      size: normalizeFacilitySize(facility.size, facility.templateId, bounds),
    })),
  };
}
