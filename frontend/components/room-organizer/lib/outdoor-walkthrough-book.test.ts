import { describe, expect, it } from 'vitest';
import { assessAcceptance } from './outdoor-acceptance-selfcheck';
import type { SessionReport } from './outdoor-session-report';
import {
  CASE_IDS,
  EVIDENCE_AS_OF,
  evidenceAsOf,
  formatReleaseStatusCard,
  statusCardSnapshot,
} from './outdoor-release-status-card';
import {
  bookToRecord,
  emptyBook,
  isCaseId,
  lookedCount,
  markSeen,
  setAsOf,
  summarizeWalkthrough,
} from './outdoor-walkthrough-book';
import type { TraceExportRow } from './turn-trace-log';

/**
 * 记录本（轮次 72）：能逐条往上标，但永远不下结论。
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

describe('走查记录本', () => {
  it('空记录本：11 条全算没看，不预先给任何一条证据', () => {
    const book = emptyBook();
    expect(book.seen).toEqual({});
    expect(lookedCount(book)).toBe(0);
    const summary = summarizeWalkthrough(book);
    expect(summary.none).toBe(11);
    expect(summary.pass).toBe(0);
    expect(summary.line).toContain('已看 0/11');
  });

  it('标一条不改原对象（可直接塞进 React state）', () => {
    const before = emptyBook('2026-11-18 走查第三轮');
    const after = markSeen(before, 3, 'pass');
    expect(before.seen).toEqual({});
    expect(after.seen[3]).toBe('pass');
    expect(after.asOf).toBe('2026-11-18 走查第三轮');
    expect(after).not.toBe(before);
  });

  it('重复标记后写的那次生效', () => {
    const book = markSeen(markSeen(emptyBook(), 4, 'pass'), 4, 'partial');
    expect(book.seen[4]).toBe('partial');
    expect(summarizeWalkthrough(book).pass).toBe(0);
    expect(summarizeWalkthrough(book).partial).toBe(1);
  });

  it('非法编号（0 / 12 / 1.5 / NaN）被拒，且返回同一个对象', () => {
    const book = emptyBook();
    for (const bad of [0, 12, 1.5, Number.NaN]) {
      expect(markSeen(book, bad, 'pass')).toBe(book);
      expect(isCaseId(bad)).toBe(false);
    }
    expect(isCaseId(1) && isCaseId(11)).toBe(true);
  });

  it('显式标成 none 仍算没看（不给自己刷“已看”）', () => {
    const book = markSeen(emptyBook(), 7, 'none');
    expect(lookedCount(book)).toBe(0);
    expect(summarizeWalkthrough(book).none).toBe(11);
  });

  it('11 条全标 pass 也只说“看完了”，不说“可发布”', () => {
    let book = emptyBook();
    for (const id of CASE_IDS) book = markSeen(book, id, 'pass');
    const summary = summarizeWalkthrough(book);
    expect(summary.pass).toBe(11);
    expect(summary.none).toBe(0);
    expect(summary.line).toContain('已看 11/11');
    expect(summary.line).not.toContain('可发布（');
    expect(summary.line).toContain('真实云端');
  });

  it('日期写成空白就不写进记录（让卡片自己回落常量）', () => {
    expect('asOf' in bookToRecord(emptyBook('   '))).toBe(false);
    expect(bookToRecord(emptyBook('2026-11-18 走查第三轮')).asOf).toBe('2026-11-18 走查第三轮');
  });

  it('接上卡片：记录本里标了 pass，卡片才出现「已通过」', () => {
    const book = markSeen(markSeen(emptyBook('2026-11-18 走查第三轮'), 2, 'pass'), 9, 'partial');
    const record = bookToRecord(book);
    const text = formatReleaseStatusCard({
      rows: assessAcceptance(report()),
      metrics: report().metrics,
      evidence: record,
    });
    expect(text).toContain('浏览器证据（2026-11-18 走查第三轮）：已通过 1 条（#2）');
    const snap = statusCardSnapshot({
      rows: assessAcceptance(report()),
      metrics: report().metrics,
      evidence: record,
    });
    expect(snap.browser.pass).toEqual([2]);
    expect(snap.browser.partial).toEqual([9]);
  });
});

describe("改走查日期（轮次 91）", () => {
  it("写日期会去掉首尾空白，其余字段不动", () => {
    const book = markSeen(emptyBook(), 2, "pass");
    const next = setAsOf(book, "  2026-11-19 第三轮  ");
    expect(next.asOf).toBe("2026-11-19 第三轮");
    expect(next.seen).toEqual(book.seen);
    expect(next).not.toBe(book);
  });

  it("清空日期就是真的删字段，不留空串", () => {
    const book = setAsOf(emptyBook("2026-11-19"), "");
    expect("asOf" in book).toBe(false);
    const blank = setAsOf(emptyBook("2026-11-19"), "   ");
    expect("asOf" in blank).toBe(false);
  });

  it("清空后 bookToRecord 回到“没写”，让卡片回落常量", () => {
    const record = bookToRecord(setAsOf(emptyBook("2026-11-19"), ""));
    expect("asOf" in record).toBe(false);
    expect(evidenceAsOf(record)).toBe(EVIDENCE_AS_OF);
  });
});
