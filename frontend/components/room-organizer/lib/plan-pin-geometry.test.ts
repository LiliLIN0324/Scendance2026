import { describe, expect, it } from 'vitest';
import { INITIAL_LAYOUT } from './initial-layout';
import { hitPlanItem, pointInRoom, sheetFractionToWorld, worldToSheetFraction } from './plan-pin-geometry';

const floor = INITIAL_LAYOUT.floors[0]!;

describe('plan pin geometry', () => {
  it('round-trips a point on the same sheet as the svg export', () => {
    const fraction = { x: 0.42, y: 0.61 };
    const world = sheetFractionToWorld(INITIAL_LAYOUT, floor, fraction);
    expect(world).not.toBeNull();
    const back = worldToSheetFraction(INITIAL_LAYOUT, floor, world!);
    expect(back?.x).toBeCloseTo(fraction.x, 6);
    expect(back?.y).toBeCloseTo(fraction.y, 6);
  });

  it('treats the sheet center as the room center when the plan is symmetric', () => {
    const world = sheetFractionToWorld(INITIAL_LAYOUT, floor, { x: 0.5, y: 0.5 });
    expect(world).not.toBeNull();
    expect(pointInRoom(INITIAL_LAYOUT, world!)).toBe(true);
    expect(hitPlanItem(floor.items, world!.x, world!.z)).toBeNull();
  });

  it('hits a table and misses the aisle', () => {
    const table = floor.items[0]!;
    expect(hitPlanItem(floor.items, table.position!.x, table.position!.z)?.name).toBe('共创桌');
    expect(hitPlanItem(floor.items, 0, 0)).toBeNull();
    expect(pointInRoom(INITIAL_LAYOUT, { x: 20, z: 0 })).toBe(false);
    expect(sheetFractionToWorld(INITIAL_LAYOUT, floor, { x: -0.1, y: 0.5 })).toBeNull();
  });
});
