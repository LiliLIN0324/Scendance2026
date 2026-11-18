import { describe, expect, it } from 'vitest';
import { boxCollider } from './walk-collision';
import { describeSightline, sightlineHit } from './walk-sightline';

describe('sightlineHit', () => {
  const tent = boxCollider(5, 0, 2, 2, 0, true);

  it('finds the nearest blocker and how far along the sight it sits', () => {
    const hit = sightlineHit([tent], { x: 0, z: 0 }, { x: 10, z: 0 });
    expect(hit.blocked).toBe(true);
    expect(hit.distanceM).toBeCloseTo(4, 6);
    expect(hit.ratio).toBeCloseTo(0.4, 6);
    expect(hit.blockerIndex).toBe(0);
  });

  it('reports a clear sightline when the ray misses', () => {
    const hit = sightlineHit([tent], { x: 0, z: 5 }, { x: 10, z: 5 });
    expect(hit.blocked).toBe(false);
    expect(hit.distanceM).toBe(Infinity);
    expect(describeSightline(hit, '入口', '舞台')).toBe('入口 → 舞台：视线通畅');
  });

  it('ignores boxes beyond the target point', () => {
    const far = boxCollider(15, 0, 2, 2, 0, true);
    const hit = sightlineHit([far], { x: 0, z: 0 }, { x: 10, z: 0 });
    expect(hit.blocked).toBe(false);
  });

  it('honours the shoulder-radius padding', () => {
    const offset = boxCollider(5, 1.1, 2, 2, 0, true);
    expect(sightlineHit([offset], { x: 0, z: 0 }, { x: 10, z: 0 }).blocked).toBe(false);
    expect(sightlineHit([offset], { x: 0, z: 0 }, { x: 10, z: 0 }, 0.15).blocked).toBe(true);
  });

  it('describes a blocked sightline with distance and share of the ray', () => {
    const hit = sightlineHit([tent], { x: 0, z: 0 }, { x: 10, z: 0 });
    expect(describeSightline(hit, '入口', '舞台')).toBe('入口 → 舞台：被挡（最近 4.0 m，占视线 40%）');
  });
});
