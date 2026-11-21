// @vitest-environment jsdom
/**
 * 2026-11-20 审计 B1 / B2 / B6 / F9 的覆盖层级验证：
 *  - 关页/切后台的最后一次 flush（B1）
 *  - 本机写失败如实上报 + 可见提示（B2）
 *  - 干净打开不写盘、不推云端（F9）
 *  - 云端版本基线取自本会话、不借共享记录（B6）
 *  - 同源多窗口写租约被占时不写不推（B6）
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryStorage } from '@/lib/test-support-memory-storage';
import type { ComponentProps } from 'react';
import type { SitePlanData } from '../../../../supabase/functions/_shared/site-plan';
import type { BackendSession } from '@/lib/backend-session';
import Overlay, { type OutdoorSaveState } from './outdoor-plan-overlay';
import {
  createStarterOutdoorPlan,
  outdoorPlanStorageKey,
  readOutdoorProjectRecord,
  saveOutdoorProjectRecord,
} from '../lib/outdoor-project-store';
import { outdoorWriteLockName } from '../lib/outdoor-write-guard';
import { resetSaveStatusForTests, saveStatusOf } from '../lib/save-status';
import { resetMapSlotsCacheForTest } from '../lib/map-source-slots';
import { writePlanGroundSource } from '../lib/plan-basemap-source';

type CanvasProps = ComponentProps<typeof import('./outdoor-plan-canvas').default>;

const state = vi.hoisted(() => ({ canvas: null as CanvasProps | null }));

vi.mock('../panels/agent-panel', () => ({ useAgentOptional: () => null }));
vi.mock('./outdoor-plan-canvas', async () => {
  const React = await import('react');
  return {
    default: React.forwardRef(function LifecycleCanvas(props: CanvasProps, ref: React.Ref<unknown>) {
      state.canvas = props;
      React.useImperativeHandle(ref, () => ({
        getEditVisuals: () => ({ plan: props.plan }),
        getSelectedIds: () => [],
        getView: () => null,
        focusBounds: () => {},
        focusLngLat: () => {},
      }));
      return React.createElement('div', { 'data-testid': 'lifecycle-canvas' });
    }),
  };
});
vi.mock('./plan-place-search', async () => {
  const React = await import('react');
  return { default: () => React.createElement('input', { 'data-testid': 'lifecycle-search', readOnly: true }) };
});

const PROJECT = 'lifecycle-activity';

function editedPlan(base: SitePlanData, lng: number): SitePlanData {
  return { ...base, anchor: { lng, lat: 30.25, crs: 'gcj-02', source: 'picker' } };
}

function seedRecord(plan: SitePlanData, extra: { remoteRevision?: number; unsyncedPlan?: boolean } = {}) {
  saveOutdoorProjectRecord({
    v: 1,
    projectId: PROJECT,
    name: '湖滨夜集',
    createdAt: '2026-11-17T00:00:00.000Z',
    updatedAt: '2026-11-17T01:00:00.000Z',
    plan,
    remoteActivityId: 'a-1',
    ...extra,
  });
  return localStorage.getItem(outdoorPlanStorageKey(PROJECT))!;
}

function edit(next: SitePlanData) {
  act(() => { state.canvas!.onPlanChange!(next); });
}

let mem: MemoryStorage;
beforeEach(() => {
  mem = new MemoryStorage();
  vi.stubGlobal('Storage', MemoryStorage);
  vi.stubGlobal('localStorage', mem);
  window.localStorage = mem;
  localStorage.clear();
  resetMapSlotsCacheForTest();
  resetSaveStatusForTests();
  writePlanGroundSource('amap-streets');
  state.canvas = null;
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => window.setTimeout(() => cb(0), 0));
  vi.stubGlobal('cancelAnimationFrame', (id: number) => window.clearTimeout(id));
});

afterEach(() => {
  cleanup();
  mem?.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  // 恢复真实的 navigator.locks（jsdom 默认没有）。
  delete (navigator as unknown as { locks?: unknown }).locks;
});

describe('打开与编辑', () => {
  it('F9：盘上内容没变时不写盘、不推云端，保存态如实报本机已存', async () => {
    const plan = createStarterOutdoorPlan();
    const before = seedRecord(plan);
    const saveOutdoorPlan = vi.fn();
    const onSaveStateChange = vi.fn<(next: OutdoorSaveState) => void>();

    render(
      <Overlay
        projectId={PROJECT}
        controller={{ saveOutdoorPlan } as unknown as BackendSession}
        onSaveStateChange={onSaveStateChange}
      />,
    );

    await act(async () => { await new Promise(resolve => setTimeout(resolve, 900)); });

    // 一个字节都没变：updatedAt 没被刷新，云端也没被打扰。
    expect(localStorage.getItem(outdoorPlanStorageKey(PROJECT))).toBe(before);
    expect(saveOutdoorPlan).not.toHaveBeenCalled();
    expect(onSaveStateChange).toHaveBeenCalledWith(expect.objectContaining({ state: 'saved', scope: PROJECT }));
    expect(onSaveStateChange).not.toHaveBeenCalledWith(expect.objectContaining({ state: 'saving' }));
  });

  it('真的编辑一次才会写盘并推一次', async () => {
    const plan = createStarterOutdoorPlan();
    seedRecord(plan);
    const saveOutdoorPlan = vi.fn().mockResolvedValue({ conflict: false, activityId: 'a-1', revision: 2 });

    render(<Overlay projectId={PROJECT} controller={{ saveOutdoorPlan } as unknown as BackendSession} />);
    edit(editedPlan(plan, 120.19));

    await waitFor(() => expect(saveOutdoorPlan).toHaveBeenCalledTimes(1), { timeout: 3000 });
    expect(readOutdoorProjectRecord(PROJECT)?.plan?.anchor?.lng).toBeCloseTo(120.19);
    // 收到回执后「待同步」才清（关页前的未确认状态另有用例）。
    await waitFor(() => expect(readOutdoorProjectRecord(PROJECT)?.unsyncedPlan).toBe(false), { timeout: 3000 });
  });
});

describe('B1：关页仍要落盘', () => {
  it('防抖窗口内 pagehide：本机写入同步完成，且不发网络请求', async () => {
    const plan = createStarterOutdoorPlan();
    seedRecord(plan);
    const saveOutdoorPlan = vi.fn().mockResolvedValue({ conflict: false, activityId: 'a-1', revision: 2 });

    render(<Overlay projectId={PROJECT} controller={{ saveOutdoorPlan } as unknown as BackendSession} />);
    edit(editedPlan(plan, 120.31));
    // 400ms 防抖还没到就关页。
    act(() => { window.dispatchEvent(new Event('pagehide')); });

    expect(readOutdoorProjectRecord(PROJECT)?.plan?.anchor?.lng).toBeCloseTo(120.31);
    // 关页只落本机：留待同步标记，下次打开补推。
    expect(readOutdoorProjectRecord(PROJECT)?.unsyncedPlan).toBe(true);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 600)); });
    expect(saveOutdoorPlan).not.toHaveBeenCalled();
  });

  it('切到后台（hidden）时也补 flush，并把云端副本结算掉', async () => {
    const plan = createStarterOutdoorPlan();
    seedRecord(plan);
    const saveOutdoorPlan = vi.fn().mockResolvedValue({ conflict: false, activityId: 'a-1', revision: 2 });

    render(<Overlay projectId={PROJECT} controller={{ saveOutdoorPlan } as unknown as BackendSession} />);
    edit(editedPlan(plan, 120.33));
    act(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(readOutdoorProjectRecord(PROJECT)?.plan?.anchor?.lng).toBeCloseTo(120.33);
    await waitFor(() => expect(saveOutdoorPlan).toHaveBeenCalledTimes(1), { timeout: 3000 });
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  });
});

describe('B2：本机写失败不再被吞掉', () => {
  it('配额满：保留当前内容、出可见提示、状态机记「本机未保存」', async () => {
    const plan = createStarterOutdoorPlan();
    seedRecord(plan);
    const original = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
      if (key === outdoorPlanStorageKey(PROJECT)) {
        const error = new Error('quota');
        error.name = 'QuotaExceededError';
        throw error;
      }
      return original.call(this, key, value);
    });
    const onSaveStateChange = vi.fn<(next: OutdoorSaveState) => void>();

    render(<Overlay projectId={PROJECT} onSaveStateChange={onSaveStateChange} />);
    edit(editedPlan(plan, 120.41));

    await waitFor(() => expect(screen.getByTestId('outdoor-local-save-error')).toBeTruthy(), { timeout: 3000 });
    expect(screen.getByTestId('outdoor-local-save-error').textContent).toContain('本机存储已满');
    expect(saveStatusOf(PROJECT).stage).toBe('local-failed');
    expect(saveStatusOf(PROJECT).localSavedAt).toBeNull();
    expect(saveStatusOf(PROJECT).pendingCount).toBe(0);
    expect(onSaveStateChange).toHaveBeenCalledWith(expect.objectContaining({ state: 'local-failed', scope: PROJECT }));
    // 盘上还是旧版：没写进去就是没写进去。
    expect(readOutdoorProjectRecord(PROJECT)?.plan?.anchor?.lng).not.toBeCloseTo(120.41);
  });

  it('点「重试保存」成功后才清掉提示', async () => {
    const plan = createStarterOutdoorPlan();
    seedRecord(plan);
    const original = Storage.prototype.setItem;
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
      if (key === outdoorPlanStorageKey(PROJECT)) {
        const error = new Error('quota');
        error.name = 'QuotaExceededError';
        throw error;
      }
      return original.call(this, key, value);
    });

    render(<Overlay projectId={PROJECT} />);
    edit(editedPlan(plan, 120.43));
    await waitFor(() => expect(screen.getByTestId('outdoor-local-save-error')).toBeTruthy(), { timeout: 3000 });

    spy.mockRestore();
    fireEvent.click(screen.getByTestId('outdoor-local-save-retry'));

    await waitFor(() => expect(screen.queryByTestId('outdoor-local-save-error')).toBeNull(), { timeout: 3000 });
    expect(readOutdoorProjectRecord(PROJECT)?.plan?.anchor?.lng).toBeCloseTo(120.43);
    expect(saveStatusOf(PROJECT).localFailure).toBeNull();
  });
});

describe('推送回执的边界', () => {
  it('回执不改写盘上更新的 plan（在途期间的新编辑不被旧快照盖回）', async () => {
    const plan = createStarterOutdoorPlan();
    seedRecord(plan, { remoteRevision: 1 });
    let release!: (value: unknown) => void;
    const pending = new Promise(resolve => { release = resolve; });
    // 只让第一次推送有回执；第二次（在途期间的新编辑）留在在途状态，
    // 这样才能看清「第一次的回执不会把盘上的新版盖回去」。
    let calls = 0;
    const saveOutdoorPlan = vi.fn().mockImplementation(() => {
      calls += 1;
      return calls === 1 ? pending : new Promise(() => {});
    });

    render(<Overlay projectId={PROJECT} controller={{ saveOutdoorPlan } as unknown as BackendSession} />);

    edit(editedPlan(plan, 120.61));
    await waitFor(() => expect(saveOutdoorPlan).toHaveBeenCalledTimes(1), { timeout: 3000 });

    // 推送在途时又改了一次：本机先落新的一版。
    edit(editedPlan(plan, 120.62));
    await waitFor(() => expect(readOutdoorProjectRecord(PROJECT)?.plan?.anchor?.lng).toBeCloseTo(120.62), { timeout: 3000 });

    await act(async () => {
      release({ conflict: false, activityId: 'a-1', revision: 5 });
      await new Promise(resolve => setTimeout(resolve, 50));
    });

    const stored = readOutdoorProjectRecord(PROJECT)!;
    expect(stored.plan?.anchor?.lng).toBeCloseTo(120.62);
    expect(stored.remoteRevision).toBe(5);
    // 新版还没被云端确认过，待同步标记要留着。
    expect(stored.unsyncedPlan).toBe(true);
  });
});

describe('B6：云端版本基线属于本会话', () => {
  it('连续保存用本会话回执推进，且不借另一个窗口写进共享记录的版本', async () => {
    const plan = createStarterOutdoorPlan();
    seedRecord(plan, { remoteRevision: 1 });
    let revision = 1;
    const saveOutdoorPlan = vi.fn().mockImplementation(async () => {
      revision += 1;
      return { conflict: false, activityId: 'a-1', revision };
    });

    render(<Overlay projectId={PROJECT} controller={{ saveOutdoorPlan } as unknown as BackendSession} />);

    edit(editedPlan(plan, 120.51));
    await waitFor(() => expect(saveOutdoorPlan).toHaveBeenCalledTimes(1), { timeout: 3000 });
    expect(saveOutdoorPlan.mock.calls[0]![0]).toMatchObject({ baseRevision: 1, activityId: 'a-1' });
    // 等本会话回执写回盘上（版本推进到 2）。
    await waitFor(() => expect(readOutdoorProjectRecord(PROJECT)?.remoteRevision).toBe(2), { timeout: 3000 });

    // 另一个窗口把自己的成功回执写进了同一条本机记录。
    const shared = readOutdoorProjectRecord(PROJECT)!;
    saveOutdoorProjectRecord({ ...shared, remoteRevision: 99 });

    edit(editedPlan(plan, 120.52));
    await waitFor(() => expect(saveOutdoorPlan).toHaveBeenCalledTimes(2), { timeout: 3000 });
    // 仍然是本会话确认过的 2，不是共享记录里借来的 99。
    expect(saveOutdoorPlan.mock.calls[1]![0]).toMatchObject({ baseRevision: 2 });

    await waitFor(() => expect(readOutdoorProjectRecord(PROJECT)?.remoteRevision).toBe(3), { timeout: 3000 });
    edit(editedPlan(plan, 120.53));
    await waitFor(() => expect(saveOutdoorPlan).toHaveBeenCalledTimes(3), { timeout: 3000 });
    expect(saveOutdoorPlan.mock.calls[2]![0]).toMatchObject({ baseRevision: 3 });
  });
});

describe('B6：同源多窗口写租约', () => {
  it('租约在别的窗口手里：不写本机、不推云端，并给出可见提示', async () => {
    const held = outdoorWriteLockName(PROJECT);
    const locks = {
      request: (name: string, options: LockOptions | undefined, callback: (lock: unknown) => unknown) => {
        if (name === held) {
          // 别的窗口一直占着：ifAvailable 立刻回 null，排队请求永远等不到。
          if (options?.ifAvailable) return Promise.resolve(callback(null));
          return new Promise(() => {});
        }
        return Promise.resolve(callback({ name, mode: 'exclusive' }));
      },
    } as unknown as LockManager;
    Object.defineProperty(navigator, 'locks', { value: locks, configurable: true });
    const saveOutdoorPlan = vi.fn();
    const onSaveStateChange = vi.fn<(next: OutdoorSaveState) => void>();

    render(
      <Overlay
        projectId={PROJECT}
        controller={{ saveOutdoorPlan } as unknown as BackendSession}
        onSaveStateChange={onSaveStateChange}
      />,
    );
    await waitFor(() => expect(screen.getByTestId('outdoor-write-blocked')).toBeTruthy(), { timeout: 3000 });

    edit(editedPlan(createStarterOutdoorPlan(), 120.71));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 700)); });

    expect(readOutdoorProjectRecord(PROJECT)).toBeNull();
    expect(saveOutdoorPlan).not.toHaveBeenCalled();
    expect(onSaveStateChange).toHaveBeenCalledWith(expect.objectContaining({ state: 'blocked', scope: PROJECT }));
  });
});
