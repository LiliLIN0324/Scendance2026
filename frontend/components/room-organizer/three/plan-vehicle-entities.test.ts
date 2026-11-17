// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { PlanRoute, PlanVehicle, SitePlanData } from '../../../../supabase/functions/_shared/site-plan';
import {
  createPlanVehicleEntitiesLayer,
  planHeadingToThreeY,
} from './plan-vehicle-entities';

const boundary = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 60 },
  { x: 0, y: 60 },
];

const vehicle = (patch: Partial<PlanVehicle> = {}): PlanVehicle => ({
  id: '55555555-5555-4555-8555-555555555555',
  type: 'coach',
  count: 1,
  position: { x: 10, y: 20 },
  notes: '',
  ...patch,
});

const plan = (vehicles: PlanVehicle[], routes: PlanRoute[] = []): SitePlanData =>
  ({ boundary, vehicles, routes }) as unknown as SitePlanData;

const northRoute = (): PlanRoute =>
  ({
    id: '66666666-6666-4666-8666-666666666666',
    kind: 'vehicle',
    name: '车行流线',
    points: [
      { x: 0, y: 10 },
      { x: 0, y: 60 },
    ],
    oneWay: false,
    notes: '',
  }) as PlanRoute;

describe('planHeadingToThreeY', () => {
  it('东向 (0) → three +x 方向', () => {
    expect(planHeadingToThreeY(0)).toBeCloseTo(Math.PI / 2, 6);
  });

  it('北向 (π/2) → three -z 方向', () => {
    expect(planHeadingToThreeY(Math.PI / 2)).toBeCloseTo(Math.PI, 6);
  });

  it('西向 (π) → three -x 方向', () => {
    expect(planHeadingToThreeY(Math.PI)).toBeCloseTo(-Math.PI / 2, 6);
  });

  it('南向 (-π/2) → three +z 方向', () => {
    expect(planHeadingToThreeY(-Math.PI / 2)).toBeCloseTo(0, 6);
  });
});

describe('createPlanVehicleEntitiesLayer', () => {
  it('旧 plan 没有 vehicles：空组，不合成车', () => {
    const layer = createPlanVehicleEntitiesLayer(0.052);
    layer.sync(plan([]));
    expect(layer.group.children).toHaveLength(0);
    layer.dispose();
  });

  it('无边界场地：不虚构落点，组回原点', () => {
    const layer = createPlanVehicleEntitiesLayer(0.052);
    layer.sync({ vehicles: [vehicle()] } as unknown as SitePlanData);
    expect(layer.group.children).toHaveLength(0);
    expect(layer.group.position.toArray()).toEqual([0, 0.052, 0]);
    layer.dispose();
  });

  it('单台静态停放：落在落点槽位，无路线朝向 0，待补模型，标签挂 0 号', () => {
    const layer = createPlanVehicleEntitiesLayer(0.052);
    layer.sync(plan([vehicle()]));
    expect(layer.group.children).toHaveLength(1);
    const root = layer.group.children[0]!;
    // 组内 x = 10 - 50 = -40，z = -(20 - 30) = 10。
    expect(root.position.x).toBeCloseTo(-40, 6);
    expect(root.position.z).toBeCloseTo(10, 6);
    expect(root.rotation.y).toBeCloseTo(0, 6);
    expect(root.userData.modelMissing).toBe(true);
    expect(root.userData.carrier).toBe('vehicle');
    expect(root.userData.label).toContain('服务大巴车');
    layer.dispose();
  });

  it('多台并排：实例数 = count，标签只挂第一台', () => {
    const layer = createPlanVehicleEntitiesLayer(0.052);
    layer.sync(plan([vehicle({ count: 3 })]));
    expect(layer.group.children).toHaveLength(3);
    const [first, second, third] = layer.group.children;
    expect(first!.userData.label).not.toBeNull();
    expect(second!.userData.label).toBeNull();
    expect(third!.userData.label).toBeNull();
    // 并排：z 相同、x 递增。
    expect(first!.position.z).toBeCloseTo(second!.position.z, 6);
    expect(second!.position.x).toBeGreaterThan(first!.position.x);
    layer.dispose();
  });

  it('台数截断到 24（防 99 台把场景压垮）', () => {
    const layer = createPlanVehicleEntitiesLayer(0.052);
    layer.sync(plan([vehicle({ count: 99 })]));
    expect(layer.group.children).toHaveLength(24);
    layer.dispose();
  });

  it('有 modelSlug：modelMissing=false，不标待补', () => {
    const layer = createPlanVehicleEntitiesLayer(0.052);
    layer.sync(plan([vehicle({ modelSlug: 'car-park-and-road-vehicle-fleet-box-truck-4574c765' })]));
    expect(layer.group.children[0]!.userData.modelMissing).toBe(false);
    layer.dispose();
  });

  it('未登记车型跳过，不回落到别的车型', () => {
    const layer = createPlanVehicleEntitiesLayer(0.052);
    layer.sync(plan([vehicle({ type: 'spaceship' as never })]));
    expect(layer.group.children).toHaveLength(0);
    layer.dispose();
  });

  it('挂上车行流线：实例巡游，advance 沿路线位移', () => {
    const layer = createPlanVehicleEntitiesLayer(0.052);
    const route = northRoute();
    layer.sync(plan([vehicle({ routeIds: [route.id] })], [route]));
    expect(layer.group.children).toHaveLength(1);
    const root = layer.group.children[0]!;
    const before = root.position.clone();
    layer.advance(0.25);
    expect(root.position.distanceTo(before)).toBeGreaterThan(0.5);
    layer.dispose();
  });

  it('巡游实例朝向取路线切线（北向 → three π）', () => {
    const layer = createPlanVehicleEntitiesLayer(0.052);
    const route = northRoute();
    layer.sync(plan([vehicle({ routeIds: [route.id] })], [route]));
    const root = layer.group.children[0]!;
    expect(root.userData.modelMissing).toBe(true);
    // 首段向北：组内方向 (0, 0, -1)，rotation.y = atan2(0, -1) = π。
    expect(Math.abs(root.rotation.y - Math.PI)).toBeLessThan(1e-6);
    layer.dispose();
  });

  it('重复 sync 幂等，组落在场地中心', () => {
    const layer = createPlanVehicleEntitiesLayer(0.052);
    layer.sync(plan([vehicle({ count: 2 })]));
    layer.sync(plan([vehicle({ count: 2 })]));
    expect(layer.group.children).toHaveLength(2);
    expect(layer.group.position.toArray()).toEqual([50, 0.052, -30]);
    layer.dispose();
  });

  it('advance 对超长 delta 做上限保护（切标签页回来不瞬移）', () => {
    const layer = createPlanVehicleEntitiesLayer(0.052);
    const route = northRoute();
    layer.sync(plan([vehicle({ routeIds: [route.id] })], [route]));
    const root = layer.group.children[0]!;
    const before = root.position.clone();
    layer.advance(60);
    // 速度上限 5 m/s，step 封顶 0.25 s → 位移 < 1.25 m 量级。
    expect(root.position.distanceTo(before)).toBeLessThan(5 * 0.25 + 0.01);
    layer.dispose();
  });

  it('dispose 清空实例与几何体', () => {
    const layer = createPlanVehicleEntitiesLayer(0.052);
    layer.sync(plan([vehicle({ count: 2 })]));
    layer.dispose();
    expect(layer.group.children).toHaveLength(0);
  });
});
