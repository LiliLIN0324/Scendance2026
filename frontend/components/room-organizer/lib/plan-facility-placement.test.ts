import { describe, expect, it } from 'vitest';
import {
  facilityPlacementSkipReason,
  facilityToPlacement,
  planFacilitiesToPlacements,
} from './plan-facility-placement';
import { planPointOfScene } from './plan-item-bridge';
import type { PlanFacility } from '../../../../supabase/functions/_shared/site-plan';

const UUID_A = '11111111-1111-1111-1111-111111111111';
const UUID_B = '22222222-2222-2222-2222-222222222222';

function makeFacility(overrides: Partial<PlanFacility> = {}): PlanFacility {
  return {
    id: UUID_A,
    templateId: 'dining-table',
    name: '主桌',
    position: { x: 1, y: 2 },
    rotationDeg: 0,
    size: { width: 1.8, depth: 1.8 },
    ...overrides,
  } as PlanFacility;
}

describe('plan-facility-placement（B-3a plan 设施 → 试算层入参适配器）', () => {
  it('坐标换算：plan (x=1, y=2, 90°) → placement (x=1, z=-2, rotation=-π/2)', () => {
    const placement = facilityToPlacement(
      makeFacility({ position: { x: 1, y: 2 }, rotationDeg: 90 }),
    );
    expect(placement.x).toBe(1);
    expect(placement.z).toBe(-2);
    expect(placement.rotation).toBeCloseTo(-Math.PI / 2, 12);
  });

  it('抹掉 -0：rotationDeg 0 与 y 0 都落成正零', () => {
    const placement = facilityToPlacement(
      makeFacility({ position: { x: 0, y: 0 }, rotationDeg: 0 }),
    );
    expect(Object.is(placement.x, 0)).toBe(true);
    expect(Object.is(placement.z, 0)).toBe(true);
    expect(Object.is(placement.rotation, 0)).toBe(true);
  });

  it('width/depth/name/color/heightM 直通；round 标 tableShape', () => {
    const placement = facilityToPlacement(makeFacility({
      size: { width: 2.4, depth: 1.2 },
      name: '签到台',
      color: '#336699',
      heightM: 1.1,
      shape: 'round',
    }));
    expect(placement.spec).toMatchObject({
      type: 'dining-table',
      name: '签到台',
      category: '',
      width: 2.4,
      depth: 1.2,
      height: 1.1,
      color: '#336699',
      icon: '',
      tableShape: 'round',
    });
  });

  it('缺 heightM 兜底 0；shape rect 不带 tableShape 键', () => {
    const placement = facilityToPlacement(makeFacility({ shape: 'rect' }));
    expect(placement.spec.height).toBe(0);
    expect(placement.spec).not.toHaveProperty('tableShape');
  });

  it('zoneId 缺省空串；zoneType 缺省 reserved；zoneTypeFor 可覆盖', () => {
    const fallback = facilityToPlacement(makeFacility());
    expect(fallback.zoneId).toBe('');
    expect(fallback.zoneType).toBe('reserved');

    const overridden = facilityToPlacement(
      makeFacility({ zoneId: UUID_B }),
      { zoneTypeFor: () => 'checkin' },
    );
    expect(overridden.zoneId).toBe(UUID_B);
    expect(overridden.zoneType).toBe('checkin');
  });

  it('批量顺序保留，非法件进 skipped 并写明原因；入参不被 mutate', () => {
    const good = makeFacility({ id: UUID_A, name: '圆桌' });
    const badSize = makeFacility({ id: UUID_B, name: '超小件', size: { width: 0, depth: 1 } });
    const badPos = makeFacility({ id: UUID_B, name: '无坐标', position: { x: NaN, y: 1 } });
    const input = [good, badSize, badPos];
    const before = JSON.stringify(input);

    const { placements, skipped } = planFacilitiesToPlacements(input);

    expect(placements).toHaveLength(1);
    expect(placements[0]!.spec.name).toBe('圆桌');
    expect(skipped).toHaveLength(2);
    expect(skipped[0]).toMatchObject({ id: UUID_B, name: '超小件' });
    expect(skipped[0]!.reason).toBeTruthy();
    expect(skipped[1]!.name).toBe('无坐标');
    expect(skipped[1]!.reason).toBeTruthy();
    expect(JSON.stringify(input)).toBe(before);
  });

  it('skipReason 对合法件返回 null，对非法件给出原因', () => {
    expect(facilityPlacementSkipReason(makeFacility())).toBeNull();
    expect(facilityPlacementSkipReason(
      makeFacility({ size: { width: -1, depth: 1 } }),
    )).toBeTruthy();
    expect(facilityPlacementSkipReason(
      makeFacility({ position: { x: 1, y: Infinity } }),
    )).toBeTruthy();
  });

  it('奇偶对照：与 plan-item-bridge 逆变换互证，位置/朝向往返一致、符号不翻错', () => {
    // bridge 正变换（shell → plan）：planPointOfScene(x, z) = { x, y: -z }；
    // 本适配器是逆变换（plan → shell）：z = -y。往返一圈位置应回到原值。
    const shell = { x: 3, z: -2 };
    const plan = planPointOfScene(shell.x, shell.z);
    const byPosition = facilityToPlacement(
      makeFacility({ position: { x: plan.x, y: plan.y }, rotationDeg: 0 }),
    );
    expect(byPosition.x).toBeCloseTo(shell.x, 12);
    expect(byPosition.z).toBeCloseTo(shell.z, 12);

    // 朝向：bridge L152 `rotationDeg = -(item.rotation) · 180/π`；
    // 逆变换 `rotation = -rotationDeg · π/180`。壳体弧度 π/2 往返应回到 π/2。
    const shellRotation = Math.PI / 2;
    const deg = -(shellRotation * 180 / Math.PI);
    const byRotation = facilityToPlacement(makeFacility({ rotationDeg: deg }));
    expect(byRotation.rotation).toBeCloseTo(shellRotation, 12);

    // 符号约定钉死：plan 逆时针 90° → shell 朝向 -π/2（顺时针）。
    const ccw90 = facilityToPlacement(makeFacility({ rotationDeg: 90 }));
    expect(ccw90.rotation).toBeCloseTo(-Math.PI / 2, 12);
  });

  it('契约外字段不进 placement；不设 ownerTableId', () => {
    const facility = makeFacility({
      groupId: 'g1',
      locked: true,
      finish: 'linen',
      notes: '备注',
      vendorName: '供应商',
      unitPrice: 100,
      modelOverride: 'slug',
    } as PlanFacility);
    const placement = facilityToPlacement(facility);

    expect(placement).not.toHaveProperty('ownerTableId');
    expect(Object.keys(placement).sort()).toEqual(
      ['spec', 'x', 'z', 'rotation', 'zoneId', 'zoneType'].sort(),
    );
    expect(Object.keys(placement.spec).sort()).toEqual(
      ['type', 'name', 'category', 'width', 'depth', 'height', 'color', 'icon'].sort(),
    );
  });
});
