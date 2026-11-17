import { describe, expect, it } from 'vitest';
import { boxCollider, resolveWalkerStep } from './walk-collision';
import {
  distanceToPolygon,
  planZoneWalk,
  pointInPolygon,
  projectOnPolyline,
  shouldEnterZone,
  zoneCrossingsAlong,
  zoneDwellSeconds,
  zoneEntryPoint,
  type ZoneRing,
} from './zone-walk';

const square: ZoneRing = {
  id: 'zone-a',
  polygon: [
    { x: -2, z: -2 },
    { x: 2, z: -2 },
    { x: 2, z: 2 },
    { x: -2, z: 2 },
  ],
};

describe('pointInPolygon / distanceToPolygon', () => {
  it('classifies inside, outside and boundary points', () => {
    expect(pointInPolygon({ x: 0, z: 0 }, square.polygon)).toBe(true);
    expect(pointInPolygon({ x: 2.2, z: 0 }, square.polygon)).toBe(false);
    // 边上算内：采样点恰好落在分区边界时不能算「还没进区」。
    expect(pointInPolygon({ x: 2, z: 1 }, square.polygon)).toBe(true);
    expect(distanceToPolygon({ x: 0, z: 0 }, square.polygon)).toBeCloseTo(2, 6);
    expect(distanceToPolygon({ x: 3, z: 0 }, square.polygon)).toBeCloseTo(1, 6);
  });

  it('treats a concave notch as outside', () => {
    const lShape = [
      { x: 0, z: 0 },
      { x: 4, z: 0 },
      { x: 4, z: 2 },
      { x: 2, z: 2 },
      { x: 2, z: 4 },
      { x: 0, z: 4 },
    ];
    expect(pointInPolygon({ x: 1, z: 3 }, lShape)).toBe(true);
    expect(pointInPolygon({ x: 3, z: 3 }, lShape)).toBe(false);
  });
});

describe('zoneCrossingsAlong', () => {
  it('finds where a line enters the zone from outside', () => {
    const line = [{ x: -6, z: 0 }, { x: 6, z: 0 }];
    const crossings = zoneCrossingsAlong(line, [square], 0.25);
    expect(crossings).toHaveLength(1);
    expect(crossings[0]!.zoneId).toBe('zone-a');
    expect(crossings[0]!.x).toBeCloseTo(-2, 1);
    expect(crossings[0]!.along).toBeCloseTo(4, 1);
  });

  it('ignores leaving the zone and walking entirely inside it', () => {
    // 起点即区内：不存在「从外往里」的穿越。
    expect(zoneCrossingsAlong([{ x: 0, z: 0 }, { x: 6, z: 0 }], [square])).toHaveLength(0);
    expect(zoneCrossingsAlong([{ x: -1, z: 0 }, { x: 1, z: 0 }], [square])).toHaveLength(0);
  });

  it('handles zones the line only grazes past', () => {
    const miss = [{ x: -6, z: 3 }, { x: 6, z: 3 }];
    expect(zoneCrossingsAlong(miss, [square])).toHaveLength(0);
  });
});

describe('zoneEntryPoint', () => {
  it('steps inward toward the centroid but stays inside', () => {
    const point = zoneEntryPoint({ x: -2, z: 0 }, square.polygon, 0.8);
    expect(point.x).toBeCloseTo(-1.2, 6);
    expect(point.z).toBeCloseTo(0, 6);
    expect(pointInPolygon(point, square.polygon)).toBe(true);
  });
});

describe('projectOnPolyline', () => {
  it('returns the arc length and gap of the closest point on the line', () => {
    const line = [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 10 }];
    const hit = projectOnPolyline(line, { x: 5, z: 2 });
    expect(hit.x).toBeCloseTo(5, 6);
    expect(hit.z).toBeCloseTo(0, 6);
    expect(hit.along).toBeCloseTo(5, 6);
    expect(hit.gap).toBeCloseTo(2, 6);
  });

  it('clamps beyond the ends instead of extending the line', () => {
    const line = [{ x: 0, z: 0 }, { x: 10, z: 0 }];
    expect(projectOnPolyline(line, { x: -3, z: 0 }).x).toBeCloseTo(0, 6);
    expect(projectOnPolyline(line, { x: 99, z: 0 }).x).toBeCloseTo(10, 6);
  });
});

describe('planZoneWalk', () => {
  const zone: ZoneRing = {
    id: 'zone-big',
    polygon: [
      { x: -4, z: -4 },
      { x: 4, z: -4 },
      { x: 4, z: 4 },
      { x: -4, z: 4 },
    ],
  };
  const bounds = { minX: -10, minZ: -10, maxX: 10, maxZ: 10 };

  it('walks from the entry to the far side and back, staying inside', () => {
    const plan = planZoneWalk(zone, { x: -3.6, z: 0 }, { bounds })!;
    expect(plan.zoneId).toBe('zone-big');
    expect(plan.points.length).toBeGreaterThan(2);
    expect(plan.points.length).toBeLessThanOrEqual(10);
    for (const point of plan.points) {
      expect(pointInPolygon(point, zone.polygon)).toBe(true);
      expect(distanceToPolygon(point, zone.polygon)).toBeGreaterThan(0.3);
    }
    const first = plan.points[0]!;
    const last = plan.points.at(-1)!;
    expect(Math.hypot(first.x - last.x, first.z - last.z)).toBeLessThan(3);
    // 去程要真的往里走，而不是原地打转。
    const farthest = plan.points.reduce((best, point) => (point.x > best.x ? point : best), plan.points[0]!);
    expect(farthest.x).toBeGreaterThan(1.5);
  });

  it('routes around a collider instead of through it', () => {
    const wall = boxCollider(0, 0, 0.4, 6, 0, true);
    const plan = planZoneWalk(zone, { x: -3.6, z: 0 }, { bounds, colliders: [wall], clearance: 0.45 })!;
    for (const point of plan.points) {
      expect(pointInPolygon(point, zone.polygon)).toBe(true);
      const dx = point.x - wall.cx;
      const dz = point.z - wall.cz;
      const lx = dx * wall.ax + dz * wall.az;
      const lz = dx * wall.bx + dz * wall.bz;
      expect(Math.abs(lx) > wall.hw || Math.abs(lz) > wall.hd).toBe(true);
      // 验收口径：区内每个点原地推挤为 0。
      const out = { x: point.x, z: point.z };
      resolveWalkerStep([wall], point, point, 0.45, out);
      expect(Math.hypot(out.x - point.x, out.z - point.z)).toBeLessThan(0.05);
    }
  });

  it('gives up on zones too narrow to move in', () => {
    const narrow: ZoneRing = {
      id: 'narrow',
      polygon: [{ x: -0.2, z: -3 }, { x: 0.2, z: -3 }, { x: 0.2, z: 3 }, { x: -0.2, z: 3 }],
    };
    expect(planZoneWalk(narrow, { x: 0, z: 0 }, { bounds })).toBeNull();
    expect(planZoneWalk({ id: 'empty', polygon: [] }, { x: 0, z: 0 }, { bounds })).toBeNull();
  });

  it('gives up when a collider swallows the whole zone', () => {
    const packed = boxCollider(0, 0, 7.4, 7.4, 0, true);
    expect(planZoneWalk(zone, { x: -3.6, z: 0 }, { bounds, colliders: [packed] })).toBeNull();
  });

  it('respects the walk bounds', () => {
    const clipped = { minX: -4, minZ: -1, maxX: 0, maxZ: 1 };
    const plan = planZoneWalk(zone, { x: -3.6, z: 0 }, { bounds: clipped })!;
    for (const point of plan.points) {
      expect(point.x).toBeGreaterThanOrEqual(clipped.minX);
      expect(point.x).toBeLessThanOrEqual(clipped.maxX);
      expect(point.z).toBeGreaterThanOrEqual(clipped.minZ);
      expect(point.z).toBeLessThanOrEqual(clipped.maxZ);
    }
  });
});

describe('deterministic zone decisions', () => {
  it('keeps the same answer for the same person and lap', () => {
    for (const id of ['p1', 'p2', 'person-42']) {
      const first = shouldEnterZone(id, 0);
      expect(shouldEnterZone(id, 0)).toBe(first);
      expect(shouldEnterZone(`${id}x`, 0)).toBe(shouldEnterZone(`${id}x`, 0));
    }
  });

  it('does not enter every lap, and does enter some of them', () => {
    const laps = Array.from({ length: 40 }, (_, lap) => shouldEnterZone('p1', lap));
    expect(laps.some(Boolean)).toBe(true);
    expect(laps.some((value) => !value)).toBe(true);
  });

  it('keeps dwell inside the requested range', () => {
    const dwell = zoneDwellSeconds('p1', 'zone-a');
    expect(dwell).toBeGreaterThanOrEqual(20);
    expect(dwell).toBeLessThanOrEqual(45);
    expect(zoneDwellSeconds('p1', 'zone-a')).toBe(dwell);
    expect(zoneDwellSeconds('p1', 'zone-a', [5, 6])).toBeGreaterThanOrEqual(5);
  });
});
