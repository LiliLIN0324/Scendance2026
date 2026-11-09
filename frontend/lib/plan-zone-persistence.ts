import { structuralViolations } from '../../supabase/functions/_shared/structural-geometry';
import { venueSchema, type Scene } from '../../supabase/functions/_shared/domain';
import { MAX_ROOM_DIMENSION } from '../components/room-organizer/lib/constants';
import { MAX_COLOR_LENGTH, MAX_ID_LENGTH, MAX_NAME_LENGTH } from '../components/room-organizer/lib/schema';
import { isRoomZone, isZoneRect, MAX_ZONES, MIN_ZONE_SIZE } from '../components/room-organizer/lib/zones';
import type { RoomLayout, RoomZone } from '../components/room-organizer/lib/types';
import { ZONE_SEMANTIC_LABELS, type LayoutPlanDraft, type PlanAnnotation, type ZoneSemanticType } from './plan-annotation';

export type PlanZonePersistenceResult =
  | { ok: true; layout: RoomLayout; addedZones: RoomZone[]; remainingDraft: LayoutPlanDraft | null; ignoredAnnotationIds: string[]; warnings: string[] }
  | { ok: false; reason: string };

const COLOR = '#4A7C59';

function overlaps(a: RoomZone, b: RoomZone): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.z < b.z + b.d && a.z + a.d > b.z;
}

/** 身份同时保留草案、原标注和阶段；超长或冲突时不能截断或覆盖。 */
function zoneId(draftId: string, annotation: PlanAnnotation): string | null {
  try {
    const value = `plan-zone:${encodeURIComponent(draftId)}:${encodeURIComponent(annotation.id)}:${annotation.stageNo}`;
    return value.length <= MAX_ID_LENGTH ? value : null;
  } catch { return null; }
}

/** 与后端同一套多边形边界算法；不以矩形外接框代替凹形场地。 */
function fitsPolygon(zone: RoomZone, venue: NonNullable<RoomLayout['backendVenue']>): boolean {
  const scene: Scene = {
    schemaVersion: 1,
    venue: { width: venue.width, depth: venue.depth, height: venue.height, shape: 'polygon', polygon: venue.polygon!, entrances: [] },
    objects: [{ id: '00000000-0000-4000-8000-000000000001', materialId: 'decoration',
      position: { x: zone.x + zone.w / 2 + venue.width / 2, z: zone.z + zone.d / 2 + venue.depth / 2 },
      size: { width: zone.w, depth: zone.d, height: 0.01 }, rotation: 0, color: COLOR, locked: false, notes: '' }],
    camera: 'overview', lighting: 'neutral',
  };
  return !structuralViolations(scene).some(violation => violation.code === 'OUT_OF_BOUNDS');
}

/**
 * 只在用户确认后调用。将矩形区一次性追加到本机布局；门、路线和测距保留在返回的草案中。
 * 不发送云端，不推断合规；任何错误都不修改输入。
 */
export function appendPlanZones(layout: RoomLayout, floorIndex: number, draft: LayoutPlanDraft): PlanZonePersistenceResult {
  if (!layout || !Array.isArray(layout.floors) || !Number.isInteger(floorIndex) || floorIndex < 0 || floorIndex >= layout.floors.length) return { ok: false, reason: '当前楼层不存在，请重新选择。' };
  if (!Number.isFinite(layout.width) || !Number.isFinite(layout.height) || layout.width <= 0 || layout.height <= 0
    || layout.width > MAX_ROOM_DIMENSION || layout.height > MAX_ROOM_DIMENSION) return { ok: false, reason: '场地尺寸无效，无法保存区域。' };
  if (!draft || typeof draft.id !== 'string' || !draft.id.trim() || !Number.isFinite(draft.createdAt)
    || !Array.isArray(draft.annotations) || !Array.isArray(draft.stages)
    || draft.stages.some(stage => !stage || !Array.isArray(stage.annotationIds) || !stage.annotationIds.every(id => typeof id === 'string'))) {
    return { ok: false, reason: '草案身份或标注无效，无法保存区域。' };
  }

  const annotationIds = new Set<string>();
  for (const annotation of draft.annotations) {
    if (!annotation || typeof annotation.id !== 'string' || !annotation.id.trim() || annotationIds.has(annotation.id)) return { ok: false, reason: '草案标注编号缺失或重复，请先核对。' };
    if (!['zone', 'door', 'route', 'measure'].includes(annotation.kind)) return { ok: false, reason: '草案包含不受支持的标注类型，原布局没有改变。' };
    annotationIds.add(annotation.id);
  }

  if (layout.floors.some(floor => !floor || typeof floor.id !== 'string' || !Array.isArray(floor.items)
    || floor.items.some(item => !item || typeof item.id !== 'string')
    || (floor.zones !== undefined && (!Array.isArray(floor.zones) || floor.zones.length > MAX_ZONES || !floor.zones.every(isRoomZone)
      || floor.zones.some(item => item.name.length > MAX_NAME_LENGTH || item.color.length > MAX_COLOR_LENGTH)))
    || (floor.interiorWalls !== undefined && (!Array.isArray(floor.interiorWalls) || floor.interiorWalls.some(wall => !wall || typeof wall.id !== 'string'))))) {
    return { ok: false, reason: '已有楼层数据无效，原布局没有改变。' };
  }
  const floor = layout.floors[floorIndex]!;
  const existing = floor.zones ?? [];
  if (!Array.isArray(existing) || !existing.every(isRoomZone)) return { ok: false, reason: '已有区域格式无效，原布局没有改变。' };
  const existingZoneIds = layout.floors.flatMap(item => (item.zones ?? []).map(zone => zone.id));
  if (existingZoneIds.some(id => !id.trim() || id.length > MAX_ID_LENGTH) || new Set(existingZoneIds).size !== existingZoneIds.length) {
    return { ok: false, reason: '已有区域编号缺失、过长或重复，原布局没有改变。' };
  }
  const areas = draft.annotations.filter(annotation => annotation.kind === 'zone');
  if (existing.length + areas.length > MAX_ZONES) return { ok: false, reason: `区域数量超过 ${MAX_ZONES} 个上限，原布局没有改变。` };

  const venue = layout.backendVenue ?? layout.backendSceneV2?.venue;
  if (venue && (Math.abs(venue.width - layout.width) > 1e-6 || Math.abs(venue.depth - layout.height) > 1e-6)) {
    return { ok: false, reason: '场地尺寸与边界数据不一致，请先核对。' };
  }
  if (venue && !venueSchema.safeParse(venue).success) return { ok: false, reason: '场地边界无效，请先核对。' };
  if (layout.backendVenue && layout.backendSceneV2?.venue) {
    const other = layout.backendSceneV2.venue;
    if (venue?.shape !== other.shape || JSON.stringify(venue?.polygon ?? null) !== JSON.stringify(other.polygon ?? null)
      || Math.abs(layout.width - other.width) > 1e-6 || Math.abs(layout.height - other.depth) > 1e-6) {
      return { ok: false, reason: '场地边界记录不一致，请先核对。' };
    }
  }

  const reservedIds = new Set(layout.floors.flatMap(item => [item.id, ...item.items.map(value => value.id),
    ...(item.zones ?? []).map(value => value.id), ...(item.interiorWalls ?? []).map(value => value.id)]));
  const addedZones: RoomZone[] = [];
  const warnings: string[] = [];
  for (const annotation of areas) {
    if (!annotation.geometry || annotation.geometry.kind !== 'rect') return { ok: false, reason: '区域不是矩形，当前无法无损保存。' };
    if (!Number.isSafeInteger(annotation.stageNo) || annotation.stageNo < 1) return { ok: false, reason: '区域阶段无效，请先核对。' };
    if (typeof annotation.label !== 'string' || !annotation.label.trim()) return { ok: false, reason: '区域名称为空，请先填写名称。' };
    const type = annotation.zoneType;
    if (type !== undefined && !Object.hasOwn(ZONE_SEMANTIC_LABELS, type)) return { ok: false, reason: '区域类型不受支持，请先核对。' };
    const semantic = type === undefined ? '普通区域' : ZONE_SEMANTIC_LABELS[type as ZoneSemanticType];
    const name = annotation.label.includes(semantic) ? annotation.label : `${annotation.label}（${semantic}）`;
    if (name.length > MAX_NAME_LENGTH) return { ok: false, reason: '区域名称过长，无法无损保存。' };
    const id = zoneId(draft.id, annotation);
    if (!id || reservedIds.has(id)) return { ok: false, reason: '区域编号过长或与已有内容冲突，原布局没有改变。' };
    const g = annotation.geometry;
    const zone: RoomZone = { id, name, color: COLOR, ...(type === undefined ? {} : {zoneType:type}), x: g.x, z: g.z, w: g.width, d: g.depth };
    if (!isZoneRect(zone) || zone.w < MIN_ZONE_SIZE || zone.d < MIN_ZONE_SIZE) return { ok: false, reason: `「${annotation.label}」的区域尺寸无效或过小。` };
    if (zone.x < -layout.width / 2 || zone.z < -layout.height / 2 || zone.x + zone.w > layout.width / 2 || zone.z + zone.d > layout.height / 2) {
      return { ok: false, reason: `「${annotation.label}」超出场地边界，请先调整。` };
    }
    if (venue?.shape === 'polygon' && !fitsPolygon(zone, venue)) return { ok: false, reason: `「${annotation.label}」超出多边形场地边界，请先调整。` };
    if ([...existing, ...addedZones].some(other => overlaps(zone, other))) warnings.push(`「${annotation.label}」与其他区域有重叠，请确认是否为共用空间。`);
    reservedIds.add(id);
    addedZones.push(zone);
  }

  const remaining = draft.annotations.filter(annotation => annotation.kind !== 'zone');
  const retainedIds = new Set(remaining.map(annotation => annotation.id));
  const remainingDraft = remaining.length ? { ...draft, annotations: remaining,
    stages: draft.stages.map(stage => ({ ...stage, annotationIds: stage.annotationIds.filter(id => retainedIds.has(id)) })) } : null;
  if (!addedZones.length) return { ok: true, layout, addedZones, remainingDraft, ignoredAnnotationIds: remaining.map(item => item.id), warnings };
  const next = { ...layout, floors: layout.floors.map((item, index) => index === floorIndex ? { ...item, zones: [...existing, ...addedZones] } : item) };
  return { ok: true, layout: next, addedZones, remainingDraft, ignoredAnnotationIds: remaining.map(item => item.id), warnings };
}
