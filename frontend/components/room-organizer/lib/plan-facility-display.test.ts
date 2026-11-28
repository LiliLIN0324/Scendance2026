import { describe, expect, it } from 'vitest';
import {
  currentMaterialCount,
  facilityInventoryRows,
  facilitySubjects,
  planBoundaryAreaM2,
  planFacilityCount,
} from './plan-facility-display';
import { UNNAMED_MATERIAL } from './proposal-change-groups';
import type { FurnitureItem } from './types';
import type { PlanFacility, PlanPoint, SitePlanData } from '../../../../supabase/functions/_shared/site-plan';

const UUID_A = '11111111-1111-1111-1111-111111111111';
const UUID_B = '22222222-2222-2222-2222-222222222222';
const UUID_C = '33333333-3333-3333-3333-333333333333';

function makeFacility(overrides: Partial<PlanFacility> = {}): PlanFacility {
  return {
    id: UUID_A,
    templateId: 'dining-table',
    name: '主桌',
    position: { x: 1, y: 2 },
    rotationDeg: 0,
    size: { width: 1.8, depth: 1.8 },
    ...overrides,
  } as PlanFacility;
}

describe('plan-facility-display（S4 C-1 plan facilities 只读展示口径）', () => {
  it('空数组：计数 0、主体空、清单行空', () => {
    expect(planFacilityCount([])).toBe(0);
    expect(facilitySubjects([])).toEqual([]);
    expect(facilityInventoryRows([])).toEqual([]);
  });

  it('计数返回 facilities 长度，不再过滤 legacy 结构标记件', () => {
    const facilities = [
      makeFacility({ id: UUID_A, name: '圆桌' }),
      makeFacility({ id: UUID_B, name: '签到台' }),
      makeFacility({ id: UUID_C, name: '椅子' }),
    ];
    expect(planFacilityCount(facilities)).toBe(3);
  });

  it('subjects 按数组顺序映射，名字裁剪空白；空名兜底 UNNAMED_MATERIAL', () => {
    const facilities = [
      makeFacility({ id: UUID_A, name: ' 签到桌 ' }),
      makeFacility({ id: UUID_B, name: '   ' }),
      makeFacility({ id: UUID_C, name: '' }),
    ];
    expect(facilitySubjects(facilities)).toEqual([
      { id: UUID_A, name: '签到桌' },
      { id: UUID_B, name: UNNAMED_MATERIAL },
      { id: UUID_C, name: UNNAMED_MATERIAL },
    ]);
  });

  it('清单行按裁剪后 name 折叠，quantity 累加，首见顺序保留', () => {
    const facilities = [
      makeFacility({ id: UUID_A, name: '圆桌' }),
      makeFacility({ id: UUID_B, name: ' 圆桌 ' }),
      makeFacility({ id: UUID_C, name: '签到台' }),
    ];
    expect(facilityInventoryRows(facilities)).toEqual([
      { name: '圆桌', quantity: 2, lockedCount: 0 },
      { name: '签到台', quantity: 1, lockedCount: 0 },
    ]);
  });

  it('lockedCount 只累加 locked === true；缺省 / 非 true 按 false', () => {
    const facilities = [
      makeFacility({ id: UUID_A, name: '圆桌', locked: true }),
      makeFacility({ id: UUID_B, name: '圆桌', locked: true }),
      makeFacility({ id: UUID_C, name: '签到台' }),
      makeFacility({ id: UUID_C, name: '椅子', locked: undefined }),
    ];
    expect(facilityInventoryRows(facilities)).toEqual([
      { name: '圆桌', quantity: 2, lockedCount: 2 },
      { name: '签到台', quantity: 1, lockedCount: 0 },
      { name: '椅子', quantity: 1, lockedCount: 0 },
    ]);
  });

  it('入参不被修改', () => {
    const facilities = [
      makeFacility({ id: UUID_A, name: '圆桌', locked: true }),
      makeFacility({ id: UUID_B, name: '签到台' }),
    ];
    const before = JSON.stringify(facilities);
    facilitySubjects(facilities);
    facilityInventoryRows(facilities);
    expect(JSON.stringify(facilities)).toBe(before);
  });
});

function makeBoundaryPlan(boundary: PlanPoint[]): SitePlanData {
  return { boundary } as unknown as SitePlanData;
}

describe('planBoundaryAreaM2（S4 C-1c plan boundary 面积双读回落）', () => {
  it('plan 为 null：返回 null（调用方回落 legacy venueArea）', () => {
    expect(planBoundaryAreaM2(null)).toBeNull();
  });

  it.each([
    ['空环', []],
    ['1 点', [{ x: 0, y: 0 }]],
    ['2 点', [{ x: 0, y: 0 }, { x: 10, y: 0 }]],
  ])('边界点 <3（%s）：返回 null', (_label, boundary) => {
    expect(planBoundaryAreaM2(makeBoundaryPlan(boundary))).toBeNull();
  });

  it('合法环：返回鞋带公式真值（10×10 正方形 = 100 m²）', () => {
    const plan = makeBoundaryPlan([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ]);
    expect(planBoundaryAreaM2(plan)).toBe(100);
  });

  it('入参不被修改', () => {
    const plan = makeBoundaryPlan([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ]);
    const before = JSON.stringify(plan);
    planBoundaryAreaM2(plan);
    expect(JSON.stringify(plan)).toBe(before);
  });
});

function makeLegacyItem(overrides: Partial<FurnitureItem> = {}): FurnitureItem {
  return {
    id: 'legacy-1',
    type: 'glb-asset',
    name: '圆桌',
    width: 1,
    depth: 1,
    height: 1,
    color: '#ffffff',
    icon: '◇',
    ...overrides,
  };
}

function makeCountPlan(facilities: PlanFacility[]): SitePlanData {
  return { facilities } as unknown as SitePlanData;
}

describe('currentMaterialCount（S4 C-2 当前计数双读回落）', () => {
  it('bound 态：读 plan facilities 长度，legacy 候选数组被忽略', () => {
    const facilities = [
      makeFacility({ id: UUID_A }),
      makeFacility({ id: UUID_B }),
      makeFacility({ id: UUID_C }),
    ];
    const legacyItems = [
      makeLegacyItem(),
      makeLegacyItem({ id: 'legacy-2' }),
      makeLegacyItem({ id: 'legacy-3' }),
      makeLegacyItem({ id: 'legacy-4' }),
      makeLegacyItem({ id: 'legacy-5' }),
    ];
    expect(currentMaterialCount({ plan: makeCountPlan(facilities), legacyItems })).toBe(3);
  });

  it('legacy 草稿态（plan 为 null）：回落 materialCount，过滤结构标记件', () => {
    const legacyItems = [
      makeLegacyItem({ id: 'legacy-1' }),
      makeLegacyItem({ id: 'legacy-2' }),
      makeLegacyItem({ id: 'legacy-marker', structuralOpeningId: 'opening-1' }),
    ];
    expect(currentMaterialCount({ plan: null, legacyItems })).toBe(2);
  });

  it('bound 态空 facilities：返回 0，不读 legacy 件数', () => {
    const legacyItems = [makeLegacyItem(), makeLegacyItem({ id: 'legacy-2' })];
    expect(currentMaterialCount({ plan: makeCountPlan([]), legacyItems })).toBe(0);
  });

  it('legacy 态空 items：返回 0', () => {
    expect(currentMaterialCount({ plan: null, legacyItems: [] })).toBe(0);
  });

  it('入参不被修改', () => {
    const facilities = [makeFacility({ id: UUID_A, name: '圆桌' })];
    const legacyItems = [makeLegacyItem()];
    const plan = makeCountPlan(facilities);
    const beforePlan = JSON.stringify(plan);
    const beforeItems = JSON.stringify(legacyItems);
    currentMaterialCount({ plan, legacyItems });
    currentMaterialCount({ plan: null, legacyItems });
    expect(JSON.stringify(plan)).toBe(beforePlan);
    expect(JSON.stringify(legacyItems)).toBe(beforeItems);
  });
});
