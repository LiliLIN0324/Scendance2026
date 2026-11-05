/**
 * 候选评分卡：把「哪个方案更好」从模型的主观判断，换成引擎能复算的分数。
 *
 * submit_candidates 原先只按 diversityKey 去重，合法与否、净距够不够、区域挤不挤都没进
 * 决策。这里用五条确定性判据把候选排开：合法性 40、净距 25、需求覆盖 20、区域负荷 10、
 * 简洁 5。未经校验、有致命违规、负荷超容量的候选直接否决，不参与排序。
 *
 * 所有输入都来自 validate_candidate / clearance_report / scene_digest 的实测回执；本模块
 * 不猜数值、不读场景、不产生随机结果。
 */

export interface ScoreInput {
  candidateId: string;
  /** 是否跑过 validate_candidate 且通过。 */
  validated: boolean;
  /** 实测净距 vs 要求，格（1 格 = 1 米）。 */
  clearances?: Array<{ from: string; to: string; gap: number; required: number }>;
  /** 结构违规；fatal 一票否决，warn 每条扣 5 分。 */
  violations: Array<{ code: string; severity: 'fatal' | 'warn' }>;
  /** 区域负荷：已用容量 / 总容量。 */
  occupancy?: { used: number; capacity: number };
  /** 需求覆盖：要 6 个座位，实际 6 个。 */
  coverage?: { requested: number; achieved: number };
  objectCount?: number;
}

export interface ScoreResult {
  candidateId: string;
  /** 0–100 的整数。 */
  total: number;
  rejected: boolean;
  /** 人类可读，逐条说明加分/扣分依据。 */
  reasons: string[];
  breakdown: { name: string; points: number; max: number }[];
}

const MAX_LEGALITY = 40;
const MAX_CLEARANCE = 25;
const MAX_COVERAGE = 20;
const MAX_OCCUPANCY = 10;
const MAX_CONCISION = 5;

function showNumber(value: number): string {
  if (!Number.isFinite(value)) return '未知';
  if (Number.isInteger(value)) return String(value);
  return String(Number(value.toFixed(2)));
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function uniqueCodes(items: Array<{ code: string }>): string {
  return [...new Set(items.map(item => item.code))].join('、');
}

/**
 * 给单个候选打分。被否决时 total 归零、五个维度都不计分，reasons 只保留否决原因，
 * 避免把「已出局」的方案与有效方案放在同一把尺子上比较。
 */
export function scoreCandidate(input: ScoreInput): ScoreResult {
  const rejectionReasons: string[] = [];
  const reasons: string[] = [];
  const fatals = input.violations.filter(violation => violation.severity === 'fatal');
  const warns = input.violations.filter(violation => violation.severity === 'warn');

  if (!input.validated) rejectionReasons.push('未经校验的候选不予提交');
  if (fatals.length > 0) {
    rejectionReasons.push(`致命违规 ${uniqueCodes(fatals)}（fatal），候选不予提交`);
  }

  // 合法性：fatal 直接出局；warn 每条扣 5，扣到 0 为止。
  let legality = MAX_LEGALITY;
  if (fatals.length === 0) {
    for (const warn of warns) {
      const deduction = Math.min(5, legality);
      legality -= deduction;
      reasons.push(deduction > 0
        ? `结构警告 ${warn.code}（-${deduction} 分）`
        : `结构警告 ${warn.code}（已达扣分下限）`);
    }
    if (warns.length === 0) reasons.push('合法性：无结构违规');
  }

  // 净距：每条按 gap/required 折算，取平均；没有实测数据就不给分，不能让模型用「看起来够」蒙混。
  let clearance = 0;
  const samples = input.clearances ?? [];
  if (samples.length === 0) {
    reasons.push('未实测净距，该维度计 0 分');
  } else {
    let ratioSum = 0;
    for (const sample of samples) {
      const gap = Number.isFinite(sample.gap) ? Math.max(0, sample.gap) : 0;
      const required = Number.isFinite(sample.required) ? sample.required : 0;
      const ratio = required > 0 ? clamp(gap / required, 0, 1) : (gap >= required ? 1 : 0);
      ratioSum += ratio;
      if (ratio < 1) {
        const share = MAX_CLEARANCE / samples.length;
        const deduction = Math.max(1, Math.round(share * (1 - ratio)));
        reasons.push(`「${sample.from}」与「${sample.to}」净距 ${showNumber(gap)} 格，要求 ${showNumber(required)} 格（-${deduction} 分）`);
      }
    }
    clearance = Math.round((ratioSum / samples.length) * MAX_CLEARANCE);
    if (ratioSum === samples.length) reasons.push('净距全达标');
  }

  // 需求覆盖：没给数据按中性 10 分，既不奖励也不惩罚「没测」。
  let coverage = 0;
  const coverageInput = input.coverage;
  if (!coverageInput) {
    coverage = MAX_COVERAGE / 2;
    reasons.push('未提供覆盖数据，按中性分计');
  } else {
    const requested = Number.isFinite(coverageInput.requested) ? Math.max(0, coverageInput.requested) : 0;
    const achieved = Number.isFinite(coverageInput.achieved) ? Math.max(0, coverageInput.achieved) : 0;
    const ratio = requested <= 0 ? 1 : clamp(achieved / requested, 0, 1);
    coverage = Math.round(ratio * MAX_COVERAGE);
    if (requested <= 0) {
      reasons.push('无覆盖需求');
    } else if (ratio >= 1) {
      reasons.push(`需求覆盖 ${showNumber(achieved)}/${showNumber(requested)}`);
    } else {
      reasons.push(`需求覆盖 ${showNumber(achieved)}/${showNumber(requested)}，缺 ${showNumber(requested - achieved)} 个（-${MAX_COVERAGE - coverage} 分）`);
    }
  }

  // 区域负荷：0.8 以内满分；0.8–1.0 从 10 线性降到 2；超过容量直接否决。
  let occupancy = 0;
  const occupancyInput = input.occupancy;
  if (!occupancyInput) {
    reasons.push('未提供负荷数据，该维度计 0 分');
  } else if (occupancyInput.capacity <= 0) {
    if (occupancyInput.used > 0) {
      rejectionReasons.push('区域负荷超过容量（容量为 0），候选不予提交');
    } else {
      occupancy = MAX_OCCUPANCY;
      reasons.push('区域负荷 0%，在阈值内');
    }
  } else {
    const ratio = Math.max(0, occupancyInput.used / occupancyInput.capacity);
    if (ratio > 1) {
      rejectionReasons.push(`区域负荷 ${Math.round(ratio * 100)}% 超过容量，候选不予提交`);
    } else if (ratio <= 0.8) {
      occupancy = MAX_OCCUPANCY;
      reasons.push(`区域负荷 ${Math.round(ratio * 100)}%，在阈值内`);
    } else {
      occupancy = Math.round(MAX_OCCUPANCY - ((ratio - 0.8) / 0.2) * (MAX_OCCUPANCY - 2));
      reasons.push(`区域负荷 ${Math.round(ratio * 100)}%，高于 80% 舒适线（-${MAX_OCCUPANCY - occupancy} 分）`);
    }
  }

  // 简洁：1–8 个满分；超过 8 个每多 1 个扣 1；0 个说明方案是空的，也不给分。
  let concision = 0;
  const count = input.objectCount;
  if (count === undefined || !Number.isFinite(count)) {
    reasons.push('未提供物件数量，该维度计 0 分');
  } else if (count <= 0) {
    reasons.push(`物件数量 ${showNumber(count)}，疑似空方案`);
  } else if (count <= 8) {
    concision = MAX_CONCISION;
    reasons.push(`物件 ${showNumber(count)} 个，布局简洁`);
  } else {
    concision = Math.max(0, MAX_CONCISION - Math.ceil(count - 8));
    reasons.push(`物件 ${showNumber(count)} 个，超出简洁上限（-${MAX_CONCISION - concision} 分）`);
  }

  if (rejectionReasons.length > 0) {
    return {
      candidateId: input.candidateId,
      total: 0,
      rejected: true,
      reasons: rejectionReasons,
      breakdown: [
        { name: 'legality', points: 0, max: MAX_LEGALITY },
        { name: 'clearance', points: 0, max: MAX_CLEARANCE },
        { name: 'coverage', points: 0, max: MAX_COVERAGE },
        { name: 'occupancy', points: 0, max: MAX_OCCUPANCY },
        { name: 'objectCount', points: 0, max: MAX_CONCISION },
      ],
    };
  }

  const breakdown = [
    { name: 'legality', points: clamp(Math.round(legality), 0, MAX_LEGALITY), max: MAX_LEGALITY },
    { name: 'clearance', points: clamp(Math.round(clearance), 0, MAX_CLEARANCE), max: MAX_CLEARANCE },
    { name: 'coverage', points: clamp(Math.round(coverage), 0, MAX_COVERAGE), max: MAX_COVERAGE },
    { name: 'occupancy', points: clamp(Math.round(occupancy), 0, MAX_OCCUPANCY), max: MAX_OCCUPANCY },
    { name: 'objectCount', points: clamp(Math.round(concision), 0, MAX_CONCISION), max: MAX_CONCISION },
  ];
  const total = breakdown.reduce((sum, item) => sum + item.points, 0);

  return {
    candidateId: input.candidateId,
    total: clamp(total, 0, 100),
    rejected: false,
    reasons,
    breakdown,
  };
}

/**
 * 排序：有效候选按总分降序，同分按 candidateId 字典序；被拒的候选沉底，并保持输入顺序。
 * 返回新数组，不修改入参。
 */
export function rankCandidates(inputs: ScoreInput[]): ScoreResult[] {
  const scored = inputs.map((input, index) => ({ result: scoreCandidate(input), index }));
  const accepted = scored
    .filter(item => !item.result.rejected)
    .sort((a, b) => {
      if (b.result.total !== a.result.total) return b.result.total - a.result.total;
      if (a.result.candidateId < b.result.candidateId) return -1;
      if (a.result.candidateId > b.result.candidateId) return 1;
      return a.index - b.index;
    });
  const rejected = scored
    .filter(item => item.result.rejected)
    .sort((a, b) => a.index - b.index);
  return [...accepted, ...rejected].map(item => item.result);
}

function stripDeduction(reason: string): string {
  return reason.replace(/（-?\d+(?:\.\d+)? 分）$/, '');
}

function clipLine(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`;
}

function describeResult(result: ScoreResult): string {
  if (result.rejected) {
    const rejection = result.reasons.find(reason => reason.includes('fatal') || reason.includes('致命'))
      ?? result.reasons[0]
      ?? '未通过校验';
    return `${result.candidateId} 已否决 —— ${rejection}`;
  }
  const highlights = result.reasons
    .filter(reason => !reason.startsWith('合法性：无结构违规'))
    .filter(reason => !reason.startsWith('物件 '))
    .filter(reason => !reason.startsWith('未提供物件数量'))
    .map(stripDeduction)
    .slice(0, 3);
  return `${result.candidateId} ${result.total} 分 —— ${highlights.length > 0 ? highlights.join('、') : '各项均达标'}`;
}

/**
 * 给模型和用户看的紧凑排序说明。超过 400 字符只保留前 3 名，其余折叠成一行，
 * 避免把提示词预算耗在重复的候选明细上。
 */
export function explainRanking(results: ScoreResult[]): string {
  const header = '候选排序（引擎实测，非模型主观）：';
  const lines = results.map((result, index) => clipLine(`${index + 1}. ${describeResult(result)}`, 110));
  const full = [header, ...lines].join('\n');
  if (full.length <= 400 || results.length <= 3) return full;
  return [header, ...lines.slice(0, 3), `其余 ${results.length - 3} 个略。`].join('\n');
}
