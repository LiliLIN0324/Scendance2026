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
  /** 发布状态快照（没算过就没有这个字段，不填空对象冒充）。 */
  release?: NonNullable<SessionReportInput['release']>;
  /** 可直接粘进工单的一段文本：轨迹在上，指标在中，发布快照在下。 */
  text: string;
}

/** 报告里可携带的发布状态块（与状态卡同源，两轮报告可直接 diff）。 */
export interface SessionReportRelease {
  snapshot: unknown;
  card?: string;
  /** 走查记录本原件：人对着报告就能复核“哪条标了什么”。 */
  walkthrough?: { asOf?: string; seen: Readonly<Record<number, string>> };
  /** 已声明“云端真跑过”的用例号（去重升序）。 */
  cloud?: readonly number[];
  /** 逐条全绿判断：由台账算（调用方传 `isAllGreen(row)` 的结果），不从标记推。 */
  verdicts?: readonly { id: number; allGreen: boolean }[];
}

export interface SessionReportInput {
  turns: readonly TurnTrace[];
  metrics: MetricsSummary;
  now?: number;
  /**
   * 顺手带上的发布状态。不给就不出现——本层不自己造快照，
   * 也不把“没算”写成 `{}` 或 0 条全绿。
   */
  release?: SessionReportRelease;
}

/** 把标记簿摊成一行：只列标过的号（`none` 不算标过），按编号升序。 */
function formatMarks(walkthrough: SessionReportRelease['walkthrough']): string[] {
  if (!walkthrough) return [];
  const marks = Object.entries(walkthrough.seen)
    .map(([id, state]) => ({ id: Number(id), state }))
    .filter((row) => Number.isInteger(row.id) && row.state !== 'none')
    .sort((a, b) => a.id - b.id)
    .map((row) => `#${row.id} ${row.state}`);
  return marks;
}

export function buildSessionReport(input: SessionReportInput): SessionReport {
  const now = input.now ?? Date.now();
  const traces = exportTraceBundle(input.turns, now);
  const metricsLine = `${METRICS_EXPORT_PREFIX} ${input.metrics.text}`;
  const lines = [traces.text, '', metricsLine];
  if (input.release) {
    // 单行 JSON：两轮报告贴在一起时能按行 diff，不会被格式化噪声搅乱。
    lines.push('', '[发布状态快照]（与状态卡同源；单行 JSON，可直接两轮比对）', JSON.stringify(input.release.snapshot));
    if (input.release.card) lines.push('', input.release.card);
    if (input.release.walkthrough) {
      const marks = formatMarks(input.release.walkthrough);
      const asOf = input.release.walkthrough.asOf?.trim();
      lines.push(
        '',
        '[走查标记]（只列标过的号；与面板同源）',
        marks.length > 0 ? marks.join(' · ') : '（一条都没标）',
      );
      if (asOf) lines.push(`走查日期：${asOf}`);
    }
    if (input.release.cloud) {
      const cloud = [...new Set(input.release.cloud)].sort((a, b) => a - b);
      lines.push(
        '',
        '[云端声明]（人声明的“真跑过”，不是自动探测）',
        cloud.length > 0 ? cloud.map((id) => `#${id}`).join(' · ') : '（一条都没声明）',
      );
    }
    if (input.release.verdicts) {
      const verdicts = [...input.release.verdicts].sort((a, b) => a.id - b.id);
      lines.push(
        '',
        '[逐条判断]（由台账算；不从标记推）',
        verdicts.length > 0
          ? verdicts.map((row) => `#${row.id} ${row.allGreen ? '全绿' : '未全绿'}`).join(' · ')
          : '（没有台账）',
      );
    }
  }
  return {
    version: 1,
    exportedAt: now,
    traces,
    metrics: { totals: input.metrics.totals, rows: input.metrics.rows, text: input.metrics.text },
    ...(input.release ? { release: input.release } : {}),
    text: lines.join('\n'),
  };
}
