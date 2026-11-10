/**
 * P4-d：二维平面选过的底图，三维地面跟着用同一张（用户 m02033）。
 *
 * 平面画布与三维场景不共享 React 状态（一个在覆盖层、一个在场景 effect 里），
 * 所以这里放一个极小的模块级偏好：平面切了底图就写进来，三维贴地时读出来。
 * 只记 OSM / Carto 三个公开源——天地图两档要走 `/api/tdt-tiles`，本仓库没有那条路由。
 */

import type { PlanGroundSource } from './plan-ground-capture';

const STORAGE_KEY = 'scendance-plan-basemap-source-v1';

export const PLAN_GROUND_SOURCES: readonly PlanGroundSource[] = ['osm', 'carto-light', 'carto-dark'];

export function isPlanGroundSource(value: unknown): value is PlanGroundSource {
  return typeof value === 'string' && (PLAN_GROUND_SOURCES as readonly string[]).includes(value);
}

let cached: PlanGroundSource | null = null;

export function readPlanGroundSource(): PlanGroundSource {
  if (cached) return cached;
  try {
    const stored = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (isPlanGroundSource(stored)) {
      cached = stored;
      return stored;
    }
  } catch {
    // 隐私模式 / 无 localStorage 时用缺省。
  }
  cached = 'osm';
  return 'osm';
}

export function writePlanGroundSource(value: string | null | undefined): void {
  if (!isPlanGroundSource(value)) return;
  cached = value;
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, value);
  } catch {
    // 存不下就算了，本会话内仍然生效。
  }
}