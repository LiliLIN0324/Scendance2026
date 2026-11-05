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
 */

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

function commit(next: AgentChatThreads): void {
  threads = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* 无痕模式或配额满：对话留在内存里，不影响用。 */
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
  const message: AgentChatMessage = { id: newId(), agent, from, text, at: Date.now() };
  commit({ ...threads, [agent]: [...(threads[agent] ?? []), message].slice(-LIMIT) });
  return message;
}

export function clearAgentChatThread(agent: ChatAgent): void {
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
  shouldPauseAfterStep: boolean;
  stopRequested: boolean;
  steerNotes: string[];
  steerDelivered: number;
  emptyOutcome: boolean;
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
  shouldPauseAfterStep: false,
  stopRequested: false,
  steerNotes: [],
  emptyOutcome: false,
  scope: 'layout',
};

let run: AgentRunState = { ...IDLE_RUN, stepLog: [], steerNotes: [] };
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
    steerNotes: [],
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
