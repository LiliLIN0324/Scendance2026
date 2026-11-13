/**
 * P4-d：二维平面选过的底图，三维地面跟着用同一张（用户 m02033）。
 *
 * 平面画布与三维场景不共享 React 状态（一个在覆盖层、一个在场景 effect 里），
 * 所以这里放一个极小的模块级偏好：平面切了底图就写进来，三维贴地时读出来。
 * 记的是能直接拼图的公开源：OSM / Carto / 高德三档（高德瓦片不需要 key，
 * 且带 CORS 头，见 tdt-probe.ts）。天地图两档要走 `/api/tdt-tiles`，不进这份偏好。
 */

import type { PlanGroundSource } from './plan-ground-capture';

const STORAGE_KEY = 'scendance-plan-basemap-source-v1';

export const PLAN_GROUND_SOURCES: readonly PlanGroundSource[] = [
  'osm',
  'carto-light',
  'carto-dark',
  'amap-satellite',
  'amap-streets',
  'amap-streets-labels',
];

export function isPlanGroundSource(value: unknown): value is PlanGroundSource {
  return typeof value === 'string' && (PLAN_GROUND_SOURCES as readonly string[]).includes(value);
}

let cached: PlanGroundSource | null = null;

const listeners = new Set<() => void>();

/**
 * 订阅图源偏好变化（主舞台 GeoGround effect 用 useSyncExternalStore 消费）。
 * 返回退订函数。
 */
export function subscribePlanGroundSource(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

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
  // 缺省用高德街道：OSM/Carto 为 WGS-84 直连源，在国内网络下浏览器批量并发瓦片易被
  // 限流挂起（首帧整批 inflight、底图空白）；高德瓦片是 GCJ-02 网格、与场地锚点同坐标系，
  // 不需 key 且带 CORS 头（见 tdt-probe.ts）。用户仍可在底图面板切回其他源。
  cached = 'amap-streets';
  return 'amap-streets';
}

export function writePlanGroundSource(value: string | null | undefined): void {
  if (!isPlanGroundSource(value)) return;
  const changed = cached !== value;
  cached = value;
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, value);
  } catch {
    // 存不下就算了，本会话内仍然生效。
  }
  if (changed) listeners.forEach((listener) => listener());
}