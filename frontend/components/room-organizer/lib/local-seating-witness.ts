import type {FurnitureItem, RoomLayout} from './types';

/**
 * A local, in-memory record of associations made by the seating generator.
 * It is not a safety check, an inventory record, or evidence of actual use.
 * Callers must bind it to the activity/session and must not reconstruct it from
 * proximity or accept model-supplied IDs as authoritative associations.
 */
export interface LocalSeatingMember {
  id:string;type:string;position:{x:number;z:number};width:number;depth:number;height:number;
  rotation:number;elevation:number;mirrored:boolean;source:string|null;assetId:string|null;materialId:string|null;glbUrl:string|null;glbNode:string|null;
}
export interface LocalSeatingWitness {
  version:1;layoutId:string;floorId:string;floorIndex:number;mode:'one_desk_one_chair'|'two_people_per_desk';
  groups:Array<{desk:LocalSeatingMember;chairs:LocalSeatingMember[]}>;
}
export type LocalSeatingGroupStatus='intact'|'broken'|'unknown';
export interface LocalSeatingReview {
  status:LocalSeatingGroupStatus;
  /** Number of chairs whose original generated associations remain unchanged, not actual usable seats. */
  intactChairs:number;
  brokenGroups:number;unknownGroups:number;
  groups:Array<{deskId:string;chairIds:string[];status:LocalSeatingGroupStatus;reason:'unchanged'|'missing_member'|'changed_member'|'wrong_floor'}>;
}

function snapshot(item:FurnitureItem):LocalSeatingMember|null {
  const p=item.position;
  if(typeof item.id!=='string'||!item.id.trim()||item.id!==item.id.trim()||typeof item.type!=='string'||!item.type||!p||
    ![p.x,p.z,item.width,item.depth,item.height,item.rotation??0,item.elevation??0].every(Number.isFinite)||
    item.width<=0||item.depth<=0||item.height<=0)return null;
  return {id:item.id,type:item.type,position:{x:p.x,z:p.z},width:item.width,depth:item.depth,height:item.height,
    rotation:item.rotation??0,elevation:item.elevation??0,mirrored:item.mirrored===true,source:item.source??null,
    assetId:item.assetId??null,materialId:item.materialId??null,glbUrl:item.glbUrl??null,glbNode:item.glbNode??null};
}
function same(a:LocalSeatingMember,b:LocalSeatingMember):boolean {
  return a.id===b.id&&a.type===b.type&&a.position.x===b.position.x&&a.position.z===b.position.z&&a.width===b.width&&a.depth===b.depth&&a.height===b.height&&
    a.rotation===b.rotation&&a.elevation===b.elevation&&a.mirrored===b.mirrored&&a.source===b.source&&a.assetId===b.assetId&&a.materialId===b.materialId&&a.glbUrl===b.glbUrl&&a.glbNode===b.glbNode;
}
const unknown=():LocalSeatingReview=>({status:'unknown',intactChairs:0,brokenGroups:0,unknownGroups:0,groups:[]});

/** Called immediately after the generator creates and identifies the exact groups. */
export function makeLocalSeatingWitness(layout:RoomLayout,floorIndex:number,mode:LocalSeatingWitness['mode'],groups:ReadonlyArray<{desk:FurnitureItem;chairs:readonly FurnitureItem[]}>):LocalSeatingWitness|null {
  const floor=layout.floors[floorIndex];
  if(!layout.id?.trim()||layout.id!==layout.id.trim()||!floor?.id?.trim()||floor.id!==floor.id.trim()||!Number.isSafeInteger(floorIndex)||floorIndex<0||groups.length===0)return null;
  const records:LocalSeatingWitness['groups']=[];
  for(const group of groups){
    const desk=snapshot(group.desk),chairs=group.chairs.map(snapshot);
    if(!desk||desk.type!=='desk'||chairs.some(chair=>!chair||chair.type!=='chair')||chairs.length<1||chairs.length>(mode==='one_desk_one_chair'?1:2))return null;
    records.push({desk,chairs:chairs as LocalSeatingMember[]});
  }
  const witness:LocalSeatingWitness={version:1,layoutId:layout.id,floorId:floor.id,floorIndex,mode,groups:records};
  return reviewLocalSeatingWitness(witness,layout).status==='intact'?witness:null;
}

/** Rechecks original object identity and geometry; never matches objects by proximity. */
export function reviewLocalSeatingWitness(witness:LocalSeatingWitness|null|undefined,layout:RoomLayout|undefined):LocalSeatingReview {
  if(!witness||witness.version!==1||!layout||typeof witness.layoutId!=='string'||!witness.layoutId.trim()||layout.id!==witness.layoutId||
    !Number.isSafeInteger(witness.floorIndex)||witness.floorIndex<0||!Array.isArray(layout.floors)||!Array.isArray(witness.groups)||witness.groups.length===0||witness.groups.length>100||
    !['one_desk_one_chair','two_people_per_desk'].includes(witness.mode))return unknown();
  const floorIds=new Set<string>();
  for(const entry of layout.floors){if(!entry||typeof entry.id!=='string'||!entry.id.trim()||entry.id!==entry.id.trim()||floorIds.has(entry.id.toLowerCase()))return unknown();floorIds.add(entry.id.toLowerCase());}
  const floor=layout.floors[witness.floorIndex];if(!floor||floor.id!==witness.floorId||!Array.isArray(floor.items))return unknown();
  const objects=new Map<string,{item:FurnitureItem;floorIndex:number}>();
  for(let index=0;index<layout.floors.length;index++){
    const items=layout.floors[index]?.items;if(!Array.isArray(items))return unknown();
    for(const item of items){if(!item||typeof item.id!=='string'||!item.id.trim()||objects.has(item.id.toLowerCase()))return unknown();objects.set(item.id.toLowerCase(),{item,floorIndex:index});}
  }
  const seen=new Set<string>(),results:LocalSeatingReview['groups']=[];
  for(const group of witness.groups){
    if(!group||!group.desk||!Array.isArray(group.chairs)||group.desk.type!=='desk'||group.chairs.length<1||group.chairs.length>(witness.mode==='one_desk_one_chair'?1:2))return unknown();
    const members=[group.desk,...group.chairs];
    if(group.chairs.some(chair=>!chair||chair.type!=='chair'))return unknown();
    for(const member of members){
      // Validate stored data without trusting a caller-provided prototype or missing fields.
      if(!member||typeof member.id!=='string'||!member.id.trim()||seen.has(member.id.toLowerCase())||!member.position||
        ![member.position.x,member.position.z,member.width,member.depth,member.height,member.rotation,member.elevation].every(Number.isFinite)||
        member.width<=0||member.depth<=0||member.height<=0||typeof member.mirrored!=='boolean')return unknown();
      seen.add(member.id.toLowerCase());
    }
    let status:LocalSeatingGroupStatus='intact',reason:LocalSeatingReview['groups'][number]['reason']='unchanged';
    for(const member of members){
      const found=objects.get(member.id.toLowerCase());
      if(!found){status='broken';reason='missing_member';break;}
      if(found.floorIndex!==witness.floorIndex){status='unknown';reason='wrong_floor';continue;}
      const current=snapshot(found.item);
      if(!current||!same(member,current)){status='unknown';reason='changed_member';}
    }
    results.push({deskId:group.desk.id,chairIds:group.chairs.map(chair=>chair.id),status,reason});
  }
  const brokenGroups=results.filter(group=>group.status==='broken').length,unknownGroups=results.filter(group=>group.status==='unknown').length;
  return {status:unknownGroups?'unknown':brokenGroups?'broken':'intact',intactChairs:results.filter(group=>group.status==='intact').reduce((count,group)=>count+group.chairIds.length,0),brokenGroups,unknownGroups,groups:results};
}
