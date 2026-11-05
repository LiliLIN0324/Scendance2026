/**
 * 每轮的「刚才做了什么」简报。
 *
 * 为什么需要：运行器只在首条消息里给一次场景，之后模型看不到自己上一轮干过什么。
 * 谷地工坊的实测（docs/plans/playtest-matrix-2026-11-05.md）里最贵的一次失败是
 * 适老场景跑了 32 分钟才收敛——模型反复 inspect 同一片地方，因为它没有「我已经查过
 * 这里三次、没有新信息」这层记忆。人不需要这段，模型非常需要。
 *
 * 与 context-refresh 的分工：那边比的是**场景增量**（工坊式直写地图才有），
 * 幕景是提案式——运行期间场景不变，变的是**工具轨迹**。所以这里比的是轨迹。
 *
 * 纯函数：不读时钟、不读环境，时间由调用方传进来（便于测试）。
 */
import type { AgentPhase } from './agent-progress.ts';

/** 工具的三档：只读、试算、落地。只读不改变任何状态，落地会产生实际效果。 */
export type ToolKind = 'read' | 'probe' | 'write';

/**
 * 工具归属。键集与运行器 schemas 的键集一致；新增工具时这里和 agent-progress 一起改，
 * 漏写会在 `toolKind` 返回 'write' 兜底——宁可把只读当写，也不要把写当只读。
 */
const TOOL_KINDS: Record<string, ToolKind> = {
  get_scene: 'read',
  inspect_zone: 'read',
  search_resources: 'read',
  inspect_materials: 'read',
  get_bom: 'read',
  find_free_areas: 'probe',
  validate_candidate: 'probe',
  create_parametric_model: 'write',
  customize_material: 'write',
  start_lux3d_model: 'write',
  submit_candidates: 'write',
};

export function toolKind(tool: string): ToolKind {
  return TOOL_KINDS[tool] ?? 'write';
}

/** 轨迹里的一条。`target` 用来判「是不是在查同一块地方」。 */
export interface TurnTraceEntry {
  turn: number;
  tool: string;
  ok: boolean;
  /** 出错时的错误码，例如 RESOURCE_NOT_FOUND。 */
  code?: string;
  /** 归一化后的目标，例如 `rect(30,80,40,90)`、`size(4x3)`、`q=桌椅`。 */
  target?: string;
}

/**
 * 把工具参数归一成一句可比对的短标识。
 *
 * 只取「同一块地方 / 同一个尺寸 / 同一个查询」这三类会重复的维度：
 * 坐标先取整再排序（x1/z1 与 x2/z2 顺序换一下仍是同一块），尺寸用 `宽x深`，
 * 其余一律退回工具名——宁可漏判重复，也不要把两次不同的探查误判成打转。
 */
export function briefTarget(tool: string, args: Record<string, unknown>): string | undefined {
  if (tool === 'inspect_zone') {
    const { x1, z1, x2, z2 } = args as { x1?: unknown; z1?: unknown; x2?: unknown; z2?: unknown };
    if ([x1, z1, x2, z2].some((v) => typeof v !== 'number')) return undefined;
    const xs = [Math.round(x1 as number), Math.round(x2 as number)].sort((a, b) => a - b);
    const zs = [Math.round(z1 as number), Math.round(z2 as number)].sort((a, b) => a - b);
    return `rect(${xs[0]},${zs[0]},${xs[1]},${zs[1]})`;
  }
  if (tool === 'find_free_areas') {
    const { width, depth } = args as { width?: unknown; depth?: unknown };
    if (typeof width !== 'number' || typeof depth !== 'number') return undefined;
    return `size(${width}x${depth})`;
  }
  if (tool === 'search_resources') {
    const { query } = args as { query?: unknown };
    if (typeof query !== 'string') return undefined;
    return `q=${query.slice(0, 20)}`;
  }
  return undefined;
}

/** 打转判据的默认阈值：同一目标查三次、且中间没有任何落地动作，就算原地转圈。 */
const STALL_THRESHOLD = 3;

export interface StallReport {
  stalled: boolean;
  tool?: string;
  target?: string;
  count?: number;
}

/**
 * 是否在打转：同一 `(工具, 目标)` 连续出现 ≥3 次，且这几次之间没有任何「试算或落地」动作。
 *
 * 为什么要「中间没有动作」这个附加条件：摆完一批物件再回头查同一块地方是正常复核，
 * 只有「反复查、什么都不做」才是空转。
 */
export function looksStalled(trace: readonly TurnTraceEntry[], threshold = STALL_THRESHOLD): StallReport {
  let count = 0;
  let current: TurnTraceEntry | undefined;
  for (const entry of trace) {
    if (toolKind(entry.tool) !== 'read') {
      count = 0;
      current = undefined;
      continue;
    }
    if (entry.target === undefined) {
      count = 0;
      current = undefined;
      continue;
    }
    if (current && current.tool === entry.tool && current.target === entry.target) count += 1;
    else {
      current = entry;
      count = 1;
    }
    if (count >= threshold) return { stalled: true, tool: entry.tool, target: entry.target, count };
  }
  return { stalled: false };
}

/** 轨迹压缩：连续同目标合并成 `×N`，最多保留最近 window 条，避免简报比场景还长。 */
export function summarizeTrace(trace: readonly TurnTraceEntry[], window = 8): string {
  if (!trace.length) return '无';
  const recent = trace.slice(-window);
  const parts: string[] = [];
  for (const entry of recent) {
    const label = entry.target ? `${entry.tool}(${entry.target})` : entry.tool;
    const suffix = entry.ok ? '' : `✗${entry.code ?? '失败'}`;
    const last = parts[parts.length - 1];
    if (last && last.startsWith(`${label}`) && !suffix) {
      const match = /×(\d+)$/.exec(last);
      parts[parts.length - 1] = `${label}×${match ? Number(match[1]) + 1 : 2}`;
      continue;
    }
    parts.push(`${label}${suffix}`);
  }
  const omitted = trace.length - recent.length;
  return `${omitted > 0 ? `…（另 ${omitted} 条略）` : ''}${parts.join(' → ')}`;
}

export type StopReason = 'LAST_TURN' | 'TIME_LOW' | 'STALLED' | null;

export interface PressureInput {
  turn: number;
  maxTurns: number;
  /** 本次运行剩余预算（秒），由运行器按 deadline 算好后传入。 */
  remainingSec: number;
  /** 单轮模型调用 + 工具执行的经验耗时（秒），用来判断「这一轮之后还够不够」。 */
  roundCostSec?: number;
  trace?: readonly TurnTraceEntry[];
}

export interface PressureResult {
  forceSubmit: boolean;
  reason: StopReason;
}

/**
 * 该不该强制提交。
 *
 * 三档，按「已经没机会再改了」的确定性排序：
 * - LAST_TURN：轮次用尽，与以前的行为一致；
 * - TIME_LOW：剩下的时间不够再跑一轮（含一次提交），这是新增的——以前只有轮次闸，
 *   模型可以在单轮里反复读，把时间烧光后直接 AGENT_DEADLINE，用户什么都拿不到；
 * - STALLED：在打转，继续给它轮次只会重复刚才的动作。
 *
 * 剩余时间判据留了 20% 余量：提交本身要跑 build + 校验，耗时不是零。
 */
export function deadlinePressure(input: PressureInput): PressureResult {
  if (input.turn >= input.maxTurns) return { forceSubmit: true, reason: 'LAST_TURN' };
  const cost = Math.max(1, input.roundCostSec ?? 90);
  // 第一轮不判时间：那时还没有任何一轮的实际耗时，用默认估算会把「预算本来就短」的运行
  // 一上来就按死（测试里 90 秒预算就是这么被打掉的）。第一轮永远给一次正常开工的机会。
  if (input.turn > 1 && input.remainingSec <= cost * 1.2) return { forceSubmit: true, reason: 'TIME_LOW' };
  if (input.trace && looksStalled(input.trace).stalled) return { forceSubmit: true, reason: 'STALLED' };
  return { forceSubmit: false, reason: null };
}

export interface TurnBriefInput {
  turn: number;
  maxTurns: number;
  phase: AgentPhase;
  trace: readonly TurnTraceEntry[];
  remainingSec: number;
  pressure: PressureResult;
  /** 上一次工具失败的错误码与工具名，用于提醒「不要再按同样方式重试」。 */
  lastError?: { code: string; tool: string } | null;
  /** 已经通过校验、可以提交的候选数（0 表示手里还没有能交的东西）。 */
  readyCandidates?: number;
}

const PHASE_LABEL: Record<AgentPhase, string> = {
  survey: '看现状',
  locate: '定落点',
  compose: '出方案',
  deliver: '交付',
};

const REASON_TEXT: Record<Exclude<StopReason, null>, string> = {
  LAST_TURN: '轮次用尽',
  TIME_LOW: '时间不够再跑一轮',
  STALLED: '同一处已反复查过、没有新信息',
};

/**
 * 渲染这一轮的简报。固定在 600 字以内——它每轮都要占一次上下文，
 * 长过场景摘要就是本末倒置；超长时先砍轨迹条数，最后通牒那一句永不砍。
 */
export function renderTurnBrief(input: TurnBriefInput): string {
  const lines: string[] = [];
  lines.push(`第 ${input.turn}/${input.maxTurns} 轮 · 阶段：${PHASE_LABEL[input.phase]} · 剩余约 ${Math.max(0, Math.round(input.remainingSec))} 秒`);
  // 轨迹是唯一可以随手变长的一段：从最近 8 条往下收，收到整段放得下为止。
  let window = 8;
  let traceLine = `已调用：${summarizeTrace(input.trace, window)}`;
  while (traceLine.length > 240 && window > 1) {
    window -= 1;
    traceLine = `已调用：${summarizeTrace(input.trace, window)}`;
  }
  lines.push(traceLine);
  if (input.lastError) lines.push(`上一条失败：${input.lastError.tool} → ${input.lastError.code}（不要用同样参数再试一次）`);
  const stall = looksStalled(input.trace);
  if (stall.stalled && stall.tool && stall.target) {
    lines.push(`⚠ ${stall.tool}(${stall.target}) 已经连续查了 ${stall.count} 次，没有产生新信息。改做别的：换落点、换尺寸，或直接提交现有结果。`);
  }
  if (input.readyCandidates !== undefined) {
    lines.push(input.readyCandidates > 0 ? `手里已有 ${input.readyCandidates} 个通过校验的候选。` : '还没有候选通过校验——提交前至少跑一次 validate_candidate。');
  }
  if (input.pressure.forceSubmit && input.pressure.reason) {
    lines.push(`【必须现在提交】${REASON_TEXT[input.pressure.reason]}：本轮请只调用 submit_candidates，不要再读场景或试算。`);
  }
  return lines.join('\n');
}
