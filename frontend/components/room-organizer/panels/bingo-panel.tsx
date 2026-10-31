'use client';

import { ChevronDown, ChevronRight, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import {
  feedbackSummaryLabel,
  formatFeedbackTime,
  readBingoPlanFeedback,
  type BingoPlanFeedback,
} from '../lib/bingo-feedback';
import {
  bingoPhaseLabel,
  clearBingoReceipt,
  emptyBingoSnapshot,
  formatBingoTime,
  readBingoSnapshot,
  type BingoPlan,
  type BingoSnapshot,
} from '../lib/bingo-status';
import './bingo-panel.css';

async function copyClientLink(url: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(url);
    return true;
  } catch {
    return false;
  }
}

function planStatusLabel(plan: BingoPlan): string {
  if (plan.returned) return '已回执';
  return '待评';
}

function PlanFeedbackBlock({ plan }: { plan: BingoPlan }): JSX.Element {
  const feedback = readBingoPlanFeedback(plan);
  const [open, setOpen] = useState(feedback.pinCount > 0);
  const [copyNote, setCopyNote] = useState('');

  const onCopy = async () => {
    const ok = await copyClientLink(plan.clientHref);
    setCopyNote(ok ? '甲方链接已复制' : '请手动复制链接');
  };

  return (
    <article className="sc-bingo-plan-card">
      <header className="sc-bingo-plan-head">
        <button type="button" className="sc-bingo-plan-toggle" aria-expanded={open} onClick={() => setOpen(value => !value)}>
          {open ? <ChevronDown size={18} aria-hidden="true" /> : <ChevronRight size={18} aria-hidden="true" />}
          <span className="sc-bingo-plan-title">
            <strong>{plan.title}</strong>
            <small>{formatBingoTime(plan.markedAt) || '已发出链接'}</small>
          </span>
        </button>
        <span className={`sc-bingo-plan-badge${plan.returned ? ' is-returned' : ''}`}>{planStatusLabel(plan)}</span>
      </header>
      <p className="sc-bingo-plan-summary">{feedbackSummaryLabel(feedback, plan.returned)}</p>
      <div className="sc-bingo-plan-actions">
        <button type="button" onClick={() => void onCopy()}>复制甲方链接</button>
        {copyNote && <span role="status">{copyNote}</span>}
      </div>
      {open && <FeedbackPins feedback={feedback} />}
    </article>
  );
}

function FeedbackPins({ feedback }: { feedback: BingoPlanFeedback }): JSX.Element {
  if (feedback.pins.length === 0) {
    return <p className="sc-bingo-feedback-empty">甲方还没在这份方案的画内落钉。对方打开链接点平面即可留钉评，你会在这里看到汇总。</p>;
  }
  return (
    <ol className="sc-bingo-feedback-list">
      {feedback.pins.map(pin => (
        <li key={pin.id} data-source={pin.source}>
          <article>
            <header>
              <strong>{pin.author}</strong>
              {pin.pinStatus && <span className={`sc-bingo-pin-status is-${pin.pinStatus}`}>{pin.pinStatus === 'resolved' ? '已处理' : '待处理'}</span>}
              {pin.source === 'legacy-comment' && <span className="sc-bingo-pin-legacy">旧侧栏</span>}
              {pin.createdAt && <time dateTime={pin.createdAt}>{formatFeedbackTime(pin.createdAt)}</time>}
            </header>
            {pin.placement && <p className="sc-bingo-pin-place">{pin.placement}</p>}
            <p>{pin.body}</p>
            {pin.replies.length > 0 && (
              <ul>
                {pin.replies.map((reply, index) => (
                  <li key={`${pin.id}-reply-${index}`}>
                    <strong>{reply.author}</strong>
                    <span>{formatFeedbackTime(reply.createdAt)}</span>
                    <p>{reply.body}</p>
                  </li>
                ))}
              </ul>
            )}
          </article>
        </li>
      ))}
    </ol>
  );
}

/**
 * 左栏 Bingo：创作者收甲方反馈。只读钉评汇总，不是第二个评审页。
 */
export function BingoPanel({ onClose, draftNote }: {
  onClose(): void;
  draftNote: { label: string; title: string; error: boolean };
}): JSX.Element {
  const [snapshot, setSnapshot] = useState<BingoSnapshot>(emptyBingoSnapshot);

  const sync = useCallback(() => {
    setSnapshot(readBingoSnapshot(window.localStorage));
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

  const onClearReceipt = () => {
    clearBingoReceipt(window.localStorage);
    sync();
  };

  const phaseLabel = bingoPhaseLabel(snapshot.phase);

  return (
    <aside id="bingo-panel" className="sc-rail-side-panel sc-bingo-panel" aria-label="Bingo · 收反馈">
      <header className="rsp-head">
        <strong>Bingo</strong>
        <span className={`sc-bingo-phase is-${snapshot.phase}`}>{phaseLabel}</span>
        <button type="button" className="rsp-close" aria-label="收起 Bingo" title="收起" onClick={onClose}>
          <X size={20} aria-hidden="true" />
        </button>
      </header>
      <div className="rsp-body sc-bingo-panel-body">
        <p className="sc-bingo-lede" role="note">
          这里只看<strong>甲方反馈</strong>：画内钉评与「完成评审」回执。链接发给对方去 <code>/review</code> 落钉；你在这读汇总，侧栏旧评论仅只读兼容。
        </p>
        <p className={`sc-bingo-draft-note${draftNote.error ? ' has-error' : ''}`} role="status" title={draftNote.title}>
          本机草稿 · {draftNote.label}
        </p>
        {snapshot.receipt && (
          <div className="sc-bingo-receipt-card" role="status">
            <strong>全局回执</strong>
            <p>甲方已在评审页点「完成评审」 · {formatBingoTime(snapshot.receipt.at) || snapshot.receipt.at}</p>
            <p className="sc-bingo-receipt-key">{snapshot.receipt.planKey}</p>
            <button type="button" className="sc-bingo-clear" onClick={onClearReceipt}>清回执</button>
          </div>
        )}
        {snapshot.plans.length > 0 ? (
          <div className="sc-bingo-plan-stack">
            {snapshot.plans.map((plan, index) => (
              <PlanFeedbackBlock key={`${plan.shareId}-${index}`} plan={plan} />
            ))}
          </div>
        ) : (
          <p className="sc-bingo-empty">
            {snapshot.phase === 'to-send'
              ? '还没有发出评审链接。用画布底栏「分享 → 发评审链接」把方案发给甲方，反馈会出现在这里。'
              : snapshot.receipt
                ? '回执已记下。若还需要对齐某份方案的钉评，等甲方在新链接下留言。'
                : '还没有收到可读的甲方反馈。'}
          </p>
        )}
      </div>
    </aside>
  );
}
