/**
 * 评测集打分（2026-11-18）。
 *
 * 刻意保持纯函数、不做 I/O：样本从 `data/agent-corpus/cases/eval-cases.json` 读，
 * 这里只负责「给一份输出，算它对不对」。这样同一套打分既能用在 Node 测试里，
 * 也能直接塞进浏览器端 Agent 自检，不依赖 fs。
 *
 * 两条口径：
 * 1) layout 样本考「提得对不对」——模板命中 + 四项计数落带；
 * 2) failure 样本考「该报的违规报没报出来」——只对已实现判据计分，
 *    未实现的引用只作上下文，**不许拿「没报」当通过，也不许拿「说了但算不了」当命中**。
 */

import { evaluateLayout } from './evaluate';
import type { CorpusRule, Layout } from './types';

export type CountBand = { min: number; max: number };

export type LayoutEvalSample = {
  id: string;
  kind: 'layout';
  derivedFrom: string;
  prompt: string;
  expect: {
    templateId: string | null;
    templateAlt: string[];
    /** 原始案例类型未分类时置 false：只核计数，不拿推测的模板当答案。 */
    templateAsserted: boolean;
    zones: CountBand;
    objects: CountBand;
    routes: CountBand;
    entrances: CountBand;
  };
  labelSource: string;
  toleranceNote: string;
  measurable: boolean;
  caveat?: string;
};

export type FailureEvalSample = {
  id: string;
  kind: 'failure';
  derivedFrom: string;
  /** 变异对应的判据；事故样本为 null。 */
  derivedFromRule?: string | null;
  prompt: string;
  expect: { violations: string[]; contextRefs: string[] };
  fixture: Layout;
  /** 受控变异说明：改了哪一处、是否单点。 */
  mutation?: { change: string; isolated: boolean };
  failureMode: string;
  note?: string;
};

export type EvalSample = LayoutEvalSample | FailureEvalSample;

/** Agent 对一条 layout 样本给出的方案摘要（只需要这五项就能判分）。 */
export type LayoutProposal = {
  templateId: string;
  zones: number;
  objects: number;
  routes: number;
  entrances: number;
};

export type SampleResult = {
  id: string;
  kind: EvalSample['kind'];
  pass: boolean;
  /** 未通过的原因，逐条可读；通过时为空。 */
  failures: string[];
  /** 补充说明：意外多报的违规、缺失的样本口径等。 */
  notes: string[];
};

function inBand(value: number, band: CountBand): boolean {
  return Number.isFinite(value) && value >= band.min && value <= band.max;
}

export function scoreLayoutSample(sample: LayoutEvalSample, proposal: LayoutProposal): SampleResult {
  const failures: string[] = [];
  const notes: string[] = [];
  if (!sample.measurable) {
    notes.push('该样本的参考读数不完整，只作参考，不计入合格率。');
    return { id: sample.id, kind: 'layout', pass: false, failures: ['样本不可测'], notes };
  }
  const accepted = [sample.expect.templateId, ...sample.expect.templateAlt].filter(
    (id): id is string => typeof id === 'string' && id.length > 0,
  );
  if (!sample.expect.templateAsserted) {
    notes.push('该样本原始类型未分类，不校验模板，只核四项计数。');
  } else if (!accepted.includes(proposal.templateId)) {
    failures.push(`模板 ${proposal.templateId} 不在可接受集合 {${accepted.join(', ')}} 内`);
  }
  const fields: (keyof LayoutProposal)[] = ['zones', 'objects', 'routes', 'entrances'];
  for (const field of fields) {
    const band = sample.expect[field] as CountBand;
    const value = proposal[field] as number;
    if (!inBand(value, band)) failures.push(`${field} ${value} ∉ [${band.min}, ${band.max}]`);
  }
  return { id: sample.id, kind: 'layout', pass: failures.length === 0, failures, notes };
}

export function scoreFailureSample(sample: FailureEvalSample, rules: CorpusRule[]): SampleResult {
  const evaluation = evaluateLayout(sample.fixture, rules);
  const reported = evaluation.receipts
    .filter((receipt) => receipt.status === 'violation')
    .map((receipt) => receipt.ruleId);
  const missed = sample.expect.violations.filter((id) => !reported.includes(id));
  const unexpected = reported.filter((id) => !sample.expect.violations.includes(id));
  const stillUnsupported = sample.expect.violations.filter((id) =>
    evaluation.unsupported.some((item) => item.ruleId === id),
  );
  // 对照样本（期望 violations 为空）：报了任何硬违规都是误报，不能因为「没漏报」就算过。
  const isControl = sample.expect.violations.length === 0;
  const failures = isControl
    ? reported.map((id) => `误报：${id}（对照样本应报 0 条硬违规）`)
    : missed.map((id) => `应报未报：${id}`);
  const notes: string[] = [];
  if (isControl) {
    notes.push('对照样本：考的是不误报，不是漏报。');
  } else if (unexpected.length > 0) {
    notes.push(`额外报出：${unexpected.join(', ')}（不算错，但要人工看是否误报）`);
  }
  if (stillUnsupported.length > 0) notes.push(`期望违规中有未实现判据：${stillUnsupported.join(', ')}（夹具或期望写错了）`);
  if (evaluation.unsupported.length > 0) notes.push(`本次共 ${evaluation.unsupported.length} 条判据未实现，未计入得分`);
  return {
    id: sample.id,
    kind: 'failure',
    pass: failures.length === 0 && stillUnsupported.length === 0,
    failures,
    notes,
  };
}

export type SuiteSummary = {
  total: number;
  passed: number;
  failed: number;
  passRate: number;
  byKind: Record<EvalSample['kind'], { total: number; passed: number }>;
};

export function summarizeResults(results: SampleResult[]): SuiteSummary {
  const byKind = {
    layout: { total: 0, passed: 0 },
    failure: { total: 0, passed: 0 },
  } satisfies Record<EvalSample['kind'], { total: number; passed: number }>;
  let passed = 0;
  for (const result of results) {
    byKind[result.kind].total += 1;
    if (result.pass) {
      byKind[result.kind].passed += 1;
      passed += 1;
    }
  }
  return {
    total: results.length,
    passed,
    failed: results.length - passed,
    passRate: results.length === 0 ? 0 : Math.round((passed / results.length) * 1000) / 1000,
    byKind,
  };
}
