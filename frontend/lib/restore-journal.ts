import { readSourceRecord, updateRestoreJournalRecord, type RecoveryTransactionGuard } from './source-storage';
import { assertRecoveryExecution } from './local-write-lease';

/** Independent recovery primitive. No editor is connected; the restore pause remains in force. */
export const RESTORE_JOURNAL_MARKER = 'scendance:restore-journal:pending:v1';
export const RESTORE_JOURNAL_NAMESPACE = 'restore-journal-v1';
const namespace = RESTORE_JOURNAL_NAMESPACE;
export type RestoreJournalStage = 'prepared' | 'applying' | 'rolling_back';
export interface RestoreJournalEntry { domain: string; key: string; before: unknown; attempted: unknown }
export interface RestoreJournal {
  version: 1; id: string; operation: 'restore' | 'undo'; stage: RestoreJournalStage;
  createdAt: string; entries: RestoreJournalEntry[]; digest: string;
  /** Required by the coordinator for new recoveries; legacy journals remain inspectable only. */
  scopeBinding?: { source: string; target: string };
}
export type RestoreJournalWriteGuard = RecoveryTransactionGuard;
export interface RestoreJournalStore {
  read(id: string): Promise<unknown>;
  create(id: string, journal: RestoreJournal): Promise<void>;
  setStage(id: string, expected: RestoreJournalStage, stage: RestoreJournalStage, digest: string, nextDigest: string, guard?: RestoreJournalWriteGuard): Promise<void>;
  remove(id: string, digest: string, guard?: RestoreJournalWriteGuard): Promise<void>;
}
export const indexedDbRestoreJournalStore: RestoreJournalStore = {
  read: id => readSourceRecord([namespace, id]),
  async create() { throw new Error('恢复日志创建尚未取得受限授权，原资料未改变。'); },
  async setStage(id, expected, stage, digest, nextDigest, guard) { await updateRestoreJournalRecord(id, value => {
    const prior = value as RestoreJournal | undefined;
    if (!prior || prior.stage !== expected || prior.digest !== digest) throw new Error('恢复记录已变化。');
    if (stage === 'prepared' || (expected === 'rolling_back' && stage !== 'rolling_back')) throw new Error('恢复阶段不能回退。');
    return { ...prior, stage, digest: nextDigest };
  }, guard); },
  async remove(id, digest, guard) { await updateRestoreJournalRecord(id, value => {
    if (!value || (value as RestoreJournal).digest !== digest) throw new Error('恢复记录已变化。');
    return undefined;
  }, guard); },
};

/** Distinguishes absent, null, bytes, and Blob content/type; refuses exotic or cyclic objects. */
async function canonicalValue(value: unknown, parents = new Set<object>()): Promise<string> {
  if (value === undefined) return 'u';
  if (value === null) return 'n';
  if (typeof value === 'string') return `s${JSON.stringify(value)}`;
  if (typeof value === 'boolean') return value ? 'b1' : 'b0';
  if (typeof value === 'number' && Number.isFinite(value)) return `d${Object.is(value, -0) ? '-0' : String(value)}`;
  if (typeof value !== 'object') throw new Error('恢复快照包含不支持的数据。');
  if (parents.has(value)) throw new Error('恢复快照包含循环引用。');
  if (value instanceof Blob) {
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', await value.arrayBuffer()));
    const file = typeof File !== 'undefined' && value instanceof File ? `F${JSON.stringify(value.name)}:${value.lastModified}:` : 'B';
    return `${file}${JSON.stringify(value.type)}:${value.size}:${Array.from(hash, byte => byte.toString(16).padStart(2, '0')).join('')}`;
  }
  parents.add(value);
  try {
    if (Array.isArray(value)) {
      const descriptors = Object.getOwnPropertyDescriptors(value);
      if (Object.values(descriptors).some(descriptor => !('value' in descriptor))) throw new Error('恢复快照包含不支持的取值器。');
      const keys = Object.keys(value).sort();
      const parts: string[] = [];
      for (const key of keys) parts.push(`${JSON.stringify(key)}:${await canonicalValue((value as unknown as Record<string, unknown>)[key], parents)}`);
      return `a${value.length}{${parts.join(',')}}`;
    }
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new Error('恢复快照包含不支持的数据。');
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Object.values(descriptors).some(descriptor => !('value' in descriptor))) throw new Error('恢复快照包含不支持的取值器。');
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
    const result: string[] = [];
    for (const [key, child] of entries) result.push(`${JSON.stringify(key)}:${await canonicalValue(child, parents)}`);
    return `o{${result.join(',')}}`;
  } finally { parents.delete(value); }
}
async function digestOf(journal: Omit<RestoreJournal, 'digest'>): Promise<string> {
  const bytes = new TextEncoder().encode(await canonicalValue(journal));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
function validId(id: unknown): id is string { return typeof id === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(id); }
export type RestoreMarker = { version: 1; id: string; state: 'pending' } | { version: 1; id: string; state: 'completed'; direction: 'apply' | 'rollback'; digest: string };
export function inspectRestoreMarker(storage: Pick<Storage, 'getItem'>): RestoreMarker | null {
  const raw = storage.getItem(RESTORE_JOURNAL_MARKER);
  if (raw === null) return null;
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error('恢复标记损坏，请保留原资料并人工核对。'); }
  if (!value || typeof value !== 'object') throw new Error('恢复标记损坏，请保留原资料并人工核对。');
  const record = value as Record<string, unknown>;
  if (record.version !== 1 || !validId(record.id)) throw new Error('恢复标记损坏，请保留原资料并人工核对。');
  if (record.state === undefined || record.state === 'pending') return { version: 1, id: record.id, state: 'pending' };
  if (record.state === 'completed' && (record.direction === 'apply' || record.direction === 'rollback') && typeof record.digest === 'string' && /^[a-f0-9]{64}$/.test(record.digest)) {
    return { version: 1, id: record.id, state: 'completed', direction: record.direction, digest: record.digest };
  }
  throw new Error('恢复标记损坏，请保留原资料并人工核对。');
}
export function pendingRestoreId(storage: Pick<Storage, 'getItem'>): string | null { return inspectRestoreMarker(storage)?.id ?? null; }
async function verifyJournal(value: unknown, id: string): Promise<RestoreJournal> {
  if (!value || typeof value !== 'object') throw new Error('恢复日志缺失，请保留原资料并人工核对。');
  const journal = value as RestoreJournal;
  if (journal.version !== 1 || journal.id !== id || !validId(id) || !['restore', 'undo'].includes(journal.operation)
    || !['prepared', 'applying', 'rolling_back'].includes(journal.stage) || typeof journal.createdAt !== 'string'
    || !Number.isFinite(Date.parse(journal.createdAt)) || !Array.isArray(journal.entries) || !journal.entries.length
    || !/^[a-f0-9]{64}$/.test(journal.digest)) throw new Error('恢复日志损坏，请保留原资料并人工核对。');
  const keys = new Set<string>();
  for (const entry of journal.entries) {
    if (!entry || typeof entry.domain !== 'string' || !entry.domain || typeof entry.key !== 'string' || !entry.key
      || !Object.hasOwn(entry, 'before') || !Object.hasOwn(entry, 'attempted')) throw new Error('恢复日志损坏，请保留原资料并人工核对。');
    const key = JSON.stringify([entry.domain, entry.key]); if (keys.has(key)) throw new Error('恢复日志包含重复范围。'); keys.add(key);
  }
  const { digest, ...authenticated } = journal;
  if (await digestOf(authenticated) !== digest) throw new Error('恢复日志校验失败，请保留原资料并人工核对。');
  return journal;
}

/** Caller must hold the same exclusive cross-tab lock as every writer until the whole operation ends. */
export async function prepareRestoreJournal(storage: Storage, store: RestoreJournalStore, input: Omit<RestoreJournal, 'version' | 'stage' | 'digest'>): Promise<RestoreJournal> {
  if (pendingRestoreId(storage) !== null) throw new Error('已有待核对的恢复记录。');
  const immutable = structuredClone({ version: 1 as const, ...input });
  const prepared = { ...immutable, stage: 'prepared' as const };
  const journal: RestoreJournal = { ...prepared, digest: await digestOf(prepared) };
  await verifyJournal(journal, journal.id);
  await store.create(journal.id, journal);
  const saved = await verifyJournal(await store.read(journal.id), journal.id);
  if (saved.digest !== journal.digest || saved.stage !== 'prepared') throw new Error('恢复日志读回不一致，不能修改业务资料。');
  if (pendingRestoreId(storage) !== null) throw new Error('已有待核对的恢复记录。');
  const marker = JSON.stringify({ version: 1, id: journal.id });
  storage.setItem(RESTORE_JOURNAL_MARKER, marker);
  if (storage.getItem(RESTORE_JOURNAL_MARKER) !== marker) throw new Error('恢复标记未能核对，不能修改业务资料。');
  return journal;
}
export async function readPendingRestoreJournal(storage: Storage, store: RestoreJournalStore): Promise<RestoreJournal | null> {
  const marker = inspectRestoreMarker(storage);
  if (!marker) return null;
  const journal = await verifyJournal(await store.read(marker.id), marker.id);
  if (marker.state === 'completed' && (marker.digest !== journal.digest || journal.stage !== (marker.direction === 'apply' ? 'applying' : 'rolling_back'))) throw new Error('恢复完成记录与日志不一致，请保留原资料。');
  return journal;
}
export async function setRestoreJournalStage(storage: Storage, store: RestoreJournalStore, stage: RestoreJournalStage): Promise<RestoreJournal> {
  const current = await readPendingRestoreJournal(storage, store);
  if (!current) throw new Error('没有待核对的恢复记录。');
  if (stage === 'prepared' || current.stage === 'rolling_back' && stage !== 'rolling_back') throw new Error('恢复阶段不能回退。');
  const { digest: _digest, ...contents } = current;
  const nextDigest = await digestOf({ ...contents, stage });
  await store.setStage(current.id, current.stage, stage, current.digest, nextDigest);
  const updated = await readPendingRestoreJournal(storage, store);
  if (!updated || updated.stage !== stage || updated.digest !== nextDigest) throw new Error('恢复阶段未能核对。');
  return updated;
}
export interface RestoreRollbackDriver {
  read(entry: RestoreJournalEntry): Promise<unknown>;
  /** Must atomically compare current to expected and write next, refusing concurrent changes. */
  compareAndSwap(entry: RestoreJournalEntry, expected: unknown, next: unknown): Promise<void>;
}
async function finishRestoreJournal(storage: Storage, store: RestoreJournalStore, journal: RestoreJournal, direction: 'apply' | 'rollback'): Promise<void> {
  if (pendingRestoreId(storage) !== journal.id) throw new Error('恢复标记已变化，请人工核对。');
  const saved = await readPendingRestoreJournal(storage, store);
  if (!saved || saved.digest !== journal.digest) throw new Error('恢复日志已变化，请人工核对。');
  // Completion remains durable and frozen. Clearing it requires a future explicit,
  // separately verified finalization protocol; neither the journal nor marker is deleted here.
  const marker = JSON.stringify({ version: 1, id: journal.id, state: 'completed', direction, digest: journal.digest });
  storage.setItem(RESTORE_JOURNAL_MARKER, marker);
  if (storage.getItem(RESTORE_JOURNAL_MARKER) !== marker) throw new Error('恢复完成记录未能核对，请保留本机资料。');
}

/** Exact domain comparison; source arrays are unordered by ID, all other values retain full structure and Blob bytes. */
export async function sameRestoreJournalEntryValue(entry: RestoreJournalEntry, a: unknown, b: unknown): Promise<boolean> {
  const normalize = (value: unknown): unknown => {
    if (entry.domain !== 'source-scope' || !value || typeof value !== 'object' || !Array.isArray((value as {sources?:unknown}).sources)) return value;
    const record = value as Record<string,unknown> & {sources:{id:string}[]};
    return {...record, sources:[...record.sources].sort((left,right)=>left.id < right.id ? -1 : left.id > right.id ? 1 : 0)};
  };
  return await canonicalValue(normalize(a)) === await canonicalValue(normalize(b));
}

/** Preflight all domains before any write. The caller holds the shared exclusive lock throughout. */
async function moveRestoreJournal(storage: Storage, store: RestoreJournalStore, driver: RestoreRollbackDriver, direction: 'applying' | 'rolling_back', capability: unknown): Promise<void> {
  const authorize = () => assertRecoveryExecution(capability, driver, storage, store);
  authorize();
  const marker = inspectRestoreMarker(storage);
  const journal = await readPendingRestoreJournal(storage, store);
  if (!journal) throw new Error('没有待核对的恢复记录。');
  if (marker?.state === 'completed' && marker.direction !== (direction === 'applying' ? 'apply' : 'rollback')) throw new Error('恢复已记录完成，不能反向操作。');
  if (direction === 'applying' && journal.stage === 'rolling_back') throw new Error('回滚已经开始，不能继续应用，请完成回滚。');
  const current: unknown[] = [];
  for (const entry of journal.entries) {
    const value = await driver.read(entry);
    authorize();
    if (!await sameRestoreJournalEntryValue(entry, value, entry.before) && !await sameRestoreJournalEntryValue(entry, value, entry.attempted)) throw new Error('资料已有新变化，未覆盖任何资料，请人工核对。');
    current.push(value);
  }
  authorize();
  const transitioned = await setRestoreJournalStage(storage, store, direction);
  authorize();
  for (let i = 0; i < journal.entries.length; i++) {
    const entry = journal.entries[i]!;
    const target = direction === 'applying' ? entry.attempted : entry.before;
    if (!await sameRestoreJournalEntryValue(entry, current[i], target)) await driver.compareAndSwap(entry, current[i], target);
    authorize();
  }
  for (const entry of journal.entries) {
    const target = direction === 'applying' ? entry.attempted : entry.before;
    if (!await sameRestoreJournalEntryValue(entry, await driver.read(entry), target)) throw new Error(direction === 'applying' ? '恢复核对未完成，请保留恢复记录并重试。' : '回滚核对未完成，请保留恢复记录并重试。');
  }
  authorize();
  await finishRestoreJournal(storage, store, transitioned, direction === 'applying' ? 'apply' : 'rollback');
}

/** Apply or resume the exact intended states; partial failures leave the marker. */
export async function applyRestoreJournal(storage: Storage, store: RestoreJournalStore, driver: RestoreRollbackDriver, capability: unknown): Promise<void> {
  await moveRestoreJournal(storage, store, driver, 'applying', capability);
}

/** Roll back or resume to the exact pre-operation states; partial failures leave the marker. */
export async function rollbackRestoreJournal(storage: Storage, store: RestoreJournalStore, driver: RestoreRollbackDriver, capability: unknown): Promise<void> {
  await moveRestoreJournal(storage, store, driver, 'rolling_back', capability);
}
