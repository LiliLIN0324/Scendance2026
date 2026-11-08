import type {ProposalDifference} from '../three/proposal-preview';
import type {RoomLayout} from './types';

export interface ExistingChangeDescription {id:string;kind:'removed'|'changed';text:string}

function number(value:number):string {return String(Number(value.toFixed(6)));}
function different(a:number|undefined,b:number|undefined):boolean {
  return typeof a==='number'&&typeof b==='number'?Math.abs(a-b)>1e-12:a!==b;
}
function position(item:{position?:{x:number;z:number}}):string {
  const p=item.position;
  return p&&Number.isFinite(p.x)&&Number.isFinite(p.z)?`横向 ${number(p.x)} 米、纵向 ${number(p.z)} 米`:'位置未记录';
}
function floorLabel(layout:RoomLayout,index:number):string {
  const name=layout.floors[index]?.name?.trim();
  return `第 ${index+1} 层${name?`（${name}）`:''}`;
}

/** Describe only real pre-existing items, using before/after geometry rather than model claims. */
export function describeExistingChanges(differences:readonly ProposalDifference[],before:RoomLayout,after:RoomLayout):ExistingChangeDescription[] {
  return differences.flatMap<ExistingChangeDescription>(change=>{
    if(change.kind==='added'||!change.before)return [];
    const previous=change.before,old=previous.item;
    const originalIndex=before.floors[previous.floorIndex]?.items.findIndex(item=>item.id===change.id)??-1;
    const ordinal=originalIndex>=0?`原场景第 ${originalIndex+1} 件`:'原场景物料';
    const location=`${floorLabel(before,previous.floorIndex)}，${position(old)}`;
    const name=old.name?.trim()||'未命名物料';
    if(change.kind==='removed')return [{id:change.id,kind:'removed' as const,text:`移除 ${name}（${ordinal}）：${location}`}];
    if(!change.after)return [];
    const next=change.after;
    const oldPosition=old.position,newPosition=next.item.position;
    const moved=previous.floorIndex!==next.floorIndex||different(oldPosition?.x,newPosition?.x)||different(oldPosition?.z,newPosition?.z);
    const destination=moved?(previous.floorIndex===next.floorIndex&&position(old)===position(next.item)
      ?'（位置有微小调整，坐标保留 6 位小数）'
      :` → ${floorLabel(after,next.floorIndex)}，${position(next.item)}`):'（位置未变，其他属性有调整）';
    return [{id:change.id,kind:'changed' as const,text:`调整 ${name}（${ordinal}）：${location}${destination}`}];
  });
}
