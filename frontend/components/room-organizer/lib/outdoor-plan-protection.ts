import { enuToLngLat, lngLatToEnu } from './outdoor-plan-canvas';
import type { PlanPoint, SitePlanData } from '../../../../supabase/functions/_shared/site-plan';
/** Changing the local geographic frame must never silently relocate existing work. */
export function canReanchorOutdoorPlan(plan: SitePlanData, anchor: NonNullable<SitePlanData['anchor']>): boolean {
  // 车辆也算内容：只有车（plan.vehicles，2026-11-16 #118）的平面若被判为空，换锚点会让所有车整体位移。
  const populated = [plan.zones, plan.routes, plan.nodes, plan.facilities, plan.workers, plan.vehicles, plan.annotations, plan.measurements].some(items => items?.length);
  if (!populated) return true;
  if (!plan.anchor) return false;
  const dx = (anchor.lng - plan.anchor.lng) * 111320 * Math.cos(anchor.lat * Math.PI / 180);
  const dy = (anchor.lat - plan.anchor.lat) * 110540;
  return Math.hypot(dx, dy) < 0.01;
}

/** Draft points are drawn in the old viewport frame until commit; convert once, atomically. */
export function boundaryAtNewAnchor(points: readonly PlanPoint[], oldAnchor: { lng: number; lat: number }, newAnchor: { lng: number; lat: number }): PlanPoint[] {
  return points.map(point => { const geo = enuToLngLat(point.x, point.y, oldAnchor.lng, oldAnchor.lat); return lngLatToEnu(geo.lng, geo.lat, newAnchor.lng, newAnchor.lat); });
}

/**
 * 换场地 = 新场地（2026-11-16 用户定稿）。
 *
 * 锚点真的挪了（≥ 1cm，与 `canReanchorOutdoorPlan` 同口径）：旧坐标系里的分区 / 设施 / 流线 /
 * 点位 / 人员 / 测量 / 标注 / 设计范围一律不跨场搬，只交出带新锚点与新用地红线的空规划；
 * 同一锚点（原地重画边界）：内容原样保留，只换 boundary——不能把手上的活误删。
 * 调用方拿到 `replaced` / `cleared` 用于提示与撤销。
 */
export function planForPickedVenue(
  current: SitePlanData,
  anchor: NonNullable<SitePlanData['anchor']>,
  boundary: SitePlanData['boundary'],
): { plan: SitePlanData; replaced: boolean; cleared: number } {
  if (canReanchorOutdoorPlan(current, anchor)) {
    return { plan: { ...current, anchor, boundary }, replaced: false, cleared: 0 };
  }
  const cleared = [current.zones, current.routes, current.nodes, current.facilities, current.workers, current.annotations, current.measurements]
    .reduce<number>((sum, items) => sum + (items?.length ?? 0), 0);
  return {
    plan: {
      schemaVersion: current.schemaVersion,
      anchor,
      boundary,
      zones: [],
      facilities: [],
      routes: [],
      nodes: [],
      workers: [],
    },
    replaced: true,
    cleared,
  };
}
