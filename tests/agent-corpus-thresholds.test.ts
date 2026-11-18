import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { IMPLEMENTED_RULE_IDS } from '../frontend/lib/agent-corpus/evaluate';
import type { CorpusRule } from '../frontend/lib/agent-corpus/types';

/**
 * 阈值台账与敏感性分析的守门测试（2026-11-18）。
 *
 * 守四件事：
 * 1) 台账覆盖 11 条已实现判据的每一条阈值；
 * 2) 执行器读不到的阈值必须被点名（不许默默失效）；
 * 3) 当前值必须落在「不误报且不漏报」的区间里；
 * 4) 案例校准的分位数可从 43 案复算，JSON 不是手填的。
 */

const root = process.cwd();
const corpusDir = path.join(root, 'data', 'agent-corpus');

const sensitivity = JSON.parse(readFileSync(path.join(corpusDir, 'threshold-sensitivity.json'), 'utf8')) as {
  analyses: {
    ruleId: string;
    thresholdLabel: string;
    field: string;
    current: number;
    safeMin: number | null;
    safeMax: number | null;
    bound: boolean;
    currentOk: boolean;
    status: string;
  }[];
  calibration: { type: string; n: number; objects: { median: number }; zones: { median: number } }[];
  summary: { thresholds: number; bound: number; unbound: string[]; boundarySensitive: string[]; notOk: string[] };
};
const rules = (JSON.parse(readFileSync(path.join(corpusDir, 'layout-assertions.json'), 'utf8')) as { rules: CorpusRule[] }).rules;
const cases = JSON.parse(readFileSync(path.join(corpusDir, 'cases', 'cases.json'), 'utf8')) as {
  basemap: { typeRaw: string; spanM: { width: number }; counts: { objects: number; zones: number } }[];
};

const ledger = (() => {
  const text = readFileSync(path.join(corpusDir, 'threshold-ledger.csv'), 'utf8').replace(/^\uFEFF/, '');
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  const header = lines[0].split(',');
  return lines.slice(1).map((line) => {
    const cells = line.split(',');
    return Object.fromEntries(header.map((key, index) => [key, cells[index] ?? '']));
  });
})();

describe('阈值台账', () => {
  it('覆盖 11 条已实现判据的每一条阈值', () => {
    const expected = rules
      .filter((rule) => (IMPLEMENTED_RULE_IDS as readonly string[]).includes(rule.id))
      .flatMap((rule) => rule.thresholds.map((threshold) => `${rule.id}:${threshold.label}`));
    const actual = sensitivity.analyses.map((item) => `${item.ruleId}:${item.thresholdLabel}`);
    expect(actual.sort()).toEqual(expected.sort());
    expect(ledger).toHaveLength(expected.length);
    expect(sensitivity.summary.thresholds).toBe(expected.length);
  });

  it('执行器读不到的阈值只有 STG-01 的舒适与临时座席两档', () => {
    expect(sensitivity.summary.unbound.sort()).toEqual(['STG-01:临时座席', 'STG-01:舒适']);
    const unbound = sensitivity.analyses.filter((item) => !item.bound);
    expect(unbound.every((item) => item.ruleId === 'STG-01')).toBe(true);
  });

  it('已绑定的阈值：当前值落在安全区间内，且台账与 JSON 一致', () => {
    for (const item of sensitivity.analyses.filter((entry) => entry.bound)) {
      expect(item.currentOk).toBe(true);
      expect(item.safeMin).not.toBeNull();
      expect(item.safeMax).not.toBeNull();
      expect(item.current).toBeGreaterThanOrEqual(item.safeMin as number);
      expect(item.current).toBeLessThanOrEqual(item.safeMax as number);
      const row = ledger.find((entry) => entry.rule_id === item.ruleId && entry.threshold_label === item.thresholdLabel)!;
      expect(row.binding).toBe('bound');
      expect(Number(row.current)).toBe(item.current);
      expect(Number(row.safe_min)).toBe(item.safeMin);
      expect(Number(row.safe_max)).toBe(item.safeMax);
    }
  });

  it('边界敏感项被点名，且不是「当前值不成立」', () => {
    expect(sensitivity.summary.boundarySensitive.sort()).toEqual(
      ['GEN-04:出口数下限', 'MKT-07:每 10 摊', 'MKT-10:摊位投影占场地'].sort(),
    );
    expect(sensitivity.summary.notOk).toEqual([]);
  });

  it('来源等级记录在台账里，C 级经验值必须看得出来', () => {
    for (const row of ledger) {
      expect(['A', 'B', 'C']).toContain(row.source_level);
    }
    const cLevel = ledger.filter((row) => row.source_level === 'C').map((row) => row.rule_id);
    expect(new Set(cLevel)).toEqual(new Set(['GEN-07', 'MKT-10', 'MKT-11', 'CMP-03']));
  });
});

describe('案例校准', () => {
  it('分位数可从 43 案复算，不是手填', () => {
    const healthy = cases.basemap.filter(
      (item) =>
        item.spanM.width > 0 && item.spanM.width < 2000 && Number.isFinite(item.counts.objects) && Number.isFinite(item.counts.zones),
    );
    const median = (values: number[]) => {
      const sorted = [...values].sort((a, b) => a - b);
      const position = (sorted.length - 1) * 0.5;
      const lower = Math.floor(position);
      const upper = Math.ceil(position);
      const weight = position - lower;
      return Math.round((sorted[lower] * (1 - weight) + sorted[upper] * weight) * 10) / 10;
    };
    for (const row of sensitivity.calibration) {
      const items = healthy.filter((item) => (item.typeRaw || '未分类') === row.type);
      expect(items.length).toBe(row.n);
      expect(median(items.map((item) => item.counts.objects))).toBe(row.objects.median);
      expect(median(items.map((item) => item.counts.zones))).toBe(row.zones.median);
    }
  });

  it('校准覆盖全部类型，且每类样本数加起来等于健康案例数', () => {
    const total = sensitivity.calibration.reduce((sum, row) => sum + row.n, 0);
    expect(total).toBe(43 - 1); // 43 案里排除 1 条跨度异常（Buffalo Marathon）
  });
});
