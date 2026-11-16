import { describe, expect, it } from 'vitest';
import { vehicleMarkerSpecs } from './vehicle-markers';
import type { PlanRoute, PlanVehicle, SitePlanData } from '../../../../supabase/functions/_shared/site-plan';

const vehicle = (patch: Partial<PlanVehicle> = {}): PlanVehicle => ({
  id: '55555555-5555-4555-8555-555555555555',
  type: 'coach',
  count: 1,
  position: { x: 10, y: 20 },
  notes: '',
  ...patch,
});

const plan = (vehicles: PlanVehicle[], routes: PlanRoute[] = []): SitePlanData => ({
  vehicles, routes,
}) as unknown as SitePlanData;

describe('vehicle-marker-specs（车辆 2D 标记规格）', () => {
  it('旧 plan 没有 vehicles：返回空数组，不合成', () => {
    expect(vehicleMarkerSpecs({} as unknown as SitePlanData)).toEqual([]);
    expect(vehicleMarkerSpecs(plan([]))).toEqual([]);
  });

  it('单台：落在实体坐标，无路线时朝向 0，缺模型标待补', () => {
    const specs = vehicleMarkerSpecs(plan([vehicle()]));
    expect(specs).toHaveLength(1);
    expect(specs[0]).toMatchObject({
      slotIndex: 0,
      x: 10,
      y: 20,
      headingRad: 0,
      lengthM: 4.8,
      widthM: 1.9,
      modelMissing: true,
      count: 1,
    });
    expect(specs[0]!.label).toContain('服务大巴车');
    expect(specs[0]!.label).toContain('待补模型');
  });

  it('多台：按槽位并排展开，标签只挂第一台', () => {
    const specs = vehicleMarkerSpecs(plan([vehicle({ count: 3 })]));
    expect(specs).toHaveLength(3);
    expect(specs.map((spec) => spec.slotIndex)).toEqual([0, 1, 2]);
    expect(specs[0]!.label).not.toBeNull();
    expect(specs[1]!.label).toBeNull();
    expect(specs[2]!.label).toBeNull();
    // 并排：y 相同、x 递增。
    expect(specs[0]!.y).toBe(specs[1]!.y);
    expect(specs[1]!.x).toBeGreaterThan(specs[0]!.x);
  });

  it('台数上限截断到 24（防 99 台把画布压垮）', () => {
    expect(vehicleMarkerSpecs(plan([vehicle({ count: 99 })]))).toHaveLength(24);
  });

  it('有 modelSlug 且有路线：标 modelMissing=false，朝向取路线切线', () => {
    const routes = [{
      id: '66666666-6666-4666-8666-666666666666',
      kind: 'vehicle',
      name: '',
      points: [{ x: 0, y: 0 }, { x: 0, y: 50 }],
      oneWay: false,
      notes: '',
    }] as unknown as PlanRoute[];
    const specs = vehicleMarkerSpecs(plan([vehicle({
      modelSlug: 'car-park-and-road-vehicle-fleet-box-truck-4574c765',
      routeIds: [routes[0]!.id],
    })], routes));
    expect(specs[0]!.modelMissing).toBe(false);
    expect(specs[0]!.label).not.toContain('待补模型');
    // 沿 +y 北向：平面数学角 π/2（0 = +x 东）。
    expect(Math.abs(specs[0]!.headingRad - Math.PI / 2)).toBeLessThan(1e-6);
  });

  it('实体自带色优先，缺省用车行色', () => {
    const withColor = vehicleMarkerSpecs(plan([vehicle({ color: '#123456' })]));
    expect(withColor[0]!.color).toBe('#123456');
    const plain = vehicleMarkerSpecs(plan([vehicle()]));
    expect(plain[0]!.color).toMatch(/^#/);
  });

  it('未登记车型跳过，不回落到别的车型', () => {
    const specs = vehicleMarkerSpecs(plan([vehicle({ type: 'spaceship' as never })]));
    expect(specs).toEqual([]);
  });
});
