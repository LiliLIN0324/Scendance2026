import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { IMPLEMENTED_RULE_IDS, evaluateLayout } from '../frontend/lib/agent-corpus/evaluate';
import {
  scoreFailureSample,
  scoreLayoutSample,
  summarizeResults,
  type EvalSample,
  type FailureEvalSample,
  type LayoutEvalSample,
} from '../frontend/lib/agent-corpus/eval-suite';
import type { CorpusRule } from '../frontend/lib/agent-corpus/types';

/**
 * 评测集的守门测试（2026-11-18）。
 *
 * 这里不只是校验 JSON 形状，还真的跑执行器：
 * 三条失效样本的夹具必须被 evaluateLayout 跑出「该报的那几条违规」，
 * 夹具一旦被改坏、判据一旦被改松，测试立刻红。
 */

const root = process.cwd();
const corpusDir = path.join(root, 'data', 'agent-corpus');

const suite = JSON.parse(readFileSync(path.join(corpusDir, 'cases', 'eval-cases.json'), 'utf8')) as {
  schemaVersion: number;
  samples: EvalSample[];
  tolerances: Record<string, number>;
};
const cases = JSON.parse(readFileSync(path.join(corpusDir, 'cases', 'cases.json'), 'utf8')) as {
  basemap: { id: string; recommended: boolean }[];
};
const rules = (JSON.parse(readFileSync(path.join(corpusDir, 'layout-assertions.json'), 'utf8')) as { rules: CorpusRule[] }).rules;
const templateIds = new Set(
  (JSON.parse(readFileSync(path.join(corpusDir, 'event-templates.json'), 'utf8')) as { templates: { id: string }[] }).templates.map(
    (item) => item.id,
  ),
);
const ruleIds = new Set(rules.map((rule) => rule.id));

const layoutSamples = suite.samples.filter((sample): sample is LayoutEvalSample => sample.kind === 'layout');
const failureSamples = suite.samples.filter((sample): sample is FailureEvalSample => sample.kind === 'failure');

describe('评测集：形态', () => {
  it('13 条样本，10 条 layout + 3 条 failure，id 唯一', () => {
    expect(suite.samples).toHaveLength(13);
    expect(layoutSamples).toHaveLength(10);
    expect(failureSamples).toHaveLength(3);
    const ids = suite.samples.map((sample) => sample.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('每条都能追回案例库，且案例确实是推荐案', () => {
    const recommended = new Set(cases.basemap.filter((item) => item.recommended).map((item) => item.id));
    for (const sample of layoutSamples) expect(recommended.has(sample.derivedFrom)).toBe(true);
    const caseIds = new Set(cases.basemap.map((item) => item.id));
    for (const sample of failureSamples) expect(caseIds.has(sample.derivedFrom)).toBe(false);
  });

  it('prompt 只给场地线索，不给答案；空区域不留空括号', () => {
    for (const sample of layoutSamples) {
      expect(sample.prompt.length).toBeGreaterThan(40);
      expect(sample.prompt).not.toContain('（）');
      expect(sample.prompt).not.toContain('分区数为');
    }
  });

  it('参考带有序、下界不为负，容差口径写清', () => {
    for (const sample of layoutSamples) {
      for (const field of ['zones', 'objects', 'routes', 'entrances'] as const) {
        const band = sample.expect[field];
        expect(band.min).toBeLessThanOrEqual(band.max);
        expect(band.min).toBeGreaterThanOrEqual(0);
      }
      expect(sample.expect.objects.min).toBeGreaterThanOrEqual(1);
      expect(sample.expect.routes.min).toBeGreaterThanOrEqual(1);
      expect(sample.expect.entrances.min).toBeGreaterThanOrEqual(1);
      expect(sample.toleranceNote).toContain('±');
      expect(sample.labelSource).toContain('非');
    }
    expect(suite.tolerances.zones).toBe(2);
  });

  it('模板断言：要校就得是注册模板，不校就必须说明原因', () => {
    for (const sample of layoutSamples) {
      if (sample.expect.templateAsserted) {
        expect(templateIds.has(sample.expect.templateId as string)).toBe(true);
        for (const alt of sample.expect.templateAlt) expect(templateIds.has(alt)).toBe(true);
      } else {
        expect(sample.expect.templateId).toBeNull();
        expect(sample.expect.templateAlt).toHaveLength(0);
      }
    }
  });
});

describe('评测集：失效样本真能跑出违规', () => {
  it('每条失效样本的期望违规都必须是已实现判据', () => {
    for (const sample of failureSamples) {
      expect(sample.expect.violations.length).toBeGreaterThan(0);
      for (const id of sample.expect.violations) {
        expect(ruleIds.has(id)).toBe(true);
        expect(IMPLEMENTED_RULE_IDS as readonly string[]).toContain(id);
      }
    }
  });

  it('上下文引用都在判据集里，且不与期望违规重复', () => {
    for (const sample of failureSamples) {
      for (const id of sample.expect.contextRefs) {
        expect(ruleIds.has(id)).toBe(true);
        expect(sample.expect.violations).not.toContain(id);
      }
    }
  });

  it('执行器跑夹具：该报的全报出来，也没有多报硬违规', () => {
    for (const sample of failureSamples) {
      const result = scoreFailureSample(sample, rules);
      expect(result.failures).toEqual([]);
      expect(result.pass).toBe(true);
      const evaluation = evaluateLayout(sample.fixture, rules);
      const reported = evaluation.receipts.filter((item) => item.status === 'violation').map((item) => item.ruleId);
      expect(reported.sort()).toEqual([...sample.expect.violations].sort());
    }
  });

  it('把缺陷修好之后，打分必须变红（防止样本空转）', () => {
    const sample = failureSamples.find((item) => item.id === 'EV-INC-02')!;
    const repaired = {
      ...sample,
      fixture: {
        ...sample.fixture,
        nodes: [
          ...(sample.fixture.nodes ?? []),
          { id: 'gate-out-1', kind: 'exit' as const, name: '应急出口 1', position: { x: 42, y: 0 } },
          { id: 'gate-out-2', kind: 'exit' as const, name: '应急出口 2', position: { x: 0, y: -8 } },
          { id: 'gate-out-3', kind: 'exit' as const, name: '应急出口 3', position: { x: 0, y: 13 } },
          { id: 'gate-out-4', kind: 'exit' as const, name: '应急出口 4', position: { x: -20, y: 13 } },
        ],
      },
    };
    const result = scoreFailureSample(repaired, rules);
    expect(result.pass).toBe(false);
    expect(result.failures.join(' ')).toContain('GEN-04');
  });

  it('夹具不写伤亡数字，只写布局失效模式', () => {
    for (const sample of failureSamples) {
      expect(sample.failureMode.length).toBeGreaterThan(4);
      expect(JSON.stringify(sample)).not.toMatch(/\d+\s*(死|伤|遇难|人受伤)/);
    }
  });
});

describe('打分器', () => {
  const sample = layoutSamples[0];

  it('命中模板且四项落带 → 通过', () => {
    const proposal = {
      templateId: sample.expect.templateId as string,
      zones: Math.round((sample.expect.zones.min + sample.expect.zones.max) / 2),
      objects: Math.round((sample.expect.objects.min + sample.expect.objects.max) / 2),
      routes: sample.expect.routes.min,
      entrances: sample.expect.entrances.min,
    };
    const result = scoreLayoutSample(sample, proposal);
    expect(result.pass).toBe(true);
    expect(result.failures).toEqual([]);
  });

  it('模板错、计数出带 → 逐条报出，不吞掉', () => {
    const result = scoreLayoutSample(sample, {
      templateId: 'KID',
      zones: 0,
      objects: 1,
      routes: 1,
      entrances: 1,
    });
    expect(result.pass).toBe(false);
    expect(result.failures.some((item) => item.includes('模板 KID'))).toBe(true);
    expect(result.failures.some((item) => item.startsWith('zones'))).toBe(true);
    expect(result.failures.some((item) => item.startsWith('objects'))).toBe(true);
  });

  it('未分类案例不校模板，但仍核计数', () => {
    const unclassified = layoutSamples.find((item) => !item.expect.templateAsserted)!;
    const result = scoreLayoutSample(unclassified, {
      templateId: 'CMP',
      zones: Math.round((unclassified.expect.zones.min + unclassified.expect.zones.max) / 2),
      objects: Math.round((unclassified.expect.objects.min + unclassified.expect.objects.max) / 2),
      routes: 2,
      entrances: 2,
    });
    expect(result.pass).toBe(true);
    expect(result.notes.join(' ')).toContain('不校验模板');
  });

  it('汇总口径：按类分别统计，合格率保留三位', () => {
    const summary = summarizeResults([
      { id: 'a', kind: 'layout', pass: true, failures: [], notes: [] },
      { id: 'b', kind: 'layout', pass: false, failures: ['x'], notes: [] },
      { id: 'c', kind: 'failure', pass: true, failures: [], notes: [] },
    ]);
    expect(summary).toMatchObject({
      total: 3,
      passed: 2,
      failed: 1,
      passRate: 0.667,
      byKind: { layout: { total: 2, passed: 1 }, failure: { total: 1, passed: 1 } },
    });
    expect(summarizeResults([]).passRate).toBe(0);
  });
});
