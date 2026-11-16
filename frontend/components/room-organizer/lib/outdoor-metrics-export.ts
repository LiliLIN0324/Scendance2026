/**
 * 把一轮对话的指标“抄出来”（M7.1 导出动作，2026-11-17）。
 *
 * 只做一件小事：拿 `summarizeMetrics()` 的结果，先打到控制台（一定有），
 * 再尽量写进剪贴板（可能没有权限/没有 API/浏览器拒绝——都不许抛错）。
 *
 * 为什么先打控制台：剪贴板在 jsdom、隐私模式、无用户手势时都会失败；
 * 如果只依赖剪贴板，用户会遇到“点了没反应”。日志一定成功，剪贴板是加分项。
 */

import type { MetricsSummary } from './outdoor-metrics-book';

export interface MetricsExportDeps {
  log?: (line: string) => void;
  clipboard?: { writeText: (text: string) => Promise<void> } | null;
}

export interface MetricsExportResult {
  /** 控制台日志里的那一行（也含汇总文本）。 */
  line: string;
  /** 剪贴板是否写成功；没有 API 或写入被拒时为 false。 */
  copied: boolean;
}

export const METRICS_EXPORT_PREFIX = '[outdoor-metrics] 汇总';

export function metricsReportLine(summary: MetricsSummary): string {
  return `${METRICS_EXPORT_PREFIX} ${summary.text}`;
}

/** 同步返回结果；剪贴板是异步的，`copied` 只表示“发起成功”。 */
export function exportMetricsReport(
  summary: MetricsSummary,
  deps: MetricsExportDeps = {},
): MetricsExportResult {
  const log = deps.log ?? ((line: string) => console.info(line));
  const line = metricsReportLine(summary);
  log(line);

  const clipboard =
    deps.clipboard === undefined
      ? typeof navigator !== 'undefined'
        ? navigator.clipboard ?? null
        : null
      : deps.clipboard;

  if (!clipboard?.writeText) return { line, copied: false };
  try {
    void clipboard.writeText(summary.text).catch(() => {});
    return { line, copied: true };
  } catch {
    // 老浏览器可能同步抛错；这时仍然只算“日志成功”。
    return { line, copied: false };
  }
}
