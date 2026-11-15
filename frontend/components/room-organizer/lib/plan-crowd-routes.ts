/**
 * 户外人群 → 人流动线分配（纯函数层，#102）。
 *
 * 本批口径：只把可走的云端人物挂到 `pedestrian` 人行动线做沿线漫游；
 * `vehicle` 车流 / `service` 后勤流暂缓，不挂动态对象（3D 仍只画静态路线）。
 *
 * 坐标：路线点由平面 ENU（x 东、y 北）折成 crowdLayer 组内局部坐标，
 * 与人群落点 `placeAtNext`（shell − 框半宽/半深）同一坐标系，follower 直接写
 * `group.position.x/z` 即可对齐。
 */
import { planPointToShell } from './plan-scene-placement';
import type { CrowdShellPlacement, PlanSiteMetrics } from './plan-scene-placement';
import type { WalkRoute } from './types';
import type { PlanPoint, PlanRoute } from '../../../../supabase/functions/_shared/site-plan';

/** 只保留可用于人群漫游的人行动线（至少 2 个途经点）。 */
export function walkablePedestrianRoutes(routes: readonly PlanRoute[]): PlanRoute[] {
  return routes.filter((route) => route.kind === 'pedestrian' && route.points.length >= 2);
}

/** ENU 路线点 → crowdLayer 组内局部坐标。 */
function routePointToLocal(
  point: PlanPoint,
  boundary: readonly PlanPoint[],
  metrics: PlanSiteMetrics,
): { x: number; z: number } {
  const shell = planPointToShell(point, boundary, metrics);
  return { x: shell.x - metrics.width / 2, z: shell.z - metrics.depth / 2 };
}

/**
 * 为每个人群实例分配一条人行动线。
 *
 * - 可走实例（绑定/默认云端 walk 角色，`assetId` 非空）按序号循环挂一条 pedestrian 路线；
 * - 无可用人流、非可走实例、路线点退化 → 不进映射（保持静态在岗摆位）。
 *
 * 返回 `placement.id → WalkRoute` 映射；场景层查不到即按现状 idle 静态摆位。
 */
export function assignCrowdWalkRoutes(
  placements: readonly CrowdShellPlacement[],
  routes: readonly PlanRoute[],
  boundary: readonly PlanPoint[],
  metrics: PlanSiteMetrics,
): Map<string, WalkRoute> {
  const out = new Map<string, WalkRoute>();
  const pedRoutes = walkablePedestrianRoutes(routes);
  if (pedRoutes.length === 0) return out;

  let walkableIndex = 0;
  for (const placement of placements) {
    // 低模 / 人位柱实例没有 walk mixer，不挂漫游 follower。
    if (!placement.assetId) continue;
    const route = pedRoutes[walkableIndex % pedRoutes.length]!;
    walkableIndex += 1;
    const points = route.points.map((point) => routePointToLocal(point, boundary, metrics));
    if (points.length < 2) continue;
    out.set(placement.id, {
      points,
      // 户外人流按折返巡游：到端点原路返回，不闭环跳回首点。
      loop: false,
      // 人流预览连续行进，不在途经点停留。
      pauseMs: 0,
    });
  }
  return out;
}
