import { MAX_ROOM_DIMENSION } from './constants';
import { totalCost } from './geometry';
import type { FurnitureItem, RoomZone, Vec2 } from './types';
import { ZONE_SEMANTIC_LABELS } from '../../../lib/plan-annotation';
import {
  itemsInZoneRing,
  rectToRing,
  ringArea,
  ringStats,
  ringsOverlap,
  zoneContainsRing,
  type RingPlacedItem,
} from './zone-polygon';
import type { PlanPoint } from '../../../../supabase/functions/_shared/site-plan';

/**
 * Room zones (#155): named, coloured polygons a floor is divided into by
 * hand — "Bedroom", "Kitchen" — so the plan, the blueprint and the stats
 * panel can measure and cost each room. Interior walls don't bound space
 * (a documented limitation), so a zone is the user's own say on where a
 * room is; an item belongs to a zone when its centre lies inside its ring.
 *
 * D5-3 (2026-11-27): RoomZone 几何从矩形 `x/z/w/d` 切到多边形环（房间中心帧
 * `Vec2{x,z}`）。旧快照矩形只在读取/水合阶段实时展环，不回写、不批量迁移；
 * 归属/面积/统计复用 D5-1 `zone-polygon` 的 plan 帧原语，z↔y 映射只在本适配层。
 * 矩形草稿/脚本/场景契约边界仍用 `ZoneRect`，转换在各自适配层完成。
 * Everything here is pure: the validation the schema uses, the draft rectangle
 * normalisation the 2D draw gesture shares, and the stats.
 */

export const MAX_ZONES = 32;
/** A drawn rectangle thinner than this on either side is a slip, not a room. */
export const MIN_ZONE_SIZE = 0.3;
/** Drawn corners round to this many metres so areas read as clean numbers. */
const ZONE_GRID = 0.1;

/** Fill / label colours handed out in turn as zones are added. */
export const ZONE_COLORS: readonly string[] = [
  '#3b82f6',
  '#f59e0b',
  '#10b981',
  '#ec4899',
  '#8b5cf6',
  '#14b8a6',
  '#ef4444',
  '#f97316',
];

/**
 * 草稿/脚本/场景契约边界用的轴对齐矩形（米，房间中心帧）。RoomZone 本身已是环，
 * 这个形状只在矩形输入边界（拖框草稿、scene-script、sceneZoneSchema 适配层）出现。
 */
export interface ZoneRect {
  x: number;
  z: number;
  w: number;
  d: number;
}

export interface ZoneStats {
  itemCount: number;
  /** Sum of the prices of the items inside, in §. */
  cost: number;
  /** Ring area, in m². */
  area: number;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isVec2Point(value: unknown): value is Vec2 {
  return isPlainObject(value) && isFiniteNumber(value.x) && isFiniteNumber(value.z);
}

// -- plan 帧 ↔ 房间中心帧适配：plan 点 {x,y}，房间点 {x,z}，y 映射到 z。 ----------
const toPlanPoint = (point: Vec2): PlanPoint => ({ x: point.x, y: point.z });
const toRoomPoint = (point: PlanPoint): Vec2 => ({ x: point.x, z: point.y });
/** 房间中心帧环 → plan 帧环（z↔y）；几何判定全部在 plan 帧原语上做。 */
const toPlanRing = (ring: readonly Vec2[]): PlanPoint[] => ring.map(toPlanPoint);

/**
 * 多边形环校验：3 点以上、每点有限且有界。不做自交/面积判定（那是 plan 链
 * `checkZoneRing` 的职责；legacy 水合只保证可读几何）。
 */
export function isZonePolygon(value: unknown): value is readonly Vec2[] {
  if (!Array.isArray(value) || value.length < 3) return false;
  return value.every((point) => isVec2Point(point)
    && Math.abs(point.x) <= MAX_ROOM_DIMENSION
    && Math.abs(point.z) <= MAX_ROOM_DIMENSION);
}

/**
 * Bounded like a room dimension: a non-finite corner or a zero, negative or
 * absurd size must not reach the renderer (it would paint nothing, or a
 * rectangle the size of the street).
 */
export function isZoneRect(value: unknown): value is ZoneRect {
  if (!isPlainObject(value)) return false;
  const v = value;
  return (
    isFiniteNumber(v.x) &&
    isFiniteNumber(v.z) &&
    Math.abs(v.x) <= MAX_ROOM_DIMENSION &&
    Math.abs(v.z) <= MAX_ROOM_DIMENSION &&
    isFiniteNumber(v.w) &&
    isFiniteNumber(v.d) &&
    v.w > 0 &&
    v.d > 0 &&
    v.w <= MAX_ROOM_DIMENSION &&
    v.d <= MAX_ROOM_DIMENSION
  );
}

/** Missing is a valid legacy value; malformed present values must be rejected. */
export function isValidZoneType(value: unknown): boolean {
  return value === undefined || typeof value === 'string' && Object.hasOwn(ZONE_SEMANTIC_LABELS, value);
}

/**
 * 可读为一个分区：新形状（polygon 环）或旧快照矩形都认；校验通过后由
 * `hydrateRoomZone` 统一落成环形状。
 */
export function isRoomZone(value: unknown): value is RoomZone {
  if (!isPlainObject(value)) return false;
  const v = value;
  const geometryOk = isZonePolygon(v.polygon) || isZoneRect(v);
  return geometryOk
    && typeof v.id === 'string'
    && typeof v.name === 'string'
    && typeof v.color === 'string'
    && isValidZoneType(v.zoneType);
}

/** 旧矩形 → 四角环（房间中心帧）；矩形无效返回 null。 */
export function rectToZoneRing(rect: ZoneRect): Vec2[] | null {
  const ring = rectToRing({ x: rect.x, y: rect.z, w: rect.w, h: rect.d });
  return ring ? ring.map(toRoomPoint) : null;
}

/**
 * 读侧水合：把可读的旧矩形快照展成环；已是环则原样保留点。落不了环返回 null，
 * 调用方丢弃该分区。不回写旧快照、不做批量迁移。
 */
export function hydrateRoomZone(value: {
  id: string;
  name: string;
  color: string;
  zoneType?: RoomZone['zoneType'];
  polygon?: unknown;
  x?: unknown;
  z?: unknown;
  w?: unknown;
  d?: unknown;
}): RoomZone | null {
  const polygon = isZonePolygon(value.polygon)
    ? value.polygon
    : isZoneRect(value)
      ? rectToZoneRing(value as ZoneRect)
      : null;
  if (!polygon) return null;
  return {
    id: value.id,
    name: value.name,
    color: value.color,
    ...(value.zoneType === undefined ? {} : { zoneType: value.zoneType }),
    polygon,
  };
}

/**
 * The rectangle spanned by two dragged corners (any order), rounded to
 * ZONE_GRID and clamped to the room's footprint; `null` when what's left
 * is too small to be a room. 2D 拖框草稿用；落区边界再把矩形展成环。
 */
export function zoneFromCorners(a: Vec2, b: Vec2, roomWidth: number, roomDepth: number): ZoneRect | null {
  const halfW = roomWidth / 2;
  const halfD = roomDepth / 2;
  const x0 = clamp(round(Math.min(a.x, b.x)), -halfW, halfW);
  const x1 = clamp(round(Math.max(a.x, b.x)), -halfW, halfW);
  const z0 = clamp(round(Math.min(a.z, b.z)), -halfD, halfD);
  const z1 = clamp(round(Math.max(a.z, b.z)), -halfD, halfD);
  const w = round(x1 - x0);
  const d = round(z1 - z0);
  if (!(w >= MIN_ZONE_SIZE) || !(d >= MIN_ZONE_SIZE)) return null;
  return { x: x0, z: z0, w, d };
}

/** `zoneFromCorners` for a rectangle already expressed as corner + size. */
export function clampZoneRect(rect: ZoneRect, roomWidth: number, roomDepth: number): ZoneRect | null {
  if (!isZoneRect(rect)) return null;
  return zoneFromCorners({ x: rect.x, z: rect.z }, { x: rect.x + rect.w, z: rect.z + rect.d }, roomWidth, roomDepth);
}

/** Inclusive on every edge, so an item centred on a shared boundary counts for both zones. */
export function zoneContains(zone: RoomZone, point: Vec2): boolean {
  return zoneContainsRing(toPlanRing(zone.polygon), toPlanPoint(point));
}

/** The items whose centre lies inside the zone (unplaced items never do). */
export function itemsInZone(zone: RoomZone, items: readonly FurnitureItem[]): FurnitureItem[] {
  const ringItems: RingPlacedItem[] = items.map((item) => ({
    id: item.id,
    ...(item.price !== undefined ? { price: item.price } : {}),
    ...(item.position ? { position: toPlanPoint(item.position) } : {}),
  }));
  const insideIds = new Set(itemsInZoneRing(toPlanRing(zone.polygon), ringItems).map((item) => item.id));
  return items.filter((item) => insideIds.has(item.id));
}

export function zoneArea(zone: RoomZone): number {
  return ringArea(toPlanRing(zone.polygon));
}

export function zoneStats(zone: RoomZone, items: readonly FurnitureItem[]): ZoneStats {
  const inside = itemsInZone(zone, items);
  const stats = ringStats(toPlanRing(zone.polygon), ringItemsFor(inside));
  return { itemCount: inside.length, cost: totalCost(inside), area: stats.area };
}

function ringItemsFor(items: readonly FurnitureItem[]): RingPlacedItem[] {
  return items.map((item) => ({
    id: item.id,
    ...(item.price !== undefined ? { price: item.price } : {}),
    ...(item.position ? { position: toPlanPoint(item.position) } : {}),
  }));
}

/**
 * 环是否整段落在房间 footprint 内（房间中心帧）：每点有限、且在 ±halfW/±halfD
 * 容差内。矩形时代的 `clampZoneRect` 是把框夹进 footprint；多边形不可反解缩放，
 * 超界即拒收（写入方负责在 footprint 内取点）。
 */
export function ringFitsFootprint(
  ring: readonly Vec2[],
  roomWidth: number,
  roomDepth: number
): boolean {
  if (ring.length < 3) return false;
  const halfW = roomWidth / 2;
  const halfD = roomDepth / 2;
  return ring.every((point) =>
    Number.isFinite(point.x) && Number.isFinite(point.z)
    && Math.abs(point.x) <= halfW + 1e-6
    && Math.abs(point.z) <= halfD + 1e-6
  );
}

/** 环间严格内部交集；共边/顶点触碰不算重叠（对齐 plan 链原语口径）。 */
export function zonesOverlap(a: RoomZone, b: RoomZone): boolean {
  return ringsOverlap(toPlanRing(a.polygon), toPlanRing(b.polygon));
}

/** 房间中心帧两环重叠判定（草稿环 ↔ 已存环用）。 */
export function roomRingsOverlap(a: readonly Vec2[], b: readonly Vec2[]): boolean {
  return ringsOverlap(toPlanRing(a), toPlanRing(b));
}

/** 环在房间中心帧的外接矩形 {x,z,w,d}；仅供导出/适配层做矩形回退展示。 */
export function zoneBBox(zone: RoomZone): { x: number; z: number; w: number; d: number } {
  const xs = zone.polygon.map((point) => point.x);
  const zs = zone.polygon.map((point) => point.z);
  const minX = Math.min(...xs);
  const minZ = Math.min(...zs);
  return { x: minX, z: minZ, w: Math.max(...xs) - minX, d: Math.max(...zs) - minZ };
}

/** 环质心（房间中心帧）；退化环回落到外接框中心。 */
export function zoneCentroid(zone: RoomZone): Vec2 {
  const ring = zone.polygon;
  let signedArea = 0;
  let cx = 0;
  let cz = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const p = ring[i]!;
    const q = ring[(i + 1) % ring.length]!;
    const cross = p.x * q.z - q.x * p.z;
    signedArea += cross;
    cx += (p.x + q.x) * cross;
    cz += (p.z + q.z) * cross;
  }
  if (Math.abs(signedArea) < 1e-9) {
    const bbox = zoneBBox(zone);
    return { x: bbox.x + bbox.w / 2, z: bbox.z + bbox.d / 2 };
  }
  return { x: cx / (3 * signedArea), z: cz / (3 * signedArea) };
}

/** The first palette colour no zone uses yet, cycling once they're all taken. */
export function nextZoneColor(existing: readonly RoomZone[]): string {
  const used = new Set(existing.map((zone) => zone.color));
  const free = ZONE_COLORS.find((color) => !used.has(color));
  return free ?? ZONE_COLORS[existing.length % ZONE_COLORS.length]!;
}

/** "Zone 1", "Zone 2", … — the first number no zone on the floor is named after. */
export function defaultZoneName(existing: readonly RoomZone[]): string {
  const names = new Set(existing.map((zone) => zone.name));
  for (let n = 1; ; n++) {
    const name = `Zone ${n}`;
    if (!names.has(name)) return name;
  }
}

/** Field-wise equality, so re-submitting a zone unchanged keeps state identity. */
export function sameZone(a: RoomZone, b: RoomZone): boolean {
  if (a.id !== b.id || a.name !== b.name || a.color !== b.color || a.zoneType !== b.zoneType) return false;
  const aRing = a.polygon;
  const bRing = b.polygon;
  if (aRing.length !== bRing.length) return false;
  return aRing.every((point, index) => point.x === bRing[index]!.x && point.z === bRing[index]!.z);
}

function round(value: number): number {
  const steps = 1 / ZONE_GRID;
  return Math.round(value * steps) / steps;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
