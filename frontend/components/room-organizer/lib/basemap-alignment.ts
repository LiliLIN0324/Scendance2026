import { gcj02ToWgs84, isInGcjOffsetRegion } from './geo-coords';
import type { PlanGroundSource } from './plan-ground-capture';

/**
 * 底图瓦片坐标系对齐。
 *
 * 应用里的锚点、边界、`MapGroundFrame` 全部是 **GCJ-02**（见 site-plan 的
 * `planAnchorSchema.crs`）：
 *   - 高德三档瓦片（卫星 / 街道 / 街道注记）本身就是 GCJ-02 网格 → 直接用；
 *   - OSM / Carto 是 WGS-84，天地图（CGCS2000）≈ WGS-84，在政策偏移区相对 GCJ-02
 *     整片平移（杭州一带实测 lng ≈ +0.0047°、lat ≈ -0.0023°，约 456 m 东 +
 *     256 m 南，合计 ~520 m）。直接按 GCJ-02 视点去取瓦片，底图内容就会相对
 *     场地边界「歪」几百米。
 *
 * 所以非高德源取瓦片前先把视点 / 范围换算到 WGS-84 网格；场馆尺度（几百米内）
 * 偏移量可当常量，整块范围平移即可，不必逐点重投影。
 */
export interface TileBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

export function needsWgs84Alignment(source: string): boolean {
  return !source.startsWith('amap-');
}

/** GCJ-02 视点 → 该瓦片源网格上对应的视点（高德源原样返回）。 */
export function alignedTileCenter(lng: number, lat: number, source: string): { lng: number; lat: number } {
  if (!needsWgs84Alignment(source)) return { lng, lat };
  return gcj02ToWgs84(lng, lat);
}

/** GCJ-02 经纬范围 → 该瓦片源网格上的同尺寸范围（整体平移，保形）。 */
export function alignedTileBounds(bounds: TileBounds, source: string): TileBounds {
  if (!needsWgs84Alignment(source)) return bounds;
  const lng = (bounds.west + bounds.east) / 2;
  const lat = (bounds.south + bounds.north) / 2;
  const wgs = gcj02ToWgs84(lng, lat);
  const dLng = wgs.lng - lng;
  const dLat = wgs.lat - lat;
  if (!Number.isFinite(dLng) || !Number.isFinite(dLat)) return bounds;
  if (Math.abs(dLng) < 1e-12 && Math.abs(dLat) < 1e-12) return bounds;
  return {
    west: bounds.west + dLng,
    south: bounds.south + dLat,
    east: bounds.east + dLng,
    north: bounds.north + dLat,
  };
}

/* ---------------- 境外场地换源（2026-11-17） ---------------- */

/** 全球卫星源 id（Esri World Imagery）。境外场地的卫星类图源。 */
export const GLOBAL_SATELLITE_SOURCE = 'esri-satellite' as const satisfies PlanGroundSource;

/** 全球街道源 id（OSM 标准瓦片）。境外场地的街道/矢量类图源。 */
export const GLOBAL_STREET_SOURCE = 'osm' as const satisfies PlanGroundSource;

/**
 * 只覆盖中国的图源：高德三档（GCJ-02 网格、影像只到国境线）与天地图两档（境内服务）。
 * 这些源在境外拿不到真瓦片，用来当底图只会是灰图/空白。
 */
export function isChinaOnlySource(source: string): boolean {
  return source.startsWith('amap-') || source === 'vec' || source === 'img';
}

/** 卫星影像类图源（换源时映射到全球卫星）；其余中国专属源都是街道/矢量类（映射到 OSM）。 */
function isSatelliteCategory(source: string): boolean {
  return source === 'amap-satellite' || source === 'img';
}

/** 锚点在境外（GCJ 偏移矩形之外）＝中国专属图源没有瓦片的区域。 */
export function isOverseasLocation(
  lng: number | null | undefined,
  lat: number | null | undefined,
): boolean {
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return false;
  return !isInGcjOffsetRegion(lng as number, lat as number);
}

/**
 * 按场地位置选实际可用的图源，并保留「地图类型」的语义。
 *
 * 2026-11-17 用户报：海外案例看不到底图。实测高德卫星在巴黎/伦敦/洛杉矶/Victoria 一律返回
 * 同一张 4235 B「此区域无卫星图」灰图（四处 MD5 相同），高德街道是 124 B 空白瓦片——
 * 即“请求成功但没内容”，前端不会报错，只会一直灰着。
 *
 * 境外换源按类别映射（用户反馈「地图怎么全改了」后从一刀切改为分类）：
 *   - 卫星影像类（高德卫星 / 天地图影像）→ 全球卫星（Esri）；
 *   - 街道 / 矢量类（高德街道 / 注记 / 天地图矢量）→ OSM 街道；
 * 这样「默认」在境外仍是一张街道图、与「卫星」肉眼可分，不会六个格子全是同一张影像。
 * 其它源（OSM / Carto / 已选的全球源）原样保留，境内一律原样返回。
 *
 * 坐标系：`gcj02ToWgs84` 在境外原样返回，所以换源后 `alignedTileBounds` 的平移量为 0，
 * 不会出现境内那种几百米偏移。
 */
export function sourceForLocation<T extends string>(
  source: T,
  lng: number | null | undefined,
  lat: number | null | undefined,
): T | PlanGroundSource {
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return source;
  if (isInGcjOffsetRegion(lng as number, lat as number)) return source;
  if (!isChinaOnlySource(source)) return source;
  return isSatelliteCategory(source) ? GLOBAL_SATELLITE_SOURCE : GLOBAL_STREET_SOURCE;
}