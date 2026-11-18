import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Agent 底座语料的守门测试（2026-11-18）。
 *
 * 目标不是验证「布局对不对」，而是保证四份机读件：
 * ① 与规范文档 `docs/plans/activity-space-norms-2026-11-05.md` 不脱节；
 * ② 内部交叉引用不断（模板→判据、物料→判据、示例→判据）；
 * ③ 格数换算与文档声明一致（min 向上取整、max 向下取整）。
 *
 * 任何改数值的动作都必须同时改规范文档与本目录，否则这里会红。
 */

const root = process.cwd();
const dir = path.join(root, 'data', 'agent-corpus');

function readJson<T>(name: string): T {
  return JSON.parse(readFileSync(path.join(dir, name), 'utf8')) as T;
}

type Threshold = {
  label: string;
  m?: number;
  m2?: number;
  count?: number;
  value?: number;
  cells?: number;
  rounding?: 'ceil' | 'floor';
  unit: string;
};

type Rule = {
  id: string;
  scope: string;
  zh: string;
  en: string;
  thresholds: Threshold[];
  formula?: string;
  spec?: string;
  check: string;
  severity: 'hard' | 'warn' | 'ideal';
  runtime: 'static' | 'runtime';
  sourceLevel: 'A' | 'B' | 'C';
  source: string;
  conflictWith: string[];
  promptCore: boolean;
};

type AssertionFile = {
  schemaVersion: number;
  grid: { cellM: number; origin: string; rotationDeg: number[] };
  promptCore: string[];
  rules: Rule[];
  conflicts: { id: string; rules: string[]; theme: string; gap: string; resolution: string; priority: string }[];
};

type Template = {
  id: string;
  zh: string;
  aliases: string[];
  aliasesImplemented: string[];
  status: 'implemented' | 'spec-only';
  codeRef: string | null;
  capacity: { unit: string; assertions: string[] } & Record<string, unknown>;
  requiredMaterials: string[];
  keyAssertions: string[];
  conflictGroups: string[];
};

type TemplateFile = { schemaVersion: number; templates: Template[] };

type MaterialRow = Record<string, string>;

const assertions = readJson<AssertionFile>('layout-assertions.json');
const templates = readJson<TemplateFile>('event-templates.json');
const schema = readJson<{
  required: string[];
  properties: {
    elements: { items: { properties: { kind: { enum: string[] }; certainty: { enum: string[] }; source: { enum: string[] } } } };
    gaps: { items: { properties: { code: { enum: string[] } } } };
    coverage: { properties: { status: { enum: string[] } } };
  };
}>('site-evidence.schema.json');
const example = readJson<{
  elements: { id: string; kind: string; certainty: string; source: string; layoutWeight: string }[];
  constraints: { id: string; evidenceIds: string[]; assertionIds?: string[] }[];
  gaps: { code: string; blocks?: string[] }[];
  coverage: { status: string };
}>('site-evidence.example.json');

const csv = readFileSync(path.join(dir, 'materials.csv'), 'utf8').replace(/^\uFEFF/, '');
const csvRows: MaterialRow[] = (() => {
  const lines = csv.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const header = lines[0].split(',');
  return lines.slice(1).map((line) => {
    const cells = line.split(',');
    const row: MaterialRow = {};
    header.forEach((key, index) => { row[key] = cells[index] ?? ''; });
    row.__fieldCount = String(cells.length);
    return row;
  });
})();

const ruleIds = new Set(assertions.rules.map((rule) => rule.id));
const materialIds = new Set(csvRows.map((row) => row.id));

function unique<T>(items: T[]): boolean {
  return new Set(items).size === items.length;
}

describe('layout-assertions.json', () => {
  it('80 条判据、12 条冲突，id 唯一且与文档编号体系一致', () => {
    expect(assertions.rules).toHaveLength(80);
    expect(assertions.conflicts).toHaveLength(12);
    expect(unique(assertions.rules.map((rule) => rule.id))).toBe(true);
    expect(unique(assertions.conflicts.map((conflict) => conflict.id))).toBe(true);
    for (const rule of assertions.rules) {
      expect(rule.id.startsWith(`${rule.scope}-`)).toBe(true);
    }
    expect(assertions.grid.cellM).toBe(1);
    expect(assertions.grid.rotationDeg).toEqual([0, 90, 180, 270]);
  });

  it('每条判据的编号在规范文档里存在（防止语料自造规则）', () => {
    const doc = readFileSync(path.join(root, 'docs', 'plans', 'activity-space-norms-2026-11-05.md'), 'utf8');
    const documented = new Set(
      [...doc.matchAll(/\|\s*((?:GEN|KID|ELD|MKT|STG|CMP|EXH)-\d{2})\s*\|/g)].map((match) => match[1]),
    );
    const missing = assertions.rules.filter((rule) => !documented.has(rule.id)).map((rule) => rule.id);
    expect(missing).toEqual([]);
    expect(documented.size).toBe(80);
  });

  it('严重级、来源等级、运行时都是受控值，来源不得为空', () => {
    for (const rule of assertions.rules) {
      expect(['hard', 'warn', 'ideal']).toContain(rule.severity);
      expect(['A', 'B', 'C']).toContain(rule.sourceLevel);
      expect(['static', 'runtime']).toContain(rule.runtime);
      expect(rule.source.trim().length).toBeGreaterThan(0);
      expect(rule.check.trim().length).toBeGreaterThan(0);
    }
  });

  it('格数换算与文档口径一致：最小值向上取整、最大值向下取整', () => {
    for (const rule of assertions.rules) {
      for (const threshold of rule.thresholds) {
        if (threshold.unit !== 'm' || threshold.cells === undefined) continue;
        const expected = threshold.rounding === 'floor' ? Math.floor(threshold.m as number) : Math.ceil(threshold.m as number);
        expect({ id: rule.id, label: threshold.label, cells: threshold.cells }).toEqual({
          id: rule.id,
          label: threshold.label,
          cells: expected,
        });
      }
    }
  });

  it('promptCore 恰好是 12 条精编判据覆盖的规则集，且与逐条标记一致', () => {
    const fromRules = assertions.rules.filter((rule) => rule.promptCore).map((rule) => rule.id).sort();
    expect([...assertions.promptCore].sort()).toEqual(fromRules);
    expect(fromRules).toHaveLength(21);
  });

  it('冲突组双向声明，且只引用已存在的判据', () => {
    for (const conflict of assertions.conflicts) {
      for (const id of conflict.rules) expect(ruleIds.has(id)).toBe(true);
      const [a, b] = conflict.rules;
      const ruleA = assertions.rules.find((rule) => rule.id === a)!;
      const ruleB = assertions.rules.find((rule) => rule.id === b)!;
      expect(ruleA.conflictWith).toContain(b);
      expect(ruleB.conflictWith).toContain(a);
    }
  });

  it('conflictWith 只引用判据 id，不混入 CF 编号', () => {
    for (const rule of assertions.rules) {
      for (const other of rule.conflictWith) expect(ruleIds.has(other)).toBe(true);
    }
  });
});

describe('event-templates.json', () => {
  it('7 类模板，id 唯一，别名不跨模板重复', () => {
    expect(templates.templates).toHaveLength(7);
    expect(unique(templates.templates.map((template) => template.id))).toBe(true);
    const aliases = templates.templates.flatMap((template) => template.aliases);
    expect(unique(aliases)).toBe(true);
  });

  it('已实现模板必须给 codeRef，spec-only 必须为 null', () => {
    for (const template of templates.templates) {
      if (template.status === 'implemented') expect(template.codeRef).toBeTruthy();
      else expect(template.codeRef).toBeNull();
    }
    expect(templates.templates.filter((template) => template.status === 'implemented').map((template) => template.id).sort())
      .toEqual(['LEC', 'MKT']);
  });

  it('模板引用的判据与物料都存在', () => {
    for (const template of templates.templates) {
      for (const id of [...template.keyAssertions, ...template.capacity.assertions]) {
        expect({ template: template.id, id, known: ruleIds.has(id) }).toEqual({ template: template.id, id, known: true });
      }
      for (const material of template.requiredMaterials) {
        expect({ template: template.id, material, known: materialIds.has(material) })
          .toEqual({ template: template.id, material, known: true });
      }
    }
  });
});

describe('materials.csv', () => {
  it('每行字段数与表头一致，id 唯一', () => {
    const headerCount = 17;
    for (const row of csvRows) expect({ id: row.id, fields: row.__fieldCount }).toEqual({ id: row.id, fields: String(headerCount) });
    expect(unique(csvRows.map((row) => row.id))).toBe(true);
  });

  it('尺寸与占地为正数，缺数据的字段必须写「待核」而不是留空或编造', () => {
    const unknownColumn = ['高_m', '部署人数', '重量_kg', '风载', '地面要求', '电力_kw', '运输'];
    for (const row of csvRows) {
      expect(Number(row['宽_m'])).toBeGreaterThan(0);
      expect(Number(row['深_m'])).toBeGreaterThan(0);
      const area = Number(row['占地_m2']);
      expect(area).toBeGreaterThan(0);
      expect(Math.abs(area - Number(row['宽_m']) * Number(row['深_m']))).toBeLessThanOrEqual(0.1);
      for (const column of unknownColumn) {
        expect(typeof row[column]).toBe('string');
        expect(row[column].length).toBeGreaterThan(0);
      }
    }
  });

  it('物料引用的间距判据都存在', () => {
    for (const row of csvRows) {
      if (!row['最小间距判据'] || row['最小间距判据'] === '待核') continue;
      for (const id of row['最小间距判据'].split(';')) {
        expect({ material: row.id, id, known: ruleIds.has(id) }).toEqual({ material: row.id, id, known: true });
      }
    }
  });
});

describe('site-evidence.schema.json / example', () => {
  it('schema 的要素类型与代码枚举一致', () => {
    const types = readFileSync(path.join(root, 'frontend', 'lib', 'site-intelligence', 'types.ts'), 'utf8');
    const line = types.split(/\r?\n/).find((row) => row.includes('export type FeatureKind'));
    expect(line).toBeTruthy();
    for (const kind of schema.properties.elements.items.properties.kind.enum) {
      if (kind === 'worker') continue; // 人员不是场地要素，仅运行时存在
      expect(line).toContain(`'${kind}'`);
    }
  });

  it('示例的要素、缺口、约束都在受控枚举内且互相可追', () => {
    const kinds = new Set(schema.properties.elements.items.properties.kind.enum);
    const certainties = new Set(schema.properties.elements.items.properties.certainty.enum);
    const sources = new Set(schema.properties.elements.items.properties.source.enum);
    const gapCodes = new Set(schema.properties.gaps.items.properties.code.enum);
    const statuses = new Set(schema.properties.coverage.properties.status.enum);
    const elementIds = new Set(example.elements.map((element) => element.id));

    expect(unique(example.elements.map((element) => element.id))).toBe(true);
    for (const element of example.elements) {
      expect(kinds.has(element.kind)).toBe(true);
      expect(certainties.has(element.certainty)).toBe(true);
      expect(sources.has(element.source)).toBe(true);
      expect(['hard', 'soft', 'info']).toContain(element.layoutWeight);
    }
    for (const constraint of example.constraints) {
      expect(constraint.evidenceIds.length).toBeGreaterThan(0);
      for (const id of constraint.evidenceIds) expect(elementIds.has(id)).toBe(true);
      for (const id of constraint.assertionIds ?? []) expect(ruleIds.has(id)).toBe(true);
    }
    for (const gap of example.gaps) {
      expect(gapCodes.has(gap.code)).toBe(true);
      for (const id of gap.blocks ?? []) expect(ruleIds.has(id)).toBe(true);
    }
    expect(statuses.has(example.coverage.status)).toBe(true);
    for (const key of schema.required) expect(example).toHaveProperty(key);
  });
});
