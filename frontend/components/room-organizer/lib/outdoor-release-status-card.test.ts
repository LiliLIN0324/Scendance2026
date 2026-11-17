import { describe, expect, it, vi } from 'vitest';
import {
  BROWSER_EVIDENCE,
  EVIDENCE_AS_OF,
  formatReleaseStatusCard,
  logReleaseStatus,
  RELEASE_STATUS_PREFIX,
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
  it('五行固定结构：标题、用例三档、浏览器证据、指标、门禁、结论', () => {
    const lines = formatReleaseStatusCard({
      rows: assessAcceptance(report()),
      metrics: report().metrics,
    }).split('\n');
    expect(lines[0]).toBe('发布前状态卡');
    expect(lines[1]).toContain('验收用例 11 条：可判 0 / 缺料 5 / 只能浏览器 6');
    expect(lines[2]).toContain(`· 浏览器证据（${EVIDENCE_AS_OF}）`);
    expect(lines[3]).toContain('· 指标：turns=0');
    expect(lines[4]).toContain('类型 未验 / 用例 未验 / 构建 未验');
    expect(lines[5]).toBe('· 结论：不可发布（三类全绿 0 条）');
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
