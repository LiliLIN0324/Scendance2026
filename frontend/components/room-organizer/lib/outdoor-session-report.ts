/**
 * 一份导出的“会话报告”（M7.1，2026-11-17）。
 *
 * 之前两本簿子各导各的：`turn-trace-log` 导「每轮怎么走的」，`outdoor-metrics-book` 导
 * 「每轮花了多少」。工单或复盘时需要一份能一起贴走的东西，所以这里只做拼装：
 *
 *   · 轨迹部分直接复用 `exportTraceBundle`（已经是逐字段白名单抄写）；
 *   · 指标部分直接复用 `formatMetricsTotals`（同样只含数字）；
 *   · 本层不再新增任何字段——多挂的原话、坐标、身份，都到不了导出文本里。
 */

import { exportTraceBundle, type TraceExport } from './turn-trace-log';
import type { TurnTrace } from './turn-trace';
import type { MetricsSummary } from './outdoor-metrics-book';
import { METRICS_EXPORT_PREFIX } from './outdoor-metrics-export';

export interface SessionReport {
  version: 1;
  exportedAt: number;
  traces: TraceExport;
  metrics: MetricsSummary;
  /** 可直接粘进工单的一段文本：轨迹在上，指标在下。 */
  text: string;
}

export function buildSessionReport(input: {
  turns: readonly TurnTrace[];
  metrics: MetricsSummary;
  now?: number;
}): SessionReport {
  const now = input.now ?? Date.now();
  const traces = exportTraceBundle(input.turns, now);
  const metricsLine = `${METRICS_EXPORT_PREFIX} ${input.metrics.text}`;
  return {
    version: 1,
    exportedAt: now,
    traces,
    metrics: { totals: input.metrics.totals, rows: input.metrics.rows, text: input.metrics.text },
    text: [traces.text, '', metricsLine].join('\n'),
  };
}
