import { assertLocalWriteCapability, assertRecoveryCapability, browserLocalWriteLeaseManager, localWriteCapabilityGuard, verifyAuthenticRecoveryLease, writeVerifiedRecoveryCompletion, type LocalWriteLease, type RestrictedRecoveryLease } from './local-write-lease';
import { inspectRestoreMarker, RESTORE_JOURNAL_NAMESPACE } from './restore-journal';
import { readSourceRecordSnapshot, SOURCE_DATABASE_NAME } from './source-storage';
import { sameRecoveryFormValue } from './recovery-form-value';
import { LIBRARY_PENDING_KEY } from './library-pending';
import { VERSION_HISTORY_PENDING_KEY } from './version-history-pending';

/** Isolated prototype: does not clear records, alter the workspace or enable recovery. */
export const RESTORE_COMPLETION_LEDGER_NAMESPACE = 'restore-completion-ledger-v1';
export interface CompletionLedgerRecord { version: 1; id: string; direction: 'apply' | 'rollback'; digest: string; verifiedAt: string }
type Inventory = { journals: number; ledgers: number; malformed: boolean };
export type StartupAuditResult = { status: 'blocked'; reason: 'marker' | 'journal' | 'ledger' | 'library-pending' | 'history-pending' | 'unreadable' | 'busy' | 'writers-not-integrated' };

function validId(id: unknown): id is string { return typeof id === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(id); }
function validLedger(value: unknown): value is CompletionLedgerRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v=value as Record<string,unknown>;
  return Object.keys(v).sort().join(',') === 'digest,direction,id,verifiedAt,version' && v.version === 1 && validId(v.id)
    && (v.direction === 'apply' || v.direction === 'rollback') && typeof v.digest === 'string' && /^[a-f0-9]{64}$/.test(v.digest)
    && typeof v.verifiedAt === 'string' && Number.isFinite(Date.parse(v.verifiedAt));
}

/** One IDB snapshot over all keys: malformed namespace members are blockers, not ignored. */
async function readInventory(): Promise<Inventory> {
  if (typeof indexedDB === 'undefined') throw new Error('本机恢复账本不可读取。');
  const db=await new Promise<IDBDatabase>((resolve,reject)=>{
    let settled=false;
    const request=indexedDB.open(SOURCE_DATABASE_NAME,1);
    request.onupgradeneeded=()=>{
      const database=request.result;
      if (!database.objectStoreNames.contains('sources')) {
        const sources=database.createObjectStore('sources',{keyPath:'id'});sources.createIndex('scope','scope');
      }
      if (!database.objectStoreNames.contains('forms')) database.createObjectStore('forms');
    };
    request.onblocked=()=>{settled=true;reject(new Error('本机恢复账本正被旧窗口占用。'));};
    request.onerror=()=>{settled=true;reject(request.error ?? new Error('本机恢复账本不可读取。'));};
    request.onsuccess=()=>{if(settled){request.result.close();return;}settled=true;resolve(request.result);};
  });
  try { return await new Promise<Inventory>((resolve,reject)=>{
    let inventory:Inventory={journals:0,ledgers:0,malformed:false};
    const transaction=db.transaction('forms','readonly');
    transaction.oncomplete=()=>resolve(inventory);
    transaction.onerror=transaction.onabort=()=>reject(transaction.error ?? new Error('本机恢复账本无法完整枚举。'));
    try {
      const request=transaction.objectStore('forms').openKeyCursor();
      request.onsuccess=()=>{
        try {
          const cursor=request.result;if(!cursor)return;
          const key=cursor.key;
          const reserved = (value:unknown) => typeof value === 'string' && (value.startsWith('restore-journal-') || value.startsWith('restore-completion-ledger-'));
          if (reserved(key)) inventory={...inventory,malformed:true};
          if (Array.isArray(key) && reserved(key[0]) && key[0]!==RESTORE_JOURNAL_NAMESPACE && key[0]!==RESTORE_COMPLETION_LEDGER_NAMESPACE) inventory={...inventory,malformed:true};
          if(Array.isArray(key) && (key[0]===RESTORE_JOURNAL_NAMESPACE || key[0]===RESTORE_COMPLETION_LEDGER_NAMESPACE)) {
            if(key.length!==2 || !validId(key[1])) inventory={...inventory,malformed:true};
            else if(key[0]===RESTORE_JOURNAL_NAMESPACE) inventory={...inventory,journals:inventory.journals+1};
            else inventory={...inventory,ledgers:inventory.ledgers+1};
          }
          cursor.continue();
        } catch (error) { try { transaction.abort(); } catch { /* already finished */ } reject(error); }
      };
    } catch(error) { try { transaction.abort(); } catch { /* already finished */ } reject(error); }
  }); } finally { db.close(); }
}

/**
 * This prototype never grants editing: existing ordinary writers do not yet all honor the same lock.
 * Even an empty enumeration is insufficient until a separate integration proof exists.
 */
export async function auditRestoreStartup(): Promise<StartupAuditResult> {
  let storage: Storage;
  try {
    storage=window.localStorage;
    if (!storage) return {status:'blocked',reason:'unreadable'};
    if (inspectRestoreMarker(storage)) return {status:'blocked',reason:'marker'};
    if (storage.getItem(LIBRARY_PENDING_KEY) !== null) return {status:'blocked',reason:'library-pending'};
    if (storage.getItem(VERSION_HISTORY_PENDING_KEY) !== null) return {status:'blocked',reason:'history-pending'};
  } catch { return {status:'blocked',reason:'unreadable'}; }
  let lease: LocalWriteLease;
  try { lease=await browserLocalWriteLeaseManager.acquireExclusiveStartup(); }
  catch { return {status:'blocked',reason:'busy'}; }
  try {
    assertLocalWriteCapability(lease.capability);
    const guard=localWriteCapabilityGuard(lease.capability);
    let abort!:()=>void;
    const cancelled=new Promise<never>((_resolve,reject)=>{abort=()=>reject(new Error('本机写入租约已失效。'));guard.signal.addEventListener('abort',abort,{once:true});});
    let inventory:Inventory;
    try { if(guard.signal.aborted) throw new Error('本机写入租约已失效。'); inventory=await Promise.race([readInventory(),cancelled]); }
    finally { guard.signal.removeEventListener('abort',abort); }
    assertLocalWriteCapability(lease.capability);
    if (inspectRestoreMarker(storage)) { await lease.release(); return {status:'blocked',reason:'marker'}; }
    if (storage.getItem(LIBRARY_PENDING_KEY) !== null) { await lease.release(); return {status:'blocked',reason:'library-pending'}; }
    if (storage.getItem(VERSION_HISTORY_PENDING_KEY) !== null) { await lease.release(); return {status:'blocked',reason:'history-pending'}; }
    if (inventory.malformed) { await lease.release(); return {status:'blocked',reason:'unreadable'}; }
    if (inventory.journals) { await lease.release(); return {status:'blocked',reason:'journal'}; }
    if (inventory.ledgers) { await lease.release(); return {status:'blocked',reason:'ledger'}; }
    await lease.release();
    return {status:'blocked',reason:'writers-not-integrated'};
  } catch {
    await lease.release();
    return {status:'blocked',reason:'unreadable'};
  }
}

/** Persist only a verified completion; idempotent, does not delete journal or marker. */
export async function recordVerifiedCompletion(lease: RestrictedRecoveryLease): Promise<CompletionLedgerRecord> {
  const verified=await verifyAuthenticRecoveryLease(lease);
  const guard={signal:lease.signal,capability:lease.capability,assertStillHeld() {
    assertRecoveryCapability(lease.capability);
    const marker=inspectRestoreMarker(window.localStorage);
    if (!marker || marker.state!=='completed' || marker.id!==verified.id || marker.direction!==verified.direction || marker.digest!==verified.digest) throw new Error('恢复完成记录已变化。');
  }};
  guard.assertStillHeld();
  const key:[string,string]=[RESTORE_COMPLETION_LEDGER_NAMESPACE,verified.id];
  const previous=await readSourceRecordSnapshot(key);
  guard.assertStillHeld();
  let record:CompletionLedgerRecord;
  if (previous.present) {
    if (!validLedger(previous.value) || previous.value.id!==verified.id || previous.value.direction!==verified.direction || previous.value.digest!==verified.digest) throw new Error('已有不同的恢复完成账本，未覆盖。');
    record=previous.value;
  } else {
    record={version:1,id:verified.id,direction:verified.direction,digest:verified.digest,verifiedAt:new Date().toISOString()};
    await writeVerifiedRecoveryCompletion(lease,record);
  }
  guard.assertStillHeld();
  const readback=await readSourceRecordSnapshot(key);
  guard.assertStillHeld();
  if (!readback.present || !validLedger(readback.value) || !sameRecoveryFormValue(readback.value,record)) throw new Error('恢复完成账本读回不一致，原记录已保留。');
  const rechecked = await verifyAuthenticRecoveryLease(lease);
  guard.assertStillHeld();
  if (!sameRecoveryFormValue(rechecked, verified)) throw new Error('恢复完成状态已变化，请保留记录并重新核对。');
  return readback.value;
}
