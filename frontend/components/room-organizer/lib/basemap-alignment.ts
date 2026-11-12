import { gcj02ToWgs84 } from './geo-coords';

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