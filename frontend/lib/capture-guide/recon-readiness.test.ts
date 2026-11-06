import { describe, expect, it } from 'vitest';
import { assessReconReadiness, RECON_RULES } from './recon-readiness';

/** 两张哈希的距离 14：既不是近似重复（>6），也没有重叠断档（<=22）。 */
const A = '000000000000007f';
const B = '0000000000003f80';

function frames(count: number, overrides: Partial<{ sharpness: number; meanLuma: number }>[] = []) {
  return Array.from({ length: count }, (_, index) => ({
    hash: index % 2 === 0 ? A : B,
    meanLuma: 120,
    brightRatio: 0.01,
    darkRatio: 0.05,
    sharpness: RECON_RULES.blurVariance + 10,
    ...(overrides[index] ?? {}),
  }));
}

describe('assessReconReadiness', () => {
  it('20 张可用帧仍判定不足（按 38% 登记率不足 12 张）', () => {
    const result = assessReconReadiness(frames(20));
    expect(result.verdict).toBe('not-enough');
    expect(result.usable).toBe(20);
    expect(result.estimatedRegistered).toBe(7);
    expect(result.missingShots).toBe(20);
    expect(result.gaps).toBe(0);
    expect(result.headline).toContain('还不够');
  });

  it('30 张可用帧接近下限', () => {
    const result = assessReconReadiness(frames(30));
    expect(result.verdict).toBe('borderline');
    expect(result.estimatedRegistered).toBe(11);
  });

  it('40 张可用帧达到下限，砍掉糊片与近似重复', () => {
    const mixed = frames(42, [
      { sharpness: 10 },
      { meanLuma: 20 },
    ]);
    // 前两张不合格；其余 40 张可用，刚好到达下限。
    const result = assessReconReadiness(mixed);
    expect(result.usable).toBe(40);
    expect(result.blurry).toBe(1);
    expect(result.exposureIssues).toBe(1);
    expect(result.verdict).toBe('enough');
    expect(result.headline).toContain('够建了');
  });

  it('相邻同哈希记为近似重复，不算可用帧', () => {
    const result = assessReconReadiness([
      { hash: A, meanLuma: 120, brightRatio: 0, darkRatio: 0, sharpness: 80 },
      { hash: A, meanLuma: 120, brightRatio: 0, darkRatio: 0, sharpness: 80 },
    ]);
    expect(result.duplicates).toBe(1);
    expect(result.usable).toBe(1);
  });

  it('相邻哈希距离过大记为重叠断档', () => {
    const result = assessReconReadiness([
      { hash: '0000000000000000', meanLuma: 120, brightRatio: 0, darkRatio: 0, sharpness: 80 },
      { hash: 'ffffffffffffffff', meanLuma: 120, brightRatio: 0, darkRatio: 0, sharpness: 80 },
    ]);
    expect(result.gaps).toBe(1);
    expect(result.goodOverlapPairs).toBe(0);
  });
});
