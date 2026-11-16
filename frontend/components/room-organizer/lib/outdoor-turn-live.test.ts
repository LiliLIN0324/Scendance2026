import { describe, expect, it } from 'vitest';
import { createLiveTurn, formatMetricsLine } from './outdoor-turn-live';
import { createMetricsBook } from './outdoor-metrics-book';
import { createTurnTraceBook } from './turn-trace-log';

function harness() {
  const lines: string[] = [];
  let clock = 1_000;
  const turn = createLiveTurn({ sink: (line) => lines.push(line), now: () => clock });
  return {
    turn,
    lines,
    advance(ms: number) {
      clock += ms;
      return clock;
    },
    at(ms: number) {
      clock = ms;
      return clock;
    },
  };
}

describe('createLiveTurn', () => {
  it('一轮到预览：收口时打出模型/地图/预览耗时与终态', () => {
    const h = harness();
    h.turn.begin('scene', 1_000);
    h.turn.markMap(1_200);
    h.turn.attempt(1_300);
    h.turn.markPreview(3_000);
    const metrics = h.turn.settle('preview_ready', 3_200);

    expect(metrics?.modelCalls).toBe(1);
    expect(metrics?.mapCalls).toBe(1);
    expect(metrics?.firstUsefulFeedbackMs).toBe(2_000);
    expect(metrics?.previewMs).toBe(2_000);
    expect(h.lines).toHaveLength(1);
    expect(h.lines[0]).toContain('model=1');
    expect(h.lines[0]).toContain('map=1');
    expect(h.lines[0]).toContain('preview=2000');
    expect(h.lines[0]).toContain('terminal=preview_ready');
  });

  it('确认后落盘：确认次数与落盘次数分开记', () => {
    const h = harness();
    h.turn.begin('scene', 1_000);
    h.turn.markPreview(2_000);
    h.turn.markConfirm(2_400);
    h.turn.markConfirm(2_420);
    h.turn.markApplied(2_900);
    const { metrics } = h.turn.peek();
    expect(metrics?.confirmations).toBe(2);
    expect(metrics?.appliedCount).toBe(1);
    expect(metrics?.applyMs).toBe(900);
  });

  it('同一轮回调两次 settle：终态不变，但会多一行 already-settled', () => {
    const h = harness();
    h.turn.begin('scene', 1_000);
    h.turn.markPreview(1_500);
    h.turn.settle('preview_ready', 1_600);
    const second = h.turn.settle('failed', 1_700);
    const { trace } = h.turn.peek();
    expect(second?.modelCalls).toBe(0);
    expect(trace?.terminal).toBe('preview_ready');
    expect(h.lines).toHaveLength(3);
    expect(h.lines[2]).toContain('already-settled');
  });

  it('没 begin 就 settle：什么都不做，返回 null', () => {
    const h = harness();
    expect(h.turn.settle('preview_ready')).toBeNull();
    expect(h.lines).toHaveLength(0);
  });

  it('换一轮时清掉上一轮的确认时刻与首气泡（不串轮）', () => {
    const h = harness();
    h.turn.begin('scene', 1_000);
    h.turn.markPreview(1_500);
    h.turn.markConfirm(1_600);
    h.turn.settle('preview_ready', 1_700);
    h.turn.begin('scene', 5_000);
    h.turn.settle('local_done', 5_400);
    const { metrics } = h.turn.peek();
    expect(metrics?.confirmations).toBe(0);
    expect(metrics?.firstUsefulFeedbackMs).toBeNull();
  });

  it('首气泡时刻只记第一次预览', () => {
    const h = harness();
    h.turn.begin('scene', 1_000);
    h.turn.markPreview(1_500);
    h.turn.markPreview(1_800);
    const { metrics } = h.turn.peek();
    expect(metrics?.firstUsefulFeedbackMs).toBe(500);
  });

  it('日志行只含数字与编号，不含原话或坐标', () => {
    const h = harness();
    h.turn.begin('scene', 1_000);
    h.turn.markPreview(1_500);
    h.turn.settle('preview_ready', 1_600);
    expect(h.lines[0]).toMatch(/^\[outdoor-metrics\] /);
    expect(h.lines[0]).not.toMatch(/[“”"]/);
  });
});

describe('formatMetricsLine', () => {
  it('缺的指标写成 null，不写成 0', () => {
    const line = formatMetricsLine({
      modelCalls: 0,
      mapCalls: 0,
      confirmations: 0,
      appliedCount: 0,
      firstUsefulFeedbackMs: null,
      previewMs: null,
      applyMs: null,
    });
    expect(line).toBe(
      '[outdoor-metrics] model=0 map=0 confirm=0 applied=0 firstFeedback=null preview=null apply=null',
    );
  });

  it('可以带终态与轮次编号用于对账', () => {
    const line = formatMetricsLine(
      {
        modelCalls: 2,
        mapCalls: 1,
        confirmations: 1,
        appliedCount: 1,
        firstUsefulFeedbackMs: 900,
        previewMs: 1_200,
        applyMs: 300,
      },
      { terminal: 'preview_ready', turnId: 't-abc-1234' },
    );
    expect(line).toContain('terminal=preview_ready');
    expect(line).toContain('turn=t-abc-1234');
  });
});

describe('createLiveTurn + 指标簿', () => {
  it('带了簿子就记一笔：确认后补的日志是更新同一行，不是新增', () => {
    const book = createMetricsBook();
    const lines: string[] = [];
    const turn = createLiveTurn({ sink: (line) => lines.push(line), book });
    turn.begin('scene', 1_000);
    turn.markPreview(2_000);
    turn.log();
    turn.markConfirm(2_300);
    turn.markApplied(2_600);
    turn.log();

    const rows = book.list();
    expect(rows).toHaveLength(1);
    expect(rows[0].confirmations).toBe(1);
    expect(rows[0].appliedCount).toBe(1);
    expect(lines).toHaveLength(2);
  });

  it('只出预览没收口就换轮：换轮时自动结掉上一轮，不留“进行中”的假记录', () => {
    const book = createMetricsBook();
    const turn = createLiveTurn({ sink: () => {}, book });
    turn.begin('scene', 1_000);
    turn.markPreview(1_800);
    turn.begin('scene', 5_000);
    const rows = book.list();
    expect(rows).toHaveLength(1);
    expect(rows[0].terminal).toBe('preview_ready');
    expect(rows[0].previewMs).toBe(800);
  });

  it('簿子里的数字与日志行逐项一致', () => {
    const book = createMetricsBook();
    const lines: string[] = [];
    const turn = createLiveTurn({ sink: (line) => lines.push(line), book });
    turn.begin('scene', 1_000);
    turn.markMap(1_200);
    turn.attempt(1_300);
    turn.markPreview(3_000);
    turn.settle('preview_ready', 3_200);
    const row = book.list()[0];
    const expected = [
      '[outdoor-metrics]',
      `model=${row.modelCalls}`,
      `map=${row.mapCalls}`,
      `confirm=${row.confirmations}`,
      `applied=${row.appliedCount}`,
      `firstFeedback=${row.firstUsefulFeedbackMs ?? 'null'}`,
      `preview=${row.previewMs ?? 'null'}`,
      `apply=${row.applyMs ?? 'null'}`,
      `terminal=${row.terminal ?? 'null'}`,
    ].join(' ');
    expect(lines[0].replace(/ turn=\S+/, '')).toBe(expected);
  });

  it('传了轨迹簿子就记下收口的那一轮（供会话报告导出）', () => {
    const traceBook = createTurnTraceBook();
    const turn = createLiveTurn({ sink: () => {}, traceBook });
    turn.begin('scene', 1_000);
    turn.markPreview(1_500);
    turn.settle('preview_ready', 1_600);
    const rows = traceBook.list();
    expect(rows).toHaveLength(1);
    expect(rows[0].terminal).toBe('preview_ready');
    expect(rows[0].stages.map((mark) => mark.stage)).toEqual(['dispatch', 'preview']);
  });

  it('没收口就不进轨迹簿子', () => {
    const traceBook = createTurnTraceBook();
    const turn = createLiveTurn({ sink: () => {}, traceBook });
    turn.begin('scene', 1_000);
    turn.markPreview(1_500);
    expect(traceBook.list()).toHaveLength(0);
  });
});
