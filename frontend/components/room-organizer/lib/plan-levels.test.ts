import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PLAN_LEVEL_ID,
  PLAN_LEVEL_MAX,
  addPlanLevel,
  deletePlanLevel,
  entityLevelId,
  filterPlanByLevel,
  nextPlanLevelName,
  planLevels,
  renamePlanLevel,
} from './plan-levels';
import { sitePlanDataSchema, type SitePlanData } from '../../../../supabase/functions/_shared/site-plan';

const LEVEL_1 = '11111111-1111-4111-8111-111111111111';
const LEVEL_2 = '22222222-2222-4222-8222-222222222222';
const ZONE_1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ZONE_2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const FACILITY_1 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function basePlan(): SitePlanData {
  return {
    schemaVersion: 1,
    boundary: [],
    zones: [
      { id: ZONE_1, semantic: 'audience', name: '观众区 1', polygon: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], notes: '' },
    ],
    facilities: [
      {
        id: FACILITY_1, templateId: 'booth-2x2', name: '棚房', position: { x: 5, y: 5 },
        rotationDeg: 0, size: { width: 2, depth: 2 }, notes: '',
      },
    ],
    routes: [],
    nodes: [],
    workers: [],
  };
}

describe('planLevels（旧数据合成默认层，不落盘）', () => {
  it('synthesizes a single default level when levels is absent', () => {
    const levels = planLevels(basePlan());
    expect(levels).toEqual([{ id: DEFAULT_PLAN_LEVEL_ID, name: '图层 1' }]);
  });

  it('returns persisted levels verbatim when present', () => {
    const plan = { ...basePlan(), levels: [{ id: LEVEL_1, name: '方案 A' }] };
    expect(planLevels(plan)).toEqual([{ id: LEVEL_1, name: '方案 A' }]);
  });
});

describe('filterPlanByLevel', () => {
  it('treats entities without levelId as first-level members（旧实体归默认层）', () => {
    const plan = basePlan();
    const view = filterPlanByLevel(plan, DEFAULT_PLAN_LEVEL_ID);
    expect(view.zones.map(z => z.id)).toEqual([ZONE_1]);
    expect(view.facilities.map(f => f.id)).toEqual([FACILITY_1]);
  });

  it('keeps only the target level’s entities while boundary stays shared', () => {
    const plan: SitePlanData = {
      ...basePlan(),
      levels: [{ id: LEVEL_1, name: '方案 A' }, { id: LEVEL_2, name: '方案 B' }],
      zones: [
        { id: ZONE_1, semantic: 'audience', name: 'A 区', polygon: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], notes: '' },
        { id: ZONE_2, semantic: 'stage', name: 'B 区', levelId: LEVEL_2, polygon: [{ x: 20, y: 20 }, { x: 30, y: 20 }, { x: 30, y: 30 }], notes: '' },
      ],
      boundary: [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 40 }],
    };
    const viewA = filterPlanByLevel(plan, LEVEL_1);
    expect(viewA.zones.map(z => z.id)).toEqual([ZONE_1]);
    expect(viewA.boundary).toHaveLength(3);
    const viewB = filterPlanByLevel(plan, LEVEL_2);
    expect(viewB.zones.map(z => z.id)).toEqual([ZONE_2]);
  });
});

describe('addPlanLevel', () => {
  it('materializes the synthetic default level on first add（第一层落盘，旧实体不丢归属）', () => {
    const result = addPlanLevel(basePlan(), undefined, LEVEL_2);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.level).toEqual({ id: LEVEL_2, name: '图层 2' });
    expect(result.value.plan.levels).toEqual([
      { id: DEFAULT_PLAN_LEVEL_ID, name: '图层 1' },
      { id: LEVEL_2, name: '图层 2' },
    ]);
    // 新 plan 仍过契约：旧实体无 levelId 归第一层。
    expect(sitePlanDataSchema.safeParse(result.value.plan).success).toBe(true);
  });

  it('fills the smallest unused 图层 N name（删过层也不撞名）', () => {
    const plan: SitePlanData = {
      ...basePlan(),
      levels: [{ id: LEVEL_1, name: '图层 1' }, { id: LEVEL_2, name: '图层 3' }],
    };
    expect(nextPlanLevelName(plan)).toBe('图层 2');
  });

  it('rejects beyond the level cap', () => {
    const plan: SitePlanData = {
      ...basePlan(),
      levels: Array.from({ length: PLAN_LEVEL_MAX }, (_, i) => ({ id: `${String(i).padStart(8, '0')}-0000-4000-8000-000000000000`, name: `图层 ${i + 1}` })),
    };
    const result = addPlanLevel(plan, undefined, LEVEL_2);
    expect(result.ok).toBe(false);
  });
});

describe('renamePlanLevel', () => {
  it('renames and trims；空名拒绝', () => {
    const plan: SitePlanData = { ...basePlan(), levels: [{ id: LEVEL_1, name: '方案 A' }] };
    const ok = renamePlanLevel(plan, LEVEL_1, '  方案 A2  ');
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.value.levels).toEqual([{ id: LEVEL_1, name: '方案 A2' }]);
    expect(renamePlanLevel(plan, LEVEL_1, '   ').ok).toBe(false);
    expect(renamePlanLevel(plan, LEVEL_2, 'x').ok).toBe(false);
  });

  it('renaming the synthetic default level persists it first', () => {
    const result = renamePlanLevel(basePlan(), DEFAULT_PLAN_LEVEL_ID, '主方案');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.levels).toEqual([{ id: DEFAULT_PLAN_LEVEL_ID, name: '主方案' }]);
  });
});

describe('deletePlanLevel', () => {
  it('removes the level and all its entities；无 levelId 实体不受影响', () => {
    const plan: SitePlanData = {
      ...basePlan(),
      levels: [{ id: LEVEL_1, name: '方案 A' }, { id: LEVEL_2, name: '方案 B' }],
      zones: [
        { id: ZONE_1, semantic: 'audience', name: 'A 区', polygon: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], notes: '' },
        { id: ZONE_2, semantic: 'stage', name: 'B 区', levelId: LEVEL_2, polygon: [{ x: 20, y: 20 }, { x: 30, y: 20 }, { x: 30, y: 30 }], notes: '' },
      ],
    };
    const result = deletePlanLevel(plan, LEVEL_2);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.levels).toEqual([{ id: LEVEL_1, name: '方案 A' }]);
    expect(result.value.zones.map(z => z.id)).toEqual([ZONE_1]);
    expect(sitePlanDataSchema.safeParse(result.value).success).toBe(true);
  });

  it('refuses to delete the last remaining level', () => {
    expect(deletePlanLevel(basePlan(), DEFAULT_PLAN_LEVEL_ID).ok).toBe(false);
  });

  it('deleting the first level takes implicit（无 levelId）entities with it', () => {
    const plan: SitePlanData = { ...basePlan(), levels: [{ id: LEVEL_1, name: 'A' }, { id: LEVEL_2, name: 'B' }] };
    const result = deletePlanLevel(plan, LEVEL_1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.zones).toEqual([]);
    expect(result.value.facilities).toEqual([]);
    expect(entityLevelId(result.value, { })).toBe(LEVEL_2);
  });
});
