/**
 * 户外场景可交互条目派生纯函数（#60 场景层的可测地基，零 three 依赖）。
 *
 * 注册表结构与近邻探测见 `interact-registry`；本模块只把 plan 数据（岗位点位 /
 * 后续设施）映射成条目快照，坐标换算口径与户外 3D、`outdoor-walk-boundary` 一致：
 * 规划 ENU（x 东、y 北）→ three 世界（x 东、y 上、z = -北）。
 *
 * 场景层负责：条目注册 / 失效、每帧近邻预筛、射线回查、高亮与 E 键触发；本层不碰 three。
 */

import {
  makeInteractableEntry,
  type InteractableEntry,
} from './interact-registry';
import { propInteractionProfile } from './prop-interactions';
import { capabilityForSlug } from './prop-capabilities';
import {
  seatFacilityTargets,
  type SeatFacilityInput,
} from './seat-placement';

/**
 * 提示卡文案：座位条目已落座时切「起身 · <名称>」，其余沿用条目原 label。
 * `seated` 由场景层按当前落座条目 id 判定传入。
 */
export function interactHintLabel(entry: InteractableEntry, seated: boolean): string {
  if (entry.kind === 'seat' && seated) {
    return `起身 · ${entry.label.replace(/^坐下 · /, '')}`;
  }
  return entry.label;
}

/** 岗位点位最小结构（与 `PlanWorker` 对齐的子集，避免前端直连 supabase shared 类型）。 */
export interface InteractableWorkerInput {
  id: string;
  role: string;
  count?: number;
  position: { x: number; y: number };
}

/** 地面标高（米）：与户外 3D `PLAN_LAYER_BASE_Y` 同口径，条目站位 y 取地面。 */
export const INTERACTABLE_GROUND_Y = 0.052;

/** 设施点位最小结构（与 `PlanFacility` 对齐的子集，避免前端直连 supabase shared 类型）。 */
export interface InteractableFacilityInput {
  id: string;
  name: string;
  position: { x: number; y: number };
}

/**
 * 把设施列表派生为「道具交互」条目（2026-11-16 丽丽要求）：
 * - 坐具仍走 seatInteractables，保留坐面高 / 眼高，行为与原来一致；
 * - 桌 / 柜台 / 摊位 / 展柜 / 舞台按 prop-interactions 给「交谈 / 挥手」文案；
 * - 围栏 / 绿植 / 车辆等仍注册为 facility（与原 facilityInteractables 一样能被看到），
 *   但不冒充可交互道具，label 保持原名。调用方若只想拿有动作的条目，按 label 前缀过滤。
 *
 * 与 facilityInteractables 二选一：本函数已经包含全部设施，重复调用会出两条。
 */
export function propInteractables(
  facilities: readonly PropInteractableInput[],
  groundY: number = INTERACTABLE_GROUND_Y,
): InteractableEntry[] {
  // PlanFacility 没有 ref；真实 slug 在 modelOverride，模板在 templateId。统一成 ref 再判。
  const normalized = facilities.map((facility) => {
    const ref = facility.ref ?? facility.modelOverride ?? facility.templateId;
    // 能力表定稿（2026-11-17）：目录给什么就做什么，不再逐条猜词。
    const capabilities = capabilityForSlug(ref);
    return {
      ...facility,
      ref,
      capabilities,
      canSeat: capabilities?.kind === 'seat' || capabilities?.kind === 'seat-set',
    };
  });
  const seats = seatInteractables(normalized, groundY);
  const seatIds = new Set(seats.map(entry => entry.id));
  const others = normalized
    .filter(facility => !seatIds.has(facility.id))
    .map((facility) => {
      const profile = propInteractionProfile(facility);
      return makeInteractableEntry({
        id: facility.id,
        kind: 'facility',
        label: profile.interactions.length > 0 ? profile.label : facility.name,
        position: { x: facility.position.x, y: groundY, z: -facility.position.y },
        personAction: profile.personAction,
      });
    });
  return [...seats, ...others];
}

/** 道具交互条目允许带的可选描述；与 prop-interactions 的输入保持同形。 */
export interface PropInteractableInput extends SeatInteractableInput {
  category?: string | undefined;
  tags?: readonly string[] | undefined;
  /** `PlanFacility.templateId`：内置模板（booth-2x2 / stage-platform-8x6…）。 */
  templateId?: string | undefined;
  /** `PlanFacility.modelOverride`：物料库 slug；真实可坐 / 摊位判定主要靠它。 */
  modelOverride?: string | undefined;
}

/**
 * 把设施列表派生为 facility 可交互条目。
 * 位置转世界坐标快照；设施占地尺寸不进条目，近邻探测仍按点位地面距离。
 */
export function facilityInteractables(
  facilities: readonly InteractableFacilityInput[],
  groundY: number = INTERACTABLE_GROUND_Y,
): InteractableEntry[] {
  return facilities.map((facility) =>
    makeInteractableEntry({
      id: facility.id,
      kind: 'facility',
      label: facility.name,
      position: { x: facility.position.x, y: groundY, z: -facility.position.y },
    }),
  );
}

/** 座位类设施最小结构（与 SeatFacilityInput 对齐的户外设施子集）。 */
export interface SeatInteractableInput extends SeatFacilityInput {}

/**
 * 把座位类设施派生为 seat 可交互条目。
 * 仅可坐物件（椅 / 沙发 / 凳）成条；探测位置取地面，落座眼高 / 坐面高放 seat 元数据。
 */
export function seatInteractables(
  facilities: readonly SeatInteractableInput[],
  groundY: number = INTERACTABLE_GROUND_Y,
): InteractableEntry[] {
  return seatFacilityTargets(facilities, groundY).map((target) =>
    makeInteractableEntry({
      id: target.id,
      kind: 'seat',
      label: `坐下 · ${target.name}`,
      position: { x: target.x, y: groundY, z: -target.y },
      personAction: 'sit',
      seat: {
        x: target.x,
        y: target.y,
        rotationDeg: target.rotationDeg,
        seatHeight: target.seatHeight,
        eyeY: target.eyeY,
      },
    }),
  );
}

/**
 * 把岗位点位列表派生为 NPC 可交互条目。
 * 一个点位是一条目（多人副本不拆条，副标题标人数）；位置转世界坐标快照。
 */
export function workerInteractables(
  workers: readonly InteractableWorkerInput[],
  groundY: number = INTERACTABLE_GROUND_Y,
): InteractableEntry[] {
  return workers.map((worker) =>
    makeInteractableEntry({
      id: worker.id,
      kind: 'npc',
      label: worker.role,
      subtitle: typeof worker.count === 'number' && worker.count > 1 ? `${worker.count} 人` : undefined,
      position: { x: worker.position.x, y: groundY, z: -worker.position.y },
    }),
  );
}
