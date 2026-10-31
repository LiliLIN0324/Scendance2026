import type { RoomLayout } from './types';
import { raiseVenue, replaceVenueWithShell } from './agent-proposal';
import { AMAP_KEY_STORAGE, AMAP_SECURITY_STORAGE, loadAmapScript } from './amap-script';
import { RECON_MATERIAL_BAN } from './site-recon-mock';

export type AmapPoint = { lng: number; lat: number };
export type LocalPoint = { x: number; z: number };

/** 纬度向 1° 的真实米数。 */
export const METERS_PER_DEGREE_LAT = 110_574;

/** 经度向 1° 的真实米数：随纬度收缩，111.32·cos(纬度) km。 */
export function metersPerDegreeLng(lat: number): number {
  return 111_320 * Math.cos((lat * Math.PI) / 180);
}

/** 圈画多边形的外接矩形，按纬度换算成米（报尺寸用；立壳用 polygonToLocalMeters）。 */
export function polygonBboxMeters(polygon: AmapPoint[]): { width: number; depth: number } {
  if (polygon.length < 3) return { width: 0, depth: 0 };
  const lats = polygon.map(p => p.lat);
  const lngs = polygon.map(p => p.lng);
  const latMid = (Math.min(...lats) + Math.max(...lats)) / 2;
  const width = (Math.max(...lngs) - Math.min(...lngs)) * metersPerDegreeLng(latMid);
  const depth = (Math.max(...lats) - Math.min(...lats)) * METERS_PER_DEGREE_LAT;
  return { width: Math.round(width * 10) / 10, depth: Math.round(depth * 10) / 10 };
}

const round1 = (value: number): number => Math.round(value * 10) / 10;

/**
 * 高德经纬度多边形 → 本地米制点列。
 * x 向东；z=0 是北缘（平面图上沿、房间的北），z 向南。这样和地图的北在上一致。
 * 有点列就保留真轮廓；无 ≥3 点则退化为空（上层再走轴对齐矩形）。
 */
export function polygonToLocalMeters(polygon: AmapPoint[]): { width: number; depth: number; points: LocalPoint[] } {
  if (polygon.length < 3) return { width: 0, depth: 0, points: [] };
  const lats = polygon.map(p => p.lat);
  const lngs = polygon.map(p => p.lng);
  const latNorth = Math.max(...lats);
  const lng0 = Math.min(...lngs);
  const latMid = (Math.min(...lats) + latNorth) / 2;
  const mLng = metersPerDegreeLng(latMid);
  const raw = polygon.map(p => ({
    x: (p.lng - lng0) * mLng,
    z: (latNorth - p.lat) * METERS_PER_DEGREE_LAT,
  }));
  const width = Math.max(...raw.map(p => p.x));
  const depth = Math.max(...raw.map(p => p.z));
  if (width < 0.01 || depth < 0.01) return { width: 0, depth: 0, points: [] };
  return {
    width: round1(width),
    depth: round1(depth),
    points: raw.map(p => ({ x: round1(p.x), z: round1(p.z) })),
  };
}

/** 规划区上限 100 m：等比缩点列进壳，保留轮廓，不压成矩形。 */
export function fitPolygonToShellLimit(
  local: { width: number; depth: number; points: LocalPoint[] },
  limit = 100,
): { width: number; depth: number; points: LocalPoint[]; scale: number; oversized: boolean } {
  if (local.points.length < 3 || local.width < 0.01 || local.depth < 0.01) {
    return { width: 0, depth: 0, points: [], scale: 1, oversized: false };
  }
  const scale = Math.min(1, limit / local.width, limit / local.depth);
  const oversized = scale < 1;
  const scaled = local.points.map(p => ({ x: p.x * scale, z: p.z * scale }));
  let width = Math.max(2, round1(Math.max(...scaled.map(p => p.x))));
  let depth = Math.max(2, round1(Math.max(...scaled.map(p => p.z))));
  width = Math.min(limit, width);
  depth = Math.min(limit, depth);
  const points = scaled.map(p => ({
    x: Math.min(width, Math.max(0, round1(p.x))),
    z: Math.min(depth, Math.max(0, round1(p.z))),
  }));
  const dedup: LocalPoint[] = [];
  for (const p of points) {
    const last = dedup[dedup.length - 1];
    if (!last || last.x !== p.x || last.z !== p.z) dedup.push(p);
  }
  if (dedup.length >= 2) {
    const first = dedup[0]!;
    const last = dedup[dedup.length - 1]!;
    if (first.x === last.x && first.z === last.z) dedup.pop();
  }
  return { width, depth, points: dedup.length >= 3 ? dedup : [], scale, oversized };
}

/** AMap 多边形路径 → 圈画点列。 */
export function toPoints(path: { lng: number; lat: number }[] | AmapPoint[]): AmapPoint[] {
  return path.map(p => ({ lng: Number(p.lng), lat: Number(p.lat) }));
}

/** 卫星贴地参考底图屏上文案（与 RECON_MATERIAL_BAN 一致，绝不进采集上传）。 */
export const SATELLITE_GROUND_LABEL = '参考底图·不可作重建素材';

export const SATELLITE_GROUND_NOTE =
  `${SATELLITE_GROUND_LABEL}；${RECON_MATERIAL_BAN}`;

/** 可识别的卫星参考底图 data URL 前缀标记（占位图 / 截帧均带此注）。 */
export const SATELLITE_GROUND_MARK = 'satellite-ground-ref';

export function isSatelliteGroundImage(url: string | undefined | null): boolean {
  return !!url && url.includes(SATELLITE_GROUND_MARK);
}

/**
 * 生成贴地参考占位 SVG（非真实瓦片、非重建素材）。
 * 仅当静态图拉取失败时兜底。地图户外壳默认打开卫星贴地；人关掉后不再自动补。
 */
export function makeSatelliteGroundPlaceholder(widthM: number, depthM: number): string {
  const w = Math.max(120, Math.round(widthM * 8));
  const h = Math.max(90, Math.round(depthM * 8));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" data-kind="${SATELLITE_GROUND_MARK}">
  <defs><pattern id="g" width="12" height="12" patternUnits="userSpaceOnUse">
    <rect width="12" height="12" fill="#2c3a2e"/>
    <rect x="0" y="0" width="6" height="6" fill="#354538" opacity=".55"/>
    <rect x="6" y="6" width="6" height="6" fill="#3a4a3c" opacity=".4"/>
  </pattern></defs>
  <rect width="100%" height="100%" fill="url(#g)"/>
  <rect x="8" y="8" width="${Math.max(80, w - 16)}" height="36" rx="6" fill="rgba(0,0,0,.55)"/>
  <text x="16" y="32" fill="#f0e6c8" font-size="14" font-family="system-ui,sans-serif">${SATELLITE_GROUND_LABEL}</text>
</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** 按场地外接米数估静态卫星图 zoom（越大越近）。 */
export function satelliteZoomForMeters(widthM: number, depthM: number): number {
  const span = Math.max(widthM, depthM, 4);
  // 高德 webst style=6 在 z=19 对本区域常回「此区域无卫星图」占位；上限 18 才有真影像。
  if (span <= 20) return 18;
  if (span <= 40) return 17;
  if (span <= 80) return 16;
  if (span <= 160) return 15;
  if (span <= 320) return 14;
  return 13;
}

/**
 * 高德静态卫星图 URL（Web 服务 Key）。仅作 3D 地面参考，绝不进 Aholo 上传。
 */
export function buildSatelliteStaticMapUrl(
  polygon: AmapPoint[],
  key: string,
  options?: { size?: number; scale?: 1 | 2 },
): string | null {
  if (!key || polygon.length < 3) return null;
  const lats = polygon.map(p => p.lat);
  const lngs = polygon.map(p => p.lng);
  const lng = (Math.min(...lngs) + Math.max(...lngs)) / 2;
  const lat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const bbox = polygonBboxMeters(polygon);
  const zoom = satelliteZoomForMeters(bbox.width, bbox.depth);
  const size = Math.max(256, Math.min(1024, options?.size ?? 768));
  const scale = options?.scale ?? 2;
  const params = new URLSearchParams({
    location: `${lng},${lat}`,
    zoom: String(zoom),
    size: `${size}*${size}`,
    scale: String(scale),
    maptype: 'satellite',
    key,
  });
  return `https://restapi.amap.com/v3/staticmap?${params.toString()}`;
}

/** 本机开发走 3199；生产（含 scendance.lilicoding.space）走同源 /api/amap-static，Key 留在 Pages。 */
export function usesLocalAmapProxy(): boolean {
  if (typeof window === 'undefined') return true;
  const host = window.location?.hostname ?? '';
  return host === 'localhost' || host === '127.0.0.1' || host === '';
}

/** 3D 圈外留白（壳体米）。卫星图必须带上同样一圈，否则贴地会对不齐。 */
export function satellitePadMeters(shellWidth: number, shellDepth: number): number {
  return Math.max(4, 0.25 * Math.max(shellWidth, shellDepth));
}

export interface MapGroundFrame {
  /** 西缘经度（壳体 x=0）。 */
  lng0: number;
  /** 壳体 z=0 的纬度。新圈画里这是北缘。 */
  lat0: number;
  latMid: number;
  /** 壳体米 / 真实米。超过 100m 才小于 1。 */
  scale: number;
  /**
   * z 增加时纬度的方向。-1：z 向南（北在 z=0，和地图、平面图上沿一致）。
   * +1：旧壳体 z 向北。缺省按 +1，避免把还没重存的旧帧读反。
   */
  latSign?: -1 | 1;
}

export interface SatelliteImageBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

/**
 * 演示 L 和手圈多边形都走这里：x 向东，z=0 为北缘，超过 100m 才等比缩小。
 * 卫星图范围用同一套原点和缩放，再向外加一圈 pad。
 */
export function groundRegistration(polygon: AmapPoint[]): {
  frame: MapGroundFrame;
  bounds: SatelliteImageBounds;
  shellWidth: number;
  shellDepth: number;
} | null {
  if (polygon.length < 3) return null;
  const local = polygonToLocalMeters(polygon);
  const fitted = fitPolygonToShellLimit(local);
  if (local.width < 0.01 || local.depth < 0.01) return null;
  const lngs = polygon.map(point => point.lng);
  const lats = polygon.map(point => point.lat);
  const lng0 = Math.min(...lngs);
  const latNorth = Math.max(...lats);
  const latSouth = Math.min(...lats);
  const frame: MapGroundFrame = {
    lng0,
    lat0: latNorth,
    latMid: (latSouth + latNorth) / 2,
    scale: fitted.points.length >= 3 ? fitted.scale : 1,
    latSign: -1,
  };
  const shellWidth = fitted.points.length >= 3 ? fitted.width : Math.max(2, round1(local.width));
  const shellDepth = fitted.points.length >= 3 ? fitted.depth : Math.max(2, round1(local.depth));
  return { frame, bounds: satelliteBoundsForFrame(polygon, frame, shellWidth, shellDepth), shellWidth, shellDepth };
}

export function satelliteBoundsForFrame(
  polygon: AmapPoint[],
  frame: MapGroundFrame,
  shellWidth: number,
  shellDepth: number,
): SatelliteImageBounds {
  const lngs = polygon.map(point => point.lng);
  const lats = polygon.map(point => point.lat);
  const padReal = satellitePadMeters(shellWidth, shellDepth) / (frame.scale > 0 ? frame.scale : 1);
  const mLng = metersPerDegreeLng(frame.latMid);
  return {
    west: Math.min(...lngs) - padReal / mLng,
    east: Math.max(...lngs) + padReal / mLng,
    south: Math.min(...lats) - padReal / METERS_PER_DEGREE_LAT,
    north: Math.max(...lats) + padReal / METERS_PER_DEGREE_LAT,
  };
}

/** 壳体米（x=0 西缘，z=0 为 frame.lat0）→ 卫星图像素比例。v 向北为 1，配合贴图 flipY。 */
export function shellMetersToSatelliteUv(
  localX: number,
  localZ: number,
  frame: MapGroundFrame,
  bounds: SatelliteImageBounds,
): { u: number; v: number } {
  const scale = frame.scale > 0 ? frame.scale : 1;
  const sign = frame.latSign ?? 1;
  const lng = frame.lng0 + (localX / scale) / metersPerDegreeLng(frame.latMid);
  const lat = frame.lat0 + sign * (localZ / scale) / METERS_PER_DEGREE_LAT;
  return {
    u: (lng - bounds.west) / (bounds.east - bounds.west),
    v: (lat - bounds.south) / (bounds.north - bounds.south),
  };
}

/**
 * 卫星图在 Shape 平面（x 向东、y 向北）里的外接矩形。
 * 圈外网格必须停在这张矩形上：再往外的顶点 UV 会落到 0..1 之外，Clamp 就把边缘像素拉成线带。
 */
export function satellitePhotoShapeRect(
  width: number,
  depth: number,
  frame: MapGroundFrame,
  bounds: SatelliteImageBounds,
): { minX: number; maxX: number; minY: number; maxY: number } {
  const rect = satelliteImageShellRect(frame, bounds);
  const x0 = rect.x - width / 2;
  const x1 = x0 + rect.width;
  const yOf = (z: number) => depth / 2 - z;
  const y0 = yOf(rect.z);
  const y1 = yOf(rect.z + rect.depth);
  return {
    minX: Math.min(x0, x1),
    maxX: Math.max(x0, x1),
    minY: Math.min(y0, y1),
    maxY: Math.max(y0, y1),
  };
}

/** 卫星图在壳体米制里的矩形。z 是平面图上的较小值（靠上的一边）。 */
export function satelliteImageShellRect(
  frame: MapGroundFrame,
  bounds: SatelliteImageBounds,
): { x: number; z: number; width: number; depth: number; northAtTop: boolean } {
  const scale = frame.scale > 0 ? frame.scale : 1;
  const sign = frame.latSign ?? 1;
  const mLng = metersPerDegreeLng(frame.latMid);
  const zOf = (lat: number) => (lat - frame.lat0) * METERS_PER_DEGREE_LAT * scale / sign;
  const x = (bounds.west - frame.lng0) * mLng * scale;
  const zNorth = zOf(bounds.north);
  const zSouth = zOf(bounds.south);
  return {
    x,
    z: Math.min(zNorth, zSouth),
    width: (bounds.east - bounds.west) * mLng * scale,
    depth: Math.abs(zSouth - zNorth),
    northAtTop: zNorth <= zSouth,
  };
}

/** 纬度与壳体 z 的协方差。大于 0 表示 z 向北（旧壳体，和地图上下相反）。 */
function latZCovariance(polygon: AmapPoint[], shell: { z: number }[]): number | null {
  if (polygon.length !== shell.length || polygon.length < 3) return null;
  const meanLat = polygon.reduce((sum, point) => sum + point.lat, 0) / polygon.length;
  const meanZ = shell.reduce((sum, point) => sum + point.z, 0) / shell.length;
  let cov = 0;
  for (let i = 0; i < polygon.length; i++) cov += (polygon[i]!.lat - meanLat) * (shell[i]!.z - meanZ);
  return cov;
}

/** 已有壳体时，帧必须跟着壳体的 z 方向，不能假设每次都是新的北在上。 */
export function frameForExistingShell(polygon: AmapPoint[], shell?: { x: number; z: number }[] | null): MapGroundFrame | null {
  const registration = groundRegistration(polygon);
  if (!registration) return null;
  const cov = shell && shell.length ? latZCovariance(polygon, shell) : null;
  if (cov !== null && cov > 1e-6) {
    return {
      lng0: registration.frame.lng0,
      lat0: Math.min(...polygon.map(point => point.lat)),
      latMid: registration.frame.latMid,
      scale: registration.frame.scale,
      latSign: 1,
    };
  }
  return registration.frame;
}

/**
 * 旧圈画把地理北放在 z 最大的一边，平面图上沿却是 z=0。
 * 打开存档时把顶点翻到北在上，并换成同一套帧。已经朝北的原样返回。
 */
export function orientMapShellNorthUp(layout: RoomLayout): RoomLayout {
  const geo = layout.mapGroundPolygon;
  const shell = layout.backendVenue?.polygon ?? layout.backendSceneV2?.venue.polygon;
  if (!geo || geo.length < 3 || !shell || shell.length < 3) return layout;
  const cov = latZCovariance(geo, shell);
  if (cov === null || cov <= 1e-6) return layout;
  const depth = layout.backendVenue?.depth ?? layout.backendSceneV2?.venue.depth ?? layout.height;
  const flip = (points: { x: number; z: number }[]) => points.map(point => ({
    ...point,
    z: Math.min(depth, Math.max(0, Math.round((depth - point.z) * 10) / 10)),
  }));
  const registration = groundRegistration(geo);
  const venue = layout.backendVenue?.polygon
    ? { ...layout.backendVenue, polygon: flip(layout.backendVenue.polygon) }
    : layout.backendVenue;
  const scene = layout.backendSceneV2?.venue.polygon
    ? { ...layout.backendSceneV2, venue: { ...layout.backendSceneV2.venue, polygon: flip(layout.backendSceneV2.venue.polygon) } }
    : layout.backendSceneV2;
  return {
    ...layout,
    ...(venue ? { backendVenue: venue } : {}),
    ...(scene ? { backendSceneV2: scene } : {}),
    ...(registration ? { mapGroundFrame: registration.frame } : {}),
  };
}

export function parseSatelliteImageBounds(url: string): SatelliteImageBounds | null {
  try {
    const params = new URL(url, 'https://scendance.lilicoding.space').searchParams;
    const west = Number(params.get('west'));
    const south = Number(params.get('south'));
    const east = Number(params.get('east'));
    const north = Number(params.get('north'));
    if (![west, south, east, north].every(Number.isFinite) || !(east > west) || !(north > south)) return null;
    return { west, south, east, north };
  } catch {
    return null;
  }
}

/**
 * 卫星参考图地址（Key 不进地址）。范围是圈画外接矩形加一圈 pad，不是任意 zoom 的方形瓦片。
 * 本机是 3199，生产是同源 /api/amap-static。
 */
export function satelliteProxyUrl(polygon: AmapPoint[], _key?: string, frame?: MapGroundFrame, shell?: { width: number; depth: number }): string | null {
  const registration = groundRegistration(polygon);
  if (!registration) return null;
  const used = frame ?? registration.frame;
  const bounds = satelliteBoundsForFrame(polygon, used, shell?.width ?? registration.shellWidth, shell?.depth ?? registration.shellDepth);
  const params = new URLSearchParams({
    west: bounds.west.toFixed(7),
    south: bounds.south.toFixed(7),
    east: bounds.east.toFixed(7),
    north: bounds.north.toFixed(7),
    'x-ref': SATELLITE_GROUND_MARK,
  });
  const query = params.toString();
  return usesLocalAmapProxy()
    ? `http://127.0.0.1:3199/amap-static?${query}`
    : `/api/amap-static?${query}`;
}

/**
 * 拉取静态卫星图并落成代理 URL（带 SATELLITE_GROUND_MARK）。
 * 失败返回 null，上层再退到占位 SVG。第二个参数只为兼容旧调用，不会写进地址。
 */
export async function fetchSatelliteGroundDataUrl(
  polygon: AmapPoint[],
  _key?: string,
  frame?: MapGroundFrame,
  shell?: { width: number; depth: number },
): Promise<string | null> {
  const proxy = satelliteProxyUrl(polygon, _key, frame, shell);
  if (!proxy || typeof window === 'undefined') return null;
  // 浏览器直连 restapi 常被掐；走本机代理。用代理 URL 直接贴地（勿嵌 data URL，避免 localStorage 爆）。
  try {
    const probe = await fetch(proxy, { method: 'GET', signal: AbortSignal.timeout(10000) });
    if (!probe.ok) return null;
    // 读头确认是图。不要 await body.cancel()：取消失败会把已经 200 的卫星图当成没拉到，
    // 随后只留下 SVG 占位，而 createImageBitmap 解不开 SVG，地面就变成橄榄绿。
    const type = (probe.headers.get('content-type') || '').toLowerCase();
    const bytes = new Uint8Array(await probe.arrayBuffer());
    const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
    const png = bytes[0] === 0x89 && bytes[1] === 0x50;
    if (!type.startsWith('image/') && !jpeg && !png) return null;
    if (bytes.byteLength < 100) return null;
    return proxy;
  } catch {
    return null;
  }
}

function storageGet(key: string): string {
  try { return globalThis.localStorage?.getItem(key) ?? ''; } catch { return ''; }
}

/** 现有 NEXT_PUBLIC_AMAP_* / 本机已存 Key。不提供粘贴入口。 */
export function readAmapKeys(): { key: string; security: string; staticKey: string } {
  const key = process.env.NEXT_PUBLIC_AMAP_KEY || storageGet(AMAP_KEY_STORAGE);
  const security = process.env.NEXT_PUBLIC_AMAP_SECURITY_CODE || storageGet(AMAP_SECURITY_STORAGE);
  const staticKey = process.env.NEXT_PUBLIC_AMAP_STATIC_KEY || key;
  return { key, security, staticKey };
}

/** 场地名里的地点，丢掉「规划区 / 真实范围」这类尺寸注。 */
export function mapVenuePlaceQuery(name: string): string {
  return name
    .replace(/规划区\s*[\d.]+[×xX][\d.]+m.*$/u, '')
    .replace(/真实范围.*$/u, '')
    .replace(/[·・]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 以地理中心按场地米数摊一块矩形，供没有存圈画点列的旧场地补卫星图。 */
export function rectangleAroundMeters(center: AmapPoint, widthM: number, depthM: number): AmapPoint[] {
  const halfLng = Math.max(widthM, 4) / 2 / metersPerDegreeLng(center.lat);
  const halfLat = Math.max(depthM, 4) / 2 / METERS_PER_DEGREE_LAT;
  return [
    { lng: center.lng - halfLng, lat: center.lat - halfLat },
    { lng: center.lng + halfLng, lat: center.lat - halfLat },
    { lng: center.lng + halfLng, lat: center.lat + halfLat },
    { lng: center.lng - halfLng, lat: center.lat + halfLat },
  ];
}

/**
 * 该不该出现卫星参考、并在没人关过时默认打开。
 * 旧项目常常没有 mapGroundPolygon，backend 场地也还是矩形：名字里的「规划区」、
 * 场地简报的户外，或已经贴过的卫星图，都算。明确标成室内、又没有这些痕迹的矩形不算。
 */
export function isMapOutdoorLayout(layout: RoomLayout): boolean {
  if ((layout.mapGroundPolygon?.length ?? 0) >= 3) return true;
  if (layout.mapLngLat && Number.isFinite(layout.mapLngLat.lng) && Number.isFinite(layout.mapLngLat.lat)) return true;
  if (isSatelliteGroundImage(layout.floorPlanImage)) return true;
  // 缺圈画点列也要露出钮：规划区 / 真实范围只会出现在地图立壳的名字里。
  if (/规划区|真实范围/.test(layout.name)) return true;
  const venue = layout.backendSceneV2?.venue ?? layout.backendVenue;
  if (!venue || venue.site?.indoorOutdoor === 'indoor') return false;
  if (venue.site?.indoorOutdoor === 'outdoor') return true;
  return venue.shape === 'polygon';
}

/**
 * 上面这些场地默认要看卫星贴地。`false` 是人关掉的，重新打开前不再自动拉。
 * `true` 是打开。缺省则按 isMapOutdoorLayout。
 */
export function satelliteGroundWanted(layout: RoomLayout): boolean {
  if (layout.satelliteGroundRef === false) return false;
  if (layout.satelliteGroundRef === true) return true;
  return isMapOutdoorLayout(layout);
}

export function isPlaceholderSatellite(url: string | undefined | null): boolean {
  return !!url && url.startsWith('data:image/svg') && isSatelliteGroundImage(url);
}

/** 已经有可贴地的卫星图（代理或位图），占位 SVG 不算。生产上的 127.0.0.1 地址不算，否则会一直纯色。 */
export function hasFetchedSatellite(url: string | undefined | null): boolean {
  if (!isSatelliteGroundImage(url) || isPlaceholderSatellite(url)) return false;
  if (!usesLocalAmapProxy() && !!url && (url.includes('127.0.0.1:3199') || url.includes('localhost:3199'))) return false;
  return true;
}

/**
 * 图的经纬度范围必须和壳体是同一套，才能按 UV 对齐。
 * 旧的 location/zoom 方形瓦片没有这个范围，不能当成已经贴准。
 */
export function satelliteImageAligned(url: string | undefined | null): boolean {
  return !!url && hasFetchedSatellite(url) && parseSatelliteImageBounds(url) !== null;
}

export async function geocodeAmapPlace(query: string, key: string, security: string): Promise<AmapPoint | null> {
  if (query.trim().length < 2 || !key || typeof window === 'undefined') return null;
  try {
    await loadAmapScript(key, security);
  } catch {
    return null;
  }
  const PlaceSearch = window.AMap?.PlaceSearch;
  if (!PlaceSearch) return null;
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve(null), 8000);
    try {
      const searcher = new PlaceSearch({ city: '全国', pageSize: 1 });
      searcher.search(query, (status, result) => {
        clearTimeout(timer);
        const poi = (result as { poiList?: { pois?: { location?: { lng?: number; lat?: number } }[] } } | null)?.poiList?.pois?.[0];
        const lng = Number(poi?.location?.lng);
        const lat = Number(poi?.location?.lat);
        resolve(status === 'complete' && Number.isFinite(lng) && Number.isFinite(lat) ? { lng, lat } : null);
      });
    } catch {
      clearTimeout(timer);
      resolve(null);
    }
  });
}

async function geocodeViaSameOrigin(query: string): Promise<AmapPoint | null> {
  if (typeof window === 'undefined' || usesLocalAmapProxy()) return null;
  try {
    const response = await fetch(`/api/amap-geocode?keywords=${encodeURIComponent(query)}`, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) return null;
    const body = await response.json() as { lng?: number; lat?: number };
    const lng = Number(body.lng);
    const lat = Number(body.lat);
    return Number.isFinite(lng) && Number.isFinite(lat) ? { lng, lat } : null;
  } catch {
    return null;
  }
}

/** 优先用立壳时存下的圈画或中心点；旧场地没有点列时，用场地名向高德要一个中心再摊矩形。 */
export async function resolveSatellitePolygon(layout: RoomLayout): Promise<AmapPoint[] | null> {
  const stored = layout.mapGroundPolygon;
  if (stored && stored.length >= 3) return stored.map(point => ({ lng: point.lng, lat: point.lat }));
  if (layout.mapLngLat && Number.isFinite(layout.mapLngLat.lng) && Number.isFinite(layout.mapLngLat.lat)) {
    return rectangleAroundMeters(layout.mapLngLat, layout.width, layout.height);
  }
  if (!isMapOutdoorLayout(layout)) return null;
  const query = mapVenuePlaceQuery(layout.name);
  if (!query || query === '户外场地' || query === '未命名' || query === '未命名活动') return null;
  const { key, security } = readAmapKeys();
  const center = (key ? await geocodeAmapPlace(query, key, security) : null) ?? await geocodeViaSameOrigin(query);
  if (!center) return null;
  return rectangleAroundMeters(center, layout.width, layout.height);
}

function centroid(points: AmapPoint[]): { lng: number; lat: number } {
  return {
    lng: points.reduce((sum, point) => sum + point.lng, 0) / points.length,
    lat: points.reduce((sum, point) => sum + point.lat, 0) / points.length,
  };
}

export interface SatelliteGroundPatch {
  floorPlanImage: string;
  floorPlanOpacity: number;
  satelliteGroundRef: true;
  /** 定位成功才有；失败时只贴占位，不编造经纬度。 */
  mapGroundPolygon?: AmapPoint[];
  mapLngLat?: { lng: number; lat: number };
  mapGroundFrame?: MapGroundFrame;
}

/**
 * 补齐卫星参考底图。同源或本机代理拉到了就用真图；定位失败或探测失败时退回占位 SVG
 * （带 satellite-ground-ref），不要让地面停在素色。已经是占位且这次仍失败则返回 null，避免来回重贴。
 * 图只写 floorPlanImage，不进采集上传。浏览器不携带高德 Key。
 */
export async function ensureSatelliteGround(layout: RoomLayout): Promise<SatelliteGroundPatch | null> {
  const polygon = await resolveSatellitePolygon(layout);
  const located = polygon && polygon.length >= 3 ? polygon : null;
  if (located) {
    const registration = groundRegistration(located);
    const shell = layout.backendVenue?.polygon ?? layout.backendSceneV2?.venue.polygon;
    const frame = layout.mapGroundFrame ?? frameForExistingShell(located, shell) ?? registration?.frame;
    const fetched = await fetchSatelliteGroundDataUrl(located, undefined, frame, { width: layout.width, depth: layout.height });
    if (fetched && frame) {
      return {
        floorPlanImage: fetched,
        floorPlanOpacity: 0.78,
        satelliteGroundRef: true,
        mapGroundPolygon: located,
        mapLngLat: centroid(located),
        mapGroundFrame: frame,
      };
    }
  }
  // 已经有真图（哪怕还是旧的方形瓦片）或占位时，拉取失败不要改掉它，避免钮一开就变空白。
  if (isPlaceholderSatellite(layout.floorPlanImage) || hasFetchedSatellite(layout.floorPlanImage)) return null;
  const bbox = located ? polygonBboxMeters(located) : { width: layout.width, depth: layout.height };
  return {
    floorPlanImage: makeSatelliteGroundPlaceholder(bbox.width || layout.width, bbox.depth || layout.height),
    floorPlanOpacity: 0.78,
    satelliteGroundRef: true,
    ...(located ? { mapGroundPolygon: located, mapLngLat: centroid(located), ...(layout.mapGroundFrame ? { mapGroundFrame: layout.mapGroundFrame } : {}) } : {}),
  };
}

/**
 * 演示圈画已经有 polygon / mapLngLat 时绝不能报「未定位」。
 * 只有既没有坐标、这次也没贴上真图，才区分缺 Key 和地点没搜到。
 */
export function satelliteMissReason(
  layout: Pick<RoomLayout, 'mapGroundPolygon' | 'mapLngLat'>,
  patch: SatelliteGroundPatch | null,
  keys: { key: string; staticKey: string },
): 'key' | 'place' | null {
  const hasLocation = (layout.mapGroundPolygon?.length ?? 0) >= 3
    || (!!layout.mapLngLat && Number.isFinite(layout.mapLngLat.lng) && Number.isFinite(layout.mapLngLat.lat));
  if (hasLocation) return null;
  if (patch && !isPlaceholderSatellite(patch.floorPlanImage)) return null;
  if (!keys.staticKey && !keys.key) return 'key';
  return patch ? null : 'place';
}

export function applySatelliteGroundPatch(layout: RoomLayout, patch: SatelliteGroundPatch): RoomLayout {
  return {
    ...layout,
    floorPlanImage: patch.floorPlanImage,
    floorPlanOpacity: patch.floorPlanOpacity,
    satelliteGroundRef: true,
    ...(patch.mapGroundPolygon ? { mapGroundPolygon: patch.mapGroundPolygon } : {}),
    ...(patch.mapLngLat ? { mapLngLat: patch.mapLngLat } : {}),
    ...(patch.mapGroundFrame ? { mapGroundFrame: patch.mapGroundFrame } : {}),
  };
}

/** 关掉贴地：留下图和圈画点，下次打开不必重拉。素色地面由 satelliteGroundRef === false 决定。 */
export function hideSatelliteGround(layout: RoomLayout): RoomLayout {
  return { ...layout, satelliteGroundRef: false };
}

export function createVenueFromPick(
  before: RoomLayout,
  pick: {
    name: string;
    location: string;
    polygon: AmapPoint[];
    satelliteGround?: boolean;
    /** 已拉取的真实卫星参考 data URL；缺省则用占位 SVG。 */
    satelliteGroundImage?: string;
  },
): { layout: RoomLayout; cleared: number } {
  const local = polygonToLocalMeters(pick.polygon);
  const fitted = fitPolygonToShellLimit(local);
  const bbox = polygonBboxMeters(pick.polygon);
  const safeWidth = fitted.points.length >= 3
    ? fitted.width
    : Math.min(100, Math.max(2, Math.round((local.width || bbox.width) * 10) / 10));
  const safeDepth = fitted.points.length >= 3
    ? fitted.depth
    : Math.min(100, Math.max(2, Math.round((local.depth || bbox.depth) * 10) / 10));
  const oversized = fitted.oversized || bbox.width > 100 || bbox.depth > 100;
  const scaleNote = oversized
    ? ` · 规划区 ${safeWidth}×${safeDepth}m（真实范围 ${Math.round(bbox.width)}×${Math.round(bbox.depth)}m）`
    : '';
  const input = {
    base: before,
    floorIndex: 0,
    widthM: safeWidth,
    depthM: safeDepth,
    indoorOutdoor: 'outdoor' as const,
    scaleOrigin: 'typed' as const,
    ...(fitted.points.length >= 3 ? { polygonMeters: fitted.points } : {}),
  };
  const plan = (before.scenePreset || before.backendSceneV2 ? replaceVenueWithShell(input) : null) ?? raiseVenue(input);
  if (!plan) throw new Error('这块场地是有内墙或图纸证据的真实结构，先在结构里清出一块空地，再来圈画。');
  const name = [pick.name, pick.location].filter(Boolean).join(' · ') + scaleNote || before.name;
  // 圈画经纬度跟着场地走，方便 3D 里后补卫星图；不进场景线、不进采集上传。
  const registration = groundRegistration(pick.polygon);
  let layout: RoomLayout = {
    ...plan.layout, name, mapGroundPolygon: pick.polygon, mapLngLat: centroid(pick.polygon),
    ...(registration ? { mapGroundFrame: registration.frame } : {}),
  };
  if (pick.satelliteGround) {
    const raw = pick.satelliteGroundImage?.trim() ?? '';
    const image = raw && (
      raw.startsWith('data:image/')
      || raw.startsWith('http://127.0.0.1:3199/amap-static?')
      || raw.startsWith('http://localhost:3199/amap-static?')
      || raw.startsWith('/api/amap-static?')
      || isSatelliteGroundImage(raw)
    )
      ? raw
      : makeSatelliteGroundPlaceholder(safeWidth, safeDepth);
    layout = {
      ...layout,
      floorPlanImage: image,
      floorPlanOpacity: 0.78,
      satelliteGroundRef: true,
    };
  } else if (pick.satelliteGround === false) {
    const next = { ...layout, satelliteGroundRef: false as const };
    if (isSatelliteGroundImage(next.floorPlanImage)) delete next.floorPlanImage;
    layout = next;
  }
  return { layout, cleared: plan.cleared };
}
