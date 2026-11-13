import { describe, expect, it } from 'vitest';
import {
  boundaryCentroid,
  constrainWorldToBoundary,
  enuToWorld,
  pointInBoundaryRing,
  worldToEnu,
  type WalkBoundaryPoint,
} from './outdoor-walk-boundary';

const SQUARE: WalkBoundaryPoint[] = [
  { x: -10, y: -10 },
  { x: 10, y: -10 },
  { x: 10, y: 10 },
  { x: -10, y: 10 },
];

describe('pointInBoundaryRing', () => {
  it('reports a point inside the square', () => {
    expect(pointInBoundaryRing({ x: 0, y: 0 }, SQUARE)).toBe(true);
    expect(pointInBoundaryRing({ x: 5, y: -7 }, SQUARE)).toBe(true);
  });

  it('reports a point outside the square', () => {
    expect(pointInBoundaryRing({ x: 20, y: 0 }, SQUARE)).toBe(false);
    expect(pointInBoundaryRing({ x: -20, y: 5 }, SQUARE)).toBe(false);
    expect(pointInBoundaryRing({ x: 0, y: 12 }, SQUARE)).toBe(false);
  });

  it('treats points on an edge or vertex as inside', () => {
    expect(pointInBoundaryRing({ x: 10, y: 0 }, SQUARE)).toBe(true);
    expect(pointInBoundaryRing({ x: 0, y: -10 }, SQUARE)).toBe(true);
    expect(pointInBoundaryRing({ x: 10, y: 10 }, SQUARE)).toBe(true);
    expect(pointInBoundaryRing({ x: -10, y: -10 }, SQUARE)).toBe(true);
  });

  it('does not judge an empty / under-started ring (no boundary yet)', () => {
    expect(pointInBoundaryRing({ x: 999, y: 999 }, [])).toBe(true);
    expect(pointInBoundaryRing({ x: 999, y: 999 }, [{ x: 0, y: 0 }, { x: 5, y: 5 }])).toBe(true);
  });

  it('works on a translated (offset) site', () => {
    const offset: WalkBoundaryPoint[] = [
      { x: 490, y: 290 },
      { x: 510, y: 290 },
      { x: 510, y: 310 },
      { x: 490, y: 310 },
    ];
    expect(pointInBoundaryRing({ x: 500, y: 300 }, offset)).toBe(true);
    expect(pointInBoundaryRing({ x: 0, y: 0 }, offset)).toBe(false);
  });

  it('works on a right triangle', () => {
    const triangle: WalkBoundaryPoint[] = [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 0, y: 20 },
    ];
    expect(pointInBoundaryRing({ x: 2, y: 2 }, triangle)).toBe(true);
    expect(pointInBoundaryRing({ x: 15, y: 15 }, triangle)).toBe(false);
  });
});

describe('world ↔ ENU mapping', () => {
  it('round-trips through worldToEnu and enuToWorld', () => {
    const world = { x: 12.5, z: -7.25 };
    const enu = worldToEnu(world.x, world.z);
    expect(enu).toEqual({ x: 12.5, y: 7.25 });
    expect(enuToWorld(enu.x, enu.y)).toEqual(world);
  });

  it('maps north to -z', () => {
    expect(enuToWorld(3, 8)).toEqual({ x: 3, z: -8 });
    expect(worldToEnu(3, -8)).toEqual({ x: 3, y: 8 });
  });
});

describe('boundaryCentroid', () => {
  it('averages the ring points', () => {
    expect(boundaryCentroid(SQUARE)).toEqual({ x: 0, y: 0 });
    expect(boundaryCentroid([])).toBeNull();
  });
});

describe('constrainWorldToBoundary', () => {
  it('keeps a fully inside step', () => {
    const out = constrainWorldToBoundary({ x: 0, z: 0 }, { x: 3, z: -2 }, SQUARE);
    expect(out).toEqual({ x: 3, z: -2 });
  });

  it('reverts the axis that leaves the ring and keeps the other', () => {
    // to ENU (20, -3): x east of the square, y still inside.
    const out = constrainWorldToBoundary({ x: 0, z: 0 }, { x: 20, z: 3 }, SQUARE);
    expect(out.x).toBeCloseTo(0, 10);
    expect(out.z).toBeCloseTo(3, 10);
  });

  it('reverts both axes for a diagonal escape', () => {
    const out = constrainWorldToBoundary({ x: 0, z: 0 }, { x: 20, z: -20 }, SQUARE);
    expect(out.x).toBeCloseTo(0, 10);
    expect(out.z).toBeCloseTo(0, 10);
  });

  it('passes the move through untouched when the ring is under-started', () => {
    const out = constrainWorldToBoundary({ x: 0, z: 0 }, { x: 999, z: 999 }, []);
    expect(out).toEqual({ x: 999, z: 999 });
  });
});
