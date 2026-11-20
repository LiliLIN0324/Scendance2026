import { describe, expect, it } from 'vitest';
import type { SitePlanData } from '../../../../supabase/functions/_shared/site-plan';
import {
  PLAN_LOCATE_MISSING_TEXT,
  PLAN_LOCATE_NO_ANCHOR_TEXT,
  keepPlanEntityIds,
  planContainsEntityId,
  planEntityExists,
  resolvePlanLocate,
} from './plan-locate';

/**
 * 2026-11-20 审计 B7 / F6：定位前先问「这东西还在吗、锚点算出来了吗」。
 * 这些用例锁的是判定顺序：对象已删除优先于没有锚点，两者都不许飞。
 */
function planWith(partial: Partial<Record<'zones' | 'facilities' | 'routes' | 'nodes' | 'workers' | 'vehicles' | 'measurements' | 'annotations', string[]>>): SitePlanData {
  const ids = (kind: keyof typeof partial) => (partial[kind] ?? []).map(id => ({ id }));
  return {
    schemaVersion: 1,
    boundary: [],
    zones: ids('zones'),
    facilities: ids('facilities'),
    routes: ids('routes'),
    nodes: ids('nodes'),
    workers: ids('workers'),
    vehicles: ids('vehicles'),
    measurements: ids('measurements'),
    annotations: ids('annotations'),
  } as unknown as SitePlanData;
}

const plan = planWith({
  zones: ['z1'],
  facilities: ['f1', 'f2'],
  routes: ['r1'],
  nodes: ['n1'],
  workers: ['w1'],
  vehicles: ['v1'],
  measurements: ['m1'],
  annotations: ['a1'],
});

describe('plan-locate · 实体是否还在', () => {
  it('按类型查对应集合', () => {
    expect(planEntityExists(plan, 'facility', 'f1')).toBe(true);
    expect(planEntityExists(plan, 'vehicle', 'v1')).toBe(true);
    expect(planEntityExists(plan, 'annotation', 'a1')).toBe(true);
    expect(planEntityExists(plan, 'facility', 'z1')).toBe(false);
    expect(planEntityExists(plan, 'facility', '')).toBe(false);
  });

  it('不知道类型时按全部集合查（给 Agent 的选中 id 用）', () => {
    expect(planContainsEntityId(plan, 'w1')).toBe(true);
    expect(planContainsEntityId(plan, 'nope')).toBe(false);
  });

  it('过滤悬空 id：保持顺序、去重、只留方案里真实存在的', () => {
    expect(keepPlanEntityIds(plan, ['f2', 'gone', 'z1', 'f2', null, undefined])).toEqual(['f2', 'z1']);
  });
});

describe('plan-locate · 定位请求', () => {
  it('对象还在且有锚点才放行', () => {
    expect(resolvePlanLocate(plan, { kind: 'facility', id: 'f1', anchor: { x: 3, y: 4 } }))
      .toEqual({ status: 'ok', anchor: { x: 3, y: 4 } });
  });

  it('对象已被删除：即使有锚点也不飞，并且说清原因', () => {
    const result = resolvePlanLocate(plan, { kind: 'facility', id: 'gone', anchor: { x: 3, y: 4 } });
    expect(result.status).toBe('missing');
    if (result.status === 'missing') expect(result.message).toBe(PLAN_LOCATE_MISSING_TEXT);
  });

  it('缺锚点不飞（问题条目在别的楼层时就是这样）', () => {
    const result = resolvePlanLocate(plan, { kind: 'zone', id: 'z1', anchor: null });
    expect(result.status).toBe('unknown-anchor');
    if (result.status === 'unknown-anchor') expect(result.message).toBe(PLAN_LOCATE_NO_ANCHOR_TEXT);
  });

  it('锚点不是有限数也不飞（避免飞到 NaN 视图）', () => {
    expect(resolvePlanLocate(plan, { anchor: { x: Number.NaN, y: 0 } }).status).toBe('unknown-anchor');
    expect(resolvePlanLocate(plan, { anchor: { x: 0, y: Number.POSITIVE_INFINITY } }).status).toBe('unknown-anchor');
  });

  it('不指向具体实体的记录（冲突规则只给锚点）只看锚点', () => {
    expect(resolvePlanLocate(plan, { anchor: { x: 1, y: 2 } }).status).toBe('ok');
  });
});
