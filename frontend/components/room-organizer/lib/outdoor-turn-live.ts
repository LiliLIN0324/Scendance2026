/**
 * 一轮对话的实时轨迹与指标（M7.1 接线层，2026-11-17）。
 *
 * 前面两块是纯函数：`turn-trace` 记阶段，`outdoor-trace-metrics` 把轨迹换成指标。
 * 这里把两者接成「一次交互一个对象」，好让 hooks 里只写一行：
 *
 *   begin() → markPreview() → settle('preview_ready')   // 出预览即一轮收口
 *   markConfirm() → markApplied() → log()               // 确认与落盘另记一笔
 *
 * 刻意不做的事：不弹 UI、不发请求、不落盘。日志走注入的 `sink`（默认 `console.info`），
 * 一行一个 JSON 片段，方便拷出来对账；`settle` 只认第一次终态，重复调用只再打一行日志，
 * 不会把已经收口的一轮改写成另一个结论。
 */

import {
  beginAttempt,
  enterStage,
  finishTurn,
  startTurn,
  type TurnRoute,
  type TurnTerminal,
  type TurnTrace,
} from './turn-trace';
import { metricsFromTurnTrace, type TurnTraceUiHints } from './outdoor-trace-metrics';
import type { OutdoorTurnMetrics } from './outdoor-turn-metrics';

export interface LiveTurnOptions {
  sink?: (line: string) => void;
  now?: () => number;
}

export interface LiveTurn {
  begin(route?: TurnRoute, now?: number): void;
  markMap(now?: number): void;
  attempt(now?: number): void;
  markPreview(now?: number): void;
  markConfirm(now?: number): void;
  markApplied(now?: number): void;
  /** 收口并打一行日志；已经收口过的只再打日志，不改终态。 */
  settle(terminal: TurnTerminal, now?: number): OutdoorTurnMetrics | null;
  /** 只打一行当前指标（例如确认后落盘再记一笔），不改终态。 */
  log(): OutdoorTurnMetrics | null;
  /** 不打日志地看当前值。 */
  peek(): { trace: TurnTrace | null; metrics: OutdoorTurnMetrics | null };
}

const PREFIX = '[outdoor-metrics]';

/** 一行日志：只放数字与终态，不放原话、坐标、用户信息。 */
export function formatMetricsLine(
  metrics: OutdoorTurnMetrics,
  extra: { turnId?: string; terminal?: TurnTerminal | null } = {},
): string {
  const parts = [
    `model=${metrics.modelCalls}`,
    `map=${metrics.mapCalls}`,
    `confirm=${metrics.confirmations}`,
    `applied=${metrics.appliedCount}`,
    `firstFeedback=${metrics.firstUsefulFeedbackMs ?? 'null'}`,
    `preview=${metrics.previewMs ?? 'null'}`,
    `apply=${metrics.applyMs ?? 'null'}`,
  ];
  if (extra.terminal !== undefined) parts.push(`terminal=${extra.terminal ?? 'null'}`);
  if (extra.turnId) parts.push(`turn=${extra.turnId}`);
  return `${PREFIX} ${parts.join(' ')}`;
}

export function createLiveTurn(options: LiveTurnOptions = {}): LiveTurn {
  const sink = options.sink ?? ((line: string) => console.info(line));
  const clock = options.now ?? (() => Date.now());
  let trace: TurnTrace | null = null;
  const confirmAts: number[] = [];
  let firstBubbleAt: number | null = null;

  const hints = (): TurnTraceUiHints => ({ firstBubbleAt, confirmAts: [...confirmAts] });
  const metricsOf = (current: TurnTrace) => metricsFromTurnTrace(current, hints());

  return {
    begin(route: TurnRoute = 'scene', now?: number) {
      trace = startTurn({ route, now: now ?? clock() });
      confirmAts.length = 0;
      firstBubbleAt = null;
    },
    markMap(now?: number) {
      if (trace) trace = enterStage(trace, 'map', now ?? clock());
    },
    attempt(now?: number) {
      if (!trace) return;
      trace = beginAttempt(trace, now ?? clock()).trace;
    },
    markPreview(now?: number) {
      if (!trace) return;
      const at = now ?? clock();
      if (firstBubbleAt === null) firstBubbleAt = at;
      trace = enterStage(trace, 'preview', at);
    },
    markConfirm(now?: number) {
      if (!trace) return;
      confirmAts.push(now ?? clock());
    },
    markApplied(now?: number) {
      if (trace) trace = enterStage(trace, 'apply', now ?? clock());
    },
    settle(terminal: TurnTerminal, now?: number) {
      if (!trace) return null;
      const already = trace.terminal !== null;
      trace = finishTurn(trace, terminal, { now: now ?? clock() });
      const metrics = metricsOf(trace);
      sink(formatMetricsLine(metrics, { turnId: trace.turnId, terminal: trace.terminal }));
      // 已收口过的一轮：只补日志，别让人以为又结算了一次。
      if (already) {
        sink(`${PREFIX} already-settled turn=${trace.turnId} asked=${terminal}`);
      }
      return metrics;
    },
    peek() {
      return { trace, metrics: trace ? metricsOf(trace) : null };
    },
    log() {
      if (!trace) return null;
      const metrics = metricsOf(trace);
      sink(formatMetricsLine(metrics, { turnId: trace.turnId, terminal: trace.terminal }));
      return metrics;
    },
  };
}
