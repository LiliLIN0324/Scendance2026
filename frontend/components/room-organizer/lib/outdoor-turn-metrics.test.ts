import { describe, expect, it } from 'vitest';
import { collectOutdoorTurnMetrics } from './outdoor-turn-metrics';

const T0 = 1_000;

describe('collectOutdoorTurnMetrics', () => {
  it('一整轮：计数、首反馈、预览与应用的耗时都对得上', () => {
    const metrics = collectOutdoorTurnMetrics({
      startedAt: T0,
      events: [
        { at: 1_000, kind: 'user_input' },
        { at: 1_120, kind: 'map_request' },
        { at: 1_400, kind: 'model_request' },
        { at: 2_900, kind: 'first_bubble' },
        { at: 3_000, kind: 'confirm' },
        { at: 3_450, kind: 'preview_ready' },
        { at: 3_800, kind: 'applied' },
      ],
    });
    expect(metrics).toEqual({
      modelCalls: 1,
      mapCalls: 1,
      confirmations: 1,
      appliedCount: 1,
      firstUsefulFeedbackMs: 1_900,
      previewMs: 450,
      applyMs: 350,
    });
  });

  it('什么都没有时是 0 与 null，不用 0 冒充瞬间完成', () => {
    expect(collectOutdoorTurnMetrics({ startedAt: T0, events: [] })).toEqual({
      modelCalls: 0,
      mapCalls: 0,
      confirmations: 0,
      appliedCount: 0,
      firstUsefulFeedbackMs: null,
      previewMs: null,
      applyMs: null,
    });
  });

  it('开始之前的事件不算（上一轮残留）', () => {
    const metrics = collectOutdoorTurnMetrics({
      startedAt: T0,
      events: [
        { at: 900, kind: 'model_request' },
        { at: 950, kind: 'first_bubble' },
        { at: 1_500, kind: 'first_bubble' },
      ],
    });
    expect(metrics.modelCalls).toBe(0);
    expect(metrics.firstUsefulFeedbackMs).toBe(500);
  });

  it('结束之后的事件不算（下一条消息串进来）', () => {
    const metrics = collectOutdoorTurnMetrics({
      startedAt: T0,
      endedAt: 2_000,
      events: [
        { at: 1_100, kind: 'model_request' },
        { at: 2_300, kind: 'model_request' },
      ],
    });
    expect(metrics.modelCalls).toBe(1);
  });

  it('没有确认时预览耗时从开始算，不返回 null', () => {
    const metrics = collectOutdoorTurnMetrics({
      startedAt: T0,
      events: [
        { at: 1_200, kind: 'preview_ready' },
        { at: 1_500, kind: 'applied' },
      ],
    });
    expect(metrics.previewMs).toBe(200);
    expect(metrics.applyMs).toBe(300);
    expect(metrics.confirmations).toBe(0);
  });

  it('双击确认：确认记 2，但只落了一次，多按的那下能看出来', () => {
    const metrics = collectOutdoorTurnMetrics({
      startedAt: T0,
      events: [
        { at: 1_002, kind: 'confirm' },
        { at: 1_020, kind: 'confirm' },
        { at: 1_300, kind: 'preview_ready' },
        { at: 1_600, kind: 'applied' },
      ],
    });
    expect(metrics.confirmations).toBe(2);
    expect(metrics.appliedCount).toBe(1);
    expect(metrics.applyMs).toBe(300);
  });

  it('同一毫秒重复的 applied 只算一次', () => {
    const metrics = collectOutdoorTurnMetrics({
      startedAt: T0,
      events: [
        { at: 1_500, kind: 'applied' },
        { at: 1_500, kind: 'applied' },
      ],
    });
    expect(metrics.appliedCount).toBe(1);
  });

  it('乱序输入按时间排好再算，结果与顺序输入一致', () => {
    const shuffled = collectOutdoorTurnMetrics({
      startedAt: T0,
      events: [
        { at: 1_600, kind: 'applied' },
        { at: 1_100, kind: 'confirm' },
        { at: 1_400, kind: 'preview_ready' },
        { at: 1_050, kind: 'first_bubble' },
      ],
    });
    expect(shuffled.firstUsefulFeedbackMs).toBe(50);
    expect(shuffled.previewMs).toBe(300);
    expect(shuffled.applyMs).toBe(200);
  });

  it('时间倒退的锚点返回 null，不返回负数', () => {
    const metrics = collectOutdoorTurnMetrics({
      startedAt: T0,
      events: [
        { at: 1_500, kind: 'preview_ready' },
        { at: 1_200, kind: 'applied' },
      ],
    });
    expect(metrics.applyMs).toBeNull();
  });
});
