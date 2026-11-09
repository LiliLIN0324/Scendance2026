import { withSourceScopeNotice } from './source-scope-notices';
import { assertRecoveryCapability, assertRecoveryStorageGrant, localWriteCapabilityGuard, recoveryCapabilitySignal, type LocalWriteCapability, type RecoveryCapability } from './local-write-lease';

/** Private image blobs and reconstruction form state live in IndexedDB, never localStorage. */
export type SourceKind = 'floorplan' | 'photo';
export interface StoredSource {
  id: string; scope: string; name: string; kind: SourceKind; width: number; height: number;
  blob?: Blob; assetId?: string; uploadedKind?: SourceKind;
}
export interface SourceScopeSnapshot {
  scope: string;
  sources: StoredSource[];
  form: unknown;
}
type FlushSourceCallback = (guard?: SourceWriteGuard) => Promise<void>;
const sourceFlushers = new Map<string, Set<FlushSourceCallback>>();
/** Register live editor state that must reach IndexedDB before a project scope changes. */
export function registerSourceFlush(scope: string, flush: FlushSourceCallback): () => void {
  const callbacks=sourceFlushers.get(scope)??new Set<FlushSourceCallback>();
  callbacks.add(flush);sourceFlushers.set(scope,callbacks);
  return ()=>{callbacks.delete(flush);if(callbacks.size===0)sourceFlushers.delete(scope);};
}
export async function flushSourceScope(scope: string, guard?: SourceWriteGuard): Promise<void> {
  return ordinaryWrite(guard,async sessionGuard=>{
    const settled=await Promise.allSettled([...sourceFlushers.get(scope)??[]].map(flush=>Promise.resolve().then(()=>flush(sessionGuard))));
    const failed=settled.find(result=>result.status==='rejected');
    if(failed?.status==='rejected')throw failed.reason;
    checkWriteGuard(sessionGuard);
  });
}
export interface SourceEditorLease { ready: Promise<void>; readonly acquired: boolean; release(): Promise<void> }
const sourceEditors = new Map<string, Set<SourceEditorLease>>();
const sourceLockName = (scope: string) => `scendance:source-editor:${scope}`;
/** Live editors hold shared native locks, including editors in other tabs. */
export function registerSourceEditor(scope: string): SourceEditorLease {
  let releaseHold!: () => void, signalReady!: () => void, rejectReady!: (error: unknown) => void;
  const hold = new Promise<void>(resolve => { releaseHold = resolve; });
  const ready = new Promise<void>((resolve,reject) => { signalReady = resolve;rejectReady=reject; });
  const abort = new AbortController();
  let released = false, acquired = false;
  const request = typeof navigator !== 'undefined' && navigator.locks
    ? navigator.locks.request(sourceLockName(scope), { mode: 'shared', signal: abort.signal }, async () => { if(released)return;acquired=true;signalReady();await hold; }).catch(rejectReady)
    : Promise.resolve().then(()=>{if(!released){acquired=true;signalReady();}});
  // Keep acquisition errors observable by callers without an unhandled rejection.
  void ready.catch(() => {});
  const lease: SourceEditorLease = { ready, get acquired(){return acquired&&!released;}, async release() {
    if (released) return request.catch(() => {});
    released = true;if(!acquired)rejectReady(new Error('本地资料编辑页面已切换，已取消本次保存。'));releaseHold();abort.abort();
    const editors = sourceEditors.get(scope); editors?.delete(lease);
    if (!editors?.size) sourceEditors.delete(scope);
    await request.catch(() => {});
  } };
  const editors = sourceEditors.get(scope) ?? new Set<SourceEditorLease>();
  editors.add(lease); sourceEditors.set(scope, editors);
  return lease;
}
/** Refuse an occupied scope immediately; never restore without cross-tab protection. */
export async function withSourceRestoreLock<T>(scopes: string[], restore: () => Promise<T>): Promise<T> {
  if (typeof navigator === 'undefined' || !navigator.locks) throw new Error('此浏览器无法保护其他页面的本地资料，请使用支持 Web Locks 的浏览器恢复备份。');
  const unique = [...new Set(scopes)].sort();
  async function acquire(index: number): Promise<T> {
    const scope = unique[index];
    if (scope === undefined) return restore();
    if (sourceEditors.get(scope)?.size) throw new Error('该项目正被另一编辑页面使用，请关闭那个页面后重试恢复。');
    return navigator.locks.request(sourceLockName(scope), { mode: 'exclusive', ifAvailable: true }, async lock => {
      if (!lock) throw new Error('该项目正被另一编辑页面使用，请关闭那个页面后重试恢复。');
      return acquire(index + 1);
    });
  }
  return acquire(0);
}
export const SOURCE_DATABASE_NAME = 'scendance-source-images-v1';
const DATABASE = SOURCE_DATABASE_NAME;
/** 普通写入能力；与恢复专用 guard 分开构造，不以恢复租约替代普通租约。 */
export interface SourceWriteGuard { readonly kind: 'ordinary'; signal: AbortSignal; assertStillHeld(): void }
type TransactionGuard = { signal: AbortSignal; assertStillHeld(): void };
export type RecoveryTransactionGuard = TransactionGuard & { capability: RecoveryCapability };
function requireRecoveryGuard(guard: RecoveryTransactionGuard | undefined, kind:'form'|'source'|'source-v2'|'journal',key:unknown,expected?:unknown,desired?:unknown): asserts guard is RecoveryTransactionGuard {
  assertRecoveryCapability(guard?.capability);
  if (recoveryCapabilitySignal(guard.capability) !== guard.signal) throw new Error('恢复事务凭证与信号不匹配。');
  assertRecoveryStorageGrant(guard,kind,key,expected,desired);
  checkWriteGuard(guard);
}
function checkWriteGuard(guard?: TransactionGuard): void {
  guard?.assertStillHeld();
  if (guard?.signal.aborted) throw new Error('本机写入租约已失效。');
}
let sessionEnforced=false;
let sessionGuard: SourceWriteGuard | null=null;
let sessionAbort=new AbortController();
let ordinaryOperations=0;

/** Explicit activation only. Once enabled, losing or unbinding never returns to legacy mode. */
export function bindSourceWriteSession(capability: LocalWriteCapability): () => void {
  const next=localWriteCapabilityGuard(capability);
  if(ordinaryOperations){
    if(sessionEnforced){sessionAbort.abort();sessionGuard=null;sessionAbort=new AbortController();}
    throw new Error('本机资料写入仍在结束，请等待后再绑定编辑权。');
  }
  sessionAbort.abort();sessionAbort=new AbortController();sessionEnforced=true;sessionGuard=next;
  const bound=sessionAbort;
  return ()=>{if(sessionAbort!==bound)return;bound.abort();sessionGuard=null;sessionAbort=new AbortController();};
}

/** Capture the binding at operation creation, and abort every pending transaction on unbind. */
async function ordinaryWrite<T>(explicit: TransactionGuard | undefined, run:(guard:SourceWriteGuard|undefined)=>Promise<T>):Promise<T> {
  if(sessionEnforced&&!sessionGuard)throw new Error('本机资料编辑权不可用，写入已暂停。');
  const bound=sessionGuard,epoch=sessionAbort;
  const abort=new AbortController();
  const sources=[...(bound?[bound.signal,epoch.signal]:[]),...(explicit?[explicit.signal]:[])];
  const cancel=()=>abort.abort();
  for(const signal of sources){if(signal.aborted)cancel();else signal.addEventListener('abort',cancel,{once:true});}
  const effective:SourceWriteGuard|undefined = bound ? {kind:'ordinary',signal:abort.signal,assertStillHeld(){
    if(sessionGuard!==bound||sessionAbort!==epoch)throw new Error('本机资料编辑权已变化。');
    checkWriteGuard(bound);checkWriteGuard(explicit);
  }} : explicit ? {kind:'ordinary',signal:abort.signal,assertStillHeld(){checkWriteGuard(explicit);}} : undefined;
  // Preserve legacy callback identity when the session was never activated.
  const selected=!sessionEnforced&&explicit ? explicit as SourceWriteGuard : effective;
  ordinaryOperations++;
  try {checkWriteGuard(selected);return await run(selected);}
  finally {ordinaryOperations--;for(const signal of sources)signal.removeEventListener('abort',cancel);}
}
/** Compound keys cannot collide with a legacy form whose imported project ID is an arbitrary string. */
export type SourceFormKey = string | [string, string];
const sourceChangeKey = (scope: SourceFormKey) => JSON.stringify(scope);
const sourceListeners = new Map<string, Set<() => void>>();
const namespaceListeners = new Map<string, Set<() => void>>();
/** Read-only views refresh after the original owner has committed its form/images. */
export function subscribeSourceRecordChanges(scope: SourceFormKey, listener: () => void): () => void {
  const key = sourceChangeKey(scope), listeners = sourceListeners.get(key) ?? new Set<() => void>();
  listeners.add(listener); sourceListeners.set(key, listeners);
  return () => { listeners.delete(listener); if (!listeners.size) sourceListeners.delete(key); };
}
/** Lists watch a whole compound-key namespace: archives are written by whichever panel is open. */
export function subscribeSourceNamespace(namespace: string, listener: () => void): () => void {
  const listeners = namespaceListeners.get(namespace) ?? new Set<() => void>();
  listeners.add(listener); namespaceListeners.set(namespace, listeners);
  return () => { listeners.delete(listener); if (!listeners.size) namespaceListeners.delete(namespace); };
}
export function subscribeSourceChanges(scope: string, listener: () => void): () => void { return subscribeSourceRecordChanges(scope, listener); }
function changedSource(scope?: SourceFormKey): void {
  const notify = (listeners: Set<() => void> | undefined): void => {
    for (const listener of listeners ?? []) { try { listener(); } catch { /* A view cannot turn a committed save into a failed write. */ } }
  };
  for (const [key, listeners] of sourceListeners) if (scope === undefined || sourceChangeKey(scope) === key) notify(listeners);
  const namespace = scope === undefined ? undefined : Array.isArray(scope) ? scope[0] : undefined;
  if (scope === undefined) for (const listeners of namespaceListeners.values()) notify(listeners);
  else if (namespace) notify(namespaceListeners.get(namespace));
}
function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('浏览器未开放本地图片存储；本次图片仅在会话中保留。')); return; }
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      const images = request.result.createObjectStore('sources', { keyPath: 'id' });
      images.createIndex('scope', 'scope');
      request.result.createObjectStore('forms');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('本机资料存储无法打开。'));
  });
}
async function transact<T>(name: 'sources' | 'forms', mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>, guard?: SourceWriteGuard): Promise<T> {
  checkWriteGuard(guard);
  const db = await openDatabase();
  try { checkWriteGuard(guard); return await new Promise((resolve, reject) => {
    const transaction = db.transaction(name, mode);
    const abort = () => { try { transaction.abort(); } catch { /* Already finished. */ } };
    guard?.signal.addEventListener('abort', abort, { once: true });
    let result: T, failure: unknown, request: IDBRequest<T> | undefined;
    transaction.oncomplete = () => { guard?.signal.removeEventListener('abort', abort); resolve(result); };
    transaction.onerror = transaction.onabort = () => { guard?.signal.removeEventListener('abort', abort); reject(failure ?? transaction.error ?? request?.error ?? new Error('本机资料保存失败。')); };
    try {
      checkWriteGuard(guard);
      request = run(transaction.objectStore(name));
      request.onsuccess = () => {
        try { checkWriteGuard(guard); result = request!.result; }
        catch (error) { failure = error; abort(); }
      };
    } catch (error) { failure = error; abort(); }
  }); } finally { db.close(); }
}
export function listStoredSources(scope: string): Promise<StoredSource[]> { return transact('sources', 'readonly', store => store.index('scope').getAll(scope)); }
/** Read-only identity lookup for recovery preflight; does not authorize a write. */
export function readStoredSourceById(id: string): Promise<StoredSource | undefined> { return transact('sources', 'readonly', store => store.get(id)); }
export async function storeSource(source: StoredSource, guard?: SourceWriteGuard): Promise<void> { await ordinaryWrite(guard,current=>withSourceScopeNotice(source.scope,async()=>{await transact('sources', 'readwrite', store => store.put(source), current);},()=>!!current||sessionEnforced)); changedSource(source.scope); }
export async function deleteSource(id: string, guard?: SourceWriteGuard): Promise<void> { await ordinaryWrite(guard,current=>withSourceScopeNotice(undefined,async()=>{await transact('sources', 'readwrite', store => store.delete(id), current);},()=>!!current||sessionEnforced)); changedSource(); }
export function readSourceRecord<T>(scope: SourceFormKey): Promise<T | undefined> { return transact('forms', 'readonly', store => store.get(scope)); }
/** Only enumerate the requested compound-key namespace; legacy private forms stay outside this list. */
export async function listSourceRecords<T>(namespace: string): Promise<{ key: [string, string]; value: T }[]> {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction('forms', 'readonly');
      const request = transaction.objectStore('forms').openCursor();
      const records: { key: [string, string]; value: T }[] = [];
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        const key = cursor.key;
        if (Array.isArray(key) && key.length === 2 && key[0] === namespace && typeof key[1] === 'string') {
          records.push({ key: [namespace, key[1]], value: cursor.value as T });
        }
        cursor.continue();
      };
      transaction.oncomplete = () => resolve(records);
      transaction.onerror = transaction.onabort = () => reject(transaction.error ?? request.error ?? new Error('本机活动列表读取失败。'));
    });
  } finally { db.close(); }
}

/** Strict discovery for recovery: malformed keys in the reserved namespace block the entire result. */
export async function listExactSourceNamespace(namespace:string,limit=100,maxArchiveTextChars=120*1024*1024):Promise<Array<{key:[string,string];value:unknown}>> {
  if(!namespace.trim()||!Number.isSafeInteger(limit)||limit<1||limit>1000||!Number.isSafeInteger(maxArchiveTextChars)||maxArchiveTextChars<1||maxArchiveTextChars>120*1024*1024)throw new Error('本机资料范围无效。');
  const db=await openDatabase();
  try{return await new Promise((resolve,reject)=>{
    const tx=db.transaction('forms','readonly'),records:Array<{key:[string,string];value:unknown}>=[];let failure:unknown,totalChars=0;
    tx.oncomplete=()=>resolve(records);tx.onerror=tx.onabort=()=>reject(failure??tx.error??new Error('本机归档无法完整枚举。'));
    try{
      const cursor=tx.objectStore('forms').openCursor();
      cursor.onsuccess=()=>{try{
        const item=cursor.result;if(!item)return;
        const key=item.key;
        if((typeof key==='string'&&(key===namespace||key.startsWith(`${namespace}:`)))||(Array.isArray(key)&&key[0]===namespace)){
          if(!Array.isArray(key)||key.length!==2||typeof key[1]!=='string'||!key[1].trim()||key[1].length>128||records.length>=limit)throw new Error('本机归档范围损坏或超过核对上限。');
          const value=item.value as {backupJson?:unknown}|null;
          if(value&&typeof value==='object'&&typeof value.backupJson==='string'){totalChars+=value.backupJson.length;if(totalChars>maxArchiveTextChars)throw new Error('本机归档超过一次核对上限，请保留原资料。');}
          records.push({key:[namespace,key[1]],value:item.value});
        }
        item.continue();
      }catch(error){failure=error;try{tx.abort();}catch{/* already ended */}}};
    }catch(error){failure=error;try{tx.abort();}catch{/* already ended */}}
  });}finally{db.close();}
}
/** Distinguish absent keys from present records whose value is undefined. */
export type SourceRecordSnapshot = { present: false } | { present: true; value: unknown };
export async function readSourceRecordSnapshot(scope: SourceFormKey): Promise<SourceRecordSnapshot> {
  const db = await openDatabase();
  try { return await new Promise((resolve, reject) => {
    const transaction = db.transaction('forms', 'readonly'), store = transaction.objectStore('forms');
    const presence = store.getKey(scope), value = store.get(scope);
    transaction.oncomplete = () => resolve(presence.result === undefined ? {present:false} : {present:true,value:value.result});
    transaction.onerror = transaction.onabort = () => reject(transaction.error ?? new Error('本机资料读取失败。'));
  }); } finally { db.close(); }
}
/** CAS on both presence and value inside one IDB transaction. */
export async function compareAndSetSourceRecord(scope: SourceFormKey, expected: SourceRecordSnapshot, desired: SourceRecordSnapshot,
  equal: (left: SourceRecordSnapshot, right: SourceRecordSnapshot) => boolean, guard: RecoveryTransactionGuard): Promise<void> {
  requireRecoveryGuard(guard,'form',scope,expected,desired);
  const db = await openDatabase();
  try {
    requireRecoveryGuard(guard,'form',scope,expected,desired);
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('forms', 'readwrite'), store = transaction.objectStore('forms');
      let failure: unknown, remaining=2;
      const abort = (error:unknown) => { failure=error; try {transaction.abort();} catch { /* Already finished. */ } };
      const onAbort = () => abort(new Error('本机恢复租约已失效。'));
      guard.signal.addEventListener('abort', onAbort, {once:true});
      transaction.oncomplete = () => { guard.signal.removeEventListener('abort', onAbort); resolve(); };
      transaction.onerror = transaction.onabort = () => { guard.signal.removeEventListener('abort', onAbort); reject(failure ?? transaction.error ?? new Error('本机资料保存失败。')); };
      if (guard.signal.aborted) {onAbort();return;}
      const presence=store.getKey(scope), value=store.get(scope);
      const ready=() => {
        try {
          requireRecoveryGuard(guard,'form',scope,expected,desired);
          if (--remaining) return;
          const current:SourceRecordSnapshot=presence.result===undefined?{present:false}:{present:true,value:value.result};
          if(!equal(current,expected)) throw new Error('本机资料已有新变化，不能覆盖。');
          requireRecoveryGuard(guard,'form',scope,expected,desired);
          const write=desired.present?store.put(desired.value,scope):store.delete(scope);
          write.onsuccess=()=>{try{requireRecoveryGuard(guard,'form',scope,expected,desired);}catch(error){abort(error);}};
        } catch(error){abort(error);}
      };
      presence.onsuccess=ready;value.onsuccess=ready;
    });
    changedSource(scope);
  } finally { db.close(); }
}
export function readSourceForm<T>(scope: string): Promise<T | undefined> { return readSourceRecord(scope); }
export async function storeSourceForm(scope: string, value: unknown, guard?: SourceWriteGuard): Promise<void> { await ordinaryWrite(guard,current=>withSourceScopeNotice(scope,async()=>{await transact('forms', 'readwrite', store => store.put(value, scope), current);},()=>!!current||sessionEnforced)); changedSource(scope); }

/** Immutable ordinary record: IndexedDB add rejects existing keys, including stored undefined. */
export async function addSourceRecord(scope:SourceFormKey,value:unknown,guard:SourceWriteGuard):Promise<void> {
  if(Array.isArray(scope)&&(scope[0]==='restore-journal-v1'||scope[0]==='restore-completion-ledger-v1'))throw new Error('恢复记录只能通过受限恢复流程修改。');
  await ordinaryWrite(guard,current=>withSourceScopeNotice(typeof scope==='string'?scope:undefined,async()=>{
    await transact('forms','readwrite',store=>store.add(value,scope),current);
  },()=>true));
  changedSource(scope);
}
/** Read and update within one native transaction so concurrent appenders cannot overwrite each other. */
export async function updateSourceForm<T>(scope: SourceFormKey, update: (current: unknown) => T, guard?: { signal: AbortSignal; assertStillHeld(): void }): Promise<T> {
  if(Array.isArray(scope)&&(scope[0]==='restore-journal-v1'||scope[0]==='restore-completion-ledger-v1'))
    throw new Error('恢复记录只能通过受限恢复流程修改。');
  return ordinaryWrite(guard,current=>withSourceScopeNotice(typeof scope==='string'?scope:undefined,()=>updateSourceFormInternal(scope,update,current),()=>!!current||sessionEnforced));
}

/** Reserved recovery-log namespace only; ordinary session authority is never used here. */
export async function updateRestoreJournalRecord<T>(id:string, update:(current:unknown)=>T, guard?:RecoveryTransactionGuard):Promise<T> {
  requireRecoveryGuard(guard,'journal',id);
  return updateSourceFormInternal(['restore-journal-v1',id],current=>{
    // A callback must not mutate the input in place and then present it as an unchanged snapshot.
    const freeze=(value:unknown,seen=new Set<object>()):void=>{
      if(!value||typeof value!=='object'||seen.has(value))return;
      seen.add(value);for(const child of Object.values(value))freeze(child,seen);Object.freeze(value);
    };
    freeze(current);
    const next=update(current);requireRecoveryGuard(guard,'journal',id,current,next);return next;
  },{signal:guard.signal,assertStillHeld:()=>requireRecoveryGuard(guard,'journal',id)});
}

async function updateSourceFormInternal<T>(scope: SourceFormKey, update: (current: unknown) => T, guard?: TransactionGuard): Promise<T> {
  const key: SourceFormKey = typeof scope === 'string' ? scope : [scope[0], scope[1]];
  guard?.assertStillHeld();
  if (guard?.signal.aborted) throw new Error('本机写入租约已失效。');
  const db = await openDatabase();
  try {
    guard?.assertStillHeld();
    if (guard?.signal.aborted) throw new Error('本机写入租约已失效。');
    const result = await new Promise<T>((resolve, reject) => {
    const transaction = db.transaction('forms', 'readwrite');
    const abort = () => { try { transaction.abort(); } catch { /* Already completed. */ } };
    guard?.signal.addEventListener('abort', abort, { once: true });
    if (guard?.signal.aborted) abort();
    const store = transaction.objectStore('forms');
    const request = store.get(key);
    let value: T, failure: unknown;
    request.onsuccess = () => {
      try {
        // Check inside the live transaction, not only before opening IndexedDB.
        guard?.assertStillHeld();
        if (guard?.signal.aborted) throw new Error('本机写入租约已失效。');
        value = structuredClone(update(request.result));
        guard?.assertStillHeld();
        if (guard?.signal.aborted) throw new Error('本机写入租约已失效。');
        const write = value === undefined ? store.delete(key) : store.put(value, key);
        write.onsuccess = () => {
          try { guard?.assertStillHeld(); if (guard?.signal.aborted) throw new Error('本机写入租约已失效。'); }
          catch (error) { failure = error; try { transaction.abort(); } catch { /* Already completed. */ } }
        };
      } catch (error) { failure = error; try { transaction.abort(); } catch { /* Already aborted. */ } }
    };
    transaction.oncomplete = () => { guard?.signal.removeEventListener('abort', abort); resolve(value); };
    transaction.onerror = transaction.onabort = () => {
      guard?.signal.removeEventListener('abort', abort);
      reject(failure ?? transaction.error ?? request.error ?? new Error('本机资料保存失败，原记录未改变。'));
    };
    });
    changedSource(key);
    return result;
  } finally { db.close(); }
}
export async function deleteSourceForm(scope: string, guard?: SourceWriteGuard): Promise<void> { await ordinaryWrite(guard,current=>withSourceScopeNotice(scope,async()=>{await transact('forms', 'readwrite', store => store.delete(scope), current);},()=>!!current||sessionEnforced)); changedSource(scope); }

/** Read images and their drawing form from the same native transaction. */
export async function readSourceScopeSnapshot(scope: string): Promise<SourceScopeSnapshot> {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(['sources', 'forms'], 'readonly');
      const images = transaction.objectStore('sources').index('scope').getAll(scope);
      const drawing = transaction.objectStore('forms').get(scope);
      let sources: StoredSource[] = [], form: unknown;
      images.onsuccess = () => { sources = images.result; };
      drawing.onsuccess = () => { form = drawing.result; };
      transaction.oncomplete = () => resolve({ scope, sources, form });
      transaction.onerror = transaction.onabort = () => reject(transaction.error ?? images.error ?? drawing.error ?? new Error('本机图纸资料读取失败。'));
    });
  } finally { db.close(); }
}

/** Compare structured-clone data without JSON dropping undefined, holes or unknown fields. */
async function sameSourceValue(left: unknown, right: unknown, seen = new WeakMap<object, WeakSet<object>>()): Promise<boolean> {
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  const tag = Object.prototype.toString.call(left);
  if (tag !== Object.prototype.toString.call(right)) return false;
  if (seen.get(left)?.has(right)) return true;
  const matches = seen.get(left) ?? new WeakSet<object>();
  matches.add(right); seen.set(left, matches);
  if (left instanceof Blob && right instanceof Blob) {
    if (left.size !== right.size || left.type !== right.type) return false;
    if (tag === '[object File]') {
      const a = left as File, b = right as File;
      if (a.name !== b.name || a.lastModified !== b.lastModified) return false;
    }
    const [a, b] = await Promise.all([left.arrayBuffer(), right.arrayBuffer()]);
    return sameSourceValue(a, b, seen);
  }
  if (left instanceof Date && right instanceof Date) return Object.is(left.getTime(), right.getTime());
  if (left instanceof RegExp && right instanceof RegExp) return left.source === right.source && left.flags === right.flags;
  if (left instanceof ArrayBuffer && right instanceof ArrayBuffer) {
    if (left.byteLength !== right.byteLength) return false;
    const a = new Uint8Array(left), b = new Uint8Array(right);
    return a.every((value, index) => value === b[index]);
  }
  if (ArrayBuffer.isView(left) && ArrayBuffer.isView(right)) {
    if (left.byteLength !== right.byteLength) return false;
    const a = new Uint8Array(left.buffer, left.byteOffset, left.byteLength);
    const b = new Uint8Array(right.buffer, right.byteOffset, right.byteLength);
    return a.every((value, index) => value === b[index]);
  }
  if (left instanceof Map && right instanceof Map) return sameSourceValue([...left], [...right], seen);
  if (left instanceof Set && right instanceof Set) return sameSourceValue([...left], [...right], seen);
  if (['[object Number]', '[object String]', '[object Boolean]', '[object BigInt]'].includes(tag)) {
    return Object.is(left.valueOf(), right.valueOf());
  }
  // An unsupported persisted type is never mistaken for an empty plain object.
  if (!['[object Object]', '[object Array]', '[object Error]'].includes(tag)) return false;
  if (left instanceof Error && right instanceof Error && left.name !== right.name) return false;
  const keys = Object.getOwnPropertyNames(left), otherKeys = Object.getOwnPropertyNames(right);
  if (keys.length !== otherKeys.length || keys.some(key => !Object.prototype.hasOwnProperty.call(right, key))) return false;
  for (const key of keys) {
    if (!await sameSourceValue((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key], seen)) return false;
  }
  return true;
}

/** Source array order is not persisted; every metadata field and each Blob byte is. */
export async function sameSourceScopeSnapshot(left: SourceScopeSnapshot, right: SourceScopeSnapshot): Promise<boolean> {
  const a = structuredClone(left), b = structuredClone(right);
  if (a.scope !== b.scope || a.sources.length !== b.sources.length) return false;
  const ordered = (sources: StoredSource[]) => [...sources].sort((first, second) => first.id < second.id ? -1 : first.id > second.id ? 1 : 0);
  return await sameSourceValue(ordered(a.sources), ordered(b.sources)) && await sameSourceValue(a.form, b.form);
}

/** V2 records whether the form key itself exists, even when its value is undefined. */
export interface SourceScopeSnapshotV2 { version:2; scope:string; sources:StoredSource[]; form:SourceRecordSnapshot }
export async function readSourceScopeSnapshotV2(scope:string):Promise<SourceScopeSnapshotV2> {
  if(typeof scope!=='string'||!scope.trim()||scope.length>128)throw new Error('图纸资料活动范围无效。');
  const db=await openDatabase();
  try{return await new Promise((resolve,reject)=>{
    const transaction=db.transaction(['sources','forms'],'readonly');
    const sources=transaction.objectStore('sources').index('scope').getAll(scope);
    const forms=transaction.objectStore('forms'),presence=forms.getKey(scope),value=forms.get(scope);
    transaction.oncomplete=()=>resolve({version:2,scope,sources:sources.result,form:presence.result===undefined?{present:false}:{present:true,value:value.result}});
    transaction.onerror=transaction.onabort=()=>reject(transaction.error??new Error('本机图纸资料读取失败。'));
  });}finally{db.close();}
}
function validateSourceScopeV2(scope:string,snapshot:SourceScopeSnapshotV2):void {
  if(typeof scope!=='string'||!scope.trim()||scope.length>128||!snapshot||snapshot.version!==2||snapshot.scope!==scope||!Array.isArray(snapshot.sources)
    ||Object.keys(snapshot).sort().join(',')!=='form,scope,sources,version')throw new Error('图纸快照缺少明确的版本或活动范围。');
  checkSourceSnapshotScope(scope,{scope,sources:snapshot.sources,form:undefined});
  const form=snapshot.form;
  if(!form||typeof form!=='object'||(form.present===false?Object.keys(form).length!==1
    :form.present===true?Object.keys(form).length!==2||!Object.hasOwn(form,'value'):true))throw new Error('图纸表单存在状态不明确，不能自动恢复。');
}
export async function sameSourceScopeSnapshotV2(left:SourceScopeSnapshotV2,right:SourceScopeSnapshotV2):Promise<boolean> {
  validateSourceScopeV2(left.scope,left);validateSourceScopeV2(right.scope,right);
  if(left.scope!==right.scope||left.sources.length!==right.sources.length||left.form.present!==right.form.present)return false;
  const ordered=(sources:StoredSource[])=>[...sources].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
  return await sameSourceValue(ordered(left.sources),ordered(right.sources))
    && (!left.form.present||!right.form.present||await sameSourceValue(left.form.value,right.form.value));
}

/**
 * Exact in-transaction CAS; Blob comparison keeps the same transaction alive.
 * This prototype is unreachable without a private source-v2 recovery grant.
 */
export async function restoreSourceScopeV2IfUnchanged(scope:string,expected:SourceScopeSnapshotV2,desired:SourceScopeSnapshotV2,
  guard:RecoveryTransactionGuard, timeoutMs=10_000):Promise<void> {
  const check=()=>requireRecoveryGuard(guard,'source-v2',scope,expected,desired);
  check();validateSourceScopeV2(scope,expected);validateSourceScopeV2(scope,desired);
  if(!Number.isFinite(timeoutMs)||timeoutMs<=0||timeoutMs>30_000)throw new Error('图纸核验时限无效。');
  const before=structuredClone(expected),next=structuredClone(desired),db=await openDatabase();
  try{check();await new Promise<void>((resolve,reject)=>{
    const transaction=db.transaction(['sources','forms'],'readwrite');
    let failure:unknown,finished=false, timer:ReturnType<typeof setTimeout>;
    const abort=(error:unknown)=>{if(finished)return;failure=error;try{transaction.abort();}catch{/* Already completed. */}};
    const onAbort=()=>abort(new Error('本机恢复租约已失效。'));
    guard.signal.addEventListener('abort',onAbort,{once:true});
    timer=setTimeout(()=>abort(new Error('图纸资料核验超时，原资料未改变。')),timeoutMs);
    const cleanup=()=>{finished=true;clearTimeout(timer);guard.signal.removeEventListener('abort',onAbort);};
    transaction.oncomplete=()=>{cleanup();resolve();};
    transaction.onerror=transaction.onabort=()=>{cleanup();reject(failure??transaction.error??new Error('图纸资料保存失败，原资料未改变。'));};
    if(guard.signal.aborted){onAbort();return;}
    const images=transaction.objectStore('sources'),forms=transaction.objectStore('forms');
    const sourceRequest=images.index('scope').getAll(scope),presence=forms.getKey(scope),value=forms.get(scope);
    let pending=3;
    const checkedWrite=(make:()=>IDBRequest)=>{check();const write=make();write.onsuccess=()=>{try{check();}catch(error){abort(error);}};};
    const compare=()=>{
      const current:SourceScopeSnapshotV2={version:2,scope,sources:sourceRequest.result,form:presence.result===undefined?{present:false}:{present:true,value:value.result}};
      let outcome:'waiting'|'equal'|'different'|'failed'='waiting',comparisonError:unknown;
      void sameSourceScopeSnapshotV2(current,before).then(equal=>{outcome=equal?'equal':'different';},error=>{comparisonError=error;outcome='failed';});
      const pump=()=>{
        try{check();const keepalive=forms.getKey(scope);keepalive.onsuccess=()=>{
          try{
            check();if(outcome==='waiting'){pump();return;}
            if(outcome==='failed')throw comparisonError;
            if(outcome==='different')throw new Error('图纸资料已有新变化，不能覆盖。');
            let remaining=next.sources.length;
            const writeAll=()=>{
              try{
                for(const source of current.sources)checkedWrite(()=>images.delete(source.id));
                for(const source of next.sources)checkedWrite(()=>images.put(source));
                checkedWrite(()=>next.form.present?forms.put(next.form.value,scope):forms.delete(scope));
              }catch(error){abort(error);}
            };
            for(const source of next.sources){check();const existing=images.get(source.id);existing.onsuccess=()=>{
              try{check();if(existing.result!==undefined&&existing.result.scope!==scope)throw new Error('图纸编号已被另一个活动使用。');if(--remaining===0)writeAll();}
              catch(error){abort(error);}
            };}
            if(!remaining)writeAll();
          }catch(error){abort(error);}
        };}catch(error){abort(error);}
      };
      pump();
    };
    const ready=()=>{try{check();if(--pending===0)compare();}catch(error){abort(error);}};
    sourceRequest.onsuccess=ready;presence.onsuccess=ready;value.onsuccess=ready;
  });changedSource(scope);}finally{db.close();}
}

function checkSourceSnapshotScope(scope: string, snapshot: SourceScopeSnapshot): void {
  if (snapshot.scope !== scope || snapshot.sources.some(source => source.scope !== scope)) {
    throw new Error('图纸资料属于另一个活动，未恢复。');
  }
  const ids = snapshot.sources.map(source => source.id);
  if (ids.some(id => typeof id !== 'string' || !id.trim()) || new Set(ids).size !== ids.length) {
    throw new Error('图纸资料编号缺失或重复，未恢复。');
  }
}

/**
 * Caller MUST hold withSourceRestoreLock for this scope through comparison,
 * replacement, readback and any compensation. Blob comparison cannot keep an
 * IDB transaction alive. The exclusive editor lock protects that read/write gap.
 * Resolves only after commit; does not read back. Caller performs readback after
 * recording that this write committed, so a read failure cannot masquerade as a
 * failed write. Images and drawing form change atomically; other form keys stay.
 */
export async function restoreSourceScopeIfUnchanged(scope: string, expected: SourceScopeSnapshot,
  desired: SourceScopeSnapshot, check: () => void = () => {}, guard?: RecoveryTransactionGuard): Promise<void> {
  requireRecoveryGuard(guard,'source',scope,expected,desired);
  const checkBoth = () => { check(); requireRecoveryGuard(guard,'source',scope,expected,desired); };
  const cancellableRead = async <T>(work: Promise<T>): Promise<T> => {
    if (!guard) return work;
    if (guard.signal.aborted) throw new Error('本机恢复租约已失效。');
    let abort!: () => void;
    const cancelled = new Promise<never>((_resolve, reject) => { abort = () => reject(new Error('本机恢复租约已失效。')); guard.signal.addEventListener('abort', abort, { once: true }); });
    try { return await Promise.race([work, cancelled]); } finally { guard.signal.removeEventListener('abort', abort); }
  };
  const before = structuredClone(expected), next = structuredClone(desired);
  checkSourceSnapshotScope(scope, before); checkSourceSnapshotScope(scope, next);
  checkBoth();
  const current = await cancellableRead(readSourceScopeSnapshot(scope));
  if (!await cancellableRead(sameSourceScopeSnapshot(current, before))) throw new Error('图纸资料已有新变化，不能覆盖较新的记录。');
  checkBoth();
  const db = await openDatabase();
  try {
    checkBoth();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(['sources', 'forms'], 'readwrite');
      let failure: unknown, remaining = next.sources.length;
      const abort = (error: unknown) => { failure = error; try { transaction.abort(); } catch { /* Already finished. */ } };
      const abortSignal = () => abort(new Error('本机恢复租约已失效。'));
      guard?.signal.addEventListener('abort', abortSignal, { once: true });
      transaction.oncomplete = () => { guard?.signal.removeEventListener('abort', abortSignal); resolve(); };
      transaction.onerror = transaction.onabort = () => { guard?.signal.removeEventListener('abort', abortSignal); reject(failure ?? transaction.error ?? new Error('本机图纸资料保存失败，原资料未改变。')); };
      if (guard?.signal.aborted) { abortSignal(); return; }
      const images = transaction.objectStore('sources'), forms = transaction.objectStore('forms');
      const replace = () => {
        try {
          checkBoth();
          for (const source of current.sources) { checkBoth(); images.delete(source.id); }
          for (const source of next.sources) { checkBoth(); images.put(source); }
          checkBoth();
          const last = next.form === undefined ? forms.delete(scope) : forms.put(next.form, scope);
          last.onsuccess = () => { try { checkBoth(); } catch (error) { abort(error); } };
        } catch (error) { abort(error); }
      };
      for (const source of next.sources) {
        const request = images.get(source.id);
        request.onsuccess = () => {
          try {
            checkBoth();
            if (failure !== undefined) return;
            if (request.result !== undefined && request.result.scope !== scope) throw new Error('图纸编号已被另一个活动使用，原图纸未改变。');
            if (--remaining === 0) replace();
          } catch (error) { abort(error); }
        };
      }
      if (remaining === 0) replace();
    });
    changedSource(scope);
  } finally { db.close(); }
}

/** A suggestion only; users explicitly correct it before identification. No image measurements inferred. */
export function suggestSourceKind(name: string, pixels?: Uint8ClampedArray): SourceKind {
  if (/(平面|图纸|户型|floor.?plan|blueprint|drawing|cad)/i.test(name)) return 'floorplan';
  if (pixels?.length) {
    let paper = 0, ink = 0, colored = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
      if (Math.min(r, g, b) > 230) paper++;
      if (Math.max(r, g, b) < 90) ink++;
      if (Math.max(r, g, b) - Math.min(r, g, b) > 45) colored++;
    }
    const total = pixels.length / 4;
    if (paper / total > 0.65 && ink / total > 0.005 && colored / total < 0.12) return 'floorplan';
  }
  return 'photo';
}
export interface ImagePoint { x: number; z: number }
/** Convert object-fit:contain clicks to original-image pixels. Letterbox clicks are rejected. */
export function containedImagePoint(clientX: number, clientY: number, rect: { left: number; top: number; width: number; height: number }, imageWidth: number, imageHeight: number): ImagePoint | null {
  if (![rect.width, rect.height, imageWidth, imageHeight].every(value => Number.isFinite(value) && value > 0)) return null;
  const scale = Math.min(rect.width / imageWidth, rect.height / imageHeight);
  const x = (clientX - rect.left - (rect.width - imageWidth * scale) / 2) / scale;
  const z = (clientY - rect.top - (rect.height - imageHeight * scale) / 2) / scale;
  if (x < 0 || z < 0 || x > imageWidth || z > imageHeight) return null;
  return { x, z };
}
export function parseDimensionText(text: string): { label: string; valueMeters: number; kind: 'width' | 'depth' | 'height' | 'wall' | 'distance' }[] {
  return [...text.matchAll(/([^，,；;\n。]*?)(\d+(?:\.\d+)?)\s*(毫米|厘米|米|mm|cm|m)(?![a-z])/gi)].map(match => {
    const label = match[1].trim().replace(/[:：=]$/, '') || '长度';
    const unit = match[3].toLowerCase();
    return { label, valueMeters: Number(match[2]) * (['厘米', 'cm'].includes(unit) ? .01 : ['毫米', 'mm'].includes(unit) ? .001 : 1),
      kind: (/总宽|场地宽/.test(label) ? 'width' : /总长|总深|场地长/.test(label) ? 'depth' : /墙高|层高|场地高/.test(label) ? 'height' : /墙/.test(label) ? 'wall' : 'distance') as 'width'|'depth'|'height'|'wall'|'distance' };
  }).filter(item => item.valueMeters > 0);
}

/** Copy a local draft's inputs when it receives a cloud project ID. Original inputs remain intact. */
export async function copySourceScope(previousScope: string, nextScope: string, guard?: SourceWriteGuard): Promise<void> {
  if(previousScope===nextScope)return;
  return ordinaryWrite(guard,current=>withSourceScopeNotice(nextScope,()=>copySourceScopeInternal(previousScope,nextScope,current),()=>!!current||sessionEnforced));
}
async function copySourceScopeInternal(previousScope: string, nextScope: string, guard?: SourceWriteGuard): Promise<void> {
  checkWriteGuard(guard);
  await flushSourceScope(previousScope,guard);
  checkWriteGuard(guard);
  const db=await openDatabase();
  try {
    checkWriteGuard(guard);
    await new Promise<void>((resolve,reject)=>{
      const transaction=db.transaction(['sources','forms'],'readwrite');
      const abortSignal=()=>{try{transaction.abort();}catch{/* Already finished. */}};
      guard?.signal.addEventListener('abort',abortSignal,{once:true});
      const images=transaction.objectStore('sources'),forms=transaction.objectStore('forms');
      const sourceImages=images.index('scope').getAll(previousScope);
      const destinationImages=images.index('scope').getAll(nextScope);
      const sourceForm=forms.get(previousScope),sourceBrief=forms.get(`${previousScope}:brief`);
      // getKey also detects an existing record whose value is undefined.
      const destinationForm=forms.getKey(nextScope),destinationBrief=forms.getKey(`${nextScope}:brief`);
      let remaining=6, failure:unknown;
      const abort=(error:unknown)=>{failure=error;abortSignal();};
      const trackedWrite=(make:()=>IDBRequest)=>{
        checkWriteGuard(guard);
        const request=make();
        request.onsuccess=()=>{try{checkWriteGuard(guard);}catch(error){abort(error);}};
      };
      const ready=()=>{
        try { checkWriteGuard(guard); } catch(error) { abort(error); return; }
        if(--remaining!==0)return;
        try {
          if(destinationImages.result.length || destinationForm.result!==undefined || destinationBrief.result!==undefined)
            throw new Error('目标项目已有场地资料或活动需求，已保留原资料，请核对后再复制。');
          const sources=sourceImages.result as StoredSource[];
          if(sources.some(source=>!source.blob))throw new Error('部分资料只有云端引用，无法复制到新项目。请先重新选择对应原图；原项目资料已保留。');
          const identities=new Map(sources.map(source=>[source.id,crypto.randomUUID()]));
          const form=sourceForm.result as Record<string,unknown>|undefined,brief=sourceBrief.result as unknown;
          const nextForm=form?{...form}:undefined;
          if(nextForm){
            for(const key of ['jobId','jobBase','jobInput','jobSources','jobMode','requestId','requestKey'])delete nextForm[key];
            if(Array.isArray(nextForm.constraints))nextForm.constraints=nextForm.constraints.map((d:Record<string,unknown>)=>({...d,...(typeof d.sourceAssetId==='string'&&identities.has(d.sourceAssetId)?{sourceAssetId:identities.get(d.sourceAssetId)}:{})}));
            const registration=nextForm.registration as {sourceId?:string}|undefined;
            if(registration?.sourceId)nextForm.registration={...registration,sourceId:identities.get(registration.sourceId)??registration.sourceId};
          }
          // add() rejects a random ID collision instead of overwriting any scope.
          for(const source of sources){const {assetId,uploadedKind,...local}=source;trackedWrite(()=>images.add({...local,id:identities.get(source.id)!,scope:nextScope}));}
          if(nextForm!==undefined)trackedWrite(()=>forms.add(nextForm,nextScope));
          if(brief!==undefined)trackedWrite(()=>forms.add(brief,`${nextScope}:brief`));
        } catch(error){abort(error);}
      };
      for(const request of [sourceImages,destinationImages,sourceForm,sourceBrief,destinationForm,destinationBrief])request.onsuccess=ready;
      transaction.oncomplete=()=>{guard?.signal.removeEventListener('abort',abortSignal);resolve();};
      transaction.onerror=transaction.onabort=()=>{guard?.signal.removeEventListener('abort',abortSignal);reject(failure??transaction.error??new Error('本机资料复制失败，原资料未改变。'));};
      if(guard?.signal.aborted)abortSignal();
    });
    changedSource(nextScope);
    changedSource(`${nextScope}:brief`);
  } finally { db.close(); }
}
