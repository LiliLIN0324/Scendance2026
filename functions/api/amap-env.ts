/** Pages 运行时的高德 Key。浏览器不读这些值；构建命令里的 NEXT_PUBLIC_* 若也配进了项目环境，同样能用。 */
export interface AmapServerEnv {
  AMAP_STATIC_KEY?: string;
  AMAP_KEY?: string;
  NEXT_PUBLIC_AMAP_STATIC_KEY?: string;
  NEXT_PUBLIC_AMAP_KEY?: string;
}

export function amapKeyFromEnv(env: AmapServerEnv): string {
  return env.AMAP_STATIC_KEY || env.NEXT_PUBLIC_AMAP_STATIC_KEY || env.AMAP_KEY || env.NEXT_PUBLIC_AMAP_KEY || '';
}

export function parseLocation(raw: string | null): { lng: number; lat: number } | null {
  if (!raw || !/^-?\d{1,3}(?:\.\d+)?,-?\d{1,2}(?:\.\d+)?$/.test(raw)) return null;
  const [lngRaw, latRaw] = raw.split(',');
  const lng = Number(lngRaw);
  const lat = Number(latRaw);
  if (!Number.isFinite(lng) || !Number.isFinite(lat) || Math.abs(lng) > 180 || Math.abs(lat) > 90) return null;
  return { lng, lat };
}

export function clampZoom(raw: string | null): number {
  const zoom = Number(raw ?? '18');
  if (!Number.isInteger(zoom) || zoom < 3 || zoom > 18) return 18;
  return zoom;
}

/** 高德卫星瓦片 style=6。静态 maptype=satellite 对本 Key 常回矢量图，瓦片才是真影像。 */
export function satelliteTileUrl(lng: number, lat: number, zoom: number): string {
  const n = 2 ** zoom;
  const x = Math.floor(((lng + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n);
  const tx = Math.min(n - 1, Math.max(0, x));
  const ty = Math.min(n - 1, Math.max(0, y));
  const host = 1 + ((tx + ty) % 4);
  return `https://webst0${host}.is.autonavi.com/appmaptile?style=6&x=${tx}&y=${ty}&z=${zoom}`;
}
