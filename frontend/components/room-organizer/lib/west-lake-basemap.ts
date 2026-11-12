import type { RoomLayout } from './types';

/**
 * 西湖风景名胜区（含平湖秋月一带）的外接范围。
 *
 * 2026-11-11 用户指令：默认进来的西湖 / 平湖秋月那套 3D 场地模型与切出来的
 * 西湖底图都不要了。3D ISO 管线已经删掉；本文件负责把**已存草稿**里还带着的
 * 这片底图数据（调研底图 + 卫星贴地裁切图）也剥掉，让「平面 / 立体」不再
 * 出现那块切出来的西湖区。
 */
export const WEST_LAKE_BOUNDS = {
  west: 120.0714663,
  south: 30.1777743,
  east: 120.1737028,
  north: 30.2736397,
} as const;

/** 经纬度是否落在西湖范围内。 */
export function withinWestLake(lng?: number | null, lat?: number | null): boolean {
  if (typeof lng !== 'number' || typeof lat !== 'number') return false;
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return false;
  return (
    lng >= WEST_LAKE_BOUNDS.west &&
    lng <= WEST_LAKE_BOUNDS.east &&
    lat >= WEST_LAKE_BOUNDS.south &&
    lat <= WEST_LAKE_BOUNDS.north
  );
}

function numberParam(url: string, key: string): number | null {
  const match = new RegExp(`[?&]${key}=(-?\\d+(?:\\.\\d+)?)`).exec(url);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

/**
 * 地图参考图 / 瓦片 URL 是否指向西湖：
 * - 旧预设的整片西湖静态图（`xihu-scenic-z15`）；
 * - 高德静态图带 `location=lng,lat`（卫星贴地裁切图就是这种）；
 * - 调研底图的 `west/south/east/north` 范围（`map-basemap` 代理图）。
 */
export function urlPointsIntoWestLake(url?: string | null): boolean {
  if (!url) return false;
  if (url.includes('xihu-scenic-z15')) return true;
  const location = /[?&]location=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/.exec(url);
  if (location) return withinWestLake(Number(location[1]), Number(location[2]));
  const west = numberParam(url, 'west');
  const south = numberParam(url, 'south');
  const east = numberParam(url, 'east');
  const north = numberParam(url, 'north');
  if (west !== null && south !== null && east !== null && north !== null) {
    return withinWestLake((west + east) / 2, (south + north) / 2);
  }
  return false;
}

/** 这份布置里是否还带着西湖那片的底图数据。 */
export function isWestLakeBasemapLayout(layout: RoomLayout): boolean {
  const area = layout.researchArea;
  if (area) {
    if (area.imageUrl?.includes('xihu-scenic-z15')) return true;
    if (withinWestLake(area.center?.lng, area.center?.lat)) return true;
    if (urlPointsIntoWestLake(area.imageUrl)) return true;
  }
  if (withinWestLake(layout.mapLngLat?.lng, layout.mapLngLat?.lat)) return true;
  if (layout.mapGroundPolygon?.some(point => withinWestLake(point.lng, point.lat))) return true;
  if (withinWestLake(layout.mapGroundFrame?.lng0, layout.mapGroundFrame?.lat0)) return true;
  if (urlPointsIntoWestLake(layout.floorPlanImage)) return true;
  return false;
}

/** 这份布置的贴地/圈画元数据是否指向西湖。 */
function groundMetadataInWestLake(layout: RoomLayout): boolean {
  if (withinWestLake(layout.mapLngLat?.lng, layout.mapLngLat?.lat)) return true;
  if (layout.mapGroundPolygon?.some(point => withinWestLake(point.lng, point.lat))) return true;
  if (withinWestLake(layout.mapGroundFrame?.lng0, layout.mapGroundFrame?.lat0)) return true;
  return false;
}

/**
 * 把布置里西湖那片的底图数据剥掉：调研底图 + 卫星贴地裁切图 + 它们的贴图元数据。
 * 场地本身（壳体、物料、场景锚点）不动——用户要的是那块地图不要了，不是这块地不要了。
 *
 * 裁切图有两种形态：
 * - 带经纬度的 URL（高德静态图 `location=lng,lat`）→ 直接按 URL 判定；
 * - canvas 合成的 data URL（`plan-ground-capture.ts`），图里没有经纬度，
 *   只有贴地元数据（mapLngLat / mapGroundPolygon / mapGroundFrame）能定位 →
 *   此时按「元数据在西湖范围内 + satelliteGroundRef 标记为贴地参考图」判定，
 *   避免把用户自己上传的平面图误删（上传的图不会带 satelliteGroundRef=true）。
 */
export function purgeWestLakeBasemap(layout: RoomLayout): { layout: RoomLayout; changed: boolean } {
  if (!isWestLakeBasemapLayout(layout)) return { layout, changed: false };
  const next: RoomLayout = { ...layout };
  let changed = false;

  const area = next.researchArea;
  if (
    area &&
    (area.imageUrl?.includes('xihu-scenic-z15') ||
      withinWestLake(area.center?.lng, area.center?.lat) ||
      urlPointsIntoWestLake(area.imageUrl))
  ) {
    delete next.researchArea;
    changed = true;
  }

  const westLakeGround = groundMetadataInWestLake(next);
  const mapReferenceImage =
    next.floorPlanImage !== undefined &&
    (urlPointsIntoWestLake(next.floorPlanImage) || (westLakeGround && next.satelliteGroundRef === true));

  if (mapReferenceImage) {
    delete next.floorPlanImage;
    delete next.floorPlanOpacity;
    delete next.floorPlanFitMode;
    changed = true;
  }

  if (westLakeGround) {
    delete next.mapGroundPolygon;
    delete next.mapLngLat;
    delete next.mapGroundFrame;
    changed = true;
  }

  if (next.satelliteGroundRef) {
    next.satelliteGroundRef = false;
    changed = true;
  }

  return { layout: changed ? next : layout, changed };
}
