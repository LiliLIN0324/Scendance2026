import { describe, expect, it } from 'vitest';
import {
  isSeatFacility,
  seatFacilityTargets,
  seatSurfaceHeight,
  seatTargetOf,
  type SeatFacilityInput,
} from './seat-placement';

const facility = (overrides: Partial<SeatFacilityInput> & { id: string; name: string }): SeatFacilityInput => ({
  position: { x: 0, y: 0 },
  ...overrides,
});

describe('isSeatFacility（可坐判定）', () => {
  it('椅子 / 沙发 / 长凳 slug 命中', () => {
    expect(isSeatFacility(facility({ id: 'c1', name: '餐椅', ref: 'bedroom-and-living-room-furniture-dining-chair-timber-b8b614f7' }))).toBe(true);
    expect(isSeatFacility(facility({ id: 's1', name: '三人沙发', ref: 'bedroom-and-living-room-furniture-sofa-three-seat-6be9b44b' }))).toBe(true);
    expect(isSeatFacility(facility({ id: 'b1', name: '游客长椅', ref: 'public-aquarium-and-marine-centre-visitor-bench-teal-d3402427' }))).toBe(true);
  });

  it('桌子 / 摊位 / 绿植不算可坐', () => {
    expect(isSeatFacility(facility({ id: 't1', name: '长桌', ref: 'medieval-monastery-and-scriptorium-trestle-table-2a0801e0' }))).toBe(false);
    expect(isSeatFacility(facility({ id: 'k1', name: '市集摊位', ref: 'harbor-and-tackle-fish-market-stall-d82006ea' }))).toBe(false);
    expect(isSeatFacility(facility({ id: 'p1', name: '盆栽', ref: 'care-home-and-day-room-potted-plant-tall-e50d9742' }))).toBe(false);
  });

  it('中文名关键词命中（无 slug 也能认）', () => {
    expect(isSeatFacility(facility({ id: 'n1', name: '木椅' }))).toBe(true);
    expect(isSeatFacility(facility({ id: 'n2', name: '双人沙发' }))).toBe(true);
    expect(isSeatFacility(facility({ id: 'n3', name: '长条凳' }))).toBe(true);
    expect(isSeatFacility(facility({ id: 'n4', name: '展台' }))).toBe(false);
  });
});

describe('seatTargetOf（落点 / 坐面 / 眼高）', () => {
  it('输出落点、朝向与坐姿眼高', () => {
    const target = seatTargetOf(
      facility({ id: 'c1', name: '餐椅', ref: 'some-chair', position: { x: 3, y: -4 }, rotationDeg: 90, height: 1.0 }),
      0.052,
    );
    expect(target).not.toBeNull();
    expect(target!.x).toBe(3);
    expect(target!.y).toBe(-4);
    expect(target!.rotationDeg).toBe(90);
    expect(target!.seatHeight).toBeCloseTo(0.45, 5);
    expect(target!.eyeY).toBeCloseTo(0.052 + 0.45 + 0.63, 5);
  });

  it('沙发坐面比椅子略低', () => {
    expect(seatSurfaceHeight(facility({ id: 's1', name: '沙发', ref: 'x-sofa-y' }))).toBeCloseTo(0.42, 5);
    expect(seatSurfaceHeight(facility({ id: 'c1', name: '餐椅', ref: 'x-chair-y' }))).toBeCloseTo(0.45, 5);
  });

  it('很矮的模型不会让坐面掉到地面以下', () => {
    expect(seatSurfaceHeight(facility({ id: 'low', name: '矮凳', height: 0.3 }))).toBeGreaterThanOrEqual(0.28);
  });

  it('不可坐返回 null', () => {
    expect(seatTargetOf(facility({ id: 't1', name: '长桌', ref: 'x-table-y' }))).toBeNull();
  });
});

describe('seatFacilityTargets（批量过滤）', () => {
  it('只保留可落座的座位', () => {
    const targets = seatFacilityTargets([
      facility({ id: 'c1', name: '餐椅', ref: 'x-chair-y' }),
      facility({ id: 't1', name: '长桌', ref: 'x-table-y' }),
      facility({ id: 's1', name: '沙发', ref: 'x-sofa-y', position: { x: 1, y: 2 } }),
    ]);
    expect(targets.map(target => target.id)).toEqual(['c1', 's1']);
  });
});
