import { describe, expect, it } from 'vitest';
import { planZonesOverlap, zoneEditBlockingIssue } from './site-plan-editing';
import type { PlanPoint } from '../../../../supabase/functions/_shared/site-plan';

/**
 * 2026-11-15 用户指令：「不同分区重叠的情况，我不希望我不能编辑，而是他有一个报错弹窗，
 * 直到我挪开才不弹」。这里守住两条边界：
 * - 重叠**不再**进入「挡住提交」的判定（重叠只上常驻提示）；
 * - 自交/退化/越界仍然挡住，因为那些形状当场就不成立。
 */

const boundary: PlanPoint[] = [
  { x: -50, y: -50 },
  { x: 50, y: -50 },
  { x: 50, y: 50 },
  { x: -50, y: 50 },
];

const square = (offset = 0): PlanPoint[] => [
  { x: 0 + offset, y: 0 },
  { x: 10 + offset, y: 0 },
  { x: 10 + offset, y: 10 },
  { x: 0 + offset, y: 10 },
];

describe('分区提交前的硬校验', () => {
  it('形状正常的环（哪怕和别的分区重叠）可以提交', () => {
    // 先确认这两个环确实重叠，避免测试「假绿」。
    expect(planZonesOverlap(square(), square(5))).toBe(true);
    expect(zoneEditBlockingIssue(square(5), boundary, '分区「B」')).toBeNull();
  });

  it('自交仍然挡住（8 字形）', () => {
    const bowtie: PlanPoint[] = [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 10, y: 0 },
      { x: 0, y: 10 },
    ];
    const issue = zoneEditBlockingIssue(bowtie, boundary, '分区「B」');
    expect(issue?.code).toBe('self-intersection');
  });

  it('越界仍然挡住（旧口径不变）', () => {
    const outside = square().map(p => ({ x: p.x + 48, y: p.y }));
    expect(zoneEditBlockingIssue(outside, boundary, '分区「B」')?.code).toBe('out-of-boundary');
  });

  it('顶点不足仍然挡住', () => {
    const issue = zoneEditBlockingIssue([{ x: 0, y: 0 }, { x: 10, y: 0 }], boundary, '分区「B」');
    expect(issue?.code).toBe('too-few-vertices');
  });
});
