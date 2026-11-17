import { describe, expect, it } from 'vitest';
import { assessAcceptance } from './outdoor-acceptance-selfcheck';
import type { SessionReport } from './outdoor-session-report';
import type { TraceExportRow } from './turn-trace-log';
import {
  CASE_IDS,
  defaultLedger,
  formatReleaseStatusCard,
  ledgerFromEvidence,
  statusCardSnapshot,
} from './outdoor-release-status-card';

/**
 * 云端那一列（轮次 78）。
 *
 * 之前整列写死 `none`，等于“这一列不存在”。现在可以声明哪几条云端真跑过，
 * 但**声明不出来**也是硬约束：云端只能显式给号，不能从浏览器结果推。
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

describe('云端证据那一列', () => {
  it('不声明就整列未验（不默认通过，也不默认“有部分”）', () => {
    const ledger = ledgerFromEvidence([2, 5]);
    expect(ledger.every((row) => row.cloud === 'none')).toBe(true);
  });

  it('只声明云端通过、但浏览器没标 pass：仍不算三类全绿', () => {
    const ledger = ledgerFromEvidence([2, 5], undefined, [2]);
    const row = ledger.find((item) => item.id === 2)!;
    expect(row.cloud).toBe('pass');
    expect(row.browser).toBe('none'); // 默认常量里 #2 没有任何浏览器证据
    const snap = statusCardSnapshot({
      rows: assessAcceptance(report()),
      metrics: report().metrics,
      ledger,
    });
    expect(snap.allGreen).toBe(0);
    expect(snap.cloud).toEqual({ pass: 1, unverified: 10 });
  });

  it('浏览器 pass + 云端 pass + 固定数据齐了，才计一条三类全绿', () => {
    const ledger = ledgerFromEvidence(
      [2, 5],
      { asOf: '2026-11-18 走查第三轮', seen: { 2: 'pass' } },
      [2],
    );
    const snap = statusCardSnapshot({
      rows: assessAcceptance(report()),
      metrics: report().metrics,
      ledger,
    });
    expect(snap.allGreen).toBe(1);
    const text = formatReleaseStatusCard({
      rows: assessAcceptance(report()),
      metrics: report().metrics,
      ledger,
    });
    expect(text).toContain('云端证据：1 条通过 / 10 条未验');
    expect(text.trimEnd().endsWith('不可发布（三类全绿 1 条）')).toBe(true);
  });

  it('声明里夹着不存在的编号（0 / 12）被丢掉，不会多出一行', () => {
    const ledger = ledgerFromEvidence([2], undefined, [0, 12, 2]);
    expect(ledger.map((row) => row.id)).toEqual([...CASE_IDS]);
    expect(ledger.filter((row) => row.cloud === 'pass').map((row) => row.id)).toEqual([2]);
  });

  it('默认台账（不传云端声明）与旧行为一致：11 行、云端全未验', () => {
    const ledger = defaultLedger();
    expect(ledger).toHaveLength(11);
    expect(ledger.filter((row) => row.cloud === 'pass')).toHaveLength(0);
  });
});
