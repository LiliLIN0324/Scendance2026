import type { RoomLayout } from './types';
import { raiseVenue, replaceVenueWithShell } from './agent-proposal';
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
 * 高德经纬度多边形 → 本地米制点列（原点在西南角，x 向东、z 向北）。
 * 有点列就保留真轮廓；无 ≥3 点则退化为空（上层再走轴对齐矩形）。
 */
export function polygonToLocalMeters(polygon: AmapPoint[]): { width: number; depth: number; points: LocalPoint[] } {
  if (polygon.length < 3) return { width: 0, depth: 0, points: [] };
  const lats = polygon.map(p => p.lat);
  const lngs = polygon.map(p => p.lng);
  const lat0 = Math.min(...lats);
  const lng0 = Math.min(...lngs);
  const latMid = (lat0 + Math.max(...lats)) / 2;
  const mLng = metersPerDegreeLng(latMid);
  const raw = polygon.map(p => ({
    x: (p.lng - lng0) * mLng,
    z: (p.lat - lat0) * METERS_PER_DEGREE_LAT,
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
 * 仅当静态图拉取失败时兜底；默认不启用，由圈画面板开关决定。
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

/**
 * 拉取静态卫星图并叠禁令文案，落成 data URL（带 SATELLITE_GROUND_MARK）。
 * 失败返回 null，上层再退到占位 SVG。
 */
export async function fetchSatelliteGroundDataUrl(
  polygon: AmapPoint[],
  key: string,
): Promise<string | null> {
  const amapUrl = buildSatelliteStaticMapUrl(polygon, key);
  if (!amapUrl) return null;
  // 浏览器直连 restapi 常被掐；走本机代理。用代理 URL 直接贴地（勿嵌 data URL，避免 localStorage 爆）。
  try {
    if (typeof window !== 'undefined') {
      const parsed = new URL(amapUrl);
      const q = new URLSearchParams(parsed.search);
      q.delete('key');
      q.delete('maptype');
      q.set('x-ref', SATELLITE_GROUND_MARK);
      const proxy = `http://127.0.0.1:3199/amap-static?${q.toString()}`;
      const probe = await fetch(proxy, { method: 'GET', signal: AbortSignal.timeout(10000) });
      if (!probe.ok) return null;
      // 读一点确认是图；不把整图塞进布局
      const type = probe.headers.get('content-type') || '';
      if (!type.startsWith('image/')) return null;
      await probe.body?.cancel?.();
      return proxy;
    }
  } catch {
    return null;
  }
  // Node / 非浏览器：仍可返回 amap URL（测试用不到真拉）
  return null;
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
  let layout: RoomLayout = { ...plan.layout, name };
  if (pick.satelliteGround) {
    const raw = pick.satelliteGroundImage?.trim() ?? '';
    const image = raw && (
      raw.startsWith('data:image/')
      || raw.startsWith('http://127.0.0.1:3199/amap-static?')
      || raw.startsWith('http://localhost:3199/amap-static?')
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
  } else if (layout.satelliteGroundRef || isSatelliteGroundImage(layout.floorPlanImage)) {
    const next = { ...layout };
    delete next.floorPlanImage;
    delete next.satelliteGroundRef;
    layout = next;
  }
  return { layout, cleared: plan.cleared };
}
