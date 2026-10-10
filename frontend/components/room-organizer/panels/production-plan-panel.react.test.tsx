// @vitest-environment jsdom
import { webcrypto } from 'node:crypto';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useLayoutEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSourceScope } from '@/lib/source-storage';
import { eventOperationsSchema } from '../../../../supabase/functions/_shared/event-operations-contract';
import { productionPlanSchema, type ProductionPlan } from '../../../../supabase/functions/_shared/production-plan-contract';
import { makeFloor, makeItem, makeLayout } from '../lib/__testfixtures__/fixtures';
import { createOperation } from '../lib/event-operations';
import { ProductionPlanPanel } from './production-plan-panel';
import type { RoomLayout } from '../lib/types';

const taskId = '10000000-0000-4000-8000-000000000001';
const missingTaskId = '10000000-0000-4000-8000-000000000002';
const staffingId = '20000000-0000-4000-8000-000000000001';
const acquisitionId = '20000000-0000-4000-8000-000000000002';
const estimateId = '20000000-0000-4000-8000-000000000003';
const unknownEstimateId = '20000000-0000-4000-8000-000000000004';
const objectId = 'scene-chair-new';
const missingObjectId = 'scene-chair-original';

beforeEach(() => vi.stubGlobal('crypto', webcrypto));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function plan(): ProductionPlan {
  return productionPlanSchema.parse({
    dataKind: 'rehearsal',
    staffing: [{ id: staffingId, roleName: '演练签到岗', taskIds: [taskId] }],
    acquisitions: [{ id: acquisitionId, title: '演练椅', objectIds: [objectId], taskIds: [taskId] }],
    estimates: [{ id: estimateId, title: '演练安装估算' }, { id: unknownEstimateId, title: '演练运输估算' }],
  });
}
function trialLayout(value?: ProductionPlan): RoomLayout {
  return makeLayout({
    id: 'local-production-trial', name: '独立演练 · 制作计划',
    floors: [makeFloor({ items: [makeItem({ id: objectId, name: '演练椅' })] })],
    eventOperations: eventOperationsSchema.parse({ dataKind: 'rehearsal', tasks: [{ ...createOperation('演练签到', 'event'), id: taskId }] }),
    ...(value === undefined ? {} : { productionPlan: value }),
  });
}
function livePanel(initial: RoomLayout, writable = true) {
  let current = initial, disabled = false;
  const updates = vi.fn<(value: ProductionPlan | undefined) => void>();
  let view: ReturnType<typeof render>;
  function update(value: ProductionPlan | undefined): void {
    updates(value);
    if (value === undefined) {
      const { productionPlan: _removed, ...rest } = current;
      current = rest;
    } else current = { ...current, productionPlan: value };
    view.rerender(element());
  }
  const element = () => <ProductionPlanPanel layout={current} disabled={disabled} onUpdate={writable ? update : undefined}/>;
  view = render(element());
  return {
    updates, get layout() { return current; },
    replace(next: RoomLayout) { current = next; view.rerender(element()); },
    disable() { disabled = true; view.rerender(element()); },
  };
}
function form(): HTMLElement { return screen.getByRole('form', { name: '制作计划草稿' }); }
function edit(): void { fireEvent.click(screen.getByRole('button', { name: '编辑制作计划' })); }
function row(title: string) { return within(within(form()).getByRole('group', { name: title })); }
function change(input: HTMLElement, value: string): void { fireEvent.change(input, { target: { value } }); }
function save(): void { fireEvent.click(screen.getByRole('button', { name: '保存制作计划' })); }

describe('local production plan draft UI', () => {
  it('blocks source actions for a new draft without submitting and allows them after cancellation', async () => {
    const ui = livePanel(trialLayout());
    await expect(flushSourceScope(ui.layout.id!)).resolves.toBeUndefined();
    fireEvent.click(screen.getByRole('button', { name: '创建制作计划' }));
    fireEvent.click(screen.getByRole('button', { name: '添加岗位' }));
    change(row('新岗位').getByLabelText('岗位名称'), '尚未保存的演练岗位');
    await expect(flushSourceScope(ui.layout.id!)).rejects.toThrow('请先保存或取消制作计划编辑');
    expect(ui.updates).not.toHaveBeenCalled();
    expect(ui.layout.productionPlan).toBeUndefined();
    expect((row('尚未保存的演练岗位').getByLabelText('岗位名称') as HTMLInputElement).value).toBe('尚未保存的演练岗位');
    fireEvent.click(screen.getByRole('button', { name: '取消编辑' }));
    await expect(flushSourceScope(ui.layout.id!)).resolves.toBeUndefined();
    expect(ui.updates).not.toHaveBeenCalled();
  });

  it('keeps source actions blocked after an invalid save and releases them after a valid save', async () => {
    const ui = livePanel(trialLayout(plan()));edit();
    change(row('演练安装估算').getByLabelText('人工估算金额（元）'), '12.345');
    change(row('演练安装估算').getByLabelText('估算依据'), '演练人工录入总额');save();
    expect(screen.getByRole('alert').textContent).toContain('两位小数');
    await expect(flushSourceScope(ui.layout.id!)).rejects.toThrow('请先保存或取消制作计划编辑');
    expect(ui.updates).not.toHaveBeenCalled();
    expect((row('演练安装估算').getByLabelText('人工估算金额（元）') as HTMLInputElement).value).toBe('12.345');
    change(row('演练安装估算').getByLabelText('人工估算金额（元）'), '12.34');save();
    await expect(flushSourceScope(ui.layout.id!)).resolves.toBeUndefined();
    expect(ui.updates).toHaveBeenCalledOnce();
    expect(ui.layout.productionPlan!.estimates[0]!.amountMinor).toBe(1234);
  });

  it('isolates source guards by project scope and unregisters them on scope change and unmount', async () => {
    const firstLayout = trialLayout(plan()), secondLayout = { ...trialLayout(plan()), id: 'second-production-trial' };
    const first = render(<ProductionPlanPanel layout={firstLayout} onUpdate={vi.fn()}/>);
    const second = render(<ProductionPlanPanel layout={secondLayout} onUpdate={vi.fn()}/>);
    fireEvent.click(within(first.container).getByRole('button', { name: '编辑制作计划' }));
    await expect(flushSourceScope(firstLayout.id!)).rejects.toThrow('请先保存或取消制作计划编辑');
    await expect(flushSourceScope(secondLayout.id!)).resolves.toBeUndefined();
    first.unmount();
    await expect(flushSourceScope(firstLayout.id!)).resolves.toBeUndefined();
    const nextLayout = { ...secondLayout, id: 'next-production-trial' };
    second.rerender(<ProductionPlanPanel layout={nextLayout} onUpdate={vi.fn()}/>);
    fireEvent.click(within(second.container).getByRole('button', { name: '编辑制作计划' }));
    await expect(flushSourceScope(secondLayout.id!)).resolves.toBeUndefined();
    await expect(flushSourceScope(nextLayout.id!)).rejects.toThrow('请先保存或取消制作计划编辑');
    second.unmount();
    await expect(flushSourceScope(nextLayout.id!)).resolves.toBeUndefined();
  });

  it('keeps an old draft isolated across scope changes and allows cancellation while stale or readonly', async () => {
    const initial = trialLayout(plan()), next = { ...initial, id: 'next-production-trial' };
    const update = vi.fn();
    let previousScopeFlush: Promise<void> | undefined;
    function ScopeTransition({ layout, disabled = false }: { layout: RoomLayout; disabled?: boolean }) {
      useLayoutEffect(() => {
        if (layout.id === next.id) previousScopeFlush = flushSourceScope(initial.id!);
      }, [layout.id]);
      return <ProductionPlanPanel layout={layout} disabled={disabled} onUpdate={update}/>;
    }
    const view = render(<ScopeTransition layout={initial}/>);edit();
    change(row('演练签到岗').getByLabelText('班次'), 'A 项目未保存班次');
    await expect(flushSourceScope(initial.id!)).rejects.toThrow('请先保存或取消制作计划编辑');
    view.rerender(<ScopeTransition layout={next}/>);
    expect(previousScopeFlush).toBeDefined();
    await expect(previousScopeFlush).resolves.toBeUndefined();
    await expect(flushSourceScope(next.id!)).resolves.toBeUndefined();
    expect((row('演练签到岗').getByLabelText('班次') as HTMLInputElement).value).toBe('A 项目未保存班次');
    expect(screen.getByRole('alert').textContent).toContain('原草稿已保留');
    const staleCancel = screen.getByRole('button', { name: '取消编辑' });
    expect(staleCancel.matches(':disabled')).toBe(false);fireEvent.click(staleCancel);edit();
    change(row('演练签到岗').getByLabelText('班次'), 'B 项目未保存班次');
    await expect(flushSourceScope(next.id!)).rejects.toThrow('请先保存或取消制作计划编辑');
    view.rerender(<ScopeTransition layout={next} disabled/>);
    expect(row('演练签到岗').getByLabelText('班次').matches(':disabled')).toBe(true);
    const readonlyCancel = screen.getByRole('button', { name: '取消编辑' });
    expect(readonlyCancel.matches(':disabled')).toBe(false);fireEvent.click(readonlyCancel);
    await expect(flushSourceScope(next.id!)).resolves.toBeUndefined();
    expect(update).not.toHaveBeenCalled();
  });

  it('only creates an explicit plan on save and cancels draft additions without writing', () => {
    const ui = livePanel(trialLayout());
    expect(screen.getByText('制作计划未记录。')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '创建制作计划' }));
    expect(ui.updates).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '添加岗位' }));
    change(row('新岗位').getByLabelText('岗位名称'), '尚未保存的演练岗位');
    fireEvent.click(screen.getByRole('button', { name: '添加取得计划' }));
    change(row('新取得计划').getByLabelText('取得标题'), '尚未保存的演练取得计划');
    fireEvent.click(screen.getByRole('button', { name: '添加估算' }));
    change(row('新估算').getByLabelText('估算标题'), '尚未保存的演练估算');
    expect(ui.layout.productionPlan).toBeUndefined();
    fireEvent.click(screen.getByRole('button', { name: '取消编辑' }));
    expect(screen.queryByRole('form', { name: '制作计划草稿' })).toBeNull();
    expect(ui.updates).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '创建制作计划' }));
    save();
    expect(ui.updates).toHaveBeenCalledOnce();
    expect(ui.layout.productionPlan).toEqual(productionPlanSchema.parse({}));
    expect(screen.getByRole('button', { name: '编辑制作计划' })).toBeTruthy();
  });

  it('preserves unknown money while requiring human basis and scope for explicitly entered zero', () => {
    const ui = livePanel(trialLayout(plan()));edit();
    const estimate = row('演练安装估算');
    expect((estimate.getByLabelText('人工估算金额（元）') as HTMLInputElement).value).toBe('');
    change(estimate.getByLabelText('人工估算金额（元）'), '0');save();
    expect(screen.getByRole('alert').textContent).toContain('依据');expect(ui.updates).not.toHaveBeenCalled();
    change(estimate.getByLabelText('估算依据'), '演练假设：已备资源，不另计安装费用');
    fireEvent.click(screen.getByRole('button', { name: '添加预算上限' }));
    change(screen.getByLabelText('预算上限（元）'), '0');save();
    expect(screen.getByRole('alert').textContent).toContain('范围');expect(ui.updates).not.toHaveBeenCalled();
    change(screen.getByLabelText('预算范围'), '演练安装范围');
    change(screen.getByLabelText('预算依据'), '演练假设上限，不代表真实预算');save();
    expect(ui.layout.productionPlan!.estimates[0]).toMatchObject({ amountMinor: 0, basisNote: '演练假设：已备资源，不另计安装费用' });
    expect(ui.layout.productionPlan!.estimates[1]!.amountMinor).toBeNull();
    expect(ui.layout.productionPlan!.budget).toEqual({ limitMinor: 0, scopeNote: '演练安装范围', basisNote: '演练假设上限，不代表真实预算' });
    expect(screen.getByText(/未知金额 1 项/)).toBeTruthy();
  });

  it('rejects invalid money without writing and converts a corrected yuan draft exactly to fen', () => {
    const ui = livePanel(trialLayout(plan()));edit();
    const estimate = row('演练安装估算');
    change(estimate.getByLabelText('人工估算金额（元）'), '12.345');
    change(estimate.getByLabelText('估算依据'), '演练人工录入的本行总额');save();
    expect(screen.getByRole('alert').textContent).toContain('两位小数');
    expect(ui.updates).not.toHaveBeenCalled();expect(ui.layout.productionPlan!.estimates[0]!.amountMinor).toBeNull();
    expect((estimate.getByLabelText('人工估算金额（元）') as HTMLInputElement).value).toBe('12.345');
    change(estimate.getByLabelText('人工估算金额（元）'), '12.34');save();
    expect(ui.layout.productionPlan!.estimates[0]!.amountMinor).toBe(1234);
    expect(ui.updates).toHaveBeenCalledOnce();
  });

  it('allows an over-limit plan while naming only the known part of estimates and preserving human basis text', () => {
    const original = plan();
    original.estimates[0]!.amountMinor = 201;original.estimates[0]!.basisNote = '演练人工录入总额';
    original.budget = { limitMinor: 100, scopeNote: '演练范围', basisNote: '演练人工上限假设' };
    const ui = livePanel(trialLayout(original));edit();
    expect(screen.getByText('已知部分估算合计 ¥2.01')).toBeTruthy();
    expect(screen.getByText('未知金额 1 项')).toBeTruthy();
    expect(screen.getByText(/估算已超过人工预算上限/)).toBeTruthy();
    const basis = '  演练依据原文\n人工核对后再调整  ';
    change(row('演练安装估算').getByLabelText('估算依据'), basis);save();
    expect(ui.updates).toHaveBeenCalledOnce();
    expect(ui.layout.productionPlan!.estimates[0]).toMatchObject({ amountMinor: 201, basisNote: basis });
    expect(ui.layout.productionPlan!.estimates[1]!.amountMinor).toBeNull();
    expect(ui.layout.productionPlan!.budget!.limitMinor).toBe(100);
  });

  it('shows unknown, known and zero budget drafts accurately and does not revive a success notice after Undo and Redo', () => {
    const original = plan();original.budget = { limitMinor: null, scopeNote: '演练范围', basisNote: '演练人工上限假设' };
    const initial = trialLayout(original), ui = livePanel(initial);edit();
    const budget = screen.getByLabelText('预算上限（元）');
    expect(screen.getByText('人工预算上限 未知')).toBeTruthy();
    change(budget, '12.34');expect(screen.getByText('人工预算上限 ¥12.34')).toBeTruthy();
    change(budget, '');expect(screen.getByText('人工预算上限 未知')).toBeTruthy();
    change(budget, '0');expect(screen.getByText('人工预算上限 ¥0.00')).toBeTruthy();save();
    const saved = ui.layout;expect(saved.productionPlan!.budget!.limitMinor).toBe(0);
    expect(screen.getByRole('status').textContent).toContain('制作计划已提交更新');
    ui.replace(initial);expect(screen.queryByRole('status')).toBeNull();
    ui.replace(saved);expect(screen.queryByRole('status')).toBeNull();
    edit();change(screen.getByLabelText('预算上限（元）'), '');
    expect(screen.getByText('人工预算上限 未知')).toBeTruthy();
    expect(ui.updates).toHaveBeenCalledOnce();
  });

  it('edits staffing in Beijing time without rewriting unchanged offsets or milliseconds', () => {
    const original = plan();
    original.staffing[0]!.plannedArrivalAt = '2026-10-08T15:30:00.123Z';
    original.staffing[0]!.plannedDepartureAt = '2026-10-09T01:30:00.987+09:00';
    const ui = livePanel(trialLayout(original));edit();
    const staff = row('演练签到岗');
    const arrival = staff.getByLabelText('计划到场') as HTMLInputElement;
    const departure = staff.getByLabelText('计划离场') as HTMLInputElement;
    expect(arrival.type).toBe('datetime-local');expect(Number(arrival.step)).toBe(0.001);
    expect(arrival.value).toBe('2026-10-08T23:30:00.123');expect(departure.value).toBe('2026-10-09T00:30:00.987');
    change(staff.getByLabelText('班次'), '演练夜班');change(staff.getByLabelText('人数'), '0');
    change(staff.getByLabelText('人员来源'), 'outsourced');change(staff.getByLabelText('来源名称'), '演练承接团队占位');
    Object.defineProperty(arrival, 'validity', { configurable: true, value: { badInput: true } });
    change(arrival, '');save();
    expect(ui.updates).not.toHaveBeenCalled();
    expect(ui.layout.productionPlan!.staffing[0]!.plannedArrivalAt).toBe(original.staffing[0]!.plannedArrivalAt);
    expect(screen.getByRole('alert').textContent).toContain('计划到离场时间');
    Reflect.deleteProperty(arrival, 'validity');
    change(arrival, '2026-10-08T23:30:00.124');change(arrival, '2026-10-08T23:30:00.123');save();
    expect(ui.layout.productionPlan!.staffing[0]).toMatchObject({ headcount: 0, shiftLabel: '演练夜班', sourceType: 'outsourced', sourceName: '演练承接团队占位', plannedArrivalAt: original.staffing[0]!.plannedArrivalAt, plannedDepartureAt: original.staffing[0]!.plannedDepartureAt });
    edit();change(row('演练签到岗').getByLabelText('计划到场'), '2026-10-08T23:40:00.321');save();
    expect(ui.layout.productionPlan!.staffing[0]!.plannedArrivalAt).toBe('2026-10-08T23:40:00.321+08:00');
    expect(ui.layout.productionPlan!.staffing[0]!.plannedDepartureAt).toBe(original.staffing[0]!.plannedDepartureAt);
  });

  it('saves both newly entered staffing times after native change events', () => {
    const ui = livePanel(trialLayout(plan()));edit();
    const staff = row('演练签到岗');
    const arrival = staff.getByLabelText('计划到场');
    const departure = staff.getByLabelText('计划离场');
    // The original handler passed this sequence too; both changes dispatch React events.
    act(() => {
      change(arrival, '2026-10-09T13:15:00.123');
      change(departure, '2026-10-09T17:45:00.987');
    });
    save();
    expect(ui.updates).toHaveBeenCalledOnce();
    expect(ui.layout.productionPlan!.staffing[0]).toMatchObject({
      plannedArrivalAt: '2026-10-09T13:15:00.123+08:00',
      plannedDepartureAt: '2026-10-09T17:45:00.987+08:00',
    });
  });

  it.each(['project', 'source plan'] as const)('blocks an old draft after the current %s changes and reopens the new source after cancellation', kind => {
    const ui = livePanel(trialLayout(plan()));edit();
    change(row('演练签到岗').getByLabelText('班次'), '过期草稿班次');
    const nextPlan = plan();nextPlan.staffing[0]!.roleName = '当前演练岗位';
    const next = { ...ui.layout, ...(kind === 'project' ? { id: 'another-local-trial' } : {}), productionPlan: nextPlan };
    ui.replace(next);
    expect(screen.getByRole('alert').textContent).toContain('原草稿已保留');
    expect(row('演练签到岗').getByLabelText('班次').matches(':disabled')).toBe(true);
    fireEvent.submit(form());expect(ui.updates).not.toHaveBeenCalled();
    expect(ui.layout.productionPlan).toEqual(nextPlan);
    fireEvent.click(screen.getByRole('button', { name: '取消编辑' }));edit();
    expect((row('当前演练岗位').getByLabelText('班次') as HTMLInputElement).value).toBe('');
  });

  it('keeps missing ID references instead of attaching same-named records and permits their explicit removal', () => {
    const original = plan();
    original.staffing[0]!.taskIds = [missingTaskId];
    original.acquisitions[0]!.taskIds = [missingTaskId];original.acquisitions[0]!.objectIds = [missingObjectId];
    const ui = livePanel(trialLayout(original));edit();
    const acquisition = row('演练椅');
    const objects = acquisition.getByLabelText('关联场景物件') as HTMLSelectElement;
    const tasks = acquisition.getByLabelText('关联活动任务') as HTMLSelectElement;
    expect(Array.from(objects.selectedOptions, option => option.value)).not.toContain(objectId);
    expect(Array.from(tasks.selectedOptions, option => option.value)).not.toContain(taskId);
    change(acquisition.getByLabelText('来源说明'), '演练旧引用待人工核对');save();
    expect(ui.layout.productionPlan!.acquisitions[0]).toMatchObject({ objectIds: [missingObjectId], taskIds: [missingTaskId] });
    expect(ui.layout.productionPlan!.staffing[0]!.taskIds).toEqual([missingTaskId]);
    edit();
    for (const [label, id] of [['关联活动任务', taskId], ['关联场景物件', objectId]]) {
      const selection = row('演练椅').getByLabelText(label!) as HTMLSelectElement;
      Array.from(selection.options).find(option => option.value === id)!.selected = true;
      fireEvent.change(selection);
    }
    save();
    expect(ui.layout.productionPlan!.acquisitions[0]!.taskIds).toEqual(expect.arrayContaining([missingTaskId, taskId]));
    expect(ui.layout.productionPlan!.acquisitions[0]!.objectIds).toEqual(expect.arrayContaining([missingObjectId, objectId]));
    const taskIndex = ui.layout.productionPlan!.acquisitions[0]!.taskIds.indexOf(missingTaskId) + 1;
    const objectIndex = ui.layout.productionPlan!.acquisitions[0]!.objectIds.indexOf(missingObjectId) + 1;
    edit();
    fireEvent.click(row('演练椅').getByRole('button', { name: `移除任务关联 ${taskIndex}` }));
    fireEvent.click(row('演练椅').getByRole('button', { name: `移除物件关联 ${objectIndex}` }));save();
    expect(ui.layout.productionPlan!.acquisitions[0]).toMatchObject({ objectIds: [objectId], taskIds: [taskId] });
    expect(ui.layout.productionPlan!.staffing[0]!.taskIds).toEqual([missingTaskId]);
  });

  it('only commits removed rows and budget when the draft is saved and can explicitly remove the plan', () => {
    const original = plan();original.budget = { limitMinor: 10000, scopeNote: '演练范围', basisNote: '演练上限假设' };
    const ui = livePanel(trialLayout(original));edit();
    fireEvent.click(row('演练签到岗').getByRole('button', { name: '移除岗位' }));
    fireEvent.click(row('演练椅').getByRole('button', { name: '移除取得计划' }));
    fireEvent.click(row('演练安装估算').getByRole('button', { name: '移除估算' }));
    fireEvent.click(row('演练运输估算').getByRole('button', { name: '移除估算' }));
    fireEvent.click(screen.getByRole('button', { name: '移除预算上限' }));
    expect(ui.updates).not.toHaveBeenCalled();expect(ui.layout.productionPlan).toEqual(original);save();
    expect(ui.layout.productionPlan).toEqual(productionPlanSchema.parse({ dataKind: 'rehearsal' }));
    fireEvent.click(screen.getByRole('button', { name: '移除制作计划' }));
    expect(ui.updates.mock.calls.at(-1)).toEqual([undefined]);
    expect(Object.hasOwn(ui.layout, 'productionPlan')).toBe(false);
    expect(screen.getByText('制作计划未记录。')).toBeTruthy();
  });

  it('blocks writes when editing becomes readonly and displays plans without an update callback', () => {
    const ui = livePanel(trialLayout(plan()));edit();
    change(row('演练签到岗').getByLabelText('班次'), '只读前的未保存草稿');ui.disable();
    expect(row('演练签到岗').getByLabelText('班次').matches(':disabled')).toBe(true);
    fireEvent.submit(form());expect(ui.updates).not.toHaveBeenCalled();
    expect(ui.layout.productionPlan!.staffing[0]!.shiftLabel).toBe('');
    cleanup();livePanel(trialLayout(plan()), false);
    const button = screen.queryByRole('button', { name: '编辑制作计划' });
    if (button) { expect(button.matches(':disabled')).toBe(true);fireEvent.click(button); }
    expect(screen.queryByRole('form', { name: '制作计划草稿' })).toBeNull();
  });
});
