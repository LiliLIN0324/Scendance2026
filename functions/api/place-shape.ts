import { wgs84ToGcj02 } from './geo-gcj';
import { placeStockConfig, type PlaceStockEnv } from './place-stock-config';

type Context = { request: Request; env: PlaceStockEnv };

/**
 * POI 真实轮廓：GET /api/place-shape?name=湖滨银泰in77&near=120.160119,30.25296
 *
 * 2026-11-12 用户需求「点一个地名，像高德一样框选对应的地址区域」——高德的
 * 商圈虚线框是自有 AOI 数据，公开拿不到；公开世界里真实占地范围只有 OSM 有
 * （商场/公园/景区多为 landuse/building/leisure 面）。两步取形：
 *   ① photon（OSM 地理编码，免 key）按「名称 + 中心点」定位 → osm_type/osm_id；
 *   ② Overpass 按 id 取几何：way 直接用点列；relation 把成员 way 接龙成单环。
 * photon 不可达时的兜底：Overpass 直接按名搜面要素（先 way 快查、再 relation 慢查），
 * 用 near 收敛范围防全城正则扫；命中结果进程内缓存，镜像抖动时重复查询秒回。
 * 输出统一 GCJ-02（与 SitePlanData.anchor 同基准）、单环、≤320 点。
 * Overpass 忙时排队数十秒：预算给足，失败一律回 `{ shape: null }`（no-store，
 * 不让 CDN 把瞬断期间的 null 缓存一天），调用方降级只落定位钉，不弹错。
 */
export interface PlaceShape {
  id: string;
  name: string;
  /** area=闭合面选区；line=道路等开放折线（前端画粗线，不填充）。缺省视为 area。 */
  kind?: 'area' | 'line';
  polygon: [number, number][];
  bounds: [number, number, number, number];
}

const PHOTON_TIMEOUT_MS = 6000;
// 2026-11-13 用户反馈「圈范围太久」→ ①单台预算 45s→25s（QL timeout 同步 40→20），
// ②镜像熔断：刚失败的台 60s 内跳过（坏窗口里不再挨台等死，秒降级），
// ③三路并发抢答（photon/way/rel 同时开跑，见 handlePlaceShape）。
const OVERPASS_TIMEOUT_MS = 25000;
const OVERPASS_COOLDOWN_MS = 60000;
const SHAPE_MAX_POINTS = 320;
const NAME_MIN = 2;
const NAME_MAX = 60;
const OVERPASS_ENDPOINTS = [
  // mail.ru 镜像国内最稳（2026-11-12 实测：overpass-api.de 整段 502、photon/Nominatim 全不可达时它 15s 出结果）
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
];

export function normalizeShapeName(value: string): string {
  return String(value ?? '').toLowerCase().replace(/[\s\u3000·．.,，()（）\-—_/]+/g, '');
}

/** `"120.15,30.25"` → `{lng, lat}`；非法 null。 */
export function parseNear(raw: string | null): { lng: number; lat: number } | null {
  if (!raw) return null;
  const [lngRaw, latRaw] = raw.split(',');
  const lng = Number(lngRaw);
  const lat = Number(latRaw);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  if (Math.abs(lng) > 180 || Math.abs(lat) > 90) return null;
  return { lng, lat };
}

export interface PhotonHit {
  osmType: 'W' | 'R';
  osmId: number;
  label: string;
}

/** photon（按名称 + 视口中心偏置）→ OSM 对象 id；名称要互相包含才算命中同一个地方。 */
export async function photonLookup(
  name: string,
  near: { lng: number; lat: number } | null,
  fetchImpl: typeof fetch,
): Promise<PhotonHit | null> {
  const url = new URL('https://photon.komoot.io/api/');
  url.searchParams.set('q', name);
  if (near) {
    url.searchParams.set('lat', String(near.lat));
    url.searchParams.set('lon', String(near.lng));
  }
  url.searchParams.set('limit', '3');
  url.searchParams.set('lang', 'default');
  try {
    const res = await fetchImpl(url.toString(), {
      signal: AbortSignal.timeout(PHOTON_TIMEOUT_MS),
      headers: { 'User-Agent': 'ScdancePages/2.2.0' },
    });
    if (!res.ok) return null;
    const body = await res.json() as { features?: { properties?: { osm_type?: string; osm_id?: number; name?: string } }[] };
    const target = normalizeShapeName(name);
    if (!target) return null;
    for (const feature of body.features ?? []) {
      const props = feature?.properties;
      if (!props || props.osm_type !== 'W' && props.osm_type !== 'R') continue; // Node 无面几何
      const candidate = normalizeShapeName(props.name ?? '');
      if (!candidate) continue;
      if (candidate.includes(target)) {
        return { osmType: props.osm_type, osmId: Number(props.osm_id), label: (props.name ?? '').trim() };
      }
    }
    return null;
  } catch {
    return null;
  }
}

/** 镜像熔断表：endpoint → 熔断到期时间戳。刚失败的台先跳过，坏窗口秒降级不挨台等死。 */
const endpointCooldownByFetch = new WeakMap<typeof fetch, Map<string, number>>();
const requestBudgetByFetch = new WeakMap<typeof fetch, AbortSignal>();

/** Overpass POST；失败/超时熔断该台 60s 后换下一台，全部熔断中秒回 null。 */
export async function overpass(query: string, fetchImpl: typeof fetch): Promise<unknown | null> {
  let endpointCooldown = endpointCooldownByFetch.get(fetchImpl);
  if (!endpointCooldown) { endpointCooldown = new Map(); endpointCooldownByFetch.set(fetchImpl, endpointCooldown); }
  const body = 'data=' + encodeURIComponent(query);
  const now = Date.now();
  const live = OVERPASS_ENDPOINTS.filter(ep => (endpointCooldown.get(ep) ?? 0) <= now);
  if (live.length === 0) return null; // 全部熔断中：直接放弃，别把超时预算烧完
  for (const endpoint of live) {
    try {
      const res = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { 'User-Agent': 'ScdancePages/2.2.0', 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
        signal: AbortSignal.timeout(OVERPASS_TIMEOUT_MS),
      });
      if (!res.ok) { endpointCooldown.set(endpoint, Date.now() + OVERPASS_COOLDOWN_MS); continue; } // 失败（含 403/451/520 系）熔断后换下一台
      const payload = await res.json();
      endpointCooldown.delete(endpoint);
      return payload;
    } catch {
      if (requestBudgetByFetch.get(fetchImpl)?.aborted) return null;
      endpointCooldown.set(endpoint, Date.now() + OVERPASS_COOLDOWN_MS); // 超时/网络失败也熔断
    }
  }
  return null;
}

interface OverpassNode { lat: number; lon: number }

interface OverpassElement {
  type?: string;
  id?: number;
  tags?: { name?: string };
  nodes?: number[];
  geometry?: OverpassNode[];
  members?: { type?: string; role?: string; ref?: number; nodes?: number[]; geometry?: OverpassNode[] }[];
}

/** relation 成员 way 接龙成单环（按首尾节点 id）；拼不拢（多部件）回 null。 */
export function stitchRelationRings(
  elements: readonly unknown[],
): OverpassNode[] | null {
  type Piece = { pts: OverpassNode[]; head: number; tail: number };
  const pieces = new Map<number, Piece>();
  for (const raw of elements) {
    const el = raw as { type?: string; id?: number; nodes?: number[]; geometry?: OverpassNode[] };
    if (el?.type !== 'way' || !Array.isArray(el.nodes) || !Array.isArray(el.geometry)) continue;
    const pts = el.geometry.filter(g => Number.isFinite(g?.lon) && Number.isFinite(g?.lat));
    if (pts.length < 2 || el.nodes.length < 2) continue;
    pieces.set(Number(el.id), { pts, head: el.nodes[0]!, tail: el.nodes[el.nodes.length - 1]! });
  }
  if (pieces.size === 0) return null;
  const first = pieces.keys().next().value as number;
  const cursorPiece = pieces.get(first)!;
  pieces.delete(first);
  const ring: OverpassNode[] = [...cursorPiece.pts];
  let tailNode = cursorPiece.tail;
  let guard = 0;
  while (pieces.size > 0 && guard < 500) {
    guard += 1;
    let matched: { id: number; piece: Piece; reverse: boolean } | null = null;
    for (const [id, piece] of pieces) {
      if (piece.head === tailNode) { matched = { id, piece, reverse: false }; break; }
      if (piece.tail === tailNode) { matched = { id, piece, reverse: true }; break; }
    }
    if (!matched) return null;
    const pts = matched.reverse ? [...matched.piece.pts].reverse() : matched.piece.pts;
    ring.push(...pts.slice(1));
    tailNode = matched.reverse ? matched.piece.head : matched.piece.tail;
    pieces.delete(matched.id);
  }
  return ring.length >= 3 ? ring : null;
}

/** 命中过的 shape 进程内缓存（Workers isolate 级）：公共镜像抖动大，重复查询秒回、省上游配额。 */
const shapeCache = new Map<string, PlaceShape>();
const SHAPE_CACHE_MAX = 64;

function cacheShape(key: string, shape: PlaceShape): PlaceShape {
  if (shapeCache.size >= SHAPE_CACHE_MAX) shapeCache.delete(shapeCache.keys().next().value as string);
  shapeCache.set(key, shape);
  return shape;
}

function escapeOverpassRegex(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|"]/g, ch => `\\${ch}`);
}

/** GCJ-02 射线法：near 落在多边形内才认为「用户点的是这块地」。 */
export function pointInGcjPolygon(
  point: { lng: number; lat: number },
  polygon: readonly (readonly [number, number])[],
): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i]!;
    const [xj, yj] = polygon[j]!;
    const crosses = (yi > point.lat) !== (yj > point.lat)
      && point.lng < ((xj - xi) * (point.lat - yi)) / (yj - yi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

function gcjBBoxArea(polygon: readonly (readonly [number, number])[]): number {
  let west = Infinity; let south = Infinity; let east = -Infinity; let north = -Infinity;
  for (const [lng, lat] of polygon) {
    west = Math.min(west, lng); east = Math.max(east, lng);
    south = Math.min(south, lat); north = Math.max(north, lat);
  }
  return (east - west) * (north - south);
}

/** bbox 平方米（等距圆柱近似）——空间命中候选的绝对尺寸门槛用。 */
function gcjBBoxAreaM2(polygon: readonly (readonly [number, number])[]): number {
  let west = Infinity; let south = Infinity; let east = -Infinity; let north = -Infinity;
  for (const [lng, lat] of polygon) {
    west = Math.min(west, lng); east = Math.max(east, lng);
    south = Math.min(south, lat); north = Math.max(north, lat);
  }
  const latMid = (north + south) / 2;
  return ((east - west) * 111320 * Math.cos((latMid * Math.PI) / 180)) * ((north - south) * 110540);
}

/** 折线（道路）→ GCJ 线型选区：不闭合、不填充，前端画粗线。 */
export function lineToGcjShape(pts: readonly OverpassNode[], id: string, label: string): PlaceShape | null {
  if (pts.length < 2) return null;
  const simplified = simplifyRingMeters(pts, 4);
  const stride = Math.max(1, Math.ceil(simplified.length / SHAPE_MAX_POINTS));
  const polygon: [number, number][] = [];
  for (let i = 0; i < simplified.length; i += stride) {
    const gcj = wgs84ToGcj02(simplified[i]!.lon, simplified[i]!.lat);
    polygon.push([Number(gcj.lng.toFixed(6)), Number(gcj.lat.toFixed(6))]);
  }
  if (polygon.length < 2) return null;
  let west = Infinity; let south = Infinity; let east = -Infinity; let north = -Infinity;
  for (const [lng, lat] of polygon) {
    west = Math.min(west, lng); east = Math.max(east, lng);
    south = Math.min(south, lat); north = Math.max(north, lat);
  }
  return {
    id,
    name: label,
    kind: 'line',
    polygon,
    bounds: [Number(west.toFixed(6)), Number(south.toFixed(6)), Number(east.toFixed(6)), Number(north.toFixed(6))],
  };
}

/** relation 成员直接按坐标接龙成单环（`out geom` 的成员带 geometry；首尾点相同即相接，不依赖节点 id）。 */
export function stitchMemberGeometry(members: readonly unknown[]): OverpassNode[] | null {
  const key = (p: OverpassNode) => `${p.lon.toFixed(7)},${p.lat.toFixed(7)}`;
  const pieces: { pts: OverpassNode[]; head: string; tail: string }[] = [];
  for (const raw of members) {
    const m = raw as { role?: string; geometry?: OverpassNode[] };
    if (m?.role === 'inner' || !Array.isArray(m.geometry)) continue;
    const pts = m.geometry.filter(g => Number.isFinite(g?.lon) && Number.isFinite(g?.lat));
    if (pts.length < 2) continue;
    pieces.push({ pts, head: key(pts[0]!), tail: key(pts[pts.length - 1]!) });
  }
  if (pieces.length === 0) return null;
  const ring: OverpassNode[] = [...pieces[0]!.pts];
  let tail = pieces[0]!.tail;
  const rest = pieces.slice(1);
  let guard = 0;
  while (rest.length > 0 && guard < 500) {
    guard += 1;
    const idx = rest.findIndex(p => p.head === tail || p.tail === tail);
    if (idx < 0) return null;
    const piece = rest.splice(idx, 1)[0]!;
    const reverse = piece.tail === tail;
    const pts = reverse ? [...piece.pts].reverse() : piece.pts;
    ring.push(...pts.slice(1));
    tail = reverse ? piece.head : piece.tail;
  }
  return rest.length === 0 && ring.length >= 3 ? ring : null;
}

/** photon 命中路径：按 osm id 取几何；relation 先试整包元素接龙，失败再从成员 geometry 拼环。 */
export async function shapeFromOsmId(
  osmType: 'W' | 'R',
  osmId: number,
  label: string,
  fetchImpl: typeof fetch,
): Promise<PlaceShape | null> {
  const kind = osmType === 'R' ? 'rel' : 'way';
  const payload = await overpass(`[out:json][timeout:20];${kind}(${osmId});out geom;`, fetchImpl) as
    { elements?: OverpassElement[] } | null;
  const elements = payload?.elements;
  if (!Array.isArray(elements) || elements.length === 0) return null;
  const primary = elements.find(el => el?.type === kind && el?.id === osmId);
  if (!primary) return null;
  let nodes: OverpassNode[] | null = null;
  if (kind === 'way') {
    const pts = (primary.geometry ?? []).filter(g => Number.isFinite(g?.lon) && Number.isFinite(g?.lat));
    nodes = pts.length >= 3 ? pts : null;
  } else {
    nodes = stitchRelationRings(elements) ?? stitchMemberGeometry(primary.members ?? []);
  }
  return nodes ? shapeFromNodes(nodes, `osm:${osmType}${osmId}`, label) : null;
}

interface NameCandidate {
  el: OverpassElement;
  label: string;
  ring: OverpassNode[];
}

/** 候选排序：同名 > 包含定位点 > 其余；同级名字短的优先（整场地 > 区块），面积大的优先。 */
export function pickNameCandidate(
  candidates: readonly NameCandidate[],
  name: string,
  near: { lng: number; lat: number } | null,
): NameCandidate | null {
  const target = normalizeShapeName(name);
  if (!target) return null;
  const scored: (NameCandidate & { rank: number; nameLen: number; area: number })[] = [];
  for (const c of candidates) {
    if (c.ring.length < 4) continue;
    const first = c.ring[0]!; const last = c.ring[c.ring.length - 1]!;
    if (Math.abs(first.lon - last.lon) > 1e-6 || Math.abs(first.lat - last.lat) > 1e-6) continue;
    const candidate = normalizeShapeName(c.label);
    if (!candidate || !candidate.includes(target)) continue;
    const gcj = c.ring.map(p => {
      const g = wgs84ToGcj02(p.lon, p.lat);
      return [g.lng, g.lat] as [number, number];
    });
    if (!simpleFootprint(gcj) || footprintAreaM2(gcj) < 20) continue;
    const rank = candidate === target ? 0 : (near && pointInGcjPolygon(near, gcj) ? 1 : 2);
    scored.push({ ...c, rank, nameLen: candidate.length, area: gcjBBoxArea(gcj) });
  }
  scored.sort((a, b) => a.rank - b.rank || a.nameLen - b.nameLen || b.area - a.area);
  return scored[0] ?? null;
}

/** Overpass 按名搜单类要素（kind='way'|'relation'）：geometry 随结果返回，无需二次请求。 */
export async function nameSearchStage(
  name: string,
  near: { lng: number; lat: number },
  kind: 'way' | 'relation',
  fetchImpl: typeof fetch,
): Promise<PlaceShape | null> {
  const safe = escapeOverpassRegex(name);
  const query = `[out:json][timeout:20];${kind}["name"~"${safe}",i]["type"!="route"](around:1500,${near.lat},${near.lng});out geom;`;
  const payload = await overpass(query, fetchImpl) as { elements?: OverpassElement[] } | null;
  const elements = payload?.elements ?? [];
  if (kind === 'way') {
    const pick = pickNameCandidate(
      elements
        .filter(el => el?.type === 'way' && Array.isArray(el.geometry))
        .map(el => ({ el, label: el.tags?.name ?? '', ring: el.geometry!.filter(g => Number.isFinite(g?.lon) && Number.isFinite(g?.lat)) })),
      name, near,
    );
    return pick ? shapeFromNodes(pick.ring, `osm:W${pick.el.id}`, pick.label || name) : null;
  }
  const relCandidates: NameCandidate[] = [];
  for (const el of elements) {
    if (el?.type !== 'relation' || !Array.isArray(el.members)) continue;
    const ring = stitchMemberGeometry(el.members ?? []);
    if (!ring) continue;
    relCandidates.push({ el, label: el.tags?.name ?? '', ring });
  }
  const pick = pickNameCandidate(relCandidates, name, near);
  return pick ? shapeFromNodes(pick.ring, `osm:R${pick.el.id}`, pick.label || name) : null;
}

/** photon 精确链：osm_id 定位 → 按 id 取几何。 */
export async function photonPath(
  name: string,
  near: { lng: number; lat: number } | null,
  fetchImpl: typeof fetch,
): Promise<PlaceShape | null> {
  const hit = await photonLookup(name, near, fetchImpl);
  if (!hit) return null;
  return shapeFromOsmId(hit.osmType, hit.osmId, hit.label || name, fetchImpl);
}

/** 三路并发抢答：谁先挖到用谁的，全空才 null——串行排队是「圈范围太久」的主因。 */
export function firstNonNull<T>(tasks: readonly (() => Promise<T | null>)[]): Promise<T | null> {
  return new Promise(resolve => {
    let pending = tasks.length;
    if (!pending) { resolve(null); return; }
    for (const task of tasks) {
      Promise.resolve().then(task).then(value => {
        if (value) resolve(value);
        else if (--pending === 0) resolve(null);
      }).catch(() => {
        if (--pending === 0) resolve(null);
      });
    }
  });
}

/** 空间命中：点在哪个面里就框哪个面——不看名字，是「点建筑出建筑选区」的主路径。 */
export async function spatialAreaStage(
  name: string,
  near: { lng: number; lat: number },
  fetchImpl: typeof fetch,
): Promise<PlaceShape | null> {
  const at = `${near.lat},${near.lng}`;
  const query = `[out:json][timeout:20];(way["building"](around:400,${at});way["landuse"](around:400,${at});way["leisure"](around:400,${at});way["amenity"](around:400,${at});way["shop"](around:400,${at});way["tourism"](around:400,${at});way["man_made"](around:400,${at});way["natural"](around:400,${at}););out geom;`;
  const payload = await overpass(query, fetchImpl) as { elements?: OverpassElement[] } | null;
  const elements = payload?.elements ?? [];
  const target = normalizeShapeName(name);
  const candidates: { el: OverpassElement; label: string; ring: OverpassNode[]; area: number; nameMatch: boolean }[] = [];
  for (const el of elements) {
    if (el?.type !== 'way' || !Array.isArray(el.geometry)) continue;
    const pts = el.geometry.filter(g => Number.isFinite(g?.lon) && Number.isFinite(g?.lat));
    if (pts.length < 4) continue;
    // 面要素要闭合（首尾同点）；开放折线（道路）不在此列，走 highway 线型兜底
    if (Math.abs(pts[0]!.lat - pts[pts.length - 1]!.lat) > 1e-6 || Math.abs(pts[0]!.lon - pts[pts.length - 1]!.lon) > 1e-6) continue;
    const gcj = pts.map(p => {
      const g = wgs84ToGcj02(p.lon, p.lat);
      return [g.lng, g.lat] as [number, number];
    });
    if (!pointInGcjPolygon(near, gcj) || !simpleFootprint(gcj) || footprintAreaM2(gcj) < 20) continue;
    const area = gcjBBoxAreaM2(gcj);
    if (area > 9e6) continue; // 3km×3km 门槛：更大的多是区域级地块，不算「点中的建筑」
    const label = el.tags?.name ?? '';
    const candidate = normalizeShapeName(label);
    candidates.push({
      el,
      label,
      ring: pts,
      area,
      nameMatch: !!(target && candidate && candidate.includes(target)),
    });
  }
  if (candidates.length === 0) return null;
  // 有匹配名称候选优先（点的名字就是它）；否则取「包含点击点的最小的面」=点中的那个建筑
  const named = candidates.filter(c => c.nameMatch);
  const pool = named.length > 0 ? named : candidates;
  pool.sort((a, b) => a.area - b.area);
  const pick = pool[0]!;
  return shapeFromNodes(pick.ring, `osm:W${pick.el.id}`, pick.label || name);
}

/** 道路线型兜底：面要素都不命中时，框住点击点最近的道路段（前端画粗线高亮）。 */
export async function highwayLineStage(
  near: { lng: number; lat: number },
  name: string,
  fetchImpl: typeof fetch,
): Promise<PlaceShape | null> {
  const at = `${near.lat},${near.lng}`;
  const query = `[out:json][timeout:20];way["highway"](around:60,${at});out geom;`;
  const payload = await overpass(query, fetchImpl) as { elements?: OverpassElement[] } | null;
  const elements = payload?.elements ?? [];
  // 名字门槛（2026-11-13 用户「点 in77 给了开元路」）：路名必须与查询名互相包含，
  // 无名/不同名的路一律不要——道路兜底只为「点道路」服务，绝不替 POI 编一个路选区。
  const target = normalizeShapeName(name);
  let best: { el: OverpassElement; pts: OverpassNode[]; label: string } | null = null;
  let bestD = Infinity;
  for (const el of elements) {
    if (el?.type !== 'way' || !Array.isArray(el.geometry)) continue;
    const pts = el.geometry.filter(g => Number.isFinite(g?.lon) && Number.isFinite(g?.lat));
    if (pts.length < 2) continue;
    const label = el.tags?.name ?? '';
    const candidate = normalizeShapeName(label);
    if (!target || !candidate || !candidate.includes(target)) continue;
    let d = Infinity;
    for (const p of pts) {
      const dd = Math.hypot((p.lon - near.lng) * 85000, (p.lat - near.lat) * 111000);
      if (dd < d) d = dd;
    }
    if (d < bestD) { bestD = d; best = { el, pts, label }; }
  }
  if (!best || bestD > 120) return null; // 120m 内没有同名道路段就放弃（宁降级只落钉，不出错路）
  return lineToGcjShape(best.pts, `osm:W${best.el.id}`, best.label || name);
}

/** 米制近似坐标（等距圆柱，x=lon·cos(lat0)·111320 / y=lat·110540）。 */
function ringToMeters(ring: readonly OverpassNode[]): { x: number; y: number }[] {
  const lat0 = ring[0]!.lat;
  const kx = Math.cos((lat0 * Math.PI) / 180) * 111320;
  return ring.map(p => ({ x: p.lon * kx, y: p.lat * 110540 }));
}

/** 轻量 Douglas-Peucker 抽稀（米制）：压掉楼宇尺度的微抖动，轮廓像高德一样干净。 */
export function simplifyRingMeters(ring: readonly OverpassNode[], toleranceM: number): OverpassNode[] {
  if (ring.length < 5) return [...ring];
  const pts = ringToMeters(ring);
  const keep = new Array<boolean>(ring.length).fill(false);
  keep[0] = true;
  keep[ring.length - 1] = true;
  const stack: [number, number][] = [[0, ring.length - 1]];
  while (stack.length > 0) {
    const [a, b] = stack.pop()!;
    if (b <= a + 1) continue;
    const ax = pts[a]!.x; const ay = pts[a]!.y;
    const dx = pts[b]!.x - ax; const dy = pts[b]!.y - ay;
    const len2 = dx * dx + dy * dy || 1e-9;
    let maxD = -1; let maxI = -1;
    for (let i = a + 1; i < b; i++) {
      const t = Math.max(0, Math.min(1, ((pts[i]!.x - ax) * dx + (pts[i]!.y - ay) * dy) / len2));
      const ex = ax + dx * t - pts[i]!.x;
      const ey = ay + dy * t - pts[i]!.y;
      const d = Math.sqrt(ex * ex + ey * ey);
      if (d > maxD) { maxD = d; maxI = i; }
    }
    if (maxD > toleranceM) {
      keep[maxI] = true;
      stack.push([a, maxI], [maxI, b]);
    }
  }
  const out: OverpassNode[] = [];
  for (let i = 0; i < ring.length; i++) if (keep[i]) out.push(ring[i]!);
  return out;
}

/** OSM 几何（WGS84）→ 单环 polygon + bounds（GCJ-02，≤320 点）。 */
export function shapeFromNodes(nodes: readonly OverpassNode[], id: string, label: string): PlaceShape | null {
  if (nodes.length < 4) return null;
  const first = nodes[0]!; const last = nodes[nodes.length - 1]!;
  if (Math.abs(first.lon - last.lon) > 1e-6 || Math.abs(first.lat - last.lat) > 1e-6) return null;
  const simplified = simplifyRingMeters(nodes, 4);
  const stride = Math.max(1, Math.ceil(simplified.length / SHAPE_MAX_POINTS));
  const polygon: [number, number][] = [];
  for (let i = 0; i < simplified.length; i += stride) {
    const gcj = wgs84ToGcj02(simplified[i]!.lon, simplified[i]!.lat);
    polygon.push([Number(gcj.lng.toFixed(6)), Number(gcj.lat.toFixed(6))]);
  }
  if (polygon.length < 3) return null;
  let west = Infinity; let south = Infinity; let east = -Infinity; let north = -Infinity;
  for (const [lng, lat] of polygon) {
    west = Math.min(west, lng); east = Math.max(east, lng);
    south = Math.min(south, lat); north = Math.max(north, lat);
  }
  return {
    id,
    name: label,
    polygon,
    bounds: [
      Number(west.toFixed(6)), Number(south.toFixed(6)),
      Number(east.toFixed(6)), Number(north.toFixed(6)),
    ],
  };
}


/** 折线长度（米，等距圆柱近似）。 */
export function gcjPolylineLengthM(polygon: readonly (readonly [number, number])[]): number {
  if (polygon.length < 2) return 0;
  const lat0 = polygon[0]![1];
  const kx = Math.cos((lat0 * Math.PI) / 180) * 111320;
  let length = 0;
  for (let i = 1; i < polygon.length; i += 1) {
    const dx = (polygon[i]![0] - polygon[i - 1]![0]) * kx;
    const dy = (polygon[i]![1] - polygon[i - 1]![1]) * 110540;
    length += Math.hypot(dx, dy);
  }
  return length;
}

/**
 * 可展示的选区：面要有像样的占地，线要有像样的路长。
 * 「杭州大厦」曾出现 3 点 kind:line 垃圾几何——太短的折线不当选区，降级只落钉。
 * 与 tools/aholo/lux3d-dev-proxy.mjs 同口径。
 */
export function isDisplayablePlaceShape(shape: { kind?: string | null; polygon?: unknown; name?: string } | null | undefined): boolean {
  const pts = readShapePoints(shape);
  if (!pts || /(?:→|->|往返|公交线路|公交路线)/u.test(shape?.name ?? '')) return false;
  if (shape!.kind === 'line') return /(?:路|街|巷|大道|高速|公路|步道|胡同|road|street|avenue|lane|highway)$/iu.test(shape?.name ?? '') && pts.length >= 2 && gcjPolylineLengthM(pts) >= 80;
  return pts.length >= 3 && simpleFootprint(pts) && footprintAreaM2(pts) >= 20;
}

/**
 * 可信占地轮廓：只有面才算「有轮廓」。线型（含 3 点垃圾线）既不入库，也不参与搜索优先排序。
 */
export function isPersistablePlaceShape(shape: { kind?: string | null; polygon?: unknown; name?: string } | null | undefined): boolean {
  if (!shape || shape.kind === 'line') return false;
  return isDisplayablePlaceShape(shape);
}

function simpleFootprint(polygon: readonly (readonly [number, number])[]): boolean {
  if (polygon.length > 2048) return false;
  const first = polygon[0]; const last = polygon[polygon.length - 1];
  if (!first || !last) return false;
  const pts = first[0] === last[0] && first[1] === last[1] ? polygon.slice(0, -1) : polygon;
  if (pts.length < 3 || new Set(pts.map(p => `${p[0]},${p[1]}`)).size !== pts.length) return false;
  const cross = (a: readonly [number, number], b: readonly [number, number], c: readonly [number, number]) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  for (let i = 0; i < pts.length; i += 1) for (let j = i + 2; j < pts.length; j += 1) {
    if (i === 0 && j === pts.length - 1) continue;
    const a = pts[i]!; const b = pts[(i + 1) % pts.length]!; const c = pts[j]!; const d = pts[(j + 1) % pts.length]!;
    if (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0) return false;
  }
  return true;
}

function footprintAreaM2(polygon: readonly (readonly [number, number])[]): number {
  if (polygon.length < 3) return 0;
  const x0 = polygon[0]![0]; const y0 = polygon[0]![1];
  const kx = Math.cos(y0 * Math.PI / 180) * 111320;
  let twice = 0;
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i]!; const b = polygon[(i + 1) % polygon.length]!;
    twice += (a[0] - x0) * kx * (b[1] - y0) * 110540 - (b[0] - x0) * kx * (a[1] - y0) * 110540;
  }
  return Math.abs(twice) / 2;
}

function readShapePoints(shape: { polygon?: unknown } | null | undefined): [number, number][] | null {
  if (!shape || !Array.isArray(shape.polygon)) return null;
  const pts: [number, number][] = [];
  for (const vertex of shape.polygon) {
    if (!Array.isArray(vertex) || vertex.length < 2 || typeof vertex[0] !== 'number' || typeof vertex[1] !== 'number') return null;
    const lng = Number(vertex[0]);
    const lat = Number(vertex[1]);
    if (!Number.isFinite(lng) || !Number.isFinite(lat) || Math.abs(lng) > 180 || Math.abs(lat) > 90) return null;
    pts.push([lng, lat]);
  }
  return pts;
}

/** 名字分段候选：整名优先（最长），再按 -·/空格 拆段。与 lux3d-dev-proxy 对齐。 */
export function shapeNameCandidates(queryName: string): string[] {
  const whole = queryName.trim();
  if (!whole) return [];
  return [
    whole,
    ...whole.split(/[-·\s]+/).map(s => s.trim()).filter(s => s.length >= 2),
  ].filter((value, index, all) => all.indexOf(value) === index)
    .sort((a, b) => b.length - a.length);
}

function acceptShape(shape: PlaceShape | null): PlaceShape | null {
  return shape && isDisplayablePlaceShape(shape) ? shape : null;
}

async function lookupPlaceStock(
  nameNorm: string,
  near: ReturnType<typeof parseNear>,
  env: PlaceStockEnv,
  fetchImpl: typeof fetch,
): Promise<PlaceShape | null> {
  const stock = placeStockConfig(env);
  if (!stock || !nameNorm) return null;
  const withoutCity = (value: string) => value.replace(/^(?:杭州市|杭州)/u, '');
  const query = withoutCity(nameNorm);
  if (!query) return null;
  try {
    const params = new URLSearchParams({
      name_norm: `eq.${nameNorm}`,
      select: 'id,name,kind,polygon,bounds',
      limit: '10',
    });
    const response = await fetchImpl(`${stock.url}?${params}`, {
      headers: stock.headers,
      signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) return null;
    const rows: unknown = await response.json();
    if (!Array.isArray(rows)) return null;
    const matches = rows.filter((row): row is PlaceShape => {
      if (typeof row?.id !== 'string' || typeof row.name !== 'string' || row.kind !== 'area'
        || !isPersistablePlaceShape(row) || !Array.isArray(row.bounds) || row.bounds.length !== 4
        || !row.bounds.every(Number.isFinite)) return false;
      const canonical = withoutCity(normalizeShapeName(row.name));
      if (canonical !== query && !(/^[a-z]+[0-9]+$/i.test(query) && canonical.endsWith(query))) return false;
      const [west, south, east, north] = row.bounds;
      return west < east && south < north && (!near ||
        (near.lng >= west - 0.01 && near.lng <= east + 0.01 && near.lat >= south - 0.01 && near.lat <= north + 0.01));
    });
    return matches.length === 1 ? matches[0]! : null;
  } catch {
    return null;
  }
}

export async function handlePlaceShape(
  request: Request,
  fetchImpl: typeof fetch = fetch,
  env: PlaceStockEnv = {},
): Promise<Response> {
  const budget = AbortSignal.any([request.signal, AbortSignal.timeout(65000)]);
  const transport = fetchImpl;
  const cooldown = endpointCooldownByFetch.get(transport) ?? new Map<string, number>();
  endpointCooldownByFetch.set(transport, cooldown);
  fetchImpl = ((input, init) => transport(input, { ...init, signal: init?.signal ? AbortSignal.any([budget, init.signal]) : budget })) as typeof fetch;
  endpointCooldownByFetch.set(fetchImpl, cooldown);
  requestBudgetByFetch.set(fetchImpl, budget);
  const params = new URL(request.url).searchParams;
  const name = (params.get('name') ?? '').trim();
  if (name.length < NAME_MIN || name.length > NAME_MAX) {
    return json({ error: 'name invalid' }, 400);
  }
  const near = parseNear(params.get('near'));
  // 检索名只取「名称 | 地址」的名称段：地址尾巴会污染 photon 匹配与 Overpass 按名正则，
  // 是「只有 in77 出框、大部分地点不出框」的主因之一（2026-11-13 用户要求大部分搜索带框）。
  const queryName = name.split('|')[0].trim() || name;
  const nameNorm = normalizeShapeName(queryName);
  const cacheKey = `${nameNorm}|${near ? `${near.lng.toFixed(4)},${near.lat.toFixed(4)}` : ''}`;
  const cached = shapeCache.get(cacheKey);
  if (cached && isDisplayablePlaceShape(cached)) return json({ shape: cached }, 200);
  if (cached) shapeCache.delete(cacheKey); // 缓存里的垃圾几何（如 3 点 line）丢掉，重新挖
  const stocked = await lookupPlaceStock(nameNorm, near, env, fetchImpl);
  if (stocked) return json({ shape: cacheShape(cacheKey, stocked) }, 200);
  // 五路抢答（2026-11-13「点哪儿框哪儿」改造）：空间命中是主路径——点的坐标就在
  // 建筑/园区里，按点查面不看名字，结构上保证「点建筑=建筑选区」；way/rel 按名兜底；
  // 全落空再查最近道路段画线型选区（点道路=道路选区）。
  // 名字分段重试与 3199 代理对齐：高德名对不上 OSM 全名时按段再试。
  const segmentCandidates = shapeNameCandidates(queryName);
  let shape: PlaceShape | null = null;
  for (let i = 0; i < segmentCandidates.length && !shape && !budget.aborted; i += 1) {
    const candidate = segmentCandidates[i]!;
    shape = await firstNonNull([
      () => photonPath(candidate, near, fetchImpl).then(acceptShape),
      async () => {
        if (!near) return null;
        return acceptShape(await nameSearchStage(candidate, near, 'way', fetchImpl))
          ?? acceptShape(await nameSearchStage(candidate, near, 'relation', fetchImpl));
      },
    ]);
  }
  if (!shape && near && !budget.aborted) shape = acceptShape(await spatialAreaStage(queryName, near, fetchImpl));
  if (!shape && near && !budget.aborted) shape = acceptShape(await highwayLineStage(near, queryName, fetchImpl));
  if (shape) cacheShape(cacheKey, shape);
  // 未命中不写进程缓存、HTTP no-store：避免把 Overpass 抖动期间的 null 缓存一天。
  return shape ? json({ shape }, 200) : json({ shape: null }, 200, false);
}

function json(body: unknown, status: number, cacheable = true): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': cacheable ? 'public, max-age=86400' : 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

export const onRequestGet = (context: Context): Promise<Response> => handlePlaceShape(context.request, fetch, context.env);
