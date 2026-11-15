import { describe, expect, it } from 'vitest';
import { sitePlanDataSchema } from '../../../../supabase/functions/_shared/site-plan';

/** 一份最小可用的规划数据（除 designScope 外都取空集合）。 */
function basePlan(extra: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1 as const,
    boundary: [],
    zones: [],
    facilities: [],
    routes: [],
    nodes: [],
    workers: [],
    ...extra,
  };
}

const square = [
  { x: -20, y: -20 },
  { x: 40, y: -20 },
  { x: 40, y: 40 },
  { x: -20, y: 40 },
];

describe('site plan 契约：设计范围 designScope', () => {
  it('接受一圈合法外框，且原样保留坐标', () => {
    const plan = sitePlanDataSchema.parse(basePlan({ designScope: square }));
    expect(plan.designScope).toHaveLength(4);
    expect(plan.designScope?.[2]).toEqual({ x: 40, y: 40 });
  });

  it('旧数据不带该字段照常解析（缺省 undefined，不自动补默认外框）', () => {
    const plan = sitePlanDataSchema.parse(basePlan());
    expect(plan.designScope).toBeUndefined();
  });

  it('空数组合法——表示用户明确「不设范围」', () => {
    const plan = sitePlanDataSchema.parse(basePlan({ designScope: [] }));
    expect(plan.designScope).toEqual([]);
  });

  it('画到一半的 1–2 点不落盘（与场地边界同一口径）', () => {
    expect(() => sitePlanDataSchema.parse(basePlan({ designScope: square.slice(0, 2) }))).toThrow();
    expect(() => sitePlanDataSchema.parse(basePlan({ designScope: [square[0]!] }))).toThrow();
  });

  it('顶点上限 64：再多也拒绝，避免把整条街画进来', () => {
    const tooMany = Array.from({ length: 65 }, (_, i) => ({ x: i, y: i % 7 }));
    expect(() => sitePlanDataSchema.parse(basePlan({ designScope: tooMany }))).toThrow();
  });
});
