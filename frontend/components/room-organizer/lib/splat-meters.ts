import type { SplatMeters } from '../three/splat-preview';

/**
 * lod-meta 的 forwardBox（米制、Z-up）换算成布置场地的宽深高。
 * 离谱的值当没有（扫描坏档），别把场地校到 0.2 m 或 300 m 去。
 */
export function metersFromForwardBox(value: unknown): SplatMeters | null {
  if (!value || typeof value !== 'object') return null;
  const box = value as { min?: unknown; max?: unknown };
  if (!Array.isArray(box.min) || !Array.isArray(box.max)) return null;
  const min = box.min as unknown[];
  const max = box.max as unknown[];
  const span = (index: number): number => {
    const low = min[index], high = max[index];
    return typeof low === 'number' && typeof high === 'number' && Number.isFinite(low) && Number.isFinite(high)
      ? Math.abs(high - low) : Number.NaN;
  };
  const width = span(0), depth = span(1), height = span(2);
  const usable = (n: number): boolean => Number.isFinite(n) && n >= 0.5 && n <= 120;
  return usable(width) && usable(depth) && usable(height)
    ? { width: Math.round(width * 10) / 10, depth: Math.round(depth * 10) / 10, height: Math.round(height * 10) / 10 }
    : null;
}
