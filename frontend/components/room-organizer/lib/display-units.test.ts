import { describe, expect, it } from 'vitest';
import {
  FEET_PER_METRE,
  convertMetres,
  convertSquareMetres,
  formatArea,
  formatLength,
  parseDisplayUnit,
  unitLabel,
} from './display-units';

describe('display-units（米制存储 → 界面展示单位）', () => {
  describe('convertMetres / convertSquareMetres', () => {
    it('米制原样返回，英尺按系数换算', () => {
      expect(convertMetres(1, 'm')).toBe(1);
      expect(convertMetres(1, 'ft')).toBeCloseTo(FEET_PER_METRE, 6);
      expect(convertSquareMetres(1, 'm')).toBe(1);
      expect(convertSquareMetres(1, 'ft')).toBeCloseTo(FEET_PER_METRE * FEET_PER_METRE, 6);
    });
  });

  describe('formatLength', () => {
    it('米默认两位小数、英尺一位，带单位后缀', () => {
      expect(formatLength(1, 'm')).toBe('1.00 m');
      expect(formatLength(2.5, 'ft')).toBe(`${(2.5 * FEET_PER_METRE).toFixed(1)} ft`);
      expect(formatLength(1, 'ft')).toBe('3.3 ft');
    });

    it('precision 覆盖默认小数位', () => {
      expect(formatLength(1.23456, 'm', 0)).toBe('1 m');
    });

    it('非有限值给占位符', () => {
      expect(formatLength(Number.NaN, 'm')).toBe('—');
      expect(formatLength(Number.POSITIVE_INFINITY, 'ft')).toBe('—');
    });
  });

  describe('formatArea', () => {
    it('面积一位小数，带 m² / ft² 后缀；非有限占位', () => {
      expect(formatArea(4, 'm')).toBe('4.0 m²');
      expect(formatArea(4, 'ft')).toBe(`${(4 * FEET_PER_METRE * FEET_PER_METRE).toFixed(1)} ft²`);
      expect(formatArea(Number.NaN, 'm')).toBe('—');
    });
  });

  describe('unitLabel / parseDisplayUnit', () => {
    it('标签按单位出中文', () => {
      expect(unitLabel('m')).toBe('米');
      expect(unitLabel('ft')).toBe('英尺');
    });

    it('解析仅认 ft，其余非法值回落米', () => {
      expect(parseDisplayUnit('ft')).toBe('ft');
      expect(parseDisplayUnit('m')).toBe('m');
      expect(parseDisplayUnit('cm')).toBe('m');
      expect(parseDisplayUnit(null)).toBe('m');
      expect(parseDisplayUnit(undefined)).toBe('m');
      expect(parseDisplayUnit(123)).toBe('m');
    });
  });
});
