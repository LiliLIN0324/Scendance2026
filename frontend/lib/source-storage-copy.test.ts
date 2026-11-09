import { afterEach, describe, expect, it, vi } from 'vitest';
import { copySourceScope, type StoredSource } from './source-storage';

const image = (id: string, scope: string): StoredSource => ({ id, scope, name: '图纸', kind: 'floorplan', width: 10, height: 10, blob: new Blob(['image']) });

/** Emulates IDB's single atomic transaction and abort-on-request-error behavior. */
function database(initialSources: StoredSource[], initialForms: [string, unknown][]) {
  let sources = new Map(initialSources.map(source => [source.id, structuredClone(source)]));
  let forms = new Map(initialForms.map(([key, value]) => [key, structuredClone(value)]));
  let failOnAdd = false, afterWrite: (() => void) | undefined;
  const db = { close: vi.fn(), transaction(names: string[], mode: string) {
    expect(names).toEqual(['sources', 'forms']); expect(mode).toBe('readwrite');
    const stagedSources = structuredClone(sources), stagedForms = structuredClone(forms);
    let pending = 0, aborted = false, complete = false, writes = 0;
    const tx = { error: null as Error | null, oncomplete: undefined as undefined | (() => void), onerror: undefined as undefined | (() => void), onabort: undefined as undefined | (() => void),
      abort() { if (aborted || complete) return; aborted = true; queueMicrotask(() => tx.onabort?.()); },
      objectStore(name: string) { return {
        index: () => ({ getAll: (scope: string) => request(() => [...stagedSources.values()].filter(source => source.scope === scope)) }),
        get: (key: string) => request(() => stagedForms.get(key)),
        getKey: (key: string) => request(() => stagedForms.has(key) ? key : undefined),
        add: (value: unknown, key?: string) => {
          const cloned = structuredClone(value);
          return request(() => {
            if (++writes === 2 && failOnAdd) throw new Error('模拟写入失败');
            if (name === 'sources') {
              const source = cloned as StoredSource;
              if (stagedSources.has(source.id)) throw new Error('编号冲突');
              stagedSources.set(source.id, source);
            } else {
              if (stagedForms.has(key!)) throw new Error('记录冲突');
              stagedForms.set(key!, cloned);
            }
            afterWrite?.();
          });
        },
      }; },
    };
    function finish() { if (pending || aborted || complete) return; complete = true; sources = stagedSources; forms = stagedForms; tx.oncomplete?.(); }
    function request(operation: () => unknown) {
      pending++;
      const req = { result: undefined as unknown, onsuccess: undefined as undefined | (() => void) };
      queueMicrotask(() => {
        if (aborted) return;
        try { req.result = operation(); req.onsuccess?.(); }
        catch (error) { tx.error = error as Error; tx.abort(); }
        pending--; queueMicrotask(finish);
      });
      return req;
    }
    queueMicrotask(finish); return tx;
  } };
  vi.stubGlobal('indexedDB', { open: () => {
    const req = { result: db, onsuccess: undefined as undefined | (() => void) };
    queueMicrotask(() => req.onsuccess?.()); return req;
  } });
  return { sources: () => [...sources.values()], forms: () => new Map(forms), fail: (value: boolean) => { failOnAdd = value; },
    afterWrite: (callback: () => void) => { afterWrite = callback; } };
}
afterEach(() => vi.unstubAllGlobals());

describe('copySourceScope', () => {
  it.each([['target', { name: '已有表单' }], ['target:brief', { event: '已有活动' }], ['target', undefined]])
    ('preserves a destination record at %s even when there are no destination images', async (key, value) => {
      const db = database([image('a', 'draft')], [['draft', { name: '新表单' }], [key as string, value]]);
      const beforeSources = db.sources(), beforeForms = db.forms();
      await expect(copySourceScope('draft', 'target')).rejects.toThrow('目标项目已有');
      expect(db.sources()).toEqual(beforeSources); expect(db.forms()).toEqual(beforeForms);
    });
  it('rolls back a failed write and can retry the same complete copy', async () => {
    const db = database([image('a', 'draft')], [['draft', { registration: { sourceId: 'a' }, jobId: 'old' }], ['draft:brief', { event: '活动' }]]);
    const originalSources = db.sources(), originalForms = db.forms();
    db.fail(true);
    await expect(copySourceScope('draft', 'target')).rejects.toThrow('模拟写入失败');
    expect(db.sources()).toEqual(originalSources); expect(db.forms()).toEqual(originalForms);
    db.fail(false); await copySourceScope('draft', 'target');
    const copied = db.sources().find(item => item.scope === 'target')!;
    expect(copied.id).not.toBe('a');
    expect(db.forms().get('target')).toEqual({ registration: { sourceId: copied.id } });
    expect(db.forms().get('target:brief')).toEqual({ event: '活动' });
    expect(db.sources().find(item => item.id === 'a')).toEqual(originalSources[0]);
  });
  it('aborts the whole copy if the ordinary lease is lost after a staged write', async () => {
    const db = database([image('a', 'draft')], [['draft', { registration: { sourceId: 'a' } }], ['draft:brief', { event: '活动' }]]);
    const beforeSources = db.sources(), beforeForms = db.forms(), abort = new AbortController();
    const guard = { kind: 'ordinary' as const, signal: abort.signal, assertStillHeld() { if (abort.signal.aborted) throw new Error('租约已失效'); } };
    db.afterWrite(() => abort.abort());
    await expect(copySourceScope('draft', 'target', guard)).rejects.toThrow();
    expect(db.sources()).toEqual(beforeSources); expect(db.forms()).toEqual(beforeForms);
  });
});
