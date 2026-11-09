/**
 * 坐具判定（漫游）：走到椅子 / 沙发 / 长凳边上时，给出「可以坐」的目标与坐面高度。
 * 只认人坐得上去的类型；桌子、柜子、绿植、地毯都不参与。
 * 与 `walk-collision` 用同一套旋转矩形约定，保证「贴住坐具」和「被它挡住」说的是同一个盒子。
 */
import type { FurnitureItem } from './types';

/** 可坐类型：椅子、餐椅、扶手椅、长凳、沙发、户外长椅。 */
export const SEAT_TYPES: ReadonlySet<string> = new Set([
  'chair',
  'dining-chair',
  'armchair',
  'bench',
  'sofa',
  'garden-bench',
]);

/**
 * 站到坐具边缘外这么近就可以坐（米）。漫游的碰撞半径是 0.3，
 * 人已经被推在坐具边上，留一点余量给「斜着靠近」的情况。
 */
const SEAT_REACH = 0.55;

/** 坐姿眼高 = 坐面 + 这么多（米），比站着的 1.6 低一截。 */
const SEATED_EYE_OFFSET = 0.63;

export interface SeatTarget {
  id: string;
  name: string;
  /** 坐下后人的落点（坐具中心，XZ 米）。 */
  x: number;
  z: number;
  /** 坐面高度（米，从楼层地面起算）。 */
  seatHeight: number;
  /** 坐下后的相机眼高。 */
  eyeY: number;
}

/** 坐面高度：按坐具常识值取，再用模型自身高度收一下，避免异常模型坐进地里或悬空。 */
export function seatSurfaceHeight(item: FurnitureItem): number {
  const cushioned = item.type === 'sofa' || item.type === 'armchair';
  const base = cushioned ? 0.42 : 0.45;
  return Math.max(0.28, Math.min(base, item.height * 0.55));
}

/**
 * 离 `point` 最近的一件可坐坐具；不在 `SEAT_REACH` 内返回 null。
 * 地面高度由调用方加（多层场景的楼层标高）。
 */
export function findSeat(
  items: readonly FurnitureItem[],
  point: Readonly<{ x: number; z: number }>,
  floorY = 0
): SeatTarget | null {
  let best: SeatTarget | null = null;
  let bestGap = SEAT_REACH;
  for (const item of items) {
    if (!item.position) continue;
    if (!SEAT_TYPES.has(item.type)) continue;
    if (item.height <= 0.2) continue;
    const gap = footprintGap(item, point);
    if (gap > bestGap) continue;
    bestGap = gap;
    const seatHeight = seatSurfaceHeight(item);
    best = {
      id: item.id,
      name: item.name,
      x: item.position.x,
      z: item.position.z,
      seatHeight,
      eyeY: floorY + seatHeight + SEATED_EYE_OFFSET,
    };
  }
  return best;
}

/** 点到坐具水平投影的间距（0 = 已经贴在盒子上），与 `walkerClearanceAt` 同口径。 */
function footprintGap(item: FurnitureItem, point: Readonly<{ x: number; z: number }>): number {
  const position = item.position;
  if (!position) return Infinity;
  const rotation = item.rotation ?? 0;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const dx = point.x - position.x;
  const dz = point.z - position.z;
  const lx = dx * cos - dz * sin;
  const lz = dx * sin + dz * cos;
  const gapX = Math.max(Math.abs(lx) - item.width / 2, 0);
  const gapZ = Math.max(Math.abs(lz) - item.depth / 2, 0);
  return Math.hypot(gapX, gapZ);
}
