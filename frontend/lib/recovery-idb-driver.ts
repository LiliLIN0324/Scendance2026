import { assertRecoveryCapability, readRecoveryIdbEntry, restoreFormWithRecoveryCapability, restoreSourceScopeWithRecoveryCapability, type RecoveryCapability, type RecoveryDomainDriver } from './local-write-lease';
import type { RestoreJournalEntry } from './restore-journal';
import type { SourceScopeSnapshotV2 } from './source-storage';

/** Only intended for the restricted recovery lease; this module does not activate recovery UI. */
export function createRecoveryIdbDriver(capability: RecoveryCapability): RecoveryDomainDriver {
  assertRecoveryCapability(capability);
  return {
    async read(entry: RestoreJournalEntry): Promise<unknown> {
      assertRecoveryCapability(capability);
      return readRecoveryIdbEntry(capability, entry);
    },
    async compareAndSwap(entry, expected, next, check): Promise<void> {
      check(); assertRecoveryCapability(capability);
      if (entry.domain === 'source-scope') {
        await restoreSourceScopeWithRecoveryCapability(capability, entry.key, expected as SourceScopeSnapshotV2, next as SourceScopeSnapshotV2);
      } else if (entry.domain === 'activity-brief' || entry.domain === 'material-checkins') {
        await restoreFormWithRecoveryCapability(capability, entry.domain, entry.key, expected, next);
      } else throw new Error('恢复资料类型不受支持。');
      check();
    },
  };
}
