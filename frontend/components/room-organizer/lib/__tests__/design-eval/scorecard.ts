import { outsideDrawnRoom, drawnRoom, type DrawnRoom } from '../../floor-reading';
import type { FurnitureItem, RoomLayout } from '../../types';

/**
 * One finished banquet preview, read into a pass/fail ledger.
 * The count is taken from the floor and wall polylines the canvas draws.
 * It does not call the receipt's own filter and then compare that filter to itself.
 */
export interface BanquetLedger {
  pass: boolean;
  seatsMatch: { pass: boolean; card: number; inRoom: number };
  noCrossing: { pass: boolean; chairs: number };
  noChairlessTables: { pass: boolean; tables: number };
  room: DrawnRoom;
}

const SEAT = new Set(['dining-chair', 'chair', 'desk-chair']);

function isSeat(item: FurnitureItem): boolean {
  return SEAT.has(item.type);
}

export function evaluateBanquet(
  layout: RoomLayout,
  floorIndex: number,
  baseIds: ReadonlySet<string>,
  cardSeats: number,
): BanquetLedger {
  const room = drawnRoom(layout, floorIndex);
  const items = layout.floors[floorIndex]?.items ?? [];
  const fresh = items.filter(item => !baseIds.has(item.id) && item.position);
  const crossing = fresh.filter(item => isSeat(item) && outsideDrawnRoom(item, layout, floorIndex));
  const inRoom = fresh.filter(item => isSeat(item) && !outsideDrawnRoom(item, layout, floorIndex));
  const chairless = fresh.filter(item => item.type === 'dining-table' && (
    outsideDrawnRoom(item, layout, floorIndex)
    || !inRoom.some(chair => Math.hypot(chair.position!.x - item.position!.x, chair.position!.z - item.position!.z) < item.width + 0.8)
  ));
  const seatsMatch = cardSeats === inRoom.length;
  const noCrossing = crossing.length === 0;
  const noChairlessTables = chairless.length === 0;
  return {
    pass: seatsMatch && noCrossing && noChairlessTables,
    seatsMatch: { pass: seatsMatch, card: cardSeats, inRoom: inRoom.length },
    noCrossing: { pass: noCrossing, chairs: crossing.length },
    noChairlessTables: { pass: noChairlessTables, tables: chairless.length },
    room,
  };
}
