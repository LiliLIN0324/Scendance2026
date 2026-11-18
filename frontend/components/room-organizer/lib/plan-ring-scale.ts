/**
 * 分区 / 用地红线的「整体缩放」（2026-11-18 用户指令）：
 * 「这个里面的分区和外面的用地红线，我希望也有缩放功能，而不只是点的编辑挪动」。
 *
 * 口径：
 * - 缩放以**外接矩形的对角**为锚点：拖 NE 角时 SW 角钉住不动，只有对边/对面朝指针走。
 *   这样一块矩形分区缩完仍是矩形，斜边多边形缩完仍是同一形状（只是整体按 x/y 拉伸）。
 * - 自由缩放（默认）= x/y 各自按指针比例；等比（按住 Shift）= 沿对角线投影出一个系数，
 *   形状绝不走样。两条都由 `scaleRingToCorner` 出口，界面只切 `uniform`。
 * - 不允许「拖过锚点」把环翻成镜像：翻面会改绕向，命中测试（点在环内）与相邻关系都会跟着变，
 *   用户只是想把框拖小一点时不该悄悄镜像。所以系数夹到正数下限。
 * - 最小边长 `minSpanM` 兜底：缩到很小就停住，剩下的由面积校验（`checkBoundaryRing` /
 *   `zoneEditBlockingIssue`）继续拦，绝不在这里静默产出退化环。
 *
 * 纯几何，不碰画布：像素偏移与命中在 `outdoor-plan-canvas` 的 `ringScaleHandlePoints`。
 */

import type { PlanPoint } from '../../../../supabase/functions/_shared/site-plan';
import { PLAN_MIN_VERTEX_GAP_M } from './site-plan-editing';

/** 环的外接矩形（plan 米制；ENU x 东、y 北）。 */
export interface RingBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** 缩放柄方块边长（CSS px）。比顶点圆点大一号，一眼分得出「整体」与「单点」。 */
export const RING_SCALE_HANDLE_SIZE_PX = 9;
/** 缩放柄沿对角外移的距离（CSS px）：矩形分区的角顶点正落在外接矩形角上，不外移就会和顶点手柄抢。 */
export const RING_SCALE_HANDLE_OFFSET_PX = 13;
/** 缩放柄命中半径（CSS px）：比方块大一圈，好点中。 */
export const RING_SCALE_HANDLE_HIT_PX = 12;

/** 环的外接矩形；少于 3 点（还不成形）返回 null。 */
export function ringBounds(ring: readonly PlanPoint[]): RingBounds | null {
  if (ring.length < 3) return null;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const p of ring) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

/** 外接矩形的米制尺寸（界面读「宽 × 深」用）。 */
export function ringBoundsSize(bounds: RingBounds): { widthM: number; heightM: number } {
  return { widthM: bounds.maxX - bounds.minX, heightM: bounds.maxY - bounds.minY };
}

/** 外接矩形中心（plan 米制）。 */
export function ringBoundsCenter(bounds: RingBounds): PlanPoint {
  return { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };
}

/** 外接矩形四角，顺序与组选/设施手柄一致：0=NW 1=NE 2=SE 3=SW。 */
export function ringScaleCorners(bounds: RingBounds): PlanPoint[] {
  return [
    { x: bounds.minX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.maxY },
    { x: bounds.minX, y: bounds.maxY },
  ];
}

/** 拖某个角时的锚点 = 对角（0↔2、1↔3）。 */
export function ringScaleAnchor(bounds: RingBounds, corner: number): PlanPoint {
  const corners = ringScaleCorners(bounds);
  return corners[(corner + 2) % 4]!;
}

export interface RingScaleOptions {
  /** true = 等比（沿对角线投影，形状不变形）；false/缺省 = x/y 各自按指针（自由缩放）。 */
  uniform?: boolean;
  /** 缩放后外接矩形的最小边长（米）。缺省 `PLAN_MIN_VERTEX_GAP_M`（0.5 m）。 */
  minSpanM?: number;
}

/**
 * 把环按「拖第 `corner` 个角到 `target`」重算一遍。
 *
 * @param ring   原始环（松手前的已提交形状，不是上一帧预览——否则误差会累积）
 * @param bounds 原始环的外接矩形（由 `ringBounds` 得来，调用方缓存一份避免每帧重算）
 * @param corner 被拖的角序号 0=NW 1=NE 2=SE 3=SW
 * @param target 指针位置（plan 米制），通常已经过网格吸附
 */
export function scaleRingToCorner(
  ring: readonly PlanPoint[],
  bounds: RingBounds,
  corner: number,
  target: PlanPoint,
  opts: RingScaleOptions = {},
): PlanPoint[] | null {
  if (ring.length < 3) return null;
  if (corner < 0 || corner > 3) return null;
  if (!Number.isFinite(target.x) || !Number.isFinite(target.y)) return null;

  const start = ringScaleCorners(bounds)[corner]!;
  const anchor = ringScaleAnchor(bounds, corner);
  const dx = start.x - anchor.x;
  const dy = start.y - anchor.y;
  const spanX = Math.abs(dx);
  const spanY = Math.abs(dy);
  const minSpan = Math.max(0.05, opts.minSpanM ?? PLAN_MIN_VERTEX_GAP_M);
  // 外接矩形某一边为 0（一条直线的环）：那个方向没有可用比例，保持 1，绝不产生 NaN/Infinity。
  const minScaleX = spanX > 1e-9 ? minSpan / spanX : 1;
  const minScaleY = spanY > 1e-9 ? minSpan / spanY : 1;

  let scaleX = spanX > 1e-9 ? (target.x - anchor.x) / dx : 1;
  let scaleY = spanY > 1e-9 ? (target.y - anchor.y) / dy : 1;

  if (opts.uniform) {
    const diag = spanX * spanX + spanY * spanY;
    const projected = diag > 1e-12
      ? ((target.x - anchor.x) * dx + (target.y - anchor.y) * dy) / diag
      : 1;
    // 等比就真的等比：两轴共用一个系数，下限取两轴里更严的那一档。
    const minUniform = Math.max(minScaleX, minScaleY);
    scaleX = Math.max(minUniform, projected);
    scaleY = scaleX;
  } else {
    scaleX = Math.max(minScaleX, scaleX);
    scaleY = Math.max(minScaleY, scaleY);
  }

  return ring.map(p => ({
    x: anchor.x + (p.x - anchor.x) * scaleX,
    y: anchor.y + (p.y - anchor.y) * scaleY,
  }));
}
