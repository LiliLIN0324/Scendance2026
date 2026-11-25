import type { PlanPoint } from '../../../../supabase/functions/_shared/site-plan';
import { metersPerDegreeLng } from './tdt-probe-scale';
import { checkBoundaryRing, planRingSelfIntersects } from './site-plan-editing';

/**
 * 户外真实足迹 → SitePlan 用地红线（ENU 米，相对 `plan.anchor`）。
 *
 * 2026-11-25（E4）：2D ↔ 3D 壳体镜像整簇退役——`seededPlanFromLayout`、
 * `shellVenuePatchFromPlanBoundary`、`nextOutdoorBoundarySync`、
 * `sceneAnchorFromOutdoorPlan`、`applyOutdoorShellVenuePatch` 已删除。
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
