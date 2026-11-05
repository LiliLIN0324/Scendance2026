'use client';

import { Check, ChevronDown, ChevronRight, Copy, ExternalLink, MessageSquare, ShieldCheck, Trash2 } from '@/components/solid-icons';
import { useCallback, useEffect, useState } from 'react';
import { violationCodeLabel, type BingoScore } from '../../../lib/bingo-score';
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
import { useGenerationOutcome } from '../lib/use-generation-outcome';

/**
 * Bingo 审计卡可由主调用方注入的「完成卡 Z8」字段。
 * 全部可选；不传时卡片回退到旧行为（只显示甲方评审钉评）。
 */
export interface BingoAuditCardProps {
  /** 体检量化分；不传则不渲染体检分区。 */
  score?: BingoScore;
  /** AI 解释「为什么这么摆」。 */
  reasoning?: string;
  /** 给用户的现场搭建建议。 */
  suggestion?: string;
  /** 本次生成耗时（毫秒）。 */
  durationMs?: number;
  /** AI 思考轮数。 */
  rounds?: number;
}

const BREAKDOWN_ITEMS: ReadonlyArray<{ key: keyof BingoScore['breakdown']; label: string }> = [
  { key: 'spacing', label: '间距' },
  { key: 'aisle', label: '通道' },
  { key: 'bounds', label: '出界' },
  { key: 'wall', label: '压墙' },
];

function breakdownColor(value: number): string {
  if (value >= 95) return '#4A7C59';
  if (value >= 60) return '#C9A96E';
  return '#C0392B';
}

function formatDuration(ms: number | undefined): string {
  if (ms === undefined || Number.isNaN(ms)) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Bingo 的审计位：3.0.0 左栏「收甲方反馈」并进对话后留下的只读记录。
 * 只读本机评审钉与完成回执，不在这里发链接、写评论或完成评审。
 *
 * 第 7 批收尾：新增体检分区（score 注入时）、Z8 完成卡字段、被拒件人话列表、页脚常驻 disclaimer。
 */
export function BingoAuditCard(props: BingoAuditCardProps = {}): JSX.Element | null {
  const { score, reasoning, suggestion, durationMs, rounds } = props;
  const [snapshot, setSnapshot] = useState<BingoSnapshot>(emptyBingoSnapshot);
  const { outcome, summary } = useGenerationOutcome();

  // 第 7 批收尾：完成卡字段优先取调用方注入的 props，
  // 没有就回落到本次 Outcome 携带的 report（生成完成时由 room-organizer 写入）。
  const report = outcome?.report;
  const effectiveScore = score ?? report?.score;
  const effectiveReasoning = reasoning ?? report?.reasoning;
  const effectiveSuggestion = suggestion ?? report?.suggestion;
  const effectiveDuration = durationMs ?? report?.durationMs;
  const effectiveRounds = rounds ?? report?.rounds;
  // report 里的耗时只覆盖「落盘 + 体检」这一段，行标题据此写准，不冒充整轮生成耗时。
  const durationLabel = durationMs === undefined && report?.durationMs !== undefined ? '落盘耗时' : '耗时';

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

  const hasAuditRecord = snapshot.plans.length > 0 || Boolean(snapshot.receipt);
  // 完成卡只在真的有完成卡字段时才出现：光有 Outcome 不开块，
  // 否则「改了件数」会和上面的「本次结果」摘要重复说同一件事。
  const hasZ8 = Boolean(effectiveScore) || effectiveRounds !== undefined || effectiveDuration !== undefined
    || Boolean(effectiveReasoning) || Boolean(effectiveSuggestion);
  if (!hasAuditRecord && !hasZ8) return null;
  const onClearReceipt = () => {
    clearBingoReceipt(window.localStorage);
    sync();
  };

  const placedCount = outcome?.placed.length ?? effectiveScore?.itemCount ?? 0;
  const refusedList = outcome?.refused ?? [];

  return <section className="ap-card ap-audit" aria-label="甲方评审记录">
    <header className="ap-audit-head">
      <ShieldCheck size={16} aria-hidden="true"/>
      <strong>甲方评审</strong>
      <span className={`ap-audit-phase is-${snapshot.phase}`}>{bingoPhaseLabel(snapshot.phase)}</span>
      {snapshot.receipt && <button type="button" className="ap-icon-btn ap-audit-clear" aria-label="清回执" title="清回执" onClick={onClearReceipt}><Trash2 size={14} aria-hidden="true"/></button>}
    </header>

    {effectiveScore && <p className="ap-audit-scope">体检按整张场地计算</p>}

    {effectiveScore && <div className="ap-audit-score" data-testid="bingo-score">
      <div className="ap-audit-score-total">
        <span className="ap-audit-score-num" style={{ color: breakdownColor(effectiveScore.total) }}>{effectiveScore.total}</span>
        <span className="ap-audit-score-label">体检分</span>
      </div>
      <div className="ap-audit-score-breakdown">
        {BREAKDOWN_ITEMS.map((item) => {
          const value = effectiveScore.breakdown[item.key];
          return (
            <div key={item.key} className="ap-audit-break">
              <span className="ap-audit-break-label">{item.label}</span>
              <div className="ap-audit-break-bar">
                <div
                  className="ap-audit-break-fill"
                  style={{ width: `${value}%`, background: breakdownColor(value) }}
                />
              </div>
              <span className="ap-audit-break-num">{value}</span>
            </div>
          );
        })}
      </div>
      <p className="ap-audit-score-summary">{effectiveScore.summary}</p>
    </div>}

    {snapshot.receipt && <p className="ap-audit-receipt"><Check size={14} aria-hidden="true"/><time dateTime={snapshot.receipt.at}>{formatBingoTime(snapshot.receipt.at) || snapshot.receipt.at}</time></p>}
    {outcome && <p className="ap-audit-outcome" role="status"><strong>本次结果：</strong>{summary}</p>}

    {hasZ8 && <div className="ap-audit-z8" data-testid="bingo-z8">
      <div className="ap-audit-z8-row">
        <span className="ap-audit-z8-key">改动件数</span>
        <span className="ap-audit-z8-val">放了 {placedCount} 件</span>
      </div>
      {effectiveRounds !== undefined && (
        <div className="ap-audit-z8-row">
          <span className="ap-audit-z8-key">思考轮数</span>
          <span className="ap-audit-z8-val">{effectiveRounds} 轮</span>
        </div>
      )}
      {effectiveDuration !== undefined && (
        <div className="ap-audit-z8-row">
          <span className="ap-audit-z8-key">{durationLabel}</span>
          <span className="ap-audit-z8-val">{formatDuration(effectiveDuration)}</span>
        </div>
      )}
      {effectiveReasoning !== undefined && (
        <div className="ap-audit-z8-row">
          <span className="ap-audit-z8-key">为什么这么摆</span>
          <span className="ap-audit-z8-val">{effectiveReasoning}</span>
        </div>
      )}
      {effectiveSuggestion !== undefined && (
        <div className="ap-audit-z8-row">
          <span className="ap-audit-z8-key">后续建议</span>
          <span className="ap-audit-z8-val">{effectiveSuggestion}</span>
        </div>
      )}
    </div>}

    {refusedList.length > 0 && <div className="ap-audit-refused" data-testid="bingo-refused">
      <p className="ap-audit-refused-title">被拒件（{refusedList.length}）</p>
      <ul>
        {refusedList.map((entry, index) => (
          <li key={index} className="ap-audit-refused-row">
            <code className="ap-audit-refused-id">{String((entry.item as { id?: unknown }).id ?? index)}</code>
            <span className="ap-audit-refused-reason">{violationCodeLabel(entry.code)}</span>
          </li>
        ))}
      </ul>
    </div>}

    {hasAuditRecord && snapshot.plans.map((plan, index) => <AuditPlan key={`${plan.shareId}-${index}`} plan={plan}/>)}

    <p className="ap-audit-disclaimer">我会出错，也可能破坏你的设计。请在交付前亲自巡场一遍。</p>
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
