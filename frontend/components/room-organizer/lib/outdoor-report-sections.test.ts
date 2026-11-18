import { describe, expect, it } from 'vitest';
import {
  REPORT_SECTIONS,
  checkReportSections,
  formatSectionCheck,
} from './outdoor-report-sections';
import { buildSessionReport } from './outdoor-session-report';

/**
 * 段落自检（轮次 96）：只数标题在不在，不判断内容、不下结论。
 */

const metrics = {
  totals: {
    turns: 0,
    modelCalls: 0,
    mapCalls: 0,
    confirmations: 0,
    appliedCount: 0,
    firstUsefulFeedbackAvgMs: null,
    previewAvgMs: null,
    applyAvgMs: null,
  },
  rows: [],
  text: 'turns=0 model=0 map=0 confirm=0 applied=0',
};

describe('报告段落自检', () => {
  it('什么都算齐的报告：六段全在，且不写“合格/可发布”', () => {
    const report = buildSessionReport({
      turns: [],
      metrics,
      now: 1,
      release: {
        snapshot: { allGreen: 0 },
        card: '· 结论：不可发布（三类全绿 0 条）',
        walkthrough: { asOf: '2026-11-19', seen: { 2: 'pass' } },
        cloud: [2],
        verdicts: [{ id: 2, allGreen: false }],
        gaps: ['#2 —— 缺：云端'],
        sources: { fixedDataIds: [2, 5], walkthroughAsOf: '2026-11-19' },
      },
    });
    const checks = checkReportSections(report.text);
    expect(checks.every((row) => row.present)).toBe(true);
    const line = formatSectionCheck(report.text);
    expect(line).toBe(`报告段落：${REPORT_SECTIONS.length}/${REPORT_SECTIONS.length} 段齐（内容对不对仍要人看）`);
    expect(line).not.toContain('可发布');
    expect(line).not.toContain('合格');
  });

  it('缺段就点名缺哪段，并说明“缺段≠没问题”', () => {
    const text = '[报告来源] x\n[发布状态快照] {}';
    const line = formatSectionCheck(text);
    expect(line).toContain('2/6 段');
    expect(line).toContain('[走查标记]');
    expect(line).toContain('缺段不代表出错');
  });

  it('空文本：六段全缺，不抛错', () => {
    expect(checkReportSections('')).toHaveLength(REPORT_SECTIONS.length);
    expect(checkReportSections('').every((row) => !row.present)).toBe(true);
    expect(formatSectionCheck('')).toContain('缺 6 段');
  });

  it('只出现一次也算在（不数次数，避免把重复标题当成两段）', () => {
    const one = checkReportSections('[云端声明]').find((row) => row.section === '[云端声明]');
    expect(one?.present).toBe(true);
  });
});
