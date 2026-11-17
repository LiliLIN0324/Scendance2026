/**
 * 2026-11-17 用户指令：地图详情面板改成「上面四个固定槽位 + 下面按类型分组的清单」。
 *
 * 上面四格是**用途位**：卫星 / 街道 / 单色（外加「无」= 纸面，走 plan-basemap-source
 * 的 ground-mode，不归这里）。下面清单里的每一项都能「置顶」——把该源换进**同用途**
 * 的槽位：街道源只能进街道格、卫星源只能进卫星格、视觉源只能进单色格。这样上排四格
 * 的语义永远成立，不会出现「卫星」格里摆着一张街道图。
 *
 * 缺省：卫星 = 高德卫星、街道 = 高德街道、单色 = Carto 白底（Carto 走直连、最稳，
 * 境外也有瓦片）。槽位记的是**用户选了什么**；境外场地真正铺哪套瓦片仍由
 * `basemap-alignment` 的 `sourceForLocation` 按类别换源（街道类→OSM、卫星类→全球卫星）。
 */

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
  satellite: 'amap-satellite',
  streets: 'amap-streets',
  tone: 'carto-light',
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
export function readMapSlots(): MapSlotPicks {
  if (cached) return cached;
  const next: MapSlotPicks = { ...DEFAULT_MAP_SLOTS };
  try {
    const raw = globalThis.localStorage?.getItem(MAP_SLOT_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
    for (const role of MAP_SLOT_ROLES) {
      const value = parsed?.[role];
      // 只认同用途的源：脏值、跨用途残值（比如手改 localStorage 把街道源塞进卫星格）
      // 一律回落缺省，别让上排格子的语义被写坏。
      if (isMapSourceId(value) && ROLE_OF_SOURCE[value] === role) next[role] = value;
    }
  } catch {
    // 隐私模式 / 坏 JSON：用缺省。
  }
  cached = next;
  return next;
}

/** 把某个源换进它所属的槽位。源与槽位用途不符时拒绝（返回 false）。 */
export function writeMapSlot(role: MapSlotRole, source: MapSourceId): boolean {
  if (ROLE_OF_SOURCE[source] !== role) return false;
  const current = readMapSlots();
  if (current[role] === source) return true;
  cached = { ...current, [role]: source };
  try {
    globalThis.localStorage?.setItem(MAP_SLOT_STORAGE_KEY, JSON.stringify(cached));
  } catch {
    // 存不下就算了，本会话内仍然生效。
  }
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
