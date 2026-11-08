import { webcrypto } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { acquireRestrictedRecoveryLease, restoreSourceScopeWithRecoveryCapability } from './local-write-lease';
import { prepareRestoreJournal, RESTORE_JOURNAL_MARKER, type RestoreJournal, type RestoreJournalStore } from './restore-journal';
import type { SourceScopeSnapshotV2, StoredSource } from './source-storage';
import * as idbDriverModule from './recovery-idb-driver';

function fakeStorage():Storage {const map=new Map<string,string>();return {get length(){return map.size;},clear(){map.clear();},key(i){return [...map.keys()][i]??null;},getItem(k){return map.get(k)??null;},setItem(k,v){map.set(k,String(v));},removeItem(k){map.delete(k);}};}
function journalStore():RestoreJournalStore {const map=new Map<string,RestoreJournal>();return {async read(id){return structuredClone(map.get(id));},async create(id,j){map.set(id,structuredClone(j));},
  async setStage(id,expected,stage,digest,nextDigest,guard){guard?.assertStillHeld();const item=map.get(id);if(!item||item.stage!==expected||item.digest!==digest)throw new Error('changed');map.set(id,{...item,stage,digest:nextDigest});},
  async remove(id,digest){if(map.get(id)?.digest!==digest)throw new Error('changed');map.delete(id);}};}
function controlledIdb(before:SourceScopeSnapshotV2) {
  let state=structuredClone(before),pendingSources=structuredClone(before.sources),pendingForm=structuredClone(before.form),aborted=false;
  let notifyQueued!:()=>void;const queued=new Promise<void>(resolve=>{notifyQueued=resolve;});let last:{onsuccess:(()=>void)|null}|undefined;
  const tx={oncomplete:null as (()=>void)|null,onabort:null as (()=>void)|null,onerror:null as (()=>void)|null,error:null,
    abort(){if(aborted)return;aborted=true;queueMicrotask(()=>tx.onabort?.());},
    objectStore(name:string){if(name==='sources')return {
      index(){return {getAll(){return readRequest(structuredClone(state.sources));}};},
      get(id:string){return readRequest(state.sources.find(item=>item.id===id));},
      delete(id:string){pendingSources=pendingSources.filter(item=>item.id!==id);return {};},
      put(item:StoredSource){pendingSources=[...pendingSources.filter(v=>v.id!==item.id),structuredClone(item)];return {};},
    };return {get(){return readRequest(state.form.present?structuredClone(state.form.value):undefined);},
      getKey(){return readRequest(state.form.present?state.scope:undefined);},
      delete(){pendingForm={present:false};last={onsuccess:null};notifyQueued();return last;},
      put(value:unknown){pendingForm={present:true,value:structuredClone(value)};last={onsuccess:null};notifyQueued();return last;}};},
  };
  let readRemaining=0;
  function readRequest(result:unknown){const req:{result:unknown;onsuccess:(()=>void)|null;error:null}={result,onsuccess:null,error:null};
    if(currentMode==='readonly')readRemaining++;
    queueMicrotask(()=>{if(aborted)return;req.onsuccess?.();if(currentMode==='readonly'&&--readRemaining===0)queueMicrotask(()=>tx.oncomplete?.());});return req;}
  let currentMode='';
  const db={transaction(_names:unknown,mode:string){currentMode=mode;return tx;},close(){}};
  const indexedDB={open(){const req:{result:typeof db;onsuccess:(()=>void)|null;onerror:null;onupgradeneeded:null;error:null}={result:db,onsuccess:null,onerror:null,onupgradeneeded:null,error:null};queueMicrotask(()=>req.onsuccess?.());return req;}};
  return {indexedDB,queued,aborted:()=>aborted,value:()=>state,finish(){last?.onsuccess?.();if(!aborted){state={version:2,scope:before.scope,sources:pendingSources,form:pendingForm};tx.oncomplete?.();}}};
}
const source=(id:string):StoredSource=>({id,scope:'scope-a',name:id,kind:'floorplan',width:1,height:1,blob:new Blob([id],{type:'image/png'})});
const before=():SourceScopeSnapshotV2=>({version:2,scope:'scope-a',sources:[source('old-image')],form:{present:true,value:{width:5}}});
const after=():SourceScopeSnapshotV2=>({version:2,scope:'scope-a',sources:[source('new-image')],form:{present:true,value:{width:6}}});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
async function setup() {
  vi.stubGlobal('crypto',webcrypto);const storage=fakeStorage(),records=journalStore();
  const locks={request(_name:string,_options:unknown,callback:(lock:unknown)=>Promise<unknown>){return callback({name:'scendance:local-activity:writer:v1'});}} as unknown as LockManager;
  vi.stubGlobal('navigator',{locks});vi.stubGlobal('window',{localStorage:storage});
  await prepareRestoreJournal(storage,records,{id:'restore-1',operation:'restore',createdAt:'2026-11-07T00:00:00Z',entries:[{domain:'source-scope',key:'scope-a',before:before(),attempted:after()}]});
  return {storage,lease:await acquireRestrictedRecoveryLease({getLocks:()=>locks,getStorage:()=>storage},records)};
}
it('恢复能力只在活动日志授权的执行路径内使用，不能伪造或修改其他范围',async()=>{
  await expect(restoreSourceScopeWithRecoveryCapability({kind:'recovery'},'scope-a',before(),after())).rejects.toThrow('凭证无效');
  const {lease}=await setup();
  await expect(restoreSourceScopeWithRecoveryCapability(lease.capability,'scope-a',before(),after())).rejects.toThrow('只能在受保护');
  vi.spyOn(idbDriverModule,'createRecoveryIdbDriver').mockReturnValue({read:async()=>before(),compareAndSwap:async()=>restoreSourceScopeWithRecoveryCapability(lease.capability,'scope-b',before(),after())});
  const operation=lease.apply();
  await expect(operation).rejects.toThrow('未授权');await lease.release();
});
it('跨图纸和表单的真实事务在中途失锁时 abort，两类原资料均保留',async()=>{
  const {storage,lease}=await setup();const fake=controlledIdb(before());vi.stubGlobal('indexedDB',fake.indexedDB);
  vi.spyOn(idbDriverModule,'createRecoveryIdbDriver').mockReturnValue({read:async()=>before(),compareAndSwap:async()=>restoreSourceScopeWithRecoveryCapability(lease.capability,'scope-a',before(),after())});
  const operation=lease.apply();
  await fake.queued;const releasing=lease.release();await expect(operation).rejects.toThrow();await releasing;
  fake.finish();expect(fake.aborted()).toBe(true);
  expect(fake.value().sources.map(item=>item.id)).toEqual(['old-image']);expect(fake.value().form).toEqual({present:true,value:{width:5}});
  expect(storage.getItem(RESTORE_JOURNAL_MARKER)).not.toBeNull();
});


it('受保护恢复完成后两张表一起提交，日志核验完成后才清标记',async()=>{
  const {storage,lease}=await setup();const fake=controlledIdb(before());vi.stubGlobal('indexedDB',fake.indexedDB);
  const operation=lease.apply();
  await fake.queued;fake.finish();await operation;
  expect(fake.value().sources.map(item=>item.id)).toEqual(['new-image']);expect(fake.value().form).toEqual({present:true,value:{width:6}});
  expect(storage.getItem(RESTORE_JOURNAL_MARKER)).toContain('"state":"completed"');await lease.release();
});
it('即使处于恢复流程，前后快照与日志不同也不能写入',async()=>{
  const {storage,lease}=await setup();const fake=controlledIdb(before());vi.stubGlobal('indexedDB',fake.indexedDB);
  const changed={...after(),form:{present:true as const,value:{width:999}}};
  vi.spyOn(idbDriverModule,'createRecoveryIdbDriver').mockReturnValue({read:async()=>before(),compareAndSwap:async()=>restoreSourceScopeWithRecoveryCapability(lease.capability,'scope-a',before(),changed)});
  const operation=lease.apply();
  await expect(operation).rejects.toThrow('与恢复日志不一致');expect(fake.value().form).toEqual({present:true,value:{width:5}});
  expect(storage.getItem(RESTORE_JOURNAL_MARKER)).not.toBeNull();await lease.release();
});

it('回滚方向只允许恢复日志记录的原图纸和表单',async()=>{
  const {storage,lease}=await setup();const fake=controlledIdb(after());vi.stubGlobal('indexedDB',fake.indexedDB);
  const operation=lease.rollback();
  await fake.queued;fake.finish();await operation;
  expect(fake.value().sources.map(item=>item.id)).toEqual(['old-image']);expect(fake.value().form).toEqual({present:true,value:{width:5}});
  expect(storage.getItem(RESTORE_JOURNAL_MARKER)).toContain('"state":"completed"');await lease.release();
});

// These tests isolate lease/driver mechanics; plan authorization is exercised without this mock in coordinator and recovery-plan-authorization tests.
vi.mock('./recovery-plan',()=>({validateRecoveryPlan:()=>{},preflightRecoverySourceIds:async()=>{}}));
