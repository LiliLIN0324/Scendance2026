import { canonical, type SceneV2 } from '../../supabase/functions/_shared/domain';
import { layoutToBackendScene } from '../components/room-organizer/lib/backend-adapter';
import type { RoomLayout } from '../components/room-organizer/lib/types';
import { imageToWorldRegistration } from './reconstruction-review';
import type { ImagePoint, StoredSource } from './source-storage';

export interface ReferenceImageLayer {
  url: string; pixelWidth: number; pixelHeight: number;
  imageToWorld: readonly[number,number,number,number,number,number];
}
export interface ReferenceRegistration {
  sourceId: string; points: ImagePoint[];
  worldWidth?: number; worldDepth?: number; sourceAssetId?: string;
  imageWidth?: number; imageHeight?: number; appliedBasis?: string;
  confirmationId?: string;
}
export interface ReferenceImageResult {
  status: 'ready' | 'unavailable' | 'needs-review'; notice: string;
  source?: StoredSource; imageToWorld?: ReferenceImageLayer['imageToWorld'];
}
/** Compare the actual edited structure, without movable furniture or its model authorization. */
export function referenceStructure(layout:RoomLayout):SceneV2|null {
  if(!layout.backendSceneV2)return null;
  try {
    const structural={...layout,floors:layout.floors.map(floor=>({...floor,items:floor.items.filter(item=>
      item.structuralOpeningId||item.structuralColumnId||item.venueEntranceId||item.type==='door'||item.type==='window')}))};
    const scene=layoutToBackendScene(structural);
    return scene.schemaVersion===2?scene:null;
  } catch { return null; }
}
export function referenceSceneBasis(layout: RoomLayout): string {
  if(layout.backendSceneV2?.schemaVersion!==2||![layout.width,layout.height].every(value=>Number.isFinite(value)&&value>0))return '';
  return canonical({schemaVersion:2,frame:'corner-xz',scope:layout.id??'local',width:layout.width,depth:layout.height});
}
function record(value:unknown):value is Record<string,unknown>{return typeof value==='object'&&value!==null&&!Array.isArray(value);}
/** Resolve only a unique local image and an explicitly applied mapping; no network or URL creation. */
export function resolveReferenceImage(layout:RoomLayout,storedSources:readonly StoredSource[],form:unknown):ReferenceImageResult {
  const basis=referenceSceneBasis(layout),scene=layout.backendSceneV2;
  if(!basis||!scene)return {status:'unavailable',notice:'当前设计没有可核对的场地结构，请先按实测尺寸创建场地。'};
  const raw=record(form)&&record(form.registration)?form.registration:undefined;
  const scope=layout.id??'local';
  const eligible=storedSources.filter(source=>source&&source.scope===scope&&source.kind==='floorplan'&&
    typeof source.id==='string'&&source.id.length>0&&source.blob instanceof Blob&&source.blob.size>0&&
    [source.width,source.height].every(value=>Number.isInteger(value)&&value>0&&value<=4096)&&
    (source.assetId===undefined||typeof source.assetId==='string'&&source.assetId.length>0)&&
    (source.assetId===undefined||scene.sources.filter(expected=>expected.assetId===source.assetId&&expected.kind==='floorplan'&&
      expected.width===source.width&&expected.height===source.height).length===1));
  const selected=raw&&typeof raw.sourceId==='string'?eligible.filter(source=>source.id===raw.sourceId):eligible;
  const source=selected.length===1?selected[0]:undefined;
  if(!source||source.assetId&&eligible.filter(other=>other.assetId===source.assetId).length!==1||eligible.filter(other=>other.id===source.id).length!==1)
    return {status:'unavailable',notice:'无法唯一对应本机平面图，请选择原图并重新核对。云端引用不能当作本机原图。'};
  const review={status:'needs-review' as const,notice:'原图与当前设计的对应尚未核对，请重新标记三个对应点并确认使用。',source};
  if(!raw||raw.sourceAssetId!==source.assetId||raw.imageWidth!==source.width||raw.imageHeight!==source.height||
    raw.worldWidth!==layout.width||raw.worldDepth!==layout.height||raw.appliedBasis!==basis||
    typeof raw.confirmationId!=='string'||raw.confirmationId.length===0||
    !Array.isArray(raw.points)||raw.points.length!==3||!raw.points.every(point=>record(point)&&
      typeof point.x==='number'&&typeof point.z==='number'&&Number.isFinite(point.x)&&Number.isFinite(point.z)&&
      point.x>=0&&point.z>=0&&point.x<=source.width&&point.z<=source.height))return review;
  const imageToWorld=imageToWorldRegistration(raw.points as ImagePoint[],raw.worldWidth as number,raw.worldDepth as number);
  if(!imageToWorld)return review;
  return {status:'ready',notice:source.assetId?'原图对应已核对，可在当前设计中使用。':'本机原图对应已核对，仅在此浏览器使用。',source,imageToWorld};
}
