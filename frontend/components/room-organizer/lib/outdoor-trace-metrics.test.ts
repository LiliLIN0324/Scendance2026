import { describe, expect, it } from 'vitest';
import { beginAttempt, enterStage, finishTurn, startTurn, type TurnTrace } from './turn-trace';
import { metricEventsFromTrace, metricsFromTurnTrace } from './outdoor-trace-metrics';

const T0 = 10_000;

function roundTrip(): TurnTrace {
  let trace = startTurn({ route: 'scene', now: T0 });
  trace = enterStage(trace, 'map', T0 + 200);
  trace = enterStage(trace, 'understand', T0 + 900);
  trace = beginAttempt(trace, T0 + 1_000).trace;
  trace = enterStage(trace, 'preview', T0 + 3_000);
  return finishTurn(trace, 'preview_ready', { now: T0 + 3_400 });
}

describe('metricsFromTurnTrace', () => {
  it('一轮完整预览：模型次数来自 attempt、地图/预览/应用时刻来自阶段打点', () => {
    const metrics = metricsFromTurnTrace(roundTrip(), {
      firstBubbleAt: T0 + 2_400,
      confirmAts: [T0 + 3_600],
    });
    expect(metrics.modelCalls).toBe(1);
    expect(metrics.mapCalls).toBe(1);
    expect(metrics.confirmations).toBe(1);
    expect(metrics.firstUsefulFeedbackMs).toBe(2_400);
    expect(metrics.previewMs).toBe(3_000); // 预览先出现，从开轮算
    expect(metrics.applyMs).toBeNull();
  });

  it('重试换 attemptId：模型次数跟着涨，但不会凭空造出时刻', () => {
    let trace = startTurn({ route: 'scene', now: T0 });
    trace = beginAttempt(trace, T0 + 100).trace;
    trace = beginAttempt(trace, T0 + 900).trace;
    trace = beginAttempt(trace, T0 + 2_100).trace;
    const { events } = metricEventsFromTrace(trace);
    expect(events.filter((event) => event.kind === 'model_request')).toHaveLength(0);
    expect(metricsFromTurnTrace(trace).modelCalls).toBe(3);
  });

  it('没有 preview 阶段但终态是 preview_ready：用收口时刻补上预览', () => {
    const trace = finishTurn(startTurn({ route: 'scene', now: T0 }), 'preview_ready', {
      now: T0 + 1_200,
    });
    expect(metricsFromTurnTrace(trace, { confirmAts: [T0 + 800] }).previewMs).toBe(400);
  });

  it('界面没给首气泡：首反馈耗时是 null，不当成 0', () => {
    expect(metricsFromTurnTrace(roundTrip()).firstUsefulFeedbackMs).toBeNull();
  });

  it('气泡在终态之后才渲染也算数（窗口末端跟着放宽）', () => {
    const metrics = metricsFromTurnTrace(roundTrip(), { firstBubbleAt: T0 + 4_000 });
    expect(metrics.firstUsefulFeedbackMs).toBe(4_000);
  });

  it('非 preview 终态时不会伪造 preview_ready', () => {
    const trace = finishTurn(startTurn({ route: 'local', now: T0 }), 'local_done', {
      now: T0 + 300,
    });
    const { events } = metricEventsFromTrace(trace);
    expect(events.some((event) => event.kind === 'preview_ready')).toBe(false);
    expect(metricsFromTurnTrace(trace).previewMs).toBeNull();
  });

  it('双击确认：确认 2 次，只有一次应用', () => {
    let trace = startTurn({ route: 'scene', now: T0 });
    trace = enterStage(trace, 'preview', T0 + 3_000);
    trace = enterStage(trace, 'apply', T0 + 3_600);
    trace = finishTurn(trace, 'preview_ready', { now: T0 + 3_700 });
    const metrics = metricsFromTurnTrace(trace, { confirmAts: [T0 + 3_500, T0 + 3_520] });
    expect(metrics.confirmations).toBe(2);
    expect(metrics.appliedCount).toBe(1);
    expect(metrics.applyMs).toBe(600);
  });

  it('终态之后不再补阶段：时间线不会被“补记”污染', () => {
    const trace = enterStage(roundTrip(), 'apply', T0 + 5_000);
    const { events } = metricEventsFromTrace(trace);
    expect(events.some((event) => event.kind === 'applied')).toBe(false);
  });

  it('阶段打点乱序也按时间还原（窗口按真实最大时刻收口）', () => {
    const trace: TurnTrace = {
      ...startTurn({ route: 'scene', now: T0 }),
      stages: [
        { stage: 'dispatch', at: T0, ms: null },
        { stage: 'preview', at: T0 + 2_000, ms: null },
        { stage: 'map', at: T0 + 500, ms: null },
      ],
      finishedAt: T0 + 2_500,
      terminal: 'preview_ready',
    };
    const metrics = metricsFromTurnTrace(trace, { confirmAts: [T0 + 1_000] });
    expect(metrics.mapCalls).toBe(1);
    expect(metrics.previewMs).toBe(1_000);
  });
});
