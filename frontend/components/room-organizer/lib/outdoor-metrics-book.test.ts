import { describe, expect, it } from 'vitest';
import { createMetricsBook, formatMetricsTotals } from './outdoor-metrics-book';
import type { OutdoorTurnMetrics } from './outdoor-turn-metrics';

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

describe('createMetricsBook', () => {
  it('最近的在前，同 turnId 再记是更新而不是新增', () => {
    const book = createMetricsBook();
    book.record('t-1', metrics({ modelCalls: 1 }), 'preview_ready');
    book.record('t-2', metrics({ modelCalls: 2 }), 'preview_ready');
    book.record('t-1', metrics({ modelCalls: 3, appliedCount: 1 }), 'preview_ready');

    const rows = book.list();
    expect(rows.map((row) => row.turnId)).toEqual(['t-1', 't-2']);
    expect(rows[0].modelCalls).toBe(3);
    expect(rows[0].appliedCount).toBe(1);
  });

  it('超过容量丢最旧的', () => {
    const book = createMetricsBook(2);
    book.record('t-1', metrics());
    book.record('t-2', metrics());
    book.record('t-3', metrics());
    expect(book.list().map((row) => row.turnId)).toEqual(['t-3', 't-2']);
  });

  it('list(limit) 只取最近几轮，不改簿子', () => {
    const book = createMetricsBook();
    book.record('t-1', metrics());
    book.record('t-2', metrics());
    book.record('t-3', metrics());
    expect(book.list(2).map((row) => row.turnId)).toEqual(['t-3', 't-2']);
    expect(book.list()).toHaveLength(3);
  });

  it('汇总：次数求和，耗时求平均且跳过没有的轮次', () => {
    const book = createMetricsBook();
    book.record('t-1', metrics({ modelCalls: 1, mapCalls: 1, firstUsefulFeedbackMs: 1_000, previewMs: 2_000 }));
    book.record('t-2', metrics({ modelCalls: 2, confirmations: 1, firstUsefulFeedbackMs: 3_000, previewMs: 4_000 }));
    const totals = book.totals();
    expect(totals.turns).toBe(2);
    expect(totals.modelCalls).toBe(3);
    expect(totals.mapCalls).toBe(1);
    expect(totals.confirmations).toBe(1);
    expect(totals.firstUsefulFeedbackAvgMs).toBe(2_000);
    expect(totals.previewAvgMs).toBe(3_000);
    expect(totals.applyAvgMs).toBeNull();
  });

  it('一条耗时都没有时平均值是 null，不是 0', () => {
    const book = createMetricsBook();
    book.record('t-1', metrics(), 'local_done');
    const totals = book.totals();
    expect(totals.firstUsefulFeedbackAvgMs).toBeNull();
    expect(totals.previewAvgMs).toBeNull();
    expect(totals.applyAvgMs).toBeNull();
  });

  it('双击确认的差值在汇总里保留：确认 2、落盘 1', () => {
    const book = createMetricsBook();
    book.record('t-1', metrics({ confirmations: 2, appliedCount: 1 }), 'preview_ready');
    const totals = book.totals();
    expect(totals.confirmations).toBe(2);
    expect(totals.appliedCount).toBe(1);
  });

  it('导出的行只有白名单字段', () => {
    const book = createMetricsBook();
    book.record('t-1', metrics({ modelCalls: 1 }), 'preview_ready');
    expect(Object.keys(book.list()[0]).sort()).toEqual(
      [
        'appliedCount',
        'applyMs',
        'confirmations',
        'firstUsefulFeedbackMs',
        'mapCalls',
        'modelCalls',
        'previewMs',
        'terminal',
        'turnId',
      ].sort(),
    );
  });

  it('改导出结果不会改到簿子里的数据', () => {
    const book = createMetricsBook();
    book.record('t-1', metrics({ modelCalls: 1 }));
    const rows = book.list();
    rows[0].modelCalls = 99;
    expect(book.list()[0].modelCalls).toBe(1);
  });

  it('clear 清空后汇总归零且平均值仍是 null', () => {
    const book = createMetricsBook();
    book.record('t-1', metrics({ modelCalls: 1, previewMs: 500 }));
    book.clear();
    expect(book.list()).toHaveLength(0);
    expect(book.totals().turns).toBe(0);
    expect(book.totals().previewAvgMs).toBeNull();
  });
});

describe('formatMetricsTotals', () => {
  it('一行汇总，缺的平均值写 null', () => {
    const book = createMetricsBook();
    book.record('t-1', metrics({ modelCalls: 2, mapCalls: 1 }));
    expect(formatMetricsTotals(book.totals())).toBe(
      'turns=1 model=2 map=1 confirm=0 applied=0 firstFeedbackAvg=null previewAvg=null applyAvg=null',
    );
  });
});
