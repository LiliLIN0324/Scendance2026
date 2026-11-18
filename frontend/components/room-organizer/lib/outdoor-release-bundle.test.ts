import { describe, expect, it } from 'vitest';
import { assessAcceptance } from './outdoor-acceptance-selfcheck';
import { readGates } from './outdoor-gate-reading';
import { releaseStatusBundle, gateSummaryLine } from './outdoor-release-bundle';
import type { SessionReport } from './outdoor-session-report';
import type { TraceExportRow } from './turn-trace-log';

/**
 * 一次算齐（轮次 83）：卡片与快照共用同一份台账，不许各算各的。
 */

function report(rows: TraceExportRow[] = []): SessionReport {
  return {
    version: 1,
    exportedAt: 0,
    traces: { version: 1, exportedAt: 0, rows, text: '' },
    metrics: {
      totals: {
        turns: rows.length,
        modelCalls: 0,
        mapCalls: 0,
        confirmations: 0,
        appliedCount: 0,
        firstUsefulFeedbackAvgMs: null,
        previewAvgMs: null,
        applyAvgMs: null,
      },
      rows: [],
      text: 'turns=0 model=0 map=0 confirm=0 applied=0',
    },
    text: 'turns=0 model=0 map=0 confirm=0 applied=0',
  };
}

const rows = () => assessAcceptance(report());
const metrics = () => report().metrics;

describe('发布状态一次算齐', () => {
  it('不传台账时自动由证据生成，卡片与快照的全绿条数一致', () => {
    const bundle = releaseStatusBundle({
      rows: rows(),
      metrics: metrics(),
      evidence: { asOf: '2026-11-18 走查第三轮', seen: { 2: 'pass' } },
      cloudPass: [2],
    });
    expect(bundle.allGreen).toBe(1);
    expect(bundle.snapshot.allGreen).toBe(1);
    expect(bundle.card).toContain('不可发布（三类全绿 1 条）');
    expect(bundle.snapshot.cloud).toEqual({ pass: 1, unverified: 10 });
    expect(bundle.ledger).toHaveLength(11);
  });

  it('显式给台账时以台账为准，cloudPass 不再叠加（避免两处各说一套）', () => {
    const ledger = releaseStatusBundle({ rows: rows(), metrics: metrics() }).ledger;
    const bundle = releaseStatusBundle({
      rows: rows(),
      metrics: metrics(),
      ledger, // 全部 cloud = none
      cloudPass: [2],
    });
    expect(bundle.snapshot.cloud).toEqual({ pass: 0, unverified: 11 });
    expect(bundle.card).toContain('要么没跑、要么还没声明');
  });

  it('门禁三项齐全才算就绪，缺一项就是未齐', () => {
    const ready = releaseStatusBundle({
      rows: rows(),
      metrics: metrics(),
      gate: { typecheck: true, tests: true, build: true },
    });
    expect(ready.gateReady).toBe(true);
    expect(ready.card).toContain('门禁就绪');
    // 门禁就绪也不等于可发布。
    expect(ready.card).toContain('不可发布');

    const partial = releaseStatusBundle({
      rows: rows(),
      metrics: metrics(),
      gate: { typecheck: true, tests: true, build: false },
    });
    expect(partial.gateReady).toBe(false);
    expect(partial.card).toContain('门禁未齐');
  });

  it('空会话：0 条用例、全绿 0、卡片说清“还没有可判的用例”', () => {
    const bundle = releaseStatusBundle({ rows: [], metrics: metrics() });
    expect(bundle.snapshot.cases.total).toBe(0);
    expect(bundle.allGreen).toBe(0);
    expect(bundle.card).toContain('验收用例 0 条');
  });

  it('快照的浏览器三档与卡片那句“已通过 N 条”来自同一份证据', () => {
    const bundle = releaseStatusBundle({
      rows: rows(),
      metrics: metrics(),
      evidence: { seen: { 2: 'pass', 9: 'pass', 4: 'partial' } },
    });
    expect(bundle.snapshot.browser.pass).toEqual([2, 9]);
    expect(bundle.card).toContain('已通过 2 条（#2 #9）');
    expect(bundle.card).toContain('有部分 1 条（#4）');
  });

  it('门禁读数摘要：没跑写未验，不写通过', () => {
    // `readGates({})` = 三项都没跑（不是跑过且干净）。
    const line = gateSummaryLine(readGates({}));
    expect(line).toBe('门禁：类型 未验 / 用例 未验 / 构建 未验');
  });
});
