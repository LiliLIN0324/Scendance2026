import { assertRecoveryCapability, readRecoveryLayoutWithCapability, restoreLayoutWithRecoveryCapability, type RecoveryCapability, type RecoveryDomainDriver, type RecoveryLayoutSnapshot } from './local-write-lease';

/** LocalStorage has no cross-process CAS: every writer must hold the shared exclusive Web Lock. */
export function createRecoveryLayoutDriver(capability: RecoveryCapability): RecoveryDomainDriver {
  assertRecoveryCapability(capability);
  return {
    async read(entry) {
      if (entry.domain !== 'layout' || entry.key !== 'main') throw new Error('恢复日志未授权此主布局。');
      return readRecoveryLayoutWithCapability(capability);
    },
    async compareAndSwap(entry, expected, next, check) {
      if (entry.domain !== 'layout' || entry.key !== 'main') throw new Error('恢复日志未授权此主布局。');
      check(); assertRecoveryCapability(capability);
      await restoreLayoutWithRecoveryCapability(capability, expected as RecoveryLayoutSnapshot, next as RecoveryLayoutSnapshot);
      check();
    },
  };
}
