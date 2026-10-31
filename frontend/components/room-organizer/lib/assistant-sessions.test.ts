import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { STORAGE_KEY } from './constants';
import {
  ASSISTANT_SESSIONS_MAX,
  ASSISTANT_SESSIONS_STORAGE_KEY,
  clampAssistantSessionTitle,
  deleteAssistantSession,
  emptyAssistantSessionIndex,
  filterAssistantSessions,
  formatAssistantSessionStamp,
  openAssistantSession,
  parseAssistantSessionIndex,
  readAssistantSessionIndex,
  renameAssistantSession,
  seedAssistantSessionIndex,
  selectAssistantSession,
  sortAssistantSessions,
  toggleAssistantSessionFavorite,
  writeAssistantSessionIndex,
  type AssistantSessionIndex,
} from './assistant-sessions';

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() { return data.size; },
    key: index => [...data.keys()][index] ?? null,
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => { data.set(key, value); },
    removeItem: key => { data.delete(key); },
    clear: () => { data.clear(); },
  };
}

function indexWith(titles: string[]): AssistantSessionIndex {
  return titles.reduce<AssistantSessionIndex>(
    (current, title, order) => openAssistantSession(current, { id: `ses-${order + 1}`, now: 1_000 + order, title }),
    emptyAssistantSessionIndex(),
  );
}

describe('assistant session index', () => {
  it('keeps its storage key off the layout draft and the canvas undo hook', () => {
    expect(ASSISTANT_SESSIONS_STORAGE_KEY).not.toBe(STORAGE_KEY);
    const files = [
      'assistant-sessions.ts',
      '../hooks/use-assistant-sessions.ts',
      '../panels/session-history-panel.tsx',
    ];
    for (const file of files) {
      const source = readFileSync(new URL(file, import.meta.url), 'utf8');
      expect(source).not.toMatch(/from ['"][^'"]*use-layout-history['"]/);
      expect(source).not.toMatch(/from ['"][^'"]*use-history['"]/);
    }
  });

  it('drops corrupt rows, duplicate ids, and an active id that is not in the list', () => {
    const parsed = parseAssistantSessionIndex(JSON.stringify({
      version: 1,
      activeId: 'missing',
      sessions: [
        { id: 'ses-a', title: '  发布会  ', createdAt: 10, updatedAt: 12, favorite: false },
        { id: 'ses-a', title: '重复', createdAt: 11, updatedAt: 11, favorite: true },
        { id: ' ', title: '空 id', createdAt: 1, updatedAt: 1, favorite: false },
        { id: 'ses-b', title: '   ', createdAt: 1, updatedAt: 1, favorite: false },
        { id: 'ses-c', title: '茶歇', createdAt: '昨天', updatedAt: 3, favorite: false },
        null,
      ],
    }));
    expect(parsed).toEqual({
      version: 1,
      activeId: null,
      sessions: [{ id: 'ses-a', title: '发布会', createdAt: 10, updatedAt: 12, favorite: false }],
    });
    expect(parseAssistantSessionIndex('{')).toBeNull();
    expect(parseAssistantSessionIndex(JSON.stringify({ version: 2, activeId: null, sessions: [] }))).toBeNull();
  });

  it('opens, renames, favorites, searches, and deletes without touching other rows', () => {
    const opened = indexWith(['发布会', '茶歇']);
    expect(opened.activeId).toBe('ses-2');
    expect(opened.sessions.map(item => item.title)).toEqual(['茶歇', '发布会']);

    const renamed = renameAssistantSession(opened, 'ses-1', '  客户发布会  ', 50);
    expect(renamed.sessions.find(item => item.id === 'ses-1')?.title).toBe('客户发布会');
    expect(renameAssistantSession(renamed, 'ses-1', '   ', 60)).toBe(renamed);
    expect(renameAssistantSession(renamed, 'missing', '别的', 60)).toBe(renamed);

    const stared = toggleAssistantSessionFavorite(renamed, 'ses-1');
    expect(sortAssistantSessions(stared.sessions).map(item => item.id)).toEqual(['ses-1', 'ses-2']);
    expect(filterAssistantSessions(sortAssistantSessions(stared.sessions), '发布').map(item => item.id)).toEqual(['ses-1']);
    expect(filterAssistantSessions(stared.sessions, '   ')).toHaveLength(2);

    const selected = selectAssistantSession(stared, 'ses-1', 80);
    expect(selected.activeId).toBe('ses-1');
    expect(selectAssistantSession(selected, 'ses-1', 90)).toBe(selected);

    const removed = deleteAssistantSession(selected, 'ses-1');
    expect(removed.activeId).toBe('ses-2');
    expect(removed.sessions).toHaveLength(1);
    expect(deleteAssistantSession(removed, 'ses-2').activeId).toBeNull();
  });

  it('clamps titles and keeps the active session when the list hits the cap', () => {
    expect(clampAssistantSessionTitle(`  ${'场'.repeat(90)}  `)).toHaveLength(80);
    let index = emptyAssistantSessionIndex();
    for (let order = 0; order < ASSISTANT_SESSIONS_MAX + 3; order += 1) {
      index = openAssistantSession(index, { id: `ses-${order}`, now: order, title: `方案 ${order}` });
    }
    expect(index.sessions).toHaveLength(ASSISTANT_SESSIONS_MAX);
    expect(index.activeId).toBe(`ses-${ASSISTANT_SESSIONS_MAX + 2}`);
    expect(index.sessions.some(item => item.id === 'ses-0')).toBe(false);
    const favoriteKept = toggleAssistantSessionFavorite(
      openAssistantSession(emptyAssistantSessionIndex(), { id: 'ses-old', now: 1, title: '旧收藏' }),
      'ses-old',
    );
    let crowded = favoriteKept;
    for (let order = 0; order < ASSISTANT_SESSIONS_MAX + 2; order += 1) {
      crowded = openAssistantSession(crowded, { id: `ses-new-${order}`, now: 10 + order, title: `新 ${order}` });
    }
    expect(crowded.sessions.some(item => item.id === 'ses-old' && item.favorite)).toBe(true);
  });

  it('round-trips through storage and reports a failed write', () => {
    const storage = memoryStorage();
    const seeded = seedAssistantSessionIndex(20, 'ses-seed');
    expect(writeAssistantSessionIndex(seeded, storage)).toBe(true);
    expect(readAssistantSessionIndex(storage)).toEqual(seeded);
    expect(storage.getItem(STORAGE_KEY)).toBeNull();
    const failing: Storage = {
      length: 0,
      clear: () => undefined,
      key: () => null,
      getItem: () => null,
      removeItem: () => undefined,
      setItem: () => { throw new DOMException('quota', 'QuotaExceededError'); },
    };
    expect(writeAssistantSessionIndex(seeded, failing)).toBe(false);
    expect(readAssistantSessionIndex(memoryStorage())).toBeNull();
  });

  it('formats a same-day stamp as a clock and another day as a date', () => {
    const now = Date.parse('2026-10-31T08:30:00');
    expect(formatAssistantSessionStamp(Date.parse('2026-10-31T07:05:00'), now)).toBe('07:05');
    expect(formatAssistantSessionStamp(Date.parse('2026-10-02T07:05:00'), now)).toBe('10月2日');
  });
});
