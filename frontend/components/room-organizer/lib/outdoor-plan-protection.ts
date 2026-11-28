import { enuToLngLat, lngLatToEnu } from './outdoor-plan-canvas';
import type { PlanPoint, SitePlanData } from '../../../../supabase/functions/_shared/site-plan';

/**
 * 整条删除用地红线（2026-11-19 用户实测：红线只能重画替换，删不掉整条）。
 *
 * 口径与 schema 一致：`boundary: []` 是合法的「用户明确不设范围」起步态，不是坏数据。
 * 只清场地壳（boundary）与失去依据的设计范围（designScope）；锚点保持不动，
 * 分区 / 物料 / 流线 / 出入口 / 人员 / 车 / 标注 / 测量一律原样保留（同一引用，不复制）。
 * 撤销由调用方走 commitPlan 的 undo 栈，这里只做纯函数。
 */
export function clearPlanBoundary(plan: SitePlanData): SitePlanData {
  if (plan.boundary.length === 0 && (plan.designScope ?? []).length === 0) return plan;
  return { ...plan, boundary: [], designScope: undefined };
}
/** 锚点位移（米）。≥1cm 即「换场」——换场=新场地，旧坐标系内容整批清空（各调用方同口径）。 */
export function anchorMovedMeters(from: { lng: number; lat: number }, to: { lng: number; lat: number }): number {
  return Math.hypot(
    (to.lng - from.lng) * 111320 * Math.cos(to.lat * Math.PI / 180),
    (to.lat - from.lat) * 110540,
  );
}

/** Changing the local geographic frame must never silently relocate existing work. */
export function canReanchorOutdoorPlan(plan: SitePlanData, anchor: NonNullable<SitePlanData['anchor']>): boolean {
  // 车辆也算内容：只有车（plan.vehicles，2026-11-16 #118）的平面若被判为空，换锚点会让所有车整体位移。
  const populated = [plan.zones, plan.routes, plan.nodes, plan.facilities, plan.workers, plan.vehicles, plan.annotations, plan.measurements].some(items => items?.length);
  if (!populated) return true;
  if (!plan.anchor) return false;
  return anchorMovedMeters(plan.anchor, anchor) < 0.01;
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
  const cleared = [current.zones, current.routes, current.nodes, current.facilities, current.workers, current.vehicles, current.annotations, current.measurements]
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
      // 2026-11-17 #118：车辆也是旧坐标系的活内容——换场地必须一起清掉，
      // 否则旧场地坐标系里的车会留在新场地上（画布上像"凭空多了一台车"）。
      vehicles: [],
      // 2026-11-28：标注/测量画在旧场地上，同样是旧坐标系活内容——cleared 已把它们计进去，
      // plan 却没清，换场后钉在新场地坐标系上（与 #118 车辆同一类漏）。
      annotations: [],
      measurements: [],
    },
    replaced: true,
    cleared,
  };
}
