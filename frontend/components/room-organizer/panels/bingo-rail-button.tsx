'use client';

import { useCallback, useEffect, useState, type RefObject } from 'react';
import { countOpenFeedbackPins, readBingoPlanFeedback } from '../lib/bingo-feedback';
import {
  emptyBingoSnapshot,
  readBingoSnapshot,
  type BingoSnapshot,
} from '../lib/bingo-status';
import { REVIEW_MARK_CHANGED_EVENT } from '../lib/review-share';
import {
  BingoStatusMark,
  bingoBadgeCount,
  bingoVisual,
  bingoVisualLabel,
  useBingoSending,
} from './bingo-status-mark';

export {
  BINGO_D4,
  bingoBeadCenter,
  bingoRingPath,
} from './bingo-status-mark';

/**
 * 左轨第二格：Bingo / 评审收藏。
 * 圆体 28px，和分享行用同一枚状态圈。选中不铺实心圆盘，开口、警示珠和对勾保持可见。
 * 未读钉仍写进 aria-label / data-tip。送出中只改这一枚的转动，不新写存储状态。
 */
export function BingoRailButton({ open, onOpen, buttonRef }: {
  open: boolean;
  onOpen(): void;
  buttonRef?: RefObject<HTMLButtonElement>;
}): JSX.Element {
  const [snapshot, setSnapshot] = useState<BingoSnapshot>(emptyBingoSnapshot);
  const [armed, setArmed] = useState(false);
  const sendingNow = useBingoSending();

  const sync = useCallback(() => {
    setSnapshot(readBingoSnapshot(typeof window === 'undefined' ? null : window.localStorage));
  }, []);

  useEffect(() => {
    sync();
    setArmed(true);
    window.addEventListener('storage', sync);
    window.addEventListener('focus', sync);
    window.addEventListener(REVIEW_MARK_CHANGED_EVENT, sync);
    document.addEventListener('visibilitychange', sync);
    return () => {
      window.removeEventListener('storage', sync);
      window.removeEventListener('focus', sync);
      window.removeEventListener(REVIEW_MARK_CHANGED_EVENT, sync);
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
  const sending = sendingNow && phase !== 'returned';
  const visual = bingoVisual(phase, sending);
  // 环内只留一个数：待评的未回执链接。未读钉不再画成第二枚角标。
  const shownCount = phase === 'awaiting' ? bingoBadgeCount(linkCount) : '';

  const labelParts = [bingoVisualLabel(visual)];
  if (linkCount > 0) labelParts.push(`${linkCount} 份链接`);
  if (pinCount > 0) labelParts.push(`${pinCount} 条未读钉`);
  // 2026-11-19 用户口径：左轨名字保持「Bingo」，气泡里只留名字，不再加待评/份数。
  const label = `Bingo，${labelParts.join('，')}`;

  return (
    <button
      ref={buttonRef}
      type="button"
      className={`sc-rail-bingo sc-rail-disc${open ? ' is-active' : ''}`}
      aria-pressed={open}
      aria-expanded={open}
      aria-label={label}
      data-tip="Bingo"
      onClick={onOpen}
    >
      <BingoStatusMark phase={phase} sending={sending} count={shownCount} size={28} armed={armed} />
      <span className="sc-rail-label" aria-hidden="true">Bingo</span>
    </button>
  );
}
