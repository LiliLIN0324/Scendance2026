'use client';

import {useEffect,useId,useRef,useState} from 'react';
import {checkCandidateInventory,type CandidateInventory,type CandidateInventoryCheck,type CandidateInventoryEntry} from '../lib/candidate-inventory';
import {isStructuralMarker} from '../lib/structural-layout';
import type {RoomLayout} from '../lib/types';

type InventoryRow={key:string;entry:Omit<CandidateInventoryEntry,'available'>;count:number};

/** Only explicit identities and complete dimensions can be associated with a reported quantity. */
function rowsFor(candidate:RoomLayout):InventoryRow[] {
 const rows=new Map<string,InventoryRow>();
 for(const floor of candidate.floors)for(const item of floor.items){
  if(isStructuralMarker(item))continue;
  const asset=item.assetId,material=item.materialId;
  if((asset!==undefined&&(typeof asset!=='string'||!asset.trim()||asset!==asset.trim()))||(material!==undefined&&(typeof material!=='string'||!material.trim()||material!==material.trim())))continue;
  if(!asset&&(material==='asset'||item.type==='glb-asset'||item.glbUrl||item.source==='generated'||item.source==='public_library'))continue;
  const value=asset||material||item.type,kind=asset?'asset_id' as const:material?'material_id' as const:'type' as const;
  if(typeof value!=='string'||!value.trim()||value!==value.trim()||value==='asset'||![item.width,item.depth,item.height].every(n=>typeof n==='number'&&Number.isFinite(n)&&n>0))continue;
  const dimensions={width:item.width,depth:item.depth,height:item.height},identity={kind,value};
  const key=JSON.stringify([kind,value,dimensions.width,dimensions.depth,dimensions.height]),existing=rows.get(key);
  if(existing)existing.count++;
  else rows.set(key,{key,entry:{identity,dimensions,name:item.name?.trim()||'未命名物料'},count:1});
 }
 return [...rows.values()];
}

function candidateKey(candidate:RoomLayout,scope:string):string {
 return JSON.stringify([scope,candidate.floors.map(floor=>[floor.id,floor.items.map(item=>[
  item.id,item.type,item.name,item.assetId,item.materialId,item.source,item.glbUrl,
  item.width,item.depth,item.height,item.position?.x,item.position?.z,
  item.structuralOpeningId,item.structuralColumnId,item.venueEntranceId,
 ])])]);
}

function inventoryFrom(rows:InventoryRow[],values:Record<string,string>):CandidateInventory|undefined {
 const invalidInputValues=Object.fromEntries(rows.flatMap(row=>{const text=values[row.key]??'';return text!==''&&(!/^(0|[1-9]\d*)$/.test(text)||!Number.isSafeInteger(Number(text)))?[[row.key,text]]:[];}));
 const invalidInput=Object.keys(invalidInputValues).length>0;
 const entries=rows.flatMap(row=>{
  const text=values[row.key]??'';
  if(!/^(0|[1-9]\d*)$/.test(text))return [];
  const available=Number(text);
  return Number.isSafeInteger(available)?[{...row.entry,available}]:[];
 });
 return entries.length||invalidInput?{origin:'user_reported',entries,...(invalidInput?{invalidInput:true,invalidInputValues}:{})}:undefined;
}

/** Counts are transient and bound to exactly this candidate and caller-supplied scope. */
export function CandidateInventoryPanel({candidate,scope,initialInventory,onChange,sessionMemory=false}:{
 candidate:RoomLayout;scope:string;initialInventory?:CandidateInventory|undefined;sessionMemory?:boolean;onChange:(value:CandidateInventory|undefined,check:CandidateInventoryCheck)=>void;
}):JSX.Element {
 const fieldPrefix=useId();
 const signature=candidateKey(candidate,scope),rows=rowsFor(candidate);
 const initialValues=()=>{
  const values:Record<string,string>={...Object.fromEntries((initialInventory?.entries??[]).map(entry=>[JSON.stringify([entry.identity.kind,entry.identity.value,entry.dimensions.width,entry.dimensions.depth,entry.dimensions.height]),String(entry.available)])),...initialInventory?.invalidInputValues};
  if(initialInventory?.invalidInput&&rows.length&&!rows.some(row=>{const text=values[row.key]??'';return text!==''&&(!/^(0|[1-9]\d*)$/.test(text)||!Number.isSafeInteger(Number(text)));}))values[rows[0]!.key]='?';
  return values;
 };
 const [saved,setSaved]=useState<{signature:string;values:Record<string,string>}>(()=>({signature,values:initialValues()}));
 const onChangeRef=useRef(onChange);onChangeRef.current=onChange;
 const values=saved.signature===signature?saved.values:{};
 const inventory=inventoryFrom(rows,values),check=checkCandidateInventory(candidate,inventory);
 useEffect(()=>{
  // Reset the parent's usable result as well as the visible inputs when the candidate changes.
  const values=initialValues(),initial=inventoryFrom(rows,values);
  setSaved({signature,values});
  onChangeRef.current(initial,checkCandidateInventory(candidate,initial));
  // `signature` covers every candidate field used by inventory matching.
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[signature]);
 function update(key:string,value:string){
  const next={...values,[key]:value},nextInventory=inventoryFrom(rows,next);
  setSaved({signature,values:next});
  onChangeRef.current(nextInventory,checkCandidateInventory(candidate,nextInventory));
 }
 return <>
  <p role="status">{check.message}</p>
  <details><summary>核对这版物料数量</summary><section aria-label="候选物料数量核对">
   <p>{sessionMemory?'同一对话中仅临时记住有明确资产编号且规格相同的数量；其他数量仅用于当前预览。切换账号、活动或对话后清除，不进入活动备份。':'仅对这次预览暂存，不进入活动备份。'}请填写这版可用总数，包含已摆在场地的同规格物料；留空表示不知道，不是零。实际库存仍需确认。</p>
   {rows.map((row,index)=>{const value=values[row.key]??'',invalid=value!==''&&(!/^(0|[1-9]\d*)$/.test(value)||!Number.isSafeInteger(Number(value)));return <div key={row.key}>
    <label htmlFor={`${fieldPrefix}-inventory-count-${index}`}>{row.entry.name} · {row.entry.dimensions.width}×{row.entry.dimensions.depth}×{row.entry.dimensions.height} 米 · 候选 {row.count} 件 · 款式 {index+1}</label>
    <input id={`${fieldPrefix}-inventory-count-${index}`} type="text" inputMode="numeric" maxLength={16} value={value} onChange={event=>update(row.key,event.currentTarget.value)} placeholder="可用总数，未知留空"/>
    {invalid&&<p role="alert">请输入非负整数；此项暂按未知处理。</p>}
   </div>;})}
  </section></details>
 </>;
}
