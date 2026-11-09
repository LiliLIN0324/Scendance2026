import { emptyVenueFacts, updateVenueFact, type VenueFactKey, type VenueFactSet } from './venue-facts';

export type VenueFactsRead = {status:'ready';value:VenueFactSet}|{status:'missing'|'corrupt'|'unavailable'};
const keys:VenueFactKey[]=['venue_width','venue_depth','door_position','door_width','door_opening_direction','approved_capacity'];
export function venueFactsStorageKey(scope:string):string|null {
  try{return scope.startsWith('activity:')&&scope.slice(9).trim()&&scope.length<=512&&!/[\u0000-\u001f]/.test(scope) ? `scendance:venue-facts:v1:${encodeURIComponent(scope)}` : null;}catch{return null;}
}
function canonical(value:unknown):string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
}
function valid(raw:unknown,scope:string):raw is VenueFactSet {
  try {
    if (!raw || typeof raw!=='object')return false;
    const set=raw as VenueFactSet;
    if (canonical(Object.keys(set).sort())!==canonical(['facts','revision','scope'])||set.scope!==scope||!Number.isSafeInteger(set.revision)||set.revision<0||!set.facts||canonical(Object.keys(set.facts).sort())!==canonical([...keys].sort()))return false;
    const revisions:number[]=[];
    for(const key of keys){
      const fact=set.facts[key];
      if(!fact||!Number.isSafeInteger(fact.revision)||fact.revision<0||fact.revision>set.revision)return false;
      const expected = fact.revision===0 ? emptyVenueFacts(scope).facts[key] : updateVenueFact({...emptyVenueFacts(scope),revision:fact.revision-1},key,{value:fact.value,source:fact.source,status:fact.status,uncertainty:fact.uncertainty,sourceRef:fact.sourceRef,updatedBy:fact.updatedBy,updatedAt:fact.updatedAt},fact.revision-1).facts[key];
      if(canonical(fact)!==canonical(expected))return false;
      if(fact.revision)revisions.push(fact.revision);
    }
    return new Set(revisions).size===revisions.length && Math.max(0,...revisions)===set.revision;
  } catch {return false;}
}
export function readVenueFacts(scope:string,storage?:Storage):VenueFactsRead {
  const key=venueFactsStorageKey(scope);if(!key)return {status:'unavailable'};
  let raw:string|null;try {raw=(storage??window.localStorage).getItem(key);}catch{return {status:'unavailable'};}
  if(raw===null)return {status:'missing'};
  try {const value:unknown=JSON.parse(raw);return valid(value,scope)?{status:'ready',value}:{status:'corrupt'};}catch{return {status:'corrupt'};}
}
/** An explicit exploration action may initialize missing facts as unknown, without overwriting records. */
export async function initializeUnknownVenueFacts(scope:string,storage?:Storage,locks?:LockManager,stillCurrent:()=>boolean=()=>true):Promise<{status:'created'|'existing';value:VenueFactSet}> {
  const key=venueFactsStorageKey(scope),manager=locks??(typeof navigator==='undefined'?undefined:navigator.locks);
  if(!key||!manager||!stillCurrent())throw new Error('活动或本机保存状态无法核对。');
  return manager.request(`scendance:venue-facts:${encodeURIComponent(scope)}`,{mode:'exclusive'},async()=>{
    if(!stillCurrent())throw new Error('活动已变化，未初始化场地信息。');
    const target=storage??window.localStorage, previous=readVenueFacts(scope,target);
    if(previous.status==='corrupt'||previous.status==='unavailable')throw new Error('原有场地信息无法读取，未覆盖。');
    if(previous.status==='ready'){if(!stillCurrent())throw new Error('活动已变化，请重新核对。');return {status:'existing' as const,value:previous.value};}
    const value=emptyVenueFacts(scope),text=JSON.stringify(value);
    if(!stillCurrent())throw new Error('活动已变化，未初始化场地信息。');
    target.setItem(key,text);
    const readback=readVenueFacts(scope,target);
    if(target.getItem(key)!==text||readback.status!=='ready'||canonical(readback.value)!==canonical(value))throw new Error('场地信息写入结果无法确认，请重新读取核对。');
    if(typeof window!=='undefined')window.dispatchEvent(new Event('scendance:venue-facts-changed'));
    if(!stillCurrent())throw new Error('未知场地信息已保存，但活动已变化，请重新核对。');
    return {status:'created' as const,value:readback.value};
  });
}
/** Serializes cooperating tabs; caller must supply stillCurrent to fence activity switches. */
export async function writeVenueFacts(scope:string,value:VenueFactSet,expectedRevision:number,storage?:Storage,locks?:LockManager,stillCurrent:()=>boolean=()=>true):Promise<void> {
  const key=venueFactsStorageKey(scope),manager=locks??(typeof navigator==='undefined'?undefined:navigator.locks);
  if(!key||!valid(value,scope)||!manager||!stillCurrent())throw new Error('本机保存不可用或活动已变化，请保留原始资料。');
  await manager.request(`scendance:venue-facts:${encodeURIComponent(scope)}`,{mode:'exclusive'},async()=>{
    if(!stillCurrent())throw new Error('活动已变化，场地信息未保存。');
    const target=storage??window.localStorage,previous=readVenueFacts(scope,target);
    if(previous.status==='corrupt'||previous.status==='unavailable')throw new Error('原有场地信息无法读取，未覆盖。');
    const revision=previous.status==='ready'?previous.value.revision:0;
    if(revision!==expectedRevision||value.revision!==expectedRevision+1)throw new Error('场地信息已变化，请重新读取后再记录。');
    const before=previous.status==='ready'?previous.value:emptyVenueFacts(scope);
    const changed=keys.filter(item=>canonical(before.facts[item])!==canonical(value.facts[item]));
    if(changed.length!==1 || value.facts[changed[0]!].revision!==value.revision)throw new Error('场地信息变更无法核对，未保存。');
    const text=JSON.stringify(value);if(!stillCurrent())throw new Error('活动已变化，场地信息未保存。');target.setItem(key,text);
    if(target.getItem(key)!==text||readVenueFacts(scope,target).status!=='ready')throw new Error('保存结果无法确认，请重新读取核对。');
    if(typeof window!=='undefined')window.dispatchEvent(new Event('scendance:venue-facts-changed'));
    if(!stillCurrent())throw new Error('场地信息已保存，但活动已变化，请重新核对。');
  });
}
