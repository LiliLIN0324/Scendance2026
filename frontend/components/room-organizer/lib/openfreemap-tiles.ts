/**
 * 2026-11-16：OpenFreeMap 瓦片数学抽成公共件。
 * 建筑（openfreemap-buildings）与路网（openfreemap-roads）用同一套行星瓦片，
 * 同一份 TileJSON 缓存、同一套 bbox→瓦片→经纬度换算必须只有一份实现，
 * 否则两边对同一个地点的对齐口径会漂移。
 */

export const OFM_TILEJSON_URL = "https://tiles.openfreemap.org/planet";
/** planet 数据的 building / transportation 图层只到 z14（TileJSON maxzoom），更高的瓦片是空的。 */
export const OFM_MAX_USEFUL_ZOOM = 14;

export interface OfmTileSource {
  template: string;
  maxzoom: number;
}

export interface OfmTile {
  z: number;
  x: number;
  y: number;
}

let tileSourcePromise: Promise<OfmTileSource> | null = null;

/**
 * 瓦片模板必须从 TileJSON 取：短地址 `/planet/{z}/{x}/{y}` 现在一律回空瓦片
 * （响应头 `x-ofm-debug: empty tile wildcard`，实测 0 字节），真模板是带版本号的
 * `/planet/<版本>_pt/{z}/{x}/{y}.pbf`。版本号随行星数据更新会变，所以不硬编码。
 */
/** 测试用：清空模块级 TileJSON 缓存，避免用例互相污染。 */
export function resetOfmTileSourceForTests(): void {
  tileSourcePromise = null;
}

function ofmAbortError(): DOMException {
  return new DOMException("Cancelled", "AbortError");
}

/**
 * 只取消这一路的等待。共享 TileJSON 继续飞，其它调用方和后续缓存不受影响。
 * 已经 abort 的 signal 不再挂监听，避免把共享失败变成未处理拒绝。
 */
function followOfmAbort<T>(shared: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(ofmAbortError());
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(ofmAbortError());
    signal.addEventListener("abort", onAbort, { once: true });
    const finish = (settle: () => void) => {
      signal.removeEventListener("abort", onAbort);
      if (signal.aborted) reject(ofmAbortError());
      else settle();
    };
    shared.then(
      (value) => finish(() => resolve(value)),
      (error: unknown) => finish(() => reject(error)),
    );
  });
}

export function loadOfmTileSource(signal?: AbortSignal): Promise<OfmTileSource> {
  // 调用方进来时已经取消：不要为了这一路新开 TileJSON。
  if (signal?.aborted) return Promise.reject(ofmAbortError());
  if (!tileSourcePromise) {
    // 共享 TileJSON 不能绑到某一个调用方的 AbortSignal，
    // 否则首次被取消会把所有并发等待方一起毒死，证据线全部退回 Overpass。
    const sharedKey = (async () => {
      const response = await fetch(OFM_TILEJSON_URL);
      if (!response.ok) throw new Error(`OpenFreeMap TileJSON ${response.status}`);
      const json = (await response.json()) as { tiles?: string[]; maxzoom?: number };
      const template = json.tiles?.[0];
      if (!template) throw new Error("OpenFreeMap TileJSON 缺少 tiles 模板");
      return { template, maxzoom: json.maxzoom ?? OFM_MAX_USEFUL_ZOOM };
    })().catch((error: unknown) => {
      if (tileSourcePromise === sharedKey) tileSourcePromise = null; // 失败不钉死缓存，下次调用重试
      throw error;
    });
    tileSourcePromise = sharedKey;
  }
  const shared = tileSourcePromise;
  if (!signal) return shared;
  return followOfmAbort(shared, signal);
}

export const ofmTileUrl = (template: string, z: number, x: number, y: number): string =>
  template
    .replace("{z}", String(z))
    .replace("{x}", String(x))
    .replace("{y}", String(y));

/** 经纬度 bbox（含余量）→ 覆盖它的瓦片坐标集合。 */
export function tilesForBBox(
  west: number,
  south: number,
  east: number,
  north: number,
  zoom: number,
): OfmTile[] {
  const lng2x = (lng: number) => Math.floor(((lng + 180) / 360) * 2 ** zoom);
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
  const tiles: OfmTile[] = [];
  for (let x = x0; x <= x1; x++)
    for (let y = y0; y <= y1; y++)
      if (y >= 0 && y < 2 ** zoom) tiles.push({ z: zoom, x, y });
  return tiles;
}

/** 瓦片内局部坐标（0..extent）→ 经纬度。 */
export function tilePointToLngLat(
  tile: OfmTile,
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
