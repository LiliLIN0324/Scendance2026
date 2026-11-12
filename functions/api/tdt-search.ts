import { wgs84ToGcj02 } from './geo-gcj';
import { tdtKeyFromEnv, type TdtServerEnv } from './tdt-env';

type Context = { request: Request; env: TdtServerEnv };

/** 与 amap-place 同形状，客户端 `place-search.ts` 只认这个契约。 */
export interface PlaceHit {
  id: string;
  name: string;
  address: string;
  lng: number;
  lat: number;
}

const KEYWORD_MIN = 2;
const KEYWORD_MAX = 80;
const PLACE_LIMIT_MAX = 10;
/**
 * 天地图 v2 地名搜索只在小范围 mapBound 内出结果（实测：1.3°×0.8° 有；
 * 4°×4° 以上、以及全国大框都返回 count 0，缺 mapBound 直接 2003 错），所以按「窄 → 中 → 宽」三档
 * 围着候选中心试探，第一档拿到结果就停（省 quota、也避免 429）。
 */
const BOUND_STEPS: readonly [number, number][] = [
  [0.16, 0.12],
  [0.35, 0.26],
  [0.7, 0.5],
];
/**
 * geocoder 的可信分。实测（2026-11-12）：「in77」「asdfgh」回 score 0 并被塞到大同（113.29,40.07），
 * 「查无此地xyz」回 score 42 却指向上海，「平湖秋月」score 0 指向嘉兴；而真地名是
 * 城市/区县 100、兴趣点 99（「湖滨银泰in77」只有 50，所以兴趣点类可以宽松些）。
 * 低于这些分既不当搜索中心，也不回那个点当建议。
 */
const TRUST_SCORE_MIN = 40;
const ADMIN_TRUST_SCORE_MIN = 80;

/** geocoder 结果可不可信：兴趣点/门牌号看 score ≥ 40，行政区划要求 ≥ 80（低分的行政区多半是硬塞的点）。 */
export function trustedGeocode(center: GeocodeCenter | null): center is GeocodeCenter {
  if (!center) return false;
  if (/兴趣点|门牌/.test(center.level)) return center.score >= TRUST_SCORE_MIN;
  if (/行政区/.test(center.level)) return center.score >= ADMIN_TRUST_SCORE_MIN;
  return center.score >= ADMIN_TRUST_SCORE_MIN;
}
/** 一次请求最多打几次上游搜索（多个中心 × 三档会吃满 8s 超时）。 */
const MAX_UPSTREAM_SEARCHES = 6;
const UPSTREAM_TIMEOUT_MS = 8000;

export function clampLimit(raw: string | null): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 6;
  return Math.min(PLACE_LIMIT_MAX, Math.max(1, Math.round(n)));
}

/** 关键词校验：2–80 字；与 amap-place 保持一致。 */
export function normalizeKeywords(raw: string | null): string | null {
  const text = (raw ?? '').trim();
  if (text.length < KEYWORD_MIN || text.length > KEYWORD_MAX) return null;
  return text;
}

export function boundAround(lng: number, lat: number, spanLng = BOUND_STEPS[0][0], spanLat = BOUND_STEPS[0][1]): string {
  const west = (lng - spanLng).toFixed(6);
  const south = (lat - spanLat).toFixed(6);
  const east = (lng + spanLng).toFixed(6);
  const north = (lat + spanLat).toFixed(6);
  return `${west},${south},${east},${north}`;
}

/** `center=120.16,30.25` → `{lng, lat}`；格式不对当没给。 */
export function parseCenter(raw: string | null): { lng: number; lat: number } | null {
  if (typeof raw !== 'string' || !raw.includes(',')) return null;
  const [lngRaw, latRaw] = raw.split(',');
  const lng = Number(lngRaw);
  const lat = Number(latRaw);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  if (Math.abs(lng) > 180 || Math.abs(lat) > 90) return null;
  return { lng, lat };
}

/** `"120.141439,30.254484"` → `{lng, lat}`；非法回 null。 */
export function parseLonLat(raw: unknown): { lng: number; lat: number } | null {
  if (typeof raw !== 'string') return null;
  const [lngRaw, latRaw] = raw.split(',');
  const lng = Number(lngRaw);
  const lat = Number(latRaw);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  if (Math.abs(lng) > 180 || Math.abs(lat) > 90) return null;
  return { lng, lat };
}

/**
 * 天地图 v2 地名搜索的响应 → PlaceHit[]（已转 GCJ-02）。
 * 上游字段：`{count, pois: [{name, address, lonlat: 'lng,lat', hotPointID, poiType}]}`
 */
export function placesFromSearchPayload(payload: unknown): PlaceHit[] {
  const pois = (payload as { pois?: unknown })?.pois;
  if (!Array.isArray(pois)) return [];
  const out: PlaceHit[] = [];
  for (const raw of pois) {
    const poi = raw as { name?: unknown; address?: unknown; lonlat?: unknown; hotPointID?: unknown };
    const name = typeof poi.name === 'string' ? poi.name.trim() : '';
    const point = parseLonLat(poi.lonlat);
    if (!name || !point) continue;
    const gcj = wgs84ToGcj02(point.lng, point.lat);
    const id = typeof poi.hotPointID === 'string' && poi.hotPointID ? poi.hotPointID : `${gcj.lng},${gcj.lat}`;
    out.push({
      id,
      name,
      address: typeof poi.address === 'string' ? poi.address.trim() : '',
      lng: Number(gcj.lng.toFixed(6)),
      lat: Number(gcj.lat.toFixed(6)),
    });
  }
  return out;
}

export interface GeocodeCenter {
  lng: number;
  lat: number;
  /** geocoder 自己的置信分（0–100），低于 TRUST_SCORE_MIN 说明它只是硬塞了一个点。 */
  score: number;
  /** 天地图的命中级别：`兴趣点` / `门牌号` / `区县及以上级行政区划` … */
  level: string;
  /** 天地图回填的规范名（拿不到就用关键词本身）。 */
  keyWord: string;
}

/** 地理编码单点（天地图 geocoder v2）。取不到回 null。 */
export async function geocodeCenter(keywords: string, key: string, fetchImpl: typeof fetch): Promise<GeocodeCenter | null> {
  const url = new URL('https://api.tianditu.gov.cn/geocoder');
  url.searchParams.set('ds', JSON.stringify({ keyWord: keywords }));
  url.searchParams.set('tk', key);
  try {
    const res = await fetchImpl(url.toString(), {
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      headers: { 'User-Agent': 'ScendancePages/2.2.0' },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      location?: { lon?: unknown; lat?: unknown; score?: unknown; level?: unknown; keyWord?: unknown };
    };
    const lng = Number(body.location?.lon);
    const lat = Number(body.location?.lat);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
    if (Math.abs(lng) > 180 || Math.abs(lat) > 90) return null;
    const score = Number(body.location?.score);
    return {
      lng,
      lat,
      score: Number.isFinite(score) ? score : 0,
      level: typeof body.location?.level === 'string' ? body.location.level : '',
      keyWord: typeof body.location?.keyWord === 'string' && body.location.keyWord.trim() ? body.location.keyWord.trim() : keywords,
    };
  } catch {
    return null;
  }
}

export function searchUrl(keywords: string, key: string, bound: string, count: number): string {
  const url = new URL('https://api.tianditu.gov.cn/v2/search');
  url.searchParams.set(
    'postStr',
    JSON.stringify({ keyWord: keywords, level: 12, mapBound: bound, queryType: 1, start: 0, count }),
  );
  url.searchParams.set('type', 'query');
  url.searchParams.set('tk', key);
  return url.toString();
}

/** 名字比较用：忽略大小写、空格与括号标点（「in77」≈「IN77」）。 */
function normalizeName(value: string): string {
  return value.toLowerCase().replace(/[\s\u3000·・()（）\-—_/]+/g, '');
}

/**
 * 天地图地名搜索代理：GET /api/tdt-search?keywords=平湖秋月&limit=6&center=120.16,30.25
 * - key 只留在 Pages 环境变量（TDT_KEY / NEXT_PUBLIC_TDT_KEY），响应里没有 tk。
 * - `center`（可选）是用户当前看的地方（画布锚点）；天地图只能在小范围 mapBound 内搜，
 *   有它就优先围着它搜——没有它时「in77」这种本地专名会被 geocoder 猜到大同（2026-11-12 实测）。
 * - 流程：geocoder 拿中心并判可信度 → 按「行政区意图/本地专名」定中心优先级（画布 → geocoder）→
 *   每个中心窄/中/宽三档 mapBound 搜 → 都没有就用可信的 geocoder 点兜底一条建议，否则 404。
 * - 坐标一律 CGCS2000 → GCJ-02，符合 `SitePlanData.anchor` 的 crs 契约。
 */
export async function handleTdtSearch(
  request: Request,
  env: TdtServerEnv,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const keywords = normalizeKeywords(params.get('keywords') ?? params.get('keyword'));
  if (!keywords) return jsonResponse({ error: 'keywords invalid' }, 400);
  const limit = clampLimit(params.get('limit'));
  const key = tdtKeyFromEnv(env);
  if (!key) return jsonResponse({ error: 'TDT_KEY missing' }, 503);
  const hint = parseCenter(params.get('center'));

  let searched = 0;
  const cache = new Map<string, PlaceHit[]>();
  const runSearch = async (bound: string): Promise<PlaceHit[]> => {
    const cached = cache.get(bound);
    if (cached) return cached;
    searched += 1;
    const places = await searchPlacesAt(keywords, key, bound, limit, fetchImpl);
    cache.set(bound, places);
    return places;
  };
  const target = normalizeName(keywords);

  // 有锚点就先打最窄一档（约 50–150ms）：命中同名 POI 直接回，省掉 geocoder 那一趟
  // ——它遇到「in77」这种查不到的词要 ~2s 才吐答案。
  if (hint) {
    const quick = await runSearch(boundAround(hint.lng, hint.lat, BOUND_STEPS[0][0], BOUND_STEPS[0][1]));
    if (quick.some(place => normalizeName(place.name) === target)) return jsonResponse({ places: quick }, 200);
  }

  const center = await geocodeCenter(keywords, key, fetchImpl);
  const trusted = trustedGeocode(center);
  // 搜的是行政区（「杭州」「西湖区」）→ 用户要的是那块地，不是名字带「杭州」的店。
  const adminIntent = Boolean(trusted && center && /行政区划|行政区/.test(center.level));

  const centers: { lng: number; lat: number }[] = [];
  const pushCenter = (point: { lng: number; lat: number } | null): void => {
    if (!point) return;
    if (centers.some(item => Math.abs(item.lng - point.lng) < 0.05 && Math.abs(item.lat - point.lat) < 0.05)) return;
    centers.push({ lng: point.lng, lat: point.lat });
  };
  if (adminIntent && trusted && center) pushCenter(center);
  pushCenter(hint);
  if (trusted && center) pushCenter(center);

  for (const point of centers) {
    for (const [spanLng, spanLat] of BOUND_STEPS) {
      if (searched >= MAX_UPSTREAM_SEARCHES) break;
      const places = await runSearch(boundAround(point.lng, point.lat, spanLng, spanLat));
      if (places.length > 0) return jsonResponse({ places }, 200);
    }
    if (searched >= MAX_UPSTREAM_SEARCHES) break;
  }

  // 没有找得到的地点：只有可信的 geocoder 点才当「至少能落钉」的兜底（不可信的就是没找到）。
  if (!trusted || !center) return jsonResponse({ error: 'no place' }, 404);
  const gcj = wgs84ToGcj02(center.lng, center.lat);
  const fallback: PlaceHit[] = [
    {
      id: `${gcj.lng.toFixed(6)},${gcj.lat.toFixed(6)}`,
      name: center.keyWord,
      address: center.level ? `天地图定位：${center.level}` : '',
      lng: Number(gcj.lng.toFixed(6)),
      lat: Number(gcj.lat.toFixed(6)),
    },
  ];
  return jsonResponse({ places: fallback }, 200);
}

/** 单档搜索：最多试两次（超时/网络错重试），空结果回 []。 */
async function searchPlacesAt(
  keywords: string,
  key: string,
  bound: string,
  limit: number,
  fetchImpl: typeof fetch,
): Promise<PlaceHit[]> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const res = await fetchImpl(searchUrl(keywords, key, bound, limit), {
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
        headers: { 'User-Agent': 'ScendancePages/2.2.0' },
      });
      if (!res.ok) continue;
      const places = placesFromSearchPayload(await res.json()).slice(0, limit);
      if (places.length > 0) return places;
      return [];
    } catch {
      // 超时/网络错：重试一次。
    }
  }
  return [];
}

function jsonHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'public, max-age=600',
    'X-Content-Type-Options': 'nosniff',
  };
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders() });
}

export const onRequestGet = (context: Context): Promise<Response> => handleTdtSearch(context.request, context.env);