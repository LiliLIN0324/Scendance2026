import { describe, expect, it } from 'vitest';
import { planFacilityColliders, planRouteFrame } from './plan-walk-context';
import { planPlayerColliders, planPlayerSiteCenter } from './plan-player-colliders';
import type { PlanFacility, PlanPoint } from '../../../../supabase/functions/_shared/site-plan';

/** 刻意不用「场地中心在原点」的边界：那样局部系与世界系重合，测不出换算漏项。 */
const boundary: PlanPoint[] = [
  { x: 100, y: 30 },
  { x: 130, y: 30 },
  { x: 130, y: 60 },
  { x: 100, y: 60 },
];
const metrics = { width: 30, depth: 30 };

function facility(overrides: Record<string, unknown> & { id: string }): PlanFacility {
  return {
    name: '设施',
    templateId: 'tent-3x3',
    position: { x: 120, y: 50 },
    rotationDeg: 0,
    size: { width: 6, depth: 4 },
    ...overrides,
  } as unknown as PlanFacility;
}

describe('planPlayerSiteCenter', () => {
  it('takes the venue bbox centre and flips north into −z', () => {
    expect(planPlayerSiteCenter(boundary)).toEqual({ x: 115, z: -45 });
  });

  it('falls back to the origin when there is no ring', () => {
    expect(planPlayerSiteCenter([])).toEqual({ x: 0, z: 0 });
  });
});

describe('planPlayerColliders', () => {
  it('moves the facility box from the route frame into the player world frame', () => {
    const [box] = planPlayerColliders([facility({ id: 'tent' })], boundary, metrics);
    expect(box).toBeDefined();
    // 设施在 ENU (120, 50) → 世界 (x 东, z = −北) 就是 (120, −50)。
    expect(box!.cx).toBeCloseTo(120, 6);
    expect(box!.cz).toBeCloseTo(-50, 6);
    // 盒心必须与 3D 里该设施网格的世界落点一致：sceneLayer 偏移 + 壳体落位。
    const center = planPlayerSiteCenter(boundary);
    const { toLocal } = planRouteFrame(boundary, metrics);
    const mesh = toLocal({ x: 120, y: 50 });
    expect(box!.cx).toBeCloseTo(mesh.x + center.x, 6);
    expect(box!.cz).toBeCloseTo(mesh.z + center.z, 6);
  });

  it('keeps the footprint half extents and rotation', () => {
    const [upright] = planPlayerColliders([facility({ id: 'tent' })], boundary, metrics);
    expect(upright!.hw).toBeCloseTo(3, 6);
    expect(upright!.hd).toBeCloseTo(2, 6);

    const [turned] = planPlayerColliders(
      [facility({ id: 'tent', rotationDeg: 90 })], boundary, metrics
    );
    // 90°：宽轴转到 z 方向，AABB 半宽/半深互换。
    expect(turned!.aabbHalfW).toBeCloseTo(2, 6);
    expect(turned!.aabbHalfD).toBeCloseTo(3, 6);
  });

  it('still blocks seats, tiny props, and facilities that sit on a walked route', () => {
    const facilities = [
      facility({ id: 'chair', name: '户外椅', templateId: 'oneplan:scale:chair', size: { width: 0.5, depth: 0.5 } }),
      facility({ id: 'sign', name: '指示牌', templateId: 'sign', size: { width: 0.2, depth: 0.2 } }),
      facility({ id: 'tent', size: { width: 4, depth: 4 } }),
    ];
    const local = planRouteFrame(boundary, metrics).toLocal({ x: 120, y: 50 });
    const route = [{ x: local.x - 6, z: local.z }, { x: local.x + 6, z: local.z }];

    // 人群口径：压在流线上的帐篷不挡（否则人流掉头）。
    expect(planFacilityColliders(facilities, boundary, metrics, [route])).toEqual([]);
    // 玩家口径：座位与小件照旧不挡，帐篷照旧挡——流线不是玩家的通行证。
    const player = planPlayerColliders(facilities, boundary, metrics);
    expect(player).toHaveLength(1);
    expect(player[0]!.hw).toBeCloseTo(2, 6);
    expect(player[0]!.cx).toBeCloseTo(120, 6);
  });

  it('returns no boxes for an empty facility list', () => {
    expect(planPlayerColliders([], boundary, metrics)).toEqual([]);
  });
});
