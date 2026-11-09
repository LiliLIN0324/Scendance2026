import { inspectRestoreMarker } from './restore-journal';

export type RestoreStartupState =
  | { status: 'ready' }
  | { status: 'blocked'; reason: 'pending' | 'completed' | 'unreadable' };

/** Synchronous pre-mount check. An inaccessible or malformed marker always blocks. */
export function inspectRestoreStartup(getStorage: () => Storage | null): RestoreStartupState {
  try {
    const storage = getStorage();
    if (!storage) return { status: 'blocked', reason: 'unreadable' };
    const marker=inspectRestoreMarker(storage);
    return !marker ? { status: 'ready' } : { status: 'blocked', reason: marker.state === 'completed' ? 'completed' : 'pending' };
  } catch {
    return { status: 'blocked', reason: 'unreadable' };
  }
}
