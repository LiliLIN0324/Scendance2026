import { acquireRestrictedRecoveryLease } from './local-write-lease';
import { indexedDbRestoreJournalStore, pendingRestoreId, type RestoreJournalStore } from './restore-journal';
import { validateRecoveryPlan } from './recovery-plan';

/** Safety depends on every regular writer holding the same exclusive lock; not wired to UI. */
export interface RecoveryCoordinatorOptions {
  direction: 'apply' | 'rollback';
  getStorage(): Storage | null;
  getLocks(): LockManager | null | undefined;
  store?: RestoreJournalStore;
  signal?: AbortSignal;
}
export async function coordinatePendingRecovery(options: RecoveryCoordinatorOptions): Promise<'none' | 'completed'> {
  let storage: Storage | null;
  try { storage=options.getStorage(); } catch { throw new Error('无法读取本机恢复状态。'); }
  if (!storage) throw new Error('无法读取本机恢复状态。');
  if (!pendingRestoreId(storage)) return 'none';
  const store=options.store ?? indexedDbRestoreJournalStore;
  const lease=await acquireRestrictedRecoveryLease({getStorage:options.getStorage,getLocks:options.getLocks},store,options.signal);
  try {
    const journal=await lease.inspect();validateRecoveryPlan(journal,options.direction);
    if(options.direction === 'apply') await lease.apply(); else await lease.rollback();
    return 'completed';
  } finally { await lease.release(); }
}

/** Read-only completed-state verification; intentionally leaves marker and journal untouched. */
export async function verifyCompletedRecovery(options: Omit<RecoveryCoordinatorOptions, 'direction'>): Promise<{ id: string; direction: 'apply' | 'rollback'; digest: string }> {
  const store=options.store ?? indexedDbRestoreJournalStore;
  const lease=await acquireRestrictedRecoveryLease({getStorage:options.getStorage,getLocks:options.getLocks},store,options.signal);
  try { return await lease.verifyCompleted(); } finally { await lease.release(); }
}
/** Cross-store cleanup is unsafe until startup also verifies a durable cleanup ledger. */
export function cleanupCompletedRecovery(): never {
  throw new Error('完成记录清理暂不可用，请保留本机恢复标记和日志。');
}
