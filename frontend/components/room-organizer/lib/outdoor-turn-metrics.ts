/**
 * 一轮户外对话的指标采集（M7.1，2026-11-16）。
 *
 * 计划 §5 要求报告「重复输入、确认次数、地图与模型调用次数、首个有用反馈耗时、预览耗时」。
 * 之前这些数只能靠人眼看日志，本轮先把它变成一段可复跑的纯计算：
 * 输入是一条时间线（谁在第几毫秒发生了什么），输出是这几项指标。
 *
 * 只做算术，不猜：
 *  · 窗口外的（早于 `startedAt`、晚于 `endedAt`）一律不算；
 *  · 缺哪个锚点，对应指标就是 `null`，不用 0 冒充「瞬间完成」；
 *  · 双击确认会让 `confirmations` 变 2，但 `appliedCount` 仍应是 1——这个差值就是「多按了一次」的证据。
 */

export type OutdoorMetricKind =
  | "user_input"
  | "model_request"
  | "map_request"
  | "first_bubble"
  | "preview_ready"
  | "confirm"
  | "applied";

export interface OutdoorMetricEvent {
  at: number;
  kind: OutdoorMetricKind;
}

export interface OutdoorTurnMetrics {
  /** 模型请求次数（含重试）。 */
  modelCalls: number;
  /** 地图/场地上下文请求次数。 */
  mapCalls: number;
  /** 用户点确认的次数（双击会记 2）。 */
  confirmations: number;
  /** 真正落盘/写画布的次数，进程内去重同一毫秒。 */
  appliedCount: number;
  /** 从用户发话到第一句有用反馈。 */
  firstUsefulFeedbackMs: number | null;
  /** 从确认到预览出现；没有确认时从开始算。 */
  previewMs: number | null;
  /** 从预览出现到真正应用。 */
  applyMs: number | null;
}

function firstAt(events: OutdoorMetricEvent[], kind: OutdoorMetricKind): number | null {
  const hit = events.find((event) => event.kind === kind);
  return hit ? hit.at : null;
}

function count(events: OutdoorMetricEvent[], kind: OutdoorMetricKind): number {
  return events.reduce((total, event) => (event.kind === kind ? total + 1 : total), 0);
}

function span(from: number | null, to: number | null): number | null {
  if (from === null || to === null) return null;
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  const delta = to - from;
  return delta >= 0 ? delta : null;
}

export function collectOutdoorTurnMetrics(input: {
  startedAt: number;
  events: OutdoorMetricEvent[];
  endedAt?: number | null;
}): OutdoorTurnMetrics {
  const startedAt = input.startedAt;
  const endedAt = typeof input.endedAt === "number" ? input.endedAt : null;
  const inWindow = (event: OutdoorMetricEvent) =>
    Number.isFinite(event.at) &&
    event.at >= startedAt &&
    (endedAt === null || event.at <= endedAt);

  const events = [...input.events]
    .filter(inWindow)
    .sort((left, right) => left.at - right.at);

  const firstBubble = firstAt(events, "first_bubble");
  const firstConfirm = firstAt(events, "confirm");
  const firstPreview = firstAt(events, "preview_ready");
  const firstApplied = firstAt(events, "applied");

  const appliedCount = new Set(
    events.filter((event) => event.kind === "applied").map((event) => event.at),
  ).size;

  return {
    modelCalls: count(events, "model_request"),
    mapCalls: count(events, "map_request"),
    confirmations: count(events, "confirm"),
    appliedCount,
    firstUsefulFeedbackMs: span(startedAt, firstBubble),
    previewMs: span(firstConfirm ?? startedAt, firstPreview),
    applyMs: span(firstPreview, firstApplied),
  };
}
