/**
 * 车辆实体（plan.vehicles，2026-11-16 #118 方案 B）的前端读取层（纯函数）。
 *
 * 契约在 `supabase/functions/_shared/site-plan.ts` 的 `planVehicleSchema`：
 * - `count` 是车数（台），不是人数——任何统计出口都不得把它并进人员口径；
 * - `modelSlug` 是物料库主键，缺省 = 库内没有该车型 GLB，只能画占位盒；
 * - `routeIds` 指向它跑的动线（缺省 = 停放/待命点）。
 *
 * 本模块只回答「这台车是什么、走哪种载体、有没有模型、摆哪儿」，不读 three、
 * 不碰 React、不写 plan。**不做近似回落**：没登记的车型不许猜成别的车，没有
 * modelSlug 不许借相邻车型的 GLB——那会把 12m 大巴画成 7.5m 箱货。
 */

import type { PlanRouteCarrier, PlanVehicle, PlanVehicleType } from '../../../../supabase/functions/_shared/site-plan';
import { VEHICLE_TYPES, vehicleModelSlug, type VehicleType } from './vehicle-types';

/** 车型登记表里该型号的条目；契约的 type 枚举与登记表 id 必须逐条对齐（测试锁）。 */
export function vehicleTypeEntry(type: PlanVehicleType): VehicleType | null {
  return VEHICLE_TYPES.find((entry) => entry.id === type) ?? null;
}

/** 车型 → 走哪一类动线（人行/车辆/后勤）。未登记返回 null，不猜。 */
export function vehicleKindFor(type: PlanVehicleType): VehicleType['kind'] | null {
  return vehicleTypeEntry(type)?.kind ?? null;
}

/**
 * 车型 → 动线载体。车一律 `vehicle`（自行车暂并入，见 vehicle-types.ts 注释）。
 * 未登记返回 null：调用方按「无载体」处理，不回落成步行。
 */
export function vehicleCarrierFor(type: PlanVehicleType): PlanRouteCarrier | null {
  return vehicleTypeEntry(type)?.carrier ?? null;
}

/** 车型中文名（图例/清单用）。未登记退回原始 type，不编名字。 */
export function vehicleLabelOf(vehicle: Pick<PlanVehicle, 'type'>): string {
  return vehicleTypeEntry(vehicle.type)?.name ?? vehicle.type;
}

/**
 * 该车实际能用的模型 slug：**只认实体自己写的 modelSlug**，不回落到登记表首项。
 * 理由（#118 §3.5）：登记表里的 modelSlugs 是「该车型可用的模型池」，但某一次
 * 具体车辆是否挂了模型，必须由实体自己说；按登记表回落会把「待补」显示成有模型。
 */
export function vehicleModelSlugOf(vehicle: Pick<PlanVehicle, 'modelSlug'>): string | null {
  return vehicle.modelSlug ?? null;
}

/** 登记表里该车型默认的模型 slug（仅用于「这台车没写 modelSlug」时的提示文案，不用于渲染）。 */
export function vehicleDefaultModelSlugFor(type: PlanVehicleType): string | null {
  const entry = vehicleTypeEntry(type);
  return entry ? vehicleModelSlug(entry) : null;
}

/** 停放位槽（确定性）：同一台车、同一 count 永远得到同一组偏移，刷新不跳。 */
export interface VehicleSlot {
  readonly index: number;
  /** 相对实体落点的偏移（plan 系米，x 东 / y 北）。 */
  readonly offsetX: number;
  readonly offsetY: number;
}

/** 每台车最多摆几个实例（与人群层 MAX_CROWD_INSTANCES_PER_WORKER 同口径，防 99 台卡死）。 */
export const MAX_VEHICLE_INSTANCES = 24;

/**
 * 按车数生成整排停放位：沿东西向一行排开，间距取该车型占位宽 + 0.6m 车距，
 * 超过 6 台折第二行。**只用于静态落点示意**——行进由路线级车流预览负责。
 * count 非法（<1）返回空数组，不虚构一台车。
 */
export function vehicleEntitySlots(
  vehicle: Pick<PlanVehicle, 'count'>,
  bodyWidthM: number,
): VehicleSlot[] {
  const count = Math.min(Math.max(0, Math.trunc(vehicle.count)), MAX_VEHICLE_INSTANCES);
  if (!Number.isFinite(count) || count < 1) return [];
  const step = Math.max(0.8, bodyWidthM + 0.6);
  const perRow = 6;
  const slots: VehicleSlot[] = [];
  for (let index = 0; index < count; index += 1) {
    const row = Math.floor(index / perRow);
    const col = index % perRow;
    const rowCount = Math.min(perRow, count - row * perRow);
    // 每行居中：第一台从 -(rowCount-1)/2 * step 起。
    const offsetX = (col - (rowCount - 1) / 2) * step;
    // row=0 时不能写成 -row * …：会得到 -0，深比较/快照都不稳，这里显式归零。
    const offsetY = row === 0 ? 0 : -(row * (Math.max(0.8, bodyWidthM) + 1.2));
    slots.push({ index, offsetX, offsetY });
  }
  return slots;
}
