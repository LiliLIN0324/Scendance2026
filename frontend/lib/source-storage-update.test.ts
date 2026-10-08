import { afterEach, describe, expect, it, vi } from 'vitest';
import { listSourceRecords, subscribeSourceChanges, subscribeSourceRecordChanges, updateSourceForm } from './source-storage';

/** Transaction harness checks callback timing; native cross-tab serialization is verified in the browser. */
function database(initial: unknown, failCommit = false, expectedKey: string | [string, string] = 'project:checkins') {
  let stored = structuredClone(initial), proposed: unknown;
  const close = vi.fn();
  const transaction = {
    oncomplete: undefined as undefined | (() => void), onerror: undefined as undefined | (() => void),
    onabort: undefined as undefined | (() => void), error: null as Error | null,
    abort: vi.fn(() => queueMicrotask(() => transaction.onabort?.())),
    objectStore: vi.fn(() => store),
  };
  const store = {
    get: vi.fn(() => {
      const request = { result: structuredClone(stored), error: null, onsuccess: undefined as undefined | (() => void) };
      queueMicrotask(() => request.onsuccess?.()); return request;
    }),
    put: vi.fn((value: unknown, key: string) => {
      expect(key).toEqual(expectedKey); proposed = structuredClone(value); return {};
    }),
    delete: vi.fn((key: string) => { expect(key).toEqual(expectedKey); proposed = undefined; return {}; }),
  };
  const open = vi.fn(() => {
    const request = { result: { close, transaction: vi.fn((name: string, mode: string) => {
      expect(name).toBe('forms'); expect(mode).toBe('readwrite'); return transaction;
    }) }, onsuccess: undefined as undefined | (() => void) };
    queueMicrotask(() => request.onsuccess?.()); return request;
  });
  vi.stubGlobal('indexedDB', { open });
  return { store, transaction, close, read: () => stored, complete: () => {
    if (failCommit) { transaction.error = new Error('容量不足'); transaction.onerror?.(); }
    else { stored = proposed; transaction.oncomplete?.(); }
  } };
}
afterEach(() => vi.unstubAllGlobals());

it('lists only two-part keys in the requested namespace and closes the database', async () => {
  const records = [
    { key: 'local-activity', value: 'legacy private form' },
    { key: ['material-checkins', 'a'], value: 'private ledger' },
    { key: ['local-activity', 'a', 'extra'], value: 'other record' },
    { key: ['local-activity', 'a'], value: { name: 'Activity A' } },
    { key: ['local-activity', 'b'], value: { name: 'Activity B' } },
  ];
  let index = 0;
  const request = { result: null as unknown, onsuccess: undefined as (() => void) | undefined };
  const tx = { oncomplete: undefined as (() => void) | undefined, objectStore: () => ({ openCursor: () => {
    queueMicrotask(next); return request;
  } }) };
  function next() {
    request.result = index < records.length ? { ...records[index++], continue: () => queueMicrotask(next) } : null;
    request.onsuccess?.();
    if (!request.result) queueMicrotask(() => tx.oncomplete?.());
  }
  const close = vi.fn();
  vi.stubGlobal('indexedDB', { open: () => {
    const open = { result: { close, transaction: () => tx }, onsuccess: undefined as (() => void) | undefined };
    queueMicrotask(() => open.onsuccess?.()); return open;
  } });
  expect(await listSourceRecords('local-activity')).toEqual([
    { key: ['local-activity', 'a'], value: { name: 'Activity A' } },
    { key: ['local-activity', 'b'], value: { name: 'Activity B' } },
  ]);
  expect(close).toHaveBeenCalledOnce();
});

describe('atomic source form updates', () => {
  it('reads the stored record, waits for commit and publishes a detached result only after success', async () => {
    const db = database({ entries: ['first'] }), notify = vi.fn();
    const unsubscribe = subscribeSourceChanges('project:checkins', notify);
    const next = { entries: ['first', 'second'] };
    const update = vi.fn((current: unknown) => { expect(current).toEqual({ entries: ['first'] }); return next; });
    const pending = updateSourceForm('project:checkins', update); let settled = false;
    void pending.then(() => { settled = true; });
    await vi.waitFor(() => expect(db.store.put).toHaveBeenCalledOnce());
    next.entries.push('late local mutation');
    expect(settled).toBe(false); expect(notify).not.toHaveBeenCalled(); expect(db.read()).toEqual({ entries: ['first'] });
    db.complete(); expect(await pending).toEqual({ entries: ['first', 'second'] });
    expect(db.read()).toEqual({ entries: ['first', 'second'] }); expect(notify).toHaveBeenCalledOnce();
    expect(db.close).toHaveBeenCalledOnce(); unsubscribe();
  });
  it('aborts a rejected merge without writing or notifying', async () => {
    const db = database({ entries: ['original'] }), notify = vi.fn();
    const unsubscribe = subscribeSourceChanges('project:checkins', notify);
    await expect(updateSourceForm('project:checkins', () => { throw new Error('同编号内容冲突'); })).rejects.toThrow('同编号内容冲突');
    expect(db.transaction.abort).toHaveBeenCalledOnce(); expect(db.store.put).not.toHaveBeenCalled();
    expect(db.read()).toEqual({ entries: ['original'] }); expect(notify).not.toHaveBeenCalled(); unsubscribe();
  });
  it('preserves the prior record and reports commit failure', async () => {
    const db = database({ entries: ['original'] }, true);
    const pending = updateSourceForm('project:checkins', () => ({ entries: ['replacement'] }));
    await vi.waitFor(() => expect(db.store.put).toHaveBeenCalledOnce());
    db.complete(); await expect(pending).rejects.toThrow('容量不足'); expect(db.read()).toEqual({ entries: ['original'] });
  });
  it('can create a missing record and refuses an async updater rather than storing a Promise', async () => {
    const db = database(undefined);
    const pending = updateSourceForm('project:checkins', current => { expect(current).toBeUndefined(); return { entries: [] }; });
    await vi.waitFor(() => expect(db.store.put).toHaveBeenCalledOnce()); db.complete(); expect(await pending).toEqual({ entries: [] });
    const invalid = database(undefined);
    await expect(updateSourceForm('project:checkins', async () => ({ entries: [] }))).rejects.toThrow();
    expect(invalid.store.put).not.toHaveBeenCalled(); expect(invalid.transaction.abort).toHaveBeenCalledOnce();
  });
  it('can compensate an uncommitted import by atomically restoring an absent value', async () => {
    const db = database({ entries: ['imported'] });
    const pending = updateSourceForm('project:checkins', current => {
      expect(current).toEqual({ entries: ['imported'] }); return undefined;
    });
    await vi.waitFor(() => expect(db.store.delete).toHaveBeenCalledOnce());
    expect(db.read()).toEqual({ entries: ['imported'] }); db.complete();
    expect(await pending).toBeUndefined(); expect(db.read()).toBeUndefined();
  });
  it('keeps compound-key notifications separate from an identical-looking project string', async () => {
    const key: [string, string] = ['material-checkins', 'project'];
    const db = database(undefined, false, [...key]), compound = vi.fn(), legacy = vi.fn();
    const stopCompound = subscribeSourceRecordChanges(key, compound), stopLegacy = subscribeSourceChanges(JSON.stringify(key), legacy);
    const pending = updateSourceForm(key, () => ({ entries: [] }));
    key[1] = 'another-project';
    await vi.waitFor(() => expect(db.store.put).toHaveBeenCalledOnce()); db.complete(); await pending;
    expect(compound).toHaveBeenCalledOnce(); expect(legacy).not.toHaveBeenCalled();
    stopCompound(); stopLegacy();
  });
});
