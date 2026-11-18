import { describe, expect, it } from 'vitest';
import { buildSessionReport } from './outdoor-session-report';
import { createMetricsBook, summarizeMetrics } from './outdoor-metrics-book';
import { startTurn, enterStage, finishTurn, type TurnTrace } from './turn-trace';
import type { OutdoorTurnMetrics } from './outdoor-turn-metrics';

const T0 = 5_000;

function metrics(over: Partial<OutdoorTurnMetrics> = {}): OutdoorTurnMetrics {
  return {
    modelCalls: 0,
    mapCalls: 0,
    confirmations: 0,
    appliedCount: 0,
    firstUsefulFeedbackMs: null,
    previewMs: null,
    applyMs: null,
    ...over,
  };
}

function summaryOf(over: Partial<OutdoorTurnMetrics> = {}) {
  const book = createMetricsBook();
  book.record('t-a', metrics(over), 'preview_ready');
  return summarizeMetrics(book);
}

function trace(): TurnTrace {
  let t = startTurn({ route: 'scene', now: T0 });
  t = enterStage(t, 'preview', T0 + 800);
  return finishTurn(t, 'preview_ready', { now: T0 + 900 });
}

describe('buildSessionReport', () => {
  it('轨迹在上、指标在下，中间空一行', () => {
    const report = buildSessionReport({ turns: [trace()], metrics: summaryOf({ modelCalls: 2 }), now: T0 });
    const lines = report.text.split('\n');
    expect(lines[0]).toContain('户外 Agent 诊断导出');
    expect(lines[0]).toContain('1 轮');
    expect(lines[lines.length - 1]).toBe(`[outdoor-metrics] 汇总 ${summaryOf({ modelCalls: 2 }).text}`);
    expect(lines[lines.length - 2]).toBe('');
  });

  it('指标部分带上了次数与平均值', () => {
    const report = buildSessionReport({
      turns: [trace()],
      metrics: summaryOf({ modelCalls: 3, mapCalls: 1, previewMs: 800 }),
      now: T0,
    });
    expect(report.metrics.totals.modelCalls).toBe(3);
    expect(report.text).toContain('model=3');
    expect(report.text).toContain('previewAvg=800');
  });

  it('轨迹挂上多余字段也导不出去（白名单在下一层已生效）', () => {
    const dirty = { ...trace(), text: '用户原话', coords: [120.1, 30.2] } as unknown as TurnTrace;
    const report = buildSessionReport({ turns: [dirty], metrics: summaryOf(), now: T0 });
    expect(report.text).not.toContain('用户原话');
    expect(report.text).not.toContain('120.1');
    expect(JSON.stringify(report.traces.rows)).not.toContain('coords');
  });

  it('没有轨迹时仍给指标行，标题写 0 轮', () => {
    const report = buildSessionReport({ turns: [], metrics: summaryOf(), now: T0 });
    expect(report.text).toContain('0 轮');
    expect(report.text).toContain('[outdoor-metrics] 汇总');
    expect(report.traces.rows).toHaveLength(0);
  });

  it('传同一个 now、同一条轨迹时结果确定（便于对账）', () => {
    const t = trace();
    const a = buildSessionReport({ turns: [t], metrics: summaryOf(), now: T0 });
    const b = buildSessionReport({ turns: [t], metrics: summaryOf(), now: T0 });
    expect(a.text).toBe(b.text);
    expect(a.exportedAt).toBe(T0);
  });

  it('不改动传入的轨迹与指标', () => {
    const turns = [trace()];
    const metricsSummary = summaryOf({ modelCalls: 1 });
    const before = JSON.stringify(turns);
    buildSessionReport({ turns, metrics: metricsSummary, now: T0 });
    expect(JSON.stringify(turns)).toBe(before);
    expect(metricsSummary.totals.modelCalls).toBe(1);
  });

  it('导出里的轨迹行与指标行数各按自己的簿子算', () => {
    const report = buildSessionReport({ turns: [trace(), trace()], metrics: summaryOf(), now: T0 });
    expect(report.traces.rows).toHaveLength(2);
    expect(report.metrics.rows).toHaveLength(1);
  });
});

describe("报告携带发布快照（轮次 85）", () => {
  const base = () => ({
    turns: [],
    metrics: {
      totals: {
        turns: 0,
        modelCalls: 0,
        mapCalls: 0,
        confirmations: 0,
        appliedCount: 0,
        firstUsefulFeedbackAvgMs: null,
        previewAvgMs: null,
        applyAvgMs: null,
      },
      rows: [],
      text: "turns=0 model=0 map=0 confirm=0 applied=0",
    },
  });

  it("不给 release 时文本与以前逐字相同，也不凭空多出 release 字段", () => {
    const report = buildSessionReport({ ...base(), now: 1 });
    expect(report.release).toBeUndefined();
    expect(report.text).not.toContain("[发布状态快照]");
  });

  it("给了 release 就多一段单行 JSON，且能原样解析回来", () => {
    const snapshot = { cases: { total: 11 }, allGreen: 0, cloud: { pass: 0, unverified: 11 } };
    const report = buildSessionReport({ ...base(), now: 1, release: { snapshot } });
    expect(report.text).toContain("[发布状态快照]");
    const line = report.text.split("\n").find((row) => row.startsWith("{\"cases\""));
    expect(line).toBeDefined();
    expect(JSON.parse(line as string)).toEqual(snapshot);
  });

  it("带卡片时卡片原文附在快照之后，不重排、不截断", () => {
    const card = "· 发布状态（只报事实）\n· 结论：不可发布（三类全绿 0 条）";
    const report = buildSessionReport({ ...base(), now: 1, release: { snapshot: { allGreen: 0 }, card } });
    // 卡片后面还会跟一行固定收尾（轮次 95），所以不再用 endsWith，而是把字面原文和先后顺序一起盯住。
    expect(report.text).toContain(card);
    expect(report.text.indexOf(card)).toBeLessThan(report.text.indexOf("（本报告只报事实"));
  });
});

describe("报告带原始走查标记（轮次 92）", () => {
  const base = () => ({
    turns: [],
    metrics: {
      totals: {
        turns: 0,
        modelCalls: 0,
        mapCalls: 0,
        confirmations: 0,
        appliedCount: 0,
        firstUsefulFeedbackAvgMs: null,
        previewAvgMs: null,
        applyAvgMs: null,
      },
      rows: [],
      text: "turns=0 model=0 map=0 confirm=0 applied=0",
    },
  });

  it("只列标过的号、按编号升序，none 不算标过", () => {
    const report = buildSessionReport({
      ...base(),
      now: 1,
      release: {
        snapshot: { allGreen: 0 },
        walkthrough: { asOf: "2026-11-19 第三轮", seen: { 5: "partial", 2: "pass", 7: "none" } },
      },
    });
    expect(report.text).toContain("[走查标记]");
    expect(report.text).toContain("#2 pass · #5 partial");
    expect(report.text).not.toContain("#7");
    expect(report.text).toContain("走查日期：2026-11-19 第三轮");
  });

  it("一条没标就明说一条都没标，不留空行", () => {
    const report = buildSessionReport({
      ...base(),
      now: 1,
      release: { snapshot: {}, walkthrough: { seen: {} } },
    });
    expect(report.text).toContain("（一条都没标）");
    expect(report.text).not.toContain("走查日期：");
  });

  it("云端声明去重升序，空集合写“一条都没声明”", () => {
    const report = buildSessionReport({
      ...base(),
      now: 1,
      release: { snapshot: {}, cloud: [5, 2, 5] },
    });
    expect(report.text).toContain("[云端声明]");
    expect(report.text).toContain("#2 · #5");

    const empty = buildSessionReport({ ...base(), now: 1, release: { snapshot: {}, cloud: [] } });
    expect(empty.text).toContain("（一条都没声明）");
  });

  it("不给 walkthrough/cloud 就不出现这两段（旧报告格式不被动）", () => {
    const report = buildSessionReport({ ...base(), now: 1, release: { snapshot: {} } });
    expect(report.text).not.toContain("[走查标记]");
    expect(report.text).not.toContain("[云端声明]");
  });
});

describe("报告带逐条判断（轮次 93）", () => {
  const base = () => ({
    turns: [],
    metrics: {
      totals: {
        turns: 0,
        modelCalls: 0,
        mapCalls: 0,
        confirmations: 0,
        appliedCount: 0,
        firstUsefulFeedbackAvgMs: null,
        previewAvgMs: null,
        applyAvgMs: null,
      },
      rows: [],
      text: "turns=0 model=0 map=0 confirm=0 applied=0",
    },
  });

  it("逐条列全绿/未全绿，按编号升序", () => {
    const report = buildSessionReport({
      ...base(),
      now: 1,
      release: {
        snapshot: {},
        verdicts: [
          { id: 5, allGreen: false },
          { id: 2, allGreen: true },
        ],
      },
    });
    expect(report.text).toContain("[逐条判断]（由台账算；不从标记推）");
    expect(report.text).toContain("#2 全绿 · #5 未全绿");
  });

  it("没有台账就写“没有台账”，不写成“都已全绿”", () => {
    const report = buildSessionReport({ ...base(), now: 1, release: { snapshot: {}, verdicts: [] } });
    expect(report.text).toContain("（没有台账）");
    expect(report.text).not.toContain("全绿 0 条");
  });

  it("不给 verdicts 就不出现这一段（旧报告格式不被动）", () => {
    const report = buildSessionReport({ ...base(), now: 1, release: { snapshot: {} } });
    expect(report.text).not.toContain("[逐条判断]");
  });
});

describe("报告带待补清单（轮次 94）", () => {
  const base = () => ({
    turns: [],
    metrics: {
      totals: {
        turns: 0,
        modelCalls: 0,
        mapCalls: 0,
        confirmations: 0,
        appliedCount: 0,
        firstUsefulFeedbackAvgMs: null,
        previewAvgMs: null,
        applyAvgMs: null,
      },
      rows: [],
      text: "turns=0 model=0 map=0 confirm=0 applied=0",
    },
  });

  it("有待补就一条一行照抄，标题写明缺口未补不可发布", () => {
    const report = buildSessionReport({
      ...base(),
      now: 1,
      release: { snapshot: {}, gaps: ["#2 两个同名地点 —— 缺：云端", "#5 缺：固定数据、浏览器"] },
    });
    expect(report.text).toContain("[待补清单]（缺口未补前不可发布）");
    expect(report.text).toContain("#2 两个同名地点 —— 缺：云端");
    expect(report.text).toContain("#5 缺：固定数据、浏览器");
    expect(report.text).not.toContain("可发布（");
  });

  it("空数组=台账里没缺口，明确写成“没有缺口”而不是空白", () => {
    const report = buildSessionReport({ ...base(), now: 1, release: { snapshot: {}, gaps: [] } });
    expect(report.text).toContain("（台账里没有缺口）");
  });

  it("不给 gaps 就不出现这一段（“没算”与“没缺口”分开）", () => {
    const report = buildSessionReport({ ...base(), now: 1, release: { snapshot: {} } });
    expect(report.text).not.toContain("[待补清单]");
  });
});

describe("报告来源与收尾（轮次 95）", () => {
  const base = () => ({
    turns: [],
    metrics: {
      totals: {
        turns: 0,
        modelCalls: 0,
        mapCalls: 0,
        confirmations: 0,
        appliedCount: 0,
        firstUsefulFeedbackAvgMs: null,
        previewAvgMs: null,
        applyAvgMs: null,
      },
      rows: [],
      text: "turns=0 model=0 map=0 confirm=0 applied=0",
    },
  });

  it("来源行写清固定数据覆盖、走查日期与生成时刻", () => {
    const report = buildSessionReport({
      ...base(),
      now: Date.parse("2026-11-19T04:00:00.000Z"),
      release: {
        snapshot: {},
        sources: { fixedDataIds: [5, 2], walkthroughAsOf: "2026-11-19 第三轮" },
      },
    });
    expect(report.text).toContain(
      "[报告来源] 固定数据用例：#2 #5 · 走查日期：2026-11-19 第三轮 · 生成：2026-11-19T04:00:00.000Z",
    );
  });

  it("走查日期没填就明说未填；没有固定数据写“无”", () => {
    const report = buildSessionReport({
      ...base(),
      now: 1,
      release: { snapshot: {}, sources: { fixedDataIds: [] } },
    });
    expect(report.text).toContain("固定数据用例：无");
    expect(report.text).toContain("走查日期：未填");
    expect(report.text).not.toContain("可发布（");
  });

  it("带发布块时末行固定“不构成发布结论”", () => {
    const report = buildSessionReport({ ...base(), now: 1, release: { snapshot: {} } });
    expect(report.text.trimEnd().endsWith("（本报告只报事实，不构成发布结论；可发布仍需三类全绿）")).toBe(true);
  });

  it("不带发布块时不多出收尾行（旧格式不被动）", () => {
    const report = buildSessionReport({ ...base(), now: 1 });
    expect(report.text).not.toContain("不构成发布结论");
    expect(report.text).not.toContain("[报告来源]");
  });
});
