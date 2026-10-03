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
import type { RoomLayout } from './types';
import type { BackendSession } from '@/lib/backend-session';

function deliveryScene(layout: RoomLayout) {
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

export function sceneDeliveryJson(layout: RoomLayout): string {
  const scene = deliveryScene(layout);
  return JSON.stringify({ format: 'scendance-scene-delivery', version: 1, units: 'm', upAxis: 'Y',
    coordinateOrigin: 'venue-north-west', name: layout.name, scene, materials: deliveryMaterials(layout),
    note: 'assetVersionId 为归档资产标识；重新打开私有资产仍需项目授权。GLB 不包含编辑器环境光和后处理。' }, null, 2);
}

function csvField(value: unknown): string {
  const text = String(value ?? '');
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}
export function sceneDeliveryCsv(layout: RoomLayout): string {
  const rows: unknown[][] = [['名称','物料类型','资产版本ID','来源','宽/m','深/m','高/m','颜色','数量','物件ID','采购状态','来源页面','许可','SHA256']];
  for (const item of deliveryMaterials(layout)) rows.push([item.name,item.materialId,item.assetVersionId,item.source,item.width,item.depth,item.height,item.color,item.quantity,item.objectIds.join(';'),item.procurement,item.sourceUrl,item.license,item.sha256]);
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

type GeometryCheck = { matrix: number[]; corners: { values: number[]; material: string }[]; materials: string[]; bounds: number[] };
function materialSignature(material: THREE.Material): string {
  const standard = material as THREE.MeshStandardMaterial;
  const imageSize = (texture: THREE.Texture | null | undefined) => { const image=texture?.image as {width?:number;height?:number}|undefined; return texture ? [image?.width ?? 0,image?.height ?? 0,texture.channel,texture.wrapS,texture.wrapT,...texture.offset.toArray(),...texture.repeat.toArray(),texture.rotation].map(value=>Math.round(value*1e5)) : null; };
  return JSON.stringify({ color: standard.color?.toArray().map(value => Math.round(value * 1e5)),
    roughness: Math.round((standard.roughness ?? 1) * 1e5), metalness: Math.round((standard.metalness ?? 0) * 1e5),
    opacity: Math.round(material.opacity * 1e5), alphaTest:Math.round(material.alphaTest*1e5), side: material.side,
    emissive:standard.emissive?.toArray().map(value=>Math.round(value*1e5)),emissiveIntensity:Math.round((standard.emissiveIntensity??1)*1e5),map: imageSize(standard.map),
    normalMap: imageSize(standard.normalMap), emissiveMap:imageSize(standard.emissiveMap), aoMap:imageSize(standard.aoMap), roughnessMap: imageSize(standard.roughnessMap), metalnessMap: imageSize(standard.metalnessMap) });
}
function geometryChecks(scene: THREE.Object3D): Map<string, GeometryCheck> {
  scene.updateMatrixWorld(true);
  const result = new Map<string, GeometryCheck>();
  scene.traverse(object => {
    const id = object.userData.deliveryObjectId as string | undefined;
    if (!id) return;
    if (result.has(id)) throw new Error('导出包含重复物件标识。');
    const corners: GeometryCheck['corners'] = [], materials: string[] = [];
    object.traverse(node => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh) return;
      if ((mesh as THREE.SkinnedMesh).isSkinnedMesh || mesh.morphTargetInfluences?.length) throw new Error('当前场景交付只支持静态模型，请先移除骨骼或变形动画物件。');
      const position = mesh.geometry.getAttribute('position'), uv = mesh.geometry.getAttribute('uv'), uv1=mesh.geometry.getAttribute('uv1');
      if (!position) throw new Error('模型缺少顶点，未导出。');
      const signatures=(Array.isArray(mesh.material)?mesh.material:[mesh.material]).map(materialSignature);
      const index = mesh.geometry.getIndex();
      for (let i = 0; i < (index?.count ?? position.count); i++) {
        const vertex = index ? index.getX(i) : i;
        const point = new THREE.Vector3().fromBufferAttribute(position, vertex).applyMatrix4(mesh.matrixWorld);
        const signature = signatures[Array.isArray(mesh.material)?mesh.geometry.groups.find(group=>i>=group.start&&i<group.start+group.count)?.materialIndex ?? 0:0];
        corners.push({ values:[point.x,point.y,point.z,uv?.getX(vertex) ?? -1,uv?.getY(vertex) ?? -1,uv1?.getX(vertex) ?? -1,uv1?.getY(vertex) ?? -1],material:signature });
      }
      materials.push(...(Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map(materialSignature));
    });
    corners.sort((a,b) => { const material=a.material.localeCompare(b.material);if(material)return material;for(let i=0;i<a.values.length;i++) if(Math.abs(a.values[i]-b.values[i])>1e-7) return a.values[i]-b.values[i]; return 0; });
    const bounds = new THREE.Box3().setFromObject(object);
    result.set(id,{matrix:object.matrixWorld.toArray(),corners,materials:materials.sort(),bounds:[...bounds.min.toArray(),...bounds.max.toArray()]});
  });
  return result;
}

/** Compare actual reloaded geometry/UV, materials and placement before offering a download. */
export function verifyDeliveryReload(source: THREE.Object3D, reloaded: THREE.Object3D): number {
  const before = geometryChecks(source), after = geometryChecks(reloaded);
  const equal = (a:number[],b:number[]) => a.length === b.length && a.every((value,i) => Number.isFinite(value) && Number.isFinite(b[i]) && Math.abs(value-b[i]) <= 1e-5);
  if (before.size !== after.size) throw new Error('GLB 复检失败：物件数量不一致。');
  for (const [id,a] of before) {
    const b = after.get(id);
    if (!b || !equal(a.matrix,b.matrix) || !equal(a.bounds,b.bounds) || JSON.stringify(a.materials)!==JSON.stringify(b.materials) || a.corners.length!==b.corners.length || a.corners.some((corner,i)=>corner.material!==b.corners[i].material||!equal(corner.values,b.corners[i].values))) {
      throw new Error('GLB 复检失败：物件标识、几何、UV、材质或摆放发生变化。');
    }
  }
  return [...before.keys()].filter(id=>!id.startsWith('shell:')).length;
}

export async function exportDeliveryGlb(layout: RoomLayout, controller?: BackendSession): Promise<{ buffer: ArrayBuffer; objectCount: number }> {
  await prepareDeliveryAssets(layout, controller);
  const scene = assembleDeliveryScene(layout);
  let loaded: THREE.Object3D | undefined;
  try {
    // Run checks before export too, so unsupported skeletons cannot be silently flattened.
    geometryChecks(scene);
    const output = await new GLTFExporter().parseAsync(scene,{binary:true,onlyVisible:false});
    if (!(output instanceof ArrayBuffer)) throw new Error('导出器未返回 GLB 文件。');
    loaded = (await new GLTFLoader().parseAsync(output,'')).scene;
    return {buffer:output,objectCount:verifyDeliveryReload(scene,loaded)};
  } finally { disposeOwnedModel(scene); if(loaded)disposeOwnedModel(loaded); }
}

export function downloadSceneDelivery(data: BlobPart, type: string, name: string, extension: 'glb'|'json'|'csv'): void {
  const url = URL.createObjectURL(new Blob([data],{type}));
  const anchor = document.createElement('a');
  anchor.href=url;anchor.download=`${(name||'Scendance').replace(/[\\/:*?"<>|\s]+/g,'_')}.${extension}`;
  try { anchor.click(); } finally { setTimeout(()=>URL.revokeObjectURL(url),0); }
}
