import { inspectRestoreStartup } from './restore-startup';
import { validateRecoveryPlan, preflightRecoverySourceIds } from './recovery-plan';
import { compareAndSetSourceRecord, readSourceRecordSnapshot, readSourceScopeSnapshotV2, readStoredSourceById, restoreSourceScopeV2IfUnchanged, sameSourceScopeSnapshotV2, type SourceRecordSnapshot, type SourceScopeSnapshotV2 } from './source-storage';
import { checkedMaterialCheckins, materialCheckinStorageKey } from './material-checkin-storage';
import { sameRecoveryFormValue } from './recovery-form-value';
import { STORAGE_KEY } from '../components/room-organizer/lib/constants';
import { applyRestoreJournal, inspectRestoreMarker, pendingRestoreId, readPendingRestoreJournal, rollbackRestoreJournal, sameRestoreJournalEntryValue, type RestoreJournal, type RestoreJournalEntry, type RestoreJournalStore, type RestoreRollbackDriver } from './restore-journal';

declare const ordinaryBrand: unique symbol;
declare const recoveryBrand: unique symbol;
export type LocalWriteCapability = { readonly [ordinaryBrand]: true };
export type RecoveryCapability = { readonly [recoveryBrand]: true };
type CapabilityRecord = { validate(): void; signal: AbortSignal; restoreSource?: (scope: string, expected: SourceScopeSnapshotV2, desired: SourceScopeSnapshotV2) => Promise<void>; readIdb?: (entry: RestoreJournalEntry) => Promise<unknown>; restoreForm?: (domain: string, scope: string, expected: unknown, desired: unknown) => Promise<void>; readLayout?: () => Promise<RecoveryLayoutSnapshot>; restoreLayout?: (expected: RecoveryLayoutSnapshot, desired: RecoveryLayoutSnapshot) => Promise<void> };
const ordinaryCapabilities = new WeakMap<object, CapabilityRecord>();
const recoveryCapabilities = new WeakMap<object, CapabilityRecord>();
const authenticRecoveryLeases = new WeakMap<object, () => Promise<{ id: string; direction: 'apply' | 'rollback'; digest: string }>>();
/** Verifies the actual lease object, not a copied capability or caller-supplied callback. */
export function verifyAuthenticRecoveryLease(value: unknown): Promise<{ id: string; direction: 'apply' | 'rollback'; digest: string }> {
  if (!value || typeof value !== 'object') return Promise.reject(new Error('恢复租约无效。'));
  const verify = authenticRecoveryLeases.get(value);
  return verify ? verify() : Promise.reject(new Error('恢复租约无效。'));
}
const activeExecutions = new WeakMap<object, { capability: RecoveryCapability; storage: Storage; store: RestoreJournalStore; active(): boolean }>();
/** Verifies the exact private driver and storage pair created for an active lease operation. */
export function assertRecoveryExecution(capability: unknown, driver: unknown, storage: Storage, store: RestoreJournalStore): void {
  assertRecoveryCapability(capability);
  if (!driver || typeof driver !== 'object') throw new Error('恢复执行凭证无效。');
  const execution=activeExecutions.get(driver);
  if (!execution || execution.capability !== capability || execution.storage !== storage || execution.store !== store || !execution.active()) throw new Error('恢复执行凭证无效。');
}

function checkCapability(value: unknown, registry: WeakMap<object, CapabilityRecord>): CapabilityRecord {
  if (!value || typeof value !== 'object') throw new Error('本机写入凭证无效。');
  const record = registry.get(value);
  if (!record) throw new Error('本机写入凭证无效。');
  record.validate();
  return record;
}
/** Runtime identity and live lease are both checked; string tags are not authority. */
export function assertLocalWriteCapability(value: unknown): asserts value is LocalWriteCapability { checkCapability(value, ordinaryCapabilities); }
export function assertRecoveryCapability(value: unknown): asserts value is RecoveryCapability { checkCapability(value, recoveryCapabilities); }
/** Recovery transaction signals must belong to the same authentic capability. */
export function recoveryCapabilitySignal(value: unknown): AbortSignal { return checkCapability(value, recoveryCapabilities).signal; }
/** Abort is tied to the same individual lease, not a caller-supplied signal. */
export function localWriteCapabilityGuard(value: unknown): { readonly kind: 'ordinary'; signal: AbortSignal; assertStillHeld(): void } {
  const record = checkCapability(value, ordinaryCapabilities);
  return { kind: 'ordinary', signal: record.signal, assertStillHeld: () => { checkCapability(value, ordinaryCapabilities); } };
}
/** Only recovery-specific adapters should use this guard. */
type RecoveryStorageGrant = { kind:'form'|'source'|'source-v2'|'journal'; key:unknown; expected?:unknown; desired?:unknown; expectedStage?:RestoreJournal['stage']; nextStage?:RestoreJournal['stage']; digest?:string; nextDigest?:string };
const recoveryStorageGrants=new WeakMap<object,RecoveryStorageGrant>();
/** The verifier is public; only this module can mint a scoped grant. */
export function assertRecoveryStorageGrant(guard:unknown, kind:RecoveryStorageGrant['kind'], key:unknown, expected?:unknown, desired?:unknown):void {
  if(!guard||typeof guard!=='object')throw new Error('恢复写入未获授权。');
  const grant=recoveryStorageGrants.get(guard);
  if(!grant||grant.kind!==kind||JSON.stringify(grant.key)!==JSON.stringify(key))throw new Error('恢复写入未获授权。');
  if(kind==='form'||kind==='source'||kind==='source-v2'){
    if(grant.expected!==expected||grant.desired!==desired)throw new Error('恢复写入与授权快照不一致。');
  } else if(expected!==undefined||desired!==undefined){
    if(!expected||!desired||typeof expected!=='object'||typeof desired!=='object')throw new Error('恢复日志更新无效。');
    const before=expected as Record<string,unknown>,after=desired as Record<string,unknown>;
    if(before.stage!==grant.expectedStage||before.digest!==grant.digest||after.stage!==grant.nextStage||after.digest!==grant.nextDigest
      ||Object.keys(before).length!==Object.keys(after).length||Object.keys(before).some(k=>k!=='stage'&&k!=='digest'&&before[k]!==after[k]))throw new Error('恢复日志更新超出授权。');
  }
}
function recoveryCapabilityGuard(value: unknown, grant:RecoveryStorageGrant): { signal: AbortSignal; capability: RecoveryCapability; assertStillHeld(): void } {
  const record = checkCapability(value, recoveryCapabilities);
  const guard={ signal: record.signal, capability:value as RecoveryCapability, assertStillHeld: () => { checkCapability(value, recoveryCapabilities); } };
  recoveryStorageGrants.set(guard,grant);return guard;
}
async function withRecoveryStorageGrant<T>(capability:unknown,grant:RecoveryStorageGrant,run:(guard:ReturnType<typeof recoveryCapabilityGuard>)=>Promise<T>):Promise<T>{
  const guard=recoveryCapabilityGuard(capability,grant);
  try{return await run(guard);}finally{recoveryStorageGrants.delete(guard);}
}
/** Only the verified journal's own completion ledger may be created. */
export async function writeVerifiedRecoveryCompletion(lease:RestrictedRecoveryLease,record:{version:1;id:string;direction:'apply'|'rollback';digest:string;verifiedAt:string}):Promise<void>{
  record=structuredClone(record);
  const verified=await verifyAuthenticRecoveryLease(lease);
  if(!record||Object.keys(record).sort().join(',')!=='digest,direction,id,verifiedAt,version'||record.version!==1
    ||record.id!==verified.id||record.direction!==verified.direction||record.digest!==verified.digest
    ||!Number.isFinite(Date.parse(record.verifiedAt)))throw new Error('恢复完成记录无效。');
  const key:[string,string]=['restore-completion-ledger-v1',verified.id];
  const before=await readSourceRecordSnapshot(key);assertRecoveryCapability(lease.capability);
  if(before.present){if(!sameRecoveryFormValue(before.value,record))throw new Error('已有不同的恢复完成账本，未覆盖。');return;}
  const after:SourceRecordSnapshot={present:true,value:record};
  await withRecoveryStorageGrant(lease.capability,{kind:'form',key,expected:before,desired:after},guard=>compareAndSetSourceRecord(key,before,after,sameRecoveryFormValue,guard));
  await verifyAuthenticRecoveryLease(lease);
}
/** Only an active journal operation may restore the exact recorded source-scope transition. */
export async function restoreSourceScopeWithRecoveryCapability(value: unknown, scope: string, expected: SourceScopeSnapshotV2, desired: SourceScopeSnapshotV2): Promise<void> {
  const record = checkCapability(value, recoveryCapabilities);
  if (!record.restoreSource) throw new Error('恢复凭证不能处理图纸资料。');
  const before = structuredClone(expected), after = structuredClone(desired);
  await record.restoreSource(scope, before, after);
}
/** Read only one IDB entry authorized by the active recovery journal. */
export async function readRecoveryIdbEntry(value: unknown, entry: RestoreJournalEntry): Promise<unknown> {
  const record = checkCapability(value, recoveryCapabilities);
  if (!record.readIdb) throw new Error('恢复凭证不能读取此资料。');
  return record.readIdb(structuredClone(entry));
}
/** Compare and replace only a form transition authorized by the active recovery journal. */
export async function restoreFormWithRecoveryCapability(value: unknown, domain: string, scope: string, expected: unknown, desired: unknown): Promise<void> {
  const record = checkCapability(value, recoveryCapabilities);
  if (!record.restoreForm) throw new Error('恢复凭证不能处理此资料。');
  await record.restoreForm(domain, scope, structuredClone(expected), structuredClone(desired));
}
export type RecoveryLayoutSnapshot = { present: false } | { present: true; raw: string };
export async function readRecoveryLayoutWithCapability(value: unknown): Promise<RecoveryLayoutSnapshot> {
  const record = checkCapability(value, recoveryCapabilities);
  if (!record.readLayout) throw new Error('恢复凭证不能读取主布局。');
  return record.readLayout();
}
export async function restoreLayoutWithRecoveryCapability(value: unknown, expected: RecoveryLayoutSnapshot, desired: RecoveryLayoutSnapshot): Promise<void> {
  const record = checkCapability(value, recoveryCapabilities);
  if (!record.restoreLayout) throw new Error('恢复凭证不能处理主布局。');
  await record.restoreLayout(structuredClone(expected), structuredClone(desired));
}
function requireBrowserAuthorities(deps: Dependencies, acquiredLocks: LockManager, acquiredStorage: Storage): void {
  try {
    if (typeof navigator === 'undefined' || typeof window === 'undefined' || !navigator.locks || !window.localStorage
      || deps.getLocks() !== acquiredLocks || navigator.locks !== acquiredLocks || deps.getStorage() !== acquiredStorage || window.localStorage !== acquiredStorage) throw new Error();
  } catch { throw new Error('写入凭证不属于当前浏览器的活动租约。'); }
}

/** Shared by all cooperating same-origin writers; not yet connected to business paths. */
export const LOCAL_ACTIVITY_WRITE_LOCK = 'scendance:local-activity:writer:v1';
export interface LocalWriteLease {
  readonly capability: LocalWriteCapability;
  /** Synchronous: call immediately before every write, including pagehide flush. */
  assertWritable(): void;
  /** Observe loss while mounted; callbacks must not write. */
  onLost(listener: () => void): () => void;
  /** Idempotent; the underlying Web Lock is released when the last local holder releases. */
  release(): Promise<void>;
}
type LeaseState = { active: boolean; releaseHold: () => void; finished: Promise<void>; references: number; listeners: Set<() => void>; locks: LockManager; storage: Storage };
type Dependencies = { getLocks: () => LockManager | null | undefined; getStorage: () => Storage | null };

/** One instance per browsing context; local callers share one exclusive session lock. */
export function createLocalWriteLeaseManager(deps: Dependencies) {
  let state: LeaseState | null = null;
  let acquiring: Promise<LeaseState> | null = null;
  let reservations = 0;
  let exclusiveStartup = false;
  function checkMarker(): void {
    const result = inspectRestoreStartup(deps.getStorage);
    if (result.status !== 'ready') throw new Error(result.reason === 'pending'
      ? '本机恢复尚待核对，不能写入。' : '无法读取本机恢复状态，不能写入。');
  }
  function invalidate(current: LeaseState): void {
    if (!current.active) return;
    current.active = false;
    for (const listener of current.listeners) { try { listener(); } catch { /* A subscriber cannot keep a lost lock alive. */ } }
    current.releaseHold();
  }
  async function open(): Promise<LeaseState> {
    checkMarker();
    let locks: LockManager | null | undefined;
    try { locks = deps.getLocks(); } catch { /* Inaccessible locks are unavailable. */ }
    if (!locks?.request) throw new Error('当前浏览器无法协调其他窗口，本机写入已暂停。');
    const acquiredLocks = locks;
    const acquiredStorage = deps.getStorage();
    if (!acquiredStorage) throw new Error('无法读取本机恢复状态，不能写入。');
    let releaseHold!: () => void;
    const hold = new Promise<void>(resolve => { releaseHold = resolve; });
    let resolveAcquired!: (value: LeaseState) => void, rejectAcquired!: (reason: unknown) => void;
    const acquired = new Promise<LeaseState>((resolve, reject) => { resolveAcquired = resolve; rejectAcquired = reject; });
    let current: LeaseState | null = null;
    let request: Promise<unknown>;
    try {
      request = locks.request(LOCAL_ACTIVITY_WRITE_LOCK, { mode: 'exclusive', ifAvailable: true }, async lock => {
        if (!lock) { rejectAcquired(new Error('另一窗口正在编辑本机活动，请先关闭或切换该窗口。')); return; }
        try { checkMarker(); if (deps.getStorage() !== acquiredStorage || deps.getLocks() !== acquiredLocks) throw new Error('本机写入环境已变化。'); } catch (error) { rejectAcquired(error); return; }
        current = { active: true, releaseHold, references: 0, finished: Promise.resolve(), listeners: new Set(), locks: acquiredLocks, storage: acquiredStorage };
        resolveAcquired(current);
        await hold;
      });
    } catch (error) { rejectAcquired(error); request = Promise.resolve(); }
    const finished = Promise.resolve(request).then(() => undefined, error => { rejectAcquired(error); });
    void finished.finally(() => { if (current) { invalidate(current); if (state === current) state = null; } });
    const result = await acquired;
    result.finished = finished;
    if (!result.active) throw new Error('本机写入租约已失效，请重新打开。');
    return result;
  }
  async function acquireInternal(forStartup = false): Promise<LocalWriteLease> {
    if (exclusiveStartup && !forStartup) throw new Error('本机恢复核查尚未完成，请稍后重试。');
    checkMarker();
    reservations++;
    let current: LeaseState | null = null;
    try {
      if (!state?.active) {
        if (!acquiring) {
          const attempt = open();
          acquiring = attempt;
          void attempt.then(value => { state = value; }, () => {}).finally(() => { if (acquiring === attempt) acquiring = null; });
        }
        current = await acquiring;
      } else current = state;
      if (!current.active) throw new Error('本机写入租约已失效，请重新打开。');
      try { checkMarker(); } catch (error) { invalidate(current); throw error; }
      current.references++;
    } finally {
      reservations--;
      if (current && current.references === 0 && reservations === 0) invalidate(current);
    }
    const held = current;
    let released = false;
    let releaseTask: Promise<void> | null = null;
    const assertWritable = () => {
      if (released || !held.active) throw new Error('本机写入租约已失效，请重新打开。');
      try { checkMarker(); } catch (error) { invalidate(held); throw error; }
    };
    const capability = Object.freeze(Object.create(null)) as LocalWriteCapability;
    const capabilityAbort = new AbortController();
    const abortCapability = () => capabilityAbort.abort();
    held.listeners.add(abortCapability);
    ordinaryCapabilities.set(capability, { signal: capabilityAbort.signal, validate: () => {
      assertWritable();
      try { requireBrowserAuthorities(deps, held.locks, held.storage); } catch (error) { invalidate(held); throw error; }
    } });
    return {
      capability, assertWritable,
      onLost(listener) {
        if (released || !held.active) { listener(); return () => {}; }
        held.listeners.add(listener);
        return () => { held.listeners.delete(listener); };
      },
      release() {
        if (releaseTask) return releaseTask;
        released = true;
        held.listeners.delete(abortCapability); capabilityAbort.abort();
        held.references--;
        if (held.references === 0 && reservations === 0) invalidate(held);
        releaseTask = (async () => { if (!held.active) await held.finished; })();
        return releaseTask;
      },
    };
  }
  async function acquire(): Promise<LocalWriteLease> { return acquireInternal(); }
  async function acquireExclusiveStartup(): Promise<LocalWriteLease> {
    if (exclusiveStartup || acquiring || reservations || state?.active) throw new Error('当前页面已有本机编辑会话，无法独占核查。');
    exclusiveStartup = true;
    try {
      const lease=await acquireInternal(true);
      let releaseTask: Promise<void> | null = null;
      return { ...lease, release() {
        if (!releaseTask) releaseTask=lease.release().finally(()=>{exclusiveStartup=false;});
        return releaseTask;
      } };
    } catch (error) { exclusiveStartup=false; throw error; }
  }
  return { acquire, acquireExclusiveStartup };
}

/** A trusted domain adapter must invoke the provided guard inside its atomic write transaction. */
export interface RecoveryDomainDriver {
  read(entry: RestoreJournalEntry): Promise<unknown>;
  compareAndSwap(entry: RestoreJournalEntry, expected: unknown, next: unknown, assertStillHeld: () => void): Promise<void>;
}
export interface RestrictedRecoveryLease {
  readonly capability: RecoveryCapability;
  /** Read-only cancellation signal; aborted whenever this recovery lease becomes invalid. */
  readonly signal: AbortSignal;
  inspect(): Promise<RestoreJournal>;
  apply(): Promise<void>;
  rollback(): Promise<void>;
  verifyCompleted(): Promise<{ id: string; direction: 'apply' | 'rollback'; digest: string }>;
  release(): Promise<void>;
}

/** Recovery uses the same exclusive lock, but never exposes an ordinary write lease. */
export async function acquireRestrictedRecoveryLease(deps: Dependencies, store: RestoreJournalStore, signal?: AbortSignal): Promise<RestrictedRecoveryLease> {
  if (signal?.aborted) throw new Error('恢复核对已取消。');
  let locks: LockManager | null | undefined, storage: Storage | null;
  try { locks = deps.getLocks(); storage = deps.getStorage(); } catch { throw new Error('无法读取本机恢复状态或协调其他窗口。'); }
  if (!locks?.request || !storage) throw new Error('无法读取本机恢复状态或协调其他窗口。');
  const expectedId = pendingRestoreId(storage);
  if (!expectedId) throw new Error('没有待核对的恢复记录。');
  const targetStorage = storage;
  let active = false, released = false, releaseHold!: () => void;
  const writeAbort = new AbortController();
  const readCancelled = new Promise<never>((_resolve, reject) => {
    writeAbort.signal.addEventListener('abort', () => reject(new Error('恢复租约已失效或取消。')), { once: true });
  });
  void readCancelled.catch(() => {});
  const cancellableRead = <T,>(work: Promise<T>): Promise<T> => Promise.race([work, readCancelled]);
  let running: Promise<unknown> | null = null, releasePromise: Promise<void> | null = null;
  const hold = new Promise<void>(resolve => { releaseHold = resolve; });
  let resolveAcquired!: (lease: RestrictedRecoveryLease) => void, rejectAcquired!: (reason: unknown) => void;
  const acquired = new Promise<RestrictedRecoveryLease>((resolve, reject) => { resolveAcquired = resolve; rejectAcquired = reject; });
  function assertActive(): void {
    if (!active || released || signal?.aborted) throw new Error('恢复租约已失效或取消。');
  }
  function assertHeld(): void {
    assertActive();
    if (pendingRestoreId(targetStorage) !== expectedId) throw new Error('恢复标记已变化，不能继续。');
  }
  const protectedStorage: Storage = {
    get length() { assertActive(); return targetStorage.length; },
    clear() { throw new Error('恢复租约不允许清空本机存储。'); },
    getItem(key) { assertActive(); return targetStorage.getItem(key); },
    key(index) { assertActive(); return targetStorage.key(index); },
    setItem(key, value) {
      assertHeld();
      if (key !== 'scendance:restore-journal:pending:v1') throw new Error('恢复租约不能修改其他本机标记。');
      const marker = JSON.parse(value) as Record<string, unknown>;
      if (marker.version !== 1 || marker.id !== expectedId || marker.state !== 'completed' || (marker.direction !== 'apply' && marker.direction !== 'rollback') || typeof marker.digest !== 'string' || !/^[a-f0-9]{64}$/.test(marker.digest)) throw new Error('恢复完成记录无效。');
      targetStorage.setItem(key, value);
    },
    removeItem(key) { assertHeld(); targetStorage.removeItem(key); },
  };
  const protectedStore: RestoreJournalStore = {
    async read(id) { assertActive(); const value = await cancellableRead(store.read(id)); assertActive(); return value; },
    async create() { throw new Error('恢复租约不允许创建恢复记录。'); },
    async setStage(id, expected, stage, digest, nextDigest) { assertRecoveryCapability(capability); await withRecoveryStorageGrant(capability,{kind:'journal',key:id,expectedStage:expected,nextStage:stage,digest,nextDigest},guard=>store.setStage(id, expected, stage, digest, nextDigest, guard)); assertRecoveryCapability(capability); },
    async remove() { throw new Error('恢复日志删除尚未开放。'); },
  };
  let finished: Promise<void> = Promise.resolve();
  async function release(): Promise<void> {
    if (releasePromise) return releasePromise;
    released = true; active = false; writeAbort.abort();
    releasePromise = (async () => { try { await running; } catch { /* Keep original operation failure. */ } releaseHold(); await finished; })();
    return releasePromise;
  }
  function guardedDriver(driver: RecoveryDomainDriver): RestoreRollbackDriver {
    return {
      async read(entry) { assertHeld(); const value = await cancellableRead(driver.read(entry)); assertHeld(); return value; },
      async compareAndSwap(entry, expected, next) { assertHeld(); await driver.compareAndSwap(entry, expected, next, assertHeld); assertHeld(); },
    };
  }
  async function run(direction: 'apply' | 'rollback'): Promise<void> {
    assertHeld();
    if (running) throw new Error('恢复核对正在进行，请勿重复操作。');
    const pending = (async () => {
      const journal = await cancellableRead(readPendingRestoreJournal(targetStorage, store)); assertHeld();
      if (!journal || journal.id !== expectedId) throw new Error('恢复日志已变化。');
      validateRecoveryPlan(journal, direction);
      await preflightRecoverySourceIds(journal, direction, id => cancellableRead(readStoredSourceById(id)), async () => {
        assertRecoveryCapability(capability);
        const latest = await cancellableRead(readPendingRestoreJournal(targetStorage, store));
        assertRecoveryCapability(capability);
        if (!latest || latest.id !== journal.id || latest.digest !== journal.digest) throw new Error('恢复日志已变化，请重新核对。');
      });
      const [{ createRecoveryIdbDriver }, { createRecoveryLayoutDriver }] = await Promise.all([import('./recovery-idb-driver'), import('./recovery-layout-driver')]);
      assertRecoveryCapability(capability);
      const idb = createRecoveryIdbDriver(capability), layout = createRecoveryLayoutDriver(capability);
      const choose = (entry: RestoreJournalEntry): RecoveryDomainDriver => {
        if (entry.domain === 'layout' && entry.key === 'main') return layout;
        if (entry.domain === 'activity-brief' || entry.domain === 'material-checkins' || entry.domain === 'source-scope') return idb;
        throw new Error('恢复计划包含不支持的资料类型。');
      };
      const driver: RecoveryDomainDriver = { read: entry => choose(entry).read(entry), compareAndSwap: (entry, expected, next, check) => choose(entry).compareAndSwap(entry, expected, next, check) };
      const guarded = guardedDriver(driver);
      activeExecutions.set(guarded, { capability, storage: protectedStorage, store: protectedStore, active: () => running === pending });
      try {
        if (direction === 'apply') await applyRestoreJournal(protectedStorage, protectedStore, guarded, capability);
        else await rollbackRestoreJournal(protectedStorage, protectedStore, guarded, capability);
      } finally { activeExecutions.delete(guarded); }
    })();
    running = pending;
    try { await pending; } finally { if (running === pending) running = null; }
  }
  const capability = Object.freeze(Object.create(null)) as RecoveryCapability;
  async function currentJournalEntry(domain: string, scope: string): Promise<{ journal: RestoreJournal; entry: RestoreJournalEntry }> {
    assertRecoveryCapability(capability);
    if (!running) throw new Error('只能在受保护的恢复操作中访问资料。');
    const journal = await cancellableRead(readPendingRestoreJournal(targetStorage, store));
    assertRecoveryCapability(capability);
    const entry = journal?.entries.find(item => item.domain === domain && item.key === scope);
    if (!entry || !journal) throw new Error('恢复日志未授权此资料范围。');
    return {journal, entry};
  }
  function formKey(domain: string, scope: string): string | [string, string] {
    if (!scope || scope.length > 128) throw new Error('活动范围无效。');
    if (domain === 'activity-brief') return `${scope}:brief`;
    if (domain === 'material-checkins') return materialCheckinStorageKey(scope) as [string, string];
    throw new Error('恢复资料类型不受支持。');
  }
  recoveryCapabilities.set(capability, { signal: writeAbort.signal, validate: () => {
    try { assertHeld(); requireBrowserAuthorities(deps, locks!, targetStorage); } catch (error) { void release(); throw error; }
  }, async readLayout() {
    await currentJournalEntry('layout', 'main');
    assertRecoveryCapability(capability);
    const raw = targetStorage.getItem(STORAGE_KEY);
    assertRecoveryCapability(capability);
    return raw === null ? {present:false} : {present:true,raw};
  }, async restoreLayout(expected, desired) {
    const {journal, entry} = await currentJournalEntry('layout', 'main');
    if (journal.stage !== 'applying' && journal.stage !== 'rolling_back') throw new Error('恢复日志尚未授权写入。');
    const from = journal.stage === 'applying' ? entry.before : entry.attempted;
    const to = journal.stage === 'applying' ? entry.attempted : entry.before;
    const parseSnapshot = (value: unknown): RecoveryLayoutSnapshot => {
      if (!value || typeof value !== 'object') throw new Error('主布局快照无效。');
      const record=value as Record<string,unknown>, keys=Object.keys(record);
      if (record.present === false && keys.length === 1) return {present:false};
      if (record.present === true && keys.length === 2 && typeof record.raw === 'string') return {present:true,raw:record.raw};
      throw new Error('主布局快照无效。');
    };
    const before=parseSnapshot(expected), after=parseSnapshot(desired);
    if (!sameRecoveryFormValue(from, before) || !sameRecoveryFormValue(to, after)) throw new Error('主布局与恢复日志不一致，未写入。');
    assertRecoveryCapability(capability);
    const raw = targetStorage.getItem(STORAGE_KEY);
    if (!sameRecoveryFormValue(raw === null ? {present:false} : {present:true,raw}, before)) throw new Error('本机主布局已有新变化，不能覆盖。');
    assertRecoveryCapability(capability);
    if (after.present) targetStorage.setItem(STORAGE_KEY, after.raw); else targetStorage.removeItem(STORAGE_KEY);
    assertRecoveryCapability(capability);
    const saved = targetStorage.getItem(STORAGE_KEY);
    if (!sameRecoveryFormValue(saved === null ? {present:false} : {present:true,raw:saved}, after)) throw new Error('主布局写后核对失败，请保留恢复记录。');
    assertRecoveryCapability(capability);
  }, async readIdb(requested) {
    const {entry} = await currentJournalEntry(requested.domain, requested.key);
    if (requested.domain === 'source-scope') return cancellableRead(readSourceScopeSnapshotV2(entry.key));
    const snapshot = await cancellableRead(readSourceRecordSnapshot(formKey(entry.domain, entry.key)));
    assertRecoveryCapability(capability);
    if (entry.domain === 'material-checkins' && snapshot.present && checkedMaterialCheckins(entry.key, snapshot.value) === undefined) throw new Error('点验记录无法完整读取。');
    return snapshot;
  }, async restoreForm(domain, scope, expected, desired) {
    const {journal, entry} = await currentJournalEntry(domain, scope);
    if (journal.stage !== 'applying' && journal.stage !== 'rolling_back') throw new Error('恢复日志尚未授权写入。');
    const from = journal.stage === 'applying' ? entry.before : entry.attempted;
    const to = journal.stage === 'applying' ? entry.attempted : entry.before;
    if (!sameRecoveryFormValue(from, expected) || !sameRecoveryFormValue(to, desired)) throw new Error('表单资料与恢复日志不一致，未写入。');
    const parseSnapshot = (value: unknown): SourceRecordSnapshot => {
      if (!value || typeof value !== 'object') throw new Error('恢复表单存在状态无效。');
      const object = value as Record<string, unknown>, keys = Object.keys(object);
      if (object.present === false && keys.length === 1) return {present:false};
      if (object.present === true && keys.length === 2 && Object.hasOwn(object, 'value')) return {present:true,value:object.value};
      throw new Error('恢复表单存在状态无效。');
    };
    const before = parseSnapshot(expected), after = parseSnapshot(desired);
    if (domain === 'material-checkins') {
      for (const snapshot of [before, after]) if (snapshot.present && checkedMaterialCheckins(scope, snapshot.value) === undefined) throw new Error('点验记录无法完整读取。');
    }
    const key = formKey(domain, scope);
    await withRecoveryStorageGrant(capability,{kind:'form',key,expected:before,desired:after},guard=>compareAndSetSourceRecord(key, before, after, sameRecoveryFormValue, guard));
  }, async restoreSource(scope, expected, desired) {
    assertRecoveryCapability(capability);
    if (!running) throw new Error('只能在受保护的恢复操作中修改图纸。');
    const journal = await cancellableRead(readPendingRestoreJournal(targetStorage, store));
    assertRecoveryCapability(capability);
    const entry = journal?.entries.find(item => item.domain === 'source-scope' && item.key === scope);
    if (!entry || !journal || (journal.stage !== 'applying' && journal.stage !== 'rolling_back')) throw new Error('恢复日志未授权此图纸范围。');
    const from = journal.stage === 'applying' ? entry.before : entry.attempted;
    const to = journal.stage === 'applying' ? entry.attempted : entry.before;
    try {
      if (!await cancellableRead(sameSourceScopeSnapshotV2(from as SourceScopeSnapshotV2, expected)) ||
          !await cancellableRead(sameSourceScopeSnapshotV2(to as SourceScopeSnapshotV2, desired))) throw new Error();
    } catch { throw new Error('图纸资料与恢复日志不一致，未写入。'); }
    assertRecoveryCapability(capability);
    await withRecoveryStorageGrant(capability,{kind:'source-v2',key:scope,expected,desired},guard=>restoreSourceScopeV2IfUnchanged(scope, expected, desired, guard));
  } });
  async function verifyCompleted(): Promise<{ id: string; direction: 'apply' | 'rollback'; digest: string }> {
    assertHeld();
    if (running) throw new Error('恢复核对正在进行，请勿重复操作。');
    const pending = (async () => {
      const marker=inspectRestoreMarker(targetStorage);
      if (!marker || marker.state !== 'completed') throw new Error('没有可核验的完成记录。');
      const journal=await cancellableRead(readPendingRestoreJournal(targetStorage,store));
      assertRecoveryCapability(capability);
      if (!journal || journal.id !== marker.id || journal.digest !== marker.digest) throw new Error('恢复完成记录与日志不一致。');
      validateRecoveryPlan(journal,marker.direction);
      await preflightRecoverySourceIds(journal,marker.direction,id=>cancellableRead(readStoredSourceById(id)),async()=>{
        assertRecoveryCapability(capability);
        const current=await cancellableRead(readPendingRestoreJournal(targetStorage,store));
        assertRecoveryCapability(capability);
        if (!current || current.digest !== journal.digest) throw new Error('恢复日志已变化。');
      });
      const [{ createRecoveryIdbDriver }, { createRecoveryLayoutDriver }] = await Promise.all([import('./recovery-idb-driver'), import('./recovery-layout-driver')]);
      assertRecoveryCapability(capability);
      const idb=createRecoveryIdbDriver(capability),layout=createRecoveryLayoutDriver(capability);
      for (const entry of journal.entries) {
        const driver=entry.domain === 'layout' ? layout : idb;
        const current=await cancellableRead(driver.read(entry));assertRecoveryCapability(capability);
        const expected=marker.direction === 'apply' ? entry.attempted : entry.before;
        if (!await cancellableRead(sameRestoreJournalEntryValue(entry,current,expected))) throw new Error('恢复完成后的资料已有变化，不能清理记录。');
      }
      assertRecoveryCapability(capability);
      const verified=await cancellableRead(readPendingRestoreJournal(targetStorage,store));
      assertRecoveryCapability(capability);
      const last=inspectRestoreMarker(targetStorage);
      if (!last || last.state !== 'completed' || last.id !== marker.id || last.direction !== marker.direction || last.digest !== marker.digest || !verified || verified.digest !== journal.digest) throw new Error('恢复完成记录已变化。');
      return {id:marker.id,direction:marker.direction,digest:marker.digest};
    })();
    running=pending;
    try { return await pending; } finally { if (running === pending) running=null; }
  }
  const lease: RestrictedRecoveryLease = {
    capability, signal: writeAbort.signal,
    async inspect() { assertHeld(); const journal = await cancellableRead(readPendingRestoreJournal(targetStorage, store)); assertHeld();
      if (!journal || journal.id !== expectedId) throw new Error('恢复日志已变化。'); return journal; },
    apply: (...args: unknown[]) => { if (args.length) return Promise.reject(new Error('恢复操作不接受外部写入驱动。')); return run('apply'); },
    rollback: (...args: unknown[]) => { if (args.length) return Promise.reject(new Error('恢复操作不接受外部写入驱动。')); return run('rollback'); },
    verifyCompleted: (...args: unknown[]) => { if (args.length) return Promise.reject(new Error('完成核验不接受外部驱动。')); return verifyCompleted(); }, release,
  };
  Object.freeze(lease);
  authenticRecoveryLeases.set(lease, verifyCompleted);
  let cancelAcquire!: () => void;
  const cancelled = new Promise<never>((_resolve, reject) => { cancelAcquire = () => reject(new Error('恢复核对已取消。')); });
  const onAbort = () => { cancelAcquire(); if (active) void release(); };
  signal?.addEventListener('abort', onAbort, { once: true });
  let request: Promise<unknown>;
  try {
    request = locks.request(LOCAL_ACTIVITY_WRITE_LOCK, { mode: 'exclusive', ifAvailable: true }, async lock => {
      if (!lock) { rejectAcquired(new Error('另一窗口正在使用本机活动，请先关闭或切换该窗口。')); return; }
      try {
        if (signal?.aborted) throw new Error('恢复核对已取消。');
        const journal = await Promise.race([readPendingRestoreJournal(targetStorage, store), cancelled]);
        if (!journal || journal.id !== expectedId || signal?.aborted || released) throw new Error('恢复日志不可核对。');
        active = true; resolveAcquired(lease);
        await hold;
      } catch (error) { rejectAcquired(error); }
    });
  } catch (error) { rejectAcquired(error); request = Promise.resolve(); }
  finished = Promise.resolve(request).then(() => undefined, error => { rejectAcquired(error); }).finally(() => {
    active = false; writeAbort.abort(); signal?.removeEventListener('abort', onAbort);
  });
  try { return await Promise.race([acquired, cancelled]); }
  catch (error) { void release(); throw error; }
}

export const browserLocalWriteLeaseManager = createLocalWriteLeaseManager({
  getLocks: () => typeof navigator === 'undefined' ? null : navigator.locks,
  getStorage: () => typeof window === 'undefined' ? null : window.localStorage,
});
