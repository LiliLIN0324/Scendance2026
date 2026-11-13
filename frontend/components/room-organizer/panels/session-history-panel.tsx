'use client';

import { useRef, useState } from 'react';
import { FolderOpen, Pencil, Pin, Plus, Search, Trash, X } from '@/components/solid-icons';
import { listOtherAssistantHistories, useAssistantSessions } from '../hooks/use-assistant-sessions';
import { readScopeNames, scopeDisplayName } from '../lib/assistant-scope-registry';
import { emptyAssistantSessionBodies, readAssistantSessionBodies, readSessionBubbles } from '../lib/assistant-session-bodies';
import { filterAssistantSessions, formatAssistantSessionStamp, readAssistantSessionIndex, sortAssistantSessions, type AssistantSession } from '../lib/assistant-sessions';
import './session-history-panel.css';

/** 2026-11-14 用户指令（对齐 ZCode 侧栏范式）：折叠时每组只露前 5 条，其余收进「展开显示」。 */
const COLLAPSED_COUNT = 5;

/** 2026-11-14 用户指令：会话四态——已读(无点)/错误(红点)/未读(蓝点)/进行中(绿点)。 */
export type SessionStatus = 'idle' | 'error' | 'unread' | 'active';

const SEEN_STORAGE_KEY = 'scendance-assistant-session-seen-v1';
/** 页面本次加载基线：在此之前最后活跃的会话一律视为已读，老数据不整片亮蓝。 */
const SESSION_SEEN_BASELINE = Date.now();

function readSeenMap(): Record<string, number> {
  try {
    const raw = localStorage.getItem(SEEN_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const record = parsed as { version?: unknown; byId?: unknown };
      if (record.version === 1 && record.byId && typeof record.byId === 'object' && !Array.isArray(record.byId)) {
        return record.byId as Record<string, number>;
      }
    }
  } catch { /* 本机 seen 记录读不回就当全没看过，只影响蓝点 */ }
  return {};
}

/** 记下「刚看过这场会话」的时间点；之后再有更新才算未读。 */
export function markSessionSeen(id: string): void {
  if (!id) return;
  const map = readSeenMap();
  map[id] = Date.now();
  try { localStorage.setItem(SEEN_STORAGE_KEY, JSON.stringify({ version: 1, byId: map })); } catch { /* 写不进就只在本页内成立 */ }
}

/** 会话最后更新晚于上次打开（且晚于本次页面加载基线）= 未读。 */
export function sessionUnreadSince(id: string, updatedAt: number): boolean {
  return updatedAt > (readSeenMap()[id] ?? SESSION_SEEN_BASELINE);
}

export interface SessionHistoryPanelProps {
  sessions: readonly AssistantSession[];
  totalCount: number;
  activeId: string | null;
  query: string;
  saveFailed: boolean;
  now?: number;
  /** overlay = 对话区上的历史层，顶栏动作在 Agent 头里。 */
  variant?: 'overlay' | 'panel';
  /** 分组标题：历史按项目分组时，每组上面那行「项目名」。 */
  heading?: string;
  /** 其他项目的分组不带搜索框——搜索只作用当前项目。 */
  hideSearch?: boolean;
  /** overlay 传：右上角给一颗关闭钮（整层接管对话区后，靠它回到对话）。 */
  onClose?(): void;
  /** 四态解析（已读/错误/未读/进行中）；不传=全部视为已读，行首不亮点。 */
  resolveStatus?: (session: AssistantSession) => SessionStatus;
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
 * 2026-11-14 重排（用户指令「图二图三」）：裸「+」新会话钮；会话行=纯文本单行
 * （时间戳与操作钮退到悬停/按下态）；每组超 5 条折叠进「展开显示」。
 */
export function SessionHistoryPanel({
  sessions,
  totalCount,
  activeId,
  query,
  saveFailed,
  now,
  variant = 'panel',
  heading,
  hideSearch = false,
  onClose,
  resolveStatus,
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
  const [expanded, setExpanded] = useState(false);
  const skipCommit = useRef(false);
  const clock = now ?? Date.now();
  const overlay = variant === 'overlay';
  // 置顶（沿用 favorite 字段，UI 语义=置顶）排组内最前；其余仍按传入顺序（最近更新在前）。
  const ordered = [...sessions].sort((a, b) => Number(b.favorite === true) - Number(a.favorite === true));
  const shown = expanded ? ordered : ordered.slice(0, COLLAPSED_COUNT);

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
            <Plus size={16} aria-hidden="true" />
          </button>
        </header>
      )}
      {!hideSearch && (
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
      )}
      {heading && (
        <div className="sc-session-group-head">
          <p className="sc-session-group">
            <FolderOpen size={14} aria-hidden="true" />
            <span>{heading}</span>
          </p>
          {overlay && (
            <button type="button" className="sc-session-new" aria-label="新开会话" onClick={onCreate}>
              <Plus size={16} aria-hidden="true" />
            </button>
          )}
          {overlay && onClose && (
            <button type="button" className="sc-session-new" aria-label="关闭会话历史" onClick={onClose}>
              <X size={16} aria-hidden="true" />
            </button>
          )}
        </div>
      )}
      {totalCount === 0 ? (
        <p className="sc-session-empty">{overlay ? '还没有会话。点 + 开始。' : '还没有会话。点右上角 + 开始一场。'}</p>
      ) : sessions.length === 0 ? (
        <p className="sc-session-empty">没有匹配的会话</p>
      ) : (
        <ul className="sc-session-list" aria-label="方案会话列表">
          {shown.map(session => {
            const active = session.id === activeId;
            const editing = editingId === session.id;
            const confirming = pendingDeleteId === session.id;
            const status = resolveStatus ? resolveStatus(session) : 'idle';
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
                    {/* 状态与置顶共用同一槽位：状态点常显；置顶图钉悬停才显示并替换状态点。 */}
                    <span className={`sc-session-dot${status !== 'idle' ? ` is-${status}` : ''}${session.favorite ? ' is-pinned' : ''}`} aria-hidden="true">
                      {session.favorite ? <Pin size={13} aria-hidden="true" /> : <i className="sc-session-dot-face" />}
                    </span>
                    <span className="sc-session-text">
                      <strong>{session.title}</strong>
                      <small>{formatAssistantSessionStamp(session.updatedAt, clock)}</small>
                    </span>
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
                      aria-label={session.favorite ? `取消置顶 ${session.title}` : `置顶 ${session.title}`}
                      data-tip={session.favorite ? '取消置顶' : '置顶任务'}
                      onClick={() => onToggleFavorite(session.id)}
                    >
                      <Pin size={15} aria-hidden="true" />
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
      {sessions.length > COLLAPSED_COUNT && (
        <button type="button" className="sc-session-expand" onClick={() => setExpanded(value => !value)}>
          {expanded ? '收起' : '展开显示'}
        </button>
      )}
      {saveFailed && <p className="sc-session-save" role="status">这场改动没能写进本机</p>}
    </section>
  );
}

/** 只读项目分组（其他项目 / 旧会话）：文件夹行 + 纯文本行，点行展开气泡；说明收进 hover title。 */
function ReadonlySessionGroup({ label, hint, sessions, query, readBubbles }: {
  label: string;
  hint: string;
  sessions: readonly AssistantSession[];
  query: string;
  readBubbles(sessionId: string): { id: string; role: string; text: string }[];
}): JSX.Element | null {
  const [expanded, setExpanded] = useState(false);
  const rows = filterAssistantSessions(sortAssistantSessions(sessions), query);
  if (rows.length === 0) return null;
  const shown = expanded ? rows : rows.slice(0, COLLAPSED_COUNT);
  return (
    <section className="sc-session-group-block" aria-label={label} title={hint}>
      <p className="sc-session-group">
        <FolderOpen size={14} aria-hidden="true" />
        <span>{label}</span>
      </p>
      <ul className="sc-session-list">
        {shown.map(session => (
          <li key={session.id} className="sc-session-row is-readonly">
            <details>
              <summary>
                <strong>{session.title}</strong>
              </summary>
              {readBubbles(session.id).map(row => (
                <p key={row.id}>{row.role === 'user' ? '你' : '助手'}：{row.text}</p>
              ))}
            </details>
          </li>
        ))}
      </ul>
      {rows.length > COLLAPSED_COUNT && (
        <button type="button" className="sc-session-expand" onClick={() => setExpanded(value => !value)}>
          {expanded ? '收起' : '展开显示'}
        </button>
      )}
    </section>
  );
}

export interface SessionHistoryOverlayProps {
  open: boolean;
  scope?: string;
  /** 当前活动的显示名；分组标题用。 */
  currentName?: string;
  onClose(): void;
  onSelect(id: string): void;
  assertWrite?: (() => void) | undefined;
  /** 四态解析（已读/错误/未读/进行中），由 Agent 面板按 agent 状态给出。 */
  resolveStatus?: (session: AssistantSession) => SessionStatus;
}

/**
 * History 浮层：挂在Bingo对话区上方，约占 1/3 高。
 * 2026-11-13 用户指令：历史「服从于不同的项目」——一份列表按项目分组，当前项目在最上面且可操作，
 * 其他项目的记录只读展示（点开看气泡），不冒充当前项目的需求。
 * 2026-11-14 重排（用户指令「图二图三」）：文件夹式分组头；其他组说明移到 hover title，不再占行。
 */
export function SessionHistoryOverlay({ open, onClose, onSelect, assertWrite, scope, currentName, resolveStatus }: SessionHistoryOverlayProps): JSX.Element | null {
  const sessions = useAssistantSessions(assertWrite, scope);
  if (!open || !sessions.ready) return null;
  const names = readScopeNames();
  const otherHistories = scope ? listOtherAssistantHistories(scope) : [];
  // 旧室内壳体留下的未分槽会话（scope='legacy'）：仍给一个只读分组，别把旧记录藏没了。
  const legacy = scope && scope !== 'legacy' ? readAssistantSessionIndex() : null;
  const legacyBodies = legacy ? readAssistantSessionBodies() : null;
  const currentHeading = `当前项目 · ${currentName?.trim() || scopeDisplayName(scope ?? '', names)}`;
  return (
    <>
      <button type="button" className="ap-history-scrim" aria-label="关闭会话历史" onClick={onClose} />
      <div className="ap-history-panel">
        <SessionHistoryPanel
          variant="overlay"
          heading={currentHeading}
          onClose={onClose}
          resolveStatus={resolveStatus}
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
        {otherHistories.map(history => (
          <ReadonlySessionGroup
            key={history.scope}
            label={scopeDisplayName(history.scope, names)}
            hint="其他项目的记录，仅查看；打开该项目后可继续。"
            sessions={history.index.sessions}
            query={sessions.query}
            readBubbles={sessionId => readSessionBubbles(history.bodies, sessionId)}
          />
        ))}
        {legacy ? (
          <ReadonlySessionGroup
            label="旧会话（未关联活动）"
            hint="仅供查看，不会自动作为当前项目的需求。"
            sessions={legacy.sessions}
            query=""
            readBubbles={sessionId => readSessionBubbles(legacyBodies ?? emptyAssistantSessionBodies(), sessionId)}
          />
        ) : null}
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
