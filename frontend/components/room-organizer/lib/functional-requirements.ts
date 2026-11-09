import { isStructuralMarker } from './structural-layout';
import type { FurnitureItem, RoomLayout, RoomZone } from './types';
import { STAGE_PLATFORM_ASSET_ID } from './stage-platform-plan';

export type FunctionalKind = 'checkin' | 'stage';
export type FunctionalNeeds = { checkin: boolean | null; stage: boolean | null };
export interface FunctionalCheck {
  kind: FunctionalKind;
  status: 'pass' | 'unknown' | 'not_applicable';
  message: string;
  /** 仅为候选中的显式标注，不代表已核验功能或安全。 */
  objectIds: string[];
  zoneIds: string[];
}

function located(item: FurnitureItem): boolean {
  return !isStructuralMarker(item) && !!item.position && Number.isFinite(item.position.x) && Number.isFinite(item.position.z)
    && Number.isFinite(item.width) && item.width > 0 && Number.isFinite(item.depth) && item.depth > 0;
}

function checkinItem(item: FurnitureItem): boolean {
  if (!located(item)) return false;
  if (item.materialId === 'reception') return true;
  if (item.type === 'counter' && item.category === 'checkin') return true;
  return (item.type === 'table' || item.type === 'counter') && /^(签到|报到|接待)(桌|台)([（(].*[）)])?$/.test(item.name.trim());
}

// 缺坐标、非常见名称或用途不明也不能作为“不需要签到”的排除证据。
function possiblyCheckinItem(item: FurnitureItem): boolean {
  return !isStructuralMarker(item) && (item.materialId === 'reception' || item.category === 'checkin'
    || /(签到|报到|接待)/.test(item.name));
}

function stageItem(item: FurnitureItem): boolean {
  if (!located(item) || item.type === 'backdrop' || item.materialId === 'backdrop') return false;
  if (item.materialId === 'asset' && item.assetId === STAGE_PLATFORM_ASSET_ID) return true;
  if (/(背景|背板|指示|标识|灯|音箱|屏幕|幕布)/.test(item.name)) return false;
  return item.type === 'stage' || item.type === 'stage-platform'
    || /^(主|临时)?(舞台|讲台)(平台)?([（(].*[）)])?$/.test(item.name.trim());
}

function zoneMatches(zone: RoomZone, kind: FunctionalKind): boolean {
  const name = zone.name.trim();
  if (/(不设|不需要|取消|禁止|背景|背板)/.test(name)) return false;
  return kind === 'checkin' ? /(签到|报到|接待)(区|处|点)/.test(name) : /(舞台|讲台)(区|区域)/.test(name);
}

function zoneWithinBounds(zone: RoomZone, layout: RoomLayout): boolean {
  if (![zone.x, zone.z, zone.w, zone.d, layout.width, layout.height].every(Number.isFinite)
    || zone.w <= 0 || zone.d <= 0 || layout.width <= 0 || layout.height <= 0
    || zone.x < -layout.width / 2 || zone.z < -layout.height / 2
    || zone.x + zone.w > layout.width / 2 || zone.z + zone.d > layout.height / 2) return false;
  // shortcut: 目前只验证矩形外框；多边形中的区域必须单独核验。
  return (layout.backendVenue?.shape ?? layout.backendSceneV2?.venue.shape) !== 'polygon';
}

/** 检查候选内的功能语义；几何、可达性、服务能力与安全另行核验。 */
export function checkFunctionalRequirements(layout: RoomLayout | undefined, floorIndex: number, needs: FunctionalNeeds): FunctionalCheck[] {
  return (['checkin', 'stage'] as const).map(kind => {
    const label = kind === 'checkin' ? '签到' : '舞台';
    const need = needs[kind];
    if (need === null) return { kind, status: 'unknown', message: `尚未确认是否需要${label}，不作判断。`, objectIds: [], zoneIds: [] };
    const floor = layout?.floors[floorIndex];
    if (!layout || !floor) return { kind, status: 'unknown', message: `无法读取当前楼层，请核对${label}需求。`, objectIds: [], zoneIds: [] };
    const objectIds = floor.items.filter(kind === 'checkin' ? (need ? checkinItem : possiblyCheckinItem) : stageItem).map(item => item.id);
    const matchingZones = (floor.zones ?? []).filter(zone => zoneMatches(zone, kind));
    const zoneIds = matchingZones.map(zone => zone.id);
    const hasEvidence = objectIds.length > 0 || zoneIds.length > 0;
    if (!need) {
      return hasEvidence
        ? { kind, status: 'unknown', message: `候选中仍有明确的${label}标注或物料，与不需要${label}的要求有冲突；请核对后调整，系统不会自动删除。`, objectIds, zoneIds }
        : { kind, status: 'pass', message: `未发现明确标注的${label}区域或物料；未标注物件的用途仍需核对。`, objectIds, zoneIds };
    }
    // 舞台区的标注和背景板都不代表舞台平台已经存在。
    const present = objectIds.length > 0 || (kind === 'checkin' && matchingZones.some(zone => zoneWithinBounds(zone, layout)));
    if (present) return { kind, status: 'pass', message: `已识别${label}的明确标注或物料；实际使用与现场条件仍需核验。`, objectIds, zoneIds };
    return { kind, status: 'unknown', message: kind === 'stage'
      ? '尚未识别实际舞台；背景板或空的舞台区不能代替舞台，请补充舞台物料或调整需求。'
      : zoneIds.length ? '签到区标注的范围尚未确认，请核对场地边界和标注位置。' : '尚未识别签到区或签到台；请明确标注、补充签到物料或调整需求。', objectIds, zoneIds };
  });
}
