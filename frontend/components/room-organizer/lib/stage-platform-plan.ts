import { hasCollisions } from './geometry';
import { floorKeepOut } from './floor-keep-out';
import { randomSuffix } from './ids';
import { structuralItemCollides } from './structural-layout';
import type { FurnitureItem, RoomLayout } from './types';

export const STAGE_PLATFORM_ASSET_ID = '2476e655-516e-5563-baad-aa821272acb7';
export const STAGE_PLATFORM_URL = '/showcase/assets/library/model/village-hall-and-community-events-stage-platform-modul-208d60a2.glb';
const WIDTH = 2;
const DEPTH = 2.0430251546437157;
const HEIGHT = 0.6000183290813681;

/** 搜索一个可编辑示意模块；不代表现场许可、库存、疏散或无障碍已核验。 */
export function proposeStagePlatform(layout: RoomLayout, floorIndex: number):
  { ok: true; layout: RoomLayout; item: FurnitureItem } | { ok: false; reason: string } {
  const floor = layout.floors[floorIndex], width = layout.width, depth = layout.height;
  if (!floor || !Number.isFinite(width) || !Number.isFinite(depth) || width <= 0 || depth <= 0)
    return { ok: false, reason: '缺少有效场地尺寸或楼层，舞台位置待核对。' };
  const margin = 0.3;
  const minX = -width / 2 + margin + WIDTH / 2, maxX = width / 2 - margin - WIDTH / 2;
  const minZ = -depth / 2 + margin + DEPTH / 2, maxZ = depth / 2 - margin - DEPTH / 2;
  const step = Math.max(0.6, (maxX - minX) / 24, (maxZ - minZ) / 24);
  const doors = [
    ...floor.items.flatMap(item => (item.type === 'door' || item.venueEntranceId || item.structuralOpeningId) && item.position
      ? [{ position: item.position, width: item.width }] : []),
    ...(layout.backendVenue?.entrances ?? layout.backendSceneV2?.venue.entrances ?? []).map(entrance => ({
      position: { x: entrance.position.x - width / 2, z: entrance.position.z - depth / 2 }, width: entrance.width,
    })),
  ];
  const context = { keepOut: floorKeepOut(layout, floorIndex), interiorWalls: floor.interiorWalls ?? [] };
  const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${randomSuffix()}`;
  if (layout.floors.some(f => f.items.some(item => item.id === id))) return { ok: false, reason: '舞台物料编号冲突，请重试。' };
  for (let z = minZ; z <= maxZ + 1e-8; z += step) for (let x = minX; x <= maxX + 1e-8; x += step) {
    if (doors.some(door => {
      const dx = Math.max(Math.abs(door.position.x - x) - WIDTH / 2, 0);
      const dz = Math.max(Math.abs(door.position.z - z) - DEPTH / 2, 0);
      return Math.hypot(dx, dz) < 1 + door.width / 2;
    })) continue;
    const item: FurnitureItem = { id, type: 'glb-asset', materialId: 'asset', assetId: STAGE_PLATFORM_ASSET_ID,
      source: 'public_library', glbUrl: STAGE_PLATFORM_URL, name: '舞台平台（示意）', width: WIDTH, depth: DEPTH,
      height: HEIGHT, color: '#4A7C59', icon: '台', category: 'stage', position: { x, z }, rotation: 0 };
    if (hasCollisions(item, floor.items, width, depth, context)) continue;
    const trial: RoomLayout = { ...layout, floors: layout.floors.map((f, index) => index === floorIndex ? { ...f, items: [...f.items, item] } : f) };
    if (structuralItemCollides(item, trial, floorIndex)) continue;
    return { ok: true, layout: trial, item };
  }
  return { ok: false, reason: '这次搜索没有找到可放示意舞台模块的空位；请调整布置或手动选择位置，不能据此断定场地无解。' };
}
