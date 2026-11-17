import { describe, expect, it } from 'vitest';
import { exportMetricsReport, metricsReportLine } from './outdoor-metrics-export';
import type { MetricsSummary } from './outdoor-metrics-book';

const summary: MetricsSummary = {
  totals: {
    turns: 2,
    modelCalls: 3,
    mapCalls: 1,
    confirmations: 2,
    appliedCount: 1,
    firstUsefulFeedbackAvgMs: 1_500,
    previewAvgMs: 2_000,
    applyAvgMs: 400,
  },
  rows: [],
  text: 'turns=2 model=3 map=1 confirm=2 applied=1 firstFeedbackAvg=1500 previewAvg=2000 applyAvg=400',
};

describe('exportMetricsReport', () => {
  it('一定打一行日志，带固定前缀与汇总文本', () => {
    const lines: string[] = [];
    const result = exportMetricsReport(summary, { log: (line) => lines.push(line), clipboard: null });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe(`[outdoor-metrics] 汇总 ${summary.text}`);
    expect(result.line).toBe(lines[0]);
    expect(result.copied).toBe(false);
  });

  it('有剪贴板就写进去，并报告 copied=true', () => {
    const written: string[] = [];
    const result = exportMetricsReport(summary, {
      log: () => {},
      clipboard: { writeText: async (text) => void written.push(text) },
    });
    expect(result.copied).toBe(true);
    expect(written).toHaveLength(1);
    expect(written[0]).toBe(summary.text);
  });

  it('剪贴板被拒也不抛错，且不出现未处理的 rejection', async () => {
    const result = exportMetricsReport(summary, {
      log: () => {},
      clipboard: { writeText: () => Promise.reject(new Error('denied')) },
    });
    expect(result.copied).toBe(true); // 已发起；失败被吞掉，避免“点了没反应”变成控制台报错
    await Promise.resolve();
  });

  it('剪贴板同步抛错时退化成只打日志', () => {
    const result = exportMetricsReport(summary, {
      log: () => {},
      clipboard: {
        writeText: () => {
          throw new Error('boom');
        },
      },
    });
    expect(result.copied).toBe(false);
  });

  it('没有写文本能力时 copied=false，但日志照打', () => {
    const lines: string[] = [];
    const result = exportMetricsReport(summary, {
      log: (line) => lines.push(line),
      clipboard: {} as { writeText: (text: string) => Promise<void> },
    });
    expect(result.copied).toBe(false);
    expect(lines).toHaveLength(1);
  });
});

describe('metricsReportLine', () => {
  it('前缀稳定，便于在控制台里筛', () => {
    expect(metricsReportLine(summary)).toMatch(/^\[outdoor-metrics\] 汇总 turns=2 /);
  });
});
