// @vitest-environment jsdom
import { webcrypto } from 'node:crypto';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { flushSync } from 'react-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { archiveLocalActivity, listLocalActivities, readLocalActivity, type NewLocalActivityMode } from '@/lib/local-activities';
import { createLocalProjectBackupV3, parseLocalProjectBackupJson, serializeLocalProjectBackupV3, type LocalProjectRestoreCandidate } from '@/lib/local-project-backup';
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
function submit(): void { fireEvent.submit(screen.getByRole('form', { name: '新建本机活动' })); }
function listedTarget() { return { projectId: targetId, name: target.name, archivedAt: '2026-10-09T03:00:00Z', itemCount: 1 }; }

describe('local activity creation and switching', () => {
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
    const ui = setup();expect(await screen.findByText(/有1份本机活动无法读取，原资料已保留/)).toBeTruthy();
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
});
