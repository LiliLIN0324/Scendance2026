/**
 * 2026-11-16 路网第一性原理（用户指令「先修路网」「我们第一性原理」）：
 *
 * 生产 `/api/road-network` 只有 Overpass 一个来源，三个镜像从 Cloudflare 侧全坏：
 * 实测 26.5s 超时后恒回 `{ roads: [] }`，于是「主要入口与通道」永远停在
 * 「未取得可核对路网」。但底图本身就是 OpenFreeMap 行星瓦片（OSM 同源、CORS `*`、
 * CDN 十年缓存），实测一块 600m 街区的 z14 瓦片里 `transportation` 图层有 356 条道路几何。
 * 路网与建筑应当同源解码：不依赖任何第三方解释器，也不给 Pages Functions 添新依赖。
 *
 * 所以在客户端加这条源，`fetchRoadNetwork` 先取它（1–2s），失败才退回服务端 Overpass。
 */
import { VectorTile, type VectorTileFeature } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";
import { wgs84ToGcj02 } from "./geo-coords";
import {
  OFM_MAX_USEFUL_ZOOM,
  loadOfmTileSource,
  ofmTileUrl,
  tilePointToLngLat,
  tilesForBBox,
  type OfmTile,
} from "./openfreemap-tiles";
import type { RoadSegment } from "./road-network";

/** 与服务端 Overpass 口径一致：每条 ≤160 点。 */
const ROAD_MAX_POINTS = 160;
/** 极端 bbox 保护：瓦片数上限与要素总数上限。 */
const MAX_TILES = 24;
const MAX_ROAD_FEATURES = 6000;
const OFM_ROAD_ZOOM = OFM_MAX_USEFUL_ZOOM;
/** 只用来兜住跨边界的那几条路，不必整片街区外扩（外扩会成倍放大瓦片数）。 */
const BBOX_MARGIN_DEG = 0.001;

interface WgsRoadWire {
  id: string;
  highway: string;
  name: string;
  points: [number, number][];
}

/**
 * OpenMapTiles `transportation.class` → OSM highway 等级。
 * 必须落在 `road-network.ts` 的 HIGHWAY_CLASS_MAP 里，否则该段会被
 * `routeClassForHighway` 判成 null 而丢弃——这里只产出前端认识的值。
 * 轨交/站台/码头/轮渡不是「人怎么进场」的路，直接不算。
 */
export function highwayForTransportationClass(
  roadClass: string,
  subclass?: string,
): string | null {
  switch (roadClass) {
    case "motorway":
    case "trunk":
    case "primary":
    case "secondary":
    case "tertiary":
    case "service":
      return roadClass;
    case "minor":
      return "residential";
    case "track":
      return "track";
    case "path":
      switch (subclass) {
        case "pedestrian":
          return "pedestrian";
        case "footway":
          return "footway";
        case "steps":
          return "steps";
        case "cycleway":
          return "cycleway";
        default:
          return "path";
      }
    default:
      return null;
  }
}

/** 等步长抽稀到上限（与服务端 decimate 同口径，首点必留）。 */
export function decimatePoints(
  points: [number, number][],
  max = ROAD_MAX_POINTS,
): [number, number][] {
  if (points.length <= max) return points;
  const stride = Math.ceil(points.length / max);
  const out: [number, number][] = [];
  for (let i = 0; i < points.length; i += stride) out.push(points[i]!);
  return out;
}

/**
 * 道路名字来自另一个图层（`transportation_name`），两层在同一条 way 上被同样切分，
 * 因此端点对得上。用「首尾点各取 4 位小数」当键：4 位小数 ≈ 11m，足以区分一个瓦片里的
 * 不同道路，又不会因为浮点抖动错配。
 */
export function roadNameKey(points: [number, number][]): string {
  if (!points.length) return "";
  const first = points[0]!;
  const last = points[points.length - 1]!;
  const round = (value: number) => Math.round(value * 1e4) / 1e4;
  const forward = `${round(first[0])},${round(first[1])}|${round(last[0])},${round(last[1])}`;
  const backward = `${round(last[0])},${round(last[1])}|${round(first[0])},${round(first[1])}`;
  return forward < backward ? forward : backward; // 方向无关
}

/** 顶点键：5 位小数 ≈ 1m，足够认出「同一条路的同一段」，又不至于因浮点抖动错配。 */
export function vertexKey(point: [number, number]): string {
  return `${Math.round(point[0] * 1e5) / 1e5},${Math.round(point[1] * 1e5) / 1e5}`;
}

/**
 * 名字图层与路网图层是同一条 way 的两次切分，端点常常对不上（实测端点键只命中 25/356），
 * 但共享顶点跑不掉。所以：先试端点键，不中再找「连续共享 ≥2 个顶点」的那条名字——
 * 只共享一个顶点的多半是路口相交，不能把那条街名安上去。
 */
export function consecutiveSharedRun(
  points: [number, number][],
  vertices: Set<string>,
): number {
  let best = 0;
  let run = 0;
  for (const point of points) {
    if (vertices.has(vertexKey(point))) {
      run += 1;
      if (run > best) best = run;
    } else {
      run = 0;
    }
  }
  return best;
}

export interface NamedRoadFeature {
  label: string;
  vertices: Set<string>;
}

/** 路网折线 → 道路名（拿不到就空串，不为了名字牺牲几何）。 */
export function matchRoadName(
  points: [number, number][],
  names: { exact: Map<string, string>; features: NamedRoadFeature[] },
): string {
  const exact = names.exact.get(roadNameKey(points));
  if (exact) return exact;
  let best: { label: string; run: number } | null = null;
  for (const feature of names.features) {
    const run = consecutiveSharedRun(points, feature.vertices);
    if (run >= 2 && (!best || run > best.run)) best = { label: feature.label, run };
  }
  return best?.label ?? "";
}

interface TileDecodeResult {
  roads: WgsRoadWire[];
  names: { exact: Map<string, string>; features: NamedRoadFeature[] };
}

/** 瓦片局部整数坐标（@mapbox/vector-tile 的 Point 未对外导出，这里按结构声明）。 */
type TilePoint = { x: number; y: number };

function lineToLngLat(feature: VectorTileFeature, extent: number, tile: OfmTile): [number, number][] {
  const lines = feature.loadGeometry();
  if (!lines.length) return [];
  // transportation 都是线要素；折线被切成多段时取最长的一段，避免把断开的段硬连起来。
  let longest: TilePoint[] = [];
  for (const line of lines) {
    if (line.length > longest.length) longest = line;
  }
  return longest.map(point => tilePointToLngLat(tile, extent, point.x, point.y));
}

/** 解码一块瓦片的 transportation / transportation_name 两个图层（WGS84）。 */
export function decodeTransportationTile(buffer: Uint8Array, tile: OfmTile): TileDecodeResult {
  const roads: WgsRoadWire[] = [];
  const names = { exact: new Map<string, string>(), features: [] as NamedRoadFeature[] };
  if (buffer.byteLength === 0) return { roads, names }; // 空瓦片是正常返回（0 字节）
  const vectorTile = new VectorTile(new PbfReader(buffer));
  const roadLayer = vectorTile.layers.transportation;
  if (roadLayer) {
    for (let index = 0; index < roadLayer.length; index++) {
      const feature = roadLayer.feature(index);
      const properties = feature.properties ?? {};
      const highway = highwayForTransportationClass(
        String(properties.class ?? ""),
        properties.subclass == null ? undefined : String(properties.subclass),
      );
      if (!highway) continue;
      let points: [number, number][];
      try {
        points = lineToLngLat(feature, roadLayer.extent, tile);
      } catch {
        continue; // 个别要素无几何/解码失败，不影响整块瓦片
      }
      if (points.length < 2) continue;
      roads.push({
        id: `ofm:${tile.z}/${tile.x}/${tile.y}/${feature.id ?? index}`,
        highway,
        name: "",
        points,
      });
    }
  }
  const nameLayer = vectorTile.layers.transportation_name;
  if (nameLayer) {
    for (let index = 0; index < nameLayer.length; index++) {
      const feature = nameLayer.feature(index);
      const properties = feature.properties ?? {};
      const label = String(properties.name ?? properties.ref ?? "").trim();
      if (!label) continue;
      let points: [number, number][];
      try {
        points = lineToLngLat(feature, nameLayer.extent, tile);
      } catch {
        continue;
      }
      if (points.length < 2) continue;
      names.exact.set(roadNameKey(points), label);
      names.features.push({
        label,
        vertices: new Set(points.map(point => vertexKey(point))),
      });
    }
  }
  return { roads, names };
}

/** WGS84 折线 → GCJ-02、6 位小数、抽稀（与 plan.anchor 同基准）。 */
export function toGcjRoadSegments(wires: WgsRoadWire[]): RoadSegment[] {
  const out: RoadSegment[] = [];
  for (const wire of wires) {
    const points: [number, number][] = [];
    for (const [lng, lat] of wire.points) {
      const gcj = wgs84ToGcj02(lng, lat);
      points.push([Number(gcj.lng.toFixed(6)), Number(gcj.lat.toFixed(6))]);
    }
    if (points.length < 2) continue;
    out.push({ id: wire.id, highway: wire.highway, name: wire.name, points: decimatePoints(points) });
  }
  return out;
}

export interface OfmRoadBBox {
  west: number;
  south: number;
  east: number;
  north: number;
}

/**
 * 抓 bbox 覆盖的 OpenFreeMap 瓦片，解码 transportation → GCJ-02 RoadSegment[]。
 * 单块瓦片失败只丢那一块；整体失败（TileJSON 拿不到等）回空数组，由调用方退服务端。
 */
export async function fetchOpenFreeMapRoads(
  bbox: OfmRoadBBox,
  options: { signal?: AbortSignal } = {},
): Promise<RoadSegment[]> {
  const signal = options.signal;
  const source = await loadOfmTileSource(signal);
  const zoom = Math.min(OFM_ROAD_ZOOM, source.maxzoom);
  let tiles = tilesForBBox(
    bbox.west - BBOX_MARGIN_DEG,
    bbox.south - BBOX_MARGIN_DEG,
    bbox.east + BBOX_MARGIN_DEG,
    bbox.north + BBOX_MARGIN_DEG,
    zoom,
  );
  if (tiles.length > MAX_TILES) {
    // 大范围时降低一级，宁可粗一点也不要把手机流量和主线程打爆。
    tiles = tilesForBBox(
      bbox.west - BBOX_MARGIN_DEG,
      bbox.south - BBOX_MARGIN_DEG,
      bbox.east + BBOX_MARGIN_DEG,
      bbox.north + BBOX_MARGIN_DEG,
      Math.max(10, zoom - 1),
    ).slice(0, MAX_TILES);
  }
  const perTile = await Promise.all(
    tiles.map(async (tile): Promise<WgsRoadWire[]> => {
      try {
        const response = await fetch(ofmTileUrl(source.template, tile.z, tile.x, tile.y), {
          signal: signal ?? null,
        });
        if (!response.ok) return [];
        const buffer = new Uint8Array(await response.arrayBuffer());
        const decoded = decodeTransportationTile(buffer, tile);
        // 名字是另一个图层：端点键优先，其次连续共享顶点；都对不上就留空。
        for (const wire of decoded.roads) {
          const label = matchRoadName(wire.points, decoded.names);
          if (label) wire.name = label;
        }
        return decoded.roads;
      } catch {
        return []; // 单瓦片失败忽略（其余瓦片仍有数据）
      }
    }),
  );
  const wires: WgsRoadWire[] = [];
  for (const list of perTile) {
    for (const wire of list) {
      if (wires.length >= MAX_ROAD_FEATURES) break;
      wires.push(wire);
    }
  }
  return toGcjRoadSegments(wires);
}
