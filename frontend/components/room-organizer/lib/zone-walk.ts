/**
 * B2 分区漫游（纯几何 + 规划，零 three / React）。
 *
 * 口径（用户 2026-11-17）：「从外面进入一个分区，就在这个分区里自由活动。」
 * 实现方式仍然是「换一条路线」——进区、区内走动、出区回线各生成一条折线，
 * 位移交给 `lib/person-route.ts` 的 follower，碰撞、转向、卡死掉头全部复用。
 *
 * 本模块只回答四个问题：
 * 1. 流线从哪儿进入分区（`zoneCrossingsAlong`）；
 * 2. 从那个口往区里走多深算进门（`zoneEntryPoint`）；
 * 3. 区里能走成一条什么线（`planZoneWalk`：网格采样 + 连通分量 + 取远端再折回）；
 * 4. 出区该接回流线哪一点（`projectOnPolyline`）。
 *
 * 坐标系：与调用方一致（户外为「路线局部」：场地中心原点，x 东、z 南）。
 * 不掷骰子：所有选择按距离 + 下标 tie-break，同一份输入两次结果相同。
 */
import { resolveWalkerStep, type WalkCollider } from './walk-collision';
import type { Vec2 } from './types';

export const ZONE_ENTER_CHANCE = 0.55;
export const ZONE_WALK_INSET_M = 0.8;

export interface ZoneRing {
  id: string;
  polygon: readonly Vec2[];
}

export interface ZoneCrossing {
  zoneId: string;
  /** 穿越点（多边形边上）。 */
  x: number;
  z: number;
  /** 沿折线的弧长（米）。 */
  along: number;
}

/**
 * 沿折线每 `step` 米采样，找出「从区外走进区内」的采样点。
 * 只认外→内：单向流线的反向穿越、从区里走出去，都不算进区。
 */
export function zoneCrossingsAlong(
  points: readonly Vec2[],
  zones: readonly ZoneRing[],
  step = 0.5
): ZoneCrossing[] {
  if (points.length < 2 || zones.length === 0) return [];
  const crossings: ZoneCrossing[] = [];
  let previous = zoneAt(points[0]!, zones);
  let along = 0;
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1]!;
    const b = points[index]!;
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    const steps = Math.max(1, Math.ceil(length / step));
    for (let k = 1; k <= steps; k += 1) {
      const t = k / steps;
      const point = { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
      const zone = zoneAt(point, zones);
      if (previous === null && zone !== null) {
        crossings.push({ zoneId: zone, x: point.x, z: point.z, along: along + length * t });
      }
      previous = zone;
    }
    along += length;
  }
  return crossings;
}

/** 分区内第一个包含该点的分区 id（与 `inferZoneIdAt` 的「第一个命中」同口径）。 */
export function zoneAt(point: Vec2, zones: readonly ZoneRing[]): string | null {
  for (const zone of zones) {
    if (zone.polygon.length >= 3 && pointInPolygon(point, zone.polygon)) return zone.id;
  }
  return null;
}

/** 从穿越点往区里让 `inset` 米：沿「穿越点 → 多边形质心」方向推进。 */
export function zoneEntryPoint(crossing: Vec2, polygon: readonly Vec2[], inset = ZONE_WALK_INSET_M): Vec2 {
  const center = centroid(polygon);
  const dx = center.x - crossing.x;
  const dz = center.z - crossing.z;
  const length = Math.hypot(dx, dz);
  if (length < 1e-6) return { x: crossing.x, z: crossing.z };
  const scale = Math.min(1, inset / length);
  return { x: crossing.x + dx * scale, z: crossing.z + dz * scale };
}

export interface ZoneWalkOptions {
  bounds?: { minX: number; minZ: number; maxX: number; maxZ: number };
  colliders?: readonly WalkCollider[];
  /** 与 `PERSON_WALK_RADIUS` 对齐的离墙余量（米）。 */
  clearance?: number;
  /** 最多几个路点：区内走动不该变成一长串锯齿。 */
  maxPoints?: number;
}

export interface ZoneWalkPlan {
  zoneId: string;
  points: Vec2[];
  loop: boolean;
}

/**
 * 区内行走折线：网格采样出可走格 → 4 邻接连通 → 取「离入口最远的连通点」→
 * 去程 + 原路折回。回来时仍走这条路，所以不需要额外寻路。
 *
 * 无可走格（分区太窄 / 全被挡住）时返回 null：调用方直接回线，不硬走。
 */
export function planZoneWalk(
  zone: ZoneRing,
  from: Vec2,
  options: ZoneWalkOptions = {}
): ZoneWalkPlan | null {
  const polygon = zone.polygon;
  if (polygon.length < 3) return null;
  const clearance = options.clearance ?? 0.35;
  const colliders = options.colliders ?? [];
  const bounds = options.bounds;
  const maxPoints = Math.max(2, options.maxPoints ?? 8);
  const box = boundsOf(polygon, bounds);
  if (!box) return null;
  const span = Math.max(box.maxX - box.minX, box.maxZ - box.minZ);
  const spacing = Math.max(0.7, Math.min(1.6, span / 12));

  const cols = Math.max(1, Math.floor((box.maxX - box.minX) / spacing));
  const rows = Math.max(1, Math.floor((box.maxZ - box.minZ) / spacing));
  const cells: { x: number; z: number; ix: number; iz: number; index: number }[] = [];
  for (let iz = 0; iz < rows; iz += 1) {
    for (let ix = 0; ix < cols; ix += 1) {
      const point = { x: box.minX + (ix + 0.5) * spacing, z: box.minZ + (iz + 0.5) * spacing };
      if (!pointInPolygon(point, polygon)) continue;
      if (bounds && !insideBounds(point, bounds)) continue;
      if (distanceToPolygon(point, polygon) < clearance) continue;
      if (!freeAt(point, colliders, clearance)) continue;
      cells.push({ ...point, ix, iz, index: cells.length });
    }
  }
  if (cells.length === 0) return null;

  const start = nearestCell(cells, from);
  if (!start) return null;
  const byGrid = new Map<string, number>();
  for (const cell of cells) byGrid.set(`${cell.ix},${cell.iz}`, cell.index);
  const neighbours = cells.map(() => [] as number[]);
  for (const cell of cells) {
    for (const [ox, oz] of [[1, 0], [0, 1]] as const) {
      const other = byGrid.get(`${cell.ix + ox},${cell.iz + oz}`);
      if (other === undefined) continue;
      const a = cells[cell.index]!;
      const b = cells[other]!;
      if (!clearBetween(a, b, colliders)) continue;
      neighbours[cell.index]!.push(other);
      neighbours[other]!.push(cell.index);
    }
  }

  const { dist, parent } = bfs(neighbours, start.index);
  const far = argmax(dist);
  if (far === start.index) return null;
  const outbound = reconstruct(parent, start.index, far, cells);
  const full = [...outbound, ...[...outbound].reverse().slice(1)];
  const simplified = stride(full, maxPoints);
  if (simplified.length < 2) return null;
  return { zoneId: zone.id, points: simplified, loop: false };
}

/** 点在线段折线上的投影：出区时用它找重返点。 */
export function projectOnPolyline(
  points: readonly Vec2[],
  point: Vec2
): { x: number; z: number; along: number; gap: number } {
  let best = { x: points[0]?.x ?? 0, z: points[0]?.z ?? 0, along: 0, gap: Infinity };
  let walked = 0;
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1]!;
    const b = points[index]!;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const length = Math.hypot(dx, dz);
    const t = length > 1e-9
      ? Math.min(1, Math.max(0, ((point.x - a.x) * dx + (point.z - a.z) * dz) / (length * length)))
      : 0;
    const x = a.x + dx * t;
    const z = a.z + dz * t;
    const gap = Math.hypot(point.x - x, point.z - z);
    if (gap < best.gap) best = { x, z, along: walked + length * t, gap };
    walked += length;
  }
  return best;
}

/** 进区概率：按人 + 圈数确定，不每帧掷骰子。 */
export function shouldEnterZone(seed: string, laps: number, chance = ZONE_ENTER_CHANCE): boolean {
  return (hashText(`${seed}:${laps}`) % 1000) / 1000 < chance;
}

/** 区内停留预算（秒）。 */
export function zoneDwellSeconds(
  seed: string,
  zoneId: string,
  range: readonly [number, number] = [20, 45]
): number {
  const [lo, hi] = range;
  return lo + ((hashText(`${seed}:${zoneId}`) % 1000) / 1000) * (hi - lo);
}

/**
 * FNV-1a + 尾部混淆。
 *
 * 不用 `h*31+c`：末位差 1 的种子（`p1:3` / `p1:4`）算出来也只差 1，取模后会形成
 * 一整段连续值——「每圈掷一次」就退化成「连续 40 圈同一个答案」。
 */
function hashText(text: string): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0x5bd1e995) >>> 0;
  hash ^= hash >>> 15;
  return hash >>> 0;
}

/* ---------------- 几何 ---------------- */

/** 射线法：点在多边形内（边上算内，避免采样点恰好落在边界时抖）。 */
export function pointInPolygon(point: Vec2, polygon: readonly Vec2[]): boolean {
  if (polygon.length < 3) return false;
  if (distanceToPolygon(point, polygon) <= 1e-6) return true;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[j]!;
    const b = polygon[i]!;
    if ((a.z > point.z) === (b.z > point.z)) continue;
    const x = ((b.x - a.x) * (point.z - a.z)) / (b.z - a.z) + a.x;
    if (point.x < x) inside = !inside;
  }
  return inside;
}

export function distanceToPolygon(point: Vec2, polygon: readonly Vec2[]): number {
  let best = Infinity;
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i]!;
    const b = polygon[(i + 1) % polygon.length]!;
    best = Math.min(best, distanceToSegment(point, a, b));
  }
  return best;
}

function distanceToSegment(point: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const lengthSquared = dx * dx + dz * dz;
  if (lengthSquared < 1e-12) return Math.hypot(point.x - a.x, point.z - a.z);
  const t = Math.min(1, Math.max(0, ((point.x - a.x) * dx + (point.z - a.z) * dz) / lengthSquared));
  return Math.hypot(point.x - (a.x + dx * t), point.z - (a.z + dz * t));
}

function centroid(polygon: readonly Vec2[]): Vec2 {
  let x = 0;
  let z = 0;
  for (const point of polygon) {
    x += point.x;
    z += point.z;
  }
  return { x: x / polygon.length, z: z / polygon.length };
}

function boundsOf(polygon: readonly Vec2[], clip?: ZoneWalkOptions['bounds']) {
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const point of polygon) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minZ = Math.min(minZ, point.z);
    maxZ = Math.max(maxZ, point.z);
  }
  if (!Number.isFinite(minX)) return null;
  if (clip) {
    minX = Math.max(minX, clip.minX);
    maxX = Math.min(maxX, clip.maxX);
    minZ = Math.max(minZ, clip.minZ);
    maxZ = Math.min(maxZ, clip.maxZ);
  }
  if (maxX - minX < 0.6 || maxZ - minZ < 0.6) return null;
  return { minX, minZ, maxX, maxZ };
}

function insideBounds(point: Vec2, bounds: NonNullable<ZoneWalkOptions['bounds']>): boolean {
  return point.x >= bounds.minX && point.x <= bounds.maxX && point.z >= bounds.minZ && point.z <= bounds.maxZ;
}

/** 原地推挤为 0 = 这个点站得下人。 */
function freeAt(point: Vec2, colliders: readonly WalkCollider[], clearance: number): boolean {
  if (colliders.length === 0) return true;
  const out = { x: point.x, z: point.z };
  resolveWalkerStep(colliders, point, point, clearance, out);
  return Math.hypot(out.x - point.x, out.z - point.z) < 0.05;
}

function clearBetween(a: Vec2, b: Vec2, colliders: readonly WalkCollider[]): boolean {
  if (colliders.length === 0) return true;
  const out = { x: a.x, z: a.z };
  resolveWalkerStep(colliders, a, b, 0.35, out);
  return Math.hypot(out.x - b.x, out.z - b.z) < 0.3;
}

function nearestCell<T extends Vec2>(cells: readonly T[], from: Vec2): T | null {
  let best: T | null = null;
  let bestGap = Infinity;
  for (const cell of cells) {
    const gap = Math.hypot(cell.x - from.x, cell.z - from.z);
    if (gap < bestGap) {
      best = cell;
      bestGap = gap;
    }
  }
  return best;
}

function bfs(neighbours: readonly number[][], start: number): { dist: number[]; parent: number[] } {
  const dist = new Array<number>(neighbours.length).fill(-1);
  const parent = new Array<number>(neighbours.length).fill(-1);
  const queue = [start];
  dist[start] = 0;
  for (let head = 0; head < queue.length; head += 1) {
    const index = queue[head]!;
    for (const next of neighbours[index] ?? []) {
      if (dist[next] !== -1) continue;
      dist[next] = dist[index]! + 1;
      parent[next] = index;
      queue.push(next);
    }
  }
  return { dist, parent };
}

function argmax(values: readonly number[]): number {
  let best = 0;
  let bestValue = -1;
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i] ?? -1;
    if (value > bestValue) {
      bestValue = value;
      best = i;
    }
  }
  return best;
}

function reconstruct(
  parent: readonly number[],
  from: number,
  to: number,
  cells: readonly Vec2[]
): Vec2[] {
  const reversed: Vec2[] = [];
  let index = to;
  for (let guard = 0; index !== -1 && guard <= parent.length; guard += 1) {
    const cell = cells[index];
    if (!cell) break;
    reversed.push({ x: cell.x, z: cell.z });
    if (index === from) break;
    index = parent[index] ?? -1;
  }
  reversed.reverse();
  return reversed;
}

/** 按等步长抽稀到最多 `maxPoints` 个点，首尾必留。 */
function stride(points: readonly Vec2[], maxPoints: number): Vec2[] {
  if (points.length <= maxPoints) return points.map((point) => ({ x: point.x, z: point.z }));
  const out: Vec2[] = [];
  const step = (points.length - 1) / (maxPoints - 1);
  for (let i = 0; i < maxPoints; i += 1) {
    const point = points[Math.round(i * step)]!;
    out.push({ x: point.x, z: point.z });
  }
  return out;
}
