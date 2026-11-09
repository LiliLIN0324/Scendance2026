import {z} from 'zod';
import {sizeSchema,venueSchema} from '../../../../supabase/functions/_shared/domain';
import {footprint,structuralViolations} from '../../../../supabase/functions/_shared/structural-geometry';
import {floorKeepOut} from './floor-keep-out';
import {hasCollisions,isLowProfile,itemsOverlap} from './geometry';
import {isStructuralMarker,layoutGeometryScene,materialCount} from './structural-layout';
import {makeLocalSeatingWitness,type LocalSeatingWitness} from './local-seating-witness';
import type {FurnitureItem,RoomLayout} from './types';

const source=z.enum(['user','assumption']);
const sourceRecord=z.strictObject({count:source,deskSize:source,chairSize:source,deskChairGap:source,columnGap:source,rowGap:source,edgeClearance:source});
/** All inputs must be chosen for this activity; no audience or activity type selects a layout. */
export const localDeskChairInputSchema=z.strictObject({
  floorIndex:z.number().int().nonnegative(),mode:z.literal('one_desk_one_chair'),count:z.number().int().min(1).max(100),
  desk:sizeSchema,chair:sizeSchema,deskChairGap:z.number().min(0.01).max(5),columnGap:z.number().min(0).max(10),
  rowGap:z.number().min(0).max(10),edgeClearance:z.number().min(0).max(10),assumptions:sourceRecord,
  region:z.strictObject({x1:z.number().min(-200).max(200),z1:z.number().min(-200).max(200),x2:z.number().min(-200).max(200),z2:z.number().min(-200).max(200),source}).optional(),
});
export type LocalDeskChairInput=z.infer<typeof localDeskChairInputSchema>;
export const localSharedDeskInputSchema=localDeskChairInputSchema.extend({
  mode:z.literal('two_people_per_desk'),chairGap:z.number().min(0).max(5),
  assumptions:sourceRecord.extend({chairGap:source}),
});
export type LocalSharedDeskInput=z.infer<typeof localSharedDeskInputSchema>;
export type LocalSharedDeskDraft=Omit<LocalDeskChairDraft,'assumptions'> & {
  assumptions:LocalSharedDeskInput;requestedTables:number;placedTables:number;placedObjects:number;
};

export type LocalDeskChairDraft={
  layout:RoomLayout;requested:number;placed:number;shortfall:number;assumptions:LocalDeskChairInput;
  unknown:string[];limitReason:'object_limit'|'no_placement'|'scan_limit'|'incomplete_geometry'|'preset_unverified'|null;
  /** Ephemeral generator-origin associations; absent for an unidentifiable activity. */
  seatingWitness:LocalSeatingWitness|null;
};

const itemLimit=200,maxProbes=5000,epsilon=1e-7;
const baseUnknown=['出口位置与用途','门扇开启范围','连续通行及疏散','消防规范','无障碍要求','场地核定人数','实物规格与可用库存','物件间额外净距及未记录的现场障碍'];
type Point={x:number;z:number};
function distance(p:Point,a:Point,b:Point):number {
  const dx=b.x-a.x,dz=b.z-a.z,den=dx*dx+dz*dz;
  const t=den?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.z-a.z)*dz)/den)):0;
  return Math.hypot(p.x-a.x-t*dx,p.z-a.z-t*dz);
}
function boundaryClear(item:FurnitureItem,polygon:readonly Point[],clearance:number,width:number,depth:number):boolean {
  if(clearance<=0)return true;
  const p=item.position!;
  const points=footprint({position:{x:p.x+width/2,z:p.z+depth/2},size:{width:item.width,depth:item.depth,height:item.height},rotation:-(item.rotation??0)*180/Math.PI});
  return points.every((point,index)=>{
    const end=points[(index+1)%points.length]!;
    return polygon.every((start,edge)=>{
      const next=polygon[(edge+1)%polygon.length]!;
      return Math.min(distance(point,start,next),distance(end,start,next),distance(start,point,end),distance(next,point,end))>=clearance-epsilon;
    });
  });
}
function occupies(item:FurnitureItem):boolean { return !isStructuralMarker(item)&&!isLowProfile(item); }

/**
 * Builds an editable local-only draft. The result is not saved or sent to cloud.
 * Callers must recheck activity, scene and edit authority before preview or apply.
 */
export function planLocalDeskChairDraft(original:RoomLayout,raw:LocalDeskChairInput,idFactory:()=>string):LocalDeskChairDraft {
  return planDraft(original,localDeskChairInputSchema.parse(raw),idFactory);
}
export function planLocalSharedDeskDraft(original:RoomLayout,raw:LocalSharedDeskInput,idFactory:()=>string):LocalSharedDeskDraft {
  const input=localSharedDeskInputSchema.parse(raw);
  const result=planDraft(original,input,idFactory);
  const placedTables=result.layout.floors.flatMap(f=>f.items).length-original.floors.flatMap(f=>f.items).length-result.placed;
  return {...result,assumptions:input,requestedTables:Math.ceil(input.count/2),placedTables,placedObjects:placedTables+result.placed};
}
function planDraft(original:RoomLayout,input:LocalDeskChairInput|LocalSharedDeskInput,idFactory:()=>string):LocalDeskChairDraft {
  const shared=input.mode==='two_people_per_desk';
  if(typeof idFactory!=='function')throw new Error('无法创建物件编号。');
  const layout=structuredClone(original),floor=layout.floors[input.floorIndex];
  const base:LocalDeskChairDraft={layout,requested:input.count,placed:0,shortfall:input.count,assumptions:input as LocalDeskChairInput,unknown:[...baseUnknown],limitReason:null,seatingWitness:null};
  const unknownGeometry=(message:string):LocalDeskChairDraft=>({...base,unknown:[...base.unknown,message],limitReason:'incomplete_geometry'});
  if(!floor||!Number.isFinite(layout.width)||!Number.isFinite(layout.height)||layout.width<=0||layout.height<=0)return unknownGeometry('楼层或场地尺寸未能核对');
  // Scanned and preset architecture may contain fixed geometry outside editable objects.
  if(layout.scenePreset||layout.venueScan)return {...base,unknown:[...base.unknown,'预设或扫描空间中的固定结构尚未完整展开'],limitReason:'preset_unverified'};
  if(layout.mapGroundPolygon?.length&&!layout.backendVenue?.polygon)return unknownGeometry('地图范围尚未转换为可核对的场地轮廓');
  if(layout.backendSceneV2&&!layout.backendVenue)return unknownGeometry('场地结构与轮廓尚未建立一致的版本');
  if(layout.backendVenue&&(layout.backendVenue.width!==layout.width||layout.backendVenue.depth!==layout.height))return unknownGeometry('当前画布与场地轮廓的尺寸不一致');
  if(layout.backendSceneV2&&layout.backendVenue){
    const first=layout.backendSceneV2.venue,second=layout.backendVenue;
    if(first.width!==second.width||first.depth!==second.depth||first.shape!==second.shape||JSON.stringify(first.polygon??null)!==JSON.stringify(second.polygon??null))return unknownGeometry('现有结构与场地轮廓不一致');
  }
  const objects=floor.items;
  if(objects.some(item=>!item.id||!item.position||![item.position.x,item.position.z,item.width,item.depth,item.height,item.rotation??0,item.elevation??0].every(Number.isFinite)||item.width<=0||item.depth<=0||item.height<=0))return unknownGeometry('已有物件的位置或尺寸不完整');
  const ids=new Set<string>();
  for(const item of layout.floors.flatMap(entry=>entry.items)){
    const id=item.id?.trim().toLowerCase();if(!id||ids.has(id))return unknownGeometry('物件编号缺失或重复');ids.add(id);
  }
  // Structure IDs share the backend scene namespace with furniture IDs.
  for(const wall of layout.floors.flatMap(entry=>entry.interiorWalls??[]))if(wall.id)ids.add(wall.id.toLowerCase());
  for(const entrance of layout.backendVenue?.entrances??[])ids.add(entrance.id.toLowerCase());
  if(layout.backendSceneV2)for(const entity of [...layout.backendSceneV2.structure.walls,...layout.backendSceneV2.structure.openings,...layout.backendSceneV2.structure.columns])ids.add(entity.id.toLowerCase());
  const model=layoutGeometryScene(layout,input.floorIndex);
  if(!venueSchema.safeParse(model.venue).success)return unknownGeometry('场地轮廓无效或无法读取');
  if(model.structure.walls.some(w=>![w.start.x,w.start.z,w.end.x,w.end.z,w.thickness,w.height].every(Number.isFinite)||w.thickness<=0||w.height<=0||Math.hypot(w.end.x-w.start.x,w.end.z-w.start.z)<epsilon)||
    model.structure.columns.some(c=>![c.position.x,c.position.z,c.size.width,c.size.depth,c.size.height,c.rotation].every(Number.isFinite)||c.size.width<=0||c.size.depth<=0||c.size.height<=0))return unknownGeometry('墙体或柱子的几何信息不完整');
  if(layout.backendSceneV2){
    if(input.floorIndex!==0)return unknownGeometry('多楼层结构尚未与当前楼层逐项核对');
    const sameIds=(a:readonly {id:string}[],b:readonly {id:string}[])=>a.length===b.length&&a.every(item=>b.some(other=>other.id===item.id));
    if(!sameIds(model.structure.walls,layout.backendSceneV2.structure.walls)||!sameIds(model.structure.columns,layout.backendSceneV2.structure.columns)||!sameIds(model.structure.openings,layout.backendSceneV2.structure.openings))return unknownGeometry('已有场地结构未完整映射到当前楼层');
  }
  if(model.structure.walls.some(w=>w.status!=='confirmed')||model.structure.columns.some(c=>c.status!=='confirmed')||!layout.backendSceneV2)base.unknown.push('场地结构来源或确认状态');
  const polygon=model.venue.polygon??[{x:0,z:0},{x:layout.width,z:0},{x:layout.width,z:layout.height},{x:0,z:layout.height}];
  const available=Math.max(0,itemLimit-materialCount(objects));
  const maxGroups=Math.floor(available/2);
  if(maxGroups===0)return {...base,limitReason:'object_limit'};
  const chairSpan=shared?2*input.chair.width+input.chairGap:input.chair.width;
  if(shared&&chairSpan>input.desk.width+epsilon)return {...base,unknown:[...base.unknown,'两把椅子及指定椅距超过桌面宽度'],limitReason:'no_placement'};
  const maxWidth=Math.max(input.desk.width,chairSpan),groupDepth=input.desk.depth+input.deskChairGap+input.chair.depth;
  const region=input.region??{x1:-layout.width/2,z1:-layout.height/2,x2:layout.width/2,z2:layout.height/2};
  if(region.x1>=region.x2||region.z1>=region.z2||region.x1< -layout.width/2||region.z1< -layout.height/2||region.x2>layout.width/2||region.z2>layout.height/2)throw new Error('指定布置区域无效，请重新核对。');
  const startX=region.x1+input.edgeClearance+maxWidth/2,endX=region.x2-input.edgeClearance-maxWidth/2;
  const startZ=region.z1+input.edgeClearance,endZ=region.z2-input.edgeClearance-groupDepth;
  if(startX>endX+epsilon||startZ>endZ+epsilon)return {...base,limitReason:'no_placement'};
  const pitchX=maxWidth+input.columnGap,pitchZ=groupDepth+input.rowGap;
  const columns=Math.floor((endX-startX+epsilon)/pitchX)+1,rows=Math.floor((endZ-startZ+epsilon)/pitchZ)+1;
  const keepOut=floorKeepOut(layout,input.floorIndex);
  let probes=0,placed=0,groups=0,exhausted=false,objectLimited=false;
  const generatedGroups:Array<{desk:FurnitureItem;chairs:FurnitureItem[]}>=[];
  const nextId=()=>{
    for(let attempt=0;attempt<32;attempt++){
      const id=idFactory();if(typeof id!=='string'||!id.trim()||id!==id.trim()||id.length>128||ids.has(id.toLowerCase()))continue;
      ids.add(id.toLowerCase());return id;
    }
    throw new Error('无法创建不重复的物件编号。');
  };
  const tempId=(suffix:string)=>{let id=`__local_seating_${suffix}__`;while(ids.has(id.toLowerCase()))id+='_';return id;};
  for(let row=0;row<rows&&placed<input.count&&groups<maxGroups;row++){
    for(let col=0;col<columns&&placed<input.count&&groups<maxGroups;col++){
      if(probes++>=maxProbes){exhausted=true;break;}
      const x=startX+col*pitchX,z=startZ+row*pitchZ;
      const desk:FurnitureItem={id:tempId('desk'),type:'desk',name:'课桌（示意）',...input.desk,color:'#ffffff',icon:'',category:'tables',source:'builtin',position:{x,z:z+input.desk.depth/2},rotation:0};
      const numberOfChairs=shared?Math.min(2,input.count-placed):1;
      if(materialCount(objects)+1+numberOfChairs>itemLimit){objectLimited=true;break;}
      const chairs:FurnitureItem[]=Array.from({length:numberOfChairs},(_,index)=>({id:tempId(`chair_${index}`),type:'chair',name:'座椅（示意）',...input.chair,color:'#ffffff',icon:'',category:'seating',source:'builtin',position:{x:x+(numberOfChairs===2?(index===0?-1:1)*(input.chair.width+(shared?input.chairGap:0))/2:0),z:z+input.desk.depth+input.deskChairGap+input.chair.depth/2},rotation:Math.PI}));
      const group=[desk,...chairs];
      if(chairs.some(chair=>itemsOverlap(desk,chair))||group.some(item=>!boundaryClear(item,polygon,input.edgeClearance,layout.width,layout.height)))continue;
      if(group.some(item=>hasCollisions(item,objects,layout.width,layout.height,{interiorWalls:floor.interiorWalls,keepOut})))continue;
      if(objects.some(item=>occupies(item)&&group.some(candidate=>itemsOverlap(candidate,item))))continue;
      const world=(item:FurnitureItem)=>({id:item.id,materialId:item.type==='desk'?'table' as const:'chair' as const,position:{x:item.position!.x+layout.width/2,z:item.position!.z+layout.height/2},size:{width:item.width,depth:item.depth,height:item.height},rotation:-(item.rotation??0)*180/Math.PI,color:item.color,locked:false,notes:''});
      if(structuralViolations({...model,objects:group.map(world)}).length)continue;
      for(const item of group)item.id=nextId();objects.push(...group);generatedGroups.push({desk,chairs});placed+=numberOfChairs;groups++;
    }
    if(exhausted||objectLimited)break;
  }
  const shortfall=input.count-placed;
  const seatingWitness=makeLocalSeatingWitness(layout,input.floorIndex,input.mode,generatedGroups);
  return {...base,placed,shortfall,seatingWitness,unknown:placed>0&&!seatingWitness?[...base.unknown,'桌椅原始配套关系']:base.unknown,
    limitReason:shortfall===0?null:objectLimited||groups>=maxGroups?'object_limit':exhausted?'scan_limit':'no_placement'};
}
