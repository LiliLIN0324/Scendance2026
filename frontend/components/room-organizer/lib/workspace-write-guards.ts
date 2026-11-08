import { useRef } from 'react';
import { localWriteCapabilityGuard, type LocalWriteCapability } from '@/lib/local-write-lease';
import { createLayoutPersistenceCapability } from './layout-capability-persistence';
import { snapshotBeforeReplace } from './restore-point';
import type { RoomLayout } from './types';

/** Optional composition for controlled integration; it does not acquire a lease or enable recovery. */
export function useWorkspaceWriteGuards(capability?: LocalWriteCapability, assertSession?: () => void) {
  const sessionCheck=useRef(assertSession);sessionCheck.current=assertSession;
  const state = useRef<null | { capability: LocalWriteCapability; revoke(): void; guards: {
    capability: LocalWriteCapability; assertLayoutWrite(): void; source: ReturnType<typeof localWriteCapabilityGuard>;
  } }>(null);
  if (!state.current && capability) {
    const layout = createLayoutPersistenceCapability(capability);
    const underlying = localWriteCapabilityGuard(capability);
    const abort = new AbortController();
    let revoked = false;
    const revoke = () => { revoked = true; abort.abort(); };
    underlying.signal.addEventListener('abort', revoke, { once: true });
    const assertHeld = () => {
      if (revoked || abort.signal.aborted) throw new Error('本机编辑权已失效，保存已暂停；请保留草稿并核对。');
      try { sessionCheck.current?.(); layout.assertWrite(); } catch (error) { revoke(); throw error; }
    };
    state.current = { capability, revoke, guards: { capability, assertLayoutWrite: assertHeld,
      source: { kind: 'ordinary', signal: abort.signal, assertStillHeld: assertHeld } } };
    if (underlying.signal.aborted) revoke();
  }
  // A removed or substituted capability must never re-enable the legacy path.
  // Re-entry requires a separately designed, conflict-checked recovery process.
  if (state.current && capability !== state.current.capability) state.current.revoke();
  return state.current?.guards ?? null;
}

/** Replace only after checking permission both around the snapshot and at application. */
export function applyGuardedWorkspaceReplacement(outgoing: RoomLayout, assertWrite: (() => void) | undefined, apply: () => void, capability?: LocalWriteCapability): void {
  const check = () => { assertWrite?.(); if (capability !== undefined) localWriteCapabilityGuard(capability).assertStillHeld(); };
  check();
  if (!snapshotBeforeReplace(outgoing, assertWrite || capability !== undefined ? check : undefined, capability)) {
    throw new Error('当前方案的恢复点未能确认保存，替换暂未应用。');
  }
  check();
  apply();
}
