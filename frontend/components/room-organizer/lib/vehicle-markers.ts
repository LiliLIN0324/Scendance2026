/**
 * 车辆实体的 2D 标记规格（纯数据，2026-11-16 #118 方案 B）。
 *
 * 与 3D `plan-vehicle-entities` 层同源：都用 `vehicleEntitySlots` 展开台数、
 * `vehicleFollowerProfileFor` 取占位长宽、`vehicleModelSlugOf` 判「有没有模型」。
 * 这样同一个 plan 在平面图和三维里落点一致，不会「2D 画 3 台、3D 摆 2 台」。
 *
 * 本模块不 import three / react / canvas：只产出 plan 坐标下的矩形与朝向，
 * 由画布负责米→像素，测试可以直接断言数据。
 */

import type { PlanRoute, PlanVehicle, SitePlanData } from '../../../../supabase/functions/_shared/site-plan';
import { PLANNING_ROUTE_KIND_COLORS } from '@/lib/outdoor-plan-tokens';
import {
  MAX_VEHICLE_INSTANCES,
  vehicleCarrierFor,
  vehicleEntitySlots,
  vehicleLabelOf,
  vehicleModelSlugOf,
} from './vehicle-entities';
import { polylineTangentRad, vehicleFollowerProfileFor } from './vehicle-follower-profile';

/** 一台车的一个可见实例（台数 > 1 时同车型并排）。 */
export interface VehicleMarkerSpec {
  readonly vehicleId: string;
  /** 该车第几个实例（0 起），标签只挂 0 号。 */
  readonly slotIndex: number;
  /** plan 坐标（米）：实体落点 + 槽位偏移。 */
  readonly x: number;
  readonly y: number;
  /** 朝向（rad，plan 数学角：0 = +x 东，π/2 = +y 北）。 */
  readonly headingRad: number;
  /** 占位长（沿朝向）/ 宽（横向），米。 */
  readonly lengthM: number;
  readonly widthM: number;
  readonly color: string;
  /** 只在 slotIndex=0 上有值，避免多台时标签叠成一团。 */
  readonly label: string | null;
  /** true = 没有可用模型，只能画占位框并标「待补模型」。 */
  readonly modelMissing: boolean;
  /** 该实体登记的总台数（标签用）。 */
  readonly count: number;
}

/** 车辆图层键（画布/图例共用，避免各处手写字符串）。 */
export const VEHICLE_MARKER_LAYER = 'vehicle' as const;

/**
 * 把 plan.vehicles 展开成画布标记。
 * 旧 plan 没有 `vehicles` → 返回 []（不合成、不猜）。
 * 未登记车型 → 跳过（schema 已枚举，这里只防脏数据），不回落成别的车型。
 */
export function vehicleMarkerSpecs(
  plan: Pick<SitePlanData, 'vehicles'> & { routes?: PlanRoute[] },
): VehicleMarkerSpec[] {
  const vehicles: PlanVehicle[] = Array.isArray(plan.vehicles) ? plan.vehicles : [];
  if (vehicles.length === 0) return [];
  const routeById = new Map((plan.routes ?? []).map((route) => [route.id, route]));
  const specs: VehicleMarkerSpec[] = [];
  vehicles.forEach((vehicle) => {
    const carrier = vehicleCarrierFor(vehicle.type);
    if (!carrier) return;
    const profile = vehicleFollowerProfileFor(carrier);
    const route = (vehicle.routeIds ?? [])
      .map((id) => routeById.get(id))
      .find((item): item is PlanRoute => item !== undefined);
    const headingRad = route ? polylineTangentRad(route.points, 0) : 0;
    const modelMissing = vehicleModelSlugOf(vehicle) === null;
    const label = `${vehicleLabelOf(vehicle)} · ${vehicle.count} 台${modelMissing ? '（待补模型）' : ''}`;
    const slots = vehicleEntitySlots(vehicle, profile.bodyWidthM).slice(0, MAX_VEHICLE_INSTANCES);
    slots.forEach((slot) => {
      specs.push({
        vehicleId: vehicle.id,
        slotIndex: slot.index,
        x: vehicle.position.x + slot.offsetX,
        y: vehicle.position.y + slot.offsetY,
        headingRad,
        lengthM: profile.bodyLengthM,
        widthM: profile.bodyWidthM,
        color: vehicle.color ?? PLANNING_ROUTE_KIND_COLORS.vehicle,
        label: slot.index === 0 ? label : null,
        modelMissing,
        count: vehicle.count,
      });
    });
  });
  return specs;
}
