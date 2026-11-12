/**
 * 户外 planCandidate 结果识别与分组计数（#46-1 前端纯函数层）。
 *
 * 运行结果里，scene 候选带 `proposal`；户外平面候选带并列的 `planCandidate`（kind === 'plan'）。
 * 这里只做识别、计数与 warnings 归组，不写画布、不碰 store；确认后的实体装配走画布既有入口。
 */
import type { AgentPlanCandidate } from '../../../../supabase/functions/_shared/plan-candidate';

/** 分组清单的计数口径：新增分区/设施/动线/节点/人员。 */
export interface PlanCandidateGroupCounts {
  zones: number;
  facilities: number;
  routes: number;
  nodes: number;
  workers: number;
}

export function isPlanCandidate(value: unknown): value is AgentPlanCandidate {
  return (
    typeof value === 'object' && value !== null
    && (value as AgentPlanCandidate).kind === 'plan'
    && typeof (value as AgentPlanCandidate).plan === 'object'
    && (value as AgentPlanCandidate).plan !== null
  );
}

/** 从候选草稿统计各组数量（added 清单为契约必填；草稿数组仅作渲染全貌参考）。 */
export function planCandidateCounts(candidate: AgentPlanCandidate): PlanCandidateGroupCounts {
  const added = candidate.added;
  return {
    zones: added.zoneIds.length,
    facilities: added.facilityIds.length,
    routes: added.routeIds.length,
    nodes: added.nodeIds.length,
    workers: added.workerIds.length,
  };
}

export function planCandidateWarnings(candidate: AgentPlanCandidate): { code: string; ids: string[] }[] {
  return Array.isArray(candidate.warnings) ? candidate.warnings : [];
}

export const PLAN_CANDIDATE_GROUP_LABELS: Record<keyof PlanCandidateGroupCounts, string> = {
  zones: '分区',
  facilities: '设施',
  routes: '动线',
  nodes: '节点',
  workers: '人员点位',
};

/** 分组清单：只出数量大于 0 的组，顺序固定，和 #43 提案分组清单同一读法。 */
export function planCandidateGroupRows(candidate: AgentPlanCandidate): { key: keyof PlanCandidateGroupCounts; label: string; count: number }[] {
  const counts = planCandidateCounts(candidate);
  return (Object.keys(PLAN_CANDIDATE_GROUP_LABELS) as (keyof PlanCandidateGroupCounts)[])
    .map(key => ({ key, label: PLAN_CANDIDATE_GROUP_LABELS[key], count: counts[key] }))
    .filter(row => row.count > 0);
}
