/**
 * 规划坐标 → 3D 场景坐标（2026-11-17 实机走查补）。
 *
 * 户外 3D 的场地以边界包围盒中心为原点：world.x = x − cx，world.z = −(y − cy)。
 * 不是绝对 ENU（`enuToWorld` 只做 z 取反，不含中心平移）——上一版人形漫游
 * 按绝对 ENU 接线，人会整体偏移一个场地中心；这里把它抽成纯函数并锁测试。
 */

export interface SceneFrameCenter {
  /** 边界包围盒中心（ENU，米），来自 ringFrame(boundary)。 */
  cx: number;
  cy: number;
}

export interface ScenePoint {
  x: number;
  z: number;
}

/** 规划点（ENU）→ 场景坐标（three 世界 x/z）。 */
export function planPointToScene(
  point: { x: number; y: number },
  frame: SceneFrameCenter,
): ScenePoint {
  // 归一 −0：中心点翻 z 会得到 -0，深比较与序列化都不喜欢它。
  const z = -(point.y - frame.cy);
  return { x: point.x - frame.cx, z: z === 0 ? 0 : z };
}

/** 场景坐标 → 规划点（ENU），用于把 scene 里量到的位置写回规划。 */
export function scenePointToPlan(
  point: ScenePoint,
  frame: SceneFrameCenter,
): { x: number; y: number } {
  return { x: point.x + frame.cx, y: -point.z + frame.cy };
}

/**
 * 漫游执行器用的是「场景平面坐标」，但只需要 x/y 两个分量：
 * 这里把规划点直接折成执行器口径（y 分量 = 场景 z），避免调用方各写一遍。
 */
export function planPointToRoam(
  point: { x: number; y: number },
  frame: SceneFrameCenter,
): { x: number; y: number } {
  const scene = planPointToScene(point, frame);
  return { x: scene.x, y: scene.z };
}
