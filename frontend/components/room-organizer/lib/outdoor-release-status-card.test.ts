import { describe, expect, it, vi } from 'vitest';
import {
  BROWSER_EVIDENCE,
  defaultLedger,
  EVIDENCE_AS_OF,
  formatReleaseStatusCard,
  ledgerFromEvidence,
  logReleaseStatus,
  RELEASE_STATUS_PREFIX,
  statusCardSnapshot,
  summarizeLedger,
  type CaseLedgerRow,
} from './outdoor-release-status-card';
import { gateFactsForCard, readGates } from './outdoor-gate-reading';
import { assessAcceptance } from './outdoor-acceptance-selfcheck';
import type { SessionReport } from './outdoor-session-report';
import type { TraceExportRow } from './turn-trace-log';

const AT = Date.UTC(2026, 10, 17, 12, 0, 0);

function row(over: Partial<TraceExportRow> = {}): TraceExportRow {
  return {
    turnId: 't-1',
    route: 'scene',
    stages: [],
    terminal: 'preview_ready',
    errorCode: null,
    totalMs: 900,
    attempts: 1,
    line: '回合 t-1 → preview_ready',
    ...over,
  };
}

function report(rows: TraceExportRow[] = [], mapCalls = 0): SessionReport {
  return {
    version: 1,
    exportedAt: AT,
    traces: { version: 1, exportedAt: AT, rows, text: '' },
    metrics: {
      totals: {
        turns: rows.length,
        modelCalls: 0,
        mapCalls,
        confirmations: 0,
        appliedCount: 0,
        firstUsefulFeedbackAvgMs: null,
        previewAvgMs: null,
        applyAvgMs: null,
      },
      rows: [],
      text: `turns=${rows.length} model=0 map=${mapCalls} confirm=0 applied=0`,
    },
    text: '',
  };
}

describe('formatReleaseStatusCard', () => {
  it('固定行结构：标题、用例三档、浏览器证据、云端证据、指标、门禁、结论', () => {
    const lines = formatReleaseStatusCard({
      rows: assessAcceptance(report()),
      metrics: report().metrics,
    }).split('\n');
    expect(lines).toHaveLength(7);
    expect(lines[0]).toBe('发布前状态卡');
    expect(lines[1]).toContain('验收用例 11 条：可判 0 / 缺料 5 / 只能浏览器 6');
    expect(lines[2]).toContain(`· 浏览器证据（${EVIDENCE_AS_OF}）`);
    expect(lines[3]).toContain('· 云端证据：未验（本次没带台账）');
    expect(lines[4]).toContain('· 指标：turns=0');
    expect(lines[5]).toContain('类型 未验 / 用例 未验 / 构建 未验');
    expect(lines[6]).toBe('· 结论：不可发布（三类全绿 0 条）');
  });

  it('证据行按对照表分“有部分 9 条 / 无证据 2 条”，且无证据的正好是 #2 #5', () => {
    const card = formatReleaseStatusCard({ rows: assessAcceptance(report()), metrics: report().metrics });
    expect(card).toContain('有部分 9 条（#1 #3 #4 #6 #7 #8 #9 #10 #11）');
    expect(card).toContain('无证据 2 条（#2 #5）');
  });

  it('证据表只包含 11 条用例编号，不允许出现未知编号', () => {
    const ids = Object.keys(BROWSER_EVIDENCE).map(Number).sort((a, b) => a - b);
    expect(ids).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(Object.values(BROWSER_EVIDENCE).every((level) => level === 'none' || level === 'partial')).toBe(true);
  });

  it('门禁没跑就写「未验」，不默认通过', () => {
    const card = formatReleaseStatusCard({ rows: assessAcceptance(report()), metrics: report().metrics, gate: {} });
    expect(card).toContain('门禁未齐');
    expect(card).toContain('类型 未验');
  });

  it('门禁三项都过也只写「门禁就绪」，结论仍是不可发布', () => {
    const card = formatReleaseStatusCard({
      rows: assessAcceptance(report()),
      metrics: report().metrics,
      gate: { typecheck: true, tests: true, build: true },
    });
    expect(card).toContain('门禁就绪');
    expect(card).toContain('不可发布');
    expect(card).not.toContain('· 结论：可发布');
  });

  it('门禁有一项未过就写「门禁未齐」', () => {
    const card = formatReleaseStatusCard({
      rows: assessAcceptance(report()),
      metrics: report().metrics,
      gate: { typecheck: true, tests: false, build: true },
    });
    expect(card).toContain('门禁未齐');
    expect(card).toContain('用例 未过');
  });

  it('有料时用例三档计数跟着变，结论句格式不变', () => {
    const rows = assessAcceptance(report([row({ terminal: 'local_done' })], 2));
    const card = formatReleaseStatusCard({ rows, metrics: report([row()], 2).metrics });
    expect(card).toContain('可判 2 / 缺料 3');
    expect(card.endsWith('· 结论：不可发布（三类全绿 0 条）')).toBe(true);
  });

  it('人手填了三类全绿条数，也只是把数字写进去', () => {
    const card = formatReleaseStatusCard({
      rows: assessAcceptance(report()),
      metrics: report().metrics,
      allGreen: 11,
    });
    expect(card).toContain('三类全绿 11 条');
    expect(card).toContain('不可发布');
  });
});

describe('门禁读数接进状态卡', () => {
  const realTests = '\n Test Files  56 passed (56)\n      Tests  645 passed (645)\n';

  it('直接给 reading：门禁行由它算，并多一行读数原文', () => {
    const reading = readGates({ types: '', tests: realTests, build: { exitCode: 0 } });
    const card = formatReleaseStatusCard({
      rows: assessAcceptance(report()),
      metrics: report().metrics,
      reading,
    });
    expect(card).toContain('· 门禁：类型 通过 / 用例 通过 / 构建 通过（门禁就绪）');
    expect(card).toContain(
      '· 读数：门禁：类型 过 / 用例 过 / 构建 过（三项门禁都绿，不等于可发布）',
    );
    expect(card).toContain('· 结论：不可发布');
  });

  it('reading 与手填 gate 同时给时，以 reading 为准', () => {
    const card = formatReleaseStatusCard({
      rows: assessAcceptance(report()),
      metrics: report().metrics,
      gate: { typecheck: true, tests: true, build: true },
      reading: readGates({ tests: realTests }),
    });
    expect(card).toContain('类型 未验 / 用例 通过 / 构建 未验（门禁未齐）');
  });

  it('不给 reading 时不多出读数行（旧调用方式不变）', () => {
    const card = formatReleaseStatusCard({
      rows: assessAcceptance(report()),
      metrics: report().metrics,
    });
    expect(card).not.toContain('· 读数：');
    expect(card).toContain('门禁未齐');
  });

  it('三项读数都过：卡里写“门禁就绪”，但结论仍是不可发布', () => {
    const reading = readGates({
      types: '',
      tests: '\n Test Files  52 passed (52)\n      Tests  608 passed (608)\n',
      build: { exitCode: 0 },
    });
    const card = formatReleaseStatusCard({
      rows: assessAcceptance(report()),
      metrics: report().metrics,
      gate: gateFactsForCard(reading),
    });
    expect(card).toContain('· 门禁：类型 通过 / 用例 通过 / 构建 通过（门禁就绪）');
    expect(card).toContain('· 结论：不可发布');
  });

  it('只跑了用例：没跑的两项仍写“未验”，门禁未齐', () => {
    const reading = readGates({
      tests: '\n Test Files  52 passed (52)\n      Tests  608 passed (608)\n',
    });
    const card = formatReleaseStatusCard({
      rows: assessAcceptance(report()),
      metrics: report().metrics,
      gate: gateFactsForCard(reading),
    });
    expect(card).toContain('类型 未验 / 用例 通过 / 构建 未验（门禁未齐）');
  });
});

describe('可对比快照（两轮直接 diff）', () => {
  it('默认台账下的快照一字段不多一字段不少', () => {
    const snap = statusCardSnapshot({
      rows: assessAcceptance(report()),
      metrics: report().metrics,
      ledger: defaultLedger(),
    });
    expect(snap).toEqual({
      evidenceAsOf: EVIDENCE_AS_OF,
      cases: { total: 11, ready: 0, missing: 5, browserOnly: 6 },
      browser: { partial: [1, 3, 4, 6, 7, 8, 9, 10, 11], none: [2, 5] },
      cloud: { pass: 0, unverified: 11 },
      gate: {},
      allGreen: 0,
    });
  });

  it('没台账时云端写 null，不写一串 0 冒充“都没过”', () => {
    const snap = statusCardSnapshot({
      rows: assessAcceptance(report()),
      metrics: report().metrics,
    });
    expect(snap.cloud).toBeNull();
    expect(snap.allGreen).toBe(0);
  });

  it('门禁读数为空时 gate 是空对象，不是三个 false', () => {
    const snap = statusCardSnapshot({
      rows: assessAcceptance(report()),
      metrics: report().metrics,
      reading: readGates({ tests: '\n      Tests  645 passed (645)\n' }),
    });
    expect(snap.gate).toEqual({ tests: true });
  });

  it('同一输入两次序列化完全一致（可放进 diff）', () => {
    const input = {
      rows: assessAcceptance(report()),
      metrics: report().metrics,
      ledger: defaultLedger(),
    };
    expect(JSON.stringify(statusCardSnapshot(input))).toBe(
      JSON.stringify(statusCardSnapshot(input)),
    );
  });
});

describe('云端那列（以前卡里根本没写）', () => {
  it('默认台账：11 条全部未验，一条也不冒充通过', () => {
    const card = formatReleaseStatusCard({
      rows: assessAcceptance(report()),
      metrics: report().metrics,
      ledger: defaultLedger(),
    });
    expect(card).toContain('· 云端证据：0 条通过 / 11 条未验');
  });

  it('台账里真有一条云端通过，就如实写 1 条', () => {
    const card = formatReleaseStatusCard({
      rows: assessAcceptance(report()),
      metrics: report().metrics,
      ledger: [
        { id: 1, fixedData: true, browser: 'pass', cloud: 'pass' },
        { id: 2, fixedData: true, browser: 'none', cloud: 'none' },
        { id: 3, fixedData: false, browser: 'partial', cloud: 'none' },
      ],
    });
    expect(card).toContain('· 云端证据：1 条通过 / 2 条未验');
    expect(card).toContain('· 结论：不可发布（三类全绿 1 条）');
  });

  it('没带台账就明说未验，不默默省掉这一行', () => {
    const card = formatReleaseStatusCard({
      rows: assessAcceptance(report()),
      metrics: report().metrics,
    });
    expect(card).toContain('· 云端证据：未验（本次没带台账）');
  });
});

describe('默认台账（FIXED_DATA_CASES）', () => {
  it('只把能点到测试文件的两条算作有固定数据', () => {
    const ledger = defaultLedger();
    expect(summarizeLedger(ledger)).toEqual({ allGreen: 0, fixedOnly: 2, total: 11 });
    expect(ledger.filter((r) => r.fixedData).map((r) => r.id)).toEqual([2, 5]);
  });

  it('默认台账下卡永远写 0 条全绿', () => {
    const card = formatReleaseStatusCard({
      rows: assessAcceptance(report()),
      metrics: report().metrics,
      ledger: defaultLedger(),
    });
    expect(card).toContain('· 结论：不可发布（三类全绿 0 条）');
  });
});

describe('台账直接从证据快照生成', () => {
  it('11 行都铺出来，浏览器列只认快照，云端列一条实证也没有', () => {
    const ledger = ledgerFromEvidence([]);
    expect(ledger.map((r) => r.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(ledger.every((r) => r.cloud === 'none')).toBe(true);
    expect(ledger.find((r) => r.id === 2)!.browser).toBe('none');
    expect(ledger.find((r) => r.id === 5)!.browser).toBe('none');
    expect(ledger.find((r) => r.id === 1)!.browser).toBe('partial');
    expect(summarizeLedger(ledger)).toEqual({ allGreen: 0, fixedOnly: 0, total: 11 });
  });

  it('报了几条有固定数据，就只算那几条 fixedOnly', () => {
    const ledger = ledgerFromEvidence([1, 3, 4, 5, 6]);
    expect(summarizeLedger(ledger)).toEqual({ allGreen: 0, fixedOnly: 5, total: 11 });
  });

  it('快照里没有任何一条是 pass，所以生成出来的台账永远算不出全绿', () => {
    const ledger = ledgerFromEvidence([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(summarizeLedger(ledger).allGreen).toBe(0);
  });

  it('卡里用生成台账时，手填 allGreen 也拦不住 0 条', () => {
    const card = formatReleaseStatusCard({
      rows: assessAcceptance(report()),
      metrics: report().metrics,
      ledger: ledgerFromEvidence([1, 3]),
      allGreen: 5,
    });
    expect(card).toContain('· 结论：不可发布（三类全绿 0 条）');
  });
});

describe('逐条台账算全绿（不靠手填）', () => {
  const row = (
    id: number,
    fixedData: boolean,
    browser: CaseLedgerRow['browser'],
    cloud: CaseLedgerRow['cloud'],
  ): CaseLedgerRow => ({ id, fixedData, browser, cloud });

  it('空台账就是 0 条', () => {
    expect(summarizeLedger([])).toEqual({ allGreen: 0, fixedOnly: 0, total: 0 });
  });

  it('只有固定数据、浏览器/云端是 partial 或 none 的，不算全绿', () => {
    const totals = summarizeLedger([
      row(1, true, 'partial', 'none'),
      row(2, true, 'partial', 'none'),
      row(5, true, 'none', 'none'),
    ]);
    expect(totals.allGreen).toBe(0);
    expect(totals.fixedOnly).toBe(3);
    expect(totals.total).toBe(3);
  });

  it('三类都对上才算一条全绿', () => {
    const totals = summarizeLedger([
      row(1, true, 'pass', 'pass'),
      row(2, true, 'pass', 'partial'),
      row(3, false, 'pass', 'pass'),
    ]);
    expect(totals.allGreen).toBe(1);
    expect(totals.fixedOnly).toBe(1);
  });

  it('对照表 11 条全是 partial：台账算出 0 条', () => {
    const ids = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
    const totals = summarizeLedger(ids.map((id) => row(id, true, 'partial', 'none')));
    expect(totals).toEqual({ allGreen: 0, fixedOnly: 11, total: 11 });
  });

  it('卡里给了台账，就忽略手填的 allGreen', () => {
    const card = formatReleaseStatusCard({
      rows: assessAcceptance(report()),
      metrics: report().metrics,
      ledger: [row(1, true, 'partial', 'none'), row(2, true, 'none', 'none')],
      allGreen: 9,
    });
    expect(card).toContain('· 结论：不可发布（三类全绿 0 条）');
    expect(card).not.toContain('三类全绿 9 条');
  });
});

describe('空会话下的状态卡（不出现空括号/光秃标签）', () => {
  it('用例 0 条时说清楚下一步，而不是报三个 0', () => {
    const card = formatReleaseStatusCard({ rows: [], metrics: { text: '' } as never });
    expect(card).toContain('· 验收用例 0 条：还没有可判的用例（先跑一次会话再用）');
    expect(card).not.toContain('可判 0 / 缺料 0');
  });

  it('没有指标时写“没有指标记录”，不留下光秃的冒号', () => {
    const card = formatReleaseStatusCard({ rows: [], metrics: { text: '   ' } as never });
    expect(card).toContain('· 指标：本次会话没有指标记录');
    expect(card).not.toMatch(/· 指标：\s*\n/);
  });

  it('证据清单为空时不留空括号', () => {
    const card = formatReleaseStatusCard({ rows: [], metrics: { text: 'turn=0' } as never });
    expect(card).toContain('有部分 0 条 / 无证据 0 条');
    expect(card).not.toContain('（）');
  });

  it('空会话也照旧写不可发布', () => {
    const card = formatReleaseStatusCard({ rows: [], metrics: { text: '' } as never });
    expect(card.trimEnd().endsWith('· 结论：不可发布（三类全绿 0 条）')).toBe(true);
  });
});

describe('logReleaseStatus', () => {
  it('打一次，首行前缀固定、正文就是整张卡', () => {
    const lines: string[] = [];
    const returned = logReleaseStatus(
      { rows: assessAcceptance(report()), metrics: report().metrics },
      { log: (line) => lines.push(line) },
    );
    expect(lines).toHaveLength(1);
    expect(lines[0].startsWith(`${RELEASE_STATUS_PREFIX}\n发布前状态卡`)).toBe(true);
    expect(lines[0]).toContain('· 结论：不可发布（三类全绿 0 条）');
    expect(lines[0]).toBe(`${RELEASE_STATUS_PREFIX}\n${returned}`);
  });

  it('不传 log 时默认走 console.info', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
    try {
      logReleaseStatus({ rows: assessAcceptance(report()), metrics: report().metrics });
      expect(spy).toHaveBeenCalledTimes(1);
      expect(String(spy.mock.calls[0][0])).toContain('发布前状态卡');
    } finally {
      spy.mockRestore();
    }
  });

  it('门禁没跑时卡里仍是“未验”，不因打印而变成通过', () => {
    const lines: string[] = [];
    logReleaseStatus(
      { rows: assessAcceptance(report()), metrics: report().metrics },
      { log: (line) => lines.push(line) },
    );
    expect(lines[0]).toContain('类型 未验 / 用例 未验 / 构建 未验');
  });
});
