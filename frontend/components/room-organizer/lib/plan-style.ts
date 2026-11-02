import type { FurnitureItem } from './types';

/**
 * 平面图按人眼高度水平切开（建筑平面常用 1.2–1.5m）。
 * 切面以上的墙、高柜、隔断被剖到，画成灰色实体；矮桌椅在切面以下，
 * 画成浅色轮廓，像从上方看下去的一张平面图。
 */
export const PLAN_SECTION_HEIGHT_M = 1.5;

/** 贴在墙面上、不参与房间体积剖切的物件。 */
const WALL_PLANE_TYPES = new Set(['door', 'window', 'painting', 'mirror', 'wall-clock', 'curtains']);

export function isPlanCut(item: Pick<FurnitureItem, 'type' | 'height' | 'elevation'>): boolean {
  if (WALL_PLANE_TYPES.has(item.type)) return false;
  const base = item.elevation ?? 0;
  return base < PLAN_SECTION_HEIGHT_M && base + item.height > PLAN_SECTION_HEIGHT_M;
}

export type PlanSymbol =
  | 'seat' | 'sofa' | 'table' | 'bed' | 'rug' | 'plant'
  | 'storage' | 'equipment' | 'opening' | 'person' | 'stairs' | 'none';

const SEATS = new Set(['chair', 'dining-chair', 'armchair', 'bench', 'seating', 'stool', 'bar-stool', 'garden-bench', 'folding-chair']);
const SOFAS = new Set(['sofa', 'couch', 'sectional', 'L-shape', 'U-shape']);
const TABLES = new Set(['table', 'dining-table', 'coffee-table', 'side-table', 'desk', 'picnic-table', 'counter', 'bar-counter', 'reception', 'reception-desk', 'console']);
const BEDS = new Set(['bed', 'double-bed', 'single-bed', 'bunk-bed', 'daybed']);
const RUGS = new Set(['rug', 'carpet', 'mat']);
const PLANTS = new Set(['plant', 'flowerpot', 'vase', 'tree', 'planter', 'planter-box']);
const STORAGE = new Set(['wardrobe', 'bookshelf', 'cabinet', 'dresser', 'nightstand', 'fridge', 'shelf', 'locker', 'crate', 'storage', 'bookcase']);
const EQUIPMENT = new Set(['wifi', 'router', 'cctv', 'security-camera', 'computer', 'tv', 'lamp', 'floor-lamp', 'lighting', 'speaker', 'projector', 'screen', 'socket', 'camera', 'monitor', 'microphone', 'mixer']);
const OPENINGS = new Set(['door', 'window', 'opening']);
const PEOPLE = new Set(['person', 'pet', 'crowd', 'guest']);

export function planSymbol(item: Pick<FurnitureItem, 'type' | 'category'>): PlanSymbol {
  const type = String(item.type);
  if (type === 'stairs') return 'stairs';
  if (SEATS.has(type)) return 'seat';
  if (SOFAS.has(type)) return 'sofa';
  if (TABLES.has(type)) return 'table';
  if (BEDS.has(type)) return 'bed';
  if (RUGS.has(type)) return 'rug';
  if (PLANTS.has(type)) return 'plant';
  if (STORAGE.has(type)) return 'storage';
  if (EQUIPMENT.has(type)) return 'equipment';
  if (OPENINGS.has(type)) return 'opening';
  if (PEOPLE.has(type)) return 'person';
  switch (item.category) {
    case 'seating': return 'seat';
    case 'tables': return 'table';
    case 'av':
    case 'electronics':
    case 'security': return 'equipment';
    case 'logistics':
    case 'storage': return 'storage';
    default: return 'none';
  }
}
