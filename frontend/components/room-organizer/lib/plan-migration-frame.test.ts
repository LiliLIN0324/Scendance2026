import { describe, expect, it } from 'vitest';
import type { PlanPoint } from '../../../../supabase/functions/_shared/site-plan';
import { framePoint, hexOrUndefined, makeFrame } from './plan-migration-frame';

/** 10×8 m 平面边界（x 东、y 北）。 */
const BOUNDARY: PlanPoint[] = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 8 },
  { x: 0, y: 8 },
];

describe('plan-migration-frame（迁移共享坐标帧）', () => {
  describe('makeFrame', () => {
    it('合法边界 + 有限壳体尺寸给出两轴缩放', () => {
      const frame = makeFrame(BOUNDARY, 20, 16);
      expect(frame.bounds).not.toBeNull();
      expect(frame.scaleX).toBeCloseTo(2, 6);
      expect(frame.scaleZ).toBeCloseTo(2, 6);
    });

    it('边界退化时回落无缩放帧（bounds null，scale 1）', () => {
      const frame = makeFrame([{ x: 0, y: 0 }], 20, 16);
      expect(frame.bounds).toBeNull();
      expect(frame.scaleX).toBe(1);
      expect(frame.scaleZ).toBe(1);
    });

    it('壳体尺寸非有限或小于 1 时同样回落无缩放帧', () => {
      expect(makeFrame(BOUNDARY, Number.NaN, 16).bounds).toBeNull();
      expect(makeFrame(BOUNDARY, 20, 0).bounds).toBeNull();
      expect(makeFrame(BOUNDARY, -1, 16).bounds).toBeNull();
    });
  });

  describe('framePoint', () => {
    it('合法帧：壳体点按缩放落位，z 南翻成 y 北，并在边界内 clamp', () => {
      const frame = makeFrame(BOUNDARY, 20, 16);
      // 壳体满幅 → 平面右上角边界。
      expect(framePoint(frame, 20, 16)).toEqual({ x: 10, y: 0 });
      // 越界壳体点被 clamp 到边界，不冒出边界框。
      expect(framePoint(frame, 999, 999).x).toBe(10);
      expect(framePoint(frame, 999, 999).y).toBe(0);
    });

    it('退化帧或非有限坐标退成直接翻轴（y = -z）', () => {
      const noFrame = makeFrame([{ x: 0, y: 0 }], 20, 16);
      expect(framePoint(noFrame, 3, 5)).toEqual({ x: 3, y: -5 });
      expect(framePoint(noFrame, 0, 0)).toEqual({ x: 0, y: 0 });
      const nanPoint = framePoint(makeFrame(BOUNDARY, 20, 16), Number.NaN, 5);
      expect(Number.isNaN(nanPoint.x)).toBe(true);
      expect(nanPoint.y).toBe(-5);
    });
  });

  describe('hexOrUndefined', () => {
    it('仅接受 6 位十六进制色，其余回落 undefined', () => {
      expect(hexOrUndefined('#8899aa')).toBe('#8899aa');
      expect(hexOrUndefined('#AABBCC')).toBe('#AABBCC');
      expect(hexOrUndefined('#fff')).toBeUndefined();
      expect(hexOrUndefined('red')).toBeUndefined();
      expect(hexOrUndefined('')).toBeUndefined();
      expect(hexOrUndefined(undefined)).toBeUndefined();
    });
  });
});
