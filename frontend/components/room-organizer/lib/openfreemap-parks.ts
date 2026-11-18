/**
 * 2026-11-18（docs/47 A1）：planet `park` + `landcover` 图层绿地面解码。
 *
 * 水体已有 `openfreemap-water`（2026-11-17），本件补绿地。验收口径是「水域/绿地要素
 * 出现在 evidence 且带 boundsM」。实测（2026-11-18，探针见 A1 提交说明）planet 的
 * `park` 图层在杭州只出 national_park/nature_reserve/historic 大景区边界，湖滨草坪
 * 这类 leisure=park/garden 面在 z14 并不以 class=park 出现；真正的城市绿地多边形在
 * `landcover` 图层（class=grass/wood）。所以两层都解码：
 * - park 层：class ∈ {park, garden}（leisure=park/garden 直译），national_park/
 *   nature_reserve/protected_area 不是活动可用绿地，丢；
 * - landcover 层：class ∈ {grass, wood}——草地/林地面即「绿地」本体；farmland/sand/
 *   ice 不是活动可用绿地，丢。
 * 停车场与广场面不在 planet 图层内，保持未知，由 fetchOfmEvidence 的 warnings 如实
 * 标注，不凭底图像素推断。
 * 坐标原样是 WGS84（与 water/building 同口径），ENU 换算由调用方按 'wgs84' 做；
 * 只做几何与类别的转写，不判断权属、可占用性、草坪养护状态；这些仍是未知。
 */
import { VectorTile } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";
import {
  OFM_MAX_USEFUL_ZOOM,
  loadOfmTileSource,
  ofmTileUrl,
  tilePointToLngLat,
  tilesForBBox,
  type OfmTile,
} from "./openfreemap-tiles";

const OFM_PARK_ZOOM = OFM_MAX_USEFUL_ZOOM;
const MAX_TILES = 24;
const MAX_PARK_FEATURES = 400;
const BBOX_MARGIN_DEG = 0.002;

/** park 层的 park/garden 与 landcover 层的 grass/wood，统一当「绿地」证据。 */
export type ParkClass = "park" | "garden" | "grass" | "wood";

export interface ParkPatch {
  id: string;
  name: string;
  parkClass: ParkClass;
  /** WGS84 经纬度环。 */
  lngLat: [number, number][];
}

function normalizeParkLayerClass(raw: string): ParkClass | null {
  const value = raw.trim().toLowerCase();
  if (value === "park") return "park";
  if (value === "garden") return "garden";
  return null;
}

function normalizeLandcoverClass(raw: string): ParkClass | null {
  const value = raw.trim().toLowerCase();
  if (value === "grass") return "grass";
  if (value === "wood") return "wood";
  return null;
}

function ringsFor(
  layer: { extent: number },
  feature: { loadGeometry(): { x: number; y: number }[][] },
  tile: OfmTile,
): [number, number][][] {
  return feature.loadGeometry().map(line =>
    line.map(point => tilePointToLngLat(tile, layer.extent, point.x, point.y)),
  );
}

/** loadGeometry 的 Close 会把首点补回环尾：规范三角形=4 点（3 独立顶点+闭合点），
 * 两点折线闭合也凑出 3 点——按 <4 过滤，不把退化环当绿地面。 */
function pushRings(
  patches: ParkPatch[],
  idPrefix: string,
  name: string,
  parkClass: ParkClass,
  rings: [number, number][][],
) {
  for (const [ringIndex, ring] of rings.entries()) {
    if (ring.length < 4) continue;
    patches.push({ id: `${idPrefix}/${ringIndex}`, name, parkClass, lngLat: ring });
  }
}

/**
 * 解码一块瓦片的 park 与 landcover 图层。单要素几何异常只丢这一条，不影响整块瓦片。
 * 同一绿地跨瓦片会拆成多块碎片（id 带瓦片坐标与环序号），与 water 同口径——
 * 这是几何证据，不是权属边界的权威来源。
 */
export function decodeParksTile(buffer: Uint8Array, tile: OfmTile): ParkPatch[] {
  if (buffer.byteLength === 0) return [];
  const vectorTile = new VectorTile(new PbfReader(buffer));
  const patches: ParkPatch[] = [];
  const parkLayer = vectorTile.layers.park;
  if (parkLayer) {
    for (let index = 0; index < parkLayer.length; index++) {
      const feature = parkLayer.feature(index);
      const parkClass = normalizeParkLayerClass(String(feature.properties?.class ?? ""));
      if (!parkClass) continue;
      let rings: [number, number][][];
      try {
        rings = ringsFor(parkLayer, feature, tile);
      } catch {
        continue;
      }
      pushRings(
        patches,
        `ofm:park/${tile.z}/${tile.x}/${tile.y}/${feature.id ?? index}`,
        String(feature.properties?.name ?? "").trim(),
        parkClass,
        rings,
      );
    }
  }
  const landcoverLayer = vectorTile.layers.landcover;
  if (landcoverLayer) {
    for (let index = 0; index < landcoverLayer.length; index++) {
      const feature = landcoverLayer.feature(index);
      const parkClass = normalizeLandcoverClass(String(feature.properties?.class ?? ""));
      if (!parkClass) continue;
      let rings: [number, number][][];
      try {
        rings = ringsFor(landcoverLayer, feature, tile);
      } catch {
        continue;
      }
      pushRings(
        patches,
        `ofm:landcover/${tile.z}/${tile.x}/${tile.y}/${feature.id ?? index}`,
        String(feature.properties?.name ?? "").trim(),
        parkClass,
        rings,
      );
    }
  }
  return patches;
}

/**
 * 抓 bbox 覆盖的瓦片，解码公园/绿地面（WGS84）。
 * 任一瓦片失败只丢那一块；整体失败（TileJSON 拿不到）回空数组，由调用方如实标注「无绿地证据」。
 */
export async function fetchOpenFreeMapParks(
  bbox: { west: number; south: number; east: number; north: number },
  signal?: AbortSignal,
): Promise<ParkPatch[]> {
  const source = await loadOfmTileSource(signal);
  const zoom = Math.min(OFM_PARK_ZOOM, source.maxzoom);
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
    tiles.map(async (tile): Promise<ParkPatch[]> => {
      try {
        const response = await fetch(ofmTileUrl(source.template, tile.z, tile.x, tile.y), {
          signal: signal ?? null,
        });
        if (!response.ok) return [];
        const buffer = new Uint8Array(await response.arrayBuffer());
        return decodeParksTile(buffer, tile);
      } catch {
        return [];
      }
    }),
  );
  const out: ParkPatch[] = [];
  for (const list of perTile) {
    for (const patch of list) {
      if (out.length >= MAX_PARK_FEATURES) break;
      out.push(patch);
    }
  }
  return out;
}
