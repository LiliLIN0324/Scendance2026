/**
 * capacity-meter.ts —— 本场上限件数估算（顶栏容量计纯函数）。
 *
 * 输入场地宽深（米）和当前已放件数，输出可用面积 / 上限 / 剩余 / 饱和度。
 * 经验值：每件占 2.5m²；主通道带按 1.8m 宽 × 场地深扣；四周退界按 0.5m 带扣。
 *
 * 纯函数、不接 UI、不读 store。
 */

export interface CapacityEstimate {
  /** 场地面积 = widthM * depthM（m²）。 */
  areaM2: number;
  /** 主通道带面积（1.8m 宽 × depthM）。 */
  aisleBandM2: number;
  /** 可用面积 = area - aisleBand - 退界。 */
  usableM2: number;
  /** 本场上限件数 = floor(usableM2 / 2.5)，不为负。 */
  maxItems: number;
  /** 当前已放件数（从 layout 传入）。 */
  placedItems: number;
  /** maxItems - placedItems，不为负。 */
  remaining: number;
  /** placedItems / maxItems，0..1+；maxItems=0 时为 0。 */
  ratio: number;
}

/** 主通道带宽（米）。 */
const AISLE_WIDTH_M = 1.8;
/** 四周退界（米）。 */
const SETBACK_M = 0.5;
/** 每件经验占地（m²）。 */
const M2_PER_ITEM = 2.5;

/**
 * 估算本场上限件数。
 * @param widthM 场地宽（米）。
 * @param depthM 场地深（米）。
 * @param placedItems 当前已放件数。
 */
export function estimateCapacity(
  widthM: number,
  depthM: number,
  placedItems: number,
): CapacityEstimate {
  const safeW = Math.max(0, widthM);
  const safeD = Math.max(0, depthM);

  const areaM2 = safeW * safeD;
  const aisleBandM2 = AISLE_WIDTH_M * safeD;
  // 退界带近似：0.5m × (width + depth)（两条边带，角部重叠已忽略）。
  const setbackM2 = SETBACK_M * (safeW + safeD);
  const usableM2 = Math.max(0, areaM2 - aisleBandM2 - setbackM2);

  const maxItems = Math.floor(usableM2 / M2_PER_ITEM);
  const remaining = Math.max(0, maxItems - placedItems);
  const ratio = maxItems > 0 ? placedItems / maxItems : 0;

  return {
    areaM2,
    aisleBandM2,
    usableM2,
    maxItems,
    placedItems,
    remaining,
    ratio,
  };
}
