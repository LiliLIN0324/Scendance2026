import {isStructuralMarker} from './structural-layout';
import type {RoomLayout} from './types';

export interface CandidateInventoryEntry {
  /** type 匹配仅用于候选没有 materialId 的物件，不能以名称猜测身份。 */
  identity:{kind:'material_id'|'asset_id'|'type';value:string};
  dimensions:{width:number;depth:number;height:number};
  /** 可用于整个候选的总数，包含已在场的同规格物件；不是剩余可租数量。 */
  available:number;
  name:string;
}
export interface CandidateInventory {origin:'assumption'|'user_reported';entries:readonly CandidateInventoryEntry[];invalidInput?:boolean;invalidInputValues?:Readonly<Record<string,string>>}
export interface CandidateInventoryShortage {name:string;identity:CandidateInventoryEntry['identity'];dimensions:CandidateInventoryEntry['dimensions'];required:number;available:number;missing:number;objectIds:string[]}
export interface CandidateInventoryCheck {status:'pass'|'violated'|'unknown'|'not_applicable';shortages:CandidateInventoryShortage[];unknownObjectIds:string[];message:string}

/** Checks a candidate against explicitly supplied inventory, never its real-world availability. */
export function checkCandidateInventory(layout:RoomLayout|undefined,inventory?:CandidateInventory):CandidateInventoryCheck {
  const unknown=(message:string,ids:string[]=[]):CandidateInventoryCheck=>({status:'unknown',shortages:[],unknownObjectIds:ids,message});
  if(!layout||!Array.isArray(layout.floors)||layout.floors.some(floor=>!floor||!Array.isArray(floor.items)||floor.items.some(item=>!item||typeof item!=='object')))return unknown('候选场景无法读取，库存待核验。');
  const items=layout.floors.flatMap(floor=>floor.items).filter(item=>!isStructuralMarker(item));
  if(!inventory)return unknown('未提供库存，物料可用数量待核验。',items.map(item=>item.id));
  if(inventory.invalidInput)return unknown('物料数量输入无效，请更正或清空后再确认。',items.map(item=>item.id));
  if(!['assumption','user_reported'].includes(inventory.origin)||!Array.isArray(inventory.entries))return unknown('库存资料无效，请重新核对。',items.map(item=>item.id));
  const rows=inventory.entries;
  const valid=(row:CandidateInventoryEntry)=>!!row&&typeof row.name==='string'&&!!row.name.trim()&&!!row.identity&&['material_id','asset_id','type'].includes(row.identity.kind)&&typeof row.identity.value==='string'&&!!row.identity.value.trim()&&row.identity.value===row.identity.value.trim()&&row.identity.value!=='asset'&&!!row.dimensions&&[row.dimensions.width,row.dimensions.depth,row.dimensions.height].every(n=>typeof n==='number'&&Number.isFinite(n)&&n>0)&&Number.isSafeInteger(row.available)&&row.available>=0;
  if(!rows.every(valid))return unknown('库存资料包含无效身份、规格或数量，请重新核对。',items.map(item=>item.id));
  const rowKey=(row:CandidateInventoryEntry)=>JSON.stringify([row.identity.kind,row.identity.value,row.dimensions.width,row.dimensions.depth,row.dimensions.height]);
  if(new Set(rows.map(rowKey)).size!==rows.length)return unknown('库存包含重复身份和规格，数量暂无法核对。',items.map(item=>item.id));
  if(!items.length)return {status:'not_applicable',shortages:[],unknownObjectIds:[],message:'当前候选没有物料可核对，库存实物仍需确认。'};
  const counts=new Map<number,string[]>(),unknownObjectIds:string[]=[],seen=new Set<string>(),duplicate=new Set<string>();
  for(const item of items){if(seen.has(item.id))duplicate.add(item.id);seen.add(item.id);}
  for(const item of items){
    if(typeof item.id!=='string'||!item.id.trim()||duplicate.has(item.id)||!item.position||![item.position.x,item.position.z,item.width,item.depth,item.height].every(n=>typeof n==='number'&&Number.isFinite(n))||item.width<=0||item.depth<=0||item.height<=0){unknownObjectIds.push(typeof item.id==='string'?item.id:'');continue;}
    if((item.materialId!==undefined&&(typeof item.materialId!=='string'||!item.materialId.trim()||item.materialId!==item.materialId.trim()))||(item.assetId!==undefined&&(typeof item.assetId!=='string'||!item.assetId.trim()||item.assetId!==item.assetId.trim()))){unknownObjectIds.push(item.id);continue;}
    const materialId=item.materialId??'',assetId=item.assetId??'';
    if(!assetId&&(materialId==='asset'||item.type==='glb-asset'||!!item.glbUrl||item.source==='generated'||item.source==='public_library')){unknownObjectIds.push(item.id);continue;}
    const matches=rows.flatMap((row,index)=>{
      const identity=assetId ? row.identity.kind==='asset_id'&&row.identity.value===assetId : materialId ? row.identity.kind==='material_id'&&row.identity.value===materialId : row.identity.kind==='type'&&row.identity.value===item.type;
      return identity&&row.dimensions.width===item.width&&row.dimensions.depth===item.depth&&row.dimensions.height===item.height?[index]:[];
    });
    if(matches.length!==1){unknownObjectIds.push(item.id);continue;}
    const list=counts.get(matches[0]!)??[];list.push(item.id);counts.set(matches[0]!,list);
  }
  const shortages:CandidateInventoryShortage[]=[];
  for(const [index,ids] of counts){const row=rows[index]!;if(ids.length>row.available)shortages.push({name:row.name,identity:{...row.identity},dimensions:{...row.dimensions},required:ids.length,available:row.available,missing:ids.length-row.available,objectIds:ids});}
  const context=inventory.origin==='assumption'?'按假设库存核对（总数含已有物件，并非真实库存）':'按提供的库存核对（总数含已有物件，实际库存仍需确认）';
  const missing=shortages.map(item=>`缺 ${item.missing} 件${item.name}（候选 ${item.required} 件，库存 ${item.available} 件）`).join('；');
  const uncertain=unknownObjectIds.length?`${unknownObjectIds.length} 件物料身份、位置或规格未能匹配，库存待核验。`:'';
  if(shortages.length)return {status:'violated',shortages,unknownObjectIds,message:`${context}：${missing}。${uncertain}`};
  if(unknownObjectIds.length)return {status:'unknown',shortages,unknownObjectIds,message:`${context}：${uncertain}`};
  return {status:'pass',shortages,unknownObjectIds,message:`${context}：候选物料数量未超出所列库存；不代表实物可用或现场条件已核验。`};
}
