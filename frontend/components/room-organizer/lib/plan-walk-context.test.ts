import { describe, expect, it } from 'vitest';
import {
  planFacilityColliders,
  planRouteFrame,
  planSeatAnchors,
  planWalkBounds,
  planZoneRings,
} from './plan-walk-context';
import type { PlanFacility, PlanPoint, PlanZone } from '../../../../supabase/functions/_shared/site-plan';

const boundary: PlanPoint[] = [
  { x: -10, y: -10 },
  { x: 10, y: -10 },
  { x: 10, y: 10 },
  { x: -10, y: 10 },
];
const metrics = { width: 20, depth: 20 };

/** 只填几何与可坐判定用得上的字段；其余由契约层负责，这里不重复造 schema。 */
function facility(overrides: Record<string, unknown> & { id: string }): PlanFacility {
  return {
    name: '设施',
    templateId: 'tent-3x3',
    position: { x: 0, y: 0 },
    rotationDeg: 0,
    size: { width: 6, depth: 4 },
    ...overrides,
  } as unknown as PlanFacility;
}

describe('planRouteFrame', () => {  it('centres the venue and flips north into −z', () => {
    const { toLocal } = planRouteFrame(boundary, metrics);
    expect(toLocal({ x: 0, y: 0 })).toEqual({ x: expect.closeTo(0, 6), z: expect.closeTo(0, 6) });
    expect(toLocal({ x: 5, y: 0 }).x).toBeCloseTo(5, 6);
    expect(toLocal({ x: 0, y: 5 }).z).toBeCloseTo(-5, 6);
    // 壳体坐标再减半个场地：外接框中心 → 0。
    expect(toLocal(boundary[0]!).x).toBeCloseTo(-10, 6);
    expect(toLocal(boundary[0]!).z).toBeCloseTo(10, 6);
  });
});

describe('planWalkBounds', () => {
  it('insets the venue by the route waypoint margin', () => {
    expect(planWalkBounds(metrics)).toEqual({ minX: -9.7, minZ: -9.7, maxX: 9.7, maxZ: 9.7 });
  });
});

describe('planFacilityColliders', () => {
  it('turns a solid facility into one box collider in the route frame', () => {
    const colliders = planFacilityColliders([facility({ id: 'stage' })], boundary, metrics);
    expect(colliders).toHaveLength(1);
    const box = colliders[0]!;
    expect(box.cx).toBeCloseTo(0, 6);
    expect(box.cz).toBeCloseTo(0, 6);
    expect(box.hw).toBeCloseTo(3, 6);
    expect(box.hd).toBeCloseTo(2, 6);
    expect(box.outdoor).toBe(false);
  });

  it('rotates the footprint with the facility', () => {
    const [box] = planFacilityColliders(
      [facility({ id: 'stage', rotationDeg: 90 })], boundary, metrics
    );
    // 90°：宽轴转到 z 方向，AABB 半宽/半深互换。
    expect(box!.aabbHalfW).toBeCloseTo(2, 6);
    expect(box!.aabbHalfD).toBeCloseTo(3, 6);
  });

  it('never blocks seats, tiny props, or anything already on a walked route', () => {
    const facilities = [
      facility({ id: 'chair', name: '户外椅', templateId: 'oneplan:scale:chair', size: { width: 0.5, depth: 0.5 } }),
      facility({ id: 'sign', name: '指示牌', templateId: 'sign', size: { width: 0.2, depth: 0.2 } }),
      facility({ id: 'tent', size: { width: 4, depth: 4 } }),
    ];
    // 流线穿过帐篷中心：新加的碰撞盒不该让既有人流掉头。
    const route = [{ x: -6, z: 0 }, { x: 6, z: 0 }];
    expect(planFacilityColliders(facilities, boundary, metrics, [route])).toEqual([]);
    // 没有流线踩到它时才立盒。
    const clear = planFacilityColliders(facilities, boundary, metrics, [[{ x: -6, z: 6 }, { x: 6, z: 6 }]]);
    expect(clear).toHaveLength(1);
    expect(clear[0]!.hw).toBeCloseTo(2, 6);
  });
});

describe('planSeatAnchors', () => {
  const chair = (rotationDeg: number) => facility({
    id: 'chair-1',
    name: '椅子',
    templateId: 'oneplan:scale:chair',
    size: { width: 0.5, depth: 0.5 },
    rotationDeg,
  });

  it('puts the sitter behind the seat with the chair facing north by default', () => {
    const [anchor] = planSeatAnchors([chair(0)], boundary, metrics);
    expect(anchor!.id).toBe('chair-1');
    // 朝向 π = 面朝北（−z）；坐姿锚点向南退 0.12 m，接近点再退 0.45 m。
    expect(anchor!.facing).toBeCloseTo(Math.PI, 6);
    expect(anchor!.x).toBeCloseTo(0, 6);
    expect(anchor!.z).toBeCloseTo(0.12, 6);
    expect(anchor!.approach.z).toBeCloseTo(0.57, 6);
    expect(anchor!.seatHeight).toBeCloseTo(0.45, 6);
  });

  it('follows the chair rotation', () => {
    const [anchor] = planSeatAnchors([chair(90)], boundary, metrics);
    // 面朝东（+x）：人退到椅子西侧。
    expect(anchor!.x).toBeCloseTo(-0.12, 6);
    expect(anchor!.z).toBeCloseTo(0, 6);
    expect(anchor!.approach.x).toBeCloseTo(-0.57, 6);
  });

  it('ignores non-seat facilities', () => {
    expect(planSeatAnchors([facility({ id: 'tent' })], boundary, metrics)).toEqual([]);
  });
});

describe('planZoneRings', () => {
  function zone(overrides: Record<string, unknown> & { id: string }): PlanZone {
    return {
      semantic: 'audience',
      name: '分区',
      polygon: [{ x: -2, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 4 }, { x: -2, y: 4 }],
      ...overrides,
    } as unknown as PlanZone;
  }

  it('converts ring points into the walking frame', () => {
    const [ring] = planZoneRings([zone({ id: 'zone-1' })], boundary, metrics);
    expect(ring!.id).toBe('zone-1');
    expect(ring!.polygon).toHaveLength(4);
    // 规划层 y=4（北）→ 行走层 z=−4；场地中心为原点。
    expect(ring!.polygon[2]!.x).toBeCloseTo(2, 6);
    expect(ring!.polygon[2]!.z).toBeCloseTo(-4, 6);
  });

  it('drops degenerate and too-small rings', () => {
    expect(planZoneRings([zone({ id: 'empty', polygon: [] })], boundary, metrics)).toEqual([]);
    expect(planZoneRings([
      zone({ id: 'tiny', polygon: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }] }),
    ], boundary, metrics)).toEqual([]);
  });
});
