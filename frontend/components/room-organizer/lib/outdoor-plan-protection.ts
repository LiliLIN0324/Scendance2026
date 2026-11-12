import { enuToLngLat, lngLatToEnu } from './outdoor-plan-canvas';
import type { PlanPoint, SitePlanData } from '../../../../supabase/functions/_shared/site-plan';
/** Changing the local geographic frame must never silently relocate existing work. */
export function canReanchorOutdoorPlan(plan: SitePlanData, anchor: NonNullable<SitePlanData['anchor']>): boolean {
  const populated = [plan.zones, plan.routes, plan.nodes, plan.facilities, plan.workers, plan.annotations, plan.measurements].some(items => items?.length);
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
