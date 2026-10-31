'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
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
  writeAssistantSessionIndex,
  type AssistantSession,
  type AssistantSessionIndex,
} from '../lib/assistant-sessions';

export interface AssistantSessionsController {
  ready: boolean;
  saveFailed: boolean;
  /** 已按收藏优先、最近更新排序，并套上搜索。 */
  visible: readonly AssistantSession[];
  totalCount: number;
  /** 当前会话标题。搜索滤掉它时也还在，对话列顶用这个，不跟列表走。 */
  activeTitle: string;
  activeId: string | null;
  query: string;
  setQuery(value: string): void;
  openSession(): void;
  selectSession(id: string): void;
  renameSession(id: string, title: string): void;
  toggleFavorite(id: string): void;
  deleteSession(id: string): void;
}

/**
 * 方案会话索引的本机读写。
 * 不订阅布局撤销：`use-history` / `use-layout-history` 仍只服务画布 undo。
 */
export function useAssistantSessions(): AssistantSessionsController {
  const [index, setIndex] = useState<AssistantSessionIndex | null>(null);
  const [query, setQuery] = useState('');
  const [saveFailed, setSaveFailed] = useState(false);
  const indexRef = useRef<AssistantSessionIndex | null>(null);
  indexRef.current = index;

  useEffect(() => {
    const stored = readAssistantSessionIndex();
    if (stored) {
      indexRef.current = stored;
      setIndex(stored);
      return;
    }
    const seeded = seedAssistantSessionIndex(Date.now(), createAssistantSessionId());
    indexRef.current = seeded;
    setIndex(seeded);
    setSaveFailed(!writeAssistantSessionIndex(seeded));
  }, []);

  const commit = useCallback((next: AssistantSessionIndex) => {
    indexRef.current = next;
    setIndex(next);
    setSaveFailed(!writeAssistantSessionIndex(next));
  }, []);

  const openSession = useCallback(() => {
    const current = indexRef.current ?? emptyAssistantSessionIndex();
    setQuery('');
    commit(openAssistantSession(current, { id: createAssistantSessionId(), now: Date.now() }));
  }, [commit]);

  const selectSession = useCallback((id: string) => {
    const current = indexRef.current;
    if (!current) return;
    const next = selectAssistantSession(current, id, Date.now());
    if (next !== current) commit(next);
  }, [commit]);

  const renameSession = useCallback((id: string, title: string) => {
    const current = indexRef.current;
    if (!current) return;
    const next = renameAssistantSession(current, id, title, Date.now());
    if (next !== current) commit(next);
  }, [commit]);

  const toggleFavorite = useCallback((id: string) => {
    const current = indexRef.current;
    if (!current) return;
    const next = toggleAssistantSessionFavorite(current, id);
    if (next !== current) commit(next);
  }, [commit]);

  const deleteSession = useCallback((id: string) => {
    const current = indexRef.current;
    if (!current) return;
    const next = deleteAssistantSession(current, id);
    if (next !== current) commit(next);
  }, [commit]);

  const sessions = index?.sessions ?? [];
  const visible = filterAssistantSessions(sortAssistantSessions(sessions), query);

  const active = sessions.find(session => session.id === index?.activeId);

  return {
    ready: index !== null,
    saveFailed,
    visible,
    totalCount: sessions.length,
    activeTitle: active?.title || '新会话',
    activeId: index?.activeId ?? null,
    query,
    setQuery,
    openSession,
    selectSession,
    renameSession,
    toggleFavorite,
    deleteSession,
  };
}
