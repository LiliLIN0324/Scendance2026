import { describe, expect, it } from 'vitest';
import {
  assignCrowdBehavior,
  crowdBehaviorForType,
  facilityWalkColliders,
  insetActivityBounds,
} from './crowd-behavior';

describe('crowdBehaviorForType', () => {
  it.each([
    ['security'],
    ['police'],
    ['medical'],
    ['fire'],
    ['exhibitor'],
    ['admin'],
    ['manager'],
    ['executive'],
  ])('classifies %s as guard', (typeId) => {
    expect(crowdBehaviorForType(typeId)).toBe('guard');
  });

  it.each([['staff'], ['volunteer'], ['performer'], ['audience']])(
    'classifies %s as wander',
    (typeId) => {
      expect(crowdBehaviorForType(typeId)).toBe('wander');
    },
  );

  it('defaults an unknown type to wander rather than pinning it on post', () => {
    expect(crowdBehaviorForType('some-new-type')).toBe('wander');
  });
});

describe('assignCrowdBehavior', () => {
  const placements = [
    { id: 'w1', crowdType: 'security' },
    { id: 'w2', crowdType: 'staff' },
    { id: 'w3', crowdType: 'volunteer' },
  ];

  it('route assignment wins over the type-based guard/wander classification', () => {
    const map = assignCrowdBehavior(placements, new Set(['w1']));
    expect(map.get('w1')).toBe('route');
    expect(map.get('w2')).toBe('wander');
    expect(map.get('w3')).toBe('wander');
  });

  it('keeps a guard type on post when it has no route', () => {
    const map = assignCrowdBehavior([{ id: 'g1', crowdType: 'police' }], new Set());
    expect(map.get('g1')).toBe('guard');
  });

  it('falls back to wander for an unknown type without a route', () => {
    const map = assignCrowdBehavior([{ id: 'u1', crowdType: 'mystery' }], new Set());
    expect(map.get('u1')).toBe('wander');
  });
});

describe('facilityWalkColliders', () => {
  it('maps a facility to an outdoor OBB collider with the north axis flipped to z', () => {
    const [collider] = facilityWalkColliders([
      { position: { x: 3, y: -4 }, rotationDeg: 90, size: { width: 1.8, depth: 0.6 } },
    ]);
    expect(collider?.cx).toBe(3);
    expect(collider?.cz).toBe(4);
    expect(collider?.hw).toBeCloseTo(0.9, 6);
    expect(collider?.hd).toBeCloseTo(0.3, 6);
    expect(collider?.outdoor).toBe(true);
  });

  it('drops zero-size facilities', () => {
    const colliders = facilityWalkColliders([
      { position: { x: 0, y: 0 }, size: { width: 0, depth: 1 } },
      { position: { x: 1, y: 1 }, size: { width: 1, depth: 0 } },
    ]);
    expect(colliders).toEqual([]);
  });
});

describe('insetActivityBounds', () => {
  it('shrinks the rectangle by the margin on every side', () => {
    const bounds = insetActivityBounds({ width: 20, depth: 12 }, 1);
    expect(bounds).toEqual({ minX: 1, maxX: 19, minZ: 1, maxZ: 11 });
  });

  it('clamps the margin to half the smaller dimension so the bounds do not invert', () => {
    const bounds = insetActivityBounds({ width: 4, depth: 6 }, 10);
    expect(bounds.minX).toBe(2);
    expect(bounds.maxX).toBe(2);
    expect(bounds.minZ).toBe(2);
    expect(bounds.maxZ).toBe(4);
  });
});
