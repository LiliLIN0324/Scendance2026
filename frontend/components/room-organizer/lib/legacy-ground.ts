/**
 * layout 上的**贴地底图旧字段**（B4/S3 收口，2026-11-25）。
 *
 * 这些字段已从 `RoomLayout` 类型里删除：贴地底图的唯一正源是 `plan.ground`。
 * 但盘上还有老方案带这些键，迁移必须先把它们读成正源，擦完之后才允许整键消失。
 * 所以这里留**唯一的旧字段读口**：
 *
 * - 读：`legacyGroundOf(layout)`（只做浅取，不做校验、不猜值）；
 * - 判：`hasLegacyGround(layout)`（有任意一项即需要迁移）；
 * - 清：`LEGACY_GROUND_KEYS`（`stripLayoutGroundBytes` 按它整键删）。
 *
 * 新代码不要再读这些键；需要底图请用 `resolveGround(layout, plan)`。
 * 类型删了、盘上还留，是迁移的中间态，不是第二份事实源。
 */
export interface LegacyLayoutGround {
  floorPlanImage?: string;
  floorPlanOpacity?: number;
  satelliteGroundRef?: boolean;
  mapGroundPolygon?: { lng: number; lat: number }[];
  mapLngLat?: { lng: number; lat: number };
  mapGroundFrame?: { lng0: number; lat0: number; latMid: number; scale: number; latSign?: -1 | 1 } | undefined;
}

export const LEGACY_GROUND_KEYS = [
  'floorPlanImage',
  'floorPlanOpacity',
  'satelliteGroundRef',
  'mapGroundPolygon',
  'mapLngLat',
  'mapGroundFrame',
] as const;

export function legacyGroundOf(layout: object | null | undefined): LegacyLayoutGround {
  if (!layout) return {};
  const raw = layout as Record<string, unknown>;
  const out: LegacyLayoutGround = {};
  if (typeof raw.floorPlanImage === 'string') out.floorPlanImage = raw.floorPlanImage;
  if (typeof raw.floorPlanOpacity === 'number') out.floorPlanOpacity = raw.floorPlanOpacity;
  if (typeof raw.satelliteGroundRef === 'boolean') out.satelliteGroundRef = raw.satelliteGroundRef;
  if (Array.isArray(raw.mapGroundPolygon)) {
    out.mapGroundPolygon = raw.mapGroundPolygon as { lng: number; lat: number }[];
  }
  if (raw.mapLngLat && typeof raw.mapLngLat === 'object') {
    out.mapLngLat = raw.mapLngLat as { lng: number; lat: number };
  }
  if (raw.mapGroundFrame && typeof raw.mapGroundFrame === 'object') {
    out.mapGroundFrame = raw.mapGroundFrame as LegacyLayoutGround['mapGroundFrame'];
  }
  return out;
}

export function hasLegacyGround(layout: object | null | undefined): boolean {
  const legacy = legacyGroundOf(layout);
  return Object.keys(legacy).length > 0;
}
