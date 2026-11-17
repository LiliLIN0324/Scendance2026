/**
 * 最近几轮指标的簿子（M7.1，2026-11-17）。
 *
 * `turn-trace-log` 留的是「每轮怎么走的」，这里留「每轮花了多少」：
 * 模型/地图调用次数、确认次数、落盘次数、首反馈与预览耗时。两件事刻意分开：
 *
 *  · **同一轮只留一条**：`turnId` 相同时是更新，不是追加——否则一轮里的
 *    「预览好了」和「确认落盘」会在簿里留下两条半截记录，平均值全部失真；
 *  · **导出按白名单拼字段**：不搬运内部对象，将来谁给指标加了原话、坐标之类，
 *    也不会顺着导出漏出去。
 *
 * 不做的事：不上报、不落盘、不发请求。要不要持久化由调用方决定。
 */

import type { OutdoorTurnMetrics } from './outdoor-turn-metrics';
import type { TurnTerminal } from './turn-trace';

const DEFAULT_CAPACITY = 20;

export interface MetricsRow {
  turnId: string;
  terminal: TurnTerminal | null;
  modelCalls: number;
  mapCalls: number;
  confirmations: number;
  appliedCount: number;
  firstUsefulFeedbackMs: number | null;
  previewMs: number | null;
  applyMs: number | null;
}

export interface MetricsTotals {
  turns: number;
  modelCalls: number;
  mapCalls: number;
  confirmations: number;
  appliedCount: number;
  /** 只对有的轮次求平均；全都没有时是 null，不是 0。 */
  firstUsefulFeedbackAvgMs: number | null;
  previewAvgMs: number | null;
  applyAvgMs: number | null;
}

export interface MetricsBook {
  /** 记一轮；同 turnId 是更新。返回自身，便于链式调用。 */
  record(turnId: string, metrics: OutdoorTurnMetrics, terminal?: TurnTerminal | null): MetricsBook;
  /** 最近的在前。 */
  list(limit?: number): MetricsRow[];
  /** 汇总：总数求和，耗时才求平均（缺的不参与）。 */
  totals(): MetricsTotals;
  clear(): MetricsBook;
}

function toRow(
  turnId: string,
  metrics: OutdoorTurnMetrics,
  terminal: TurnTerminal | null,
): MetricsRow {
  return {
    turnId,
    terminal,
    modelCalls: metrics.modelCalls,
    mapCalls: metrics.mapCalls,
    confirmations: metrics.confirmations,
    appliedCount: metrics.appliedCount,
    firstUsefulFeedbackMs: metrics.firstUsefulFeedbackMs,
    previewMs: metrics.previewMs,
    applyMs: metrics.applyMs,
  };
}

function average(values: (number | null)[]): number | null {
  const numbers = values.filter((value): value is number => typeof value === 'number');
  if (!numbers.length) return null;
  return Math.round(numbers.reduce((sum, value) => sum + value, 0) / numbers.length);
}

export function createMetricsBook(capacity: number = DEFAULT_CAPACITY): MetricsBook {
  const cap = Math.max(1, Math.floor(capacity));
  const rows: MetricsRow[] = [];
  const book: MetricsBook = {
    record(turnId, metrics, terminal = null) {
      const index = rows.findIndex((row) => row.turnId === turnId);
      if (index >= 0) rows.splice(index, 1);
      rows.unshift(toRow(turnId, metrics, terminal));
      if (rows.length > cap) rows.length = cap;
      return book;
    },
    list(limit) {
      const slice = limit === undefined ? rows : rows.slice(0, Math.max(0, Math.floor(limit)));
      return slice.map((row) => ({ ...row }));
    },
    totals() {
      return {
        turns: rows.length,
        modelCalls: rows.reduce((sum, row) => sum + row.modelCalls, 0),
        mapCalls: rows.reduce((sum, row) => sum + row.mapCalls, 0),
        confirmations: rows.reduce((sum, row) => sum + row.confirmations, 0),
        appliedCount: rows.reduce((sum, row) => sum + row.appliedCount, 0),
        firstUsefulFeedbackAvgMs: average(rows.map((row) => row.firstUsefulFeedbackMs)),
        previewAvgMs: average(rows.map((row) => row.previewMs)),
        applyAvgMs: average(rows.map((row) => row.applyMs)),
      };
    },
    clear() {
      rows.length = 0;
      return book;
    },
  };
  return book;
}

/** 一行纯文本汇总，方便贴进进度文件或工单。 */
export function formatMetricsTotals(totals: MetricsTotals): string {
  return [
    `turns=${totals.turns}`,
    `model=${totals.modelCalls}`,
    `map=${totals.mapCalls}`,
    `confirm=${totals.confirmations}`,
    `applied=${totals.appliedCount}`,
    `firstFeedbackAvg=${totals.firstUsefulFeedbackAvgMs ?? 'null'}`,
    `previewAvg=${totals.previewAvgMs ?? 'null'}`,
    `applyAvg=${totals.applyAvgMs ?? 'null'}`,
  ].join(' ');
}

export interface MetricsSummary {
  totals: MetricsTotals;
  rows: MetricsRow[];
  /** 可直接贴走的一行文本（与 `formatMetricsTotals` 同源）。 */
  text: string;
}

/** 只读快照：面板或控制台要“抄出来”时调它，不暴露簿子本身。 */
export function summarizeMetrics(book: MetricsBook, limit?: number): MetricsSummary {
  const totals = book.totals();
  return { totals, rows: book.list(limit), text: formatMetricsTotals(totals) };
}
