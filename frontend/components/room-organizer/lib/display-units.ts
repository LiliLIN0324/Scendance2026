import type { LengthPrecisionM } from '../../../../supabase/functions/_shared/plan-editor';
import type { DisplayUnit } from './types';

/**
 * 显示单位换算。工程底稿、内部存储一律保持米；这里只负责把米换算成界面/导出需要的展示单位。
 * 英尺口径：1 m ≈ 3.28084 ft，读数保留一位小数（不拆 ft′ in″ 双单位）。
 */
export const FEET_PER_METRE = 3.28084;

/** 从米换算到目标显示单位的数值；米制原样返回。 */
export function convertMetres(metres: number, unit: DisplayUnit): number {
  return unit === 'ft' ? metres * FEET_PER_METRE : metres;
}

/** 从平方米换算到目标显示单位的面积数值。 */
export function convertSquareMetres(areaMetres2: number, unit: DisplayUnit): number {
  return unit === 'ft' ? areaMetres2 * FEET_PER_METRE * FEET_PER_METRE : areaMetres2;
}

/** 长度读数：米默认两位小数，英尺一位小数；非有限值给占位符。 */
export function formatLength(metres: number, unit: DisplayUnit, precision?: number): string {
  if (!Number.isFinite(metres)) return '—';
  const value = convertMetres(metres, unit);
  const digits = precision ?? (unit === 'ft' ? 1 : 2);
  return `${value.toFixed(digits)} ${unit === 'ft' ? 'ft' : 'm'}`;
}

/** 先按米制步长取整，再换成当前显示单位。切英尺只改读数。 */
export function formatReading(metres: number, unit: DisplayUnit, stepM: LengthPrecisionM = 0.01): string {
  if (!Number.isFinite(metres)) return '—';
  const step = stepM > 0 ? stepM : 0.01;
  const rounded = Math.round(metres / step) * step;
  const digits = step >= 1 ? 0 : step >= 0.1 ? 1 : 2;
  return formatLength(rounded, unit, unit === 'ft' && step >= 1 ? 0 : digits);
}

/** 面积读数（m² / ft²），一位小数。 */
export function formatArea(metres2: number, unit: DisplayUnit): string {
  if (!Number.isFinite(metres2)) return '—';
  const value = convertSquareMetres(metres2, unit);
  return `${value.toFixed(1)} ${unit === 'ft' ? 'ft²' : 'm²'}`;
}

export function unitLabel(unit: DisplayUnit): string {
  return unit === 'ft' ? '英尺' : '米';
}

/** 解析可能来自本机/云端的单位取值；非法值回落到米。 */
export function parseDisplayUnit(value: unknown): DisplayUnit {
  return value === 'ft' ? 'ft' : 'm';
}
