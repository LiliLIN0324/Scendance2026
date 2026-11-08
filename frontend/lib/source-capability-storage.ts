import { localWriteCapabilityGuard, type LocalWriteCapability } from './local-write-lease';
import { copySourceScope, deleteSource, deleteSourceForm, flushSourceScope, storeSource, storeSourceForm, updateSourceForm, type SourceFormKey, type StoredSource } from './source-storage';

/** Explicit ordinary-write adapters. Legacy unguarded APIs remain separate until all callers migrate. */
export const sourceCapabilityStorage = {
  storeSource(capability: LocalWriteCapability, source: StoredSource): Promise<void> {
    return storeSource(source, localWriteCapabilityGuard(capability));
  },
  deleteSource(capability: LocalWriteCapability, id: string): Promise<void> {
    return deleteSource(id, localWriteCapabilityGuard(capability));
  },
  storeSourceForm(capability: LocalWriteCapability, scope: string, value: unknown): Promise<void> {
    return storeSourceForm(scope, value, localWriteCapabilityGuard(capability));
  },
  deleteSourceForm(capability: LocalWriteCapability, scope: string): Promise<void> {
    return deleteSourceForm(scope, localWriteCapabilityGuard(capability));
  },
  updateSourceForm<T>(capability: LocalWriteCapability, scope: SourceFormKey, update: (current: unknown) => T): Promise<T> {
    return updateSourceForm(scope, update, localWriteCapabilityGuard(capability));
  },
  copySourceScope(capability: LocalWriteCapability, from: string, to: string): Promise<void> {
    return copySourceScope(from, to, localWriteCapabilityGuard(capability));
  },
  flushSourceScope(capability: LocalWriteCapability, scope: string): Promise<void> {
    return flushSourceScope(scope, localWriteCapabilityGuard(capability));
  },
};
