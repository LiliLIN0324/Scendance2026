import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  readSourceScopeSnapshot, restoreSourceScopeIfUnchanged, sameSourceScopeSnapshot,
  subscribeSourceChanges, type SourceScopeSnapshot, type StoredSource,
} from './source-storage';

const image = (id = 'image-a', scope = 'activity-a', content = 'pixels'): StoredSource => ({
  id, scope, name: '原图.png', kind: 'floorplan', width: 100, height: 80,
  blob: new Blob([content], { type: 'image/png' }),
});
const snapshot = (form: unknown = undefined, sources = [image()]): SourceScopeSnapshot => ({ scope: 'activity-a', sources, form });

/** Native-shaped transaction harness: stage all writes and discard every one on abort. */
function database(initial: SourceScopeSnapshot, otherSources: StoredSource[] = []) {
  let sources = new Map([...initial.sources, ...otherSources].map(source => [source.id, structuredClone(source)]));
  let forms = new Map<string, unknown>([[initial.scope, structuredClone(initial.form)], ['activity-a:brief', { description: 'untouched' }]]);
  const transactions: { names: string[]; mode: string; operations: string[] }[] = [];
  const close = vi.fn();
  let failWriteCommit = false, failRead = false;
  function transaction(names: string[], mode: string) {
    const stagedSources = structuredClone(sources), stagedForms = structuredClone(forms);
    const record = { names, mode, operations: [] as string[] }; transactions.push(record);
    let pending = 0, aborted = false, settled = false;
    const tx = {
      error: null as Error | null,
      oncomplete: undefined as undefined | (() => void),
      onerror: undefined as undefined | (() => void),
      onabort: undefined as undefined | (() => void),
      abort() { if (settled || aborted) return; aborted = true; queueMicrotask(() => tx.onabort?.()); },
      objectStore(name: string) {
        if (!names.includes(name)) throw new Error('Store outside transaction');
        return {
          index: () => ({ getAll: (scope: string) => request('getAll', () => [...stagedSources.values()].filter(source => source.scope === scope)) }),
          get: (key: string) => request('get', () => name === 'sources' ? stagedSources.get(key) : stagedForms.get(key)),
          put: (value: unknown, key?: string) => {
            const copy = structuredClone(value);
            return request(`put:${name}`, () => {
              if (mode !== 'readwrite') throw new Error('Readonly write');
              if (name === 'sources') stagedSources.set((copy as StoredSource).id, copy as StoredSource);
              else stagedForms.set(key!, copy);
            });
          },
          delete: (key: string) => request(`delete:${name}`, () => {
            if (mode !== 'readwrite') throw new Error('Readonly delete');
            if (name === 'sources') stagedSources.delete(key); else stagedForms.delete(key);
          }),
        };
      },
    };
    function finish() {
      if (pending || settled || aborted) return;
      settled = true;
      if (mode === 'readwrite' && failWriteCommit) { tx.error = new Error('容量不足'); tx.onerror?.(); return; }
      if (mode === 'readwrite') { sources = stagedSources; forms = stagedForms; }
      tx.oncomplete?.();
    }
    function request(operation: string, run: () => unknown) {
      pending++; record.operations.push(operation);
      const req = { result: undefined as unknown, error: null as Error | null, onsuccess: undefined as undefined | (() => void) };
      queueMicrotask(() => {
        if (aborted) return;
        try {
          if (mode === 'readonly' && failRead) throw new Error('读取失败');
          req.result = structuredClone(run()); req.onsuccess?.();
        } catch (error) { req.error = error as Error; tx.error = error as Error; tx.abort(); }
        pending--; queueMicrotask(finish);
      });
      return req;
    }
    queueMicrotask(finish);
    return tx;
  }
  vi.stubGlobal('indexedDB', { open: () => {
    const req = { result: { transaction, close }, onsuccess: undefined as undefined | (() => void) };
    queueMicrotask(() => req.onsuccess?.()); return req;
  } });
  return { transactions, close, failCommit: () => { failWriteCommit = true; }, failRead: () => { failRead = true; },
    images: () => [...sources.values()], form: (scope = initial.scope) => forms.get(scope), hasForm: () => forms.has(initial.scope) };
}

afterEach(() => vi.unstubAllGlobals());

describe('drawing scope snapshot comparison', () => {
  it('compares all source metadata and actual equal-size Blob bytes, independent of image order', async () => {
    const a = snapshot({ future: { value: undefined } }, [image(), image('second')]);
    const b = snapshot({ future: { value: undefined } }, [image('second'), image()]);
    expect(await sameSourceScopeSnapshot(a, b)).toBe(true);
    for (const patch of [{ name: 'changed' }, { kind: 'photo' as const }, { assetId: 'asset' }, { uploadedKind: 'photo' as const }, { width: 101 }, { blob: new Blob(['Pixels'], { type: 'image/png' }) }, { blob: new Blob(['pixels'], { type: 'image/jpeg' }) }]) {
      expect(await sameSourceScopeSnapshot(a, { ...a, sources: [{ ...a.sources[0], ...patch }, a.sources[1]] })).toBe(false);
    }
    expect(await sameSourceScopeSnapshot(a, { ...a, scope: 'other' })).toBe(false);
  });
  it.each([null, {}, [], '', 0, false])('does not mistake absent form for %j', async form => {
    expect(await sameSourceScopeSnapshot(snapshot(), snapshot(form))).toBe(false);
  });
  it('retains unknown fields, undefined properties, sparse arrays and structured-clone values', async () => {
    expect(await sameSourceScopeSnapshot(snapshot({ a: undefined }), snapshot({}))).toBe(false);
    expect(await sameSourceScopeSnapshot(snapshot([undefined]), snapshot(Array(1)))).toBe(false);
    const form = { date: new Date('2026-10-09'), map: new Map([['future', new Set([1, 2])]]), bytes: new Uint8Array([0, 255]), nested: { future: undefined } };
    expect(await sameSourceScopeSnapshot(snapshot(form), snapshot(structuredClone(form)))).toBe(true);
    expect(await sameSourceScopeSnapshot(snapshot(form), snapshot({ ...form, date: new Date('2026-10-10') }))).toBe(false);
    expect(await sameSourceScopeSnapshot(snapshot(form), snapshot({ ...form, bytes: new Uint8Array([0, 254]) }))).toBe(false);
    const cycle: { self?: unknown; future: number } = { future: 1 }; cycle.self = cycle;
    expect(await sameSourceScopeSnapshot(snapshot(cycle), snapshot(structuredClone(cycle)))).toBe(true);
    expect(await sameSourceScopeSnapshot(snapshot({ a: 1, b: 2 }), snapshot({ b: 2, a: 1 }))).toBe(true);
  });
});

describe('atomic drawing scope restore under the caller exclusive scope lock', () => {
  it('reads both stores in one transaction and returns detached data', async () => {
    const original = snapshot({ registration: { sourceId: 'image-a', points: [] }, future: undefined });
    const db = database(original);
    const result = await readSourceScopeSnapshot(original.scope);
    expect(await sameSourceScopeSnapshot(result, original)).toBe(true);
    expect(db.transactions).toEqual([{ names: ['sources', 'forms'], mode: 'readonly', operations: ['getAll', 'get'] }]);
    (result.form as { registration: { points: number[] } }).registration.points.push(1);
    expect(db.form()).toEqual(original.form); expect(db.close).toHaveBeenCalledOnce();
  });
  it('commits replacement once, leaves other activities and brief untouched, then notifies', async () => {
    const before = snapshot({ registration: 'old' }), desired = snapshot({ registration: 'new' }, [image('replacement')]);
    const other = image('other-image', 'activity-b'), db = database(before, [other]);
    const notify = vi.fn(() => { expect(db.form()).toEqual(desired.form); expect(db.images().map(value => value.id)).toEqual(['other-image', 'replacement']); });
    const stop = subscribeSourceChanges(before.scope, notify), check = vi.fn();
    await restoreSourceScopeIfUnchanged(before.scope, before, desired, check);
    expect(db.transactions.map(tx => tx.mode)).toEqual(['readonly', 'readwrite']);
    expect(db.transactions.every(tx => tx.names.join() === 'sources,forms')).toBe(true);
    expect(db.form('activity-a:brief')).toEqual({ description: 'untouched' });
    expect(notify).toHaveBeenCalledOnce(); expect(check).toHaveBeenCalled(); expect(db.close).toHaveBeenCalledTimes(2); stop();
  });
  it.each([null, {}, undefined])('stores the exact desired form value %j, deleting only undefined', async value => {
    const before = snapshot({ before: true }), db = database(before);
    await restoreSourceScopeIfUnchanged(before.scope, before, snapshot(value, []));
    expect(db.form()).toEqual(value); expect(db.hasForm()).toBe(value !== undefined); expect(db.images()).toEqual([]);
  });
  it('rejects changed form or changed Blob bytes before opening a write transaction', async () => {
    for (const actual of [snapshot({ changed: true }), snapshot(undefined, [image('image-a', 'activity-a', 'Pixels')])]) {
      const db = database(actual);
      await expect(restoreSourceScopeIfUnchanged(actual.scope, snapshot(), snapshot({}, []))).rejects.toThrow('新变化');
      expect(db.transactions.every(tx => tx.mode === 'readonly')).toBe(true);
      expect(db.form()).toEqual(actual.form);
    }
  });
  it('aborts global image-ID collision in the write transaction without changing either scope', async () => {
    const before = snapshot({ original: true }), other = image('occupied', 'activity-b'), db = database(before, [other]);
    await expect(restoreSourceScopeIfUnchanged(before.scope, before, snapshot({}, [image('occupied')]))).rejects.toThrow('另一个活动');
    expect(db.images().map(source => source.id)).toEqual(['image-a', 'occupied']); expect(db.form()).toEqual(before.form);
    expect(db.transactions[1].operations).toEqual(['get']);
  });
  it('rejects cross-scope snapshots, cross-scope images and duplicate IDs before storage access', async () => {
    const before = snapshot(), db = database(before);
    for (const desired of [{ ...before, scope: 'other' }, snapshot({}, [image('foreign', 'other')]), snapshot({}, [image(), image()])]) {
      await expect(restoreSourceScopeIfUnchanged(before.scope, before, desired)).rejects.toThrow();
    }
    await expect(restoreSourceScopeIfUnchanged(before.scope, { ...before, scope: 'other' }, before)).rejects.toThrow();
    expect(db.transactions).toEqual([]);
  });
  it('rolls back all staged writes when the final check throws, and never notifies', async () => {
    const before = snapshot({ original: true }), db = database(before), notify = vi.fn();
    const stop = subscribeSourceChanges(before.scope, notify);
    await expect(restoreSourceScopeIfUnchanged(before.scope, before, snapshot({}, [image('new')]), () => {
      if (db.transactions.at(-1)?.operations.includes('put:forms')) throw new Error('活动已切换');
    })).rejects.toThrow('活动已切换');
    expect(db.images().map(source => source.id)).toEqual(['image-a']); expect(db.form()).toEqual(before.form); expect(notify).not.toHaveBeenCalled(); stop();
  });
  it('preserves the original snapshot on commit failure and exposes read failure before any write', async () => {
    const before = snapshot({ original: true }), db = database(before); db.failCommit();
    await expect(restoreSourceScopeIfUnchanged(before.scope, before, snapshot({}, []))).rejects.toThrow('容量不足');
    expect(db.form()).toEqual(before.form); expect(db.images()).toHaveLength(1);
    const broken = database(before); broken.failRead();
    await expect(restoreSourceScopeIfUnchanged(before.scope, before, snapshot({}, []))).rejects.toThrow('读取失败');
    expect(broken.transactions).toHaveLength(1); expect(broken.close).toHaveBeenCalledOnce();
  });
});
