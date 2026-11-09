import { hasCollisions } from './geometry';
import { floorKeepOut } from './floor-keep-out';
import { randomSuffix } from './ids';
import { structuralItemCollides } from './structural-layout';
import { MAX_ZONES } from './zones';
import type { FurnitureItem, RoomLayout, RoomZone } from './types';

/** 搜索尺度只是候选布置的尺寸假设，不代表通道规范或安全结论。 */
const REST_WIDTH = 2.2;
const REST_DEPTH = 1.6;
const WALL_MARGIN = 0.3;
const KNOWN_DOOR_BUFFER = 1;

type RestAreaResult = { ok: true; layout: RoomLayout } | { ok: false; reason: string };

function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${randomSuffix()}`;
}

function overlapsZone(a: Pick<RoomZone, 'x' | 'z' | 'w' | 'd'>, b: RoomZone): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.z < b.z + b.d && a.z + a.d > b.z;
}

/** 在最终候选中找一块空区域，仅追加一把示意长椅和一个可编辑区域。 */
export function proposeRestArea(layout: RoomLayout, floorIndex: number): RestAreaResult {
  const floor = layout.floors[floorIndex];
  const width = layout.width;
  const depth = layout.height;
  if (!floor || !Number.isFinite(width) || !Number.isFinite(depth) || width <= 0 || depth <= 0) {
    return { ok: false, reason: '缺少有效的场地尺寸或楼层，休息区位置待核对。' };
  }
  if ((floor.zones?.length ?? 0) >= MAX_ZONES) return { ok: false, reason: '区域数量已达上限，无法添加休息区。' };

  const minX = -width / 2 + WALL_MARGIN + REST_WIDTH / 2;
  const maxX = width / 2 - WALL_MARGIN - REST_WIDTH / 2;
  const minZ = -depth / 2 + WALL_MARGIN + REST_DEPTH / 2;
  const maxZ = depth / 2 - WALL_MARGIN - REST_DEPTH / 2;
  if (minX > maxX || minZ > maxZ) return { ok: false, reason: '当前尺寸下没有找到可放示意休息区的位置，请调整需求或场地。' };

  // 限制搜索预算；未找到不等于场地无解。
  const step = Math.max(0.6, (maxX - minX) / 24, (maxZ - minZ) / 24);
  const knownDoors = [
    ...floor.items.flatMap(item => (item.type === 'door' || item.venueEntranceId) && item.position
      ? [{ position: item.position, width: item.width }] : []),
    ...(layout.backendVenue?.entrances ?? []).map(entrance => ({
      position: { x: entrance.position.x - width / 2, z: entrance.position.z - depth / 2 }, width: entrance.width,
    })),
  ];
  const context = { keepOut: floorKeepOut(layout, floorIndex), interiorWalls: floor.interiorWalls ?? [] };
  for (let z = minZ; z <= maxZ + 1e-8; z += step) {
    for (let x = minX; x <= maxX + 1e-8; x += step) {
      const rect = { x: x - REST_WIDTH / 2, z: z - REST_DEPTH / 2, w: REST_WIDTH, d: REST_DEPTH };
      if ((floor.zones ?? []).some(zone => overlapsZone(rect, zone))) continue;
      if (knownDoors.some(door => {
        const dx = Math.max(Math.abs(door.position.x - x) - REST_WIDTH / 2, 0);
        const dz = Math.max(Math.abs(door.position.z - z) - REST_DEPTH / 2, 0);
        return Math.hypot(dx, dz) < KNOWN_DOOR_BUFFER + door.width / 2;
      })) continue;
      const probe: FurnitureItem = { id: newId(), type: 'rest-area-probe', name: '休息区空间', width: REST_WIDTH,
        depth: REST_DEPTH, height: 1, color: '#4A7C59', icon: '', category: 'rest', position: { x, z }, rotation: 0 };
      if (hasCollisions(probe, floor.items, width, depth, context)) continue;
      const trial: RoomLayout = { ...layout, floors: layout.floors.map((f, index) => index === floorIndex ? { ...f, items: [...f.items, probe] } : f) };
      if (structuralItemCollides(probe, trial, floorIndex)) continue;

      const bench: FurnitureItem = { ...probe, id: newId(), type: 'bench', name: '休息长椅（示意）', width: 1.4, depth: 0.4, height: 0.45, icon: '椅' };
      const zone: RoomZone = { id: newId(), name: '休息区（待核验）', color: '#4A7C59', ...rect };
      return { ok: true, layout: { ...layout, floors: layout.floors.map((f, index) => index === floorIndex
        ? { ...f, items: [...f.items, bench], zones: [...(f.zones ?? []), zone] } : f) } };
    }
  }
  return { ok: false, reason: '这次搜索没有找到可放示意休息区的空位；请调整布置或手动画区，不能据此断定场地无解。' };
}
