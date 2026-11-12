import { wgs84ToGcj02 } from './geo-gcj';

type Context = { request: Request };

/**
 * 路网矢量：GET /api/road-network?lat=30.4094&lng=120.541&span=1200
 *
 * V-2a（2026-11-13）：流线自动生成的道路几何来源。底图瓦片只有图像，
 * 可计算的道路折线只有 OSM 有——Overpass `way["highway"]` 按 bbox 拉取，
 * 与底图同源天然对齐。折线 GCJ-02（与 plan.anchor 同基准）、服务端抽稀 ≤160 点/条。
 * 失败一律回 `{ roads: [] }`（no-store），调用方回「路网暂时拿不到」，不弹错。
 * 与 place-shape 共用镜像端点与熔断策略（mail.ru 置首国内最稳）。
 */
export interface RoadWire {
  id: string;
  highway: string;
  name: string;
  points: [number, number][];
}

const OVERPASS_TIMEOUT_MS = 25000;
const OVERPASS_COOLDOWN_MS = 60000;
const ROAD_MAX_POINTS = 160;
const OVERPASS_ENDPOINTS = [
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
];

const endpointCooldown = new Map<string, number>();

function parseCoordinate(raw: string | null, limit: number): number | null {
  if (!raw) return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || Math.abs(value) > limit) return null;
  return value;
}

/** 简化折线：等步长抽稀到上限（Overpass geom 已是简化折线，米制 DP 留给前端渲染层）。 */
function decimate(points: [number, number][]): [number, number][] {
  if (points.length <= ROAD_MAX_POINTS) return points;
  const stride = Math.ceil(points.length / ROAD_MAX_POINTS);
  const out: [number, number][] = [];
  for (let i = 0; i < points.length; i += stride) out.push(points[i]!);
  return out;
}

export function parseRoadWires(body: unknown): RoadWire[] {
  const elements = (body as { elements?: unknown[] } | null)?.elements;
  if (!Array.isArray(elements)) return [];
  const roads: RoadWire[] = [];
  for (const raw of elements) {
    const el = raw as { type?: string; id?: number; tags?: { name?: string; highway?: string }; geometry?: { lon?: number; lat?: number }[] };
    if (el?.type !== 'way' || !Array.isArray(el.geometry) || !el.tags?.highway) continue;
    const points: [number, number][] = [];
    for (const node of el.geometry) {
      if (!Number.isFinite(node?.lon) || !Number.isFinite(node?.lat)) continue;
      const gcj = wgs84ToGcj02(node.lon!, node.lat!);
      points.push([Number(gcj.lng.toFixed(6)), Number(gcj.lat.toFixed(6))]);
    }
    if (points.length < 2) continue;
    roads.push({
      id: `osm:W${el.id ?? roads.length}`,
      highway: el.tags.highway,
      name: el.tags.name ?? '',
      points: decimate(points),
    });
  }
  return roads;
}

export async function handleRoadNetwork(
  request: Request,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const lng = parseCoordinate(params.get('lng'), 180);
  const lat = parseCoordinate(params.get('lat'), 90);
  const spanRaw = Number(params.get('span') ?? 1200);
  const span = Number.isFinite(spanRaw) ? Math.min(5000, Math.max(200, spanRaw)) : 1200;
  if (lng === null || lat === null) return json({ roads: [] }, 200, false);
  const halfDegLat = span / 111132.92;
  const halfDegLng = span / (Math.cos(lat * Math.PI / 180) * 111319.49);
  const south = lat - halfDegLat; const north = lat + halfDegLat;
  const west = lng - halfDegLng; const east = lng + halfDegLng;
  // bbox 直接圈范围；highway 全类型拉取，等级映射归客户端（road-network.ts lib）
  const query = `[out:json][timeout:20];way["highway"](${south.toFixed(6)},${west.toFixed(6)},${north.toFixed(6)},${east.toFixed(6)});out geom;`;
  const roads = await overpass(query, fetchImpl) ?? [];
  return json({ roads }, 200, false);
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

async function overpass(query: string, fetchImpl: typeof fetch): Promise<RoadWire[] | null> {
  const body = 'data=' + encodeURIComponent(query);
  const now = Date.now();
  const live = OVERPASS_ENDPOINTS.filter(ep => (endpointCooldown.get(ep) ?? 0) <= now);
  if (live.length === 0) return null;
  for (const endpoint of live) {
    try {
      const res = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { 'User-Agent': 'ScdancePages/2.2.0', 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
        signal: AbortSignal.timeout(OVERPASS_TIMEOUT_MS),
      });
      if (!res.ok) { endpointCooldown.set(endpoint, Date.now() + OVERPASS_COOLDOWN_MS); continue; }
      const payload = await res.json();
      const roads = parseRoadWires(payload);
      endpointCooldown.delete(endpoint);
      return roads;
    } catch {
      endpointCooldown.set(endpoint, Date.now() + OVERPASS_COOLDOWN_MS);
    }
  }
  return null;
}

export const onRequestGet = (context: Context): Promise<Response> => handleRoadNetwork(context.request);
