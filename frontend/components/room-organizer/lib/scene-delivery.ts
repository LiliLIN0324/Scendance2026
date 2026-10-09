import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import assetIds from '../../../../assets/library/asset-ids.json';
import catalogue from '../../../../assets/library/catalogue.json';
import { createFurnitureModel } from '../three/furniture-builders';
import { disposeOwnedModel, ensureGlbAsset, getGlbAssetState, glbAssetKey } from '../three/glb-assets';
import { buildRoom } from '../three/room-builder';
import { buildStructureShell } from '../three/structure-builder';
import { computeWallOpenings } from '../three/wall-openings';
import { layoutToBackendScene } from './backend-adapter';
import { handoffSchema, type Handoff } from '../../../../supabase/functions/_shared/delivery-contract';
import { blankHandoff, effectiveHandoffStatus, HANDOFF_STATUS_LABELS } from './scene-handoff';
import { eventOperationsSchema, type EventOperationTask } from '../../../../supabase/functions/_shared/event-operations-contract';
import { operationReview, OPERATION_PHASE_LABELS, OPERATION_STATUS_LABELS } from './event-operations';
import type { RoomLayout } from './types';
import type { MaterialCheckinLedger } from '../../../../supabase/functions/_shared/material-checkin-contract';
import type { BackendSession } from '@/lib/backend-session';

export function deliveryScene(layout: RoomLayout) {
  if (layout.scenePreset || layout.floors.some(floor => floor.items.some(item => item.glbNode))) {
    throw new Error('完整场景预设暂不支持交付导出，固定场馆结构和物件会保留在云方案中。');
  }
  if(layout.entrance)throw new Error('当前交付不支持本地建筑入口扩展，请保留原始方案。');
  return layoutToBackendScene(layout);
}
const materialItems = (layout: RoomLayout) => layout.floors.flatMap(floor => floor.items.filter(item => !item.venueEntranceId && !item.structuralOpeningId && !item.structuralColumnId));
const publicModels = new Map(catalogue.models.map(model => [(assetIds as Record<string,string>)[model.cdnUrl], model]));
export interface DeliveryMaterial {
  name: string; materialId: string; assetVersionId: string | null; source: string;
  width: number; depth: number; height: number; color: string; quantity: number; objectIds: string[];
  procurement: '概念物料，采购待确认' | '规格与采购待确认';
  sourceUrl: string | null; license: string | null; sha256: string | null;
}

/** A version reference is the archived immutable asset ID, never an expiring URL. */
export function deliveryMaterials(layout: RoomLayout): DeliveryMaterial[] {
  const scene = deliveryScene(layout);
  const names = new Map(materialItems(layout).map(item => [item.id, item]));
  const groups = new Map<string, DeliveryMaterial>();
  for (const object of scene.objects) {
    const item = names.get(object.id)!;
    const publicModel = object.assetId ? publicModels.get(object.assetId) : undefined;
    const source = publicModel ? 'public_library' : item.source ?? (object.assetId ? 'cloud_asset' : 'builtin');
    const key = JSON.stringify([object.assetId ?? object.materialId, object.size, object.color, source]);
    const prior = groups.get(key);
    if (prior) { prior.quantity++; prior.objectIds.push(object.id); continue; }
    groups.set(key, { name: item.name, materialId: object.materialId, assetVersionId: object.assetId ?? null, source,
      ...object.size, color: object.color, quantity: 1, objectIds: [object.id],
      procurement: source === 'generated' ? '概念物料，采购待确认' : '规格与采购待确认',
      sourceUrl: publicModel?.pageUrl ?? null, license: publicModel ? catalogue.license : null, sha256: publicModel?.sha256 ?? null });
  }
  return [...groups.values()];
}

export interface DeliverySnapshot { id: string; generatedAt: string }
export interface DeliveryExecution extends Omit<Handoff, 'reviewedBasis'> {
  objectId: string; name: string; materialId: string; assetVersionId: string | null;
  floorId: string; floorName: string; size: { width: number; depth: number; height: number };
  position: { x: number; z: number }; rotation: number; elevation: number;
  hasHandoff: boolean; effectiveStatus: Handoff['status'] | 'needs_review';
}

export async function deliveryExecution(layout: RoomLayout): Promise<DeliveryExecution[]> {
  const scene = deliveryScene(layout);
  return Promise.all(scene.objects.map(async object => {
    const floor = layout.floors.find(entry => entry.items.some(item => item.id === object.id))!;
    const item = floor.items.find(entry => entry.id === object.id)!;
    const { reviewedBasis: _localBasis, ...handoff } = handoffSchema.parse(item.handoff ?? blankHandoff());
    return { ...handoff, objectId: object.id, name: item.name, materialId: object.materialId,
      assetVersionId: object.assetId ?? null, floorId: floor.id, floorName: floor.name,
      size: object.size, position: object.position, rotation: object.rotation, elevation: object.elevation ?? 0,
      hasHandoff: !!item.handoff, effectiveStatus: await effectiveHandoffStatus(layout, item.id) };
  }));
}

export interface DeliveryOperation extends Omit<EventOperationTask, 'reviewedBasis'> {
  effectiveStatus: EventOperationTask['status'] | 'needs_review'; missingObjectIds: string[];
  ambiguousObjectIds?: string[]; missingProductionObjectIds?: string[]; ambiguousProductionObjectIds?: string[];
}
export async function deliveryOperations(layout: RoomLayout, checkins?: MaterialCheckinLedger): Promise<{
  schemaVersion: 1; dataKind: 'unspecified' | 'rehearsal' | 'real'; tasks: DeliveryOperation[];
} | null> {
  if (!layout.eventOperations) return null;
  const operations = eventOperationsSchema.parse(layout.eventOperations);
  return { schemaVersion: 1, dataKind: operations.dataKind, tasks: await Promise.all(operations.tasks.map(async task => {
    const { reviewedBasis: _localBasis, ...fields } = task;
    const review = await operationReview(layout, task, checkins);
    return { ...fields, effectiveStatus: review.status, missingObjectIds: review.missingObjectIds,
      ...(review.ambiguousObjectIds?.length ? { ambiguousObjectIds: review.ambiguousObjectIds } : {}),
      ...(review.missingProductionObjectIds?.length ? { missingProductionObjectIds: review.missingProductionObjectIds } : {}),
      ...(review.ambiguousProductionObjectIds?.length ? { ambiguousProductionObjectIds: review.ambiguousProductionObjectIds } : {}),
    };
  })) };
}

export async function sceneDeliveryJson(layout: RoomLayout, snapshot?: DeliverySnapshot, checkins?: MaterialCheckinLedger): Promise<string> {
  const scene = deliveryScene(layout);
  return JSON.stringify({ format: 'scendance-scene-delivery', version: 2, units: 'm', upAxis: 'Y',
    coordinateOrigin: 'venue-north-west', name: layout.name, ...(snapshot ? { snapshot } : {}), scene,
    execution: await deliveryExecution(layout), materials: deliveryMaterials(layout),
    operations: await deliveryOperations(layout, checkins), operationsTimeZone: 'Asia/Shanghai',
    source: { kind: 'editor-snapshot', layoutId: layout.id ?? null },
    note: 'assetVersionId 为归档资产标识；重新打开私有资产仍需项目授权。GLB 不包含编辑器环境光和后处理。' }, null, 2);
}

function csvField(value: unknown): string {
  const text = String(value ?? '');
  const safe = typeof value === 'string' && /^\s*[=+\-@]|^[\t\r\n]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}
export function sceneDeliveryCsv(layout: RoomLayout, snapshot?: DeliverySnapshot): string {
  const rows: unknown[][] = [['名称','物料类型','资产版本ID','来源','宽/m','深/m','高/m','颜色','数量','物件ID','采购状态','来源页面','许可','SHA256','交付编号','生成时间']];
  for (const item of deliveryMaterials(layout)) rows.push([item.name,item.materialId,item.assetVersionId,item.source,item.width,item.depth,item.height,item.color,item.quantity,item.objectIds.join(';'),item.procurement,item.sourceUrl,item.license,item.sha256,snapshot?.id,snapshot?.generatedAt]);
  return '\uFEFF' + rows.map(row => row.map(csvField).join(',')).join('\r\n');
}

export async function sceneExecutionCsv(layout: RoomLayout, snapshot?: DeliverySnapshot): Promise<string> {
  const rows: unknown[][] = [['物件ID','名称','物料类型','资产版本ID','楼层','宽/m','深/m','高/m','X/m','Z/m','旋转/度','离地/m','数量','负责人','期限','验收条件','记录状态','有效状态','证据链接','验收说明','交付编号','生成时间']];
  for (const item of await deliveryExecution(layout)) rows.push([item.objectId,item.name,item.materialId,item.assetVersionId,
    item.floorName,item.size.width,item.size.depth,item.size.height,item.position.x,item.position.z,item.rotation,item.elevation,
    1,item.ownerName,item.dueDate,item.acceptance,HANDOFF_STATUS_LABELS[item.status],
    item.hasHandoff ? HANDOFF_STATUS_LABELS[item.effectiveStatus] : '未分配',item.evidenceUrls.join('\n'),item.evidenceNote,
    snapshot?.id,snapshot?.generatedAt]);
  return '\uFEFF' + rows.map(row => row.map(csvField).join(',')).join('\r\n');
}

/** Text schedules remain deliverable even when venue/model exports are unsupported. */
export async function eventOperationsCsv(layout: RoomLayout, snapshot?: DeliverySnapshot, checkins?: MaterialCheckinLedger): Promise<string> {
  const kinds = { unspecified: '未标注', rehearsal: '演练', real: '真实' };
  const operations = await deliveryOperations(layout, checkins);
  const rows: unknown[][] = [['任务编号','任务标题','阶段','负责人','承接团队','计划开始','计划结束','实际开始','实际结束','完成条件','记录状态','有效状态','关联物件编号','缺失物件编号','现场核对说明','证据链接','资料类型','界面输入时区','交付编号','生成时间','场景名称','本地项目编号','歧义物件编号','制作计划缺失物件编号','制作计划歧义物件编号']];
  for (const task of operations?.tasks ?? []) rows.push([task.id,task.title,OPERATION_PHASE_LABELS[task.phase],task.ownerName,
    task.contractorName,task.plannedStartAt,task.plannedEndAt,task.actualStartedAt,task.actualFinishedAt,task.acceptance,
    OPERATION_STATUS_LABELS[task.status],OPERATION_STATUS_LABELS[task.effectiveStatus],task.objectIds.join(';'),task.missingObjectIds.join(';'),
    task.evidenceNote,task.evidenceUrls.join('\n'),kinds[operations!.dataKind],'Asia/Shanghai',snapshot?.id,snapshot?.generatedAt,layout.name,layout.id,
    task.ambiguousObjectIds?.join(';'),task.missingProductionObjectIds?.join(';'),task.ambiguousProductionObjectIds?.join(';')]);
  return '\uFEFF' + rows.map(row => row.map(csvField).join(',')).join('\r\n');
}

/** Reject unsupported local presets/structures through the existing scene adapter. */
export async function prepareDeliveryAssets(layout: RoomLayout, controller?: BackendSession): Promise<void> {
  const scene = deliveryScene(layout);
  const objects = new Map(scene.objects.map(object => [object.id, object]));
  for (const item of materialItems(layout)) {
    const object = objects.get(item.id)!;
    if (!object.assetId) continue;
    const key = glbAssetKey(item) ?? object.assetId;
    if (getGlbAssetState(key).status === 'ready') continue;
    const url = controller?.getSnapshot().user ? (await controller.authorizeAsset(object.assetId)).url : item.glbUrl;
    if (!url) throw new Error(`“${item.name}”模型尚未加载，请连接项目后重试。`);
    await ensureGlbAsset(key, url);
  }
}

/** Fresh assembly prevents cutaway visibility, selection, ghosting and collision tints leaking into delivery. */
export function assembleDeliveryScene(layout: RoomLayout): THREE.Scene {
  const canonical = deliveryScene(layout);
  const scene = new THREE.Scene();
  scene.name = layout.name || 'Scendance';
  scene.userData = { format: 'scendance-scene-delivery', units: 'm', upAxis: 'Y', coordinateOrigin: 'venue-center' };
  try {
    const floor = layout.floors[0];
    if (canonical.schemaVersion === 2) buildStructureShell(THREE, scene, layout);
    else buildRoom(THREE, { scene, width: layout.width, depth: layout.height, wallHeight: canonical.venue.height,
      floorColor: floor.floorColor, floorPattern: floor.floorPattern ?? 'solid', wallPattern: floor.wallPattern ?? 'solid',
      wallOpenings: computeWallOpenings(floor.items,layout.width,layout.height,canonical.venue.height),
      wallColors: floor.wallColors ?? {}, hiddenWalls: floor.hiddenWalls ?? [], floorPlanImage: null,
      floorPlanOpacity: 0, floorPlanFitMode: 'contain', floorPlan3DEffect: false });
    // Room builders include editing grid lines. They are not physical deliverables.
    for (const child of [...scene.children]) if ((child as THREE.Line).isLine) { const line=child as THREE.Line;scene.remove(line);line.geometry.dispose();for(const material of Array.isArray(line.material)?line.material:[line.material])material.dispose(); }
    scene.children.forEach((child,index)=>{child.userData.deliveryObjectId=`shell:${index}`;child.userData.deliveryKind='shell';});
    const expected = new Map(canonical.objects.map(object => [object.id, object]));
    for (const item of floor.items) {
      if (item.venueEntranceId) continue;
      const object = expected.get(item.id);
      const model = createFurnitureModel(THREE, item, false);
      if ((item.assetId || item.glbUrl || item.type === 'glb-asset') && model.userData.glbStatus !== 'ready') {
        disposeOwnedModel(model); throw new Error(`“${item.name}”模型尚未就绪，未导出占位物件。`);
      }
      if (!item.position) { disposeOwnedModel(model); throw new Error(`“${item.name}”缺少位置，无法导出。`); }
      model.name = item.name;
      model.position.set(item.position.x, 0, item.position.z);
      model.rotation.y = item.rotation ?? 0;
      if (item.mirrored) model.scale.x *= -1;
      model.userData = { ...model.userData, deliveryObjectId: item.id,
        deliveryKind: object ? 'material' : 'structure', assetVersionId: object?.assetId ?? null };
      scene.add(model);
    }
    scene.updateMatrixWorld(true);
    return scene;
  } catch (error) { disposeOwnedModel(scene); throw error; }
}

type TriangleCheck = { values: number[]; material: string };
type GeometryCheck = { matrix: number[]; triangles: TriangleCheck[]; materials: string[]; bounds: number[] };
/** Pixel IDs are shared across the before/after checks. Hash buckets are only an
 * accelerator: byte equality is checked too, so a checksum collision cannot pass. */
function textureChecks() {
  const images = new Map<unknown, Map<boolean,string>>();
  const pixels = new Map<string,{id:string;data:Uint8Array | Uint8ClampedArray}[]>();
  let nextId = 0;
  return (texture:THREE.Texture):string => {
    const image = texture.image as {width:number;height:number;data?:ArrayLike<number>};
    const cached = images.get(image)?.get(texture.flipY);
    if (cached) return cached;
    const width=image?.width,height=image?.height;
    if (!Number.isInteger(width)||!Number.isInteger(height)||width<=0||height<=0||width*height>4096*4096) throw new Error('纹理像素无法完整读取，未导出。');
    let data:Uint8Array | Uint8ClampedArray;
    if (image.data) {
      if (texture.format!==THREE.RGBAFormat||texture.type!==THREE.UnsignedByteType||image.data.length!==width*height*4) throw new Error('当前交付不支持此纹理像素格式，未导出。');
      data=Uint8Array.from(image.data);
      if(texture.flipY) {
        const original=data.slice(),row=width*4;
        for(let y=0;y<height;y++)data.set(original.subarray((height-1-y)*row,(height-y)*row),y*row);
      }
    } else {
      if(typeof document==='undefined')throw new Error('纹理像素无法完整读取，未导出。');
      const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
      try {
        const context=canvas.getContext('2d',{willReadFrequently:true});
        if(!context)throw new Error('canvas');
        if(texture.flipY){context.translate(0,height);context.scale(1,-1);}
        context.drawImage(image as CanvasImageSource,0,0,width,height);
        data=context.getImageData(0,0,width,height).data;
      } catch {throw new Error('纹理像素无法完整读取，未导出。');}
      finally {canvas.width=0;canvas.height=0;}
    }
    let hash=2166136261;
    for(let i=0;i<data.length;i++)hash=Math.imul(hash^data[i],16777619);
    const key=`${width}:${height}:${hash}`,bucket=pixels.get(key)??[];
    let match=bucket.find(entry=>entry.data.length===data.length&&entry.data.every((value,i)=>value===data[i]));
    if(!match){match={id:String(nextId++),data};bucket.push(match);pixels.set(key,bucket);}
    const byOrientation=images.get(image)??new Map<boolean,string>();byOrientation.set(texture.flipY,match.id);images.set(image,byOrientation);
    return match.id;
  };
}
function materialSignature(material: THREE.Material, pixelId:ReturnType<typeof textureChecks>): string {
  const standard = material as THREE.MeshStandardMaterial;
  const textureSignature = (texture: THREE.Texture | null | undefined) => texture ? {
    pixels:pixelId(texture),colorSpace:texture.colorSpace,
    sampler:[texture.channel,texture.wrapS,texture.wrapT,...texture.offset.toArray(),...texture.repeat.toArray(),texture.rotation].map(value=>Math.round(value*1e5)),
  } : null;
  return JSON.stringify({ color: standard.color?.toArray().map(value => Math.round(value * 1e5)),
    roughness: Math.round((standard.roughness ?? 1) * 1e5), metalness: Math.round((standard.metalness ?? 0) * 1e5),
    opacity: Math.round(material.opacity * 1e5), alphaTest:Math.round(material.alphaTest*1e5), side: material.side,
    emissive:standard.emissive?.toArray().map(value=>Math.round(value*1e5)),emissiveIntensity:Math.round((standard.emissiveIntensity??1)*1e5),
    normalScale:standard.normalMap?standard.normalScale.toArray().map(value=>Math.round(value*1e5)):null,
    aoMapIntensity:standard.aoMap?Math.round(standard.aoMapIntensity*1e5):null,
    textures:Object.fromEntries(Object.entries(material).filter(([,value])=>value instanceof THREE.Texture).sort(([a],[b])=>a.localeCompare(b)).map(([name,value])=>[name,textureSignature(value as THREE.Texture)])) });
}
function compareValues(a:number[],b:number[]):number {
  for(let i=0;i<a.length;i++)if(Math.abs(a[i]-b[i])>1e-7)return a[i]-b[i];
  return 0;
}
function geometryChecks(scene: THREE.Object3D,pixelId:ReturnType<typeof textureChecks>): Map<string, GeometryCheck> {
  scene.updateMatrixWorld(true);
  const result = new Map<string, GeometryCheck>();
  const materialSignatures=new Map<THREE.Material,string>();
  const signature=(material:THREE.Material)=>{
    let value=materialSignatures.get(material);
    if(value===undefined){value=materialSignature(material,pixelId);materialSignatures.set(material,value);}
    return value;
  };
  scene.traverse(object => {
    const id = object.userData.deliveryObjectId as string | undefined;
    if (!id) return;
    if (result.has(id)) throw new Error('导出包含重复物件标识。');
    const triangles: TriangleCheck[] = [], materials: string[] = [];
    object.traverse(node => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh) return;
      if ((mesh as THREE.SkinnedMesh).isSkinnedMesh || mesh.morphTargetInfluences?.length) throw new Error('当前场景交付只支持静态模型，请先移除骨骼或变形动画物件。');
      const position = mesh.geometry.getAttribute('position'), uv = mesh.geometry.getAttribute('uv'), uv1=mesh.geometry.getAttribute('uv1');
      if (!position) throw new Error('模型缺少顶点，未导出。');
      const signatures=(Array.isArray(mesh.material)?mesh.material:[mesh.material]).map(signature);
      const index = mesh.geometry.getIndex(),count=index?.count??position.count;
      if(count%3)throw new Error('模型包含非三角面，未导出。');
      for (let i = 0; i < count; i+=3) {
        const vertices=[0,1,2].map(offset=>{
          const vertex=index?index.getX(i+offset):i+offset;
          const point=new THREE.Vector3().fromBufferAttribute(position,vertex).applyMatrix4(mesh.matrixWorld);
          return [point.x,point.y,point.z,uv?.getX(vertex)??-1,uv?.getY(vertex)??-1,uv1?.getX(vertex)??-1,uv1?.getY(vertex)??-1];
        });
        // Cyclic rotations preserve winding; reversing a triangle never does.
        let start=0;
        for(let candidate=1;candidate<3;candidate++){
          const first=compareValues(vertices[candidate],vertices[start]);
          if(first<0||first===0&&compareValues(vertices[(candidate+1)%3],vertices[(start+1)%3])<0)start=candidate;
        }
        const material=signatures[Array.isArray(mesh.material)?mesh.geometry.groups.find(group=>i>=group.start&&i<group.start+group.count)?.materialIndex??0:0];
        triangles.push({values:[...vertices[start],...vertices[(start+1)%3],...vertices[(start+2)%3]],material});
      }
      materials.push(...signatures);
    });
    triangles.sort((a,b)=>a.material.localeCompare(b.material)||compareValues(a.values,b.values));
    const bounds = new THREE.Box3().setFromObject(object);
    result.set(id,{matrix:object.matrixWorld.toArray(),triangles,materials:materials.sort(),bounds:[...bounds.min.toArray(),...bounds.max.toArray()]});
  });
  return result;
}
function verifyChecks(before:Map<string,GeometryCheck>,after:Map<string,GeometryCheck>):number {
  const equal = (a:number[],b:number[]) => a.length === b.length && a.every((value,i) => Number.isFinite(value) && Number.isFinite(b[i]) && Math.abs(value-b[i]) <= 1e-5);
  if (before.size !== after.size) throw new Error('GLB 复检失败：物件数量不一致。');
  for (const [id,a] of before) {
    const b = after.get(id);
    if (!b || !equal(a.matrix,b.matrix) || !equal(a.bounds,b.bounds) || JSON.stringify(a.materials)!==JSON.stringify(b.materials) || a.triangles.length!==b.triangles.length || a.triangles.some((triangle,i)=>triangle.material!==b.triangles[i].material||!equal(triangle.values,b.triangles[i].values))) {
      throw new Error('GLB 复检失败：物件标识、几何、UV、材质或摆放发生变化。');
    }
  }
  return [...before.keys()].filter(id=>!id.startsWith('shell:')).length;
}
/** Compare actual reloaded triangles/UV, texture pixels, materials and placement. */
export function verifyDeliveryReload(source: THREE.Object3D, reloaded: THREE.Object3D): number {
  const pixelId=textureChecks();
  return verifyChecks(geometryChecks(source,pixelId),geometryChecks(reloaded,pixelId));
}

export async function exportDeliveryGlb(layout: RoomLayout, controller?: BackendSession): Promise<{ buffer: ArrayBuffer; objectCount: number }> {
  await prepareDeliveryAssets(layout, controller);
  const scene = assembleDeliveryScene(layout);
  let loaded: THREE.Object3D | undefined;
  try {
    // Run checks before export too, so unsupported skeletons cannot be silently flattened.
    const pixelId=textureChecks(),before=geometryChecks(scene,pixelId);
    // Exporter otherwise re-encodes the loader's original JPEG/WebP MIME type.
    // These textures belong to the fresh delivery scene; the asset cache is unchanged.
    scene.traverse(node=>{
      const mesh=node as THREE.Mesh;if(!mesh.isMesh)return;
      for(const material of Array.isArray(mesh.material)?mesh.material:[mesh.material])for(const value of Object.values(material)) {
        if(value instanceof THREE.Texture)value.userData={...value.userData,mimeType:'image/png'};
      }
    });
    const output = await new GLTFExporter().parseAsync(scene,{binary:true,onlyVisible:false});
    if (!(output instanceof ArrayBuffer)) throw new Error('导出器未返回 GLB 文件。');
    loaded = (await new GLTFLoader().parseAsync(output,'')).scene;
    return {buffer:output,objectCount:verifyChecks(before,geometryChecks(loaded,pixelId))};
  } finally { disposeOwnedModel(scene); if(loaded)disposeOwnedModel(loaded); }
}

export function downloadSceneDelivery(data: BlobPart, type: string, name: string, extension: 'glb'|'json'|'csv'|'html'): void {
  const url = URL.createObjectURL(new Blob([data],{type}));
  const anchor = document.createElement('a');
  anchor.href=url;anchor.download=`${(name||'Scendance').replace(/[\\/:*?"<>|\s]+/g,'_')}.${extension}`;
  try { anchor.click(); } finally { setTimeout(()=>URL.revokeObjectURL(url),0); }
}
