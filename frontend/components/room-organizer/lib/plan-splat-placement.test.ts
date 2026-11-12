import { describe, expect, it } from 'vitest';

import {
  splatPlacementOffset,
  splatVenueSpan,
  splatWorldPosition,
} from './plan-splat-placement';

const METRICS = { width: 100, depth: 80 };

describe('splatWorldPosition', () => {
  it('与 outdoor-plan-3d 的 placeAt + 组偏移同口径：world.x = shell.x，world.z = shell.z - depth', () => {
    expect(splatWorldPosition({ x: 0, z: 0 }, METRICS)).toEqual({ x: 0, y: 0, z: -80 });
    expect(splatWorldPosition({ x: 50, z: 40 }, METRICS)).toEqual({ x: 50, y: 0, z: -40 });
    expect(splatWorldPosition({ x: 100, z: 80 }, METRICS)).toEqual({ x: 100, y: 0, z: 0 });
  });

  it('场地中心（壳体 w/2, d/2）落在世界 (w/2, -d/2)', () => {
    expect(splatWorldPosition({ x: METRICS.width / 2, z: METRICS.depth / 2 }, METRICS)).toEqual({
      x: 50,
      y: 0,
      z: -40,
    });
  });

  it('平面 ENU 原点在西南角时等价于 three.x = plan.x、three.z = -plan.y', () => {
    // 壳体 z = (maxY - plan.y) = 80 - plan.y ⇒ world.z = shell.z - 80 = -plan.y
    const planY = 30;
    const shell = { x: 25, z: 80 - planY };
    expect(splatWorldPosition(shell, METRICS)).toEqual({ x: 25, y: 0, z: -planY });
  });
});

describe('splatPlacementOffset', () => {
  it('默认标定（origin 为原点）时直接给目标点', () => {
    const target = { x: 50, y: 0, z: -40 };
    expect(splatPlacementOffset(target, { x: 0, z: 0 })).toEqual(target);
  });

  it('抵消标定原点：最终世界中心恒等于目标（origin + position = target）', () => {
    const target = { x: 50, y: 0, z: -40 };
    const origin = { x: 12, z: -7 };
    const offset = splatPlacementOffset(target, origin);
    expect(offset).toEqual({ x: 38, y: 0, z: -33 });
    expect({ x: origin.x + offset.x, z: origin.z + offset.z }).toEqual({ x: target.x, z: target.z });
  });
});

describe('splatVenueSpan', () => {
  it('取场地对角尺寸', () => {
    expect(splatVenueSpan({ width: 30, depth: 40 })).toBe(50);
    expect(splatVenueSpan(METRICS)).toBeCloseTo(Math.hypot(100, 80), 10);
  });
});
