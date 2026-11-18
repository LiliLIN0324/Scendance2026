/**
 * 第三人称 / 过肩相机的设施防穿（纯函数，零 three 依赖）。
 *
 * 人在场地里走时，机位沿朝向后拉 4 m（过肩 1.5 m）。如果正后方是一顶帐篷，
 * 相机就会钻进帐篷里，看到内壁或黑面。这里不解碰撞、不改相机朝向，只回答
 * 一个问题：**沿着这条后拉射线，最多能拉多远还不进盒子**。
 *
 * 判定用 2D 射线对 OBB 的 slab 求交，盒子按相机半径外扩，和
 * `resolveWalkerStep` 的推挤口径一致（x 东、z = −北）。
 */
import type { WalkCollider } from './walk-collision';

/** 相机贴上盒子表面的余量（米）：留一点，避免正好卡在面上闪烁。 */
const SURFACE_SKIN_M = 0.02;

export interface CameraRay {
  x: number;
  z: number;
}

/**
 * 射线进入一个外扩盒子前表面的距离；不命中返回 `Infinity`，起点已在盒内返回 `0`。
 *
 * 导出供视线检查（`lib/walk-sightline.ts`）复用同一套 slab 求交，免得两处
 * 对“什么叫被挡住”各写一份判定。
 */
export function rayBoxEntry(box: WalkCollider, from: CameraRay, dir: CameraRay, pad: number): number {
  const ox = from.x - box.cx;
  const oz = from.z - box.cz;
  // 转到盒子局部轴
  const localX = ox * box.ax + oz * box.az;
  const localZ = ox * box.bx + oz * box.bz;
  const dirX = dir.x * box.ax + dir.z * box.az;
  const dirZ = dir.x * box.bx + dir.z * box.bz;
  const halfW = box.hw + pad;
  const halfD = box.hd + pad;
  if (Math.abs(localX) <= halfW && Math.abs(localZ) <= halfD) return 0;

  let tMin = -Infinity;
  let tMax = Infinity;
  if (Math.abs(dirX) < 1e-9) {
    if (Math.abs(localX) > halfW) return Infinity;
  } else {
    const t1 = (-halfW - localX) / dirX;
    const t2 = (halfW - localX) / dirX;
    tMin = Math.max(tMin, Math.min(t1, t2));
    tMax = Math.min(tMax, Math.max(t1, t2));
  }
  if (Math.abs(dirZ) < 1e-9) {
    if (Math.abs(localZ) > halfD) return Infinity;
  } else {
    const t1 = (-halfD - localZ) / dirZ;
    const t2 = (halfD - localZ) / dirZ;
    tMin = Math.max(tMin, Math.min(t1, t2));
    tMax = Math.min(tMax, Math.max(t1, t2));
  }
  if (tMin > tMax || tMax < 0) return Infinity;
  return Math.max(0, tMin);
}

/**
 * 机位最多能沿 `dir` 拉多远。
 *
 * @param colliders 玩家世界系设施盒（`planPlayerColliders` 的产物）
 * @param from 玩家锚点（地面平面 x/z；眼高不参与，盒子是 2D 的）
 * @param dir 单位方向（后拉方向）
 * @param distance 档位想要的后拉距离
 * @param radius 相机半径（米）：比人头略小，够防止镜头贴进内壁
 */
export function clearCameraDistance(
  colliders: readonly WalkCollider[],
  from: CameraRay,
  dir: CameraRay,
  distance: number,
  radius: number
): number {
  if (!Number.isFinite(distance) || distance <= 0) return Math.max(0, distance || 0);
  const length = Math.hypot(dir.x, dir.z);
  if (colliders.length === 0 || length < 1e-9) return distance;
  const unit: CameraRay = { x: dir.x / length, z: dir.z / length };
  let limit = distance;
  for (const box of colliders) {
    const entry = rayBoxEntry(box, from, unit, radius);
    if (!Number.isFinite(entry)) continue;
    const allowed = entry - SURFACE_SKIN_M;
    if (allowed < limit) limit = allowed;
  }
  return Math.max(0, Math.min(distance, limit));
}
