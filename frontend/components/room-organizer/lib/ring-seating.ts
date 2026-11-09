import { FURNITURE_CATALOG } from './constants';
import { rotatedHalfExtents } from './geometry';
import type { FurnitureSet, FurnitureSetItem } from './furniture-sets';
import type { Vec2 } from './types';

export interface RingRect { x: number; z: number; w: number; d: number }

/** Round table with chairs on one circle, facing inward. Not the 4-corner dining grid. */
export function ringDiningSet(): FurnitureSet {
  const table = FURNITURE_CATALOG.find(entry => entry.type === 'dining-table');
  const chair = FURNITURE_CATALOG.find(entry => entry.type === 'dining-chair');
  const radius = 1.15;
  const seats = 6;
  const items: FurnitureSetItem[] = [];
  if (table) {
    items.push({
      type: 'dining-table',
      offset: { x: 0, z: 0 },
      snapshot: { ...table, width: 1.4, depth: 1.4, name: '圆桌' },
    });
  }
  if (chair) {
    for (let index = 0; index < seats; index++) {
      const angle = -Math.PI / 2 + (2 * Math.PI * index) / seats;
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
 * Centres on a ring or open sector. The south gap is the aisle.
 * One centre when the zone cannot hold a loop.
 */
export function ringCenters(rect: RingRect, footprint: { halfX: number; halfZ: number }, wallGap: number, aisleM: number): Vec2[] {
  const insetX = wallGap + footprint.halfX;
  const insetZ = wallGap + footprint.halfZ;
  const innerW = rect.w - 2 * insetX;
  const innerD = rect.d - 2 * insetZ;
  const cx = rect.x + rect.w / 2;
  const cz = rect.z + rect.d / 2;
  if (innerW < 0.2 || innerD < 0.2) return [{ x: cx, z: cz }];
  const rx = innerW / 2;
  const rz = innerD / 2;
  const pitch = Math.max(2 * footprint.halfX, 2 * footprint.halfZ) + Math.max(0.4, aisleM * 0.35);
  const circ = Math.PI * (3 * (rx + rz) - Math.sqrt(Math.max(0, (3 * rx + rz) * (rx + 3 * rz))));
  const count = Math.max(1, Math.min(10, Math.floor(circ / Math.max(pitch, 0.5))));
  if (count <= 2 || Math.min(rx, rz) < pitch * 0.35) return [{ x: cx, z: cz }];
  const opening = Math.min(Math.PI / 2, Math.max(0.45, aisleM / Math.max(rx, rz, 0.5)));
  const span = Math.PI * 2 - opening;
  const start = Math.PI / 2 + opening / 2;
  const slots: Vec2[] = [];
  for (let index = 0; index < count; index++) {
    const angle = start + (span * index) / count;
    slots.push({ x: cx + rx * Math.cos(angle), z: cz + rz * Math.sin(angle) });
  }
  return slots;
}
