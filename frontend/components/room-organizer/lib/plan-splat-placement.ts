/**
 * 户外 3D 里「实景扫描（高斯点云 / 3DGS）」的落位数学（纯函数，无 three 依赖）。
 *
 * 口径来源（`components/room-organizer/components/outdoor-plan-3d.tsx`）：
 *  - 落点组补偏移：`sceneLayer.position.set(metrics.width / 2, 0, -metrics.depth / 2)`
 *    （该文件第 426-429 行；crowd 层第 432-435 行同口径）。
 *  - 子对象壳体偏移：`placeAt` 里
 *    `object.position.set(shell.x - metrics.width / 2, 0, shell.z - metrics.depth / 2)`
 *    （第 438-442 行）。
 *  ⇒ 壳体坐标 (x 东、z 南，原点在场地西北角) → three 世界坐标：
 *    world.x = shell.x，world.y = 0，world.z = shell.z - metrics.depth。
 *
 * 换句话说：场地壳体是「北沿 z=0、东沿 x=0」的局部系，落到 three 世界时
 * z 轴整体平移 -depth（y 不动）。当平面 ENU 原点在场地西南角（minX = minY = 0、
 * 比例 1:1）时，这等价于 outdoor-plan-3d.tsx 文件头注释里的
 * `three.x = plan.x`、`three.z = -plan.y`。
 *
 * 这套换算必须和 `placeAt` 严格一致：实景扫描的地面轮廓标记（patch / outline）
 * 与点云本体用的是同一条链路，点云才会正好盖在那块轮廓上。
 */

/** 场地尺寸（米），与 3D 场景的 metrics 一致。 */
export interface PlanSplatMetrics {
  width: number;
  depth: number;
}

/** 场地壳体坐标：x 东、z 南，原点在场地西北角。 */
export interface PlanSplatShellPoint {
  x: number;
  z: number;
}

/** three 世界坐标（x 东、z 南、y 上）。 */
export interface PlanSplatWorldPoint {
  x: number;
  y: number;
  z: number;
}

/**
 * 壳体坐标 → three 世界坐标。
 *
 * 与 `outdoor-plan-3d.tsx` 的 `placeAt` + 落点组偏移完全同口径：
 * `world = (shell.x - w/2 + w/2, 0, shell.z - d/2 - d/2)`。
 */
export function splatWorldPosition(
  shell: PlanSplatShellPoint,
  metrics: PlanSplatMetrics,
): PlanSplatWorldPoint {
  return {
    x: shell.x,
    y: 0,
    z: shell.z - metrics.depth,
  };
}

/**
 * 点云预览的 `position` 偏移。
 *
 * `createSplatPreview` 的落位公式（`three/scan-placement.ts:computeScanFit`）是
 * 「点云自身中心 → `calibration.origin`」，`options.position` 再叠加上去，
 * 所以最终世界中心 = `calibration.origin + position`。
 *
 * 户外规划里点云要落在「实景扫描」那块场地轮廓上（= `target`），而
 * `calibration.origin` 是扫描自己那份标定里的原点，可能不在同一套坐标里，
 * 所以这里把 origin 抵消掉：最终中心恒等于 target。
 */
export function splatPlacementOffset(
  target: PlanSplatWorldPoint,
  origin: { x: number; z: number },
): PlanSplatWorldPoint {
  return {
    x: target.x - origin.x,
    y: target.y,
    z: target.z - origin.z,
  };
}

/**
 * 场地对角尺寸（米）——点云载入时的 `sizeMeters` 参考值，
 * 也是「这块场地最多能有多大」的量级上限。
 */
export function splatVenueSpan(metrics: PlanSplatMetrics): number {
  return Math.hypot(metrics.width, metrics.depth);
}
