'use client';

import { Check, ChevronDown, ChevronRight, Copy, ExternalLink, MessageSquare, ShieldCheck, Trash2 } from '@/components/solid-icons';
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

/**
 * Bingo 的审计位：3.0.0 左栏「收甲方反馈」并进对话后留下的只读记录。
 * 只读本机评审钉与完成回执，不在这里发链接、写评论或完成评审。
 */
export function BingoAuditCard(): JSX.Element | null {
  const [snapshot, setSnapshot] = useState<BingoSnapshot>(emptyBingoSnapshot);

  const sync = useCallback(() => {
    setSnapshot(readBingoSnapshot(typeof window === 'undefined' ? null : window.localStorage));
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

  if (snapshot.plans.length === 0 && !snapshot.receipt) return null;
  const onClearReceipt = () => {
    clearBingoReceipt(window.localStorage);
    sync();
  };

  return <section className="ap-card ap-audit" aria-label="甲方评审记录">
    <header className="ap-audit-head">
      <ShieldCheck size={16} aria-hidden="true"/>
      <strong>甲方评审</strong>
      <span className={`ap-audit-phase is-${snapshot.phase}`}>{bingoPhaseLabel(snapshot.phase)}</span>
      {snapshot.receipt && <button type="button" className="ap-icon-btn ap-audit-clear" aria-label="清回执" title="清回执" onClick={onClearReceipt}><Trash2 size={14} aria-hidden="true"/></button>}
    </header>
    {snapshot.receipt && <p className="ap-audit-receipt"><Check size={14} aria-hidden="true"/><time dateTime={snapshot.receipt.at}>{formatBingoTime(snapshot.receipt.at) || snapshot.receipt.at}</time></p>}
    {snapshot.plans.map((plan, index) => <AuditPlan key={`${plan.shareId}-${index}`} plan={plan}/>)}
  </section>;
}

function AuditPlan({ plan }: { plan: BingoPlan }): JSX.Element {
  const feedback = readBingoPlanFeedback(plan);
  const [open, setOpen] = useState(feedback.pinCount > 0);
  const [copied, setCopied] = useState(false);
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(new URL(plan.clientHref, window.location.origin).toString());
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };
  return <article className="ap-audit-plan">
    <button type="button" className="ap-audit-toggle" aria-expanded={open} onClick={() => setOpen(value => !value)}>
      {open ? <ChevronDown size={14} aria-hidden="true"/> : <ChevronRight size={14} aria-hidden="true"/>}
      <span className="ap-audit-title">{plan.title}</span>
      <span className={`ap-audit-badge${plan.returned ? ' is-returned' : ''}`}>{plan.returned ? '已回执' : '待评'}</span>
    </button>
    <p className="ap-audit-meta">
      <MessageSquare size={13} aria-hidden="true"/>
      <span>{feedback.pinCount}</span>
      <small>{feedbackSummaryLabel(feedback, plan.returned)}</small>
      <button type="button" className="ap-audit-link" aria-label={copied ? '甲方链接已复制' : '复制甲方链接'} title="复制甲方链接" onClick={() => { void copyLink(); }}>
        {copied ? <Check size={13} aria-hidden="true"/> : <Copy size={13} aria-hidden="true"/>}
      </button>
      <a className="ap-audit-link" href={plan.clientHref} aria-label="打开评审页" title="打开评审页"><ExternalLink size={13} aria-hidden="true"/></a>
    </p>
    {open && <AuditPins feedback={feedback}/>}
  </article>;
}

function AuditPins({ feedback }: { feedback: BingoPlanFeedback }): JSX.Element {
  if (feedback.pins.length === 0) return <p className="ap-audit-empty">还没有甲方钉评</p>;
  return <ol className="ap-audit-pins">
    {feedback.pins.map(pin => <li key={pin.id}>
      <p className="ap-audit-pin-head">
        <strong>{pin.author}</strong>
        {pin.pinStatus && <span className={`ap-audit-pin-status is-${pin.pinStatus}`}>{pin.pinStatus === 'resolved' ? '已处理' : '待处理'}</span>}
        {pin.createdAt && <time dateTime={pin.createdAt}>{formatFeedbackTime(pin.createdAt)}</time>}
      </p>
      {pin.placement && <p className="ap-audit-place">{pin.placement}</p>}
      <p>{pin.body}</p>
      {pin.replies.length > 0 && <ul>
        {pin.replies.map((reply, index) => <li key={`${pin.id}-${index}`}>
          <p className="ap-audit-pin-head"><strong>{reply.author}</strong>{reply.createdAt && <time dateTime={reply.createdAt}>{formatFeedbackTime(reply.createdAt)}</time>}</p>
          <p>{reply.body}</p>
        </li>)}
      </ul>}
    </li>)}
  </ol>;
}
