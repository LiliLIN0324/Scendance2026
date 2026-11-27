import { describe, expect, it } from 'vitest';
import { buildWalkColliders, resolveWalkerPosition, resolveWalkerStep, walkerClearanceAt } from './walk-collision';
import type { FurnitureCategory, FurnitureItem } from './types';

const RADIUS = 0.3;
const ROOM = { roomWidth: 10, roomDepth: 10 };

function item(overrides: Partial<FurnitureItem> & { position: { x: number; z: number } }): FurnitureItem {
  return {
    id: 'item',
    type: 'sofa',
    name: 'Sofa',
    width: 2,
    depth: 1,
    height: 0.8,
    color: '#000',
    icon: '🛋️',
    rotation: 0,
    ...overrides,
  };
}

/** A 2 × 1 box centred at (0, -1.5): its near face is the line z = -1. */
const BOX = item({ position: { x: 0, z: -1.5 } });

const walk = (
  from: { x: number; z: number },
  to: { x: number; z: number },
  items: FurnitureItem[],
  options = ROOM
) => resolveWalkerPosition(from, to, RADIUS, items, options);

describe('resolveWalkerPosition — furniture', () => {
  it('walking head-on into a box stops at its surface', () => {
    const result = walk({ x: 0, z: 0 }, { x: 0, z: -1.5 }, [BOX]);
    expect(result.x).toBeCloseTo(0, 5);
    expect(result.z).toBeCloseTo(-1 + RADIUS, 3);
  });

  it('a diagonal push into a face slides along it', () => {
    const result = walk({ x: 0, z: 0 }, { x: 0.6, z: -1.5 }, [BOX]);
    expect(result.x).toBeCloseTo(0.6, 3);
    expect(result.z).toBeCloseTo(-1 + RADIUS, 3);
  });

  it('brushing a corner does not stick — the walker gets past', () => {
    // Box spans x ∈ [-1, 1]; walker at x = 1.2 overlaps the corner by 0.1.
    const result = walk({ x: 1.2, z: 0 }, { x: 1.2, z: -3 }, [BOX]);
    // Rounding the corner costs a few centimetres of travel, never the move.
    expect(result.z).toBeLessThan(-2.9);
    expect(result.x).toBeGreaterThanOrEqual(1.2);
    expect(result.x).toBeLessThan(1.2 + RADIUS);
  });

  it('a walker already inside a box is pushed out through the nearest face', () => {
    const result = walk({ x: 0.9, z: -1.5 }, { x: 0.9, z: -1.5 }, [BOX]);
    expect(result.z).toBeCloseTo(-1.5, 5);
    expect(result.x).toBeCloseTo(1 + RADIUS, 3);
  });

  it('respects a rotated item', () => {
    // 2 × 0.5 box at the origin: flat along X unrotated, along Z at 90°.
    const flat = item({ position: { x: 0, z: 0 }, depth: 0.5, rotation: 0 });
    const upright = item({ position: { x: 0, z: 0 }, depth: 0.5, rotation: Math.PI / 2 });
    // Walking along z at x = 0.9 hits the flat box and clears the upright one.
    expect(walk({ x: 0.9, z: 2 }, { x: 0.9, z: -2 }, [flat]).z).toBeCloseTo(0.25 + RADIUS, 3);
    expect(walk({ x: 0.9, z: 2 }, { x: 0.9, z: -2 }, [upright]).z).toBeCloseTo(-2, 3);
    // Walking along x at z = 0.9 clears the flat box and hits the upright one.
    expect(walk({ x: 2, z: 0.9 }, { x: -2, z: 0.9 }, [flat]).x).toBeCloseTo(-2, 3);
    expect(walk({ x: 2, z: 0.9 }, { x: -2, z: 0.9 }, [upright]).x).toBeCloseTo(0.25 + RADIUS, 3);
  });

  it('a 45° item blocks the diagonal its unrotated footprint leaves clear', () => {
    const flat = item({ position: { x: 0, z: 0 }, depth: 0.5, rotation: 0 });
    const diagonal = item({ position: { x: 0, z: 0 }, depth: 0.5, rotation: Math.PI / 4 });
    // (0.7, -0.7) lies inside the diagonal footprint; outside the flat one.
    const clear = walk({ x: 2, z: -2 }, { x: 0.7, z: -0.7 }, [flat]);
    expect(clear.x).toBeCloseTo(0.7, 3);
    expect(clear.z).toBeCloseTo(-0.7, 3);
    const blocked = walk({ x: 2, z: -2 }, { x: 0.7, z: -0.7 }, [diagonal]);
    // Stopped at the box's end: 1 (half-width) + radius along the width axis.
    expect(Math.hypot(blocked.x, blocked.z)).toBeCloseTo(1 + RADIUS, 2);
  });

  it('ignores low-profile items (rugs)', () => {
    const rug = item({ id: 'rug', type: 'rug', position: { x: 0, z: -1.5 }, height: 0.02 });
    const result = walk({ x: 0, z: 0 }, { x: 0, z: -3 }, [rug]);
    expect(result.z).toBeCloseTo(-3, 3);
  });

  it('ignores wall-mounted openings and cameras', () => {
    const wallItems = [
      item({ id: 'door', type: 'door', position: { x: 0, z: -1.5 }, width: 0.9, depth: 0.1, height: 2.05 }),
      item({ id: 'window', type: 'window', position: { x: 0, z: -2 }, width: 1.2, depth: 0.1, height: 1.2 }),
      item({ id: 'cam', type: 'security-camera', position: { x: 0, z: -2.5 }, width: 0.2, depth: 0.2, height: 0.2 }),
    ];
    const result = walk({ x: 0, z: 0 }, { x: 0, z: -3 }, wallItems);
    expect(result.z).toBeCloseTo(-3, 3);
  });

  it('ignores an unplaced item', () => {
    const { position: _placed, ...unplaced } = BOX;
    expect(walk({ x: 0, z: 0 }, { x: 0, z: -3 }, [unplaced]).z).toBeCloseTo(-3, 3);
  });

  it('walks under wall-hung decor: it hangs above the path (#376)', () => {
    for (const type of ['painting', 'mirror', 'wall-shelf', 'wall-clock', 'curtains']) {
      const decor = item({ type, width: 2, depth: 1, height: 0.6, position: { x: 0, z: -1.5 } });
      expect(buildWalkColliders([decor])).toEqual([]);
      expect(walk({ x: 0, z: 0 }, { x: 0, z: -3 }, [decor]).z).toBeCloseTo(-3, 3);
    }
  });
});

describe('resolveWalkerPosition — outdoor items', () => {
  const tree = (position: { x: number; z: number }) =>
    item({ id: 'tree', type: 'tree', category: 'outdoor' as FurnitureCategory, position, width: 1, depth: 1, height: 3 });

  it('a walker inside the room walks through outdoor items', () => {
    const result = walk({ x: 0, z: 0 }, { x: 0, z: -3 }, [tree({ x: 0, z: -1.5 })]);
    expect(result.z).toBeCloseTo(-3, 3);
  });

  it('a walker outside the room collides with outdoor items', () => {
    const result = walk({ x: 0, z: 8 }, { x: 0, z: 6 }, [tree({ x: 0, z: 6 })]);
    expect(result.z).toBeCloseTo(6.5 + RADIUS, 3);
  });

  it('a walker outside the room still collides with indoor items', () => {
    const bench = item({ id: 'bench', position: { x: 0, z: 6 }, width: 1, depth: 1 });
    const result = walk({ x: 0, z: 8 }, { x: 0, z: 6 }, [bench]);
    expect(result.z).toBeCloseTo(6.5 + RADIUS, 3);
  });

  it('without room dimensions everything is solid', () => {
    const result = walk({ x: 0, z: 0 }, { x: 0, z: -3 }, [tree({ x: 0, z: -1.5 })], {} as typeof ROOM);
    expect(result.z).toBeCloseTo(-1 + RADIUS, 3);
  });
});

describe('resolveWalkerStep', () => {
  it('writes into and returns the supplied output object', () => {
    const colliders = buildWalkColliders([BOX]);
    const out = { x: NaN, z: NaN };
    const result = resolveWalkerStep(colliders, { x: 0, z: 0 }, { x: 0, z: -2 }, RADIUS, out, ROOM);
    expect(result).toBe(out);
    expect(out.z).toBeCloseTo(-1 + RADIUS, 3);
  });

  it('a no-op move with nothing nearby leaves the position untouched', () => {
    const colliders = buildWalkColliders([BOX]);
    const out = { x: 0, z: 0 };
    resolveWalkerStep(colliders, { x: 3, z: 3 }, { x: 3, z: 3 }, RADIUS, out, ROOM);
    expect(out).toEqual({ x: 3, z: 3 });
  });
});

describe('walkerClearanceAt — 路线布点贴障预检', () => {
  it('measures the gap to a box face', () => {
    const colliders = buildWalkColliders([BOX]);
    // BOX 近面在 z = -1，点在 z = -0.8。
    expect(walkerClearanceAt(colliders, { x: 0, z: -0.8 }, ROOM)).toBeCloseTo(0.2, 6);
  });

  it('is zero inside a box', () => {
    const colliders = buildWalkColliders([BOX]);
    expect(walkerClearanceAt(colliders, { x: 0, z: -1.5 }, ROOM)).toBe(0);
  });

  it('honours rotation — a 90°-turned box swaps width/depth extents', () => {
    const rotated = item({ id: 'rot', position: { x: 0, z: 0 }, rotation: Math.PI / 2 });
    const colliders = buildWalkColliders([rotated]);
    // 2×1 旋 90° 后占 z ∈ [-1, 1]、x ∈ [-0.5, 0.5]。
    expect(walkerClearanceAt(colliders, { x: 0, z: 1.6 }, ROOM)).toBeCloseTo(0.6, 6);
    expect(walkerClearanceAt(colliders, { x: 1.0, z: 0 }, ROOM)).toBeCloseTo(0.5, 6);
  });

  it('picks the nearest of several boxes', () => {
    const far = item({ id: 'far', position: { x: 3, z: 0 }, width: 1, depth: 1 });
    const colliders = buildWalkColliders([BOX, far]);
    // 点 (0.6, 0)：到 BOX 近面 1.0，到 far 盒 1.9。
    expect(walkerClearanceAt(colliders, { x: 0.6, z: 0 }, ROOM)).toBeCloseTo(1.0, 6);
  });

  it('ignores outdoor boxes inside the room and counts them outside', () => {
    // 1×1 盒贴在房间东边界外沿：占 x ∈ [5, 6]。
    const outdoor = item({ id: 'out', position: { x: 5.5, z: 0 }, width: 1, depth: 1, category: 'outdoor' as FurnitureCategory });
    const colliders = buildWalkColliders([outdoor]);
    expect(walkerClearanceAt(colliders, { x: 4.5, z: 0 }, ROOM)).toBe(Infinity);
    expect(walkerClearanceAt(colliders, { x: 6.2, z: 0 }, ROOM)).toBeCloseTo(0.2, 6);
  });

  it('returns Infinity with no colliders and without room bounds', () => {
    expect(walkerClearanceAt([], { x: 0, z: 0 })).toBe(Infinity);
    const colliders = buildWalkColliders([BOX]);
    expect(walkerClearanceAt(colliders, { x: 100, z: 100 })).toBeGreaterThan(90);
  });
});
