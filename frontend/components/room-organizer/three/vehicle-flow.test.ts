import { describe, expect, it } from 'vitest';
import { polylineTangentRad, turnTowardRad } from '../lib/vehicle-follower-profile';
import { walkerCountFor } from '../lib/flow-sim';
import type { PlanRoute, PlanRouteCarrier } from '../../../../supabase/functions/_shared/site-plan';
import {
  createVehicleFlowUnits,
  isVehicleFlowRoute,
  stepVehicleFlowUnits,
  vehicleBoxDimensionsForRoute,
  type VehicleFlowUnit,
} from './vehicle-flow';

function route(id: string, kind: PlanRoute['kind'], points: { x: number; y: number }[], carrier?: PlanRouteCarrier): PlanRoute {
  return { id, kind, name: id, points, oneWay: false, notes: '', ...(carrier ? { carrier } : {}) };
}

/** 100m 直线。 */
const LINE = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
/** 30m 直段 + 20m 纵段：拐点在弧长 30 处，切线 0 → π/2。 */
const CORNER = [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 20 }];

describe('vehicle-flow（车流/后勤 3D 动态对象纯函数）', () => {
  it('isVehicleFlowRoute：vehicle/service 挂，pedestrian 与纯人行后勤不挂', () => {
    expect(isVehicleFlowRoute(route('a', 'vehicle', LINE))).toBe(true);
    expect(isVehicleFlowRoute(route('b', 'service', LINE))).toBe(true); // 缺省 carrier=mixed
    expect(isVehicleFlowRoute(route('c', 'service', LINE, 'walk'))).toBe(false); // 纯人行后勤交还人流层
    expect(isVehicleFlowRoute(route('d', 'pedestrian', LINE))).toBe(false);
    expect(isVehicleFlowRoute(route('e', 'vehicle', LINE, 'vehicle'))).toBe(true);
  });

  it('createVehicleFlowUnits：只建选中路线，速度/密度走 flow-sim 载体档，朝向=弧长处切线', () => {
    const ped = route('p', 'pedestrian', LINE);
    const veh = route('v', 'vehicle', LINE);
    const svc = route('s', 'service', LINE);
    const { units, routes } = createVehicleFlowUnits([ped, veh, svc]);
    expect(routes.map((item) => item.id)).toEqual(['v', 's']);
    expect(units.length).toBe(walkerCountFor(veh) + walkerCountFor(svc));

    const vehUnits = units.filter((unit) => routes[unit.routeIndex]?.id === 'v');
    const svcUnits = units.filter((unit) => routes[unit.routeIndex]?.id === 's');
    expect(vehUnits.length).toBeGreaterThan(0);
    expect(svcUnits.length).toBeGreaterThan(0);
    for (const unit of vehUnits) {
      expect(unit.speed).toBeGreaterThanOrEqual(3.0);
      expect(unit.speed).toBeLessThanOrEqual(5.0);
    }
    for (const unit of svcUnits) {
      // 后勤缺省 mixed：人车一起以慢的一方为准。
      expect(unit.speed).toBeGreaterThanOrEqual(1.0);
      expect(unit.speed).toBeLessThanOrEqual(1.3);
    }
    for (const unit of units) {
      expect(unit.heading).toBeCloseTo(polylineTangentRad(routes[unit.routeIndex]!.points, unit.dist), 10);
    }
  });

  it('stepVehicleFlowUnits：位移按速度推进，拐点后朝向按 turnRate*dt 限速收敛到 π/2', () => {
    const corner = route('c', 'vehicle', CORNER);
    // 手工单元：起点在拐点后 1m、朝向还是直段方向——最可控的收敛场景。
    let units: VehicleFlowUnit[] = [{ routeIndex: 0, dist: 31, dir: 1, speed: 3.4, heading: 0 }];
    for (let i = 0; i < 40; i += 1) units = stepVehicleFlowUnits(units, [corner], 0.1);
    // 0.9 rad/s * 0.1s = 0.09/步，约 18 步到位；40 步后应稳定在 π/2。
    expect(units[0]!.heading).toBeCloseTo(Math.PI / 2, 6);
    // 未回绕：40 步走 13.6m，31+13.6=44.6 < 总长 50。
    expect(units[0]!.dist).toBeCloseTo(31 + 3.4 * 0.1 * 40, 6);
  });

  it('stepVehicleFlowUnits：单步转向不超过 turnRate*dt，位移=速度*dt', () => {
    const corner = route('c', 'vehicle', CORNER);
    const units: VehicleFlowUnit[] = [{ routeIndex: 0, dist: 29.9, dir: 1, speed: 3.4, heading: 0 }];
    const next = stepVehicleFlowUnits(units, [corner], 0.05);
    expect(next[0]!.dist).toBeCloseTo(29.9 + 3.4 * 0.05, 10);
    expect(next[0]!.heading).toBeCloseTo(0.9 * 0.05, 10);
  });

  it('stepVehicleFlowUnits：dt=0 / NaN 位移与朝向都不动；空单元返回空', () => {
    const corner = route('c', 'vehicle', CORNER);
    const units: VehicleFlowUnit[] = [{ routeIndex: 0, dist: 10, dir: 1, speed: 3.4, heading: 1.1 }];
    for (const dt of [0, Number.NaN]) {
      const next = stepVehicleFlowUnits(units, [corner], dt);
      expect(next[0]!.dist).toBe(10);
      expect(next[0]!.heading).toBeCloseTo(turnTowardRad(1.1, polylineTangentRad(CORNER, 10), 0), 10);
    }
    expect(stepVehicleFlowUnits([], [corner], 0.1)).toEqual([]);
  });

  it('vehicleBoxDimensionsForRoute：车/混流 4.8×1.9×1.6，推车 1.2×0.7×0.9', () => {
    const vehicle = vehicleBoxDimensionsForRoute(route('v', 'vehicle', LINE));
    expect(vehicle).toEqual({ lengthM: 4.8, widthM: 1.9, heightM: 1.6 });
    const service = vehicleBoxDimensionsForRoute(route('s', 'service', LINE)); // 缺省 mixed
    expect(service).toEqual({ lengthM: 4.8, widthM: 1.9, heightM: 1.6 });
    const trolley = vehicleBoxDimensionsForRoute(route('t', 'service', LINE, 'trolley'));
    expect(trolley).toEqual({ lengthM: 1.2, widthM: 0.7, heightM: 0.9 });
  });
});
