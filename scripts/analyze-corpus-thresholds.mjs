import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

/**
 * 阈值审计与敏感性分析（2026-11-18）。
 *
 * 三件事：
 * 1) 绑定审计：改判据表里的阈值，看执行器行为变不变。行为不变 = 这条阈值没被读，
 *    执行器里另有写死副本（漂移风险）。
 * 2) 安全区间：在「对照样本不误报」且「该报的变异样本不被放过」两个约束下，
 *    扫出每条阈值可取的区间，并标出当前值离边界有多远。
 * 3) 案例校准：用 43 案的平台读数给出各类型的跨度/分区/件数分位数，作为模板默认值的
 *    参考量级（建议值，未写回模板）。
 *
 * 为什么用「改数据看行为」而不是读代码：读代码只能证明某处写了常量，
 * 证明不了执行器到底用了哪个；行为法可以。
 */

const root = process.cwd();
const corpusDir = path.join(root, 'data', 'agent-corpus');
const tempDir = path.join(root, '.temp', 'agent-corpus-runtime');

function loadEvaluator() {
  mkdirSync(tempDir, { recursive: true });
  const require = createRequire(import.meta.url);
  const tsModule = require('typescript');
  const transpile = (file) => {
    const source = readFileSync(path.join(root, 'frontend', 'lib', 'agent-corpus', file), 'utf8');
    const output = tsModule.transpileModule(source, {
      compilerOptions: { module: tsModule.ModuleKind.ESNext, target: tsModule.ScriptTarget.ES2022 },
      fileName: file,
    }).outputText;
    // 只重写运行期 import；类型 import 已被排除。
    const rewritten = output.replace(/from '\.\/geometry'/g, "from './geometry.mjs'");
    const target = path.join(tempDir, file.replace(/\.ts$/, '.mjs'));
    writeFileSync(target, rewritten, 'utf8');
    return target;
  };
  transpile('geometry.ts');
  const evaluatePath = transpile('evaluate.ts');
  return import(pathToFileURL(evaluatePath).href);
}

const { evaluateLayout, IMPLEMENTED_RULE_IDS } = await loadEvaluator();

const assertions = JSON.parse(readFileSync(path.join(corpusDir, 'layout-assertions.json'), 'utf8'));
const suite = JSON.parse(readFileSync(path.join(corpusDir, 'cases', 'eval-cases.json'), 'utf8'));
const cases = JSON.parse(readFileSync(path.join(corpusDir, 'cases', 'cases.json'), 'utf8'));

const rules = assertions.rules;
const fixtures = suite.samples.filter((sample) => sample.kind === 'failure');
const control = fixtures.find((sample) => sample.expect.violations.length === 0);

function fieldOf(threshold) {
  for (const key of ['m', 'm2', 'value', 'count']) {
    if (typeof threshold[key] === 'number') return key;
  }
  return null;
}

function runWith(mutate) {
  const copy = structuredClone(rules);
  mutate(copy);
  return fixtures.map((sample) => {
    const evaluation = evaluateLayout(sample.fixture, copy);
    const reported = evaluation.receipts.filter((item) => item.status === 'violation').map((item) => item.ruleId);
    const expected = sample.expect.violations;
    return {
      id: sample.id,
      isControl: sample.id === control.id,
      reported,
      missed: expected.filter((id) => !reported.includes(id)),
      extra: reported.filter((id) => !expected.includes(id)),
    };
  });
}

const baselineOutcome = runWith(() => {});

/** 与基线逐条比对：有没有任何样本的结果变了。 */
function outcomeChanged(outcome) {
  return outcome.some((row, index) => {
    const base = baselineOutcome[index];
    return row.reported.slice().sort().join(',') !== base.reported.slice().sort().join(',');
  });
}

function gridFor(field, current, unit) {
  if (field === 'count') {
    const values = new Set();
    for (let value = Math.max(1, Math.floor(current) - 2); value <= Math.ceil(current) + 3; value += 1) values.add(value);
    return [...values].sort((a, b) => a - b);
  }
  if (unit === 'ratio') {
    return [0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.5, 0.6];
  }
  if (unit === 'm2_per_person') {
    return [0.3, 0.5, 0.6, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 2, 2.5, 3];
  }
  const grid = new Set();
  for (const factor of [0.4, 0.6, 0.8, 1, 1.2, 1.5, 2]) {
    grid.add(Math.round(current * factor * 10) / 10);
  }
  // 小阈值补整米点，避免网格全落在小数上
  if (current <= 12) {
    for (let value = 1; value <= 16; value += 1) grid.add(value);
  }
  return [...grid].filter((value) => value > 0).sort((a, b) => a - b);
}

function analyseThreshold(ruleId, thresholdIndex) {
  const rule = rules.find((item) => item.id === ruleId);
  const threshold = rule.thresholds[thresholdIndex];
  const field = fieldOf(threshold);
  const current = threshold[field];
  const grid = gridFor(field, current, threshold.unit);
  const points = [];
  let bound = false;

  for (const value of grid) {
    const outcome = runWith((copy) => {
      copy.find((item) => item.id === ruleId).thresholds[thresholdIndex][field] = value;
    });
    const changed = outcomeChanged(outcome);
    if (changed) bound = true;
    const controlRow = outcome.find((row) => row.isControl);
    const missed = outcome.filter((row) => !row.isControl && row.missed.length > 0).map((row) => `${row.id}:${row.missed.join('/')}`);
    const extra = outcome.filter((row) => !row.isControl && row.extra.length > 0).map((row) => `${row.id}:${row.extra.join('/')}`);
    points.push({
      value,
      controlViolations: controlRow.reported.length,
      missed,
      extra,
      ok: controlRow.reported.length === 0 && missed.length === 0 && extra.length === 0,
    });
  }

  const okValues = points.filter((point) => point.ok).map((point) => point.value);
  const safeMin = okValues.length ? Math.min(...okValues) : null;
  const safeMax = okValues.length ? Math.max(...okValues) : null;
  const marginBelow = safeMin === null ? null : Math.round((current - safeMin) * 100) / 100;
  const marginAbove = safeMax === null ? null : Math.round((safeMax - current) * 100) / 100;
  const currentOk = points.find((point) => point.value === current)?.ok ?? false;

  let status = 'hold';
  if (!bound) status = '未绑定（执行器不读该阈值）';
  else if (!currentOk) status = '当前值在夹具上不成立';
  else if (marginBelow !== null && marginAbove !== null && Math.min(marginBelow, marginAbove) <= current * 0.1) {
    status = '边界敏感（余量 ≤10%），需人工确认';
  } else if (marginBelow === null || marginAbove === null) {
    status = '区间单边开放，夹具未覆盖另一侧';
  }

  return {
    ruleId,
    thresholdLabel: threshold.label,
    field,
    current,
    unit: threshold.unit,
    bound,
    currentOk,
    safeMin,
    safeMax,
    marginBelow,
    marginAbove,
    status,
    sourceLevel: rule.sourceLevel,
    source: rule.source,
    points,
  };
}

const implementedRules = rules.filter((rule) => IMPLEMENTED_RULE_IDS.includes(rule.id));
const analyses = [];
for (const rule of implementedRules) {
  rule.thresholds.forEach((_, index) => analyses.push(analyseThreshold(rule.id, index)));
}

// ---------------------------------------------------------------------------
// 案例校准：43 案读数分位（排除跨度异常样本）
// ---------------------------------------------------------------------------

function quantile(values, q) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const weight = position - lower;
  return Math.round((sorted[lower] * (1 - weight) + sorted[upper] * weight) * 10) / 10;
}

const healthy = cases.basemap.filter(
  (item) =>
    item.spanM.width > 0 &&
    item.spanM.width < 2000 &&
    Number.isFinite(item.counts.objects) &&
    Number.isFinite(item.counts.zones),
);

const byType = {};
for (const item of healthy) {
  const type = item.typeRaw || '未分类';
  byType[type] ??= [];
  byType[type].push(item);
}

const calibration = Object.entries(byType)
  .map(([type, items]) => ({
    type,
    n: items.length,
    spanWidth: { p25: quantile(items.map((i) => i.spanM.width), 0.25), median: quantile(items.map((i) => i.spanM.width), 0.5), p75: quantile(items.map((i) => i.spanM.width), 0.75) },
    spanHeight: { p25: quantile(items.map((i) => i.spanM.height), 0.25), median: quantile(items.map((i) => i.spanM.height), 0.5), p75: quantile(items.map((i) => i.spanM.height), 0.75) },
    zones: { p25: quantile(items.map((i) => i.counts.zones), 0.25), median: quantile(items.map((i) => i.counts.zones), 0.5), p75: quantile(items.map((i) => i.counts.zones), 0.75) },
    objects: { p25: quantile(items.map((i) => i.counts.objects), 0.25), median: quantile(items.map((i) => i.counts.objects), 0.5), p75: quantile(items.map((i) => i.counts.objects), 0.75) },
  }))
  .sort((a, b) => b.n - a.n);

const payload = {
  schemaVersion: 1,
  generatedAt: '2026-11-18',
  generator: 'scripts/analyze-corpus-thresholds.mjs',
  method: {
    binding: '把判据表里的阈值逐点改动，重跑 16 份夹具；结果有任何变化即视为执行器读了该阈值。',
    safeInterval: '同时满足「对照样本 0 条硬违规」与「所有变异样本该报的都报出、且不多报」的阈值集合，取连续区间端点。',
    calibration: '43 案平台读数（排除跨度 >2 km 的异常样本），按类型给 P25/中位/P75；只是量级参考，不是判据依据。',
  },
  implementedRules: IMPLEMENTED_RULE_IDS,
  analyses,
  calibration,
  summary: {
    thresholds: analyses.length,
    bound: analyses.filter((item) => item.bound).length,
    unbound: analyses.filter((item) => !item.bound).map((item) => `${item.ruleId}:${item.thresholdLabel}`),
    boundarySensitive: analyses.filter((item) => item.status.startsWith('边界敏感')).map((item) => `${item.ruleId}:${item.thresholdLabel}`),
    notOk: analyses.filter((item) => !item.currentOk).map((item) => `${item.ruleId}:${item.thresholdLabel}`),
  },
};

mkdirSync(path.join(corpusDir), { recursive: true });
writeFileSync(path.join(corpusDir, 'threshold-sensitivity.json'), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

const header = [
  'rule_id',
  'threshold_label',
  'field',
  'current',
  'unit',
  'binding',
  'safe_min',
  'safe_max',
  'margin_below',
  'margin_above',
  'source_level',
  'status',
  'note',
];
const rows = analyses.map((item) => [
  item.ruleId,
  item.thresholdLabel,
  item.field,
  item.current,
  item.unit,
  item.bound ? 'bound' : 'unbound',
  item.safeMin ?? '',
  item.safeMax ?? '',
  item.marginBelow ?? '',
  item.marginAbove ?? '',
  item.sourceLevel,
  item.status,
  item.status === '未绑定（执行器不读该阈值）'
    ? '判据表里有值，但执行器用的是写死副本；改表不生效'
    : item.status === 'hold'
      ? '当前值在夹具上成立'
      : item.status,
]);
const escape = (cell) => (/[",\n]/.test(String(cell)) ? `"${String(cell).replace(/"/g, '""')}"` : String(cell));
writeFileSync(
  path.join(corpusDir, 'threshold-ledger.csv'),
  `${[header, ...rows].map((row) => row.map(escape).join(',')).join('\n')}\n`,
  'utf8',
);

console.log(`threshold-sensitivity.json: ${analyses.length} 条阈值，绑定 ${payload.summary.bound}，未绑定 ${payload.summary.unbound.length}`);
for (const item of analyses) {
  console.log(
    `${item.ruleId.padEnd(7)} ${item.thresholdLabel.padEnd(14)} 当前 ${String(item.current).padEnd(5)}${item.unit.padEnd(16)} 安全 [${item.safeMin ?? '-'}, ${item.safeMax ?? '-'}] ${item.status}`,
  );
}
console.log('校准（类型 / n / 件数中位 / 跨度中位）：');
for (const row of calibration) {
  console.log(`${row.type.padEnd(18)} n=${String(row.n).padEnd(3)} 件数 ${String(row.objects.median).padEnd(5)} 区 ${String(row.zones.median).padEnd(4)} 跨度 ${row.spanWidth.median}×${row.spanHeight.median}`);
}
