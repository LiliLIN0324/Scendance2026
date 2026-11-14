import { describe, expect, it } from 'vitest';
import {
  gcjBBoxAreaM2,
  gcjPolylineLengthM,
  isDisplayablePlaceShape,
  isOutlineHint,
  isPersistablePlaceShape,
  namesReferToSamePlace,
  normalizeOutlineName,
} from './place-shape-quality';

describe('place-shape-quality（选区几何可信度纯函数）', () => {
  describe('normalizeOutlineName', () => {
    it('小写并去掉空白 / 标点 / 括号 / 连字符分隔符', () => {
      expect(normalizeOutlineName(' 杭州大厦 · A座 ')).toBe('杭州大厦a座');
      expect(normalizeOutlineName('Foo-Bar/Baz')).toBe('foobarbaz');
      expect(normalizeOutlineName('')).toBe('');
    });
  });

  describe('gcjPolylineLengthM', () => {
    it('不足两点返回 0，两点算平面线长', () => {
      expect(gcjPolylineLengthM([])).toBe(0);
      expect(gcjPolylineLengthM([[120.14, 30.25]])).toBe(0);
      const len = gcjPolylineLengthM([[120.14, 30.25], [120.15, 30.25]]);
      expect(len).toBeGreaterThan(0);
    });
  });

  describe('gcjBBoxAreaM2', () => {
    it('空集合面积 0，矩形外接框给出正面积', () => {
      expect(gcjBBoxAreaM2([])).toBe(0);
      const area = gcjBBoxAreaM2([[120.14, 30.25], [120.15, 30.26]]);
      expect(area).toBeGreaterThan(0);
    });
  });

  describe('isOutlineHint', () => {
    it('line 或不足三点不算轮廓；非 line 且 ≥3 点算', () => {
      expect(isOutlineHint(null)).toBe(false);
      expect(isOutlineHint({ kind: 'line', pts: 5 })).toBe(false);
      expect(isOutlineHint({ kind: 'area', pts: 2 })).toBe(false);
      expect(isOutlineHint({ kind: 'area', pts: 3 })).toBe(true);
    });
  });

  describe('namesReferToSamePlace', () => {
    it('同名、去城市前缀、短码后缀互相命中；空名与不相关返回 false', () => {
      expect(namesReferToSamePlace('武林广场', '武林广场')).toBe(true);
      expect(namesReferToSamePlace('杭州市武林广场', '武林广场')).toBe(true);
      expect(namesReferToSamePlace('杭州in77', 'in77')).toBe(true);
      expect(namesReferToSamePlace('', '武林广场')).toBe(false);
      expect(namesReferToSamePlace('西湖景区', '火车站')).toBe(false);
    });
  });

  describe('isPersistablePlaceShape', () => {
    it('line 与空值一律不算可入库轮廓', () => {
      expect(isPersistablePlaceShape(null)).toBe(false);
      expect(isPersistablePlaceShape({ kind: 'line', polygon: [[120.14, 30.25], [120.15, 30.25]] })).toBe(false);
    });
  });

  describe('isDisplayablePlaceShape', () => {
    const AREA: [number, number][] = [
      [120.1400, 30.2500],
      [120.1410, 30.2500],
      [120.1410, 30.2510],
      [120.1400, 30.2510],
      [120.1400, 30.2500],
    ];

    it('空值 / 非数组多边形 / 越界点拒绝', () => {
      expect(isDisplayablePlaceShape(undefined)).toBe(false);
      expect(isDisplayablePlaceShape({ kind: 'area', polygon: 'x' })).toBe(false);
      expect(isDisplayablePlaceShape({ kind: 'area', polygon: [[200, 30], [201, 31]] })).toBe(false);
    });

    it('名字带公交 / 往返线路标记的拒绝，即使几何合法', () => {
      expect(isDisplayablePlaceShape({ kind: 'area', name: '往返公交路线', polygon: AREA })).toBe(false);
    });

    it('可信面（≥3 点、不自交、占地够）可展示', () => {
      expect(isDisplayablePlaceShape({ kind: 'area', name: '杭州大厦', polygon: AREA })).toBe(true);
    });

    it('合法名且够长的线可展示；太短的线拒绝', () => {
      const longLine: [number, number][] = [[120.1400, 30.2500], [120.1410, 30.2500]];
      expect(isDisplayablePlaceShape({ kind: 'line', name: '天目山路', polygon: longLine })).toBe(true);
      const shortLine: [number, number][] = [[120.1400, 30.2500], [120.1401, 30.2500]];
      expect(isDisplayablePlaceShape({ kind: 'line', name: '天目山路', polygon: shortLine })).toBe(false);
    });
  });
});
