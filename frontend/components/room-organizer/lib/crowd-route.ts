/**
 * 人群动线（氛围预览，不是漫游，也不写入布置）。
 *
 * 漫游是 `use-walkthrough.ts` 的第一人称相机（PointerLock + WASD）。
 * 人群是另外一件事：最多 3 个示意人沿场地里走得通的格子排队走。
 * 有主入口就从门口内侧出发；没有就在轮廓里走，不假装有门。
 * 格子只落在场地多边形内，并且站得进 `walk-collision` 的家具 / 内墙空隙。
 */
import { buildWalkColliders, resolveWalkerStep } from './walk-collision';
import type { FurnitureItem, InteriorWall, RoomLayout } from './types';
import type { WalkCollider, WalkerPosition } from './walk-collision';

export interface CrowdPoint {
  x: number;
  z: number;
}

export interface CrowdVenue {
  roomWidth: number;
  roomDepth: number;
  /** 场景坐标（西南角为原点），与 `venue.polygon` 相同。缺省则用场地外接矩形。 */
  polygon?: readonly CrowdPoint[];
  items?: readonly FurnitureItem[];
  interiorWalls?: readonly InteriorWall[];
  /** 主入口：门的 structuralOpeningId、venueEntranceId 或 id。没有就不从门口出发。 */
  mainEntranceId?: string;
}

export interface CrowdRoutePlan {
  /** 编辑器坐标（场地中心为原点）上的闭合动线，相邻点只隔一格。 */
  waypoints: CrowdPoint[];
  /** 从主入口出发时为 0；否则为 -1。 */
  entranceIndex: number;
  enteredFromEntrance: boolean;
  /** 走完一圈的米数。只有一个落点时为 0。 */
  length: number;
  /** 编辑器坐标下的场地轮廓。 */
  outline: readonly CrowdPoint[];
  spacing: number;
  roomWidth: number;
  roomDepth: number;
}

export interface CrowdWalker {
  x: number;
  z: number;
  /** `atan2(dx, dz)`，和 Three 的 rotation.y 同一套。 */
  facing: number;
  /** 下一格在 `waypoints` 里的下标。 */
  next: number;
  pause: number;
  phase: number;
  speed: number;
  stuck: number;
}

/** 肩宽，略窄于漫游的 0.3 m，好从 0.8 m 门洞过。 */
export const CROWD_WALKER_RADIUS = 0.28;
/** 氛围预算：同时在场的示意人。 */
export const CROWD_MAX = 3;
const BOUNDARY_CLEARANCE = CROWD_WALKER_RADIUS + 0.14;
const ARRIVE = 0.2;
const STUCK_SECONDS = 0.45;
const STAGGER_SECONDS = 1.35;
const QUEUE_OFFSET = 0.38;

const NO_ITEMS: readonly FurnitureItem[] = [];
const NO_WALLS: readonly InteriorWall[] = [];

export function crowdColliders(venue: CrowdVenue): WalkCollider[] {
  return buildWalkColliders(venue.items ?? NO_ITEMS, venue.interiorWalls ?? NO_WALLS, {
    roomWidth: venue.roomWidth,
    roomDepth: venue.roomDepth,
  });
}

/** 主入口与轮廓从场景真相读，不另造一套门。户外没门就都不填。 */
export function crowdHintsFromLayout(layout: RoomLayout): { polygon?: readonly CrowdPoint[]; mainEntranceId?: string } {
  if (layout.backendSceneV2) {
    const venue = layout.backendSceneV2.venue;
    return {
      ...(venue.polygon ? { polygon: venue.polygon } : {}),
      ...(venue.site?.mainEntrance?.openingId ? { mainEntranceId: venue.site.mainEntrance.openingId } : {}),
    };
  }
  const venue = layout.backendVenue;
  const entranceId = venue?.entrances[0]?.id;
  return {
    ...(venue?.polygon ? { polygon: venue.polygon } : {}),
    ...(entranceId ? { mainEntranceId: entranceId } : {}),
  };
}

export function planCrowdRoute(venue: CrowdVenue): CrowdRoutePlan {
  const outline = editorOutline(venue);
  const colliders = crowdColliders(venue);
  const spacing = chooseSpacing(venue.roomWidth, venue.roomDepth);
  const room = { roomWidth: venue.roomWidth, roomDepth: venue.roomDepth };
  const cells = freeCells(outline, colliders, spacing, room);
  const aim = entranceAim(venue, outline, colliders, room);
  const start = aim ? nearestCell(cells, aim.point) : nearestCell(cells, centroid(outline));
  const empty: CrowdRoutePlan = {
    waypoints: [{ x: 0, z: 0 }],
    entranceIndex: -1,
    enteredFromEntrance: false,
    length: 0,
    outline,
    spacing,
    roomWidth: venue.roomWidth,
    roomDepth: venue.roomDepth,
  };
  if (!start) {
    const fallback = aim?.point ?? (inside(centroid(outline), outline) ? centroid(outline) : { x: 0, z: 0 });
    return { ...empty, waypoints: [fallback] };
  }
  const waypoints = tour(cells, start.index, colliders, outline, room, spacing);
  const entered = aim !== null && Math.hypot(waypoints[0]!.x - aim.point.x, waypoints[0]!.z - aim.point.z) <= Math.max(1.8, spacing * 1.6);
  return {
    waypoints,
    entranceIndex: entered ? 0 : -1,
    enteredFromEntrance: entered,
    length: loopLength(waypoints),
    outline,
    spacing,
    roomWidth: venue.roomWidth,
    roomDepth: venue.roomDepth,
  };
}

export function crowdPointInside(plan: CrowdRoutePlan, point: CrowdPoint): boolean {
  return inside(point, plan.outline);
}

export function createCrowdWalkers(
  plan: CrowdRoutePlan,
  count = CROWD_MAX,
  colliders: readonly WalkCollider[] = [],
): CrowdWalker[] {
  const n = Math.max(0, Math.min(CROWD_MAX, Math.floor(count)));
  const origin = plan.waypoints[0] ?? { x: 0, z: 0 };
  const ahead = plan.waypoints[1] ?? origin;
  const facing = Math.atan2(ahead.x - origin.x, ahead.z - origin.z);
  const walkers: CrowdWalker[] = [];
  for (let i = 0; i < n; i++) {
    const spot = standingSpot(plan, i, origin, ahead, colliders);
    walkers.push({
      x: spot.x,
      z: spot.z,
      facing,
      next: plan.waypoints.length > 1 ? 1 : 0,
      pause: i * STAGGER_SECONDS,
      phase: i * 0.9,
      speed: 0.82 + i * 0.1,
      stuck: 0,
    });
  }
  return walkers;
}

/**
 * 沿动线走一帧。返回 true 表示脚真的挪了（调用方才摆走路姿势、才要求重绘）。
 * 原地等、被挡住、或动线只有一个点时返回 false，不抖。
 */
export function stepCrowdWalker(
  walker: CrowdWalker,
  plan: CrowdRoutePlan,
  colliders: readonly WalkCollider[],
  delta: number,
): boolean {
  if (walker.pause > 0) {
    walker.pause = Math.max(0, walker.pause - delta);
    return false;
  }
  const waypoints = plan.waypoints;
  if (waypoints.length < 2) return false;
  const len = waypoints.length;
  walker.next = ((walker.next % len) + len) % len;
  const target = waypoints[walker.next]!;
  const dx = target.x - walker.x;
  const dz = target.z - walker.z;
  const distance = Math.hypot(dx, dz);
  if (distance <= ARRIVE) {
    const arrived = walker.next;
    walker.next = (arrived + 1) % len;
    walker.stuck = 0;
    if (plan.enteredFromEntrance && arrived === 0) walker.pause = 0.35;
    return false;
  }

  const step = Math.min(distance, walker.speed * delta);
  const to = { x: walker.x + (dx / distance) * step, z: walker.z + (dz / distance) * step };
  const out: WalkerPosition = { x: walker.x, z: walker.z };
  resolveWalkerStep(colliders, walker, to, CROWD_WALKER_RADIUS, out, {
    roomWidth: plan.roomWidth,
    roomDepth: plan.roomDepth,
  });
  if (!inside(out, plan.outline)) {
    noteStuck(walker, plan, colliders, delta);
    return false;
  }
  const gained = Math.hypot(out.x - walker.x, out.z - walker.z);
  if (gained < 0.004) {
    noteStuck(walker, plan, colliders, delta);
    return false;
  }
  walker.facing = Math.atan2(out.x - walker.x, out.z - walker.z);
  walker.x = out.x;
  walker.z = out.z;
  walker.phase += delta * walker.speed * 7;
  walker.stuck = 0;
  return true;
}

function noteStuck(
  walker: CrowdWalker,
  plan: CrowdRoutePlan,
  colliders: readonly WalkCollider[],
  delta: number,
): void {
  walker.stuck += delta;
  if (walker.stuck < STUCK_SECONDS) return;
  walker.stuck = 0;
  if (!retarget(walker, plan, colliders)) walker.pause = 0.8;
}

function retarget(walker: CrowdWalker, plan: CrowdRoutePlan, colliders: readonly WalkCollider[]): boolean {
  const waypoints = plan.waypoints;
  const len = waypoints.length;
  for (let k = 1; k < len; k++) {
    const idx = (walker.next + k) % len;
    const point = waypoints[idx]!;
    if (!segmentClear(walker, point, colliders, plan)) continue;
    walker.next = idx;
    return true;
  }
  return false;
}

function segmentClear(
  from: CrowdPoint,
  to: CrowdPoint,
  colliders: readonly WalkCollider[],
  plan: CrowdRoutePlan,
): boolean {
  if (!segmentInside(from, to, plan.outline)) return false;
  const out: WalkerPosition = { x: from.x, z: from.z };
  resolveWalkerStep(colliders, from, to, CROWD_WALKER_RADIUS, out, {
    roomWidth: plan.roomWidth,
    roomDepth: plan.roomDepth,
  });
  return Math.hypot(out.x - to.x, out.z - to.z) < 0.3 && inside(out, plan.outline);
}

function standingSpot(
  plan: CrowdRoutePlan,
  index: number,
  origin: CrowdPoint,
  ahead: CrowdPoint,
  colliders: readonly WalkCollider[],
): CrowdPoint {
  if (index === 0) return origin;
  const dx = ahead.x - origin.x;
  const dz = ahead.z - origin.z;
  const len = Math.hypot(dx, dz) || 1;
  const side = index === 1 ? -1 : 1;
  const candidate = {
    x: origin.x + (-dz / len) * side * QUEUE_OFFSET,
    z: origin.z + (dx / len) * side * QUEUE_OFFSET,
  };
  if (spotFree(candidate, plan, colliders)) return candidate;
  return origin;
}

function spotFree(point: CrowdPoint, plan: CrowdRoutePlan, colliders: readonly WalkCollider[]): boolean {
  if (!inside(point, plan.outline) || distanceToOutline(point, plan.outline) < 0.2) return false;
  const out: WalkerPosition = { x: point.x, z: point.z };
  resolveWalkerStep(colliders, point, point, CROWD_WALKER_RADIUS, out, {
    roomWidth: plan.roomWidth,
    roomDepth: plan.roomDepth,
  });
  return Math.hypot(out.x - point.x, out.z - point.z) < 0.05;
}

function editorOutline(venue: CrowdVenue): CrowdPoint[] {
  const source = venue.polygon && venue.polygon.length >= 3
    ? venue.polygon
    : [
        { x: 0, z: 0 },
        { x: venue.roomWidth, z: 0 },
        { x: venue.roomWidth, z: venue.roomDepth },
        { x: 0, z: venue.roomDepth },
      ];
  return source.map((point) => ({
    x: point.x - venue.roomWidth / 2,
    z: point.z - venue.roomDepth / 2,
  }));
}

function chooseSpacing(roomWidth: number, roomDepth: number): number {
  const longSide = Math.max(roomWidth, roomDepth);
  if (!Number.isFinite(longSide) || longSide <= 0) return 0.6;
  return Math.max(0.6, longSide / 36);
}

interface GridCell extends CrowdPoint {
  index: number;
  ix: number;
  iz: number;
}

function freeCells(
  outline: readonly CrowdPoint[],
  colliders: readonly WalkCollider[],
  spacing: number,
  room: { roomWidth: number; roomDepth: number },
): GridCell[] {
  const tight = collectCells(outline, colliders, spacing, room, BOUNDARY_CLEARANCE);
  if (tight.length > 0) return tight;
  return collectCells(outline, colliders, spacing, room, 0.05);
}

function collectCells(
  outline: readonly CrowdPoint[],
  colliders: readonly WalkCollider[],
  spacing: number,
  room: { roomWidth: number; roomDepth: number },
  clearance: number,
): GridCell[] {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const point of outline) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minZ = Math.min(minZ, point.z);
    maxZ = Math.max(maxZ, point.z);
  }
  if (!Number.isFinite(minX)) return [];
  const cols = Math.max(1, Math.floor((maxX - minX) / spacing));
  const rows = Math.max(1, Math.floor((maxZ - minZ) / spacing));
  const cells: GridCell[] = [];
  for (let iz = 0; iz < rows; iz++) {
    for (let ix = 0; ix < cols; ix++) {
      const point = { x: minX + (ix + 0.5) * spacing, z: minZ + (iz + 0.5) * spacing };
      if (!cellFree(point, outline, colliders, room, clearance)) continue;
      cells.push({ ...point, index: cells.length, ix, iz });
    }
  }
  return cells;
}

function cellFree(
  point: CrowdPoint,
  outline: readonly CrowdPoint[],
  colliders: readonly WalkCollider[],
  room: { roomWidth: number; roomDepth: number },
  clearance: number,
): boolean {
  if (!inside(point, outline) || distanceToOutline(point, outline) < clearance) return false;
  const out: WalkerPosition = { x: point.x, z: point.z };
  resolveWalkerStep(colliders, point, point, CROWD_WALKER_RADIUS, out, room);
  return Math.hypot(out.x - point.x, out.z - point.z) < 0.05;
}

function nearestCell(cells: readonly GridCell[], target: CrowdPoint): { index: number; point: CrowdPoint } | null {
  let best: GridCell | null = null;
  let bestDistance = Infinity;
  for (const cell of cells) {
    const distance = Math.hypot(cell.x - target.x, cell.z - target.z);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = cell;
    }
  }
  return best ? { index: best.index, point: { x: best.x, z: best.z } } : null;
}

function entranceAim(
  venue: CrowdVenue,
  outline: readonly CrowdPoint[],
  colliders: readonly WalkCollider[],
  room: { roomWidth: number; roomDepth: number },
): { point: CrowdPoint } | null {
  if (!venue.mainEntranceId) return null;
  const door = (venue.items ?? NO_ITEMS).find((item) =>
    item.type === 'door' && item.position
    && (item.structuralOpeningId === venue.mainEntranceId || item.venueEntranceId === venue.mainEntranceId || item.id === venue.mainEntranceId),
  );
  if (!door?.position) return null;
  const point = approachFromDoor(
    { x: door.position.x, z: door.position.z },
    door.rotation ?? 0,
    outline,
    colliders,
    room,
  );
  return point ? { point } : null;
}

function approachFromDoor(
  door: CrowdPoint,
  rotation: number,
  outline: readonly CrowdPoint[],
  colliders: readonly WalkCollider[],
  room: { roomWidth: number; roomDepth: number },
): CrowdPoint | null {
  const tx = Math.cos(rotation);
  const tz = -Math.sin(rotation);
  const normals = [{ x: -tz, z: tx }, { x: tz, z: -tx }];
  const ranked = normals.sort((a, b) => normalScore(door, b, outline) - normalScore(door, a, outline));
  for (const normal of ranked) {
    if (normalScore(door, normal, outline) === 0) continue;
    for (let distance = 0.45; distance <= 2.4; distance += 0.2) {
      const point = { x: door.x + normal.x * distance, z: door.z + normal.z * distance };
      if (cellFree(point, outline, colliders, room, BOUNDARY_CLEARANCE)) return point;
      if (cellFree(point, outline, colliders, room, 0.05)) return point;
    }
  }
  return null;
}

function normalScore(door: CrowdPoint, normal: CrowdPoint, outline: readonly CrowdPoint[]): number {
  let score = 0;
  for (let distance = 0.4; distance <= 2; distance += 0.4) {
    if (inside({ x: door.x + normal.x * distance, z: door.z + normal.z * distance }, outline)) score += 1;
  }
  return score;
}

function tour(
  cells: readonly GridCell[],
  startIndex: number,
  colliders: readonly WalkCollider[],
  outline: readonly CrowdPoint[],
  room: { roomWidth: number; roomDepth: number },
  spacing: number,
): CrowdPoint[] {
  const adj = adjacency(cells, colliders, outline, room, spacing);
  const fromStart = bfs(adj, startIndex);
  const farA = argmax(fromStart.dist);
  const fromA = bfs(adj, farA);
  const farB = argmax(fromA.dist);
  const fromB = bfs(adj, farB);
  const outbound = joinPaths([
    reconstruct(fromStart.parent, startIndex, farA, cells),
    reconstruct(fromA.parent, farA, farB, cells).slice(1),
  ]);
  const back = reconstruct(fromB.parent, farB, startIndex, cells);
  const home = cells[startIndex];
  const far = cells[farB];
  const returned = !!home && !!far && back.length > 1
    && back[0]?.x === far.x && back[0]?.z === far.z
    && back[back.length - 1]?.x === home.x && back[back.length - 1]?.z === home.z;
  if (returned) return joinPaths([outbound, back.slice(1)]);
  return joinPaths([outbound, [...outbound].reverse().slice(1)]);
}

function adjacency(
  cells: readonly GridCell[],
  colliders: readonly WalkCollider[],
  outline: readonly CrowdPoint[],
  room: { roomWidth: number; roomDepth: number },
  spacing: number,
): number[][] {
  const byGrid = new Map<string, number>();
  for (const cell of cells) byGrid.set(`${cell.ix},${cell.iz}`, cell.index);
  const adj: number[][] = cells.map(() => []);
  const gate: CrowdRoutePlan = {
    outline,
    roomWidth: room.roomWidth,
    roomDepth: room.roomDepth,
    waypoints: [],
    entranceIndex: -1,
    enteredFromEntrance: false,
    length: 0,
    spacing,
  };
  for (const cell of cells) {
    for (const [ox, oz] of [[1, 0], [0, 1]] as const) {
      const neighbor = byGrid.get(`${cell.ix + ox},${cell.iz + oz}`);
      if (neighbor === undefined || neighbor <= cell.index) continue;
      const other = cells[neighbor];
      if (!other || Math.hypot(other.x - cell.x, other.z - cell.z) > spacing * 1.2) continue;
      if (!segmentClear(cell, other, colliders, gate) || !segmentClear(other, cell, colliders, gate)) continue;
      adj[cell.index]!.push(neighbor);
      adj[neighbor]!.push(cell.index);
    }
  }
  return adj;
}

function bfs(adj: readonly number[][], start: number): { dist: number[]; parent: number[] } {
  const dist = new Array<number>(adj.length).fill(-1);
  const parent = new Array<number>(adj.length).fill(-1);
  const queue = [start];
  dist[start] = 0;
  for (let head = 0; head < queue.length; head++) {
    const index = queue[head]!;
    for (const next of adj[index] ?? []) {
      if (dist[next] !== -1) continue;
      dist[next] = dist[index]! + 1;
      parent[next] = index;
      queue.push(next);
    }
  }
  return { dist, parent };
}

function argmax(dist: readonly number[]): number {
  let best = 0;
  let bestDistance = -1;
  for (let i = 0; i < dist.length; i++) {
    const distance = dist[i] ?? -1;
    if (distance > bestDistance) {
      bestDistance = distance;
      best = i;
    }
  }
  return best;
}

function reconstruct(parent: readonly number[], from: number, to: number, cells: readonly GridCell[]): CrowdPoint[] {
  const reversed: CrowdPoint[] = [];
  let index = to;
  for (let guard = 0; index !== -1 && guard <= parent.length; guard++) {
    const cell = cells[index];
    if (!cell) break;
    reversed.push({ x: cell.x, z: cell.z });
    if (index === from) break;
    index = parent[index] ?? -1;
  }
  reversed.reverse();
  const start = cells[from];
  const head = reversed[0];
  if (!start || !head || head.x !== start.x || head.z !== start.z) return start ? [{ x: start.x, z: start.z }] : [];
  return reversed;
}

function joinPaths(parts: readonly (readonly CrowdPoint[])[]): CrowdPoint[] {
  const out: CrowdPoint[] = [];
  for (const part of parts) {
    for (const point of part) {
      const last = out[out.length - 1];
      if (last && Math.hypot(last.x - point.x, last.z - point.z) < 1e-3) continue;
      out.push({ x: point.x, z: point.z });
    }
  }
  if (out.length > 1) {
    const first = out[0]!;
    const last = out[out.length - 1]!;
    if (Math.hypot(first.x - last.x, first.z - last.z) < 1e-3) out.pop();
  }
  return out.length > 0 ? out : [{ x: 0, z: 0 }];
}

function loopLength(waypoints: readonly CrowdPoint[]): number {
  if (waypoints.length < 2) return 0;
  let length = 0;
  for (let i = 0; i < waypoints.length; i++) {
    const next = waypoints[(i + 1) % waypoints.length]!;
    const point = waypoints[i]!;
    length += Math.hypot(next.x - point.x, next.z - point.z);
  }
  return length;
}

function segmentInside(from: CrowdPoint, to: CrowdPoint, outline: readonly CrowdPoint[]): boolean {
  const distance = Math.hypot(to.x - from.x, to.z - from.z);
  const steps = Math.max(1, Math.ceil(distance / 0.3));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    if (!inside({ x: from.x + (to.x - from.x) * t, z: from.z + (to.z - from.z) * t }, outline)) return false;
  }
  return true;
}

function inside(point: CrowdPoint, outline: readonly CrowdPoint[]): boolean {
  if (outline.length < 3) return true;
  if (distanceToOutline(point, outline) <= 1e-4) return true;
  let crossings = false;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const a = outline[j]!;
    const b = outline[i]!;
    if ((a.z > point.z) === (b.z > point.z)) continue;
    const x = ((b.x - a.x) * (point.z - a.z)) / (b.z - a.z) + a.x;
    if (point.x < x) crossings = !crossings;
  }
  return crossings;
}

function distanceToOutline(point: CrowdPoint, outline: readonly CrowdPoint[]): number {
  let best = Infinity;
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i]!;
    const b = outline[(i + 1) % outline.length]!;
    best = Math.min(best, distanceToSegment(point.x, point.z, a.x, a.z, b.x, b.z));
  }
  return best;
}

function distanceToSegment(px: number, pz: number, x1: number, z1: number, x2: number, z2: number): number {
  const vx = x2 - x1;
  const vz = z2 - z1;
  const lengthSquared = vx * vx + vz * vz;
  if (lengthSquared < 1e-9) return Math.hypot(px - x1, pz - z1);
  const t = Math.max(0, Math.min(1, ((px - x1) * vx + (pz - z1) * vz) / lengthSquared));
  return Math.hypot(px - (x1 + t * vx), pz - (z1 + t * vz));
}

function centroid(outline: readonly CrowdPoint[]): CrowdPoint {
  if (outline.length === 0) return { x: 0, z: 0 };
  let x = 0;
  let z = 0;
  for (const point of outline) {
    x += point.x;
    z += point.z;
  }
  return { x: x / outline.length, z: z / outline.length };
}
