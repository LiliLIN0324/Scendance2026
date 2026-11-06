/**
 * GCJ-02（火星坐标）↔ WGS-84（GPS 原始坐标）互转——纯函数，无依赖。
 *
 * 为什么需要它（MAP-04，docs/20 坐标边界约定）：
 * - 高德全系（JSAPI POI / 地图瓦片 / 静态图 / AutoComplete）都是 GCJ-02；
 *   `sceneAnchor`、`researchArea.bounds`、`AholoAssetGeo(source: 'picker' | 'lookup')` 因此都是 GCJ-02，
 *   内部一致，直接用，不要转。
 * - GPS/EXIF/采集遥测（如 DJI djmd 轨）是 WGS-84。把它直接当 GCJ-02 铺在高德底图上，
 *   在国内会偏差约 100–700 m。凡 WGS-84 来源进场景坐标前，必须先过 `wgs84ToGcj02`。
 * - `source: 'manual'` 的坐标系统目前未标注，接入前先弄清用户粘的是哪套，再决定转不转。
 *
 * 算法为公开的 GCJ-02 偏移拟合（国测局椭球参数），境内精度约 1–2 m，境外原样返回。
 */

const PI = Math.PI;
/** 克拉索夫斯基椭球长半轴（GCJ-02 拟合用的就是它）。 */
const SEMI_MAJOR = 6378245.0;
/** 第一偏心率平方。 */
const EE = 0.00669342162296594323;

export interface LngLat {
  lng: number;
  lat: number;
}

/** 粗判是否在中国大陆坐标偏移适用范围（不含港澳台管辖争议细节，仅做适用性判断）。 */
export function isInGcjOffsetRegion(lng: number, lat: number): boolean {
  return lng >= 72.004 && lng <= 137.8347 && lat >= 0.8293 && lat <= 55.8271;
}

function transformLat(x: number, y: number): number {
  let ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  ret += (20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0 / 3.0;
  ret += (20.0 * Math.sin(y * PI) + 40.0 * Math.sin(y / 3.0 * PI)) * 2.0 / 3.0;
  ret += (160.0 * Math.sin(y / 12.0 * PI) + 320 * Math.sin(y * PI / 30.0)) * 2.0 / 3.0;
  return ret;
}

function transformLng(x: number, y: number): number {
  let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  ret += (20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0 / 3.0;
  ret += (20.0 * Math.sin(x * PI) + 40.0 * Math.sin(x / 3.0 * PI)) * 2.0 / 3.0;
  ret += (150.0 * Math.sin(x / 12.0 * PI) + 300.0 * Math.sin(x / 30.0 * PI)) * 2.0 / 3.0;
  return ret;
}

/** WGS-84（GPS/EXIF）→ GCJ-02（高德）。境外坐标原样返回。 */
export function wgs84ToGcj02(lng: number, lat: number): LngLat {
  if (!isInGcjOffsetRegion(lng, lat)) return { lng, lat };
  let dLat = transformLat(lng - 105.0, lat - 35.0);
  let dLng = transformLng(lng - 105.0, lat - 35.0);
  const radLat = (lat / 180.0) * PI;
  let magic = Math.sin(radLat);
  magic = 1 - EE * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180.0) / (((SEMI_MAJOR * (1 - EE)) / (magic * sqrtMagic)) * PI);
  dLng = (dLng * 180.0) / ((SEMI_MAJOR / sqrtMagic) * Math.cos(radLat) * PI);
  return { lng: lng + dLng, lat: lat + dLat };
}

/** GCJ-02（高德）→ WGS-84（GPS）。迭代反推正向偏移，三次内收敛到 <1e-9 度（毫米级）。境外原样返回。 */
export function gcj02ToWgs84(lng: number, lat: number): LngLat {
  if (!isInGcjOffsetRegion(lng, lat)) return { lng, lat };
  let wgs: LngLat = { lng, lat };
  for (let i = 0; i < 3; i += 1) {
    const gcj = wgs84ToGcj02(wgs.lng, wgs.lat);
    wgs = { lng: wgs.lng - (gcj.lng - lng), lat: wgs.lat - (gcj.lat - lat) };
  }
  return wgs;
}
