import { describe, expect, it } from 'vitest';
import { rectRing as scopeRectRing } from './outdoor-design-scope';
import { annotationRectRing } from './site-plan-annotate';
import { rectRing as weddingRectRing } from './wedding-spatial';
import { ringArea, rectToRing } from './zone-polygon';
import type { PlanPoint } from '../../../../supabase/functions/_shared/site-plan';

/**
 * D5-2 对角点/外接框 → 四角环的现存生产方对齐基线。
 *
 * 所有 plan 帧矩形展环共用同一套四角口径（D5-1 `rectToRing`）：
 * NW→NE→SE→SW 顺时针、不回写首点；面积 = w × h。各生产方入参形状不同
 * （对角两点 / 外接框），适配仍留在各自调用侧，这里只钉住展开后的环一致。
 */
const footprint = { x: 2, y: 1, w: 8, h: 5 };
const expected: PlanPoint[] = [
  { x: 2, y: 1 },
  { x: 10, y: 1 },
  { x: 10, y: 6 },
  { x: 2, y: 6 },
];

describe('D5-2 rect→ring producers share the canonical corner order', () => {
  it('rectToRing (x/y/w/h) is the canonical four corners', () => {
    expect(rectToRing(footprint)).toEqual(expected);
  });

  it('annotationRectRing (two dragged corners) matches the same order', () => {
    expect(annotationRectRing({ x: 2, y: 1 }, { x: 10, y: 6 })).toEqual(expected);
    // 对角任意起终点归一成同一组四角。
    expect(annotationRectRing({ x: 10, y: 6 }, { x: 2, y: 1 })).toEqual(expected);
  });

  it('design-scope rectRing (two corners) matches the same order', () => {
    expect(scopeRectRing({ x: 2, y: 1 }, { x: 10, y: 6 })).toEqual(expected);
    expect(scopeRectRing({ x: 10, y: 1 }, { x: 2, y: 6 })).toEqual(expected);
  });

  it('wedding rectRing (w/e/s/n bounds) matches the same order', () => {
    expect(weddingRectRing({ w: 2, e: 10, s: 1, n: 6 })).toEqual(expected);
  });

  it('none repeats the closing first point, and the ring area is w × h', () => {
    for (const ring of [
      rectToRing(footprint)!,
      annotationRectRing({ x: 2, y: 1 }, { x: 10, y: 6 }),
      scopeRectRing({ x: 2, y: 1 }, { x: 10, y: 6 }),
      weddingRectRing({ w: 2, e: 10, s: 1, n: 6 }),
    ]) {
      expect(ring).toHaveLength(4);
      expect(ring[0]).not.toEqual(ring[3]);
      const [p0, p1, p2, p3] = ring;
      // NW → NE → SE → SW：左右两条竖边、上下两条横边分别共线。
      expect(p0!.x).toBe(p3!.x);
      expect(p0!.y).toBe(p1!.y);
      expect(p1!.x).toBe(p2!.x);
      expect(p2!.y).toBe(p3!.y);
      expect(ringArea(ring)).toBeCloseTo(footprint.w * footprint.h, 6);
    }
  });
});
