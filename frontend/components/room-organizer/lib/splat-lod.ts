/**
 * 整景区视距下的点云 LOD（HANDOFF 第七节第 3 步）。
 *
 * 远景（整景区视距）不加载、不绘制 3DGS，只在锚点留一个 POI 图标；
 * 相机水平距离进到 100 m 内才切回 splat 层。阈值带滞回，避免在临界处来回切：
 * - 远景 → 近景：< 100 m（SPLAT_LOD_ENTER_M）
 * - 近景 → 远景：> 200 m（SPLAT_LOD_POI_M）
 * - 100–200 m 保持上一状态（滞回区）
 *
 * 距离按真实米算：世界单位 × anchors.metersPerUnit（壳体等比缩小时世界单位变小）。
 */

export const SPLAT_LOD_ENTER_M = 100;
export const SPLAT_LOD_POI_M = 200;

export type SplatLodMode = 'splat' | 'poi';

/** 状态机：只允许在两个阈值处翻转，中间距离保持上一状态。 */
export function nextSplatLod(previous: SplatLodMode, distanceM: number): SplatLodMode {
  if (previous === 'splat') return distanceM > SPLAT_LOD_POI_M ? 'poi' : 'splat';
  return distanceM < SPLAT_LOD_ENTER_M ? 'splat' : 'poi';
}

/** 相机到锚点的水平距离（真实米）。只比水平距离：俯视/仰视的高度不参与阈值。 */
export function splatLodDistanceM(
  camera: Readonly<{ x: number; z: number }>,
  anchor: Readonly<{ x: number; z: number }>,
  metersPerUnit = 1,
): number {
  const metres = Math.hypot(camera.x - anchor.x, camera.z - anchor.z) * metersPerUnit;
  return Number.isFinite(metres) ? metres : 0;
}

/** 距离文案：近处取整米，整景区视距用公里。 */
export function formatSplatLodDistance(distanceM: number): string {
  return distanceM >= 1000 ? `${(distanceM / 1000).toFixed(1)} km` : `${Math.round(distanceM)} m`;
}

/**
 * POI 颜色（截图验收按这几个值取样，别在组件里另写字面量）。
 * 沿用场景点位层的品牌绿 + 中性灰，不引入第二个强调色。
 */
export const SPLAT_POI_COLORS = {
  dot: '#35624A',
  dotRing: '#FFFFFF',
  label: '#52524E',
  card: 'rgba(255,255,255,0.92)',
  cardBorder: 'rgba(53,98,74,0.28)',
} as const;
