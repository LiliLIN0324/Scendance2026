import { describe, expect, it } from 'vitest';
import { buildFurnitureSet } from './furniture-sets';
import { ringCenters, ringDiningSet } from './ring-seating';

describe('round-table ring', () => {
  it('puts chairs on one circle facing the table, not a square of four', () => {
    const items = buildFurnitureSet(ringDiningSet(), { idPrefix: 'ring', roomWidth: 20, roomDepth: 16 });
    const chairs = items.filter(item => item.type === 'dining-chair');
    expect(chairs.length).toBe(6);
    const radii = chairs.map(item => Math.hypot(item.position?.x ?? 0, item.position?.z ?? 0));
    expect(Math.max(...radii) - Math.min(...radii)).toBeLessThan(0.05);
    for (const chair of chairs) {
      const x = chair.position?.x ?? 0;
      const z = chair.position?.z ?? 0;
      const length = Math.hypot(x, z);
      const theta = chair.rotation ?? 0;
      const facing = Math.sin(theta) * (-x / length) + Math.cos(theta) * (-z / length);
      expect(facing).toBeGreaterThan(0.9);
    }
  });

  it('places several tables on a loop instead of two rows and two columns', () => {
    const sample = buildFurnitureSet(ringDiningSet(), { idPrefix: 'm', roomWidth: 30, roomDepth: 24 });
    const half = sample.reduce((max, item) => Math.max(max, Math.hypot(item.position?.x ?? 0, item.position?.z ?? 0) + Math.max(item.width, item.depth) / 2), 0);
    const centers = ringCenters({ x: -10, z: -7, w: 20, d: 14 }, { halfX: half, halfZ: half }, 0.4, 1.2);
    expect(centers.length).toBeGreaterThanOrEqual(3);
    const xs = new Set(centers.map(point => point.x.toFixed(2)));
    const zs = new Set(centers.map(point => point.z.toFixed(2)));
    expect(xs.size > 2 || zs.size > 2).toBe(true);
  });
});
