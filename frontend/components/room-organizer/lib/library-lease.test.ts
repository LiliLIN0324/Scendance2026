// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createLocalWriteLeaseManager } from '@/lib/local-write-lease';
import { makeLayout } from './__testfixtures__/fixtures';
import { saveNamedLayout, deleteNamedLayout, loadNamedLayout, listSavedLayouts, recoverNamedLayoutChange } from './library';
import { listSnapshots, recordSnapshot } from './version-history';

const INDEX = 'standalone-room-organizer-library:_index';
const PENDING = 'standalone-room-organizer-library:_guarded_pending';
const KEY = 'standalone-room-organizer-library:example';
const locks = { request(_name: string, _options: unknown, callback: (lock: unknown) => Promise<unknown>) {
  return Promise.resolve().then(() => callback({ name: 'local' }));
} } as unknown as LockManager;
const manager = () => createLocalWriteLeaseManager({getLocks:()=>locks,getStorage:()=>window.localStorage});
beforeEach(()=>vi.stubGlobal('navigator',{locks}));
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();window.localStorage.clear();});

it('rejects forged and released capabilities without touching existing data',async()=>{
  expect(saveNamedLayout(makeLayout({name:'old'}),'example')).not.toBeNull();
  const before=window.localStorage.getItem(KEY), lease=await manager().acquire();
  await lease.release();
  expect(saveNamedLayout(makeLayout({name:'new'}),'example',lease.capability)).toBeNull();
  expect(deleteNamedLayout('example',{} as never)).toBe(false);
  expect(window.localStorage.getItem(KEY)).toBe(before);
  expect(window.localStorage.getItem(PENDING)).toBeNull();
});
it('keeps old data in recovery record on mid-save lease loss and restores only with a fresh capability',async()=>{
  expect(saveNamedLayout(makeLayout({width:8}),'example')).not.toBeNull();
  const before=window.localStorage.getItem(KEY), index=window.localStorage.getItem(INDEX);
  const mgr=manager(),lease=await mgr.acquire(), original=Storage.prototype.setItem;
  vi.spyOn(Storage.prototype,'setItem').mockImplementation(function(this:Storage,key,value){
    original.call(this,key,value);if(key===KEY)void lease.release();
  });
  expect(saveNamedLayout(makeLayout({width:12}),'example',lease.capability)).toBeNull();
  expect(JSON.parse(window.localStorage.getItem(PENDING)!).beforeBlob).toBe(before);
  expect(recoverNamedLayoutChange(lease.capability)).toBe(false);
  expect(saveNamedLayout(makeLayout(),'other')).toBeNull();
  expect(deleteNamedLayout('example')).toBe(false);
  vi.restoreAllMocks();
  const fresh=await mgr.acquire();
  expect(recoverNamedLayoutChange(fresh.capability)).toBe(true);
  expect(window.localStorage.getItem(KEY)).toBe(before);expect(window.localStorage.getItem(INDEX)).toBe(index);
  expect(saveNamedLayout(makeLayout({width:12}),'example',fresh.capability)).not.toBeNull();
  expect(loadNamedLayout('example')?.width).toBe(12);await fresh.release();
});
it('preserves delete data and refuses to roll back over a later conflicting change',async()=>{
  expect(saveNamedLayout(makeLayout(),'example')).not.toBeNull();
  const before=window.localStorage.getItem(KEY), mgr=manager(),lease=await mgr.acquire();
  const original=Storage.prototype.removeItem;
  vi.spyOn(Storage.prototype,'removeItem').mockImplementation(function(this:Storage,key){original.call(this,key);if(key===KEY)void lease.release();});
  expect(deleteNamedLayout('example',lease.capability)).toBe(false);
  expect(JSON.parse(window.localStorage.getItem(PENDING)!).beforeBlob).toBe(before);
  vi.restoreAllMocks();window.localStorage.setItem(KEY,'other edit');
  const fresh=await mgr.acquire();expect(recoverNamedLayoutChange(fresh.capability)).toBe(false);
  expect(window.localStorage.getItem(KEY)).toBe('other edit');
  window.localStorage.removeItem(KEY);expect(recoverNamedLayoutChange(fresh.capability)).toBe(true);
  expect(window.localStorage.getItem(KEY)).toBe(before);expect(listSavedLayouts()).toHaveLength(1);
  expect(deleteNamedLayout('example',fresh.capability)).toBe(true);await fresh.release();
});
it('refuses quota failure without evicting existing snapshots or changing library',async()=>{
  expect(recordSnapshot(makeLayout())).toBe(true);
  const lease=await manager().acquire(), original=Storage.prototype.setItem;
  vi.spyOn(Storage.prototype,'setItem').mockImplementation(function(this:Storage,key,value){
    if(key===PENDING)throw new DOMException('full','QuotaExceededError');original.call(this,key,value);
  });
  expect(saveNamedLayout(makeLayout(),'example',lease.capability)).toBeNull();
  expect(window.localStorage.getItem(KEY)).toBeNull();expect(listSnapshots()).toHaveLength(1);await lease.release();
});

it('stops before business writes if the recovery record cannot be read back',async()=>{
  const lease=await manager().acquire(), original=Storage.prototype.getItem;
  vi.spyOn(Storage.prototype,'getItem').mockImplementation(function(this:Storage,key){
    if(key===PENDING && original.call(this,key)!==null)return 'unreadable';
    return original.call(this,key);
  });
  expect(saveNamedLayout(makeLayout(),'example',lease.capability)).toBeNull();
  expect(window.localStorage.getItem(KEY)).toBeNull();
  expect(window.localStorage.getItem(INDEX)).toBeNull();
  await lease.release();
});
