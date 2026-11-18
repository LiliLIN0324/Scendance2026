/**
 * 视线检查（纯函数，零 three 依赖）。
 *
 * 主办方常问"站在入口能不能看见舞台"。漫游里可以走过去抬头看，但没法给结论；
 * 这里沿"人眼 → 目标"的平面连线做一次射线求交，回答两件事：有没有设施挡在中间、
 * 最近的一件离观察点多远。
 *
 * 复用 `walk-camera-clearance` 的 slab 求交（同一套 OBB 口径），盒子仍来自
 * `planPlayerColliders` 的世界系产物。
 *
 * 已知边界：**只做水平 2D**，不区分高度——野餐桌和 4 m 舞台一样会被算成遮挡。
 * 所以结论按"可能遮挡"呈现，由人确认；真正要按高度判定，得先给设施补一份高度表。
 */
import { rayBoxEntry } from './walk-camera-clearance';
import type { WalkCollider } from './walk-collision';

export interface SightPoint {
  x: number;
  z: number;
}

export interface SightlineHit {
  blocked: boolean;
  /** 从观察点到最近遮挡物的距离（米）；没挡住为 `Infinity`。 */
  distanceM: number;
  /** 遮挡发生在整条视线的哪个比例（0 = 紧贴观察点，1 = 目标点）。 */
  ratio: number;
  /** 最近遮挡物在传入数组里的下标。 */
  blockerIndex: number | null;
}

/**
 * 从 `from` 看向 `to`，第一条挡住视线的盒子。
 *
 * @param radius 观察者/目标的横向容差（米）。0 是"正中心一点"，普通检查用 0
 *   就够；想留一点余量可传 0.15（半个肩宽）。
 */
export function sightlineHit(
  colliders: readonly WalkCollider[],
  from: SightPoint,
  to: SightPoint,
  radius = 0
): SightlineHit {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const length = Math.hypot(dx, dz);
  if (length < 1e-6) return { blocked: false, distanceM: Infinity, ratio: 0, blockerIndex: null };
  const dir = { x: dx / length, z: dz / length };
  let best = Infinity;
  let bestIndex: number | null = null;
  for (let i = 0; i < colliders.length; i++) {
    const entry = rayBoxEntry(colliders[i]!, from, dir, radius);
    if (!Number.isFinite(entry)) continue;
    if (entry >= length) continue; // 目标点之后的不算挡
    if (entry < best) {
      best = entry;
      bestIndex = i;
    }
  }
  if (bestIndex === null) {
    return { blocked: false, distanceM: Infinity, ratio: 0, blockerIndex: null };
  }
  return {
    blocked: true,
    distanceM: best,
    ratio: length > 0 ? best / length : 0,
    blockerIndex: bestIndex,
  };
}

/** 一句话结论（HUD / 面板用）。 */
export function describeSightline(hit: SightlineHit, fromLabel: string, toLabel: string): string {
  if (!hit.blocked) return `${fromLabel} → ${toLabel}：视线通畅`;
  return `${fromLabel} → ${toLabel}：被挡（最近 ${hit.distanceM.toFixed(1)} m，占视线 ${Math.round(hit.ratio * 100)}%）`;
}
