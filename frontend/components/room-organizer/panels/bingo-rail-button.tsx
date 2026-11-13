'use client';

import { useCallback, useEffect, useState, type RefObject } from 'react';
import {
  bingoBallLabel,
  bingoPhaseLabel,
  emptyBingoSnapshot,
  readBingoSnapshot,
  type BingoSnapshot,
} from '../lib/bingo-status';

/** 圆内计数：0 不画；超过 9 收束为 9+。 */
function badgeCount(count: number): string {
  if (count <= 0) return '';
  return count > 9 ? '9+' : String(count);
}

/**
 * 左轨第二格：Bingo / 评审收藏。
 * 圆徽标沿用旧版三态——待发空圆、待评圆内数字（未回执链接数）、已回执勾形；
 * 圆体 28px，与其他轨钮图标槽同尺寸。状态与计数写进 aria-label / data-tip，不只靠颜色。
 */
export function BingoRailButton({ open, onOpen, buttonRef }: {
  open: boolean;
  onOpen(): void;
  buttonRef?: RefObject<HTMLButtonElement>;
}): JSX.Element {
  const [snapshot, setSnapshot] = useState<BingoSnapshot>(emptyBingoSnapshot);

  const sync = useCallback(() => {
    setSnapshot(readBingoSnapshot(typeof window === 'undefined' ? null : window.localStorage));
  }, []);

  useEffect(() => {
    sync();
    window.addEventListener('storage', sync);
    window.addEventListener('focus', sync);
    document.addEventListener('visibilitychange', sync);
    return () => {
      window.removeEventListener('storage', sync);
      window.removeEventListener('focus', sync);
      document.removeEventListener('visibilitychange', sync);
    };
  }, [sync]);

  const phase = snapshot.phase;
  const count = phase === 'awaiting' ? snapshot.plans.length : 0;
  const countText = badgeCount(count);
  const label = bingoBallLabel(snapshot);
  const tip = `Bingo · ${bingoPhaseLabel(phase)}${count > 0 ? ` · ${count} 份链接` : ''}`;

  return (
    <button
      ref={buttonRef}
      type="button"
      className={`sc-rail-bingo sc-rail-disc${open ? ' is-active' : ''}`}
      aria-pressed={open}
      aria-expanded={open}
      aria-label={label}
      data-tip={tip}
      onClick={onOpen}
    >
      <span
        className="sc-bingo-badge"
        data-status={phase}
        {...(countText ? { 'data-count': countText } : {})}
        aria-hidden="true"
      >
        {phase === 'returned' ? (
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M5 12.5 10 17.5 19 7.5" />
          </svg>
        ) : (
          countText
        )}
      </span>
      <span className="sc-rail-label" aria-hidden="true">Bingo</span>
    </button>
  );
}
