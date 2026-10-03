import library from '../../../assets/library/merged.json' with { type: 'json' };
import { sizeSchema, uuid, type Scene } from './domain.ts';
import type { Backend } from './backend.ts';

export interface SceneResource {
  resourceId: string;
  assetId: string;
  name: string;
  category: string;
  size?: { width: number; depth: number; height: number };
}

// Use the same reviewed placement dimensions as the visible model library.
// Raw GLB bounds are not a statement of real-world dimensions.
export const libraryResources: readonly SceneResource[] = library.models.filter(model => model.assetId && !('blockedReason' in model)).map((model,index) => ({
  resourceId: `library:${index}`, assetId: uuid.parse(model.assetId),
  name: model.name.replace(/\s*\([^()]*\)\s*$/, '').trim(), category: model.subcategory,
  size: sizeSchema.parse(Object.fromEntries(['width','depth','height'].map(key =>
    [key,Math.min(50,Math.max(0.02,Math.round(model[key as 'width'|'depth'|'height']*1000)/1000))]))),
}));

/** Server-owned inventory. No storage paths, URLs, owner IDs or license payloads reach the model. */
export async function readSceneResources(backend: Backend, actor: string, scene: Scene): Promise<SceneResource[]> {
  const resources = new Map(libraryResources.map(resource => [resource.assetId,resource]));
  const own: { id: string; name: string; format: string }[] = await backend.scene(actor,'assets.list');
  for (const asset of own) {
    if (asset.format !== 'glb' || resources.has(asset.id)) continue;
    resources.set(asset.id,{ resourceId:`asset:${uuid.parse(asset.id)}`,assetId:asset.id,name:asset.name.slice(0,120),category:'个人素材；尺寸待指定' });
  }
  for (const object of scene.objects) {
    if (!object.assetId) continue;
    let resource=resources.get(object.assetId);
    if (!resource) {
      const asset=await backend.scene(actor,'assets.get',{assetId:object.assetId});
      resource={resourceId:`asset:${object.assetId}`,assetId:object.assetId,name:String(asset.name).slice(0,120),category:'当前场景素材'};
    }
    if (!resource.size) resources.set(object.assetId,{...resource,size:{...object.size}});
  }
  return [...resources.values()];
}

/** Compact rows keep the full public index bounded for the scene and repair call. */
export function resourceIndex(resources: readonly SceneResource[]) {
  return { columns:['resourceId','name','category','sizeMeters'],items:resources.map(resource =>
    [resource.resourceId,resource.name,resource.category,resource.size ? [resource.size.width,resource.size.depth,resource.size.height] : null]) };
}

/** Link existing instances to their catalogue identity without trusting client labels. */
export function sceneResourceRefs(scene: Scene, resources: readonly SceneResource[]) {
  const refs=new Map(resources.map(resource=>[resource.assetId,resource.resourceId]));
  return Object.fromEntries(scene.objects.filter(object=>object.assetId && refs.has(object.assetId))
    .map(object=>[object.id,refs.get(object.assetId!)]));
}
