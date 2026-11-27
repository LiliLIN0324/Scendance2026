import { describe, expect, it } from 'vitest';
import { reviewAdoptionBusinessState, type ReviewAdoptionSlotStatus } from './review-adoption-state';

const scan = { assetId: 'scan-1' };

function state(operations: ReviewAdoptionSlotStatus, plan: ReviewAdoptionSlotStatus, scanValue?: typeof scan) {
  return reviewAdoptionBusinessState({
    operations: { status: operations },
    plan: { status: plan },
    scan: scanValue,
  });
}

describe('reviewAdoptionBusinessState（T6 评审采纳业务状态投影）', () => {
  it('双槽命中记录且带扫描身份：无待核、不判 stale', () => {
    const result = state('record', 'record', scan);
    expect(result.operations.pending).toBe(false);
    expect(result.plan.pending).toBe(false);
    expect(result.pendingKinds).toEqual([]);
    expect(result.scanPresent).toBe(true);
    expect(result.stale).toBe(false);
  });

  it('operations 找不到记录：operations 进待核，plan 不受牵连，判 stale', () => {
    const result = state('missing', 'record', scan);
    expect(result.operations.pending).toBe(true);
    expect(result.plan.pending).toBe(false);
    expect(result.pendingKinds).toEqual(['operations']);
    expect(result.stale).toBe(true);
  });

  it('plan 找不到记录：plan 进待核，判 stale', () => {
    const result = state('record', 'missing', scan);
    expect(result.plan.pending).toBe(true);
    expect(result.pendingKinds).toEqual(['plan']);
    expect(result.stale).toBe(true);
  });

  it('旧变体回落内嵌副本只读：不进待核、不据此判 stale', () => {
    const result = state('fallback-legacy', 'fallback-legacy', scan);
    expect(result.operations.pending).toBe(false);
    expect(result.plan.pending).toBe(false);
    expect(result.pendingKinds).toEqual([]);
    expect(result.stale).toBe(false);
  });

  it('解析尚未回：视同待核并判 stale，不入库直到读取落地', () => {
    const result = state('pending', 'record', scan);
    expect(result.operations.pending).toBe(true);
    expect(result.pendingKinds).toEqual(['operations']);
    expect(result.stale).toBe(true);
  });

  it('两槽都命中但缺扫描身份：判 stale，业务槽本身不待核', () => {
    const result = state('record', 'record');
    expect(result.scanPresent).toBe(false);
    expect(result.pendingKinds).toEqual([]);
    expect(result.stale).toBe(true);
  });

  it('双槽缺失：待核清单按 operations、plan 顺序排列', () => {
    const result = state('missing', 'missing', scan);
    expect(result.pendingKinds).toEqual(['operations', 'plan']);
    expect(result.stale).toBe(true);
  });

  it('返回结构只含状态与待核标注，不带业务资料副本', () => {
    const result = state('record', 'record', scan);
    expect(result).not.toHaveProperty('operationsData');
    expect(result).not.toHaveProperty('planData');
    expect(Object.keys(result).sort()).toEqual(['operations', 'pendingKinds', 'plan', 'scanPresent', 'stale']);
  });
});
