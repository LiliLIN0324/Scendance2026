'use client';

import { Check, ChevronDown, ChevronRight, Copy, ExternalLink, MessageSquare, ShieldCheck, Trash2 } from '@/components/solid-icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import {inspectReviewFeedbackReceipt,type ReceiptPin} from '@/components/review-share-page/review-feedback-receipt';
import {importReviewFeedback,readImportedReviewFeedback} from '@/components/review-share-page/review-feedback-storage';
import {readShareHash} from '../lib/share';
import { violationCodeLabel, type BingoScore } from '../../../lib/bingo-score';
import {
  feedbackSummaryLabel,
  formatFeedbackTime,
  readBingoPlanFeedback,
  type BingoPlanFeedback,
} from '../lib/bingo-feedback';
import {
  clearBingoReceipt,
  emptyBingoSnapshot,
  formatBingoTime,
  readBingoSnapshot,
  type BingoPlan,
  type BingoSnapshot,
} from '../lib/bingo-status';
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
export interface BingoAuditCardProps {
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

const CHECKLIST_LABELS = ['椅子分布', '画布中线附近', '矩形画布边界', '已建模内墙'] as const;

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
  const { score, durationMs, rounds, scopeKey, isCurrent } = props;
  const [snapshot, setSnapshot] = useState<BingoSnapshot>(emptyBingoSnapshot);
  const { outcome } = useGenerationOutcome();
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
  const hasZ8 = Boolean(effectiveScore) || effectiveRounds !== undefined || effectiveDuration !== undefined
;
  if (!hasAuditRecord && !hasZ8) return null;
  const onClearReceipt = () => {
    clearBingoReceipt(window.localStorage);
    sync();
  };

  const placedCount = visibleOutcome?.placed.length ?? 0;
  const refusedList = visibleOutcome?.refused ?? [];

  return <section className="ap-card ap-audit" aria-label="系统体检与评审记录">
    <header className="ap-audit-head">
      <ShieldCheck size={16} aria-hidden="true"/>
      <strong>系统体检与评审记录</strong>
    </header>

    {effectiveScore && <><h4>{outcome && !outcomeCurrent ? '历史系统体检记录' : '系统体检结果'}</h4><p className="ap-audit-scope">仅粗略检查已建模物件与画布；现场净宽、出入口、消防和规范验收均未核验。修改场景后请重新体检。</p>
      <div className="ap-audit-score" data-testid="bingo-score">
        <p>几何检查：待核验{effectiveScore.failedCount > 0 ? `；发现 ${effectiveScore.failedCount} 件需关注` : ''}</p>
        <ul>{CHECKLIST_LABELS.map(label=><li key={label}>{label}：待核验</li>)}</ul>
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

    {hasAuditRecord && <section aria-label="本机评审记录">
      <h4>本机评审记录</h4>
      <p>对方的意见不会自动同步。请对方导出反馈文件，再在对应分享记录中导入。</p>
      <p>请核对反馈来源和身份；文件所述完成状态不代表身份认证或安全验收。</p>
      {snapshot.receipt && <><button type="button" className="ap-icon-btn ap-audit-clear" aria-label="清回执" title="清回执" onClick={onClearReceipt}><Trash2 size={14} aria-hidden="true"/></button><p className="ap-audit-receipt"><Check size={14} aria-hidden="true"/>本机旧回执，未核对当前版本 · <time dateTime={snapshot.receipt.at}>{formatBingoTime(snapshot.receipt.at) || snapshot.receipt.at}</time></p></>}
      {snapshot.plans.map((plan, index) => <AuditPlan key={`${plan.shareId}-${index}`} plan={plan} ordinal={index + 1} scopeKey={scopeKey} isCurrent={isCurrent}/>)}
    </section>}

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
  function shareHash():string {const hash=new URL(plan.clientHref,window.location.origin).hash;if(!hash.startsWith('#layout='))throw new Error('缺少完整分享链接，无法核对版本。');return hash;}
  useEffect(()=>{
    if(!eligible)return;const valid=capture(),id=sequence.current;
    void (async()=>{try{if(!valid())return;const hash=shareHash();const stored=await readImportedReviewFeedback(window.localStorage,hash);if(!valid()||sequence.current!==id)return;
      const decoded=await readShareHash(hash);if(!decoded.ok||!valid()||sequence.current!==id)return;
      if(stored.pins.length||stored.reportedCompleted)setSaved({...stored,floorNames:Object.fromEntries(decoded.layout.floors.map((floor,index)=>[floor.id,floor.name||`第 ${index+1} 层`]))});
    }catch{/* 无法读取时不把旧记录当成已导入。 */}})();
  },[plan.clientHref,plan.projectKey,scopeKey,eligible]);
  async function inspect(file:File|undefined):Promise<void>{
    if(!file||pending||unknown)return;const valid=capture(),id=++sequence.current;
    if(!valid()){setNotice('活动或分享记录已变化，无法导入。');return;}
    if(file.size>256_000){setNotice('反馈文件超过 256 KB，未读取。');return;}
    setPending(true);setPreview(null);setNotice('');
    try {const hash=shareHash(),json=await file.text();if(!valid()||sequence.current!==id)return;
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
    {open && <AuditPins feedback={feedback}/>}
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

function AuditPins({ feedback }: { feedback: BingoPlanFeedback }): JSX.Element {
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
      {pin.replies.length > 0 && <ul>
        {pin.replies.map((reply, index) => <li key={`${pin.id}-${index}`}>
          <p className="ap-audit-pin-head"><strong>{reply.author}</strong>{reply.createdAt && <time dateTime={reply.createdAt}>{formatFeedbackTime(reply.createdAt)}</time>}</p>
          <p>{reply.body}</p>
        </li>)}
      </ul>}
    </li>)}
  </ol>;
}
