/**
 * 玩家（漫游锚点）与场地物件的碰撞盒 —— 世界系。
 *
 * 为什么不能直接用 `planFacilityColliders()`：那套盒子是「路线局部」坐标
 * （场地外接框中心为原点，见 `plan-walk-context`），而玩家锚点、相机、
 * 座位条目都在 three 世界系（x 东、y 上、z = −北）。两者差一个场地中心平移：
 *
 *   世界 = 路线局部 + (场地中心 x, −场地中心 y)
 *
 * 场景里设施网格正是这么落的：`outdoor-plan-3d.tsx` 把设施挂到
 * `sceneLayer`（position = (cx, baseY, −cy)），子物体再按壳体偏移落位，
 * 两项相加就回到世界系。少加这一步，人会整体偏一个场地中心，表现是
 * 「走到帐篷前两米就被挡住」或干脆穿进舞台。
 *
 * 排除规则沿用人群那套（座位不挡、过小件不挡），但**不**排除压在流线上的
 * 设施：流线是给人流走的，玩家走到帐篷 / 舞台跟前仍应被占地推开。
 * 因此这里调用 `planFacilityColliders()` 时**不传 routes**。
 */
import { planFacilityColliders } from './plan-walk-context';
import type { WalkCollider } from './walk-collision';
import type { PlanFacility, PlanPoint } from '../../../../supabase/functions/_shared/site-plan';
import type { PlanSiteMetrics } from './plan-scene-placement';

/** 世界系平面点（x 东、z = −北），米。 */
export interface PlanWorldPoint {
  x: number;
  z: number;
}

/**
 * 场地外接框中心，换算到世界系。口径与 `three/plan-basemap-tiles.ts` 的
 * `ringFrame` 一致（中心取外接框中心，不做订正）；点不足时退回原点。
 */
export function planPlayerSiteCenter(boundary: readonly PlanPoint[]): PlanWorldPoint {
  if (boundary.length === 0) return { x: 0, z: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of boundary) {
    if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) continue;
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  if (!Number.isFinite(minX) || !Number.isFinite(maxX)) return { x: 0, z: 0 };
  // y 北向 → z 南向：世界 z = −ENU y。
  return { x: (minX + maxX) / 2, z: -(minY + maxY) / 2 };
}

/**
 * 设施 → 玩家世界系碰撞盒。
 *
 * @param facilities 参与碰撞的设施（座位与小件由内部规则剔除）
 * @param boundary 场地边界（ENU）
 * @param metrics 场地外接框尺寸，与 3D 壳体的 `{ width, depth }` 同一份
 * @param center 场地中心（世界系）；缺省按 boundary 现算
 */
export function planPlayerColliders(
  facilities: readonly PlanFacility[],
  boundary: readonly PlanPoint[],
  metrics: PlanSiteMetrics,
  center: PlanWorldPoint = planPlayerSiteCenter(boundary)
): WalkCollider[] {
  // 不传 routes：压在流线上的设施对玩家仍然是障碍。
  const local = planFacilityColliders(facilities, boundary, metrics);
  if (local.length === 0) return local;
  return local.map((collider) => ({
    ...collider,
    cx: collider.cx + center.x,
    cz: collider.cz + center.z,
  }));
}
