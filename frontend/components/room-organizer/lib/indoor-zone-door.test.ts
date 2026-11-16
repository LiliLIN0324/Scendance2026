import { describe, expect, it } from 'vitest';
import { indoorZoneDoor } from './outdoor-plan-canvas';

const rect = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 4 },
  { x: 0, y: 4 },
];

describe('indoorZoneDoor', () => {
  it('把门放在最长那段边的中点上', () => {
    const door = indoorZoneDoor(rect);
    expect(door).not.toBeNull();
    const midX = (door!.hinge.x + door!.latch.x) / 2;
    const midY = (door!.hinge.y + door!.latch.y) / 2;
    // 10×4 的矩形，最长边是 y=0 那条，门洞中点落在 (5, 0)。
    expect(midX).toBeCloseTo(5, 5);
    expect(midY).toBeCloseTo(0, 5);
  });

  it('门洞只占这段边的一小段，不会开成一整面墙', () => {
    const door = indoorZoneDoor(rect)!;
    const width = Math.hypot(door.latch.x - door.hinge.x, door.latch.y - door.hinge.y);
    // half = 边长×0.18，所以门洞全宽 = 边长×0.36。
    expect(width).toBeCloseTo(10 * 0.36, 5);
    expect(width).toBeLessThan(10);
  });

  it('开门方向指向分区内部', () => {
    const door = indoorZoneDoor(rect)!;
    // 质心在 (5,2)，门在 y=0 的边上，所以内部方向是 +y。
    expect(door.inward.y).toBeGreaterThan(0.9);
    expect(Math.abs(door.inward.x)).toBeLessThan(0.1);
  });

  it('长边超过 25 米时门洞仍有上限，不会随边无限变宽', () => {
    const wide = [
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 6 },
      { x: 0, y: 6 },
    ];
    const door = indoorZoneDoor(wide)!;
    const width = Math.hypot(door.latch.x - door.hinge.x, door.latch.y - door.hinge.y);
    expect(width).toBeCloseTo(2.5 * 2, 5);
  });

  it('点不够或退化成一个点时给 null，不画门', () => {
    expect(indoorZoneDoor([])).toBeNull();
    expect(indoorZoneDoor([{ x: 0, y: 0 }, { x: 5, y: 0 }])).toBeNull();
    expect(indoorZoneDoor([{ x: 1, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 1 }])).toBeNull();
  });
});
