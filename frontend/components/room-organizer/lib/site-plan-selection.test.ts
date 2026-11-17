import { describe, expect, it } from 'vitest';
import { planSelectionCount, type PlanSelectionCountInput } from './site-plan-selection';

const NONE: PlanSelectionCountInput = {
  zone: false,
  facility: false,
  route: false,
  node: false,
  worker: false,
  vehicle: false,
  multiRoute: 0,
  multiNode: 0,
  multiFacility: 0,
};

describe('planSelectionCount', () => {
  it('没选中任何东西时是 0（属性卡走空状态）', () => {
    expect(planSelectionCount(NONE)).toBe(0);
  });

  // 2026-11-17 #118 回归：车辆漏算 → 选中车后「属性」卡不弹，模型/台数/删除都够不着。
  it('选中一辆车算 1 件（车必须进选中数，否则属性卡弹不出来）', () => {
    expect(planSelectionCount({ ...NONE, vehicle: true })).toBe(1);
  });

  it('六类单选实体各算 1 件', () => {
    expect(planSelectionCount({
      zone: true,
      facility: true,
      route: true,
      node: true,
      worker: true,
      vehicle: true,
      multiRoute: 0,
      multiNode: 0,
      multiFacility: 0,
    })).toBe(6);
  });

  it('多选动线与出入口按条数累加', () => {
    expect(planSelectionCount({ ...NONE, multiRoute: 3, multiNode: 2 })).toBe(5);
  });

  it('设施多选 ≥ 2 才算 1 件（单件已由 facility 计过）', () => {
    expect(planSelectionCount({ ...NONE, multiFacility: 1 })).toBe(0);
    expect(planSelectionCount({ ...NONE, multiFacility: 2 })).toBe(1);
    expect(planSelectionCount({ ...NONE, multiFacility: 4 })).toBe(1);
  });

  it('车与多选同时存在时件数相加', () => {
    expect(planSelectionCount({ ...NONE, vehicle: true, multiRoute: 2 })).toBe(3);
  });
});
