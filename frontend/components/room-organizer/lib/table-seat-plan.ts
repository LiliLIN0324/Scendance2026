import { itemsOverlap } from './geometry';
import type { FurnitureItem } from './types';

/**
 * How many people a table can seat. The layout script places this result;
 * it does not keep a private "8 per table".
 *
 * Chair is the catalog dining chair, 0.45 × 0.45 m. Air is 0.05 m, the same
 * gap the ring used so a touching box still counts as overlap at confirm.
 *
 * Round: chair centres sit on the circle just outside the collision square's
 * corners, R = (diameter / 2) × √2 + chair depth / 2 + 0.07 m. Seats are
 * floor(2πR / 0.75 m), then reduced until the boxes clear. A wider diameter
 * moves that circle out and fits more chairs. 1.4 m → 10, 1.8 m → 13, 2.2 m → 15.
 *
 * Rect: each side gets floor((edge − 2 × inset) / pitch) chairs, inset and
 * pitch both chair-width + air, so corners stay free for the neighbouring
 * side. Any pair that still overlaps is dropped, short sides first.
 */
export const SEAT_CLEARANCE_M = 0.05;
export const DINING_CHAIR_M = { width: 0.45, depth: 0.45 };
/** Default banquet round table. Same side as the previous fixed ring. */
export const DEFAULT_ROUND_DIAMETER_M = 1.4;
/** Default long table when a rect brief gives a headcount but no size. */
export const DEFAULT_RECT_TABLE_M = { width: 1.8, depth: 0.9 };

const MIN_RING = 3;
const MAX_RING = 16;

export interface ChairSize { width: number; depth: number }
export interface SeatPlacement { x: number; z: number; rotation: number }

export interface TableArrangement {
  shape: 'round' | 'rect';
  width: number;
  depth: number;
  seatsPerTable: number;
  /** Whole tables needed for the headcount. Zero when nobody was asked for. */
  tables: number;
  explanation: string;
}

function chairItem(id: string, chair: ChairSize, place: SeatPlacement): FurnitureItem {
  return {
    id, type: 'dining-chair', name: '餐椅', width: chair.width, depth: chair.depth, height: 0.9,
    color: '#5D4037', icon: '🪑', position: { x: place.x, z: place.z }, rotation: place.rotation,
  };
}

function tableItem(width: number, depth: number): FurnitureItem {
  return {
    id: 'table', type: 'dining-table', name: '桌', width, depth, height: 0.75,
    color: '#A0522D', icon: '🟫', position: { x: 0, z: 0 }, rotation: 0,
  };
}

function clears(table: FurnitureItem, chairs: FurnitureItem[]): boolean {
  const fatTable: FurnitureItem = {
    ...table,
    width: table.width + SEAT_CLEARANCE_M * 2,
    depth: table.depth + SEAT_CLEARANCE_M * 2,
  };
  for (let index = 0; index < chairs.length; index++) {
    const chair = chairs[index]!;
    if (itemsOverlap(fatTable, chair)) return false;
    const fatChair: FurnitureItem = { ...chair, width: chair.width + SEAT_CLEARANCE_M, depth: chair.depth + SEAT_CLEARANCE_M };
    for (let other = index + 1; other < chairs.length; other++) {
      if (itemsOverlap(fatChair, chairs[other]!)) return false;
    }
  }
  return true;
}

function ringPlaces(seats: number, radius: number): SeatPlacement[] {
  const places: SeatPlacement[] = [];
  for (let index = 0; index < seats; index++) {
    const angle = -Math.PI / 2 + (2 * Math.PI * index) / seats;
    places.push({
      x: radius * Math.cos(angle),
      z: radius * Math.sin(angle),
      rotation: Math.atan2(-Math.cos(angle), -Math.sin(angle)),
    });
  }
  return places;
}

const roundCache = new Map<string, { seats: number; radius: number; chairs: SeatPlacement[] }>();

/**
 * Largest ring that still sits against the table. The radius is the table
 * radius plus the chair and the air gap, not an arbitrary circle out in the room.
 */
export function roundSeatLayout(diameter: number, chair: ChairSize = DINING_CHAIR_M): { seats: number; radius: number; chairs: SeatPlacement[] } {
  const key = `${diameter.toFixed(3)}:${chair.width}:${chair.depth}`;
  const cached = roundCache.get(key);
  if (cached) return cached;
  const empty = { seats: 0, radius: diameter / 2, chairs: [] as SeatPlacement[] };
  if (!(diameter >= 0.6)) { roundCache.set(key, empty); return empty; }
  // Chairs have to clear the square's corners, not only the flat sides.
  // Seat pitch along that circle is about 0.75 m (chair plus elbow room).
  const radius = Math.round(((diameter / 2) * Math.SQRT2 + chair.depth / 2 + SEAT_CLEARANCE_M + 0.02) * 1000) / 1000;
  const pitch = 0.75;
  const byPitch = Math.floor((2 * Math.PI * radius) / pitch);
  const table = tableItem(diameter, diameter);
  let best = { ...empty, radius };
  for (let seats = Math.min(MAX_RING, Math.max(MIN_RING, byPitch)); seats >= MIN_RING; seats--) {
    const chairs = ringPlaces(seats, radius);
    if (clears(table, chairs.map((place, index) => chairItem(`c${index}`, chair, place)))) {
      best = { seats, radius, chairs };
      break;
    }
  }
  roundCache.set(key, best);
  return best;
}

const SEAT_AIR_M = SEAT_CLEARANCE_M + 0.02;

function edgeCount(length: number, chair: ChairSize): number {
  const inset = chair.width / 2 + SEAT_AIR_M;
  const usable = length - 2 * inset;
  const pitch = chair.width + SEAT_AIR_M;
  if (usable + 1e-6 < chair.width) return 0;
  return Math.max(1, Math.floor((usable + SEAT_AIR_M) / pitch + 1e-6));
}

function centred(count: number, chair: ChairSize): number[] {
  if (count <= 0) return [];
  const pitch = chair.width + SEAT_AIR_M;
  const start = -((count - 1) * pitch) / 2;
  return Array.from({ length: count }, (_, index) => start + index * pitch);
}

function rectPlaces(width: number, depth: number, alongWidth: number, alongDepth: number, chair: ChairSize): SeatPlacement[] {
  const outX = width / 2 + SEAT_AIR_M + chair.depth / 2;
  const outZ = depth / 2 + SEAT_AIR_M + chair.depth / 2;
  const places: SeatPlacement[] = [];
  for (const x of centred(alongWidth, chair)) {
    places.push({ x, z: -outZ, rotation: 0 });
    places.push({ x, z: outZ, rotation: Math.PI });
  }
  for (const z of centred(alongDepth, chair)) {
    places.push({ x: outX, z, rotation: -Math.PI / 2 });
    places.push({ x: -outX, z, rotation: Math.PI / 2 });
  }
  return places;
}

/** Chairs on the long sides and, when the ends are wide enough, on the short sides. */
export function rectSeatLayout(width: number, depth: number, chair: ChairSize = DINING_CHAIR_M): { seats: number; chairs: SeatPlacement[] } {
  if (!(width >= 0.4) || !(depth >= 0.4)) return { seats: 0, chairs: [] };
  let alongWidth = edgeCount(width, chair);
  let alongDepth = edgeCount(depth, chair);
  const table = tableItem(width, depth);
  for (let guard = 0; guard < 24; guard++) {
    const chairs = rectPlaces(width, depth, alongWidth, alongDepth, chair);
    if (chairs.length === 0) return { seats: 0, chairs: [] };
    if (clears(table, chairs.map((place, index) => chairItem(`c${index}`, chair, place)))) {
      return { seats: chairs.length, chairs };
    }
    if (alongDepth > 0) alongDepth -= 1;
    else if (alongWidth > 0) alongWidth -= 1;
    else return { seats: 0, chairs: [] };
  }
  return { seats: 0, chairs: [] };
}

function roundUpDiameter(seats: number, chair: ChairSize): number {
  for (let step = 0; step <= 30; step++) {
    const diameter = Math.round((0.9 + step * 0.1) * 10) / 10;
    if (roundSeatLayout(diameter, chair).seats >= seats) return diameter;
  }
  return 3.9;
}

function growRect(seats: number, chair: ChairSize, width: number | null, depth: number | null): { width: number; depth: number } {
  let nextWidth = width ?? DEFAULT_RECT_TABLE_M.width;
  let nextDepth = depth ?? DEFAULT_RECT_TABLE_M.depth;
  if (rectSeatLayout(nextWidth, nextDepth, chair).seats >= seats) return { width: nextWidth, depth: nextDepth };
  for (let step = 0; step < 16 && rectSeatLayout(nextWidth, nextDepth, chair).seats < seats; step++) {
    nextWidth = Math.round((nextWidth + 0.3) * 10) / 10;
  }
  for (let step = 0; step < 8 && rectSeatLayout(nextWidth, nextDepth, chair).seats < seats; step++) {
    nextDepth = Math.round((nextDepth + 0.3) * 10) / 10;
  }
  return { width: nextWidth, depth: nextDepth };
}

function tablesFor(guests: number, seats: number): number {
  if (seats < 1) return 0;
  return guests > 0 ? Math.ceil(guests / seats) : 1;
}

function metres(value: string, unit: string): number | null {
  const number = Number(value);
  const scale = /mm|毫米/.test(unit) ? 0.001 : /cm|厘米|公分/.test(unit) ? 0.01 : 1;
  const result = number * scale;
  return Number.isFinite(result) && result >= 0.4 && result <= 6 ? Math.round(result * 1000) / 1000 : null;
}

/**
 * What the brief already said about the table. Venue sizes (20×15) are ignored
 * unless they sit next to 圆桌 / 方桌 / 长桌.
 */
export interface BanquetTableRequest {
  shape?: 'round' | 'rect' | undefined;
  width?: number | undefined;
  depth?: number | undefined;
  peoplePerTable?: number | undefined;
  evidence: string;
}

/** Keep a table size stated earlier when this sentence does not mention one. */
export function mergeBanquetTable(previous: BanquetTableRequest | undefined, raw: string): BanquetTableRequest | undefined {
  const next = readTableRequest(raw);
  if (!next) return previous;
  return { ...(previous ?? { evidence: raw.trim().slice(0, 200) }), ...next, evidence: raw.trim().slice(0, 200) };
}

export function readTableRequest(raw: string): { shape?: 'round' | 'rect'; width?: number; depth?: number; peoplePerTable?: number } | undefined {
  const text = raw.normalize('NFKC').replace(/[ØΦφ⌀]/g, '直径');
  const clauses = text.split(/[，,；;。！？!?\n]/).map(clause => clause.trim()).filter(clause => clause && !/去年|上次|上一场|以前|之前|历史/.test(clause));
  const whole = clauses.join('').replace(/\s+/g, '');
  const mentionsRound = /圆桌|围着坐|围坐/.test(whole);
  const mentionsRect = /方桌|长桌|长条桌/.test(whole);
  let shape: 'round' | 'rect' | undefined = mentionsRect ? 'rect' : mentionsRound ? 'round' : undefined;
  let width: number | undefined;
  let depth: number | undefined;
  let peoplePerTable: number | undefined;
  for (const clause of clauses) {
    const compact = clause.replace(/\s+/g, '');
    const diameter = compact.match(/直径(?:为|是|约)?(\d+(?:\.\d+)?)(米|m|厘米|公分|cm|毫米|mm)/i)
      ?? compact.match(/(\d+(?:\.\d+)?)(米|m)直径/i);
    if (diameter && (mentionsRound || /直径/.test(compact))) {
      const value = metres(diameter[1]!, diameter[2]!);
      if (value !== null && !mentionsRect) { shape = 'round'; width = value; depth = value; }
    }
    const pair = compact.match(/(圆桌|方桌|长桌|长条桌)(?:的)?(?:尺寸|规格)?(?:为|是)?(\d+(?:\.\d+)?)[×xX*](\d+(?:\.\d+)?)(米|m|厘米|公分|cm)/i);
    if (pair) {
      const a = metres(pair[2]!, pair[4]!);
      const b = metres(pair[3]!, pair[4]!);
      if (a !== null && b !== null) {
        shape = pair[1]!.includes('圆') ? 'round' : 'rect';
        width = shape === 'round' ? Math.min(a, b) : a;
        depth = shape === 'round' ? Math.min(a, b) : b;
      }
    }
    const per = compact.match(/每桌(?:坐|供|配|安排|容纳)?(\d{1,2})(?:个)?人/);
    if (per && (mentionsRound || mentionsRect)) {
      const count = Number(per[1]);
      if (count >= 1 && count <= 16) peoplePerTable = count;
    }
  }
  if (!shape && width === undefined && peoplePerTable === undefined) return undefined;
  return {
    ...(shape ? { shape } : {}),
    ...(width !== undefined ? { width } : {}),
    ...(depth !== undefined ? { depth } : {}),
    ...(peoplePerTable !== undefined ? { peoplePerTable } : {}),
  };
}

/** Decide table size, seats per table, and how many tables. The compiler only places this. */
export function resolveTableArrangement(input: {
  shape: 'round' | 'rect';
  guests?: number | null;
  width?: number | null;
  depth?: number | null;
  peoplePerTable?: number | null;
  chair?: ChairSize;
}): TableArrangement {
  const chair = input.chair ?? DINING_CHAIR_M;
  const guests = input.guests && input.guests > 0 ? Math.floor(input.guests) : 0;
  const asked = input.peoplePerTable && input.peoplePerTable > 0 ? Math.floor(input.peoplePerTable) : 0;
  if (input.shape === 'round') {
    const given = input.width && input.width > 0 ? input.width : input.depth && input.depth > 0 ? input.depth : null;
    const diameter = given ?? (asked > 0 ? roundUpDiameter(asked, chair) : DEFAULT_ROUND_DIAMETER_M);
    const seats = roundSeatLayout(diameter, chair).seats;
    const tables = tablesFor(guests, seats);
    const explanation = `圆桌直径 ${diameter.toFixed(2)} 米，按椅宽 ${chair.width} 米、净距 ${SEAT_CLEARANCE_M} 米，每桌 ${seats} 人${guests > 0 ? `，${guests} 人约 ${tables} 桌` : ''}。`;
    return { shape: 'round', width: diameter, depth: diameter, seatsPerTable: seats, tables, explanation };
  }
  const givenWidth = input.width && input.width > 0 ? input.width : null;
  const givenDepth = input.depth && input.depth > 0 ? input.depth : null;
  const grown = asked > 0 ? growRect(asked, chair, givenWidth, givenDepth) : {
    width: givenWidth ?? DEFAULT_RECT_TABLE_M.width,
    depth: givenDepth ?? DEFAULT_RECT_TABLE_M.depth,
  };
  const seats = rectSeatLayout(grown.width, grown.depth, chair).seats;
  const tables = tablesFor(guests, seats);
  const explanation = `长桌 ${grown.width.toFixed(2)} × ${grown.depth.toFixed(2)} 米，长边两侧入座，短边放得下才坐两端；椅宽 ${chair.width} 米、净距 ${SEAT_CLEARANCE_M} 米，每桌 ${seats} 人${guests > 0 ? `，${guests} 人约 ${tables} 桌` : ''}。`;
  return { shape: 'rect', width: grown.width, depth: grown.depth, seatsPerTable: seats, tables, explanation };
}
