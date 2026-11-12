/**
 * 天地图满铺探针页（H0-b）坐标与瓦片工具。
 *
 * 探针页独立成页，不动现有 AmapVenuePicker 主路径。它按 EPSG:3857 Web 墨卡托
 * 满铺画布加载天地图瓦片（矢量/影像切换 + 注记层叠加）：线上浏览器直连
 * WMTS（NEXT_PUBLIC_TDT_KEY，见 tdtDirectTileUrl），本机 dev 走 /api/tdt-tiles
 * 服务端代理。
 *
 * 坐标口径：天地图使用 CGCS2000（≈WGS84）。探针页直接吃 WGS84 经纬度，
 * 不与高德 GCJ-02 混算——混用会造成数百米级偏移，探针阶段就分开。
 */

/** 探针页支持的天地图底图：vec 矢量底图、img 影像底图；各配 cva/cia 注记。 */
export type TdtProbeLayer = 'vec' | 'img';

export const TDT_PROBE_TILE = 256;
export const TDT_PROBE_MIN_ZOOM = 3;
export const TDT_PROBE_MAX_ZOOM = 18;

/** 探针默认视角：平湖秋月（WGS84）。 */
export const TDT_PROBE_DEFAULT = {
  lng: 120.141306,
  lat: 30.2545,
  zoom: 15,
  layer: 'vec' as TdtProbeLayer,
};

/** Web 墨卡托瓦片坐标：lng/lat → (x, y, z) 的 x/y。 */
export function lngLatToTileXY(lng: number, lat: number, zoom: number): { x: number; y: number } {
  const span = 2 ** zoom;
  const latRad = lat * Math.PI / 180;
  return {
    x: Math.floor((lng + 180) / 360 * span),
    y: Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * span),
  };
}

/** 每像素代表的地面米数（近似，用于比例尺）。 */
export function metersPerPixel(lat: number, zoom: number): number {
  const latRad = lat * Math.PI / 180;
  const metersPerWorld = 40075016.686 * Math.cos(latRad);
  return metersPerWorld / ((2 ** zoom) * TDT_PROBE_TILE);
}

/** 当前可见瓦片网格，供画布一次拉取并平铺。 */
export function visibleTileGrid(centerLng: number, centerLat: number, zoom: number, viewportW: number, viewportH: number) {
  const span = 2 ** zoom;
  const center = lngLatToTileXY(centerLng, centerLat, zoom);
  const tileW = viewportW / TDT_PROBE_TILE;
  const tileH = viewportH / TDT_PROBE_TILE;
  const halfW = Math.max(0, Math.ceil(tileW / 2) + 1);
  const halfH = Math.max(0, Math.ceil(tileH / 2) + 1);
  const tiles: { x: number; y: number }[] = [];
  for (let dy = -halfH; dy <= halfH; dy++) {
    for (let dx = -halfW; dx <= halfW; dx++) {
      const x = center.x + dx;
      const y = center.y + dy;
      if (x < 0 || y < 0 || x >= span || y >= span) continue;
      tiles.push({ x, y });
    }
  }
  return { tiles, centerX: center.x, centerY: center.y };
}

/**
 * 线上前端直连天地图 WMTS 的 key（构建时注入的公开 key）：
 * 线上不能走 /api/tdt-tiles 服务端代理——天地图 CloudWAF 会拦截境外节点
 * （Cloudflare 边缘出口）的请求，实测 418「访问被拦截」（2026-11-12）；而
 * 天地图瓦片带 `Access-Control-Allow-Origin: *`，浏览器直连完全可用，
 * 3D WebGL 纹理也能用。防滥用靠天地图控制台的域名白名单。
 * 本机 dev（localhost / 127.0.0.1）仍走 3199 代理（读根 .env.local 的 TDT_KEY）。
 */
const TDT_DIRECT_KEY = () => process.env.NEXT_PUBLIC_TDT_KEY?.trim() || '';

/** 本机开发（无 window 为 SSR/测试）一律走代理，保证本地体验与单测可预期。 */
export function usesLocalTdtProxy(): boolean {
  if (typeof window === 'undefined') return false;
  const host = window.location?.hostname ?? '';
  return host === 'localhost' || host === '127.0.0.1' || host === '';
}

/**
 * 浏览器直连天地图 WMTS 单瓦片（host t0–t7 按 (x+y)%8 轮询，参数与
 * functions/api/tdt-env.ts 的 tdtTileUrl 同构）。非浏览器 / 本机 dev /
 * 未配置 key 时返回 null，调用方回落到 /api/tdt-tiles 同源代理。
 */
export function tdtDirectTileUrl(
  layer: 'vec_w' | 'img_w' | 'cva_w' | 'cia_w',
  z: number,
  x: number,
  y: number,
  key: string = TDT_DIRECT_KEY(),
  local: boolean = usesLocalTdtProxy(),
): string | null {
  if (!key || local) return null;
  const params = new URLSearchParams({
    SERVICE: 'WMTS',
    REQUEST: 'GetTile',
    VERSION: '1.0.0',
    LAYER: layer.slice(0, -2),
    STYLE: 'default',
    TILEMATRIXSET: 'w',
    FORMAT: 'tiles',
    TILECOL: String(x),
    TILEROW: String(y),
    TILEMATRIX: String(z),
    tk: key,
  });
  const host = (x + y) % 8;
  return `https://t${host}.tianditu.gov.cn/${layer}/wmts?${params.toString()}`;
}

/**
 * 探针瓦片地址：线上带 NEXT_PUBLIC_TDT_KEY 时浏览器直连天地图 WMTS
 * （天地图 CloudWAF 拦境外节点，服务端代理线上拉不到瓦片）；本机 dev / SSR /
 * 无 key 回落同源 /api/tdt-tiles。返回底图瓦片与对应注记瓦片两个地址——
 * 同后缀配对（vec_w+cva_w、img_w+cia_w），前端各自拉取后在画布上叠加。
 */
export interface TdtProbeTilePair { base: string; annotation: string }

export function tdtProbeTileUrl(layer: TdtProbeLayer, z: number, x: number, y: number, base: string = '/api/tdt-tiles'): TdtProbeTilePair {
  const baseLayer = layer === 'vec' ? 'vec_w' : 'img_w';
  const annotationLayer = layer === 'vec' ? 'cva_w' : 'cia_w';
  const urlFor = (wmtsLayer: 'vec_w' | 'img_w' | 'cva_w' | 'cia_w'): string =>
    tdtDirectTileUrl(wmtsLayer, z, x, y) ?? `${base}?layer=${wmtsLayer}&z=${z}&x=${x}&y=${y}`;
  return {
    base: urlFor(baseLayer),
    annotation: urlFor(annotationLayer),
  };
}

/** 底图 + 注记的署名行，与天地图 WMTS 使用政策一致。 */
export const TDT_PROBE_ATTRIBUTION = '底图 © 天地图（CGCS2000）· 数据来自国家地理信息公共服务平台';

/* ---------------- 公开免费图源（无需 key，探针立即可出真图） ---------------- */

/**
 * 探针可用的公开图源。天地图线上浏览器直连 / 本机走 /api/tdt-tiles 代理；
 * OSM/Carto 是公开标准瓦片，浏览器直连即可，均带必显署名。
 * 使用边界（规划稿 §5.4）：OSM 官方瓦片受用量政策约束，禁止批量抓取，
 * Carto 2026-09-23 起 key 化（非商用 5M/月、商用 1M/月免费），
 * 重负载需商用瓦片商或自建——探针轻量使用合规，生产另议。
 */
export type ProbePublicSource =
  | 'osm'
  | 'carto-light'
  | 'carto-dark'
  | 'amap-satellite'
  | 'amap-streets'
  | 'amap-streets-labels';

export const PROBE_PUBLIC_SOURCES: readonly ProbePublicSource[] = [
  'osm',
  'carto-light',
  'carto-dark',
  'amap-satellite',
  'amap-streets',
  'amap-streets-labels',
];

/**
 * Carto Basemaps key（公开配置，非密钥）：2026-09-23 起 Carto 要求 tile URL 带 ?key=，
 * 无 key 商用仅保障至 2026-11-30。key 从 NEXT_PUBLIC_CARTO_KEY 读取，可空——
 * 空时沿用无 key 公开端点（带水印），探针零配置仍可跑。
 */
const CARTO_KEY = process.env.NEXT_PUBLIC_CARTO_KEY?.trim() || '';
const CARTO_QUERY = CARTO_KEY ? `?key=${CARTO_KEY}` : '';

export interface PublicSourceSpec {
  id: ProbePublicSource;
  label: string;
  /** 瓦片 URL 模板：{z}/{x}/{y}。OSM 无子域；Carto 用固定 a.basemaps 单域，避免轮询滥用。 */
  urlTemplate: string;
  attribution: string;
}

export const PUBLIC_SOURCE_SPECS: Record<ProbePublicSource, PublicSourceSpec> = {
  osm: {
    id: 'osm',
    label: 'OSM 街道',
    urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '© OpenStreetMap contributors',
  },
  'carto-light': {
    id: 'carto-light',
    label: 'Carto 浅色',
    urlTemplate: `https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png${CARTO_QUERY}`,
    attribution: '© OpenStreetMap contributors · © CARTO',
  },
  'carto-dark': {
    id: 'carto-dark',
    label: 'Carto 深色',
    urlTemplate: `https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png${CARTO_QUERY}`,
    attribution: '© OpenStreetMap contributors · © CARTO',
  },
  // 2026-11-11 用户 m00xxx：「地图类型-高德那三个能用，补到我的平面下面」。
  // 高德网页瓦片直连即可用（实测 200 + `Access-Control-Allow-Origin: *`，不需要 key，
  // 所以能进 canvas 拼图、也能被 capturePlanGround 抓成 3D 地面纹理）。
  // style 6=卫星、7=街道、8=街道+注记；矢量档最高 z18（z19 返回 100 多字节的空瓦片），
  // 卫星档真影像也到 z18——z19/z20 返回「此区域无卫星图」灰色占位图（2026-11-12 六城实测同哈希），
  // 更高级别由 2D 画布 overzoom 拉伸 z18 瓦片，见 outdoor-plan-canvas.tsx 的 mapMaxZoomFor。
  'amap-satellite': {
    id: 'amap-satellite',
    label: '高德卫星',
    urlTemplate: 'https://webst01.is.autonavi.com/appmaptile?style=6&x={x}&y={y}&z={z}',
    attribution: '© 高德地图',
  },
  'amap-streets': {
    id: 'amap-streets',
    label: '高德街道',
    urlTemplate: 'https://webrd01.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=7&x={x}&y={y}&z={z}',
    attribution: '© 高德地图',
  },
  'amap-streets-labels': {
    id: 'amap-streets-labels',
    label: '高德街道注记',
    urlTemplate: 'https://webrd01.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}',
    attribution: '© 高德地图',
  },
};

/** 公开源单层瓦片地址（自带注记，无需叠加层）。 */
export function publicSourceTileUrl(source: ProbePublicSource, z: number, x: number, y: number): string {
  return PUBLIC_SOURCE_SPECS[source].urlTemplate.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));
}

/** 图源署名（随当前图源切换）。天地图沿用 TDT_PROBE_ATTRIBUTION。 */
export function probeSourceAttribution(source: ProbePublicSource | TdtProbeLayer): string {
  if ((PROBE_PUBLIC_SOURCES as readonly string[]).includes(source)) {
    return PUBLIC_SOURCE_SPECS[source as ProbePublicSource].attribution;
  }
  return TDT_PROBE_ATTRIBUTION;
}

/**
 * 画布 / 3D 右下角的可见署名（中文，逐档对应真实数据来源）。
 * 换图源必须换署名：署名写错比不写更糟（高德三档不能挂天地图的名）。
 */
export function basemapSourceAttribution(source: ProbePublicSource | TdtProbeLayer): string {
  switch (source) {
    case 'osm':
      return '© OpenStreetMap 贡献者';
    case 'carto-light':
    case 'carto-dark':
      return '© CARTO · © OpenStreetMap 贡献者';
    case 'amap-satellite':
      return '© 高德地图 · 卫星影像';
    case 'amap-streets':
    case 'amap-streets-labels':
      return '© 高德地图';
    case 'img':
      return '© 天地图影像 · 国家地理信息公共服务平台';
    default:
      return '© 天地图矢量 · 国家地理信息公共服务平台';
  }
}

/**
 * 兜底占位瓦片：当服务端没有 key / 拉不到真瓦片时，在画布上画一块程序化色块网格，
 * 让「满铺 + 缩放 + 拖拽 + 图层切换」交互仍可被验证。网格颜色随 x/y 与图层变化，
 * 肉眼可确认每帧对齐与平移是否正确。生产拿到 key 后真实瓦片会自动覆盖它。
 */
export function drawMockTile(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  zoom: number,
  layer: TdtProbeLayer,
): void {
  const hue = (x * 37 + y * 61 + zoom * 13) % 360;
  const dark = layer === 'img';
  ctx.fillStyle = dark
    ? `hsla(${hue}, 18%, 24%, 0.85)`
    : `hsla(${hue}, 22%, 78%, 0.85)`;
  ctx.fillRect(0, 0, TDT_PROBE_TILE, TDT_PROBE_TILE);
  ctx.strokeStyle = dark ? 'rgba(255,255,255,0.35)' : 'rgba(0,60,90,0.45)';
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, TDT_PROBE_TILE - 1, TDT_PROBE_TILE - 1);
  ctx.fillStyle = dark ? '#d9e4ee' : '#123b52';
  ctx.font = '11px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(`${layer} z${zoom}`, 6, 6);
  ctx.fillText(`${x},${y}`, 6, 20);
}