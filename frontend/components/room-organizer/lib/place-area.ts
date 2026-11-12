/**
 * 「选区」检索客户端（行政区边界）：用户输入地名时，除了一个中心点，
 * 还能拿到这块地的边界环，画布据此画选区并把视野框住。
 *
 * 2026-11-12 用户反馈：输入地理位置时希望看到「相关的选区」而不是一个居中的点。
 * 本机走 3199 代理 `/api/tdt-area`（天地图行政区划，带 boundary），
 * 线上 Pages Function 同路径同契约（`functions/api/tdt-area.ts`）。
 * 坐标一律 GCJ-02，与 `SitePlanData.anchor` 同基准。
 */

import { usesLocalPlaceProxy } from './place-search';

export interface PlaceArea {
  id: string;
  name: string;
  /** 行政区级别中文名：省 / 市 / 区县 / 街道；POI 轮廓固定「占地范围」。 */
  level: string;
  lng: number;
  lat: number;
  /** `[west, south, east, north]`。 */
  bounds: [number, number, number, number];
  /** 闭合性不要求的顶点序列（首尾不重复）。 */
  polygon: [number, number][];
  /** line=道路等开放折线（画布画粗线高亮）；缺省=闭合面选区。 */
  kind?: 'area' | 'line';
}

export interface AreaSearchOptions {
  /** 画布中心，用来在同名行政区里挑最近的那个。 */
  near?: { lng: number; lat: number } | null;
  limit?: number;
  local?: boolean;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

export function placeAreaUrl(
  keywords: string,
  near: { lng: number; lat: number } | null | undefined,
  limit = 3,
  local = usesLocalPlaceProxy(),
): string {
  const params = new URLSearchParams({ keywords: keywords.trim(), limit: String(limit) });
  if (near && Number.isFinite(near.lng) && Number.isFinite(near.lat)) {
    params.set('near', `${near.lng.toFixed(6)},${near.lat.toFixed(6)}`);
  }
  const query = params.toString();
  return local ? `http://127.0.0.1:3199/api/tdt-area?${query}` : `/api/tdt-area?${query}`;
}

/** 响应 → PlaceArea[]；坏数据逐条丢弃，不整体报错。 */
export function parseAreaPayload(body: unknown): PlaceArea[] {
  const raw = (body as { areas?: unknown } | null)?.areas;
  if (!Array.isArray(raw)) return [];
  const areas: PlaceArea[] = [];
  for (const entry of raw) {
    const item = entry as Partial<PlaceArea> | null;
    if (!item || !Array.isArray(item.polygon)) continue;
    const polygon: [number, number][] = [];
    for (const vertex of item.polygon) {
      if (!Array.isArray(vertex) || vertex.length < 2) continue;
      const lng = Number(vertex[0]);
      const lat = Number(vertex[1]);
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
      if (Math.abs(lng) > 180 || Math.abs(lat) > 90) continue;
      polygon.push([lng, lat]);
    }
    if (polygon.length < 3) continue;
    const boundsRaw = Array.isArray(item.bounds) ? item.bounds.map(Number) : [];
    let bounds: [number, number, number, number];
    if (boundsRaw.length === 4 && boundsRaw.every(Number.isFinite)) {
      bounds = [boundsRaw[0]!, boundsRaw[1]!, boundsRaw[2]!, boundsRaw[3]!];
    } else {
      let west = Infinity; let south = Infinity; let east = -Infinity; let north = -Infinity;
      for (const [lng, lat] of polygon) {
        west = Math.min(west, lng); east = Math.max(east, lng);
        south = Math.min(south, lat); north = Math.max(north, lat);
      }
      bounds = [west, south, east, north];
    }
    const lng = Number(item.lng);
    const lat = Number(item.lat);
    const name = String(item.name ?? '').trim();
    if (!name) continue;
    areas.push({
      id: String(item.id ?? name),
      name,
      level: String(item.level ?? '行政区').trim() || '行政区',
      lng: Number.isFinite(lng) ? lng : (bounds[0] + bounds[2]) / 2,
      lat: Number.isFinite(lat) ? lat : (bounds[1] + bounds[3]) / 2,
      bounds,
      polygon,
    });
  }
  return areas;
}

/** 选区检索；失败一律回空数组（调用方只当「没有选区」，不弹错）。 */
export async function searchAreas(keywords: string, options: AreaSearchOptions = {}): Promise<PlaceArea[]> {
  const query = keywords.trim();
  if (query.length < 2 || query.length > 40) return [];
  const local = options.local ?? usesLocalPlaceProxy();
  const doFetch = options.fetchImpl ?? fetch;
  try {
    const response = await doFetch(placeAreaUrl(query, options.near, options.limit ?? 3, local), {
      signal: options.signal ?? AbortSignal.timeout(8000),
    });
    if (!response.ok) return [];
    // 同名行政区全国有多份（西湖区在杭州、南昌各一个）：服务端已按 near 远近排过，
    // 这里同名只留最近的一条，避免建议列表里两行一模一样的「西湖区」。
    const seen = new Set<string>();
    const areas: PlaceArea[] = [];
    for (const area of parseAreaPayload(await response.json())) {
      if (seen.has(area.name)) continue;
      seen.add(area.name);
      areas.push(area);
    }
    return areas;
  } catch {
    return [];
  }
}

/* ---------------- POI 真实轮廓（点击地名后的后台挖掘） ---------------- */

/* 进程外缓存（localStorage）：挖到一次的地点跨会话秒出。真实世界的占地轮廓
 * 几乎不变，TTL 给足 14 天；写失败（隐私模式/存储满）静默放弃——缓存是锦上添花。 */
const SHAPE_CACHE_STORAGE = 'scendance.place-shape.v1';
const SHAPE_CACHE_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const SHAPE_CACHE_MAX = 40;

type ShapeCacheEntry = { t: number; area: PlaceArea };

function shapeCacheKey(name: string, near: { lng: number; lat: number } | null | undefined): string {
  const queryName = name.split('|')[0].trim().toLowerCase();
  const at = near && Number.isFinite(near.lng) && Number.isFinite(near.lat)
    ? `${near.lng.toFixed(2)},${near.lat.toFixed(2)}`
    : '';
  return `${queryName}|${at}`;
}

function readShapeCache(key: string): PlaceArea | null {
  try {
    const raw = window.localStorage.getItem(SHAPE_CACHE_STORAGE);
    if (!raw) return null;
    const table = JSON.parse(raw) as Record<string, ShapeCacheEntry>;
    const entry = table[key];
    if (!entry || typeof entry.t !== 'number' || !entry.area) return null;
    if (Date.now() - entry.t > SHAPE_CACHE_TTL_MS) return null;
    return entry.area;
  } catch {
    return null;
  }
}

function writeShapeCache(key: string, area: PlaceArea): void {
  try {
    const raw = window.localStorage.getItem(SHAPE_CACHE_STORAGE);
    const table = (raw ? JSON.parse(raw) : {}) as Record<string, ShapeCacheEntry>;
    table[key] = { t: Date.now(), area };
    const keys = Object.keys(table);
    if (keys.length > SHAPE_CACHE_MAX) {
      keys.sort((a, b) => (table[a]!.t ?? 0) - (table[b]!.t ?? 0));
      for (const key of keys.slice(0, keys.length - SHAPE_CACHE_MAX)) delete table[key];
    }
    window.localStorage.setItem(SHAPE_CACHE_STORAGE, JSON.stringify(table));
  } catch {
    // 存储不可用：缓存是锦上添花，失败就放弃
  }
}

/**
 * 点了一个地点建议后，从 OSM 挖这个地点的**真实占地多边形**
 * （商场/公园/景区在 OSM 里多为面要素；高德商圈框的公开等价物）。
 * 服务端三路并发抢答（photon 精确链 / way 按名 / relation 按名）+ 镜像熔断，
 * 命中结果写 localStorage——同一个地点再点秒出。失败回 null，
 * 调用方静默保留定位钉。`cache: false` 供测试绕开 localStorage。
 */
export async function fetchPlaceShape(
  name: string,
  options: { near?: { lng: number; lat: number } | null; signal?: AbortSignal; local?: boolean; fetchImpl?: typeof fetch; cache?: boolean } = {},
): Promise<PlaceArea | null> {
  const query = name.trim();
  if (query.length < 2 || query.length > 60) return null;
  const cacheKey = shapeCacheKey(query, options.near);
  const cached = options.cache === false ? null : readShapeCache(cacheKey);
  if (cached) return cached;
  const local = options.local ?? usesLocalPlaceProxy();
  const doFetch = options.fetchImpl ?? fetch;
  const params = new URLSearchParams({ name: query });
  if (options.near && Number.isFinite(options.near.lng) && Number.isFinite(options.near.lat)) {
    params.set('near', `${options.near.lng.toFixed(6)},${options.near.lat.toFixed(6)}`);
  }
  const url = local
    ? `http://127.0.0.1:3199/api/place-shape?${params.toString()}`
    : `/api/place-shape?${params.toString()}`;
  try {
    // 服务端预算：单台 Overpass 25s × 熔断轮换，三路并发抢答；给足 85s 兜底。
    const response = await doFetch(url, { signal: options.signal ?? AbortSignal.timeout(85000) });
    if (!response.ok) return null;
    const body = await response.json() as { shape?: { id?: string; name?: string; kind?: string; polygon?: [number, number][]; bounds?: number[] } | null };
    const raw = body?.shape;
    if (!raw || !Array.isArray(raw.polygon) || raw.polygon.length < 3) return null;
    const polygon: [number, number][] = [];
    for (const vertex of raw.polygon) {
      const lng = Number(vertex?.[0]);
      const lat = Number(vertex?.[1]);
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
      polygon.push([lng, lat]);
    }
    if (polygon.length < 3) return null;
    const b = Array.isArray(raw.bounds) ? raw.bounds.map(Number) : [];
    const bounds: [number, number, number, number] = b.length === 4 && b.every(Number.isFinite)
      ? [b[0]!, b[1]!, b[2]!, b[3]!]
      : (() => {
        let west = Infinity; let south = Infinity; let east = -Infinity; let north = -Infinity;
        for (const [lng, lat] of polygon) {
          west = Math.min(west, lng); east = Math.max(east, lng);
          south = Math.min(south, lat); north = Math.max(north, lat);
        }
        return [west, south, east, north];
      })();
    const area: PlaceArea = {
      id: String(raw.id ?? `shape:${query}`),
      name: String(raw.name ?? query),
      level: '占地范围',
      lng: (bounds[0] + bounds[2]) / 2,
      lat: (bounds[1] + bounds[3]) / 2,
      bounds,
      polygon,
      ...(raw.kind === 'line' ? { kind: 'line' as const } : {}),
    };
    if (options.cache !== false) writeShapeCache(cacheKey, area);
    return area;
  } catch {
    return null;
  }
}