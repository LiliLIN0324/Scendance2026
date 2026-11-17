/**
 * 2026-11-17 用户实测「就沿着水岸线」被反问北/东/南/西：地图上明明画着河，数据结构里却没有水。
 *
 * 与 `openfreemap-roads` / `openfreemap-buildings` 同源：浏览器直连 OpenFreeMap 行星瓦片，
 * 解码 OpenMapTiles 的 `water`（面：湖/河面/水库）与 `waterway`（线：河/渠/沟中心线）两个图层。
 * 一层是「水面」，一层是「水道线」，岸线排布两样都要：面给落水侧，线给可沿岸的走向。
 *
 * 口径：
 * - 坐标原样是 WGS84（与 building 图层同口径），ENU 换算由调用方按 'wgs84' 做；
 * - 游泳池不算活动可用水域，直接丢；码头（dock）是构筑物，也丢；
 * - 只做几何与类别的转写，不判断权属、可下水性、岸线稳定；这些仍是未知，必须由 warnings 如实标注。
 */
import { VectorTile, type VectorTileFeature } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";
import {
  OFM_MAX_USEFUL_ZOOM,
  loadOfmTileSource,
  ofmTileUrl,
  tilePointToLngLat,
  tilesForBBox,
  type OfmTile,
} from "./openfreemap-tiles";

const OFM_WATER_ZOOM = OFM_MAX_USEFUL_ZOOM;
const MAX_TILES = 24;
const MAX_WATER_FEATURES = 400;
const BBOX_MARGIN_DEG = 0.002;

/** OpenMapTiles `water.class` / `waterway.class` → 我们保留的水体类别。 */
export type WaterClass =
  | "ocean"
  | "lake"
  | "river"
  | "pond"
  | "reservoir"
  | "canal"
  | "stream"
  | "ditch"
  | "drain"
  | "basin"
  | "unknown";

/** 不算「可用水岸」的类别：私人小水体与构筑物。 */
const SKIPPED_WATER_CLASSES = new Set(["swimming_pool", "dock", "swimming_area"]);

export interface WaterWire {
  id: string;
  name: string;
  /** area = 水面多边形；line = 水道/岸线折线。 */
  shape: "area" | "line";
  waterClass: WaterClass;
  /** WGS84 经纬度环/折线。 */
  lngLat: [number, number][];
}

function normalizeClass(raw: string): WaterClass {
  const value = raw.trim().toLowerCase();
  switch (value) {
    case "ocean":
    case "sea":
      return "ocean";
    case "lake":
      return "lake";
    case "river":
    case "riverbank":
      return "river";
    case "pond":
      return "pond";
    case "reservoir":
      return "reservoir";
    case "canal":
      return "canal";
    case "stream":
      return "stream";
    case "ditch":
      return "ditch";
    case "drain":
      return "drain";
    case "basin":
      return "basin";
    default:
      return "unknown";
  }
}

function featureLines(
  feature: VectorTileFeature,
  extent: number,
  tile: OfmTile,
): [number, number][][] {
  return feature
    .loadGeometry()
    .map(line => line.map(point => tilePointToLngLat(tile, extent, point.x, point.y)));
}

/** 点名图层：water_name 的标注点落进哪个面，就把它叫什么。 */
interface WaterNamePoint {
  name: string;
  point: [number, number];
}

function pointInRing(point: [number, number], ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > point[1] !== yj > point[1] && point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi || 1e-12) + xi)
      inside = !inside;
  }
  return inside;
}

/** 名字匹配：面用「落点在环内」，线用「30 m 内最近的名字点」。拿不到就空串，不猜。 */
function nameFor(
  shape: "area" | "line",
  ring: [number, number][],
  names: WaterNamePoint[],
): string {
  if (!names.length || ring.length < 2) return "";
  if (shape === "area") {
    const hit = names.find(entry => pointInRing(entry.point, ring));
    return hit?.name ?? "";
  }
  const mid = ring[Math.floor(ring.length / 2)]!;
  const metersPerDegLat = 111132.92;
  const metersPerDegLng = 111319.49 * Math.cos((mid[1] * Math.PI) / 180);
  let best: { name: string; d: number } | null = null;
  for (const entry of names) {
    const dx = (entry.point[0] - mid[0]) * metersPerDegLng;
    const dy = (entry.point[1] - mid[1]) * metersPerDegLat;
    const d = Math.hypot(dx, dy);
    if (d <= 30 && (!best || d < best.d)) best = { name: entry.name, d };
  }
  return best?.name ?? "";
}

/**
 * 解码一块瓦片的 water / waterway / water_name 三个图层。
 * 单要素几何异常只丢这一条，不影响整块瓦片。
 */
export function decodeWaterTile(buffer: Uint8Array, tile: OfmTile): WaterWire[] {
  if (buffer.byteLength === 0) return [];
  const vectorTile = new VectorTile(new PbfReader(buffer));
  const names: WaterNamePoint[] = [];
  const nameLayer = vectorTile.layers.water_name;
  if (nameLayer) {
    for (let index = 0; index < nameLayer.length; index++) {
      const feature = nameLayer.feature(index);
      const label = String(feature.properties?.name ?? "").trim();
      if (!label) continue;
      try {
        const geometry = featureLines(feature, nameLayer.extent, tile);
        const point = geometry[0]?.[0];
        if (point) names.push({ name: label, point });
      } catch {
        continue;
      }
    }
  }

  const wires: WaterWire[] = [];
  const waterLayer = vectorTile.layers.water;
  if (waterLayer) {
    for (let index = 0; index < waterLayer.length; index++) {
      const feature = waterLayer.feature(index);
      const rawClass = String(feature.properties?.class ?? "");
      if (SKIPPED_WATER_CLASSES.has(rawClass.toLowerCase())) continue;
      let rings: [number, number][][];
      try {
        rings = featureLines(feature, waterLayer.extent, tile);
      } catch {
        continue;
      }
      for (const [ringIndex, ring] of rings.entries()) {
        if (ring.length < 3) continue;
        wires.push({
          id: `ofm:water/${tile.z}/${tile.x}/${tile.y}/${feature.id ?? index}/${ringIndex}`,
          name: nameFor("area", ring, names),
          shape: "area",
          waterClass: normalizeClass(rawClass),
          lngLat: ring,
        });
      }
    }
  }

  const waterwayLayer = vectorTile.layers.waterway;
  if (waterwayLayer) {
    for (let index = 0; index < waterwayLayer.length; index++) {
      const feature = waterwayLayer.feature(index);
      const rawClass = String(feature.properties?.class ?? "");
      if (SKIPPED_WATER_CLASSES.has(rawClass.toLowerCase())) continue;
      let lines: [number, number][][];
      try {
        lines = featureLines(feature, waterwayLayer.extent, tile);
      } catch {
        continue;
      }
      for (const [lineIndex, line] of lines.entries()) {
        if (line.length < 2) continue;
        wires.push({
          id: `ofm:waterway/${tile.z}/${tile.x}/${tile.y}/${feature.id ?? index}/${lineIndex}`,
          name: nameFor("line", line, names),
          shape: "line",
          waterClass: normalizeClass(rawClass),
          lngLat: line,
        });
      }
    }
  }
  return wires;
}

/**
 * 抓 bbox 覆盖的瓦片，解码水体与水道（WGS84）。
 * 任一瓦片失败只丢那一块；整体失败（TileJSON 拿不到）回空数组，由调用方如实标注「无水体证据」。
 */
export async function fetchOpenFreeMapWater(
  bbox: { west: number; south: number; east: number; north: number },
  signal?: AbortSignal,
): Promise<WaterWire[]> {
  const source = await loadOfmTileSource(signal);
  const zoom = Math.min(OFM_WATER_ZOOM, source.maxzoom);
  let tiles = tilesForBBox(
    bbox.west - BBOX_MARGIN_DEG,
    bbox.south - BBOX_MARGIN_DEG,
    bbox.east + BBOX_MARGIN_DEG,
    bbox.north + BBOX_MARGIN_DEG,
    zoom,
  );
  if (tiles.length > MAX_TILES) {
    tiles = tilesForBBox(
      bbox.west - BBOX_MARGIN_DEG,
      bbox.south - BBOX_MARGIN_DEG,
      bbox.east + BBOX_MARGIN_DEG,
      bbox.north + BBOX_MARGIN_DEG,
      Math.max(10, zoom - 1),
    ).slice(0, MAX_TILES);
  }
  const perTile = await Promise.all(
    tiles.map(async (tile): Promise<WaterWire[]> => {
      try {
        const response = await fetch(ofmTileUrl(source.template, tile.z, tile.x, tile.y), {
          signal: signal ?? null,
        });
        if (!response.ok) return [];
        const buffer = new Uint8Array(await response.arrayBuffer());
        return decodeWaterTile(buffer, tile);
      } catch {
        return [];
      }
    }),
  );
  const out: WaterWire[] = [];
  for (const list of perTile) {
    for (const wire of list) {
      if (out.length >= MAX_WATER_FEATURES) break;
      out.push(wire);
    }
  }
  return out;
}
