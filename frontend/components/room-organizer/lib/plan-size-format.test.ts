import { describe, expect, it } from 'vitest';
import { formatPlanObjectSize } from './plan-size-format';

describe('formatPlanObjectSize', () => {
  it('uses whole centimetres below one metre, rounding the model bounding box', () => {
    expect(formatPlanObjectSize(0.5201502442359924, 0.5390734076499993)).toBe('52 × 54 cm');
    expect(formatPlanObjectSize(0.45, 0.5)).toBe('45 × 50 cm');
  });

  it('uses metres with at most two decimals for normal footprints', () => {
    expect(formatPlanObjectSize(2, 2)).toBe('2 × 2 m');
    expect(formatPlanObjectSize(1.5, 0.9)).toBe('1.5 × 0.9 m');
    expect(formatPlanObjectSize(1.234, 0.567)).toBe('1.23 × 0.57 m');
  });

  it('never invents a size for missing or non-positive values', () => {
    expect(formatPlanObjectSize(0, 2)).toBe('尺寸未知');
    expect(formatPlanObjectSize(Number.NaN, 2)).toBe('尺寸未知');
    expect(formatPlanObjectSize(-1, 2)).toBe('尺寸未知');
    expect(formatPlanObjectSize(Number.POSITIVE_INFINITY, 2)).toBe('尺寸未知');
  });
});
