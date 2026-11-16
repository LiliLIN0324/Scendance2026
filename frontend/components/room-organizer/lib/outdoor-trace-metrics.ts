/**
 * 把一轮真实轨迹（`TurnTrace`）换算成指标（M7.1，2026-11-17）。
 *
 * `outdoor-turn-metrics` 只认时间线，不认业务；这里负责“从轨迹里把时间线抽出来”：
 *  · 阶段打点 → 地图请求 / 预览出现 / 应用；
 *  · `attemptIds` → 模型请求次数（轨迹只记次数不记每次时刻，就只报次数，不编时刻）；
 *  · 界面上才有的事（第一句话出现、用户点确认）由调用方作为 `ui` 传进来，缺就不算。
 *
 * 窗口末端取 `finishedAt` 与所有 UI 时刻的最大值：气泡常常在终态之后才渲染，
 * 若拿终态当硬边界，会把“最先看到反馈”的那一毫秒直接裁掉。
 */

import type { TurnTrace } from './turn-trace';
import {
  collectOutdoorTurnMetrics,
  type OutdoorMetricEvent,
  type OutdoorTurnMetrics,
} from './outdoor-turn-metrics';

export interface TurnTraceUiHints {
  /** 第一句可见反馈的渲染时刻。 */
  firstBubbleAt?: number | null;
  /** 用户每次点确认的时刻（双击就是两条）。 */
  confirmAts?: readonly number[];
}

export function metricEventsFromTrace(
  trace: TurnTrace,
  ui: TurnTraceUiHints = {},
): { startedAt: number; endedAt: number | null; events: OutdoorMetricEvent[] } {
  const events: OutdoorMetricEvent[] = [];

  for (const mark of trace.stages) {
    if (mark.stage === 'map') events.push({ at: mark.at, kind: 'map_request' });
    if (mark.stage === 'preview') events.push({ at: mark.at, kind: 'preview_ready' });
    if (mark.stage === 'apply') events.push({ at: mark.at, kind: 'applied' });
  }

  // 终态即“预览好了”但没走 preview 阶段：用收口时刻补一条，别让预览耗时凭空消失。
  const hasPreview = events.some((event) => event.kind === 'preview_ready');
  if (!hasPreview && trace.terminal === 'preview_ready' && trace.finishedAt !== null) {
    events.push({ at: trace.finishedAt, kind: 'preview_ready' });
  }

  if (typeof ui.firstBubbleAt === 'number') {
    events.push({ at: ui.firstBubbleAt, kind: 'first_bubble' });
  }
  for (const at of ui.confirmAts ?? []) {
    events.push({ at, kind: 'confirm' });
  }

  const uiTimes = [
    typeof ui.firstBubbleAt === 'number' ? ui.firstBubbleAt : null,
    ...(ui.confirmAts ?? []),
  ].filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  // 窗口末端必须在所有已知时刻之后：轨迹自己的阶段打点（如确认之后才发生的 apply）
  // 与前一条给过的界面时刻都算，否则“确认 2.4s、落盘 2.9s”会被空窗口裁掉。
  const windowEnd = [trace.finishedAt, ...uiTimes, ...trace.stages.map((mark) => mark.at)]
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
    .reduce<number | null>((max, value) => (max === null || value > max ? value : max), null);

  return { startedAt: trace.startedAt, endedAt: windowEnd, events };
}

export function metricsFromTurnTrace(
  trace: TurnTrace,
  ui: TurnTraceUiHints = {},
): OutdoorTurnMetrics {
  const { startedAt, endedAt, events } = metricEventsFromTrace(trace, ui);
  const base = collectOutdoorTurnMetrics({ startedAt, endedAt, events });
  // 轨迹只记了发过几次真实请求，不记每次的时刻——所以只报次数，不动耗时。
  return { ...base, modelCalls: trace.attemptIds.length };
}
