import { describe, expect, it } from 'vitest';
import { createLiveTurn, formatMetricsLine } from './outdoor-turn-live';

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
