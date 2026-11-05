/**
 * generation-report.ts —— 把一次生成跑完的实测数字，写成策划师看得懂的两句话。
 *
 * 口径纪律（与计划书「受众瞬间 U1/U4」一致）：
 * - 只写**实测到**的数字：摆了件、挪开几件、挪不动几件、被拒几件、体检多少分；
 * - 拿不到的数据就不写，不拿「预览帧数」冒充「思考轮数」；
 * - 原始 code（BBOX_OVERLAP 之类）不进这句话，只进开发者日志。
 *
 * 纯函数：不 import UI、不读 localStorage，可在 vitest 里直接断言。
 */

import type { BingoScore } from './bingo-score';
import type { GenerationReport } from './generation-outcome';

/** 构造完成卡所需的一次性事实。 */
export interface GenerationReportInput {
  /** 体检分（computeBingoScore 的产物）。 */
  score: BingoScore;
  /** 实际放进画布的件数。 */
  placedCount: number;
  /** 过不了判据被拒的件数。 */
  refusedCount: number;
  /** 按原样保留没动的件数。 */
  skippedCount: number;
  /** settle 自动挪开的件数。 */
  fixedCount: number;
  /** settle 挪不动、已标红的件数。 */
  stuckCount: number;
  /** 场地面积（m²）。 */
  areaM2: number;
  /** 本次落盘 + 体检耗时（毫秒）。 */
  durationMs: number;
  /** AI 思考轮数；拿不到就 undefined，卡上不显示这一行。 */
  rounds?: number;
}

function round1(value: number): string {
  return Number.isFinite(value) ? String(Math.round(value * 10) / 10) : '0';
}

/** 「为什么这么摆」：只陈述这一版实际发生了什么。 */
export function buildReasoning(input: GenerationReportInput): string {
  const parts: string[] = [];
  parts.push(`按 ${round1(input.areaM2)} m² 的场地摆了 ${input.placedCount} 件。`);
  if (input.fixedCount > 0) parts.push(`压住通道和边界的 ${input.fixedCount} 件已自动挪开。`);
  if (input.stuckCount > 0) parts.push(`还有 ${input.stuckCount} 件挪不动，已在画布标红。`);
  if (input.refusedCount > 0) parts.push(`${input.refusedCount} 件没过判据被拒，没有硬塞进场地。`);
  if (input.skippedCount > 0) parts.push(`${input.skippedCount} 件按原样保留，这次没动。`);
  return parts.join('');
}

/** 「后续建议」：下一句该做什么，按最要紧的问题排。 */
export function buildSuggestion(input: GenerationReportInput): string {
  if (input.stuckCount > 0) return `先处理 ${input.stuckCount} 处标红（压通道或压墙），再交场。`;
  if (input.refusedCount > 0) return `有 ${input.refusedCount} 件因判据被拒，换个位置或换个素材再试一次。`;
  if (input.score.total < 95) return `体检 ${input.score.total} 分，交付前照着主通道走一遍，确认净宽够 1.2 m。`;
  return `体检 ${input.score.total} 分，通道与间距都过；交付前按主通道净宽 ≥1.2 m 复核一次。`;
}

/**
 * 组装完成卡（Z8）字段。
 *
 * `rounds` 只在调用方确实拿到真实轮数时传入，否则整段不出现，
 * 避免用别的数字冒充「思考轮数」。
 */
export function buildGenerationReport(input: GenerationReportInput): GenerationReport {
  const report: GenerationReport = {
    score: input.score,
    reasoning: buildReasoning(input),
    suggestion: buildSuggestion(input),
    durationMs: input.durationMs,
  };
  if (input.rounds !== undefined) report.rounds = input.rounds;
  return report;
}
