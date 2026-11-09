/**
 * 天地图满铺探针（H0-c）尺度夹具与坐标对位。
 *
 * 覆盖评审稿 §6「验证尺度」与 §10.1 P0a 探针第 5 步：
 * - 500×500 m 样板：在同一份几何下，对角线/面积在矢量、影像两种底图一致（≤1 cm）。
 * - GCJ-02 ↔ WGS-84（≈CGCS2000）对位：天地图底图是 CGCS2000，高德语义层是 GCJ-02，
 *   混用会数百米偏移；探针阶段用固定锚点 + 局部米制近似映射，另做独立地标双检。
 *
 * 约定（与 site-plan.ts 一致）：几何真值用局部米制 ENU 平面（x 东、y 北），
 * 场地锚点单独保留地理坐标；派生量（面积/长度）一律从米制几何现算。
 */

import { gcj02ToWgs84, wgs84ToGcj02 } from './geo-coords';

export interface LngLat { lng: number; lat: number }
export interface PlanPoint { x: number; y: number }

/** 固定原点的 WGS84 → 局部米制 ENU（近似：把经纬度差按该纬度换算成东/北米）。 */
export function wgs84ToEnu(lng: number, lat: number, origin: FPointLatLng): PlanPoint {
  const dLng = lng - origin.lng;
  const dLat = lat - origin.lat;
  return {
    x: dLng * metersPerDegreeLng(origin.lat),
    y: dLat * metersPerDegreeLat,
  };
}

export interface FPointLatLng { lng: number; lat: number }

/** 每度纬度对应的米数（近似恒定）。 */
export const metersPerDegreeLat = 111132.92;

/** 每度经度对应的米数，随纬度变化（余弦收缩）。 */
export function metersPerDegreeLng(lat: number): number {
  return Math.cos(lat * Math.PI / 180) * 111319.49;
}

/** 多边形面积（鞋带公式，米²，自动闭合）。 */
export function ringAreaM2(points: readonly PlanPoint[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

/** 折线长度（米）。 */
export function polylineLengthM(points: readonly PlanPoint[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  return total;
}

/** 闭合环周长（米，含首尾闭合边）。 */
export function ringPerimeterM(points: readonly PlanPoint[]): number {
  let total = polylineLengthM(points);
  if (points.length >= 2) {
    total += Math.hypot(points[0].x - points[points.length - 1].x, points[0].y - points[points.length - 1].y);
  }
  return total;
}

/** 500×500 m 方正样板的边界（米制 ENU，原点西北角）。 */
export function squareSampleBoundary(spanM = 500): PlanPoint[] {
  return [
    { x: 0, y: 0 },
    { x: spanM, y: 0 },
    { x: spanM, y: spanM },
    { x: 0, y: spanM },
  ];
}

/** 双底图尺度一致性断言结果：同一几何在两种底图下读数必须一致到 ≤1 cm。 */
export interface ScaleConsistency {
  spanM: number;
  diagonalM: number;
  areaM2: number;
  perimeterM: number;
  /** 两条对角线（交点于中心）总长 = 2 × 对角线长，作为交叉验证。 */
  crossDiagonalsM: number;
  /** 绝对误差（米），同一几何不存在底图差异，故为 0；记录以证设计约束。 */
  maxAbsErrorM: number;
}

/**
 * 500×500 m 尺度夹具。实测目标：对角线 / 面积在矢量、影像两种底图下一致 ≤1 cm。
 * 这里用同一份米制几何表达「两底图共用同一几何」的不变量——换底图不换几何，
 * 因此差异恒为 0；真正的「两底图实测一致」在有 key 后由浏览器量测对账（探针报告记录）。
 */
export function scaleConsistency(spanM = 500): ScaleConsistency {
  const boundary = squareSampleBoundary(spanM);
  const diagonalM = Math.hypot(spanM, spanM);
  return {
    spanM,
    diagonalM,
    areaM2: ringAreaM2(boundary),
    perimeterM: ringPerimeterM(boundary),
    crossDiagonalsM: diagonalM * 2,
    maxAbsErrorM: 0, // 同一几何，底图切换不产生几何漂移；≤1cm 目标由几何恒等保证。
  };
}

/** 平湖秋月固定锚点（WGS-84），作为 GCJ-02 ↔ WGS84 对位参考。 */
export const PINGHU_WGS84: FPointLatLng = { lng: 120.141306, lat: 30.2545 };

/** GCJ-02 → WGS84 对位记录：返回往返误差（米），用于核验转换可用性。 */
export function gcjWgs84RoundTrip(gcj: FPointLatLng): { wgs: FPointLatLng; roundTripM: number } {
  const wgs = gcj02ToWgs84(gcj.lng, gcj.lat);
  const back = wgs84ToGcj02(wgs.lng, wgs.lat);
  const dLng = back.lng - gcj.lng;
  const dLat = back.lat - gcj.lat;
  return {
    wgs,
    roundTripM: Math.hypot(dLng * metersPerDegreeLng(gcj.lat), dLat * metersPerDegreeLat),
  };
}