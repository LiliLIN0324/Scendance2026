import { describe, expect, it } from 'vitest';
import { createFlowWalkers, pointAtDistance, polylineLength, routeDensity, stepFlowWalkers, walkerCountFor, walkerPoints } from './flow-sim';
import type { PlanRoute } from '../../../../supabase/functions/_shared/site-plan';

function route(id: string, kind: PlanRoute['kind'], points: { x: number; y: number }[]): PlanRoute {
  return { id, kind, name: id, points, oneWay: false, notes: '' };
}

/** 100m 直线（0,0)→(100,0)。 */
const LINE = route('r1', 'pedestrian', [{ x: 0, y: 0 }, { x: 100, y: 0 }]);

describe('flow-sim（V-4b 流动模拟）', () => {
  it('walkerCountFor 按长度每 8m 一个、夹在 2–12，车行减半上限', () => {
    expect(walkerCountFor(LINE)).toBe(12); // 100m/8=12.5 → 12
    const short = route('r2', 'pedestrian', [{ x: 0, y: 0 }, { x: 10, y: 0 }]);
    expect(walkerCountFor(short)).toBe(2); // 下限 2
    const long = route('r3', 'pedestrian', [{ x: 0, y: 0 }, { x: 500, y: 0 }]);
    expect(walkerCountFor(long)).toBe(12); // 上限 12
    const vehicle = route('r4', 'vehicle', [{ x: 0, y: 0 }, { x: 500, y: 0 }]);
    expect(walkerCountFor(vehicle)).toBeLessThanOrEqual(6); // 车行 cap 6
  });

  it('pointAtDistance 弧长插值准确', () => {
    expect(pointAtDistance(LINE.points, 40)).toEqual({ x: 40, y: 0 });
    const elbow = route('r5', 'pedestrian', [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 20 }]);
    expect(pointAtDistance(elbow.points, 40)).toEqual({ x: 30, y: 10 }); // 30 + 10
    expect(pointAtDistance(LINE.points, 999)).toEqual({ x: 100, y: 0 }); // 超长夹紧
  });

  it('createFlowWalkers 双向对开（含逆向），总数=各流线布点之和', () => {
    const walkers = createFlowWalkers([LINE, LINE]);
    expect(walkers.length).toBe(24);
    expect(walkers.some(w => w.dir === -1)).toBe(true);
    expect(walkers.some(w => w.dir === 1)).toBe(true);
    // 速度都在 1.0–1.3
    for (const walker of walkers) {
      expect(walker.speed).toBeGreaterThanOrEqual(1.0);
      expect(walker.speed).toBeLessThanOrEqual(1.3);
    }
  });

  it('stepFlowWalkers 匀速前进、端点回绕；dt=0 不动', () => {
    const walkers = createFlowWalkers([LINE]);
    const stepped = stepFlowWalkers(walkers, [LINE], 1);
    for (let i = 0; i < walkers.length; i += 1) {
      const delta = Math.abs(stepped[i]!.dist - walkers[i]!.dist);
      // 回绕后 delta 也应等于 speed*1（模 100）——直接验证总位移一致
      expect(Math.abs(delta - walkers[i]!.speed) % 100).toBeLessThan(1e-6);
      expect(stepped[i]!.dist).toBeGreaterThanOrEqual(0);
      expect(stepped[i]!.dist).toBeLessThanOrEqual(100);
    }
    const frozen = stepFlowWalkers(walkers, [LINE], 0);
    expect(frozen.map(w => w.dist)).toEqual(walkers.map(w => w.dist));
  });

  it('routeDensity 按每 10m 人数、walkerPoints 与步进坐标一致', () => {
    const walkers = createFlowWalkers([LINE]);
    const density = routeDensity(walkers, [LINE]);
    expect(density[0]).toBeCloseTo(12 / 100 * 10, 5); // 12 人/100m → 1.2 人/10m
    const stepped = stepFlowWalkers(walkers, [LINE], 2);
    const points = walkerPoints(stepped, [LINE]);
    expect(points.length).toBe(stepped.length);
    for (let i = 0; i < points.length; i += 1) {
      expect(points[i]!.x).toBeCloseTo(pointAtDistance(LINE.points, stepped[i]!.dist).x, 5);
    }
    expect(polylineLength(LINE.points)).toBe(100);
  });
});
