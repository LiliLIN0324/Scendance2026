/**
 * 2D → 3D 落点的纯计算层。
 *
 * 2D 画布上的坐标是平面 ENU（x 东、y 北、米），3D 场景用的是场地壳体坐标
 * （x 东、z 南、0..width / 0..depth）。这里负责把两者对上，并给出朝向，
 * 让 3D 渲染层只负责"摆"和"着色"。
 *
 * 口径与 three/plan-footprint-builder.ts 保持位置一致：设施实体用
 * `position.set(center.x - metrics.width / 2, 0, center.z - metrics.depth / 2)`。
 * 朝向分两套：本层服务 bridge 派生的场景物件，其 `rotationDeg` 已在 bridge 里反号存入，
 * 故 3D 还原 `rotation.y = -(rotationDeg * Math.PI) / 180`；户外原生设施（plan-model-layer /
 * plan-footprint-builder）存的是 ENU 平面角，3D 取 `+rotationDeg`，两者约定不同、不要混用。
 */

import { planShellFrame } from './plan-footprint-geometry';
import type { PlanCrowdWorker, CrowdPlacement } from './plan-crowd-placement';
import { planCrowdPlacements } from './plan-crowd-placement';
import type { PlanSceneObject } from './plan-item-bridge';
import type { PlanPoint } from '../../../../supabase/functions/_shared/site-plan';

/** 场地尺寸（米），与 3D 场景的 metrics 一致。 */
export interface PlanSiteMetrics {
  width: number;
  depth: number;
}

/** 壳体坐标：x 东、z 南，原点在场地西北角。 */
export interface PlanShellPoint {
  x: number;
  z: number;
}

/** 一个物料 / 场景在 3D 里的落点。 */
export interface SceneObjectPlacement {
  id: string;
  kind: 'item' | 'scene';
  name: string;
  shell: PlanShellPoint;
  width: number;
  depth: number;
  height: number;
  /** 2D 逆时针为正（度）。 */
  rotationDeg: number;
  color: string;
  modelUrl?: string | undefined;
  /** 资产 ID（实景扫描 / 高斯点云场景用它找源文件）。 */
  assetId?: string | undefined;
}

/** 一组人群实例在 3D 里的落点。 */
export interface CrowdShellPlacement extends CrowdPlacement {
  shell: PlanShellPoint;
}

/**
 * 平面 ENU → 场地壳体坐标。没有有效边界时退回原值（x 东、z = -y 北）。
 */
export function planPointToShell(
  point: PlanPoint,
  boundary: readonly PlanPoint[],
  metrics: PlanSiteMetrics,
): PlanShellPoint {
  const frame = planShellFrame(boundary, metrics);
  if (!frame) return { x: point.x, z: -point.y };
  return frame.toShell(point);
}

/**
 * 物料 / 场景落点：把 bridge 派生的 PlanSceneObject 换算成壳体坐标。
 * 场景（实景扫描）覆盖整个边界，物料按自身中心。
 */
export function planSceneObjectPlacements(
  objects: readonly PlanSceneObject[],
  boundary: readonly PlanPoint[],
  metrics: PlanSiteMetrics,
): SceneObjectPlacement[] {
  return objects.map((object) => ({
    id: object.id,
    kind: object.kind,
    name: object.name,
    shell: planPointToShell(object.center, boundary, metrics),
    width: Math.max(0.2, object.width),
    depth: Math.max(0.2, object.depth),
    height: Math.max(0.2, object.height),
    rotationDeg: object.rotationDeg,
    color: object.color,
    modelUrl: object.modelUrl,
    assetId: object.assetId,
  }));
}

/**
 * 人群落点：2D 岗位点位按 count 展开成 N 个人，再换算到壳体坐标。
 */
export function planCrowdShellPlacements(
  workers: readonly PlanCrowdWorker[],
  boundary: readonly PlanPoint[],
  metrics: PlanSiteMetrics,
): CrowdShellPlacement[] {
  return planCrowdPlacements(workers).map((placement) => ({
    ...placement,
    shell: planPointToShell(placement.at, boundary, metrics),
  }));
}
