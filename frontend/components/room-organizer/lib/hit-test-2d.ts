// 2D 平面点击命中的纯几何：从已退役的 use-canvas-2d-interaction（2026-11-25 S1-c）
// 里抽出的两个导出，评审分享页 review-plan-sheet 仍在直接调用。
import { isWallMounted } from './opening-snap';
import { planDrawOrder } from './plan-order';
import type { FurnitureItem } from './types';

/** Extra hit margin (CSS px) around wall-mounted and very small items (#286):
 * a 0.2 m Wi-Fi puck or a 0.12 m-deep window is a 4–8 px target at typical
 * plan scales, so a click a few pixels off its edge should still land.
 */
export const HIT_SLOP_PX = 6;
/** Items whose shorter side is under this (m) get the slop. */
const SMALL_ITEM_MAX_SIDE_M = 0.3;

/**
 * Topmost item under a world-space point, by exact rotated-rect containment.
 * "Topmost" is the last hit in draw order — `render2DTopDown` paints
 * `planDrawOrder(floor.items)` (rugs → floor furniture → tabletop → wall,
 * #286), so this walks the same order in reverse: the sofa over a rug wins
 * the click, matching the 3D raycast. `slop` (world metres, typically
 * HIT_SLOP_PX / scale) widens the target of wall-mounted and sub-0.3 m
 * items only; large furniture keeps its exact footprint.
 */
export function hitTest2DItems(
  items: readonly FurnitureItem[],
  worldX: number,
  worldZ: number,
  slop = 0
): FurnitureItem | null {
  const ordered = planDrawOrder(items);
  for (let i = ordered.length - 1; i >= 0; i--) {
    const item = ordered[i]!;
    if (!item.position) continue;
    const dx = worldX - item.position.x;
    const dz = worldZ - item.position.z;
    const rotation = item.rotation ?? 0;
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    // Project the delta onto the item's oriented axes. Three's rotateY maps
    // local +X to (cos, −sin) in world XZ (see lib/geometry's OBB axes), so
    // the width axis is (cos, −sin) and the depth axis is (sin, cos).
    const alongWidth = dx * cos - dz * sin;
    const alongDepth = dx * sin + dz * cos;
    const margin =
      isWallMounted(item.type) || Math.min(item.width, item.depth) < SMALL_ITEM_MAX_SIDE_M ? slop : 0;
    if (Math.abs(alongWidth) <= item.width / 2 + margin && Math.abs(alongDepth) <= item.depth / 2 + margin) {
      return item;
    }
  }
  return null;
}
