/**
 * 地点检索客户端（创建活动时填「活动地点」用）。
 *
 * 两套服务端契约同形（`{ places: [{ id, name, address, lng, lat }] }`，坐标 GCJ-02）：
 * - 本机开发（localhost / 127.0.0.1）：`http://127.0.0.1:3199/api/tdt-search`，
 *   代理读根 .env.local 的 TDT_KEY（天地图），且带 CORS。
 * - 线上：同源 `/api/amap-place`（Pages Function，AMAP_STATIC_KEY）。
 *   为什么线上不用天地图：天地图 CloudWAF 会拦截境外节点（Cloudflare 边缘出口）
 *   的请求，实测 geocoder 418「访问被拦截」（2026-11-12），而 restapi.amap.com
 *   从边缘可达——线上搜索切高德（amap-place 与 tdt-search 契约同形，客户端不用改）。
 * - Key（TDT_KEY / AMAP_STATIC_KEY）都只留在服务端，不进页面。
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
  /**
   * 用户当前看的地方（画布中心 / 项目锚点，GCJ-02）。
   * 天地图的地名搜索只能在小范围 mapBound 内出结果，没有这个提示点就只能靠 geocoder 猜中心——
   * 实测「in77」会被 geocoder 猜到大同（score 0），而围着杭州搜就能命中「湖滨银泰 in77」。
   */
  center?: { lng: number; lat: number } | null;
}

/** 本机开发走 3199（天地图）；线上走同源 Pages Function 高德代理。与 amap-venue 的 usesLocalAmapProxy 同口径。 */
export function usesLocalPlaceProxy(): boolean {
  if (typeof window === 'undefined') return false;
  const host = window.location?.hostname ?? '';
  return host === 'localhost' || host === '127.0.0.1' || host === '';
}

export function placeSearchUrl(
  keywords: string,
  limit = 6,
  local = usesLocalPlaceProxy(),
  center: { lng: number; lat: number } | null = null,
): string {
  const params = new URLSearchParams({ keywords: keywords.trim(), limit: String(limit) });
  if (center && Number.isFinite(center.lng) && Number.isFinite(center.lat)) {
    params.set('center', `${center.lng.toFixed(6)},${center.lat.toFixed(6)}`);
  }
  const query = params.toString();
  return local ? `http://127.0.0.1:3199/api/tdt-search?${query}` : `/api/amap-place?${query}`;
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
    const response = await doFetch(placeSearchUrl(query, options.limit ?? 6, local, options.center ?? null), {
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

/**
 * 建议栏合成：**名字与关键词完全一致的新鲜结果**最先——旧版 geocoder 兜底点（地址是
 * 「天地图定位：…」）被选中后会进「最近选过」，凭同名挤在真 POI 前面，回车默认选第一条
 * 就又飞回假点；所以完全命中的新鲜结果压过「最近」，其后按「最近 → 其余新鲜结果」排列，
 * 按 id 去重。关键词为空时只有最近建议。
 */
export function mergePlaceSuggestions(
  keyword: string,
  recent: readonly PlaceSuggestion[],
  hits: readonly PlaceSuggestion[],
): PlaceSuggestion[] {
  const query = keyword.trim();
  const seen = new Set<string>();
  const out: PlaceSuggestion[] = [];
  const push = (place: PlaceSuggestion): void => {
    if (seen.has(place.id)) return;
    seen.add(place.id);
    out.push(place);
  };
  if (query) {
    for (const hit of hits) if (placeRelevance(hit, query) >= 100) push(hit);
    for (const item of recent) push(item);
    for (const hit of hits) push(hit);
    return out;
  }
  // 空关键词只有最近建议（调用方此时本来也不会有搜索结果，这里防御性丢弃）。
  for (const item of recent) push(item);
  return out;
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