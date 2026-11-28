import { describe, expect, it } from 'vitest';
import {
  facilityInventoryRows,
  facilitySubjects,
  planFacilityCount,
} from './plan-facility-display';
import { UNNAMED_MATERIAL } from './proposal-change-groups';
import type { PlanFacility } from '../../../../supabase/functions/_shared/site-plan';

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
