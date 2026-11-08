import { describe, expect, it } from 'vitest';
import { hasCollisions } from './geometry';
import { makeFloor, makeItem, makeLayout } from './__testfixtures__/fixtures';
import { proposeRestArea } from './rest-area-plan';

describe('rest area candidate', () => {
  it('adds a named editable area and sample bench without changing a locked item', () => {
    const locked = makeItem({ id: 'locked', name: '锁定桌', type: 'table', locked: true, width: 2, depth: 2, position: { x: -3, z: -2 } });
    const layout = makeLayout({ width: 12, height: 9, floors: [makeFloor({ items: [locked] })] });
    const result = proposeRestArea(layout, 0);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const floor = result.layout.floors[0]!;
    expect(floor.items.find(item => item.id === 'locked')).toEqual(locked);
    const bench = floor.items.find(item => item.name === '休息长椅（示意）')!;
    const zone = floor.zones?.find(item => item.name === '休息区（待核验）')!;
    expect(bench).toBeTruthy();
    expect(zone).toBeTruthy();
    expect(bench.position!.x).toBeGreaterThanOrEqual(zone.x);
    expect(bench.position!.x).toBeLessThanOrEqual(zone.x + zone.w);
    expect(hasCollisions(bench, floor.items, layout.width, layout.height)).toBe(false);
    expect(layout.floors[0]!.items).toEqual([locked]);
    expect(layout.floors[0]!.zones ?? []).toEqual([]);
  });

  it('reports a bounded search failure without claiming the venue is impossible', () => {
    const occupied = makeItem({ id: 'locked', name: '锁定物', type: 'table', locked: true, width: 8, depth: 8, height: 1, position: { x: 0, z: 0 } });
    const layout = makeLayout({ width: 8, height: 8, floors: [makeFloor({ items: [occupied] })] });
    const result = proposeRestArea(layout, 0);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('不能据此断定场地无解');
    expect(layout.floors[0]!.items).toEqual([occupied]);
  });

  it('keeps away from known door markers instead of inventing an entrance', () => {
    const door = makeItem({ id: 'door', name: '门', type: 'door', width: 1.2, depth: 0.12, position: { x: -3, z: -3 } });
    const layout = makeLayout({ width: 10, height: 8, floors: [makeFloor({ items: [door] })] });
    const result = proposeRestArea(layout, 0);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const zone = result.layout.floors[0]!.zones![0]!;
    const dx = Math.max(zone.x - door.position!.x, 0, door.position!.x - (zone.x + zone.w));
    const dz = Math.max(zone.z - door.position!.z, 0, door.position!.z - (zone.z + zone.d));
    expect(Math.hypot(dx, dz)).toBeGreaterThanOrEqual(1 + door.width / 2);
  });

  it('avoids a backend venue entrance even when its marker is absent from the floor', () => {
    const entrance = { id: '31000000-0000-4000-8000-000000000001', position: { x: 1, z: 0 }, width: 1.2 };
    const layout = makeLayout({ width: 10, height: 8, backendVenue: { width: 10, depth: 8, height: 3, shape: 'rectangle', entrances: [entrance] }, floors: [makeFloor()] });
    const result = proposeRestArea(layout, 0);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const zone = result.layout.floors[0]!.zones![0]!;
    const x = entrance.position.x - layout.width / 2, z = entrance.position.z - layout.height / 2;
    const dx = Math.max(zone.x - x, 0, x - (zone.x + zone.w));
    const dz = Math.max(zone.z - z, 0, z - (zone.z + zone.d));
    expect(Math.hypot(dx, dz)).toBeGreaterThanOrEqual(1 + entrance.width / 2);
  });

  it('does not place a rest area inside the missing corner of a concave venue', () => {
    const top = makeItem({ id: 'top', type: 'table', name: '现有物料', locked: true, width: 10, depth: 3, position: { x: 0, z: -2.5 } });
    const left = makeItem({ id: 'left', type: 'table', name: '现有物料', locked: true, width: 3, depth: 5, position: { x: -3.5, z: 1.5 } });
    const layout = makeLayout({ width: 10, height: 8, backendVenue: { width: 10, depth: 8, height: 3, shape: 'polygon',
      polygon: [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 3 }, { x: 3, z: 3 }, { x: 3, z: 8 }, { x: 0, z: 8 }], entrances: [] },
    floors: [makeFloor({ items: [top, left] })] });
    const result = proposeRestArea(layout, 0);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('不能据此断定场地无解');
  });
});
