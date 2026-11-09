import { describe, expect, it } from 'vitest';
import { findSeat, seatSurfaceHeight } from './walk-seat';
import type { FurnitureItem } from './types';

function item(overrides: Partial<FurnitureItem> & { position: { x: number; z: number } }): FurnitureItem {
  return {
    id: 'seat',
    type: 'chair',
    name: '椅子',
    width: 0.46,
    depth: 0.46,
    height: 0.9,
    color: '#000',
    icon: '🪑',
    rotation: 0,
    ...overrides,
  };
}

describe('findSeat', () => {
  it('站在椅子边上就能坐', () => {
    const chair = item({ position: { x: 0, z: 0 } });
    const seat = findSeat([chair], { x: 0, z: 0.6 });
    expect(seat?.id).toBe('seat');
    expect(seat?.x).toBe(0);
    expect(seat?.z).toBe(0);
  });

  it('离得远就返回 null', () => {
    const chair = item({ position: { x: 0, z: 0 } });
    expect(findSeat([chair], { x: 0, z: 3 })).toBeNull();
  });

  it('桌子、地毯、绿植都不能坐', () => {
    const items = [
      item({ id: 'table', type: 'table', position: { x: 0, z: 0 }, width: 1.4, depth: 0.8 }),
      item({ id: 'rug', type: 'rug', position: { x: 0, z: 0 }, height: 0.02 }),
      item({ id: 'tree', type: 'tree', position: { x: 0, z: 0 } }),
    ];
    expect(findSeat(items, { x: 0, z: 0.5 })).toBeNull();
  });

  it('取最近的那一件', () => {
    const near = item({ id: 'near', position: { x: 0, z: 0 } });
    const far = item({ id: 'far', position: { x: 0, z: 1.2 }, width: 0.46, depth: 0.46 });
    expect(findSeat([far, near], { x: 0, z: 0.55 })?.id).toBe('near');
  });

  it('旋转过的坐具按自己的朝向算距离', () => {
    // 2 × 0.5 的长凳绕 Y 转 90°：它沿 Z 方向长，点 (1.0, 0) 已经够不着。
    const bench = item({ id: 'bench', type: 'bench', position: { x: 0, z: 0 }, width: 2, depth: 0.5, rotation: Math.PI / 2 });
    expect(findSeat([bench], { x: 0, z: 1.2 })?.id).toBe('bench');
    expect(findSeat([bench], { x: 1.2, z: 0 })).toBeNull();
  });

  it('楼层标高加进眼高', () => {
    const chair = item({ position: { x: 0, z: 0 } });
    const seat = findSeat([chair], { x: 0, z: 0.6 }, 3.2);
    expect(seat?.eyeY).toBeCloseTo(3.2 + (seat?.seatHeight ?? 0) + 0.63, 5);
  });
});

describe('seatSurfaceHeight', () => {
  it('沙发坐面比椅子略低', () => {
    expect(seatSurfaceHeight(item({ type: 'sofa', position: { x: 0, z: 0 } }))).toBe(0.42);
    expect(seatSurfaceHeight(item({ type: 'chair', position: { x: 0, z: 0 } }))).toBe(0.45);
  });

  it('很矮的模型不会让坐面掉到地面以下', () => {
    expect(seatSurfaceHeight(item({ height: 0.3, position: { x: 0, z: 0 } }))).toBeGreaterThanOrEqual(0.28);
  });
});
