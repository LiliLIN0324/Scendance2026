/**
 * 最近若干轮的编号簿（M1a：可回看、可取证）。
 *
 * 时间线本身在 `turn-trace.ts` 里；这层只解决「出了事怎么抄出来对账」：
 * - 只留最近 N 轮（默认 20），同一 `turnId` 再记一次是更新而不是新增，
 *   这样一轮从 dispatched 涨到 failed 不会在簿里留下半截影子；
 * - 导出只按白名单拼字段，**不搬运原始 trace 对象**：以后谁给 trace 挂了
 *   `text`/`coords` 之类的字段，也不会顺着导出漏出去；
 * - 存储可注入，node 里直接测；不碰 localStorage 就完全无副作用。
 *
 * 刻意不做的事：不上报、不落盘、不发网络请求。要不要持久化由调用方决定。
 */

import {
  type TurnTrace,
  type TurnTerminal,
  type TurnRoute,
  summarizeTurn,
  totalMs,
} from './turn-trace';

const DEFAULT_CAPACITY = 20;

export interface TurnTraceBook {
  /** 记一轮（同 turnId 更新，不进第二条）。返回新的簿，便于对比引用。 */
  record(trace: TurnTrace): TurnTraceBook;
  /** 最近的在前。 */
  list(limit?: number): TurnTrace[];
  /** 清空——换项目/退出登录时用。 */
  clear(): TurnTraceBook;
}

export function createTurnTraceBook(capacity: number = DEFAULT_CAPACITY): TurnTraceBook {
  const cap = Math.max(1, Math.floor(capacity));
  const items: TurnTrace[] = [];
  const book: TurnTraceBook = {
    record(trace) {
      const index = items.findIndex((item) => item.turnId === trace.turnId);
      if (index >= 0) items.splice(index, 1);
      items.unshift(trace);
      if (items.length > cap) items.length = cap;
      return book;
    },
    list(limit) {
      if (limit === undefined) return [...items];
      return items.slice(0, Math.max(0, Math.floor(limit)));
    },
    clear() {
      items.length = 0;
      return book;
    },
  };
  return book;
}

/** 导出里一轮的固定形制：只有编号、分流、阶段耗时、终态、错误码、耗时。 */
export interface TraceExportRow {
  turnId: string;
  route: TurnRoute;
  stages: { stage: string; ms: number | null }[];
  terminal: TurnTerminal | null;
  errorCode: string | null;
  totalMs: number | null;
  attempts: number;
  line: string;
}

export interface TraceExport {
  version: 1;
  exportedAt: number;
  rows: TraceExportRow[];
  /** 整份可直接粘进工单的一段文本。 */
  text: string;
}

/**
 * 白名单导出：逐字段抄写，不 spread 原始对象。
 * 传入的 trace 多挂了什么字段都到不了这里——这是脱敏的最后一道闸。
 */
export function toExportRow(trace: TurnTrace): TraceExportRow {
  return {
    turnId: trace.turnId,
    route: trace.route,
    stages: trace.stages.map((mark) => ({ stage: mark.stage, ms: mark.ms })),
    terminal: trace.terminal,
    errorCode: trace.errorCode,
    totalMs: totalMs(trace),
    attempts: trace.attemptIds.length,
    line: summarizeTurn(trace),
  };
}

export function exportTraceBundle(turns: readonly TurnTrace[], now: number = Date.now()): TraceExport {
  const rows = turns.map(toExportRow);
  const header = `户外 Agent 诊断导出 · ${new Date(now).toISOString()} · ${rows.length} 轮`;
  const text = [header, ...rows.map((row) => row.line)].join('\n');
  return { version: 1, exportedAt: now, rows, text };
}
