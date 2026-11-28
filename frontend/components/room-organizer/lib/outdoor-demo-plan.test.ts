import { describe, expect, it } from 'vitest';
import {
  createDemoOutdoorPlan,
  DEMO_OUTDOOR_FACILITY_COUNT,
  DEMO_OUTDOOR_WORKER_COUNT,
} from './outdoor-demo-plan';
import { findFacilityTemplate } from './site-plan-facilities';
import { sitePlanDataSchema } from '../../../../supabase/functions/_shared/site-plan';
import { DEFAULT_SCOPE_MARGIN_M, expandRect } from './outdoor-design-scope';

describe('outdoor-demo-plan（内置示范场景）', () => {
  it('过站点规划 schema，实体计数与目录常量一致', () => {
    const plan = createDemoOutdoorPlan();
    const verified = sitePlanDataSchema.safeParse(plan);
    expect(verified.success).toBe(true);
    if (!verified.success) return;
    expect(verified.data.facilities).toHaveLength(DEMO_OUTDOOR_FACILITY_COUNT);
    expect(verified.data.workers).toHaveLength(DEMO_OUTDOOR_WORKER_COUNT);
  });

  it('给出闭合矩形边界（4 顶点），分区/动线/出入口为空', () => {
    const plan = createDemoOutdoorPlan();
    expect(plan.boundary).toHaveLength(4);
    expect(plan.zones).toEqual([]);
    expect(plan.routes).toEqual([]);
    expect(plan.nodes).toEqual([]);
  });

  it('设施 templateId 全部在册模板目录内', () => {
    const plan = createDemoOutdoorPlan();
    for (const facility of plan.facilities) {
      expect(findFacilityTemplate(facility.templateId)).not.toBeNull();
    }
  });

  it('所有实体 id 唯一（跨设施/岗位不撞号）', () => {
    const plan = createDemoOutdoorPlan();
    const ids = [
      ...plan.facilities.map(item => item.id),
      ...plan.workers.map(item => item.id),
    ];
    expect(new Set(ids)).toHaveLength(ids.length);
  });

  it('工厂每次返回独立对象，就地改写不污染后续副本', () => {
    const first = createDemoOutdoorPlan();
    first.facilities[0]!.name = '被改掉';
    const second = createDemoOutdoorPlan();
    expect(second.facilities[0]!.name).not.toBe('被改掉');
    expect(second.facilities).toHaveLength(DEMO_OUTDOOR_FACILITY_COUNT);
  });
});

// 2026-11-17 同一标准：示范方案也是「带红线的成品」，不能只画红线不给白框。
describe('demo plan 的设计范围', () => {
  it('自带默认外扩的白框，四个角正好各边外扩一个 margin', () => {
    const plan = createDemoOutdoorPlan();
    expect(plan.designScope).toEqual(expandRect(plan.boundary, DEFAULT_SCOPE_MARGIN_M));
    expect(plan.designScope).toHaveLength(4);
  });

  it('仍旧是独立对象：改一份的白框不会污染下一份', () => {
    const first = createDemoOutdoorPlan();
    first.designScope![0]!.x = 999;
    expect(createDemoOutdoorPlan().designScope![0]!.x).not.toBe(999);
  });
});
