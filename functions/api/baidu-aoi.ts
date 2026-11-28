/**
 * 搜索兜底补库：OSM 挖不到轮廓时，从百度 AOI 取一次真实边界，写进 place_shapes。
 *
 * 为什么放在 `/api/place-shape` 的 miss 分支：那一处正好是「用户选了一个场地、
 * 我们确实拿不出边框」的唯一收敛点——既覆盖画布搜索，也覆盖对话里选场地，
 * 而且不需要新端点、不改响应契约（200 `{shape:null}` 照旧，写库走 waitUntil 异步）。
 *
 * 三条硬约束：
 * 1. **不阻塞、不影响响应**：所有网络与写库都在 waitUntil 里跑，失败静默；
 *    用独立的 transport fetch，不借用请求自己的 20 s 预算（请求结束会 abort 它）。
 * 2. **不覆盖已有数据**：只在库里没有同名行时写。人工描过边的作业面比景区 AOI 细，
 *    自动抓的绝不能盖掉它。
 * 3. **不放大外部压力**：同一 isolate 内同名 10 分钟内只试一次；单次总预算 9 s；
 *    百度只给点没有 AOI 的场地直接放弃，不做二次猜测。
 *
 * 坐标：百度 `qt=ext` 的 geo 是 BD09 墨卡托米，按控制点标定换算到 GCJ-02
 * （与 tools/place-shapes/fetch-baidu-aoi.mjs 同一组常数），残差约 ±50 m。
 * 这是底稿精度，不是测量精度——入库后仍以人工收边为准。
 */

export interface BaiduAoiEnv {
  SUPABASE_URL?: string;
  NEXT_PUBLIC_SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?: string;
  NEXT_PUBLIC_SUPABASE_ANON_KEY?: string;
}

/** 与 functions/api/place-stock-config.ts 的默认库一致（线上 Function 读的就是它）。 */
const DEFAULT_SUPABASE_URL = 'https://wkhfvnzgopjdzxlmycks.supabase.co';

/** MC(BD09 墨卡托米) → GCJ-02：三点标定（杭州植物园 / 江寺公园 / 临安钱王陵园）。 */
const CALIBRATION = {
  lng: { a: 8.978697066554e-6, b: 0.05171037435591567 },
  lat: { a: 7.778292870121e-6, b: 2.910385526248087 },
};

const BAIDU_TIMEOUT_MS = 9000;
const MIN_AREA_M2 = 200;
const MAX_AREA_M2 = 5_000_000;
const ATTEMPT_TTL_MS = 10 * 60 * 1000;
const ATTEMPT_CACHE_MAX = 200;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36';

export function mcToGcj(x: number, y: number): { lng: number; lat: number } {
  return {
    lng: Number((CALIBRATION.lng.a * x + CALIBRATION.lng.b).toFixed(6)),
    lat: Number((CALIBRATION.lat.a * y + CALIBRATION.lat.b).toFixed(6)),
  };
}

interface McPoint { x: number; y: number }

/** 百度 `qt=ext` 的 geo："4|w,s;e,n|1-x1,y1,x2,y2;…" → 各环的 MC 点列。 */
export function parseBaiduGeo(geo: unknown): { type: number; rings: McPoint[][] } | null {
  const parts = String(geo ?? '').split('|');
  if (parts.length < 3) return null;
  const rings: McPoint[][] = [];
  for (const segment of parts.slice(2)) {
    for (const chunk of segment.split(';')) {
      const cleaned = chunk.replace(/^\d+-/, '').trim();
      if (!cleaned) continue;
      const numbers = cleaned.split(',').map(Number);
      if (numbers.length < 6 || numbers.length % 2 !== 0) continue;
      const ring: McPoint[] = [];
      for (let i = 0; i < numbers.length; i += 2) {
        const x = numbers[i]!;
        const y = numbers[i + 1]!;
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        ring.push({ x, y });
      }
      if (ring.length >= 3) rings.push(ring);
    }
  }
  return rings.length > 0 ? { type: Number(parts[0]), rings } : null;
}

function mcRingArea(ring: readonly McPoint[]): number {
  let twice = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    twice += a.x * b.y - b.x * a.y;
  }
  return Math.abs(twice) / 2;
}

/** GCJ 环真实面积（米²，等距圆柱近似）。 */
export function ringAreaM2(polygon: readonly (readonly [number, number])[]): number {
  if (polygon.length < 3) return 0;
  const lat0 = polygon[0]![1];
  const kx = Math.cos((lat0 * Math.PI) / 180) * 111320;
  let twice = 0;
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i]!;
    const b = polygon[(i + 1) % polygon.length]!;
    twice += (a[0] * kx) * (b[1] * 110540) - (b[0] * kx) * (a[1] * 110540);
  }
  return Math.abs(twice) / 2;
}

/** 自交检测（与服务端 simpleFootprint 同口径的轻量版）：自交的框不能入库。 */
export function isSimpleRing(polygon: readonly (readonly [number, number])[]): boolean {
  const pts = polygon.length > 3
    && polygon[0]![0] === polygon[polygon.length - 1]![0]
    && polygon[0]![1] === polygon[polygon.length - 1]![1]
    ? polygon.slice(0, -1)
    : polygon;
  if (pts.length < 3) return false;
  if (new Set(pts.map(p => `${p[0]},${p[1]}`)).size !== pts.length) return false;
  const cross = (a: readonly [number, number], b: readonly [number, number], c: readonly [number, number]) =>
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  for (let i = 0; i < pts.length; i += 1) {
    for (let j = i + 2; j < pts.length; j += 1) {
      if (i === 0 && j === pts.length - 1) continue;
      const a = pts[i]!;
      const b = pts[(i + 1) % pts.length]!;
      const c = pts[j]!;
      const d = pts[(j + 1) % pts.length]!;
      if (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0) return false;
    }
  }
  return true;
}

export interface PlaceAoiRow {
  id: string;
  name: string;
  name_norm: string;
  kind: 'area';
  center_lng: number;
  center_lat: number;
  polygon: [number, number][];
  bounds: [number, number, number, number];
  pts: number;
}

/** 与服务端 normalizeShapeName 同口径。 */
export function normalizeAoiName(value: string): string {
  return String(value ?? '').toLowerCase().replace(/[\s\u3000·．.,，()（）\-—_/]+/g, '');
}

/**
 * geo → 入库行；不合格返回 null。取 MC 面积最大的环当外轮廓，
 * 面积门槛与脚本一致：太小是亭子/门牌，太大是区域级地块。
 */
export function aoiRowFromGeo(geo: unknown, name: string, uid: string): PlaceAoiRow | null {
  const parsed = parseBaiduGeo(geo);
  if (!parsed) return null;
  const rings = parsed.rings
    .map(ring => ({ ring, area: mcRingArea(ring) }))
    .sort((a, b) => b.area - a.area);
  const outer = rings[0];
  if (!outer) return null;

  const polygon: [number, number][] = [];
  for (const point of outer.ring) {
    const gcj = mcToGcj(point.x, point.y);
    if (!Number.isFinite(gcj.lng) || !Number.isFinite(gcj.lat)) continue;
    polygon.push([gcj.lng, gcj.lat]);
  }
  if (polygon.length < 3) return null;
  if (!isSimpleRing(polygon)) return null;
  const areaM2 = ringAreaM2(polygon);
  if (areaM2 < MIN_AREA_M2 || areaM2 > MAX_AREA_M2) return null;

  let west = Infinity; let south = Infinity; let east = -Infinity; let north = -Infinity;
  for (const [lng, lat] of polygon) {
    west = Math.min(west, lng); east = Math.max(east, lng);
    south = Math.min(south, lat); north = Math.max(north, lat);
  }
  // 与库内既有行（含脚本写的那批）同口径：存不闭合环，最后一点不与首点重复。
  if (polygon.length > 3) {
    const head = polygon[0]!;
    const tail = polygon[polygon.length - 1]!;
    if (head[0] === tail[0] && head[1] === tail[1]) polygon.pop();
  }
  return {
    id: `baidu:${uid}`,
    name,
    name_norm: normalizeAoiName(name),
    kind: 'area',
    center_lng: Number(((west + east) / 2).toFixed(6)),
    center_lat: Number(((south + north) / 2).toFixed(6)),
    polygon, // 不闭合环（首尾不重复），与库内既有行一致
    bounds: [
      Number(west.toFixed(6)), Number(south.toFixed(6)),
      Number(east.toFixed(6)), Number(north.toFixed(6)),
    ],
    pts: polygon.length,
  };
}

/** 建议词取第一条（百度 Web 端内部接口，非公开 API）。 */
export async function baiduSuggest(name: string, fetchImpl: typeof fetch, signal: AbortSignal):
  Promise<{ uid: string; label: string } | null> {
  const url = `https://map.baidu.com/su?wd=${encodeURIComponent(name)}&cid=289&type=0&pc_ver=2&newmap=1&ie=utf-8&oue=1&fromproduct=jsapi&res=api`;
  const response = await fetchImpl(url, { headers: { 'User-Agent': UA, Referer: 'https://map.baidu.com/' }, signal });
  if (!response.ok) return null;
  const body = await response.json() as { s?: string[] };
  const first = (body.s ?? [])[0];
  if (!first) return null;
  const fields = first.split('$');
  const uid = fields[5];
  const label = fields[3];
  if (!uid) return null;
  return { uid, label: (label ?? name).trim() };
}

export async function baiduGeo(uid: string, fetchImpl: typeof fetch, signal: AbortSignal): Promise<unknown | null> {
  const url = `https://map.baidu.com/?qt=ext&uid=${uid}&ext_ver=new&l=18`;
  const response = await fetchImpl(url, { headers: { 'User-Agent': UA, Referer: 'https://map.baidu.com/' }, signal });
  if (!response.ok) return null;
  const body = await response.json() as { content?: { geo?: string } };
  return body.content?.geo ?? null;
}

/** isolate 内去重：同名 10 分钟内只试一次，避免同一场地被反复搜索时连续打百度。 */
const attempts = new Map<string, number>();

function recentlyAttempted(key: string): boolean {
  const now = Date.now();
  const at = attempts.get(key);
  if (at != null && now - at < ATTEMPT_TTL_MS) return true;
  if (attempts.size >= ATTEMPT_CACHE_MAX) {
    for (const [k, t] of attempts) if (now - t >= ATTEMPT_TTL_MS) attempts.delete(k);
    if (attempts.size >= ATTEMPT_CACHE_MAX) attempts.delete(attempts.keys().next().value as string);
  }
  attempts.set(key, now);
  return false;
}

function stockConfig(env: BaiduAoiEnv): { url: string; readKey: string; writeKey: string } | null {
  const writeKey = env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  const readKey = writeKey || env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
  const url = (env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || DEFAULT_SUPABASE_URL).replace(/\/$/, '');
  if (!url || !readKey) return null;
  return { url, readKey, writeKey };
}

function authHeaders(key: string): Record<string, string> {
  return { apikey: key, ...(key.startsWith('eyJ') ? { Authorization: `Bearer ${key}` } : {}) };
}

async function alreadyStocked(
  url: string, readKey: string, nameNorm: string, fetchImpl: typeof fetch, signal: AbortSignal,
): Promise<boolean> {
  const response = await fetchImpl(`${url}/rest/v1/place_shapes?name_norm=eq.${encodeURIComponent(nameNorm)}&select=name&limit=1`, {
    headers: authHeaders(readKey), signal,
  });
  if (!response.ok) return true; // 读不确定就当已有：宁可不写，也不覆盖人工数据
  const rows = await response.json() as unknown;
  return Array.isArray(rows) && rows.length > 0;
}

async function insertRow(
  url: string, writeKey: string, row: PlaceAoiRow, fetchImpl: typeof fetch, signal: AbortSignal,
): Promise<boolean> {
  const headers = {
    ...authHeaders(writeKey),
    'Content-Type': 'application/json',
    Prefer: 'resolution=merge-duplicates,return=minimal',
  };
  const body = JSON.stringify(row);
  // 线上表没有 name_norm 唯一索引：PostgREST 回 400/42P10，退回「先删同名再插」。
  let response = await fetchImpl(`${url}/rest/v1/place_shapes?on_conflict=name_norm`, { method: 'POST', headers, body, signal });
  if (!response.ok) {
    const text = await response.text();
    if (!text.includes('42P10') && response.status !== 409) return false;
    await fetchImpl(`${url}/rest/v1/place_shapes?name_norm=eq.${encodeURIComponent(row.name_norm)}`, {
      method: 'DELETE', headers: authHeaders(writeKey), signal,
    });
    response = await fetchImpl(`${url}/rest/v1/place_shapes`, { method: 'POST', headers, body, signal });
  }
  return response.ok;
}

export type AoiIngestResult = 'written' | 'skipped-existing' | 'skipped-recent' | 'skipped-no-key' | 'missed' | 'failed';

/**
 * 一次补库：百度建议 → AOI → 换算/校验 → 入库。永不抛错（调用方在 waitUntil 里跑）。
 * 只处理「库里还没有同名行」的场地；已有行一律跳过，保护人工描边。
 */
export async function ingestBaiduAoi(
  name: string,
  env: BaiduAoiEnv,
  fetchImpl: typeof fetch = fetch,
): Promise<AoiIngestResult> {
  const queryName = name.split('|')[0]?.trim() ?? '';
  if (queryName.length < 2 || queryName.length > 60) return 'missed';
  const stock = stockConfig(env);
  if (!stock?.writeKey) return 'skipped-no-key';
  const nameNorm = normalizeAoiName(queryName);
  if (recentlyAttempted(nameNorm)) return 'skipped-recent';

  const signal = AbortSignal.timeout(BAIDU_TIMEOUT_MS);
  try {
    const suggestion = await baiduSuggest(queryName, fetchImpl, signal);
    if (!suggestion) return 'missed';
    const geo = await baiduGeo(suggestion.uid, fetchImpl, signal);
    if (!geo) return 'missed';
    const row = aoiRowFromGeo(geo, queryName, suggestion.uid);
    if (!row) return 'missed';
    if (await alreadyStocked(stock.url, stock.readKey, nameNorm, fetchImpl, signal)) return 'skipped-existing';
    return (await insertRow(stock.url, stock.writeKey, row, fetchImpl, signal)) ? 'written' : 'failed';
  } catch {
    return 'failed';
  } finally {
    // 失败也保留 10 分钟冷却：百度抖动时不要每次搜索都重试一遍。
  }
}
