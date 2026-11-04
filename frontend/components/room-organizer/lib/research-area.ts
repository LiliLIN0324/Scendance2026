/**
 * 调研底图：把一句地名变成「一片真实米制的地图地面」。
 *
 * 与「场地壳体」是两件事：
 * - 场地壳体是这一场活动的地面，尺度上限 100 m，物料按米摆在它上面。
 * - 调研底图是这一片区域的路网，尺度到公里，只给人看位置、读路、定点。
 *
 * 两层共用同一套地理换算（`amap-venue.ts` 的米制投影与地理 UV），
 * 所以底图上的路，和壳体下的那块地，是同一个世界里的同一个位置。
 *
 * 地图图只是参考底图，与卫星贴地同一条禁令：不可作重建素材。
 */

import { loadAmapScript } from './amap-script';
import {
  METERS_PER_DEGREE_LAT,
  metersPerDegreeLng,
  polygonBboxMeters,
  readAmapKeys,
  usesLocalAmapProxy,
  type AmapPoint,
} from './amap-venue';

/** 调研底图的图地址标记。服务端只认带标记的请求，避免这个地址被当成通用图代理。 */
export const MAP_BASEMAP_MARK = 'map-basemap';

/** 高德瓦片样式：6 卫星、7 路网、8 路网加注记。调研底图默认 7 路网——选址先看路。 */
export type ResearchMapStyle = 6 | 7 | 8;
export const RESEARCH_ROAD_STYLE: ResearchMapStyle = 7;
export const RESEARCH_SATELLITE_STYLE: ResearchMapStyle = 6;

/** 调研半径档位（米）。西湖这种水面开阔的地方，1600 m 差不多能看全一圈。 */
export const RESEARCH_RADIUS_CHOICES = [800, 1600, 3000] as const;
export const DEFAULT_RESEARCH_RADIUS_M = 1600;

export interface GeoBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface ResearchArea {
  /** 地点名，如「西湖」。 */
  name: string;
  /** 地址，如「浙江省杭州市西湖区」。 */
  address: string;
  /** 调研范围的中心点。 */
  center: { lng: number; lat: number };
  /** 半径（米）。 */
  radiusM: number;
  bounds: GeoBounds;
  /** 底图覆盖的真实尺寸（米）。 */
  widthM: number;
  depthM: number;
  /** 底图地址。带 west/south/east/north，3D 与 2D 靠这几个值对齐。 */
  imageUrl: string;
  style: ResearchMapStyle;
}

const round7 = (value: number): number => Math.round(value * 1e7) / 1e7;

/** 以中心点按半径摊一圈经纬度范围。 */
export function boundsAround(center: { lng: number; lat: number }, radiusM: number): GeoBounds {
  const safeRadius = Math.max(50, Math.min(20000, Math.round(radiusM)));
  const mLng = metersPerDegreeLng(center.lat);
  return {
    west: round7(center.lng - safeRadius / mLng),
    east: round7(center.lng + safeRadius / mLng),
    south: round7(center.lat - safeRadius / METERS_PER_DEGREE_LAT),
    north: round7(center.lat + safeRadius / METERS_PER_DEGREE_LAT),
  };
}

export function boundsCenter(bounds: GeoBounds): { lng: number; lat: number } {
  return { lng: (bounds.west + bounds.east) / 2, lat: (bounds.south + bounds.north) / 2 };
}

/** 经纬度范围换真实米数。 */
export function boundsSizeMeters(bounds: GeoBounds): { widthM: number; depthM: number } {
  const latMid = (bounds.south + bounds.north) / 2;
  return {
    widthM: (bounds.east - bounds.west) * metersPerDegreeLng(latMid),
    depthM: (bounds.north - bounds.south) * METERS_PER_DEGREE_LAT,
  };
}

/**
 * 底图地址。Key 不进地址：本机走 3199 代理，线上走同源 /api/amap-static。
 * style 与 x-ref 一起给，服务端据此挑卫星还是路网瓦片。
 */
export function researchImageUrl(bounds: GeoBounds, style: ResearchMapStyle = RESEARCH_ROAD_STYLE): string {
  const params = new URLSearchParams({
    west: bounds.west.toFixed(7),
    south: bounds.south.toFixed(7),
    east: bounds.east.toFixed(7),
    north: bounds.north.toFixed(7),
    style: String(style),
    'x-ref': MAP_BASEMAP_MARK,
  });
  const query = params.toString();
  return usesLocalAmapProxy()
    ? `http://127.0.0.1:3199/amap-static?${query}`
    : `/api/amap-static?${query}`;
}

/** 「调研西湖」「我想调研的是西湖地区」→ 地名；有调研动词但没地名时是 'ask'。 */
export function matchResearchCommand(text: string): string | null {
  if (!/调研|踏勘/.test(text)) return null;
  let rest = text.replace(/调研|踏勘/g, ' ');
  rest = rest.replace(/的是|一下|一个/g, ' ');
  rest = rest.replace(/^[我我们想请帮先要把打算准备接下来\s，,。.：:]+/u, '');
  rest = rest.replace(/(地区|区域|一带|附近|周边)\s*$/u, '');
  rest = rest.replace(/[\s，,。.：:]+$/u, '');
  return rest.length >= 2 && rest.length <= 30 ? rest : 'ask';
}

export interface ResearchPlace {
  name: string;
  address: string;
  lng: number;
  lat: number;
}

/**
 * 地名 → 地点。走前端 JSAPI 的 PlaceSearch：与地图选址弹窗同一条路，
 * 本机由 3199 代理代发（/_AMapService），线上直连；Web 服务 REST Key 不参与。
 */
export async function lookupPlace(keywords: string, signal?: AbortSignal): Promise<ResearchPlace | null> {
  const query = keywords.trim();
  if (query.length < 2 || typeof window === 'undefined') return null;
  const { key, security } = readAmapKeys();
  if (!key) return null;
  try {
    await loadAmapScript(key, security);
  } catch {
    return null;
  }
  const PlaceSearch = window.AMap?.PlaceSearch;
  if (!PlaceSearch) return null;
  return new Promise<ResearchPlace | null>((resolve) => {
    if (signal?.aborted) { resolve(null); return; }
    const timer = window.setTimeout(() => resolve(null), 9000);
    const search = new PlaceSearch({ pageSize: 1, pageIndex: 1, extensions: 'all' });
    search.search(query, (status, result) => {
      window.clearTimeout(timer);
      if (signal?.aborted || status !== 'complete') { resolve(null); return; }
      const pois = (result as { poiList?: { pois?: { name?: string; address?: unknown; location?: { lng?: number; lat?: number } }[] } } | null)?.poiList?.pois ?? [];
      const first = pois[0];
      const lng = Number(first?.location?.lng);
      const lat = Number(first?.location?.lat);
      if (!first || !Number.isFinite(lng) || !Number.isFinite(lat)) { resolve(null); return; }
      resolve({
        name: (first.name ?? '').trim() || query,
        address: Array.isArray(first.address) ? first.address.join('') : typeof first.address === 'string' ? first.address : '',
        lng,
        lat,
      });
    });
  });
}

/** 地点 + 半径 → 一片可铺进 3D 的调研底图。 */
export function createResearchArea(
  place: ResearchPlace,
  radiusM: number = DEFAULT_RESEARCH_RADIUS_M,
  style: ResearchMapStyle = RESEARCH_ROAD_STYLE,
): ResearchArea {
  const center = { lng: place.lng, lat: place.lat };
  const bounds = boundsAround(center, radiusM);
  const size = boundsSizeMeters(bounds);
  return {
    name: place.name,
    address: place.address,
    center,
    radiusM: Math.max(50, Math.min(20000, Math.round(radiusM))),
    bounds,
    widthM: Math.round(size.widthM),
    depthM: Math.round(size.depthM),
    imageUrl: researchImageUrl(bounds, style),
    style,
  };
}

/** 换半径或换样式时重算底图，地名与地址不动。 */
export function researchAreaWith(area: ResearchArea, changes: { radiusM?: number; style?: ResearchMapStyle }): ResearchArea {
  const radiusM = changes.radiusM ?? area.radiusM;
  const style = changes.style ?? area.style;
  const bounds = boundsAround(area.center, radiusM);
  const size = boundsSizeMeters(bounds);
  return {
    ...area,
    radiusM: Math.max(50, Math.min(20000, Math.round(radiusM))),
    bounds,
    widthM: Math.round(size.widthM),
    depthM: Math.round(size.depthM),
    imageUrl: researchImageUrl(bounds, style),
    style,
  };
}

/** 场地周边一圈的紧凑范围：给壳体自己那张贴地图用。 */
export function venueBounds(polygon: AmapPoint[], padRatio = 0.25): GeoBounds {
  const bbox = polygonBboxMeters(polygon);
  const pad = Math.max(8, Math.max(bbox.width, bbox.depth) * padRatio);
  const lats = polygon.map(point => point.lat);
  const lngs = polygon.map(point => point.lng);
  const latMid = (Math.min(...lats) + Math.max(...lats)) / 2;
  const mLng = metersPerDegreeLng(latMid);
  return {
    west: round7(Math.min(...lngs) - pad / mLng),
    east: round7(Math.max(...lngs) + pad / mLng),
    south: round7(Math.min(...lats) - pad / METERS_PER_DEGREE_LAT),
    north: round7(Math.max(...lats) + pad / METERS_PER_DEGREE_LAT),
  };
}

export function isResearchArea(value: unknown): value is ResearchArea {
  if (!value || typeof value !== 'object') return false;
  const area = value as Partial<ResearchArea>;
  const bounds = area.bounds;
  return typeof area.name === 'string'
    && typeof area.radiusM === 'number'
    && typeof area.imageUrl === 'string'
    && !!bounds
    && [bounds.west, bounds.south, bounds.east, bounds.north].every(value => Number.isFinite(value))
    && bounds.east > bounds.west
    && bounds.north > bounds.south;
}
