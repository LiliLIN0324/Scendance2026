import { canvasFloor, canvasWalls, segmentsCross, type CanvasFloor, type FloorPoint, type WallSegment } from '../../floor-reading';
import type { FurnitureItem, RoomLayout } from '../../types';

/**
 * One finished banquet preview, read into a pass/fail ledger.
 * The inside/outside test lives here. It does not call the receipt's
 * drawn-room predicate or the preview filter, so a preview the generator
 * already cleaned cannot pass just by being compared with that predicate.
 */
export interface BanquetLedger {
  pass: boolean;
  recovered: boolean;
  seatsMatch: { pass: boolean; card: number; inRoom: number };
  noCrossing: { pass: boolean; chairs: number };
  noChairlessTables: { pass: boolean; tables: number };
  room: CanvasFloor;
}

const SEAT = new Set(['dining-chair', 'chair', 'desk-chair']);

function isSeat(item: FurnitureItem): boolean {
  return SEAT.has(item.type);
}

function worldOf(item: FurnitureItem, layout: RoomLayout): FloorPoint | null {
  if (!item.position) return null;
  return { x: item.position.x + layout.width / 2, z: item.position.z + layout.height / 2 };
}

function crossesAny(from: FloorPoint, to: FloorPoint, walls: readonly WallSegment[]): boolean {
  return walls.some(wall => segmentsCross(from.x, from.z, to.x, to.z, wall.x1, wall.z1, wall.x2, wall.z2));
}

function ringContains(x: number, z: number, poly: readonly FloorPoint[]): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!, b = poly[j]!;
    const onEdge = Math.abs((b.x - a.x) * (z - a.z) - (x - a.x) * (b.z - a.z)) <= 1e-6
      && x >= Math.min(a.x, b.x) - 1e-6 && x <= Math.max(a.x, b.x) + 1e-6
      && z >= Math.min(a.z, b.z) - 1e-6 && z <= Math.max(a.z, b.z) + 1e-6;
    if (onEdge) return true;
    if ((a.z > z) !== (b.z > z) && x < (b.x - a.x) * (z - a.z) / (b.z - a.z) + a.x) hit = !hit;
  }
  return hit;
}

function segmentDistance(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax, dz = bz - az;
  const length = dx * dx + dz * dz;
  const t = length > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / length)) : 0;
  return Math.hypot(px - ax - dx * t, pz - az - dz * t);
}

/** Chair corners in the same world metres as the floor mesh. */
function cornersOf(item: FurnitureItem, layout: RoomLayout): FloorPoint[] {
  if (!item.position) return [];
  const rotation = item.rotation ?? 0;
  const cos = Math.cos(rotation), sin = Math.sin(rotation);
  const halfW = item.width / 2, halfD = item.depth / 2;
  const cx = item.position.x + layout.width / 2;
  const cz = item.position.z + layout.height / 2;
  return [[-halfW, -halfD], [halfW, -halfD], [halfW, halfD], [-halfW, halfD]].map(([x, z]) => ({
    x: cx + x * cos - z * sin,
    z: cz + x * sin + z * cos,
  }));
}

/**
 * Chairs whose footprints stay inside the floor polygon the canvas mesh uses.
 * An unclosed wall loop recovers nothing: every fresh chair is crossing, and
 * the in-room count is not the activity frame.
 */
export function countChairsOnCanvasFloor(
  layout: RoomLayout,
  floorIndex: number,
  baseIds: ReadonlySet<string>,
): { recovered: boolean; inRoom: number; crossing: number; chairless: number } {
  const room = canvasFloor(layout, floorIndex);
  const items = layout.floors[floorIndex]?.items ?? [];
  const fresh = items.filter(item => !baseIds.has(item.id) && item.position);
  const seats = fresh.filter(isSeat);
  if (!room.recovered || !room.floor) {
    return { recovered: false, inRoom: 0, crossing: seats.length, chairless: fresh.filter(item => item.type === 'dining-table').length };
  }
  const floor = room.floor;
  const walls = canvasWalls(layout, floorIndex);
  const tables = fresh.filter(item => item.type === 'dining-table');
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    const next = parent.get(id) ?? id;
    if (next === id) return id;
    const root = find(next);
    parent.set(id, root);
    return root;
  };
  for (const table of tables) parent.set(table.id, table.id);
  for (let i = 0; i < tables.length; i++) {
    const a = worldOf(tables[i]!, layout);
    if (!a) continue;
    for (let j = i + 1; j < tables.length; j++) {
      const b = worldOf(tables[j]!, layout);
      if (b && !crossesAny(a, b, walls)) parent.set(find(tables[i]!.id), find(tables[j]!.id));
    }
  }
  const score = new Map<string, number>();
  for (const chair of seats) {
    const here = worldOf(chair, layout);
    if (!here) continue;
    for (const table of tables) {
      const point = worldOf(table, layout);
      if (!point || Math.hypot(point.x - here.x, point.z - here.z) > table.width / 2 + 2.5 || crossesAny(here, point, walls)) continue;
      const root = find(table.id);
      score.set(root, (score.get(root) ?? 0) + 1);
      break;
    }
  }
  let kept = '';
  let keptScore = -1;
  for (const [root, value] of score) if (value > keptScore) { kept = root; keptScore = value; }
  const offFloor = (item: FurnitureItem): boolean => {
    const corners = cornersOf(item, layout);
    if (!corners.length) return true;
    return corners.some(corner => !ringContains(corner.x, corner.z, floor) || floor.some((a, index) => {
      const b = floor[(index + 1) % floor.length]!;
      return segmentDistance(corner.x, corner.z, a.x, a.z, b.x, b.z) < 0.02;
    }));
  };
  const outside = (item: FurnitureItem): boolean => {
    if (offFloor(item)) return true;
    const here = worldOf(item, layout);
    if (!here) return true;
    if (item.type === 'dining-table') return kept !== '' && find(item.id) !== kept;
    if (!kept) return tables.length > 0;
    return !tables.some(table => {
      if (find(table.id) !== kept) return false;
      const point = worldOf(table, layout);
      return !!point && Math.hypot(point.x - here.x, point.z - here.z) <= table.width / 2 + 2.5 && !crossesAny(here, point, walls);
    });
  };
  const crossing = seats.filter(outside);
  const inRoom = seats.filter(item => !outside(item));
  const chairless = fresh.filter(item => item.type === 'dining-table' && (
    outside(item)
    || !inRoom.some(chair => Math.hypot(chair.position!.x - item.position!.x, chair.position!.z - item.position!.z) < item.width + 0.8)
  ));
  return { recovered: true, inRoom: inRoom.length, crossing: crossing.length, chairless: chairless.length };
}

export function evaluateBanquet(
  layout: RoomLayout,
  floorIndex: number,
  baseIds: ReadonlySet<string>,
  cardSeats: number,
): BanquetLedger {
  const room = canvasFloor(layout, floorIndex);
  const counted = countChairsOnCanvasFloor(layout, floorIndex, baseIds);
  const seatsMatch = counted.recovered && cardSeats === counted.inRoom;
  const noCrossing = counted.recovered && counted.crossing === 0;
  const noChairlessTables = counted.recovered && counted.chairless === 0;
  return {
    pass: seatsMatch && noCrossing && noChairlessTables,
    recovered: counted.recovered,
    seatsMatch: { pass: seatsMatch, card: cardSeats, inRoom: counted.inRoom },
    noCrossing: { pass: noCrossing, chairs: counted.crossing },
    noChairlessTables: { pass: noChairlessTables, tables: counted.chairless },
    room,
  };
}
