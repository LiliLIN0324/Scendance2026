import {readPreserveExisting} from '../../../../supabase/functions/_shared/user-preserve';
import type {RoomLayout} from './types';

/** User-declared preservation of objects present at the time of the instruction. */
export interface OriginalPreservation {
  activityId:string;
  evidence:string;
  keepPositions:boolean;
  items:Array<{id:string;floorId:string;position:{x:number;z:number}|null;rotation:number|null;elevation:number|null}>;
}
export type OriginalPreservationCheck = {status:'not_requested'|'pass'|'violated'|'unknown';message:string|null};

/** A question or non-specific target is intentionally not promoted to a global requirement. */
export function preservationIntent(text:string){
  // The backend parser is permissive for cloud hints. Do not promote uncertainty,
  // hypothetical examples, or negation forms it does not understand to a durable
  // local constraint.
  if(/(?:可能|也许|或许|不确定|未必|不一定|不排除|待定|看情况|假如|如果|例如|比如|是否|要不要|[?？])/u.test(text))return undefined;
  const compact=text.normalize('NFKC').replace(/\s+/g,'').replace(/[。！!]+$/,'');
  if(/^(?:请|请帮我|帮我)?不(?:再)?(?:保留|保持)(?:(?:所有|全部|全部的|所有的))?(?:原物|原有(?:的)?(?:物件|物品|家具|桌椅|摆设|物料)|现有(?:的)?(?:物件|物品|家具|桌椅|摆设|物料)|已有(?:的)?(?:物件|物品|家具|桌椅|摆设|物料))$/u.test(compact))return {keepAll:false,keepPositions:false};
  if(/(?:不再|不)(?:保留|保持)|(?:不必|无需|不需要|不用|不想|不要|别|取消)保持/u.test(text))return undefined;
  return readPreserveExisting(text);
}

/** Only short, unambiguous standalone instructions may bypass normal dialogue. */
export function isStandalonePreservationInstruction(text:string):boolean {
  const clauses=text.normalize('NFKC').replace(/\s+/g,'').split(/[，,；;。！!]/).filter(Boolean);
  if(!clauses.length||!preservationIntent(text))return false;
  const target='(?:(?:所有|全部|全部的|所有的))?(?:原物|原有(?:的)?(?:物件|物品|家具|桌椅|摆设|物料)|现有(?:的)?(?:物件|物品|家具|桌椅|摆设|物料)|已有(?:的)?(?:物件|物品|家具|桌椅|摆设|物料))';
  const command=new RegExp(`^(?:(?:请|请帮我|帮我|务必|必须|需要|并且|同时))*((?:不再|不必|无需|不需要|不用|不想|不要|不|别|取消)?(?:保留|保持)|(?:不许|不要|不能|不得|别)(?:删除|移除|移动|挪动))${target}(?:位置不变|原位不动|不移动|不挪动)?$`);
  return clauses.every((clause,index)=>command.test(clause)||(index>0&&/^(?:并且|且)?(?:位置不变|原位不动|都不移动|都不挪动)$/.test(clause)));
}

export function captureOriginalPreservation(layout:RoomLayout,evidence:string,keepPositions:boolean):OriginalPreservation|null {
  if(!layout.id?.trim()||!evidence.trim()||evidence.length>2000||!Array.isArray(layout.floors))return null;
  const ids=new Set<string>(),items:OriginalPreservation['items']=[];
  for(const floor of layout.floors){
    if(!floor.id?.trim()||!Array.isArray(floor.items))return null;
    for(const item of floor.items){
      if(!item.id?.trim()||ids.has(item.id)||items.length>=1000)return null;
      ids.add(item.id);
      const p=item.position;
      items.push({id:item.id,floorId:floor.id,position:p&&Number.isFinite(p.x)&&Number.isFinite(p.z)?{x:p.x,z:p.z}:null,
        rotation:item.rotation===undefined?0:Number.isFinite(item.rotation)?item.rotation:null,
        elevation:item.elevation===undefined?0:Number.isFinite(item.elevation)?item.elevation:null});
    }
  }
  return {activityId:layout.id,evidence,keepPositions,items};
}

/** Never infer that a replacement with a different ID is the retained original. */
export function reviewOriginalPreservation(requirement:OriginalPreservation|undefined, candidate:RoomLayout|undefined):OriginalPreservationCheck {
  if(!requirement)return {status:'not_requested',message:null};
  const parsed=preservationIntent(requirement.evidence);
  if(!parsed?.keepAll||parsed.keepPositions!==requirement.keepPositions||!Array.isArray(requirement.items)||requirement.items.length>1000||!candidate||candidate.id!==requirement.activityId||!Array.isArray(candidate.floors))return {status:'unknown',message:'原物保留要求暂时无法核对，请重新说明后生成。'};
  const next=new Map<string,{floorId:string;item:RoomLayout['floors'][number]['items'][number]}>();
  for(const floor of candidate.floors){
    if(!floor.id||!Array.isArray(floor.items))return {status:'unknown',message:'原物保留要求暂时无法核对，请重新说明后生成。'};
    for(const item of floor.items){if(!item.id||next.has(item.id))return {status:'unknown',message:'物件身份无法核对，请重新生成。'};next.set(item.id,{floorId:floor.id,item});}
  }
  const seen=new Set<string>();let missing=0,moved=0,unknown=false;
  for(const old of requirement.items){
    if(!old.id||seen.has(old.id)){unknown=true;continue;}seen.add(old.id);
    const found=next.get(old.id);if(!found){missing++;continue;}
    if(requirement.keepPositions){
      const p=found.item.position,r=found.item.rotation??0,e=found.item.elevation??0;
      if(!old.position||old.rotation===null||old.elevation===null||!p||!Number.isFinite(p.x)||!Number.isFinite(p.z)||!Number.isFinite(r)||!Number.isFinite(e)){unknown=true;continue;}
      const angleDelta=Math.atan2(Math.sin(old.rotation-r),Math.cos(old.rotation-r));
      if(old.floorId!==found.floorId||Math.abs(old.position.x-p.x)>1e-9||Math.abs(old.position.z-p.z)>1e-9||Math.abs(angleDelta)>1e-9||Math.abs(old.elevation-e)>1e-9)moved++;
    }
  }
  if(missing||moved)return {status:'violated',message:`这版与保留原物要求冲突：${missing?`${missing} 件原物被移除` : ''}${missing&&moved?'，':''}${moved?`${moved} 件原物位置或方向改变`:''}；请调整后重新核对。`};
  if(unknown)return {status:'unknown',message:'原物位置或身份信息不完整，暂无法核对保留要求。'};
  return {status:'pass',message:null};
}
