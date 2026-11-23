/**
 * 评审页地图：与户外工作台同一套 ENU → 屏幕投影、同一套瓦片对齐。
 * 锚点仍是方案里的 GCJ-02，这里不改坐标。
 * 四档底图跟工作台正在用的源，不另起一套：
 * - 地图：街道槽缺省（高德街道；境外由 sourceForLocation 换成 OSM）
 * - 卫星：全球卫星 Esri World Imagery。发出时 esri-satellite 被收成
 *   basemapStyle=satellite；写死高德卫星会让评审页挂「© 高德地图 · 卫星影像」，
 *   和工作台右下角的 Esri 不是同一张图。
 * - 浅色：单色槽缺省（Carto 浅色）
 * - 纸面：不铺瓦片
 * 非高德源先把视点换到该源网格（alignedTileCenter），否则杭州一带会偏大约 500 米。
 */

import { alignedTileCenter, GLOBAL_SATELLITE_SOURCE, sourceForLocation } from '../room-organizer/lib/basemap-alignment';
import { basemapNativeMaxZoom, type BasemapNativeSource } from '../room-organizer/lib/basemap-zoom-caps';
import { DEFAULT_MAP_SLOTS } from '../room-organizer/lib/map-source-slots';
import { enuToLngLat, planMetersPerPixel, planPixelToPoint, planPointToPixel, type PlanViewport } from '../room-organizer/lib/outdoor-plan-canvas';
import { PROBE_PUBLIC_SOURCES, publicSourceTileUrl, type ProbePublicSource } from '../room-organizer/lib/tdt-probe';
import type { ReviewBasemap } from './review-access';
import type { PlanPoint, SitePlanData } from '../../../supabase/functions/_shared/site-plan';

export const REVIEW_TILE_PX = 256;
const MIN_ZOOM = 12;
const MAX_ZOOM = 19;

export interface ReviewCamera {
  lng: number;
  lat: number;
  zoom: number;
}

export interface ReviewTile {
  key: string;
  url: string;
  left: number;
  top: number;
  size: number;
}

export function reviewTileSource(style: ReviewBasemap, lng: number, lat: number): ProbePublicSource | null {
  if (style === 'paper') return null;
  const requested = style === 'satellite'
    ? GLOBAL_SATELLITE_SOURCE
    : style === 'light'
      ? DEFAULT_MAP_SLOTS.tone
      : DEFAULT_MAP_SLOTS.streets;
  const resolved = sourceForLocation(requested, lng, lat);
  return (PROBE_PUBLIC_SOURCES as readonly string[]).includes(resolved) ? resolved as ProbePublicSource : DEFAULT_MAP_SLOTS.streets;
}

export function reviewViewport(input: {
  anchorLng: number;
  anchorLat: number;
  camera: ReviewCamera;
  width: number;
  height: number;
}): PlanViewport {
  return {
    lng: input.camera.lng,
    lat: input.camera.lat,
    zoom: input.camera.zoom,
    canvasW: input.width,
    canvasH: input.height,
    anchorLng: input.anchorLng,
    anchorLat: input.anchorLat,
    bearing: 0,
  };
}

export function reviewTiles(input: {
  style: ReviewBasemap;
  camera: ReviewCamera;
  width: number;
  height: number;
}): ReviewTile[] {
  const source = reviewTileSource(input.style, input.camera.lng, input.camera.lat);
  if (!source || input.width < 1 || input.height < 1) return [];
  // 视图可以比图源更近。高德街道 z19 是空瓦片，所以取到实测上限，再把那一级拉大。
  const viewZoom = input.camera.zoom;
  const tileZoom = Math.min(Math.round(viewZoom), basemapNativeMaxZoom(source as BasemapNativeSource));
  const overScale = 2 ** (viewZoom - tileZoom);
  const tileSize = REVIEW_TILE_PX * overScale;
  const center = alignedTileCenter(input.camera.lng, input.camera.lat, source);
  const world = REVIEW_TILE_PX * 2 ** viewZoom;
  const cx = ((center.lng + 180) / 360) * world;
  const clamped = Math.max(-85.05112878, Math.min(85.05112878, center.lat));
  const sin = Math.sin((clamped * Math.PI) / 180);
  const cy = (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * world;
  const left = cx - input.width / 2;
  const top = cy - input.height / 2;
  const max = 2 ** tileZoom;
  const wrap = (value: number, limit: number) => ((value % limit) + limit) % limit;
  const x0 = Math.floor(left / tileSize) - 1;
  const x1 = Math.floor((left + input.width) / tileSize) + 1;
  const y0 = Math.max(0, Math.floor(top / tileSize) - 1);
  const y1 = Math.min(max - 1, Math.floor((top + input.height) / tileSize) + 1);
  const tiles: ReviewTile[] = [];
  for (let x = x0; x <= x1; x += 1) {
    for (let y = y0; y <= y1; y += 1) {
      if (y < 0 || y >= max) continue;
      tiles.push({
        key: `${source}-${tileZoom}-${x}-${y}`,
        url: publicSourceTileUrl(source, tileZoom, wrap(x, max), y),
        left: Math.round(x * tileSize - left),
        top: Math.round(y * tileSize - top),
        size: Math.ceil(tileSize) + 1,
      });
    }
  }
  return tiles;
}

function extentOf(plan: SitePlanData): { minX: number; minY: number; maxX: number; maxY: number } | null {
  const xs: number[] = [];
  const ys: number[] = [];
  const add = (point: PlanPoint) => { xs.push(point.x); ys.push(point.y); };
  for (const point of plan.boundary) add(point);
  for (const zone of plan.zones) for (const point of zone.polygon) add(point);
  for (const facility of plan.facilities) add(facility.position);
  for (const route of plan.routes) for (const point of route.points) add(point);
  for (const node of plan.nodes) add(node.position);
  for (const vehicle of plan.vehicles ?? []) add(vehicle.position);
  if (xs.length === 0) return null;
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

/** 把场地框进视口。没有几何时停在锚点，仍是那一块真实地图，不是 10×8 示意格。 */
export function fitReviewCamera(plan: SitePlanData, width: number, height: number): ReviewCamera | null {
  const anchor = plan.anchor;
  if (!anchor) return null;
  const extent = extentOf(plan);
  const cx = extent ? (extent.minX + extent.maxX) / 2 : 0;
  const cy = extent ? (extent.minY + extent.maxY) / 2 : 0;
  const spot = enuToLngLat(cx, cy, anchor.lng, anchor.lat);
  const span = extent ? Math.max(extent.maxX - extent.minX, extent.maxY - extent.minY, 160) : 420;
  const viewport = Math.max(280, Math.min(width || 960, height || 640));
  const targetMpp = (span * 1.8) / viewport;
  const cos = Math.cos((spot.lat * Math.PI) / 180);
  const zoom = Math.log2((40075016.686 * Math.max(0.2, cos)) / (REVIEW_TILE_PX * targetMpp));
  return {
    lng: spot.lng,
    lat: spot.lat,
    zoom: Math.min(17.4, Math.max(MIN_ZOOM, zoom)),
  };
}

export function reviewPointAt(input: {
  clientX: number;
  clientY: number;
  rect: { left: number; top: number; width: number; height: number };
  viewport: PlanViewport;
}): PlanPoint {
  const x = ((input.clientX - input.rect.left) / Math.max(1, input.rect.width)) * input.viewport.canvasW;
  const y = ((input.clientY - input.rect.top) / Math.max(1, input.rect.height)) * input.viewport.canvasH;
  return planPixelToPoint({ x, y }, input.viewport);
}

/** 滚轮缩放后，光标下的地面点留在原地。 */
export function zoomReviewCamera(input: {
  camera: ReviewCamera;
  anchorLng: number;
  anchorLat: number;
  width: number;
  height: number;
  cursorX: number;
  cursorY: number;
  zoomIn: boolean;
}): ReviewCamera {
  const viewport = reviewViewport({
    anchorLng: input.anchorLng,
    anchorLat: input.anchorLat,
    camera: input.camera,
    width: input.width,
    height: input.height,
  });
  const before = planPixelToPoint({ x: input.cursorX, y: input.cursorY }, viewport);
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, input.camera.zoom + (input.zoomIn ? 0.4 : -0.4)));
  const next = reviewViewport({
    anchorLng: input.anchorLng,
    anchorLat: input.anchorLat,
    camera: { ...input.camera, zoom },
    width: input.width,
    height: input.height,
  });
  const after = planPointToPixel(before, next);
  const mpp = planMetersPerPixel(next);
  const shifted = enuToLngLat((after.x - input.cursorX) * mpp, (input.cursorY - after.y) * mpp, input.camera.lng, input.camera.lat);
  return { lng: shifted.lng, lat: shifted.lat, zoom };
}

export function panReviewCamera(input: {
  camera: ReviewCamera;
  width: number;
  height: number;
  anchorLng: number;
  anchorLat: number;
  dx: number;
  dy: number;
}): ReviewCamera {
  const viewport = reviewViewport(input);
  const mpp = planMetersPerPixel(viewport);
  const shifted = enuToLngLat(-input.dx * mpp, input.dy * mpp, input.camera.lng, input.camera.lat);
  return { ...input.camera, lng: shifted.lng, lat: shifted.lat };
}

export { planPointToPixel };
