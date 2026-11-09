import { METERS_PER_DEGREE_LAT, metersPerDegreeLng } from './amap-venue';

/**
 * 圈画草稿的纯逻辑层：顶点收集、撤销、轮廓校验。
 *
 * 为什么要独立成文件：地图 SDK 只给「画完了」这一个信号，没闭合、少于 3 点、
 * 点都挤在一起、轮廓自相交这些情况，用户在屏幕上看到的只是一块不会亮的按钮。
 * 把判定收进纯函数，才能在没有真实地图的环境里逐条验收，也才能让界面给出
 * 具体原因（缺几个点 / 面积多大 / 哪里自交），而不是一句「无效」。
 */

/** 圈画一个顶点。坐标与高德一致，是 GCJ-02。 */
export interface DrawPoint {
  lng: number;
  lat: number;
}

/** 相邻顶点的最小间隔（米）：小于它视为重复点击同一个点，直接忽略。 */
export const MIN_VERTEX_GAP_M = 0.5;

/** 轮廓最小可接受面积（平方米）：小于它说明点几乎挤在一起，围不出场地。 */
export const MIN_POLYGON_AREA_M2 = 4;

/** 轮廓判定的两种结果。 */
export type ContourCheck =
  | { ok: true; areaM2: number; vertexCount: number }
  | { ok: false; reason: string; vertexCount: number };

function isFinitePoint(point: DrawPoint | undefined | null): point is DrawPoint {
  return !!point && Number.isFinite(point.lng) && Number.isFinite(point.lat);
}

/** 两点间地面距离（米）。纬度取两点均值，经度按该纬度收缩。 */
export function pointDistanceMeters(a: DrawPoint, b: DrawPoint): number {
  const latMid = (a.lat + b.lat) / 2;
  const dx = (b.lng - a.lng) * metersPerDegreeLng(latMid);
  const dy = (b.lat - a.lat) * METERS_PER_DEGREE_LAT;
  return Math.hypot(dx, dy);
}

/**
 * 追加一个顶点。离上一个点太近（或与任意已有点重合）时拒绝，返回 rejected。
 * 双击闭合会在同一处连着触发两次 click，这个守卫能挡住第二次。
 */
export function appendVertex(
  points: readonly DrawPoint[],
  point: DrawPoint,
): { points: DrawPoint[]; rejected: boolean } {
  if (!isFinitePoint(point)) return { points: [...points], rejected: true };
  for (const existing of points) {
    if (pointDistanceMeters(existing, point) < MIN_VERTEX_GAP_M) {
      return { points: [...points], rejected: true };
    }
  }
  return { points: [...points, { lng: point.lng, lat: point.lat }], rejected: false };
}

/** 撤销最后一个顶点（草稿）。 */
export function undoVertex(points: readonly DrawPoint[]): DrawPoint[] {
  return points.length > 0 ? points.slice(0, -1) : [];
}

/** 折线长度（米）。 */
export function polylineLengthMeters(points: readonly DrawPoint[]): number {
  let total = 0;
  for (let i = 0; i < points.length - 1; i += 1) {
    total += pointDistanceMeters(points[i]!, points[i + 1]!);
  }
  return total;
}

/** 轮廓面积（平方米）。用等距近似投影到平面后算鞋带公式；面积与投影无关。 */
export function polygonAreaMeters2(points: readonly DrawPoint[]): number {
  if (points.length < 3) return 0;
  const lats = points.map(p => p.lat);
  const lngs = points.map(p => p.lng);
  const latMid = (Math.min(...lats) + Math.max(...lats)) / 2;
  const mLng = metersPerDegreeLng(latMid);
  const local = points.map(p => ({
    x: (p.lng - Math.min(...lngs)) * mLng,
    y: (p.lat - Math.min(...lats)) * METERS_PER_DEGREE_LAT,
  }));
  let sum = 0;
  for (let i = 0; i < local.length; i += 1) {
    const a = local[i]!;
    const b = local[(i + 1) % local.length]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

/** 两条线段是否相交（不含共享端点的相邻边）。 */
function segmentsCross(a: DrawPoint, b: DrawPoint, c: DrawPoint, d: DrawPoint): boolean {
  const orient = (p: DrawPoint, q: DrawPoint, r: DrawPoint) => {
    const value = (q.lng - p.lng) * (r.lat - p.lat) - (q.lat - p.lat) * (r.lng - p.lng);
    return value > 1e-12 ? 1 : value < -1e-12 ? -1 : 0;
  };
  const onSegment = (p: DrawPoint, q: DrawPoint, r: DrawPoint) =>
    q.lng >= Math.min(p.lng, r.lng) - 1e-12 && q.lng <= Math.max(p.lng, r.lng) + 1e-12
    && q.lat >= Math.min(p.lat, r.lat) - 1e-12 && q.lat <= Math.max(p.lat, r.lat) + 1e-12;
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSegment(a, c, b)) return true;
  if (o2 === 0 && onSegment(a, d, b)) return true;
  if (o3 === 0 && onSegment(c, a, d)) return true;
  if (o4 === 0 && onSegment(c, b, d)) return true;
  return false;
}

/** 轮廓是否自相交（边与边之间穿模）。 */
export function polygonSelfIntersects(points: readonly DrawPoint[]): boolean {
  if (points.length < 4) return false;
  const n = points.length;
  for (let i = 0; i < n; i += 1) {
    const a1 = points[i]!;
    const a2 = points[(i + 1) % n]!;
    for (let j = i + 1; j < n; j += 1) {
      // 相邻边共享端点，不算自交；首尾边同样相邻。
      if (j === i) continue;
      if ((j + 1) % n === i) continue;
      if (j === (i + 1) % n) continue;
      const b1 = points[j]!;
      const b2 = points[(j + 1) % n]!;
      if (segmentsCross(a1, a2, b1, b2)) return true;
    }
  }
  return false;
}

/**
 * 轮廓能不能作为场地边界。给不出「为什么不行」时也要说清楚缺什么。
 * 未闭合在这里表现为「点数不足」——围成一块地至少要 3 个顶点。
 */
export function checkContour(points: readonly DrawPoint[]): ContourCheck {
  const vertexCount = points.length;
  if (vertexCount < 3) {
    return { ok: false, reason: `轮廓还没围住：至少要 3 个点，现在有 ${vertexCount} 个。`, vertexCount };
  }
  if (polygonSelfIntersects(points)) {
    return { ok: false, reason: '轮廓自己穿模了（边和边交叉），圈画请按顺序描一圈。', vertexCount };
  }
  const areaM2 = polygonAreaMeters2(points);
  if (areaM2 < MIN_POLYGON_AREA_M2) {
    return {
      ok: false,
      reason: `轮廓围出的面积太小（约 ${areaM2.toFixed(1)} m²），点可能都点在了一起。`,
      vertexCount,
    };
  }
  return { ok: true, areaM2, vertexCount };
}

/** 流线能不能用：至少两个点才有折线。 */
export function checkFlowLine(points: readonly DrawPoint[]): ContourCheck {
  const vertexCount = points.length;
  if (vertexCount < 2) {
    return { ok: false, reason: `流线至少要 2 个点，现在有 ${vertexCount} 个。`, vertexCount };
  }
  return { ok: true, areaM2: polylineLengthMeters(points), vertexCount };
}
