import { afterEach, expect, it, vi } from 'vitest';
import { compareAndSetSourceRecord, updateRestoreJournalRecord, updateSourceForm, type RecoveryTransactionGuard } from './source-storage';
import { mergeStoredMaterialCheckins } from './material-checkin-storage';
import { materialCheckinLedgerSchema } from '../../supabase/functions/_shared/material-checkin-contract';
import { acquireRestrictedRecoveryLease, createLocalWriteLeaseManager, type LocalWriteCapability } from './local-write-lease';
import { sourceCapabilityStorage } from './source-capability-storage';
import * as idbDriverModule from './recovery-idb-driver';
import { indexedDbRestoreJournalStore, prepareRestoreJournal, RESTORE_JOURNAL_MARKER, type RestoreJournal, type RestoreJournalStore } from './restore-journal';
import { webcrypto } from 'node:crypto';

/** Controlled IDB transaction: a queued put is committed only on explicit completion. */
function controlledIdb(initial:unknown='before') {
  let data:unknown=initial, pending:unknown, aborted=false, transactionStarted!:()=>void, putQueued!:()=>void;
  let writeRequest:{onsuccess:(()=>void)|null}|undefined;
  const started=new Promise<void>(resolve=>{transactionStarted=resolve;}), queued=new Promise<void>(resolve=>{putQueued=resolve;});
  const tx:{oncomplete:(()=>void)|null;onabort:(()=>void)|null;onerror:(()=>void)|null;error:null;abort:()=>void;objectStore:()=>unknown}={
    oncomplete:null,onabort:null,onerror:null,error:null,
    abort(){if(aborted)return;aborted=true;queueMicrotask(()=>tx.onabort?.());},
    objectStore(){return {get(){const request:{result:unknown;error:null;onsuccess:(()=>void)|null}={result:data,error:null,onsuccess:null};
      queueMicrotask(()=>{if(!aborted)request.onsuccess?.();});return request;},
      put(value:unknown){pending=value;writeRequest={onsuccess:null};putQueued();return writeRequest;},delete(){pending=undefined;writeRequest={onsuccess:null};putQueued();return writeRequest;}};},
  };
  const db={transaction(){transactionStarted();return tx;},close(){}};
  const indexedDB={open(){const request:{result:typeof db;error:null;onsuccess:(()=>void)|null;onerror:(()=>void)|null;onupgradeneeded:null}={result:db,error:null,onsuccess:null,onerror:null,onupgradeneeded:null};
    queueMicrotask(()=>request.onsuccess?.());return request;}};
  return {indexedDB,started,queued,value:()=>data,isAborted:()=>aborted,finishWrite(){writeRequest?.onsuccess?.();},complete(){if(!aborted){data=pending;tx.oncomplete?.();}}};
}
afterEach(()=>vi.unstubAllGlobals());
it('失锁后中止尚未提交的 IndexedDB 写事务，即使已排队 put 也不提交',async()=>{
  const fake=controlledIdb();vi.stubGlobal('indexedDB',fake.indexedDB);
  const abort=new AbortController();let held=true;
  const operation=updateSourceForm(['ordinary-test','id'],()=> 'after',{signal:abort.signal,assertStillHeld(){if(!held)throw new Error('失锁');}});
  await fake.queued;held=false;abort.abort();await expect(operation).rejects.toThrow();
  fake.complete();expect(fake.isAborted()).toBe(true);expect(fake.value()).toBe('before');
});
it('请求回调运行前失锁时也不会写入',async()=>{
  const fake=controlledIdb();vi.stubGlobal('indexedDB',fake.indexedDB);
  const abort=new AbortController();let held=true;
  const update=vi.fn(()=> 'after');const operation=updateSourceForm('x',update,{signal:abort.signal,assertStillHeld(){if(!held)throw new Error('失锁');}});
  await fake.started;held=false;abort.abort();await expect(operation).rejects.toThrow();
  fake.complete();expect(update).not.toHaveBeenCalled();expect(fake.value()).toBe('before');
});

it('put 排队后标记变化时写入成功回调重新检查并中止事务',async()=>{
  const fake=controlledIdb();vi.stubGlobal('indexedDB',fake.indexedDB);const abort=new AbortController();let held=true;
  const operation=updateSourceForm('x',()=> 'after',{signal:abort.signal,assertStillHeld(){if(!held)throw new Error('标记已变化');}});
  await fake.queued;held=false;fake.finishWrite();await expect(operation).rejects.toThrow('标记已变化');
  fake.complete();expect(fake.value()).toBe('before');expect(fake.isAborted()).toBe(true);
});

async function capabilityFixture() {
  const values=new Map<string,string>();const storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value),removeItem:(key:string)=>values.delete(key)} as unknown as Storage;
  const locks={request(_name:string,_options:unknown,callback:(lock:unknown)=>Promise<unknown>){return callback({name:'scendance:local-activity:writer:v1'});}} as unknown as LockManager;
  vi.stubGlobal('navigator',{locks});vi.stubGlobal('window',{localStorage:storage});
  const lease=await createLocalWriteLeaseManager({getLocks:()=>locks,getStorage:()=>storage}).acquire();return {lease,storage};
}
it('普通能力显式进入实际表单事务，租约释放会中止已排队写入',async()=>{
  const fake=controlledIdb();vi.stubGlobal('indexedDB',fake.indexedDB);const {lease}=await capabilityFixture();
  const operation=sourceCapabilityStorage.updateSourceForm(lease.capability,'x',()=> 'after');
  await fake.queued;await lease.release();await expect(operation).rejects.toThrow();
  fake.finishWrite();fake.complete();expect(fake.isAborted()).toBe(true);expect(fake.value()).toBe('before');
});
it('伪造的普通能力在打开数据库前就被拒绝',()=>{
  const open=vi.fn();vi.stubGlobal('indexedDB',{open});
  expect(()=>sourceCapabilityStorage.storeSourceForm({kind:'ordinary'} as unknown as LocalWriteCapability,'x','after')).toThrow('凭证无效');
  expect(open).not.toHaveBeenCalled();
});
it('持有的普通能力在写成功回调再次验证后允许提交',async()=>{
  const fake=controlledIdb();vi.stubGlobal('indexedDB',fake.indexedDB);const {lease}=await capabilityFixture();
  const operation=sourceCapabilityStorage.updateSourceForm(lease.capability,'x',()=> 'after');
  await fake.queued;fake.finishWrite();fake.complete();await expect(operation).resolves.toBe('after');
  expect(fake.value()).toBe('after');await lease.release();
});

it('恢复能力仅保护日志阶段事务，失锁会中止已排队的真实适配写入',async()=>{
  vi.stubGlobal('crypto',webcrypto);
  const values=new Map<string,string>();const storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value),removeItem:(key:string)=>values.delete(key)} as unknown as Storage;
  const locks={request(_name:string,_options:unknown,callback:(lock:unknown)=>Promise<unknown>){return callback({name:'scendance:local-activity:writer:v1'});}} as unknown as LockManager;
  vi.stubGlobal('navigator',{locks});vi.stubGlobal('window',{localStorage:storage});
  let journal:RestoreJournal|undefined;
  const records:RestoreJournalStore={read:async()=>journal,create:async(_id,value)=>{journal=structuredClone(value);},
    setStage:indexedDbRestoreJournalStore.setStage,remove:async()=>{throw new Error('不应删除');}};
  await prepareRestoreJournal(storage,records,{id:'restore-1',operation:'restore',createdAt:'2026-11-07T00:00:00Z',entries:[{domain:'activity-brief',key:'x',before:'old',attempted:'new'}]});
  const fake=controlledIdb(journal);vi.stubGlobal('indexedDB',fake.indexedDB);
  const lease=await acquireRestrictedRecoveryLease({getLocks:()=>locks,getStorage:()=>storage},records);
  const cas=vi.fn();vi.spyOn(idbDriverModule,'createRecoveryIdbDriver').mockReturnValue({read:async()=> 'old',compareAndSwap:cas});const applying=lease.apply();
  await fake.queued;const releasing=lease.release();await expect(applying).rejects.toThrow();await releasing;
  fake.finishWrite();fake.complete();expect(fake.isAborted()).toBe(true);expect((fake.value() as RestoreJournal).stage).toBe('prepared');
  expect(cas).not.toHaveBeenCalled();expect(storage.getItem(RESTORE_JOURNAL_MARKER)).not.toBeNull();
});

it('does not let an intercepted stage grant write unrelated records or survive the operation',async()=>{
  vi.stubGlobal('crypto',webcrypto);
  const values=new Map<string,string>();const storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value),removeItem:(key:string)=>values.delete(key)} as unknown as Storage;
  const locks={request(_name:string,_options:unknown,callback:(lock:unknown)=>Promise<unknown>){return callback({name:'scendance:local-activity:writer:v1'});}} as unknown as LockManager;
  vi.stubGlobal('navigator',{locks});vi.stubGlobal('window',{localStorage:storage});
  let journal:RestoreJournal|undefined,captured:RecoveryTransactionGuard|undefined;
  const records:RestoreJournalStore={read:async()=>journal,create:async(_id,value)=>{journal=structuredClone(value);},
    async setStage(_id,_expected,stage,_digest,nextDigest,guard){
      captured=guard;
      await expect(compareAndSetSourceRecord('other',{present:false},{present:true,value:'overwrite'},()=>true,guard!)).rejects.toThrow('未获授权');
      await expect(updateRestoreJournalRecord('another',()=>({}),guard)).rejects.toThrow('未获授权');
      const fake=controlledIdb(journal);vi.stubGlobal('indexedDB',fake.indexedDB);
      await expect(updateRestoreJournalRecord('restore-1',current=>({...current as object,stage,digest:nextDigest,entries:[]}),guard)).rejects.toThrow('超出授权');
      expect(fake.isAborted()).toBe(true);
      throw new Error('停止测试');
    },remove:async()=>{throw new Error('不应删除');}};
  await prepareRestoreJournal(storage,records,{id:'restore-1',operation:'restore',createdAt:'2026-11-07T00:00:00Z',entries:[{domain:'activity-brief',key:'x',before:'old',attempted:'new'}]});
  const lease=await acquireRestrictedRecoveryLease({getLocks:()=>locks,getStorage:()=>storage},records);
  vi.spyOn(idbDriverModule,'createRecoveryIdbDriver').mockReturnValue({read:async()=> 'old',compareAndSwap:vi.fn()});
  await expect(lease.apply()).rejects.toThrow('停止测试');
  await expect(updateRestoreJournalRecord('restore-1',()=>({}),captured)).rejects.toThrow('未获授权');
  await lease.release();expect(storage.getItem(RESTORE_JOURNAL_MARKER)).not.toBeNull();
});

// These tests isolate lease/driver mechanics; plan authorization is exercised without this mock in coordinator and recovery-plan-authorization tests.
vi.mock('./recovery-plan',()=>({validateRecoveryPlan:()=>{},preflightRecoverySourceIds:async()=>{}}));

it('点验合并已进入 IDB 事务后失锁，队列中的写入中止并保留原账',async()=>{
  const original=materialCheckinLedgerSchema.parse({projectId:'point-a',dataKind:'rehearsal',sheets:[]});
  const fake=controlledIdb(original);vi.stubGlobal('indexedDB',fake.indexedDB);const {lease}=await capabilityFixture();
  const operation=mergeStoredMaterialCheckins('point-a',original,()=>{},lease.capability);
  await fake.queued;await lease.release();await expect(operation).rejects.toThrow();
  fake.finishWrite();fake.complete();expect(fake.isAborted()).toBe(true);expect(fake.value()).toEqual(original);
});
