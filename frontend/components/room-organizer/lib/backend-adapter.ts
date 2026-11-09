import libraryAssetIds from '../../../../assets/library/asset-ids.json';
import libraryAssetLabels from '../../../../assets/library/asset-labels.zh.json';
/** The backend domain is the single wire-format authority. No parallel API schema. */
import { catalog, presetManifest, sceneSchema, type Scene, type SceneObject } from '../../../../supabase/functions/_shared/domain';
import { PLANNING_ZONES_GENERATION_MESSAGE } from '../../../../supabase/functions/_shared/planning-zones-contract';
import { dimensionConflicts } from '../../../../supabase/functions/_shared/structural-geometry';
import { MAX_ITEM_DIMENSION, MAX_ROOM_DIMENSION } from './constants';
import { mergeProposalPresentation } from './creative-brief';
import { presetModelUrl } from './scene-presets';
import { MAX_STOREY_HEIGHT, MIN_STOREY_HEIGHT } from './storeys';
import { layoutGeometryScene, canApplyLayoutGeometry, stableMeasurement } from './structural-layout';
import { pruneVenueSite } from './venue-shell';
import { isRoomZone, MAX_ZONES } from './zones';
import { MAX_COLOR_LENGTH, MAX_ID_LENGTH, MAX_NAME_LENGTH } from './schema';
import type { FurnitureItem, RoomLayout } from './types';

const publicLibraryIds = new Set(Object.values(libraryAssetIds));

export class SceneAdapterError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'SceneAdapterError';
  }
}

export const LOCAL_ZONES_CLOUD_MESSAGE = '此云端操作暂不支持本机区域标注。请先备份本机草稿或处理区域标注；现有标注未删除。';
const hasZoneData = (zones: unknown): boolean => zones !== undefined && (!Array.isArray(zones) || zones.length > 0);
export function layoutCarriesCloudZones(layout: RoomLayout): boolean {
  return layout.floors.some(floor => hasZoneData(floor.zones)) || layout.backendSceneV2?.planningZones !== undefined;
}

/** Generation must stop before it can drop saved zones. The layout itself is left unchanged. */
export function assertGeneratorLeavesSavedZones(layout: RoomLayout, serverScene?: { planningZones?: unknown } | null): void {
  if (layoutCarriesCloudZones(layout) || serverScene?.planningZones !== undefined) {
    throw new SceneAdapterError('PLANNING_ZONES_GENERATION_UNAVAILABLE', PLANNING_ZONES_GENERATION_MESSAGE);
  }
}

/** 未显式开启矩形首版时，当前层和历史版本里的区域都不能静默转换。多边形区域不在首版范围内。 */
export function assertCloudZoneSupport(layout: RoomLayout, allowRootZones = false): void {
  if (!allowRootZones && (layout.floors.some(floor => hasZoneData(floor.zones)) || layout.backendSceneV2?.planningZones !== undefined)) {
    throw new SceneAdapterError('ZONES_NOT_SUPPORTED', LOCAL_ZONES_CLOUD_MESSAGE);
  }
  const pending: RoomLayout[] = [...(layout.designBook?.variants.map(variant => variant.layout) ?? [])];
  const seen = new Set<RoomLayout>();
  while (pending.length) {
    const current = pending.pop()!;
    if (seen.has(current)) continue;
    seen.add(current);
    if (current.backendSceneV2?.planningZones !== undefined || current.floors.some(floor => hasZoneData(floor.zones))) {
      throw new SceneAdapterError('ZONES_NOT_SUPPORTED', LOCAL_ZONES_CLOUD_MESSAGE);
    }
    pending.push(...(current.designBook?.variants.map(variant => variant.layout) ?? []));
  }
}

const rendererTypes: Record<SceneObject['materialId'], string> = {
  chair: 'chair', table: 'table', reception: 'counter', backdrop: 'backdrop',
  display: 'bookshelf', partition: 'partition', carpet: 'rug', decoration: 'plant', asset: 'glb-asset',
};
const icons: Record<SceneObject['materialId'], string> = {
  chair: '🪑', table: '▰', reception: '▣', backdrop: '▥', display: '▤',
  partition: '▯', carpet: '▱', decoration: '✦', asset: '◇',
};

export interface BackendAdapterOptions {
  name?: string;
  projectId?: string;
  /** Short-lived loading URLs only; these are never sent back in scene.save. */
  assetUrls?: Readonly<Record<string, string>>;
  assetNames?: Readonly<Record<string, string>>;
  /** 本机资产号 → 云端资产号；上传成功后由 asset-cloud 维护，保存时替换掉本机号。 */
  assetIdMap?: Readonly<Record<string, string>>;
  /** 只给保存用：这些是本机资产号；没出现在 assetIdMap 里说明还没上云，保存要停下来说清状态。 */
  localAssetIds?: ReadonlySet<string>;
  /** 只有已经核对过服务端 planning_zones v1 能力的调用方可以打开。默认仍阻断。 */
  planningZonesV1?: true;
}

// 云端坐标是米，分辨率到 1e-9。其它字段不截断；读不回来的精度直接拒绝。
const zoneCoordinate = (value: number): number => Math.round(value * 1e9) / 1e9;
const textWithin = (value: string, max: number) => Array.from(value).length <= max;

function assertSupportedVenue(venue: Scene['venue'], version: number): void {
  if (version === 1 && venue.shape !== 'rectangle') {
    throw new SceneAdapterError('POLYGON_NOT_SUPPORTED', '此版编辑器暂不支持多边形场地，未打开项目；原云端场景保持不变。');
  }
  if (version === 1 && venue.floorplanAssetId) {
    throw new SceneAdapterError('FLOORPLAN_NOT_SUPPORTED', '此版编辑器暂不支持云端平面图，未打开项目；请保留原项目并等待平面图功能。');
  }
  if (venue.width > MAX_ROOM_DIMENSION || venue.depth > MAX_ROOM_DIMENSION ||
      venue.height < MIN_STOREY_HEIGHT || venue.height > (version === 2 ? 30 : MAX_STOREY_HEIGHT)) {
    throw new SceneAdapterError('VENUE_SIZE_NOT_SUPPORTED', '场地尺寸超出此版编辑器范围，无法无损打开。');
  }
}

/** Backend positive angle turns +X towards +Z; Three.js positive Y turns towards -Z. */
export function backendDegreesToEditorRadians(degrees: number): number {
  return -degrees * Math.PI / 180;
}
export function editorRadiansToBackendDegrees(radians: number): number {
  const degrees = -radians * 180 / Math.PI;
  // Avoid rounding a persisted value or changing ±360 when already in the wire range.
  return degrees >= -360 && degrees <= 360 ? degrees : ((degrees + 180) % 360 + 360) % 360 - 180;
}

function entranceItem(entrance: Scene['venue']['entrances'][number], venue: Scene['venue']): FurnitureItem {
  const sideWall = Math.abs(entrance.position.x) < 1e-8 || Math.abs(entrance.position.x - venue.width) < 1e-8;
  return {
    id: entrance.id, type: 'door', name: '主要出入口', icon: '🚪',
    width: entrance.width, depth: 0.12, height: Math.min(2.2, venue.height), color: '#d6c7a4',
    position: { x: entrance.position.x - venue.width / 2, z: entrance.position.z - venue.depth / 2 },
    rotation: sideWall ? Math.PI / 2 : 0,
    locked: true, venueEntranceId: entrance.id, source: 'builtin',
  };
}

export function backendSceneToLayout(input: unknown, options: BackendAdapterOptions = {}): RoomLayout {
  const result = sceneSchema.safeParse(input);
  if (!result.success) throw new SceneAdapterError('INVALID_SCENE', '云端场景格式无效，未覆盖当前编辑内容。');
  const scene = result.data;
  assertSupportedVenue(scene.venue, scene.schemaVersion);
  if (scene.planningZones?.zones.some(zone => zone.x !== zoneCoordinate(zone.x) || zone.z !== zoneCoordinate(zone.z) || zone.width !== zoneCoordinate(zone.width) || zone.depth !== zoneCoordinate(zone.depth) ||
      !textWithin(zone.id, MAX_ID_LENGTH) || !textWithin(zone.name, MAX_NAME_LENGTH) || !textWithin(zone.color, MAX_COLOR_LENGTH))) {
    throw new SceneAdapterError('ZONE_PRECISION_NOT_SUPPORTED', '云端区域精度或文字超出本机无损读取范围，未打开项目。');
  }
  const ids = new Set(scene.objects.map(o => o.id));
  if (scene.venue.entrances.some(e => ids.has(e.id))) {
    throw new SceneAdapterError('ENTRANCE_ID_COLLISION', '出入口与物件编号重复，无法无损打开。');
  }
  const items: FurnitureItem[] = scene.objects.map(o => {
    const minFootprint = o.presetNode !== undefined ? 0 : o.materialId === 'asset' ? 0.02 : 0.1;
    if (Math.max(o.size.width, o.size.depth, o.size.height) > MAX_ITEM_DIMENSION ||
        o.size.width < minFootprint || o.size.depth < minFootprint || o.size.height < (o.presetNode !== undefined ? 0 : 0.01)) {
      throw new SceneAdapterError('OBJECT_SIZE_NOT_SUPPORTED', `物件尺寸超出此版编辑器范围（宽深至少 ${minFootprint} 米、高至少 0.01 米），未打开项目，原尺寸未改动。`);
    }
    const meta = catalog.find(entry => entry.id === o.materialId);
    return {
      id: o.id, type: rendererTypes[o.materialId], materialId: o.materialId,
      name: o.presetNode !== undefined ? presetManifest[scene.scenePreset!][o.presetNode] : o.assetId ? (libraryAssetLabels as Record<string, string>)[o.assetId] ?? options.assetNames?.[o.assetId] ?? '三维资产' : meta?.name ?? o.materialId,
      width: o.size.width, depth: o.size.depth, height: o.size.height,
      position: { x: o.position.x - scene.venue.width / 2, z: o.position.z - scene.venue.depth / 2 },
      rotation: backendDegreesToEditorRadians(o.rotation), color: o.color, icon: icons[o.materialId],
      locked: o.locked, notes: o.notes,
      ...(o.elevation !== undefined ? { elevation: o.elevation } : {}),
      ...(o.wallId ? { wallId: o.wallId } : {}),
      ...(o.assetId ? { assetId: o.assetId, ...(publicLibraryIds.has(o.assetId) ? { source: 'public_library' as const } : {}) } : { source: 'builtin' as const }),
      ...(o.assetId && options.assetUrls?.[o.assetId] ? { glbUrl: options.assetUrls[o.assetId] } : {}),
      ...(o.presetNode !== undefined ? { source: 'local_sample' as const, glbUrl: presetModelUrl(scene.scenePreset!), glbNode: `Preset_Object_${o.presetNode}` } : {}),
    };
  });
  if (scene.schemaVersion === 2) {
    for (const opening of scene.structure.openings) {
      const wall = scene.structure.walls.find(w => w.id === opening.wallId)!;
      const length = Math.hypot(wall.end.x - wall.start.x, wall.end.z - wall.start.z);
      const t = (opening.offset + opening.width / 2) / length;
      items.push({ id: opening.id, type: opening.kind, structuralOpeningId: opening.id,
        wallId: wall.id, name: opening.kind === 'door' ? '门洞' : '窗户', icon: opening.kind === 'door' ? '🚪' : '▣',
        width: opening.width, depth: wall.thickness, height: opening.height, sillHeight: opening.sillHeight,
        color: '#cabd9f', locked: true,
        position: { x: wall.start.x + (wall.end.x - wall.start.x) * t - scene.venue.width / 2,
          z: wall.start.z + (wall.end.z - wall.start.z) * t - scene.venue.depth / 2 },
        rotation: -Math.atan2(wall.end.z - wall.start.z, wall.end.x - wall.start.x) });
    }
    for (const column of scene.structure.columns) items.push({ id: column.id, type: 'column', structuralColumnId: column.id,
      name: '柱子', icon: '▣', width: column.size.width, depth: column.size.depth, height: column.size.height,
      position: { x: column.position.x - scene.venue.width / 2, z: column.position.z - scene.venue.depth / 2 },
      rotation: backendDegreesToEditorRadians(column.rotation), color: '#d1cdc5', locked: true });
  } else items.push(...scene.venue.entrances.map(e => entranceItem(e, scene.venue)));
  return {
    ...(options.projectId ? { id: options.projectId } : {}),
    ...(scene.scenePreset ? { scenePreset: scene.scenePreset } : {}),
    name: options.name ?? '活动场景', width: scene.venue.width, height: scene.venue.depth,
    floors: [{ id: 'event-floor', name: '活动场地', height: scene.venue.height,
      floorColor: scene.schemaVersion === 2 ? scene.finishes?.floorColor ?? scene.design?.palette[0] ?? '#f5f6f7' : '#f5f6f7',
      ...(scene.schemaVersion === 2 && scene.finishes?.floorPattern ? { floorPattern: scene.finishes.floorPattern } : {}), items,
      ...(scene.planningZones ? { zones: scene.planningZones.zones.map(zone => ({ id: zone.id, name: zone.name, color: zone.color,
        x: zone.x - scene.venue.width / 2, z: zone.z - scene.venue.depth / 2, w: zone.width, d: zone.depth,
        ...(zone.zoneType === undefined ? {} : { zoneType: zone.zoneType }) })) } : {}),
      interiorWalls: scene.schemaVersion === 2 ? scene.structure.walls.map(w => ({ id: w.id,
        x1: w.start.x - scene.venue.width / 2, z1: w.start.z - scene.venue.depth / 2,
        x2: w.end.x - scene.venue.width / 2, z2: w.end.z - scene.venue.depth / 2,
        thickness: w.thickness, height: w.height, kind: w.kind, status: w.status,
        ...(scene.finishes?.wallColors?.[w.id] ? { color: scene.finishes.wallColors[w.id] } : {}) })) : [] }],
    roof: { style: 'none' },
    ...(scene.schemaVersion === 2 ? { backendSceneV2: structuredClone(scene) } : {}),
    backendVenue: structuredClone(scene.venue), backendCamera: scene.camera, backendLighting: scene.lighting,
  };
}

export function layoutToBackendScene(layout: RoomLayout, options: Pick<BackendAdapterOptions,'assetIdMap'|'localAssetIds'|'planningZonesV1'> = {}): Scene {
  if (layout.floors.length !== 1) throw new SceneAdapterError('MULTI_FLOOR_NOT_SUPPORTED', '当前云端版暂不支持保存多层方案。这份方案和修改会保留在本机；请勿删除本地方案。');
  assertCloudZoneSupport(layout, options.planningZonesV1 === true);
  if (!layout.backendSceneV2 && (layout.floorPlanImage || layout.backendVenue?.floorplanAssetId)) {
    throw new SceneAdapterError('FLOORPLAN_NOT_SUPPORTED', '平面图尚未接入云保存，不能忽略底图后保存。');
  }
  if (!layout.backendSceneV2 && layout.backendVenue?.shape === 'polygon') {
    throw new SceneAdapterError('POLYGON_NOT_SUPPORTED', '多边形场地尚未接入此版编辑器，不能改存为矩形。');
  }
  const floor = layout.floors[0]!;
  const zones = floor.zones;
  if (options.planningZonesV1 && layout.backendVenue?.shape === 'polygon' && (hasZoneData(zones) || layout.backendSceneV2?.planningZones !== undefined)) {
    throw new SceneAdapterError('POLYGON_NOT_SUPPORTED', '首版只保存矩形场地里的矩形区域；多边形场地和多边形区域都尚未覆盖，未保存。');
  }
  if (options.planningZonesV1 && zones !== undefined && (!Array.isArray(zones) || zones.length > MAX_ZONES || zones.some(zone => !isRoomZone(zone) ||
    Object.keys(zone).some(key => !['id', 'name', 'color', 'x', 'z', 'w', 'd', 'zoneType'].includes(key)) ||
    !textWithin(zone.id, MAX_ID_LENGTH) || !textWithin(zone.name, MAX_NAME_LENGTH) || !textWithin(zone.color, MAX_COLOR_LENGTH) ||
    zone.x < -layout.width / 2 - 1e-9 || zone.z < -layout.height / 2 - 1e-9 || zone.x + zone.w > layout.width / 2 + 1e-9 || zone.z + zone.d > layout.height / 2 + 1e-9))) {
    throw new SceneAdapterError('INVALID_PLANNING_ZONE', '区域格式或位置无法无损保存，请先核对。');
  }
  if ((!layout.backendSceneV2 && floor.interiorWalls?.length) || layout.roof && layout.roof.style !== 'none' ||
      layout.terrain && (layout.terrain.frontY !== 0 || layout.terrain.backY !== 0)) {
    throw new SceneAdapterError('STRUCTURE_NOT_SUPPORTED', '此方案含未接入云端的建筑结构，不能忽略这些内容后保存。');
  }
  const entrances = (layout.backendVenue?.entrances ?? []).map(original => {
    if (layout.backendSceneV2) return original;
    const item = floor.items.find(i => i.venueEntranceId === original.id);
    if (!item?.position) throw new SceneAdapterError('ENTRANCE_MISSING', '主要出入口数据缺失，已阻止保存。');
    return { id: original.id, position: { x: item.position.x + layout.width / 2, z: item.position.z + layout.height / 2 }, width: item.width };
  });
  if (floor.items.some(i => i.venueEntranceId && !entrances.some(e => e.id === i.venueEntranceId))) {
    throw new SceneAdapterError('UNKNOWN_ENTRANCE', '存在未关联的出入口，已阻止保存。');
  }
  const objects = floor.items.filter(i => !i.venueEntranceId && !i.structuralOpeningId && !i.structuralColumnId).map(item => {
    if (!item.position) throw new SceneAdapterError('POSITION_MISSING', `物件“${item.name}”缺少位置，无法保存。`);
    if (item.mirrored) throw new SceneAdapterError('MIRROR_NOT_SUPPORTED', '云端暂不支持镜像物件，不能丢失镜像状态。');
    const localAssetId = item.assetId ?? (libraryAssetIds as Record<string,string>)[item.glbUrl ?? ''];
    // 本机生成的 GLB 先上传换云端资产号；没换到就明确停下，不把本机 UUID 当成云资产发给后端。
    const assetId = localAssetId && options.localAssetIds?.has(localAssetId)
      ? options.assetIdMap?.[localAssetId]
      : localAssetId;
    if (localAssetId && options.localAssetIds?.has(localAssetId) && !assetId) {
      throw new SceneAdapterError('LOCAL_ASSET_NOT_UPLOADED', `“${item.name}”还在本机或上次上传失败，尚未上云；本机副本保留着，网络恢复后会自动重试。`);
    }
    const presetNode = item.glbNode?.match(/^Preset_Object_(\d+)$/)?.[1];
    if (item.glbNode && (!layout.scenePreset || item.glbUrl !== presetModelUrl(layout.scenePreset) || presetNode === undefined || !presetManifest[layout.scenePreset][Number(presetNode)])) {
      throw new SceneAdapterError('UNKNOWN_PRESET_NODE', '场景预设节点不在已归档的模型中，未保存。');
    }
    if ((item.type === 'glb-asset' || item.glbUrl) && !assetId && presetNode === undefined) {
      throw new SceneAdapterError('LOCAL_ASSET_NOT_UPLOADED', '本地模型尚未归档到云端，不能作为云资产保存。');
    }
    const inferred = Object.entries(rendererTypes).find(([, type]) => type === item.type)?.[0];
    const materialId = item.materialId ?? inferred;
    if (!materialId) throw new SceneAdapterError('MATERIAL_NOT_SUPPORTED', `物料“${item.name}”不在活动目录中，无法保存。`);
    const original = layout.backendSceneV2?.objects.find(o=>o.id===item.id);
    return {
      id: item.id, materialId, ...(assetId ? { assetId } : {}),
      ...(presetNode !== undefined ? { presetNode: Number(presetNode) } : {}),
      position: { x: stableMeasurement(item.position.x + layout.width / 2, original?.position.x), z: stableMeasurement(item.position.z + layout.height / 2, original?.position.z) },
      rotation: stableMeasurement(editorRadiansToBackendDegrees(item.rotation ?? 0), original?.rotation),
      size: { width: item.width, depth: item.depth, height: item.height }, color: item.color,
      locked: item.locked ?? false, notes: item.notes ?? '',
      ...(item.elevation !== undefined ? { elevation: item.elevation } : {}),
      ...(item.wallId ? { wallId: item.wallId } : {}),
    };
  });
  const geometric = layout.backendSceneV2 ? layoutGeometryScene(layout) : null;
  if (geometric && layout.backendSceneV2) {
    const source=layout.backendSceneV2;
    const changed=(a:number,b:number)=>!Number.isFinite(a)||!Number.isFinite(b)||Math.abs(a-b)>1e-6;
    const protectedByEvidence=(id:string,status:string)=>status==='confirmed'||source.dimensions.some(d=>d.status==='confirmed'&&(d.targetId===id||d.targetEndId===id));
    // The editable floor copy cannot promote an inferred/detected wall by changing its status.
    // A real reconfirmation must replace both the authoritative V2 record and its evidence.
    for(const current of geometric.structure.walls){
      const original=source.structure.walls.find(wall=>wall.id===current.id);
      if(current.status==='confirmed' && original?.status!=='confirmed')
        throw new SceneAdapterError('STRUCTURE_EVIDENCE_STALE','墙体确认状态与原结构记录不一致，请在结构面板中重新核对。');
    }
    for(const wall of source.structure.walls){
      const current=geometric.structure.walls.find(value=>value.id===wall.id);
      const protectedWall=protectedByEvidence(wall.id,wall.status)||(wall.evidence?.length??0)>0;
      if(!protectedWall)continue;
      if(!current || current.status!==wall.status || current.kind!==wall.kind ||
        changed(current.start.x,wall.start.x)||changed(current.start.z,wall.start.z)||
        changed(current.end.x,wall.end.x)||changed(current.end.z,wall.end.z)||
        changed(current.thickness,wall.thickness)||changed(current.height,wall.height))
        throw new SceneAdapterError('STRUCTURE_EVIDENCE_STALE','墙体已改变，原结构确认和图纸依据不能沿用；请在结构面板中重新核对。');
    }
    for(const opening of source.structure.openings) {
      if(!protectedByEvidence(opening.id,opening.status))continue;
      const current=geometric.structure.openings.find(value=>value.id===opening.id);
      if(!current||current.wallId!==opening.wallId||current.kind!==opening.kind||changed(current.offset,opening.offset)||
        changed(current.width,opening.width)||changed(current.height,opening.height)||changed(current.sillHeight,opening.sillHeight))
        throw new SceneAdapterError('STRUCTURE_EVIDENCE_STALE','门窗已改变，原结构确认和尺寸依据不能沿用；请在结构面板中重新核对。');
    }
    for(const column of source.structure.columns) {
      if(!protectedByEvidence(column.id,column.status))continue;
      const current=geometric.structure.columns.find(value=>value.id===column.id);
      if(!current||changed(current.position.x,column.position.x)||changed(current.position.z,column.position.z)||changed(current.rotation,column.rotation)||
        changed(current.size.width,column.size.width)||changed(current.size.depth,column.size.depth)||changed(current.size.height,column.size.height))
        throw new SceneAdapterError('STRUCTURE_EVIDENCE_STALE','柱子已改变，原结构确认和尺寸依据不能沿用；请在结构面板中重新核对。');
    }
  }
  // 主入口只能指着结构里真实存在的门窗。门洞被删或换过墙之后剪掉这条引用（室内外、尺度
  // 置信度这些其它真相留着），否则域校验会把用户锁在「无法保存」上。
  const site = pruneVenueSite(layout.backendVenue?.site, geometric?.structure.openings.map(opening => opening.id) ?? []);
  const originalFinishes = layout.backendSceneV2?.finishes;
  const wallColors = Object.fromEntries((floor.interiorWalls ?? []).filter(w=>w.color).map(w=>[w.id,w.color]));
  const finishes = {
    ...originalFinishes,
    ...(originalFinishes?.floorColor !== undefined || floor.floorColor !== (layout.backendSceneV2?.design?.palette[0] ?? '#f5f6f7') ? { floorColor: floor.floorColor } : {}),
    ...(floor.floorPattern ? { floorPattern: floor.floorPattern } : {}),
    ...(originalFinishes?.wallColors !== undefined || Object.keys(wallColors).length ? { wallColors } : {}),
  };
  const sceneBase = layout.backendSceneV2 ? (({ planningZones, ...rest }) => rest)(layout.backendSceneV2) : {};
  const candidate = {
    ...sceneBase,
    schemaVersion: layout.backendSceneV2 ? 2 : 1,
    ...(layout.scenePreset ? { scenePreset: layout.scenePreset } : {}),
    venue: { ...(layout.backendVenue ? { ...layout.backendVenue, ...(site ? { site } : { site: undefined }) } : {}), width: layout.width, depth: layout.height, height: floor.height ?? 3, shape: layout.backendVenue?.shape ?? 'rectangle', entrances },
    ...(geometric ? { structure: geometric.structure,
      ...(originalFinishes || Object.keys(finishes).length ? { finishes } : {}),
      ...(layout.backendSceneV2?.design ? { design: { ...layout.backendSceneV2.design,
        highlights: layout.backendSceneV2.design.highlights.map(h=>({...h, objectIds:h.objectIds.filter(id=>objects.some(o=>o.id===id))})),
        requirements: layout.backendSceneV2.design.requirements.map(r=>r.objectIds.some(id=>!objects.some(o=>o.id===id))
          ? {...r,status:'unmet',reason:'关联物件已被编辑或删除，请重新核对要求。',objectIds:r.objectIds.filter(id=>objects.some(o=>o.id===id))} : r),
      } } : {}),
    } : {}),
    ...(options.planningZonesV1 && zones?.length ? { planningZones: { version: 1 as const, zones: zones.map(zone => ({
      id: zone.id, name: zone.name, color: zone.color, x: zoneCoordinate(zone.x + layout.width / 2), z: zoneCoordinate(zone.z + layout.height / 2),
      width: zoneCoordinate(zone.w), depth: zoneCoordinate(zone.d), ...(zone.zoneType === undefined ? {} : { zoneType: zone.zoneType }), source: 'unverified' as const })) } } : {}),
    objects, camera: layout.backendCamera ?? 'overview', lighting: layout.backendLighting ?? 'neutral',
  };
  if (geometric && geometric.structure.openings.length !== floor.items.filter(i=>i.structuralOpeningId).length) {
    throw new SceneAdapterError('OPENING_MISSING_WALL', '门窗未关联有效墙段，请修正位置或删除该门窗后保存。');
  }
  const result = sceneSchema.safeParse(candidate);
  if (!result.success) {
    throw new SceneAdapterError('INVALID_SCENE', `场景未通过后端校验，未保存：${result.error.issues[0]?.message ?? '格式错误'}`);
  }
  const conflicts = dimensionConflicts(result.data);
  if (conflicts.length) throw new SceneAdapterError('DIMENSION_CONFLICT', conflicts[0].message);
  return result.data;
}

/** Dimensions are user supplied; rectangular walls remain assumptions until separately reviewed. */
export function createMeasuredRoomLayout(base: RoomLayout, dimensions: { width: number; depth: number; height: number }): RoomLayout {
  if (base.backendSceneV2) throw new SceneAdapterError('STRUCTURE_RESIZE_REQUIRES_REVIEW', '已有结构需要修改尺寸约束并重新核对，不能只缩放外框。');
  const old = layoutToBackendScene(base);
  const { width, depth, height } = dimensions;
  const points = [{ x: 0, z: 0 }, { x: width, z: 0 }, { x: width, z: depth }, { x: 0, z: depth }];
  const walls = points.map((start, index) => ({ id: crypto.randomUUID(), start, end: points[(index + 1) % 4],
    thickness: 0.16, height, kind: 'exterior', status: 'inferred' }));
  const openings = old.venue.entrances.map(entrance => {
    const {x,z}=entrance.position;
    const owners = [Math.abs(z)<1e-6 ? 0 : -1, Math.abs(x-old.venue.width)<1e-6 ? 1 : -1,
      Math.abs(z-old.venue.depth)<1e-6 ? 2 : -1, Math.abs(x)<1e-6 ? 3 : -1].filter(index=>index>=0);
    for (const index of owners) {
      const length=index%2 ? depth : width;
      const center=index===0 ? x : index===1 ? z : index===2 ? width-x : depth-z;
      const offset=center-entrance.width/2;
      if (offset>=0 && offset+entrance.width<=length) return {id:entrance.id,wallId:walls[index]!.id,
        kind:'door',offset,width:entrance.width,height:Math.min(2.2,height),sillHeight:0,status:'inferred'};
    }
    throw new SceneAdapterError('ENTRANCE_REQUIRES_REVIEW','原出入口无法放入新的墙段，请先核对场地尺寸与入口位置。');
  });
  const candidate = backendSceneToLayout({ ...old, schemaVersion: 2, venue: { ...old.venue, width, depth, height, entrances:[] },
    structure: { walls, openings, columns: [] }, sources: [],
    dimensions: (['width', 'depth', 'height'] as const).map(kind => ({ id: crypto.randomUUID(), kind,
      valueMeters: dimensions[kind], status: 'confirmed', label: kind === 'width' ? '总宽' : kind === 'depth' ? '总长' : '净高' })) },
    { name: base.name, ...(base.id ? { projectId: base.id } : {}) });
  if (!canApplyLayoutGeometry(base, candidate)) throw new SceneAdapterError('STRUCTURAL_COLLISION', '新尺寸会使现有物件穿墙或超出边界，请先移动这些物件。');
  return mergeMeasuredPresentation(base, candidate);
}
function mergeMeasuredPresentation(base: RoomLayout, next: RoomLayout): RoomLayout {
  const merged = mergeProposalPresentation(base, next);
  const existing = new Map(base.floors.flatMap(floor => floor.items.map(item => [item.id, item] as const)));
  return { ...merged, floors: merged.floors.map((floor, i) => ({ ...floor,
    floorColor: base.floors[i]?.floorColor ?? floor.floorColor,
    items: floor.items.map(item => {
      const old = existing.get(item.id);
      return old && old.type === item.type && old.assetId === item.assetId
        ? { ...item, ...(old.glbUrl ? { glbUrl: old.glbUrl } : {}), ...(old.source ? { source: old.source } : {}) }
        : item;
    }),
  })) };
}
