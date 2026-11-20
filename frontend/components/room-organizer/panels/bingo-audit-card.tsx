'use client';

import { ArrowUp, Check, ChevronDown, ChevronRight, Copy, ExternalLink, MapPin, MessageSquare, RotateCw, Trash2 } from '@/components/solid-icons';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import {inspectReviewFeedbackReceipt,type ReceiptPin} from '@/components/review-share-page/review-feedback-receipt';
import {importReviewFeedback,readImportedReviewFeedback} from '@/components/review-share-page/review-feedback-storage';
import {readReviewLink,reviewCodeFromHash} from '@/components/review-share-page/review-link-cloud';
import {readShareHash} from '../lib/share';
import { violationCodeLabel, type BingoScore } from '../../../lib/bingo-score';
import {
  countOpenFeedbackPins,
  feedbackSummaryLabel,
  formatFeedbackTime,
  mergeBingoCloudPins,
  readBingoPlanFeedback,
  reviewPlanKeysForBingoPlan,
  type BingoFeedbackPin,
  type BingoPlanFeedback,
} from '../lib/bingo-feedback';
import { listReviewPinsCloud, setReviewPinStatusCloud } from '../../review-share-page/review-pins-cloud';
import { setReviewSharePinStatus } from '../../review-share-page/share-pins';
import type { ReviewPin } from '../lib/review-pins';
import {
  bingoPhaseLabel,
  clearBingoReceipt,
  emptyBingoSnapshot,
  formatBingoTime,
  readBingoSnapshot,
  type BingoPlan,
  type BingoSnapshot,
} from '../lib/bingo-status';
import { getOutdoorPlanIssues, getOutdoorPlanSettled, requestOutdoorPlanIssueFocus, requestOutdoorPlanPointFocus, subscribeOutdoorPlanIssues } from '../lib/outdoor-plan-issues';
import { BingoStatusMark, useBingoSending } from './bingo-status-mark';
import { useGenerationOutcome } from '../lib/use-generation-outcome';
import {REVIEW_MARK_CHANGED_EVENT} from '../lib/review-share';
import {useLayoutStore} from '../hooks/use-layout-store';
import {outcomeSummary} from '@/lib/generation-outcome';
import {isStructuralMarker} from '../lib/structural-layout';
import type {FurnitureItem} from '../lib/types';
import {sameRecoveryFormValue} from '@/lib/recovery-form-value';

/**
 * Bingo 审计卡可由主调用方注入的「完成卡 Z8」字段。
 * 全部可选；不传时卡片回退到旧行为（只显示甲方评审钉评）。
 */
export interface BingoReviewActions {
  onRecheck(): void;
  onSendReview(): void;
}

export interface BingoAuditCardProps {
  /** 重新检查与发给客户评审。缺省时不画工具栏（卡片单测不接 Agent）。 */
  reviewActions?: BingoReviewActions;
  /** 体检量化分；不传则不渲染体检分区。 */
  score?: BingoScore;
  /** 活动身份与同步代次由工作台提供；缺失时禁止导入。 */
  scopeKey?: string | undefined;
  isCurrent?: (()=>boolean) | undefined;
  /** AI 解释「为什么这么摆」。 */
  reasoning?: string;
  /** 给用户的现场搭建建议。 */
  suggestion?: string;
  /** 本次生成耗时（毫秒）。 */
  durationMs?: number;
  /** AI 思考轮数。 */
  rounds?: number;
}

const REVIEW_ROW_PREVIEW = 4;
const CORRIDOR_TITLE = /^「[^」]*」的通行带（宽 [^）]*）与设施「([^」]+)」占地相交。?$/;
const CATEGORY_TITLE = /^(?:⚠|缺|核)\s+([^：]+)：([\s\S]+)$/;

export function reviewIssueTitle(text: string): { category: string; title: string } {
  const matched = CATEGORY_TITLE.exec(text.trim());
  const category = matched?.[1] ?? '其他问题';
  const message = (matched?.[2] ?? text).replace(/\s+/g, ' ').trim();
  const facility = CORRIDOR_TITLE.exec(message);
  return { category, title: facility ? `${facility[1]} 压到通行带` : message };
}

export interface ReviewIssueGroup {
  category: string;
  rows: { key: string; title: string; text: string }[];
}

export function reviewIssueGroups(issues: readonly { key: string; text: string }[]): ReviewIssueGroup[] {
  const groups = new Map<string, ReviewIssueGroup>();
  const order: string[] = [];
  for (const issue of issues) {
    const { category, title } = reviewIssueTitle(issue.text);
    let group = groups.get(category);
    if (!group) {
      group = { category, rows: [] };
      groups.set(category, group);
      order.push(category);
    }
    group.rows.push({ key: issue.key, title, text: issue.text });
  }
  return order.map(category => groups.get(category)!);
}

export function settledLayers(settled: { boundaryClosed: boolean; zoneCount: number; routeCount: number }): { count: number; aside: string } {
  const parts: string[] = [];
  if (settled.boundaryClosed) parts.push('红线');
  if (settled.zoneCount > 0) parts.push(`分区 ${settled.zoneCount}`);
  if (settled.routeCount > 0) parts.push(`动线 ${settled.routeCount}`);
  return { count: parts.length, aside: parts.join(' · ') };
}

function usableReviewHref(plans: readonly BingoPlan[]): string {
  for (const plan of plans) {
    if (plan.linkStatus === 'unavailable') continue;
    const href = plan.clientHref.trim();
    if (!href || href === '/review/' || href === '/review') continue;
    return href;
  }
  return '';
}

function PriorityMark(): JSX.Element {
  return <svg className="ap-review-priority" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" focusable="false">
    <rect x="0.75" y="0.75" width="12.5" height="12.5" rx="3" fill="currentColor"/>
    <path d="M7 3.35v4.15" stroke="#fff" strokeWidth="1.35" strokeLinecap="round"/>
    <circle cx="7" cy="10.15" r="0.8" fill="#fff"/>
  </svg>;
}

function ReviewGroup({ open, onToggle, mark, title, count, aside, children }: {
  open: boolean;
  onToggle(): void;
  mark: ReactNode;
  title: string;
  count: number;
  aside?: string;
  children?: ReactNode;
}): JSX.Element {
  return <div className="ap-review-block">
    <button type="button" className="ap-review-group" aria-expanded={open} onClick={onToggle}>
      <span className="ap-review-chevron">{open ? <ChevronDown size={12} aria-hidden="true"/> : <ChevronRight size={12} aria-hidden="true"/>}</span>
      <span className="ap-review-mark">{mark}</span>
      <span className="ap-review-title">{title}</span>
      <span className="ap-review-count">{count}</span>
      {aside ? <span className="ap-review-aside">{aside}</span> : null}
    </button>
    {open ? children : null}
  </div>;
}

function formatDuration(ms: number | undefined): string {
  if (ms === undefined || Number.isNaN(ms)) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/** 经典案例记录必须与真甲方评审分开：只认标题或链接里的明确标记。 */
function isDemoPlan(plan: BingoPlan): boolean {
  const hay = `${plan.title}\n${plan.clientHref}`.toLowerCase();
  return /案例|演示|scotiabank/.test(hay) || /(^|[\/\-_])demo([\/\-_?]|$)/.test(hay);
}

/**
 * Bingo 的审校位：创作者视角的「我的完成 + 对方的修改」。
 *
 * 只读本机评审钉、完成回执与画布发布的问题清单；发链接走右上角分享，
 * 这里不再并列体检 / 评审 / 钉评三颗按钮，也不再承担全案统计与图例。
 */
export function BingoAuditCard(props: BingoAuditCardProps = {}): JSX.Element | null {
  const { score, durationMs, rounds, scopeKey, isCurrent, reviewActions } = props;
  const [snapshot, setSnapshot] = useState<BingoSnapshot>(emptyBingoSnapshot);
  const { outcome } = useGenerationOutcome();
  const issues = useSyncExternalStore(subscribeOutdoorPlanIssues, getOutdoorPlanIssues, getOutdoorPlanIssues);
  const settled = useSyncExternalStore(subscribeOutdoorPlanIssues, getOutdoorPlanSettled, getOutdoorPlanSettled);
  const sendingNow = useBingoSending();
  const [armed, setArmed] = useState(false);
  const [settledOpen, setSettledOpen] = useState(false);
  const [openGroups, setOpenGroups] = useState<ReadonlySet<string>>(() => new Set(['通行带压设施']));
  const [feedbackOpen, setFeedbackOpen] = useState(true);
  const [linkCopied, setLinkCopied] = useState(false);
  useEffect(() => { setArmed(true); }, []);
  const isMaterial=(item:unknown)=>!item||typeof item!=='object'||!isStructuralMarker(item as FurnitureItem);
  const visibleOutcome=outcome?{...outcome,placed:outcome.placed.filter(isMaterial),removed:outcome.removed?.filter(isMaterial),
    refused:outcome.refused.filter(entry=>isMaterial(entry.item)),skipped:outcome.skipped.filter(entry=>isMaterial(entry.item))}:null;
  const summary=visibleOutcome?outcomeSummary(visibleOutcome):'';
  const currentLayout=useLayoutStore(state=>state.layout),currentRevision=useLayoutStore(state=>state.revision);
  let outcomeCurrent=false;
  try {outcomeCurrent=!!outcome&&outcome.appliedLayout!==undefined&&outcome.appliedRevision===currentRevision&&sameRecoveryFormValue(outcome.appliedLayout,currentLayout);} catch { /* 无法比较时保守视为历史。 */ }

  // 第 7 批收尾：完成卡字段优先取调用方注入的 props，
  // 没有就回落到本次 Outcome 携带的 report（生成完成时由 room-organizer 写入）。
  const report = outcome?.report;
  const effectiveScore = score ?? report?.score;
  const effectiveDuration = durationMs ?? report?.durationMs;
  const effectiveRounds = rounds ?? report?.rounds;
  // report 里的耗时只覆盖「落盘 + 体检」这一段，行标题据此写准，不冒充整轮生成耗时。
  const durationLabel = durationMs === undefined && report?.durationMs !== undefined ? '落盘耗时' : '耗时';

  const sync = useCallback(() => {
    try { setSnapshot(readBingoSnapshot(typeof window === 'undefined' ? null : window.localStorage)); }
    catch { setSnapshot(emptyBingoSnapshot()); }
  }, []);

  useEffect(() => {
    sync();
    const onStore = () => sync();
    window.addEventListener('storage', onStore);
    window.addEventListener(REVIEW_MARK_CHANGED_EVENT, onStore);
    window.addEventListener('focus', onStore);
    document.addEventListener('visibilitychange', onStore);
    return () => {
      window.removeEventListener('storage', onStore);
      window.removeEventListener(REVIEW_MARK_CHANGED_EVENT, onStore);
      window.removeEventListener('focus', onStore);
      document.removeEventListener('visibilitychange', onStore);
    };
  }, [sync]);

  const hasAuditRecord = snapshot.plans.length > 0 || Boolean(snapshot.receipt);
  // 完成卡只在真的有完成卡字段时才出现：光有 Outcome 不开块，
  // 否则「改了件数」会和上面的「本次结果」摘要重复说同一件事。
  const hasZ8 = Boolean(effectiveScore) || effectiveRounds !== undefined || effectiveDuration !== undefined;
  const placedCount = visibleOutcome?.placed.length ?? 0;
  const refusedList = visibleOutcome?.refused ?? [];
  const hasDiagnostics = Boolean(effectiveScore) || Boolean(outcome) || refusedList.length > 0 || hasZ8;
  useEffect(() => { if (hasDiagnostics) setSettledOpen(true); }, [hasDiagnostics]);

  const onClearReceipt = () => {
    clearBingoReceipt(window.localStorage);
    sync();
  };

  const cloudKey = snapshot.plans.map(plan => plan.reviewPlanKey).join('|');
  const [cloudByKey, setCloudByKey] = useState<Record<string, ReviewPin[]>>({});
  const [cloudTick, setCloudTick] = useState(0);
  useEffect(() => {
    const bump = () => { if (document.visibilityState === 'visible') setCloudTick(value => value + 1); };
    window.addEventListener('focus', bump);
    document.addEventListener('visibilitychange', bump);
    return () => {
      window.removeEventListener('focus', bump);
      document.removeEventListener('visibilitychange', bump);
    };
  }, []);
  useEffect(() => {
    let alive = true;
    const keys = [...new Set(snapshot.plans.flatMap(plan => reviewPlanKeysForBingoPlan(plan)).filter(key => key.startsWith('review-v2:')))];
    if (keys.length === 0) { setCloudByKey({}); return () => { alive = false; }; }
    void Promise.all(keys.map(async key => [key, await listReviewPinsCloud(key)] as const)).then(rows => {
      if (!alive) return;
      const next: Record<string, ReviewPin[]> = {};
      for (const [key, result] of rows) next[key] = result.ok ? result.value : [];
      setCloudByKey(next);
    });
    return () => { alive = false; };
  }, [cloudKey, cloudTick, snapshot.plans]);
  const plansWithFeedback = snapshot.plans.map(plan => ({
    plan,
    feedback: mergeBingoCloudPins(
      readBingoPlanFeedback(plan),
      reviewPlanKeysForBingoPlan(plan).flatMap(key => cloudByKey[key] ?? []),
    ),
  }));
  const feedbackRows = plansWithFeedback.flatMap(({ feedback }) => feedback.pins);
  const pinCount = plansWithFeedback.reduce((sum, entry) => sum + entry.feedback.pinCount, 0);
  const openPinCount = plansWithFeedback.reduce((sum, entry) => sum + countOpenFeedbackPins(entry.feedback), 0);
  // 系统问题只算能落到这张图上、且还没收尾的；被拒件也是我要处理的事。
  const todoCount = issues.length + refusedList.length;
  const phaseLabel = bingoPhaseLabel(snapshot.phase);
  const statusTail = todoCount > 0 ? `还剩 ${todoCount} 件要收尾` : '我要收尾的已处理完';
  const statusOther = openPinCount > 0 ? `对方提了 ${openPinCount} 条修改` : '还没有对方的修改';
  const statusText = `${phaseLabel} ${statusTail} · ${statusOther}`;
  const layers = settledLayers(settled);
  const issueGroups = reviewIssueGroups(issues);
  const reviewHref = usableReviewHref(snapshot.plans);
  const shownFeedback = feedbackRows.slice(0, REVIEW_ROW_PREVIEW);
  const copyReviewLink = () => {
    if (!reviewHref) return;
    void navigator.clipboard.writeText(new URL(reviewHref, window.location.origin).toString()).then(() => {
      setLinkCopied(true);
      window.setTimeout(() => setLinkCopied(false), 1600);
    }).catch(() => setLinkCopied(false));
  };
  const toggleGroup = (category: string) => {
    setOpenGroups(current => {
      const next = new Set(current);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  };

  return <section className="ap-review" aria-label="我的完成与对方的修改">
    <p className="ap-review-status" data-testid="bingo-review-status">
      <BingoStatusMark phase={snapshot.phase} sending={sendingNow && snapshot.phase !== 'returned'} size={14} armed={armed} />
      <span>{statusText}</span>
    </p>
    {reviewActions && <div className="ap-review-toolbar" aria-label="审校动作">
      <button type="button" className="ap-review-tool" onClick={reviewActions.onRecheck}>
        <RotateCw size={14} aria-hidden="true"/>重新检查
      </button>
      {reviewHref
        ? <>
          <button type="button" className="ap-review-tool" onClick={copyReviewLink}>
            {linkCopied ? <Check size={14} aria-hidden="true"/> : <Copy size={14} aria-hidden="true"/>}{linkCopied ? '已复制' : '复制评审链接'}
          </button>
          <a className="ap-review-tool" href={reviewHref} target="_blank" rel="noreferrer">
            <ExternalLink size={14} aria-hidden="true"/>查看评审页
          </a>
        </>
        : <button type="button" className="ap-review-tool is-send" onClick={reviewActions.onSendReview}>
          <ArrowUp size={14} aria-hidden="true"/>发给客户评审
        </button>}
    </div>}

    <p className="ap-review-kicker">我的完成</p>
    <ReviewGroup
      open={settledOpen}
      onToggle={() => setSettledOpen(value => !value)}
      mark={<BingoStatusMark phase="returned" size={14} armed={false} />}
      title="已落实"
      count={layers.count}
      aside={layers.aside}
    >
      {hasDiagnostics ? <div className="ap-review-detail">
        {effectiveScore && <>
          <p className="ap-audit-score-title">系统体检结果</p>
          <div className="ap-audit-score" data-testid="bingo-score">
            <p>几何检查：{effectiveScore.itemCount === 0 ? '还没有可检查的已建模物件' : effectiveScore.failedCount > 0 ? `${effectiveScore.failedCount} 件待处理` : '已通过'}</p>
            <p className="ap-audit-scope">只核对已建模几何；消防、无障碍与现场条件需另行核验。</p>
          </div>
        </>}
        {outcome && <p className="ap-audit-outcome" role="status"><strong>{outcomeCurrent?'本次结果：':'历史操作结果（当前布局已变化或无法核对）：'}</strong>{summary}</p>}
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
          <div className="ap-audit-z8-row"><span className="ap-audit-z8-key">后续建议</span><span className="ap-audit-z8-val">请核对实际出入口、通行净宽及现场条件，消防与无障碍要求需另行核验。</span></div>
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
      </div> : null}
    </ReviewGroup>

    {issueGroups.map(group => {
      const open = openGroups.has(group.category);
      const shown = group.rows.slice(0, REVIEW_ROW_PREVIEW);
      const rest = group.rows.length - shown.length;
      return <ReviewGroup
        key={group.category}
        open={open}
        onToggle={() => toggleGroup(group.category)}
        mark={<PriorityMark />}
        title={group.category}
        count={group.rows.length}
      >
        <>
          {shown.map(row => <button key={row.key} type="button" className="ap-review-row" title={row.text} onClick={() => requestOutdoorPlanIssueFocus(row.key)}>
            <span className="ap-review-icons"><PriorityMark /><MapPin className="ap-review-pin" size={14} aria-hidden="true"/></span>
            <span className="ap-review-title">{row.title}</span>
          </button>)}
          {rest > 0 && <p className="ap-review-more">还有 {rest} 处，点开一条飞到地图</p>}
        </>
      </ReviewGroup>;
    })}

    <ReviewGroup
      open={feedbackOpen}
      onToggle={() => setFeedbackOpen(value => !value)}
      mark={<MessageSquare size={14} aria-hidden="true"/>}
      title="对方的修改"
      count={pinCount}
    >
      {pinCount === 0
        ? <p className="ap-review-empty"><MessageSquare size={14} aria-hidden="true"/>还没有对方的修改</p>
        : <>
          {shownFeedback.map(pin => {
            const title = pin.body.trim() || pin.placement || '未写意见';
            const locatable = typeof pin.x === 'number' && typeof pin.z === 'number';
            const mark = <span className="ap-review-icons"><MessageSquare size={14} aria-hidden="true"/><MapPin className="ap-review-pin" size={14} aria-hidden="true"/></span>;
            return locatable
              ? <button key={pin.id} type="button" className="ap-review-row" onClick={() => requestOutdoorPlanPointFocus(pin.x as number, pin.z as number)}>
                {mark}<span className="ap-review-title">{title}</span>
              </button>
              : <div key={pin.id} className="ap-review-row">{mark}<span className="ap-review-title">{title}</span></div>;
          })}
          {feedbackRows.length > shownFeedback.length && <p className="ap-review-more">还有 {feedbackRows.length - shownFeedback.length} 处，点开一条飞到地图</p>}
        </>}
    </ReviewGroup>

    {hasAuditRecord && <details className="ap-audit-records">
      <summary>本机评审记录</summary>
      {snapshot.receipt && <><button type="button" className="ap-icon-btn ap-audit-clear" aria-label="清回执" title="清回执" onClick={onClearReceipt}><Trash2 size={14} aria-hidden="true"/></button><p className="ap-audit-receipt"><Check size={14} aria-hidden="true"/>本机旧回执，未核对当前版本 · <time dateTime={snapshot.receipt.at}>{formatBingoTime(snapshot.receipt.at) || snapshot.receipt.at}</time></p></>}
      {snapshot.plans.map((plan, index) => <AuditPlan key={`${plan.shareId}-${index}`} plan={plan} ordinal={index + 1} scopeKey={scopeKey} isCurrent={isCurrent}/>)}
    </details>}

    <p className="ap-audit-disclaimer">我会出错，也可能破坏你的设计。请在交付前亲自巡场一遍。</p>
  </section>;
}

function AuditPlan({ plan, ordinal, scopeKey, isCurrent }: { plan: BingoPlan;ordinal:number;scopeKey?:string|undefined;isCurrent?:(()=>boolean)|undefined }): JSX.Element {
  const alive=useRef(true), latest=useRef({plan,scopeKey,isCurrent});latest.current={plan,scopeKey,isCurrent};
  const [preview,setPreview]=useState<{json:string;hash:string;pins:ReceiptPin[];completed:boolean;duplicates:number;floorNames:Record<string,string>}|null>(null);
  const [saved,setSaved]=useState<{pins:ReceiptPin[];reportedCompleted:boolean;floorNames:Record<string,string>}|null>(null);
  const [pending,setPending]=useState(false),[unknown,setUnknown]=useState(false),[notice,setNotice]=useState('');
  const sequence=useRef(0);
  useEffect(()=>{alive.current=true;return ()=>{alive.current=false;sequence.current++;};},[]);
  useEffect(()=>{sequence.current++;setPreview(null);setSaved(null);setPending(false);setUnknown(false);setNotice('');},[plan.clientHref,plan.projectKey,scopeKey]);
  const capture=()=>{const captured={url:plan.clientHref,project:plan.projectKey,scope:scopeKey,guard:isCurrent};
    return ()=>{try{return alive.current&&!!captured.guard&&captured.guard()&&captured.scope===`activity:${captured.project}`&&latest.current.scopeKey===captured.scope&&latest.current.plan.clientHref===captured.url&&latest.current.plan.projectKey===captured.project&&readBingoSnapshot(window.localStorage).plans.some(p=>p.projectKey===captured.project&&p.clientHref===captured.url);}catch{return false;}};};
  const eligible=!!isCurrent&&scopeKey===`activity:${plan.projectKey}`&&plan.projectKey!=='local-draft'&&plan.linkStatus==='needs-verification';
  async function shareHash():Promise<string> {
    const hash=new URL(plan.clientHref,window.location.origin).hash;
    if(hash.startsWith('#layout='))return hash;
    const code=reviewCodeFromHash(hash);
    if(code){const record=await readReviewLink(code);if(record.ok)return record.value.longHash;}
    throw new Error('缺少完整分享链接，无法核对版本。');
  }
  useEffect(()=>{
    if(!eligible)return;const valid=capture(),id=sequence.current;
    void (async()=>{try{if(!valid())return;const hash=await shareHash();const stored=await readImportedReviewFeedback(window.localStorage,hash);if(!valid()||sequence.current!==id)return;
      const decoded=await readShareHash(hash);if(!decoded.ok||!valid()||sequence.current!==id)return;
      if(stored.pins.length||stored.reportedCompleted)setSaved({...stored,floorNames:Object.fromEntries(decoded.layout.floors.map((floor,index)=>[floor.id,floor.name||`第 ${index+1} 层`]))});
    }catch{/* 无法读取时不把旧记录当成已导入。 */}})();
  },[plan.clientHref,plan.projectKey,scopeKey,eligible]);
  async function inspect(file:File|undefined):Promise<void>{
    if(!file||pending||unknown)return;const valid=capture(),id=++sequence.current;
    if(!valid()){setNotice('活动或分享记录已变化，无法导入。');return;}
    if(file.size>256_000){setNotice('反馈文件超过 256 KB，未读取。');return;}
    setPending(true);setPreview(null);setNotice('');
    try {const hash=await shareHash(),json=await file.text();if(!valid()||sequence.current!==id)return;
      const stored=await readImportedReviewFeedback(window.localStorage,hash);if(!valid()||sequence.current!==id)return;
      const result=await inspectReviewFeedbackReceipt(json,hash,stored.pins);if(!valid()||sequence.current!==id)return;
      const decoded=await readShareHash(hash);if(!decoded.ok)throw new Error('分享方案无法读取，不能导入反馈。');if(!valid()||sequence.current!==id)return;
      const floorNames=Object.fromEntries(decoded.layout.floors.map((floor,index)=>[floor.id,floor.name||`第 ${index+1} 层`]));
      setPreview({json,hash,pins:result.receipt.pins,completed:result.receipt.completed,duplicates:result.duplicates,floorNames});
    }catch(error){if(valid()&&sequence.current===id)setNotice(error instanceof Error?error.message:'反馈无法核对，未导入。');}
    finally{if(valid()&&sequence.current===id)setPending(false);}
  }
  async function applyFeedback():Promise<void>{
    if(!preview||pending||unknown)return;const valid=capture(),id=++sequence.current,selected=preview;
    if(!valid()){setNotice('活动或分享记录已变化，未导入。');return;}
    setPending(true);setNotice('');
    try{const result=await importReviewFeedback(window.localStorage,selected.json,selected.hash,undefined,valid);
      if(result.state==='unknown'){if(alive.current){setUnknown(true);setPreview(null);setNotice('导入结果暂时无法确认，请保留反馈文件并核对本机记录，暂不要重复导入。');}return;}
      if(!valid()||sequence.current!==id)return;
      const current=await readImportedReviewFeedback(window.localStorage,selected.hash);if(!valid()||sequence.current!==id)return;
      setSaved({...current,floorNames:selected.floorNames});setPreview(null);setNotice(`已导入 ${result.added} 条，${result.duplicates} 条已存在。`);
    }catch{if(valid()&&sequence.current===id){setUnknown(true);setPreview(null);setNotice('导入结果暂时无法确认，请保留反馈文件并核对本机记录，暂不要重复导入。');}}
    finally{if(valid()&&sequence.current===id)setPending(false);}
  }

  // G4：远端钉异步并进本机汇总，跨设备评审也能在 Bingo 里看到。
  const [cloudPins, setCloudPins] = useState<ReviewPin[]>([]);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const reloadCloud = useCallback(async (): Promise<ReviewPin[]> => {
    const keys = reviewPlanKeysForBingoPlan(plan).filter(key => key.startsWith('review-v2:'));
    const results = await Promise.all(keys.map(key => listReviewPinsCloud(key)));
    return results.flatMap(result => result.ok ? result.value : []);
  }, [plan]);
  useEffect(() => {
    let alive = true;
    void reloadCloud().then(pins => { if (alive) setCloudPins(pins); });
    return () => { alive = false; };
  }, [reloadCloud]);
  const feedback = mergeBingoCloudPins(readBingoPlanFeedback(plan), cloudPins);
  async function resolvePin(pin: BingoFeedbackPin): Promise<void> {
    if (resolvingId) return;
    const valid = capture();
    if (!valid()) { setNotice('活动或分享记录已变化，请重新打开后再标记。'); return; }
    setResolvingId(pin.id); setNotice('');
    try {
      const keys = reviewPlanKeysForBingoPlan(plan);
      for (const key of keys) setReviewSharePinStatus(window.localStorage, key, pin.id, 'resolved');
      for (const key of keys.filter(k => k.startsWith('review-v2:'))) {
        await setReviewPinStatusCloud({ shareKey: key, pinId: pin.id, status: 'resolved' });
      }
      const fresh = await reloadCloud();
      if (alive.current) setCloudPins(fresh);
    } catch {
      if (alive.current) setNotice('标记已处理未完成，请重试。');
    } finally {
      if (alive.current) setResolvingId(null);
    }
  }
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
      {isDemoPlan(plan) && <span className="ap-audit-badge">案例演示</span>}
      <span className="ap-audit-badge">记录 {ordinal}</span>
    </button>
    <p className="ap-audit-meta">分享于 {formatBingoTime(plan.markedAt) || '时间待核对'}</p>
    <p className="ap-audit-meta">
      <MessageSquare size={13} aria-hidden="true"/>
      <span>{feedback.pinCount}</span>
      <small>{feedbackSummaryLabel(feedback, false)}{saved ? ` · 已导入反馈 ${saved.pins.length} 条` : ''}</small>
    </p>
    {plan.linkStatus!=='unavailable'&&<div className="ap-audit-actions"><button type="button" className="ap-audit-link" aria-label={copied ? '甲方链接已复制' : '复制甲方链接'} onClick={() => { void copyLink(); }}>
      {copied ? <Check size={13} aria-hidden="true"/> : <Copy size={13} aria-hidden="true"/>}{copied ? '已复制' : '复制链接'}
    </button>
    <a className="ap-audit-link" href={plan.clientHref} aria-label="打开评审页"><ExternalLink size={13} aria-hidden="true"/>查看评审页</a></div>}
    {open && <AuditPins feedback={feedback} onResolve={pin => void resolvePin(pin)} resolvingId={resolvingId} />}
    {eligible?<label>导入反馈文件 <input type="file" accept="application/json,.json" disabled={pending||unknown} onChange={event=>{const file=event.currentTarget.files?.[0];event.currentTarget.value='';void inspect(file);}}/></label>:<p>{plan.linkStatus==='unavailable'?'原分享链接不完整，无法核验，请重新分享。':'此历史分享未关联当前活动，或缺少可核对的活动身份，暂不能导入。'}</p>}
    {preview&&<section aria-label="待导入反馈预览"><p>反馈文件声明：{preview.completed?'已完成':'未完成'}；已有 {preview.duplicates} 条相同意见。</p><FeedbackPins pins={preview.pins} floorNames={preview.floorNames}/><button type="button" disabled={pending||unknown} onClick={()=>void applyFeedback()}>确认导入反馈</button><button type="button" disabled={pending} onClick={()=>setPreview(null)}>取消导入</button></section>}
    {saved&&<section aria-label="已导入反馈"><p>文件声明：{saved.reportedCompleted?'已完成':'未完成'}；来源和身份仍需核对。</p><FeedbackPins pins={saved.pins} floorNames={saved.floorNames}/></section>}
    {notice&&<p role="status">{notice}</p>}
  </article>;
}

function FeedbackPins({pins,floorNames}:{pins:readonly ReceiptPin[];floorNames:Record<string,string>}):JSX.Element {
  if(!pins.length)return <p>文件没有意见。</p>;
  // -0.001 这类近零值 toFixed 会出「-0.00」；先取整到厘米再归零负零。
  const fmtCoord = (value: number): string => {
    const cents = Math.round(value * 100);
    return (cents === 0 ? 0 : cents / 100).toFixed(2);
  };
  return <ol>{pins.map(pin=><li key={pin.id}><p>{pin.text}</p><p>{floorNames[pin.floorId]??'楼层待核对'} · 位置 {fmtCoord(pin.x)}，{fmtCoord(pin.z)} 米 · {pin.status==='resolved'?'文件标记已处理':'文件标记待处理'}</p></li>)}</ol>;
}

function AuditPins({ feedback, onResolve, resolvingId }: {
  feedback: BingoPlanFeedback;
  onResolve?: (pin: BingoFeedbackPin) => void;
  resolvingId?: string | null;
}): JSX.Element {
  if (feedback.pins.length === 0) return <p className="ap-audit-empty">本机暂无评审意见</p>;
  return <ol className="ap-audit-pins">
    {feedback.pins.map(pin => <li key={pin.id}>
      <p className="ap-audit-pin-head">
        <strong>{pin.author}</strong>
        {pin.pinStatus && <span className={`ap-audit-pin-status is-${pin.pinStatus}`}>{pin.pinStatus === 'resolved' ? '已处理' : '待处理'}</span>}
        {pin.createdAt && <time dateTime={pin.createdAt}>{formatFeedbackTime(pin.createdAt)}</time>}
      </p>
      {pin.placement && <p className="ap-audit-place">{pin.placement}</p>}
      <p>{pin.body}</p>
      {typeof pin.x === 'number' && typeof pin.z === 'number' && (
        <button type="button" className="ap-audit-link" aria-label={`定位意见「${pin.body}」`} onClick={() => requestOutdoorPlanPointFocus(pin.x as number, pin.z as number)}>定位</button>
      )}
      {pin.source === 'share-pin' && pin.pinStatus !== 'resolved' && (
        <button type="button" className="ap-audit-link" disabled={resolvingId === pin.id}
          aria-label={`标记意见「${pin.body}」已处理`}
          onClick={() => onResolve?.(pin)}>
          {resolvingId === pin.id ? '标记中…' : '标已处理'}
        </button>
      )}
      {pin.replies.length > 0 && <ul>
        {pin.replies.map((reply, index) => <li key={`${pin.id}-${index}`}>
          <p className="ap-audit-pin-head"><strong>{reply.author}</strong>{reply.createdAt && <time dateTime={reply.createdAt}>{formatFeedbackTime(reply.createdAt)}</time>}</p>
          <p>{reply.body}</p>
        </li>)}
      </ul>}
    </li>)}
  </ol>;
}
