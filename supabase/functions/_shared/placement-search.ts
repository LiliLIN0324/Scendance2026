// Deterministic metre-space placement search. The model asks for a legal anchor
// instead of guessing coordinates and hoping the validator accepts them.
import { ApiError, type Point, type Scene, type SceneObject } from './domain.ts';
import { confirmedDoorwayObstructions, footprint, footprintsIntersect } from './structural-geometry.ts';
import { structureOf } from './scene-digest.ts';
export { footprintsIntersect } from './structural-geometry.ts';

const EPS = 1e-6;
const PROBE_ID = '00000000-0000-4000-8000-000000000000';

export type FreeAreaQuery = {
  width: number;
  depth: number;
  height?: number;
  rotation?: number;
  /** Free gap kept from every other object and column, in metres. Walls are not padded. */
  clearance?: number;
  near?: Point;
  limit?: number;
  step?: number;
};

export type FreeAreaSite = {
  x: number;
  z: number;
  rotation: number;
  distanceToNear?: number;
  nearestEntrance?: { id: string; distance: number };
};

export type FreeAreaResult = {
  sites: FreeAreaSite[];
  step: number;
  clearance: number;
  scanned: number;
  rejected: { outOfBounds: number; overlap: number; structure: number };
  note: string;
};

type Box = { x1: number; z1: number; x2: number; z2: number };

function venuePolygon(scene: Scene): Point[] {
  const v = scene.venue;
  return v.polygon ?? [{ x: 0, z: 0 }, { x: v.width, z: 0 }, { x: v.width, z: v.depth }, { x: 0, z: v.depth }];
}
function cross(a: Point, b: Point, c: Point) {
  return (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
}
function onSegment(p: Point, a: Point, b: Point) {
  return Math.abs(cross(a, b, p)) < EPS && p.x >= Math.min(a.x, b.x) - EPS && p.x <= Math.max(a.x, b.x) + EPS && p.z >= Math.min(a.z, b.z) - EPS && p.z <= Math.max(a.z, b.z) + EPS;
}
function inside(p: Point, poly: Point[]) {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (onSegment(p, a, b)) return true;
    if ((a.z > p.z) !== (b.z > p.z) && p.x < (b.x - a.x) * (p.z - a.z) / (b.z - a.z) + a.x) hit = !hit;
  }
  return hit;
}
function boundsOf(poly: Point[]): Box {
  const xs = poly.map(p => p.x), zs = poly.map(p => p.z);
  return { x1: Math.min(...xs), z1: Math.min(...zs), x2: Math.max(...xs), z2: Math.max(...zs) };
}
function boxesApart(a: Box, b: Box) {
  return a.x2 <= b.x1 + EPS || b.x2 <= a.x1 + EPS || a.z2 <= b.z1 + EPS || b.z2 <= a.z1 + EPS;
}
/** The solid spans of a wall: an opening cuts the wall body out of it. Mirrors the save-path collision rule. */
function wallPolygons(scene: Scene): Point[][] {
  const result: Point[][] = [];
  for (const wall of structureOf(scene).walls) {
    const dx = wall.end.x - wall.start.x, dz = wall.end.z - wall.start.z, length = Math.hypot(dx, dz);
    if (length < EPS) continue;
    const holes = structureOf(scene).openings
      .filter(o => o.wallId === wall.id)
      .map(o => [o.offset, o.offset + o.width] as [number, number])
      .sort((a, b) => a[0] - b[0]);
    const spans: { start: number; end: number }[] = [];
    let cursor = 0;
    for (const [start, end] of holes) {
      if (start > cursor + EPS) spans.push({ start: cursor, end: start });
      cursor = Math.max(cursor, end);
    }
    if (cursor < length - EPS) spans.push({ start: cursor, end: length });
    for (const { start, end } of spans) {
      const a = { x: wall.start.x + dx * start / length, z: wall.start.z + dz * start / length };
      const b = { x: wall.start.x + dx * end / length, z: wall.start.z + dz * end / length };
      const nx = -dz / length * wall.thickness / 2, nz = dx / length * wall.thickness / 2;
      result.push([{ x: a.x + nx, z: a.z + nz }, { x: b.x + nx, z: b.z + nz }, { x: b.x - nx, z: b.z - nz }, { x: a.x - nx, z: a.z - nz }]);
    }
  }
  return result;
}

export function findFreeAreas(scene: Scene, query: FreeAreaQuery): FreeAreaResult {
  const width = query.width, depth = query.depth;
  if (!(width > 0) || !(depth > 0)) throw new ApiError('INVALID_SEARCH_SIZE', 422);
  const clearance = Math.max(0, query.clearance ?? 0);
  const height = Math.max(0.01, query.height ?? 1);
  const rotation = query.rotation ?? 0;
  const limit = Math.min(24, Math.max(1, query.limit ?? 6));
  const poly = venuePolygon(scene), bounds = boundsOf(poly);
  // Keep the scan bounded: a 60x60 m hall must not cost 10^6 probes.
  const span = Math.max(bounds.x2 - bounds.x1, bounds.z2 - bounds.z1);
  const step = query.step ?? Math.max(0.25, Math.min(1, Math.ceil((span / 60) * 4) / 4 || 0.25));

  const probeAt = (x: number, z: number, grow: number): SceneObject => ({
    id: PROBE_ID, materialId: 'decoration', position: { x, z }, rotation,
    size: { width: width + grow * 2, depth: depth + grow * 2, height }, color: '#000000', locked: false, notes: '',
  });
  const obstacles = [
    ...scene.objects.map(o => ({ poly: footprint(o), box: boundsOf(footprint(o)), bottom: o.elevation ?? 0, carpet: o.materialId === 'carpet' })),
    ...structureOf(scene).columns.map(c => ({ poly: footprint(c), box: boundsOf(footprint(c)), bottom: 0, carpet: false })),
  ];
  const walls = wallPolygons(scene).map(poly => ({ poly, box: boundsOf(poly) }));

  const rejected = { outOfBounds: 0, overlap: 0, structure: 0 };
  const accepted: FreeAreaSite[] = [];
  let probes = 0;
  const xFrom = bounds.x1 + width / 2, xTo = bounds.x2 - width / 2;
  const zFrom = bounds.z1 + depth / 2, zTo = bounds.z2 - depth / 2;
  for (let x = xFrom; x <= xTo + EPS; x += step) {
    for (let z = zFrom; z <= zTo + EPS; z += step) {
      probes++;
      // Check the exact coordinates returned to the caller, including rounding.
      const siteX=Number(x.toFixed(3)),siteZ=Number(z.toFixed(3));
      const probe=probeAt(siteX,siteZ,0);
      const exact = footprint(probe);
      if (height > scene.venue.height + EPS || exact.some(p => !inside(p, poly))) { rejected.outOfBounds++; continue; }
      const padded = clearance > 0 ? footprint(probeAt(siteX, siteZ, clearance)) : exact;
      const paddedBox = boundsOf(padded);
      let blocked = false;
      for (const obstacle of obstacles) {
        if (obstacle.carpet || boxesApart(paddedBox, obstacle.box)) continue;
        // A stacked object above the probe's head does not block the floor.
        if (obstacle.bottom >= height - EPS) continue;
        if (footprintsIntersect(padded, obstacle.poly)) { blocked = true; break; }
      }
      if (blocked) { rejected.overlap++; continue; }
      for (const wall of walls) {
        if (boxesApart(paddedBox, wall.box)) continue;
        if (footprintsIntersect(exact, wall.poly)) { blocked = true; break; }
      }
      if (blocked) { rejected.structure++; continue; }
      // Only the newly searched footprint is compared; existing door obstruction
      // remains untouched and is still reported by independent candidate review.
      if(confirmedDoorwayObstructions({...scene,objects:[probe]} as Scene).length){rejected.structure++;continue;}
      accepted.push({ x: siteX, z: siteZ, rotation });
    }
  }

  // Keep the answer readable: two returned anchors are never neighbours.
  const spacing = Math.max(1, Math.max(width, depth) / 2);
  const thinned: FreeAreaSite[] = [];
  for (const site of accepted) {
    if (thinned.every(c => Math.hypot(c.x - site.x, c.z - site.z) >= spacing)) thinned.push(site);
  }
  const ranked = thinned.map(site => {
    const entrance = scene.venue.entrances
      .map(e => ({ id: e.id, distance: Number(Math.hypot(e.position.x - site.x, e.position.z - site.z).toFixed(2)) }))
      .sort((a, b) => a.distance - b.distance)[0];
    return {
      ...site,
      ...(query.near ? { distanceToNear: Number(Math.hypot(query.near.x - site.x, query.near.z - site.z).toFixed(2)) } : {}),
      ...(entrance ? { nearestEntrance: entrance } : {}),
    };
  }).sort((a, b) => query.near
    ? (a.distanceToNear ?? 0) - (b.distanceToNear ?? 0)
    : (a.nearestEntrance?.distance ?? 0) - (b.nearestEntrance?.distance ?? 0));

  return {
    sites: ranked.slice(0, limit),
    step, clearance, scanned: probes, rejected,
    note: ranked.length
      ? '坐标是占地中心，可用于候选试排。间隙只对物件和柱子生效，墙按实际厚度判定；门扇、通行及现场条件仍需核验。'
      : '本次没有满足条件的落点，可核对尺寸、间隙和现有物件后再试；门扇、通行及现场条件仍需核验，不代表场地无解。',
  };
}
