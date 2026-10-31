/**
 * 晴光「方案会话」索引：一场对话 / 一套方案的标题、收藏和时间。
 *
 * 这不是画布撤销。布局 undo 走 `hooks/use-history.ts`；本地若另有
 * `use-layout-history`，那是画布 undo 分轨，禁止改名占用，也禁止从这里调用。
 * 本索引只写自己的 localStorage 键，不进 layout reducer，不进撤销栈。
 */

import { safeGetItem, safeSetItem } from './safe-storage';

export const ASSISTANT_SESSIONS_STORAGE_KEY = 'scendance.assistant-sessions.v1';
export const ASSISTANT_SESSIONS_VERSION = 1;
export const ASSISTANT_SESSION_TITLE_MAX = 80;
export const ASSISTANT_SESSIONS_MAX = 40;
export const ASSISTANT_SESSION_DEFAULT_TITLE = '新会话';

export interface AssistantSession {
  readonly id: string;
  readonly title: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly favorite: boolean;
}

export interface AssistantSessionIndex {
  readonly version: typeof ASSISTANT_SESSIONS_VERSION;
  readonly activeId: string | null;
  readonly sessions: readonly AssistantSession[];
}

export function emptyAssistantSessionIndex(): AssistantSessionIndex {
  return { version: ASSISTANT_SESSIONS_VERSION, activeId: null, sessions: [] };
}

export function clampAssistantSessionTitle(title: string): string {
  const chars = Array.from(title.trim());
  if (chars.length === 0) return '';
  if (chars.length <= ASSISTANT_SESSION_TITLE_MAX) return chars.join('');
  return chars.slice(0, ASSISTANT_SESSION_TITLE_MAX).join('');
}

export function createAssistantSessionId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return `ses-${uuid}`;
  return `ses-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function sortAssistantSessions(sessions: readonly AssistantSession[]): AssistantSession[] {
  return [...sessions].sort((a, b) => {
    if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
    if (a.updatedAt !== b.updatedAt) return b.updatedAt - a.updatedAt;
    if (a.createdAt !== b.createdAt) return b.createdAt - a.createdAt;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

export function filterAssistantSessions(sessions: readonly AssistantSession[], query: string): AssistantSession[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [...sessions];
  return sessions.filter(item => item.title.toLocaleLowerCase().includes(needle));
}

/** 今天只显示时刻，跨日显示月日。给列表副文案用，不参与存储。 */
export function formatAssistantSessionStamp(updatedAt: number, now = Date.now()): string {
  if (!Number.isFinite(updatedAt)) return '';
  const then = new Date(updatedAt);
  const today = new Date(now);
  const sameDay = then.getFullYear() === today.getFullYear()
    && then.getMonth() === today.getMonth()
    && then.getDate() === today.getDate();
  if (sameDay) {
    const hh = String(then.getHours()).padStart(2, '0');
    const mm = String(then.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  }
  return `${then.getMonth() + 1}月${then.getDate()}日`;
}

export function openAssistantSession(
  index: AssistantSessionIndex,
  input: { id: string; now: number; title?: string },
): AssistantSessionIndex {
  const title = clampAssistantSessionTitle(input.title ?? ASSISTANT_SESSION_DEFAULT_TITLE) || ASSISTANT_SESSION_DEFAULT_TITLE;
  const session: AssistantSession = {
    id: input.id,
    title,
    createdAt: input.now,
    updatedAt: input.now,
    favorite: false,
  };
  const sessions = limitSessions(
    [session, ...index.sessions.filter(item => item.id !== input.id)],
    input.id,
  );
  return { version: ASSISTANT_SESSIONS_VERSION, activeId: input.id, sessions };
}

export function seedAssistantSessionIndex(now: number, id: string): AssistantSessionIndex {
  return openAssistantSession(emptyAssistantSessionIndex(), { id, now });
}

export function selectAssistantSession(index: AssistantSessionIndex, id: string, now: number): AssistantSessionIndex {
  const current = index.sessions.find(item => item.id === id);
  if (!current || index.activeId === id) return index;
  return {
    version: ASSISTANT_SESSIONS_VERSION,
    activeId: id,
    sessions: index.sessions.map(item => item.id === id ? { ...item, updatedAt: now } : item),
  };
}

export function renameAssistantSession(
  index: AssistantSessionIndex,
  id: string,
  title: string,
  now: number,
): AssistantSessionIndex {
  const nextTitle = clampAssistantSessionTitle(title);
  const current = index.sessions.find(item => item.id === id);
  if (!current || !nextTitle || current.title === nextTitle) return index;
  return {
    version: ASSISTANT_SESSIONS_VERSION,
    activeId: index.activeId,
    sessions: index.sessions.map(item => item.id === id ? { ...item, title: nextTitle, updatedAt: now } : item),
  };
}

export function toggleAssistantSessionFavorite(index: AssistantSessionIndex, id: string): AssistantSessionIndex {
  const current = index.sessions.find(item => item.id === id);
  if (!current) return index;
  return {
    version: ASSISTANT_SESSIONS_VERSION,
    activeId: index.activeId,
    sessions: index.sessions.map(item => item.id === id ? { ...item, favorite: !item.favorite } : item),
  };
}

export function deleteAssistantSession(index: AssistantSessionIndex, id: string): AssistantSessionIndex {
  if (!index.sessions.some(item => item.id === id)) return index;
  const sessions = index.sessions.filter(item => item.id !== id);
  const activeId = index.activeId === id ? (sortAssistantSessions(sessions)[0]?.id ?? null) : index.activeId;
  return { version: ASSISTANT_SESSIONS_VERSION, activeId, sessions };
}

export function parseAssistantSessionIndex(raw: string): AssistantSessionIndex | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (record.version !== ASSISTANT_SESSIONS_VERSION || !Array.isArray(record.sessions)) return null;
  const sessions: AssistantSession[] = [];
  const seen = new Set<string>();
  for (const row of record.sessions) {
    const session = parseSession(row);
    if (!session || seen.has(session.id)) continue;
    seen.add(session.id);
    sessions.push(session);
  }
  const requested = typeof record.activeId === 'string' && seen.has(record.activeId) ? record.activeId : null;
  const limited = limitSessions(sessions, requested);
  const activeId = requested && limited.some(item => item.id === requested) ? requested : null;
  return { version: ASSISTANT_SESSIONS_VERSION, activeId, sessions: limited };
}

/** 键不存在或内容无法解析时返回 null，调用方再决定要不要种一条「新会话」。 */
export function readAssistantSessionIndex(storage?: Storage): AssistantSessionIndex | null {
  const raw = storage === undefined
    ? safeGetItem(ASSISTANT_SESSIONS_STORAGE_KEY)
    : safeGetItem(ASSISTANT_SESSIONS_STORAGE_KEY, storage);
  if (raw == null) return null;
  return parseAssistantSessionIndex(raw);
}

export function writeAssistantSessionIndex(index: AssistantSessionIndex, storage?: Storage): boolean {
  const payload = JSON.stringify({
    version: index.version,
    activeId: index.activeId,
    sessions: index.sessions,
  });
  return storage === undefined
    ? safeSetItem(ASSISTANT_SESSIONS_STORAGE_KEY, payload)
    : safeSetItem(ASSISTANT_SESSIONS_STORAGE_KEY, payload, storage);
}

function parseSession(row: unknown): AssistantSession | null {
  if (!row || typeof row !== 'object') return null;
  const record = row as Record<string, unknown>;
  if (typeof record.id !== 'string' || typeof record.title !== 'string') return null;
  const id = record.id.trim();
  if (!id || id.length > 96 || /\s/.test(id)) return null;
  const title = clampAssistantSessionTitle(record.title);
  if (!title) return null;
  if (typeof record.createdAt !== 'number' || !Number.isFinite(record.createdAt)) return null;
  if (typeof record.updatedAt !== 'number' || !Number.isFinite(record.updatedAt)) return null;
  if (typeof record.favorite !== 'boolean') return null;
  return { id, title, createdAt: record.createdAt, updatedAt: record.updatedAt, favorite: record.favorite };
}

function limitSessions(sessions: readonly AssistantSession[], activeId: string | null): AssistantSession[] {
  if (sessions.length <= ASSISTANT_SESSIONS_MAX) return [...sessions];
  const ranked = sortAssistantSessions(sessions);
  const kept = new Set(ranked.slice(0, ASSISTANT_SESSIONS_MAX).map(item => item.id));
  if (activeId && !kept.has(activeId) && sessions.some(item => item.id === activeId)) {
    const overflow = ranked[ASSISTANT_SESSIONS_MAX - 1];
    if (overflow) kept.delete(overflow.id);
    kept.add(activeId);
  }
  return sessions.filter(item => kept.has(item.id));
}
