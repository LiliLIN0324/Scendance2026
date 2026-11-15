/**
 * 提案确认卡（预览态）与改动分组清单：从 agent-panel 抽出的展示层第二批。
 *
 * 决策留痕（decision）是面板内存态，由 props 传入；确认 / 撤回 / 换一版 / 加座
 * 只收回调，组件不再接触 AgentValue。PlanPreview 与选择定位走编辑器上下文。
 * ProposalView 仍是面板侧的视图契约，这里做 type-only 反向导入（运行时擦除）。
 */
import { type ReactNode } from 'react';
import { Check, X } from '@/components/solid-icons';
import { useRoomEditor, useSelectionOptional } from '../contexts';
import { formatArea } from '../lib/workbench-agent';
import { venueArea } from '../lib/structural-layout';
import { PlanPreview } from './plan-preview';
import { BoundaryLineNote, FollowupChips, type BoundaryContext } from './proposal-followup-chips';
import { groupChangeItems, type ProposalChangeItem, type ProposalChangeKind, type ProposalChangeSummary } from '../lib/proposal-change-groups';
import { formatDurationClock } from './agent-chat-store';
import { ModelTextDisclosure } from './model-text-disclosure';
import { REFERENCE_SOURCE_UNVERIFIED } from '../lib/reference-source-status';
import type { ProposalView } from './agent-panel';

/** 这一轮候选卡上的决策留痕：批准 / 拒绝，只活在当前面板内存里，不落后端。 */
export type ProposalDecision = 'approved' | 'rejected';

/**
 * 提案分组清单：新增 / 挪动 / 撤掉 三组可点条目，点选只做选中定位，
 * 不挂任何单件批准/拒绝按钮；整版二元决策仍由卡片底部按钮行负责。
 */
export function ProposalChangeList({ items, summary, onLocate }: {
  items: ProposalChangeItem[];
  summary: ProposalChangeSummary;
  onLocate(id: string): void;
}): JSX.Element {
  const groups = groupChangeItems(items);
  const meta: { kind: ProposalChangeKind; title: string }[] = [
    { kind: 'added', title: '新增' },
    { kind: 'moved', title: '挪动' },
    { kind: 'removed', title: '撤掉' },
  ];
  const summaryParts = [`改动 ${summary.total} 处`];
  if (summary.zoneCount != null) summaryParts.push(`涉及 ${summary.zoneCount} 个区域`);
  if (summary.elapsedMs != null) summaryParts.push(`用时 ${formatDurationClock(summary.elapsedMs)}`);
  return (
    <div className="ap-change-list">
      <p className="ap-note ap-change-summary">{summaryParts.join(' · ')}</p>
      {meta.map(({ kind, title }) => {
        const entries = groups[kind];
        if (entries.length === 0) return null;
        return (
          <details className="ap-change-group" key={kind}>
            <summary>{title}（{entries.length}）</summary>
            <ul>
              {entries.map(entry => (
                <li key={entry.id}>
                  <button type="button" className="ap-change-item" onClick={() => onLocate(entry.id)}>
                    {entry.label}
                  </button>
                </li>
              ))}
            </ul>
          </details>
        );
      })}
    </div>
  );
}

/** 预览态：主钮「确认布置」，次钮「不用」；决策后原地留成徽章，一屏只留一个深主钮。 */
export function ProposalCard({ plan, decision, cloudBusy, recovering, inventoryBlocked, inventoryInvalid, exportPreview, inventoryWorkspace, onAddSeats, onConfirm, onWithdraw, onRegenerate, onPrefill, onApprove, onReject }: {
  plan: ProposalView | null;
  decision?: ProposalDecision | null;
  cloudBusy: boolean;
  recovering: boolean;
  inventoryBlocked: boolean;
  inventoryInvalid: boolean;
  exportPreview: boolean;
  inventoryWorkspace: ReactNode;
  onAddSeats(): void;
  onConfirm(): void;
  onWithdraw(): void;
  onRegenerate(): void;
  onPrefill?: (text: string) => void;
  onApprove?: () => void;
  onReject?: () => void;
}): JSX.Element | null {
  const { layout } = useRoomEditor();
  const selection = useSelectionOptional();
  if (!plan) return null;
  const names = plan.overlapNames.slice(0, 3).join('、');
  const review = !!plan.review;
  const guests = plan.guests && plan.guests > 0 ? plan.guests : 0;
  const seats = plan.seats ?? 0;
  const short = guests > 0 && seats < guests;
  const banquet = plan.receipt === 'banquet';
  const followupCtx: BoundaryContext = { guests, seats, short, banquet, review };
    // 云端还在写、或上一版还在恢复：最后一帧没稳，不亮确认。blocked / stale 同样不亮。
    const hold = cloudBusy || recovering;
  // 紧凑统计：座位 / 场地 / 物料 三件，数字大标签小。
  const areaValue = formatArea(plan.candidateArea ?? venueArea(layout));
  const placedCount = plan.outcome.placed ?? 0;
  const removedCount = plan.outcome.removed ?? 0;
  const movedCount = plan.outcome.moved ?? 0;
  // 状态徽章：绿=已干净，橙=待核验。一行排开，不写长段落。
  type Pill = { tone: 'ok' | 'warn'; label: string };
  const pills: Pill[] = [];
  if (plan.overlapCount > 0) pills.push({ tone: 'warn', label: `${plan.overlapCount} 件重叠` });
  else if (!plan.blocked) pills.push({ tone: 'ok', label: '无重叠' });
  if (short) pills.push({ tone: 'warn', label: `座位还差 ${guests - seats}` });
  else if (guests > 0) pills.push({ tone: 'ok', label: '座位够了' });
  if (plan.seatingAllocationUnverified || plan.seatingSpecsUnverified || plan.seatingHeadcountUnverified) {
    pills.push({ tone: 'warn', label: '座位待核验' });
  }
  if (plan.safetyChecksUnknown) pills.push({ tone: 'warn', label: '安全待核' });
  if (plan.entranceWarning) pills.push({ tone: 'warn', label: '门口净区待查' });
  const pillRow = pills.slice(0, 5);
  return <div className="ap-card ap-plan" id="plan-proposal" data-tour="proposal-card">
    <strong>{plan.comparisonOnly ? '原场景对照' : review ? '改法预览' : '这版还在预览'}</strong>
    {layout && !plan.comparisonOnly && <div className="ap-plan-thumb" aria-hidden="true"><PlanPreview layout={layout}/></div>}
    {guests > 0 && !banquet && <div className="ap-seats-meter" aria-hidden="true"><div className="ap-seats-meter-fill" style={{ width: `${Math.min(100, Math.round((seats / Math.max(guests, 1)) * 100))}%` }} data-short={short ? 'true' : undefined}/></div>}
    <div className="ap-stats ap-plan-stats">
      {banquet && <div className="ap-stat"><b>{plan.placedTables ?? 0}</b><span>桌</span></div>}
      {guests > 0 && <div className="ap-stat" data-short={short ? 'true' : undefined}>
        <b>{seats}<span className="ap-stat-of">/{guests}</span></b>
        <span>{banquet ? '座位' : '座位 / 目标'}</span>
      </div>}
      <div className="ap-stat"><b>{areaValue}</b><span>㎡ 场地</span></div>
      {(placedCount > 0 || removedCount > 0 || movedCount > 0) && <div className="ap-stat">
        <b>{placedCount > 0 ? `+${placedCount}` : '·'}{removedCount > 0 ? ` -${removedCount}` : ''}{movedCount > 0 ? ` 挪${movedCount}` : ''}</b>
        <span>新增 / 撤掉</span>
      </div>}
    </div>
    {pillRow.length > 0 && <div className="ap-pills" role="status">
      {pillRow.map(pill => <span key={pill.label} className={`ap-pill ap-pill-${pill.tone}`}>{pill.label}</span>)}
    </div>}
    {plan.changeItems && plan.changeItems.length > 0 && plan.changeSummary && (
      <ProposalChangeList
        items={plan.changeItems}
        summary={plan.changeSummary}
        onLocate={id => selection?.selectOnly(id, { keepPanel: true })}
      />
    )}
    <BoundaryLineNote plan={plan} ctx={followupCtx}/>
    {plan.venueChange && <p className="ap-warn-line">{plan.venueChange}；确认前不会修改场地。</p>}
    {!!plan.removedZones && <p className="ap-warn-line">这版将移除 {plan.removedZones} 个已有区域标注。</p>}
    {short && !plan.localDraftDetails && (!plan.seatPriority || (banquet && !/加不进更多/.test(plan.blocked ?? ''))) && <div className="ap-error-actions ap-seat-fix"><button type="button" className="chip btn-outline" onClick={onAddSeats}>加座，再排一版</button></div>}
    {plan.blocked && <p className="ap-warn-line"><span aria-hidden="true">!</span>{plan.blocked}</p>}
    {inventoryBlocked && <p role="alert">{inventoryInvalid?'物料数量输入无效，请更正或清空后再确认。':'已填写的物料数量不足，请调整数量或方案后再确认。'}</p>}
    {hold
      ? <p className="ap-small" id="plan-busy" role="status">{recovering && !cloudBusy ? '上一版还在恢复，确认先不亮。' : '正在整理这一版…'}</p>
      : decision === 'approved'
        ? <div className="ap-decision-row" aria-label="本版已批准">
            <span className="ap-decision-badge is-approved"><Check size={14} aria-hidden="true"/>已批准</span>
          </div>
        : decision === 'rejected'
          ? <div className="ap-decision-row" aria-label="本版已拒绝">
              <span className="ap-decision-badge is-rejected"><X size={14} aria-hidden="true"/>你拒绝了</span>
            </div>
          : <>
          {!plan.blocked && !inventoryBlocked && !exportPreview && <button id="step-cta" type="button" className="btn-primary" data-tour="confirm-plan" onClick={() => { onApprove?.(); onConfirm(); }}>确认布置</button>}
          <div id="cta-hint" className="ap-error-actions">
            <button type="button" className="chip btn-outline" onClick={() => { onReject?.(); onWithdraw(); }}>不用</button>
            {!review && <button type="button" className="chip btn-outline" onClick={onRegenerate}>换一版</button>}
          </div>
          <FollowupChips plan={plan} ctx={followupCtx} onPrefill={onPrefill}/>
        </>}
    {!banquet && <div className="ap-notes">
      {plan.source === 'local' && plan.added > 0 && <p className="ap-note">新增物料由系统规则生成。</p>}
      {plan.planNotes?.map(line => <p className="ap-note" key={line}>{line}</p>)}
      {plan.recolorPreview?.map(line => <p className="ap-note" key={line}>{line}</p>)}
      {plan.rotationPreview?.map(line => <p className="ap-note" key={line}>{line}</p>)}
      {plan.scalePreview?.map(line => <p className="ap-note" key={line}>{line}</p>)}
      {plan.movementPreview?.map(line => <p className="ap-note" key={line}>{line}</p>)}
      {plan.restPreview?.map(line => <p className="ap-note" key={line}>{line}；通行和消防条件待核验。</p>)}
      {short && !plan.localDraftDetails && plan.seatPriority && <p className="ap-note" id="plan-seat-cap">这次排到 {seats} 座，仍缺 {guests - seats} 座；可尝试调整物料规格、功能区或场地，再核对方案。</p>}
      {plan.overlapCount > 0 && <p className="ap-warn-line"><span aria-hidden="true">!</span>{review ? '改完还剩 ' : ''}{plan.overlapCount} 件挤在一起或压到墙：{names}{plan.overlapNames.length > 3 ? ' 等' : ''}。</p>}
      {plan.seatingReview?.status==='broken' && <p className="ap-note" role="status">原生成的桌椅配套有 {plan.seatingReview.brokenGroups} 组缺少物件；仍保留原配套关系的椅子有 {plan.seatingReview.intactChairs} 把，实际座位及现场条件仍需核验。</p>}
      {plan.seatingReview?.status==='unknown' && <p className="ap-note" role="status">桌椅配套关系尚未核验，不能只按椅子数量认定座位充足；请检查桌椅对应关系。</p>}
      {plan.localDraftDetails?.map(line=><p className="ap-note" key={line}>{line}</p>)}
      {plan.seatWarning && <p className="ap-note">{plan.seatWarning}</p>}
      {plan.seatCeilingNote && <p className="ap-note" role="status">{plan.seatCeilingNote}</p>}
      {plan.annotationWarning && <p className="ap-note" role="status">{plan.annotationWarning}</p>}
      {plan.functionalWarnings?.map(message => <p className="ap-note" key={message}>{message}</p>)}
      {!!plan.existingChanges?.length && <details className="ap-existing-changes">
        <summary>对现有物料的改动（{plan.existingChanges.length} 件）</summary>
        <p>确认后将修改现有物料；目前仅为预览，尚未应用。位置以场地中心为原点。</p>
        <ul>{plan.existingChanges.map(change=><li key={change.id}>{change.text}</li>)}</ul>
      </details>}
      <p className="ap-note">{REFERENCE_SOURCE_UNVERIFIED}</p>
    </div>}
    {banquet && short && !plan.localDraftDetails && plan.seatPriority && !/加不进更多/.test(plan.blocked ?? '') && <p id="plan-seat-cap">这次排到 {seats} 座，仍缺 {guests - seats} 座；可尝试调整物料规格、功能区或场地，再核对方案。</p>}
    {plan.modelExplanation && <ModelTextDisclosure><p>{plan.modelExplanation}</p></ModelTextDisclosure>}
    {!banquet && inventoryWorkspace}
  </div>;
}