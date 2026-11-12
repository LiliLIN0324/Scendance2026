import { describe, expect, it } from 'vitest';
import {
  addPlanFacilities,
  addPlanWorkers,
  addPlanZones,
  buildPlanCandidate,
  createStarterOutdoorPlan,
  type AgentPlanCandidate,
} from '../../../../supabase/functions/_shared/plan-candidate';
import type { SitePlanData } from '../../../../supabase/functions/_shared/site-plan';
import { applyPlanCandidate, checkCandidateConsistency } from './plan-candidate-apply';

const gen = () => crypto.randomUUID();

function makeCandidate(): { candidate: AgentPlanCandidate; plan: SitePlanData } {
  let draft = createStarterOutdoorPlan();
  const zones = addPlanZones(draft, [{
    semantic: 'audience', name: '观众区', notes: '',
    polygon: [{ x: 2, y: 2 }, { x: 20, y: 2 }, { x: 20, y: 12 }, { x: 2, y: 12 }],
  }], gen);
  draft = zones.draft;
  const facilities = addPlanFacilities(draft, [{ templateId: 'booth-2x2', position: { x: 8, y: 6 }, notes: '' }], gen);
  draft = facilities.draft;
  const workers = addPlanWorkers(draft, [{ role: '志愿者', count: 3, position: { x: 10, y: 8 }, notes: '' }], gen);
  draft = workers.draft;
  const added = {
    zoneIds: zones.added.zoneIds, facilityIds: facilities.added.facilityIds,
    workerIds: workers.added.workerIds, routeIds: [], nodeIds: [],
  };
  const candidate = buildPlanCandidate(draft, added, '测试方案，待现场核验', [], null);
  return { candidate, plan: draft };
}

describe('plan-candidate-apply 确认装配', () => {
  it('一致性通过时把分区/设施/人员装配进当前平面，applied 与 added 对齐', () => {
    const { candidate } = makeCandidate();
    const current = createStarterOutdoorPlan();
    const result = applyPlanCandidate(current, candidate, {
      snapshotAnchor: null, currentAnchor: null, snapshotPlanHash: 'h1', currentPlanHash: 'h1',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.zones).toHaveLength(1);
    expect(result.plan.facilities).toHaveLength(1);
    expect(result.plan.workers).toHaveLength(1);
    expect(result.applied).toEqual(expect.arrayContaining([...candidate.added.zoneIds, ...candidate.added.facilityIds, ...candidate.added.workerIds]));
    // 当前平面原有实体不被清空。
    expect(result.plan.boundary).toEqual(current.boundary);
  });

  it('planHash 不一致阻断装配，返回 stale-plan-hash 且不改平面', () => {
    const { candidate } = makeCandidate();
    const current = createStarterOutdoorPlan();
    const result = applyPlanCandidate(current, candidate, {
      snapshotAnchor: null, currentAnchor: null, snapshotPlanHash: 'old', currentPlanHash: 'new',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issue.code).toBe('stale-plan-hash');
    expect(current.zones).toHaveLength(0);
  });

  it('锚点漂移阻断装配，返回 anchor-mismatch', () => {
    const { candidate } = makeCandidate();
    const current = createStarterOutdoorPlan();
    const issue = checkCandidateConsistency({
      snapshotAnchor: { lng: 120.11, lat: 30.25, crs: 'gcj-02', source: 'preset' },
      currentAnchor: { lng: 120.20, lat: 30.30, crs: 'gcj-02', source: 'preset' },
    });
    expect(issue?.code).toBe('anchor-mismatch');
    const result = applyPlanCandidate(current, candidate, {
      snapshotAnchor: { lng: 120.11, lat: 30.25, crs: 'gcj-02', source: 'preset' },
      currentAnchor: { lng: 120.20, lat: 30.30, crs: 'gcj-02', source: 'preset' },
    });
    expect(result.ok).toBe(false);
    expect(current.facilities).toHaveLength(0);
  });

  it('已存在的实体 id 跳过，不重复摆放；拒绝路径不调用装配即保持原平面', () => {
    const { candidate } = makeCandidate();
    const first = applyPlanCandidate(createStarterOutdoorPlan(), candidate, { snapshotAnchor: null, currentAnchor: null });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = applyPlanCandidate(first.plan, candidate, { snapshotAnchor: null, currentAnchor: null });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.plan.facilities).toHaveLength(1);
    expect(second.plan.zones).toHaveLength(1);
    expect(second.plan.workers).toHaveLength(1);
    expect(second.applied).toEqual([]);
  });
});
