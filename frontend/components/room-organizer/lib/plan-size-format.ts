/**
 * 规划界面的尺寸文案（画布幽灵/清单/图例同源）。
 *
 * 背景：生成模型的实际包围盒常是 `0.5201502442359924` 这样的浮点，
 * 直接拼进标签会出现「0.52×0.54 m」之外的整串小数；而用户真正要的是
 * 「52 × 54 cm」这种能一眼对照商品规格的数字。
 *
 * 口径：
 * - 宽深都小于 1 m → 厘米整数（不足 1 cm 也按 1 cm 计，避免出现 0 cm）；
 * - 其余 → 米保留两位，去掉末尾 0（1.50 → "1.5"，2.00 → "2"）；
 * - 非有限值/非正数 → "尺寸未知"，不编一个看起来像真的数。
 */
export function formatPlanObjectSize(widthM: number, depthM: number): string {
  if (!Number.isFinite(widthM) || !Number.isFinite(depthM) || widthM <= 0 || depthM <= 0) return '尺寸未知';
  if (widthM < 1 && depthM < 1) {
    const cm = (value: number): number => Math.max(1, Math.round(value * 100));
    return `${cm(widthM)} × ${cm(depthM)} cm`;
  }
  const meters = (value: number): string => String(Math.round(value * 100) / 100);
  return `${meters(widthM)} × ${meters(depthM)} m`;
}
