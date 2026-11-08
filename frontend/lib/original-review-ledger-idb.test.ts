// @vitest-environment jsdom
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {createLocalWriteLeaseManager} from './local-write-lease';
import {originalReviewReceiptKey,type OriginalReviewReceipt} from './original-review-commit';
import {auditOriginalReviewStartup} from './original-review-completion';
import {createOriginalReviewLedger} from './original-review-ledger-idb';
const account='11111111-1111-4111-8111-111111111111',project='22222222-2222-4222-8222-222222222222';
const key=originalReviewReceiptKey(account,project);
const receipt:OriginalReviewReceipt={version:1,projectId:project,reviewId:'33333333-3333-4333-8333-333333333333',baseHash:'a'.repeat(64),candidateHash:'b'.repeat(64),baseRevision:4};
const completion={version:1 as const,receipt,appliedRevision:5};
const locks={request(_name:string,_opts:unknown,cb:(lock:unknown)=>Promise<unknown>){return Promise.resolve().then(()=>cb({}));}} as unknown as LockManager;
let lease:Awaited<ReturnType<ReturnType<typeof createLocalWriteLeaseManager>['acquire']>>;
function fakeDb(){
 const data=new Map<IDBValidKey,unknown>();let beforePut:(()=>void)|undefined;
 const db={close(){},transaction(_store:string,mode:string){
  const draft=new Map(data);let count=0,aborted=false,finished=false;
  const tx={error:null as unknown,oncomplete:null as null|(()=>void),onerror:null as null|(()=>void),onabort:null as null|(()=>void),
   abort(){if(aborted||finished)return;aborted=true;queueMicrotask(()=>tx.onabort?.());},
   objectStore(){return {transaction:tx,getKey:(k:IDBValidKey)=>request(()=>draft.has(k)?k:undefined),get:(k:IDBValidKey)=>request(()=>draft.get(k)),
    put:(v:unknown,k:IDBValidKey)=>{beforePut?.();return request(()=>{draft.set(k,structuredClone(v));});},delete:(k:IDBValidKey)=>request(()=>{draft.delete(k);}),
    openCursor(){count++;const values=[...draft.entries()];let index=0;
     const req:{result:{key:IDBValidKey;value:unknown;continue():void}|null;onsuccess:null|(()=>void)}={result:null,onsuccess:null};
     const advance=()=>{if(aborted)return;if(index>=values.length){req.result=null;req.onsuccess?.();count--;queueMicrotask(finish);return;}
       const [key,value]=values[index++]!;req.result={key,value,continue(){queueMicrotask(advance);}};req.onsuccess?.();};
     queueMicrotask(advance);return req;},
   };}};
  function finish(){if(count||aborted||finished)return;finished=true;if(mode==='readwrite'){data.clear();for(const [key,value] of draft)data.set(key,value);}tx.oncomplete?.();}
  function request(run:()=>unknown){count++;const req={result:undefined as unknown,onsuccess:null as null|(()=>void)};
   queueMicrotask(()=>{if(aborted)return;req.result=run();req.onsuccess?.();count--;queueMicrotask(finish);});return req;}
  queueMicrotask(finish);return tx;
 }};
 vi.stubGlobal('indexedDB',{open(){const req={result:db,onsuccess:null as null|(()=>void),onerror:null,onblocked:null,onupgradeneeded:null};queueMicrotask(()=>req.onsuccess?.());return req;}});
 return {data,onPut(fn:()=>void){beforePut=fn;}};
}
beforeEach(async()=>{localStorage.clear();vi.stubGlobal('navigator',{locks});lease=await createLocalWriteLeaseManager({getLocks:()=>locks,getStorage:()=>window.localStorage}).acquire();});
afterEach(async()=>{await lease.release();vi.restoreAllMocks();vi.unstubAllGlobals();localStorage.clear();});
describe('isolated original-review completion IDB ledger',()=>{
 it('preserves exact values and uses transaction CAS instead of replacing a third value',async()=>{
  const fake=fakeDb(),ledger=createOriginalReviewLedger(lease.capability,account);
  expect(await ledger.read(key)).toEqual({present:false});
  expect(await ledger.compareAndSwap(key,{present:false},{present:true,value:completion})).toBe('applied');
  expect(await ledger.read(key)).toEqual({present:true,value:completion});
  expect(await ledger.compareAndSwap(key,{present:false},{present:true,value:completion})).toBe('conflict');expect(fake.data.get(key)).toEqual(completion);
  expect(await ledger.compareAndSwap(key,{present:true,value:completion},{present:false})).toBe('unknown');expect(fake.data.get(key)).toEqual(completion);
  expect(await ledger.compareAndSwap(key,{present:true,value:completion},{present:true,value:completion})).toBe('unknown');expect(fake.data.get(key)).toEqual(completion);
 });
 it.each([null,undefined,{version:1,receipt,appliedRevision:99}])('retains malformed existing value %j and fails closed',async value=>{
  const fake=fakeDb(),ledger=createOriginalReviewLedger(lease.capability,account);fake.data.set(key,value);
  await expect(ledger.read(key)).rejects.toThrow('无法核验');expect(await ledger.compareAndSwap(key,{present:false},{present:true,value:completion})).toBe('unknown');
  await expect(ledger.list()).rejects.toThrow();expect(fake.data.has(key)).toBe(true);expect(fake.data.get(key)).toEqual(value);
 });
 it('includes malformed keys in audit as a blocker, never silently skips them',async()=>{
  const fake=fakeDb(),ledger=createOriginalReviewLedger(lease.capability,account);
  expect(await auditOriginalReviewStartup({storage:localStorage,ledger:ledger.auditView})).toBe('clear');
  fake.data.set(['unexpected','key'],completion);
  expect(await auditOriginalReviewStartup({storage:localStorage,ledger:ledger.auditView})).toBe('blocked');
  expect(fake.data.size).toBe(1);
 });
 it('refuses another account key while the global audit still enumerates it',async()=>{
  const fake=fakeDb(),ledger=createOriginalReviewLedger(lease.capability,account),other='44444444-4444-4444-8444-444444444444';
  const otherKey=originalReviewReceiptKey(other,project);fake.data.set(otherKey,completion);
  await expect(ledger.read(otherKey)).rejects.toThrow('身份无效');
  expect(await ledger.compareAndSwap(otherKey,{present:true,value:completion},{present:false})).toBe('unknown');
  expect(await auditOriginalReviewStartup({storage:localStorage,ledger:ledger.auditView})).toBe('blocked');
  expect(fake.data.has(otherKey)).toBe(true);
 });
 it('aborts an in-flight mutation on cancellation and retains prior data',async()=>{
  const fake=fakeDb(),abort=new AbortController(),ledger=createOriginalReviewLedger(lease.capability,account,abort.signal);
  fake.onPut(()=>abort.abort());expect(await ledger.compareAndSwap(key,{present:false},{present:true,value:completion})).toBe('unknown');
  expect(fake.data.has(key)).toBe(false);await expect(ledger.list()).rejects.toThrow('失效');
 });
 it('rejects forged, lost or wrong-project authority without writes',async()=>{
  const fake=fakeDb();expect(()=>createOriginalReviewLedger({} as never,account)).toThrow('凭证无效');
  const ledger=createOriginalReviewLedger(lease.capability,account);const wrong={...completion,receipt:{...receipt,projectId:account}};
  expect(await ledger.compareAndSwap(key,{present:false},{present:true,value:wrong})).toBe('unknown');
  await lease.release();expect(await ledger.compareAndSwap(key,{present:false},{present:true,value:completion})).toBe('unknown');expect(fake.data.size).toBe(0);
 });
 it('never accepts caller-supplied evidence or repeated attempts to change completed records',async()=>{
  const fake=fakeDb(),ledger=createOriginalReviewLedger(lease.capability,account);fake.data.set(key,completion);
  const swap=ledger.compareAndSwap as unknown as (...args:unknown[])=>Promise<string>;
  const forged={accountId:account,projectId:project,cloudVerified:true,lockHeld:true};
  const different={...completion,receipt:{...receipt,reviewId:'55555555-5555-4555-8555-555555555555'}};
  expect(await swap(key,{present:true,value:completion},{present:false},forged)).toBe('unknown');
  expect(await swap(key,{present:true,value:completion},{present:false},forged)).toBe('unknown');
  expect(await swap(key,{present:true,value:completion},{present:true,value:different},forged)).toBe('unknown');
  expect(fake.data.get(key)).toEqual(completion);
 });
});
