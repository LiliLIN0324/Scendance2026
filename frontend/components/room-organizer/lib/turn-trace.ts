/**
 * 一轮请求的编号与阶段时间线（M1a 前端侧）。
 *
 * 目标很窄：让「这一轮为什么没发请求 / 卡在哪一步 / 花了多久」能被抄出来对账，
 * 而不是靠复述。约定：
 * - 一个用户动作 = 一个 `turnId`，一次真实网络请求 = 一个 `attemptId`；重试换
 *   attemptId、复用 turnId，两者都不含任何身份信息（无用户 id、无原话、无坐标）。
 * - 阶段先入先出打点，`finish` 只认第一次终态；重复终态只记一条冲突标记，不改结果，
 *   保证「每轮恰有一个终态」这条对账前提不被后续代码推翻。
 * - 失败只带安全错误码：非白名单字符一律剔掉并截断，供应商原话不进编号。
 *
 * 纯函数 + 无副作用，能在 node 里直接测；落盘/上报由调用方决定。
 */

export type TurnRoute = 'local' | 'map' | 'conversation' | 'scene';

export type TurnStage =
  | 'dispatch'
  | 'map'
  | 'understand'
  | 'plan'
  | 'validate'
  | 'preview'
  | 'apply'
  | 'finish';

/** 每轮恰有一个终态。`stale` = 结果回来时任务已不是当前那条。 */
export type TurnTerminal =
  | 'local_done'
  | 'awaiting_place'
  | 'awaiting_login'
  | 'preview_ready'
  | 'failed'
  | 'cancelled'
  | 'stale';

export interface StageMark {
  stage: TurnStage;
  /** 该阶段进入时刻（毫秒时间戳），用于算耗时与顺序对账。 */
  at: number;
  /** 该阶段耗时；null = 还在进行或未收口。 */
  ms: number | null;
}

export interface TurnTrace {
  turnId: string;
  route: TurnRoute;
  startedAt: number;
  stages: StageMark[];
  attemptIds: string[];
  terminal: TurnTerminal | null;
  /** 第二个终态（如果出现）：只留证据，不覆盖第一个。 */
  conflictingTerminal: TurnTerminal | null;
  /** 安全错误码；只在 failed 时有值。 */
  errorCode: string | null;
  finishedAt: number | null;
}

/** 一个词算得上“错误码”的形制：字母开头，只含字母数字与 _ . -。 */
const CODE_TOKEN = /^[A-Za-z][A-Za-z0-9_.-]*$/;
const MAX_CODE_LENGTH = 48;

function randomSuffix(): string {
  // 不用 crypto 也能跑（老浏览器/测试桩）；只要不与同一毫秒内的另一轮撞车即可。
  return Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0');
}

export function newTurnId(now: number = Date.now()): string {
  return `t-${now.toString(36)}-${randomSuffix()}`;
}

export function newAttemptId(now: number = Date.now()): string {
  return `a-${now.toString(36)}-${randomSuffix()}`;
}

/**
 * 错误码脱敏：只收“长得像错误码”的词，其余全部丢掉。
 *
 * 只做字符替换是不够的：一句供应商原话里 `token=abc`、`30.2,120.1` 这类片段
 * 剥掉中文后仍然会留在编号里。所以按词判定——必须字母开头且只含安全字符，
 * 才能进编号；一句自然语言最终会变成 null，宁缺也不泄。
 */
export function safeErrorCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const kept: string[] = [];
  for (const token of raw.trim().split(/\s+/)) {
    // 先切掉尾部的标点（`timeout!` / `provider:`），再按形制过滤。
    const trimmed = token.replace(/[^A-Za-z0-9_.-]+$/, '');
    if (CODE_TOKEN.test(trimmed)) kept.push(trimmed);
  }
  if (!kept.length) return null;
  return kept.join('-').slice(0, MAX_CODE_LENGTH);
}

export function startTurn(input: { route: TurnRoute; now?: number }): TurnTrace {
  const now = input.now ?? Date.now();
  return {
    turnId: newTurnId(now),
    route: input.route,
    startedAt: now,
    stages: [{ stage: 'dispatch', at: now, ms: null }],
    attemptIds: [],
    terminal: null,
    conflictingTerminal: null,
    errorCode: null,
    finishedAt: null,
  };
}

/** 进入下一阶段：把上一个还在进行的阶段收口，再压入新阶段。返回新对象，便于 React 比较。 */
export function enterStage(trace: TurnTrace, stage: TurnStage, now: number = Date.now()): TurnTrace {
  if (trace.terminal) return trace; // 终态之后不再加阶段，避免时间线被“补记”污染
  const stages = trace.stages.map((mark) =>
    mark.ms === null ? { ...mark, ms: Math.max(0, now - mark.at) } : mark,
  );
  stages.push({ stage, at: now, ms: null });
  return { ...trace, stages };
}

/** 每发一次真实请求调一次：同一轮内 attemptId 各不相同，顺序即重试顺序。 */
export function beginAttempt(trace: TurnTrace, now: number = Date.now()): { trace: TurnTrace; attemptId: string } {
  const attemptId = newAttemptId(now);
  return { trace: { ...trace, attemptIds: [...trace.attemptIds, attemptId] }, attemptId };
}

export function finishTurn(
  trace: TurnTrace,
  terminal: TurnTerminal,
  options: { errorCode?: unknown; now?: number } = {},
): TurnTrace {
  const now = options.now ?? Date.now();
  if (trace.terminal) {
    // 每轮恰一个终态：后来的只当冲突证据，不改业务结论。
    return { ...trace, conflictingTerminal: terminal };
  }
  const stages = trace.stages.map((mark) =>
    mark.ms === null ? { ...mark, ms: Math.max(0, now - mark.at) } : mark,
  );
  return {
    ...trace,
    stages,
    terminal,
    errorCode: terminal === 'failed' ? safeErrorCode(options.errorCode) : null,
    finishedAt: now,
  };
}

export function totalMs(trace: TurnTrace): number | null {
  return trace.finishedAt === null ? null : Math.max(0, trace.finishedAt - trace.startedAt);
}

function formatMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

/**
 * 可复制的单行摘要：编号、分流、阶段耗时、终态、错误码。
 * 只拼白名单字段，原话和坐标不可能混进来。
 */
export function summarizeTurn(trace: TurnTrace): string {
  const parts = [`turn ${trace.turnId}`, `route=${trace.route}`];
  const stages = trace.stages
    .map((mark) => `${mark.stage}:${mark.ms === null ? '…' : formatMs(mark.ms)}`)
    .join(',');
  if (stages) parts.push(`stages=${stages}`);
  parts.push(`term=${trace.terminal ?? 'unfinished'}`);
  const total = totalMs(trace);
  if (total !== null) parts.push(`total=${formatMs(total)}`);
  if (trace.errorCode) parts.push(`code=${trace.errorCode}`);
  if (trace.attemptIds.length > 1) parts.push(`attempts=${trace.attemptIds.length}`);
  return parts.join(' ');
}

/** 失败时给用户能做的事：一句照做就行的话，不给“请稍后再试”这种等于没说的。 */
export function failureHint(trace: TurnTrace): string | null {
  if (trace.terminal !== 'failed') return null;
  const code = trace.errorCode;
  if (!code) return '这次没跑完。点重试会用同一个编号再发一次，便于对照。';
  if (code.startsWith('provider')) return '模型那边暂时没响应。可以点重试；同一编号会跟着第二次请求走。';
  if (code === 'timeout') return '等太久了，已停下。点重试会沿用同一编号重发。';
  return `这次没跑完（${code}）。点重试会沿用同一编号重发，方便按编号对账。`;
}
