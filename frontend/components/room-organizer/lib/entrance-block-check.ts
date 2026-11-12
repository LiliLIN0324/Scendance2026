import type { FurnitureItem, RoomLayout } from './types';
import { rotatedHalfExtents } from './geometry';

/**
 * 门口净区检查（对话候选卡用）：门标记在地面的通行投影内有没有家具。
 * 门位置来自场景门洞记录（多为 inferred，不代表现场确认的门位），
 * 本检查只做几何提示，不是通行安全结论。
 */

/** 门口净区深度：取 0.9 m（≈门扇 90 cm 开启弧在地面的投影近似）。 */
const DOOR_CLEAR_DEPTH_M = 0.9;

export interface EntranceBlockReport {
  /** 被家具压住门口净区的门数量。 */
  blockedEntrances: number;
  /** 压住净区的家具名（去重，最多 3 个）。 */
  offenders: string[];
  /** 人话警告；没有门标记或没有压门时为 null（不虚构门位）。 */
  message: string | null;
}

interface Rect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

function itemRect(item: FurnitureItem): Rect | null {
  if (!item.position) return null;
  const { halfW, halfD } = rotatedHalfExtents(item);
  return {
    minX: item.position.x - halfW,
    maxX: item.position.x + halfW,
    minZ: item.position.z - halfD,
    maxZ: item.position.z + halfD,
  };
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.minX < b.maxX - 1e-9 && b.minX < a.maxX - 1e-9 && a.minZ < b.maxZ - 1e-9 && b.minZ < a.maxZ - 1e-9;
}

/** 门标记 → 贴哪面墙 + 门口净区矩形。与 plan-scene-doors 的贴墙判据一致（最近外墙边）。 */
function doorClearRect(item: FurnitureItem, roomWidth: number, roomDepth: number): { rect: Rect; label: string } | null {
  if (!item.position) return null;
  const { x, z } = item.position;
  const widthM = Number.isFinite(item.width) && item.width > 0 ? item.width : 0.9;
  const edges = [
    { wall: 'north' as const, distance: Math.abs(z + roomDepth / 2), position: x },
    { wall: 'south' as const, distance: Math.abs(z - roomDepth / 2), position: x },
    { wall: 'west' as const, distance: Math.abs(x + roomWidth / 2), position: z },
    { wall: 'east' as const, distance: Math.abs(x - roomWidth / 2), position: z },
  ].sort((a, b) => a.distance - b.distance);
  const edge = edges[0]!;
  const tolerance = Math.max(0.2, item.depth / 2 + 0.05);
  if (edge.distance > tolerance) return null;
  const along: Rect =
    edge.wall === 'north' || edge.wall === 'south'
      ? { minX: edge.position - widthM / 2, maxX: edge.position + widthM / 2, minZ: edge.wall === 'north' ? -roomDepth / 2 : roomDepth / 2 - DOOR_CLEAR_DEPTH_M, maxZ: edge.wall === 'north' ? -roomDepth / 2 + DOOR_CLEAR_DEPTH_M : roomDepth / 2 }
      : { minZ: edge.position - widthM / 2, maxZ: edge.position + widthM / 2, minX: edge.wall === 'west' ? -roomWidth / 2 : roomWidth / 2 - DOOR_CLEAR_DEPTH_M, maxX: edge.wall === 'west' ? -roomWidth / 2 + DOOR_CLEAR_DEPTH_M : roomWidth / 2 };
  return { rect: along, label: item.name || '门洞' };
}

function isFurniture(item: FurnitureItem): boolean {
  if (!item.position) return false;
  if (item.type === 'door' || item.type === 'window') return false;
  if (item.structuralOpeningId || item.structuralColumnId || item.venueEntranceId) return false;
  return Number.isFinite(item.width) && Number.isFinite(item.depth) && item.width > 0 && item.depth > 0;
}

export function checkEntranceBlocks(layout: RoomLayout, floorIndex = layout.floors.length - 1): EntranceBlockReport {
  const empty: EntranceBlockReport = { blockedEntrances: 0, offenders: [], message: null };
  const floor = layout.floors[floorIndex];
  const width = layout.width;
  const depth = layout.height;
  if (!floor || !Number.isFinite(width) || !Number.isFinite(depth) || width <= 0 || depth <= 0) return empty;
  const furniture = floor.items.filter(isFurniture);
  if (!furniture.length) return empty;
  const offenders = new Set<string>();
  let blockedEntrances = 0;
  for (const item of floor.items) {
    if (item.type !== 'door' || item.structuralColumnId) continue;
    const door = doorClearRect(item, width, depth);
    if (!door) continue;
    const hits = furniture.filter(furniture => {
      const rect = itemRect(furniture);
      return rect !== null && overlaps(rect, door.rect);
    });
    if (hits.length) {
      blockedEntrances += 1;
      for (const hit of hits) offenders.add(hit.name || hit.type);
    }
  }
  if (!blockedEntrances) return empty;
  const names = [...offenders].slice(0, 3).map(name => `「${name}」`).join('');
  const suffix = offenders.size > 3 ? ' 等' : '';
  return {
    blockedEntrances,
    offenders: [...offenders].slice(0, 3),
    message: `门口被挡：${names}${suffix}压在门口净区上，门可能推不开或过不去；请挪开后重新核对。（门位多为推测，现场以实际门为准）`,
  };
}
