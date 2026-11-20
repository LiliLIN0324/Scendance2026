/**
 * 户外规划「可编辑性」的单一判定（2026-11-20 地图编辑交互审计 B3/K3/K8）。
 *
 * 今天的可编辑性原本拆成三条互不相干的轴：图层可见（`layerState`）、图层锁定
 * （`lockedLayers`）、以及各 `selectedXxxRef`。命中、清单行、属性卡、放置各取所需，
 * 于是出现「看不见的还能点中拖动」「锁了层但清单行照样改名」。
 *
 * 这里把「所在图层 + 可见 + 锁定」收敛成一个纯函数：命中、清单行、属性写入、放置
 * 与 3D 都调它，漏改一处也不会再各说各话。当前楼层不是本模块的事——调用方先过
 * `filterPlanByLevel`（`viewPlan()`）。
 */

import {
  PLANNING_LABELS,
  type PlanningEditMode,
  type PlanningLayerKind,
} from '@/lib/outdoor-plan-tokens';
import type { PlanInventoryKind } from './site-plan-inventory';

/** 图层可读名（`PLANNING_LABELS` 没有 node；node 与 access 同层显示为「出入口」）。 */
export const PLAN_LAYER_HUMAN_LABELS: Record<PlanningLayerKind, string> = {
  ...PLANNING_LABELS,
  node: '出入口',
};

/**
 * 清单/命中里的实体种类 → 图层开关键。
 * 节点画在 access 层；车辆由动线层承载（车跟路线走，不另开图层行）。
 */
export const PLAN_INVENTORY_LAYER: Record<PlanInventoryKind, PlanningLayerKind> = {
  zone: 'zone',
  facility: 'facility',
  route: 'route',
  node: 'access',
  worker: 'worker',
  vehicle: 'route',
  measurement: 'measure',
  annotation: 'annotate',
};

/**
 * 各绘制工具把内容落到哪个图层（K8：切工具时若该层被隐藏就自动打开，
 * 否则会出现「放完看不见，右下角却说已放置」）。
 */
export const PLAN_MODE_TARGET_LAYER: Partial<Record<PlanningEditMode, PlanningLayerKind>> = {
  boundary: 'boundary',
  'boundary-vertex': 'boundary',
  zone: 'zone',
  scope: 'zone',
  wall: 'zone',
  facility: 'facility',
  route: 'route',
  node: 'access',
  worker: 'worker',
  vehicle: 'route',
  measure: 'measure',
  note: 'annotate',
  shape: 'annotate',
};

/** 某图层的访问态：可见 = 参与绘制与命中；锁定 = 可看不可改。 */
export interface PlanLayerAccess {
  visible: boolean;
  locked: boolean;
}

/** 被挡住的原因；`null` = 可编辑。 */
export type PlanLayerBlock = 'hidden' | 'locked' | null;

/** 从两张开关表读出某图层的访问态（缺省即可见、未锁定）。 */
export function planLayerAccess(
  layer: PlanningLayerKind,
  visibility: Partial<Record<PlanningLayerKind, boolean>>,
  locked: Partial<Record<PlanningLayerKind, boolean>>,
): PlanLayerAccess {
  return { visible: visibility[layer] !== false, locked: locked[layer] === true };
}

/** 访问态 → 是否可编辑（可见 ∧ 未锁定）。 */
export function planLayerEditable(access: PlanLayerAccess): boolean {
  return access.visible && !access.locked;
}

/** 访问态 → 被挡原因（隐藏优先于锁定：看不见比只读更根本）。 */
export function planLayerBlock(access: PlanLayerAccess): PlanLayerBlock {
  if (!access.visible) return 'hidden';
  if (access.locked) return 'locked';
  return null;
}

/** 实体种类 → 是否可编辑。 */
export function planEntityEditable(
  kind: PlanInventoryKind,
  visibility: Partial<Record<PlanningLayerKind, boolean>>,
  locked: Partial<Record<PlanningLayerKind, boolean>>,
): boolean {
  return planLayerEditable(planLayerAccess(PLAN_INVENTORY_LAYER[kind], visibility, locked));
}

/** 一句给用户看的解释（为什么点不中/为什么改不了）；可编辑返回 null。 */
export function planLayerBlockReason(
  layer: PlanningLayerKind,
  access: PlanLayerAccess,
): string | null {
  const block = planLayerBlock(access);
  if (block === 'hidden') {
    return `「${PLAN_LAYER_HUMAN_LABELS[layer]}」图层已隐藏：先在左栏图层开关里打开它，才能选中或编辑。`;
  }
  if (block === 'locked') {
    return `「${PLAN_LAYER_HUMAN_LABELS[layer]}」图层已锁定：先在左栏点锁图标解锁，才能选中或编辑。`;
  }
  return null;
}

/** 实体种类 → 挡住原因文案；可编辑返回 null。 */
export function planEntityBlockReason(
  kind: PlanInventoryKind,
  visibility: Partial<Record<PlanningLayerKind, boolean>>,
  locked: Partial<Record<PlanningLayerKind, boolean>>,
): string | null {
  const layer = PLAN_INVENTORY_LAYER[kind];
  return planLayerBlockReason(layer, planLayerAccess(layer, visibility, locked));
}

/** 切到某绘制工具时是否需要自动打开目标层（返回要打开的图层，或 null）。 */
export function planModeAutoVisibleLayer(
  mode: PlanningEditMode,
  visibility: Partial<Record<PlanningLayerKind, boolean>>,
): PlanningLayerKind | null {
  const layer = PLAN_MODE_TARGET_LAYER[mode];
  if (!layer) return null;
  return visibility[layer] === false ? layer : null;
}
