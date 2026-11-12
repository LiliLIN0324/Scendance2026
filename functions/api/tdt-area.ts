import { wgs84ToGcj02 } from './geo-gcj';
import { tdtKeyFromEnv, type TdtServerEnv } from './tdt-env';

type Context = { request: Request; env: TdtServerEnv };

/**
 * 选区（行政区边界）搜索代理：GET /api/tdt-area?keywords=西湖区&near=120.15,30.25&limit=3
 *
 * 2026-11-12 用户反馈「输入地理位置时希望能给我相关的选区，而不是一个居中的点」：
 * 地名搜索只回点（v2/search 的 lonlat），行政区划接口（v2/administrative）才带边界。
 * 这里把天地图的 `boundary`（WKT MULTIPOLYGON，CGCS2000）解析成环，取最大的一块，
 * 采样到 ≤240 个顶点，再统一转 GCJ-02，客户端拿去画选区 + 框住视野。
 *
 * 只做「看一眼这块地」的辅助：不写 plan / anchor，也不改场地边界。
 */
export interface PlaceAreaHit {
  id: string;
  name: string;
  /** 行政区级别的中文名：省 / 市 / 区县 …（天地图 level 数字映射）。 */
  level: string;
  /** 中心点（GCJ-02）。 */
  lng: number;
  lat: number;
  /** 选区外框 `[west, south, east, north]`（GCJ-02）。 */
  bounds: [number, number, number, number];
  /** 选区多边形顶点（GCJ-02，首尾不重复）。 */
  polygon: [number, number][];
}

const KEYWORD_MIN = 2;
const KEYWORD_MAX = 40;
const AREA_LIMIT_MAX = 5;
const MAX_POLYGON_POINTS = 240;
const UPSTREAM_TIMEOUT_MS = 8000;
const LEVEL_LABELS: Record<number, string> = { 1: '省', 2: '区县', 3: '市', 4: '街道' };

export function normalizeAreaKeywords(raw: string | null): string | null {
  const text = (raw ?? '').trim();
  if (text.length < KEYWORD_MIN || text.length > KEYWORD_MAX) return null;
  return text;
}

export function clampAreaLimit(raw: string | null): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 3;
  return Math.min(AREA_LIMIT_MAX, Math.max(1, Math.round(n)));
}

/** `"120.15,30.25"` → `{lng, lat}`；非法回 null。 */
export function parseNear(raw: string | null): { lng: number; lat: number } | null {
  if (!raw) return null;
  const [lngRaw, latRaw] = raw.split(',');
  const lng = Number(lngRaw);
  const lat = Number(latRaw);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  if (Math.abs(lng) > 180 || Math.abs(lat) > 90) return null;
  return { lng, lat };
}

/**
 * WKT（POLYGON / MULTIPOLYGON）→ 环数组。
 * 只取最内层的坐标串：`((x y, x y, …))` / `(((…)),((…)))` 都能拆开，
 * 外层的嵌套括号本身不携带信息。
 */
export function ringsFromWkt(wkt: string): [number, number][][] {
  const rings: [number, number][][] = [];
  if (typeof wkt !== 'string' || !wkt.includes('(')) return rings;
  const pattern = /\(([^()]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(wkt)) !== null) {
    const points: [number, number][] = [];
    for (const pair of match[1].split(',')) {
      const [lngRaw, latRaw] = pair.trim().split(/\s+/);
      const lng = Number(lngRaw);
      const lat = Number(latRaw);
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
      if (Math.abs(lng) > 180 || Math.abs(lat) > 90) continue;
      points.push([lng, lat]);
    }
    if (points.length >= 3) rings.push(points);
  }
  return rings;
}

/** 环的有向面积（度数²，仅用于比较大小，不参与长度换算）。 */
export function ringArea(ring: readonly [number, number][]): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    sum += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(sum) / 2;
}

/** 等步长抽稀到 ≤ max 个点（保留首点，环闭合由绘制方负责）。 */
export function thinRing(ring: readonly [number, number][], max = MAX_POLYGON_POINTS): [number, number][] {
  if (ring.length <= max) return ring.map(pair => [pair[0], pair[1]]);
  const stride = Math.ceil(ring.length / max);
  const out: [number, number][] = [];
  for (let i = 0; i < ring.length; i += stride) out.push([ring[i]![0], ring[i]![1]]);
  return out;
}

/** 天地图行政区划响应 → PlaceAreaHit[]（已转 GCJ-02、已挑最大环、已抽稀）。 */
export function areasFromDistrictPayload(payload: unknown, near: { lng: number; lat: number } | null = null): PlaceAreaHit[] {
  const districts = (payload as { data?: { district?: unknown } } | null)?.data?.district;
  if (!Array.isArray(districts)) return [];
  const out: PlaceAreaHit[] = [];
  const seen = new Set<string>();
  for (const raw of districts) {
    const item = raw as {
      name?: unknown; gb?: unknown; boundary?: unknown; center?: unknown; level?: unknown;
    };
    const name = typeof item.name === 'string' ? item.name.trim() : '';
    const wkt = typeof item.boundary === 'string' ? item.boundary : '';
    if (!name || !wkt) continue;
    const id = typeof item.gb === 'string' && item.gb ? item.gb : `${name}:${wkt.length}`;
    if (seen.has(id)) continue;
    const rings = ringsFromWkt(wkt);
    if (rings.length === 0) continue;
    let biggest = rings[0]!;
    for (const ring of rings) if (ringArea(ring) > ringArea(biggest)) biggest = ring;
    const thinned = thinRing(biggest);
    const polygon: [number, number][] = thinned.map(([lng, lat]) => {
      const gcj = wgs84ToGcj02(lng, lat);
      return [Number(gcj.lng.toFixed(6)), Number(gcj.lat.toFixed(6))] as [number, number];
    });
    if (polygon.length < 3) continue;
    let west = Infinity; let south = Infinity; let east = -Infinity; let north = -Infinity;
    for (const [lng, lat] of polygon) {
      west = Math.min(west, lng); east = Math.max(east, lng);
      south = Math.min(south, lat); north = Math.max(north, lat);
    }
    const centerRaw = item.center as { lng?: unknown; lat?: unknown } | undefined;
    const cnLng = Number(centerRaw?.lng);
    const cnLat = Number(centerRaw?.lat);
    const center = Number.isFinite(cnLng) && Number.isFinite(cnLat)
      ? wgs84ToGcj02(cnLng, cnLat)
      : { lng: (west + east) / 2, lat: (south + north) / 2 };
    const levelNo = Number(item.level);
    seen.add(id);
    out.push({
      id,
      name,
      level: LEVEL_LABELS[levelNo] ?? '行政区',
      lng: Number(center.lng.toFixed(6)),
      lat: Number(center.lat.toFixed(6)),
      bounds: [
        Number(west.toFixed(6)), Number(south.toFixed(6)),
        Number(east.toFixed(6)), Number(north.toFixed(6)),
      ],
      polygon,
    });
  }
  if (!near) return out;
  // 同名行政区全国有多份（西湖区在杭州/南昌各一个）：按距画布中心远近排序。
  return out
    .map(hit => ({ hit, d: (hit.lng - near.lng) ** 2 + (hit.lat - near.lat) ** 2 }))
    .sort((a, b) => a.d - b.d)
    .map(entry => entry.hit);
}

export function areaSearchUrl(keywords: string, key: string): string {
  const url = new URL('https://api.tianditu.gov.cn/v2/administrative');
  url.searchParams.set('keyword', keywords);
  url.searchParams.set('childLevel', '0');
  url.searchParams.set('extensions', 'true');
  url.searchParams.set('tk', key);
  return url.toString();
}

export async function handleTdtArea(
  request: Request,
  env: TdtServerEnv,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const keywords = normalizeAreaKeywords(params.get('keywords') ?? params.get('keyword'));
  if (!keywords) return json({ error: 'keywords invalid' }, 400);
  const limit = clampAreaLimit(params.get('limit'));
  const near = parseNear(params.get('near'));
  const key = tdtKeyFromEnv(env);
  if (!key) return json({ error: 'TDT_KEY missing' }, 503);
  try {
    const res = await fetchImpl(areaSearchUrl(keywords, key), {
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      headers: { 'User-Agent': 'ScendancePages/2.2.0' },
    });
    if (!res.ok) return json({ areas: [] }, 200);
    const areas = areasFromDistrictPayload(await res.json(), near).slice(0, limit);
    return json({ areas }, 200);
  } catch {
    return json({ areas: [] }, 200);
  }
}

function jsonHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'public, max-age=600',
    'X-Content-Type-Options': 'nosniff',
  };
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders() });
}

export const onRequestGet = (context: Context): Promise<Response> => handleTdtArea(context.request, context.env);