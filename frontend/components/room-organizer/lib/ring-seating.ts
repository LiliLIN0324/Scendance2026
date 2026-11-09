import { FURNITURE_CATALOG } from './constants';
import { itemsOverlap, rotatedHalfExtents } from './geometry';
import type { FurnitureSet, FurnitureSetItem } from './furniture-sets';
import type { FurnitureItem, Vec2 } from './types';

export interface RingRect { x: number; z: number; w: number; d: number }

/** Square footprint of the round-table mesh. Chairs must clear this box, not a circle. */
export const RING_TABLE_SIDE_M = 1.4;
/** Eight seats is a normal banquet ring; six left a 20×15 room far short of 80. */
export const RING_SEATS = 8;
/** Air the footprints must keep. Confirm treats a touching box as overlap. */
const CLEARANCE_M = 0.05;

function ringItems(radius: number): FurnitureItem[] {
  const table = FURNITURE_CATALOG.find(entry => entry.type === 'dining-table');
  const chair = FURNITURE_CATALOG.find(entry => entry.type === 'dining-chair');
  if (!table || !chair) return [];
  const items: FurnitureItem[] = [{
    ...table,
    id: 'ring-table',
    width: RING_TABLE_SIDE_M,
    depth: RING_TABLE_SIDE_M,
    name: '圆桌',
    position: { x: 0, z: 0 },
    rotation: 0,
  }];
  for (let index = 0; index < RING_SEATS; index++) {
    const angle = -Math.PI / 2 + (2 * Math.PI * index) / RING_SEATS;
    items.push({
      ...chair,
      id: `ring-chair-${index}`,
      name: '餐椅',
      position: { x: radius * Math.cos(angle), z: radius * Math.sin(angle) },
      rotation: Math.atan2(-Math.cos(angle), -Math.sin(angle)),
    });
  }
  return items;
}

/** True when every chair box clears the table box and its neighbours, with air. */
function ringClears(radius: number): boolean {
  const items = ringItems(radius);
  const table = items[0];
  if (!table) return false;
  const fatTable: FurnitureItem = { ...table, width: table.width + CLEARANCE_M * 2, depth: table.depth + CLEARANCE_M * 2 };
  const chairs = items.slice(1);
  for (let index = 0; index < chairs.length; index++) {
    const chair = chairs[index]!;
    if (itemsOverlap(fatTable, chair)) return false;
    const fatChair: FurnitureItem = { ...chair, width: chair.width + CLEARANCE_M, depth: chair.depth + CLEARANCE_M };
    for (let other = index + 1; other < chairs.length; other++) {
      if (itemsOverlap(fatChair, chairs[other]!)) return false;
    }
  }
  return true;
}

/** Smallest radius whose chair boxes stay off the square table. Cached. */
export function ringChairRadius(): number {
  let lo = RING_TABLE_SIDE_M / 2;
  let hi = 2.2;
  if (!ringClears(hi)) return hi;
  for (let step = 0; step < 18; step++) {
    const mid = (lo + hi) / 2;
    if (ringClears(mid)) hi = mid;
    else lo = mid;
  }
  let radius = Math.ceil(hi * 100) / 100;
  while (radius < 2.4 && !ringClears(radius)) radius = Math.round((radius + 0.01) * 100) / 100;
  return radius;
}

/** Round table with chairs on one circle, facing inward. Not the 4-corner dining grid. */
export function ringDiningSet(): FurnitureSet {
  const table = FURNITURE_CATALOG.find(entry => entry.type === 'dining-table');
  const chair = FURNITURE_CATALOG.find(entry => entry.type === 'dining-chair');
  const radius = ringChairRadius();
  const items: FurnitureSetItem[] = [];
  if (table) {
    items.push({
      type: 'dining-table',
      offset: { x: 0, z: 0 },
      snapshot: { ...table, width: RING_TABLE_SIDE_M, depth: RING_TABLE_SIDE_M, name: '圆桌' },
    });
  }
  if (chair) {
    for (let index = 0; index < RING_SEATS; index++) {
      const angle = -Math.PI / 2 + (2 * Math.PI * index) / RING_SEATS;
      items.push({
        type: 'dining-chair',
        offset: { x: radius * Math.cos(angle), z: radius * Math.sin(angle) },
        rotation: Math.atan2(-Math.cos(angle), -Math.sin(angle)),
        snapshot: { ...chair, name: '餐椅' },
      });
    }
  }
  return { key: 'dining-ring', label: '圆桌围坐', icon: '🍽️', description: '圆桌围坐', items };
}

export function setFootprint(items: readonly { position?: Vec2 | undefined; width: number; depth: number; rotation?: number | undefined }[]): { halfX: number; halfZ: number } {
  let halfX = 0;
  let halfZ = 0;
  for (const item of items) {
    const { halfW, halfD } = rotatedHalfExtents({ width: item.width, depth: item.depth, rotation: item.rotation ?? 0 });
    halfX = Math.max(halfX, Math.abs(item.position?.x ?? 0) + halfW);
    halfZ = Math.max(halfZ, Math.abs(item.position?.z ?? 0) + halfD);
  }
  return { halfX, halfZ };
}

/**
 * Centres that fill the zone in rows. A single loop capped at 10 tables
 * left an 80-person room at 20 counted seats. The gap is between chair backs;
 * the north aisle band is a separate zone, so this does not reuse the 1.2 m aisle.
 */
export function ringCenters(rect: RingRect, footprint: { halfX: number; halfZ: number }, wallGap: number, aisleM: number): Vec2[] {
  // 1.2 m is the north aisle, not the gap between every table. A full 1.2 m pitch under-seats the room.
  const gap = Math.min(0.7, Math.max(0.5, aisleM > 0 && aisleM < 0.7 ? aisleM : 0.6));
  const halfX = Math.max(footprint.halfX, 0.2);
  const halfZ = Math.max(footprint.halfZ, 0.2);
  const cellX = halfX * 2 + gap;
  const cellZ = halfZ * 2 + gap;
  const usableW = rect.w - 2 * wallGap;
  const usableD = rect.d - 2 * wallGap;
  const cx = rect.x + rect.w / 2;
  const cz = rect.z + rect.d / 2;
  const cols = Math.floor((usableW + gap) / cellX);
  const rows = Math.floor((usableD + gap) / cellZ);
  if (cols < 1 || rows < 1 || usableW < halfX * 2 || usableD < halfZ * 2) return [{ x: cx, z: cz }];
  const gridW = cols * cellX - gap;
  const gridD = rows * cellZ - gap;
  const x0 = rect.x + (rect.w - gridW) / 2 + halfX;
  const z0 = rect.z + (rect.d - gridD) / 2 + halfZ;
  const slots: Vec2[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      slots.push({
        x: Math.round((x0 + col * cellX) * 100) / 100,
        z: Math.round((z0 + row * cellZ) * 100) / 100,
      });
    }
  }
  return slots;
}
