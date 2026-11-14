/**
 * 2026-11-14 用户指令「建筑给室内分区，设计别做进室内」+「carto 线稿很清晰地展示了边界」：
 * OpenFreeMap 免费矢量瓦片（OSM 同源数据、无 key、CORS 开放、CDN 稳定）作为建筑足迹的第二数据源，
 * 摆脱 Overpass 网络坏窗口依赖。解码 MVT building 图层 → WGS84 环 → GCJ-02 → ENU（调用方做口径过滤）。
 */
import { VectorTile, type VectorTileFeature } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";
import { wgs84ToGcj02 } from "./geo-coords";
import type { PlanPoint } from "../../../../supabase/functions/_shared/site-plan";

const OFM_TILEJSON_URL = "https://tiles.openfreemap.org/planet";
/** planet 数据的 building 图层只到 z14（TileJSON maxzoom），更高的瓦片是空的。 */
const OFM_BUILDING_ZOOM = 14;

let tileSourcePromise: Promise<{ template: string; maxzoom: number }> | null = null;
/**
 * 瓦片模板必须从 TileJSON 取：短地址 `/planet/{z}/{x}/{y}` 现在一律回空瓦片
 * （响应头 `x-ofm-debug: empty tile wildcard`，实测 0 字节），真模板是带版本号的
 * `/planet/<版本>_pt/{z}/{x}/{y}.pbf`。版本号随行星数据更新会变，所以不硬编码。
 */
function loadTileSource(signal?: AbortSignal): Promise<{ template: string; maxzoom: number }> {
  if (!tileSourcePromise) {
    tileSourcePromise = (async () => {
      const response = await fetch(OFM_TILEJSON_URL, { signal: signal ?? null });
      if (!response.ok) throw new Error(`OpenFreeMap TileJSON ${response.status}`);
      const json = (await response.json()) as { tiles?: string[]; maxzoom?: number };
      const template = json.tiles?.[0];
      if (!template) throw new Error("OpenFreeMap TileJSON 缺少 tiles 模板");
      return { template, maxzoom: json.maxzoom ?? OFM_BUILDING_ZOOM };
    })().catch((error: unknown) => {
      tileSourcePromise = null; // 失败不钉死缓存，下次调用重试
      throw error;
    });
  }
  return tileSourcePromise;
}

const tileUrl = (template: string, z: number, x: number, y: number) =>
  template
    .replace("{z}", String(z))
    .replace("{x}", String(x))
    .replace("{y}", String(y));

interface LngLatRing {
  id: string;
  name: string;
  lngLat: [number, number][];
}

/** 经纬度 bbox（含余量）→ 覆盖它的瓦片坐标集合。 */
function tilesForBBox(
  west: number,
  south: number,
  east: number,
  north: number,
  zoom: number,
): { z: number; x: number; y: number }[] {
  const lng2x = (lng: number) =>
    Math.floor((((lng + 180) / 360) * 2 ** zoom));
  const lat2y = (lat: number) => {
    const rad = (lat * Math.PI) / 180;
    return Math.floor(
      ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** zoom,
    );
  };
  const x0 = lng2x(west);
  const x1 = lng2x(east);
  const y0 = lat2y(north);
  const y1 = lat2y(south);
  const tiles: { z: number; x: number; y: number }[] = [];
  for (let x = x0; x <= x1; x++)
    for (let y = y0; y <= y1; y++)
      if (y >= 0 && y < 2 ** zoom) tiles.push({ z: zoom, x, y });
  return tiles;
}

/** 瓦片内局部坐标（0..extent）→ 经纬度。 */
function tilePointToLngLat(
  tile: { z: number; x: number; y: number },
  extent: number,
  x: number,
  y: number,
): [number, number] {
  const scale = 2 ** tile.z;
  const worldX = (tile.x + x / extent) / scale;
  const worldY = (tile.y + y / extent) / scale;
  const lng = worldX * 360 - 180;
  const n = Math.PI - 2 * Math.PI * worldY;
  const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  return [lng, lat];
}

/** 要素几何 → 经纬环数组（复用官方 loadGeometry；坐标是 0..extent 的瓦片局部整数，环原样带出）。 */
function featureRings(
  feature: VectorTileFeature,
  extent: number,
  tile: { z: number; x: number; y: number },
): [number, number][][] {
  return feature
    .loadGeometry()
    .map(ring => ring.map(p => tilePointToLngLat(tile, extent, p.x, p.y)));
}

/**
 * 抓边界 bbox 覆盖的 OpenFreeMap 瓦片，解码 building 图层 → GCJ-02 环数组。
 * 每次调用即拉即用（CDN 稳定，无需缓存也能秒回）；失败回空数组由调用方走后备源。
 */
export async function fetchOpenFreeMapBuildings(
  boundaryLngLatBBox: { west: number; south: number; east: number; north: number },
  signal?: AbortSignal,
): Promise<LngLatRing[]> {
  const source = await loadTileSource(signal);
  const zoom = Math.min(OFM_BUILDING_ZOOM, source.maxzoom);
  // 余量约 200m：只用来兜住跨边界的建筑，不必像整片街区那样外扩（外扩 0.02° 会把瓦片数翻十倍）。
  const margin = 0.002;
  const tiles = tilesForBBox(
    boundaryLngLatBBox.west - margin,
    boundaryLngLatBBox.south - margin,
    boundaryLngLatBBox.east + margin,
    boundaryLngLatBBox.north + margin,
    zoom,
  );
  // 并发拉瓦片（实测串行 25 块要 9s，并发降到 1s 级）；单块失败只丢这一块。
  const perTile = await Promise.all(
    tiles.map(async (tile): Promise<LngLatRing[]> => {
      try {
        const response = await fetch(tileUrl(source.template, tile.z, tile.x, tile.y), {
          signal: signal ?? null,
        });
        if (!response.ok) return [];
        const buffer = await response.arrayBuffer();
        if (buffer.byteLength === 0) return []; // 空瓦片是正常返回（0 字节）
        const vectorTile = new VectorTile(new PbfReader(new Uint8Array(buffer)));
        const layer = vectorTile.layers.building;
        if (!layer) return [];
        const rings: LngLatRing[] = [];
        for (let fi = 0; fi < layer.length; fi++) {
          const feature = layer.feature(fi);
          let geometry: [number, number][][];
          try {
            geometry = featureRings(feature, layer.extent, tile);
          } catch {
            continue; // 个别要素无几何/解码失败，不影响整块瓦片
          }
          for (const [ri, ring] of geometry.entries()) {
            if (ring.length < 3) continue;
            rings.push({
              id: `ofm:${tile.z}/${tile.x}/${tile.y}/${feature.id ?? fi}/${ri}`,
              name: String(feature.properties?.name ?? ""),
              lngLat: ring,
            });
          }
        }
        return rings;
      } catch {
        return []; // 单瓦片失败忽略（其余瓦片仍有数据）
      }
    }),
  );
  return perTile.flat();
}

/** GCJ-02 环（E 0..extent 坐标系外的一般折线）→ ENU PlanPoint 环。 */
export function lngLatRingsToEnu(
  rings: LngLatRing[],
  anchorLng: number,
  anchorLat: number,
): PlanPoint[][] {
  return rings.map(ring =>
    ring.lngLat.map(([lng, lat]) => {
      const gcj = wgs84ToGcj02(lng, lat);
      return {
        x: (gcj.lng - anchorLng) * metersPerDegreeLng(anchorLat),
        y: (gcj.lat - anchorLat) * 111132.92,
      };
    }),
  );
}

function metersPerDegreeLng(lat: number): number {
  return 111319.49 * Math.cos((lat * Math.PI) / 180);
}
