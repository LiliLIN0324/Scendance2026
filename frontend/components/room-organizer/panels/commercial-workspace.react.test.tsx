// @vitest-environment jsdom
import { webcrypto } from 'node:crypto';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BackendSession, getBackendConfig, type BackendSnapshot } from '@/lib/backend-session';
import { readCommercialSnapshot, type CommercialContextGuard, type CommercialRead } from '@/lib/commercial-dossier-storage';
import { flushSourceScope } from '@/lib/source-storage';
import { eventOperationsSchema } from '../../../../supabase/functions/_shared/event-operations-contract';
import { layoutStore, useLayout } from '../hooks/use-layout-store';
import { makeFloor, makeItem, makeLayout } from '../lib/__testfixtures__/fixtures';
import { layoutToBackendScene } from '../lib/backend-adapter';
import { CommercialWorkspace } from './commercial-workspace';

const backup = vi.hoisted(() => ({ backupPending: false }));
vi.mock('./creative-studio', () => ({ useLocalProjectBackup: () => backup }));
vi.mock('@/lib/commercial-dossier-storage', async importOriginal => {
  const real = await importOriginal<typeof import('@/lib/commercial-dossier-storage')>();
  return { ...real, readCommercialSnapshot: vi.fn(), saveCommercialDraft: vi.fn(), freezeCommercialVersion: vi.fn(),
    appendCommercialSignatureReport: vi.fn(), discardCommercialDraft: vi.fn() };
});

const localId = 'commercial-host-rehearsal-a';
const remoteId = '10000000-0000-4000-8000-000000000001';
const chairId = '10000000-0000-4000-8000-000000000002';
const fixture = () => makeLayout({ id: localId, name: '合同身份接线演练',
  roof: { style: 'none', color: '#ffffff' }, floors: [makeFloor({ items: [makeItem({ id: chairId })] })] });

/** Only the public reactive session boundary is simulated; no private state or auth/network is changed. */
class ReactiveSession {
  config = getBackendConfig({ url: 'http://127.0.0.1:54333', anonKey: 'sb_publishable_local_integration_only' });
  snapshot: BackendSnapshot = { ...new BackendSession(this.config).getSnapshot(), user: { id: 'rehearsal-user-a' } };
  listeners = new Set<() => void>();
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
  bindGeometry(): void {
    this.update({ project: { id: remoteId, name: '仅场景连接的演练项目', studio_id: 'rehearsal-studio', revision: 1,
      scene: layoutToBackendScene(fixture()) }, geometryBinding: { version: 1, localActivityId: localId,
      userId: this.snapshot.user!.id, apiUrl: this.config.apiUrl, cloudProjectId: remoteId } });
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
const reads: { id: string; guard: CommercialContextGuard }[] = [];
const heldReads: ReturnType<typeof deferred<CommercialRead>>[] = [];
function holdNextRead() { const pending = deferred<CommercialRead>(); heldReads.push(pending); return pending; }
function absent(id = localId): CommercialRead { return { status: 'absent', projectId: id }; }
function setup(session = new ReactiveSession(), ensure = vi.fn(() => {})) {
  let controller = session.controller(), isActive = true;
  const renderedIds: (string | undefined)[] = [];
  function Harness() { const layout = useLayout(); renderedIds.push(layout.id); return <CommercialWorkspace controller={controller} layout={layout}
    isActive={isActive} ensurePersistentIdentity={ensure}/>; }
  const view = render(<Harness/>);
  return { ensure, session, renderedIds,
    rerender() { view.rerender(<Harness/>); },
    active(next: boolean) { isActive = next; view.rerender(<Harness/>); },
    controller(next: ReactiveSession) { controller = next.controller(); view.rerender(<Harness/>); },
  };
}
async function expectRead(count = 1) { await waitFor(() => expect(reads).toHaveLength(count)); return reads[count - 1]!; }
async function ready() { await waitFor(() => expect((screen.getByRole('button', { name: '新建客户委托' }) as HTMLButtonElement).disabled).toBe(false)); }

beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto);
  window.history.replaceState({}, '', '/?local=1'); backup.backupPending = false;
  reads.length = 0; heldReads.length = 0;
  layoutStore.getState().actions.applyLayout(fixture());
  vi.mocked(readCommercialSnapshot).mockReset().mockImplementation(async (id, guard) => {
    reads.push({ id, guard }); guard();
    const read = heldReads.shift(); const result = read ? await read.promise : absent(id);
    guard(); return result;
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('CommercialWorkspace real panel identity boundary', () => {
  it('does not read contracts when persistent identity verification fails, then retries with a synchronous valid guard', async () => {
    const pending = holdNextRead(), ensure = vi.fn<() => void>(() => { throw new Error('演练：本机保存失败'); });
    setup(new ReactiveSession(), ensure);
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('本机保存失败'));
    expect(readCommercialSnapshot).not.toHaveBeenCalled();
    ensure.mockImplementation(() => {});
    fireEvent.click(screen.getByRole('button', { name: '重新读取约定' }));
    const read = await expectRead();
    expect(read.id).toBe(localId); expect(read.guard()).toBeUndefined(); expect(ensure).toHaveBeenCalledTimes(2);
    await act(async () => { pending.resolve(absent()); }); await ready();
  });

  it('keeps its guard and unsaved draft through immutable geometry, task, floor and scene-service revision updates', async () => {
    const pending = holdNextRead(), host = setup(), read = await expectRead();
    act(() => {
      const actions = layoutStore.getState().actions;
      actions.moveItem(chairId, 1, 1);
      actions.setEventOperations(eventOperationsSchema.parse({ dataKind: 'rehearsal', tasks: [{
        id: '20000000-0000-4000-8000-000000000001', title: '演练任务', phase: 'preparation',
      }] }));
      actions.addFloor(); actions.setActiveFloorIndex(1); host.session.bindGeometry();
      host.session.update({ revision: 3, localRevision: 4 });
      expect(read.guard()).toBeUndefined();
    });
    await act(async () => { pending.resolve(absent()); }); await ready();
    fireEvent.click(screen.getByRole('button', { name: '新建客户委托' }));
    fireEvent.change(screen.getByLabelText('约定名称'), { target: { value: '未保存的演练约定' } });
    act(() => {
      layoutStore.getState().actions.setWidth(9); layoutStore.getState().actions.setActiveFloorIndex(0);
      host.session.update({ revision: 5, localRevision: 6 });
    });
    expect((screen.getByLabelText('约定名称') as HTMLInputElement).value).toBe('未保存的演练约定');
    expect(readCommercialSnapshot).toHaveBeenCalledTimes(1); expect(host.ensure).toHaveBeenCalledTimes(1);
    await expect(flushSourceScope(localId)).rejects.toThrow('未保存修改');
  });

  it('permanently invalidates an in-flight read across A to B to A in one React batch', async () => {
    const pending = holdNextRead(), host = setup(), read = await expectRead(), before = host.renderedIds.length;
    act(() => {
      layoutStore.getState().actions.applyLayout(makeLayout({ id: 'commercial-host-rehearsal-b' }));
      layoutStore.getState().actions.applyLayout(fixture());
      expect(host.renderedIds).toHaveLength(before);
      expect(read.guard).toThrow('已变化');
    });
    await act(async () => { pending.resolve(absent()); }); await expectRead(2); await ready();
    expect(read.guard).toThrow('已变化'); expect(reads[1]!.id).toBe(localId);
    expect(host.renderedIds).not.toContain('commercial-host-rehearsal-b');
  });

  it('observes public account notifications and rejects old reads even after the original account returns in one batch', async () => {
    const pending = holdNextRead(), host = setup(), read = await expectRead();
    act(() => {
      host.session.update({ user: { id: 'rehearsal-user-b' } });
      host.session.update({ user: { id: 'rehearsal-user-a' } });
      expect(read.guard).toThrow('已变化');
    });
    await act(async () => { pending.resolve(absent()); }); await expectRead(2); await ready();
    expect(read.guard).toThrow('已变化');
  });

  it('rejects old reads on API round trips and on controller replacement', async () => {
    const pending = holdNextRead(), host = setup(), read = await expectRead(), originalApi = host.session.config.apiUrl;
    act(() => {
      host.session.config.apiUrl = 'http://127.0.0.1:54334/functions/v1/scene-api'; host.session.emit();
      host.session.config.apiUrl = originalApi; host.session.emit(); expect(read.guard).toThrow('已变化');
    });
    await act(async () => { pending.resolve(absent()); }); await expectRead(2); await ready();
    const second = holdNextRead(); fireEvent.click(screen.getByRole('button', { name: '重新读取核对' }));
    const previousControllerRead = await expectRead(3);
    host.controller(new ReactiveSession());
    expect(previousControllerRead.guard).toThrow('已变化');
    await act(async () => { second.resolve(absent()); }); await expectRead(4); await ready();
  });

  it('does not read local dossiers in a formal cloud URL and invalidates old reads across local/cloud/local mode notifications', async () => {
    window.history.replaceState({}, '', '/?project=rehearsal-cloud-project');
    const cloud = setup();
    expect(readCommercialSnapshot).not.toHaveBeenCalled(); expect(cloud.ensure).not.toHaveBeenCalled();
    cleanup(); window.history.replaceState({}, '', '/?local=1');
    const pending = holdNextRead(), host = setup(), read = await expectRead();
    act(() => {
      host.session.update({ project: { id: remoteId, name: '正式云模式演练', studio_id: 'rehearsal-studio', revision: 1,
        scene: layoutToBackendScene(fixture()) }, geometryBinding: null });
      host.session.update({ project: null }); expect(read.guard).toThrow('已变化');
    });
    await act(async () => { pending.resolve(absent()); }); await expectRead(2); await ready();
  });

  it('invalidates old reads on leaving and returning to the active workspace', async () => {
    const pending = holdNextRead(), host = setup(), read = await expectRead();
    host.active(false); expect(read.guard).toThrow('已变化');
    host.active(true); expect(read.guard).toThrow('已变化');
    await act(async () => { pending.resolve(absent()); }); await expectRead(2); await ready();
    expect(host.ensure).toHaveBeenCalledTimes(2);
  });

  it('disables interaction during backup without changing identity and retains the real source-flush registration', async () => {
    const pending = holdNextRead(), host = setup(), read = await expectRead();
    backup.backupPending = true; host.rerender();
    expect(read.guard()).toBeUndefined();
    await expect(flushSourceScope(localId)).rejects.toThrow('正在处理');
    await act(async () => { pending.resolve(absent()); });
    expect((screen.getByRole('button', { name: '新建客户委托' }) as HTMLButtonElement).disabled).toBe(true);
    await expect(flushSourceScope(localId)).resolves.toBeUndefined();
    backup.backupPending = false; host.rerender(); await ready();
    expect(readCommercialSnapshot).toHaveBeenCalledTimes(1); expect(host.ensure).toHaveBeenCalledTimes(1);
  });
});
