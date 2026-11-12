/**
 * P4-d 3D 地面底图：把二维平面用的地图（OSM / Carto）离屏拼成一张图，贴到 3D 地面上。
 *
 * 用户反馈（m02033）：三维里也应该用我二维那张地图当底图，而不是另拉一套高德卫星。
 * 所以这里不碰任何外部静态图 API：直接复用平面画布同一套瓦片源
 * （`lib/tdt-probe.ts` 的 `publicSourceTileUrl`），按贴地注册帧给出的地理范围拼图，
 * 输出的 data URL 直接塞进 `layout.floorPlanImage`。
 *
 * 设计约束：
 * - 不依赖 3D / three，只做「地理范围 → 一张位图」；纯几何部分（`planGroundTiles`）可单测。
 * - 浏览器外（SSR / node 测试）一律返回 null，不抛错。
 * - 高德静态图仍是兜底：这里返回 null 时调用方继续走老路径。
 */

import { alignedTileBounds } from './basemap-alignment';

export interface PlanGroundBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

export type PlanGroundSource =
  | 'osm'
  | 'carto-light'
  | 'carto-dark'
  | 'amap-satellite'
  | 'amap-streets'
  | 'amap-streets-labels';

export interface PlanGroundTilePlacement {
  url: string;
  /** 目标画布左上角（像素）。 */
  x: number;
  y: number;
  /** 目标画布尺寸（像素），按瓦片自身经纬跨度投影，边缘瓦片会被裁到画外。 */
  w: number;
  h: number;
}

export interface PlanGroundTilePlan {
  zoom: number;
  placements: PlanGroundTilePlacement[];
  /** 拼图覆盖的瓦片行列范围（含端点）。 */
  range: { minX: number; maxX: number; minY: number; maxY: number };
}

/** 各底图的空档底色，瓦片没回来时先铺这个，避免黑边。 */
export const PLAN_GROUND_BACKDROP: Record<PlanGroundSource, string> = {
  osm: '#efe9df',
  'carto-light': '#f6f3ee',
  'carto-dark': '#1b1f26',
  'amap-satellite': '#12161b',
  'amap-streets': '#f4f1ea',
  'amap-streets-labels': '#f4f1ea',
};

/**
 * 各底图的瓦片上限（贴地拼图用）。
 * 高德矢量档 z19 返回 100 多字节的空瓦片，只有 z18 及以下是真图；卫星档 z19 仍有影像。
 * OSM z19（z20 是 400）；Carto 能到 21，但 1024px 拼图在 z19 已覆盖约 20 m，够用。
 */
export function planGroundMaxZoom(source: PlanGroundSource): number {
  if (source === 'amap-streets' || source === 'amap-streets-labels') return 18;
  return 19;
}

/** Web 墨卡托：瓦片 y 对应的北缘纬度。 */
export function tileNorthLat(tileY: number, zoom: number): number {
  const n = Math.PI - (2 * Math.PI * tileY) / 2 ** zoom;
  return (180 / Math.PI) * Math.atan(Math.sinh(n));
}

/** 经度 → 瓦片 x（含小数，范围 0..2^zoom）。 */
export function lngToTileX(lng: number, zoom: number): number {
  return ((lng + 180) / 360) * 2 ** zoom;
}

/** 纬度 → 瓦片 y（含小数，范围 0..2^zoom）。 */
export function latToTileY(lat: number, zoom: number): number {
  const rad = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** zoom;
}

/**
 * 按地理范围挑缩放级别并算出每块瓦片在目标画布上的落点。
 *
 * 目标画布用的是「经度线性、纬度线性」映射（与 `MapGroundFrame` 的贴地口径一致），
 * 而瓦片是墨卡托切片：单块瓦片内部按墨卡托算、块与块之间按线性拼，
 * 在 100 m 量级的场地上两者差 < 0.01 m，看不出来；换成省市级范围就会歪，所以这里限死城市级。
 */
export function planGroundTiles(
  bounds: PlanGroundBounds,
  size: number,
  zoom: number,
  urlFor: (z: number, x: number, y: number) => string,
): PlanGroundTilePlan {
  const east = Math.max(bounds.east, bounds.west + 1e-9);
  const north = Math.max(bounds.north, bounds.south + 1e-9);
  const spanX = east - bounds.west;
  const spanY = north - bounds.south;
  const range = {
    minX: Math.floor(lngToTileX(bounds.west, zoom)),
    maxX: Math.floor(lngToTileX(east, zoom)),
    minY: Math.floor(latToTileY(north, zoom)),
    maxY: Math.floor(latToTileY(bounds.south, zoom)),
  };
  const placements: PlanGroundTilePlacement[] = [];
  const maxTile = 2 ** zoom - 1;
  for (let ty = range.minY; ty <= range.maxY; ty += 1) {
    for (let tx = range.minX; tx <= range.maxX; tx += 1) {
      // 经度环绕（东西跨 180°）在城市级不会发生，兜个底即可。
      const wrappedX = ((tx % (maxTile + 1)) + (maxTile + 1)) % (maxTile + 1);
      const tileWest = (tx / 2 ** zoom) * 360 - 180;
      const tileEast = ((tx + 1) / 2 ** zoom) * 360 - 180;
      const tileNorth = tileNorthLat(ty, zoom);
      const tileSouth = tileNorthLat(ty + 1, zoom);
      const x0 = ((tileWest - bounds.west) / spanX) * size;
      const x1 = ((tileEast - bounds.west) / spanX) * size;
      const y0 = ((north - tileNorth) / spanY) * size;
      const y1 = ((north - tileSouth) / spanY) * size;
      if (x1 <= 0 || y1 <= 0 || x0 >= size || y0 >= size) continue;
      placements.push({ url: urlFor(zoom, wrappedX, ty), x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
    }
  }
  return { zoom, placements, range };
}

/** 场地米数 → 合适的瓦片级别：1024 px 图铺满场地时，一像素约等于多少米决定级别。 */
export function zoomForGroundSpan(widthM: number, depthM: number, size: number): number {
  const span = Math.max(widthM, depthM, 8);
  const metersPerPixel = span / Math.max(size, 128);
  // 每像素米数 ≈ 156543.03392 * cos(lat) / 2^zoom；纬度按 30°（杭州）算，误差 2% 以内。
  const target = Math.log2((156543.03392 * Math.cos((30 * Math.PI) / 180)) / metersPerPixel);
  return Math.max(13, Math.min(19, Math.round(target)));
}

/** 经纬度范围 → 实际米数（用小范围线性近似，与贴地帧同口径）。 */
export function boundsSpanMeters(bounds: PlanGroundBounds): { width: number; depth: number } {
  const latMid = (bounds.north + bounds.south) / 2;
  return {
    width: Math.abs(bounds.east - bounds.west) * 111320 * Math.cos((latMid * Math.PI) / 180),
    depth: Math.abs(bounds.north - bounds.south) * 110574,
  };
}

const imageCache = new Map<string, HTMLImageElement>();

function loadTile(url: string, timeoutMs: number): Promise<HTMLImageElement | null> {
  const cached = imageCache.get(url);
  if (cached && cached.complete && cached.naturalWidth > 0) return Promise.resolve(cached);
  return new Promise(resolve => {
    let settled = false;
    const finish = (image: HTMLImageElement | null) => {
      if (settled) return;
      settled = true;
      resolve(image);
    };
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.decoding = 'async';
    const timer = setTimeout(() => finish(null), timeoutMs);
    image.onload = () => {
      clearTimeout(timer);
      imageCache.set(url, image);
      finish(image);
    };
    image.onerror = () => {
      clearTimeout(timer);
      finish(null);
    };
    image.src = url;
  });
}

export interface PlanGroundCapture {
  dataUrl: string;
  bounds: PlanGroundBounds;
  zoom: number;
  tileCount: number;
  missing: number;
}

/**
 * 拼一张贴地底图。拿不到任何瓦片时返回 null（调用方退回高德静态图 / 占位）。
 * jpeg：地图大面积渐变，png 会到 1.5 MB，data URL 存进 layout 太重。
 */
export async function capturePlanGround(options: {
  bounds: PlanGroundBounds;
  source: PlanGroundSource;
  size?: number;
  zoom?: number;
  urlFor: (source: PlanGroundSource, z: number, x: number, y: number) => string;
  timeoutMs?: number;
}): Promise<PlanGroundCapture | null> {
  if (typeof document === 'undefined' || typeof Image === 'undefined') return null;
  const size = Math.max(256, Math.min(2048, Math.round(options.size ?? 1024)));
  const span = boundsSpanMeters(options.bounds);
  const zoom = Math.max(4, Math.min(planGroundMaxZoom(options.source), options.zoom ?? zoomForGroundSpan(span.width, span.depth, size)));
  // 高德三档本身就是 GCJ-02（与应用锚点同系）；OSM/Carto 是 WGS-84，
  // 拼图前把范围挪到 WGS-84 网格，免得贴到 3D 地面后相对场地偏几百米。
  const tileBounds = alignedTileBounds(options.bounds, options.source);
  const plan = planGroundTiles(tileBounds, size, zoom, (z, x, y) => options.urlFor(options.source, z, x, y));
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  let ctx: CanvasRenderingContext2D | null = null;
  try {
    ctx = canvas.getContext('2d');
  } catch {
    // jsdom / 无 canvas 实现的环境：直接让调用方退回兜底方案。
    return null;
  }
  if (!ctx) return null;
  ctx.fillStyle = PLAN_GROUND_BACKDROP[options.source];
  ctx.fillRect(0, 0, size, size);
  const timeoutMs = options.timeoutMs ?? 9000;
  const images = await Promise.all(plan.placements.map(tile => loadTile(tile.url, timeoutMs)));
  let drawn = 0;
  plan.placements.forEach((tile, index) => {
    const image = images[index];
    if (!image) return;
    drawn += 1;
    ctx.drawImage(image, tile.x, tile.y, tile.w, tile.h);
  });
  if (drawn === 0) return null;
  return {
    dataUrl: canvas.toDataURL('image/jpeg', 0.84),
    bounds: options.bounds,
    zoom,
    tileCount: plan.placements.length,
    missing: plan.placements.length - drawn,
  };
}