import { afterEach, expect, it, vi } from 'vitest';
import { LIBRARY_PENDING_KEY } from './library-pending';
import { VERSION_HISTORY_PENDING_KEY } from './version-history-pending';
import { browserLocalWriteLeaseManager } from './local-write-lease';
import { RESTORE_JOURNAL_MARKER, RESTORE_JOURNAL_NAMESPACE } from './restore-journal';
import { auditRestoreStartup, RESTORE_COMPLETION_LEDGER_NAMESPACE } from './restore-startup-audit';
function storage():Storage {const values=new Map<string,string>();return {get length(){return values.size;},clear(){values.clear();},key(i){return [...values.keys()][i]??null;},getItem(k){return values.get(k)??null;},setItem(k,v){values.set(k,String(v));},removeItem(k){values.delete(k);}};}
function locks() {let held=false;return {request(_name:string,_options:unknown,callback:(lock:unknown)=>Promise<unknown>){if(held)return callback(null);held=true;return callback({name:'writer'}).finally(()=>{held=false;});}} as unknown as LockManager;}
function database(keys:unknown[], options:{fail?:boolean;hang?:boolean}={}) {
  const open=vi.fn(()=>{const db={close(){},transaction(){
    const tx={oncomplete:null as (()=>void)|null,onerror:null as (()=>void)|null,onabort:null as (()=>void)|null,error:null,abort(){queueMicrotask(()=>tx.onabort?.());},
      objectStore(){return {openKeyCursor(){
        const request:{result:{key:unknown;continue():void}|null;onsuccess:(()=>void)|null}={result:null,onsuccess:null};let index=0;
        const advance=()=>{if(options.fail){tx.abort();return;}if(index>=keys.length){request.result=null;request.onsuccess?.();queueMicrotask(()=>tx.oncomplete?.());return;}
          request.result={key:keys[index++],continue(){queueMicrotask(advance);}};request.onsuccess?.();};
        if(!options.hang)queueMicrotask(advance);return request;}};},
    };return tx;}};
    const req:{result:typeof db;onsuccess:(()=>void)|null;onerror:null;onblocked:null;onupgradeneeded:null;error:null}={result:db,onsuccess:null,onerror:null,onblocked:null,onupgradeneeded:null,error:null};queueMicrotask(()=>req.onsuccess?.());return req;});
  return {open};
}
function setup(keys:unknown[]=[],options:{fail?:boolean;hang?:boolean}={}) {const local=storage(),lock=locks(),idb=database(keys,options);vi.stubGlobal('window',{localStorage:local});vi.stubGlobal('navigator',{locks:lock});vi.stubGlobal('indexedDB',idb);return {local,lock,idb};}
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
it('即便标记和账本都为空，写入者未全部接入时仍不放行',async()=>{
  const f=setup([['other','x']]);
  expect(await auditRestoreStartup()).toEqual({status:'blocked',reason:'writers-not-integrated'});
  let acquired=false;await f.lock.request('scendance:local-activity:writer:v1',{mode:'exclusive',ifAvailable:true},async lock=>{acquired=!!lock;});expect(acquired).toBe(true);
});
it.each([JSON.stringify({version:1,id:'pending'}),'corrupt'])('existing or corrupt marker %s never mounts',async marker=>{
  const f=setup();f.local.setItem(RESTORE_JOURNAL_MARKER,marker);const result=await auditRestoreStartup();expect(result.status).toBe('blocked');expect(f.idb.open).not.toHaveBeenCalled();
});
it.each([
  [[RESTORE_JOURNAL_NAMESPACE,'orphan'], 'journal'],
  [[RESTORE_COMPLETION_LEDGER_NAMESPACE,'orphan'], 'ledger'],
  [[RESTORE_JOURNAL_NAMESPACE], 'unreadable'],
  [[RESTORE_COMPLETION_LEDGER_NAMESPACE,42], 'unreadable'],
  [RESTORE_JOURNAL_NAMESPACE, 'unreadable'],
  [['restore-journal-v2','future'], 'unreadable'],
  [['restore-completion-ledger-v2','future'], 'unreadable'],
] as const)('orphan or malformed key %j blocks with %s',async(key,reason)=>{
  setup([key]);expect(await auditRestoreStartup()).toEqual({status:'blocked',reason});
});
it('IDB scan failure and unreadable local storage fail closed',async()=>{
  setup([],{fail:true});expect(await auditRestoreStartup()).toEqual({status:'blocked',reason:'unreadable'});
  vi.unstubAllGlobals();setup();Object.defineProperty(window,'localStorage',{get(){throw new Error('blocked');}});
  expect(await auditRestoreStartup()).toEqual({status:'blocked',reason:'unreadable'});
});
it('existing same-tab editing lease blocks startup audit, rather than sharing the lock',async()=>{
  setup();const writer=await browserLocalWriteLeaseManager.acquire();
  expect(await auditRestoreStartup()).toEqual({status:'blocked',reason:'busy'});await writer.release();
});

it.each(['{bad-json', JSON.stringify({version:1}), ''])('方案库待核对记录存在或损坏时冻结：%s',async value=>{
  const {local,idb}=setup();local.setItem(LIBRARY_PENDING_KEY,value);
  expect(await auditRestoreStartup()).toEqual({status:'blocked',reason:'library-pending'});
  expect(idb.open).not.toHaveBeenCalled();
  local.removeItem(LIBRARY_PENDING_KEY);
  expect(await auditRestoreStartup()).toEqual({status:'blocked',reason:'writers-not-integrated'});
});
it('方案库标记不可读或账本枚举期间出现标记时冻结',async()=>{
  const {local}=setup();const original=local.getItem.bind(local);
  vi.spyOn(local,'getItem').mockImplementation(key=>{if(key===LIBRARY_PENDING_KEY)throw new Error('unreadable');return original(key);});
  expect(await auditRestoreStartup()).toEqual({status:'blocked',reason:'unreadable'});
  vi.unstubAllGlobals();vi.restoreAllMocks();
  const next=setup();const read=next.local.getItem.bind(next.local);let reads=0;
  vi.spyOn(next.local,'getItem').mockImplementation(key=>key===LIBRARY_PENDING_KEY&&++reads===2?'late marker':read(key));
  expect(await auditRestoreStartup()).toEqual({status:'blocked',reason:'library-pending'});
});

it.each(['', 'broken', '{"version":1}'])('版本历史待核对标记存在即冻结 %s',async value=>{
  const {local}=setup();local.setItem(VERSION_HISTORY_PENDING_KEY,value);
  expect(await auditRestoreStartup()).toEqual({status:'blocked',reason:'history-pending'});
  local.removeItem(VERSION_HISTORY_PENDING_KEY);
  expect(await auditRestoreStartup()).toEqual({status:'blocked',reason:'writers-not-integrated'});
});
it('读取版本历史标记异常时冻结',async()=>{
  const {local}=setup(),read=local.getItem.bind(local);
  vi.spyOn(local,'getItem').mockImplementation(key=>{if(key===VERSION_HISTORY_PENDING_KEY)throw new Error('unreadable');return read(key);});
  expect(await auditRestoreStartup()).toEqual({status:'blocked',reason:'unreadable'});
});
