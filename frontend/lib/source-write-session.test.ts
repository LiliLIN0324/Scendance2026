import { webcrypto } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';

function browser() {
  const values=new Map<string,string>();let held=false;
  const storage:Storage={get length(){return values.size;},clear:()=>values.clear(),getItem:key=>values.get(key)??null,key:index=>[...values.keys()][index]??null,
    setItem:(key,value)=>{values.set(key,String(value));},removeItem:key=>{values.delete(key);}};
  const locks={request(_name:string,_options:unknown,callback:(lock:unknown)=>Promise<unknown>){
    if(held)return Promise.resolve().then(()=>callback(null));held=true;
    return Promise.resolve().then(()=>callback({})).finally(()=>{held=false;});
  }} as unknown as LockManager;
  vi.stubGlobal('crypto',webcrypto);vi.stubGlobal('navigator',{locks});vi.stubGlobal('window',{localStorage:storage});
  return {storage,locks};
}
/** Stage IDB changes until completion; abort discards every pending write. */
function database() {
  let forms=new Map<string,unknown>(),images=new Map<string,unknown>(),deferOpen=false;
  const waiting:(()=>void)[]=[];
  const db={close:vi.fn(),transaction(_names:string|string[]){
    const stagedForms=structuredClone(forms),stagedImages=structuredClone(images);let pending=0,aborted=false,done=false;
    const tx={error:null as Error|null,oncomplete:undefined as undefined|(()=>void),onabort:undefined as undefined|(()=>void),onerror:undefined as undefined|(()=>void),
      abort(){if(aborted||done)return;aborted=true;queueMicrotask(()=>tx.onabort?.());},objectStore(name:string){
        const map=name==='forms'?stagedForms:stagedImages;
        const key=(value:unknown)=>JSON.stringify(value);
        return {
          get:(k:unknown)=>request(()=>map.get(key(k))),getKey:(k:unknown)=>request(()=>map.has(key(k))?k:undefined),
          index:()=>({getAll:(scope:string)=>request(()=>[...stagedImages.values()].filter((item:any)=>item.scope===scope))}),
          put:(value:unknown,k?:unknown)=>request(()=>{map.set(key(k??(value as {id:string}).id),structuredClone(value));}),
          add:(value:unknown,k?:unknown)=>request(()=>{const id=key(k??(value as {id:string}).id);if(map.has(id))throw new Error('重复');map.set(id,structuredClone(value));}),
          delete:(k:unknown)=>request(()=>{map.delete(key(k));}),
        };
      }};
    function finish(){if(pending||aborted||done)return;done=true;forms=stagedForms;images=stagedImages;tx.oncomplete?.();}
    function request(run:()=>unknown){pending++;const req={result:undefined as unknown,error:null as Error|null,onsuccess:undefined as undefined|(()=>void)};
      queueMicrotask(()=>{if(aborted)return;try{req.result=run();req.onsuccess?.();}catch(error){tx.error=error as Error;tx.abort();}pending--;queueMicrotask(finish);});return req;}
    queueMicrotask(finish);return tx;
  }};
  vi.stubGlobal('indexedDB',{open(){const req={result:db,onsuccess:undefined as undefined|(()=>void)};const finish=()=>req.onsuccess?.();if(deferOpen)waiting.push(finish);else queueMicrotask(finish);return req;}});
  return {forms:()=>forms,images:()=>images,hold(){deferOpen=true;},release(){deferOpen=false;for(const finish of waiting.splice(0))finish();}};
}
afterEach(()=>{vi.unstubAllGlobals();vi.resetModules();});

it('guards legacy writes, cancels queued operations on unbind, and refuses replacement until old flushes settle',async()=>{
  vi.resetModules();const {storage,locks}=browser(),db=database();
  const source=await import('./source-storage'),leases=await import('./local-write-lease');
  await source.storeSourceForm('legacy',{name:'旧模式'});
  const manager=leases.createLocalWriteLeaseManager({getLocks:()=>locks,getStorage:()=>storage});
  const first=await manager.acquire(),second=await manager.acquire();
  expect(()=>source.bindSourceWriteSession({} as typeof first.capability)).toThrow('凭证无效');
  const unbind=source.bindSourceWriteSession(first.capability);
  await source.storeSourceForm('draft',{name:'原始'});
  await source.storeSource({id:'photo',scope:'draft',name:'原图',kind:'floorplan',width:1,height:1,blob:new Blob(['pixels'])});
  await source.updateSourceForm('draft',value=>({...value as object,description:'已确认'}));
  expect(db.forms().get(JSON.stringify('draft'))).toEqual({name:'原始',description:'已确认'});
  db.hold();const queued=source.storeSourceForm('draft',{name:'不可写入'});void queued.catch(()=>{});
  expect(()=>source.bindSourceWriteSession(second.capability)).toThrow('写入仍在结束');
  unbind();db.release();await expect(queued).rejects.toThrow();
  expect(db.forms().get(JSON.stringify('draft'))).toEqual({name:'原始',description:'已确认'});
  await expect(source.storeSourceForm('draft',{name:'无权'})).rejects.toThrow('已暂停');

  const releaseSecond=source.bindSourceWriteSession(second.capability);
  let continueFlush!:()=>void,entered!:()=>void;const started=new Promise<void>(resolve=>{entered=resolve;});
  const unregister=source.registerSourceFlush('draft',async()=>{entered();await new Promise<void>(resolve=>{continueFlush=resolve;});await source.storeSourceForm('draft',{name:'旧刷新'});});
  const copy=source.copySourceScope('draft','target');void copy.catch(()=>{});await started;
  releaseSecond();expect(()=>source.bindSourceWriteSession(first.capability)).toThrow('写入仍在结束');
  continueFlush();await expect(copy).rejects.toThrow();unregister();
  expect(db.forms().get(JSON.stringify('draft'))).toEqual({name:'原始',description:'已确认'});expect(db.forms().has(JSON.stringify('target'))).toBe(false);
  const afterFlushUnbind=source.bindSourceWriteSession(first.capability);
  await source.copySourceScope('draft','copy');
  expect(db.forms().get(JSON.stringify('copy'))).toEqual({name:'原始',description:'已确认'});
  expect([...db.images().values()].filter((entry:any)=>entry.scope==='copy')).toHaveLength(1);
  let releasePeer!:()=>void,peerStarted!:()=>void;const peerReady=new Promise<void>(resolve=>{peerStarted=resolve;});
  const stopFail=source.registerSourceFlush('concurrent',()=>{throw new Error('一个刷新失败');});
  const stopWait=source.registerSourceFlush('concurrent',async()=>{peerStarted();await new Promise<void>(resolve=>{releasePeer=resolve;});await source.storeSourceForm('draft',{name:'迟到写入'});});
  const concurrent=source.flushSourceScope('concurrent');void concurrent.catch(()=>{});await peerReady;
  expect(()=>source.bindSourceWriteSession(second.capability)).toThrow('写入仍在结束');
  releasePeer();await expect(concurrent).rejects.toThrow();stopFail();stopWait();afterFlushUnbind();
  expect(db.forms().get(JSON.stringify('draft'))).toEqual({name:'原始',description:'已确认'});
  const finalUnbind=source.bindSourceWriteSession(first.capability);
  await source.storeSourceForm('after',{name:'新租约'});expect(db.forms().get(JSON.stringify('after'))).toEqual({name:'新租约'});
  await expect(source.updateSourceForm(['restore-journal-v1','other'],()=>({}))).rejects.toThrow('受限恢复流程');
  await expect(source.updateSourceForm(['restore-completion-ledger-v1','other'],()=>({}))).rejects.toThrow('受限恢复流程');
  const ordinaryAsRecovery={capability:first.capability as unknown as import('./local-write-lease').RecoveryCapability,signal:new AbortController().signal,assertStillHeld(){}};
  await expect(source.compareAndSetSourceRecord('after',{present:false},{present:false},()=>true,ordinaryAsRecovery)).rejects.toThrow('凭证无效');
  await first.release();await expect(source.storeSourceForm('after',{name:'失权'})).rejects.toThrow();
  expect(db.forms().get(JSON.stringify('after'))).toEqual({name:'新租约'});
  finalUnbind();await second.release();
  const journal=await import('./restore-journal');let recorded:unknown;
  const recoveryStore:import('./restore-journal').RestoreJournalStore={
    async read(){return structuredClone(recorded);},async create(_id,value){recorded=structuredClone(value);},
    async setStage(){throw new Error('not needed');},async remove(){throw new Error('not needed');},
  };
  await journal.prepareRestoreJournal(storage,recoveryStore,{id:'recovery',operation:'restore',createdAt:'2026-11-07T00:00:00Z',entries:[{domain:'layout',key:'main',before:'old',attempted:'new'}]});
  const recovery=await leases.acquireRestrictedRecoveryLease({getLocks:()=>locks,getStorage:()=>storage},recoveryStore);
  expect(()=>source.bindSourceWriteSession(recovery.capability as unknown as typeof first.capability)).toThrow('凭证无效');
  const fakeGuard={capability:recovery.capability,signal:recovery.signal,assertStillHeld(){}};
  await expect(source.compareAndSetSourceRecord('draft',{present:true,value:{name:'原始',description:'已确认'}},{present:false},()=>true,fakeGuard)).rejects.toThrow('未获授权');
  const sourceBefore={scope:'draft',sources:[],form:undefined};
  await expect(source.restoreSourceScopeIfUnchanged('draft',sourceBefore,sourceBefore,()=>{},fakeGuard)).rejects.toThrow('未获授权');
  const sourceBeforeV2={version:2 as const,scope:'draft',sources:[],form:{present:false as const}};
  await expect(source.restoreSourceScopeV2IfUnchanged('draft',sourceBeforeV2,sourceBeforeV2,fakeGuard)).rejects.toThrow('未获授权');
  await expect(source.updateRestoreJournalRecord('recovery',()=>({}),fakeGuard)).rejects.toThrow('未获授权');
  await expect(source.updateRestoreJournalRecord('recovery',()=>({}))).rejects.toThrow('凭证无效');
  expect(db.forms().get(JSON.stringify('draft'))).toEqual({name:'原始',description:'已确认'});
  await recovery.release();
});
