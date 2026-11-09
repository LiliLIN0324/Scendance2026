import { localWriteCapabilityGuard, type LocalWriteCapability } from './local-write-lease';
import { isOriginalReviewReceipt, originalReviewReceiptKey } from './original-review-commit';
import type { OriginalReviewCompletion, OriginalReviewCompletionStore } from './original-review-completion';
import { sameRecoveryFormValue } from './recovery-form-value';

type Snapshot = {present:false}|{present:true;value:OriginalReviewCompletion};
const dbName='scendance-original-review-ledger-v1', storeName='records';
const keyPattern=/^scendance:original-review:v1:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;
function validValue(key:string,value:unknown):value is OriginalReviewCompletion {
  try {
    if(!sameRecoveryFormValue(value,value)||!value||typeof value!=='object'||Array.isArray(value))return false;
    const v=value as OriginalReviewCompletion, match=keyPattern.exec(key);
    return !!match&&Object.keys(v).sort().join(',')==='appliedRevision,receipt,version'&&v.version===1&&isOriginalReviewReceipt(v.receipt)&&v.receipt.projectId.toLowerCase()===match[2]&&v.appliedRevision===v.receipt.baseRevision+1&&Number.isSafeInteger(v.appliedRevision);
  }catch{return false;}
}

/** Isolated prototype; account identity and project lock must be verified by its future caller. */
export function createOriginalReviewLedger(capability:LocalWriteCapability,accountId:string,signal?:AbortSignal) {
  const guard=localWriteCapabilityGuard(capability);
  // Validate account even before any storage access.
  originalReviewReceiptKey(accountId,accountId);
  const account=accountId.toLowerCase();
  function check(){guard.assertStillHeld();if(signal?.aborted||guard.signal.aborted)throw new Error('账本操作已失效。');}
  function keyCheck(key:string){const m=keyPattern.exec(key);if(!m||m[1]!==account)throw new Error('账本身份无效。');}
  async function open():Promise<IDBDatabase>{check();return new Promise((resolve,reject)=>{
    const req=indexedDB.open(dbName,1);let done=false;
    req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains(storeName))req.result.createObjectStore(storeName);};
    req.onerror=()=>{done=true;reject(req.error??new Error('账本不可读取。'));};
    req.onblocked=()=>{done=true;reject(new Error('账本被占用。'));};
    req.onsuccess=()=>{if(done){req.result.close();return;}try{check();done=true;resolve(req.result);}catch(e){req.result.close();reject(e);}};
  });}
  async function transact<T>(mode:IDBTransactionMode,run:(s:IDBObjectStore,set:(v:T)=>void)=>void):Promise<T>{
    const db=await open();try{return await new Promise<T>((resolve,reject)=>{
      let value:T;let tx:IDBTransaction;
      try{check();tx=db.transaction(storeName,mode,{durability:'strict'});}catch(e){reject(e);return;}
      const abort=()=>{try{tx.abort();}catch{}};
      signal?.addEventListener('abort',abort);guard.signal.addEventListener('abort',abort);
      const cleanup=()=>{signal?.removeEventListener('abort',abort);guard.signal.removeEventListener('abort',abort);};
      tx.oncomplete=()=>{cleanup();try{check();resolve(value);}catch(e){reject(e);}};
      tx.onabort=tx.onerror=()=>{cleanup();reject(tx.error??new Error('账本内容无法核验或操作已失效。'));};
      try{check();run(tx.objectStore(storeName),v=>{check();value=v;});}catch(e){abort();reject(e);}
    });}finally{db.close();}
  }
  async function read(key:string):Promise<Snapshot>{keyCheck(key);return transact('readonly',(store,set)=>{
    const exists=store.getKey(key);exists.onsuccess=()=>{try{check();if(exists.result===undefined){set({present:false});return;}const get=store.get(key);get.onsuccess=()=>{try{check();if(!validValue(key,get.result))throw new Error('账本内容无法核验。');set({present:true,value:get.result});}catch{store.transaction.abort();}};}catch{store.transaction.abort();}};
  });}
  async function list():Promise<Array<{key:string;value:unknown}>>{return transact('readonly',(store,set)=>{
    const entries:Array<{key:string;value:unknown}>=[],cursor=store.openCursor();cursor.onsuccess=()=>{try{check();const c=cursor.result;if(!c){set(entries);return;}if(typeof c.key!=='string'||!validValue(c.key,c.value))throw new Error('账本内容无法核验。');entries.push({key:c.key,value:c.value});c.continue();}catch{store.transaction.abort();}};
  });}
  async function compareAndSwap(key:string,expected:Snapshot,desired:Snapshot):Promise<'applied'|'conflict'|'unknown'>{try{
    keyCheck(key);check();if((expected.present&&!validValue(key,expected.value))||(desired.present&&!validValue(key,desired.value)))return 'unknown';
    // A normal workspace lease alone cannot authorize erasing or replacing
    // completion evidence. Keep it until the lock-bound cloud verifier owns a
    // non-forgeable scoped authorization in the same trust boundary.
    if(expected.present||!desired.present)return 'unknown';
    return await transact('readwrite',(store,set)=>{const exists=store.getKey(key);exists.onsuccess=()=>{try{check();const present=exists.result!==undefined;if(!present){write();return;}const get=store.get(key);get.onsuccess=()=>{try{check();if(!validValue(key,get.result))throw new Error();set('conflict');}catch{store.transaction.abort();}};}catch{store.transaction.abort();}};
      function write(){check();if(desired.present)store.put(desired.value,key);else store.delete(key);set('applied');}
    });
  }catch{return 'unknown';}}
  const auditView:OriginalReviewCompletionStore={get:async key=>{const item=await read(key);return item.present?item.value:null;},list,put:async()=>{throw new Error('账本写入尚未接入受控流程。');},delete:async()=>{throw new Error('账本清理尚未接入受控流程。');}};
  return {read,list,compareAndSwap,auditView};
}
