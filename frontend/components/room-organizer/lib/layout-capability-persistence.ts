import { assertLocalWriteCapability, type LocalWriteCapability } from '@/lib/local-write-lease';
import { backupStoredLayout, discardRecoveryCopy, keepStoredLayout, loadLayout, resetStoredLayout, saveLayout, type RawStore } from './persistence';
import { snapshotBeforeReplace } from './restore-point';
import { clearSnapshots, evictOldestSnapshot, recordSnapshot, type VersionHistoryOptions, type VersionHistoryStore } from './version-history';
import type { RoomLayout } from './types';

/** A stable assertion is tied to this exact lease and cannot be reused after release. */
export function createLayoutPersistenceCapability(capability: LocalWriteCapability) {
  const assertWrite = () => assertLocalWriteCapability(capability);
  assertWrite();
  return {
    assertWrite,
    loadLayout() { assertWrite(); return loadLayout(assertWrite); },
    saveLayout(layout: RoomLayout, storage?: VersionHistoryStore) { assertWrite(); return saveLayout(layout, storage, assertWrite); },
    backupStoredLayout(storage?: RawStore, now?: number) { assertWrite(); return backupStoredLayout(storage, now, assertWrite); },
    keepStoredLayout(storage?: RawStore, now?: number) { assertWrite(); return keepStoredLayout(storage, now, assertWrite); },
    resetStoredLayout(storage?: RawStore, now?: number) { assertWrite(); return resetStoredLayout(storage, now, assertWrite); },
    discardRecoveryCopy(key: string, storage?: RawStore) { assertWrite(); return discardRecoveryCopy(key, storage, assertWrite); },
    recordSnapshot(layout: RoomLayout, options: Omit<VersionHistoryOptions, 'assertWrite' | 'capability'> & { force?: boolean } = {}) {
      assertWrite(); return recordSnapshot(layout, { ...options, assertWrite, capability });
    },
    snapshotBeforeReplace(layout: RoomLayout | null | undefined) { assertWrite(); return snapshotBeforeReplace(layout, assertWrite, capability); },
    clearSnapshots(options: Omit<VersionHistoryOptions, 'assertWrite' | 'capability'> = {}) { assertWrite(); return clearSnapshots({ ...options, assertWrite, capability }); },
    evictOldestSnapshot(options: Omit<VersionHistoryOptions, 'assertWrite' | 'capability'> = {}) { assertWrite(); return evictOldestSnapshot({ ...options, assertWrite, capability }); },
  };
}
