import { describe, expect, it } from "vitest";
import { largestWaterFreeRect, ringTouchesWater, type WaterRing } from "./agent-venue-range";

/**
 * 幕景Agent Test「锁定区域」（2026-11-22）：默认范围把河道包了进去（截图 E1/E2）。
 * 这里钉住两件纯几何事：贴水就不算可用候选、兜底范围收缩到无水子区。
 */
const rect = (x0: number, y0: number, x1: number, y1: number) => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

const waterArea = (points: { x: number; y: number }[]): WaterRing => ({
  id: "ofm:water/1",
  name: "河面",
  points,
  closed: true,
});

const waterLine = (points: { x: number; y: number }[]): WaterRing => ({
  id: "ofm:waterway/1",
  name: "中河",
  points,
  closed: false,
});

describe("ringTouchesWater（范围压水判定）", () => {
  it("水面横穿范围中段：算压水", () => {
    const ring = rect(-50, -50, 50, 50);
    const river = waterArea(rect(-100, -10, 100, 10));
    expect(ringTouchesWater(ring, [river])).toBe(true);
  });

  it("水面完全在范围外的远处：不算压水", () => {
    const ring = rect(-50, -50, 50, 50);
    const lake = waterArea(rect(200, 200, 300, 300));
    expect(ringTouchesWater(ring, [lake])).toBe(false);
  });

  it("水面贴边共线也算：岸边搭到水线的默认范围不当作可落地", () => {
    const ring = rect(-50, -50, 50, 50);
    const bank = waterArea(rect(-50, -50, 50, -50));
    expect(ringTouchesWater(ring, [bank])).toBe(true);
  });

  it("水道折线穿过范围：算压水（线状水没有闭合面也要拦）", () => {
    const ring = rect(-50, -50, 50, 50);
    const line = waterLine([{ x: -80, y: 0 }, { x: 80, y: 0 }]);
    expect(ringTouchesWater(ring, [line])).toBe(true);
  });

  it("范围整个落进湖里：算压水", () => {
    const ring = rect(-10, -10, 10, 10);
    const lake = waterArea(rect(-200, -200, 200, 200));
    expect(ringTouchesWater(ring, [lake])).toBe(true);
  });
});

describe("largestWaterFreeRect（兜底范围收缩到无水子区）", () => {
  it("西侧一条河占掉 40 米：结果落在东侧且不再碰水", () => {
    const footprint = rect(-50, -50, 50, 50);
    const river = waterArea(rect(-50, -60, -10, 60));
    const cleared = largestWaterFreeRect(footprint, [river]);

    expect(cleared).not.toBeNull();
    expect(Math.min(...cleared!.map((point) => point.x))).toBeGreaterThanOrEqual(-10);
    expect(ringTouchesWater(cleared!, [river])).toBe(false);
    // 东侧还有 60 米可用，收缩后不应小于 10 米最小边
    expect(Math.min(...cleared!.map((point) => point.x))).toBeLessThan(40);
  });

  it("没有水体几何时不下结论：回 null 由调用方保留原轮廓", () => {
    expect(largestWaterFreeRect(rect(-50, -50, 50, 50), [])).toBeNull();
  });

  it("只剩一条 6 米宽的干地：宁可回 null，也不裁出假范围", () => {
    const footprint = rect(-50, -50, 50, 50);
    const flood = waterArea(rect(-50, -60, 44, 60));
    expect(largestWaterFreeRect(footprint, [flood])).toBeNull();
  });

  it("水面只占一角：结果仍是块能用的矩形，且避开那一角", () => {
    const footprint = rect(-50, -50, 50, 50);
    const pond = waterArea(rect(10, 10, 60, 60));
    const cleared = largestWaterFreeRect(footprint, [pond]);

    expect(cleared).not.toBeNull();
    expect(ringTouchesWater(cleared!, [pond])).toBe(false);
    const width = Math.max(...cleared!.map((point) => point.x)) - Math.min(...cleared!.map((point) => point.x));
    const depth = Math.max(...cleared!.map((point) => point.y)) - Math.min(...cleared!.map((point) => point.y));
    expect(width * depth).toBeGreaterThan(3000);
  });
});
