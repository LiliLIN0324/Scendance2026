import { footprint, footprintsIntersect, pointInPolygon } from '../../../../supabase/functions/_shared/structural-geometry';
import { layoutGeometryScene } from './structural-layout';
import type { FurnitureItem, RoomLayout } from './types';

/**
 * Polygon the structure shell's floor mesh uses. This module imports no
 * layout generator. The receipt may use `outsideDrawnRoom`. The design eval
 * must not: it reads `canvasFloor` and counts chairs with its own test.
 */
export interface FloorPoint { x: number; z: number }

export interface WallSegment { x1: number; z1: number; x2: number; z2: number; thickness: number }

export interface CanvasFloor {
  /**
   * False when walls are drawn but do not close into a room.
   * The 23.8×16.1 frame is not used in place of that room.
   */
  recovered: boolean;
  /** World-metre polygon the floor mesh uses. Null when the room cannot be recovered. */
  floor: FloorPoint[] | null;
}

function ringArea(points: readonly FloorPoint[]): number {
  let area = 0;
  for (let index = 0; index < points.length; index++) {
    const a = points[index]!, b = points[(index + 1) % points.length]!;
    area += a.x * b.z - b.x * a.z;
  }
  return Math.abs(area) / 2;
}

function signedRing(points: readonly FloorPoint[]): number {
  let area = 0;
  for (let index = 0; index < points.length; index++) {
    const a = points[index]!, b = points[(index + 1) % points.length]!;
    area += a.x * b.z - b.x * a.z;
  }
  return area / 2;
}

function insetLoop(loop: readonly FloorPoint[], distance: number): FloorPoint[] | null {
  if (!(distance > 0) || loop.length < 3) return null;
  const ccw = signedRing(loop) > 0;
  const edges = loop.map((start, index) => {
    const end = loop[(index + 1) % loop.length]!;
    const dx = end.x - start.x, dz = end.z - start.z;
    const length = Math.hypot(dx, dz) || 1;
    const nx = (ccw ? -dz : dz) / length, nz = (ccw ? dx : -dx) / length;
    return { x: start.x + nx * distance, z: start.z + nz * distance, dx, dz };
  });
  const verts: FloorPoint[] = [];
  for (let index = 0; index < edges.length; index++) {
    const prev = edges[(index + edges.length - 1) % edges.length]!;
    const next = edges[index]!;
    const den = prev.dx * next.dz - prev.dz * next.dx;
    if (Math.abs(den) < 1e-9) return null;
    const t = ((next.x - prev.x) * next.dz - (next.z - prev.z) * next.dx) / den;
    const point = { x: prev.x + prev.dx * t, z: prev.z + prev.dz * t };
    if (!Number.isFinite(point.x) || !Number.isFinite(point.z)) return null;
    verts.push(point);
  }
  const area = ringArea(verts);
  if (!(area > 1) || area >= ringArea(loop) - 1e-6 || signedRing(verts) * signedRing(loop) <= 0) return null;
  return verts;
}

interface ChainWall { start: FloorPoint; end: FloorPoint; thickness: number }

/** Close one loop starting at any wall. A stray first segment must not hide the room. */
function chainFrom(walls: readonly ChainWall[], start: number): { loop: FloorPoint[]; thickness: number } | null {
  if (walls.length < 3 || start < 0 || start >= walls.length) return null;
  const key = (point: FloorPoint) => `${point.x.toFixed(3)},${point.z.toFixed(3)}`;
  const pending = walls.map(wall => ({ ...wall }));
  const first = pending.splice(start, 1)[0];
  if (!first) return null;
  const loop = [first.start, first.end];
  const used = [first];
  let closed = false;
  while (pending.length) {
    const end = loop[loop.length - 1]!;
    const index = pending.findIndex(wall => key(wall.start) === key(end) || key(wall.end) === key(end));
    if (index < 0) break;
    const wall = pending.splice(index, 1)[0]!;
    used.push(wall);
    const next = key(wall.start) === key(end) ? wall.end : wall.start;
    if (key(next) === key(loop[0]!)) { closed = true; break; }
    loop.push(next);
  }
  if (!closed || loop.length < 3) return null;
  return { loop, thickness: Math.max(0, ...used.map(wall => wall.thickness)) };
}

function closedLoops(walls: readonly ChainWall[]): { loop: FloorPoint[]; thickness: number; area: number }[] {
  const found: { loop: FloorPoint[]; thickness: number; area: number }[] = [];
  const seen = new Set<string>();
  for (let start = 0; start < walls.length; start++) {
    const chained = chainFrom(walls, start);
    if (!chained) continue;
    const area = ringArea(chained.loop);
    if (!(area > 1)) continue;
    const id = chained.loop.map(point => `${point.x.toFixed(2)},${point.z.toFixed(2)}`).sort().join('|');
    if (seen.has(id)) continue;
    seen.add(id);
    found.push({ ...chained, area });
  }
  return found;
}

/**
 * Polygon the structure shell's floor mesh is built from.
 * A closed wall loop, of any kind, is that floor. Walls that do not close
 * do not fall back to the activity frame.
 */
export function canvasFloor(layout: RoomLayout, floorIndex = 0): CanvasFloor {
  const scene = layoutGeometryScene(layout, floorIndex);
  const frame = layout.width * layout.height;
  const venue = (scene.venue.polygon ?? [
    { x: 0, z: 0 }, { x: layout.width, z: 0 },
    { x: layout.width, z: layout.height }, { x: 0, z: layout.height },
  ]).map(point => ({ x: point.x, z: point.z }));
  const walls: ChainWall[] = scene.structure.walls.map(wall => ({
    start: { x: wall.start.x, z: wall.start.z },
    end: { x: wall.end.x, z: wall.end.z },
    thickness: wall.thickness ?? 0.16,
  }));
  if (!walls.length) return { recovered: true, floor: venue };
  const loops = closedLoops(walls);
  if (!loops.length) return { recovered: false, floor: null };
  const tighter = loops.filter(loop => loop.area < frame * 0.98);
  const pool = tighter.length ? tighter : loops;
  const chosen = pool.reduce((best, loop) => loop.area < best.area ? loop : best);
  const inner = insetLoop(chosen.loop, chosen.thickness / 2) ?? chosen.loop;
  return { recovered: true, floor: inner };
}

/** Wall centerlines the structure shell extrudes. World metres. */
export function canvasWalls(layout: RoomLayout, floorIndex = 0): WallSegment[] {
  const scene = layoutGeometryScene(layout, floorIndex);
  return scene.structure.walls.map(wall => ({
    x1: wall.start.x, z1: wall.start.z, x2: wall.end.x, z2: wall.end.z,
    thickness: wall.thickness ?? 0.16,
  }));
}

/** True when the open segments cross. Touching an endpoint does not count. */
export function segmentsCross(ax: number, az: number, bx: number, bz: number, cx: number, cz: number, dx: number, dz: number): boolean {
  const eps = 1e-8;
  const abx = bx - ax, abz = bz - az, cdx = dx - cx, cdz = dz - cz;
  const denom = abx * cdz - abz * cdx;
  if (Math.abs(denom) < eps) return false;
  const t = ((cx - ax) * cdz - (cz - az) * cdx) / denom;
  const u = ((cx - ax) * abz - (cz - az) * abx) / denom;
  return t > eps && t < 1 - eps && u > eps && u < 1 - eps;
}

function distanceToSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax, dz = bz - az;
  const length = dx * dx + dz * dz;
  const t = length > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / length)) : 0;
  return Math.hypot(px - ax - dx * t, pz - az - dz * t);
}

function itemCorners(item: FurnitureItem, layout: RoomLayout): FloorPoint[] {
  if (!item.position) return [];
  const rotation = -(item.rotation ?? 0) * 180 / Math.PI;
  return footprint({
    position: { x: item.position.x + layout.width / 2, z: item.position.z + layout.height / 2 },
    rotation,
    size: { width: item.width, depth: item.depth, height: item.height },
  });
}

function wallBox(wall: { start: { x: number; z: number }; end: { x: number; z: number }; thickness: number }): FloorPoint[] {
  const dx = wall.end.x - wall.start.x, dz = wall.end.z - wall.start.z;
  const length = Math.hypot(dx, dz);
  if (!(length > 0)) return [];
  return footprint({
    position: { x: (wall.start.x + wall.end.x) / 2, z: (wall.start.z + wall.end.z) / 2 },
    rotation: Math.atan2(dz, dx) * 180 / Math.PI,
    size: { width: length, depth: wall.thickness ?? 0.16, height: 1 },
  });
}

/**
 * A seat or table whose footprint leaves the drawn indoor floor, sits on its
 * edge, or cuts a drawn wall. The activity frame alone is not that floor.
 */
export function outsideDrawnRoom(item: FurnitureItem, layout: RoomLayout, floorIndex = 0): boolean {
  if (!item.position) return false;
  const scene = layoutGeometryScene(layout, floorIndex);
  const room = canvasFloor(layout, floorIndex);
  const corners = itemCorners(item, layout);
  if (!corners.length) return false;
  // An unclosed wall polyline is not the activity frame. Do not bill the chair.
  if (!room.recovered || !room.floor) return true;
  for (const corner of corners) {
    if (!pointInPolygon(corner, room.floor)) return true;
    for (let index = 0; index < room.floor.length; index++) {
      const a = room.floor[index]!, b = room.floor[(index + 1) % room.floor.length]!;
      if (distanceToSegment(corner.x, corner.z, a.x, a.z, b.x, b.z) < 0.02) return true;
    }
  }
  const chair = corners;
  for (const wall of scene.structure.walls) {
    const box = wallBox(wall);
    if (box.length >= 3 && footprintsIntersect(chair, box)) return true;
  }
  // A chair on the far side of a wall still draws a cyan outline through the
  // wall, while the seat mesh stays hidden. It is not a landed seat.
  if (seatCutOffByWall(item, layout, floorIndex)) return true;
  return false;
}

function worldPoint(item: FurnitureItem, layout: RoomLayout): FloorPoint | null {
  if (!item.position) return null;
  return { x: item.position.x + layout.width / 2, z: item.position.z + layout.height / 2 };
}

function seatCutOffByWall(item: FurnitureItem, layout: RoomLayout, floorIndex: number): boolean {
  const here = worldPoint(item, layout);
  const floor = layout.floors[floorIndex];
  if (!here || !floor) return false;
  const walls = canvasWalls(layout, floorIndex);
  const tables = floor.items.filter(other => other.type === 'dining-table' && other.position);
  const crosses = (from: FloorPoint, to: FloorPoint) => walls.some(wall => segmentsCross(from.x, from.z, to.x, to.z, wall.x1, wall.z1, wall.x2, wall.z2));
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    const next = parent.get(id) ?? id;
    if (next === id) return id;
    const root = find(next);
    parent.set(id, root);
    return root;
  };
  const unite = (a: string, b: string) => {
    const left = find(a), right = find(b);
    if (left !== right) parent.set(left, right);
  };
  for (const table of tables) parent.set(table.id, table.id);
  for (let i = 0; i < tables.length; i++) {
    const a = worldPoint(tables[i]!, layout);
    if (!a) continue;
    for (let j = i + 1; j < tables.length; j++) {
      const b = worldPoint(tables[j]!, layout);
      if (b && !crosses(a, b)) unite(tables[i]!.id, tables[j]!.id);
    }
  }
  const score = new Map<string, number>();
  for (const other of floor.items) {
    if (other.type !== 'dining-chair' && other.type !== 'chair' && other.type !== 'desk-chair') continue;
    const chair = worldPoint(other, layout);
    if (!chair) continue;
    for (const table of tables) {
      const point = worldPoint(table, layout);
      if (!point || Math.hypot(point.x - chair.x, point.z - chair.z) > table.width / 2 + 2.5 || crosses(chair, point)) continue;
      const root = find(table.id);
      score.set(root, (score.get(root) ?? 0) + 1);
      break;
    }
  }
  let best = '';
  let bestScore = -1;
  for (const [root, value] of score) if (value > bestScore) { best = root; bestScore = value; }
  if (item.type === 'dining-table') return best !== '' && find(item.id) !== best;
  if (!best) return tables.length > 0;
  for (const table of tables) {
    if (find(table.id) !== best) continue;
    const point = worldPoint(table, layout);
    if (point && Math.hypot(point.x - here.x, point.z - here.z) <= table.width / 2 + 2.5 && !crosses(here, point)) return false;
  }
  return true;
}
