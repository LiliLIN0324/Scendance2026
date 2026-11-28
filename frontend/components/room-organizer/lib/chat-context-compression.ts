import { safeGetItem, safeSetItem } from './safe-storage';

export type ContextMessage = {
  role: 'user' | 'assistant' | 'tool';
  text: string;
  toolCallId?: string;
  toolResult?: boolean;
};

export type ChatCompressionOptions = {
  thresholdTokens?: number;
  recentMessages?: number;
  storage?: Storage;
  storageKey?: string;
};

export type CompressedChatContext = {
  history: Array<{ role: 'user' | 'assistant'; text: string }>;
  memo: string;
  compressed: boolean;
};

const DEFAULT_THRESHOLD = 2000;
const DEFAULT_RECENT = 4;
const DEFAULT_KEY = 'scendance.assistant-chat-context.v1';

function tokens(text: string): number { return Math.ceil(text.length / 4); }
function clean(text: string): string { return text.replace(/\s+/g, ' ').trim(); }
function memoLines(messages: ContextMessage[]): string[] {
  const result: string[] = [];
  const labels: Array<[RegExp, string]> = [
    [/活动|会议|婚礼|培训|发布会|演练/, '活动环节'],
    [/姓名|联系人|主持人|负责人/, '姓名'],
    [/\d+\s*人|人数|宾客|嘉宾/, '人数'],
    [/\d+(?:\.\d+)?\s*[×x*]\s*\d+|尺寸|米|场地/, '场地尺寸'],
    [/必须|不能|不要|限制|要求|禁止/, '用户限制'],
    [/待办|未完成|还差|需要核对|待确认/, '未完成事项'],
    [/确认|决定|采用|保留|确定/, '已确认决定'],
    [/假设|按.*估|暂定|预计/, '规划假设'],
    [/任务|进行中|已完成|失败|排队/, '相关任务状态'],
  ];
  for (const message of messages) {
    const text = clean(message.text);
    if (!text) continue;
    const matched = labels.find(([pattern]) => pattern.test(text));
    if (matched) result.push(`${matched[1]}：${text.slice(0, 280)}`);
  }
  if (result.length === 0) {
    for (const message of messages.slice(-8)) {
      const text = clean(message.text);
      if (text) result.push(`${message.role === 'user' ? '用户' : 'Agent'}：${text.slice(0, 280)}`);
    }
  }
  return [...new Set(result)].slice(-24);
}

function pairTools(messages: ContextMessage[]): ContextMessage[] {
  const output: ContextMessage[] = [];
  const pending = new Map<string, ContextMessage>();
  for (const message of messages) {
    if (message.role !== 'tool' || !message.toolCallId) { output.push(message); continue; }
    if (!message.toolResult) { pending.set(message.toolCallId, message); continue; }
    const call = pending.get(message.toolCallId);
    if (call) { output.push(call, message); pending.delete(message.toolCallId); }
    else output.push(message);
  }
  for (const call of pending.values()) output.push(call);
  return output;
}

/** tool 消息只服务本引擎，不进模型 history；filter 后把 role 收窄到对话两态。 */
function isChatRole(message: ContextMessage): message is ContextMessage & { role: 'user' | 'assistant' } {
  return message.role !== 'tool';
}

function readMemo(storage: Storage | undefined, key: string): string {
  if (!storage) return '';
  try { return safeGetItem(key, storage) ?? ''; } catch { return ''; }
}

export function compressChatContext(messages: readonly ContextMessage[], currentMessage: string, options: ChatCompressionOptions = {}): CompressedChatContext {
  const threshold = options.thresholdTokens ?? DEFAULT_THRESHOLD;
  const recent = Math.max(1, options.recentMessages ?? DEFAULT_RECENT);
  const key = options.storageKey ?? DEFAULT_KEY;
  const storedMemo = readMemo(options.storage, key);
  const grouped = pairTools([...messages]);
  const eligible = grouped.filter(message => message.role !== 'tool' || message.toolCallId);
  const total = tokens(eligible.map(message => message.text).join('\n') + currentMessage);
  if (total <= threshold && !storedMemo) {
    return { history: eligible.filter(isChatRole).map(message => ({ role: message.role, text: message.text })), memo: '', compressed: false };
  }
  const split = Math.max(0, eligible.length - recent);
  const old = eligible.slice(0, split);
  const tail = eligible.slice(split);
  const additions = memoLines(old);
  const merged = [...storedMemo.split('\n').filter(Boolean), ...additions];
  const memo = [...new Set(merged)].slice(-32).join('\n');
  if (options.storage) safeSetItem(key, memo, options.storage);
  return {
    memo,
    compressed: old.length > 0,
    history: [
      ...(memo ? [{ role: 'assistant' as const, text: `[对话备忘录]\n${memo}` }] : []),
      ...tail.filter(isChatRole).map(message => ({ role: message.role, text: message.text })),
    ],
  };
}

export const CHAT_COMPRESSION_DEFAULTS = { thresholdTokens: DEFAULT_THRESHOLD, recentMessages: DEFAULT_RECENT } as const;
