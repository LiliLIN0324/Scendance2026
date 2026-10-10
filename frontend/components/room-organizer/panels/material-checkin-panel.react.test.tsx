// @vitest-environment jsdom
import { webcrypto } from 'node:crypto';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSourceScope } from '@/lib/source-storage';
import { materialCheckinEventSchema, materialCheckinLedgerSchema, materialCheckinSummary, mergeMaterialCheckinLedgers, projectMaterialCheckinEvents,
  type MaterialCheckinEvent, type MaterialCheckinLedger } from '../../../../supabase/functions/_shared/material-checkin-contract';
import { productionPlanSchema } from '../../../../supabase/functions/_shared/production-plan-contract';
import { makeFloor, makeItem, makeLayout } from '../lib/__testfixtures__/fixtures';
import { MaterialCheckinPanel } from './material-checkin-panel';
import type { RoomLayout } from '../lib/types';

const projectId = 'house-checkin-trial';
const acquisitionId = '10000000-0000-4000-8000-000000000001';
const sheetId = '20000000-0000-4000-8000-000000000001';
const agreementId = '30000000-0000-4000-8000-000000000001';
const receivedId = '40000000-0000-4000-8000-000000000001';
const returnedId = '40000000-0000-4000-8000-000000000002';
const moreReceivedId = '40000000-0000-4000-8000-000000000003';
const moreReturnedId = '40000000-0000-4000-8000-000000000004';
const correctionId = '50000000-0000-4000-8000-000000000001';
const snapshot = { title: '演练租赁20把椅子', supplierName: '演练供应方占位', specificationNote: '演练折叠椅规格' };

beforeEach(() => vi.stubGlobal('crypto', webcrypto));
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

function layout(id = projectId): RoomLayout {
  return makeLayout({ id, name: '独立演练 · 数量点验',
    floors: [makeFloor({ items: [makeItem({ id: 'model-1', name: '演练椅' }), makeItem({ id: 'model-2', name: '演练椅' }), makeItem({ id: 'model-3', name: '演练椅' })] })],
    productionPlan: productionPlanSchema.parse({ dataKind: 'rehearsal', acquisitions: [{ id: acquisitionId, ...snapshot, method: 'rental', objectIds: ['model-1', 'model-2', 'model-3'] }] }),
  });
}
function checked(kind: 'receive' | 'return', quantity: number, id: string, batchRef: string, occurredAt: string): MaterialCheckinEvent {
  return materialCheckinEventSchema.parse({ id, kind, quantity, batchRef, checkState: 'checked', occurredAt,
    fromPartyName: kind === 'receive' ? '演练供应方占位' : '演练现场组', toPartyName: kind === 'receive' ? '演练现场组' : '演练供应方占位',
    evidenceNote: `演练原始点验${quantity}件，原文留存`, evidenceUrls: [], recordedAt: '2026-10-08T05:00:00Z', recordedBy: '演练记录人',
  });
}
function ledger(events: MaterialCheckinEvent[] = [], id = projectId): MaterialCheckinLedger {
  return materialCheckinLedgerSchema.parse({ schemaVersion: 1, projectId: id, dataKind: 'rehearsal', sheets: [{
    id: sheetId, acquisitionId, acquisitionSnapshot: snapshot, unit: 'piece',
    agreements: [{ id: agreementId, agreedQuantity: 20, basisNote: '演练约定20件，待真实活动核定', recordedAt: '2026-10-08T01:00:00Z', recordedBy: '演练记录人' }], events,
  }] });
}
function fullLedger(): MaterialCheckinLedger {
  return ledger([checked('receive', 18, receivedId, '演练收1', '2026-10-08T02:00:00Z'), checked('return', 18, returnedId, '演练还1', '2026-10-08T04:00:00Z')]);
}
function batchedLedger(): MaterialCheckinLedger {
  return ledger([checked('receive', 12, receivedId, '演练收1', '2026-10-08T02:00:00Z'), checked('receive', 6, moreReceivedId, '演练收2', '2026-10-08T02:30:00Z'),
    checked('return', 5, returnedId, '演练还1', '2026-10-08T03:00:00Z'), checked('return', 13, moreReturnedId, '演练还2', '2026-10-08T04:00:00Z')]);
}
function livePanel(initial: RoomLayout, initialLedger?: MaterialCheckinLedger, beforeSave: (value: MaterialCheckinLedger) => Promise<void> = async () => {}) {
  let current = initial, saved = initialLedger;
  let options = { loading: false, error: null as string | null, disabled: false };
  const calls = vi.fn<(value: MaterialCheckinLedger) => void>();
  let view: ReturnType<typeof render>;
  async function onSave(value: MaterialCheckinLedger): Promise<void> {
    materialCheckinLedgerSchema.parse(value);calls(value);await beforeSave(value);
    saved = saved === undefined ? value : mergeMaterialCheckinLedgers(saved, value);
    view.rerender(element());
  }
  const element = () => <MaterialCheckinPanel layout={current} projectId={current.id!} ledger={saved} {...options} onSave={onSave}/>;
  view = render(element());
  return { calls, get layout() { return current; }, get ledger() { return saved; },
    replace(next: RoomLayout, value = saved) { current = next;saved = value;view.rerender(element()); },
    flags(next: Partial<typeof options>) { options = { ...options, ...next };view.rerender(element()); },
  };
}
function form() { return within(screen.getByRole('form', { name: '点验记录表单' })); }
function change(label: string, value: string): void { fireEvent.change(form().getByLabelText(label), { target: { value } }); }
function beginSheet(unit: 'piece' | 'set' = 'piece', quantity = ''): void {
  fireEvent.click(screen.getByRole('button', { name: '新建点验单' }));
  change('原取得计划', acquisitionId);change('计数单位', unit);change('点验资料类型', 'rehearsal');
  change('约定数量', quantity);change('记录人', '演练记录人');
}
function fillBatch(quantity: string, batchRef = '演练新增批次', evidence = '演练逐批核对说明'): void {
  change('批次编号', batchRef);change('本批数量', quantity);change('核对状态', 'checked');
  change('发生时间（北京时间）', '2026-10-08T10:00:00.123');
  change('交出方', '演练交出组');change('接收方', '演练接收组');change('现场说明', evidence);change('记录人', '演练记录人');
}
async function save(): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: '保存点验记录' }));
  await act(async () => {});
}
function count(label: string): string {
  const term = screen.getByText(label, { exact: true });
  return term.nextElementSibling?.textContent ?? term.parentElement!.textContent!;
}

describe('material quantity check-in UI', () => {
  it('blocks leaving even an empty open form without submitting, then permits cancellation', async () => {
    const ui = livePanel(layout());
    await expect(flushSourceScope(projectId)).resolves.toBeUndefined();
    fireEvent.click(screen.getByRole('button', { name: '新建点验单' }));
    await act(async () => { await expect(flushSourceScope(projectId)).rejects.toThrow('请先保存或取消点验记录'); });
    expect(ui.calls).not.toHaveBeenCalled();expect(screen.getByRole('alert').textContent).toContain('保存或取消');
    fireEvent.click(screen.getByRole('button', { name: '取消记录' }));
    await expect(flushSourceScope(projectId)).resolves.toBeUndefined();
    expect(screen.queryByRole('form', { name: '点验记录表单' })).toBeNull();
  });

  it('keeps invalid input protected and releases the guard after a successful parent update', async () => {
    const ui = livePanel(layout());beginSheet('piece', '20');await save();
    expect(ui.calls).not.toHaveBeenCalled();
    await act(async () => { await expect(flushSourceScope(projectId)).rejects.toThrow('请先保存或取消点验记录'); });
    expect((form().getByLabelText('约定数量') as HTMLInputElement).value).toBe('20');
    change('约定依据', '演练人工核对20件');await save();
    expect(ui.calls).toHaveBeenCalledOnce();expect(ui.ledger!.sheets).toHaveLength(1);
    await expect(flushSourceScope(projectId)).resolves.toBeUndefined();
  });

  it('rejects a flush immediately during a pending save without waiting for that save', async () => {
    let finish!: () => void;
    const pending = new Promise<void>(resolve => { finish = resolve; });
    const ui = livePanel(layout(), ledger(), () => pending);
    fireEvent.click(screen.getByRole('button', { name: '记录实收' }));fillBatch('18');
    fireEvent.click(screen.getByRole('button', { name: '保存点验记录' }));
    await waitFor(() => expect(ui.calls).toHaveBeenCalledOnce());
    await act(async () => { await expect(flushSourceScope(projectId)).rejects.toThrow('正在保存'); });
    expect((form().getByLabelText('本批数量') as HTMLInputElement).value).toBe('18');
    await act(async () => { finish();await pending; });
    await expect(flushSourceScope(projectId)).resolves.toBeUndefined();
    expect(materialCheckinSummary(ui.ledger!.sheets[0]!).receivedQuantity).toBe(18);
  });

  it('isolates each project guard and unregisters it on unmount', async () => {
    const ui = livePanel(layout());beginSheet();
    const other = 'house-checkin-trial-B';ui.replace(layout(other), undefined);
    await expect(flushSourceScope(projectId)).resolves.toBeUndefined();
    await expect(flushSourceScope(other)).resolves.toBeUndefined();
    beginSheet();
    await act(async () => { await expect(flushSourceScope(other)).rejects.toThrow('请先保存或取消点验记录'); });
    await expect(flushSourceScope(projectId)).resolves.toBeUndefined();
    cleanup();
    await expect(flushSourceScope(other)).resolves.toBeUndefined();expect(ui.calls).not.toHaveBeenCalled();
  });

  it('creates explicit sheets with the original acquisition ID and keeps unknown agreement distinct from zero', async () => {
    const ui = livePanel(layout());
    expect(ui.calls).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '新建点验单' }));
    change('原取得计划', acquisitionId);change('点验资料类型', 'rehearsal');change('记录人', '演练记录人');
    expect((form().getByLabelText('计数单位') as HTMLSelectElement).value).toBe('');
    await save();expect(ui.calls).not.toHaveBeenCalled();expect(screen.getByRole('alert')).toBeTruthy();
    change('计数单位', 'set');
    expect((form().getByLabelText('约定数量') as HTMLInputElement).value).toBe('');
    await save();
    expect(ui.ledger!.sheets[0]).toMatchObject({ acquisitionId, acquisitionSnapshot: snapshot, unit: 'set' });
    expect(ui.ledger!.sheets[0]!.agreements[0]!.agreedQuantity).toBeNull();
    beginSheet('piece', '0');await save();
    expect(ui.calls).toHaveBeenCalledOnce();expect(screen.getByRole('alert')).toBeTruthy();
    change('约定依据', '演练明确约定为零，不取标题或模型数量');await save();
    expect(ui.calls).toHaveBeenCalledTimes(2);expect(ui.ledger!.sheets).toHaveLength(2);
    expect(ui.ledger!.sheets[1]!.agreements[0]!.agreedQuantity).toBe(0);
    expect(ui.ledger!.sheets[1]!.acquisitionId).toBe(acquisitionId);
  });

  it.each([['single handoff', fullLedger], ['split batches', batchedLedger]] as const)('shows 20 agreed, 18 received and 18 returned without implying loss or settlement (%s)', (_name, fixture) => {
    const ui = livePanel(layout(), fixture());
    expect(screen.getByText('账册资料性质：演练')).toBeTruthy();
    expect(count('完整实收数量')).toContain('18');expect(count('完整归还数量')).toContain('18');
    expect(count('约定未实收')).toContain('2');expect(count('实收范围待归还')).toContain('0');
    expect(ui.calls).not.toHaveBeenCalled();
    expect(materialCheckinSummary(ui.ledger!.sheets[0]!)).toMatchObject({ receivedQuantity: 18, returnedQuantity: 18, notReceivedQuantity: 2, notReturnedQuantity: 0 });
    expect(screen.queryByText(/已遗失|合同已结清|已完成结算/)).toBeNull();
  });

  it('requires checked evidence and keeps pending or disputed batches outside complete totals', async () => {
    const pending = materialCheckinEventSchema.parse({ id: moreReceivedId, kind: 'receive', quantity: null, checkState: 'pending', recordedAt: '2026-10-08T05:00:00Z', recordedBy: '演练记录人' });
    const disputed = materialCheckinEventSchema.parse({ id: moreReturnedId, kind: 'receive', quantity: 7, checkState: 'disputed', recordedAt: '2026-10-08T05:00:00Z', recordedBy: '演练记录人' });
    const ui = livePanel(layout(), ledger([pending, disputed]));
    fireEvent.click(screen.getByRole('button', { name: '记录实收' }));fillBatch('', '演练核零', '');await save();
    expect(ui.calls).not.toHaveBeenCalled();expect(screen.getByRole('alert')).toBeTruthy();
    change('本批数量', '0');await save();expect(ui.calls).not.toHaveBeenCalled();
    change('现场说明', '演练明确核对实收为零');await save();
    expect(ui.calls).toHaveBeenCalledOnce();
    expect(count('已核实收小计')).toContain('0');expect(count('完整实收数量')).toContain('未知');expect(count('完整归还数量')).toContain('未知');
    expect(materialCheckinSummary(ui.ledger!.sheets[0]!)).toMatchObject({ knownReceivedQuantity: 0, receivedQuantity: null, returnedQuantity: null, pendingEventIds: [pending.id], disputedEventIds: [disputed.id] });
  });

  it('corrects 18 to 16 as one receipt version, retains the original wording and voids the latest version once', async () => {
    const original = checked('receive', 18, receivedId, '演练收1', '2026-10-08T02:00:00Z');
    const ui = livePanel(layout(), ledger([original]));
    fireEvent.click(screen.getByRole('button', { name: '更正有效记录' }));
    change('当前有效记录', receivedId);change('本批数量', '16');change('更正或作废理由', '演练原录入18应为16');
    change('现场说明', '演练更正后重新核对16件');change('记录人', '演练更正人');await save();
    expect(ui.ledger!.sheets[0]!.events[0]).toEqual(original);
    const corrected = ui.ledger!.sheets[0]!.events.at(-1)!;
    expect(corrected).toMatchObject({ kind: 'correction', targetId: receivedId, replacement: { quantity: 16 } });
    expect(projectMaterialCheckinEvents(ui.ledger!.sheets[0]!).effectiveEvents).toMatchObject([{ rootEventId: receivedId, effectiveEventId: corrected.id, kind: 'receive', quantity: 16 }]);
    expect(count('完整实收数量')).toContain('16');expect(count('完整归还数量')).toContain('未知');
    const history = screen.getByText('原始历史记录').closest('details')!;
    fireEvent.click(history.querySelector('summary')!);history.open = true;
    expect(within(history).getByText(/原文留存/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '作废有效记录' }));
    change('当前有效记录', corrected.id);change('更正或作废理由', '演练重复登记，整条作废');
    change('现场说明', '演练人工核对作废依据');change('记录人', '演练作废人');await save();
    expect(ui.ledger!.sheets[0]!.events).toHaveLength(3);
    expect(ui.ledger!.sheets[0]!.events.at(-1)).toMatchObject({ kind: 'void', targetId: corrected.id });
    expect(projectMaterialCheckinEvents(ui.ledger!.sheets[0]!)).toMatchObject({ effectiveEvents: [], voidedRootIds: [receivedId] });
    expect(ui.ledger!.sheets[0]!.events[0]).toEqual(original);
  });

  it('refuses saving a new sheet from an acquisition snapshot that changed while editing', async () => {
    const initial = layout(), ui = livePanel(initial);beginSheet();change('约定依据', '演练旧供应依据');
    const changed = { ...initial, productionPlan: productionPlanSchema.parse({ ...initial.productionPlan!, acquisitions: initial.productionPlan!.acquisitions.map(value => ({ ...value, supplierName: '演练新供应依据' })) }) };
    ui.replace(changed);fireEvent.submit(screen.getByRole('form', { name: '点验记录表单' }));await act(async () => {});
    expect(ui.calls).not.toHaveBeenCalled();expect(screen.getByRole('alert')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '取消记录' }));beginSheet();
    change('约定依据', '演练重开后核对新供应依据');await save();
    expect(ui.calls).toHaveBeenCalledOnce();
    expect(ui.ledger!.sheets[0]!.acquisitionSnapshot.supplierName).toBe('演练新供应依据');
  });

  it('refuses a correction after its selected parent was replaced by another correction', async () => {
    const base = ledger([checked('receive', 18, receivedId, '演练收1', '2026-10-08T02:00:00Z')]);
    const ui = livePanel(layout(), base);
    fireEvent.click(screen.getByRole('button', { name: '更正有效记录' }));change('当前有效记录', receivedId);
    change('本批数量', '16');change('更正或作废理由', '演练旧稿更正');change('记录人', '演练记录人');
    const replacement = { batchRef: '演练收1', quantity: 15, checkState: 'checked', occurredAt: '2026-10-08T02:00:00Z', fromPartyName: '演练供应方占位', toPartyName: '演练现场组', evidenceNote: '演练另一页核对15件', evidenceUrls: [] };
    const next = materialCheckinLedgerSchema.parse({ ...base, sheets: [{ ...base.sheets[0]!, events: [...base.sheets[0]!.events, { id: correctionId, kind: 'correction', targetId: receivedId, reason: '演练先完成的更正', replacement, recordedAt: '2026-10-08T06:00:00Z', recordedBy: '演练另一页' }] }] });
    ui.replace(ui.layout, mergeMaterialCheckinLedgers(base, next));
    fireEvent.submit(screen.getByRole('form', { name: '点验记录表单' }));await act(async () => {});
    expect(ui.calls).not.toHaveBeenCalled();expect(screen.getByRole('alert')).toBeTruthy();
    expect(materialCheckinSummary(ui.ledger!.sheets[0]!).receivedQuantity).toBe(15);
  });

  it('retries a failed save with the same record ID, timestamp and original payload without double counting', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });vi.setSystemTime(new Date('2026-10-09T07:00:00Z'));
    const store = vi.fn<(value: MaterialCheckinLedger) => Promise<void>>().mockRejectedValueOnce(new Error('演练写入失败')).mockResolvedValueOnce(undefined);
    const ui = livePanel(layout(), ledger(), store);
    fireEvent.click(screen.getByRole('button', { name: '记录实收' }));fillBatch('18');await save();
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    const first = structuredClone(ui.calls.mock.calls[0]![0]);
    expect((form().getByLabelText('本批数量') as HTMLInputElement).value).toBe('18');expect(ui.ledger!.sheets[0]!.events).toHaveLength(0);
    vi.setSystemTime(new Date('2026-10-09T07:00:10Z'));await save();
    expect(ui.calls).toHaveBeenCalledTimes(2);expect(ui.calls.mock.calls[1]![0]).toEqual(first);
    expect(ui.ledger!.sheets[0]!.events).toHaveLength(1);expect(materialCheckinSummary(ui.ledger!.sheets[0]!).receivedQuantity).toBe(18);
  });

  it('locks a failed revision already observed in the parent ledger and only changes it through a fresh revision after cancellation', async () => {
    let current = ledger();
    const calls = vi.fn<(value: MaterialCheckinLedger) => void>();
    let view: ReturnType<typeof render>;
    async function onSave(value: MaterialCheckinLedger): Promise<void> {
      calls(value);current = mergeMaterialCheckinLedgers(current, value);view.rerender(element());
      if (calls.mock.calls.length <= 2) throw new Error('演练写入后反馈失败');
    }
    const currentLayout = layout();
    const element = () => <MaterialCheckinPanel layout={currentLayout} projectId={projectId} ledger={current} loading={false} error={null} disabled={false} onSave={onSave}/>;
    view = render(element());
    fireEvent.click(screen.getByRole('button', { name: '修订约定' }));
    change('约定数量', '25');change('约定依据', '演练明确修订为25件');change('记录人', '演练记录人');await save();
    expect(screen.getByRole('alert')).toBeTruthy();
    const first = structuredClone(calls.mock.calls[0]![0]);
    const quantity = form().getByLabelText('约定数量') as HTMLInputElement;
    expect(quantity.matches(':disabled')).toBe(true);change('约定数量', '30');expect(quantity.value).toBe('25');
    await save();expect(calls).toHaveBeenCalledTimes(2);expect(calls.mock.calls[1]![0]).toEqual(first);
    expect(current.sheets[0]!.agreements).toHaveLength(2);
    const adopted = current.sheets[0]!.agreements.at(-1)!;
    fireEvent.click(screen.getByRole('button', { name: '取消记录' }));
    fireEvent.click(screen.getByRole('button', { name: '修订约定' }));
    change('约定数量', '30');change('约定依据', '演练取消旧稿后明确修订为30件');change('记录人', '演练记录人');await save();
    expect(calls).toHaveBeenCalledTimes(3);expect(current.sheets[0]!.agreements).toHaveLength(3);
    expect(current.sheets[0]!.agreements.at(-1)).toMatchObject({ supersedesId: adopted.id, agreedQuantity: 30 });
    expect(current.sheets[0]!.agreements.at(-1)!.id).not.toBe(adopted.id);
    expect(current.sheets[0]!.agreements[0]!.agreedQuantity).toBe(20);
  });

  it.each(['success', 'failure'] as const)('keeps old asynchronous %s feedback out of a new A→B→A draft', async outcome => {
    let finish!: () => void, fail!: (error: Error) => void;
    const pending = new Promise<void>((resolve, reject) => { finish = resolve;fail = reject; });
    const onSave = vi.fn<(value: MaterialCheckinLedger) => Promise<void>>().mockReturnValue(pending);
    const a = layout(), aLedger = ledger(), b = layout('house-checkin-trial-B');
    const element = (current: RoomLayout, value: MaterialCheckinLedger | undefined) => <MaterialCheckinPanel layout={current} projectId={current.id!} ledger={value} loading={false} error={null} disabled={false} onSave={onSave}/>;
    const view = render(element(a, aLedger));fireEvent.click(screen.getByRole('button', { name: '记录实收' }));fillBatch('18', '演练旧A批次');
    fireEvent.click(screen.getByRole('button', { name: '保存点验记录' }));await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    view.rerender(element(b, undefined));view.rerender(element(a, aLedger));
    fireEvent.click(screen.getByRole('button', { name: '记录实收' }));fillBatch('7', '演练新A草稿');
    await act(async () => { if (outcome === 'success') finish();else fail(new Error('演练旧A异步失败'));await pending.catch(() => {}); });
    expect((form().getByLabelText('批次编号') as HTMLInputElement).value).toBe('演练新A草稿');
    expect((form().getByLabelText('本批数量') as HTMLInputElement).value).toBe('7');
    expect(screen.queryByText(/演练旧A异步失败/)).toBeNull();expect(screen.queryByRole('status')).toBeNull();
    expect(onSave).toHaveBeenCalledOnce();
  });

  it('prevents writes for readonly, loading, read error, mismatched ledger or mismatched layout identity', async () => {
    const current = layout(), empty = ledger(), onSave = vi.fn<(value: MaterialCheckinLedger) => Promise<void>>();
    const props = { layout: current, projectId, ledger: empty, loading: false, error: null as string | null, disabled: false, onSave };
    const view = render(<MaterialCheckinPanel {...props}/>);
    fireEvent.click(screen.getByRole('button', { name: '记录实收' }));fillBatch('18');
    for (const override of [{ disabled: true }, { loading: true }, { error: '演练账册读取失败' }, { ledger: ledger([], 'house-checkin-trial-B') }, { layout: layout('house-checkin-trial-B') }]) {
      view.rerender(<MaterialCheckinPanel {...props} {...override}/>);
      const active = screen.queryByRole('form', { name: '点验记录表单' });
      if (active) fireEvent.submit(active);
      const create = screen.queryByRole('button', { name: '新建点验单' });
      if (create) { expect(create.matches(':disabled')).toBe(true);fireEvent.click(create); }
      await act(async () => {});expect(onSave).not.toHaveBeenCalled();
    }
    view.rerender(<MaterialCheckinPanel {...props}/>);
    fireEvent.click(screen.getByRole('button', { name: '记录实收' }));fillBatch('18');
    view.rerender(<MaterialCheckinPanel {...props} ledger={materialCheckinLedgerSchema.parse({ ...empty, dataKind: 'real' })}/>);
    fireEvent.submit(screen.getByRole('form', { name: '点验记录表单' }));await act(async () => {});
    expect(onSave).not.toHaveBeenCalled();expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('retains the original sheet identity after its acquisition is deleted without reattaching a same-named plan', () => {
    const initial = layout(), ui = livePanel(initial, fullLedger());
    const otherId = '10000000-0000-4000-8000-000000000002';
    const next = { ...initial, productionPlan: productionPlanSchema.parse({ ...initial.productionPlan!, acquisitions: [{ ...initial.productionPlan!.acquisitions[0]!, id: otherId }] }) };
    ui.replace(next);
    expect(count('完整实收数量')).toContain('18');expect(count('实收范围待归还')).toContain('0');
    expect(ui.ledger!.sheets[0]).toMatchObject({ id: sheetId, acquisitionId, acquisitionSnapshot: snapshot });
    expect(ui.calls).not.toHaveBeenCalled();expect(ui.layout.floors[0]!.items).toHaveLength(3);
  });
});
