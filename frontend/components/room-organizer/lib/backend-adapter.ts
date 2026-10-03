import libraryAssetIds from '../../../../assets/library/asset-ids.json';
import libraryAssetLabels from '../../../../assets/library/asset-labels.zh.json';
/** The backend domain is the single wire-format authority. No parallel API schema. */
import { catalog, sceneSchema, type Scene, type SceneObject } from '../../../../supabase/functions/_shared/domain';
import { dimensionConflicts } from '../../../../supabase/functions/_shared/structural-geometry';
import { MAX_ITEM_DIMENSION, MAX_ROOM_DIMENSION } from './constants';
import { MAX_STOREY_HEIGHT, MIN_STOREY_HEIGHT } from './storeys';
import { layoutGeometryScene, canApplyLayoutGeometry, stableMeasurement } from './structural-layout';
import type { FurnitureItem, RoomLayout } from './types';

const publicLibraryIds = new Set(Object.values(libraryAssetIds));

export class SceneAdapterError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'SceneAdapterError';
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
}

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
  const ids = new Set(scene.objects.map(o => o.id));
  if (scene.venue.entrances.some(e => ids.has(e.id))) {
    throw new SceneAdapterError('ENTRANCE_ID_COLLISION', '出入口与物件编号重复，无法无损打开。');
  }
  const items: FurnitureItem[] = scene.objects.map(o => {
    const minFootprint = o.materialId === 'asset' ? 0.02 : 0.1;
    if (Math.max(o.size.width, o.size.depth, o.size.height) > MAX_ITEM_DIMENSION ||
        o.size.width < minFootprint || o.size.depth < minFootprint || o.size.height < 0.01) {
      throw new SceneAdapterError('OBJECT_SIZE_NOT_SUPPORTED', `物件尺寸超出此版编辑器范围（宽深至少 ${minFootprint} 米、高至少 0.01 米），未打开项目，原尺寸未改动。`);
    }
    const meta = catalog.find(entry => entry.id === o.materialId);
    return {
      id: o.id, type: rendererTypes[o.materialId], materialId: o.materialId,
      name: o.assetId ? (libraryAssetLabels as Record<string, string>)[o.assetId] ?? options.assetNames?.[o.assetId] ?? '三维资产' : meta?.name ?? o.materialId,
      width: o.size.width, depth: o.size.depth, height: o.size.height,
      position: { x: o.position.x - scene.venue.width / 2, z: o.position.z - scene.venue.depth / 2 },
      rotation: backendDegreesToEditorRadians(o.rotation), color: o.color, icon: icons[o.materialId],
      locked: o.locked, notes: o.notes,
      ...(o.elevation !== undefined ? { elevation: o.elevation } : {}),
      ...(o.wallId ? { wallId: o.wallId } : {}),
      ...(o.assetId ? { assetId: o.assetId, ...(publicLibraryIds.has(o.assetId) ? { source: 'public_library' as const } : {}) } : { source: 'builtin' as const }),
      ...(o.assetId && options.assetUrls?.[o.assetId] ? { glbUrl: options.assetUrls[o.assetId] } : {}),
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
    name: options.name ?? '活动场景', width: scene.venue.width, height: scene.venue.depth,
    floors: [{ id: 'event-floor', name: '活动场地', height: scene.venue.height,
      floorColor: scene.schemaVersion === 2 ? scene.finishes?.floorColor ?? scene.design?.palette[0] ?? '#e9e5db' : '#e9e5db',
      ...(scene.schemaVersion === 2 && scene.finishes?.floorPattern ? { floorPattern: scene.finishes.floorPattern } : {}), items,
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

export function layoutToBackendScene(layout: RoomLayout): Scene {
  if (layout.scenePreset || layout.floors.some(floor => floor.items.some(item => item.glbNode))) {
    throw new SceneAdapterError('PRESET_LOCAL_ONLY', '完整场景预设保存在此浏览器，暂不支持云保存或 AI 修改；原场馆结构和物件改动会保留。');
  }
  if (layout.floors.length !== 1) throw new SceneAdapterError('MULTI_FLOOR_NOT_SUPPORTED', '云端首版只支持单层场地，请保留本地方案。');
  if (!layout.backendSceneV2 && (layout.floorPlanImage || layout.backendVenue?.floorplanAssetId)) {
    throw new SceneAdapterError('FLOORPLAN_NOT_SUPPORTED', '平面图尚未接入云保存，不能忽略底图后保存。');
  }
  if (!layout.backendSceneV2 && layout.backendVenue?.shape === 'polygon') {
    throw new SceneAdapterError('POLYGON_NOT_SUPPORTED', '多边形场地尚未接入此版编辑器，不能改存为矩形。');
  }
  const floor = layout.floors[0]!;
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
    const assetId = item.assetId ?? (libraryAssetIds as Record<string,string>)[item.glbUrl ?? ''];
    if ((item.type === 'glb-asset' || item.glbUrl) && !assetId) {
      throw new SceneAdapterError('LOCAL_ASSET_NOT_UPLOADED', '本地 GLB 样例尚未归档到云端，不能作为云资产保存。');
    }
    const inferred = Object.entries(rendererTypes).find(([, type]) => type === item.type)?.[0];
    const materialId = item.materialId ?? inferred;
    if (!materialId) throw new SceneAdapterError('MATERIAL_NOT_SUPPORTED', `物料“${item.name}”不在活动目录中，无法保存。`);
    const original = layout.backendSceneV2?.objects.find(o=>o.id===item.id);
    return {
      id: item.id, materialId, ...(assetId ? { assetId } : {}),
      position: { x: stableMeasurement(item.position.x + layout.width / 2, original?.position.x), z: stableMeasurement(item.position.z + layout.height / 2, original?.position.z) },
      rotation: stableMeasurement(editorRadiansToBackendDegrees(item.rotation ?? 0), original?.rotation),
      size: { width: item.width, depth: item.depth, height: item.height }, color: item.color,
      locked: item.locked ?? false, notes: item.notes ?? '',
      ...(item.elevation !== undefined ? { elevation: item.elevation } : {}),
      ...(item.wallId ? { wallId: item.wallId } : {}),
    };
  });
  const geometric = layout.backendSceneV2 ? layoutGeometryScene(layout) : null;
  const originalFinishes = layout.backendSceneV2?.finishes;
  const wallColors = Object.fromEntries((floor.interiorWalls ?? []).filter(w=>w.color).map(w=>[w.id,w.color]));
  const finishes = {
    ...originalFinishes,
    ...(originalFinishes?.floorColor !== undefined || floor.floorColor !== (layout.backendSceneV2?.design?.palette[0] ?? '#e9e5db') ? { floorColor: floor.floorColor } : {}),
    ...(floor.floorPattern ? { floorPattern: floor.floorPattern } : {}),
    ...(originalFinishes?.wallColors !== undefined || Object.keys(wallColors).length ? { wallColors } : {}),
  };
  const candidate = {
    ...(layout.backendSceneV2 ?? {}),
    schemaVersion: layout.backendSceneV2 ? 2 : 1,
    venue: { ...(layout.backendVenue ?? {}), width: layout.width, depth: layout.height, height: floor.height ?? 3, shape: layout.backendVenue?.shape ?? 'rectangle', entrances },
    ...(geometric ? { structure: geometric.structure,
      ...(originalFinishes || Object.keys(finishes).length ? { finishes } : {}),
      ...(layout.backendSceneV2?.design ? { design: { ...layout.backendSceneV2.design,
        highlights: layout.backendSceneV2.design.highlights.map(h=>({...h, objectIds:h.objectIds.filter(id=>objects.some(o=>o.id===id))})),
        requirements: layout.backendSceneV2.design.requirements.map(r=>r.objectIds.some(id=>!objects.some(o=>o.id===id))
          ? {...r,status:'unmet',reason:'关联物件已被编辑或删除，请重新核对要求。',objectIds:r.objectIds.filter(id=>objects.some(o=>o.id===id))} : r),
      } } : {}),
    } : {}),
    objects, camera: layout.backendCamera ?? 'overview', lighting: layout.backendLighting ?? 'warm',
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

/** Explicit v1 → v2 upgrade from measured dimensions, without model inference. */
export function createMeasuredRoomLayout(base: RoomLayout, dimensions: { width: number; depth: number; height: number }): RoomLayout {
  if (base.backendSceneV2) throw new SceneAdapterError('STRUCTURE_RESIZE_REQUIRES_REVIEW', '已有结构需要修改尺寸约束并重新核对，不能只缩放外框。');
  const old = layoutToBackendScene(base);
  const { width, depth, height } = dimensions;
  const points = [{ x: 0, z: 0 }, { x: width, z: 0 }, { x: width, z: depth }, { x: 0, z: depth }];
  const walls = points.map((start, index) => ({ id: crypto.randomUUID(), start, end: points[(index + 1) % 4],
    thickness: 0.16, height, kind: 'exterior', status: 'confirmed' }));
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
  return { ...base, ...next, floors: next.floors.map((floor, i) => ({ ...floor,
    floorColor: base.floors[i]?.floorColor ?? floor.floorColor })) };
}
