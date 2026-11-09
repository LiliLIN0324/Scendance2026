'use client';

import {useEffect,useRef,useState,type FormEvent} from 'react';
import {emptyVenueFacts,updateVenueFact,type VenueFactChange,type VenueFactKey} from '../lib/venue-facts';
import {readVenueFacts,venueFactsStorageKey,writeVenueFacts} from '../lib/venue-facts-storage';

const labels:Record<VenueFactKey,string>={venue_width:'场地宽度',venue_depth:'场地深度',door_position:'门的位置',door_width:'门宽',door_opening_direction:'门的开启方向',approved_capacity:'场地核定人数'};
const keys=Object.keys(labels) as VenueFactKey[];
const statuses={unknown:'未知',pending:'待核对',confirmed:'用户已核对',inferred:'推测'} as const;
const sources={unavailable:'暂无来源',user_statement:'用户提供',venue_plan:'用户标注为场地图纸',site_measurement:'用户标注为现场测量',model_inference:'模型推测'} as const;
const directions={inward:'向内开',outward:'向外开',sliding:'推拉门',other:'其他'} as const;

/** Local notes require a caller-provided activity scope and switch guard. */
export function VenueFactsPanel({activityId,isCurrent}:{activityId:string;isCurrent:()=>boolean}):JSX.Element {
 const scope=`activity:${activityId}`,current=useRef({scope,isCurrent});current.current={scope,isCurrent};
 const initial=()=>{const read=readVenueFacts(scope);return read.status==='ready'?read.value:emptyVenueFacts(scope);};
 const [facts,setFacts]=useState(initial),[status,setStatus]=useState(()=>readVenueFacts(scope).status);
 const [key,setKey]=useState<VenueFactKey>('venue_width'),[value,setValue]=useState(''),[second,setSecond]=useState(''),[person,setPerson]=useState(''),[sourceRef,setSourceRef]=useState('');
 const [source,setSource]=useState<'user_statement'|'venue_plan'|'site_measurement'>('user_statement'),[confirmed,setConfirmed]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{const read=readVenueFacts(scope);setStatus(read.status);setFacts(read.status==='ready'?read.value:emptyVenueFacts(scope));setValue('');setSecond('');setError('');setBusy(false);
  const storageKey=venueFactsStorageKey(scope);const onStorage=(event:StorageEvent)=>{if(storageKey&&event.key===storageKey){setStatus('corrupt');setError('其他页面修改了场地记录，请重新打开后核对。');}};
  window.addEventListener('storage',onStorage);return()=>window.removeEventListener('storage',onStorage);
 },[scope]);
 async function save(event:FormEvent<HTMLFormElement>){event.preventDefault();if(busy||status==='corrupt'||status==='unavailable'||!activityId||!isCurrent())return;
  if(!value.trim()||(key==='door_position'&&!second.trim())){setError('请填写完整信息。');return;}
  const guard=()=>current.current.scope===scope&&current.current.isCurrent();
  try{
   const nextValue=key==='door_position'?{x:Number(value),z:Number(second)}:key==='door_opening_direction'?value:Number(value);
   const change={value:nextValue,source,status:confirmed?'confirmed':'pending',uncertainty:null,sourceRef:sourceRef.trim()||null,updatedBy:person,updatedAt:new Date().toISOString()} as VenueFactChange<typeof key>;
   const next=updateVenueFact(facts,key,change,facts.revision);setBusy(true);setError('');
   await writeVenueFacts(scope,next,facts.revision,undefined,undefined,guard);
   if(guard()){setFacts(next);setStatus('ready');setValue('');setSecond('');setConfirmed(false);}
  }catch(cause){if(guard())setError(cause instanceof Error?cause.message:'暂时无法保存，请核对后重试。');}finally{if(guard())setBusy(false);}
 }
 async function markUnknown(){
  if(busy||status!=='ready'||!activityId||!isCurrent()||facts.facts[key].status==='unknown')return;
  const guard=()=>current.current.scope===scope&&current.current.isCurrent();
  try{
   const next=updateVenueFact(facts,key,{value:null,source:'unavailable',status:'unknown',uncertainty:null,sourceRef:null,updatedBy:person,updatedAt:new Date().toISOString()},facts.revision);
   setBusy(true);setError('');await writeVenueFacts(scope,next,facts.revision,undefined,undefined,guard);
   if(guard()){setFacts(next);setStatus('ready');setValue('');setSecond('');setConfirmed(false);}
  }catch(cause){if(guard())setError(cause instanceof Error?cause.message:'暂时无法保存，请核对后重试。');}finally{if(guard())setBusy(false);}
 }
 return <details><summary>场地信息记录</summary>
  <p>仅保存在此浏览器，不会同步到画布、交付文件或场地方；仅记录一扇门，不代表全部出入口。用户核对不等于现场确认或安全验收。</p>
  {(status==='corrupt'||status==='unavailable')&&<p role="alert">原有场地记录无法读取，已暂停保存，请保留原始资料。</p>}
  <ul>{keys.map(item=>{const fact=facts.facts[item],v=fact.value;return <li key={item}>{labels[item]}：{v===null?'未填写':typeof v==='object'?`横向 ${v.x} 米，纵向 ${v.z} 米`:item==='door_opening_direction'?directions[v as keyof typeof directions]:`${v} ${item==='approved_capacity'?'人':'米'}`} · {statuses[fact.status]} · {sources[fact.source]}{fact.sourceRef?`（${fact.sourceRef}）`:''}{fact.updatedBy?` · 记录人 ${fact.updatedBy}`:''}</li>;})}</ul>
  <form onSubmit={event=>void save(event)}>
   <label>要记录的信息<select value={key} onChange={event=>{setKey(event.target.value as VenueFactKey);setValue('');setSecond('');}}>{keys.map(item=><option key={item} value={item}>{labels[item]}</option>)}</select></label>
   {key==='door_opening_direction'?<label>开启方向<select value={value} onChange={event=>setValue(event.target.value)}><option value="">请选择</option><option value="inward">向内开</option><option value="outward">向外开</option><option value="sliding">推拉门</option><option value="other">其他</option></select></label>:<label>{key==='door_position'?'横向位置（米）':key==='approved_capacity'?'人数':'数值（米）'}<input type="number" min={key==='approved_capacity'?0:undefined} step={key==='approved_capacity'?'1':'any'} value={value} onChange={event=>setValue(event.target.value)}/></label>}
   {key==='door_position'&&<label>纵向位置（米，以平面中心为原点）<input type="number" step="any" value={second} onChange={event=>setSecond(event.target.value)}/></label>}
   <label>资料来源<select value={source} onChange={event=>setSource(event.target.value as typeof source)}><option value="user_statement">我提供的信息</option><option value="venue_plan">场地图纸</option><option value="site_measurement">现场测量</option></select></label>
   <label>来源说明<input maxLength={200} value={sourceRef} onChange={event=>setSourceRef(event.target.value)}/></label>
   <label>记录人<input maxLength={80} value={person} onChange={event=>setPerson(event.target.value)}/></label>
   <label><input type="checkbox" checked={confirmed} onChange={event=>setConfirmed(event.target.checked)}/>我已核对这项信息</label>
   {error&&<p role="alert">{error}</p>}
   <button type="submit" disabled={!activityId||busy||status==='corrupt'||status==='unavailable'}>{busy?'正在保存…':'保存这项信息'}</button>
   <button type="button" onClick={()=>void markUnknown()} disabled={!activityId||busy||status!=='ready'||facts.facts[key].status==='unknown'}>将这项标为未知</button>
  </form>
 </details>;
}
