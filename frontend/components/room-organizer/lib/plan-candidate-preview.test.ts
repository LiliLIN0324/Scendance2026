import { describe, expect, it } from 'vitest';
import {
  isPlanCandidate,
  planCandidateCounts,
  planCandidateGroupRows,
  planCandidateWarnings,
} from './plan-candidate-preview';
import type { AgentPlanCandidate } from '../../../../supabase/functions/_shared/plan-candidate';

const emptyPlan = {
  schemaVersion: 1 as const,
  boundary: [],
  zones: [],
  facilities: [],
  routes: [],
  nodes: [],
  workers: [],
};

function makeCandidate(added: Partial<AgentPlanCandidate['added']>, warnings: { code: string; ids: string[] }[] = []): AgentPlanCandidate {
  return {
    kind: 'plan',
    plan: emptyPlan,
    added: { zoneIds: [], facilityIds: [], routeIds: [], nodeIds: [], workerIds: [], ...added },
    warnings,
    explanation: '示意方案，待现场核验',
    notice: '户外平面草稿为待核验快照；读取不代表已用于排布、容量核定或通过安全检查。',
  };
}

describe('plan-candidate-preview 识别与分组', () => {
  it('识别 kind=plan 的户外候选，拒绝 scene 提案与空值', () => {
    expect(isPlanCandidate(makeCandidate({ zoneIds: ['11111111-1111-4111-8111-111111111111'] }))).toBe(true);
    expect(isPlanCandidate({ proposal: { base_scene: {}, candidate: {} } })).toBe(false);
    expect(isPlanCandidate(null)).toBe(false);
    expect(isPlanCandidate({ kind: 'scene' })).toBe(false);
  });

  it('计数取自 added 清单', () => {
    const candidate = makeCandidate({ zoneIds: ['a', 'b'], facilityIds: ['c'], workerIds: ['d'] });
    expect(planCandidateCounts(candidate)).toEqual({ zones: 2, facilities: 1, routes: 0, nodes: 0, workers: 1 });
  });

  it('分组清单只出非零组且顺序固定；warnings 原样透出', () => {
    const candidate = makeCandidate({ facilityIds: ['x'], workerIds: ['y', 'z'] }, [{ code: 'UNKNOWN_ZONE', ids: ['z1'] }]);
    expect(planCandidateGroupRows(candidate).map(row => [row.label, row.count])).toEqual([['设施', 1], ['人员点位', 2]]);
    expect(planCandidateWarnings(candidate)).toEqual([{ code: 'UNKNOWN_ZONE', ids: ['z1'] }]);
  });
});
