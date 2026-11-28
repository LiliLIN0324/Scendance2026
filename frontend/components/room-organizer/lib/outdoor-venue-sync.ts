import type { PlanPoint } from '../../../../supabase/functions/_shared/site-plan';
import { metersPerDegreeLng } from './tdt-probe-scale';
import { checkBoundaryRing, planRingSelfIntersects } from './site-plan-editing';

/**
 * 户外真实足迹 → SitePlan 用地红线（ENU 米，相对 `plan.anchor`）。
 *
 * 2026-11-25（E4）：2D ↔ 3D 壳体镜像整簇退役——由 layout 播种 plan、
 * 壳体边界补丁、双向边界同步、scene 锚点推导、壳体 venue 回写这五件已删。
 * `plan` 是唯一正源，壳体不再回写、也不再反向播种。
 *
 * 现在只剩「地图搜索选区 / 真实 GCJ 足迹 → 红线」这一条只读转换，
 * 供地图选址直接生成规划边界。
 */

/**
 * V-1c：真实 GCJ 足迹 → ENU 米边界（相对锚点），顶点抽稀到 64（契约上界）。
 * 按最小三角形逐点简化，每次验证不自交，保留凹口与狭窄连接处。
 * 任何顶点跑出 ±4900m（±5000 契约留余量）就整体不采信，调用方退回壳体轮廓。
 */
export function trueFootprintBoundary(
  polygon: readonly { lng: number; lat: number }[],
  anchor: { lng: number; lat: number },
  maxPoints = 64,
): PlanPoint[] | null {
  if (polygon.length < 3) return null;
  const kx = metersPerDegreeLng(anchor.lat);
  const points: PlanPoint[] = [];
  for (const { lng, lat } of polygon) {
    const x = (lng - anchor.lng) * kx;
    const y = (lat - anchor.lat) * 111132.92;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    if (Math.abs(x) > 4900 || Math.abs(y) > 4900) return null;
    const point = { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 };
    const prior = points[points.length - 1];
    if (!prior || Math.hypot(point.x - prior.x, point.y - prior.y) >= 0.5) points.push(point);
  }
  if (points.length > 1 && Math.hypot(points[0]!.x - points[points.length - 1]!.x, points[0]!.y - points[points.length - 1]!.y) < 0.5) points.pop();
  if (points.length < 3) return null;
  if (planRingSelfIntersects(points)) return null;
  while (points.length > Math.max(3, maxPoints)) {
    const candidates = points.map((point, index) => {
      const prev = points[(index + points.length - 1) % points.length]!;
      const next = points[(index + 1) % points.length]!;
      return { index, area: Math.abs((point.x - prev.x) * (next.y - prev.y) - (next.x - prev.x) * (point.y - prev.y)) };
    }).sort((a, b) => a.area - b.area);
    let removed = false;
    for (const { index } of candidates) {
      const reduced = points.filter((_, i) => i !== index);
      if (planRingSelfIntersects(reduced)) continue;
      if (reduced.some((p, i) => Math.hypot(p.x - reduced[(i + 1) % reduced.length]!.x, p.y - reduced[(i + 1) % reduced.length]!.y) < 0.5)) continue;
      points.splice(index, 1); removed = true; break;
    }
    if (!removed) return null;
  }
  return points;
}

/**
 * POI 检索点吸附进可信足迹（2026-11-28 用户「西湖美术馆钉子在树上、轮廓在楼上」实测拍板）：
 * 检索源（天地图/高德）的 POI 点可以和真实占地差几十米（该馆实测 72.5 m，OSM 面），
 * 轮廓才是场地真值——锚点与钉子都应跟着轮廓走。
 *
 * 口径：点在足迹内原样保留；在外取「最近边界点 + 朝质心方向内移」的点（顶点处天然是
 * 角平分线，真正进环而不是贴着邻边；贴边朝向会让锚点落在边界线上），步长逐级加大直到
 * 进环为止；质心也进不了环（病态几何）就回落原点，行为与未吸附完全一致。
 * 全程在以该点为原点的局部米制下算，坐标不变换。
 */
export function snapPointIntoFootprint(
  polygon: readonly [number, number][],
  point: { lng: number; lat: number },
): { lng: number; lat: number } {
  if (polygon.length < 3) return point;
  const kx = metersPerDegreeLng(point.lat);
  const toMeters = ([lng, lat]: [number, number]) => ({ x: (lng - point.lng) * kx, y: (lat - point.lat) * 111132.92 });
  const toLngLat = (p: { x: number; y: number }) => ({ lng: point.lng + p.x / kx, lat: point.lat + p.y / 111132.92 });
  const ring = polygon.map(toMeters);
  if (pointInRing({ x: 0, y: 0 }, ring)) return point;
  const centroid = ringCentroid(ring);
  if (centroid) {
    // 每条边对原点的最近点各出一个候选（顶点处相邻边共享同一点），按距离从近到远逐个试。
    const closest = nearestBoundaryPoints(ring).sort((a, b) => a.d - b.d);
    for (const c of closest) {
      const dx = centroid.x - c.x;
      const dy = centroid.y - c.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 1e-9) continue;
      for (const stepM of [0.5, 1, 2, 4, 8, dist]) {
        const s = Math.min(stepM, dist);
        const candidate = { x: c.x + (dx / dist) * s, y: c.y + (dy / dist) * s };
        if (pointInRing(candidate, ring)) return toLngLat(candidate);
        if (s >= dist) break;
      }
    }
    if (pointInRing(centroid, ring)) return toLngLat(centroid);
  }
  return point;
}

/** 射线法（米制局部坐标）：复用服务端 pointInGcjPolygon 的同款判定口径。 */
function pointInRing(point: { x: number; y: number }, ring: readonly { x: number; y: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!;
    const b = ring[j]!;
    if ((a.y > point.y) !== (b.y > point.y)
      && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** 每条边对原点的最近点（米制局部坐标，d=距离）。 */
function nearestBoundaryPoints(
  ring: readonly { x: number; y: number }[],
): { x: number; y: number; d: number }[] {
  const out: { x: number; y: number; d: number }[] = [];
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const len2 = abx * abx + aby * aby;
    const t = Math.max(0, Math.min(1, (-a.x * abx - a.y * aby) / (len2 || 1e-12)));
    const x = a.x + abx * t;
    const y = a.y + aby * t;
    out.push({ x, y, d: Math.hypot(x, y) });
  }
  return out;
}

/** 鞋带公式面积质心（米制）；退化环返回 null。 */
function ringCentroid(ring: readonly { x: number; y: number }[]): { x: number; y: number } | null {
  let area2 = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    const cross = a.x * b.y - b.x * a.y;
    area2 += cross;
    cx += (a.x + b.x) * cross;
    cy += (a.y + b.y) * cross;
  }
  if (Math.abs(area2) < 1e-9) return null;
  return { x: cx / (3 * area2), y: cy / (3 * area2) };
}

/**
 * 地图搜索选区（经纬度闭合面）→ 可写入 `plan.boundary` 的 ENU 环。
 * 搜索叠层和用地红线不是同一份数据：道路折线、不够三点、或几何过不了红线校验时返回 null，
 * 调用方继续只把它当视图辅助。
 */
export function planBoundaryFromSearchArea(
  area: { polygon: readonly [number, number][]; kind?: 'area' | 'line' } | null | undefined,
  anchor: { lng: number; lat: number } | null | undefined,
): PlanPoint[] | null {
  if (!area || area.kind === 'line' || area.polygon.length < 3 || !anchor) return null;
  const boundary = trueFootprintBoundary(
    area.polygon.map(([lng, lat]) => ({ lng, lat })),
    anchor,
  );
  if (!boundary || !checkBoundaryRing(boundary).ok) return null;
  return boundary;
}
