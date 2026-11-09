import { hasCollisions, itemsOverlap, isLowProfile } from './geometry';
import { isStructuralMarker } from './structural-layout';
import type { RoomLayout } from './types';

/** 统一读取实际候选中的单人椅数量；不推断长椅或组合家具容量。 */
export function countSingleSeats(layout: RoomLayout | undefined, floorIndex: number): number | null {
  const floor = layout?.floors[floorIndex];
  if (!floor || !Number.isFinite(layout?.width) || !Number.isFinite(layout?.height) || layout!.width <= 0 || layout!.height <= 0) return null;
  return floor.items.filter(item => {
    if (isStructuralMarker(item) || !['chair', 'dining-chair', 'desk-chair'].includes(item.type)) return false;
    if (/(工作人员|员工|供应商|主持人|讲师|演讲人|嘉宾专用)/.test(`${item.name} ${item.notes ?? ''}`)) return false;
    const { position, width, depth } = item;
    const rotation = item.rotation ?? 0;
    if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.z) ||
        !Number.isFinite(width) || width <= 0 || !Number.isFinite(depth) || depth <= 0 || !Number.isFinite(rotation)) return false;
    const cos = Math.abs(Math.cos(rotation)), sin = Math.abs(Math.sin(rotation));
    const halfWidth = (width * cos + depth * sin) / 2;
    const halfDepth = (width * sin + depth * cos) / 2;
    const within = Math.abs(position.x) + halfWidth <= layout!.width / 2 + 1e-9 &&
      Math.abs(position.z) + halfDepth <= layout!.height / 2 + 1e-9;
    if (!within || hasCollisions(item, floor.items.filter(other => !other.position || (Number.isFinite(other.position.x) && Number.isFinite(other.position.z))), layout!.width, layout!.height, { interiorWalls: floor.interiorWalls })) return false;
    return !floor.items.some(other => other !== item && other.position && Number.isFinite(other.position.x) && Number.isFinite(other.position.z) &&
      Number.isFinite(other.width) && other.width > 0 && Number.isFinite(other.depth) && other.depth > 0 &&
      Number.isFinite(other.rotation ?? 0) && Number.isFinite(other.height) && !isLowProfile(other) && itemsOverlap(item, other));
  }).length;
}

/** 只点验可明确识别的单人椅，不推断长椅、组合家具或安全容量。 */
export function checkRequiredSeats(layout: RoomLayout | undefined, floorIndex: number, guests: number | null | undefined, required: boolean): { status: 'quantity_met' | 'unknown' | 'not_required'; message: string | null } {
  if (!required) return { status: 'not_required', message: null };
  if (!Number.isSafeInteger(guests) || !guests || guests < 1) return { status: 'unknown', message: '已要求所有人入座，请先确认人数。' };
  const seats = countSingleSeats(layout, floorIndex);
  if (seats === null) return { status: 'unknown', message: '场地边界或楼层信息不完整，暂不能核对已摆座席。' };
  if (seats < guests) return { status: 'unknown', message: `这版识别到 ${seats} 把单人椅（已定位且完整位于场地内）；未定位、几何信息不完整、冲突或明确为工作人员使用的座椅未计入。未能核对是否满足 ${guests} 人的座席要求；请补充座位或调整要求。` };
  return { status: 'quantity_met', message: `识别到 ${seats} 把无已知物件重叠的单人椅，数量达到 ${guests}；观众用途、座席可用性和现场条件仍需核验。` };
}

/** 只有明确标注的区域才算已提供休息区；椅子数量不能代替区域意图。 */
export function checkRestArea(layout: RoomLayout | undefined, floorIndex: number, required: boolean): { status: 'present' | 'unknown' | 'not_required'; message: string | null } {
  if (!required) return { status: 'not_required', message: null };
  const zones = layout?.floors[floorIndex]?.zones ?? [];
  if (layout && Number.isFinite(layout.width) && layout.width > 0 && Number.isFinite(layout.height) && layout.height > 0 && zones.some(zone =>
    zone.name.includes('休息') && !/(不设|不需要|取消|禁止)/.test(zone.name)
      && Number.isFinite(zone.x) && Number.isFinite(zone.z) && Number.isFinite(zone.w) && Number.isFinite(zone.d)
      && zone.w > 0 && zone.d > 0 && zone.x >= -layout.width / 2 && zone.z >= -layout.height / 2
      && zone.x + zone.w <= layout.width / 2 && zone.z + zone.d <= layout.height / 2)) {
    return { status: 'present', message: null };
  }
  return { status: 'unknown', message: '这版还没有明确标注休息区；请先补充并核对休息区，或调整需求。' };
}
