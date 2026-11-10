import { footprint, footprintsIntersect, pointInPolygon } from '../../../../supabase/functions/_shared/structural-geometry';
import { layoutGeometryScene } from './structural-layout';
import type { FurnitureItem, RoomLayout } from './types';

/**
 * The indoor floor and wall polylines the canvas draws.
 * This module imports no layout generator. The receipt and the design eval
 * both read a finished preview through here, so a chair past the drawn wall
 * cannot be billed just because a looser exterior shell still contains it.
 */
export interface FloorPoint { x: number; z: number }

export interface DrawnRoom {
  /** World metres. The tighter of the drawn venue polygon and a closed wall loop. */
  floor: FloorPoint[];
  /** True when that floor is smaller than the activity frame. */
  tighterThanFrame: boolean;
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

/** Close one wall polyline. Leftover partitions do not throw the room away. */
function chainLoop(walls: readonly ChainWall[]): { loop: FloorPoint[]; thickness: number } | null {
  if (walls.length < 3) return null;
  const key = (point: FloorPoint) => `${point.x.toFixed(3)},${point.z.toFixed(3)}`;
  const pending = walls.map(wall => ({ ...wall }));
  const first = pending.shift()!;
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

function tighter(frame: number, loops: FloorPoint[][]): FloorPoint[] | null {
  const usable = loops.filter(loop => loop.length >= 3 && ringArea(loop) > 1 && ringArea(loop) < frame * 0.98);
  if (!usable.length) return null;
  return usable.reduce((best, loop) => ringArea(loop) < ringArea(best) ? loop : best);
}

/** Floor and walls `buildStructureShell` draws, in world metres. */
export function drawnRoom(layout: RoomLayout, floorIndex = 0): DrawnRoom {
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
  const exterior = walls.filter((_, index) => scene.structure.walls[index]?.kind === 'exterior');
  const chained = chainLoop(exterior.length >= 3 ? exterior : walls) ?? (exterior.length >= 3 ? chainLoop(walls) : null);
  const inner = chained ? insetLoop(chained.loop, chained.thickness / 2) ?? chained.loop : null;
  const floor = tighter(frame, [venue, ...(inner ? [inner] : [])]) ?? venue;
  return { floor, tighterThanFrame: ringArea(floor) < frame * 0.98 };
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
  const room = drawnRoom(layout, floorIndex);
  const corners = itemCorners(item, layout);
  if (!corners.length) return false;
  if (room.tighterThanFrame) {
    for (const corner of corners) {
      if (!pointInPolygon(corner, room.floor)) return true;
      for (let index = 0; index < room.floor.length; index++) {
        const a = room.floor[index]!, b = room.floor[(index + 1) % room.floor.length]!;
        if (distanceToSegment(corner.x, corner.z, a.x, a.z, b.x, b.z) < 0.02) return true;
      }
    }
  }
  const chair = corners;
  for (const wall of scene.structure.walls) {
    const box = wallBox(wall);
    if (box.length >= 3 && footprintsIntersect(chair, box)) return true;
  }
  return false;
}
