// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eventOperationsSchema } from '../../../../supabase/functions/_shared/event-operations-contract';
import { makeLayout } from '../lib/__testfixtures__/fixtures';
import { STORAGE_KEY } from '../lib/constants';
import { withHouseId } from '../lib/ids';
import {
  EDITOR_SETTLED_MS,
  crashRecurredAfterReload,
  isRecoveryKey,
  loadLayout,
  noteReloadAttempt,
  readRecoveryCopies,
} from '../lib/persistence';
import { VERSION_HISTORY_STORAGE_KEY } from '../lib/version-history';
import { useLayoutPersistence } from './use-layout-persistence';
import { useLayoutState } from './use-layout-state';
import { layoutStore } from './use-layout-store';
import type { RoomLayout } from '../lib/types';

describe('useLayoutPersistence — guarded task save and readback', () => {
  beforeEach(() => { localStorage.clear(); window.history.replaceState(null, '', '/'); vi.useFakeTimers(); });
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });
  const operations = eventOperationsSchema.parse({ dataKind: 'rehearsal', tasks: [{
    id: 'a1000000-0000-4000-8000-000000000002', title: '演练新增任务', phase: 'preparation', objectIds: [],
  }] });
  const mountEditor = (saved = makeLayout({ id: 'task-rehearsal', name: '已存演练' })) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
    layoutStore.setState({ layout: saved, activeFloorIndex: 0 });
    const onHydrate = vi.fn((value: RoomLayout) => layoutStore.getState().actions.applyLayout(value));
    const tab = renderHook(() => {
      const state = useLayoutState();
      return { ...state, persistence: useLayoutPersistence({ layout: state.layout, onHydrate, debounceMs: 100 }) };
    });
    const expected = tab.result.current.layout;
    const next = { ...expected, eventOperations: operations };
    return { tab, expected, next, onHydrate };
  };
  const settleOldSave = () => act(() => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    vi.advanceTimersByTime(1000); window.dispatchEvent(new Event('pagehide'));
  });
  const loseReadbackAfterCommit = async ({ tab, expected, next }: ReturnType<typeof mountEditor>) => {
    const originalRead = Storage.prototype.getItem, originalWrite = Storage.prototype.setItem;
    let committed = false;
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      originalWrite.call(this, key, value); if (key === STORAGE_KEY) committed = true;
    });
    const read = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, key) {
      if (key === STORAGE_KEY && committed) { committed = false; throw new DOMException('readback lost', 'SecurityError'); }
      return originalRead.call(this, key);
    });
    await act(async () => { await expect(tab.result.current.persistence.persistVerifiedLayout(expected, next, () => {})).rejects.toThrow('无法回读'); });
    read.mockRestore(); write.mockRestore();
    expect(loadLayout()).toEqual(next);
    expect(tab.result.current.layout).toBe(expected);
  };

  it('reads back the complete layout before applying tasks and cancels the old debounce and pagehide', async () => {
    const { tab, onHydrate } = mountEditor();
    act(() => tab.result.current.actions.setWidth(9));
    const expected = tab.result.current.layout;
    const next = { ...expected, eventOperations: operations };
    const write = vi.spyOn(Storage.prototype, 'setItem');
    let verified!: RoomLayout;
    await act(async () => { verified = await tab.result.current.persistence.persistVerifiedLayout(expected, next, () => {}); });
    expect(verified).toEqual(next);
    expect(tab.result.current.layout).toBe(expected);
    expect(tab.result.current.layout.eventOperations).toBeUndefined();
    expect(onHydrate).toHaveBeenCalledTimes(1);
    expect(loadLayout()).toEqual(next);
    expect(tab.result.current.persistence.saveError).toBeNull();
    expect(tab.result.current.persistence.lastSavedAt).not.toBeNull();
    settleOldSave();
    expect(loadLayout()).toEqual(next);
    expect(write.mock.calls.filter(([key]) => key === STORAGE_KEY)).toHaveLength(1);
    expect(localStorage.getItem(VERSION_HISTORY_STORAGE_KEY)).toBeNull();
    act(() => tab.result.current.actions.setEventOperations(verified.eventOperations!));
    act(() => tab.result.current.actions.setWidth(10));
    settleOldSave();
    expect(loadLayout()?.width).toBe(10);
    expect(loadLayout()?.eventOperations).toEqual(operations);
  });

  it.each([
    ['same id with changed tasks', (value: RoomLayout) => ({ ...value, eventOperations: operations })],
    ['another activity', (value: RoomLayout) => ({ ...value, id: 'other-activity' })],
    ['corrupt record', () => '{broken activity'],
    ['removed record', () => null],
  ])('refuses an unseen %s without overwriting it', async (_label, foreign) => {
    const { tab, expected, next } = mountEditor();
    const replacement = foreign(expected);
    const raw = replacement === null || typeof replacement === 'string' ? replacement : JSON.stringify(replacement);
    if (raw === null) localStorage.removeItem(STORAGE_KEY); else localStorage.setItem(STORAGE_KEY, raw);
    const write = vi.spyOn(Storage.prototype, 'setItem');
    await act(async () => { await expect(tab.result.current.persistence.persistVerifiedLayout(expected, next, () => {})).rejects.toThrow('已变化'); });
    settleOldSave();
    expect(write.mock.calls.filter(([key]) => key === STORAGE_KEY)).toHaveLength(0);
    expect(localStorage.getItem(STORAGE_KEY)).toBe(raw);
    expect(tab.result.current.layout).toBe(expected);
    expect(tab.result.current.persistence.lastSavedAt).toBeNull();
  });

  it('refuses storage reads before any write, then retries the same proposal', async () => {
    const { tab, expected, next } = mountEditor();
    const read = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('blocked', 'SecurityError'); });
    const write = vi.spyOn(Storage.prototype, 'setItem');
    await act(async () => { await expect(tab.result.current.persistence.persistVerifiedLayout(expected, next, () => {})).rejects.toThrow('无法读取'); });
    expect(write).not.toHaveBeenCalled();
    expect(tab.result.current.persistence.saveError).toBe('blocked');
    read.mockRestore();
    await act(async () => { await tab.result.current.persistence.persistVerifiedLayout(expected, next, () => {}); });
    expect(loadLayout()).toEqual(next);
  });

  it('keeps an unknown committed write and confirms it on retry without a second write', async () => {
    const { tab, expected, next } = mountEditor();
    const original = Storage.prototype.getItem;
    let reads = 0;
    const read = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, key) {
      if (key === STORAGE_KEY && ++reads === 3) throw new DOMException('readback blocked', 'SecurityError');
      return original.call(this, key);
    });
    const write = vi.spyOn(Storage.prototype, 'setItem');
    await act(async () => { await expect(tab.result.current.persistence.persistVerifiedLayout(expected, next, () => {})).rejects.toThrow('无法回读'); });
    expect(tab.result.current.layout).toBe(expected);
    expect(tab.result.current.persistence.lastSavedAt).toBeNull();
    expect(tab.result.current.persistence.saveError).toBe('blocked');
    read.mockRestore();
    settleOldSave();
    expect(loadLayout()).toEqual(next);
    act(() => expect(() => tab.result.current.persistence.ensurePersistentIdentity()).toThrow('仍待核对'));
    await act(async () => { await tab.result.current.persistence.persistVerifiedLayout(expected, next, () => {}); });
    expect(write.mock.calls.filter(([key]) => key === STORAGE_KEY)).toHaveLength(1);
    expect(tab.result.current.persistence.saveError).toBeNull();
    expect(tab.result.current.layout).toBe(expected);
  });

  it.each(['silent', 'quota'] as const)('does not acknowledge a %s write failure', async failure => {
    const { tab, expected, next } = mountEditor();
    const raw = localStorage.getItem(STORAGE_KEY);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      if (failure === 'quota') throw new DOMException('full', 'QuotaExceededError');
    });
    await act(async () => { await expect(tab.result.current.persistence.persistVerifiedLayout(expected, next, () => {})).rejects.toThrow(failure === 'quota' ? '任务未保存' : '回读不一致'); });
    settleOldSave();
    expect(localStorage.getItem(STORAGE_KEY)).toBe(raw);
    expect(tab.result.current.layout).toBe(expected);
    expect(tab.result.current.persistence.lastSavedAt).toBeNull();
    expect(tab.result.current.persistence.saveError).toBe(failure === 'quota' ? 'quota' : 'unknown');
    write.mockRestore();
    await act(async () => { await tab.result.current.persistence.persistVerifiedLayout(expected, next, () => {}); });
    expect(loadLayout()).toEqual(next);
  });

  it('leaves a concurrent readback replacement untouched and keeps the old UI', async () => {
    const { tab, expected, next } = mountEditor();
    const foreign = JSON.stringify({ ...expected, width: 11 });
    const original = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      original.call(this, key, key === STORAGE_KEY ? foreign : value);
    });
    await act(async () => { await expect(tab.result.current.persistence.persistVerifiedLayout(expected, next, () => {})).rejects.toThrow('回读不一致'); });
    settleOldSave();
    expect(localStorage.getItem(STORAGE_KEY)).toBe(foreign);
    expect(tab.result.current.layout).toBe(expected);
    expect(tab.result.current.persistence.lastSavedAt).toBeNull();
  });

  it('checks the guard again before writing and after writing without acknowledging stale identity', async () => {
    const { tab, expected, next } = mountEditor();
    const guard = vi.fn();
    guard.mockImplementationOnce(() => {}).mockImplementationOnce(() => { throw new Error('账号已变化'); });
    const original = Storage.prototype.setItem;
    const write = vi.spyOn(Storage.prototype, 'setItem');
    await act(async () => { await expect(tab.result.current.persistence.persistVerifiedLayout(expected, next, guard)).rejects.toThrow('账号已变化'); });
    expect(write).not.toHaveBeenCalled();
    let active = true;
    write.mockImplementation(function (this: Storage, key, value) { original.call(this, key, value); active = false; });
    await act(async () => { await expect(tab.result.current.persistence.persistVerifiedLayout(expected, next, () => { if (!active) throw new Error('活动已取消'); })).rejects.toThrow('活动已取消'); });
    expect(loadLayout()).toEqual(next);
    expect(tab.result.current.layout).toBe(expected);
    expect(tab.result.current.persistence.lastSavedAt).toBeNull();
    settleOldSave();
    expect(loadLayout()).toEqual(next);
  });

  it('rejects an obsolete immutable expected layout or a different next identity before writing', async () => {
    const { tab, expected, next } = mountEditor();
    const write = vi.spyOn(Storage.prototype, 'setItem');
    await act(async () => { await expect(tab.result.current.persistence.persistVerifiedLayout({ ...expected }, next, () => {})).rejects.toThrow('已变化'); });
    await act(async () => { await expect(tab.result.current.persistence.persistVerifiedLayout(expected, { ...next, id: 'foreign' }, () => {})).rejects.toThrow('编号不一致'); });
    expect(write).not.toHaveBeenCalled();
  });

  it('checks the stored baseline once more after the pre-write guard', async () => {
    const { tab, expected, next } = mountEditor();
    const foreign = JSON.stringify({ ...expected, name: '其他页面更新' });
    let checks = 0;
    const original = Storage.prototype.setItem;
    const write = vi.spyOn(Storage.prototype, 'setItem');
    await act(async () => { await expect(tab.result.current.persistence.persistVerifiedLayout(expected, next, () => {
      if (++checks === 2) original.call(localStorage, STORAGE_KEY, foreign);
    })).rejects.toThrow('已变化'); });
    settleOldSave();
    expect(write).not.toHaveBeenCalled();
    expect(localStorage.getItem(STORAGE_KEY)).toBe(foreign);
  });

  it('does not acknowledge when the guard expires after the readback', async () => {
    const { tab, expected, next } = mountEditor();
    let checks = 0;
    await act(async () => { await expect(tab.result.current.persistence.persistVerifiedLayout(expected, next, () => {
      if (++checks === 4) throw new Error('项目已变化');
    })).rejects.toThrow('项目已变化'); });
    expect(checks).toBe(4);
    expect(loadLayout()).toEqual(next);
    expect(tab.result.current.persistence.lastSavedAt).toBeNull();
    expect(tab.result.current.layout).toBe(expected);
    settleOldSave();
    expect(loadLayout()).toEqual(next);
  });

  it('does not treat an unknown hydration read as an empty verified storage baseline', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const original = Storage.prototype.getItem;
    let unread = true;
    const read = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, key) {
      if (key === STORAGE_KEY && unread) { unread = false; throw new DOMException('blocked', 'SecurityError'); }
      return original.call(this, key);
    });
    const current = makeLayout({ id: 'unknown-baseline' });
    const tab = renderHook(() => useLayoutPersistence({ layout: current, onHydrate: () => {}, debounceMs: 100 }));
    read.mockRestore();
    const write = vi.spyOn(Storage.prototype, 'setItem');
    await act(async () => { await expect(tab.result.current.persistVerifiedLayout(current, { ...current, eventOperations: operations }, () => {})).rejects.toThrow('已变化'); });
    settleOldSave();
    expect(write).not.toHaveBeenCalled();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('rejects a layout which would be silently repaired on reload before writing', async () => {
    const { tab, expected, next } = mountEditor();
    const write = vi.spyOn(Storage.prototype, 'setItem');
    await act(async () => { await expect(tab.result.current.persistence.persistVerifiedLayout(expected, { ...next, name: 'a'.repeat(201) }, () => {})).rejects.toThrow('无法核对'); });
    expect(write).not.toHaveBeenCalled();
  });

  it('verifies an already-applied layout after reload without writing or holding its later autosave', async () => {
    const { tab: first, expected, next } = mountEditor();
    await act(async () => { await first.result.current.persistence.persistVerifiedLayout(expected, next, () => {}); });
    first.unmount();
    layoutStore.setState({ layout: makeLayout({ id: 'fallback' }), activeFloorIndex: 0 });
    const reopened = renderHook(() => {
      const state = useLayoutState();
      return { ...state, persistence: useLayoutPersistence({ layout: state.layout, onHydrate: state.actions.applyLayout, debounceMs: 100 }) };
    });
    const current = reopened.result.current.layout;
    const write = vi.spyOn(Storage.prototype, 'setItem');
    await act(async () => { await reopened.result.current.persistence.persistVerifiedLayout(current, current, () => {}); });
    expect(write).not.toHaveBeenCalled();
    act(() => reopened.result.current.actions.setWidth(12));
    settleOldSave();
    expect(loadLayout()?.width).toBe(12);
    expect(loadLayout()?.eventOperations).toEqual(operations);
  });

  it('resumes the newer geometry immediately after read-only confirmation when the tasks already match', async () => {
    const initial = makeLayout({ id: 'task-rehearsal', width: 10, eventOperations: operations });
    const { tab } = mountEditor(initial);
    act(() => tab.result.current.actions.setWidth(11));
    const expected = tab.result.current.layout;
    const write = vi.spyOn(Storage.prototype, 'setItem');
    await act(async () => { await tab.result.current.persistence.persistVerifiedLayout(expected, initial, () => {}); });
    expect(write).not.toHaveBeenCalled();
    expect(tab.result.current.layout).toBe(expected);
    expect(tab.result.current.persistence.saving).toBe(true);
    expect(loadLayout()?.width).toBe(10);
    act(() => { vi.advanceTimersByTime(100); });
    expect(loadLayout()?.width).toBe(11);
    expect(loadLayout()?.eventOperations).toEqual(operations);
    act(() => tab.result.current.actions.setWidth(12));
    settleOldSave();
    expect(loadLayout()?.width).toBe(12);
    expect(loadLayout()?.eventOperations?.tasks.map(task => task.id)).toEqual(operations.tasks.map(task => task.id));
  });

  it('waits for verified tasks to enter the current geometry, then autosaves that geometry without new task IDs', async () => {
    const oldOperations = eventOperationsSchema.parse({ dataKind: 'rehearsal', tasks: [{
      id: 'a1000000-0000-4000-8000-000000000003', title: '原演练任务', phase: 'event', objectIds: [],
    }] });
    const newOperations = { ...oldOperations, tasks: [...oldOperations.tasks, ...operations.tasks] };
    const stored = makeLayout({ id: 'task-rehearsal', width: 10, eventOperations: newOperations });
    const { tab, onHydrate } = mountEditor(stored);
    act(() => { tab.result.current.actions.setEventOperations(oldOperations); tab.result.current.actions.setWidth(11); });
    const expected = tab.result.current.layout;
    const write = vi.spyOn(Storage.prototype, 'setItem');
    let verified!: RoomLayout;
    await act(async () => { verified = await tab.result.current.persistence.persistVerifiedLayout(expected, stored, () => {}); });
    expect(write).not.toHaveBeenCalled();
    settleOldSave();
    expect(write).not.toHaveBeenCalled();
    expect(loadLayout()).toEqual(stored);
    expect(tab.result.current.layout).toBe(expected);
    expect(tab.result.current.layout.eventOperations).toEqual(oldOperations);
    act(() => tab.result.current.actions.setEventOperations(verified.eventOperations!));
    expect(tab.result.current.layout.width).toBe(11);
    expect(tab.result.current.persistence.saving).toBe(true);
    act(() => { vi.advanceTimersByTime(100); });
    expect(loadLayout()?.width).toBe(11);
    expect(loadLayout()?.eventOperations).toEqual(newOperations);
    expect(loadLayout()?.eventOperations?.tasks.map(task => task.id)).toEqual(newOperations.tasks.map(task => task.id));
    expect(onHydrate).toHaveBeenCalledTimes(1);
    expect(write.mock.calls.filter(([key]) => key === STORAGE_KEY)).toHaveLength(1);
    expect(localStorage.getItem(VERSION_HISTORY_STORAGE_KEY)).not.toBeNull();
  });

  it.each(['undefined before', 'existing before', 'already pending'] as const)('recovers a committed task in the same mount with newer geometry and %s operations', async mode => {
    const before = eventOperationsSchema.parse({ dataKind: 'rehearsal', tasks: [{
      id: 'a1000000-0000-4000-8000-000000000003', title: '原演练任务', phase: 'event', objectIds: [],
    }] });
    const initial = makeLayout({ id: 'same-mount-rehearsal', width: 10, ...(mode === 'existing before' ? { eventOperations: before } : {}) });
    const editor = mountEditor(initial);
    const newOperations = mode === 'existing before' ? { ...before, tasks: [...before.tasks, ...operations.tasks] } : operations;
    const next = { ...editor.expected, eventOperations: newOperations };
    await loseReadbackAfterCommit({ ...editor, next });
    act(() => {
      editor.tab.result.current.actions.setWidth(11);
      if (mode === 'already pending') editor.tab.result.current.actions.setEventOperations(newOperations);
    });
    settleOldSave();
    expect(loadLayout()).toEqual(next);
    const expected = editor.tab.result.current.layout;
    const write = vi.spyOn(Storage.prototype, 'setItem');
    let verified!: RoomLayout;
    await act(async () => { verified = await editor.tab.result.current.persistence.persistVerifiedLayout(expected, loadLayout()!, () => {}); });
    expect(write).not.toHaveBeenCalled();
    expect(editor.tab.result.current.layout).toBe(expected);
    if (mode !== 'already pending') {
      settleOldSave();
      expect(write).not.toHaveBeenCalled();
      act(() => editor.tab.result.current.actions.setEventOperations(verified.eventOperations!));
    }
    expect(editor.tab.result.current.layout.width).toBe(11);
    expect(editor.tab.result.current.persistence.saving).toBe(true);
    act(() => { vi.advanceTimersByTime(100); });
    expect(loadLayout()?.width).toBe(11);
    expect(loadLayout()?.eventOperations).toEqual(newOperations);
    act(() => editor.tab.result.current.actions.setWidth(12));
    settleOldSave();
    expect(loadLayout()?.width).toBe(12);
    expect(loadLayout()?.eventOperations?.tasks.map(task => task.id)).toEqual(newOperations.tasks.map(task => task.id));
    expect(editor.onHydrate).toHaveBeenCalledTimes(1);
    expect(write.mock.calls.filter(([key]) => key === STORAGE_KEY)).toHaveLength(2);
  });

  it.each(['manual task', 'empty instead of undefined', 'different proposal', 'external stored geometry', 'other activity'] as const)(
    'refuses same-mount recovery after %s without redefining the original before-state', async change => {
      const before = eventOperationsSchema.parse({ dataKind: 'rehearsal', tasks: [{
        id: 'a1000000-0000-4000-8000-000000000003', title: '原演练任务', phase: 'event', objectIds: [],
      }] });
      const initial = makeLayout({ id: 'same-mount-rehearsal', width: 10, ...(change === 'manual task' ? { eventOperations: before } : {}) });
      const editor = mountEditor(initial);
      const newOperations = change === 'manual task' ? { ...before, tasks: [...before.tasks, ...operations.tasks] } : operations;
      const next = { ...editor.expected, eventOperations: newOperations };
      await loseReadbackAfterCommit({ ...editor, next });
      act(() => {
        editor.tab.result.current.actions.setWidth(11);
        if (change === 'manual task') editor.tab.result.current.actions.setEventOperations({ ...before, tasks: [{ ...before.tasks[0]!, title: '人工新内容' }] });
        if (change === 'empty instead of undefined') editor.tab.result.current.actions.setEventOperations(eventOperationsSchema.parse({ dataKind: 'rehearsal', tasks: [] }));
      });
      let target = next;
      if (change === 'different proposal') target = { ...next, eventOperations: { ...newOperations, tasks: newOperations.tasks.map(task => ({ ...task, title: '另一份建议' })) } };
      if (change === 'external stored geometry') localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...next, width: 20 }));
      if (change === 'other activity') target = { ...next, id: 'other-activity' };
      const raw = localStorage.getItem(STORAGE_KEY);
      const expected = editor.tab.result.current.layout;
      const write = vi.spyOn(Storage.prototype, 'setItem');
      await act(async () => { await expect(editor.tab.result.current.persistence.persistVerifiedLayout(expected, target, () => {})).rejects.toThrow(); });
      settleOldSave();
      expect(write).not.toHaveBeenCalled();
      expect(localStorage.getItem(STORAGE_KEY)).toBe(raw);
      expect(editor.tab.result.current.layout).toBe(expected);
      if (change === 'manual task') {
        await act(async () => { await expect(editor.tab.result.current.persistence.persistVerifiedLayout(expected, next, () => {})).rejects.toThrow('原任务已有新变化'); });
        act(() => editor.tab.result.current.actions.setEventOperations(before));
        const restoredBefore = editor.tab.result.current.layout;
        await act(async () => { await editor.tab.result.current.persistence.persistVerifiedLayout(restoredBefore, next, () => {}); });
        expect(write).not.toHaveBeenCalled();
        act(() => editor.tab.result.current.actions.setEventOperations(newOperations));
        act(() => { vi.advanceTimersByTime(100); });
        expect(loadLayout()?.width).toBe(11);
        expect(loadLayout()?.eventOperations).toEqual(newOperations);
      }
    },
  );

  it('does not relax the original expected reference for a failed write which never committed', async () => {
    const editor = mountEditor(makeLayout({ id: 'same-mount-rehearsal', width: 10 }));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const failed = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('blocked write', 'SecurityError'); });
    await act(async () => { await expect(editor.tab.result.current.persistence.persistVerifiedLayout(editor.expected, editor.next, () => {})).rejects.toThrow('任务未保存'); });
    failed.mockRestore();
    act(() => editor.tab.result.current.actions.setWidth(11));
    const current = editor.tab.result.current.layout;
    const write = vi.spyOn(Storage.prototype, 'setItem');
    await act(async () => { await expect(editor.tab.result.current.persistence.persistVerifiedLayout(current, editor.next, () => {})).rejects.toThrow('保存尚未读回'); });
    settleOldSave();
    expect(write).not.toHaveBeenCalled();
    expect(loadLayout()?.width).toBe(10);
    expect(loadLayout()?.eventOperations).toBeUndefined();
  });
});

describe('useLayoutPersistence — persistent activity identity', () => {
  beforeEach(() => { localStorage.clear(); window.history.replaceState(null, '', '/'); vi.useFakeTimers(); });
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });
  const mountEditor = () => renderHook(() => {
    const state = useLayoutState();
    const persistence = useLayoutPersistence({ layout: state.layout, onHydrate: state.actions.applyLayout, debounceMs: 100 });
    return { ...state, persistence };
  });

  it('persists a fresh identity without a scene edit and reopens the same activity', () => {
    const initial = withHouseId(makeLayout());
    layoutStore.setState({ layout: initial, activeFloorIndex: 0 });
    const first = mountEditor();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    const writes = vi.spyOn(Storage.prototype, 'setItem');
    act(() => first.result.current.persistence.ensurePersistentIdentity());
    expect(loadLayout()).toEqual(initial);
    expect(first.result.current.layout).toBe(initial);
    expect(first.result.current.persistence.saving).toBe(false);
    expect(first.result.current.persistence.lastSavedAt).not.toBeNull();
    expect(localStorage.getItem(VERSION_HISTORY_STORAGE_KEY)).toBeNull();
    act(() => { vi.advanceTimersByTime(100); window.dispatchEvent(new Event('pagehide')); });
    expect(writes.mock.calls.filter(([key]) => key === STORAGE_KEY)).toHaveLength(1);
    first.unmount();
    layoutStore.setState({ layout: withHouseId(makeLayout()), activeFloorIndex: 0 });
    const reopened = mountEditor();
    expect(reopened.result.current.layout.id).toBe(initial.id);
  });

  it('persists the identity minted while hydrating an old ID-less layout', () => {
    const legacy = makeLayout({ name: '旧版演练活动' });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(legacy));
    layoutStore.setState({ layout: withHouseId(makeLayout()), activeFloorIndex: 0 });
    const tab = mountEditor();
    const hydrated = tab.result.current.layout;
    expect(hydrated.id).toMatch(/^house-/);
    act(() => { vi.advanceTimersByTime(100); });
    expect(loadLayout()?.id).toBeUndefined();
    act(() => tab.result.current.persistence.ensurePersistentIdentity());
    expect(loadLayout()).toEqual(hydrated);
    expect(localStorage.getItem(VERSION_HISTORY_STORAGE_KEY)).toBeNull();
    expect(tab.result.current.persistence.saving).toBe(false);
  });

  it('only verifies an existing identity and leaves ordinary geometry edits on their original autosave', () => {
    const saved = makeLayout({ id: 'same-activity' });
    const raw = JSON.stringify(saved);
    localStorage.setItem(STORAGE_KEY, raw);
    layoutStore.setState({ layout: withHouseId(makeLayout()), activeFloorIndex: 0 });
    const tab = mountEditor();
    act(() => tab.result.current.actions.setWidth(9));
    const writes = vi.spyOn(Storage.prototype, 'setItem');
    act(() => tab.result.current.persistence.ensurePersistentIdentity());
    expect(localStorage.getItem(STORAGE_KEY)).toBe(raw);
    expect(writes).not.toHaveBeenCalled();
    expect(tab.result.current.persistence.saving).toBe(true);
    expect(tab.result.current.persistence.lastSavedAt).toBeNull();
    act(() => { vi.advanceTimersByTime(100); });
    expect(loadLayout()?.width).toBe(9);
  });

  it.each([
    ['QuotaExceededError', 'quota'],
    ['SecurityError', 'blocked'],
  ] as const)('refuses %s without pretending to save, then permits an explicit retry', (name, reason) => {
    layoutStore.setState({ layout: withHouseId(makeLayout()), activeFloorIndex: 0 });
    const tab = mountEditor();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('test failure', name); });
    act(() => expect(() => tab.result.current.persistence.ensurePersistentIdentity()).toThrow('活动未保存到本机'));
    expect(tab.result.current.persistence.saveError).toBe(reason);
    expect(tab.result.current.persistence.lastSavedAt).toBeNull();
    act(() => { vi.advanceTimersByTime(100); window.dispatchEvent(new Event('pagehide')); });
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    write.mockRestore();
    act(() => tab.result.current.persistence.ensurePersistentIdentity());
    expect(loadLayout()?.id).toBe(tab.result.current.layout.id);
    expect(tab.result.current.persistence.saveError).toBeNull();
    expect(tab.result.current.persistence.saving).toBe(false);
  });

  it('refuses a read failure and never treats unreadable storage as an empty fresh activity', () => {
    layoutStore.setState({ layout: withHouseId(makeLayout()), activeFloorIndex: 0 });
    const tab = mountEditor();
    const read = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('test blocked', 'SecurityError'); });
    const write = vi.spyOn(Storage.prototype, 'setItem');
    act(() => expect(() => tab.result.current.persistence.ensurePersistentIdentity()).toThrow('无法读取本机存档'));
    expect(tab.result.current.persistence.saveError).toBe('blocked');
    expect(tab.result.current.persistence.lastSavedAt).toBeNull();
    expect(write).not.toHaveBeenCalled();
    read.mockRestore();
    act(() => tab.result.current.persistence.ensurePersistentIdentity());
    expect(loadLayout()?.id).toBe(tab.result.current.layout.id);
  });

  it('refuses a silent write failure until a strict write and readback both succeed', () => {
    layoutStore.setState({ layout: withHouseId(makeLayout()), activeFloorIndex: 0 });
    const tab = mountEditor();
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {});
    act(() => expect(() => tab.result.current.persistence.ensurePersistentIdentity()).toThrow('回读不一致'));
    expect(tab.result.current.persistence.saveError).toBe('unknown');
    expect(tab.result.current.persistence.lastSavedAt).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    write.mockRestore();
    act(() => tab.result.current.persistence.ensurePersistentIdentity());
    expect(loadLayout()?.id).toBe(tab.result.current.layout.id);
    expect(tab.result.current.persistence.saveError).toBeNull();
  });

  it('refuses a concurrent readback replacement and leaves that other activity untouched', () => {
    const current = withHouseId(makeLayout());
    const foreign = JSON.stringify({ ...current, id: 'other-activity' });
    layoutStore.setState({ layout: current, activeFloorIndex: 0 });
    const tab = mountEditor();
    const original = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      original.call(this, key, key === STORAGE_KEY ? foreign : value);
    });
    act(() => expect(() => tab.result.current.persistence.ensurePersistentIdentity()).toThrow('回读不一致'));
    expect(tab.result.current.persistence.lastSavedAt).toBeNull();
    expect(tab.result.current.persistence.saveError).toBe('unknown');
    act(() => { vi.advanceTimersByTime(100); window.dispatchEvent(new Event('pagehide')); });
    expect(localStorage.getItem(STORAGE_KEY)).toBe(foreign);
    expect(tab.result.current.layout).toBe(current);
  });

  it('never acknowledges a write whose readback was blocked', () => {
    const current = withHouseId(makeLayout());
    layoutStore.setState({ layout: current, activeFloorIndex: 0 });
    const tab = mountEditor();
    const original = Storage.prototype.getItem;
    let reads = 0;
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, key) {
      if (key === STORAGE_KEY && ++reads === 2) throw new DOMException('blocked readback', 'SecurityError');
      return original.call(this, key);
    });
    act(() => expect(() => tab.result.current.persistence.ensurePersistentIdentity()).toThrow('无法回读'));
    expect(tab.result.current.persistence.lastSavedAt).toBeNull();
    expect(tab.result.current.persistence.saveError).toBe('blocked');
    expect(tab.result.current.persistence.saving).toBe(false);
    expect(loadLayout()?.id).toBe(current.id);
  });

  it('refuses a different persistent ID even when both activities have identical geometry', () => {
    const current = withHouseId(makeLayout());
    layoutStore.setState({ layout: current, activeFloorIndex: 0 });
    const tab = mountEditor();
    const foreign = JSON.stringify({ ...current, id: 'other-activity' });
    localStorage.setItem(STORAGE_KEY, foreign);
    act(() => expect(() => tab.result.current.persistence.ensurePersistentIdentity()).toThrow('已切换活动'));
    act(() => { vi.advanceTimersByTime(100); window.dispatchEvent(new Event('pagehide')); });
    expect(localStorage.getItem(STORAGE_KEY)).toBe(foreign);
    expect(tab.result.current.persistence.lastSavedAt).toBeNull();
  });

  it('refuses an ID-less replacement that is no longer the hydrated activity', () => {
    const legacy = makeLayout({ name: '原演练' });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(legacy));
    layoutStore.setState({ layout: withHouseId(makeLayout()), activeFloorIndex: 0 });
    const tab = mountEditor();
    const foreign = JSON.stringify({ ...legacy, name: '其他页面的演练' });
    localStorage.setItem(STORAGE_KEY, foreign);
    act(() => expect(() => tab.result.current.persistence.ensurePersistentIdentity()).toThrow('已变化'));
    expect(localStorage.getItem(STORAGE_KEY)).toBe(foreign);
  });

  it('waits for the actual local hydration dispatch before persisting an ID-less activity', () => {
    const legacy = makeLayout();
    const raw = JSON.stringify(legacy);
    localStorage.setItem(STORAGE_KEY, raw);
    const tab = renderHook(({ layout }) => useLayoutPersistence({ layout, onHydrate: () => {}, debounceMs: 100 }), {
      initialProps: { layout: withHouseId(makeLayout()) },
    });
    act(() => expect(() => tab.result.current.ensurePersistentIdentity()).toThrow('仍在载入'));
    expect(localStorage.getItem(STORAGE_KEY)).toBe(raw);
    const hydrated = withHouseId(legacy);
    tab.rerender({ layout: hydrated });
    act(() => tab.result.current.ensurePersistentIdentity());
    expect(loadLayout()?.id).toBe(hydrated.id);
  });

  it('refuses a corrupt main save even if a recovery copy was successfully kept', () => {
    const raw = '{unreadable activity';
    localStorage.setItem(STORAGE_KEY, raw);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    layoutStore.setState({ layout: withHouseId(makeLayout()), activeFloorIndex: 0 });
    const tab = mountEditor();
    expect(readRecoveryCopies().map(copy => copy.raw)).toEqual([raw]);
    act(() => expect(() => tab.result.current.persistence.ensurePersistentIdentity()).toThrow('无法核对'));
    act(() => { vi.advanceTimersByTime(100); window.dispatchEvent(new Event('pagehide')); });
    expect(localStorage.getItem(STORAGE_KEY)).toBe(raw);
  });

  it('does not release a held corrupt main save when its only recovery copy still cannot be stored', () => {
    const raw = '{unreadable activity';
    localStorage.setItem(STORAGE_KEY, raw);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const original = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (isRecoveryKey(key)) throw new DOMException('full', 'QuotaExceededError');
      original.call(this, key, value);
    });
    layoutStore.setState({ layout: withHouseId(makeLayout()), activeFloorIndex: 0 });
    const tab = mountEditor();
    act(() => expect(() => tab.result.current.persistence.ensurePersistentIdentity()).toThrow('尚未安全保留'));
    act(() => {
      vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
      document.dispatchEvent(new Event('visibilitychange'));
    });
    act(() => { vi.advanceTimersByTime(100); window.dispatchEvent(new Event('pagehide')); });
    expect(localStorage.getItem(STORAGE_KEY)).toBe(raw);
    expect(readRecoveryCopies()).toEqual([]);
    expect(tab.result.current.persistence.lastSavedAt).toBeNull();
  });
});

describe('useLayoutPersistence — activity metadata', () => {
  const operations = eventOperationsSchema.parse({ dataKind: 'rehearsal', tasks: [{
    id: 'a1000000-0000-4000-8000-000000000001', title: '签到', phase: 'event', objectIds: [],
    plannedStartAt: '2026-10-09T09:00:00+08:00', plannedEndAt: '2026-10-09T09:30:00+08:00',
    actualStartedAt: '2026-10-09T09:05:00+08:00', actualFinishedAt: '2026-10-09T09:35:00+08:00',
    ownerName: '签到团队', contractorName: '执行团队', acceptance: '登记记录核对', status: 'accepted',
    evidenceNote: '已人工核对签到记录', evidenceUrls: ['https://example.com/signin'],
    reviewedBasis: `sha256:${'a'.repeat(64)}`,
  }] });
  beforeEach(() => { window.localStorage.clear(); window.history.replaceState(null, '', '/'); vi.useFakeTimers(); });
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

  it('flushes a pending edit on visibility hidden without needing pagehide or the debounce', () => {
    const initial = makeLayout({ id: 'hidden-activity', width: 10 });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(initial));
    layoutStore.setState({ layout: initial, activeFloorIndex: 0 });
    const editor = renderHook(() => {
      const state = useLayoutState();
      return { ...state, persistence: useLayoutPersistence({ layout: state.layout, onHydrate: state.actions.applyLayout, debounceMs: 1500 }) };
    });
    act(() => editor.result.current.actions.setWidth(11));
    const write = vi.spyOn(Storage.prototype, 'setItem');
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(loadLayout()?.width).toBe(10);
    expect(write).not.toHaveBeenCalled();
    visibility.mockReturnValue('hidden');
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(loadLayout()?.width).toBe(11);
    expect(editor.result.current.persistence.saving).toBe(false);
    expect(editor.result.current.persistence.lastSavedAt).not.toBeNull();
    expect(editor.result.current.persistence.saveError).toBeNull();
    act(() => { vi.advanceTimersByTime(1500); window.dispatchEvent(new Event('pagehide')); });
    expect(write.mock.calls.filter(([key]) => key === STORAGE_KEY)).toHaveLength(1);
  });

  it.each([
    ['QuotaExceededError', 'quota', 'hidden'], ['SecurityError', 'blocked', 'hidden'],
    ['QuotaExceededError', 'quota', 'timer'], ['SecurityError', 'blocked', 'timer'],
  ] as const)('keeps a failed %s hidden save pending until a %s retry succeeds (%s)', (name, reason, retry) => {
    const initial = makeLayout({ id: 'hidden-retry-activity', width: 10 });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(initial));
    layoutStore.setState({ layout: initial, activeFloorIndex: 0 });
    const editor = renderHook(() => {
      const state = useLayoutState();
      return { ...state, persistence: useLayoutPersistence({ layout: state.layout, onHydrate: state.actions.applyLayout, debounceMs: 1500 }) };
    });
    act(() => editor.result.current.actions.setWidth(11));
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const failedWrite = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('test failure', name); });
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(loadLayout()?.width).toBe(10);
    expect(editor.result.current.persistence.saving).toBe(true);
    expect(editor.result.current.persistence.lastSavedAt).toBeNull();
    expect(editor.result.current.persistence.saveError).toBe(reason);
    failedWrite.mockRestore();
    const successfulWrite = vi.spyOn(Storage.prototype, 'setItem');
    act(() => {
      if (retry === 'hidden') document.dispatchEvent(new Event('visibilitychange'));
      else vi.advanceTimersByTime(1500);
    });
    expect(loadLayout()?.width).toBe(11);
    expect(editor.result.current.persistence.saving).toBe(false);
    expect(editor.result.current.persistence.lastSavedAt).not.toBeNull();
    expect(editor.result.current.persistence.saveError).toBeNull();
    act(() => { vi.advanceTimersByTime(1500); document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('pagehide')); });
    expect(successfulWrite.mock.calls.filter(([key]) => key === STORAGE_KEY)).toHaveLength(1);
  });

  it('does not let an older layout debounce overwrite a verified file restore or pagehide', () => {
    const initial = makeLayout({ id: 'activity-a' });
    const restored = makeLayout({ id: 'activity-b', eventOperations: operations });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(initial));
    layoutStore.setState({ layout: initial, activeFloorIndex: 0 });
    const editor = renderHook(() => {
      const state = useLayoutState();
      const persistence = useLayoutPersistence({ layout: state.layout, onHydrate: state.actions.applyLayout, debounceMs: 250 });
      return { ...state, persistence };
    });
    act(() => { editor.result.current.actions.setName('尚在旧保存窗口中的演练输入'); });
    act(() => { vi.advanceTimersByTime(100); });
    act(() => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(restored));
      editor.result.current.actions.applyLayout(restored);
      editor.result.current.persistence.acknowledgeRestoredLayout(layoutStore.getState().layout, JSON.stringify(restored));
    });
    act(() => {
      vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
      document.dispatchEvent(new Event('visibilitychange'));
    });
    act(() => { vi.advanceTimersByTime(1000); window.dispatchEvent(new Event('pagehide')); });
    expect(loadLayout()).toEqual(restored);
    expect(editor.result.current.persistence.saving).toBe(false);
    expect(editor.result.current.persistence.saveError).toBeNull();
    editor.unmount(); expect(loadLayout()).toEqual(restored);
  });

  it('flushes pending activity edits on close and hydrates the same geometry and metadata on reopen', () => {
    layoutStore.setState({ layout: makeLayout({ id: 'rehearsal-30' }), activeFloorIndex: 0 });
    const mount = () => renderHook(() => {
      const state = useLayoutState();
      const persistence = useLayoutPersistence({ layout: state.layout, onHydrate: state.actions.applyLayout, debounceMs: 10 });
      return { ...state, persistence };
    });
    const first = mount();
    act(() => { first.result.current.actions.setEventOperations(operations); first.result.current.actions.setWidth(9); });
    const edited = layoutStore.getState().layout;
    first.unmount();
    expect(loadLayout()).toEqual(edited);
    layoutStore.setState({ layout: makeLayout({ id: 'fallback' }), activeFloorIndex: 0 });
    const second = mount();
    expect(second.result.current.layout).toEqual(edited);
    expect(second.result.current.layout.eventOperations).toEqual(operations);
    second.unmount();
  });

  it('shows failed saving and leaves the previously saved record and current activity draft intact', () => {
    const saved = makeLayout({ id: 'rehearsal-30', eventOperations: operations });
    const tab = renderHook(({ layout }) => useLayoutPersistence({ layout, onHydrate: () => {}, debounceMs: 10 }), {
      initialProps: { layout: saved },
    });
    act(() => { vi.advanceTimersByTime(10); });
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const savedAt = tab.result.current.lastSavedAt;
    const draft = { ...saved, eventOperations: { ...operations, dataKind: 'real' as const } };
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('blocked', 'SecurityError'); });
    tab.rerender({ layout: draft });
    act(() => { vi.advanceTimersByTime(10); });
    expect(tab.result.current.saveError).toBe('blocked');
    expect(tab.result.current.saving).toBe(true);
    expect(tab.result.current.lastSavedAt).toBe(savedAt);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(raw);
    expect(draft.eventOperations.dataKind).toBe('real');
  });
});

function fireStorage(key: string, newValue: string | null): void {
  window.dispatchEvent(new StorageEvent('storage', { key, newValue }));
}

describe('useLayoutPersistence — cross-tab guard (#123)', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  const setup = () =>
    renderHook(() =>
      useLayoutPersistence({
        layout: makeLayout({ name: 'This tab' }),
        onHydrate: () => {},
        debounceMs: 60_000,
      })
    );

  it('surfaces a valid layout saved by another tab', () => {
    const { result } = setup();
    expect(result.current.remoteLayout).toBeNull();
    const remote = makeLayout({ name: 'Other tab' });
    act(() => fireStorage(STORAGE_KEY, JSON.stringify(remote)));
    expect(result.current.remoteLayout).toEqual(remote);
  });

  it('ignores writes to other keys, removals, and unreadable payloads', () => {
    const { result } = setup();
    act(() => fireStorage('some-other-key', JSON.stringify(makeLayout())));
    act(() => fireStorage(STORAGE_KEY, null));
    act(() => fireStorage(STORAGE_KEY, '{not json'));
    act(() => fireStorage(STORAGE_KEY, JSON.stringify({ width: 5 })));
    expect(result.current.remoteLayout).toBeNull();
  });

  it('clearRemoteLayout dismisses the notice', () => {
    const { result } = setup();
    act(() => fireStorage(STORAGE_KEY, JSON.stringify(makeLayout({ name: 'Other tab' }))));
    expect(result.current.remoteLayout).not.toBeNull();
    act(() => result.current.clearRemoteLayout());
    expect(result.current.remoteLayout).toBeNull();
  });
});

describe('useLayoutPersistence — no ping-pong between tabs (#334)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.useFakeTimers();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  const DEBOUNCE = 50;
  const mountTab = (initial: RoomLayout) =>
    renderHook(({ layout }) => useLayoutPersistence({ layout, onHydrate: () => {}, debounceMs: DEBOUNCE }), {
      initialProps: { layout: initial },
    });

  /** Let the debounced autosave land, then deliver the write as the browser would. */
  const saveAndBroadcast = (): void => {
    act(() => {
      vi.advanceTimersByTime(DEBOUNCE);
    });
    // jsdom fires no storage events. The real one reaches only the OTHER tab;
    // delivering it to both also proves a tab ignores its own echo.
    act(() => fireStorage(STORAGE_KEY, window.localStorage.getItem(STORAGE_KEY)));
  };

  it('ignores the echo of a house this tab already shows, in both directions', () => {
    const tabA = mountTab(makeLayout({ name: 'Edited in A' }));
    const tabB = mountTab(makeLayout({ name: 'Old' }));
    act(() => {
      vi.advanceTimersByTime(DEBOUNCE);
    });
    tabA.rerender({ layout: makeLayout({ name: 'Edited in A', width: 9 }) });
    saveAndBroadcast();
    expect(tabA.result.current.remoteLayout).toBeNull();
    const offered = tabB.result.current.remoteLayout;
    expect(offered?.width).toBe(9);

    // B adopts: a fresh object with the same content, autosaved straight back.
    tabB.rerender({ layout: { ...offered! } });
    act(() => tabB.result.current.clearRemoteLayout());
    saveAndBroadcast();
    expect(tabA.result.current.remoteLayout).toBeNull();
    expect(tabB.result.current.remoteLayout).toBeNull();

    // The other way round: B edits, A adopts, and B must not be bounced.
    tabB.rerender({ layout: makeLayout({ name: 'Edited in A', width: 11 }) });
    saveAndBroadcast();
    expect(tabB.result.current.remoteLayout).toBeNull();
    const back = tabA.result.current.remoteLayout;
    expect(back?.width).toBe(11);
    tabA.rerender({ layout: { ...back! } });
    act(() => tabA.result.current.clearRemoteLayout());
    saveAndBroadcast();
    expect(tabA.result.current.remoteLayout).toBeNull();
    expect(tabB.result.current.remoteLayout).toBeNull();
  });

  it('withdraws a notice once storage goes back to what this tab wrote', () => {
    const shown = makeLayout({ name: 'X' });
    const tabA = mountTab(shown);
    const tabB = mountTab(shown);
    act(() => {
      vi.advanceTimersByTime(DEBOUNCE);
    });
    // B edits to W: A is offered W.
    tabB.rerender({ layout: makeLayout({ name: 'W' }) });
    saveAndBroadcast();
    expect(tabA.result.current.remoteLayout?.name).toBe('W');
    // B undoes back to X, writing exactly the JSON A last saved: the offer is stale.
    tabB.rerender({ layout: { ...shown } });
    saveAndBroadcast();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(JSON.stringify(shown));
    expect(tabA.result.current.remoteLayout).toBeNull();
    expect(tabB.result.current.remoteLayout).toBeNull();
  });

  it('treats the same house written with a different key order as no change', () => {
    const shown = makeLayout({ name: 'Same' });
    const tab = mountTab(shown);
    const { name, ...rest } = shown;
    act(() => fireStorage(STORAGE_KEY, JSON.stringify({ ...rest, name })));
    expect(tab.result.current.remoteLayout).toBeNull();
  });

  it('treats the same house under another id as no change — two tabs on a fresh lot', () => {
    const tab = mountTab(makeLayout({ id: 'tab-a' }));
    act(() => fireStorage(STORAGE_KEY, JSON.stringify(makeLayout({ id: 'tab-b' }))));
    expect(tab.result.current.remoteLayout).toBeNull();
    act(() => fireStorage(STORAGE_KEY, JSON.stringify(makeLayout({ id: 'tab-b', width: 9 }))));
    expect(tab.result.current.remoteLayout?.width).toBe(9);
  });

  it('withdraws a pending notice once the other tab writes what this tab shows', () => {
    const shown = makeLayout({ name: 'Mine' });
    const tab = mountTab(shown);
    act(() => fireStorage(STORAGE_KEY, JSON.stringify(makeLayout({ name: 'Theirs' }))));
    expect(tab.result.current.remoteLayout).not.toBeNull();
    act(() => fireStorage(STORAGE_KEY, JSON.stringify(shown)));
    expect(tab.result.current.remoteLayout).toBeNull();
  });
});

describe('useLayoutPersistence — reload marker (#336)', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    vi.useFakeTimers();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  const mount = () =>
    renderHook(() => useLayoutPersistence({ layout: makeLayout(), onHydrate: () => {}, debounceMs: 60_000 }));

  it('clears the marker once the editor has stayed up', () => {
    noteReloadAttempt(Date.now());
    mount();
    act(() => {
      vi.advanceTimersByTime(EDITOR_SETTLED_MS);
    });
    expect(crashRecurredAfterReload()).toBe(false);
  });

  it('leaves the marker when the editor goes down before settling', () => {
    noteReloadAttempt(Date.now());
    const tab = mount();
    act(() => {
      vi.advanceTimersByTime(EDITOR_SETTLED_MS / 2);
    });
    tab.unmount();
    act(() => {
      vi.advanceTimersByTime(EDITOR_SETTLED_MS);
    });
    expect(crashRecurredAfterReload()).toBe(true);
  });
});

describe('useLayoutPersistence — save failure reason (#472)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.useFakeTimers();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it.each([
    ['QuotaExceededError', 'quota'],
    ['SecurityError', 'blocked'],
  ] as const)('reports %s as %s and clears it after a good save', (name, reason) => {
    const failure = new Error(name);
    Object.defineProperty(failure, 'name', { value: name });
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw failure;
    });
    const tab = renderHook(({ layout }) => useLayoutPersistence({ layout, onHydrate: () => {}, debounceMs: 10 }), {
      initialProps: { layout: makeLayout() },
    });
    act(() => {
      vi.advanceTimersByTime(10);
    });
    expect(tab.result.current.saveError).toBe(reason);
    spy.mockRestore();
    tab.rerender({ layout: makeLayout({ width: 9 }) });
    act(() => {
      vi.advanceTimersByTime(10);
    });
    expect(tab.result.current.saveError).toBeNull();
  });
});

describe('useLayoutPersistence — an unreadable save that cannot be copied (#336)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.useFakeTimers();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('never writes over it, shows the failure, and resumes once a copy fits', () => {
    window.localStorage.setItem(STORAGE_KEY, '{unreadable house');
    const quota = new Error('full');
    Object.defineProperty(quota, 'name', { value: 'QuotaExceededError' });
    const original = Storage.prototype.setItem;
    let full = true;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
      if (full && isRecoveryKey(key)) throw quota;
      original.call(this, key, value);
    });
    const tab = renderHook(({ layout }) => useLayoutPersistence({ layout, onHydrate: () => {}, debounceMs: 10 }), {
      initialProps: { layout: makeLayout() },
    });
    expect(tab.result.current.saveError).toBe('quota');
    act(() => {
      vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('{unreadable house');
    act(() => {
      vi.advanceTimersByTime(10);
    });
    expect(tab.result.current.saveError).toBe('quota');
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('{unreadable house');

    tab.rerender({ layout: makeLayout({ width: 9 }) });
    act(() => {
      vi.advanceTimersByTime(10);
    });
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('{unreadable house');
    // Nor may the page going away write over it.
    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('{unreadable house');

    full = false;
    tab.rerender({ layout: makeLayout({ width: 10 }) });
    act(() => {
      vi.advanceTimersByTime(10);
    });
    expect(tab.result.current.saveError).toBeNull();
    expect(readRecoveryCopies().map(({ raw }) => raw)).toEqual(['{unreadable house']);
    expect(loadLayout()?.width).toBe(10);
  });
});
