import { describe, expect, it } from 'vitest';
import {
  checkZoneRing,
  itemsInZoneRing,
  rectToRing,
  ringArea,
  ringStats,
  ringsOverlap,
  zoneContainsRing,
  zoneRingBounds,
  type RingPlacedItem,
} from './zone-polygon';
import type { PlanPoint } from '../../../../supabase/functions/_shared/site-plan';

const rect = (x0: number, y0: number, w: number, h: number): PlanPoint[] => [
  { x: x0, y: y0 },
  { x: x0 + w, y: y0 },
  { x: x0 + w, y: y0 + h },
  { x: x0, y: y0 + h },
];

function item(overrides: Partial<RingPlacedItem>): RingPlacedItem {
  return { id: 'item-1', ...overrides };
}

describe('rectToRing (D5-1)', () => {
  it('expands the rectangle into four corners in the template order, without a repeated closing point', () => {
    const ring = rectToRing({ x: -2, y: -1.5, w: 3, h: 2.5 });
    expect(ring).toEqual([
      { x: -2, y: -1.5 },
      { x: 1, y: -1.5 },
      { x: 1, y: 1 },
      { x: -2, y: 1 },
    ]);
  });

  it('rejects non-finite coordinates and non-positive sizes as a degenerate rectangle', () => {
    expect(rectToRing({ x: 0, y: 0, w: Number.NaN, h: 2 })).toBeNull();
    expect(rectToRing({ x: 0, y: 0, w: 0, h: 2 })).toBeNull();
    expect(rectToRing({ x: 0, y: 0, w: 3, h: -1 })).toBeNull();
  });
});

describe('zoneContainsRing (D5-1)', () => {
  const ring = rect(0, 0, 4, 3);

  it('counts an interior point as inside', () => {
    expect(zoneContainsRing(ring, { x: 1, y: 1 })).toBe(true);
  });

  it('keeps the inclusive edge rule: points on an edge or a vertex count as inside', () => {
    expect(zoneContainsRing(ring, { x: 0, y: 1 })).toBe(true); // west edge
    expect(zoneContainsRing(ring, { x: 2, y: 0 })).toBe(true); // south edge
    expect(zoneContainsRing(ring, { x: 4, y: 3 })).toBe(true); // vertex
  });

  it('rejects points outside the ring', () => {
    expect(zoneContainsRing(ring, { x: -1, y: 1 })).toBe(false);
    expect(zoneContainsRing(ring, { x: 2, y: 4 })).toBe(false);
    expect(zoneContainsRing(ring, { x: 5, y: 2 })).toBe(false);
  });

  it('returns false for a ring with fewer than three vertices', () => {
    expect(zoneContainsRing([{ x: 0, y: 0 }, { x: 4, y: 0 }], { x: 1, y: 1 })).toBe(false);
  });
});

describe('itemsInZoneRing / ringStats (D5-1)', () => {
  const ring = rect(0, 0, 4, 3);

  it('matches items by centre only and skips unplaced items, preserving order', () => {
    const inside = item({ id: 'in', price: 800, position: { x: 1, y: 1 } });
    // Centre just outside even though the 1×1 footprint overlaps the edge.
    const straddling = item({ id: 'out', position: { x: 4.6, y: 1 } });
    const unplaced = item({ id: 'none' });
    expect(itemsInZoneRing(ring, [inside, straddling, unplaced]).map((row) => row.id)).toEqual(['in']);
  });

  it('ringArea is w × h and ringStats sums prices of the items inside', () => {
    expect(ringArea(ring)).toBeCloseTo(12);
    const items = [
      item({ id: 'bed', price: 800, position: { x: 1, y: 1 } }),
      item({ id: 'lamp', price: 45, position: { x: 3, y: 2 } }),
      item({ id: 'sofa', price: 1200, position: { x: 8, y: 8 } }),
      item({ id: 'free', position: { x: 2, y: 1 } }),
    ];
    expect(ringStats(ring, items)).toEqual({ itemCount: 3, cost: 845, area: 12 });
  });
});

describe('ringsOverlap (D5-1)', () => {
  const a = rect(0, 0, 4, 3);

  it('treats shared edges and touching vertices as non-overlapping', () => {
    const sharedEdge = rect(4, 0, 2, 3);
    expect(ringsOverlap(a, sharedEdge)).toBe(false);
  });

  it('detects a real interior overlap', () => {
    const partial = rect(3, 0, 3, 3);
    expect(ringsOverlap(a, partial)).toBe(true);
  });

  it('treats a disjoint ring as non-overlapping', () => {
    const disjoint = rect(6, 0, 2, 3);
    expect(ringsOverlap(a, disjoint)).toBe(false);
  });
});

describe('checkZoneRing / zoneRingBounds (D5-1)', () => {
  it('accepts a valid rectangle ring and reports its area', () => {
    const check = checkZoneRing(rect(0, 0, 4, 3));
    expect(check.ok).toBe(true);
    if (check.ok) expect(check.areaM2).toBeCloseTo(12, 6);
  });

  it('rejects fewer than three vertices', () => {
    const check = checkZoneRing([{ x: 0, y: 0 }, { x: 4, y: 0 }]);
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.issue.code).toBe('too-few-vertices');
  });

  it('rejects a self-intersecting ring', () => {
    const bowtie: PlanPoint[] = [{ x: 0, y: 0 }, { x: 4, y: 3 }, { x: 4, y: 0 }, { x: 0, y: 3 }];
    const check = checkZoneRing(bowtie);
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.issue.code).toBe('self-intersection');
  });

  it('rejects a ring below the minimum zone area', () => {
    const check = checkZoneRing(rect(0, 0, 0.5, 0.5));
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.issue.code).toBe('area-below-min');
  });

  it('reports the bounding box and null for a malformed ring', () => {
    expect(zoneRingBounds(rect(0, 0, 4, 3))).toEqual({ minX: 0, minY: 0, maxX: 4, maxY: 3 });
    expect(zoneRingBounds([{ x: 0, y: 0 }, { x: 4, y: 0 }])).toBeNull();
  });
});
