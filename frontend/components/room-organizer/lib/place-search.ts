/**
 * 地点检索客户端（创建活动时填「活动地点」用）。
 *
 * 契约与生产 Pages Function `functions/api/tdt-search.ts` 一致：
 * GET `?keywords=&limit=` → `{ places: [{ id, name, address, lng, lat }] }`，
 * 关键词 2–80 字、无结果 404、Key（TDT_KEY）只在服务端。
 *
 * 为什么从高德换成天地图：amap 那把 WEB 服务 key 在控制台开了数字签名，
 * 服务端没有私钥就算不了 sig，`restapi.amap.com` 一律回 INVALID_USER_SIGNATURE；
 * 天地图 key（仓库根 .env.local 的 TDT_KEY）已实测可用，且坐标是 CGCS2000≈WGS84，
 * 服务端会转成 GCJ-02 再回给客户端，符合 `SitePlanData.anchor` 的 `crs: 'gcj-02'` 契约。
 *
 * 本机开发（localhost / 127.0.0.1）走 3199 代理的 `/api/tdt-search`（代理读 .env.local 的 TDT_KEY，且带 CORS）；
 * 线上走同源 `/api/tdt-search`。Key 不进页面。
 */

export interface PlaceSuggestion {
  id: string;
  name: string;
  address: string;
  lng: number;
  lat: number;
}

export interface PlaceSearchOptions {
  limit?: number;
  /** 注入以便测试与特殊环境（默认按当前 hostname 判本机代理）。 */
  local?: boolean;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

/** 本机开发走 3199；线上走同源 Pages Function。与 amap-venue 的 usesLocalAmapProxy 同口径。 */
export function usesLocalPlaceProxy(): boolean {
  if (typeof window === 'undefined') return false;
  const host = window.location?.hostname ?? '';
  return host === 'localhost' || host === '127.0.0.1' || host === '';
}

export function placeSearchUrl(keywords: string, limit = 6, local = usesLocalPlaceProxy()): string {
  const params = new URLSearchParams({ keywords: keywords.trim(), limit: String(limit) });
  const query = params.toString();
  return local ? `http://127.0.0.1:3199/api/tdt-search?${query}` : `/api/tdt-search?${query}`;
}

function parsePlaces(body: unknown): PlaceSuggestion[] {
  const raw = (body as { places?: unknown[] } | null)?.places;
  if (!Array.isArray(raw)) return [];
  const places: PlaceSuggestion[] = [];
  for (const entry of raw) {
    const item = entry as Partial<PlaceSuggestion> | null;
    if (!item) continue;
    const lng = Number(item.lng);
    const lat = Number(item.lat);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
    places.push({
      id: String(item.id ?? `${lng},${lat}`),
      name: String(item.name ?? '').trim() || String(item.address ?? '').trim(),
      address: String(item.address ?? '').trim(),
      lng,
      lat,
    });
  }
  return places;
}

/** 检索失败（网络/404/超时）一律回空数组——调用方只当作「没建议」，不弹错。 */
export async function searchPlaces(keywords: string, options: PlaceSearchOptions = {}): Promise<PlaceSuggestion[]> {
  const query = keywords.trim();
  if (query.length < 2 || query.length > 80) return [];
  const local = options.local ?? usesLocalPlaceProxy();
  const doFetch = options.fetchImpl ?? fetch;
  try {
    const response = await doFetch(placeSearchUrl(query, options.limit ?? 6, local), {
      signal: options.signal ?? AbortSignal.timeout(8000),
    });
    if (!response.ok) return [];
    return rankPlaces(parsePlaces(await response.json()), query);
  } catch {
    return [];
  }
}

/* ---------------- 模糊排序：让「完全命中 > 前缀 > 包含 > 只在地址里」排前面 ---------------- */

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[\s\u3000·・()（）\-—_/]+/g, '');
}

/**
 * 给候选打一个 0–100 的相关度分（越大越靠前）：
 * 名称完全等于 100、名称前缀 88、名称包含 76、地址包含 52、名字字数差得少再补 0–8。
 * 关键词为空时原序返回。
 */
export function placeRelevance(place: PlaceSuggestion, query: string): number {
  const q = normalizeText(query);
  if (!q) return 0;
  const name = normalizeText(place.name);
  const address = normalizeText(place.address);
  let score = 20;
  if (name === q) score = 100;
  else if (name.startsWith(q)) score = 88;
  else if (name.includes(q)) score = 76;
  else if (address.includes(q)) score = 52;
  const lengthSavings = Math.max(0, 8 - Math.max(0, name.length - q.length));
  return score + lengthSavings;
}

/** 按相关度排序（同分保持原序，稳定排序）。导出以便单测与页面复用。 */
export function rankPlaces(places: readonly PlaceSuggestion[], query: string): PlaceSuggestion[] {
  const q = query.trim();
  if (!q || places.length < 2) return [...places];
  return places
    .map((place, index) => ({ place, index, score: placeRelevance(place, q) }))
    .sort((a, b) => (b.score - a.score) || (a.index - b.index))
    .map(entry => entry.place);
}

/* ---------------- 最近选过的地点：本地记忆，输入时先给「最近」建议 ---------------- */

export const PLACE_RECENT_STORAGE = 'scendance-place-recent-v1';
const RECENT_LIMIT = 5;

function placeStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** 读最近地点；坏数据/无 localStorage 一律回空数组。 */
export function recentPlaces(): PlaceSuggestion[] {
  const store = placeStorage();
  if (!store) return [];
  try {
    const raw = store.getItem(PLACE_RECENT_STORAGE);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsePlaces({ places: parsed }).slice(0, RECENT_LIMIT);
  } catch {
    return [];
  }
}

/** 记住一个选中过的地点（按 id 去重、最多 5 条、最新的在前）。 */
export function rememberPlace(place: PlaceSuggestion): void {
  const store = placeStorage();
  if (!store) return;
  try {
    const next = [place, ...recentPlaces().filter(item => item.id !== place.id)].slice(0, RECENT_LIMIT);
    store.setItem(PLACE_RECENT_STORAGE, JSON.stringify(next));
  } catch {
    // 存不下就算了，不影响选地点。
  }
}

/** 关键词对最近地点做包含匹配（不区分大小写、忽略空格与标点）。 */
export function matchRecentPlaces(query: string): PlaceSuggestion[] {
  const q = normalizeText(query);
  const recent = recentPlaces();
  if (!q) return recent;
  return recent.filter(place => normalizeText(place.name).includes(q) || normalizeText(place.address).includes(q));
}