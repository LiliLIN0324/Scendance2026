/**
 * 判据执行器的几何底座（2026-11-18）。
 *
 * 全部是纯函数，不做栅格化：只算轴对齐外接框之间的**正交净距**与面积/长度。
 * 口径来自 `activity-space-norms-2026-11-05.md` §0.2：
 * 净距 = 两个 footprint 之间最小连续空格数，沿正交方向测，不用欧氏距离。
 */

import type { LayoutFacility, Point, Rect } from './types';

/** 把 0/90/180/270 的旋转折进外接框：90/270 时宽深互换。 */
export function facilityRect(facility: LayoutFacility): Rect {
  const quarter = Math.round(((facility.rotationDeg % 180) + 180) % 180 / 90); // 0 或 1
  const swap = quarter === 1;
  const width = swap ? facility.size.depth : facility.size.width;
  const depth = swap ? facility.size.width : facility.size.depth;
  const { x, y } = facility.position;
  return { minX: x - width / 2, maxX: x + width / 2, minY: y - depth / 2, maxY: y + depth / 2 };
}

export function ringRect(points: Point[]): Rect {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

export function rectArea(rect: Rect): number {
  return Math.max(0, rect.maxX - rect.minX) * Math.max(0, rect.maxY - rect.minY);
}

/**
 * 正交净距（米）。
 * - 两框重叠或相切 → 0；
 * - 仅 x 向分开 → x 间距；仅 y 向分开 → y 间距；
 * - 斜向分开 → max(dx, dy)（必须先让开较大的那个偏移）。
 */
export function rectGap(a: Rect, b: Rect): number {
  const dx = Math.max(0, Math.max(a.minX, b.minX) - Math.min(a.maxX, b.maxX));
  const dy = Math.max(0, Math.max(a.minY, b.minY) - Math.min(a.maxY, b.maxY));
  return Math.max(dx, dy);
}

/** 真重叠（排除仅相切）：两个方向都严格交叠。 */
export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY;
}

/** 两框在 y 向是否有交集（判断「左右相邻」）。 */
export function overlapY(a: Rect, b: Rect): boolean {
  return a.minY < b.maxY && b.minY < a.maxY;
}

/** 两框在 x 向是否有交集（判断「上下相邻」）。 */
export function overlapX(a: Rect, b: Rect): boolean {
  return a.minX < b.maxX && b.minX < a.maxX;
}

/** 多边形面积（鞋带公式，绝对值）。 */
export function ringArea(points: Point[]): number {
  if (points.length < 3) return 0;
  let sum = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    sum += current.x * next.y - next.x * current.y;
  }
  return Math.abs(sum) / 2;
}

/** 点到矩形的最短距离（正交），用于「物件到水域/入口」这类单向距离。 */
export function pointRectDistance(point: Point, rect: Rect): number {
  const dx = Math.max(rect.minX - point.x, 0, point.x - rect.maxX);
  const dy = Math.max(rect.minY - point.y, 0, point.y - rect.maxY);
  return Math.max(dx, dy);
}

/** 米→格（保守取整），用于把实测值与判据阈值放在同一单位上比较。 */
export function toCells(meters: number, rounding: 'ceil' | 'floor' = 'ceil'): number {
  return rounding === 'floor' ? Math.floor(meters) : Math.ceil(meters);
}

export function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
