import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { agentEventOutcome, agentEventTools } from '../supabase/functions/_shared/agent-events.ts';
import { AGENT_PLAN_OBSERVATION_NOTICE } from '../supabase/functions/_shared/site-plan.ts';
import {
  addPlanFacilities,
  addPlanRoutes,
  addPlanWorkers,
  addPlanZones,
  buildPlanCandidate,
  createStarterOutdoorPlan,
  findFacilityTemplate,
  isAllowedFacilityTemplate,
  planCandidateUncovered,
  agentPlanCandidateSchema,
} from '../supabase/functions/_shared/plan-candidate.ts';
import {
  ONEPLAN_PLACEABLE_TEMPLATE_IDS,
  isOneplanPlaceableTemplateId,
  parseOneplanTemplateId,
} from '../supabase/functions/_shared/oneplan-whitelist.ts';

const uuid = () => crypto.randomUUID();
const gen = () => crypto.randomUUID();

function resetCounter() { /* 真实 uuid，无需计数器 */ }

describe('户外 planCandidate 契约与内存工作副本（#46-1）', () => {
  it('起步草稿为空集合且过 site-plan 契约', () => {
    const plan = createStarterOutdoorPlan();
    expect(plan.zones).toEqual([]);
    expect(plan.facilities).toEqual([]);
    expect(plan.routes).toEqual([]);
    expect(plan.nodes).toEqual([]);
    expect(plan.workers).toEqual([]);
    expect(plan.schemaVersion).toBe(1);
  });

  it('内置模板白名单命中已知 slug，未知 slug 不命中', () => {
    expect(findFacilityTemplate('booth-2x2')?.name).toBe('市集摊位');
    expect(findFacilityTemplate('pack:fairs:duck-pond-booth')).toBeNull();
    expect(findFacilityTemplate('does-not-exist')).toBeNull();
  });

  it('oneplan 白名单与 manifest 可放置条目一致；内置模板仍兼容，未知/包条目拒绝', () => {
    const manifest = JSON.parse(readFileSync(new URL('../frontend/public/oneplan-icons/manifest.json', import.meta.url), 'utf8'));
    const kindMap = { icon: 'icon', 'scale-fg': 'scale', area: 'area' } as Record<string, string>;
    const expected: string[] = [];
    for (const asset of manifest.assets) {
      const kind = kindMap[asset.kind];
      const slug = (asset.slug ?? '').trim();
      if (kind && slug) expected.push(`oneplan:${kind}:${slug}`);
    }
    expect(ONEPLAN_PLACEABLE_TEMPLATE_IDS).toHaveLength(expected.length);
    expect([...ONEPLAN_PLACEABLE_TEMPLATE_IDS].sort()).toEqual([...expected].sort());

    const sample = ONEPLAN_PLACEABLE_TEMPLATE_IDS[0]!;
    expect(isOneplanPlaceableTemplateId(sample)).toBe(true);
    expect(parseOneplanTemplateId(sample)).toMatchObject({ kind: expect.any(String), slug: expect.any(String) });
    expect(isAllowedFacilityTemplate('booth-2x2')).toBe(true);
    expect(isAllowedFacilityTemplate(sample)).toBe(true);
    expect(isAllowedFacilityTemplate('pack:fairs:duck-pond-booth')).toBe(false);
    expect(isAllowedFacilityTemplate('oneplan:scale-bg:parking')).toBe(false);
    expect(isAllowedFacilityTemplate('oneplan:icon:no-such-slug')).toBe(false);
    expect(isAllowedFacilityTemplate('does-not-exist')).toBe(false);
  });

  it('oneplan 条目用占位尺寸落位并生成可读名，仍不引入未知 slug', () => {
    const draft = createStarterOutdoorPlan();
    const sample = ONEPLAN_PLACEABLE_TEMPLATE_IDS.find(id => id.startsWith('oneplan:icon:'))!;
    const res = addPlanFacilities(draft, [{ templateId: sample, position: { x: 10, y: 10 } }], gen);
    expect(res.draft.facilities).toHaveLength(1);
    expect(res.draft.facilities[0]?.size).toEqual({ width: 1.5, depth: 1.5 });
    expect(res.draft.facilities[0]?.name).not.toBe('');
    expect(res.warnings).toEqual([]);
  });

  it('追加分区批次：服务端生成 id、计数累加、自交退化环出 warning', () => {
    resetCounter();
    const draft = createStarterOutdoorPlan();
    const validPolygon = [{ x: 10, y: 10 }, { x: 40, y: 10 }, { x: 40, y: 30 }, { x: 10, y: 30 }];
    const result = addPlanZones(draft, [{ semantic: 'audience', name: '观众区', polygon: validPolygon }], gen);
    expect(result.added.zoneIds).toHaveLength(1);
    expect(result.draft.zones).toHaveLength(1);
    expect(result.draft.zones[0]?.id).toBe(result.added.zoneIds[0]);
    expect(result.warnings).toEqual([]);

    const degenerate = addPlanZones(result.draft, [{
      semantic: 'stage', name: '舞台',
      polygon: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 0 }, { x: 0, y: 5 }],
    }], gen);
    expect(degenerate.draft.zones).toHaveLength(1);
    expect(degenerate.warnings.some(w => w.code === 'ZONE_DEGENERATE')).toBe(true);
  });

  it('追加设施：命中模板取模板尺寸；未知模板被跳过并出 warning，不静默造件', () => {
    resetCounter();
    const draft = createStarterOutdoorPlan();
    const ok = addPlanFacilities(draft, [
      { templateId: 'booth-2x2', position: { x: 20, y: 20 } },
      { templateId: 'pack:unknown:fake', position: { x: 30, y: 30 } },
    ], gen);
    expect(ok.draft.facilities).toHaveLength(1);
    expect(ok.draft.facilities[0]?.size).toEqual({ width: 2, depth: 2 });
    expect(ok.warnings.some(w => w.code === 'UNKNOWN_TEMPLATE')).toBe(true);
  });

  it('悬空 zoneId 出 warning；人员计数落位', () => {
    resetCounter();
    const draft = createStarterOutdoorPlan();
    const res = addPlanWorkers(draft, [{
      role: '志愿者', count: 6, position: { x: 15, y: 15 }, zoneId: uuid(),
    }], gen);
    expect(res.draft.workers).toHaveLength(0);
    expect(res.warnings.some(w => w.code === 'UNKNOWN_ZONE')).toBe(true);

    const ok = addPlanWorkers(res.draft, [{ role: '安保', count: 2, position: { x: 5, y: 5 } }], gen);
    expect(ok.draft.workers).toHaveLength(1);
    expect(ok.draft.workers[0]?.count).toBe(2);
  });

  it('动线引用本批新节点；悬空节点引用出 warning', () => {
    resetCounter();
    const draft = createStarterOutdoorPlan();
    const withNode = addPlanRoutes(draft, [{ kind: 'entry', name: '主入口', position: { x: 0, y: 0 } }], [
      { kind: 'pedestrian', name: '入口通道', points: [{ x: 0, y: 0 }, { x: 20, y: 20 }], startNodeId: undefined, endNodeId: undefined },
    ], gen);
    expect(withNode.draft.nodes).toHaveLength(1);
    expect(withNode.draft.routes).toHaveLength(1);

    const dangling = addPlanRoutes(withNode.draft, [], [{
      kind: 'vehicle', name: '货车通道', points: [{ x: 0, y: 0 }, { x: 50, y: 50 }], endNodeId: uuid(),
    }], gen);
    expect(dangling.draft.routes).toHaveLength(1);
    expect(dangling.warnings.some(w => w.code === 'UNKNOWN_NODE')).toBe(true);
  });

  it('候选信封：kind 判别位、固定 notice、added 清单与 uncovered 固定项', () => {
    resetCounter();
    const draft = createStarterOutdoorPlan();
    const zones = addPlanZones(draft, [{
      semantic: 'checkin', name: '签到区',
      polygon: [{ x: 2, y: 2 }, { x: 20, y: 2 }, { x: 20, y: 12 }, { x: 2, y: 12 }],
    }], gen);
    const candidate = buildPlanCandidate(zones.draft, zones.added, '示意签到分区，需现场核验', zones.warnings, null);
    const parsed = agentPlanCandidateSchema.parse(candidate);
    expect(parsed.kind).toBe('plan');
    expect(parsed.notice).toBe(AGENT_PLAN_OBSERVATION_NOTICE);
    expect(parsed.added.zoneIds).toHaveLength(1);
    expect(planCandidateUncovered.map(u => u.id)).toEqual(['exit', 'egress', 'accessibility', 'fire', 'capacity', 'anchor']);
  });

  it('事件白名单包含 7 个户外工具；提交/校验回执映射正确', () => {
    const outdoor = ['get_outdoor_plan', 'prepare_plan_zones', 'prepare_plan_facilities', 'prepare_plan_routes', 'prepare_plan_workers', 'validate_plan_candidate', 'submit_plan_candidates'];
    for (const tool of outdoor) expect(agentEventTools).toContain(tool);

    expect(agentEventOutcome('submit_plan_candidates', { accepted: 1 }).outcome).toBe('success');
    expect(agentEventOutcome('submit_plan_candidates', { accepted: 0, errors: [{ code: 'PLAN_CANDIDATE_NOT_FOUND', ids: [] }] }).outcome).toBe('failed');
    expect(agentEventOutcome('validate_plan_candidate', { valid: true }).outcome).toBe('success');
    expect(agentEventOutcome('validate_plan_candidate', { valid: false, code: 'UNKNOWN_ZONE' }).outcome).toBe('failed');
    expect(agentEventOutcome('prepare_plan_zones', { preparedId: uuid() }).outcome).toBe('success');
  });
});
