// @vitest-environment jsdom
import { webcrypto } from 'node:crypto';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { flushSync } from 'react-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { archiveLocalActivity, listLocalActivities, readLocalActivity, type NewLocalActivityMode } from '@/lib/local-activities';
import { createLocalProjectBackupV3, parseLocalProjectBackupJson, serializeLocalProjectBackupV3, type LocalProjectRestoreCandidate } from '@/lib/local-project-backup';
import { registerStageCover } from '@/lib/stage-cover';
import { eventOperationsSchema } from '../../../../supabase/functions/_shared/event-operations-contract';
import { materialCheckinLedgerSchema } from '../../../../supabase/functions/_shared/material-checkin-contract';
import { productionPlanSchema } from '../../../../supabase/functions/_shared/production-plan-contract';
import { makeFloor, makeItem, makeLayout } from '../lib/__testfixtures__/fixtures';
import { LocalActivitiesPanel } from './local-activities-panel';
import type { LocalProjectBackupActions } from './creative-studio';
import type { RoomLayout } from '../lib/types';

vi.mock('@/lib/local-activities', async original => ({
  ...await original<typeof import('@/lib/local-activities')>(), archiveLocalActivity: vi.fn(), listLocalActivities: vi.fn(), readLocalActivity: vi.fn(),
}));
const originalId = 'house-local-activity-original';
const targetId = 'house-local-activity-target';
const brief = { event: '独立演练', guests: 0, description: '演练旧需求，不应带入新活动', mustHave: '', allowIdeas: false };
const original = makeLayout({ id: originalId, name: '演练原活动', floors: [makeFloor({ items: [makeItem({
  id: 'original-chair', name: '演练布置椅', assetId: '10000000-0000-4000-8000-000000000001',
  notes: '演练原活动内部备注', handoff: { ownerName: '演练负责人', dueDate: '', acceptance: '', status: 'todo', evidenceUrls: [], evidenceNote: '' },
})] })], eventOperations: eventOperationsSchema.parse({ dataKind: 'rehearsal', tasks: [] }), productionPlan: productionPlanSchema.parse({ dataKind: 'rehearsal' }) });
const target = makeLayout({ id: targetId, name: '演练目标活动', floors: [makeFloor({ items: [makeItem({ id: 'target-chair', name: '目标演练椅' })] })] });
function backupText(layout: RoomLayout): string {
  const scope = layout.id!;
  return serializeLocalProjectBackupV3(layout,
    { state: 'ready', scope, brief: scope === originalId ? { status: 'present', value: brief } : { status: 'absent' } },
    { state: 'ready', scope, materialCheckins: scope === originalId ? { status: 'present', value: materialCheckinLedgerSchema.parse({ projectId: scope, dataKind: 'rehearsal', sheets: [] }) } : { status: 'absent' } },
    '2026-10-09T03:00:00Z');
}
function archiveResult(text: string, projectId: string, beforeWrite?: () => void) {
  beforeWrite?.();const candidate = parseLocalProjectBackupJson(text);
  if (candidate.layout.id !== projectId || candidate.brief.status === 'not-in-file' || candidate.materialCheckins.status === 'not-in-file') throw new Error('演练归档编号或覆盖不一致');
  return createLocalProjectBackupV3(candidate.layout, { state: 'ready', scope: projectId, brief: candidate.brief },
    { state: 'ready', scope: projectId, materialCheckins: candidate.materialCheckins }, candidate.createdAt!);
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(ok => { resolve = ok; });return { promise, resolve };
}
beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto);
  vi.mocked(listLocalActivities).mockReset().mockResolvedValue({ activities: [], unreadableProjectIds: [] });
  vi.mocked(readLocalActivity).mockReset().mockResolvedValue(parseLocalProjectBackupJson(backupText(target)));
  vi.mocked(archiveLocalActivity).mockReset().mockImplementation(async (text, id, beforeWrite) => archiveResult(text, id, beforeWrite));
});
afterEach(() => { cleanup();vi.unstubAllGlobals(); });
function setup(commitRestore = false) {
  let current = original, disabled = false;
  const onComplete = vi.fn();let view: ReturnType<typeof render>;
  const actions: LocalProjectBackupActions = {
    prepareBackup: vi.fn(async () => backupText(current)),
    restoreBackup: vi.fn(async (candidate: LocalProjectRestoreCandidate) => { if (commitRestore) { current = candidate.layout;view.rerender(element()); } }),
    undoRestore: vi.fn().mockResolvedValue(undefined), backupPending: false, canUndoRestore: false,
  };
  const element = () => <LocalActivitiesPanel layout={current} actions={actions} disabled={disabled} onComplete={onComplete}/>;
  view = render(element());
  return { actions, view, onComplete, get layout() { return current; },
    replace(next: RoomLayout) { current = next;view.rerender(element()); },
    disable(next: boolean) { disabled = next;view.rerender(element()); },
    pendingBackup(next: boolean) { actions.backupPending = next;view.rerender(element()); },
  };
}
function name(value = '演练新活动'): void { fireEvent.change(screen.getByRole('textbox', { name: '新活动名称' }), { target: { value } }); }
function submit(): void { fireEvent.submit(screen.getByRole('form', { name: '新建活动' })); }
function listedTarget() { return { projectId: targetId, name: target.name, archivedAt: '2026-10-09T03:00:00Z', itemCount: 1 }; }

describe('local activity creation and switching', () => {
  it('splits the create card and the archive list for their outside entry points', async () => {
    const actions: LocalProjectBackupActions = {
      prepareBackup: vi.fn(), restoreBackup: vi.fn(), undoRestore: vi.fn(), backupPending: false, canUndoRestore: false,
    };
    const view = render(<LocalActivitiesPanel mode="create" layout={original} actions={actions}/>);
    expect(screen.getByRole('form', { name: '新建活动' })).toBeTruthy();
    expect(screen.queryByText('最近活动')).toBeNull();
    view.rerender(<LocalActivitiesPanel mode="list" layout={original} actions={actions}/>);
    expect(screen.queryByRole('form', { name: '新建活动' })).toBeNull();
    expect(await screen.findByText('最近活动')).toBeTruthy();
  });

  it('puts the open canvas first in the same list and keeps a duplicate archive out of it', async () => {
    const actions: LocalProjectBackupActions = {
      prepareBackup: vi.fn(), restoreBackup: vi.fn(), undoRestore: vi.fn(), backupPending: false, canUndoRestore: false,
    };
    vi.mocked(listLocalActivities).mockResolvedValue({ activities: [
      { projectId: originalId, name: original.name, archivedAt: '2026-10-09T03:00:00Z', itemCount: 1 },
      { ...listedTarget(), preview: target },
    ], unreadableProjectIds: [] });
    render(<LocalActivitiesPanel mode="list" layout={original} actions={actions} currentStatus="有改动待保存"/>);
    const cards = await waitFor(() => screen.getAllByRole('listitem'));
    expect(cards[0].getAttribute('aria-label')).toBe(`当前活动「${original.name}」`);
    expect(cards[0].textContent).toContain('1 件');
    expect(cards[0].textContent).toContain('有改动待保存');
    expect(screen.getByText('当前')).toBeTruthy();
    // 当前卡 + 一张归档卡 + 末尾「新建活动」拼贴卡。
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getByRole('button', { name: `打开活动「${target.name}」` })).toBeTruthy();
    expect(screen.getByRole('button', { name: '新建活动，空白画布直接进入工作台' })).toBeTruthy();
  });

  it('hides the archives that belong to another team and takes them out of the count', async () => {
    const actions: LocalProjectBackupActions = {
      prepareBackup: vi.fn(), restoreBackup: vi.fn(), undoRestore: vi.fn(), backupPending: false, canUndoRestore: false,
    };
    vi.mocked(listLocalActivities).mockResolvedValue({ activities: [
      { ...listedTarget(), preview: target },
      { projectId: 'house-local-activity-other-team', name: '演练他队活动', archivedAt: '2026-10-08T03:00:00Z', itemCount: 1 },
    ], unreadableProjectIds: [] });
    const view = render(<LocalActivitiesPanel mode="list" layout={original} actions={actions}
      isActivityVisible={projectId => projectId !== 'house-local-activity-other-team'}/>);
    expect(await screen.findByText(target.name)).toBeTruthy();
    expect(screen.queryByText('演练他队活动')).toBeNull();
    // 当前画布是正在编辑的东西，不跟着团队筛掉；拼贴卡不计入「N 个」活动计数。
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(view.container.querySelector('.sc-settings-count')?.textContent).toBe('2 个');
  });

  it('takes a live 3D still for the current card once the panel is on screen', async () => {
    const stop = registerStageCover(() => 'data:image/jpeg;base64,BBBB');
    vi.stubGlobal('IntersectionObserver', class {
      constructor(private readonly callback: IntersectionObserverCallback) {}
      observe(): void { this.callback([{ isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver); }
      unobserve(): void {}
      disconnect(): void {}
    });
    try {
      const actions: LocalProjectBackupActions = {
        prepareBackup: vi.fn(), restoreBackup: vi.fn(), undoRestore: vi.fn(), backupPending: false, canUndoRestore: false,
      };
      const view = render(<LocalActivitiesPanel mode="list" layout={original} actions={actions}/>);
      await waitFor(() => expect(view.container.querySelector('li.is-current .sc-activity-thumb-image')?.getAttribute('src'))
        .toBe('data:image/jpeg;base64,BBBB'));
    } finally { stop(); }
  });

  it('shows the captured 3D still on the card and keeps the plan only as a fallback', async () => {
    const actions: LocalProjectBackupActions = {
      prepareBackup: vi.fn(), restoreBackup: vi.fn(), undoRestore: vi.fn(), backupPending: false, canUndoRestore: false,
    };
    vi.mocked(listLocalActivities).mockResolvedValue({ activities: [{ ...listedTarget(), preview: target }], unreadableProjectIds: [] });
    const view = render(<LocalActivitiesPanel mode="list" layout={original} actions={actions}/>);
    const archived = (): Element | undefined => view.container.querySelectorAll('.sc-local-activities-list li')[1];
    expect(await screen.findByText(target.name)).toBeTruthy();
    expect(archived()?.querySelector('.sc-activity-thumb-canvas')).toBeTruthy();
    expect(archived()?.querySelector('.sc-activity-thumb-image')).toBeNull();
    vi.mocked(listLocalActivities).mockResolvedValue({ activities: [{ ...listedTarget(), cover: 'data:image/jpeg;base64,AAAA' }], unreadableProjectIds: [] });
    fireEvent.click(screen.getByRole('button', { name: '刷新活动列表' }));
    await waitFor(() => expect(archived()?.querySelector('.sc-activity-thumb-image')?.getAttribute('src')).toBe('data:image/jpeg;base64,AAAA'));
    expect(archived()?.querySelector('.sc-activity-thumb-canvas')).toBeNull();
  });

  it.each(['empty', 'reuse-layout'] as const)('archives first and uses the real creator for a fresh %s activity without carrying old business data', async (mode: NewLocalActivityMode) => {
    const ui = setup(true);name('  演练新活动  ');
    if (mode === 'reuse-layout') fireEvent.click(screen.getByRole('radio', { name: '沿用当前布置' }));
    submit();await waitFor(() => expect(ui.onComplete).toHaveBeenCalledOnce());
    expect(ui.actions.prepareBackup).toHaveBeenCalledOnce();expect(archiveLocalActivity).toHaveBeenCalledWith(backupText(original), originalId, expect.any(Function));
    expect(ui.actions.restoreBackup).toHaveBeenCalledOnce();
    const candidate = vi.mocked(ui.actions.restoreBackup).mock.calls[0]![0];
    expect(candidate).toMatchObject({ source: 'backup', backupVersion: 3, brief: { status: 'absent' }, materialCheckins: { status: 'absent' } });
    expect(candidate.layout.id).not.toBe(originalId);expect(candidate.layout.id).toMatch(/^house-/);expect(candidate.layout.name).toBe('演练新活动');
    expect(candidate.layout.eventOperations).toBeUndefined();expect(candidate.layout.productionPlan).toBeUndefined();expect(candidate.layout.designBook).toBeUndefined();
    const items = candidate.layout.floors.flatMap(floor => floor.items);
    if (mode === 'empty') expect(items).toHaveLength(0);
    else {
      expect(items).toHaveLength(1);expect(items[0]).toMatchObject({ assetId: original.floors[0]!.items[0]!.assetId, position: original.floors[0]!.items[0]!.position });
      expect(items[0]!.handoff).toBeUndefined();expect(JSON.stringify(candidate.layout)).not.toContain('演练原活动内部备注');
    }
    expect(original.eventOperations).toBeDefined();expect(original.floors[0]!.items[0]!.notes).toBe('演练原活动内部备注');
    expect(screen.getByRole('textbox', { name: '新活动名称' })).toHaveProperty('value', '');
    expect(screen.getByText(/已打开「演练新活动」/)).toBeTruthy();
  });

  it('retains name and mode through preparation, archive-write, readback and restore failures without reporting success', async () => {
    const ui = setup();name('演练保留的姓名输入');fireEvent.click(screen.getByRole('radio', { name: '沿用当前布置' }));
    vi.mocked(ui.actions.prepareBackup).mockRejectedValueOnce(new Error('演练当前完整备份准备失败'));
    submit();await screen.findByText('演练当前完整备份准备失败');expect(archiveLocalActivity).not.toHaveBeenCalled();
    for (const message of ['演练归档写入失败', '演练归档写后回读不一致']) {
      vi.mocked(archiveLocalActivity).mockRejectedValueOnce(new Error(message));submit();await screen.findByText(message);
      expect(ui.actions.restoreBackup).not.toHaveBeenCalled();
    }
    vi.mocked(ui.actions.restoreBackup).mockRejectedValueOnce(new Error('演练完整恢复保存失败'));
    submit();await screen.findByText('演练完整恢复保存失败');
    expect(screen.getByRole('textbox', { name: '新活动名称' })).toHaveProperty('value', '演练保留的姓名输入');
    expect((screen.getByRole('radio', { name: '沿用当前布置' }) as HTMLInputElement).checked).toBe(true);
    expect(ui.layout).toBe(original);expect(ui.onComplete).not.toHaveBeenCalled();expect(screen.queryByText(/已打开「/)).toBeNull();
  });

  it('opens a target only after the current archive completes and accepts its legitimate restore scope change once', async () => {
    vi.mocked(listLocalActivities).mockResolvedValue({ activities: [listedTarget()], unreadableProjectIds: [] });
    const pending = deferred<ReturnType<typeof archiveResult>>();
    vi.mocked(archiveLocalActivity).mockImplementationOnce(() => pending.promise);
    const ui = setup(true);const open = await screen.findByRole('button', { name: `打开活动「${target.name}」` });
    fireEvent.click(open);fireEvent.click(open);
    await waitFor(() => expect(archiveLocalActivity).toHaveBeenCalledOnce());
    expect(ui.actions.prepareBackup).toHaveBeenCalledOnce();expect(readLocalActivity).not.toHaveBeenCalled();expect(ui.actions.restoreBackup).not.toHaveBeenCalled();
    const args = vi.mocked(archiveLocalActivity).mock.calls[0]!;
    await act(async () => { pending.resolve(archiveResult(args[0], args[1], args[2])); });
    await waitFor(() => expect(ui.onComplete).toHaveBeenCalledOnce());
    expect(readLocalActivity).toHaveBeenCalledWith(targetId);expect(ui.actions.restoreBackup).toHaveBeenCalledWith(parseLocalProjectBackupJson(backupText(target)));
    expect(ui.layout.id).toBe(targetId);expect(screen.getByText(/已打开「演练目标活动」/)).toBeTruthy();
  });

  it('shows unreadable archives and refuses a corrupt target without dropping the current activity or original list', async () => {
    const storedList = { activities: [listedTarget()], unreadableProjectIds: ['house-unreadable-original'] };
    vi.mocked(listLocalActivities).mockResolvedValue(storedList);
    vi.mocked(readLocalActivity).mockRejectedValueOnce(new Error('演练目标归档无法完整读取，原资料已保留'));
    const ui = setup();expect(await screen.findByText(/有1份活动无法读取，资料已保留/)).toBeTruthy();
    expect(archiveLocalActivity).not.toHaveBeenCalled();expect(ui.actions.restoreBackup).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: `打开活动「${target.name}」` }));
    await screen.findByText('演练目标归档无法完整读取，原资料已保留');
    expect(ui.actions.restoreBackup).not.toHaveBeenCalled();expect(ui.layout).toBe(original);expect(ui.onComplete).not.toHaveBeenCalled();
    expect(storedList).toEqual({ activities: [listedTarget()], unreadableProjectIds: ['house-unreadable-original'] });
  });

  it('invalidates pre-restore writes after layout edits, A→B→A or unmount and never restores an old operation', async () => {
    for (const interruption of ['layout', 'ABA', 'unmount']) {
      const pending = deferred<ReturnType<typeof archiveResult>>();
      vi.mocked(archiveLocalActivity).mockImplementationOnce(() => pending.promise);
      const ui = setup();name();const previousCalls = vi.mocked(archiveLocalActivity).mock.calls.length;submit();
      await waitFor(() => expect(archiveLocalActivity).toHaveBeenCalledTimes(previousCalls + 1));
      const args = vi.mocked(archiveLocalActivity).mock.calls.at(-1)!;
      if (interruption === 'layout') ui.replace({ ...original, width: original.width + 1 });
      else if (interruption === 'ABA') { ui.replace(target);ui.replace(original); }
      else ui.view.unmount();
      expect(() => args[2]!()).toThrow();
      await act(async () => { pending.resolve(archiveResult(args[0], args[1])); });
      expect(ui.actions.restoreBackup).not.toHaveBeenCalled();expect(ui.onComplete).not.toHaveBeenCalled();
      if (interruption !== 'unmount') expect(screen.getByRole('textbox', { name: '新活动名称' })).toHaveProperty('value', '演练新活动');
      cleanup();
    }
  });

  it('guards direct submission when disabled, missing identity or another backup operation is pending', async () => {
    for (const block of ['disabled', 'identity', 'backup']) {
      const ui = setup();name();
      if (block === 'disabled') ui.disable(true);
      else if (block === 'identity') { const { id: _id, ...withoutId } = original;ui.replace(withoutId); }
      else ui.pendingBackup(true);
      submit();await act(async () => {});
      expect(ui.actions.prepareBackup).not.toHaveBeenCalled();expect(archiveLocalActivity).not.toHaveBeenCalled();expect(ui.actions.restoreBackup).not.toHaveBeenCalled();
      cleanup();
    }
  });

  it('suppresses completion after a pending restore finishes in an unrelated activity', async () => {
    const pending = deferred<void>();const ui = setup();name();
    vi.mocked(ui.actions.restoreBackup).mockReturnValueOnce(pending.promise);submit();
    await waitFor(() => expect(ui.actions.restoreBackup).toHaveBeenCalledOnce());
    ui.replace({ ...target, id: 'house-unrelated-activity' });
    await act(async () => { pending.resolve(); });
    expect(ui.onComplete).not.toHaveBeenCalled();expect(screen.queryByText(/已打开「/)).toBeNull();
    expect(screen.getByRole('textbox', { name: '新活动名称' })).toHaveProperty('value', '演练新活动');
  });

  it('completes once after the provider flushes the target layout synchronously and resolves restoration later', async () => {
    const pending = deferred<void>();const ui = setup();name();
    vi.mocked(ui.actions.restoreBackup).mockImplementationOnce(candidate => {
      flushSync(() => ui.replace(candidate.layout));return pending.promise;
    });
    submit();await waitFor(() => expect(ui.actions.restoreBackup).toHaveBeenCalledOnce());
    expect(ui.onComplete).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: '新活动名称' })).toHaveProperty('value', '演练新活动');
    await act(async () => { pending.resolve(); });
    await waitFor(() => expect(ui.onComplete).toHaveBeenCalledOnce());
    expect(screen.getByRole('textbox', { name: '新活动名称' })).toHaveProperty('value', '');
    expect(screen.getByText(/已打开「演练新活动」/)).toBeTruthy();
  });

  it('completes once when restoration resolves before the parent renders the target scope and retains its later notice', async () => {
    const pending = deferred<void>();const ui = setup();name();
    vi.mocked(ui.actions.restoreBackup).mockReturnValueOnce(pending.promise);submit();
    await waitFor(() => expect(ui.actions.restoreBackup).toHaveBeenCalledOnce());
    const candidate = vi.mocked(ui.actions.restoreBackup).mock.calls[0]![0];
    await act(async () => { pending.resolve(); });
    expect(ui.onComplete).toHaveBeenCalledOnce();
    expect(screen.getByRole('textbox', { name: '新活动名称' })).toHaveProperty('value', '');
    ui.replace(candidate.layout);await act(async () => {});
    expect(ui.onComplete).toHaveBeenCalledOnce();expect(screen.getByText(/已打开「演练新活动」/)).toBeTruthy();
  });

  it('suppresses late completion and preserves the name after disabled A→B→A during an otherwise legitimate restore', async () => {
    const pending = deferred<void>();const ui = setup();name();
    vi.mocked(ui.actions.restoreBackup).mockImplementationOnce(candidate => { ui.replace(candidate.layout);return pending.promise; });submit();
    await waitFor(() => expect(ui.actions.restoreBackup).toHaveBeenCalledOnce());
    ui.disable(true);ui.disable(false);await act(async () => { pending.resolve(); });
    expect(ui.onComplete).not.toHaveBeenCalled();expect(screen.queryByText(/已打开「/)).toBeNull();
    expect(screen.getByRole('textbox', { name: '新活动名称' })).toHaveProperty('value', '演练新活动');
  });

  it('makes the whole archive card one native button and runs the open transaction from it', async () => {
    vi.mocked(listLocalActivities).mockResolvedValue({ activities: [listedTarget()], unreadableProjectIds: [] });
    const actions: LocalProjectBackupActions = {
      prepareBackup: vi.fn(async () => backupText(original)), restoreBackup: vi.fn(), undoRestore: vi.fn(), backupPending: false, canUndoRestore: false,
    };
    const view = render(<LocalActivitiesPanel mode="list" layout={original} actions={actions}/>);
    const card = await screen.findByRole('button', { name: `打开活动「${target.name}」` });
    expect(card.tagName).toBe('BUTTON');
    // 旧的内嵌小「打开」按钮已消失，整张卡（含封面）都在这颗 button 里。
    expect(view.container.querySelector('.sc-activity-open')).toBeNull();
    expect(card.querySelector('.sc-activity-thumb')).toBeTruthy();
    fireEvent.click(card);
    await waitFor(() => expect(actions.prepareBackup).toHaveBeenCalledOnce());
    expect(readLocalActivity).toHaveBeenCalledWith(targetId);
  });

  it('creates a blank activity from the gallery tile, refuses an empty name and collapses the tile afterwards', async () => {
    let current = original;
    const onComplete = vi.fn();
    const actions: LocalProjectBackupActions = {
      prepareBackup: vi.fn(async () => backupText(current)),
      restoreBackup: vi.fn(async (candidate: LocalProjectRestoreCandidate) => { current = candidate.layout; }),
      undoRestore: vi.fn(), backupPending: false, canUndoRestore: false,
    };
    render(<LocalActivitiesPanel mode="list" layout={current} actions={actions} onComplete={onComplete}/>);
    expect(screen.queryByRole('form', { name: '画廊内联新建活动' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '新建活动，空白画布直接进入工作台' }));
    const tileForm = await screen.findByRole('form', { name: '画廊内联新建活动' });
    fireEvent.submit(tileForm);
    expect(await screen.findByText('请填写新活动名称。')).toBeTruthy();
    expect(actions.prepareBackup).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole('textbox', { name: '画廊新活动名称' }), { target: { value: '画廊新画布' } });
    fireEvent.submit(tileForm);
    await waitFor(() => expect(onComplete).toHaveBeenCalledOnce());
    expect(actions.restoreBackup).toHaveBeenCalledOnce();
    const candidate = vi.mocked(actions.restoreBackup).mock.calls[0]![0];
    expect(candidate.layout.name).toBe('画廊新画布');
    expect(candidate.layout.floors.flatMap(floor => floor.items)).toHaveLength(0);
    expect(screen.queryByRole('form', { name: '画廊内联新建活动' })).toBeNull();
  });

  it('prints readiness short words 齐/缺 on every card instead of the old object-count wording', async () => {
    vi.mocked(listLocalActivities).mockResolvedValue({ activities: [
      { ...listedTarget() },
      { projectId: 'house-local-activity-empty', name: '演练空活动', archivedAt: '2026-10-01T03:00:00Z', itemCount: 0 },
    ], unreadableProjectIds: [] });
    const actions: LocalProjectBackupActions = {
      prepareBackup: vi.fn(), restoreBackup: vi.fn(), undoRestore: vi.fn(), backupPending: false, canUndoRestore: false,
    };
    const view = render(<LocalActivitiesPanel mode="list" layout={original} actions={actions}/>);
    await screen.findByText('演练空活动');
    expect(view.container.textContent).not.toContain('个物件');
    const ready = view.container.querySelectorAll('.sc-activity-meta em.is-ready');
    const low = view.container.querySelectorAll('.sc-activity-meta em.is-low');
    expect(ready).toHaveLength(2);
    expect(low).toHaveLength(1);
    expect(low[0]!.textContent).toBe('缺');
  });
});
