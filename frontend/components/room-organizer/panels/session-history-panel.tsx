'use client';

import { MessageCirclePlus, Pencil, Search, Star, Trash } from 'lucide-react';
import { useRef, useState } from 'react';
import { formatAssistantSessionStamp, type AssistantSession } from '../lib/assistant-sessions';
import { useAssistantSessions } from '../hooks/use-assistant-sessions';
import './session-history-panel.css';

export interface SessionHistoryPanelProps {
  sessions: readonly AssistantSession[];
  totalCount: number;
  activeId: string | null;
  query: string;
  saveFailed: boolean;
  now?: number;
  /** overlay = 对话区上的历史层，顶栏动作在 Agent 头里。 */
  variant?: 'overlay' | 'panel';
  onQuery(value: string): void;
  onCreate(): void;
  onSelect(id: string): void;
  onRename(id: string, title: string): void;
  onToggleFavorite(id: string): void;
  onDelete(id: string): void;
}

/**
 * 方案会话列表：搜索、收藏、行内改名、删除确认。
 * oddeNova 同构：默认只在 History overlay 里展开，不常驻左栏大面板。
 */
export function SessionHistoryPanel({
  sessions,
  totalCount,
  activeId,
  query,
  saveFailed,
  now,
  variant = 'panel',
  onQuery,
  onCreate,
  onSelect,
  onRename,
  onToggleFavorite,
  onDelete,
}: SessionHistoryPanelProps): JSX.Element {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const skipCommit = useRef(false);
  const clock = now ?? Date.now();
  const overlay = variant === 'overlay';

  function beginRename(session: AssistantSession): void {
    skipCommit.current = false;
    setPendingDeleteId(null);
    setEditingId(session.id);
    setDraft(session.title);
  }

  function cancelRename(): void {
    skipCommit.current = true;
    setEditingId(null);
  }

  function commitRename(): void {
    if (skipCommit.current) {
      skipCommit.current = false;
      return;
    }
    const id = editingId;
    if (!id) return;
    const title = draft.trim();
    setEditingId(null);
    if (title) onRename(id, title);
  }

  return (
    <section
      className={`sc-session-history${overlay ? ' is-overlay' : ''}`}
      aria-label="方案会话"
    >
      {!overlay && (
        <header className="sc-session-history-head">
          <h2>方案会话</h2>
          <button type="button" className="sc-session-new" aria-label="新开会话" onClick={onCreate}>
            <MessageCirclePlus size={16} aria-hidden="true" />
            <span>新会话</span>
          </button>
        </header>
      )}
      <label className="sc-session-search">
        <Search size={15} aria-hidden="true" />
        <input
          type="search"
          value={query}
          placeholder="搜索"
          aria-label="搜索会话"
          onChange={event => onQuery(event.target.value)}
        />
      </label>
      {totalCount === 0 ? (
        <p className="sc-session-empty">{overlay ? '还没有会话。点顶栏「新会话」开始。' : '还没有会话。点右上角「新会话」开始一场。'}</p>
      ) : sessions.length === 0 ? (
        <p className="sc-session-empty">没有匹配的会话</p>
      ) : (
        <ul className="sc-session-list" aria-label="方案会话列表">
          {sessions.map(session => {
            const active = session.id === activeId;
            const editing = editingId === session.id;
            const confirming = pendingDeleteId === session.id;
            return (
              <li key={session.id} className={`sc-session-row${active ? ' is-active' : ''}${editing ? ' is-renaming' : ''}${confirming ? ' is-confirming' : ''}`}>
                {editing ? (
                  <input
                    className="sc-session-rename"
                    aria-label="会话名称"
                    value={draft}
                    autoFocus
                    maxLength={80}
                    onChange={event => setDraft(event.target.value)}
                    onBlur={commitRename}
                    onKeyDown={event => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        commitRename();
                      } else if (event.key === 'Escape') {
                        event.preventDefault();
                        cancelRename();
                      }
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    className="sc-session-open"
                    aria-current={active ? 'true' : undefined}
                    onClick={() => onSelect(session.id)}
                  >
                    <strong>{session.title}</strong>
                    <small>{formatAssistantSessionStamp(session.updatedAt, clock)}</small>
                  </button>
                )}
                {confirming ? (
                  <div className="sc-session-confirm" role="group" aria-label={`确认删除 ${session.title}`}>
                    <span>删除这场会话？</span>
                    <button type="button" onClick={() => setPendingDeleteId(null)}>取消</button>
                    <button type="button" className="is-danger" aria-label="确认删除" onClick={() => { onDelete(session.id); setPendingDeleteId(null); }}>删除</button>
                  </div>
                ) : (
                  <div className="sc-session-actions">
                    <button type="button" aria-label={`改名 ${session.title}`} onClick={() => beginRename(session)}>
                      <Pencil size={15} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className={session.favorite ? 'is-on' : undefined}
                      aria-pressed={session.favorite}
                      aria-label={session.favorite ? `取消收藏 ${session.title}` : `收藏 ${session.title}`}
                      onClick={() => onToggleFavorite(session.id)}
                    >
                      <Star size={15} aria-hidden="true" fill={session.favorite ? 'currentColor' : 'none'} />
                    </button>
                    <button type="button" aria-label={`删除 ${session.title}`} onClick={() => { setEditingId(null); setPendingDeleteId(session.id); }}>
                      <Trash size={15} aria-hidden="true" />
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {saveFailed && <p className="sc-session-save" role="status">这场改动没能写进本机</p>}
    </section>
  );
}

export interface SessionHistoryOverlayProps {
  open: boolean;
  onClose(): void;
  onSelect(id: string): void;
}

/** History 浮层：挂在晴光对话区上方，约占 1/3 高。 */
export function SessionHistoryOverlay({ open, onClose, onSelect }: SessionHistoryOverlayProps): JSX.Element | null {
  const sessions = useAssistantSessions();
  if (!open || !sessions.ready) return null;
  return (
    <>
      <button type="button" className="ap-history-scrim" aria-label="关闭会话历史" onClick={onClose} />
      <div className="ap-history-panel">
        <SessionHistoryPanel
          variant="overlay"
          sessions={sessions.visible}
          totalCount={sessions.totalCount}
          activeId={sessions.activeId}
          query={sessions.query}
          saveFailed={sessions.saveFailed}
          onQuery={sessions.setQuery}
          onCreate={() => { sessions.openSession(); onClose(); }}
          onSelect={id => { sessions.selectSession(id); onSelect(id); onClose(); }}
          onRename={sessions.renameSession}
          onToggleFavorite={sessions.toggleFavorite}
          onDelete={sessions.deleteSession}
        />
      </div>
    </>
  );
}

/** @deprecated 左栏常驻 dock 已移除；测试与 Story 仍可直接挂载面板。 */
export function AssistantSessionDock(): JSX.Element {
  const sessions = useAssistantSessions();
  if (!sessions.ready) {
    return (
      <section className="sc-session-history" aria-label="方案会话" aria-busy="true">
        <header className="sc-session-history-head">
          <h2>方案会话</h2>
        </header>
        <p className="sc-session-empty">正在读取本机会话…</p>
      </section>
    );
  }
  return (
    <SessionHistoryPanel
      sessions={sessions.visible}
      totalCount={sessions.totalCount}
      activeId={sessions.activeId}
      query={sessions.query}
      saveFailed={sessions.saveFailed}
      onQuery={sessions.setQuery}
      onCreate={sessions.openSession}
      onSelect={sessions.selectSession}
      onRename={sessions.renameSession}
      onToggleFavorite={sessions.toggleFavorite}
      onDelete={sessions.deleteSession}
    />
  );
}
