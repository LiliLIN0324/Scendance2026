import { describe, expect, it } from 'vitest';
import { densityToSpec, describeDensity } from './density';

describe('densityToSpec', () => {
  it('1. d=0 → spacing=1.8, decor=2, variety=3（最松端）', () => {
    const s = densityToSpec(0);
    expect(s.spacingMeters).toBeCloseTo(1.8, 6);
    expect(s.decorCountPer10sqm).toBeCloseTo(2, 6);
    expect(s.candidateVariety).toBeCloseTo(3, 6);
  });

  it('2. d=1 → spacing=0.9, decor=12, variety=8（最密端）', () => {
    const s = densityToSpec(1);
    expect(s.spacingMeters).toBeCloseTo(0.9, 6);
    expect(s.decorCountPer10sqm).toBeCloseTo(12, 6);
    expect(s.candidateVariety).toBeCloseTo(8, 6);
  });

  it('3. d=0.5 线性中点 → spacing=1.35', () => {
    const s = densityToSpec(0.5);
    expect(s.spacingMeters).toBeCloseTo(1.35, 6);
  });

  it('4. 越界截断：d=2 → 按 1 算；d=-1 → 按 0 算', () => {
    const hi = densityToSpec(2);
    expect(hi.spacingMeters).toBeCloseTo(0.9, 6);
    const lo = densityToSpec(-1);
    expect(lo.spacingMeters).toBeCloseTo(1.8, 6);
  });
});

describe('describeDensity', () => {
  it('5. 三档文案：0.2 → 松；0.5 → 适中；0.9 → 密', () => {
    expect(describeDensity(0.2)).toBe('松');
    expect(describeDensity(0.5)).toBe('适中');
    expect(describeDensity(0.9)).toBe('密');
  });
});
