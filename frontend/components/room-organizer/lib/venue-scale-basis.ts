import type { RoomLayout } from './types';
import type { BriefMemory } from './brief-agent';
import {venueSchema} from '../../../../supabase/functions/_shared/domain';
import {venueArea} from './structural-layout';

/** Structural identity uses exact data, never a lossy image or geometry hash. */
export function venueScaleBasis(layout: RoomLayout): string {
  return JSON.stringify({id:layout.id ?? null,width:layout.width,height:layout.height,scenePreset:layout.scenePreset ?? null,
    venueScan:layout.venueScan ?? null,backendVenue:layout.backendVenue ?? null,
    venue:layout.backendSceneV2?.venue ?? null,structure:layout.backendSceneV2?.structure ?? null,
    sources:layout.backendSceneV2?.sources ?? null,dimensions:layout.backendSceneV2?.dimensions ?? null,
    floors:layout.floors.map(f=>({id:f.id,height:f.height ?? null,interiorWalls:(f.interiorWalls ?? []).map(w=>({id:w.id,x1:w.x1,z1:w.z1,x2:w.x2,z2:w.z2,thickness:w.thickness??null,height:w.height??null,kind:w.kind??null,status:w.status??null})),
      structuralMarkers:f.items.filter(item=>item.structuralOpeningId || item.structuralColumnId || item.venueEntranceId)
        .map(item=>({id:item.id,type:item.type,structuralOpeningId:item.structuralOpeningId ?? null,
          structuralColumnId:item.structuralColumnId ?? null,venueEntranceId:item.venueEntranceId ?? null,
          wallId:item.wallId ?? null,position:item.position ?? null,width:item.width,depth:item.depth,height:item.height,
          rotation:item.rotation ?? 0,elevation:item.elevation ?? null,sillHeight:item.sillHeight ?? null}))
        .sort((left,right)=>left.id < right.id ? -1 : left.id > right.id ? 1 : 0)})),
    floorPlanImage:layout.floorPlanImage ?? null,mapGroundPolygon:layout.mapGroundPolygon ?? null,
    mapLngLat:layout.mapLngLat ?? null,sceneAnchor:layout.sceneAnchor ?? null,
    researchBounds:layout.researchArea?.bounds ?? null});
}
export function isVenueScaleCurrent(memory: BriefMemory | null | undefined, layout: RoomLayout): boolean {
  if (!memory) return true;
  if (memory.scaleNeedsReconfirmation) return false;
  if (memory.lengthM === null && memory.widthM === null && memory.areaM2 === null) return true;
  return typeof memory.venueScaleBasis === 'string' && memory.venueScaleBasis === venueScaleBasis(layout);
}

/** Explicit length and width are ordered to match the canvas X/Z axes; area alone cannot determine them. */
export function venueDimensionsMismatch(memory: BriefMemory, layout: RoomLayout, stage:'generate'|'candidate'='generate'): string | null {
  const next = stage==='generate'?'本次没有提交生成，请先在空间中调整或重新确认场地尺寸。':'请先核对候选场地尺寸。';
  const sceneName=stage==='candidate'?'候选':'当前';
  if(memory.lengthM!==null&&memory.widthM!==null){
    const values=[memory.lengthM,memory.widthM,layout.width,layout.height];
    if(values.some(value=>!Number.isFinite(value)||value<=0))return '场地尺寸暂时无法核对，请先检查当前场地和活动需求。';
    if(Math.abs(memory.lengthM-layout.width)>1e-6||Math.abs(memory.widthM-layout.height)>1e-6)
      return `你要求按 ${memory.lengthM} × ${memory.widthM} 米布置，但${sceneName}场地是 ${layout.width} × ${layout.height} 米。${next}`;
  }
  if(memory.areaM2===null)return null;
  if(!Number.isFinite(memory.areaM2)||memory.areaM2<=0)return '场地面积暂时无法核对，请先检查当前场地和活动需求。';
  const current=layout.backendVenue;
  const source=layout.backendSceneV2?.venue;
  // Conflicting preserved shapes or an invalid polygon cannot be treated as a rectangle.
  if(source&&(!current||source.shape!==current.shape||JSON.stringify(source.polygon??null)!==JSON.stringify(current.polygon??null)))
    return '场地轮廓资料不一致，面积暂时无法核对，请先检查场地。';
  const venue=venueSchema.safeParse({...(current??{shape:'rectangle',entrances:[]}),width:layout.width,depth:layout.height,height:layout.floors[0]?.height??3});
  if(!venue.success)return '场地轮廓或尺寸无效，面积暂时无法核对，请先检查场地。';
  const actual=venueArea(layout);
  if(!Number.isFinite(actual)||actual<=0)return '场地面积暂时无法核对，请先检查当前场地和活动需求。';
  // Area is an approximate user figure here: tolerate 5% or 1㎡, whichever is larger.
  if(Math.abs(actual-memory.areaM2)<=Math.max(1,memory.areaM2*0.05))return null;
  return `你提到场地约 ${memory.areaM2} 平方米，但${sceneName}场地轮廓约 ${Number(actual.toFixed(2))} 平方米；请核对两者是否指同一范围。${next}`;
}
