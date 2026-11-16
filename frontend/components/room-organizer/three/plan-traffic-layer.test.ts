// @vitest-environment jsdom
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { PlanRoute, SitePlanData } from '../../../../supabase/functions/_shared/site-plan';
import {
  createPlanTrafficLayer,
  drivableRoutes,
  isVehicleFacility,
  planFrameOf,
  routePathOf,
  sampleRoute,
} from './plan-traffic-layer';
import { createPlanRoleLabels } from './plan-role-labels';

const boundary = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 60 },
  { x: 0, y: 60 },
];

const route = (over: Partial<PlanRoute> = {}): PlanRoute =>
  ({
    id: '11111111-1111-4111-8111-111111111111',
    kind: 'vehicle',
    name: '车行流线',
    points: [
      { x: 10, y: 10 },
      { x: 90, y: 10 },
    ],
    oneWay: false,
    notes: '',
    ...over,
  }) as PlanRoute;

const plan = (over: Partial<SitePlanData> = {}): SitePlanData =>
  ({
    boundary,
    designScope: undefined,
    levels: undefined,
    zones: [],
    facilities: [],
    routes: [],
    nodes: [],
    workers: [],
    measurements: undefined,
    buildings: [],
    ...over,
  }) as unknown as SitePlanData;

describe('planFrameOf', () => {
  it('取边界包围盒中心与宽深', () => {
    expect(planFrameOf(boundary)).toEqual({ cx: 50, cy: 30, width: 100, depth: 60 });
  });

  it('顶点不足三个就返回 null（不虚构场地）', () => {
    expect(planFrameOf([{ x: 0, y: 0 }, { x: 1, y: 1 }])).toBeNull();
    expect(planFrameOf([])).toBeNull();
  });
});

describe('drivableRoutes', () => {
  it('只留下能行车的流线：车行、人车一起（后勤按 schema 就是人车一起），人行不算', () => {
    const kept = drivableRoutes([
      route({ id: 'a' }),
      route({ id: 'b', kind: 'pedestrian' }),
      route({ id: 'c', kind: 'service' }),
      route({ id: 'd', kind: 'pedestrian', carrier: 'mixed' }),
    ]);
    expect(kept.map(item => item.id)).toEqual(['a', 'c', 'd']);
  });

  it('单点流线不算可行驶路线', () => {
    expect(drivableRoutes([route({ points: [{ x: 1, y: 1 }] })])).toHaveLength(0);
  });
});

describe('isVehicleFacility', () => {
  it('认车类名与车类模板', () => {
    expect(isVehicleFacility({ name: '咖啡餐车' })).toBe(true);
    expect(isVehicleFacility({ name: '摆渡车 A' })).toBe(true);
    expect(isVehicleFacility({ name: '某设施', templateId: 'oneplan:icon:tour-bus' })).toBe(true);
  });

  it('帐篷、舞台不算车（宁可留静态也不误判）', () => {
    expect(isVehicleFacility({ name: '主舞台' })).toBe(false);
    expect(isVehicleFacility({ name: '3×3 帐篷' })).toBe(false);
  });
});

describe('routePathOf / sampleRoute', () => {
  it('换成以场地中心为原点的 three 坐标（x - cx, -(y - cy)）', () => {
    const path = routePathOf(route(), { cx: 50, cy: 30 })!;
    expect(path.points[0]!.toArray()).toEqual([-40, 0, 20]);
    expect(path.points[1]!.toArray()).toEqual([40, 0, 20]);
    expect(path.total).toBeCloseTo(80, 6);
  });

  it('重复顶点与零长流线一律返回 null', () => {
    expect(routePathOf(route({ points: [{ x: 5, y: 5 }, { x: 5, y: 5 }] }), { cx: 0, cy: 0 })).toBeNull();
  });

  it('按路程取点与朝向，超出总长后回绕', () => {
    const path = routePathOf(route(), { cx: 50, cy: 30 })!;
    const mid = sampleRoute(path, 40);
    expect(mid.position.x).toBeCloseTo(0, 6);
    expect(mid.position.z).toBeCloseTo(20, 6);
    expect(mid.heading.x).toBeCloseTo(1, 6);
    // 81 m 走回起点的第一段（总长 80，余 1）。
    const wrapped = sampleRoute(path, 81);
    expect(wrapped.position.x).toBeCloseTo(-39, 6);
  });
});

describe('createPlanTrafficLayer', () => {
  const ferry = {
    id: '22222222-2222-4222-8222-222222222222',
    templateId: 'oneplan:icon:food-truck',
    name: '咖啡餐车',
    position: { x: 20, y: 20 },
    rotationDeg: 0,
    size: { width: 4, depth: 2 },
    notes: '',
  };

  it('没有车行流线时一台车都不接管，设施照旧静态摆放', () => {
    const layer = createPlanTrafficLayer(0.052);
    layer.sync(plan({ facilities: [ferry], routes: [route({ kind: 'pedestrian' })] }));
    expect(layer.movesFacility(ferry.id)).toBe(false);
    expect(layer.group.children).toHaveLength(0);
    layer.dispose();
  });

  it('有车行流线时接管车类设施，并按帧推进位置', () => {
    const layer = createPlanTrafficLayer(0.052);
    layer.sync(plan({ facilities: [ferry as never], routes: [route()] }));
    expect(layer.movesFacility(ferry.id)).toBe(true);
    expect(layer.group.children).toHaveLength(1);
    const car = layer.group.children[0]!;
    const before = car.position.clone();
    layer.advance(0.25);
    // 2.2 m/s 起、长流线略提速：一个 0.25 s 帧至少走半米。
    expect(car.position.distanceTo(before)).toBeGreaterThan(0.5);
    layer.dispose();
    expect(layer.group.children).toHaveLength(0);
  });

  it('重复 sync 幂等，且组落在场地中心、底面在 baseY', () => {
    const layer = createPlanTrafficLayer(0.052);
    layer.sync(plan({ facilities: [ferry as never], routes: [route()] }));
    layer.sync(plan({ facilities: [ferry as never], routes: [route()] }));
    expect(layer.group.children).toHaveLength(1);
    expect(layer.group.position.toArray()).toEqual([50, 0.052, -30]);
    layer.dispose();
  });

  it('advance 对超长 delta 做上限保护（切标签页回来不瞬移）', () => {
    const layer = createPlanTrafficLayer(0.052);
    layer.sync(plan({ facilities: [ferry as never], routes: [route()] }));
    const car = layer.group.children[0]!;
    const before = car.position.clone();
    layer.advance(60);
    expect(car.position.distanceTo(before)).toBeLessThan(2.5 * 0.25 + 0.01);
    layer.dispose();
  });
});

describe('createPlanRoleLabels', () => {
  it('同一岗位只在第一个人头上写字，其余用色点，dispose 后清空', () => {
    const labels = createPlanRoleLabels();
    const first = new THREE.Group();
    const second = new THREE.Group();
    labels.add(first, '安保', '#cc3344', 1.75);
    labels.add(second, '安保', '#cc3344', 1.75);
    expect(first.children).toHaveLength(1);
    expect(second.children).toHaveLength(1);
    expect(first.children[0]!.name).toBe('plan-role-label');
    // 一张岗位字牌 + 一张圆点，同名岗位不重复建贴图。
    expect(labels.textureCacheSize()).toBe(2);
    // 同一组重复调用不叠标签。
    labels.add(first, '安保', '#cc3344', 1.75);
    expect(first.children).toHaveLength(1);
    labels.dispose();
    labels.dispose();
    expect(first.children).toHaveLength(0);
    expect(labels.textureCacheSize()).toBe(0);
  });
});
