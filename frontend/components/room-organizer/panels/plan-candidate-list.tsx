'use client';

/**
 * 户外平面候选清单（#46-1b）：与 #43 场景提案卡并列的独立槽位。
 *
 * 受控状态：每张候选卡确认/拒绝后落本地态，重复进入不翻出旧卡；
 * 真正装配与落 store 由父组件回调完成，本组件不读写 localStorage。
 */
import { useState } from 'react';
import type { AgentPlanCandidate } from '../../../../supabase/functions/_shared/plan-candidate';
import { PlanCandidateCard } from './plan-candidate-card';

export interface PlanCandidateListProps {
  candidates: readonly AgentPlanCandidate[];
  /** 父组件经既有建实体入口装配并落本机 store；返回是否成功。 */
  onApply(candidate: AgentPlanCandidate): void;
  onReject(candidate: AgentPlanCandidate): void;
  applying?: boolean;
}

type Resolved = 'applied' | 'rejected';

export function PlanCandidateList({ candidates, onApply, onReject, applying }: PlanCandidateListProps) {
  const [resolved, setResolved] = useState<Record<string, Resolved>>({});

  if (candidates.length === 0) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {candidates.map((candidate, index) => {
        const state = resolved[candidate.plan.facilities.length + candidate.plan.zones.length + index];
        if (state === 'rejected') {
          return <p key={index} role="status" style={{ color: '#6b7280', fontSize: 12 }}>已拒绝该户外方案，未落到平面。</p>;
        }
        if (state === 'applied') {
          return <p key={index} role="status" style={{ color: '#4a7c59', fontSize: 12 }}>已应用到户外平面，可在画布核对。</p>;
        }
        return (
          <PlanCandidateCard
            key={index}
            candidate={candidate}
            applying={applying}
            onApply={() => { setResolved(prev => ({ ...prev, [index]: 'applied' })); onApply(candidate); }}
            onReject={() => { setResolved(prev => ({ ...prev, [index]: 'rejected' })); onReject(candidate); }}
          />
        );
      })}
    </div>
  );
}

export default PlanCandidateList;
