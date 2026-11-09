import {readVenueFacts,venueFactsStorageKey} from './venue-facts-storage';
import type {VenueFactKey,VenueFactSet} from './venue-facts';

const keys:VenueFactKey[]=['venue_width','venue_depth','door_position','door_width','door_opening_direction','approved_capacity'];

/** This is a local note, not a finding about the current drawing or venue. */
export function unlinkedVenueNotes(facts:VenueFactSet) {
  return {
    // The scope is used internally for locking, never copied into the file.
    format:'scendance-unlinked-venue-notes',version:1,scope:'当前活动',revision:facts.revision,
    notice:'以下仅为用户本机记录，尚未与当前画布或图纸版本关联；门的信息仅记录一扇门，不代表全部出入口。用户核对不等于场地方确认或消防、无障碍和现场安全验收。',
    facts:keys.map(key=>{const fact=facts.facts[key];return {
      // A legacy point may carry extra properties; export only its coordinates.
      key:fact.key,value:key==='door_position'&&fact.value!==null?{x:(fact.value as {x:number;z:number}).x,z:(fact.value as {x:number;z:number}).z}:fact.value,unit:fact.unit,source:fact.source,
      recordedStatus:fact.status,uncertainty:fact.uncertainty,updatedAt:fact.updatedAt?new Date(fact.updatedAt).toISOString():'',revision:fact.revision,
    };}),
  };
}

/** Hold the same lock as cooperating sidecar writers until the caller downloads. */
export async function withUnlinkedVenueNotes<T>(scope:string,stillCurrent:()=>boolean,work:(notes:ReturnType<typeof unlinkedVenueNotes>,assertCurrent:()=>void)=>Promise<T>,options?:{storage?:Storage;locks?:LockManager;events?:Window}):Promise<T> {
  const current=()=>{try{return stillCurrent();}catch{return false;}};
  const key=venueFactsStorageKey(scope),locks=options?.locks??(typeof navigator==='undefined'?undefined:navigator.locks);
  if(!key||!locks||typeof locks.request!=='function'||!current())throw new Error('活动范围或本机记录锁不可用；未导出含场地记录的草案。');
  const events=options?.events??(typeof window==='undefined'?undefined:window);
  if(!events)throw new Error('本机记录状态无法核对；未导出含场地记录的草案。');
  let changed=false;
  const local=()=>{changed=true;};
  const external=(event:StorageEvent)=>{if(event.key===key||event.key===null)changed=true;};
  events.addEventListener('scendance:venue-facts-changed',local);
  events.addEventListener('storage',external);
  const abort=new AbortController();
  let timer:ReturnType<typeof setTimeout>|undefined;
  const timeout=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{
    abort.abort();reject(new Error('等待场地记录核对超时；未导出草案，请稍后重试。'));
  },10_000);});
  try {
    const request=locks.request(`scendance:venue-facts:${encodeURIComponent(scope)}`,{mode:'shared',signal:abort.signal},async()=>{
      // A broken lock manager may invoke its callback after ignoring abort.
      if(abort.signal.aborted)throw new Error('等待场地记录核对超时；未导出草案，请稍后重试。');
      clearTimeout(timer);
      if(changed||!current())throw new Error('活动或场地记录已变化；未导出草案。');
      const first=readVenueFacts(scope,options?.storage);
      if(first.status==='missing')throw new Error('尚无本机场地记录；可取消勾选后导出草案。');
      if(first.status!=='ready')throw new Error('本机场地记录无法读取；未导出含记录的草案。');
      const snapshot=structuredClone(first.value),signature=JSON.stringify(snapshot);
      const assertCurrent=()=>{
        if(changed||!current())throw new Error('活动或场地记录已变化；未导出草案。');
        const observed=readVenueFacts(scope,options?.storage);
        if(observed.status!=='ready'||JSON.stringify(observed.value)!==signature)throw new Error('场地记录已变化或无法读取；未导出草案。');
      };
      assertCurrent();return await work(unlinkedVenueNotes(snapshot),assertCurrent);
    });
    return await Promise.race([request,timeout]);
  } catch(error) {
    if(abort.signal.aborted)throw new Error('等待场地记录核对超时；未导出草案，请稍后重试。');
    throw error;
  } finally {
    clearTimeout(timer);
    events.removeEventListener('scendance:venue-facts-changed',local);
    events.removeEventListener('storage',external);
  }
}
