import { describe, expect, it } from 'vitest';
import { advancePhase, AGENT_PHASE_COUNT, phaseDetail, phaseIndex, phaseLabel, progressLine } from '../supabase/functions/_shared/agent-progress.ts';

describe('阶段化进度', () => {
  it('四段工作从看现状到交付，序号从 1 开始', () => {
    expect(AGENT_PHASE_COUNT).toBe(4);
    expect(phaseIndex('survey')).toBe(1);
    expect(phaseIndex('deliver')).toBe(4);
  });

  it('阶段只前进不后退：回头读细节不算退步', () => {
    expect(advancePhase('survey', 'locate')).toBe('locate');
    expect(advancePhase('locate', 'compose')).toBe('compose');
    // 校验完又回去看一眼局部——真实模型会这么走
    expect(advancePhase('compose', 'survey')).toBe('compose');
    expect(advancePhase('deliver', 'compose')).toBe('deliver');
  });

  it('原地不动时保持原阶段', () => {
    expect(advancePhase('locate', 'locate')).toBe('locate');
  });

  it('进度行以阶段开头、轮数在尾，轮数是真实预算读数', () => {
    expect(progressLine('locate', 3, 6)).toBe('第 2/4 阶段 · 定落点 · 第 3/6 轮');
    expect(progressLine('survey', 1, 6)).toBe('第 1/4 阶段 · 看现状 · 第 1/6 轮');
    expect(progressLine('deliver', 6, 6)).toBe('第 4/4 阶段 · 交付 · 第 6/6 轮');
  });

  it('轮数越界时不写出第 0 轮或 3/2 轮这种账', () => {
    expect(progressLine('survey', 0, 6)).toBe('第 1/4 阶段 · 看现状 · 第 1/6 轮');
    expect(progressLine('survey', 9, 6)).toBe('第 1/4 阶段 · 看现状 · 第 9/9 轮');
    expect(progressLine('survey', Number.NaN, Number.NaN)).toBe('第 1/4 阶段 · 看现状 · 第 1/1 轮');
  });

  it('每段都有名字与一句说明，不留空标签', () => {
    for (const phase of ['survey', 'locate', 'compose', 'deliver'] as const) {
      expect(phaseLabel(phase).length).toBeGreaterThan(0);
      expect(phaseDetail(phase).length).toBeGreaterThan(0);
    }
  });
});
