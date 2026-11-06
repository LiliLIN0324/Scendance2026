import { describe, expect, it } from 'vitest';
import { OVERLAY_LINE_WIDTH_M, researchOverlayLineWidthPx } from './research-overlays';

describe('researchOverlayLineWidthPx（MAP-02 矢量线宽）', () => {
  const H = 900;
  const FOV = Math.PI / 3; // 60°，tan(30°) ≈ 0.57735

  it('远距离钳到下限 1 px（整湖概览时不糊成一团）', () => {
    expect(researchOverlayLineWidthPx(60_000, H, FOV)).toBe(1);
    expect(researchOverlayLineWidthPx(10_000, H, FOV)).toBe(1);
  });

  it('近距离钳到上限 8 px（贴地时不遮住底下点云）', () => {
    expect(researchOverlayLineWidthPx(1, H, FOV)).toBe(8);
    expect(researchOverlayLineWidthPx(0.2, H, FOV)).toBe(8); // <1m 按 1m 处理，仍在上限
  });

  it('中距离按 6 m 宽换算像素（回归钉：1000 m @900px/60° ≈ 4.68 px）', () => {
    const expected = OVERLAY_LINE_WIDTH_M * ((H / 2) / (1000 * Math.tan(FOV / 2)));
    expect(expected).toBeGreaterThan(1);
    expect(expected).toBeLessThan(8);
    expect(researchOverlayLineWidthPx(1000, H, FOV)).toBeCloseTo(expected, 6);
  });

  it('线宽随距离单调递减（近粗远细）', () => {
    let prev = researchOverlayLineWidthPx(2, H, FOV);
    for (const d of [10, 50, 100, 500, 2000, 9000]) {
      const px = researchOverlayLineWidthPx(d, H, FOV);
      expect(px).toBeLessThanOrEqual(prev);
      prev = px;
    }
  });
});
