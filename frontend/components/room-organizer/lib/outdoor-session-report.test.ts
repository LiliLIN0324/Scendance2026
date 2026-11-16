import { describe, expect, it } from 'vitest';
import { buildSessionReport } from './outdoor-session-report';
import { createMetricsBook, summarizeMetrics } from './outdoor-metrics-book';
import { startTurn, enterStage, finishTurn, type TurnTrace } from './turn-trace';
import type { OutdoorTurnMetrics } from './outdoor-turn-metrics';

const T0 = 5_000;

function metrics(over: Partial<OutdoorTurnMetrics> = {}): OutdoorTurnMetrics {
  return {
    modelCalls: 0,
    mapCalls: 0,
    confirmations: 0,
    appliedCount: 0,
    firstUsefulFeedbackMs: null,
    previewMs: null,
    applyMs: null,
    ...over,
  };
}

function summaryOf(over: Partial<OutdoorTurnMetrics> = {}) {
  const book = createMetricsBook();
  book.record('t-a', metrics(over), 'preview_ready');
  return summarizeMetrics(book);
}

function trace(): TurnTrace {
  let t = startTurn({ route: 'scene', now: T0 });
  t = enterStage(t, 'preview', T0 + 800);
  return finishTurn(t, 'preview_ready', { now: T0 + 900 });
}

describe('buildSessionReport', () => {
  it('轨迹在上、指标在下，中间空一行', () => {
    const report = buildSessionReport({ turns: [trace()], metrics: summaryOf({ modelCalls: 2 }), now: T0 });
    const lines = report.text.split('\n');
    expect(lines[0]).toContain('户外 Agent 诊断导出');
    expect(lines[0]).toContain('1 轮');
    expect(lines[lines.length - 1]).toBe(`[outdoor-metrics] 汇总 ${summaryOf({ modelCalls: 2 }).text}`);
    expect(lines[lines.length - 2]).toBe('');
  });

  it('指标部分带上了次数与平均值', () => {
    const report = buildSessionReport({
      turns: [trace()],
      metrics: summaryOf({ modelCalls: 3, mapCalls: 1, previewMs: 800 }),
      now: T0,
    });
    expect(report.metrics.totals.modelCalls).toBe(3);
    expect(report.text).toContain('model=3');
    expect(report.text).toContain('previewAvg=800');
  });

  it('轨迹挂上多余字段也导不出去（白名单在下一层已生效）', () => {
    const dirty = { ...trace(), text: '用户原话', coords: [120.1, 30.2] } as unknown as TurnTrace;
    const report = buildSessionReport({ turns: [dirty], metrics: summaryOf(), now: T0 });
    expect(report.text).not.toContain('用户原话');
    expect(report.text).not.toContain('120.1');
    expect(JSON.stringify(report.traces.rows)).not.toContain('coords');
  });

  it('没有轨迹时仍给指标行，标题写 0 轮', () => {
    const report = buildSessionReport({ turns: [], metrics: summaryOf(), now: T0 });
    expect(report.text).toContain('0 轮');
    expect(report.text).toContain('[outdoor-metrics] 汇总');
    expect(report.traces.rows).toHaveLength(0);
  });

  it('传同一个 now、同一条轨迹时结果确定（便于对账）', () => {
    const t = trace();
    const a = buildSessionReport({ turns: [t], metrics: summaryOf(), now: T0 });
    const b = buildSessionReport({ turns: [t], metrics: summaryOf(), now: T0 });
    expect(a.text).toBe(b.text);
    expect(a.exportedAt).toBe(T0);
  });

  it('不改动传入的轨迹与指标', () => {
    const turns = [trace()];
    const metricsSummary = summaryOf({ modelCalls: 1 });
    const before = JSON.stringify(turns);
    buildSessionReport({ turns, metrics: metricsSummary, now: T0 });
    expect(JSON.stringify(turns)).toBe(before);
    expect(metricsSummary.totals.modelCalls).toBe(1);
  });

  it('导出里的轨迹行与指标行数各按自己的簿子算', () => {
    const report = buildSessionReport({ turns: [trace(), trace()], metrics: summaryOf(), now: T0 });
    expect(report.traces.rows).toHaveLength(2);
    expect(report.metrics.rows).toHaveLength(1);
  });
});
