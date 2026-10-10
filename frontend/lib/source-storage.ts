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
type FlushSourceCallback = () => Promise<void>;
const sourceFlushers = new Map<string, Set<FlushSourceCallback>>();
/** Register live editor state that must reach IndexedDB before a project scope changes. */
export function registerSourceFlush(scope: string, flush: FlushSourceCallback): () => void {
  const callbacks=sourceFlushers.get(scope)??new Set<FlushSourceCallback>();
  callbacks.add(flush);sourceFlushers.set(scope,callbacks);
  return ()=>{callbacks.delete(flush);if(callbacks.size===0)sourceFlushers.delete(scope);};
}
export async function flushSourceScope(scope: string): Promise<void> {
  await Promise.all([...sourceFlushers.get(scope)??[]].map(flush=>flush()));
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
const DATABASE = 'scendance-source-images-v1';
/** Compound keys cannot collide with a legacy form whose imported project ID is an arbitrary string. */
export type SourceFormKey = string | [string, string];
const sourceChangeKey = (scope: SourceFormKey) => JSON.stringify(scope);
const sourceListeners = new Map<string, Set<() => void>>();
/** Read-only views refresh after the original owner has committed its form/images. */
export function subscribeSourceRecordChanges(scope: SourceFormKey, listener: () => void): () => void {
  const key = sourceChangeKey(scope), listeners = sourceListeners.get(key) ?? new Set<() => void>();
  listeners.add(listener); sourceListeners.set(key, listeners);
  return () => { listeners.delete(listener); if (!listeners.size) sourceListeners.delete(key); };
}
export function subscribeSourceChanges(scope: string, listener: () => void): () => void { return subscribeSourceRecordChanges(scope, listener); }
function changedSource(scope?: SourceFormKey): void {
  for (const [key, listeners] of sourceListeners) if (scope === undefined || sourceChangeKey(scope) === key) {
    for (const listener of listeners) { try { listener(); } catch { /* A view cannot turn a committed save into a failed write. */ } }
  }
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
async function transact<T>(name: 'sources' | 'forms', mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(name, mode);
    const request = run(transaction.objectStore(name));
    let result: T;
    request.onsuccess = () => { result = request.result; };
    transaction.oncomplete = () => { db.close(); resolve(result); };
    transaction.onerror = transaction.onabort = () => { db.close(); reject(transaction.error ?? request.error ?? new Error('本机资料保存失败。')); };
  });
}
export function listStoredSources(scope: string): Promise<StoredSource[]> { return transact('sources', 'readonly', store => store.index('scope').getAll(scope)); }
export async function storeSource(source: StoredSource): Promise<void> { await transact('sources', 'readwrite', store => store.put(source)); changedSource(source.scope); }
export async function deleteSource(id: string): Promise<void> { await transact('sources', 'readwrite', store => store.delete(id)); changedSource(); }
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
export function readSourceForm<T>(scope: string): Promise<T | undefined> { return readSourceRecord(scope); }
export async function storeSourceForm(scope: string, value: unknown): Promise<void> { await transact('forms', 'readwrite', store => store.put(value, scope)); changedSource(scope); }
/** Read and update within one native transaction so concurrent appenders cannot overwrite each other. */
export async function updateSourceForm<T>(scope: SourceFormKey, update: (current: unknown) => T): Promise<T> {
  const key: SourceFormKey = typeof scope === 'string' ? scope : [scope[0], scope[1]];
  const db = await openDatabase();
  try {
    const result = await new Promise<T>((resolve, reject) => {
    const transaction = db.transaction('forms', 'readwrite');
    const store = transaction.objectStore('forms');
    const request = store.get(key);
    let value: T, failure: unknown;
    request.onsuccess = () => {
      try {
        // The updater must be synchronous; an uncloneable result aborts rather than escaping the transaction.
        value = structuredClone(update(request.result));
        if (value === undefined) store.delete(key);
        else store.put(value, key);
      } catch (error) { failure = error; transaction.abort(); }
    };
    transaction.oncomplete = () => resolve(value);
    transaction.onerror = transaction.onabort = () => {
      reject(failure ?? transaction.error ?? request.error ?? new Error('本机资料保存失败，原记录未改变。'));
    };
    });
    changedSource(key);
    return result;
  } finally { db.close(); }
}
export async function deleteSourceForm(scope: string): Promise<void> { await transact('forms', 'readwrite', store => store.delete(scope)); changedSource(scope); }

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
  desired: SourceScopeSnapshot, check: () => void = () => {}): Promise<void> {
  const before = structuredClone(expected), next = structuredClone(desired);
  checkSourceSnapshotScope(scope, before); checkSourceSnapshotScope(scope, next);
  check();
  const current = await readSourceScopeSnapshot(scope);
  if (!await sameSourceScopeSnapshot(current, before)) throw new Error('图纸资料已有新变化，不能覆盖较新的记录。');
  check();
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(['sources', 'forms'], 'readwrite');
      const images = transaction.objectStore('sources'), forms = transaction.objectStore('forms');
      let failure: unknown, remaining = next.sources.length;
      const abort = (error: unknown) => { failure = error; transaction.abort(); };
      const replace = () => {
        try {
          check();
          for (const source of current.sources) images.delete(source.id);
          for (const source of next.sources) images.put(source);
          const last = next.form === undefined ? forms.delete(scope) : forms.put(next.form, scope);
          // Recheck in the last request callback, while abort can still undo all
          // queued writes. There are no awaited operations inside this transaction.
          last.onsuccess = () => { try { check(); } catch (error) { abort(error); } };
        } catch (error) { abort(error); }
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = transaction.onabort = () => reject(failure ?? transaction.error ?? new Error('本机图纸资料保存失败，原资料未改变。'));
      // IDs are global in the sources store. A lock on this scope alone cannot
      // authorize overwriting another activity's image with the same local ID.
      for (const source of next.sources) {
        const request = images.get(source.id);
        request.onsuccess = () => {
          if (failure !== undefined) return;
          if (request.result !== undefined && request.result.scope !== scope) {
            abort(new Error('图纸编号已被另一个活动使用，原图纸未改变。')); return;
          }
          if (--remaining === 0) replace();
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
export async function copySourceScope(previousScope: string, nextScope: string): Promise<void> {
  if(previousScope===nextScope)return;
  await flushSourceScope(previousScope);
  const sources=await listStoredSources(previousScope);
  if(sources.some(source=>!source.blob))throw new Error('部分资料只有云端引用，无法复制到新项目。请先重新选择对应原图；原项目资料已保留。');
  const destination=await listStoredSources(nextScope);
  if(destination.length)throw new Error('目标项目已有场地资料，已保留原资料，请核对后再复制。');
  const identities=new Map(sources.map(source=>[source.id,crypto.randomUUID()]));
  const form=await readSourceForm<Record<string,unknown>>(previousScope),brief=await readSourceForm<unknown>(`${previousScope}:brief`);
  const nextForm=form?{...form}:undefined;
  if(nextForm){
    for(const key of ['jobId','jobBase','jobInput','jobSources','jobMode','requestId','requestKey'])delete nextForm[key];
    if(Array.isArray(nextForm.constraints))nextForm.constraints=nextForm.constraints.map((d:Record<string,unknown>)=>({...d,...(typeof d.sourceAssetId==='string'&&identities.has(d.sourceAssetId)?{sourceAssetId:identities.get(d.sourceAssetId)}:{})}));
    const registration=nextForm.registration as {sourceId?:string}|undefined;
    if(registration?.sourceId)nextForm.registration={...registration,sourceId:identities.get(registration.sourceId)??registration.sourceId};
  }
  for(const source of sources){const {assetId,uploadedKind,...local}=source;await storeSource({...local,id:identities.get(source.id)!,scope:nextScope});}
  if(nextForm)await storeSourceForm(nextScope,nextForm);
  if(brief)await storeSourceForm(`${nextScope}:brief`,brief);
}
