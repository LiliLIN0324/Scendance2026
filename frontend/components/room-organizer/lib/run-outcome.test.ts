import { describe, expect, it } from 'vitest';
import { buildOutcome, outcomeLines, outcomeOfPlan } from './run-outcome';
import type { PlanProposal } from './agent-proposal';

const plan = (overrides: Partial<PlanProposal> = {}): PlanProposal => ({
  layouts: [], added: 0, removing: 0, keptLocked: 0, dropped: 0,
  overlapCount: 0, overlapNames: [], blocked: null, diagnostics: [], ...overrides,
});

describe('run-outcome — 一次运行的账单', () => {
  it('成功、被拒、锁定各占一行，被拒按原因分开说', () => {
    const outcome = outcomeOfPlan(plan({
      added: 8, removing: 2, keptLocked: 3, dropped: 4,
      diagnostics: [
        { severity: 'warning', code: 'OUT_OF_BOUNDS', count: 3, names: ['餐椅'], message: '超出场地边界' },
        { severity: 'warning', code: 'STRUCTURAL_COLLISION', count: 1, names: ['餐桌'], message: '压墙或立柱' },
      ],
    }));
    expect(outcome.placed).toBe(8);
    expect(outcome.refused.reduce((sum, item) => sum + item.count, 0)).toBe(4);
    expect(outcomeLines(outcome)).toEqual([
      '放进 8 件 · 撤掉 2 件',
      '没放进去 4 件：超出场地边界 3 件、压墙或立柱 1 件',
      '锁定 3 件我没动',
    ]);
  });

  it('一版什么都没放进去时，账单给出空结果原因而不是只说 0 件', () => {
    const outcome = outcomeOfPlan(plan());
    expect(outcome.empty).toContain('没有可落地的改动');
    expect(outcomeLines(outcome)).toEqual([outcome.empty]);
  });

  it('体检改法只说挪动，没动的件数点名', () => {
    const outcome = buildOutcome({
      added: 0, removing: 0, changed: 2, keptLocked: 0, dropped: 0,
      review: true, skipped: ['椅子', '签到台'], blocked: null,
    });
    expect(outcomeLines(outcome)).toEqual([
      '只挪位置，其他没动 · 挪了 2 件',
      '没动 2 件：椅子、签到台（锁着或没找到稳妥落点）',
    ]);
  });

  it('云端提案动了锁定件，也按被拒记账', () => {
    const outcome = buildOutcome({
      added: 3, removing: 0, changed: 0, keptLocked: 0, dropped: 0, lockedTouched: 2,
      blocked: '这版动了 2 件锁着的物料：我不改锁着的东西，先解锁或换一版。',
    });
    expect(outcome.refused).toEqual([{ code: 'LOCKED', count: 2, message: '改到了锁定的物料' }]);
    // 只有一条原因时不再把同一个数字念两遍（老的写法是「没放进去 2 件：改到了锁定的物料 2 件」）。
    expect(outcomeLines(outcome)[1]).toBe('没放进去 2 件：改到了锁定的物料');
  });

  it('座位缺口按「座」记：不再冒出一句按件的「没放进去」', () => {
    const outcome = outcomeOfPlan(plan({
      added: 18, guests: 80, seats: 24,
      diagnostics: [{ severity: 'warning', code: 'CAPACITY_EXCEEDED', count: 0, seats: 56, capacity: 24, names: ['座位'], message: '按这套排法这块座位区排到 24 座就是头' }],
    }));
    expect(outcomeLines(outcome)).toEqual(['放进 18 件']);
    expect(outcome.refused[0]?.seats).toBe(56);
  });

  it('同一版里既有物料被拒又有座位缺口：两句各说各的单位', () => {
    const outcome = outcomeOfPlan(plan({
      added: 18, guests: 80, seats: 24, dropped: 3,
      diagnostics: [
        { severity: 'warning', code: 'CAPACITY_EXCEEDED', count: 0, seats: 56, capacity: 24, names: ['座位'], message: '按这套排法这块座位区排到 24 座就是头' },
        { severity: 'warning', code: 'KEEP_OUT', count: 3, names: ['绿植'], message: '压在通道或预留区上' },
      ],
    }));
    expect(outcomeLines(outcome)).toEqual(['放进 18 件', '没放进去 3 件：压在通道或预留区上']);
  });
});
