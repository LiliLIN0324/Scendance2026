/**
 * V-2a/V-2b（2026-11-13）：路网矢量客户端 + 高速路等级 → 流线类别映射。
 *
 * 底图瓦片只有图像，流线自动生成需要可计算的道路几何——来源 OSM Overpass
 * `way["highway"]`（与底图同源，天然对齐）。服务端两份：
 * - dev：lux3d-dev-proxy `/api/road-network`（复用 Overpass 镜像熔断管线）；
 * - 线上：`functions/api/road-network.ts`（同契约）。
 * 坐标一律 GCJ-02（与 plan.anchor 同基准），客户端只做等级映射与裁剪。
 */

import { usesLocalPlaceProxy } from './place-search';

export interface RoadSegment {
  id: string;
  /** OSM highway 等级：motorway/trunk/primary/secondary/tertiary/residential/service/pedestrian/footway/path… */
  highway: string;
  name: string;
  /** GCJ-02 折线（已按服务端抽稀）。 */
  points: [number, number][];
}

export interface RoadNetwork {
  roads: RoadSegment[];
}

/** 流线三类与 planRouteKinds 一致：人行 / 车辆 / 后勤。 */
export type RouteClass = 'pedestrian' | 'vehicle' | 'service';

/**
 * highway 等级 → 流线类别（V-2b v1 口径，用户可后续调）：
 * 车行=机动车主/次干道；人行=步行/步道类；后勤=服务道路与支路街巷。
 */
const HIGHWAY_CLASS_MAP: Record<string, RouteClass> = {
  motorway: 'vehicle',
  motorway_link: 'vehicle',
  trunk: 'vehicle',
  trunk_link: 'vehicle',
  primary: 'vehicle',
  primary_link: 'vehicle',
  secondary: 'vehicle',
  secondary_link: 'vehicle',
  tertiary: 'vehicle',
  tertiary_link: 'vehicle',
  residential: 'service',
  unclassified: 'service',
  service: 'service',
  living_street: 'service',
  pedestrian: 'pedestrian',
  footway: 'pedestrian',
  path: 'pedestrian',
  track: 'pedestrian',
  steps: 'pedestrian',
  cycleway: 'pedestrian',
};

export function routeClassForHighway(highway: string): RouteClass | null {
  return HIGHWAY_CLASS_MAP[highway] ?? null;
}

export function routeClassLabel(routeClass: RouteClass): string {
  return routeClass === 'pedestrian' ? '人行' : routeClass === 'vehicle' ? '车行' : '后勤';
}

export function parseRoadNetwork(body: unknown): RoadSegment[] {
  const raw = (body as { roads?: unknown } | null)?.roads;
  if (!Array.isArray(raw)) return [];
  const roads: RoadSegment[] = [];
  for (const entry of raw) {
    const item = entry as Partial<RoadSegment> | null;
    if (!item || !Array.isArray(item.points)) continue;
    const points: [number, number][] = [];
    for (const vertex of item.points) {
      if (!Array.isArray(vertex) || vertex.length < 2) continue;
      const lng = Number(vertex[0]);
      const lat = Number(vertex[1]);
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
      points.push([lng, lat]);
    }
    if (points.length < 2) continue;
    roads.push({
      id: String(item.id ?? `${points[0]![0]},${points[0]![1]}`),
      highway: String(item.highway ?? ''),
      name: String(item.name ?? '').trim(),
      points,
    });
  }
  return roads;
}

export async function fetchRoadNetwork(
  center: { lng: number; lat: number },
  spanM: number,
  options: { signal?: AbortSignal; local?: boolean; fetchImpl?: typeof fetch } = {},
): Promise<RoadNetwork> {
  const local = options.local ?? usesLocalPlaceProxy();
  const doFetch = options.fetchImpl ?? fetch;
  const params = new URLSearchParams({
    lat: center.lat.toFixed(6),
    lng: center.lng.toFixed(6),
    span: String(Math.round(spanM)),
  });
  const url = local
    ? `http://127.0.0.1:3199/api/road-network?${params.toString()}`
    : `/api/road-network?${params.toString()}`;
  // Overpass 忙时要排队：给足 50s 预算，失败回空路网（调用方回「路网暂时拿不到」）。
  const response = await doFetch(url, { signal: options.signal ?? AbortSignal.timeout(50000) });
  if (!response.ok) return { roads: [] };
  return { roads: parseRoadNetwork(await response.json()) };
}
