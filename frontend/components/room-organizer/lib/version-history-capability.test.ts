// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {createLocalWriteLeaseManager} from '@/lib/local-write-lease';
import {VERSION_HISTORY_PENDING_KEY} from '@/lib/version-history-pending';
import {makeLayout} from './__testfixtures__/fixtures';
import {clearSnapshots,evictOldestSnapshot,listSnapshots,recordSnapshot,recoverVersionHistoryChange,VERSION_HISTORY_STORAGE_KEY,VERSION_HISTORY_META_KEY} from './version-history';
const locks={request(_name:string,_options:unknown,callback:(lock:unknown)=>Promise<unknown>){return Promise.resolve().then(()=>callback({name:'history'}));}} as unknown as LockManager;
const manager=()=>createLocalWriteLeaseManager({getLocks:()=>locks,getStorage:()=>window.localStorage});
beforeEach(()=>vi.stubGlobal('navigator',{locks}));
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();window.localStorage.clear();});
it('retains an undo record when a lease is lost after writing the ring and recovers on a fresh lease',async()=>{
  expect(recordSnapshot(makeLayout({width:8}),{force:true})).toBe(true);
  const before=window.localStorage.getItem(VERSION_HISTORY_STORAGE_KEY),meta=window.localStorage.getItem(VERSION_HISTORY_META_KEY);
  const mgr=manager(),lease=await mgr.acquire(),original=Storage.prototype.setItem;
  vi.spyOn(Storage.prototype,'setItem').mockImplementation(function(this:Storage,key,value){original.call(this,key,value);if(key===VERSION_HISTORY_STORAGE_KEY)void lease.release();});
  expect(recordSnapshot(makeLayout({width:12}),{force:true,capability:lease.capability})).toBe(false);
  expect(JSON.parse(window.localStorage.getItem(VERSION_HISTORY_PENDING_KEY)!).before.ring).toBe(before);
  expect(recordSnapshot(makeLayout(),{force:true})).toBe(false);
  expect(recoverVersionHistoryChange(lease.capability)).toBe(false);vi.restoreAllMocks();
  const fresh=await mgr.acquire();expect(recoverVersionHistoryChange(fresh.capability)).toBe(true);
  expect(window.localStorage.getItem(VERSION_HISTORY_STORAGE_KEY)).toBe(before);
  expect(window.localStorage.getItem(VERSION_HISTORY_META_KEY)).toBe(meta);
  expect(recordSnapshot(makeLayout({width:12}),{force:true,capability:fresh.capability})).toBe(true);await fresh.release();
});
it('refuses to recover across a third value and preserves the new data',async()=>{
  expect(recordSnapshot(makeLayout(),{force:true})).toBe(true);
  const mgr=manager(),lease=await mgr.acquire(),original=Storage.prototype.removeItem;
  vi.spyOn(Storage.prototype,'removeItem').mockImplementation(function(this:Storage,key){original.call(this,key);if(key===VERSION_HISTORY_STORAGE_KEY)void lease.release();});
  clearSnapshots({capability:lease.capability});vi.restoreAllMocks();
  expect(window.localStorage.getItem(VERSION_HISTORY_PENDING_KEY)).not.toBeNull();
  window.localStorage.setItem(VERSION_HISTORY_STORAGE_KEY,'other change');const fresh=await mgr.acquire();
  expect(recoverVersionHistoryChange(fresh.capability)).toBe(false);
  expect(window.localStorage.getItem(VERSION_HISTORY_STORAGE_KEY)).toBe('other change');await fresh.release();
});
it('quota, forged capability and failed record readback do not evict history',async()=>{
  expect(recordSnapshot(makeLayout(),{force:true})).toBe(true);const before=window.localStorage.getItem(VERSION_HISTORY_STORAGE_KEY);
  expect(evictOldestSnapshot({capability:{} as never})).toBe(false);
  const lease=await manager().acquire(),original=Storage.prototype.setItem;
  vi.spyOn(Storage.prototype,'setItem').mockImplementation(function(this:Storage,key,value){if(key===VERSION_HISTORY_PENDING_KEY)throw new DOMException('full','QuotaExceededError');original.call(this,key,value);});
  expect(recordSnapshot(makeLayout({width:12}),{force:true,capability:lease.capability})).toBe(false);
  expect(window.localStorage.getItem(VERSION_HISTORY_STORAGE_KEY)).toBe(before);expect(listSnapshots()).toHaveLength(1);
  vi.restoreAllMocks();const read=Storage.prototype.getItem;
  vi.spyOn(Storage.prototype,'getItem').mockImplementation(function(this:Storage,key){const value=read.call(this,key);return key===VERSION_HISTORY_PENDING_KEY&&value!==null?'broken':value;});
  expect(evictOldestSnapshot({capability:lease.capability})).toBe(false);
  expect(window.localStorage.getItem(VERSION_HISTORY_STORAGE_KEY)).toBe(before);await lease.release();
});

it('retains the recovery marker when a storage write silently fails readback',async()=>{
  expect(recordSnapshot(makeLayout(),{force:true})).toBe(true);
  const before=window.localStorage.getItem(VERSION_HISTORY_STORAGE_KEY),lease=await manager().acquire();
  const original=Storage.prototype.setItem;
  vi.spyOn(Storage.prototype,'setItem').mockImplementation(function(this:Storage,key,value){
    if(key!==VERSION_HISTORY_STORAGE_KEY)original.call(this,key,value);
  });
  expect(recordSnapshot(makeLayout({width:12}),{force:true,capability:lease.capability})).toBe(false);
  expect(window.localStorage.getItem(VERSION_HISTORY_STORAGE_KEY)).toBe(before);
  expect(window.localStorage.getItem(VERSION_HISTORY_PENDING_KEY)).not.toBeNull();
  vi.restoreAllMocks();expect(recoverVersionHistoryChange(lease.capability)).toBe(true);await lease.release();
});
