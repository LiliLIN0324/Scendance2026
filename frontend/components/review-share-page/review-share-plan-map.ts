import { planBounds } from '../room-organizer/lib/plan-export/plan-geometry';
import {
  DEFAULT_SVG_MARGIN,
  DEFAULT_SVG_PX_PER_METRE,
  planSheetSize,
} from '../room-organizer/lib/plan-export/svg';
import type { FloorLayout, FurnitureItem, RoomLayout } from '../room-organizer/lib/types';

export interface PlanSheetMap {
  sheetWidth: number;
  sheetHeight: number;
  rootX: number;
  rootY: number;
  margin: number;
  scale: number;
  layoutWidth: number;
  layoutHeight: number;
}

export function createPlanSheetMap(layout: RoomLayout, floor: FloorLayout): PlanSheetMap {
  const scale = DEFAULT_SVG_PX_PER_METRE;
  const margin = DEFAULT_SVG_MARGIN;
  const bounds = planBounds(layout, floor, margin / scale);
  const sheet = planSheetSize(layout, floor);
  const rootX = (-layout.width / 2 - bounds.minX) * scale - margin;
  const rootY = (-layout.height / 2 - bounds.minZ) * scale - margin;
  return {
    sheetWidth: sheet.widthPx,
    sheetHeight: sheet.heightPx,
    rootX,
    rootY,
    margin,
    scale,
    layoutWidth: layout.width,
    layoutHeight: layout.height,
  };
}

/** 世界坐标 (x/z，场地中心为原点) → SVG 整张 sheet 上的像素。 */
export function sheetPixelFromWorld(map: PlanSheetMap, x: number, z: number): { x: number; y: number } {
  const roomPx = map.margin + (x + map.layoutWidth / 2) * map.scale;
  const roomPy = map.margin + (z + map.layoutHeight / 2) * map.scale;
  return { x: roomPx + map.rootX, y: roomPy + map.rootY };
}

/** sheet 像素 → 世界 x/z。 */
export function worldFromSheetPixel(map: PlanSheetMap, sheetX: number, sheetY: number): { x: number; z: number } {
  const roomPx = sheetX - map.rootX;
  const roomPy = sheetY - map.rootY;
  return {
    x: roomPx / map.scale - map.layoutWidth / 2,
    z: roomPy / map.scale - map.layoutHeight / 2,
  };
}

export function hitPlacedItem(
  items: readonly FurnitureItem[],
  x: number,
  z: number,
): FurnitureItem | null {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]!;
    if (!item.position) continue;
    const halfW = item.width / 2;
    const halfD = item.depth / 2;
    const dx = x - item.x;
    const dz = z - item.z;
    if (Math.abs(dx) <= halfW && Math.abs(dz) <= halfD) return item;
  }
  return null;
}

export function pinPercent(map: PlanSheetMap, x: number, z: number): { left: string; top: string } {
  const point = sheetPixelFromWorld(map, x, z);
  return {
    left: `${(point.x / map.sheetWidth) * 100}%`,
    top: `${(point.y / map.sheetHeight) * 100}%`,
  };
}
