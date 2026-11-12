'use client';

/**
 * 户外平面提案确认卡（#46-1）。
 *
 * 与 #43 的 scene ProposalCard 并列、独立组件：不塞进室内 scene 提案流。
 * 纯受控展示——分组列出将新增的分区/设施/动线/节点/人员数量与 warnings，
 * 用户点「应用到户外平面」才由父组件走画布既有建实体入口落 store；点拒绝则丢弃内存候选。
 * 卡片本身不拼 schema JSON、不直接写 outdoor-project-store。
 */
import type { CSSProperties } from 'react';
import type { AgentPlanCandidate } from '../../../../supabase/functions/_shared/plan-candidate';
import { planCandidateGroupRows, planCandidateWarnings } from '../lib/plan-candidate-preview';

export interface PlanCandidateCardProps {
  candidate: AgentPlanCandidate;
  title?: string | undefined;
  /** 确认应用：父组件负责经既有建实体入口装配并落本机 store。 */
  onApply(): void;
  /** 拒绝：丢弃该内存候选，不落盘。 */
  onReject(): void;
  applying?: boolean | undefined;
}

const cardStyle: CSSProperties = {
  border: '1px solid #e5e7eb',
  borderRadius: 12,
  padding: 14,
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  background: '#ffffff',
};

const rowStyle: CSSProperties = { display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13 };
const mutedStyle: CSSProperties = { color: '#6b7280', fontSize: 12, lineHeight: 1.5 };

export function PlanCandidateCard({ candidate, title, onApply, onReject, applying }: PlanCandidateCardProps) {
  const groups = planCandidateGroupRows(candidate);
  const warnings = planCandidateWarnings(candidate);
  return (
    <section style={cardStyle} aria-label="户外平面方案确认">
      <div style={{ fontWeight: 600, fontSize: 14 }}>{title ?? '户外平面方案'}</div>
      {candidate.explanation ? <p style={mutedStyle}>{candidate.explanation}</p> : null}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {groups.map(group => (
          <div key={group.key} style={rowStyle}>
            <span>{group.label}</span>
            <span aria-label={`${group.label} ${group.count}`}>{group.count}</span>
          </div>
        ))}
        {groups.length === 0 ? <div style={mutedStyle}>本次没有新增实体。</div> : null}
      </div>
      {warnings.length > 0 ? (
        <ul style={{ ...mutedStyle, margin: 0, paddingLeft: 16, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {warnings.map(warning => (
            <li key={warning.code}>{warning.code}{warning.ids.length ? `：${warning.ids.join('、')}` : ''}</li>
          ))}
        </ul>
      ) : null}
      <p style={mutedStyle}>{candidate.notice}</p>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button type="button" onClick={onReject} disabled={applying}>拒绝</button>
        <button type="button" onClick={onApply} disabled={applying}>应用到户外平面</button>
      </div>
    </section>
  );
}

export default PlanCandidateCard;
