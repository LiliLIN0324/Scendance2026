import { describe, expect, it } from 'vitest';
import { assessAcceptance } from './outdoor-acceptance-selfcheck';
import type { SessionReport } from './outdoor-session-report';
import type { TraceExportRow } from './turn-trace-log';
import {
  BROWSER_EVIDENCE,
  CASE_IDS,
  EVIDENCE_AS_OF,
  UNSET_ROUND_AS_OF,
  browserEvidenceFrom,
  defaultLedger,
  evidenceAsOf,
  formatReleaseStatusCard,
  ledgerFromEvidence,
  statusCardSnapshot,
  summarizeLedger,
  type WalkthroughRecord,
} from './outdoor-release-status-card';

/**
 * 浏览器证据不再写死在常量里（轮次 71）。
 *
 * 之前卡片和台账里的「有部分 / 无证据」是照对照表抄的一份常量——走查真做了，
 * 也改不进卡片。现在改成：给一份走查记录，就按记录算；不给记录，行为与以前一字不差。
 */

const AT = 0;

function report(rows: TraceExportRow[] = []): SessionReport {
  return {
    version: 1,
    exportedAt: AT,
    traces: { version: 1, exportedAt: AT, rows, text: '' },
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
      text: `turns=${rows.length} model=0 map=0 confirm=0 applied=0`,
    },
    text: `turns=${rows.length} model=0 map=0 confirm=0 applied=0`,
  };
}

function card(record?: WalkthroughRecord): string {
  return formatReleaseStatusCard({
    rows: assessAcceptance(report()),
    metrics: report().metrics,
    ledger: defaultLedger(record),
    ...(record ? { evidence: record } : {}),
  });
}

describe('浏览器证据可注入', () => {
  it('不给记录时，与照对照表抄的那份常量逐条一致', () => {
    const derived = browserEvidenceFrom();
    for (const id of CASE_IDS) {
      expect(derived[id]).toBe(BROWSER_EVIDENCE[id]);
    }
  });

  it('记录里写 pass 的条目，卡片才出现「已通过」；台账那一列跟着变 pass', () => {
    const record: WalkthroughRecord = {
      asOf: '2026-11-18 走查第三轮',
      seen: { 3: 'pass' },
    };
    const text = card(record);
    expect(text).toContain('浏览器证据（2026-11-18 走查第三轮）：已通过 1 条（#3）');
    const ledger = defaultLedger(record);
    expect(ledger.find((row) => row.id === 3)?.browser).toBe('pass');
    // 云端一列仍然没有实证：只凭浏览器过，不能算三类全绿。
    expect(statusCardSnapshot({
      rows: assessAcceptance(report()),
      metrics: report().metrics,
      ledger,
      evidence: record,
    }).allGreen).toBe(0);
    expect(text.trimEnd().endsWith('不可发布（三类全绿 0 条）')).toBe(true);
  });

  it('记录里没提到的号一律当 none，不默认给 partial', () => {
    const record: WalkthroughRecord = { seen: { 4: 'partial' } };
    const derived = browserEvidenceFrom(record);
    expect(derived[4]).toBe('partial');
    expect(derived[1]).toBe('none');
    expect(derived[5]).toBe('none');
  });

  it('空记录（这一轮还没走查）回落到对照表快照，不是一片「无证据」', () => {
    // 2026-11-18：真实链路的空记录本是 `{seen:{}}`（不是 undefined），
    // 旧写法只在 undefined 时回落，于是界面里 11 条全成「无证据」，
    // 而卡片日期还写着 2026-11-17 第二轮——日期与证据跨了两轮。
    const derived = browserEvidenceFrom({ seen: {} });
    for (const id of CASE_IDS) expect(derived[id]).toBe(BROWSER_EVIDENCE[id]);
    // 走了这一轮（有记录）就整份按记录替换，不拿上一轮顶替。
    const marked = browserEvidenceFrom({ seen: { 3: 'pass' } });
    expect(marked[3]).toBe('pass');
    expect(marked[1]).toBe('none');
  });

  it('空记录回落时卡片与台账同源：浏览器列不再是 11 条全无证据', () => {
    const ledger = defaultLedger({ seen: {} });
    expect(ledger.filter((row) => row.browser === 'partial').length).toBe(9);
    expect(ledger.filter((row) => row.browser === 'none').length).toBe(2);
    // 全绿仍是 0：partial 不算过，云端一列也还没有实证。
    expect(summarizeLedger(ledger).allGreen).toBe(0);
  });

  it('记录里多出的号（如 12）被丢掉，不会凭空长出一行台账', () => {
    const ledger = ledgerFromEvidence([2], { seen: { 12: 'pass' } });
    expect(ledger.map((row) => row.id)).toEqual([...CASE_IDS]);
    expect(ledger.some((row) => row.id === 12)).toBe(false);
  });

  it('日期不跨轮：标过证据没填日期就明说未填，不拿上一轮顶替', () => {
    expect(evidenceAsOf({ seen: { 2: 'pass' }, asOf: '2026-11-18 走查第三轮' })).toBe('2026-11-18 走查第三轮');
    expect(evidenceAsOf({ seen: { 2: 'pass' } })).toBe(UNSET_ROUND_AS_OF);
    // 只填了日期、一条都没标：浏览器列仍是快照，日期也必须跟快照一致。
    expect(evidenceAsOf({ seen: {}, asOf: '2026-11-18 走查第三轮' })).toBe(EVIDENCE_AS_OF);
    expect(evidenceAsOf({ asOf: '   ', seen: {} })).toBe(EVIDENCE_AS_OF);
    expect(evidenceAsOf()).toBe(EVIDENCE_AS_OF);
  });

  it('标了证据却没填日期时，卡片不再写上一轮的日期', () => {
    const text = card({ seen: { 2: 'pass' } });
    expect(text).toContain(UNSET_ROUND_AS_OF);
    expect(text).not.toContain(EVIDENCE_AS_OF);
  });

  it('快照的浏览器三档升序、合起来正好覆盖 11 条（不重不漏）', () => {
    const record: WalkthroughRecord = { seen: { 9: 'pass', 2: 'pass', 5: 'none' } };
    const snapshot = statusCardSnapshot({
      rows: assessAcceptance(report()),
      metrics: report().metrics,
      ledger: defaultLedger(record),
      evidence: record,
    });
    expect(snapshot.browser.pass).toEqual([2, 9]);
    for (const list of [snapshot.browser.pass, snapshot.browser.partial, snapshot.browser.none]) {
      expect([...list]).toEqual([...list].sort((a, b) => a - b));
    }
    expect([...snapshot.browser.pass, ...snapshot.browser.partial, ...snapshot.browser.none].sort((a, b) => a - b))
      .toEqual([...CASE_IDS].sort((a, b) => a - b));
  });
});
