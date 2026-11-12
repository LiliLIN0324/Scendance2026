'use client';

/**
 * 左轨 agent 的本机对话记录。
 *
 * 为什么放在本机：空间/物料这两条线还没有自己的后端会话，先把对话记在本机
 * （localStorage，按 agent 分线）。活动与 Bingo 那一场真实的对话走 AgentPanel 自己的
 * agent.bubbles，不走这里。等后刀接上真接口，只需要把 appendMessage 换成服务端调用。
 *
 * 第 8 批增补：生成运行时状态（真步骤时间线 / 运行条三控件 / 空结果回执）。
 * 这一层是纯本机账本，不接大模型、不接 3D；真实接入由后续命令门接线，这里先把
 * UI 要渲染的数据形状和订阅口子定下来。
 *
 * 第 11 批增补：账本里多一个「阶段」。阶段名与序号跟服务端共用一份定义
 * （supabase/functions/_shared/agent-progress.ts），两边不各写一份数字。
 */

import { localWriteCapabilityGuard, type LocalWriteCapability } from '@/lib/local-write-lease';
import type { AgentPhase } from '../../../../supabase/functions/_shared/agent-progress';
import type { AgentRunEvent } from '@/lib/agent-run-events';

/** 四个格子各自一条线。 */
export type ChatAgent = 'door' | 'bingo' | 'space' | 'material';
export type ChatFrom = 'you' | 'agent';

export interface AgentChatMessage {
  id: string;
  agent: ChatAgent;
  from: ChatFrom;
  text: string;
  at: number;
}

export type AgentChatThreads = Record<ChatAgent, AgentChatMessage[]>;

const STORAGE_KEY = 'scendance.agent-chat.v1';
/** 每条线只留最近这些条，别把本机存储撑爆。 */
const LIMIT = 40;
const EMPTY: AgentChatThreads = { door: [], bingo: [], space: [], material: [] };

function readStored(): AgentChatThreads {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as Partial<AgentChatThreads> | null;
    if (!parsed || typeof parsed !== 'object') return EMPTY;
    const pick = (agent: ChatAgent): AgentChatMessage[] => {
      const list = parsed[agent];
      if (!Array.isArray(list)) return [];
      return list.filter((message): message is AgentChatMessage => (
        !!message
        && typeof message.id === 'string'
        && (message.from === 'you' || message.from === 'agent')
        && typeof message.text === 'string'
        && typeof message.at === 'number'
      ));
    };
    return { door: pick('door'), bingo: pick('bingo'), space: pick('space'), material: pick('material') };
  } catch {
    return EMPTY;
  }
}

let threads: AgentChatThreads = typeof window === 'undefined' ? EMPTY : readStored();
const listeners = new Set<() => void>();

let sessionRequired = false;
let sessionGuard: ReturnType<typeof localWriteCapabilityGuard> | null = null;
let sessionBefore: string | null = null;
let sessionFailed = false;
/** A binding is explicit and cannot drop back to unguarded writes after revocation. */
export function bindAgentChatWriteSession(capability: LocalWriteCapability): () => void {
  const guard=localWriteCapabilityGuard(capability); guard.assertStillHeld();
  sessionRequired=true;
  if (sessionGuard || sessionFailed) throw new Error('对话草稿尚待核对，不能切换编辑权。');
  const raw=window.localStorage.getItem(STORAGE_KEY);
  if (raw !== null) {
    let parsed:unknown;
    try { parsed=JSON.parse(raw); } catch { throw new Error('对话资料无法完整读取。'); }
    if (JSON.stringify(parsed)!==JSON.stringify(threads)) throw new Error('对话资料已变化，请先核对。');
  } else if (Object.values(threads).some(messages=>messages.length)) throw new Error('对话草稿尚未保存，请先核对。');
  sessionRequired=true;sessionGuard=guard;sessionBefore=raw;
  const revoke=()=>{if(sessionGuard===guard)sessionGuard=null;};
  guard.signal.addEventListener('abort',revoke,{once:true});
  return ()=>{guard.signal.removeEventListener('abort',revoke);revoke();};
}
export function agentChatWriteStatus(): 'legacy'|'ready'|'blocked'|'needs_review' {
  return sessionFailed?'needs_review':sessionGuard?'ready':sessionRequired?'blocked':'legacy';
}
function commit(next: AgentChatThreads): void {
  threads = next;
  try {
    if (sessionRequired) {
      const guard=sessionGuard;
      if (!guard || sessionFailed) throw new Error('本机对话编辑权不可用。');
      guard.assertStillHeld();
      if (guard.signal.aborted || window.localStorage.getItem(STORAGE_KEY)!==sessionBefore) throw new Error('对话资料已变化。');
      const json=JSON.stringify(next);
      guard.assertStillHeld();window.localStorage.setItem(STORAGE_KEY,json);guard.assertStillHeld();
      if (window.localStorage.getItem(STORAGE_KEY)!==json) throw new Error('对话保存结果待核对。');
      sessionBefore=json;
    } else window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    if (sessionRequired) { sessionFailed=true;sessionGuard=null; }
  }
  for (const listener of listeners) listener();
}

export function subscribeAgentChat(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getAgentChatThreads(): AgentChatThreads {
  return threads;
}

function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function appendAgentChatMessage(agent: ChatAgent, from: ChatFrom, text: string): AgentChatMessage {
  if (sessionRequired && (!sessionGuard || sessionFailed || threads[agent].length >= LIMIT)) throw new Error('本机对话需要先核对或备份，未丢弃原有消息。');
  const message: AgentChatMessage = { id: newId(), agent, from, text, at: Date.now() };
  commit({ ...threads, [agent]: [...(threads[agent] ?? []), message].slice(-LIMIT) });
  return message;
}

export function clearAgentChatThread(agent: ChatAgent): void {
  if (sessionRequired) throw new Error('当前编辑会话暂不支持删除对话，请先保留和核对原有记录。');
  commit({ ...threads, [agent]: [] });
}

/* ──────────────────────────────────────────────────────────────
 * 第 8 批：生成运行时账本（真步骤时间线 / 运行条 / 空结果回执）
 * ────────────────────────────────────────────────────────────── */

/**
 * 单个工具步骤的一条账本。
 * - toolName：宏工具原生命（list_items / place_item / layBanquet / audit_settle …）。
 * - durationMs：这一步从开工到收尾的墙钟耗时。
 * - isReadonly：只读步（勘察类）灰显；写入步品牌绿左边框带件数。
 * - itemCount：写入步摆了几件；只读步不带。
 * - thought：这一步的自然语言思考摘要（可折叠）。
 * - startedAt：这一步开工的时间戳；用于计算当前步的"已用时"。
 */
export interface AgentStepLogEntry {
  toolName: string;
  durationMs: number;
  isReadonly: boolean;
  itemCount?: number;
  thought?: string;
  startedAt: number;
  /** Local layout steps. Cloud steps leave this unset. */
  outcome?: 'running' | 'done' | 'error';
}

/**
 * 运行时整盘状态。一份账本对应一次生成任务；start/end 之间持续累加。
 * - thoughtCount：头部"N 条思考"用——模型每出一段自述就 +1。
 * - shouldPauseAfterStep：「跑完这步停」一次性 checkpoint，当前步收尾即停。
 * - stopRequested：「停止」优雅停，等当前步在 turn 边界收尾。
 * - steerNotes：用户在运行条输入框塞进来的备注，按顺序注入下一轮上下文。
 * - steerDelivered：云端承认已收到的备注总数（run.steerTotal），单调递增。
 *   它和 steerNotes 是两件事：steerNotes 是「还没送到」的，steerDelivered 是「已经送到、
 *   会在下一轮生效」的。界面上不能把两者混成一个数，否则用户以为写进去了其实没送到。
 * - emptyOutcome：本轮结束既无输出又无布局改动 → 触发空结果回执卡。
 */
export interface AgentRunState {
  isRunning: boolean;
  startedAt: number;
  thoughtCount: number;
  stepLog: AgentStepLogEntry[];
  /** Validated, ordered tool events for this run; no arguments or model text. */
  eventLog: Array<Pick<AgentRunEvent,'seq'|'tool'|'stage'|'outcome'>>;
  shouldPauseAfterStep: boolean;
  stopRequested: boolean;
  steerNotes: string[];
  steerDelivered: number;
  emptyOutcome: boolean;
  /**
   * 这一趟推进到哪一段（四段工作：看现状 / 定落点 / 出方案 / 交付）。
   * 云端的真值，刷新页面重新读档也接得上。拿不到就不显示——阶段是给用户看的
   * 读数，前端自己分段就是编的。
   */
  phase: AgentPhase | null;
  /**
   * 这一轮属于哪张脸。四张脸共用一本账本，不分区的话活动脸的运行过程会
   * 飘到空间/物料脸上——那是别的功能域的事，不该出现在那里。
   */
  scope: AgentRunScope;
}

/** 运行账本的作用域：与四张脸一一对应。 */
export type AgentRunScope = 'layout' | 'space' | 'material';

const IDLE_RUN: AgentRunState = {
  isRunning: false,
  startedAt: 0,
  thoughtCount: 0,
  stepLog: [],
  eventLog: [],
  shouldPauseAfterStep: false,
  stopRequested: false,
  steerNotes: [],
  steerDelivered: 0,
  emptyOutcome: false,
  phase: null,
  scope: 'layout',
};

let run: AgentRunState = { ...IDLE_RUN, stepLog: [], eventLog: [], steerNotes: [] };
const runListeners = new Set<() => void>();

function commitRun(next: AgentRunState): void {
  run = next;
  for (const listener of runListeners) listener();
}

/** 订阅生成运行时账本；返回取消订阅函数。 */
export function subscribeAgentRun(listener: () => void): () => void {
  runListeners.add(listener);
  return () => runListeners.delete(listener);
}

/** 读当前运行时账本（供组件 useSyncExternalStore 或一次性读取）。 */
export function getAgentRun(): AgentRunState {
  return run;
}

/** 开一轮新生成：清掉上一轮的步骤、备注、空结果标记。 */
export function startAgentRun(scope: AgentRunScope = 'layout'): void {
  commitRun({
    ...IDLE_RUN,
    isRunning: true,
    startedAt: Date.now(),
    scope,
    stepLog: [],
    eventLog: [],
    steerNotes: [],
  });
}

export type LocalLayoutKind = 'preview' | 'validate' | 'revise' | 'confirm' | 'applied';

const LOCAL_LAYOUT_STEP: Readonly<Record<LocalLayoutKind, { toolName: string; running: string; done: string }>> = {
  preview: { toolName: 'local_preview', running: '正在试排圆桌…', done: '出预览' },
  validate: { toolName: 'local_validate', running: '正在核对重叠…', done: '已核对重叠' },
  revise: { toolName: 'local_revise', running: '正在修改布置…', done: '已修改' },
  confirm: { toolName: 'local_confirm', running: '确认布置', done: '确认布置' },
  applied: { toolName: 'local_applied', running: '正在写入画布…', done: '已落画布' },
};

/**
 * Local generate / revise / validate / apply. A new preview starts a fresh
 * timeline. Later steps append, so the row stays 出预览 → 确认布置 → 已落画布.
 */
/** Record a selection that already finished, without wiping the preview timeline. */
export function notePriorLayoutTool(toolName: string, thought: string): void {
  if (run.scope !== 'layout') return;
  if (run.stepLog.some(step => step.toolName === toolName)) return;
  commitRun({
    ...run,
    stepLog: [{
      toolName,
      durationMs: 1,
      isReadonly: true,
      startedAt: Date.now(),
      outcome: 'done' as const,
      thought,
    }, ...run.stepLog],
  });
}

export function pushLocalLayoutStep(kind: LocalLayoutKind, outcome: 'running' | 'done' | 'error', note?: string): void {
  const spec = LOCAL_LAYOUT_STEP[kind];
  const now = Date.now();
  if ((kind === 'preview' && outcome === 'running') || run.scope !== 'layout') startAgentRun('layout');
  const current = run;
  const thought = note ?? (outcome === 'running' ? spec.running : spec.done);
  const stepLog = current.stepLog
    .filter(step => step.toolName !== spec.toolName)
    .map(step => step.outcome === 'running'
      ? { ...step, outcome: 'done' as const, durationMs: Math.max(1, now - step.startedAt) }
      : step);
  commitRun({
    ...current,
    isRunning: outcome === 'running',
    stepLog: [...stepLog, {
      toolName: spec.toolName,
      durationMs: outcome === 'running' ? 0 : 1,
      isReadonly: kind !== 'applied',
      startedAt: now,
      outcome,
      thought,
    }],
  });
}

/** Drop the in-memory run. Used when the chat panel goes away. */
export function resetAgentRun(): void {
  commitRun({ ...IDLE_RUN, stepLog: [], eventLog: [], steerNotes: [] });
}

/** Mark the open local step failed without starting a new timeline. */
export function failOpenLocalStep(note: string): void {
  if (run.scope !== 'layout') return;
  const open = [...run.stepLog].reverse().find(step => step.outcome === 'running');
  if (!open) return;
  const kind = (Object.keys(LOCAL_LAYOUT_STEP) as LocalLayoutKind[]).find(key => LOCAL_LAYOUT_STEP[key].toolName === open.toolName);
  if (!kind) return;
  pushLocalLayoutStep(kind, 'error', note);
}

/** Stop the clock but keep the local steps so the collapsed trace stays. */
export function finishLocalLayoutRun(): void {
  if (run.scope !== 'layout') return;
  const now = Date.now();
  commitRun({
    ...run,
    isRunning: false,
    shouldPauseAfterStep: false,
    stopRequested: false,
    stepLog: run.stepLog.map(step => step.outcome === 'running'
      ? { ...step, outcome: 'done' as const, durationMs: Math.max(1, now - step.startedAt) }
      : step),
  });
}

/** 生成收尾。emptyOutcome=true 时由组件出空结果回执卡，不允许沉默结束。 */
export function endAgentRun(options?: { emptyOutcome?: boolean }): void {
  commitRun({
    ...run,
    isRunning: false,
    shouldPauseAfterStep: false,
    stopRequested: false,
    emptyOutcome: options?.emptyOutcome ?? false,
  });
}

/**
 * 每完成一步 push 一条。durationMs 由调用方量好；startedAt 用来让当前步在还没收尾时
 * 也能渲染"进行中"那一格（durationMs 传 0 表示这步还在跑）。
 */
export function appendAgentStep(entry: AgentStepLogEntry): void {
  commitRun({ ...run, stepLog: [...run.stepLog, entry] });
}

/** Caller fences the run before and after reading; duplicate/old events are ignored. */
export function appendAgentRunEvents(events:readonly AgentRunEvent[]):void {
  let last=run.eventLog.at(-1)?.seq??0;
  const next=[...run.eventLog];
  for(const event of events){
    if(event.seq<=last)continue;
    next.push({seq:event.seq,tool:event.tool,stage:event.stage,outcome:event.outcome});last=event.seq;
  }
  if(next.length!==run.eventLog.length)commitRun({...run,eventLog:next});
}

/** 模型每出一段自述思考 +1，用来驱动头部"N 条思考"。 */
export function bumpAgentThought(count = 1): void {
  commitRun({ ...run, thoughtCount: run.thoughtCount + Math.max(1, count) });
}

/**
 * 直接把思考条数设成某个值（云端给的是绝对值，不是增量）。
 *
 * 云端 AgentRun.call_count 是本轮真实模型调用次数（0–6 轮，上限由
 * AGENT_CALL_LIMIT 守着）。它是权威读数，前端不用自己数——数出来的永远
 * 是猜的。设成绝对值也避免了「+1 计数」在轮询重复时越加越多。
 */
export function setAgentThoughtCount(count: number): void {
  const next = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  if (next === run.thoughtCount) return;
  commitRun({ ...run, thoughtCount: next });
}

/**
 * 写当前阶段（云端给的真值）。
 *
 * 阶段只前进不后退是服务端那条链路的保证（advancePhase），前端这里照单全收，
 * 不自己推进——否则刷新一次界面就会退回上一段，看着像进度倒流。
 * 传 null 表示这趟没有阶段读数（老记录、本机规则模式），界面就不显示阶段。
 */
export function setAgentPhase(phase: AgentPhase | null): void {
  if (phase === run.phase) return;
  commitRun({ ...run, phase });
}

/**
 * 收尾当前那一步：把「这一步从开工到收尾」的墙钟耗时写回账本。
 *
 * 步骤是按「进度句变了」记的，所以一步的耗时在**下一步开始时**才知道。
 * durationMs 传 0 表示这一步还在跑（UI 会用当前时刻减 startedAt 实时显示）。
 */
export function closeAgentStep(durationMs: number): void {
  if (!run.stepLog.length) return;
  const stepLog = run.stepLog.slice();
  const last = stepLog[stepLog.length - 1]!;
  stepLog[stepLog.length - 1] = { ...last, durationMs: Math.max(0, Math.round(durationMs)) };
  commitRun({ ...run, stepLog });
}

/** 「跑完这步停」：一次性 checkpoint，当前步跑完即停。 */
export function setAgentPauseAfterStep(value: boolean): void {
  commitRun({ ...run, shouldPauseAfterStep: value });
}

/** 「停止」：优雅停，等当前步在 turn 边界收尾（不硬切）。 */
export function requestAgentStop(): void {
  commitRun({ ...run, stopRequested: true });
}

/** 运行条里塞进来的备注，按顺序进下一轮 agent 上下文。 */
export function pushAgentSteerNote(text: string): void {
  const trimmed = text.trim();
  if (!trimmed) return;
  commitRun({ ...run, steerNotes: [...run.steerNotes, trimmed] });
}

/** 读完 steerNotes 后由调用方清空（避免同一备注被反复注入）。 */
export function clearAgentSteerNotes(): void {
  commitRun({ ...run, steerNotes: [] });
}

/**
 * 把「云端一共收到几条改道备注」写进账本。
 *
 * 这个数是服务端的绝对读数（run.steerTotal），不是前端自己加出来的——备注送没送到
 * 只有服务端知道。轮询会重复读到同一个值，所以设成绝对值才不会越滚越大。
 */
export function setAgentSteerDelivered(count: number): void {
  const next = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  if (next === run.steerDelivered) return;
  commitRun({ ...run, steerDelivered: next });
}

/** 空结果回执卡由人/主代理点掉时清掉标记。 */
export function dismissAgentEmptyReceipt(): void {
  if (!run.emptyOutcome) return;
  commitRun({ ...run, emptyOutcome: false });
}

/**
 * 中文工具名映射。
 * 勘察类（list_items / query_region / get_map）→「查看场地」
 * 写入类（place_item / apply_layout / layBanquet / buildStage / arrangeSeating / scatterDecor）→「摆放物件」
 * 规划类（set_annotation / update_plan）→「标注规划」
 * 体检类（audit_settle）→「巡场体检」
 */
export function chineseToolLabel(toolName: string): string {
  const name = toolName.toLowerCase();
  if (['list_items', 'query_region', 'get_map'].includes(name)) return '查看场地';
  if (['place_item', 'apply_layout', 'laybanquet', 'buildstage', 'arrangeseating', 'scatterdecor'].includes(name)) return '摆放物件';
  if (['set_annotation', 'update_plan'].includes(name)) return '标注规划';
  if (['audit_settle'].includes(name)) return '巡场体检';
  return toolName;
}

/** 判断一个工具名是不是写入类（用于品牌绿左边框 + 件数）。 */
export function isWriteTool(toolName: string): boolean {
  const name = toolName.toLowerCase();
  return ['place_item', 'apply_layout', 'laybanquet', 'buildstage', 'arrangeseating', 'scatterdecor', 'set_annotation', 'update_plan'].includes(name);
}

/**
 * 把毫秒格式成 mm:ss（头部"已用时"和单步"耗时"共用）。
 * 秒数不足两位补零；超过 1 小时也只按 mm:ss 显示（mm 可以 > 59）。
 */
export function formatDurationClock(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * UI 验证用：种子几条假步骤并开一轮运行。不接任何真实管线。
 * 由主代理在真机走查时显式调用；不上线、不自动触发。
 */
export function __demoStartMockRun(): void {
  const now = Date.now();
  commitRun({
    ...IDLE_RUN,
    isRunning: true,
    startedAt: now - 15000,
    thoughtCount: 3,
    stepLog: [
      { toolName: 'list_items', durationMs: 1200, isReadonly: true, startedAt: now - 15000, thought: '先把场地上已有的物件盘一遍，看看哪些能留、哪些要挪。' },
      { toolName: 'query_region', durationMs: 800, isReadonly: true, startedAt: now - 13800, thought: '量一下主舞台和观众席之间的间距，按 80 人发布会估一下桌位。' },
      { toolName: 'layBanquet', durationMs: 6000, isReadonly: false, itemCount: 3, startedAt: now - 13000, thought: '主区摆 3 桌圆桌，每桌 8 人，留出主通道 1.8 米。' },
    ],
    steerNotes: [],
  });
}
