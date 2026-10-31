// @vitest-environment jsdom
import { webcrypto } from 'node:crypto';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ASSISTANT_SESSIONS_STORAGE_KEY,
  emptyAssistantSessionIndex,
  deleteAssistantSession,
  filterAssistantSessions,
  openAssistantSession,
  renameAssistantSession,
  selectAssistantSession,
  sortAssistantSessions,
  toggleAssistantSessionFavorite,
  type AssistantSessionIndex,
} from '../lib/assistant-sessions';
import { AssistantSessionDock, SessionHistoryPanel } from './session-history-panel';

const NOW = Date.parse('2026-10-31T09:40:00');

function sampleIndex(): AssistantSessionIndex {
  const opened = openAssistantSession(
    openAssistantSession(emptyAssistantSessionIndex(), { id: 'ses-1', now: NOW - 120_000, title: '发布会' }),
    { id: 'ses-2', now: NOW - 60_000, title: '茶歇' },
  );
  return selectAssistantSession(opened, 'ses-1', NOW);
}

function Harness(): JSX.Element {
  const [index, setIndex] = useState(sampleIndex);
  const [query, setQuery] = useState('');
  const visible = filterAssistantSessions(sortAssistantSessions(index.sessions), query);
  return (
    <SessionHistoryPanel
      sessions={visible}
      totalCount={index.sessions.length}
      activeId={index.activeId}
      query={query}
      saveFailed={false}
      now={NOW}
      onQuery={setQuery}
      onCreate={() => { setQuery(''); setIndex(current => openAssistantSession(current, { id: 'ses-new', now: NOW, title: '新会话' })); }}
      onSelect={id => setIndex(current => selectAssistantSession(current, id, NOW))}
      onRename={(id, title) => setIndex(current => renameAssistantSession(current, id, title, NOW))}
      onToggleFavorite={id => setIndex(current => toggleAssistantSessionFavorite(current, id))}
      onDelete={id => setIndex(current => deleteAssistantSession(current, id))}
    />
  );
}

function list(): HTMLElement {
  return screen.getByRole('list', { name: '方案会话列表' });
}

beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('session history panel', () => {
  it('lists sessions, filters them, and opens a new one', () => {
    render(<Harness />);
    expect(within(list()).getByRole('button', { name: /^发布会/ }).getAttribute('aria-current')).toBe('true');
    expect(within(list()).getByRole('button', { name: /^茶歇/ })).toBeTruthy();
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索会话' }), { target: { value: '茶' } });
    expect(within(list()).queryByRole('button', { name: /^发布会/ })).toBeNull();
    expect(within(list()).getByRole('button', { name: /^茶歇/ })).toBeTruthy();
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索会话' }), { target: { value: '没有这场' } });
    expect(screen.getByText('没有匹配的会话')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '新开会话' }));
    expect(within(list()).getByRole('button', { name: /^新会话/ }).getAttribute('aria-current')).toBe('true');
  });

  it('renames in place and restores the previous title on Escape', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: '改名 发布会' }));
    const input = screen.getByRole('textbox', { name: '会话名称' });
    fireEvent.change(input, { target: { value: '客户发布会' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(within(list()).getByRole('button', { name: /^客户发布会/ })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '改名 茶歇' }));
    const next = screen.getByRole('textbox', { name: '会话名称' });
    fireEvent.change(next, { target: { value: '不保存' } });
    fireEvent.keyDown(next, { key: 'Escape' });
    expect(within(list()).getByRole('button', { name: /^茶歇/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^不保存/ })).toBeNull();
  });

  it('toggles a favorite and asks before deleting', () => {
    render(<Harness />);
    const star = screen.getByRole('button', { name: '收藏 茶歇' });
    fireEvent.click(star);
    expect(screen.getByRole('button', { name: '取消收藏 茶歇' }).getAttribute('aria-pressed')).toBe('true');
    expect(within(list()).getAllByRole('button', { name: /^(发布会|茶歇)/ })[0]?.textContent).toContain('茶歇');

    fireEvent.click(screen.getByRole('button', { name: '删除 茶歇' }));
    expect(screen.getByText('删除这场会话？')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(within(list()).getByRole('button', { name: /^茶歇/ })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '删除 茶歇' }));
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }));
    expect(within(list()).queryByRole('button', { name: /^茶歇/ })).toBeNull();
    expect(within(list()).getByRole('button', { name: /^发布会/ })).toBeTruthy();
  });
});

describe('session history overlay variant', () => {
  it('hides the dock header and new-session control', () => {
    render(
      <SessionHistoryPanel
        sessions={sampleIndex().sessions}
        totalCount={2}
        activeId="ses-1"
        query=""
        saveFailed={false}
        now={NOW}
        variant="overlay"
        onQuery={() => {}}
        onCreate={() => {}}
        onSelect={() => {}}
        onRename={() => {}}
        onToggleFavorite={() => {}}
        onDelete={() => {}}
      />,
    );
    expect(screen.queryByRole('heading', { name: '方案会话' })).toBeNull();
    expect(screen.queryByRole('button', { name: '新开会话' })).toBeNull();
    expect(screen.getByRole('searchbox', { name: '搜索会话' })).toBeTruthy();
  });
});

describe('assistant session dock', () => {
  it('persists a seeded session locally and leaves the layout draft alone', async () => {
    const layoutDraftKey = 'scendance-editor-local-v1';
    localStorage.setItem(layoutDraftKey, 'layout-blob');
    const first = render(<AssistantSessionDock />);
    expect(await screen.findByRole('list', { name: '方案会话列表' })).toBeTruthy();
    expect(localStorage.getItem(layoutDraftKey)).toBe('layout-blob');
    const raw = localStorage.getItem(ASSISTANT_SESSIONS_STORAGE_KEY);
    expect(raw).toContain('新会话');
    expect(raw).not.toContain('layout-blob');

    fireEvent.click(screen.getByRole('button', { name: '改名 新会话' }));
    const input = screen.getByRole('textbox', { name: '会话名称' });
    fireEvent.change(input, { target: { value: '周末共创' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(await screen.findByRole('button', { name: /^周末共创/ })).toBeTruthy();
    first.unmount();

    render(<AssistantSessionDock />);
    expect(await screen.findByRole('button', { name: /^周末共创/ })).toBeTruthy();
    expect(localStorage.getItem(layoutDraftKey)).toBe('layout-blob');
    expect(localStorage.getItem(ASSISTANT_SESSIONS_STORAGE_KEY)).toContain('周末共创');
  });
});
