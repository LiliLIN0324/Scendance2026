import { FURNITURE_CATALOG } from './constants';
import { rotatedHalfExtents } from './geometry';
import type { FurnitureSet, FurnitureSetItem, SetItemSnapshot } from './furniture-sets';
import { DEFAULT_ROUND_DIAMETER_M, rectSeatLayout, roundSeatLayout } from './table-seat-plan';
import type { Vec2 } from './types';

export interface RingRect { x: number; z: number; w: number; d: number }

/**
 * Side of the round table's collision square. The mesh is a cylinder of this
 * diameter, so chairs must clear the box (confirm treats a touching box as
 * overlap) and therefore also clear the disc.
 */
export const RING_TABLE_SIDE_M = DEFAULT_ROUND_DIAMETER_M;
/** Seats the default 1.4 m round table can clear. Derived, not a fixed 8. */
export const RING_SEATS = roundSeatLayout(RING_TABLE_SIDE_M).seats;

function roundTableSnapshot(sideM: number): SetItemSnapshot | undefined {
  const table = FURNITURE_CATALOG.find(entry => entry.name === '圆桌' && entry.tableShape === 'round')
    ?? FURNITURE_CATALOG.find(entry => entry.type === 'dining-table');
  if (!table) return undefined;
  return { ...table, width: sideM, depth: sideM, name: '圆桌', tableShape: 'round' };
}

function diningChair() {
  return FURNITURE_CATALOG.find(entry => entry.type === 'dining-chair');
}

/** Smallest radius whose chair boxes stay off this round table's collision square. */
export function ringChairRadius(sideM = RING_TABLE_SIDE_M): number {
  return roundSeatLayout(sideM).radius;
}

/** Round table with as many chairs as the diameter can clear. */
export function ringDiningSet(spec?: { sideM?: number }): FurnitureSet {
  const side = spec?.sideM && spec.sideM > 0 ? spec.sideM : RING_TABLE_SIDE_M;
  const table = roundTableSnapshot(side);
  const chair = diningChair();
  const layout = roundSeatLayout(side);
  const items: FurnitureSetItem[] = [];
  if (table) {
    items.push({ type: 'dining-table', offset: { x: 0, z: 0 }, snapshot: table });
  }
  if (chair) {
    for (const place of layout.chairs) {
      items.push({
        type: 'dining-chair',
        offset: { x: place.x, z: place.z },
        rotation: place.rotation,
        snapshot: { ...chair, name: '餐椅' },
      });
    }
  }
  return { key: 'dining-ring', label: '圆桌围坐', icon: '🍽️', description: '圆桌围坐', items };
}

/** Rectangular banquet table. Seat count follows the length and width. */
export function rectDiningSet(size: { width: number; depth: number }): FurnitureSet {
  const catalog = FURNITURE_CATALOG.find(entry => entry.type === 'dining-table' && entry.name === 'Dining Table')
    ?? FURNITURE_CATALOG.find(entry => entry.type === 'dining-table');
  const chair = diningChair();
  const layout = rectSeatLayout(size.width, size.depth);
  const square = Math.abs(size.width - size.depth) < 0.15;
  const items: FurnitureSetItem[] = [];
  if (catalog) {
    items.push({
      type: 'dining-table',
      offset: { x: 0, z: 0 },
      snapshot: { ...catalog, width: size.width, depth: size.depth, name: square ? '方桌' : '长桌', tableShape: 'rect' },
    });
  }
  if (chair) {
    for (const place of layout.chairs) {
      items.push({
        type: 'dining-chair',
        offset: { x: place.x, z: place.z },
        rotation: place.rotation,
        snapshot: { ...chair, name: '餐椅' },
      });
    }
  }
  return { key: 'dining-rect', label: square ? '方桌' : '长桌', icon: '🍽️', description: square ? '方桌' : '长桌', items };
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
