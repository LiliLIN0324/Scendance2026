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
import { fetchOpenFreeMapBuildings, type LngLatRing } from "./openfreemap-buildings";
import { fetchOpenFreeMapParks, type ParkPatch } from "./openfreemap-parks";
import { fetchOpenFreeMapRoads } from "./openfreemap-roads";
import { fetchOpenFreeMapWater, type WaterWire } from "./openfreemap-water";
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
 * 水体要素（2026-11-17）：面状水按 polygon 出，线状水按 line 出。
 * 面环若因抽稀/自交过不了 `isValidGeometry`，就降级成闭合折线——岸线仍可用，只是不声称它是水面面积。
 */
function waterFeature(
  wire: WaterWire,
  anchor: { lng: number; lat: number },
  radius: number,
): MapFeature | null {
  try {
    let points = wire.lngLat.map(([lng, lat]) => toLocal(lng, lat, anchor, "wgs84"));
    if (points.length < 2) return null;
    const closed =
      wire.shape === "area" &&
      points.length >= 4 &&
      Math.hypot(
        points[0]!.x - points[points.length - 1]!.x,
        points[0]!.y - points[points.length - 1]!.y,
      ) < 0.01;
    if (closed) points = points.slice(0, -1);
    if (!inRange(points, radius)) return null;
    const areaGeometry = { type: "polygon" as const, points };
    const lineGeometry = { type: "line" as const, points: [...points, points[0]!] };
    const polygon =
      wire.shape === "area" && points.length >= 3 && isValidGeometry(areaGeometry);
    const geometry = polygon ? areaGeometry : lineGeometry;
    if (!isValidGeometry(geometry)) return null;
    const label =
      wire.name ||
      (wire.waterClass === "lake"
        ? "湖区"
        : wire.waterClass === "pond"
          ? "水塘"
          : wire.waterClass === "ocean"
            ? "海域"
            : wire.shape === "area"
              ? "水面"
              : "河道");
    return {
      id: wire.id,
      kind: "water",
      name: label,
      geometry,
      tags: { water: wire.waterClass },
      evidence: {
        source: "osm",
        sourceId: wire.id,
        certainty: "mapped",
        note: "OpenFreeMap（OSM 同源瓦片）水体/水道几何；不是岸线测量，不代表可下水、权属或救生条件。",
      },
    };
  } catch {
    return null;
  }
}


/**
 * 绿地要素（2026-11-18 docs/47 A1）：planet park/landcover 图层的绿地面按 polygon 出，
 * kind 沿 open-space（可踩踏面）；park/garden 出 leisure 标签，grass/wood 出 landcover
 * 标签，A2 分级都按 soft 档输入。
 */
function parkFeature(
  patch: ParkPatch,
  anchor: { lng: number; lat: number },
  radius: number,
): MapFeature | null {
  try {
    let points = patch.lngLat.map(([lng, lat]) => toLocal(lng, lat, anchor, "wgs84"));
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
    const isLeisure = patch.parkClass === "park" || patch.parkClass === "garden";
    const fallbackName =
      patch.parkClass === "park"
        ? "公园"
        : patch.parkClass === "garden"
          ? "公园绿地"
          : patch.parkClass === "wood"
            ? "林地"
            : "草地";
    return {
      id: patch.id,
      kind: "open-space",
      name: patch.name || fallbackName,
      geometry,
      tags: isLeisure ? { leisure: patch.parkClass } : { landcover: patch.parkClass },
      evidence: {
        source: "osm",
        sourceId: patch.id,
        certainty: "mapped",
        note: "OpenFreeMap（OSM 同源瓦片）公园/绿地几何；开放空间不代表可占用、权属或活动授权。入口/障碍未知。",
      },
    };
  } catch {
    return null;
  }
}


export async function fetchOfmEvidence(
  anchor: { lng: number; lat: number },
  radiusM: number,
  signal?: AbortSignal,
): Promise<MapEvidenceResult | null> {
  let radius: number;
  let bbox: BBox;
  try {
    radius = boundedRadius(radiusM);
    bbox = bboxFor(anchor, radius);
  } catch (error) {
    throw error;
  }
  let settled: PromiseSettledResult<unknown>[];
  try {
    settled = await Promise.allSettled([
      fetchOpenFreeMapRoads(bbox, signal ? { signal } : {}),
      fetchOpenFreeMapBuildings(bbox, signal),
      fetchOpenFreeMapWater(bbox, signal),
      fetchOpenFreeMapParks(bbox, signal),
    ]);
  } catch (error) {
    throw error;
  }
  const roadSettled = settled[0]!;
  const buildingSettled = settled[1]!;
  const waterSettled = settled[2]!;
  const parkSettled = settled[3]!;
  const roads: RoadSegment[] =
    roadSettled.status === "fulfilled" ? (roadSettled.value as RoadSegment[]) : [];
  const rings: LngLatRing[] =
    buildingSettled.status === "fulfilled" ? (buildingSettled.value as LngLatRing[]) : [];
  const waters: WaterWire[] =
    waterSettled?.status === "fulfilled" ? (waterSettled.value as WaterWire[]) : [];
  const parks: ParkPatch[] =
    parkSettled?.status === "fulfilled" ? (parkSettled.value as ParkPatch[]) : [];

  const features: MapFeature[] = [];
  for (const road of roads.slice(0, MAX_FEATURES)) {
    const feature = roadFeature(road, anchor, radius);
    if (feature) features.push(feature);
  }
  for (const ring of rings.slice(0, MAX_FEATURES)) {
    const feature = buildingFeature(ring, anchor, radius);
    if (feature) features.push(feature);
  }
  for (const wire of waters.slice(0, MAX_FEATURES)) {
    const feature = waterFeature(wire, anchor, radius);
    if (feature) features.push(feature);
  }
  for (const patch of parks.slice(0, MAX_FEATURES)) {
    const feature = parkFeature(patch, anchor, radius);
    if (feature) features.push(feature);
  }
  if (!features.length) return null;

  const fetchedAt = new Date().toISOString();
  for (const feature of features) feature.evidence.observedAt = fetchedAt;
  return {
    status: "partial",
    features,
    warnings: [
      "OpenFreeMap（OSM 同源瓦片）道路、建筑足迹、水体与公园绿地几何；真实入口、障碍与室内连接仍未知，需现场核对。",
      ...(waters.length ? [] : ["本轮瓦片未取到水体/水道几何：沿岸类需求应先确认水在哪一侧，不能凭底图像素推断。"]),
      ...(parks.length ? [] : ["本轮瓦片未取到公园/绿地几何：草坪类需求应先确认可用绿地在哪，不能凭底图像素推断。"]),
      // planet 图层不含停车场与广场面（amenity=parking / place=square）：
      // 按「未知」处理，不凭底图像素推断；退服务端 Overpass 兜底时才有这些要素。
      "planet 图层不含停车场与广场面：此类铺装证据按未知处理，需现场核对。",
    ],
    complete: false,
    fetchedAt,
    scope: { anchor: { ...anchor }, radiusM: radius, crs: "gcj-02" },
  };
}
