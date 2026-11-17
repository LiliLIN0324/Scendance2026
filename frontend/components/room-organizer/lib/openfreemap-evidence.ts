/**
 * 2026-11-16：地图结构化证据（site-context 线）的 OpenFreeMap 客户端源。
 *
 * 生产 `/api/site-context` 只轮询三个公共 Overpass 镜像，从 Pages 边缘全挂
 * （实测 503 / 15s 超时），物件阶段拿不到建筑/道路证据。与 `fetchRoadNetwork`
 * 同口径：浏览器直连与底图同源的 OpenFreeMap 行星瓦片（OSM 同源、CORS 开放、
 * CDN 十年缓存），先在客户端解码 transportation / building 图层，函数 Overpass
 * 仅作后手兜底。拿不到任何要素时返回 null，由调用方退服务端，不虚构地图理解。
 *
 * 坐标一律归一到 ENU（与 plan.anchor 同基准）：道路折线是 GCJ-02，建筑环是
 * WGS84（解码层原样带出）。入口、障碍、开放空间、室内连接不在 planet 这两个
 * 图层内，保持未知并在 warnings 如实标注。
 */
import { fetchOpenFreeMapRoads } from "./openfreemap-roads";
import {
  fetchOpenFreeMapBuildings,
  type LngLatRing,
} from "./openfreemap-buildings";
import type { RoadSegment } from "./road-network";
import {
  boundedRadius,
  isValidGeometry,
  toLocal,
  type MapEvidenceResult,
  type MapFeature,
  type Point,
} from "@/lib/site-intelligence";

const MAX_FEATURES = 300;

interface BBox {
  west: number;
  south: number;
  east: number;
  north: number;
}

/** 半径（米）→ 经纬度 bbox；口径与 fetchRoadNetwork 一致（GCJ anchor 直算，城市内偏移由瓦片余量兜住）。 */
function bboxFor(anchor: { lng: number; lat: number }, radiusM: number): BBox {
  const halfDegLat = radiusM / 111132.92;
  const halfDegLng = radiusM / (Math.cos((anchor.lat * Math.PI) / 180) * 111319.49);
  return {
    west: anchor.lng - halfDegLng,
    south: anchor.lat - halfDegLat,
    east: anchor.lng + halfDegLng,
    north: anchor.lat + halfDegLat,
  };
}

/** 与 evidence.ts 同口径：折线/环允许跨边界，只要任一顶点落在半径内。 */
function inRange(points: Point[], radius: number): boolean {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return (
    Math.min(...xs) <= radius &&
    Math.max(...xs) >= -radius &&
    Math.min(...ys) <= radius &&
    Math.max(...ys) >= -radius
  );
}

function roadFeature(road: RoadSegment, anchor: { lng: number; lat: number }, radius: number): MapFeature | null {
  try {
    const points = road.points.map(([lng, lat]) => toLocal(lng, lat, anchor, "gcj-02"));
    if (points.length < 2) return null;
    const geometry = { type: "line" as const, points };
    if (!isValidGeometry(geometry) || !inRange(points, radius)) return null;
    const id = `ofm:road/${road.id}`;
    return {
      id,
      kind: "road",
      name: road.name,
      geometry,
      tags: road.highway ? { highway: road.highway } : {},
      evidence: {
        source: "osm",
        sourceId: id,
        certainty: "mapped",
        note: "OpenFreeMap（OSM 同源瓦片）道路几何；不代表权属、现场通行或安全认证。入口/障碍/室内连接未知。",
      },
    };
  } catch {
    return null;
  }
}

function buildingFeature(ring: LngLatRing, anchor: { lng: number; lat: number }, radius: number): MapFeature | null {
  try {
    let points = ring.lngLat.map(([lng, lat]) => toLocal(lng, lat, anchor, "wgs84"));
    if (points.length < 3) return null;
    const closed =
      points.length >= 4 &&
      Math.hypot(
        points[0]!.x - points[points.length - 1]!.x,
        points[0]!.y - points[points.length - 1]!.y,
      ) < 0.01;
    if (closed) points = points.slice(0, -1);
    if (points.length < 3) return null;
    const geometry = { type: "polygon" as const, points };
    if (!isValidGeometry(geometry) || !inRange(points, radius)) return null;
    const id = `ofm:building/${ring.id}`;
    return {
      id,
      kind: "building",
      name: ring.name,
      geometry,
      tags: { building: "yes" },
      evidence: {
        source: "osm",
        sourceId: id,
        certainty: "mapped",
        note: "OpenFreeMap（OSM 同源瓦片）建筑足迹；不是活动授权范围。入口/障碍/室内连接未知。",
      },
    };
  } catch {
    return null;
  }
}

/**
 * 取 OpenFreeMap 客户端证据。任一瓦片源整体不可用（TileJSON 拿不到等）返回 null，
 * 由调用方退服务端 Overpass 后手；道路/建筑各自独立失败，互不拖累。
 */
/** 临时诊断旁路：定位浏览器生产环境证据线退兜底的根因，验收后删除。 */
function debug(part: string, payload: unknown) {
  try {
    const w = window as unknown as { __ofmDebug?: unknown[] };
    w.__ofmDebug = w.__ofmDebug ?? [];
    w.__ofmDebug.push({ part, ...(payload as object), at: new Date().toISOString() });
    console.warn("[ofm-evidence]", part, payload);
  } catch {
    /* 诊断旁路自身不得影响主流程 */
  }
}

export async function fetchOfmEvidence(
  anchor: { lng: number; lat: number },
  radiusM: number,
  signal?: AbortSignal,
): Promise<MapEvidenceResult | null> {
  debug("enter", { lng: anchor.lng, lat: anchor.lat, radiusM, aborted: Boolean(signal?.aborted) });
  let radius: number;
  let bbox: BBox;
  try {
    radius = boundedRadius(radiusM);
    bbox = bboxFor(anchor, radius);
  } catch (error) {
    debug("throw-before-fetch", { error: String(error) });
    throw error;
  }
  let settled: PromiseSettledResult<unknown>[];
  try {
    settled = await Promise.allSettled([
      fetchOpenFreeMapRoads(bbox, signal ? { signal } : {}),
      fetchOpenFreeMapBuildings(bbox, signal),
    ]);
  } catch (error) {
    debug("settled-throw", { error: String(error) });
    throw error;
  }
  const roadSettled = settled[0]!;
  const buildingSettled = settled[1]!;
  if (roadSettled.status === "rejected") debug("roads-rejected", { reason: String(roadSettled.reason) });
  if (buildingSettled.status === "rejected") debug("buildings-rejected", { reason: String(buildingSettled.reason) });
  const roads: RoadSegment[] =
    roadSettled.status === "fulfilled" ? (roadSettled.value as RoadSegment[]) : [];
  const rings: LngLatRing[] =
    buildingSettled.status === "fulfilled" ? (buildingSettled.value as LngLatRing[]) : [];
  debug("settled", { roads: roads.length, rings: rings.length, roadStatus: roadSettled.status, buildingStatus: buildingSettled.status });

  const features: MapFeature[] = [];
  for (const road of roads.slice(0, MAX_FEATURES)) {
    const feature = roadFeature(road, anchor, radius);
    if (feature) features.push(feature);
  }
  for (const ring of rings.slice(0, MAX_FEATURES)) {
    const feature = buildingFeature(ring, anchor, radius);
    if (feature) features.push(feature);
  }
  if (!features.length) {
    debug("empty-features", { roads: roads.length, rings: rings.length });
    return null;
  }
  debug("features", { count: features.length });

  const fetchedAt = new Date().toISOString();
  for (const feature of features) feature.evidence.observedAt = fetchedAt;
  return {
    status: "partial",
    features,
    warnings: [
      "OpenFreeMap（OSM 同源瓦片）道路与建筑足迹；真实入口、障碍、开放空间与室内连接仍未知，需现场核对。",
    ],
    complete: false,
    fetchedAt,
    scope: { anchor: { ...anchor }, radiusM: radius, crs: "gcj-02" },
  };
}
