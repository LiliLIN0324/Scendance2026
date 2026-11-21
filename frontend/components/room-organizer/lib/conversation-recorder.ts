/**
 * 对话留痕：把「本机就能答完」的轮次也补记到服务端。
 *
 * 模型问答、Agent 运行由后端在各自入口直接写库；这里只负责两类没有后端请求的轮次：
 * 本地规则作答、本地命令。写入一律 best-effort：先入本机队列，失败保留，下次发送时重试。
 * 网络或服务端故障永远不能阻塞对话。
 */
export type ConversationSurface = 'brief' | 'assistant' | 'agent' | 'activity' | 'local_command';
export type ConversationOutcome = 'answered' | 'preview' | 'applied' | 'failed' | 'local_only' | 'queued';

export interface ConversationTurnPayload {
  turnKey: string;
  sessionId: string;
  turnIndex: number;
  surface: ConversationSurface;
  userText: string;
  assistantText?: string;
  outcome: ConversationOutcome;
  errorCode?: string;
  latencyMs?: number;
  /** 云端项目 id：只在活动已挂到云项目时带上；本地活动不传，由服务端留空。 */
  projectId?: string;
}

export interface ConversationTraceTransport {
  recordConversationTurns?(turns: ConversationTurnPayload[]): Promise<unknown>;
}

const OUTBOX_KEY = 'scendance:conversation-outbox:v1';
const MAX_QUEUED = 50;
let flushing = false;

export function conversationTurnKey(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, char => {
      const value = (Math.random() * 16) | 0;
      return (char === 'x' ? value : (value & 0x3) | 0x8).toString(16);
    });
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** trace 契约是 strictObject：projectId 只收真 uuid；本地活动的 scope 字符串一律不留。 */
export function conversationProjectId(value: unknown): string | undefined {
  return typeof value === 'string' && UUID_RE.test(value) ? value : undefined;
}

function readQueue(): ConversationTurnPayload[] {
  try {
    const raw = window.localStorage.getItem(OUTBOX_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is ConversationTurnPayload => !!item && typeof item === 'object' && typeof (item as ConversationTurnPayload).turnKey === 'string');
  } catch {
    return [];
  }
}

function writeQueue(turns: ConversationTurnPayload[]) {
  try {
    window.localStorage.setItem(OUTBOX_KEY, JSON.stringify(turns.slice(-MAX_QUEUED)));
  } catch {
    /* 存储不可用时不重试，直接放弃这一轮，不阻塞对话 */
  }
}

async function flush(transport: ConversationTraceTransport) {
  if (flushing || !transport.recordConversationTurns) return;
  const queued = readQueue();
  if (!queued.length) return;
  flushing = true;
  try {
    await transport.recordConversationTurns(queued);
    writeQueue(readQueue().filter(item => !queued.some(sent => sent.turnKey === item.turnKey)));
  } catch {
    /* 保留队列，等下一次对话再试 */
  } finally {
    flushing = false;
  }
}

/** 记一轮本机完成的对话；sessionId 缺失时也要留下记录，用 unknown 占位。 */
export function recordConversationTurn(transport: ConversationTraceTransport | null | undefined, turn: Omit<ConversationTurnPayload, 'sessionId'> & { sessionId?: string | null }) {
  if (!transport?.recordConversationTurns) return;
  const payload: ConversationTurnPayload = { ...turn, sessionId: turn.sessionId?.trim() || 'unknown' };
  const queue: ConversationTurnPayload[] = [...readQueue().filter(item => item.turnKey !== payload.turnKey), payload];
  writeQueue(queue);
  void flush(transport);
}
