'use client';

import { X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { reviewShareUrl } from '../lib/review-share';
import {
  bingoPhaseLabel,
  clearBingoReceipt,
  emptyBingoSnapshot,
  formatBingoTime,
  readBingoSnapshot,
  type BingoPlan,
  type BingoSnapshot,
} from '../lib/bingo-status';
import { readDeveloperFeedback, type DeveloperFeedbackSummary } from '../lib/bingo-developer-inbox';
import './bingo-review-panel.css';

function clientReviewUrl(shareId: string): string {
  try {
    return reviewShareUrl(window.location.origin, shareId);
  } catch {
    return `/review/${shareId}`;
  }
}

function PlanFeedback({ plan }: { plan: BingoPlan }): JSX.Element | null {
  const [feedback, setFeedback] = useState<DeveloperFeedbackSummary>({ threadCount: 0, lines: [] });
  useEffect(() => {
    setFeedback(readDeveloperFeedback(window.localStorage, { shareId: plan.shareId, projectKey: plan.projectKey }));
  }, [plan.projectKey, plan.shareId]);
  if (feedback.threadCount === 0) return null;
  return (
    <div className="sc-bingo-feedback">
      <p className="sc-bingo-feedback-kicker">甲方反馈 · {feedback.threadCount} 条</p>
      <ul>
        {feedback.lines.map((line, index) => (
          <li key={`${plan.shareId}-${index}`}>
            <strong>{line.author}</strong>
            <span>{line.body}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * 开发端 Bingo：只看甲方反馈与评审状态。不打开甲方钉评页，也不在此发表评论。
 */
export function BingoReviewPanel({
  onClose,
  onEnterVenueReview,
}: {
  onClose(): void;
  onEnterVenueReview(): void;
}): JSX.Element {
  const [snapshot, setSnapshot] = useState<BingoSnapshot>(emptyBingoSnapshot);
  const [ready, setReady] = useState(false);
  const [copyNote, setCopyNote] = useState('');

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

  const phaseLabel = bingoPhaseLabel(ready ? snapshot.phase : 'to-send');

  const copyClientLink = async (shareId: string) => {
    const url = clientReviewUrl(shareId);
    try {
      await navigator.clipboard.writeText(url);
      setCopyNote('甲方链接已复制。请发给对方，在本页不要自评。');
    } catch {
      setCopyNote('复制失败，请从分享菜单再发一次评审链接。');
    }
  };

  return (
    <aside className="sc-bingo-panel" aria-label="Bingo 开发端" data-bingo-side="developer">
      <header className="sc-bingo-panel-head">
        <div className="sc-bingo-panel-title">
          <strong>Bingo</strong>
          <span className="sc-bingo-panel-side">开发端</span>
        </div>
        <span className={`sc-bingo-panel-phase is-${snapshot.phase}`}>{phaseLabel}</span>
        <button type="button" className="sc-bingo-panel-close" aria-label="收起 Bingo" onClick={onClose}>
          <X size={16} aria-hidden="true" />
        </button>
      </header>
      <div className="sc-bingo-panel-body">
        <p className="sc-bingo-boundary" role="note">
          甲方在分享页只读钉评；这里只看对方反馈与状态。不要在本机打开评审页自评。
        </p>
        <button type="button" className="sc-bingo-enter-review" onClick={onEnterVenueReview}>
          在画布场地点钉
        </button>
        {snapshot.receipt && (
          <p className="sc-bingo-receipt">
            甲方已点完成评审 · {formatBingoTime(snapshot.receipt.at) || snapshot.receipt.at}
            <span>{snapshot.receipt.planKey}</span>
          </p>
        )}
        {snapshot.plans.length > 0 ? (
          <ul className="sc-bingo-plans">
            {snapshot.plans.map((plan, index) => (
              <li key={`${plan.shareId}-${index}`}>
                <div className="sc-bingo-plan-copy">
                  <strong>{plan.title}</strong>
                  <span>{plan.returned ? '已回执' : '待甲方评审'}</span>
                </div>
                <PlanFeedback plan={plan} />
                <button type="button" className="sc-bingo-copy" onClick={() => void copyClientLink(plan.shareId)}>
                  复制甲方评审链接
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="sc-bingo-empty">
            {snapshot.receipt
              ? '回执还在。清掉后状态回到待发。'
              : '还没有发出评审。用画布「分享」生成链接发给甲方。'}
          </p>
        )}
        {snapshot.receipt && (
          <div className="sc-bingo-actions">
            <button
              type="button"
              className="sc-bingo-clear"
              onClick={() => {
                clearBingoReceipt(window.localStorage);
                sync();
                setCopyNote('已清回执。收藏仍在。');
              }}
            >
              清回执
            </button>
          </div>
        )}
        {copyNote && <p className="sc-bingo-copy-note" role="status">{copyNote}</p>}
      </div>
    </aside>
  );
}
