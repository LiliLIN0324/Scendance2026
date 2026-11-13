'use client';

import { useCallback, useEffect, useState, type RefObject } from 'react';
import { countOpenFeedbackPins, readBingoPlanFeedback } from '../lib/bingo-feedback';
import {
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
 * 圆徽标三态——待发空圆、待评主圆出未读钉 P + 角标出未回执链接 L、已回执勾形 + 角标未读钉 P；
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

  const storage = typeof window === 'undefined' ? null : window.localStorage;
  const plans = snapshot.plans;
  // L：尚未回执的评审链接份数；P：这些方案下未闭环画内钉总数。
  const linkCount = plans.filter(plan => !plan.returned).length;
  const pinCount = plans.reduce(
    (sum, plan) => sum + countOpenFeedbackPins(readBingoPlanFeedback(plan, storage)),
    0,
  );

  const phase = snapshot.phase;
  const mainCount = phase === 'awaiting' ? badgeCount(pinCount) : '';
  const cornerCount = phase === 'awaiting'
    ? badgeCount(linkCount)
    : phase === 'returned'
      ? badgeCount(pinCount)
      : '';

  const labelParts = [bingoPhaseLabel(phase)];
  if (linkCount > 0) labelParts.push(`${linkCount} 份链接`);
  if (pinCount > 0) labelParts.push(`${pinCount} 条未读钉`);
  const label = `收反馈，${labelParts.join('，')}`;
  const tipParts = ['Bingo', bingoPhaseLabel(phase)];
  if (pinCount > 0) tipParts.push(`${pinCount} 条未读钉`);
  if (linkCount > 0) tipParts.push(`${linkCount} 份链接`);
  const tip = tipParts.join(' · ');

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
        {...(mainCount ? { 'data-count': mainCount } : {})}
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
          mainCount
        )}
        {cornerCount && (
          <span className="sc-bingo-corner" data-count={cornerCount}>{cornerCount}</span>
        )}
      </span>
      <span className="sc-rail-label" aria-hidden="true">Bingo</span>
    </button>
  );
}
