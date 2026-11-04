/**
 * F3 拖拽落点三档：拖动物料落画布时，纯函数判定落点。
 * - 「关联摆放」：落点距已有物件中心 <= NEAR_ANCHOR_DISTANCE，自动吸附到该物件侧旁，
 *   不再落在原落点（避免重叠），并把锚点物件回传给调用方做提示。
 * - 「新放一件」：周围没有锚点，按原落点放。
 * 材质类拖到已放物件上的「换肤」档在接线层判定（需要 material-customization 入口），
 * 这里只负责几何，不碰 store。
 */

export interface DropAnchor {
  id: string;
  name: string;
  x: number;
  z: number;
  width: number;
  depth: number;
}

export interface DropPoint {
  x: number;
  z: number;
}

export const NEAR_ANCHOR_DISTANCE = 1.8;
const ANCHOR_GAP = 0.45;

/**
 * 给定原始落点与当前楼层物件，返回智能落点。
 * 找到最近锚点（按中心距），若在阈值内则沿「落点→锚心」方向把新物件推到锚点旁。
 */
export function suggestDropPoint(
  world: DropPoint,
  anchors: readonly DropAnchor[],
  itemSize: { width: number; depth: number }
): { point: DropPoint; anchor: DropAnchor | null } {
  let best: DropAnchor | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const anchor of anchors) {
    const dx = anchor.x - world.x;
    const dz = anchor.z - world.z;
    const dist = Math.hypot(dx, dz);
    if (dist < bestDist) { bestDist = dist; best = anchor; }
  }
  if (!best || bestDist > NEAR_ANCHOR_DISTANCE || bestDist < 0.001) {
    return { point: { ...world }, anchor: null };
  }
  // 推到锚点外缘：沿锚心-落点方向走 (锚深一半 + 新物深一半 + 间隙)。
  const nx = (world.x - best.x) / bestDist;
  const nz = (world.z - best.z) / bestDist;
  const push = best.depth / 2 + itemSize.depth / 2 + ANCHOR_GAP;
  return {
    point: { x: best.x + nx * push, z: best.z + nz * push },
    anchor: best,
  };
}
