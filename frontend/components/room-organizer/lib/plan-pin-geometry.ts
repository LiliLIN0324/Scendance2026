/**
 * 平面落钉的坐标。和 `layoutToSvg` 同一张纸：
 * 世界坐标（场地中心为原点，米）↔ 图纸上的 0–1 比例。
 */
import { planBounds } from './plan-export/plan-geometry';
import { DEFAULT_SVG_MARGIN, DEFAULT_SVG_PX_PER_METRE, planSheetSize } from './plan-export/svg';
import type { FloorLayout, RoomLayout } from './types';

export interface SheetFraction {
  x: number;
  y: number;
}

export interface PlanWorldPoint {
  x: number;
  z: number;
}

function sheetFrame(layout: RoomLayout, floor: FloorLayout): {
  scale: number;
  bounds: { minX: number; minZ: number };
  widthPx: number;
  heightPx: number;
} | null {
  const scale = DEFAULT_SVG_PX_PER_METRE;
  const bounds = planBounds(layout, floor, DEFAULT_SVG_MARGIN / scale);
  const sheet = planSheetSize(layout, floor);
  if (sheet.widthPx <= 0 || sheet.heightPx <= 0) return null;
  return { scale, bounds, widthPx: sheet.widthPx, heightPx: sheet.heightPx };
}

export function sheetFractionToWorld(
  layout: RoomLayout,
  floor: FloorLayout,
  fraction: SheetFraction,
): PlanWorldPoint | null {
  if (!Number.isFinite(fraction.x) || !Number.isFinite(fraction.y)) return null;
  if (fraction.x < 0 || fraction.y < 0 || fraction.x > 1 || fraction.y > 1) return null;
  const frame = sheetFrame(layout, floor);
  if (!frame) return null;
  return {
    x: (fraction.x * frame.widthPx) / frame.scale + frame.bounds.minX,
    z: (fraction.y * frame.heightPx) / frame.scale + frame.bounds.minZ,
  };
}

export function worldToSheetFraction(
  layout: RoomLayout,
  floor: FloorLayout,
  point: PlanWorldPoint,
): SheetFraction | null {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.z)) return null;
  const frame = sheetFrame(layout, floor);
  if (!frame) return null;
  return {
    x: ((point.x - frame.bounds.minX) * frame.scale) / frame.widthPx,
    y: ((point.z - frame.bounds.minZ) * frame.scale) / frame.heightPx,
  };
}

/** 点在场地矩形里（含一点边）。物料可以略出界，落钉仍认那件。 */
export function pointInRoom(
  layout: { width: number; height: number },
  point: PlanWorldPoint,
  slack = 0.05,
): boolean {
  if (!Number.isFinite(layout.width) || !Number.isFinite(layout.height)) return false;
  return point.x >= -layout.width / 2 - slack
    && point.x <= layout.width / 2 + slack
    && point.z >= -layout.height / 2 - slack
    && point.z <= layout.height / 2 + slack;
}

export interface PlanHitItem {
  id: string;
  name: string;
  width: number;
  depth: number;
  position?: { x: number; z: number } | undefined;
  rotation?: number | undefined;
}

/** 点落在哪一件的占地里。后画的盖住先画的。没有就 null（地面）。 */
export function hitPlanItem(items: readonly PlanHitItem[], x: number, z: number): PlanHitItem | null {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
  let found: PlanHitItem | null = null;
  for (const item of items) {
    const position = item.position;
    if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.z)) continue;
    if (!Number.isFinite(item.width) || !Number.isFinite(item.depth) || item.width <= 0 || item.depth <= 0) continue;
    const rotation = item.rotation ?? 0;
    const dx = x - position.x;
    const dz = z - position.z;
    const cos = Math.cos(-rotation);
    const sin = Math.sin(-rotation);
    const localX = dx * cos - dz * sin;
    const localZ = dx * sin + dz * cos;
    if (Math.abs(localX) <= item.width / 2 && Math.abs(localZ) <= item.depth / 2) found = item;
  }
  return found;
}
