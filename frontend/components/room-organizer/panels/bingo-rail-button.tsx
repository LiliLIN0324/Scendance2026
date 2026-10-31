'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  bingoBallLabel,
  emptyBingoSnapshot,
  readBingoSnapshot,
  type BingoSnapshot,
} from '../lib/bingo-status';

/**
 * 窄轨第三格：Bingo / 评审收藏。点开左栏独立面板，不在轨上挂 popover。
 */
export function BingoRailButton({ open, onToggle }: { open: boolean; onToggle(): void }): JSX.Element {
  const [snapshot, setSnapshot] = useState<BingoSnapshot>(emptyBingoSnapshot);
  const [ready, setReady] = useState(false);

  const sync = useCallback(() => {
    setSnapshot(readBingoSnapshot(window.localStorage));
    setReady(true);
  }, []);

  useEffect(() => {
    sync();
    const onStore = () => sync();
    window.addEventListener('storage', onStore);
    window.addEventListener('focus', onStore);
    document.addEventListener('visibilitychange', onStore);
    return () => {
      window.removeEventListener('storage', onStore);
      window.removeEventListener('focus', onStore);
      document.removeEventListener('visibilitychange', onStore);
    };
  }, [sync]);

  const phase = ready ? snapshot.phase : 'to-send';
  const label = ready ? bingoBallLabel(snapshot) : '收反馈';
  const count = ready && snapshot.phase === 'awaiting' ? String(snapshot.plans.length) : '';

  return (
    <button
      type="button"
      className={`sc-bingo-ball sc-rail-bingo${open ? ' is-active' : ''}${phase === 'returned' ? ' is-returned' : ''}`}
      data-status={phase}
      {...(count ? { 'data-count': count } : {})}
      aria-pressed={open}
      aria-label={label}
      data-tip="Bingo"
      onClick={onToggle}
    >
      {count ? <span className="sc-bingo-count">{count}</span> : null}
    </button>
  );
}
