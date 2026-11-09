'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { browserLocalWriteLeaseManager, type LocalWriteLease } from '@/lib/local-write-lease';

type LeaseManager = { acquire(): Promise<LocalWriteLease> };
const LocalWriteContext = createContext<LocalWriteLease | null>(null);

/** The callback must be checked again inside each real storage transaction. */
export function useLocalWriteLease(): LocalWriteLease {
  const lease = useContext(LocalWriteContext);
  if (!lease) throw new Error('本机编辑权尚未取得，不能写入。');
  return lease;
}

type State = { status: 'waiting'; manager: LeaseManager } | { status: 'writing'; manager: LeaseManager; lease: LocalWriteLease } | { status: 'read-only'; manager: LeaseManager; message: string; lease?: LocalWriteLease };

/** Mount outside editor and storage providers. No business writer is wired here yet. */
export function LocalWriteLeaseProvider({ children, readOnlyView, manager = browserLocalWriteLeaseManager }: {
  children: ReactNode; readOnlyView?: ReactNode; manager?: LeaseManager;
}) {
  const [state, setState] = useState<State>({ status: 'waiting', manager });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true, lease: LocalWriteLease | null = null, unsubscribe: (() => void) | undefined;
    setState(previous => previous.manager === manager && previous.status === 'read-only' && previous.lease ? previous : { status: 'waiting', manager });
    void manager.acquire().then(acquired => {
      if (!alive) { void acquired.release(); return; }
      lease = acquired;
      const lose = () => { if (alive) setState({ status: 'read-only', manager, lease: acquired, message: '本机编辑权已失效，保存已暂停。请保留当前资料并重新核对。' }); };
      unsubscribe = acquired.onLost(lose);
      try { acquired.assertWritable(); } catch { lose(); return; }
      setState({ status: 'writing', manager, lease: acquired });
    }, error => { if (alive) setState(previous => ({ status: 'read-only', manager, message: error instanceof Error ? error.message : '暂时无法取得本机编辑权。', ...(previous.manager === manager && previous.status === 'read-only' && previous.lease ? { lease: previous.lease } : {}) })); });
    const onStorage = () => {
      if (!lease) return;
      try { lease.assertWritable(); } catch { /* The lease notifies its subscribers. */ }
    };
    window.addEventListener('storage', onStorage);
    return () => { alive = false; window.removeEventListener('storage', onStorage); unsubscribe?.(); if (lease) void lease.release(); };
  }, [manager, attempt]);
  if (state.manager !== manager || state.status === 'waiting') return <div role="status">正在核对本机编辑权，请稍候。</div>;
  const lease = state.lease;
  return <LocalWriteContext.Provider value={lease ?? null}>
    {lease && <div ref={node => { if (node) node.toggleAttribute('inert', state.status === 'read-only'); }} aria-disabled={state.status === 'read-only'}>{children}</div>}
    {state.status === 'read-only' && <section role="alert" aria-label="本机只读状态">
      <h1>本机活动暂为只读</h1><p>{state.message}</p><p>当前页面不会自动保存。请保留现有资料，核对其他窗口或恢复状态。</p>
      {readOnlyView}
      <button type="button" onClick={() => setAttempt(value => value + 1)}>重新核对编辑权</button>
    </section>}
  </LocalWriteContext.Provider>;
}
