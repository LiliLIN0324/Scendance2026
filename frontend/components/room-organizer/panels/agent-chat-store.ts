'use client';

/**
 * 左轨四个 agent 的对话记录。
 *
 * 为什么放在本机：总控/空间/物料这三条线都还没有自己的后端会话，先把对话记在本机
 * （localStorage，按 agent 分线），Bingo 那条真实的布置对话仍走 AgentPanel 自己的
 * agent.bubbles，不走这里。等后刀接上真接口，只需要把 appendMessage 换成服务端调用。
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

/** 总控要的是「全局」：四条线按时间排在一起。 */
export function globalAgentChatFeed(all: AgentChatThreads): AgentChatMessage[] {
  return [...all.door, ...all.bingo, ...all.space, ...all.material].sort((left, right) => left.at - right.at);
}