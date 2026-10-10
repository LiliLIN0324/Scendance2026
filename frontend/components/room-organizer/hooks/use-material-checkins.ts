'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { materialCheckinStorageKey, mergeStoredMaterialCheckins, readMaterialCheckins } from '../../../lib/material-checkin-storage';
import { registerSourceFlush, subscribeSourceRecordChanges } from '../../../lib/source-storage';
import type { MaterialCheckinLedger } from '../../../../supabase/functions/_shared/material-checkin-contract';

const CHANNEL = 'scendance-material-checkin-changes';
export interface MaterialCheckinState {
  projectId: string | undefined; ledger: MaterialCheckinLedger | undefined;
  ready: boolean; loading: boolean; saving: boolean; error: string | null;
  onSave(value: MaterialCheckinLedger): Promise<void>; retry(): void;
}
interface StoredState { scope: string | null; epoch: number; ledger: MaterialCheckinLedger | undefined; ready: boolean; error: string | null }

/** Project facts live outside layout history; this view never copies them into a new scene. */
export function useMaterialCheckins({ projectId, enabled, prepareWrite }: {
  projectId: string | undefined; enabled: boolean;
  prepareWrite(): Promise<() => void>;
}): MaterialCheckinState {
  const scope = enabled && projectId ? projectId : null;
  const generation = useRef({ scope, epoch: 0 });
  if (generation.current.scope !== scope) generation.current = { scope, epoch: generation.current.epoch + 1 };
  const epoch = generation.current.epoch;
  const latest = useRef({ scope, prepareWrite }); latest.current = { scope, prepareWrite };
  const [state, setState] = useState<StoredState>({ scope: null, epoch: -1, ledger: undefined, ready: false, error: null });
  const [savingScope, setSavingScope] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const reads = useRef(0), alive = useRef(true);
  const pending = useRef(new Map<string, Promise<void>>());
  const channel = useRef<BroadcastChannel | null>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (!scope) return;
    let active = true;
    const read = async () => {
      const serial = ++reads.current;
      try {
        const ledger = await readMaterialCheckins(scope);
        if (active && latest.current.scope === scope && reads.current === serial) setState({ scope, epoch, ledger, ready: true, error: null });
      } catch (error) {
        if (active && latest.current.scope === scope && reads.current === serial) setState({ scope, epoch, ledger: undefined, ready: false,
          error: error instanceof Error ? error.message : '点验记录读取失败，请重试。' });
      }
    };
    void read();
    const unsubscribe = subscribeSourceRecordChanges(materialCheckinStorageKey(scope), () => { void read(); });
    const unregister = registerSourceFlush(scope, async () => { await pending.current.get(scope); });
    const onFocus = () => { void read(); };
    window.addEventListener('focus', onFocus);
    let messages: BroadcastChannel | null = null;
    try {
      if (typeof BroadcastChannel !== 'undefined') {
        messages = new BroadcastChannel(CHANNEL);
        messages.onmessage = event => { if (event.data === scope) void read(); };
        channel.current = messages;
      }
    } catch { /* Focus and the visible retry action still refresh local records. */ }
    return () => { active = false; unsubscribe(); unregister(); window.removeEventListener('focus', onFocus);
      if (channel.current === messages) channel.current = null; messages?.close(); };
  }, [scope, epoch, attempt]);

  const onSave = useCallback(async (proposal: MaterialCheckinLedger) => {
    const currentScope = latest.current.scope;
    const currentEpoch = generation.current.epoch;
    if (!currentScope) throw new Error('数量点验暂用于有明确编号的本地项目。');
    if (pending.current.has(currentScope)) throw new Error('本次点验正在保存，请稍候。');
    setSavingScope(currentScope);
    const operation = (async () => {
      const guard = await latest.current.prepareWrite();
      const check = () => { if (latest.current.scope !== currentScope || generation.current.epoch !== currentEpoch) throw new Error('项目已切换，原点验输入未写入其他项目。'); guard(); };
      const saved = await mergeStoredMaterialCheckins(currentScope, proposal, check);
      if (alive.current && latest.current.scope === currentScope && generation.current.epoch === currentEpoch) {
        reads.current++;
        setState({ scope: currentScope, epoch: currentEpoch, ledger: saved, ready: true, error: null });
      }
      try { channel.current?.postMessage(currentScope); } catch { /* Notification failure cannot undo a committed write. */ }
    })();
    pending.current.set(currentScope, operation);
    try { await operation; }
    finally {
      if (pending.current.get(currentScope) === operation) pending.current.delete(currentScope);
      if (alive.current && latest.current.scope === currentScope) setSavingScope(null);
    }
  }, []);
  const current = state.scope === scope && state.epoch === epoch && scope ? state : { ledger: undefined, ready: false, error: null };
  return { projectId, ledger: current.ledger, ready: current.ready, loading: !!scope && !current.ready && !current.error,
    saving: savingScope === scope && scope !== null, error: current.error, onSave, retry: () => { setAttempt(value => value + 1); } };
}
