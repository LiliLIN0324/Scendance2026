import { describe, expect, it } from 'vitest';
import { planRouteCarriers } from '../../../../supabase/functions/_shared/site-plan';
import { speedRangeForCarrier } from './flow-sim';
import {
  polylineTangentRad,
  turnTowardRad,
  vehicleFollowerProfileFor,
  vehiclePreviewSpeed,
} from './vehicle-follower-profile';

describe('vehicle-follower-profile 预览档', () => {
  it('四档载体都有 profile，且 speedRange 与 speedRangeForCarrier 逐档恒等', () => {
    for (const carrier of planRouteCarriers) {
      const profile = vehicleFollowerProfileFor(carrier);
      expect(profile.carrier).toBe(carrier);
      // 同一引用：速度只有 flow-sim 一处来源，本模块不复制数字。
      expect(profile.speedRange).toBe(speedRangeForCarrier(carrier));
      expect(profile.speedRange[0]).toBe(speedRangeForCarrier(carrier)[0]);
      expect(profile.speedRange[1]).toBe(speedRangeForCarrier(carrier)[1]);
    }
  });

  it('车身长宽与转向角速度为正，且车身不短于车宽', () => {
    for (const carrier of planRouteCarriers) {
      const profile = vehicleFollowerProfileFor(carrier);
      expect(profile.bodyLengthM).toBeGreaterThan(0);
      expect(profile.bodyWidthM).toBeGreaterThan(0);
      expect(profile.turnRateRadPerSec).toBeGreaterThan(0);
      expect(profile.bodyLengthM).toBeGreaterThanOrEqual(profile.bodyWidthM);
      // 边界要在 note 里写明，后续 3D 面板直接展示这句话。
      expect(profile.note).toContain('不代表现场限速');
      expect(profile.note).toContain('通行能力');
    }
  });

  it('同一 carrier 返回同一引用（可缓存）且对象被冻结', () => {
    for (const carrier of planRouteCarriers) {
      const first = vehicleFollowerProfileFor(carrier);
      const second = vehicleFollowerProfileFor(carrier);
      expect(second).toBe(first);
      expect(Object.isFrozen(first)).toBe(true);
    }
    // 四档互不串档。
    const refs = planRouteCarriers.map((carrier) => vehicleFollowerProfileFor(carrier));
    expect(new Set(refs).size).toBe(planRouteCarriers.length);
  });

  it('转向速率排序 walk > trolley > vehicle', () => {
    const walk = vehicleFollowerProfileFor('walk').turnRateRadPerSec;
    const trolley = vehicleFollowerProfileFor('trolley').turnRateRadPerSec;
    const vehicle = vehicleFollowerProfileFor('vehicle').turnRateRadPerSec;
    expect(walk).toBeGreaterThan(trolley);
    expect(trolley).toBeGreaterThan(vehicle);
  });

  it('混合档速度=步行档，占位按在场最大的车（速度按人、占位按车）', () => {
    const mixed = vehicleFollowerProfileFor('mixed');
    const walk = vehicleFollowerProfileFor('walk');
    const vehicle = vehicleFollowerProfileFor('vehicle');

    // 数值上等于步行档（同一来源的相邻档），但仍逐档取自 speedRangeForCarrier。
    expect(mixed.speedRange).toEqual(walk.speedRange);
    expect(mixed.speedRange).toBe(speedRangeForCarrier('mixed'));

    expect(mixed.bodyLengthM).toBe(vehicle.bodyLengthM);
    expect(mixed.bodyWidthM).toBe(vehicle.bodyWidthM);
    expect(mixed.turnRateRadPerSec).toBe(vehicle.turnRateRadPerSec);
    expect(mixed.bodyLengthM).toBeGreaterThan(walk.bodyLengthM);
  });
});

describe('vehiclePreviewSpeed 预览速度插值', () => {
  it('unit=0/0.5/1 在区间内线性插值', () => {
    expect(vehiclePreviewSpeed('walk', 0)).toBeCloseTo(1.0, 10);
    expect(vehiclePreviewSpeed('walk', 0.5)).toBeCloseTo(1.15, 10);
    expect(vehiclePreviewSpeed('walk', 1)).toBeCloseTo(1.3, 10);

    expect(vehiclePreviewSpeed('vehicle', 0)).toBeCloseTo(3.0, 10);
    expect(vehiclePreviewSpeed('vehicle', 0.5)).toBeCloseTo(4.0, 10);
    expect(vehiclePreviewSpeed('vehicle', 1)).toBeCloseTo(5.0, 10);

    expect(vehiclePreviewSpeed('trolley', 0.5)).toBeCloseTo(0.75, 10);
  });

  it('越界 unit 夹紧到区间端点', () => {
    for (const carrier of planRouteCarriers) {
      const [min, max] = speedRangeForCarrier(carrier);
      expect(vehiclePreviewSpeed(carrier, -5)).toBeCloseTo(min, 10);
      expect(vehiclePreviewSpeed(carrier, 9)).toBeCloseTo(max, 10);
    }
  });

  it('NaN / Infinity 取下限', () => {
    for (const carrier of planRouteCarriers) {
      const [min] = speedRangeForCarrier(carrier);
      expect(vehiclePreviewSpeed(carrier, Number.NaN)).toBe(min);
      expect(vehiclePreviewSpeed(carrier, Number.POSITIVE_INFINITY)).toBe(min);
      expect(vehiclePreviewSpeed(carrier, Number.NEGATIVE_INFINITY)).toBe(min);
    }
  });
});

describe('polylineTangentRad 折线切线方位角', () => {
  it('直线段方位角为 0（+x 方向），反向为 π', () => {
    const line = [{ x: 0, y: 0 }, { x: 10, y: 0 }];
    expect(polylineTangentRad(line, 0)).toBeCloseTo(0, 10);
    expect(polylineTangentRad(line, 5)).toBeCloseTo(0, 10);
    expect(polylineTangentRad(line, 10)).toBeCloseTo(0, 10);

    const reversed = [{ x: 0, y: 0 }, { x: -10, y: 0 }];
    expect(Math.abs(polylineTangentRad(reversed, 5))).toBeCloseTo(Math.PI, 10);
  });

  it('直角拐点前后分别取前后段方向，拐点本身取后段', () => {
    const corner = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }];
    expect(polylineTangentRad(corner, 9)).toBeCloseTo(0, 10);
    expect(polylineTangentRad(corner, 10)).toBeCloseTo(Math.PI / 2, 10);
    expect(polylineTangentRad(corner, 15)).toBeCloseTo(Math.PI / 2, 10);
  });

  it('超长 dist 夹紧到末端方向，负 dist 取首段方向', () => {
    const corner = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }];
    expect(polylineTangentRad(corner, 999)).toBeCloseTo(Math.PI / 2, 10);
    expect(polylineTangentRad(corner, -3)).toBeCloseTo(0, 10);
  });

  it('重复点 / 零长段跳过，不制造 0 方向', () => {
    const repeated = [
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 5 },
    ];
    const totalLength = 15;
    expect(polylineTangentRad(repeated, 0)).toBeCloseTo(0, 10);
    expect(polylineTangentRad(repeated, 5)).toBeCloseTo(0, 10);
    expect(polylineTangentRad(repeated, 10)).toBeCloseTo(Math.PI / 2, 10);
    expect(polylineTangentRad(repeated, totalLength)).toBeCloseTo(Math.PI / 2, 10);
    expect(polylineTangentRad(repeated, 12)).toBeCloseTo(Math.PI / 2, 10);
  });

  it('点数 <2 或全零长返回 0', () => {
    expect(polylineTangentRad([], 0)).toBe(0);
    expect(polylineTangentRad([{ x: 3, y: 4 }], 1)).toBe(0);
    expect(
      polylineTangentRad([{ x: 1, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 1 }], 5),
    ).toBe(0);
  });
});

describe('turnTowardRad 限速最短弧转向', () => {
  it('小角度一步到位，精确等于目标', () => {
    expect(turnTowardRad(0, 0.2, 0.5)).toBeCloseTo(0.2, 10);
    expect(turnTowardRad(1, 1, 0.5)).toBeCloseTo(1, 10);
  });

  it('大角度被 maxDelta 限幅', () => {
    expect(turnTowardRad(0, 2, 0.5)).toBeCloseTo(0.5, 10);
    expect(turnTowardRad(0, -2, 0.5)).toBeCloseTo(-0.5, 10);
    // 限幅后仍朝目标方向推进，不反向。
    expect(turnTowardRad(0, 2, 0.5)).toBeGreaterThan(0);
  });

  it('跨 ±π 走最短弧（-3.10 → 3.10 不绕大圈）', () => {
    const next = turnTowardRad(-3.1, 3.1, 0.1);
    // 最短弧仅 0.0832 rad：结果应越过 -π 折到 +π 附近，而不是 6.2 rad 的大圈。
    expect(Math.abs(next - 3.1)).toBeLessThan(0.1);
    expect(next).toBeGreaterThan(3.0);
    expect(next).toBeLessThanOrEqual(Math.PI);

    const back = turnTowardRad(3.1, -3.1, 0.1);
    expect(Math.abs(back + 3.1)).toBeLessThan(0.1);
    expect(back).toBeLessThan(-3.0);
    expect(back).toBeGreaterThan(-Math.PI);
  });

  it('maxDelta=0 或非有限时原地不动（仍归一化到 (-π, π]）', () => {
    expect(turnTowardRad(0.3, 2, 0)).toBeCloseTo(0.3, 10);
    expect(turnTowardRad(0.3, 2, Number.NaN)).toBeCloseTo(0.3, 10);
    expect(turnTowardRad(0.3, 2, Number.POSITIVE_INFINITY)).toBeCloseTo(0.3, 10);

    const wrapped = turnTowardRad(5, 2, 0);
    expect(wrapped).toBeCloseTo(5 - Math.PI * 2, 10);
    expect(turnTowardRad(-Math.PI, 0, 0)).toBeCloseTo(Math.PI, 10);
  });

  it('输入 NaN 返回 0', () => {
    expect(turnTowardRad(Number.NaN, 1, 0.5)).toBe(0);
    expect(turnTowardRad(0, Number.NaN, 0.5)).toBe(0);
  });
});
