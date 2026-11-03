/**
 * Bingo 方案会话的气泡正文：按 sessionId 分袋，与标题索引分键存放。
 * 不进 layout reducer / 画布撤销栈。气泡上的 action 回调不可序列化，落盘时丢掉。
 */

import { safeGetItem, safeSetItem } from './safe-storage';

export const ASSISTANT_SESSION_BODIES_STORAGE_KEY = 'scendance.assistant-session-bodies.v1';
export const ASSISTANT_SESSION_BODIES_VERSION = 1;
/** 单场会话最多留这么多条，与对话区 slice(-30) 对齐。 */
export const ASSISTANT_SESSION_BODY_BUBBLE_MAX = 30;

const AGENT_IDS = new Set(['door', 'bingo', 'space', 'material']);

export type StoredAssistantBubble = {
  readonly id: string;
  readonly role: 'user' | 'agent';
  readonly text: string;
  readonly meta?: string;
  readonly warn?: string;
  readonly amber?: boolean;
  readonly to?: readonly ('door' | 'bingo' | 'space' | 'material')[];
  readonly long?: boolean;
  readonly image?: string;
};

export type AssistantSessionBodies = {
  readonly version: typeof ASSISTANT_SESSION_BODIES_VERSION;
  readonly byId: Readonly<Record<string, readonly StoredAssistantBubble[]>>;
};

export function emptyAssistantSessionBodies(): AssistantSessionBodies {
  return { version: ASSISTANT_SESSION_BODIES_VERSION, byId: {} };
}

export function readSessionBubbles(
  bodies: AssistantSessionBodies,
  sessionId: string,
): readonly StoredAssistantBubble[] {
  return bodies.byId[sessionId] ?? [];
}

export function writeSessionBubbles(
  bodies: AssistantSessionBodies,
  sessionId: string,
  bubbles: readonly StoredAssistantBubble[],
): AssistantSessionBodies {
  const id = sessionId.trim();
  if (!id) return bodies;
  const clipped = bubbles.slice(-ASSISTANT_SESSION_BODY_BUBBLE_MAX).map(normalizeStoredBubble).filter((row): row is StoredAssistantBubble => row !== null);
  if (clipped.length === 0) {
    if (!(id in bodies.byId)) return bodies;
    const { [id]: _removed, ...rest } = bodies.byId;
    return { version: ASSISTANT_SESSION_BODIES_VERSION, byId: rest };
  }
  return {
    version: ASSISTANT_SESSION_BODIES_VERSION,
    byId: { ...bodies.byId, [id]: clipped },
  };
}

export function deleteSessionBubbles(bodies: AssistantSessionBodies, sessionId: string): AssistantSessionBodies {
  if (!(sessionId in bodies.byId)) return bodies;
  const { [sessionId]: _removed, ...rest } = bodies.byId;
  return { version: ASSISTANT_SESSION_BODIES_VERSION, byId: rest };
}

/** 索引裁掉的场次，正文也一并丢掉，避免孤儿袋堆满本机。 */
export function pruneSessionBodies(
  bodies: AssistantSessionBodies,
  keepIds: ReadonlySet<string> | readonly string[],
): AssistantSessionBodies {
  const keep = keepIds instanceof Set ? keepIds : new Set(keepIds);
  let changed = false;
  const next: Record<string, readonly StoredAssistantBubble[]> = {};
  for (const [id, bubbles] of Object.entries(bodies.byId)) {
    if (!keep.has(id)) {
      changed = true;
      continue;
    }
    next[id] = bubbles;
  }
  return changed ? { version: ASSISTANT_SESSION_BODIES_VERSION, byId: next } : bodies;
}

export function parseAssistantSessionBodies(raw: string): AssistantSessionBodies | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (record.version !== ASSISTANT_SESSION_BODIES_VERSION || !record.byId || typeof record.byId !== 'object') return null;
  const byId: Record<string, StoredAssistantBubble[]> = {};
  for (const [id, rows] of Object.entries(record.byId as Record<string, unknown>)) {
    if (!id.trim() || !Array.isArray(rows)) continue;
    const bubbles = rows.map(normalizeStoredBubble).filter((row): row is StoredAssistantBubble => row !== null);
    if (bubbles.length) byId[id] = bubbles.slice(-ASSISTANT_SESSION_BODY_BUBBLE_MAX);
  }
  return { version: ASSISTANT_SESSION_BODIES_VERSION, byId };
}

export function readAssistantSessionBodies(storage?: Storage): AssistantSessionBodies {
  const raw = storage === undefined
    ? safeGetItem(ASSISTANT_SESSION_BODIES_STORAGE_KEY)
    : safeGetItem(ASSISTANT_SESSION_BODIES_STORAGE_KEY, storage);
  if (raw == null) return emptyAssistantSessionBodies();
  return parseAssistantSessionBodies(raw) ?? emptyAssistantSessionBodies();
}

export function writeAssistantSessionBodies(bodies: AssistantSessionBodies, storage?: Storage): boolean {
  const payload = JSON.stringify({ version: bodies.version, byId: bodies.byId });
  return storage === undefined
    ? safeSetItem(ASSISTANT_SESSION_BODIES_STORAGE_KEY, payload)
    : safeSetItem(ASSISTANT_SESSION_BODIES_STORAGE_KEY, payload, storage);
}

function normalizeStoredBubble(row: unknown): StoredAssistantBubble | null {
  if (!row || typeof row !== 'object') return null;
  const record = row as Record<string, unknown>;
  if (typeof record.id !== 'string' || !record.id.trim()) return null;
  if (record.role !== 'user' && record.role !== 'agent') return null;
  if (typeof record.text !== 'string') return null;
  const bubble = {
    id: record.id,
    role: record.role,
    text: record.text,
    ...(typeof record.meta === 'string' ? { meta: record.meta } : {}),
    ...(typeof record.warn === 'string' ? { warn: record.warn } : {}),
    ...(record.amber === true ? { amber: true } : {}),
    ...(record.long === true ? { long: true } : {}),
    ...(typeof record.image === 'string' ? { image: record.image } : {}),
  } satisfies StoredAssistantBubble;
  if (Array.isArray(record.to)) {
    const to = record.to.filter((item): item is 'door' | 'bingo' | 'space' | 'material' => (
      typeof item === 'string' && AGENT_IDS.has(item)
    ));
    if (to.length) return { ...bubble, to };
  }
  return bubble;
}
