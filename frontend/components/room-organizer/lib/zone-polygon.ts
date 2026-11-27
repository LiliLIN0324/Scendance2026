/**
 * D5-1 分区多边形纯函数（plan ENU 米制，环点 { x, y }）。
 *
 * 过渡状态（2026-11-27 档3）：本模块与 `zones.ts` 的矩形辅助并列存在；矩形版
 * `isZoneRect/zoneFromCorners/clampZoneRect/zoneContains/itemsInZone/zoneArea/zoneStats/sameZone`
 * 保留到 D5-2 写入侧、D5-3 消费侧切换完成后再退役，本批不删不改。
 *
 * 坐标帧口径：
 * - 本模块只认 plan 环点 `{ x, y }`（x 东、y 北）；layout 房间中心帧的 `{ x, z }`
 *   与 plan 帧 `{ x, y }` 的轴映射属于适配层职责，本模块不做帧反解、不反解矩形。
 * - 几何算法全部复用现役 plan 原语（`site-plan-editing.ts` / 契约 `planRingAreaM2` /
 *   `plan-ring-scale.ts`），不在本层另立射线法、鞋带公式或外接矩形算法。
 */

import { planRingAreaM2, type PlanPoint } from '../../../../supabase/functions/_shared/site-plan';
import { ringBounds, type RingBounds } from './plan-ring-scale';
import {
  PLAN_MIN_ZONE_AREA_M2,
  checkPlanRing,
  planPointInRing,
  planRingsOverlap,
  type PlanEditIssue,
} from './site-plan-editing';

/** 矩形（plan 帧）：x/y 为角点，w/h 为米制边长。角点排列顺序由 `rectToRing` 固定。 */
export interface ZoneRingRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 环上的可归属物件：按中心点判定；未摆放（无 position）不计入。价格口径与矩形版一致（缺省 0）。 */
export interface RingPlacedItem {
  id: string;
  price?: number;
  position?: PlanPoint;
}

/**
 * 矩形四角展成 plan 环。顶点顺序与户外模板工厂一致：
 * `(x,y) → (x+w,y) → (x+w,y+h) → (x,y+h)`；不回写首点（契约 `planRingSchema`
 * 同样不存闭合首点，闭合由消费方补）。
 *
 * 非有限坐标或边长 ≤ 0 视为退化矩形，返回 `null`（与 `zoneFromCorners` 拒绝薄片同口径）。
 */
export function rectToRing(rect: ZoneRingRect): PlanPoint[] | null {
  const { x, y, w, h } = rect;
  if (
    !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(w) || !Number.isFinite(h)
    || w <= 0 || h <= 0
  ) {
    return null;
  }
  return [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ];
}

/**
 * 点是否在环内：边界上视为在内（与矩形版 `zoneContains` 的 inclusive 边口径对齐）。
 * 复用 `planPointInRing`（射线法 + 边界 epsilon）。环不足 3 点时返回 false。
 */
export function zoneContainsRing(ring: readonly PlanPoint[], point: PlanPoint): boolean {
  if (ring.length < 3) return false;
  return planPointInRing(point, ring);
}

/** 物件归属：按中心点；未摆放物件不计入。返回环内物件原数组引用顺序。 */
export function itemsInZoneRing<T extends RingPlacedItem>(
  ring: readonly PlanPoint[],
  items: readonly T[],
): T[] {
  return items.filter((item) => item.position !== undefined && zoneContainsRing(ring, item.position));
}

/** 环面积（m²，鞋带公式，复用契约 `planRingAreaM2`；未闭合按闭合处理）。 */
export function ringArea(ring: readonly PlanPoint[]): number {
  return planRingAreaM2(ring);
}

/** 环内统计：件数、价格合计（缺省 0）、面积。口径与矩形版 `zoneStats` 对齐。 */
export function ringStats<T extends RingPlacedItem>(
  ring: readonly PlanPoint[],
  items: readonly T[],
): { itemCount: number; cost: number; area: number } {
  const inside = itemsInZoneRing(ring, items);
  return {
    itemCount: inside.length,
    cost: inside.reduce((sum, item) => sum + (item.price ?? 0), 0),
    area: ringArea(ring),
  };
}

/**
 * 两环是否有面积交集：共边、共享顶点、贴边触碰都不算重叠（复用 `planRingsOverlap`
 * 的严格内部口径）。与矩形版「中心点落在对方矩形内」的归属口径不同，此处判环间重叠。
 */
export function ringsOverlap(a: readonly PlanPoint[], b: readonly PlanPoint[]): boolean {
  return planRingsOverlap(a, b);
}

/** 分区环基础校验：顶点数、相邻重合、自交、面积下限；复用 `checkPlanRing`。 */
export function checkZoneRing(
  ring: readonly PlanPoint[],
): { ok: true; areaM2: number } | { ok: false; issue: PlanEditIssue } {
  return checkPlanRing(ring, PLAN_MIN_ZONE_AREA_M2, '分区');
}

/** 环外接矩形（复用 `ringBounds`）；不足 3 点或坐标非有限返回 null。 */
export function zoneRingBounds(ring: readonly PlanPoint[]): RingBounds | null {
  return ringBounds(ring);
}
