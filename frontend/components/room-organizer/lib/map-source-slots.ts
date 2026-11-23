/**
 * 地图类型槽位：卫星 / 街道 / 单色，外加「无」= 纸面（纸面走 plan-basemap-source
 * 的 ground-mode，不归这里）。
 *
 * 2026-11-23：每一格只保留一个瓦片源，和记下的底图选择对齐
 * （卫星 = 高德卫星、街道 = 高德街道、单色 = Carto 浅色）。
 * 旧的「置顶全球卫星 / 天地图 / Carto 深色」不再写成第二套源——那会让图层写着
 * 全球卫星、瓦片却混进另一套影像。境外换源仍只发生在 `tileSourceForBasemapStyle`。
 */

import { WORKBENCH_BASEMAP_SOURCE } from './basemap-style';
import type { PlanGroundSource } from './plan-ground-capture';
import type { ProbePublicSource, TdtProbeLayer } from './tdt-probe';

/** 面板与三维地面共用的图源 id 集合（与 outdoor-plan-canvas 的 CanvasBasemapSource 同构）。 */
export type MapSourceId = TdtProbeLayer | ProbePublicSource;

/** 三个可换的槽位。第四格「无」不是图源，不在这里。 */
export type MapSlotRole = 'satellite' | 'streets' | 'tone';

export const MAP_SLOT_ROLES: readonly MapSlotRole[] = ['satellite', 'streets', 'tone'];

/** 槽位标题（上排四格的字）。 */
export const MAP_SLOT_LABELS: Record<MapSlotRole, string> = {
  satellite: '卫星',
  streets: '街道',
  tone: '单色',
};

/** 下方清单的分组标题（按用途分组，与槽位一一对应）。 */
export const MAP_SLOT_GROUP_LABELS: Record<MapSlotRole, string> = {
  satellite: '卫星类',
  streets: '街道类',
  tone: '视觉类',
};

export type MapSlotPicks = Record<MapSlotRole, MapSourceId>;

/**
 * 用户点名的缺省顺序：先高德卫星、再高德街道、第三格白底 Carto。
 * 三个缺省值都必须是三维地面能直接铺的源（PlanGroundSource）——三维菜单拿不到有效源时
 * 就回落到这里。
 */
export const DEFAULT_MAP_SLOTS: Record<MapSlotRole, PlanGroundSource> = {
  satellite: WORKBENCH_BASEMAP_SOURCE.satellite,
  streets: WORKBENCH_BASEMAP_SOURCE.map,
  tone: WORKBENCH_BASEMAP_SOURCE.light,
};

/**
 * 每个图源属于哪个用途位。写成穷举 Record：以后新增图源，TypeScript 会强制在这里
 * 表态，避免新源在面板里找不到分组、或置顶到语义不符的格子。
 */
const ROLE_OF_SOURCE: Record<MapSourceId, MapSlotRole> = {
  'amap-satellite': 'satellite',
  'esri-satellite': 'satellite',
  img: 'satellite',
  'amap-streets': 'streets',
  'amap-streets-labels': 'streets',
  osm: 'streets',
  vec: 'streets',
  'carto-light': 'tone',
  'carto-dark': 'tone',
};

export function slotRoleForSource(source: MapSourceId): MapSlotRole {
  return ROLE_OF_SOURCE[source];
}

export function isMapSourceId(value: unknown): value is MapSourceId {
  return typeof value === 'string' && Object.hasOwn(ROLE_OF_SOURCE, value);
}

export const MAP_SLOT_STORAGE_KEY = 'scendance-map-slots-v1';

let cached: MapSlotPicks | null = null;

const listeners = new Set<() => void>();

/** 订阅槽位变化（面板用 useSyncExternalStore 消费）。返回退订函数。 */
export function subscribeMapSlots(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * 读槽位。返回值是模块级缓存对象——`useSyncExternalStore` 要求同一快照恒等，
 * 所以只在真正写入时换新对象。
 */
function persistSlots(slots: MapSlotPicks): void {
  try {
    globalThis.localStorage?.setItem(MAP_SLOT_STORAGE_KEY, JSON.stringify(slots));
  } catch {
    // 存不下就算了，本会话内仍然生效。
  }
}

export function readMapSlots(): MapSlotPicks {
  if (cached) return cached;
  // 不回放旧的置顶：卫星格里的全球卫星 / 天地图、单色格里的深色都会变成第二套瓦片。
  cached = { ...DEFAULT_MAP_SLOTS };
  persistSlots(cached);
  return cached;
}

/** 用途相符时槽位保持该选择的唯一源；跨用途拒绝。 */
export function writeMapSlot(role: MapSlotRole, source: MapSourceId): boolean {
  if (ROLE_OF_SOURCE[source] !== role) return false;
  const current = readMapSlots();
  if (current[role] === DEFAULT_MAP_SLOTS[role]) return true;
  cached = { ...current, [role]: DEFAULT_MAP_SLOTS[role] };
  persistSlots(cached);
  listeners.forEach((listener) => listener());
  return true;
}

/** 「置顶」：把清单里的图源换进对应槽位，返回落在哪一格。 */
export function pinMapSource(source: MapSourceId): MapSlotRole {
  const role = ROLE_OF_SOURCE[source];
  writeMapSlot(role, source);
  return role;
}

/** 测试用：丢掉模块级缓存（localStorage 由用例自己清）。 */
export function resetMapSlotsCacheForTest(): void {
  cached = null;
}
