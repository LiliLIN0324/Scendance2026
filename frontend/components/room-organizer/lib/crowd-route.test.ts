import { describe, expect, it } from 'vitest';
import { makeLayout } from './__testfixtures__/fixtures';
import {
  CROWD_MAX,
  createCrowdWalkers,
  crowdColliders,
  crowdHintsFromLayout,
  crowdPointInside,
  planCrowdRoute,
  stepCrowdWalker,
  type CrowdPoint,
  type CrowdRoutePlan,
  type CrowdVenue,
  type CrowdWalker,
} from './crowd-route';
import type { FurnitureItem, InteriorWall, RoomLayout } from './types';

function item(overrides: Partial<FurnitureItem> & { position: { x: number; z: number } }): FurnitureItem {
  return {
    id: 'item',
    type: 'sofa',
    name: 'Sofa',
    width: 2,
    depth: 1,
    height: 0.8,
    color: '#000',
    icon: '🛋',
    rotation: 0,
    ...overrides,
  };
}

function door(id: string, position: { x: number; z: number }, rotation = 0): FurnitureItem {
  return item({
    id,
    type: 'door',
    structuralOpeningId: id,
    name: '门洞',
    width: 1.8,
    depth: 0.16,
    height: 2.2,
    position,
    rotation,
  });
}

function perimeter(width: number, depth: number): InteriorWall[] {
  const halfW = width / 2;
  const halfD = depth / 2;
  return [
    { id: 's', x1: -halfW, z1: -halfD, x2: halfW, z2: -halfD, kind: 'exterior' },
    { id: 'e', x1: halfW, z1: -halfD, x2: halfW, z2: halfD, kind: 'exterior' },
    { id: 'n', x1: halfW, z1: halfD, x2: -halfW, z2: halfD, kind: 'exterior' },
    { id: 'w', x1: -halfW, z1: halfD, x2: -halfW, z2: -halfD, kind: 'exterior' },
  ];
}

/** L 的缺口在场景坐标 x>5 且 z>4，编辑器里是 x>0 且 z>0。 */
const L_POLYGON: readonly CrowdPoint[] = [
  { x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 4 }, { x: 5, z: 4 }, { x: 5, z: 8 }, { x: 0, z: 8 },
];

function maxStep(plan: CrowdRoutePlan): number {
  let max = 0;
  for (let i = 0; i < plan.waypoints.length; i++) {
    const a = plan.waypoints[i]!;
    const b = plan.waypoints[(i + 1) % plan.waypoints.length]!;
    max = Math.max(max, Math.hypot(b.x - a.x, b.z - a.z));
  }
  return max;
}

function inNotch(point: CrowdPoint): boolean {
  return point.x > 0.05 && point.z > 0.05;
}

function simulate(venue: CrowdVenue, plan: CrowdRoutePlan, seconds: number): CrowdWalker[] {
  const colliders = crowdColliders(venue);
  const walkers = createCrowdWalkers(plan, 3, colliders);
  const steps = Math.round(seconds * 30);
  for (let i = 0; i < steps; i++) {
    for (const walker of walkers) stepCrowdWalker(walker, plan, colliders, 1 / 30);
  }
  return walkers;
}

describe('planCrowdRoute', () => {
  it('walks the rectangle in short steps instead of one chord across the room', () => {
    const plan = planCrowdRoute({ roomWidth: 10, roomDepth: 8 });
    expect(plan.enteredFromEntrance).toBe(false);
    expect(plan.length).toBeGreaterThan(10);
    expect(maxStep(plan)).toBeLessThanOrEqual(plan.spacing * 1.25);
    for (const point of plan.waypoints) {
      expect(crowdPointInside(plan, point)).toBe(true);
      expect(Math.abs(point.x)).toBeLessThan(5);
      expect(Math.abs(point.z)).toBeLessThan(4);
    }
  });

  it('files in from the main door and goes around a sofa', () => {
    const venue: CrowdVenue = {
      roomWidth: 10,
      roomDepth: 8,
      mainEntranceId: 'door-1',
      interiorWalls: perimeter(10, 8),
      items: [
        door('door-1', { x: 0, z: -4 }),
        item({ id: 'sofa', position: { x: 0, z: 0 }, width: 3.2, depth: 1.2 }),
      ],
    };
    const plan = planCrowdRoute(venue);
    expect(plan.enteredFromEntrance).toBe(true);
    expect(plan.entranceIndex).toBe(0);
    expect(plan.waypoints[0]!.z).toBeGreaterThan(-4 + 0.3);
    expect(Math.abs(plan.waypoints[0]!.x)).toBeLessThan(1.2);
    expect(maxStep(plan)).toBeLessThanOrEqual(plan.spacing * 1.25);
    for (const point of plan.waypoints) {
      const besideSofa = Math.abs(point.z) < 0.55;
      if (besideSofa) expect(Math.abs(point.x)).toBeGreaterThan(1.7);
    }
    const [leader, , last] = simulate(venue, plan, 1);
    expect(Math.hypot(leader!.x - plan.waypoints[0]!.x, leader!.z - plan.waypoints[0]!.z)).toBeGreaterThan(0.6);
    expect(Math.hypot(last!.x - plan.waypoints[0]!.x, last!.z - plan.waypoints[0]!.z)).toBeLessThan(0.5);

    const travelled = simulate(venue, plan, 6)[0]!;
    expect(Math.hypot(travelled.x - plan.waypoints[0]!.x, travelled.z - plan.waypoints[0]!.z)).toBeGreaterThan(2);
    expect(Math.abs(travelled.x) > 1.7 || Math.abs(travelled.z) > 0.7).toBe(true);
  });

  it('keeps an L-shaped outline and still enters from the door on its south edge', () => {
    const venue: CrowdVenue = {
      roomWidth: 10,
      roomDepth: 8,
      polygon: L_POLYGON,
      mainEntranceId: 'door-1',
      items: [door('door-1', { x: -3, z: -4 })],
    };
    const plan = planCrowdRoute(venue);
    expect(plan.enteredFromEntrance).toBe(true);
    expect(plan.length).toBeGreaterThan(6);
    expect(plan.waypoints.some((point) => point.z > 1 && point.x < 0)).toBe(true);
    for (let i = 0; i < plan.waypoints.length; i++) {
      const a = plan.waypoints[i]!;
      const b = plan.waypoints[(i + 1) % plan.waypoints.length]!;
      expect(inNotch(a)).toBe(false);
      const steps = 8;
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        expect(inNotch({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t })).toBe(false);
      }
    }
    const before = { x: plan.waypoints[0]!.x, z: plan.waypoints[0]!.z };
    const after = simulate(venue, plan, 5)[0]!;
    expect(Math.hypot(after.x - before.x, after.z - before.z)).toBeGreaterThan(2);
    expect(inNotch(after)).toBe(false);
    expect(crowdPointInside(plan, after)).toBe(true);
  });

  it('does not treat a window or a missing door as the main entrance', () => {
    const windowOnly = planCrowdRoute({
      roomWidth: 10,
      roomDepth: 8,
      mainEntranceId: 'win',
      items: [item({ id: 'win', type: 'window', position: { x: 0, z: -4 }, width: 1.4, height: 1.2 })],
    });
    expect(windowOnly.enteredFromEntrance).toBe(false);
    const missing = planCrowdRoute({ roomWidth: 10, roomDepth: 8, mainEntranceId: 'gone', items: [] });
    expect(missing.enteredFromEntrance).toBe(false);
    expect(missing.length).toBeGreaterThan(10);
  });

  it('is deterministic and caps the crowd at three', () => {
    const venue: CrowdVenue = { roomWidth: 12, roomDepth: 9, mainEntranceId: 'door-1', items: [door('door-1', { x: 0, z: -4.5 })] };
    expect(planCrowdRoute(venue)).toEqual(planCrowdRoute(venue));
    const plan = planCrowdRoute(venue);
    expect(createCrowdWalkers(plan, 8)).toHaveLength(CROWD_MAX);
    expect(createCrowdWalkers(plan, 3)).toEqual(createCrowdWalkers(plan, 3));
  });
});

describe('crowdHintsFromLayout', () => {
  it('uses the v2 main entrance and polygon, not a leftover v1 gate', () => {
    const polygon = [...L_POLYGON];
    const layout = makeLayout({
      backendSceneV2: {
        venue: { polygon, site: { mainEntrance: { openingId: 'main-door' } } },
      } as NonNullable<RoomLayout['backendSceneV2']>,
      backendVenue: {
        entrances: [{ id: 'old-gate', position: { x: 1, z: 0 }, width: 1.2 }],
        polygon: [{ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 1, z: 1 }],
      } as NonNullable<RoomLayout['backendVenue']>,
    });
    expect(crowdHintsFromLayout(layout)).toEqual({ polygon, mainEntranceId: 'main-door' });
  });

  it('falls back to the v1 entrance list when there is no scene v2', () => {
    const layout = makeLayout({
      backendVenue: {
        entrances: [{ id: 'gate', position: { x: 4, z: 0 }, width: 2 }],
      } as NonNullable<RoomLayout['backendVenue']>,
    });
    expect(crowdHintsFromLayout(layout).mainEntranceId).toBe('gate');
    expect(crowdHintsFromLayout(makeLayout()).mainEntranceId).toBeUndefined();
  });

  it('leaves the entrance empty for an outdoor shell that has no door', () => {
    const layout = makeLayout({
      backendSceneV2: { venue: { site: { indoorOutdoor: 'outdoor' } } } as NonNullable<RoomLayout['backendSceneV2']>,
    });
    expect(crowdHintsFromLayout(layout).mainEntranceId).toBeUndefined();
    expect(crowdHintsFromLayout(layout).polygon).toBeUndefined();
  });
});
