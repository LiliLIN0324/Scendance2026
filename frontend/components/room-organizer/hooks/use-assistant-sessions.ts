'use client';

import { useCallback, useSyncExternalStore } from 'react';
import {
  deleteSessionBubbles,
  emptyAssistantSessionBodies,
  pruneSessionBodies,
  readAssistantSessionBodies,
  writeAssistantSessionBodies,
  type AssistantSessionBodies,
} from '../lib/assistant-session-bodies';
import {
  createAssistantSessionId,
  deleteAssistantSession,
  emptyAssistantSessionIndex,
  filterAssistantSessions,
  openAssistantSession,
  readAssistantSessionIndex,
  renameAssistantSession,
  seedAssistantSessionIndex,
  selectAssistantSession,
  sortAssistantSessions,
  toggleAssistantSessionFavorite,
  touchAssistantSession,
  writeAssistantSessionIndex,
  type AssistantSession,
  type AssistantSessionIndex,
} from '../lib/assistant-sessions';

export interface AssistantSessionsController {
  ready: boolean;
  saveFailed: boolean;
  /** 当前选中的会话；不受搜索过滤影响。 */
  activeSession: AssistantSession | null;
  /** 已按收藏优先、最近更新排序，并套上搜索。 */
  visible: readonly AssistantSession[];
  totalCount: number;
  activeId: string | null;
  query: string;
  setQuery(value: string): void;
  openSession(): void;
  selectSession(id: string): void;
  renameSession(id: string, title: string): void;
  toggleFavorite(id: string): void;
  deleteSession(id: string): void;
  /** 当前场有新气泡时抬一下 updatedAt，列表会往上排。 */
  touchActiveSession(): void;
}

type Snapshot = {
  ready: boolean;
  saveFailed: boolean;
  index: AssistantSessionIndex | null;
  query: string;
};

/**
 * 方案会话索引的本机读写（模块级单例，左栏与历史浮层共享同一份）。
 * 不订阅布局撤销：`use-history` / `use-layout-history` 仍只服务画布 undo。
 * 气泡正文另键存放，删/裁索引时顺带清孤儿袋。
 */
let snapshot: Snapshot = { ready: false, saveFailed: false, index: null, query: '' };
let bodies: AssistantSessionBodies = emptyAssistantSessionBodies();
const listeners = new Set<() => void>();
let bootstrapped = false;

function emit(): void {
  for (const listener of listeners) listener();
}

function replaceSnapshot(next: Snapshot): void {
  snapshot = next;
  emit();
}

function persistIndex(index: AssistantSessionIndex): boolean {
  const ok = writeAssistantSessionIndex(index);
  const keep = new Set(index.sessions.map(item => item.id));
  const pruned = pruneSessionBodies(bodies, keep);
  if (pruned !== bodies) {
    bodies = pruned;
    writeAssistantSessionBodies(bodies);
  }
  return ok;
}

function commitIndex(index: AssistantSessionIndex, query = snapshot.query): void {
  replaceSnapshot({
    ready: true,
    saveFailed: !persistIndex(index),
    index,
    query,
  });
}

function ensureBootstrapped(): void {
  if (bootstrapped || typeof window === 'undefined') return;
  bootstrapped = true;
  bodies = readAssistantSessionBodies();
  const stored = readAssistantSessionIndex();
  if (stored) {
    const pruned = pruneSessionBodies(bodies, stored.sessions.map(item => item.id));
    if (pruned !== bodies) {
      bodies = pruned;
      writeAssistantSessionBodies(bodies);
    }
    snapshot = { ready: true, saveFailed: false, index: stored, query: '' };
    return;
  }
  const seeded = seedAssistantSessionIndex(Date.now(), createAssistantSessionId());
  snapshot = {
    ready: true,
    saveFailed: !writeAssistantSessionIndex(seeded),
    index: seeded,
    query: '',
  };
}

function subscribe(listener: () => void): () => void {
  ensureBootstrapped();
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function getSnapshot(): Snapshot {
  ensureBootstrapped();
  return snapshot;
}

function getServerSnapshot(): Snapshot {
  return { ready: false, saveFailed: false, index: null, query: '' };
}

/** 测试用：清掉单例，下一次订阅会重新从 storage 引导。 */
export function resetAssistantSessionsStoreForTests(): void {
  snapshot = { ready: false, saveFailed: false, index: null, query: '' };
  bodies = emptyAssistantSessionBodies();
  bootstrapped = false;
  listeners.clear();
}

/** 给 LayoutAgentProvider 读/写当前场气泡正文（与 hook 同份 bodies）。 */
export function getAssistantSessionBodies(): AssistantSessionBodies {
  ensureBootstrapped();
  return bodies;
}

export function replaceAssistantSessionBodies(next: AssistantSessionBodies): boolean {
  ensureBootstrapped();
  bodies = next;
  return writeAssistantSessionBodies(bodies);
}

/** 切场落盘前确认旧场还在索引里，避免删除后把正文又写回去。 */
export function assistantSessionExists(id: string): boolean {
  ensureBootstrapped();
  return !!snapshot.index?.sessions.some(item => item.id === id);
}

export function useAssistantSessions(): AssistantSessionsController {
  const current = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setQuery = useCallback((value: string) => {
    if (snapshot.query === value) return;
    replaceSnapshot({ ...snapshot, query: value });
  }, []);

  const openSession = useCallback(() => {
    const index = snapshot.index ?? emptyAssistantSessionIndex();
    commitIndex(openAssistantSession(index, { id: createAssistantSessionId(), now: Date.now() }), '');
  }, []);

  const selectSession = useCallback((id: string) => {
    const index = snapshot.index;
    if (!index) return;
    const next = selectAssistantSession(index, id, Date.now());
    if (next !== index) commitIndex(next);
  }, []);

  const renameSession = useCallback((id: string, title: string) => {
    const index = snapshot.index;
    if (!index) return;
    const next = renameAssistantSession(index, id, title, Date.now());
    if (next !== index) commitIndex(next);
  }, []);

  const toggleFavorite = useCallback((id: string) => {
    const index = snapshot.index;
    if (!index) return;
    const next = toggleAssistantSessionFavorite(index, id);
    if (next !== index) commitIndex(next);
  }, []);

  const deleteSession = useCallback((id: string) => {
    const index = snapshot.index;
    if (!index) return;
    const next = deleteAssistantSession(index, id);
    if (next === index) return;
    bodies = deleteSessionBubbles(bodies, id);
    writeAssistantSessionBodies(bodies);
    commitIndex(next);
  }, []);

  const touchActiveSession = useCallback(() => {
    const index = snapshot.index;
    const id = index?.activeId;
    if (!index || !id) return;
    const next = touchAssistantSession(index, id, Date.now());
    if (next !== index) commitIndex(next);
  }, []);

  const sessions = current.index?.sessions ?? [];
  const visible = filterAssistantSessions(sortAssistantSessions(sessions), current.query);
  const activeSession = current.index?.activeId
    ? sessions.find(item => item.id === current.index?.activeId) ?? null
    : null;

  return {
    ready: current.ready,
    saveFailed: current.saveFailed,
    activeSession,
    visible,
    totalCount: sessions.length,
    activeId: current.index?.activeId ?? null,
    query: current.query,
    setQuery,
    openSession,
    selectSession,
    renameSession,
    toggleFavorite,
    deleteSession,
    touchActiveSession,
  };
}
