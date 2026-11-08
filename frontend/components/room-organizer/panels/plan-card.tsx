'use client';

import { useMemo, useState, type CSSProperties } from 'react';
import type { LayoutPlanDraft } from '../../../lib/plan-annotation';
import { planZones } from '../../../lib/plan-approve';
import { isScoredPlanApplicable, type ScoredPlan, type PlanVariantId } from '../../../lib/plan-scoring';
import type { ActivitySuggestion } from '../../../lib/suggestions';
import { buildPlanChecklist } from '../../../lib/plan-checklist';
import type { PlanSizeFacts } from '../../../lib/plan-size-facts';
import type { FunctionalNeeds } from '../lib/functional-requirements';

type SkippedZone = { zoneId: string; reason: string };

/**
 * 第 7.5 批「规划草案」计划卡。
 *
 * 受控组件：不订阅 agent-chat 内部状态，全部回调由父组件注入。
 * 对应 Z4/Z5——阶段带空间关系理由，三按钮「批准 / 换一版 / 取消」，
 * 输入框允许口头改方案，页脚常驻「执行前我会先征求你的意见」。
 *
 * 第 12 批：父组件额外传入三版打分结果 + AI 建议，卡片在阶段列表下方、
 * 按钮行上方插入「三版分数小条」与「AI 建议」两块，让用户在批准前
 * 看到「思考过程」和可切换的推荐版本。
 */
export interface PlanCardProps {
  draft: LayoutPlanDraft | null;
  onApprove(): void;
  onReplace(): void;
  onCancel(): void;
  onComment(text: string): void;
  /** 三版打分结果（松/适中/密），由父组件算好传入；空数组时不渲染分数条。 */
  plans?: ScoredPlan[] | undefined;
  /** 父组件推荐版 variantId。 */
  recommendedId?: PlanVariantId | undefined;
  /** 用户当前手动选中的 variantId（受控）。 */
  selectedId?: PlanVariantId | undefined;
  /** 切换版本回调。 */
  onSelectVariant?(id: PlanVariantId): void;
  /** AI 建议列表；空数组时不渲染建议卡。 */
  suggestions?: ActivitySuggestion[] | undefined;
  zoneWarnings?: readonly string[];
  blockedReason?: string | undefined;
  functionalNeeds?: FunctionalNeeds | undefined;
  /** 当前场地、当前楼层的尺寸事实；无可信关联来源时不运行网格。 */
  sizeFacts?: PlanSizeFacts | undefined;
}

const cardStyle: CSSProperties = {
  border: '1px solid #e5e7eb',
  borderRadius: 12,
  background: '#fff',
  padding: 14,
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  fontFamily:
    '-apple-system, "PingFang SC", "Microsoft YaHei", "Segoe UI", sans-serif',
  color: '#374151',
  fontSize: 13,
  minWidth: 260,
};

const titleStyle: CSSProperties = {
  fontWeight: 600,
  fontSize: 14,
  color: '#1f2937',
};

const stageStyle: CSSProperties = {
  borderLeft: '3px solid #4A7C59',
  padding: '4px 8px',
  background: '#f9fafb',
  borderRadius: 4,
};

const stageTitleStyle: CSSProperties = {
  fontWeight: 600,
  color: '#1f2937',
};

const rationaleStyle: CSSProperties = {
  color: '#6b7280',
  fontSize: 12,
  marginTop: 2,
};

const metaStyle: CSSProperties = {
  color: '#9ca3af',
  fontSize: 11,
  marginTop: 2,
};

const buttonRowStyle: CSSProperties = {
  display: 'flex',
  gap: 8,
  marginTop: 4,
};

const primaryButtonStyle: CSSProperties = {
  flex: 1,
  background: '#4A7C59',
  color: '#fff',
  border: 'none',
  borderRadius: 8,
  padding: '8px 10px',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
};

const secondaryButtonStyle: CSSProperties = {
  flex: 1,
  background: '#F4F5F7',
  color: '#374151',
  border: '1px solid #e5e7eb',
  borderRadius: 8,
  padding: '8px 10px',
  fontSize: 13,
  cursor: 'pointer',
};

const cancelButtonStyle: CSSProperties = {
  flex: 1,
  background: 'transparent',
  color: '#b45309',
  border: 'none',
  borderRadius: 8,
  padding: '8px 10px',
  fontSize: 13,
  cursor: 'pointer',
};

const inputStyle: CSSProperties = {
  border: '1px solid #e5e7eb',
  borderRadius: 8,
  padding: '8px 10px',
  fontSize: 13,
  color: '#374151',
  outline: 'none',
};

const footerStyle: CSSProperties = {
  color: '#9ca3af',
  fontSize: 11,
  textAlign: 'center',
  marginTop: 2,
};

/* ---------- 第 12 批：三版分数条 / AI 建议样式 ---------- */

const variantsBlockStyle: CSSProperties = {
  background: '#f9fafb',
  border: '1px solid #e5e7eb',
  borderRadius: 8,
  padding: '8px 10px',
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
};

const variantsTitleStyle: CSSProperties = {
  color: '#6b7280',
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: 0.3,
};

const variantRowBase: CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  gap: 6,
  fontSize: 12,
  padding: '4px 6px',
  borderRadius: 6,
  cursor: 'pointer',
  color: '#374151',
  border: '1px solid transparent',
  background: 'transparent',
  textAlign: 'left',
};

const variantRowSelected: CSSProperties = {
  ...variantRowBase,
  border: '1px solid #4A7C59',
  background: '#fff',
};

const variantRowRecommendedText: CSSProperties = {
  color: '#4A7C59',
  fontWeight: 700,
};

const variantRowMeta: CSSProperties = {
  color: '#6b7280',
  fontSize: 11,
};

/** 0-100 三维子分小行（容量/动线/人体），灰色小字，不再显示裸总分。 */
const variantSubScoreStyle: CSSProperties = {
  color: '#6b7280',
  fontSize: 11,
  padding: '0 6px 2px 6px',
  lineHeight: 1.4,
};

/** 单版 violation 列表容器（无 violations 时整块不渲染）。 */
const variantViolationsWrapStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  padding: '2px 4px 2px 6px',
};

/** hard violation：品牌绿左边框 + 浅灰底（复用 stageStyle 色板，禁紫/禁靛）。 */
const violationHardStyle: CSSProperties = {
  borderLeft: '3px solid #4A7C59',
  background: '#f9fafb',
  padding: '3px 8px',
  fontSize: 12,
  color: '#374151',
  borderRadius: 4,
  lineHeight: 1.4,
};

/** soft violation：灰色小字，不扣分只提示。 */
const violationSoftStyle: CSSProperties = {
  color: '#6b7280',
  fontSize: 11,
  padding: '1px 8px',
  lineHeight: 1.4,
};

/* ---------- SC-19/G1：版级可行性徽标 + 无推荐横幅样式 ---------- */

/** 不可行（hard violation）徽标：琥珀色，沿用取消按钮色板，禁紫/禁靛。 */
const variantInfeasibleBadgeStyle: CSSProperties = {
  color: '#b45309',
  fontSize: 11,
  fontWeight: 600,
  border: '1px solid #f3d5a4',
  borderRadius: 999,
  padding: '1px 8px',
  whiteSpace: 'nowrap',
};

/** 缺关键数据（INSUFFICIENT_INPUT）徽标：灰底灰字。 */
const variantInsufficientBadgeStyle: CSSProperties = {
  color: '#6b7280',
  fontSize: 11,
  fontWeight: 600,
  border: '1px solid #e5e7eb',
  borderRadius: 999,
  padding: '1px 8px',
  whiteSpace: 'nowrap',
};

/** 推测门草案（draft_unverified）小字标签：灰色，不与不可行混用。 */
const variantDraftMetaStyle: CSSProperties = {
  color: '#9ca3af',
  fontSize: 11,
};

/* ---------- B4 降容话术露出面：推荐版 reasons 渲染 ---------- */

/** 推荐版理由列表容器（挂在推荐版行下，与 violations 同级）。 */
const variantReasonsWrapStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 1,
  padding: '0 6px 2px 10px',
};

/** 「推荐理由」小标题。 */
const variantReasonTitleStyle: CSSProperties = {
  color: '#6b7280',
  fontSize: 11,
  fontWeight: 600,
};

/** 单条理由：灰色小字，与子分行保持同色系。 */
const variantReasonStyle: CSSProperties = {
  color: '#6b7280',
  fontSize: 11,
  lineHeight: 1.5,
};

/** 降容建议行（「装不下 N 人 / 建议降到」）：琥珀色提醒，沿用 REC=null 横幅色板。 */
const variantCapacityAdviceStyle: CSSProperties = {
  color: '#92400e',
  fontSize: 11,
  lineHeight: 1.5,
};

/** REC=null 横幅：所有版本都有硬冲突时，先说「没有可推荐方案」。 */
const noRecommendBannerStyle: CSSProperties = {
  borderLeft: '3px solid #b45309',
  background: '#fff7ed',
  padding: '6px 10px',
  fontSize: 12,
  color: '#92400e',
  borderRadius: 4,
  lineHeight: 1.5,
};

/** feasibilityStatus → 版级徽标文案；FEASIBLE 不出徽标。 */
function feasibilityBadge(p: ScoredPlan): { text: string; style: CSSProperties } | null {
  if (p.feasibilityStatus === 'INSUFFICIENT_INPUT') {
    return { text: '⚠ 待核验', style: variantInsufficientBadgeStyle };
  }
  if (!p.feasible) {
    return { text: '⛔ 不可行', style: variantInfeasibleBadgeStyle };
  }
  return null;
}

const suggestionsBlockStyle: CSSProperties = {
  background: '#f9fafb',
  border: '1px solid #e5e7eb',
  borderRadius: 8,
  padding: '8px 10px',
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
};

const suggestionsTitleStyle: CSSProperties = {
  color: '#6b7280',
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: 0.3,
};

const suggestionItemStyle: CSSProperties = {
  fontSize: 12,
  color: '#374151',
  lineHeight: 1.5,
};

const suggestionReasonStyle: CSSProperties = {
  color: '#6b7280',
  fontSize: 11,
};

/** 局部间距不等于通道宽度或通行结论。 */
function formatAisle(plan: ScoredPlan): string {
  const w = plan.flow.aisleWidthM;
  if (w === null || !Number.isFinite(w)) return '通行待核验';
  return `签到区一侧间距估算 ${w.toFixed(1)}m`;
}

export function PlanCard({
  draft,
  onApprove,
  onReplace,
  onCancel,
  onComment,
  plans,
  recommendedId,
  selectedId,
  onSelectVariant,
  suggestions,
  zoneWarnings,
  blockedReason,
  functionalNeeds,
  sizeFacts,
}: PlanCardProps): JSX.Element | null {
  const [comment, setComment] = useState('');
  const selectedPlan = plans?.find((plan) => plan.variantId === selectedId);
  const trustedSize = sizeFacts && [sizeFacts.width, sizeFacts.depth].every(fact =>
    fact.status === 'confirmed' && fact.valueMeters !== null && Number.isFinite(fact.valueMeters) && fact.valueMeters > 0
    && fact.records.some(entry => entry.matchesCurrent && entry.record.status === 'confirmed' && entry.source !== null));
  const checklistRoomSize = trustedSize ? { width: sizeFacts!.width.valueMeters!, height: sizeFacts!.depth.valueMeters! } : undefined;
  const checklistEvidence = (value:string) => (draft?.annotations ?? []).reduce((text, annotation) =>
    annotation.id ? text.replaceAll(annotation.id, annotation.label || '标注') : text, value);

  const stages = useMemo(
    () => (draft ? [...draft.stages].sort((a, b) => a.stageNo - b.stageNo) : []),
    [draft],
  );

  // 批准前先把「每个区会落什么」算出来摆给用户看，别让人盲批。
  const preview = useMemo(() => {
    if (!draft) return { byId: new Map<string, string>(), skipped: [] as SkippedZone[] };
    const outcome = selectedPlan ?? (plans?.length ? { placements: [], skipped: [] } : planZones(draft.annotations, 0.5));
    const byId = new Map<string, string>();
    for (const zone of draft.annotations.filter((a) => a.kind === 'zone')) {
      const items = outcome.placements.filter((p) => p.zoneId === zone.id);
      if (items.length === 0) continue;
      const counts = new Map<string, number>();
      for (const p of items) counts.set(p.spec.name, (counts.get(p.spec.name) ?? 0) + 1);
      byId.set(zone.id, [...counts.entries()].map(([name, n]) => `${name}×${n}`).join('、'));
    }
    return { byId, skipped: outcome.skipped };
  }, [draft, selectedPlan, plans]);

  if (!draft) return null;

  const submitComment = (): void => {
    const text = comment.trim();
    if (!text) return;
    onComment(text);
    setComment('');
  };

  const hasPlans = Array.isArray(plans) && plans.length > 0;
  const hasSuggestions = Array.isArray(suggestions) && suggestions.length > 0;
  // SC-19/G1：三版都有硬冲突（父组件推荐版为空）时，先明说「没有可推荐方案」，
  // 再列硬冲突清单——不能让用户对着一排看似正常的分数条自己猜。
  const noRecommendedPlan = hasPlans && !recommendedId && plans!.every((p) =>
    (p.violations ?? []).some((v) => v.severity === 'hard' && (v.status === undefined || v.status === 'violated')),
  );
  const hardConflictSummary = noRecommendedPlan
    ? (() => {
        const seen = new Set<string>();
        for (const p of plans!) {
          for (const v of Array.isArray(p.violations) ? p.violations : []) {
            if (v.severity === 'hard' && (v.status === undefined || v.status === 'violated')) seen.add(v.message);
          }
        }
        return [...seen].slice(0, 4);
      })()
    : [];

  return (
    <section style={cardStyle} aria-label="规划草案">
      <header style={titleStyle}>规划草案</header>
      {blockedReason && <p role="alert" style={violationHardStyle}>{blockedReason}</p>}
      {zoneWarnings?.map(warning => <p key={warning} style={rationaleStyle}>{warning}</p>)}

      {stages.length === 0 && (
        <p style={rationaleStyle}>还没有阶段，正在画标注…</p>
      )}

      {stages.map((stage) => {
        const zoneAnnotations = (draft?.annotations ?? []).filter(
          (a) => a.kind === 'zone' && stage.annotationIds.includes(a.id),
        );
        return (
          <div key={stage.stageNo} style={stageStyle}>
            <div style={stageTitleStyle}>
              <span aria-hidden="true">{stage.stageNo}.</span> {stage.title}
            </div>
            <div style={rationaleStyle}>{stage.rationale}</div>
            {zoneAnnotations.map((a) => {
              const planned = preview.byId.get(a.id);
              const missed = preview.skipped.find((s) => s.zoneId === a.id);
              return (
                <div key={a.id} style={metaStyle}>
                  · {a.label}
                  {planned ? ` → ${planned}` : ''}
                  {missed ? `（${missed.reason}）` : ''}
                </div>
              );
            })}
          </div>
        );
      })}

      {/* 第 12 批：三版分数小条——思考过程可见，推荐版高亮，可点击换版。 */}
      {hasPlans && (
        <div style={variantsBlockStyle}>
          <div style={variantsTitleStyle}>三版布置打分</div>
          <p style={rationaleStyle}>当前为待核验草案：入口、门扇与现场通行条件仍需确认，分数不代表安全或合规。</p>
          {functionalNeeds?.checkin == null && <p style={rationaleStyle}>尚未确认是否需要签到。</p>}
          {functionalNeeds?.stage == null && <p style={rationaleStyle}>尚未确认是否需要舞台。</p>}
          {selectedPlan && <details><summary>本次候选检查范围与待核验项</summary>
            <p>仅检查本次候选及其区域标注，不覆盖既有物件或全部楼层；不能作为全场安全或规范结论。</p>
            {buildPlanChecklist({placements:selectedPlan.placements,annotations:draft.annotations,...(checklistRoomSize ? {roomSize:checklistRoomSize} : {}),...(functionalNeeds?.checkin != null?{checkinRequired:functionalNeeds.checkin}:{})}).map(check => <div key={check.id} style={metaStyle}>
              <strong>{check.status === 'violated' ? '发现冲突' : check.status === 'not_applicable' ? '本项不适用' : check.status === 'pass' ? '已核对' : '待核验'}</strong>：{check.applicability} {check.evidence.map(checklistEvidence).join('；')}（{check.ruleScope}）
            </div>)}
          </details>}
          {!plans!.some(isScoredPlanApplicable) && <p style={rationaleStyle}>本次没有找到可应用的完整候选，可调整区域或需求后重试；这不代表场地无解。</p>}
          {noRecommendedPlan && (
            <div style={noRecommendBannerStyle} data-testid="plan-card-no-recommendation">
              各候选均有硬冲突，没有可推荐方案：
              {hardConflictSummary.length > 0
                ? hardConflictSummary.map((m, i) => <div key={`hc-${i}`}>· {m}</div>)
                : '请调整标注或场地尺寸'}
            </div>
          )}
          {plans!.map((p) => {
            // 防御：reasons 为空数组时，这个 plan 没法向用户解释为什么推荐，
            // 哪怕它被父组件标成 recommendedId 也不渲染「✅ 推荐」标签。
            const hasReasons = Array.isArray(p.reasons) && p.reasons.length > 0;
            const isRecommended = recommendedId === p.variantId && hasReasons && isScoredPlanApplicable(p);
            const isSelected = selectedId === p.variantId;
            const rowStyle = isSelected ? variantRowSelected : variantRowBase;
            const hardViolations = Array.isArray(p.violations)
              ? p.violations.filter((v) => v.severity === 'hard' && (v.status === undefined || v.status === 'violated'))
              : [];
            const softViolations = Array.isArray(p.violations)
              ? p.violations.filter((v) => v.status === 'unknown' || (v.severity === 'soft' && (v.status === undefined || v.status === 'violated')))
              : [];
            const hasViolations = hardViolations.length > 0 || softViolations.length > 0;
            // G1 版级出口：不可行 / 缺尺寸出版级徽标；推测门草案出灰色小字。
            const badge = feasibilityBadge(p);
            const isDraft = p.assurance === 'draft_unverified';
            // B4：推荐版的 reasons 从数据层露出——降容建议（「装不下 N 人 / 建议降到」）
            // 此前只存在 reasons 数组里，任何 UI 都不渲染，用户永远看不到。
            // 与 violations 去重：与违规清单逐字相同的理由不再重复列一遍。
            const shownViolationTexts = new Set(
              [...hardViolations, ...softViolations].map((v) => v.message),
            );
            const reasonLines = isRecommended && hasReasons
              ? [...new Set((p.reasons ?? []).filter((r) => !shownViolationTexts.has(r)))]
              : [];
            return (
              <div key={p.variantId} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <button
                  type="button"
                  style={rowStyle}
                  onClick={() => onSelectVariant?.(p.variantId)}
                  aria-pressed={isSelected}
                >
                  <span style={isRecommended ? variantRowRecommendedText : undefined}>
                    {isRecommended ? '✅ 推荐 ' : ''}
                    {isSelected ? '👉 选中 ' : ''}
                    {p.label}版
                  </span>
                  {badge && <span style={badge.style} data-testid={`plan-variant-badge-${p.variantId}`}>{badge.text}</span>}
                  <span style={variantRowMeta}>
                    估算 {p.capacitySeats} 座 · {formatAisle(p)} · 越界 {p.outOfBounds}
                  </span>
                </button>
                <div style={variantSubScoreStyle}>
                  容量 {p.subScores.capacity} · 动线 {p.subScores.flow ?? '待核验'} · 人体 {p.subScores.ergonomics ?? '待核验'}
                  {isDraft && <span style={variantDraftMetaStyle} data-testid="plan-card-draft-unverified"> · 待核验草案</span>}
                </div>
                {p.placements.length === 0 && <div style={violationSoftStyle}>这版没有生成物料，请调整区域后重试。</div>}
                {p.skipped.map((item, index) => <div key={`skipped-${index}`} style={violationSoftStyle}>未能放入{item.label ? `「${item.label}」` : '物料'}：{item.reason}</div>)}
                {(p.inventoryNotes ?? []).map((note, index) => <div key={`inventory-${index}`} style={violationSoftStyle}>{note}</div>)}
                {reasonLines.length > 0 && (
                  <div style={variantReasonsWrapStyle} data-testid="plan-card-recommended-reasons">
                    <div style={variantReasonTitleStyle}>推荐理由</div>
                    {reasonLines.map((r, i) => {
                      // 降容建议行加琥珀色提醒：这是 B4 的核心露出——出方案时就
                      // 能看到「装不下 N 人 / 建议降到约 X 人」，不必等批准。
                      const isCapacityAdvice = r.includes('还差约');
                      return (
                        <div
                          key={`r-${i}`}
                          style={isCapacityAdvice ? variantCapacityAdviceStyle : variantReasonStyle}
                          data-testid={isCapacityAdvice ? 'plan-card-capacity-advice' : undefined}
                        >
                          · {r}
                        </div>
                      );
                    })}
                  </div>
                )}
                {hasViolations && (
                  <div style={variantViolationsWrapStyle}>
                    {hardViolations.map((v, i) => (
                      <div key={`h-${i}`} style={violationHardStyle}>{v.message}</div>
                    ))}
                    {softViolations.map((v, i) => (
                      <div key={`s-${i}`} style={violationSoftStyle}>{v.message}</div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* 第 12 批：AI 建议卡——按受众/区类型/场地短边给人话提醒。 */}
      {hasSuggestions && (
        <div style={suggestionsBlockStyle}>
          <div style={suggestionsTitleStyle}>AI 建议</div>
          {suggestions!.map((s, i) => {
            // 防御：title 与 reason 都为空字符串时不渲染那一条。
            const title = typeof s.title === 'string' ? s.title.trim() : '';
            const reason = typeof s.reason === 'string' ? s.reason.trim() : '';
            if (!title && !reason) return null;
            return (
              <div key={`${title || i}`} style={suggestionItemStyle}>
                {title ? `· ${title}` : ''}
                {reason ? <div style={suggestionReasonStyle}>{reason}</div> : null}
              </div>
            );
          })}
        </div>
      )}

      <div style={buttonRowStyle}>
        <button type="button" style={primaryButtonStyle} onClick={onApprove} disabled={!!blockedReason || !selectedPlan || !isScoredPlanApplicable(selectedPlan)}>
          应用布置
        </button>
        <button type="button" style={secondaryButtonStyle} onClick={onReplace}>
          换一版
        </button>
        <button type="button" style={cancelButtonStyle} onClick={onCancel}>
          取消
        </button>
      </div>

      <input
        style={inputStyle}
        placeholder="或用文字回答，直接口头改方案…"
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submitComment();
        }}
      />

      <footer style={footerStyle}>执行前我会先征求你的意见</footer>
    </section>
  );
}
