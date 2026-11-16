/**
 * 车流 / 后勤流的 3D 动态对象（2026-11-16，#117 接线切片的纯函数层）。
 *
 * 2D 的 flow-sim 已经按 carrier 分档布点与步进；这里把「哪些路线该挂车体块、
 * 占位尺寸多大、朝向怎么转」收敛成纯函数：不 import three、不读 plan 上下文、
 * 不写 plan，供 `outdoor-plan-3d` 的渲染循环每帧调用。速度与密度只有 flow-sim
 * 一个来源（createFlowWalkers/stepFlowWalkers 按 routeCarrier 自动取档）；转向
 * 限速与占位长宽来自 vehicle-follower-profile，本模块不另立数字。
 *
 * 口径（与 #118 契约文档 §3.4 一致）：
 * - 只给 kind='vehicle' | 'service' 的路线挂动态对象；明确标 carrier='walk' 的
 *   纯人行后勤不挂（那是人在走，不是车，交给人流层）；
 * - 速度按 routeCarrier 走 flow-sim 档：vehicle 3.0–5.0 m/s；service 缺省 mixed
 *   走步行档——人车一起的通道以慢的一方为准，但占位按在场最大的车留；
 * - 车体块是占位：高度是预览值，不是车型实测尺寸；整层预览不代表载客容量、
 *   通行能力或合规核算。
 */

import { routeCarrier, type PlanRoute } from '../../../../supabase/functions/_shared/site-plan';
import { createFlowWalkers, stepFlowWalkers, type FlowWalker } from '../lib/flow-sim';
import {
  polylineTangentRad,
  turnTowardRad,
  vehicleFollowerProfileFor,
  type VehicleFollowerProfile,
} from '../lib/vehicle-follower-profile';

/** 该路线是否挂 3D 车流动态对象：vehicle / service，且不是明确标纯人行的后勤。 */
export function isVehicleFlowRoute(
  route: Pick<PlanRoute, 'kind'> & { carrier?: PlanRoute['carrier'] },
): boolean {
  if (route.kind !== 'vehicle' && route.kind !== 'service') return false;
  return routeCarrier(route) !== 'walk';
}

/**
 * 车体块占位高度（米）：车/混流按乘用车顶预览 1.6，推车按车把高 0.9。
 * walk 档不会被选中（isVehicleFlowRoute 已排除），给出人高只是兜底完整映射。
 */
const BOX_HEIGHT_M: Record<VehicleFollowerProfile['carrier'], number> = {
  walk: 1.7,
  trolley: 0.9,
  vehicle: 1.6,
  mixed: 1.6,
};

export interface VehicleBoxDimensions {
  /** 沿行进方向的占位长（米），对应 BoxGeometry 的 x 向。 */
  readonly lengthM: number;
  /** 横向占位宽（米），对应 BoxGeometry 的 z 向。 */
  readonly widthM: number;
  /** 占位高（米），对应 BoxGeometry 的 y 向。 */
  readonly heightM: number;
}

/** 按 profile 取车体块占位尺寸（长宽来自 profile，高度按 carrier 查预览表）。 */
export function vehicleBoxDimensionsFor(profile: VehicleFollowerProfile): VehicleBoxDimensions {
  return {
    lengthM: profile.bodyLengthM,
    widthM: profile.bodyWidthM,
    heightM: BOX_HEIGHT_M[profile.carrier],
  };
}

/** 按路线取车体块占位尺寸（carrier 经 routeCarrier 单一决策点派生）。 */
export function vehicleBoxDimensionsForRoute(route: PlanRoute): VehicleBoxDimensions {
  return vehicleBoxDimensionsFor(vehicleFollowerProfileFor(routeCarrier(route)));
}

/** 车流单元 = flow-sim 的 walker + 当前朝向（plan 系 atan2(dy,dx)，弧度）。 */
export interface VehicleFlowUnit extends FlowWalker {
  heading: number;
}

/**
 * 从 plan 路线里选出路网并布车流单元。
 * routes 返回过滤后的子集（unit.routeIndex 对齐该数组），调用方每帧步进时必须
 * 传同一份 routes 引用。速度/密度由 flow-sim 按 carrier 决定，这里不重复算。
 */
export function createVehicleFlowUnits(
  routes: readonly PlanRoute[],
): { units: VehicleFlowUnit[]; routes: PlanRoute[] } {
  const selected = routes.filter(isVehicleFlowRoute);
  const units = createFlowWalkers(selected).map((walker) => {
    const route = selected[walker.routeIndex]!;
    return { ...walker, heading: polylineTangentRad(route.points, walker.dist) };
  });
  return { units, routes: selected };
}

/**
 * 步进一帧：位移复用 flow-sim 的 stepFlowWalkers（端点回绕、接驳分流、oneWay
 * 都在那里），朝向按所在档的 turnRateRadPerSec 限速转向上一点的切线。
 * units 与返回值按下标一一对应；路线切换（接驳）后的第一帧朝向可能滞后一拍，
 * 由最短弧转向在后续帧内收敛——预览可接受，不做瞬时光滑。
 */
export function stepVehicleFlowUnits(
  units: readonly VehicleFlowUnit[],
  routes: readonly PlanRoute[],
  dt: number,
): VehicleFlowUnit[] {
  if (units.length === 0) return [];
  const stepped = stepFlowWalkers(units, routes, dt);
  const maxTurnBase = Math.max(0, Number.isFinite(dt) ? dt : 0);
  return stepped.map((walker, index) => {
    const previous = units[index]?.heading ?? 0;
    const route = routes[walker.routeIndex];
    if (!route) return { ...walker, heading: previous };
    const profile = vehicleFollowerProfileFor(routeCarrier(route));
    const target = polylineTangentRad(route.points, walker.dist);
    return { ...walker, heading: turnTowardRad(previous, target, profile.turnRateRadPerSec * maxTurnBase) };
  });
}
