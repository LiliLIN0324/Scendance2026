/** Pages 运行时的天地图 Key。浏览器不读这些值；探针与规划画布一律走 /api/tdt-tiles 服务端代理。 */
export interface TdtServerEnv {
  TDT_KEY?: string;
  NEXT_PUBLIC_TDT_KEY?: string;
}

export function tdtKeyFromEnv(env: TdtServerEnv): string {
  return env.TDT_KEY || env.NEXT_PUBLIC_TDT_KEY || '';
}

/**
 * 天地图 WMTS 图层（TILEMATRIXSET=w 即 EPSG:3857 Web 墨卡托）：
 * 矢量底图 vec_w、矢量注记 cva_w、影像底图 img_w、影像注记 cia_w。
 * 底图与注记必须同后缀配对（vec_w+cva_w、img_w+cia_w）；只放开 w 投影，c/4326 不进画布。
 */
export const TDT_TILE_LAYERS = ['vec_w', 'cva_w', 'img_w', 'cia_w'] as const;
export type TdtTileLayer = typeof TDT_TILE_LAYERS[number];

export function isTdtTileLayer(raw: string | null): raw is TdtTileLayer {
  return !!raw && (TDT_TILE_LAYERS as readonly string[]).includes(raw);
}

/** WMTS 参数里的 LAYER 名不带投影后缀：vec_w -> vec、cia_w -> cia。 */
export function tdtLayerBase(layer: TdtTileLayer): string {
  return layer.slice(0, -2);
}

/** 瓦片坐标校验：z 3–18，x/y 必须落在 [0, 2^z)。 */
export function parseTileCoord(
  zRaw: string | null,
  xRaw: string | null,
  yRaw: string | null,
): { z: number; x: number; y: number } | null {
  const z = Number(zRaw);
  const x = Number(xRaw);
  const y = Number(yRaw);
  if (!Number.isInteger(z) || !Number.isInteger(x) || !Number.isInteger(y)) return null;
  if (z < 3 || z > 18) return null;
  const span = 2 ** z;
  if (x < 0 || y < 0 || x >= span || y >= span) return null;
  return { z, x, y };
}

/** 天地图 WMTS 单瓦片 URL。tk 只在服务端拼接，永不回给浏览器。host 取 t0–t7 轮询。 */
export function tdtTileUrl(
  layer: TdtTileLayer,
  z: number,
  x: number,
  y: number,
  key: string,
  host: number = (x + y) % 8,
): string {
  const url = new URL(`https://t${host}.tianditu.gov.cn/${layer}/wmts`);
  url.searchParams.set('SERVICE', 'WMTS');
  url.searchParams.set('REQUEST', 'GetTile');
  url.searchParams.set('VERSION', '1.0.0');
  url.searchParams.set('LAYER', tdtLayerBase(layer));
  url.searchParams.set('STYLE', 'default');
  url.searchParams.set('TILEMATRIXSET', 'w');
  url.searchParams.set('FORMAT', 'tiles');
  url.searchParams.set('TILECOL', String(x));
  url.searchParams.set('TILEROW', String(y));
  url.searchParams.set('TILEMATRIX', String(z));
  url.searchParams.set('tk', key);
  return url.toString();
}
