'use client';

import { bingoPhaseLabel, readBingoSnapshot, type BingoPhase } from '../lib/bingo-status';
import { useEffect, useState } from 'react';

/**
 * 窄轨第三格：Bingo 评审。独立面板入口，不是画布浮球，也不是轨脚草稿字。
 */
export function BingoRailButton({ open, onToggle }: { open: boolean; onToggle(): void }): JSX.Element {
  const [phase, setPhase] = useState<BingoPhase | 'pending'>('pending');
  useEffect(() => {
    const sync = () => setPhase(readBingoSnapshot(window.localStorage).phase);
    sync();
    window.addEventListener('storage', sync);
    window.addEventListener('focus', sync);
    document.addEventListener('visibilitychange', sync);
    return () => {
      window.removeEventListener('storage', sync);
      window.removeEventListener('focus', sync);
      document.removeEventListener('visibilitychange', sync);
    };
  }, []);
  const label = phase === 'pending' ? 'Bingo' : `Bingo · ${bingoPhaseLabel(phase)}`;
  return (
    <button
      type="button"
      className={`sc-rail-bingo-btn${open ? ' is-active' : ''}${phase === 'returned' ? ' is-returned' : ''}${phase === 'awaiting' ? ' is-awaiting' : ''}`}
      aria-pressed={open}
      aria-label={label}
      data-tip="Bingo"
      title={label}
      onClick={onToggle}
    >
      <span className="sc-rail-bingo-ring" aria-hidden="true" />
      <span className="sc-rail-word">Bingo</span>
    </button>
  );
}
