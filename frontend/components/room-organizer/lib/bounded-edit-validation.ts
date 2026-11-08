import {sameRecoveryFormValue} from '@/lib/recovery-form-value';
import type {RoomLayout} from './types';
import {isStructuralMarker} from './structural-layout';

/** Experimental validation only; callers must still check geometry, safety and confirmed intent. */
export type BoundedEditField='position'|'rotation'|'color'|'width'|'depth'|'height';
export type BoundedEditTarget={id:string;fields:readonly BoundedEditField[]};
export type BoundedEditResult={ok:true}|{ok:false;reason:string};
const FIELDS=new Set<BoundedEditField>(['position','rotation','color','width','depth','height']);
export function validateBoundedEdit(before:RoomLayout,after:RoomLayout,targets:readonly BoundedEditTarget[]):BoundedEditResult{
 const fail=(reason:string):BoundedEditResult=>({ok:false,reason});
 try{
  if(!sameRecoveryFormValue(before,before)||!sameRecoveryFormValue(after,after))return fail('方案资料无法核对。');
  if(!before.id||before.id!==after.id)return fail('活动已变化。');
  if(!targets.length)return fail('请先明确需要修改的物件。');
  const items=(layout:RoomLayout)=>layout.floors.flatMap(floor=>floor.items);
  const prior=items(before),next=items(after);
  if(new Set(prior.map(i=>i.id)).size!==prior.length||new Set(next.map(i=>i.id)).size!==next.length)return fail('物件编号重复。');
  const normalized=structuredClone(after),normalizedItems=items(normalized),seen=new Set<string>();
  for(const target of targets){
   if(!target.id||seen.has(target.id)||!target.fields.length||new Set(target.fields).size!==target.fields.length||target.fields.some(field=>!FIELDS.has(field)))return fail('修改范围不明确。');
   seen.add(target.id);
   const old=prior.find(i=>i.id===target.id),current=normalizedItems.find(i=>i.id===target.id);
   if(!old||!current)return fail('目标物件已变化。');
   if(old.locked)return fail('锁定物件不能修改。');
   if(isStructuralMarker(old)||old.glbNode||['wall','door','window','column'].includes(old.type))return fail('场地结构不能按局部物件修改。');
   const source=old as unknown as Record<string,unknown>,record=current as unknown as Record<string,unknown>;
   for(const field of target.fields){if(Object.prototype.hasOwnProperty.call(source,field))record[field]=source[field];else delete record[field];}
  }
  if(!sameRecoveryFormValue(before,normalized))return fail('候选超出明确的物件或字段范围。');
  return {ok:true};
 }catch{return fail('方案资料无法完整核对。');}
}
