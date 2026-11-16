/**
 * 提案合并/携带的纯函数级回归（2026-11-16 #121 车辆接入读取层）。
 *
 * 锁两件事且必须成对：
 * 1) `baseStillIntact` 把「基座之后用户新画的车」当纯新增，不误判成规划已变化；
 * 2) `carryNewEntities` 真的把新车带回提案——只加键表不加携带，会得到「判定完好但车被覆盖丢失」。
 * 另锁：基座里的车被删/被改仍算规划已变化，旧 plan 不因合并凭空长出 vehicles 字段。
 */
import { describe, expect, it } from 'vitest';
import type { PlanVehicle, SitePlanData } from '../../../../supabase/functions/_shared/site-plan';
import { baseStillIntact, carryNewEntities } from './use-outdoor-agent-workflow';

const ZONE_1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CAR_A = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const CAR_B = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

function plan(overrides: Partial<SitePlanData> = {}): SitePlanData {
  return {
    schemaVersion: 1,
    boundary: [],
    zones: [],
    facilities: [],
    routes: [],
    nodes: [],
    workers: [],
    ...overrides,
  };
}

function car(id: string, overrides: Partial<PlanVehicle> = {}): PlanVehicle {
  return { id, type: 'coach', count: 2, position: { x: 1, y: 2 }, notes: '', ...overrides };
}

const zone = {
  id: ZONE_1,
  semantic: 'audience' as const,
  name: '展览区',
  polygon: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }],
  notes: '',
};

describe('baseStillIntact（车辆）', () => {
  it('基座之后用户新画的车不算「规划已变化」', () => {
    const base = plan();
    const current = plan({ vehicles: [car(CAR_A)] });
    expect(baseStillIntact(base, current)).toBe(true);
  });

  it('基座里的车被删或被改仍算规划已变化（不拿基座覆盖用户编辑）', () => {
    const base = plan({ vehicles: [car(CAR_A)] });
    expect(baseStillIntact(base, plan({ vehicles: [car(CAR_A)] }))).toBe(true);
    expect(baseStillIntact(base, plan({ vehicles: [] }))).toBe(false);
    expect(baseStillIntact(base, plan({ vehicles: [car(CAR_A, { count: 5 })] }))).toBe(false);
  });
});

describe('carryNewEntities（车辆）', () => {
  it('只加键表不加携带会丢车：判定完好时新车必须原样并回提案', () => {
    const base = plan();
    const proposal = plan({ zones: [zone] });
    const current = plan({ vehicles: [car(CAR_A)] });
    expect(baseStillIntact(base, current)).toBe(true);
    const carried = carryNewEntities(base, proposal, current);
    expect(carried.zones).toEqual([zone]);
    expect(carried.vehicles).toEqual([car(CAR_A)]);
  });

  it('提案自带的车保留，用户新画的车追加，不互相覆盖', () => {
    const base = plan({ vehicles: [car(CAR_A)] });
    const proposal = plan({ vehicles: [car(CAR_A)], zones: [zone] });
    const current = plan({ vehicles: [car(CAR_A), car(CAR_B)] });
    const carried = carryNewEntities(base, proposal, current);
    expect(carried.vehicles?.map(v => v.id)).toEqual([CAR_A, CAR_B]);
  });

  it('旧 plan 无 vehicles 字段：合并结果不带该字段（不合成空数组）', () => {
    const base = plan();
    const proposal = plan({ zones: [zone] });
    const carried = carryNewEntities(base, proposal, plan());
    expect('vehicles' in carried).toBe(false);
    expect(carried.zones).toEqual([zone]);
  });

  it('提案显式带空车辆集合时保持原样，不悄悄删字段', () => {
    const base = plan({ vehicles: [] });
    const proposal = plan({ vehicles: [] });
    const carried = carryNewEntities(base, proposal, plan({ vehicles: [] }));
    expect(carried.vehicles).toEqual([]);
  });
});
