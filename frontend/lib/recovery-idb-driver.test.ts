import { webcrypto } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { materialCheckinLedgerSchema } from '../../supabase/functions/_shared/material-checkin-contract';
import { acquireRestrictedRecoveryLease, restoreFormWithRecoveryCapability } from './local-write-lease';
import { createRecoveryIdbDriver } from './recovery-idb-driver';
import * as idbDriverModule from './recovery-idb-driver';
import { sameRecoveryFormValue } from './recovery-form-value';
import { prepareRestoreJournal, RESTORE_JOURNAL_MARKER, type RestoreJournal, type RestoreJournalEntry, type RestoreJournalStore } from './restore-journal';

const project='20000000-0000-4000-8000-000000000001';
function storage():Storage {const map=new Map<string,string>();return {get length(){return map.size;},clear(){map.clear();},key(i){return [...map.keys()][i]??null;},getItem(k){return map.get(k)??null;},setItem(k,v){map.set(k,String(v));},removeItem(k){map.delete(k);}};}
function journalStore():RestoreJournalStore {const map=new Map<string,RestoreJournal>();return {async read(id){return structuredClone(map.get(id));},async create(id,j){map.set(id,structuredClone(j));},
  async setStage(id,expected,stage,digest,nextDigest,guard){guard?.assertStillHeld();const item=map.get(id);if(!item||item.stage!==expected||item.digest!==digest)throw new Error('changed');map.set(id,{...item,stage,digest:nextDigest});},
  async remove(id,digest){if(map.get(id)?.digest!==digest)throw new Error('changed');map.delete(id);}};}
/** Controlled IndexedDB facade; all changes are staged until a transaction commits. */
function formsDb(seed:Array<[unknown,unknown]>, pauseWrite=false) {
  const data=new Map(seed.map(([k,v])=>[JSON.stringify(k),structuredClone(v)]));let resume!:()=>void,queued!:()=>void;
  const writeQueued=new Promise<void>(resolve=>{queued=resolve;});
  function transaction(_names:unknown,mode:string) {
    let pending=0,aborted=false;const staged=new Map(data);
    const tx={oncomplete:null as (()=>void)|null,onabort:null as (()=>void)|null,onerror:null as (()=>void)|null,error:null,
      abort(){if(aborted)return;aborted=true;queueMicrotask(()=>tx.onabort?.());},
      objectStore(){return {
        get(key:unknown){return request(()=>structuredClone(staged.get(JSON.stringify(key))));},
        getKey(key:unknown){return request(()=>staged.has(JSON.stringify(key))?key:undefined);},
        put(value:unknown,key:unknown){return request(()=>{staged.set(JSON.stringify(key),structuredClone(value));return key;},true);},
        delete(key:unknown){return request(()=>{staged.delete(JSON.stringify(key));return undefined;},true);},
      };},
    };
    function request(compute:()=>unknown,writing=false){const r:{result:unknown;error:null;onsuccess:(()=>void)|null}={result:undefined,error:null,onsuccess:null};pending++;
      const run=()=>{if(aborted)return;r.result=compute();r.onsuccess?.();if(--pending===0)queueMicrotask(()=>{if(!aborted){if(mode==='readwrite'){data.clear();for(const [k,v] of staged)data.set(k,v);}tx.oncomplete?.();}});};
      if(writing&&pauseWrite){resume=run;queued();}else queueMicrotask(run);return r;}
    return tx;
  }
  const db={transaction,close(){}};const indexedDB={open(){const req:{result:typeof db;onsuccess:(()=>void)|null;onerror:null;onupgradeneeded:null;error:null}={result:db,onsuccess:null,onerror:null,onupgradeneeded:null,error:null};queueMicrotask(()=>req.onsuccess?.());return req;}};
  return {indexedDB,writeQueued,resume:()=>resume?.(),get:(key:unknown)=>structuredClone(data.get(JSON.stringify(key))),has:(key:unknown)=>data.has(JSON.stringify(key)),set:(key:unknown,value:unknown)=>data.set(JSON.stringify(key),structuredClone(value))};
}
async function setup(entry:RestoreJournalEntry) {
  vi.stubGlobal('crypto',webcrypto);const local=storage(),records=journalStore();
  const locks={request(_name:string,_opts:unknown,callback:(lock:unknown)=>Promise<unknown>){return callback({name:'scendance:local-activity:writer:v1'});}} as unknown as LockManager;
  vi.stubGlobal('navigator',{locks});vi.stubGlobal('window',{localStorage:local});
  await prepareRestoreJournal(local,records,{id:'restore-1',operation:'restore',createdAt:'2026-11-07T00:00:00Z',entries:[entry]});
  return {local,lease:await acquireRestrictedRecoveryLease({getLocks:()=>locks,getStorage:()=>local},records)};
}
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
it('需求表单按日志应用并按原始值做事务 CAS',async()=>{
  const entry={domain:'activity-brief',key:project,before:{present:true,value:{event:'讲座',description:'旧'}},attempted:{present:true,value:{event:'讲座',description:'新'}}};
  const fake=formsDb([[`${project}:brief`,{description:'旧',event:'讲座'}]]);vi.stubGlobal('indexedDB',fake.indexedDB);
  const {local,lease}=await setup(entry);await lease.apply();
  expect(fake.get(`${project}:brief`)).toEqual(entry.attempted.value);expect(local.getItem(RESTORE_JOURNAL_MARKER)).toContain('"state":"completed"');await lease.release();
});
it('点验按反向阶段恢复，并保持记录原样',async()=>{
  const before=materialCheckinLedgerSchema.parse({projectId:project,sheets:[]});
  const attempted=materialCheckinLedgerSchema.parse({projectId:project,dataKind:'rehearsal',sheets:[]});
  const fake=formsDb([[['material-checkins',project],attempted]]);vi.stubGlobal('indexedDB',fake.indexedDB);
  const {local,lease}=await setup({domain:'material-checkins',key:project,before:{present:true,value:before},attempted:{present:true,value:attempted}});await lease.rollback();
  expect(fake.get(['material-checkins',project])).toEqual(before);expect(local.getItem(RESTORE_JOURNAL_MARKER)).toContain('"state":"completed"');await lease.release();
});
it('活动需求持锁写入排队后失锁会中止并保留原值',async()=>{
  const entry={domain:'activity-brief',key:project,before:{present:true,value:{description:'旧'}},attempted:{present:true,value:{description:'新'}}};
  const fake=formsDb([[`${project}:brief`,entry.before.value]],true);vi.stubGlobal('indexedDB',fake.indexedDB);
  const {local,lease}=await setup(entry);const operation=lease.apply();
  await fake.writeQueued;const releasing=lease.release();await expect(operation).rejects.toThrow();await releasing;fake.resume();
  expect(fake.get(`${project}:brief`)).toEqual(entry.before.value);expect(local.getItem(RESTORE_JOURNAL_MARKER)).not.toBeNull();
});
it('事务 CAS 看到第三方新值时不覆盖并保留标记',async()=>{
  const entry={domain:'activity-brief',key:project,before:{present:true,value:{description:'旧'}},attempted:{present:true,value:{description:'新'}}};
  const fake=formsDb([[`${project}:brief`,entry.before.value]]);vi.stubGlobal('indexedDB',fake.indexedDB);
  const {local,lease}=await setup(entry);const base=createRecoveryIdbDriver(lease.capability);
  vi.spyOn(idbDriverModule,'createRecoveryIdbDriver').mockReturnValue({read:base.read,compareAndSwap:async(...args)=>{fake.set(`${project}:brief`,{description:'外部更新'});await base.compareAndSwap(...args);}});
  const operation=lease.apply();
  await expect(operation).rejects.toThrow('已有新变化');expect(fake.get(`${project}:brief`)).toEqual({description:'外部更新'});
  expect(local.getItem(RESTORE_JOURNAL_MARKER)).not.toBeNull();await lease.release();
});
it('表单等值严格区分 undefined、缺失、空槽及对象键顺序',()=>{
  expect(sameRecoveryFormValue({a:1,b:2},{b:2,a:1})).toBe(true);
  expect(sameRecoveryFormValue({a:undefined},{})).toBe(false);
  expect(sameRecoveryFormValue(Array(1),[undefined])).toBe(false);
});
it('伪造凭证或非当前流程不能调用需求恢复',async()=>{
  await expect(restoreFormWithRecoveryCapability({kind:'recovery'},'activity-brief',project,{},{})).rejects.toThrow('凭证无效');
  const {lease}=await setup({domain:'activity-brief',key:project,before:{present:false},attempted:{present:false}});
  await expect(restoreFormWithRecoveryCapability(lease.capability,'activity-brief',project,{present:false},{present:false})).rejects.toThrow('只能在受保护');await lease.release();
});

it('存在但值为 undefined 与没有该记录不同，未知第三值不得覆盖',async()=>{
  const key=`${project}:brief`,fake=formsDb([[key,undefined]]);vi.stubGlobal('indexedDB',fake.indexedDB);
  const {local,lease}=await setup({domain:'activity-brief',key:project,before:{present:false},attempted:{present:true,value:{description:'新'}}});
  await expect(lease.apply()).rejects.toThrow('已有新变化');
  expect(fake.has(key)).toBe(true);expect(fake.get(key)).toBeUndefined();expect(local.getItem(RESTORE_JOURNAL_MARKER)).not.toBeNull();await lease.release();
});
it('日志明确记录 present undefined 时可精确删除而不是假设本来不存在',async()=>{
  const key=`${project}:brief`,fake=formsDb([[key,undefined]]);vi.stubGlobal('indexedDB',fake.indexedDB);
  const {local,lease}=await setup({domain:'activity-brief',key:project,before:{present:true,value:undefined},attempted:{present:false}});
  await lease.apply();expect(fake.has(key)).toBe(false);
  expect(local.getItem(RESTORE_JOURNAL_MARKER)).toContain('"state":"completed"');await lease.release();
});

// These tests isolate lease/driver mechanics; plan authorization is exercised without this mock in coordinator and recovery-plan-authorization tests.
vi.mock('./recovery-plan',()=>({validateRecoveryPlan:()=>{},preflightRecoverySourceIds:async()=>{}}));
