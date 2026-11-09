/**
 * 天地图满铺探针页（H0-b）坐标与瓦片工具。
 *
 * 探针页独立成页，不动现有 AmapVenuePicker 主路径。它按 EPSG:3857 Web 墨卡托
 * 满铺画布加载天地图瓦片（矢量/影像切换 + 注记层叠加），key 只走 /api/tdt-tiles
 * 服务端代理，前端只拼 layer/z/x/y，永不携带 tk。
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
 * 探针瓦片地址：key 只留在服务端，前端直接打同源 /api/tdt-tiles。
 * 返回底图瓦片与对应注记瓦片两个地址——同后缀配对（vec_w+cva_w、img_w+cia_w），
 * 前端各自拉取后在画布上叠加。
 */
export interface TdtProbeTilePair { base: string; annotation: string }

export function tdtProbeTileUrl(layer: TdtProbeLayer, z: number, x: number, y: number, base: string = '/api/tdt-tiles'): TdtProbeTilePair {
  const baseLayer = layer === 'vec' ? 'vec_w' : 'img_w';
  const annotationLayer = layer === 'vec' ? 'cva_w' : 'cia_w';
  return {
    base: `${base}?layer=${baseLayer}&z=${z}&x=${x}&y=${y}`,
    annotation: `${base}?layer=${annotationLayer}&z=${z}&x=${x}&y=${y}`,
  };
}

/** 底图 + 注记的署名行，与天地图 WMTS 使用政策一致。 */
export const TDT_PROBE_ATTRIBUTION = '底图 © 天地图（CGCS2000）· 数据来自国家地理信息公共服务平台';

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