// @vitest-environment jsdom
import { webcrypto } from 'node:crypto';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { activityTaskRequestStorageKey, type ActivityTaskRequestIdentity, type ActivityTaskRequestMarker } from '@/lib/activity-task-proposal-storage';
import { BackendSession, getBackendConfig, SceneApiError, type ActivityTaskRunInput, type BackendSnapshot } from '@/lib/backend-session';
import { registerSourceFlush, type SourceFormKey } from '@/lib/source-storage';
import { activityTaskContextSchema, activityTaskRunSchema, type ActivityTaskRun } from '../../../../supabase/functions/_shared/activity-task-contract';
import { canonical } from '../../../../supabase/functions/_shared/domain';
import { eventOperationsSchema, type EventOperations } from '../../../../supabase/functions/_shared/event-operations-contract';
import { layoutStore, useLayout } from '../hooks/use-layout-store';
import { makeFloor, makeItem, makeLayout, makeUnplacedItem } from '../lib/__testfixtures__/fixtures';
import { layoutToBackendScene } from '../lib/backend-adapter';
import { STORAGE_KEY } from '../lib/constants';
import { ActivityTaskWorkspace } from './activity-task-workspace';
import type { RoomLayout } from '../lib/types';

const boundary = vi.hoisted(() => ({
  records: new Map<string, unknown>(), events: [] as { action: string; state?: string | undefined }[],
  failCommit: false, failNextRead: false, failReadbackState: null as string | null,
}));
// Substitute only the existing IndexedDB clone/transaction boundary. Domain preparation,
// source flush registration, disclosure UI and request marker validation stay real.
vi.mock('@/lib/source-storage', async importOriginal => {
  const real = await importOriginal<typeof import('@/lib/source-storage')>();
  return { ...real,
    readSourceRecord: async <T,>(key: SourceFormKey): Promise<T | undefined> => {
      const value = boundary.records.get(JSON.stringify(key));
      if (Array.isArray(key) && key[0] === 'activity-task-request') {
        if (boundary.failNextRead) { boundary.failNextRead = false; throw new Error('演练：建议记录读回失败'); }
        boundary.events.push({ action: 'marker-read', state: (value as ActivityTaskRequestMarker | undefined)?.state });
      }
      return structuredClone(value) as T | undefined;
    },
    updateSourceForm: async <T,>(key: SourceFormKey, update: (raw: unknown) => T): Promise<T> => {
      const value = update(structuredClone(boundary.records.get(JSON.stringify(key))));
      if (boundary.failCommit) { boundary.failCommit = false; throw new Error('演练：建议记录提交失败'); }
      boundary.records.set(JSON.stringify(key), structuredClone(value));
      const state = (value as ActivityTaskRequestMarker).state;
      boundary.events.push({ action: 'marker-commit', state });
      if (state === boundary.failReadbackState) { boundary.failReadbackState = null; boundary.failNextRead = true; }
      return structuredClone(value);
    },
  };
});

const uuid = (n: number) => `ab000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const localId = 'house-task-workspace-rehearsal';
const remoteId = uuid(2), userId = uuid(1), objectId = 'rehearsal-sign-in-table';
function fixture(): RoomLayout {
  return makeLayout({ id: localId, name: '任务接线假设演练', roof: { style: 'none', color: '#ffffff' },
    floors: [makeFloor({ id: 'rehearsal-floor', name: '演练一层', items: [
      makeItem({ id: objectId, name: '演练签到桌', type: 'table', position: { x: 1, z: 2 }, glbUrl: 'https://example.com/private?token=not-for-disclosure', price: 999 }),
      makeUnplacedItem({ id: 'rehearsal-unplaced-chair', name: '未摆放的演练椅' }),
    ] })],
    eventOperations: eventOperationsSchema.parse({ dataKind: 'rehearsal', tasks: [
      { id: uuid(10), title: '原签到核对', phase: 'setup', acceptance: '保留原人工完成条件', objectIds: [objectId],
        ownerName: '不得披露的负责人', contractorName: '不得披露的外包方', evidenceNote: '不得披露的原证据', evidenceUrls: ['https://example.com/private-evidence'] },
      { id: uuid(11), title: '原撤场交接', phase: 'teardown', acceptance: '保留另一项人工任务' },
    ] }),
  });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
class ReactiveSession {
  config = getBackendConfig({ url: 'http://127.0.0.1:54337', anonKey: 'sb_publishable_local_integration_only' });
  snapshot: BackendSnapshot;
  listeners = new Set<() => void>();
  startActivityTaskRun = vi.fn<(input: ActivityTaskRunInput) => Promise<ActivityTaskRun>>();
  getActivityTaskRun = vi.fn<(runId: string) => Promise<ActivityTaskRun>>();
  getActivityTaskRunByRequest = vi.fn<(requestId: string) => Promise<ActivityTaskRun>>();
  cancelActivityTaskRun = vi.fn<(runId: string) => Promise<ActivityTaskRun>>();
  constructor() {
    const base = new BackendSession(this.config).getSnapshot();
    const remoteScene = layoutToBackendScene(makeLayout({ roof: { style: 'none', color: '#ffffff' } }));
    this.snapshot = { ...base, user: { id: userId }, status: 'editing', writeBlocked: false, revision: 1,
      project: { id: remoteId, name: '独立远端场景演练', studio_id: uuid(5), revision: 1, scene: remoteScene },
      geometryBinding: { version: 1, localActivityId: localId, userId, apiUrl: this.config.apiUrl, cloudProjectId: remoteId },
      lease: { projectId: remoteId, sessionId: uuid(6), generation: 1, revision: 1, expiresAt: '2099-01-01T00:00:00Z' },
    };
    this.startActivityTaskRun.mockImplementation(async () => {
      boundary.events.push({ action: 'POST' }); return completed(this);
    });
    this.getActivityTaskRunByRequest.mockImplementation(async () => completed(this));
    this.getActivityTaskRun.mockImplementation(async () => {
      const marker = currentMarker(this); return marker?.run ?? completed(this);
    });
    this.cancelActivityTaskRun.mockImplementation(async () => completed(this, { state: 'cancelled', activityResult: null }));
  }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  isGeometryBound = (id: string) => {
    const binding = this.snapshot.geometryBinding;
    return !!binding && binding.localActivityId === id && binding.userId === this.snapshot.user?.id &&
      binding.apiUrl === this.config.apiUrl && binding.cloudProjectId === this.snapshot.project?.id;
  };
  update(patch: Partial<BackendSnapshot>): void { this.snapshot = { ...this.snapshot, ...patch }; this.emit(); }
  emit(): void { for (const listener of this.listeners) listener(); }
  controller(): BackendSession { return this as unknown as BackendSession; }
  identity(): ActivityTaskRequestIdentity {
    return { apiUrl: this.config.apiUrl, userId: this.snapshot.user!.id, activityId: localId, remoteProjectId: this.snapshot.project!.id };
  }
}
function currentMarker(session: ReactiveSession): ActivityTaskRequestMarker | undefined {
  return structuredClone(boundary.records.get(JSON.stringify(activityTaskRequestStorageKey(session.identity())))) as ActivityTaskRequestMarker | undefined;
}
function completed(session: ReactiveSession, overrides: Partial<ActivityTaskRun> = {}): ActivityTaskRun {
  const marker = currentMarker(session);
  if (!marker) throw new Error('POST must follow a persisted and read-back marker');
  return activityTaskRunSchema.parse({ kind: 'activity_tasks', id: uuid(20), projectId: remoteId, requestId: marker.requestId,
    activityId: localId, contextHash: marker.contextHash, state: 'complete', progress: '演练合成回复完成', callCount: 1,
    expiresAt: '2099-01-01T00:00:00Z', activityResult: { suggestions: [
      { title: '建议签到通道核对', phase: 'setup', acceptance: '人工逐项核对选定签到桌和通道', objectIds: [objectId] },
      { title: '建议反馈整理', phase: 'event', acceptance: '人工整理待处理反馈', objectIds: [] },
    ] }, ...overrides });
}
function setup(session = new ReactiveSession()) {
  let isActive = true;
  const renderedIds: (string | undefined)[] = [];
  const ensure = vi.fn(() => {});
  const persist = vi.fn<(expected: RoomLayout, next: RoomLayout, guard: () => void) => Promise<RoomLayout>>();
  persist.mockImplementation(async (_expected, next, guard) => {
    guard(); boundary.events.push({ action: 'layout-save' });
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw || canonical(JSON.parse(raw)) !== canonical(next)) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    boundary.events.push({ action: 'layout-readback' });
    guard(); return structuredClone(next);
  });
  const commit = vi.fn((operations: EventOperations) => layoutStore.getState().actions.setEventOperations(operations));
  function Harness() {
    const layout = useLayout(); renderedIds.push(layout.id);
    return <ActivityTaskWorkspace layout={layout} controller={session.controller()} isActive={isActive} disabled={false}
      ensurePersistentIdentity={ensure} persistVerifiedLayout={persist} onCommitOperations={commit}/>;
  }
  const view = render(<Harness/>);
  return { session, ensure, persist, commit, renderedIds, view,
    active(value: boolean) { isActive = value; view.rerender(<Harness/>); },
  };
}
async function selectionReady() {
  await waitFor(() => expect((screen.getByRole('button', { name: '查看待发送摘要' }) as HTMLButtonElement).disabled).toBe(false));
}
async function disclose(includeTask = true) {
  await selectionReady();
  fireEvent.change(screen.getByLabelText('选定需求'), { target: { value: '只参考这段明确选定的演练需求' } });
  fireEvent.change(screen.getByLabelText('希望整理什么任务'), { target: { value: '整理签到核对和反馈任务' } });
  if (includeTask) fireEvent.click(screen.getByLabelText('原签到核对布场'));
  fireEvent.click(screen.getByLabelText('演练签到桌演练一层 · 位置 X 1 m / Z 2 m'));
  fireEvent.click(screen.getByLabelText('未摆放的演练椅演练一层 · 位置未记录'));
  fireEvent.click(screen.getByRole('button', { name: '查看待发送摘要' }));
  await screen.findByRole('region', { name: '待发送摘要' });
  await waitFor(() => expect((screen.getByLabelText('我已核对，确认发送以上内容') as HTMLInputElement).disabled).toBe(false));
}
async function send() {
  fireEvent.click(screen.getByLabelText('我已核对，确认发送以上内容'));
  fireEvent.click(screen.getByRole('button', { name: '确认发送' }));
}
async function prepared() {
  await screen.findByRole('region', { name: '本次任务建议' });
  await waitFor(() => expect((screen.getByLabelText('建议签到通道核对布场') as HTMLInputElement).disabled).toBe(false));
}
async function chooseAndSave() {
  await prepared(); fireEvent.click(screen.getByLabelText('建议签到通道核对布场'));
  fireEvent.click(screen.getByRole('button', { name: '保存勾选任务' }));
}
beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto); window.history.replaceState({}, '', '/?local=1'); window.localStorage.clear();
  boundary.records.clear(); boundary.events.length = 0; boundary.failCommit = false; boundary.failNextRead = false; boundary.failReadbackState = null;
  layoutStore.getState().actions.applyLayout(fixture());
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(layoutStore.getState().layout));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('ActivityTaskWorkspace disclosure and durable request', () => {
  it('clears an unsent disclosure on activity switch so invisible old task and object IDs cannot enter the next activity summary', async () => {
    const host = setup(); await disclose(); fireEvent.click(screen.getByLabelText('我已核对，确认发送以上内容'));
    const second = makeLayout({ id: 'house-task-workspace-rehearsal-b', name: '另一场任务假设演练',
      floors: [makeFloor({ id: 'rehearsal-floor-b', name: 'B演练层', items: [
        makeItem({ id: 'rehearsal-object-b', name: 'B演练桌', type: 'table', position: { x: 4, z: 5 } }),
      ] })], eventOperations: eventOperationsSchema.parse({ dataKind: 'rehearsal', tasks: [
        { id: uuid(41), title: 'B原任务', phase: 'setup', acceptance: '仅核对B活动', objectIds: ['rehearsal-object-b'] },
      ] }),
    });
    act(() => { layoutStore.getState().actions.applyLayout(second); }); await selectionReady();
    expect((screen.getByLabelText('选定需求') as HTMLTextAreaElement).value).toBe('');
    expect((screen.getByLabelText('希望整理什么任务') as HTMLTextAreaElement).value).toBe('');
    expect((screen.getByLabelText('B原任务布场') as HTMLInputElement).checked).toBe(false);
    expect((screen.getByLabelText('B演练桌B演练层 · 位置 X 4 m / Z 5 m') as HTMLInputElement).checked).toBe(false);
    expect(screen.queryByRole('region', { name: '待发送摘要' })).toBeNull();
    fireEvent.change(screen.getByLabelText('选定需求'), { target: { value: '只使用B活动的新需求' } });
    fireEvent.change(screen.getByLabelText('希望整理什么任务'), { target: { value: '核对B任务' } });
    fireEvent.click(screen.getByLabelText('B原任务布场'));
    fireEvent.click(screen.getByLabelText('B演练桌B演练层 · 位置 X 4 m / Z 5 m'));
    fireEvent.click(screen.getByRole('button', { name: '查看待发送摘要' }));
    const disclosure = within(await screen.findByRole('region', { name: '待发送摘要' }));
    expect(disclosure.getByText('B原任务')).toBeTruthy(); expect(disclosure.getByText('B演练桌')).toBeTruthy();
    expect(disclosure.queryByText('原签到核对')).toBeNull(); expect(disclosure.queryByText('演练签到桌')).toBeNull();
    expect(disclosure.queryByText('只参考这段明确选定的演练需求')).toBeNull();
    expect((screen.getByLabelText('我已核对，确认发送以上内容') as HTMLInputElement).checked).toBe(false);
    expect(host.session.startActivityTaskRun).not.toHaveBeenCalled(); expect(boundary.records.size).toBe(0); expect(host.persist).not.toHaveBeenCalled();
  });

  it('keeps unsent selection and instruction when the same activity explicitly gains a scene-service binding and its lease renews', async () => {
    const session = new ReactiveSession(), bound = session.getSnapshot();
    session.update({ project: null, geometryBinding: null, lease: null });
    const host = setup(session); await disclose(); fireEvent.click(screen.getByLabelText('我已核对，确认发送以上内容'));
    act(() => { session.update({ project: bound.project, geometryBinding: bound.geometryBinding ?? null, lease: bound.lease }); });
    await selectionReady();
    expect((screen.getByLabelText('选定需求') as HTMLTextAreaElement).value).toBe('只参考这段明确选定的演练需求');
    expect((screen.getByLabelText('希望整理什么任务') as HTMLTextAreaElement).value).toBe('整理签到核对和反馈任务');
    expect((screen.getByLabelText('原签到核对布场') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText('演练签到桌演练一层 · 位置 X 1 m / Z 2 m') as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '查看待发送摘要' }));
    await screen.findByRole('region', { name: '待发送摘要' });
    act(() => { session.update({ revision: 2, project: { ...bound.project!, revision: 2 },
      lease: { ...bound.lease!, revision: 2, generation: 2, expiresAt: '2099-01-02T00:00:00Z' } }); });
    await selectionReady();
    expect((screen.getByLabelText('选定需求') as HTMLTextAreaElement).value).toBe('只参考这段明确选定的演练需求');
    expect((screen.getByLabelText('希望整理什么任务') as HTMLTextAreaElement).value).toBe('整理签到核对和反馈任务');
    expect((screen.getByLabelText('原签到核对布场') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText('未摆放的演练椅演练一层 · 位置未记录') as HTMLInputElement).checked).toBe(true);
    expect(host.session.startActivityTaskRun).not.toHaveBeenCalled(); expect(boundary.records.size).toBe(0);
  });

  it('sends only reviewed normalized selected facts, after the original request marker commits and reads back', async () => {
    const host = setup(), before = structuredClone(layoutStore.getState().layout);
    await disclose();
    const summary = within(screen.getByRole('region', { name: '待发送摘要' }));
    expect(summary.getByText('只参考这段明确选定的演练需求')).toBeTruthy();
    expect(summary.queryByText('不得披露的负责人')).toBeNull(); expect(summary.queryByText('不得披露的原证据')).toBeNull();
    expect(host.session.startActivityTaskRun).not.toHaveBeenCalled(); expect(currentMarker(host.session)).toBeUndefined();
    expect((screen.getByRole('button', { name: '确认发送' }) as HTMLButtonElement).disabled).toBe(true);
    await send(); await prepared();
    const input = host.session.startActivityTaskRun.mock.calls[0][0];
    expect(input.activityContext).toEqual(activityTaskContextSchema.parse(input.activityContext));
    expect(input.activityContext.projectId).toBe(localId); expect(input.activityContext.projectId).not.toBe(remoteId);
    expect(input.activityContext.tasks.map(task => task.id)).toEqual([uuid(10)]);
    expect(input.activityContext.objects[1]).toMatchObject({ position: null, elevation: null });
    for (const secret of ['不得披露的负责人', '不得披露的外包方', '不得披露的原证据', 'private-evidence', 'token=not-for-disclosure', '999']) {
      expect(canonical(input)).not.toContain(secret);
    }
    expect(boundary.events.slice(0, boundary.events.findIndex(event => event.action === 'POST')).slice(-2)).toEqual([
      { action: 'marker-commit', state: 'requested' }, { action: 'marker-read', state: 'requested' },
    ]);
    expect(currentMarker(host.session)?.requestId).toBe(input.requestId); expect(host.ensure).toHaveBeenCalledOnce();
    expect(layoutStore.getState().layout).toEqual(before); expect(host.persist).not.toHaveBeenCalled();
  });

  it.each(['commit', 'readback'] as const)('never POSTs after marker %s failure, keeping the disclosure and committed original request', async failure => {
    const host = setup(); await disclose();
    if (failure === 'commit') boundary.failCommit = true; else boundary.failReadbackState = 'requested';
    await send(); await screen.findByRole('alert');
    expect(host.session.startActivityTaskRun).not.toHaveBeenCalled(); expect(host.persist).not.toHaveBeenCalled();
    expect(within(screen.getByRole('region', { name: '待发送摘要' })).getByText('只参考这段明确选定的演练需求')).toBeTruthy();
    const marker = currentMarker(host.session);
    if (failure === 'commit') expect(marker).toBeUndefined();
    else { expect(marker?.state).toBe('requested'); expect(screen.getByRole('button', { name: '查询原请求' })).toBeTruthy(); }
  });

  it.each([new TypeError('演练：网络丢失 POST 回复'), new SceneApiError('INVALID_RESPONSE', 502, '演练：POST DTO 不能确认')])(
    'retains one marker after an unknown POST and only queries it, without preparing again after reopen', async failure => {
      const host = setup(); host.session.startActivityTaskRun.mockRejectedValueOnce(failure);
      await disclose(); await send(); await screen.findByRole('alert');
      const original = currentMarker(host.session)!;
      expect(original.state).toBe('requested'); expect(original.proposal).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: '查询原请求' })); await prepared();
      const first = currentMarker(host.session)!; expect(first.requestId).toBe(original.requestId);
      expect(host.session.getActivityTaskRunByRequest).toHaveBeenCalledExactlyOnceWith(original.requestId);
      expect(host.session.startActivityTaskRun).toHaveBeenCalledOnce();
      cleanup(); const reopened = setup(host.session); await prepared();
      expect(currentMarker(host.session)?.proposal).toEqual(first.proposal);
      expect(host.session.startActivityTaskRun).toHaveBeenCalledOnce(); expect(host.session.getActivityTaskRunByRequest).toHaveBeenCalledOnce();
      expect(reopened.persist).not.toHaveBeenCalled();
    });

  it.each(['signed-out', 'unbound', 'expired', 'cloud'] as const)('does not POST after a reviewed summary loses its %s authorization', async mode => {
    const host = setup(), session = host.session; await disclose(); fireEvent.click(screen.getByLabelText('我已核对，确认发送以上内容'));
    act(() => {
      if (mode === 'signed-out') session.update({ user: null });
      if (mode === 'unbound') session.update({ geometryBinding: null });
      if (mode === 'expired') session.update({ lease: { ...session.snapshot.lease!, expiresAt: '2000-01-01T00:00:00Z' } });
      if (mode === 'cloud') { window.history.replaceState({}, '', `/?project=${remoteId}`); host.active(true); }
    });
    await waitFor(() => { const sendButton = screen.queryByRole('button', { name: '确认发送' });
      expect(!sendButton || (sendButton as HTMLButtonElement).disabled).toBe(true); });
    expect(host.session.startActivityTaskRun).not.toHaveBeenCalled(); expect(boundary.records.size).toBe(0);
  });

  it('does not prepare again when complete GET committed but its readback failed and the user queries the same request again', async () => {
    const host = setup(); host.session.startActivityTaskRun.mockRejectedValueOnce(new TypeError('演练：POST 回复未知'));
    await disclose(); await send(); await screen.findByRole('alert');
    boundary.failReadbackState = 'prepared';
    fireEvent.click(screen.getByRole('button', { name: '查询原请求' }));
    await screen.findByText(/任务建议记录已提交，但读回未确认/);
    const committed = currentMarker(host.session)!;
    expect(committed.state).toBe('prepared');
    const random = vi.spyOn(globalThis.crypto, 'randomUUID');
    fireEvent.click(screen.getByRole('button', { name: '查询原请求' })); await prepared();
    expect(random).not.toHaveBeenCalled(); expect(currentMarker(host.session)?.proposal).toEqual(committed.proposal);
    expect(host.session.getActivityTaskRunByRequest.mock.calls).toEqual([[committed.requestId], [committed.requestId]]);
    expect(host.session.startActivityTaskRun).toHaveBeenCalledOnce(); expect(host.persist).not.toHaveBeenCalled();
  });
});

describe('ActivityTaskWorkspace proposed save and receipt', () => {
  it('saves the first suggested task from a source with no eventOperations and reopens closed without inventing an initial empty task list', async () => {
    const empty = fixture(); delete empty.eventOperations;
    layoutStore.getState().actions.applyLayout(empty); window.localStorage.setItem(STORAGE_KEY, JSON.stringify(empty));
    const host = setup(); expect(layoutStore.getState().layout.eventOperations).toBeUndefined();
    await disclose(false); await send(); await prepared();
    const proposal = currentMarker(host.session)!.proposal!;
    expect(currentMarker(host.session)?.context.summary).toMatchObject({ dataKind: 'unspecified', tasks: [] });
    expect(layoutStore.getState().layout.eventOperations).toBeUndefined();
    await chooseAndSave(); await screen.findByText('勾选任务已保存，可在活动安排中继续编辑。');
    const saved = layoutStore.getState().layout;
    expect(saved.eventOperations).toMatchObject({ dataKind: 'unspecified', tasks: [proposal.tasks[0]] });
    expect(saved.eventOperations?.tasks).toHaveLength(1); expect(saved.eventOperations?.tasks[0].status).toBe('todo');
    expect(saved.floors).toEqual(empty.floors); expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY)!).eventOperations).toEqual(saved.eventOperations);
    const closed = currentMarker(host.session)!; expect(closed.state).toBe('closed');
    cleanup(); const reopened = setup(host.session); await screen.findByText('勾选任务已保存，可在活动安排中继续编辑。');
    expect(currentMarker(host.session)).toEqual(closed); expect(layoutStore.getState().layout.eventOperations?.tasks).toEqual([proposal.tasks[0]]);
    expect(reopened.persist).not.toHaveBeenCalled(); expect(host.session.startActivityTaskRun).toHaveBeenCalledOnce();
  });

  it.each(['empty-operations', 'manual-task', 'changed-kind'] as const)(
    'does not normalize away a manual %s change after previewing a source with no eventOperations', async change => {
      const empty = fixture(); delete empty.eventOperations;
      layoutStore.getState().actions.applyLayout(empty); window.localStorage.setItem(STORAGE_KEY, JSON.stringify(empty));
      const host = setup(); await disclose(false); await send(); await prepared();
      fireEvent.click(screen.getByLabelText('建议签到通道核对布场'));
      const proposal = currentMarker(host.session)!;
      const operations = eventOperationsSchema.parse({ dataKind: change === 'changed-kind' ? 'rehearsal' : 'unspecified',
        tasks: change === 'manual-task' ? [{ id: uuid(40), title: '用户刚新增的第一项任务', phase: 'event' }] : [] });
      act(() => { layoutStore.getState().actions.setEventOperations(operations); });
      await screen.findByText(/活动资料已变化，本次摘要和建议不能继续确认/);
      expect((screen.getByRole('button', { name: '保存勾选任务' }) as HTMLButtonElement).disabled).toBe(true);
      expect(host.persist).not.toHaveBeenCalled(); expect(currentMarker(host.session)).toEqual(proposal);
      expect(layoutStore.getState().layout.eventOperations).toEqual(operations);
    });

  it('stages the exact chosen stable IDs before saving, closes only after readback and appends todo without changing old tasks', async () => {
    const host = setup(), before = structuredClone(layoutStore.getState().layout), save = deferred<RoomLayout>();
    host.persist.mockImplementation(async (expected, next, guard) => {
      guard(); expect(expected).toBe(layoutStore.getState().layout);
      const marker = currentMarker(host.session)!;
      expect(marker.state).toBe('saving'); expect(marker.receipt).toBeNull(); expect(marker.pending?.operations).toEqual(next.eventOperations);
      boundary.events.push({ action: 'layout-save' }); const result = await save.promise; guard(); return result;
    });
    await disclose(); await send(); await chooseAndSave();
    await waitFor(() => expect(host.persist).toHaveBeenCalledOnce());
    const pending = currentMarker(host.session)!;
    expect(pending.pending?.receipt.acceptedTaskIds).toEqual([pending.proposal!.tasks[0].id]);
    expect(currentMarker(host.session)?.state).toBe('saving'); expect(host.commit).not.toHaveBeenCalled();
    expect(screen.queryByText('勾选任务已保存，可在活动安排中继续编辑。')).toBeNull();
    const next = host.persist.mock.calls[0][1];
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    await act(async () => { save.resolve(structuredClone(next)); });
    await screen.findByText('勾选任务已保存，可在活动安排中继续编辑。');
    const actual = layoutStore.getState().layout;
    expect(actual.eventOperations?.tasks.slice(0, 2)).toEqual(before.eventOperations?.tasks);
    expect(actual.eventOperations?.tasks).toHaveLength(3);
    expect(actual.eventOperations?.tasks[2]).toMatchObject({ id: pending.proposal!.tasks[0].id, status: 'todo', ownerName: '', contractorName: '',
      plannedStartAt: null, plannedEndAt: null, actualStartedAt: null, actualFinishedAt: null, evidenceNote: '', evidenceUrls: [] });
    expect(actual.floors).toEqual(before.floors); expect(currentMarker(host.session)?.state).toBe('closed');
    expect(currentMarker(host.session)?.receipt).toEqual(pending.pending?.receipt);
  });

  it('keeps pending IDs after failed layout save; verification does not write and an explicit retry uses the original proposal', async () => {
    const host = setup(); host.persist.mockRejectedValueOnce(new Error('演练：主活动保存读回失败'));
    await disclose(); await send(); await chooseAndSave(); await screen.findByRole('alert');
    const pending = currentMarker(host.session)!;
    expect(pending.state).toBe('saving'); expect(pending.receipt).toBeNull(); expect(host.commit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '核对原保存结果' }));
    await screen.findByText(/原任务尚未完整读回确认/); expect(host.persist).toHaveBeenCalledOnce();
    cleanup(); const reopened = setup(host.session);
    await screen.findByRole('button', { name: '重试原任务保存' });
    expect(currentMarker(host.session)?.proposal).toEqual(pending.proposal);
    fireEvent.click(screen.getByRole('button', { name: '重试原任务保存' }));
    await screen.findByText('勾选任务已保存，可在活动安排中继续编辑。');
    expect(reopened.persist).toHaveBeenCalledOnce();
    expect(reopened.persist.mock.calls[0][1].eventOperations).toEqual(pending.pending?.operations);
    expect(host.session.startActivityTaskRun).toHaveBeenCalledOnce(); expect(host.session.getActivityTaskRunByRequest).not.toHaveBeenCalled();
    expect(currentMarker(host.session)?.proposal).toEqual(pending.proposal); expect(layoutStore.getState().layout.eventOperations?.tasks).toHaveLength(3);
  });

  it('can verify a committed layout after closing-marker failure without another POST or changing chosen IDs', async () => {
    const host = setup(); await disclose(); await send(); await prepared();
    boundary.failReadbackState = 'closed'; await chooseAndSave(); await screen.findByRole('alert');
    const committed = currentMarker(host.session)!;
    expect(committed.state).toBe('closed'); expect(layoutStore.getState().layout.eventOperations?.tasks).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: '核对原保存结果' }));
    await screen.findByText('勾选任务已保存，可在活动安排中继续编辑。');
    expect(host.persist).toHaveBeenCalledOnce(); expect(currentMarker(host.session)).toEqual(committed);
    expect(host.session.startActivityTaskRun).toHaveBeenCalledOnce(); expect(host.session.getActivityTaskRunByRequest).not.toHaveBeenCalled();
  });

  it('only reads a previously committed task save, closes its receipt and preserves newer in-memory geometry', async () => {
    const host = setup();
    host.persist.mockImplementationOnce(async (_expected, next, guard) => {
      guard(); window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      throw new Error('演练：写入成功但调用方未拿到保存读回');
    });
    await disclose(); await send(); await chooseAndSave(); await screen.findByRole('alert');
    const pending = currentMarker(host.session)!;
    expect(pending.state).toBe('saving'); expect(layoutStore.getState().layout.eventOperations?.tasks).toHaveLength(2);
    const storedBefore = window.localStorage.getItem(STORAGE_KEY);
    expect(JSON.parse(storedBefore!).eventOperations.tasks).toHaveLength(3);
    const writes = vi.spyOn(Storage.prototype, 'setItem');
    act(() => { layoutStore.getState().actions.setWidth(9); });
    fireEvent.click(screen.getByRole('button', { name: '核对原保存结果' }));
    await screen.findByText('勾选任务已保存，可在活动安排中继续编辑。');
    expect(writes).not.toHaveBeenCalled(); expect(window.localStorage.getItem(STORAGE_KEY)).toBe(storedBefore);
    expect(layoutStore.getState().layout.width).toBe(9);
    expect(layoutStore.getState().layout.eventOperations).toEqual(pending.pending?.operations);
    expect(currentMarker(host.session)).toMatchObject({ state: 'closed', receipt: pending.pending?.receipt, proposal: pending.proposal });
    expect(host.session.startActivityTaskRun).toHaveBeenCalledOnce(); expect(host.session.getActivityTaskRunByRequest).not.toHaveBeenCalled();
  });

  it('respects other dirty source editors and retains the selected proposal without staging or saving tasks', async () => {
    const host = setup(); await disclose(); await send(); await prepared();
    const original = currentMarker(host.session)!;
    const unregister = registerSourceFlush(localId, async () => { throw new Error('演练：原资料尚有未保存修改'); });
    try {
      await chooseAndSave(); await screen.findByText('演练：原资料尚有未保存修改');
      expect(host.persist).not.toHaveBeenCalled(); expect(currentMarker(host.session)).toEqual(original);
      expect((screen.getByLabelText('建议签到通道核对布场') as HTMLInputElement).checked).toBe(true);
    } finally { unregister(); }
  });

  it('does not resurrect a closed accepted task after manual editing or deleting it and reopening', async () => {
    const host = setup(); await disclose(); await send(); await chooseAndSave(); await screen.findByText('勾选任务已保存，可在活动安排中继续编辑。');
    const original = currentMarker(host.session)!;
    const taskId = original.receipt!.acceptedTaskIds[0];
    const operations = structuredClone(layoutStore.getState().layout.eventOperations!);
    operations.tasks.find(task => task.id === taskId)!.title = '人工修改后必须保留';
    act(() => { layoutStore.getState().actions.setEventOperations(operations); });
    cleanup(); const edited = setup(host.session); await screen.findByText('勾选任务已保存，可在活动安排中继续编辑。');
    expect(layoutStore.getState().layout.eventOperations?.tasks.find(task => task.id === taskId)?.title).toBe('人工修改后必须保留');
    expect(edited.persist).not.toHaveBeenCalled();
    const removed = { ...operations, tasks: operations.tasks.filter(task => task.id !== taskId) };
    act(() => { layoutStore.getState().actions.setEventOperations(removed); });
    cleanup(); const reopened = setup(host.session); await screen.findByText('勾选任务已保存，可在活动安排中继续编辑。');
    expect(layoutStore.getState().layout.eventOperations).toEqual(removed); expect(currentMarker(host.session)).toEqual(original);
    expect(reopened.persist).not.toHaveBeenCalled(); expect(host.session.startActivityTaskRun).toHaveBeenCalledOnce();
  });
});

describe('ActivityTaskWorkspace late results and identity', () => {
  it.each(['contextHash', 'activityId', 'projectId', 'requestId'] as const)(
    'does not prepare a typed complete response with the wrong %s binding', async field => {
      const host = setup(); host.session.startActivityTaskRun.mockImplementationOnce(async () => completed(host.session, {
        [field]: field === 'contextHash' ? '0'.repeat(64) : field === 'activityId' ? 'another-local-activity' : uuid(33),
      }));
      await disclose(); await send(); await screen.findByText('返回结果与原活动请求不一致。');
      expect(currentMarker(host.session)).toMatchObject({ state: 'requested', proposal: null, pending: null });
      expect(host.persist).not.toHaveBeenCalled(); expect(host.commit).not.toHaveBeenCalled();
      expect(layoutStore.getState().layout.eventOperations).toEqual(fixture().eventOperations);
    });

  it.each(['source', 'activity-aba', 'account-aba', 'project-aba', 'lease-aba', 'revision-aba', 'inactive'] as const)(
    'does not prepare a late complete result after %s changes', async change => {
      const host = setup(), post = deferred<ActivityTaskRun>(); host.session.startActivityTaskRun.mockReturnValueOnce(post.promise);
      await disclose(); await send(); await waitFor(() => expect(host.session.startActivityTaskRun).toHaveBeenCalledOnce());
      const original = currentMarker(host.session)!, value = completed(host.session), before = host.renderedIds.length;
      act(() => {
        if (change === 'source') layoutStore.getState().actions.moveItem(objectId, 2, 2);
        if (change === 'activity-aba') {
          layoutStore.getState().actions.applyLayout(makeLayout({ id: 'other-rehearsal-activity' })); layoutStore.getState().actions.applyLayout(fixture());
          expect(host.renderedIds).toHaveLength(before);
        }
        if (change === 'account-aba') { host.session.update({ user: { id: uuid(31) } }); host.session.update({ user: { id: userId } }); }
        if (change === 'project-aba') {
          const project = host.session.snapshot.project, binding = host.session.snapshot.geometryBinding;
          host.session.update({ project: { ...project!, id: uuid(32) }, geometryBinding: { ...binding!, cloudProjectId: uuid(32) } });
          host.session.update({ project, geometryBinding: binding ?? null });
        }
        if (change === 'lease-aba') {
          const lease = host.session.snapshot.lease; host.session.update({ lease: { ...lease!, generation: 2 } }); host.session.update({ lease });
        }
        if (change === 'revision-aba') { host.session.update({ revision: 2 }); host.session.update({ revision: 1 }); }
        if (change === 'inactive') host.active(false);
      });
      await act(async () => { post.resolve(value); });
      await waitFor(() => expect(currentMarker(host.session)?.state).toBe('requested'));
      expect(currentMarker(host.session)?.proposal).toBeNull(); expect(currentMarker(host.session)?.requestId).toBe(original.requestId);
      expect(host.persist).not.toHaveBeenCalled(); expect(host.commit).not.toHaveBeenCalled();
      expect(screen.queryByRole('region', { name: '本次任务建议' })).toBeNull();
    });

  it('locally cancels an in-flight request and never prepares its later complete result', async () => {
    const host = setup(), post = deferred<ActivityTaskRun>(); host.session.startActivityTaskRun.mockReturnValueOnce(post.promise);
    await disclose(); await send(); await waitFor(() => expect(host.session.startActivityTaskRun).toHaveBeenCalledOnce());
    const value = completed(host.session), originalId = currentMarker(host.session)!.requestId;
    fireEvent.click(screen.getByRole('button', { name: '取消本次建议' })); await screen.findByText('本次建议已取消。');
    await act(async () => { post.resolve(value); });
    expect(currentMarker(host.session)).toMatchObject({ state: 'cancelled', requestId: originalId, proposal: null });
    expect(host.session.startActivityTaskRun).toHaveBeenCalledOnce(); expect(host.session.cancelActivityTaskRun).toHaveBeenCalledExactlyOnceWith(value.id);
    expect(host.persist).not.toHaveBeenCalled(); expect(host.commit).not.toHaveBeenCalled();
  });

  it('invalidates a prepared selection after source change and preserves original records instead of confirming old suggestions', async () => {
    const host = setup(); await disclose(); await send(); await prepared();
    fireEvent.click(screen.getByLabelText('建议签到通道核对布场'));
    const original = currentMarker(host.session)!;
    act(() => { const operations = structuredClone(layoutStore.getState().layout.eventOperations!);
      operations.tasks[0].acceptance = '更新后的人工完成条件'; layoutStore.getState().actions.setEventOperations(operations); });
    await screen.findByText(/活动资料已变化，本次摘要和建议不能继续确认/);
    expect((screen.getByRole('button', { name: '保存勾选任务' }) as HTMLButtonElement).disabled).toBe(true);
    expect(currentMarker(host.session)).toEqual(original); expect(host.persist).not.toHaveBeenCalled();
    expect(layoutStore.getState().layout.eventOperations?.tasks[0].acceptance).toBe('更新后的人工完成条件');
  });

  it('rechecks a live activity round trip after awaiting another source editor, before staging or saving the accepted selection', async () => {
    const host = setup(); await disclose(); await send(); await prepared();
    const original = currentMarker(host.session)!, held = deferred<void>(), flushing = vi.fn(async () => held.promise);
    const unregister = registerSourceFlush(localId, flushing);
    try {
      await chooseAndSave(); await waitFor(() => expect(flushing).toHaveBeenCalledOnce());
      act(() => { layoutStore.getState().actions.applyLayout(makeLayout({ id: 'other-rehearsal-activity' }));
        layoutStore.getState().actions.applyLayout(fixture()); });
      await act(async () => { held.resolve(); });
      await screen.findByText('活动、账号或场景连接已变化，本次结果未写入。');
      expect(currentMarker(host.session)).toEqual(original); expect(host.persist).not.toHaveBeenCalled(); expect(host.commit).not.toHaveBeenCalled();
      expect(layoutStore.getState().layout.eventOperations).toEqual(fixture().eventOperations);
    } finally { unregister(); }
  });

  it.each(['activity-aba', 'account-aba', 'project-aba', 'active-aba'] as const)(
    'does not confirm a previously prepared proposal after a synchronous %s round trip', async change => {
      const host = setup(); await disclose(); await send(); await prepared();
      fireEvent.click(screen.getByLabelText('建议签到通道核对布场'));
      const original = currentMarker(host.session)!;
      act(() => {
        if (change === 'activity-aba') {
          layoutStore.getState().actions.applyLayout(makeLayout({ id: 'other-rehearsal' })); layoutStore.getState().actions.applyLayout(fixture());
        }
        if (change === 'account-aba') { host.session.update({ user: { id: uuid(31) } }); host.session.update({ user: { id: userId } }); }
        if (change === 'project-aba') {
          const project = host.session.snapshot.project, binding = host.session.snapshot.geometryBinding;
          host.session.update({ project: { ...project!, id: uuid(32) }, geometryBinding: { ...binding!, cloudProjectId: uuid(32) } });
          host.session.update({ project, geometryBinding: binding ?? null });
        }
      });
      if (change === 'active-aba') { host.active(false); host.active(true); }
      await screen.findByText(/活动资料已变化，本次摘要和建议不能继续确认/);
      expect((screen.getByRole('button', { name: '保存勾选任务' }) as HTMLButtonElement).disabled).toBe(true);
      expect(currentMarker(host.session)).toEqual(original); expect(host.persist).not.toHaveBeenCalled(); expect(host.commit).not.toHaveBeenCalled();
    });
});

describe('ActivityTaskWorkspace complete history and current authorization', () => {
  it('accepts historical complete results past the run deadline after reload and a fresh valid lease, retaining all proposal IDs', async () => {
    const host = setup(); host.session.startActivityTaskRun.mockImplementationOnce(async () => completed(host.session, { expiresAt: '2000-01-01T00:00:00Z' }));
    await disclose(); await send(); await prepared();
    const preparedMarker = currentMarker(host.session)!;
    expect(Date.parse(preparedMarker.run!.expiresAt)).toBeLessThan(Date.now());
    cleanup(); host.session.update({ lease: { ...host.session.snapshot.lease!, expiresAt: '2000-01-01T00:00:00Z' } });
    const reopened = setup(host.session); await screen.findByRole('region', { name: '本次任务建议' });
    expect(currentMarker(host.session)?.proposal).toEqual(preparedMarker.proposal);
    expect((screen.getByRole('button', { name: '保存勾选任务' }) as HTMLButtonElement).disabled).toBe(true);
    act(() => { host.session.update({ revision: 2, project: { ...host.session.snapshot.project!, revision: 2 },
      lease: { ...host.session.snapshot.lease!, revision: 2, generation: 2, expiresAt: '2099-01-01T00:00:00Z' } }); });
    const random = vi.spyOn(globalThis.crypto, 'randomUUID');
    await chooseAndSave(); await screen.findByText('勾选任务已保存，可在活动安排中继续编辑。');
    expect(host.session.getActivityTaskRun).toHaveBeenCalledExactlyOnceWith(preparedMarker.run!.id);
    expect(host.session.startActivityTaskRun).toHaveBeenCalledOnce(); expect(host.session.getActivityTaskRunByRequest).not.toHaveBeenCalled();
    expect(random).not.toHaveBeenCalled(); expect(reopened.persist).toHaveBeenCalledOnce();
    expect(currentMarker(host.session)?.proposal).toEqual(preparedMarker.proposal);
    expect(currentMarker(host.session)?.receipt?.acceptedTaskIds).toEqual([preparedMarker.proposal!.tasks[0].id]);
    expect(layoutStore.getState().layout.eventOperations?.tasks[2].id).toBe(preparedMarker.proposal!.tasks[0].id);
  });

  it.each(['2000-01-01T00:00:00Z', 'not-a-date'])(
    'blocks first acceptance with an expired or malformed current lease (%s) without GET, staging or writing', async expiresAt => {
      const host = setup(); await disclose(); await send(); await prepared();
      fireEvent.click(screen.getByLabelText('建议签到通道核对布场'));
      const original = currentMarker(host.session)!;
      act(() => { host.session.update({ lease: { ...host.session.snapshot.lease!, expiresAt } }); });
      await screen.findByText('当前场景没有有效编辑权，请在账户中核对连接。');
      expect((screen.getByRole('button', { name: '保存勾选任务' }) as HTMLButtonElement).disabled).toBe(true);
      expect(host.session.getActivityTaskRun).not.toHaveBeenCalled(); expect(host.persist).not.toHaveBeenCalled();
      expect(currentMarker(host.session)).toEqual(original); expect(host.commit).not.toHaveBeenCalled();
    });

  it.each(['generation-aba', 'revision-aba', 'expired', 'malformed'] as const)(
    'rejects a late first-acceptance GET after the current lease or revision changes (%s)', async change => {
      const host = setup(), get = deferred<ActivityTaskRun>(); await disclose(); await send(); await prepared();
      const original = currentMarker(host.session)!;
      host.session.getActivityTaskRun.mockReturnValueOnce(get.promise);
      await chooseAndSave(); await waitFor(() => expect(host.session.getActivityTaskRun).toHaveBeenCalledOnce());
      act(() => {
        const lease = host.session.snapshot.lease;
        if (change === 'generation-aba') { host.session.update({ lease: { ...lease!, generation: 2 } }); host.session.update({ lease }); }
        if (change === 'revision-aba') { host.session.update({ revision: 2 }); host.session.update({ revision: 1 }); }
        if (change === 'expired' || change === 'malformed') host.session.update({ lease: { ...lease!, expiresAt: change === 'expired' ? '2000-01-01T00:00:00Z' : 'not-a-date' } });
      });
      await act(async () => { get.resolve(original.run!); });
      await screen.findByRole('alert');
      expect(currentMarker(host.session)).toEqual(original); expect(host.persist).not.toHaveBeenCalled(); expect(host.commit).not.toHaveBeenCalled();
      expect(host.session.startActivityTaskRun).toHaveBeenCalledOnce();
    });

  it.each(['cancelled', 'failed', 'get-error', 'changed-hash', 'changed-result'] as const)(
    'retains the original selected proposal when the fresh original-run GET is %s, without staging or writing', async result => {
      const host = setup(); await disclose(); await send(); await prepared();
      const original = currentMarker(host.session)!;
      if (result === 'get-error') host.session.getActivityTaskRun.mockRejectedValueOnce(new TypeError('演练：原运行查询失败'));
      else host.session.getActivityTaskRun.mockResolvedValueOnce(result === 'changed-result'
        ? completed(host.session, { activityResult: { suggestions: [{ title: '服务器后来给出的其他内容', phase: 'event', acceptance: '必须重新核对', objectIds: [] }] } })
        : result === 'changed-hash' ? completed(host.session, { contextHash: '0'.repeat(64) })
        : completed(host.session, { state: result, activityResult: null }));
      await chooseAndSave(); await screen.findByRole('alert');
      expect(currentMarker(host.session)).toEqual(original); expect(host.persist).not.toHaveBeenCalled(); expect(host.commit).not.toHaveBeenCalled();
      expect((screen.getByLabelText('建议签到通道核对布场') as HTMLInputElement).checked).toBe(true);
      expect(host.session.getActivityTaskRun).toHaveBeenCalledExactlyOnceWith(original.run!.id);
      expect(host.session.startActivityTaskRun).toHaveBeenCalledOnce(); expect(host.session.getActivityTaskRunByRequest).not.toHaveBeenCalled();
    });

  it('verifies an already saving local readback with an expired lease and no additional network request', async () => {
    const host = setup(); host.persist.mockImplementationOnce(async (_expected, next, guard) => {
      guard(); window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      throw new Error('演练：保存成功但反馈未知');
    });
    await disclose(); await send(); await chooseAndSave(); await screen.findByRole('alert');
    const pending = currentMarker(host.session)!;
    expect(pending.state).toBe('saving');
    cleanup(); host.session.update({ lease: { ...host.session.snapshot.lease!, expiresAt: '2000-01-01T00:00:00Z' } });
    const reopened = setup(host.session); await screen.findByRole('button', { name: '核对原保存结果' });
    host.session.startActivityTaskRun.mockClear(); host.session.getActivityTaskRun.mockClear(); host.session.getActivityTaskRunByRequest.mockClear();
    const writes = vi.spyOn(Storage.prototype, 'setItem'), random = vi.spyOn(globalThis.crypto, 'randomUUID');
    fireEvent.click(screen.getByRole('button', { name: '核对原保存结果' }));
    await screen.findByText('勾选任务已保存，可在活动安排中继续编辑。');
    expect(host.session.startActivityTaskRun).not.toHaveBeenCalled(); expect(host.session.getActivityTaskRun).not.toHaveBeenCalled();
    expect(host.session.getActivityTaskRunByRequest).not.toHaveBeenCalled(); expect(writes).not.toHaveBeenCalled(); expect(random).not.toHaveBeenCalled();
    expect(reopened.commit).toHaveBeenCalledExactlyOnceWith(pending.pending!.operations);
    expect(currentMarker(host.session)?.receipt).toEqual(pending.pending?.receipt); expect(currentMarker(host.session)?.proposal).toEqual(pending.proposal);
  });
});
