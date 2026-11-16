import { describe, expect, it } from 'vitest';
import {
  ACCEPTANCE_RULES,
  assessAcceptance,
  reportSignals,
  summarizeAssessment,
} from './outdoor-acceptance-selfcheck';
import type { SessionReport } from './outdoor-session-report';
import type { TraceExportRow } from './turn-trace-log';

const AT = Date.UTC(2026, 10, 17, 8, 0, 0);

function row(over: Partial<TraceExportRow> = {}): TraceExportRow {
  return {
    turnId: 't-1',
    route: 'scene',
    stages: [],
    terminal: 'preview_ready',
    errorCode: null,
    totalMs: 900,
    attempts: 1,
    line: '回合 t-1 route=scene → preview_ready',
    ...over,
  };
}

function report(input: {
  rows?: TraceExportRow[];
  mapCalls?: number;
  confirmations?: number;
  appliedCount?: number;
  previewAvgMs?: number | null;
} = {}): SessionReport {
  const rows = input.rows ?? [];
  return {
    version: 1,
    exportedAt: AT,
    traces: { version: 1, exportedAt: AT, rows, text: '' },
    metrics: {
      totals: {
        turns: rows.length,
        modelCalls: 0,
        mapCalls: input.mapCalls ?? 0,
        confirmations: input.confirmations ?? 0,
        appliedCount: input.appliedCount ?? 0,
        firstUsefulFeedbackAvgMs: null,
        previewAvgMs: input.previewAvgMs ?? null,
        applyAvgMs: null,
      },
      rows: [],
      text: '',
    },
    text: '',
  };
}

const byId = (rows: ReturnType<typeof assessAcceptance>, id: number) =>
  rows.find((item) => item.id === id)!;

describe('reportSignals', () => {
  it('空报告没有任何信号', () => {
    expect([...reportSignals(report())]).toEqual([]);
  });

  it('预览终态给 preview，落盘终态同时给 preview 与 apply', () => {
    expect(reportSignals(report({ rows: [row()] })).has('preview')).toBe(true);
    expect(reportSignals(report({ rows: [row({ terminal: 'local_done' })] })).has('apply')).toBe(true);
    expect(reportSignals(report({ rows: [row({ terminal: 'local_done' })] })).has('preview')).toBe(true);
  });

  it('失败既认终态也认 errorCode', () => {
    expect(reportSignals(report({ rows: [row({ terminal: 'failed' })] })).has('failure')).toBe(true);
    expect(reportSignals(report({ rows: [row({ errorCode: 'provider_error' })] })).has('failure')).toBe(true);
  });

  it('登录门、要地点、撤回各自独立成信号', () => {
    const signals = reportSignals(
      report({
        rows: [
          row({ turnId: 'a', terminal: 'awaiting_login' }),
          row({ turnId: 'b', terminal: 'awaiting_place' }),
          row({ turnId: 'c', terminal: 'cancelled' }),
        ],
      }),
    );
    expect(signals.has('login')).toBe(true);
    expect(signals.has('place')).toBe(true);
    expect(signals.has('cancel')).toBe(true);
  });

  it('计数类信号只看 totals，不需要逐轮行', () => {
    const signals = reportSignals(report({ mapCalls: 2, confirmations: 1 }));
    expect(signals.has('map-call')).toBe(true);
    expect(signals.has('confirm')).toBe(true);
  });
});

describe('assessAcceptance', () => {
  it('11 条用例全覆盖，编号不重不漏', () => {
    const ids = ACCEPTANCE_RULES.map((rule) => rule.id);
    expect(ids).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it('空报告：可判 0 条，6 条只能浏览器，#1 缺 turn/map-call/preview', () => {
    const rows = assessAcceptance(report());
    expect(rows.filter((item) => item.verdict === 'ready')).toHaveLength(0);
    expect(rows.filter((item) => item.verdict === 'browser-only')).toHaveLength(6);
    expect(byId(rows, 1).missing).toEqual(['turn', 'map-call', 'preview']);
  });

  it('一份「地图+预览+确认+失败」的报告能判 #1 #3 #6 #10，#4 仍缺 place', () => {
    const rows = assessAcceptance(
      report({
        rows: [row(), row({ turnId: 't-2', terminal: 'failed', errorCode: 'provider_error' })],
        mapCalls: 3,
        confirmations: 1,
        previewAvgMs: 900,
      }),
    );
    expect(byId(rows, 1).verdict).toBe('ready');
    expect(byId(rows, 3).verdict).toBe('ready');
    expect(byId(rows, 6).verdict).toBe('ready');
    expect(byId(rows, 10).verdict).toBe('ready');
    expect(byId(rows, 4).verdict).toBe('missing');
    expect(byId(rows, 4).missing).toEqual(['place']);
  });

  it('只有失败、没有成功预览时 #10 不成立（这条要一失败一成功）', () => {
    const rows = assessAcceptance(report({ rows: [row({ terminal: 'failed' })] }));
    expect(byId(rows, 6).verdict).toBe('ready');
    expect(byId(rows, 10).verdict).toBe('missing');
    expect(byId(rows, 10).missing).toEqual(['preview']);
  });

  it('浏览器类用例永远不给 ready（报告再全也一样）', () => {
    const rows = assessAcceptance(
      report({
        rows: [
          row({ turnId: 'a', terminal: 'local_done' }),
          row({ turnId: 'b', terminal: 'preview_ready' }),
          row({ turnId: 'c', terminal: 'awaiting_login' }),
        ],
        mapCalls: 5,
        confirmations: 2,
        appliedCount: 1,
        previewAvgMs: 800,
      }),
    );
    for (const id of [2, 5, 7, 8, 9, 11]) {
      expect(byId(rows, id).verdict).toBe('browser-only');
    }
  });
});

describe('summarizeAssessment', () => {
  it('汇总三段，并明写「可判 ≠ 通过」', () => {
    const totals = summarizeAssessment(assessAcceptance(report({ rows: [row()], mapCalls: 1 })));
    expect(totals.ready).toBe(2); // #1 #3
    expect(totals.browserOnly).toBe(6);
    expect(totals.text).toContain('可判 2 条');
    expect(totals.text).toContain('只能浏览器 6 条');
    expect(totals.text).toContain('可判 ≠ 通过');
  });

  it('缺料时逐条写出缺哪个信号', () => {
    const totals = summarizeAssessment(assessAcceptance(report()));
    expect(totals.text).toContain('#1 缺 turn/map-call/preview');
    expect(totals.missing).toBe(5);
  });
});
