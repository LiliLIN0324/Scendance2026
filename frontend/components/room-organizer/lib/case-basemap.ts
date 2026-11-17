/**
 * 2026-11-18 用户：「我的经典案例的卡片可以给背后加渲染吗」→ 澄清为「加底图」。
 *
 * 案例卡预览（`CaseThumb`）原来只有一块浅色底 + 红线/分区线稿，看着像示意图。
 * 这里按案例锚点取真实卫星瓦片，铺在线稿下面：卡片所见即真实地面，与 2D 画布
 * 里「红线压在卫星图上」同一套取图口径，不再另造一套图片资源。
 *
 * 三条边界，都是为了「不许以为有图」：
 * 1. 一张卡最多 4 块瓦片（2×2），取当前范围能容下的**最高**层级；
 *    45 张卡同时挂载时不至于一次打几百个瓦片请求。
 * 2. 瓦片坐标系跟画布一致：高德源本身是 GCJ-02 网格，Esri/OSM 是 WGS-84，
 *    取图前统一过 `alignedTileCenter`；境外锚点按类别换全球卫星（高德卫星在境外
 *    只回「此区域无卫星图」灰图，见 basemap-alignment 的注释）。
 * 3. 拿不到锚点 / 几何退化时返回 null，调用方保留原来的浅色底，不开天窗。
 */

import { alignedTileCenter, sourceForLocation } from './basemap-alignment';
import { enuToLngLat, lngLatToEnu } from './outdoor-plan-canvas';
import { publicSourceTileUrl, type ProbePublicSource } from './tdt-probe';

/** 案例卡固定用卫星影像：线稿压影像，才看得出来方案落在地面哪儿。 */
const CASE_BASEMAP_SOURCE = 'amap-satellite' as const satisfies ProbePublicSource;

/**
 * 一张卡最多铺几块瓦片：4 = 2×2。
 *
 * 2026-11-18 实测：只给 2 块时，350 m 级的场地被挤到 z16，256 px 瓦片要撑 380 px 的卡（
 * 还要乘 DPR），线稿清楚而地面发虚。放到 4 块后同一块场地能上到 z17，像素密度翻倍；
 * 最坏情况 45 张卡也是 180 个瓦片请求，与画布一张底图一个量级。
 */
const MAX_TILES = 4;

/** 层级上限：案例锚点最细到 z18（Victoria 内港实测有真航拍），再往上没有更多细节。 */
const MAX_ZOOM = 18;

/** 层级下限：超大场（800 m 级音乐节）也得一块瓦片兜住，不再往下缩。 */
const MIN_ZOOM = 13;

/** 取景留白：瓦片边缘不进卡片，避免出现半块空瓦片。 */
const PAD_RATIO = 0.04;

export interface CaseBasemapBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface CaseBasemapTile {
  url: string;
  /** 瓦片在案例本地 ENU 米坐标里的矩形；y 向北为正（与 SitePlanData 同一口径）。 */
  rect: { x: number; y: number; width: number; height: number };
}

export interface CaseBasemap {
  source: ProbePublicSource;
  /** 卡片右下角的短署名（Esri / 高德各自的口径，不能互串）。 */
  credit: string;
  zoom: number;
  tiles: CaseBasemapTile[];
}

function fracTileXY(lng: number, lat: number, zoom: number): { x: number; y: number } {
  const span = 2 ** zoom;
  const latRad = Math.max(Math.min(lat, 85.05112878), -85.05112878) * Math.PI / 180;
  return {
    x: (lng + 180) / 360 * span,
    y: (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * span,
  };
}

function tileLngAt(x: number, zoom: number): number {
  return x / 2 ** zoom * 360 - 180;
}

function tileLatAt(y: number, zoom: number): number {
  const n = Math.PI * (1 - 2 * y / 2 ** zoom);
  return Math.atan(Math.sinh(n)) * 180 / Math.PI;
}

/** 案例卡用短署名：卡片只有 200 px 宽，长串版权行会糊成一条灰。 */
function creditFor(source: ProbePublicSource): string {
  return source === 'esri-satellite' ? '© Esri' : '© 高德';
}

/**
 * 给一块案例范围取底图瓦片。
 *
 * @param input.anchor 案例锚点（GCJ-02 口径，与 plan.anchor 一致）。
 * @param input.bounds 红线 + 分区 + 流线的外接矩形（本地 ENU 米）。
 */
export function caseBasemapTiles(input: {
  anchor: { lng: number; lat: number } | null | undefined;
  bounds: CaseBasemapBounds;
}): CaseBasemap | null {
  const { anchor, bounds } = input;
  if (!anchor || !Number.isFinite(anchor.lng) || !Number.isFinite(anchor.lat)) return null;
  const { minX, minY, maxX, maxY } = bounds;
  if (![minX, minY, maxX, maxY].every(Number.isFinite)) return null;
  if (maxX <= minX || maxY <= minY) return null;

  const source = sourceForLocation(CASE_BASEMAP_SOURCE, anchor.lng, anchor.lat);
  const spanX = maxX - minX;
  const spanY = maxY - minY;
  const padX = spanX * PAD_RATIO;
  const padY = spanY * PAD_RATIO;

  // ENU → 该瓦片源网格上的经纬度：先按锚点换算，再过一次坐标系对齐
  //（境内用 Esri/OSM 时要整体挪几百米，境外 gcj02ToWgs84 原样返回）。
  const toSourceLngLat = (x: number, y: number): { lng: number; lat: number } => {
    const gcj = enuToLngLat(x, y, anchor.lng, anchor.lat);
    return alignedTileCenter(gcj.lng, gcj.lat, source);
  };

  const corners = [
    toSourceLngLat(minX - padX, minY - padY),
    toSourceLngLat(maxX + padX, maxY + padY),
  ];
  const westLng = Math.min(corners[0].lng, corners[1].lng);
  const eastLng = Math.max(corners[0].lng, corners[1].lng);
  const southLat = Math.min(corners[0].lat, corners[1].lat);
  const northLat = Math.max(corners[0].lat, corners[1].lat);

  // 从最细层级往下找：范围能落在 2 块瓦片以内就用它，越细卡片越清楚。
  let picked: { zoom: number; x0: number; x1: number; y0: number; y1: number } | null = null;
  for (let zoom = MAX_ZOOM; zoom >= MIN_ZOOM; zoom -= 1) {
    const nw = fracTileXY(westLng, northLat, zoom);
    const se = fracTileXY(eastLng, southLat, zoom);
    const x0 = Math.floor(nw.x);
    const x1 = Math.floor(se.x);
    const y0 = Math.floor(nw.y);
    const y1 = Math.floor(se.y);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) <= MAX_TILES) {
      picked = { zoom, x0, x1, y0, y1 };
      break;
    }
  }
  if (!picked) {
    // 连最小层级都兜不住（超大范围）：只取中心那一块，宁可少铺也不发一串请求。
    const center = fracTileXY((westLng + eastLng) / 2, (southLat + northLat) / 2, MIN_ZOOM);
    const x = Math.floor(center.x);
    const y = Math.floor(center.y);
    picked = { zoom: MIN_ZOOM, x0: x, x1: x, y0: y, y1: y };
  }

  // 瓦片角点（源网格经纬度）→ 案例 ENU：以范围中心为原点对齐，保证影像与线稿同框。
  const centerEnu = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
  const centerSource = toSourceLngLat(centerEnu.x, centerEnu.y);
  const toEnu = (lng: number, lat: number): { x: number; y: number } => {
    const local = lngLatToEnu(lng, lat, centerSource.lng, centerSource.lat);
    return { x: local.x + centerEnu.x, y: local.y + centerEnu.y };
  };

  const tiles: CaseBasemapTile[] = [];
  for (let ty = picked.y0; ty <= picked.y1; ty += 1) {
    for (let tx = picked.x0; tx <= picked.x1; tx += 1) {
      const northWest = toEnu(tileLngAt(tx, picked.zoom), tileLatAt(ty, picked.zoom));
      const southEast = toEnu(tileLngAt(tx + 1, picked.zoom), tileLatAt(ty + 1, picked.zoom));
      tiles.push({
        url: publicSourceTileUrl(source, picked.zoom, tx, ty),
        rect: {
          x: Math.min(northWest.x, southEast.x),
          y: Math.min(northWest.y, southEast.y),
          width: Math.abs(southEast.x - northWest.x),
          height: Math.abs(northWest.y - southEast.y),
        },
      });
    }
  }
  if (!tiles.length) return null;

  return { source, credit: creditFor(source), zoom: picked.zoom, tiles };
}
