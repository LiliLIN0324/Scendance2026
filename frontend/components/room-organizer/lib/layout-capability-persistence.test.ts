import { webcrypto } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { acquireRestrictedRecoveryLease, createLocalWriteLeaseManager, type LocalWriteCapability } from '@/lib/local-write-lease';
import { prepareRestoreJournal, type RestoreJournal, type RestoreJournalStore } from '@/lib/restore-journal';
import { makeLayout } from './__testfixtures__/fixtures';
import { createLayoutPersistenceCapability } from './layout-capability-persistence';

function authorities() {
  const entries=new Map<string,string>();let held=false;
  const storage:Storage={get length(){return entries.size;},clear:()=>entries.clear(),getItem:key=>entries.get(key)??null,key:index=>[...entries.keys()][index]??null,
    setItem:(key,value)=>{entries.set(key,String(value));},removeItem:key=>{entries.delete(key);}};
  const locks={request(_name:string,_options:unknown,callback:(lock:unknown)=>Promise<unknown>){
    if(held)return Promise.resolve().then(()=>callback(null));held=true;
    return Promise.resolve().then(()=>callback({})).finally(()=>{held=false;});
  }} as unknown as LockManager;
  vi.stubGlobal('crypto',webcrypto);vi.stubGlobal('navigator',{locks});vi.stubGlobal('window',{localStorage:storage});
  return {storage,locks,entries,deps:{getLocks:()=>locks,getStorage:()=>storage}};
}
function journalStore(): RestoreJournalStore {
  const entries=new Map<string,RestoreJournal>();
  return {async read(id){return structuredClone(entries.get(id));},async create(id,journal){entries.set(id,structuredClone(journal));},
    async setStage(id,expected,stage,digest,nextDigest){const prior=entries.get(id);if(!prior||prior.stage!==expected||prior.digest!==digest)throw new Error('changed');entries.set(id,{...prior,stage,digest:nextDigest});},
    async remove(id,digest){if(entries.get(id)?.digest!==digest)throw new Error('changed');entries.delete(id);}};
}
afterEach(()=>vi.unstubAllGlobals());

describe('layout persistence ordinary capability',()=>{
  it('accepts only the live ordinary capability and its stable assertion expires on release',async()=>{
    const {deps,storage}=authorities(); const lease=await createLocalWriteLeaseManager(deps).acquire();
    expect(()=>createLayoutPersistenceCapability({} as LocalWriteCapability)).toThrow('凭证无效');
    const adapter=createLayoutPersistenceCapability(lease.capability),assertion=adapter.assertWrite;
    expect(adapter.saveLayout(makeLayout(),storage).ok).toBe(true);
    await lease.release();expect(()=>assertion()).toThrow('失效');
    expect(()=>adapter.saveLayout(makeLayout(),storage)).toThrow('失效');
  });
  it('rejects recovery capability even while it is valid',async()=>{
    const {deps,storage}=authorities(),store=journalStore();
    await prepareRestoreJournal(storage,store,{id:'journal-1',operation:'restore',createdAt:'2026-11-07T00:00:00Z',entries:[{domain:'layout',key:'main',before:'old',attempted:'new'}]});
    const lease=await acquireRestrictedRecoveryLease(deps,store);
    expect(()=>createLayoutPersistenceCapability(lease.capability as unknown as LocalWriteCapability)).toThrow('凭证无效');
    await lease.release();
  });
});
