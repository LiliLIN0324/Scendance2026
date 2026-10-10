import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { canonical, sha256 } from '../../supabase/functions/_shared/domain';
import { eventOperationsSchema } from '../../supabase/functions/_shared/event-operations-contract';
import { makeFloor, makeItem, makeLayout } from '../components/room-organizer/lib/__testfixtures__/fixtures';
import {
  ActivityTaskReadbackError, activityTaskRequestStorageKey, beginActivityTaskRequest, closeActivityTaskAcceptance,
  finishActivityTaskRequest, readActivityTaskRequest, stageActivityTaskAcceptance, storeActivityTaskRun,
  type ActivityTaskRequestIdentity, type ActivityTaskRequestMarker,
} from './activity-task-proposal-storage';
import { acceptActivityTaskSuggestions, buildActivityTaskContext } from './activity-task-suggestions';

const id = (n: number) => `a5000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const identity: ActivityTaskRequestIdentity = { apiUrl: 'http://127.0.0.1:54337', userId: id(1), activityId: 'house-rehearsal-30', remoteProjectId: id(2) };
const guard = () => {};
const layout = () => makeLayout({ id: identity.activityId, name: '明确标注的任务建议演练',
  floors: [makeFloor({ items: [makeItem({ id: 'legacy-chair', name: '演练椅', color: '#ffffff' })] })],
  eventOperations: eventOperationsSchema.parse({ dataKind: 'rehearsal', tasks: [{ id: id(10), title: '已有任务', phase: 'setup', acceptance: '保留原稿', objectIds: ['legacy-chair'] }] }),
});
async function input(requestId = id(3)) {
  const selection = { briefText: '只披露本次选定内容', taskIds: [id(10)], objectIds: ['legacy-chair'] };
  return { identity, requestId, instruction: '建议核对与撤场任务', selection, context: await buildActivityTaskContext({ layout: layout(), selection }) };
}
function run(marker: ActivityTaskRequestMarker, overrides: Record<string, unknown> = {}) {
  return { kind: 'activity_tasks', id: id(4), projectId: identity.remoteProjectId, requestId: marker.requestId,
    activityId: identity.activityId, contextHash: marker.contextHash, state: 'complete', progress: '已完成', callCount: 1,
    activityResult: { suggestions: [
      { title: '建议现场核对', phase: 'event', acceptance: '人工核对数量', objectIds: ['legacy-chair'] },
      { title: '建议撤场交接', phase: 'teardown', acceptance: '物件返回指定位置', objectIds: [] },
    ] }, expiresAt: '2026-10-10T12:00:00Z', ...overrides };
}

/** Same serial transaction/clone boundary substitute used by commercial storage tests.
 * This is not a claim of browser cross-tab layout transaction support. */
function database() {
  type Request = { result: unknown; error: Error | null; onsuccess?: () => void; onerror?: () => void };
  type Transaction = { oncomplete?: () => void; onerror?: () => void; onabort?: () => void; error: Error | null; objectStore: (name: string) => unknown; abort: () => void };
  let stored = new Map<string, unknown>(), busy = false;
  const queue: (() => void)[] = [];
  const control = { failCommit: false, failReads: 0, beforeWriteGet: undefined as (() => void) | undefined,
    afterCommit: undefined as (() => void) | undefined, deferNextOpen: undefined as Promise<void> | undefined };
  const put = vi.fn(), keyOf = (key: unknown) => JSON.stringify(key);
  const tick = () => { if (!busy && queue.length) { busy = true; queue.shift()!(); } };
  function transaction(name: string, mode: string) {
    expect(name).toBe('forms');
    let working = new Map<string, unknown>(), active = false, ended = false, pending = 0, dirty = false;
    const jobs: (() => void)[] = [];
    const done = () => { busy = false; queueMicrotask(tick); };
    const tx: Transaction = { error: null, objectStore: name => { expect(name).toBe('forms'); return store; }, abort: () => {
      if (ended) return; ended = true; queueMicrotask(() => { tx.onabort?.(); done(); });
    } };
    const finish = () => {
      if (ended || pending) return;
      ended = true;
      if (dirty && control.failCommit) { control.failCommit = false; tx.error = new Error('QuotaExceededError'); tx.onerror?.(); done(); return; }
      if (dirty) { stored = working; const hook = control.afterCommit; control.afterCommit = undefined; hook?.(); }
      tx.oncomplete?.(); done();
    };
    const request = (action: () => unknown, reading = false): Request => {
      const result: Request = { result: undefined, error: null }; pending++;
      const job = () => queueMicrotask(() => {
        if (ended) return;
        if (reading && mode === 'readonly' && control.failReads) {
          control.failReads--; ended = true; result.error = tx.error = new Error('本机读回失败'); tx.onerror?.(); done(); return;
        }
        if (reading && mode === 'readwrite') control.beforeWriteGet?.();
        result.result = action(); result.onsuccess?.(); pending--; queueMicrotask(finish);
      });
      if (active) job(); else jobs.push(job); return result;
    };
    const store = {
      get: (key: unknown) => request(() => structuredClone(working.get(keyOf(key))), true),
      put: (value: unknown, key: unknown) => { const clone = structuredClone(value); dirty = true; put(key, clone); return request(() => { working.set(keyOf(key), clone); return key; }); },
      delete: (key: unknown) => { dirty = true; return request(() => working.delete(keyOf(key))); },
    };
    queue.push(() => { working = structuredClone(stored); active = true; jobs.forEach(job => job()); }); queueMicrotask(tick); return tx;
  }
  vi.stubGlobal('indexedDB', { open: () => {
    const request = { result: { close: () => {}, transaction }, onsuccess: undefined as (() => void) | undefined };
    const gate = control.deferNextOpen; control.deferNextOpen = undefined;
    if (gate) void gate.then(() => request.onsuccess?.()); else queueMicrotask(() => request.onsuccess?.()); return request;
  } });
  return { control, put, read: (key = activityTaskRequestStorageKey(identity)) => structuredClone(stored.get(keyOf(key))),
    seed: (value: unknown, key = activityTaskRequestStorageKey(identity)) => stored.set(keyOf(key), structuredClone(value)) };
}
beforeEach(() => vi.stubGlobal('crypto', webcrypto));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function prepared() {
  const request = await beginActivityTaskRequest(await input(), guard);
  return storeActivityTaskRun(identity, request.requestId, run(request), '明确标注的模拟模型回复', guard);
}
async function accepted(marker: ActivityTaskRequestMarker) {
  if (!marker.proposal) throw new Error('Expected proposal');
  const selection = marker.selection;
  const result = await acceptActivityTaskSuggestions({ layout: layout(), selection }, marker.proposal, [marker.proposal.tasks[0].id]);
  if (result.status !== 'accepted') throw new Error('Expected proposed write');
  return result;
}

describe('single durable original request', () => {
  it('persists and reads back the exact disclosure before a request can be sent, with distinct remote and local IDs', async () => {
    const db = database(), request = await input(), original = structuredClone(request);
    const marker = await beginActivityTaskRequest(request, guard);
    expect(marker.state).toBe('requested'); expect(marker.contextHash).toBe(await sha256(canonical(marker.context.summary)));
    expect(marker.contextHash).not.toMatch(/^sha256:/); expect(marker.identity.activityId).not.toBe(marker.identity.remoteProjectId);
    expect(db.read()).toEqual(marker); expect(await readActivityTaskRequest(identity, guard)).toEqual(marker); expect(request).toEqual(original);
    expect(db.put.mock.calls[0][0]).toEqual(['activity-task-request', canonical(identity)]);
  });
  it('reuses unknown POST request IDs and rejects same-ID changed input or a new request without an explicit replacement', async () => {
    database(); const original = await input(), marker = await beginActivityTaskRequest(original, guard);
    expect(await beginActivityTaskRequest(original, guard)).toEqual(marker);
    await expect(beginActivityTaskRequest({ ...original, instruction: '改变指令' }, guard)).rejects.toThrow('同一请求编号');
    await expect(beginActivityTaskRequest(await input(id(5)), guard)).rejects.toThrow('结束原任务');
    const next = await beginActivityTaskRequest(await input(id(5)), guard, { replaceRequestId: marker.requestId });
    expect(next.requestId).toBe(id(5)); expect(next.proposal).toBeNull();
  });
  it('allows a new request after an explicit terminal state without creating a queue', async () => {
    const db = database(), first = await beginActivityTaskRequest(await input(), guard);
    await finishActivityTaskRequest(identity, first.requestId, 'cancelled', guard);
    const next = await beginActivityTaskRequest(await input(id(5)), guard);
    expect(db.read()).toEqual(next); expect(next.requestId).toBe(id(5));
  });
  it('does not mark an unknown POST as failed or authorize a new request until the original run confirms failure', async () => {
    const db = database(), first = await beginActivityTaskRequest(await input(), guard);
    await expect(finishActivityTaskRequest(identity, first.requestId, 'failed', guard)).rejects.toThrow('按原编号查询');
    expect(db.read()).toEqual(first);
    const failed = await storeActivityTaskRun(identity, first.requestId, run(first, { state: 'failed', activityResult: null, errorCode: 'AGENT_MODEL_FAILED' }), '模拟结果', guard);
    expect(failed.state).toBe('failed'); expect(failed.proposal).toBeNull();
    expect((await beginActivityTaskRequest(await input(id(5)), guard)).requestId).toBe(id(5));
  });
  it('distinguishes an absent record from corrupt, forged-hash or other-identity records and retains them', async () => {
    const db = database(); expect(await readActivityTaskRequest(identity, guard)).toBeUndefined();
    const marker = await beginActivityTaskRequest(await input(), guard);
    for (const corrupt of [{ ...marker, privateField: 'not allowed' }, { ...marker, contextHash: '0'.repeat(64) },
      { ...marker, identity: { ...identity, userId: id(8) } }, { ...marker, selection: { ...marker.selection, objectIds: [] } }]) {
      db.seed(corrupt); await expect(readActivityTaskRequest(identity, guard)).rejects.toThrow(); expect(db.read()).toEqual(corrupt);
      await expect(beginActivityTaskRequest(await input(), guard)).rejects.toThrow();
    }
  });
  it('isolates all four identity components and refuses credentials or query strings in API addresses', async () => {
    database(); await beginActivityTaskRequest(await input(), guard);
    for (const foreign of [{ ...identity, apiUrl: 'http://127.0.0.1:54339' }, { ...identity, userId: id(9) },
      { ...identity, activityId: 'another-activity' }, { ...identity, remoteProjectId: id(9) }]) expect(await readActivityTaskRequest(foreign, guard)).toBeUndefined();
    expect(() => activityTaskRequestStorageKey({ ...identity, apiUrl: 'https://user:secret@example.com' })).toThrow();
    expect(() => activityTaskRequestStorageKey({ ...identity, apiUrl: 'https://example.com?token=secret' })).toThrow();
  });
  it('never authorizes POST after failed commit or unconfirmed readback; the committed original ID remains recoverable', async () => {
    const db = database(); db.control.failCommit = true;
    await expect(beginActivityTaskRequest(await input(), guard)).rejects.toThrow('QuotaExceededError'); expect(db.read()).toBeUndefined();
    db.control.afterCommit = () => { db.control.failReads = 1; };
    await expect(beginActivityTaskRequest(await input(), guard)).rejects.toMatchObject({ name: 'ActivityTaskReadbackError', committed: true });
    expect((await readActivityTaskRequest(identity, guard))?.requestId).toBe(id(3));
  });
  it('checks synchronous void guards before work, after awaits and inside the live native transaction', async () => {
    const db = database(), request = await input();
    await expect(beginActivityTaskRequest(request, async () => {})).rejects.toThrow('同步');
    await expect(beginActivityTaskRequest(request, (() => true) as unknown as () => void)).rejects.toThrow('同步');
    let active = true; const liveGuard = () => { if (!active) throw new Error('活动已切换'); };
    db.control.beforeWriteGet = () => { active = false; };
    await expect(beginActivityTaskRequest(request, liveGuard)).rejects.toThrow('活动已切换'); expect(db.read()).toBeUndefined();
    db.control.beforeWriteGet = undefined; active = true;
    const marker = await beginActivityTaskRequest(request, liveGuard);
    db.control.afterCommit = () => { active = false; };
    await expect(storeActivityTaskRun(identity, marker.requestId, run(marker), '模拟结果', liveGuard)).rejects.toThrow('活动已切换');
    expect((db.read() as ActivityTaskRequestMarker).proposal).not.toBeNull();
  });
  it('does not turn a late read into a valid current request', async () => {
    const db = database(); await beginActivityTaskRequest(await input(), guard);
    let release!: () => void, active = true;
    db.control.deferNextOpen = new Promise<void>(resolve => { release = resolve; });
    const pending = readActivityTaskRequest(identity, () => { if (!active) throw new Error('账号已切换'); });
    active = false; release(); await expect(pending).rejects.toThrow('账号已切换');
  });
  it('captures the user-reviewed input before hashing rather than observing edits made during an await', async () => {
    database(); const request = await input(), original = structuredClone(request);
    const digest = crypto.subtle.digest.bind(crypto.subtle);
    let release!: () => void; const wait = new Promise<void>(resolve => { release = resolve; });
    vi.spyOn(crypto.subtle, 'digest').mockImplementationOnce(async (...args) => { await wait; return digest(...args); });
    const pending = beginActivityTaskRequest(request, guard);
    request.instruction = '后来编辑的内容'; request.selection.briefText = '后来编辑的需求'; request.requestId = id(8);
    release(); const marker = await pending;
    expect(marker.instruction).toBe(original.instruction); expect(marker.selection).toEqual(original.selection); expect(marker.requestId).toBe(original.requestId);
  });
});

describe('prepared proposals and save acknowledgement', () => {
  it('prepares once across separate module instances and concurrent same-run results, retaining stable task IDs on reopen', async () => {
    database(); const marker = await beginActivityTaskRequest(await input(), guard);
    const uuidSpy = vi.spyOn(globalThis.crypto, 'randomUUID');
    vi.resetModules(); const second = await import('./activity-task-proposal-storage');
    const [a, b] = await Promise.all([storeActivityTaskRun(identity, marker.requestId, run(marker), '模拟结果', guard),
      second.storeActivityTaskRun(identity, marker.requestId, run(marker), '模拟结果', guard)]);
    expect(uuidSpy).toHaveBeenCalledTimes(3); expect(a.proposal).toEqual(b.proposal);
    expect((await second.readActivityTaskRequest(identity, guard))?.proposal).toEqual(a.proposal);
    expect(await storeActivityTaskRun(identity, marker.requestId, run(marker, { reused: true }), '另一个显示标签', guard)).toEqual(a);
    expect(uuidSpy).toHaveBeenCalledTimes(3);
  });
  it('rejects foreign runs, changed results, undeclared references and model execution fields before any local preparation', async () => {
    const db = database(), marker = await beginActivityTaskRequest(await input(), guard), uuidSpy = vi.spyOn(globalThis.crypto, 'randomUUID');
    for (const override of [{ kind: 'scene' }, { requestId: id(5) }, { projectId: id(5) }, { activityId: 'other-local' },
      { contextHash: '0'.repeat(64) }, { activityResult: { suggestions: [{ title: '建议', phase: 'event', acceptance: '核对', objectIds: ['not-disclosed'] }] } },
      { activityResult: { suggestions: [{ title: '建议', phase: 'event', acceptance: '核对', ownerName: '模型杜撰' }] } }]) {
      await expect(storeActivityTaskRun(identity, marker.requestId, run(marker, override), '模拟结果', guard)).rejects.toThrow();
      expect(db.read()).toEqual(marker);
    }
    expect(uuidSpy).not.toHaveBeenCalled();
    const first = await storeActivityTaskRun(identity, marker.requestId, run(marker), '模拟结果', guard);
    await expect(storeActivityTaskRun(identity, marker.requestId, run(marker, { activityResult: { suggestions: [{ title: '另一建议', phase: 'event', acceptance: '核对', objectIds: [] }] } }), '模拟结果', guard)).rejects.toThrow('完整结果已变化');
    expect(db.read()).toEqual(first);
  });
  it('stores complete intended operations and selected receipt before the main layout write, then closes only after exact saved readback', async () => {
    const db = database(), marker = await prepared(), proposed = await accepted(marker), old = layout().eventOperations!;
    const pending = await stageActivityTaskAcceptance(identity, marker.requestId, proposed, guard);
    expect(pending.state).toBe('saving'); expect(pending.receipt).toBeNull(); expect(pending.pending).toEqual({ operations: proposed.operations, receipt: proposed.receipt });
    expect(proposed.operations.tasks[0]).toEqual(old.tasks[0]); expect(proposed.operations.tasks).toHaveLength(2);
    expect(proposed.operations.tasks[1]).toMatchObject({ status: 'todo', ownerName: '', contractorName: '', plannedStartAt: null, plannedEndAt: null, evidenceNote: '', evidenceUrls: [] });
    await expect(closeActivityTaskAcceptance(identity, marker.requestId, { activityId: identity.activityId, operations: old }, guard)).rejects.toThrow('尚未读回');
    await expect(closeActivityTaskAcceptance(identity, marker.requestId, { activityId: 'other-activity', operations: proposed.operations }, guard)).rejects.toThrow();
    expect(db.read()).toEqual(pending);
    const closed = await closeActivityTaskAcceptance(identity, marker.requestId, { activityId: identity.activityId, operations: proposed.operations }, guard);
    expect(closed.state).toBe('closed'); expect(closed.receipt).toEqual(proposed.receipt);
    expect(await closeActivityTaskAcceptance(identity, marker.requestId, { activityId: identity.activityId, operations: proposed.operations }, guard)).toEqual(closed);
    expect(await storeActivityTaskRun(identity, marker.requestId, run(marker), '模拟结果', guard)).toEqual(closed);
    expect(await finishActivityTaskRequest(identity, marker.requestId, 'cancelled', guard)).toEqual(closed);
  });
  it('retains pending operations and stable IDs across a failed closing commit or failed readback, so crash recovery only checks saved tasks', async () => {
    const db = database(), marker = await prepared(), proposed = await accepted(marker);
    const pending = await stageActivityTaskAcceptance(identity, marker.requestId, proposed, guard);
    db.control.failCommit = true;
    await expect(closeActivityTaskAcceptance(identity, marker.requestId, { activityId: identity.activityId, operations: proposed.operations }, guard)).rejects.toThrow('QuotaExceededError');
    expect(await readActivityTaskRequest(identity, guard)).toEqual(pending);
    db.control.afterCommit = () => { db.control.failReads = 1; };
    await expect(closeActivityTaskAcceptance(identity, marker.requestId, { activityId: identity.activityId, operations: proposed.operations }, guard)).rejects.toBeInstanceOf(ActivityTaskReadbackError);
    const reopened = await readActivityTaskRequest(identity, guard);
    expect(reopened?.state).toBe('closed'); expect(reopened?.proposal?.tasks.map(task => task.id)).toEqual(marker.proposal?.tasks.map(task => task.id));
    expect(reopened?.pending?.operations).toEqual(proposed.operations);
  });
  it('refuses changed proposal/selection receipts, unselected draft IDs and a cancelled proposal', async () => {
    const db = database(), marker = await prepared(), proposed = await accepted(marker);
    for (const corrupt of [{ ...proposed, receipt: { ...proposed.receipt, proposalId: id(8) } },
      { ...proposed, addedTaskIds: [id(8)] }, { ...proposed, operations: { ...proposed.operations, tasks: [...proposed.operations.tasks, marker.proposal!.tasks[1]] } }]) {
      await expect(stageActivityTaskAcceptance(identity, marker.requestId, corrupt, guard)).rejects.toThrow(); expect(db.read()).toEqual(marker);
    }
    const pending = await stageActivityTaskAcceptance(identity, marker.requestId, proposed, guard);
    await expect(stageActivityTaskAcceptance(identity, marker.requestId, { ...proposed, operations: { ...proposed.operations, tasks: proposed.operations.tasks.map(task => ({ ...task, title: 'changed' })) } }, guard)).rejects.toThrow('不能更改');
    expect(db.read()).toEqual(pending);
    const cancelled = await finishActivityTaskRequest(identity, marker.requestId, 'cancelled', guard);
    await expect(closeActivityTaskAcceptance(identity, marker.requestId, { activityId: identity.activityId, operations: proposed.operations }, guard)).rejects.toThrow();
    expect(await storeActivityTaskRun(identity, marker.requestId, run(marker), '模拟结果', guard)).toEqual(cancelled);
  });
});
