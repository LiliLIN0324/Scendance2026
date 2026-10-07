// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eventOperationsSchema } from '../../../../supabase/functions/_shared/event-operations-contract';
import { makeLayout } from '../lib/__testfixtures__/fixtures';
import { STORAGE_KEY } from '../lib/constants';
import {
  EDITOR_SETTLED_MS,
  crashRecurredAfterReload,
  isRecoveryKey,
  loadLayout,
  noteReloadAttempt,
  readRecoveryCopies,
} from '../lib/persistence';
import { useLayoutPersistence } from './use-layout-persistence';
import { layoutStore } from './use-layout-store';
import { useLayoutState } from './use-layout-state';
import type { RoomLayout } from '../lib/types';

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
