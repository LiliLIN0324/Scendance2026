import { describe, expect, it } from 'vitest';
import { estimateCapacity } from './capacity-meter';

describe('estimateCapacity', () => {
  it('20m × 15m = 300m² → usable≈255.5、maxItems≈102', () => {
    const est = estimateCapacity(20, 15, 0);
    expect(est.areaM2).toBe(300);
    expect(est.aisleBandM2).toBeCloseTo(27, 1);
    // 退界带 = 0.5 * (20 + 15) = 17.5；usable = 300 - 27 - 17.5 = 255.5
    expect(est.usableM2).toBeCloseTo(255.5, 1);
    expect(est.maxItems).toBe(102);
  });

  it('placed=30 → remaining=72、ratio≈0.29', () => {
    const est = estimateCapacity(20, 15, 30);
    expect(est.placedItems).toBe(30);
    expect(est.remaining).toBe(72);
    expect(est.ratio).toBeCloseTo(30 / 102, 1);
  });

  it('placed 超过 maxItems → remaining 不为负、ratio 可大于 1', () => {
    const est = estimateCapacity(10, 10, 500);
    expect(est.remaining).toBe(0);
    expect(est.ratio).toBeGreaterThan(1);
  });

  it('极小场地 → maxItems 不为负', () => {
    const est = estimateCapacity(1, 1, 0);
    expect(est.maxItems).toBeGreaterThanOrEqual(0);
    expect(est.remaining).toBeGreaterThanOrEqual(0);
  });

  it('0 宽或 0 深 → 不抛错、maxItems=0、ratio=0', () => {
    const est = estimateCapacity(0, 10, 5);
    expect(est.maxItems).toBe(0);
    expect(est.ratio).toBe(0);
    expect(est.remaining).toBe(0);
  });
});
