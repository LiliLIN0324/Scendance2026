// @vitest-environment jsdom
import { Blob as NodeBlob, File as NodeFile } from 'node:buffer';
import { webcrypto } from 'node:crypto';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createRef, StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_COMMERCIAL_BACKUP_BYTES, preflightCommercialBackupJson, restoreCommercialBackupJson, serializeCommercialBackup,
  type CommercialRestoreCandidate } from '@/lib/commercial-dossier-backup';
import {
  appendCommercialSignatureReport, CommercialReadbackError, discardCommercialDraft, freezeCommercialVersion,
  prepareCommercialOriginal, readCommercialSnapshot, saveCommercialDraft, verifyCommercialOriginal,
  type CommercialFileAdditions, type CommercialRead, type CommercialStoredSnapshot,
} from '@/lib/commercial-dossier-storage';
import { flushSourceScope } from '@/lib/source-storage';
import {
  commercialAttachmentSchema, commercialContentSchema, commercialDossierSchema, commercialDraftSchema,
  commercialSignatureReportSchema, commercialVersionSchema,
  type CommercialAgreement, type CommercialAttachment, type CommercialContent,
} from '../../../../supabase/functions/_shared/commercial-dossier-contract';
import { canonical } from '../../../../supabase/functions/_shared/domain';
import { eventOperationsSchema } from '../../../../supabase/functions/_shared/event-operations-contract';
import { makeFloor, makeItem, makeLayout } from '../lib/__testfixtures__/fixtures';
import { downloadTextFile } from '../lib/plan-export/download';
import { CommercialDossierPanel, type CommercialDossierPanelHandle, type CommercialDossierPanelProps } from './commercial-dossier-panel';

vi.mock('@/lib/commercial-dossier-storage', async importOriginal => {
  const real = await importOriginal<typeof import('@/lib/commercial-dossier-storage')>();
  return { ...real, readCommercialSnapshot: vi.fn(), saveCommercialDraft: vi.fn(), freezeCommercialVersion: vi.fn(),
    appendCommercialSignatureReport: vi.fn(), discardCommercialDraft: vi.fn(), prepareCommercialOriginal: vi.fn(real.prepareCommercialOriginal),
    verifyCommercialOriginal: vi.fn(real.verifyCommercialOriginal) };
});
vi.mock('@/lib/commercial-dossier-backup', async importOriginal => {
  const real = await importOriginal<typeof import('@/lib/commercial-dossier-backup')>();
  return { ...real, serializeCommercialBackup: vi.fn(), preflightCommercialBackupJson: vi.fn(), restoreCommercialBackupJson: vi.fn() };
});
vi.mock('../lib/plan-export/download', () => ({ downloadTextFile: vi.fn() }));

const projectId = 'commercial-ui-project';
const agreementId = '10000000-0000-4000-8000-000000000001';
const draftId = '20000000-0000-4000-8000-000000000001';
const attachmentId = '30000000-0000-4000-8000-000000000001';
const externalId = '30000000-0000-4000-8000-000000000002';
const versionId = '40000000-0000-4000-8000-000000000001';
const reportId = '50000000-0000-4000-8000-000000000001';
const recordedAt = '2026-10-09T06:00:00.000Z';
const pdfBytes = '%PDF-1.7\nOriginal bytes: rehearsal only\n%%EOF\n';
let stored: CommercialRead;
let nextToken: number;
let clicked: ReturnType<typeof vi.spyOn>;
let objectUrl: ReturnType<typeof vi.fn>;
let revokeUrl: ReturnType<typeof vi.fn>;

function readCopy(value: CommercialRead & { status: 'present' }): CommercialRead & { status: 'present' };
function readCopy(value?: CommercialRead): CommercialRead;
function readCopy(value: CommercialRead = stored): CommercialRead {
  return value.status === 'absent' ? { ...value } : { ...value, value: { ...value.value,
    dossier: commercialDossierSchema.parse(value.value.dossier), originals: { ...value.value.originals } } };
}
function present(agreements: CommercialAgreement[] = [], refs: CommercialAttachment[] = [], originals: Record<string, Blob> = {}): CommercialRead & { status: 'present' } {
  return { status: 'present', projectId, value: { schemaVersion: 1, storageToken: 'storage-1',
    dossier: commercialDossierSchema.parse({ projectId, dataKind: 'rehearsal', agreements, attachmentRefs: refs }), originals } };
}
function savedDraft(content: Partial<CommercialContent> = {}): CommercialAgreement {
  return { id: agreementId, direction: 'customer_commission', versions: [], draft: commercialDraftSchema.parse({
    id: draftId, draftToken: 'initial-token', content: commercialContentSchema.parse({ title: '已存客户演练', ...content }) }) };
}
function missingRef(): CommercialAttachment {
  return commercialAttachmentSchema.parse({ id: attachmentId, agreementId, sourceState: 'missing', purpose: 'agreement',
    documentLabel: '演练合同待补原件', recordedAt, recordedBy: '演练记录人' });
}
function history(): CommercialRead & { status: 'present' } {
  const version = commercialVersionSchema.parse({ id: versionId, recordedAt, recordedBy: '演练记录人', fixingNote: '冻结演练资料',
    content: { ...commercialContentSchema.parse({ title: '冻结客户演练', unconfirmedNote: '主体范围未知，仅软件演练' }), documentRefs: [attachmentId] } });
  return present([{ id: agreementId, direction: 'customer_commission', draft: null, versions: [version] }], [missingRef()]);
}
function signedHistory(): CommercialRead & { status: 'present' } {
  const value = history(); value.value.dossier.signatureReports = [commercialSignatureReportSchema.parse({
    id: reportId, agreementId, versionId, kind: 'reported_signed', recordedAt, recordedBy: '演练记录人',
    observedParties: ['our'], signedOn: null, evidenceNote: '原软件演练报告，真实签署未核', attachmentIds: [attachmentId],
  })]; value.value.dossier = commercialDossierSchema.parse(value.value.dossier); return value;
}
async function localHistory(): Promise<CommercialRead & { status: 'present' }> {
  const original = await prepareCommercialOriginal({ id: attachmentId, agreementId, fileName: '原始合同.PDF', purpose: 'agreement',
    documentLabel: '未经签署的演练原件', sourceUrl: null, recordedAt, recordedBy: '演练记录人' }, new Blob([pdfBytes], { type: 'application/pdf' }));
  const value = history(); value.value.dossier.attachmentRefs = [original.attachment]; value.value.originals = { [attachmentId]: original.blob };
  return value;
}
function snapshot(): CommercialStoredSnapshot {
  if (stored.status !== 'present') throw new Error('test expected saved snapshot');
  return stored.value;
}
function clearTemporary(value: CommercialStoredSnapshot, id: string): void {
  const referenced = new Set(value.dossier.agreements.flatMap(row => [...row.versions.flatMap(version => version.content.documentRefs), ...row.draft?.content.documentRefs ?? []]));
  for (const report of value.dossier.signatureReports) (report.kind === 'correction' ? report.replacement : report).attachmentIds.forEach(ref => referenced.add(ref));
  value.dossier.attachmentRefs = value.dossier.attachmentRefs.filter(row => {
    if (row.agreementId !== id || referenced.has(row.id)) return true;
    delete value.originals[row.id]; return false;
  });
}
async function addFiles(value: CommercialStoredSnapshot, input: CommercialFileAdditions): Promise<void> {
  const real = await vi.importActual<typeof import('@/lib/commercial-dossier-storage')>('@/lib/commercial-dossier-storage');
  for (const file of input.originals ?? []) await real.verifyCommercialOriginal(file.attachment, file.blob);
  for (const ref of [...input.attachmentRefs ?? [], ...input.originals?.map(row => row.attachment) ?? []]) {
    const existing = value.dossier.attachmentRefs.find(row => row.id === ref.id);
    if (existing && canonical(existing) !== canonical(ref)) throw new Error('同附件编号已有不同内容');
    if (!existing) value.dossier.attachmentRefs.push(commercialAttachmentSchema.parse(ref));
  }
  for (const file of input.originals ?? []) if (!value.originals[file.attachment.id]) value.originals[file.attachment.id] = file.blob;
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: Error) => void;
  const promise = new Promise<T>((ok, no) => { resolve = ok; reject = no; });
  return { promise, resolve, reject };
}
function setup(overrides: Partial<CommercialDossierPanelProps> = {}, strict = false) {
  const ref = createRef<CommercialDossierPanelHandle>();
  const onStateChange = vi.fn();
  let props: CommercialDossierPanelProps = { identity: { mode: 'local', projectId, epoch: 1 }, flushScope: projectId,
    layout: makeLayout({ id: projectId, name: '30人商务演练', eventOperations: eventOperationsSchema.parse({ dataKind: 'rehearsal' }),
      floors: [makeFloor({ items: [makeItem({ id: 'chair-1', name: '演练椅' })] })] }),
    guard: vi.fn(), onStateChange, ...overrides };
  const element = () => strict ? <StrictMode><CommercialDossierPanel ref={ref} {...props}/></StrictMode> : <CommercialDossierPanel ref={ref} {...props}/>;
  const view = render(element());
  return { ref, view, onStateChange, get props() { return props; },
    update(next: Partial<CommercialDossierPanelProps>) { props = { ...props, ...next }; view.rerender(element()); } };
}
const button = (name: string | RegExp) => screen.getByRole('button', { name }) as HTMLButtonElement;
function change(name: string | RegExp, value: string): void { fireEvent.change(screen.getByLabelText(name), { target: { value } }); }
function chooseFile(label: string | RegExp, chosen: File): void { fireEvent.change(screen.getByLabelText(label), { target: { files: [chosen] } }); }
function openSection(name: RegExp): void {
  const summary = screen.queryByText(name, { selector: 'summary' });
  if (summary && !(summary.parentElement as HTMLDetailsElement).open) fireEvent.click(summary);
}
async function ready(): Promise<void> { await waitFor(() => expect(button('新建客户委托').disabled).toBe(false)); }
async function beginCustomer(): Promise<void> {
  await ready(); if (!(screen.getByLabelText('资料性质') as HTMLSelectElement).disabled) change('资料性质', 'rehearsal');
  fireEvent.click(button('新建客户委托'));
}
function openHistory(): void { fireEvent.click(button('查看固定历史')); openSection(/固定第1版/); }
function reportForm() { return within(screen.getByRole('form', { name: '人工签署报告' })); }
async function save(): Promise<void> { fireEvent.click(button('保存草稿')); await waitFor(() => expect(button('保存草稿').disabled).toBe(false)); }

beforeEach(async () => {
  vi.stubGlobal('Blob', NodeBlob); vi.stubGlobal('File', NodeFile); vi.stubGlobal('crypto', webcrypto);
  stored = { status: 'absent', projectId }; nextToken = 0;
  vi.mocked(readCommercialSnapshot).mockReset().mockImplementation(async (id, guard) => {
    guard(); const value = readCopy(); guard(); return value.status === 'absent' ? { ...value, projectId: id } : value;
  });
  vi.mocked(saveCommercialDraft).mockReset().mockImplementation(async (id, input, guard) => {
    guard(); const value = stored.status === 'present' ? readCopy(stored).value : present().value;
    if (stored.status === 'present' && (value.dossier.projectId !== id || value.dossier.dataKind !== input.dataKind)) throw new Error('项目或资料性质不一致');
    if (stored.status === 'absent') value.dossier = commercialDossierSchema.parse({ projectId: id, dataKind: input.dataKind });
    let agreement = value.dossier.agreements.find(row => row.id === input.agreementId);
    if ((agreement?.draft?.draftToken ?? null) !== input.expectedDraftToken) throw new Error('草稿冲突');
    if (agreement && agreement.direction !== input.direction) throw new Error('业务方向不能改变');
    if (agreement?.draft && agreement.draft.id !== input.draft.id) throw new Error('草稿编号不能改变');
    if (!agreement) { agreement = { id: input.agreementId, direction: input.direction, draft: null, versions: [] }; value.dossier.agreements.push(agreement); }
    agreement.draft = commercialDraftSchema.parse({ ...input.draft, draftToken: `saved-token-${++nextToken}` });
    await addFiles(value, input); if (input.cleanupUnreferenced) clearTemporary(value, input.agreementId);
    value.dossier = commercialDossierSchema.parse(value.dossier); value.storageToken = `storage-${nextToken}`;
    guard(); stored = { status: 'present', projectId: id, value }; return readCopy();
  });
  vi.mocked(freezeCommercialVersion).mockReset().mockImplementation(async (_id, id, expected, metadata, guard) => {
    guard(); const value = readCopy(stored);
    if (value.status !== 'present') throw new Error('missing');
    const agreement = value.value.dossier.agreements.find(row => row.id === id)!;
    if (agreement.draft?.draftToken !== expected) throw new Error('草稿冲突');
    agreement.versions.push(commercialVersionSchema.parse({ ...metadata, ...(agreement.draft.basedOnVersionId ? { basedOnVersionId: agreement.draft.basedOnVersionId } : {}), content: agreement.draft.content }));
    agreement.draft = null; value.value.dossier = commercialDossierSchema.parse(value.value.dossier); guard(); stored = value; return readCopy();
  });
  vi.mocked(appendCommercialSignatureReport).mockReset().mockImplementation(async (_id, report, additions, guard) => {
    guard(); const value = readCopy(stored);
    if (value.status !== 'present') throw new Error('missing');
    const existing = value.value.dossier.signatureReports.find(row => row.id === report.id);
    if (existing && canonical(existing) !== canonical(report)) throw new Error('报告编号有不同内容');
    if (!existing) value.value.dossier.signatureReports.push(commercialSignatureReportSchema.parse(report));
    await addFiles(value.value, additions);
    value.value.dossier = commercialDossierSchema.parse(value.value.dossier); guard(); stored = value; return readCopy();
  });
  vi.mocked(discardCommercialDraft).mockReset().mockImplementation(async (_id, id, expected, guard) => {
    guard(); const value = readCopy(stored);
    if (value.status !== 'present') throw new Error('missing');
    const agreement = value.value.dossier.agreements.find(row => row.id === id)!;
    if (agreement.draft?.draftToken !== expected) throw new Error('草稿冲突');
    agreement.draft = null; clearTemporary(value.value, id);
    value.value.dossier.agreements = value.value.dossier.agreements.filter(row => row.versions.length || row.draft !== null || value.value.dossier.signatureReports.some(report => report.agreementId === row.id));
    value.value.dossier = commercialDossierSchema.parse(value.value.dossier);
    guard(); stored = value; return readCopy();
  });
  const realStorage = await vi.importActual<typeof import('@/lib/commercial-dossier-storage')>('@/lib/commercial-dossier-storage');
  vi.mocked(prepareCommercialOriginal).mockReset().mockImplementation(realStorage.prepareCommercialOriginal);
  vi.mocked(verifyCommercialOriginal).mockReset().mockImplementation(realStorage.verifyCommercialOriginal);
  vi.mocked(serializeCommercialBackup).mockReset().mockResolvedValue('{"commercial":"complete"}');
  vi.mocked(preflightCommercialBackupJson).mockReset(); vi.mocked(restoreCommercialBackupJson).mockReset();
  vi.mocked(downloadTextFile).mockReset();
  objectUrl = vi.fn(() => 'blob:commercial-test'); revokeUrl = vi.fn();
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: objectUrl });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeUrl });
  clicked = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('commercial dossier panel', () => {
  it('does not read hidden local files in cloud mode, without stable identity, or for a mismatched layout', async () => {
    const ui = setup({ identity: { mode: 'cloud', projectId, epoch: 1 } });
    await act(async () => {}); expect(readCommercialSnapshot).not.toHaveBeenCalled();
    ui.update({ identity: { mode: 'local', projectId: null, epoch: 2 } });
    await act(async () => {}); expect(readCommercialSnapshot).not.toHaveBeenCalled();
    ui.update({ identity: { mode: 'local', projectId, epoch: 3 }, layout: makeLayout({ id: 'other-project' }) });
    await act(async () => {}); expect(readCommercialSnapshot).not.toHaveBeenCalled();
  });

  it('keeps read failure distinct from absence and never enables an empty overwrite', async () => {
    vi.mocked(readCommercialSnapshot).mockRejectedValueOnce(new Error('cannot read local bytes'));
    const ui = setup();
    await screen.findByRole('alert'); expect(saveCommercialDraft).not.toHaveBeenCalled();
    const create = screen.queryByRole('button', { name: '新建客户委托' }) as HTMLButtonElement | null;
    expect(!create || create.disabled).toBe(true);
    await expect(ui.ref.current!.flush()).rejects.toThrow();
  });

  it('rejects a dirty editor through both the handle and registered source flush, then releases after abandoning local edits', async () => {
    const ui = setup(); await beginCustomer(); change('约定名称', '未保存客户演练');
    await expect(ui.ref.current!.flush()).rejects.toThrow();
    await expect(flushSourceScope(projectId)).rejects.toThrow();
    fireEvent.click(button('放弃未保存修改'));
    await expect(ui.ref.current!.flush()).resolves.toBeUndefined();
    await expect(flushSourceScope(projectId)).resolves.toBeUndefined();
    expect(discardCommercialDraft).not.toHaveBeenCalled();
  });

  it('does not adopt a late first read after StrictMode replay or use its token as a new editor baseline', async () => {
    const first = deferred<CommercialRead>();
    stored = present([savedDraft()]);
    vi.mocked(readCommercialSnapshot).mockReturnValueOnce(first.promise).mockResolvedValueOnce(readCopy());
    setup({}, true); await ready();
    await waitFor(() => expect(readCommercialSnapshot).toHaveBeenCalledTimes(2));
    const stale = present([savedDraft({ title: '迟到旧草稿' })]);
    stale.value.dossier.agreements[0].draft!.draftToken = 'stale-token';
    await act(async () => { first.resolve(stale); });
    expect(screen.queryByText('迟到旧草稿')).toBeNull();
    fireEvent.click(button('编辑已存草稿')); change('约定名称', '当前修改'); await save();
    expect(vi.mocked(saveCommercialDraft).mock.calls[0][1].expectedDraftToken).toBe('initial-token');
  });

  it('ignores an old A read after A → B → A with newer epochs', async () => {
    const oldA = deferred<CommercialRead>();
    vi.mocked(readCommercialSnapshot).mockReturnValueOnce(oldA.promise);
    const ui = setup();
    ui.update({ identity: { mode: 'local', projectId: 'project-b', epoch: 2 }, layout: makeLayout({ id: 'project-b' }) });
    await ready();
    ui.update({ identity: { mode: 'local', projectId, epoch: 3 }, layout: makeLayout({ id: projectId }) });
    await ready();
    await act(async () => { oldA.resolve(present([savedDraft({ title: '旧A结果不得显示' })])); });
    expect(screen.queryByText('旧A结果不得显示')).toBeNull();
    await beginCustomer(); await save();
    expect(vi.mocked(saveCommercialDraft).mock.calls.at(-1)![1].expectedDraftToken).toBeNull();
  });

  it('saves a blank draft with explicit absence CAS and establishes only the confirmed returned token', async () => {
    setup(); await beginCustomer(); await save();
    const first = vi.mocked(saveCommercialDraft).mock.calls[0][1];
    expect(first.expectedDraftToken).toBeNull();
    expect(first.direction).toBe('customer_commission');
    expect(first.dataKind).toBe('rehearsal');
    expect(first.draft.content.ourParty.name).toBe(''); expect(first.draft.content.fileAmount.amountMinor).toBeNull();
    expect(first.draft.content.fileAmount.currency).toBeNull();
    change('约定名称', '保存后修改'); await save();
    const second = vi.mocked(saveCommercialDraft).mock.calls[1][1];
    expect(second.expectedDraftToken).toBe('saved-token-1'); expect(second.draft.id).toBe(first.draft.id);
    expect(snapshot().dossier.agreements[0].draft?.content.title).toBe('保存后修改');
  });

  it('preserves unsaved input and its original CAS token after a concurrent draft rejection', async () => {
    stored = present([savedDraft()]); setup(); await ready(); fireEvent.click(button('编辑已存草稿'));
    change('约定名称', '本页未保存');
    vi.mocked(saveCommercialDraft).mockRejectedValueOnce(new Error('商务草稿已有新变化'));
    fireEvent.click(button('保存草稿')); await screen.findByRole('alert');
    expect((screen.getByLabelText('约定名称') as HTMLInputElement).value).toBe('本页未保存');
    expect(vi.mocked(saveCommercialDraft).mock.calls[0][1].expectedDraftToken).toBe('initial-token');
    expect(readCommercialSnapshot).toHaveBeenCalledTimes(1);
  });

  it('locks pending saves even against forced change/click events and rejects switching until confirmation', async () => {
    const saving = deferred<CommercialRead>();
    vi.mocked(saveCommercialDraft).mockReturnValueOnce(saving.promise);
    const ui = setup(); await beginCustomer(); change('约定名称', '保存中的内容');
    fireEvent.click(button('保存草稿')); await waitFor(() => expect(button('保存草稿').disabled).toBe(true));
    fireEvent.change(screen.getByLabelText('约定名称'), { target: { value: '强制变化' } });
    fireEvent.click(button('保存草稿'));
    expect(vi.mocked(saveCommercialDraft).mock.calls).toHaveLength(1);
    expect((screen.getByLabelText('约定名称') as HTMLInputElement).value).toBe('保存中的内容');
    await expect(ui.ref.current!.flush()).rejects.toThrow(); await expect(flushSourceScope(projectId)).rejects.toThrow();
    const input = vi.mocked(saveCommercialDraft).mock.calls[0][1];
    const confirmed = present([{ id: input.agreementId, direction: input.direction, versions: [],
      draft: commercialDraftSchema.parse({ ...input.draft, draftToken: 'pending-returned-token' }) }]);
    await act(async () => { saving.resolve(confirmed); });
    await expect(ui.ref.current!.flush()).resolves.toBeUndefined();
    expect((screen.getByLabelText('约定名称') as HTMLInputElement).value).toBe('保存中的内容');
  });

  it('does not display an old save as success after leaving and reopening the same project with a new epoch', async () => {
    const saving = deferred<CommercialRead>(); vi.mocked(saveCommercialDraft).mockReturnValueOnce(saving.promise);
    const ui = setup(); await beginCustomer(); change('约定名称', '旧保存结果'); fireEvent.click(button('保存草稿'));
    const input = vi.mocked(saveCommercialDraft).mock.calls[0][1];
    ui.update({ identity: { mode: 'local', projectId: 'project-b', epoch: 2 }, layout: makeLayout({ id: 'project-b' }) }); await ready();
    ui.update({ identity: { mode: 'local', projectId, epoch: 3 }, layout: makeLayout({ id: projectId }) }); await ready();
    await act(async () => { saving.resolve(present([{ id: input.agreementId, direction: input.direction, versions: [],
      draft: commercialDraftSchema.parse({ ...input.draft, draftToken: 'late-token' }) }])); });
    expect(screen.queryByText('旧保存结果')).toBeNull();
    await beginCustomer(); await save();
    expect(vi.mocked(saveCommercialDraft).mock.calls.at(-1)![1].expectedDraftToken).toBeNull();
  });

  it('requires an explicit readback after committed uncertainty and preserves the submitted draft without blind retry', async () => {
    vi.mocked(saveCommercialDraft).mockRejectedValueOnce(new CommercialReadbackError());
    const ui = setup(); await beginCustomer(); change('约定名称', '已提交未核实内容'); fireEvent.click(button('保存草稿'));
    await screen.findByRole('alert');
    expect((screen.getByLabelText('约定名称') as HTMLInputElement).value).toBe('已提交未核实内容');
    expect(button('保存草稿').disabled).toBe(true); fireEvent.click(button('保存草稿')); expect(saveCommercialDraft).toHaveBeenCalledTimes(1);
    await expect(ui.ref.current!.flush()).rejects.toThrow();
    const input = vi.mocked(saveCommercialDraft).mock.calls[0][1];
    stored = present([{ id: input.agreementId, direction: input.direction, versions: [],
      draft: commercialDraftSchema.parse({ ...input.draft, draftToken: 'reloaded-token' }) }]);
    fireEvent.click(button('重新读取核对')); await ready();
    expect(readCommercialSnapshot).toHaveBeenCalledTimes(2);
    await expect(ui.ref.current!.flush()).resolves.toBeUndefined();
    expect(saveCommercialDraft).toHaveBeenCalledTimes(1);
  });

  it('keeps a geometry-only layout update out of the commercial editing identity', async () => {
    const ui = setup(); await beginCustomer(); change('约定名称', '不随几何刷新抹除');
    ui.update({ layout: { ...ui.props.layout, width: 25, name: '几何更新后', floors: [makeFloor({ items: [makeItem({ id: 'chair-1', name: '新名称' })] })] } });
    expect((screen.getByLabelText('约定名称') as HTMLInputElement).value).toBe('不随几何刷新抹除');
    expect(readCommercialSnapshot).toHaveBeenCalledTimes(1);
    await save(); expect(snapshot().dossier.agreements[0].draft?.content.title).toBe('不随几何刷新抹除');
  });

  it('creates customer and supplier drafts with independent nested defaults', async () => {
    setup(); await beginCustomer(); change('约定名称', '客户演练'); change('我方主体', '我方演练组'); await save();
    fireEvent.click(button('新建供应约定')); await save();
    expect(saveCommercialDraft).toHaveBeenCalledTimes(2);
    const [customer, supplier] = snapshot().dossier.agreements;
    expect(customer.direction).toBe('customer_commission'); expect(supplier.direction).toBe('supplier_engagement');
    expect(supplier.draft?.content.ourParty.name).toBe(''); expect(supplier.draft?.content.references.objectIds).toEqual([]);
    expect(supplier.draft?.content.fileAmount.amountMinor).toBeNull();
    expect(customer.draft?.content.ourParty.name).toBe('我方演练组');
    expect(customer.draft?.content.ourParty).not.toBe(supplier.draft?.content.ourParty);
    expect(customer.draft?.content.references).not.toBe(supplier.draft?.content.references);
  });

  it('abandons unsaved changes back to the read baseline and reserves draft deletion for a second explicit confirmation', async () => {
    stored = present([savedDraft()]); const ui = setup(); await ready(); fireEvent.click(button('编辑已存草稿'));
    change('约定名称', '本页改动'); fireEvent.click(button('放弃未保存修改'));
    expect(discardCommercialDraft).not.toHaveBeenCalled(); expect(saveCommercialDraft).not.toHaveBeenCalled();
    await expect(ui.ref.current!.flush()).resolves.toBeUndefined();
    fireEvent.click(button('编辑已存草稿'));
    expect((screen.getByLabelText('约定名称') as HTMLInputElement).value).toBe('已存客户演练');
    fireEvent.click(button('删除已存草稿'));
    expect(discardCommercialDraft).not.toHaveBeenCalled();
    expect(screen.getByRole('group', { name: '删除草稿确认' })).toBeTruthy(); fireEvent.click(button('取消删除'));
    expect(discardCommercialDraft).not.toHaveBeenCalled(); fireEvent.click(button('删除已存草稿')); fireEvent.click(button('确认删除已存草稿'));
    await waitFor(() => expect(discardCommercialDraft).toHaveBeenCalledOnce());
    expect(vi.mocked(discardCommercialDraft).mock.calls[0].slice(0, 3)).toEqual([projectId, agreementId, 'initial-token']);
  });

  it('unregisters a dirty source flush when the panel unmounts', async () => {
    const ui = setup(); await beginCustomer();
    await expect(flushSourceScope(projectId)).rejects.toThrow();
    ui.view.unmount(); await expect(flushSourceScope(projectId)).resolves.toBeUndefined();
  });

  it('registers the supplied activity flush scope independently from its persistent commercial project ID', async () => {
    setup({ flushScope: 'editor-controller-source-scope' }); await beginCustomer();
    await expect(flushSourceScope('editor-controller-source-scope')).rejects.toThrow();
    await expect(flushSourceScope(projectId)).resolves.toBeUndefined();
    expect(vi.mocked(readCommercialSnapshot).mock.calls[0][0]).toBe(projectId);
  });

  it('exports a fresh saved read with one fixed metadata identity and never exports an unsaved editor', async () => {
    const ui = setup(); await ready();
    stored = present([savedDraft({ title: '后台已有合法新资料' })]);
    openSection(/商务原件包/); fireEvent.click(button('导出商务原件包'));
    await waitFor(() => expect(serializeCommercialBackup).toHaveBeenCalledOnce());
    const [read, metadata] = vi.mocked(serializeCommercialBackup).mock.calls[0];
    expect(read.status).toBe('present');
    if (read.status === 'present') expect(read.value.dossier.agreements[0].draft?.content.title).toBe('后台已有合法新资料');
    expect(metadata.id).toBeTruthy(); expect(Number.isNaN(Date.parse(metadata.generatedAt))).toBe(false);
    expect(downloadTextFile).toHaveBeenCalledOnce();
    await beginCustomer(); change('约定名称', '不应打进包的未保存资料');
    fireEvent.click(button('导出商务原件包')); await act(async () => {});
    expect(serializeCommercialBackup).toHaveBeenCalledTimes(1);
    await expect(ui.ref.current!.flush()).rejects.toThrow();
  });

  it.each(['absent', 'not-in-file'] as const)('prechecks %s as a distinct non-restoring result and preserves existing business facts', async status => {
    stored = history(); const original = commercialDossierSchema.parse(snapshot().dossier);
    const candidate: CommercialRestoreCandidate = status === 'not-in-file' ? { status, projectId } : { status, projectId, id: 'absence-package', generatedAt: recordedAt };
    vi.mocked(preflightCommercialBackupJson).mockResolvedValueOnce(candidate);
    setup(); await ready(); openSection(/商务原件包/);
    chooseFile('选择商务包', new File(['old-or-absent'], '旧文件.json', { type: 'application/json' }));
    await waitFor(() => expect(preflightCommercialBackupJson).toHaveBeenCalledOnce());
    await act(async () => {});
    const restore = screen.queryByRole('button', { name: '确认恢复商务资料' }) as HTMLButtonElement | null;
    expect(!restore || restore.disabled).toBe(true); expect(restoreCommercialBackupJson).not.toHaveBeenCalled();
    expect(snapshot().dossier).toEqual(original);
    expect(screen.queryByText(/商务资料已恢复/)).toBeNull();
  });

  it('prechecks present records first, then restores only after explicit confirmation using target read tokens', async () => {
    stored = present([savedDraft()]);
    const incoming = present([savedDraft()]); incoming.value.dossier.agreements[0].draft!.draftToken = 'package-token-is-not-authority';
    vi.mocked(preflightCommercialBackupJson).mockResolvedValueOnce({ status: 'present', projectId, id: 'restore-package', generatedAt: recordedAt, value: incoming.value });
    vi.mocked(restoreCommercialBackupJson).mockResolvedValueOnce(readCopy(stored));
    setup(); await ready(); openSection(/商务原件包/);
    chooseFile('选择商务包', new File(['complete-commercial-package'], '商务包.json', { type: 'application/json' }));
    await waitFor(() => expect(preflightCommercialBackupJson).toHaveBeenCalledOnce());
    await act(async () => {}); expect(restoreCommercialBackupJson).not.toHaveBeenCalled();
    expect(button('确认恢复商务资料').disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox', { name: /确认.*恢复/ }));
    fireEvent.click(button('确认恢复商务资料'));
    await waitFor(() => expect(restoreCommercialBackupJson).toHaveBeenCalledOnce());
    expect(vi.mocked(restoreCommercialBackupJson).mock.calls[0].slice(0, 3)).toEqual(['complete-commercial-package', projectId, { [agreementId]: 'initial-token' }]);
  });

  it('keeps bad or cross-project package preflight failures separate from success and leaves saved facts unchanged', async () => {
    stored = history(); const original = commercialDossierSchema.parse(snapshot().dossier);
    vi.mocked(preflightCommercialBackupJson).mockRejectedValueOnce(new Error('商务包属于另一项目，未覆盖'));
    setup(); await ready(); openSection(/商务原件包/);
    chooseFile('选择商务包', new File(['wrong-project'], '跨项目包.json', { type: 'application/json' }));
    await screen.findByRole('alert'); expect(restoreCommercialBackupJson).not.toHaveBeenCalled();
    expect(snapshot().dossier).toEqual(original);
    expect(screen.queryByText(/商务资料已恢复/)).toBeNull();
  });

  it('rejects scope flush while a package is being restored and prevents a forced second restore', async () => {
    stored = history(); const restoring = deferred<CommercialRead>();
    vi.mocked(preflightCommercialBackupJson).mockResolvedValueOnce({ status: 'present', projectId, id: 'pending-package', generatedAt: recordedAt, value: snapshot() });
    vi.mocked(restoreCommercialBackupJson).mockReturnValueOnce(restoring.promise);
    const ui = setup(); await ready(); openSection(/商务原件包/);
    chooseFile('选择商务包', new File(['pending-restore'], '商务包.json', { type: 'application/json' }));
    await waitFor(() => expect(preflightCommercialBackupJson).toHaveBeenCalledOnce()); await act(async () => {});
    fireEvent.click(screen.getByRole('checkbox', { name: /确认.*恢复/ })); fireEvent.click(button('确认恢复商务资料'));
    await expect(ui.ref.current!.flush()).rejects.toThrow(); await expect(flushSourceScope(projectId)).rejects.toThrow();
    fireEvent.click(button('确认恢复商务资料')); expect(restoreCommercialBackupJson).toHaveBeenCalledTimes(1);
    await act(async () => { restoring.resolve(readCopy()); });
    await expect(ui.ref.current!.flush()).resolves.toBeUndefined();
  });

  it('cancels a late package encode download after the activity epoch changes', async () => {
    const encoded = deferred<string>(); vi.mocked(serializeCommercialBackup).mockReturnValueOnce(encoded.promise);
    const ui = setup(); await ready(); openSection(/商务原件包/); fireEvent.click(button('导出商务原件包'));
    await waitFor(() => expect(serializeCommercialBackup).toHaveBeenCalledOnce());
    ui.update({ identity: { mode: 'local', projectId: 'other-project', epoch: 2 }, layout: makeLayout({ id: 'other-project' }) }); await ready();
    await act(async () => { encoded.resolve('must-not-download'); }); expect(downloadTextFile).not.toHaveBeenCalled();
  });

  it('downloads the original name and bytes only after actual byte verification', async () => {
    stored = await localHistory(); vi.mocked(verifyCommercialOriginal).mockClear(); setup(); await ready(); openHistory();
    fireEvent.click(button(/下载原件/)); await waitFor(() => expect(clicked).toHaveBeenCalledOnce());
    expect(verifyCommercialOriginal).toHaveBeenCalledOnce();
    const [record, bytes] = vi.mocked(verifyCommercialOriginal).mock.calls[0];
    expect(record.fileName).toBe('原始合同.PDF'); expect(await bytes.text()).toBe(pdfBytes);
    expect(objectUrl).toHaveBeenCalledWith(bytes);
    const anchor = clicked.mock.instances[0] as unknown as HTMLAnchorElement;
    expect(anchor.download).toBe('原始合同.PDF'); await waitFor(() => expect(revokeUrl).toHaveBeenCalledWith('blob:commercial-test'));
    expect(downloadTextFile).not.toHaveBeenCalled();
  });

  it('does not download a local-file declaration whose actual bytes fail verification', async () => {
    stored = await localHistory(); vi.mocked(verifyCommercialOriginal).mockRejectedValueOnce(new Error('摘要不一致'));
    setup(); await ready(); openHistory(); fireEvent.click(button(/下载原件/)); await screen.findByRole('alert');
    expect(clicked).not.toHaveBeenCalled(); expect(objectUrl).not.toHaveBeenCalled();
    expect(snapshot().dossier.attachmentRefs[0].sourceState).toBe('local-file');
  });

  it('cancels a verified original download if the local identity changes while verification is pending', async () => {
    stored = await localHistory(); const verifying = deferred<void>();
    vi.mocked(verifyCommercialOriginal).mockReturnValueOnce(verifying.promise);
    const ui = setup(); await ready(); openHistory(); fireEvent.click(button(/下载原件/));
    await waitFor(() => expect(verifyCommercialOriginal).toHaveBeenCalledOnce());
    ui.update({ identity: { mode: 'cloud', projectId, epoch: 2 } });
    await act(async () => { verifying.resolve(); });
    expect(clicked).not.toHaveBeenCalled(); expect(objectUrl).not.toHaveBeenCalled();
  });

  it('keeps external and missing origins explicit without fetching or exposing them as local downloads', async () => {
    const external = commercialAttachmentSchema.parse({ ...missingRef(), id: externalId, sourceState: 'external-reference',
      sourceUrl: 'https://example.org/rehearsal-contract', documentLabel: '原件仅为外链' });
    const value = present([savedDraft({ documentRefs: [attachmentId, externalId] })], [missingRef(), external]);
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch); stored = value; setup(); await ready();
    fireEvent.click(button('编辑已存草稿')); openSection(/原件与来源/);
    expect(screen.queryByRole('button', { name: /下载原件/ })).toBeNull();
    expect(screen.getAllByText(/原件仅为外链/).length).toBeGreaterThan(0); expect(screen.getAllByText(/待补原件/).length).toBeGreaterThan(0);
    expect(fetch).not.toHaveBeenCalled(); expect(prepareCommercialOriginal).not.toHaveBeenCalled();
  });

  it('starts an editable draft from the selected old fixed version without rewriting that history', async () => {
    stored = history(); const original = commercialDossierSchema.parse(snapshot().dossier);
    setup(); await ready(); openHistory(); fireEvent.click(button('从此版起新草稿'));
    expect((screen.getByLabelText('约定名称') as HTMLInputElement).value).toBe('冻结客户演练');
    change('约定名称', '以旧版为依据的新草稿'); await save();
    const input = vi.mocked(saveCommercialDraft).mock.calls[0][1];
    expect(input.expectedDraftToken).toBeNull(); expect(input.draft.basedOnVersionId).toBe(versionId);
    expect(input.draft.content.documentRefs).toEqual([attachmentId]);
    expect(snapshot().dossier.agreements[0].versions).toEqual(original.agreements[0].versions);
    expect(snapshot().dossier.agreements[0].versions[0].content.title).toBe('冻结客户演练');
  });

  it.each([
    { fileAmount: { amountMinor: 0, currency: 'CNY' as const, basisNote: '自制文件明确零额，仅演练' }, amountSourceText: '演练原文人民币0元' },
    { fileAmount: { amountMinor: null, currency: null, basisNote: '币种未核，以原文为准' }, amountSourceText: 'USD 100.00（演练原文，不换算人民币）' },
  ])('preserves zero and non-CNY source meaning when editing another field: $amountSourceText', async content => {
    stored = present([savedDraft(content)]); setup(); await ready(); fireEvent.click(button('编辑已存草稿'));
    change('约定名称', '只修改名称'); await save();
    const saved = vi.mocked(saveCommercialDraft).mock.calls[0][1].draft.content;
    expect(saved.fileAmount).toEqual(content.fileAmount); expect(saved.amountSourceText).toBe(content.amountSourceText);
  });

  it.each([['0', 0], ['12.34', 1234]] as const)('records exact CNY %s from explicit file basis while preserving parties, scope and planned payment nodes', async (amount, minor) => {
    setup(); await beginCustomer(); change('约定名称', '金额与计划演练'); change('我方主体', '演练承办组'); change('对方主体', '演练客户');
    change('包含范围', '30人交流演练的场地准备'); change('不含事项', '真实签署与实付均未记录'); change('待确认说明', '仅软件演练，真实日期待定');
    openSection(/文件金额与收付款计划/); change('文件记载金额（元）', amount); change('文件金额币种', 'CNY');
    change('文件金额依据', '自制演练文件记载，不是报价'); change('金额原文', `人民币${amount}元，软件演练`);
    fireEvent.click(button('添加计划节点')); change('节点1名称', '演练预收计划'); change('计划方向', 'receivable');
    change('节点1金额（元）', '0'); change('节点币种', 'CNY'); change('节点1金额依据', '文件计划零额，仅演练');
    change('节点1计划日期', '2026-10-17'); change('节点1触发条件', '演练前核对范围'); await save();
    const content = vi.mocked(saveCommercialDraft).mock.calls[0][1].draft.content;
    expect(content.fileAmount).toEqual({ amountMinor: minor, currency: 'CNY', basisNote: '自制演练文件记载，不是报价' });
    expect(content.ourParty.name).toBe('演练承办组'); expect(content.counterparty.name).toBe('演练客户');
    expect(content.scopeIn).toBe('30人交流演练的场地准备'); expect(content.scopeOut).toBe('真实签署与实付均未记录');
    expect(content.paymentPlanNodes[0]).toMatchObject({ label: '演练预收计划', direction: 'receivable', dueOn: '2026-10-17',
      triggerNote: '演练前核对范围', amount: { amountMinor: 0, currency: 'CNY', basisNote: '文件计划零额，仅演练' } });
    expect('paidAt' in content.paymentPlanNodes[0]).toBe(false); expect('receivedAt' in content.paymentPlanNodes[0]).toBe(false);
  });

  it.each(['1.234', '1e3', '-1'])('rejects ambiguous monetary input %s without submitting or replacing it', async value => {
    setup(); await beginCustomer(); openSection(/文件金额与收付款计划/);
    change('文件记载金额（元）', value); change('文件金额币种', 'CNY'); change('文件金额依据', '演练依据');
    fireEvent.click(button('保存草稿')); await screen.findByRole('alert'); expect(saveCommercialDraft).not.toHaveBeenCalled();
    expect((screen.getByLabelText('文件记载金额（元）') as HTMLInputElement).value).toBe(value);
  });

  it('does not silently assign CNY to a known number without confirmed currency and basis', async () => {
    setup(); await beginCustomer(); openSection(/文件金额与收付款计划/); change('文件记载金额（元）', '100.00');
    fireEvent.click(button('保存草稿')); await screen.findByRole('alert'); expect(saveCommercialDraft).not.toHaveBeenCalled();
    expect((screen.getByLabelText('文件金额币种') as HTMLSelectElement).value).toBe('');
    expect((screen.getByLabelText('文件记载金额（元）') as HTMLInputElement).value).toBe('100.00');
  });

  it('prepares and saves a PDF original with its actual filename, unconverted bytes and document reference', async () => {
    setup(); await beginCustomer(); change('本次录入人', '演练录入人'); openSection(/原件与来源/);
    change('文件用途', 'quotation'); change('文件版本标识', '自制演练报价资料，未被确认');
    chooseFile('添加草稿原件', new File([pdfBytes], '签署未知 演练原件.PDF', { type: 'application/pdf' }));
    await waitFor(() => expect(prepareCommercialOriginal).toHaveBeenCalledOnce());
    await waitFor(() => expect(button('保存草稿').disabled).toBe(false));
    expect(vi.mocked(prepareCommercialOriginal).mock.calls[0][0]).toMatchObject({ fileName: '签署未知 演练原件.PDF', recordedBy: '演练录入人',
      purpose: 'quotation', documentLabel: '自制演练报价资料，未被确认' });
    expect(await vi.mocked(prepareCommercialOriginal).mock.calls[0][1].text()).toBe(pdfBytes);
    const quoteId = (screen.getByLabelText('关联报价原件') as HTMLSelectElement).options[1].value; change('关联报价原件', quoteId);
    await save(); const input = vi.mocked(saveCommercialDraft).mock.calls[0][1];
    expect(input.originals).toHaveLength(1); expect(await input.originals![0].blob.text()).toBe(pdfBytes);
    const record = input.originals![0].attachment;
    expect(input.draft.content.documentRefs).toEqual([record.id]); expect(record.sourceState).toBe('local-file');
    expect(input.draft.content.quoteDocumentId).toBe(record.id);
    expect(record.byteSize).toBe(new Blob([pdfBytes]).size); expect(record.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(snapshot().dossier.signatureReports).toEqual([]);
  });

  it('locks an async original preparation and cancels its late prepared file after leaving the activity', async () => {
    const prepared = deferred<Awaited<ReturnType<typeof prepareCommercialOriginal>>>();
    vi.mocked(prepareCommercialOriginal).mockReturnValueOnce(prepared.promise);
    const ui = setup(); await beginCustomer(); change('约定名称', '准备原件中'); change('本次录入人', '演练录入人'); openSection(/原件与来源/);
    const file = new File([pdfBytes], '迟到原件.pdf', { type: 'application/pdf' }); chooseFile('添加草稿原件', file);
    await waitFor(() => expect(prepareCommercialOriginal).toHaveBeenCalledOnce());
    fireEvent.change(screen.getByLabelText('约定名称'), { target: { value: '强制原件中修改' } });
    fireEvent.change(screen.getByLabelText('本次录入人'), { target: { value: '强制更换录入人' } });
    expect((screen.getByLabelText('约定名称') as HTMLInputElement).value).toBe('准备原件中');
    expect((screen.getByLabelText('本次录入人') as HTMLInputElement).value).toBe('演练录入人');
    expect((screen.getByLabelText('本次录入人') as HTMLInputElement).disabled).toBe(true);
    await expect(ui.ref.current!.flush()).rejects.toThrow();
    const metadata = vi.mocked(prepareCommercialOriginal).mock.calls[0][0];
    ui.update({ identity: { mode: 'local', projectId: 'next-project', epoch: 2 }, layout: makeLayout({ id: 'next-project' }) }); await ready();
    const real = await vi.importActual<typeof import('@/lib/commercial-dossier-storage')>('@/lib/commercial-dossier-storage');
    await act(async () => { prepared.resolve(await real.prepareCommercialOriginal(metadata, file)); });
    expect(screen.queryByText('迟到原件.pdf')).toBeNull(); expect(saveCommercialDraft).not.toHaveBeenCalled();
  });

  it('registers external and missing sources without fetching or pretending that they contain original bytes', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch); setup(); await beginCustomer(); change('本次录入人', '演练录入人');
    openSection(/原件与来源/); openSection(/登记外链或缺失来源/); change('来源文件名（可未知）', '外链演练合同.pdf');
    change('外部来源地址', 'https://example.org/rehearsal-contract'); fireEvent.click(button('登记来源'));
    change('来源状态', 'missing'); change('来源文件名（可未知）', '待补演练原件.pdf'); fireEvent.click(button('登记来源')); await save();
    expect(fetch).not.toHaveBeenCalled(); expect(prepareCommercialOriginal).not.toHaveBeenCalled();
    const input = vi.mocked(saveCommercialDraft).mock.calls[0][1]; expect(input.originals).toEqual([]);
    expect(input.attachmentRefs?.map(row => row.sourceState)).toEqual(['external-reference', 'missing']);
    expect(input.attachmentRefs?.every(row => row.sha256 === null && row.byteSize === null)).toBe(true);
    expect(input.draft.content.documentRefs).toEqual(input.attachmentRefs?.map(row => row.id));
  });

  it('saves an unreferenced staging original first and deletes it only through explicit cleanup', async () => {
    setup(); await beginCustomer(); change('本次录入人', '演练录入人'); openSection(/原件与来源/);
    chooseFile('添加草稿原件', new File([pdfBytes], '临时原件.pdf', { type: 'application/pdf' }));
    await waitFor(() => expect(button('保存草稿').disabled).toBe(false));
    fireEvent.click(screen.getByRole('checkbox', { name: '使用文件 临时原件.pdf' })); await save();
    expect(snapshot().dossier.agreements[0].draft?.content.documentRefs).toEqual([]);
    expect(snapshot().dossier.attachmentRefs).toHaveLength(1); expect(Object.keys(snapshot().originals)).toHaveLength(1);
    expect(vi.mocked(saveCommercialDraft).mock.calls[0][1].cleanupUnreferenced).not.toBe(true);
    fireEvent.click(button('清理已解除引用的临时附件'));
    await waitFor(() => expect(saveCommercialDraft).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(button('保存草稿').disabled).toBe(false));
    expect(vi.mocked(saveCommercialDraft).mock.calls[1][1].cleanupUnreferenced).toBe(true);
    expect(snapshot().dossier.attachmentRefs).toEqual([]); expect(snapshot().originals).toEqual({});
  });

  it('fixes the exact saved draft only after the explicit action and keeps fixing separate from signing', async () => {
    stored = present([savedDraft({ title: '要固定的演练草稿', documentRefs: [attachmentId], unconfirmedNote: '主体和范围待核，仅软件演练' })], [missingRef()]);
    const before = commercialDossierSchema.parse(snapshot().dossier);
    setup(); await ready(); fireEvent.click(button('编辑已存草稿')); change('本次录入人', '演练录入人'); change('固定说明', '明确固定这份演练原文，未确认真实签署');
    expect(freezeCommercialVersion).not.toHaveBeenCalled(); fireEvent.click(button('固定当前版本'));
    await waitFor(() => expect(freezeCommercialVersion).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.queryByRole('form', { name: '约定草稿' })).toBeNull());
    const [id, target, expected, metadata] = vi.mocked(freezeCommercialVersion).mock.calls[0];
    expect([id, target, expected]).toEqual([projectId, agreementId, 'initial-token']); expect(metadata.recordedBy).toBe('演练录入人');
    expect(metadata.fixingNote).toBe('明确固定这份演练原文，未确认真实签署');
    expect(snapshot().dossier.agreements[0].draft).toBeNull();
    expect(snapshot().dossier.agreements[0].versions[0].content).toEqual(before.agreements[0].draft!.content);
    expect(snapshot().dossier.signatureReports).toEqual([]);
  });

  it('records a manual signature observation against the exact fixed version with an unknown observed date', async () => {
    stored = history(); const version = commercialDossierSchema.parse(snapshot().dossier).agreements[0].versions[0];
    const ui = setup(); await ready(); openHistory(); change('本次录入人', '演练录入人'); fireEvent.click(button('记录所见签署'));
    fireEvent.click(reportForm().getByRole('checkbox', { name: '我方所见签署标记' }));
    fireEvent.click(reportForm().getByRole('checkbox', { name: '使用文件 演练合同待补原件' }));
    fireEvent.change(reportForm().getByLabelText('人工报告说明'), { target: { value: '仅验证软件的人工报告功能，非真实签署' } });
    await expect(ui.ref.current!.flush()).rejects.toThrow(); fireEvent.click(button('保存人工报告'));
    await waitFor(() => expect(appendCommercialSignatureReport).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.queryByRole('form', { name: '人工签署报告' })).toBeNull());
    const proposal = vi.mocked(appendCommercialSignatureReport).mock.calls[0][1];
    expect(proposal).toMatchObject({ agreementId, versionId, kind: 'reported_signed', observedParties: ['our'], signedOn: null,
      attachmentIds: [attachmentId], recordedBy: '演练录入人', evidenceNote: '仅验证软件的人工报告功能，非真实签署' });
    expect(snapshot().dossier.agreements[0].versions[0]).toEqual(version);
    await expect(ui.ref.current!.flush()).resolves.toBeUndefined();
  });

  it('saves a newly prepared manual report original in the same append call as its exact version observation', async () => {
    stored = history(); setup(); await ready(); openHistory(); change('本次录入人', '演练录入人'); fireEvent.click(button('记录所见签署'));
    fireEvent.click(reportForm().getByRole('checkbox', { name: '对方所见签署标记' }));
    fireEvent.change(reportForm().getByLabelText('人工报告说明'), { target: { value: '自制演练报告原件，不代表真实签署' } });
    chooseFile('添加报告原件', new File([pdfBytes], '人工报告演练原件.pdf', { type: 'application/pdf' }));
    await waitFor(() => expect(prepareCommercialOriginal).toHaveBeenCalledOnce()); await waitFor(() => expect(button('保存人工报告').disabled).toBe(false));
    fireEvent.click(button('保存人工报告')); await waitFor(() => expect(appendCommercialSignatureReport).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.queryByRole('form', { name: '人工签署报告' })).toBeNull());
    const [id, report, additions] = vi.mocked(appendCommercialSignatureReport).mock.calls[0];
    expect(id).toBe(projectId); expect(report).toMatchObject({ agreementId, versionId, kind: 'reported_signed', signedOn: null });
    expect(additions.originals).toHaveLength(1); expect(additions.originals![0].attachment).toMatchObject({ agreementId, fileName: '人工报告演练原件.pdf', purpose: 'signature_evidence' });
    expect(report.kind === 'reported_signed' && report.attachmentIds).toEqual([additions.originals![0].attachment.id]);
    expect(await additions.originals![0].blob.text()).toBe(pdfBytes);
    expect(snapshot().dossier.attachmentRefs.find(row => row.id === additions.originals![0].attachment.id)?.purpose).toBe('signature_evidence');
  });

  it('appends correction and void reports without mutating the original report, version or evidence', async () => {
    stored = signedHistory(); const before = commercialDossierSchema.parse(snapshot().dossier);
    setup(); await ready(); openHistory(); change('本次录入人', '演练录入人'); fireEvent.click(button('更正这条报告'));
    fireEvent.change(reportForm().getByLabelText('更正或作废原因'), { target: { value: '演练核对所见日期原记录有误' } });
    fireEvent.change(reportForm().getByLabelText('人工报告说明'), { target: { value: '演练更正说明' } });
    fireEvent.change(reportForm().getByLabelText('所见签署日期（可未知）'), { target: { value: '2026-10-08' } });
    fireEvent.click(button('保存人工报告')); await waitFor(() => expect(appendCommercialSignatureReport).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.queryByRole('form', { name: '人工签署报告' })).toBeNull());
    const corrected = vi.mocked(appendCommercialSignatureReport).mock.calls[0][1];
    expect(corrected).toMatchObject({ kind: 'correction', targetId: reportId, agreementId, versionId,
      replacement: { signedOn: '2026-10-08', observedParties: ['our'], attachmentIds: [attachmentId] } });
    expect(snapshot().dossier.signatureReports[0]).toEqual(before.signatureReports[0]);
    fireEvent.click(button('作废这条报告'));
    fireEvent.change(reportForm().getByLabelText('更正或作废原因'), { target: { value: '演练撤销这一条人工报告记录' } });
    fireEvent.change(reportForm().getByLabelText('人工报告说明'), { target: { value: '只作废软件报告，非现实合同撤销' } });
    fireEvent.click(button('保存人工报告')); await waitFor(() => expect(appendCommercialSignatureReport).toHaveBeenCalledTimes(2));
    const voided = vi.mocked(appendCommercialSignatureReport).mock.calls[1][1];
    expect(voided).toMatchObject({ kind: 'void', targetId: corrected.id, agreementId, versionId, attachmentIds: [attachmentId] });
    expect(snapshot().dossier.signatureReports[0]).toEqual(before.signatureReports[0]); expect(snapshot().dossier.signatureReports[1]).toEqual(corrected);
    expect(snapshot().dossier.agreements[0].versions).toEqual(before.agreements[0].versions);
    expect(snapshot().dossier.attachmentRefs).toEqual(before.attachmentRefs);
  });

  it('locks a pending manual report, retains its action ID on committed uncertainty and requires exact explicit readback', async () => {
    stored = history(); const submitting = deferred<CommercialRead>();
    vi.mocked(appendCommercialSignatureReport).mockReturnValueOnce(submitting.promise);
    const ui = setup(); await ready(); openHistory(); change('本次录入人', '演练录入人'); fireEvent.click(button('记录所见签署'));
    fireEvent.click(reportForm().getByRole('checkbox', { name: '对方所见签署标记' }));
    fireEvent.click(reportForm().getByRole('checkbox', { name: '使用文件 演练合同待补原件' }));
    fireEvent.change(reportForm().getByLabelText('人工报告说明'), { target: { value: '已提交待核对的演练报告' } });
    fireEvent.click(button('保存人工报告')); await waitFor(() => expect(appendCommercialSignatureReport).toHaveBeenCalledOnce());
    const proposal = vi.mocked(appendCommercialSignatureReport).mock.calls[0][1];
    fireEvent.change(reportForm().getByLabelText('人工报告说明'), { target: { value: '强制改动' } }); fireEvent.click(button('保存人工报告'));
    expect((reportForm().getByLabelText('人工报告说明') as HTMLTextAreaElement).value).toBe('已提交待核对的演练报告');
    expect(appendCommercialSignatureReport).toHaveBeenCalledTimes(1); await expect(ui.ref.current!.flush()).rejects.toThrow();
    await act(async () => { submitting.reject(new CommercialReadbackError()); }); await screen.findByRole('alert');
    expect(button('保存人工报告').disabled).toBe(true); expect(snapshot().dossier.signatureReports).toEqual([]);
    fireEvent.click(button('重新读取核对')); await waitFor(() => expect(button('重新读取核对').disabled).toBe(false));
    expect(button('保存人工报告').disabled).toBe(true); expect(appendCommercialSignatureReport).toHaveBeenCalledTimes(1);
    snapshot().dossier.signatureReports.push(commercialSignatureReportSchema.parse(proposal));
    fireEvent.click(button('重新读取核对')); await ready();
    await waitFor(() => expect(screen.queryByRole('form', { name: '人工签署报告' })).toBeNull());
    expect(snapshot().dossier.signatureReports[0].id).toBe(proposal.id); expect(appendCommercialSignatureReport).toHaveBeenCalledTimes(1);
    await expect(ui.ref.current!.flush()).resolves.toBeUndefined();
  });

  it('preserves all fixed and manual report originals when a later draft stops referencing and cleans files', async () => {
    stored = await localHistory(); const local = snapshot().dossier.attachmentRefs[0];
    snapshot().dossier.signatureReports.push(commercialSignatureReportSchema.parse({ id: reportId, agreementId, versionId, kind: 'reported_signed',
      recordedAt, recordedBy: '演练记录人', observedParties: ['our'], signedOn: null, evidenceNote: '软件演练报告', attachmentIds: [attachmentId] }));
    const before = commercialDossierSchema.parse(snapshot().dossier);
    setup(); await ready(); openHistory(); fireEvent.click(button('从此版起新草稿')); openSection(/原件与来源/);
    fireEvent.click(screen.getByRole('checkbox', { name: `使用文件 ${local.fileName}` })); await save();
    fireEvent.click(button('清理已解除引用的临时附件')); await waitFor(() => expect(saveCommercialDraft).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(button('保存草稿').disabled).toBe(false));
    expect(snapshot().dossier.attachmentRefs).toEqual(before.attachmentRefs);
    expect(snapshot().dossier.agreements[0].versions).toEqual(before.agreements[0].versions);
    expect(snapshot().dossier.signatureReports).toEqual(before.signatureReports);
    expect(await snapshot().originals[attachmentId].text()).toBe(pdfBytes);
  });

  it('rejects a file whose metadata says PDF but whose bytes are not a PDF, preserving the draft', async () => {
    setup(); await beginCustomer(); change('约定名称', '不被坏文件抹除'); change('本次录入人', '演练录入人'); openSection(/原件与来源/);
    chooseFile('添加草稿原件', new File(['this is not a PDF'], '伪声明.pdf', { type: 'application/pdf' }));
    await screen.findByRole('alert');
    expect((screen.getByLabelText('约定名称') as HTMLInputElement).value).toBe('不被坏文件抹除');
    expect(screen.queryByRole('checkbox', { name: '使用文件 伪声明.pdf' })).toBeNull(); expect(saveCommercialDraft).not.toHaveBeenCalled();
  });

  it('stops a failed full package encode without downloading a ledger-only substitute', async () => {
    stored = await localHistory(); const before = commercialDossierSchema.parse(snapshot().dossier);
    vi.mocked(serializeCommercialBackup).mockRejectedValueOnce(new Error('local-file bytes cannot be read'));
    setup(); await ready(); fireEvent.click(button('导出商务原件包')); await screen.findByRole('alert');
    expect(serializeCommercialBackup).toHaveBeenCalledOnce(); expect(downloadTextFile).not.toHaveBeenCalled(); expect(clicked).not.toHaveBeenCalled();
    expect(snapshot().dossier).toEqual(before);
  });

  it('clears a previously confirmed preview before inspecting a different broken package', async () => {
    stored = history(); const before = commercialDossierSchema.parse(snapshot().dossier);
    vi.mocked(preflightCommercialBackupJson).mockResolvedValueOnce({ status: 'present', projectId, id: 'first-preview', generatedAt: recordedAt, value: snapshot() })
      .mockRejectedValueOnce(new Error('新文件损坏'));
    setup(); await ready(); chooseFile('选择商务包', new File(['first'], '第一包.json', { type: 'application/json' }));
    await waitFor(() => expect(screen.getByRole('checkbox', { name: '确认恢复' })).toBeTruthy());
    fireEvent.click(screen.getByRole('checkbox', { name: '确认恢复' })); expect(button('确认恢复商务资料').disabled).toBe(false);
    chooseFile('选择商务包', new File(['broken'], '损坏包.json', { type: 'application/json' })); await screen.findByRole('alert');
    expect(screen.queryByRole('button', { name: '确认恢复商务资料' })).toBeNull(); expect(restoreCommercialBackupJson).not.toHaveBeenCalled();
    expect(snapshot().dossier).toEqual(before);
  });

  it('does not confirm a committed restore until explicit fresh read contains the full incoming immutable history', async () => {
    stored = present(); const incoming = history();
    vi.mocked(preflightCommercialBackupJson).mockResolvedValueOnce({ status: 'present', projectId, id: 'uncertain-restore', generatedAt: recordedAt, value: incoming.value });
    vi.mocked(restoreCommercialBackupJson).mockRejectedValueOnce(new CommercialReadbackError());
    const ui = setup(); await ready(); chooseFile('选择商务包', new File(['uncertain'], '商务包.json', { type: 'application/json' }));
    await waitFor(() => expect(screen.getByRole('checkbox', { name: '确认恢复' })).toBeTruthy()); fireEvent.click(screen.getByRole('checkbox', { name: '确认恢复' }));
    fireEvent.click(button('确认恢复商务资料')); await screen.findByRole('alert');
    await expect(ui.ref.current!.flush()).rejects.toThrow(); expect(restoreCommercialBackupJson).toHaveBeenCalledOnce();
    fireEvent.click(button('重新读取核对')); await waitFor(() => expect(button('重新读取核对').disabled).toBe(false));
    expect(button('确认恢复商务资料').disabled).toBe(true); await expect(ui.ref.current!.flush()).rejects.toThrow();
    stored = incoming; fireEvent.click(button('重新读取核对')); await ready();
    await waitFor(() => expect(screen.queryByRole('button', { name: '确认恢复商务资料' })).toBeNull());
    await expect(ui.ref.current!.flush()).resolves.toBeUndefined(); expect(restoreCommercialBackupJson).toHaveBeenCalledOnce();
    expect(snapshot().dossier.agreements[0].versions[0].id).toBe(versionId);
  });

  it('stops before storage read if the required synchronous context guard rejects or returns a promise', async () => {
    const ui = setup({ guard: () => { throw new Error('身份失效'); } }); await screen.findByRole('alert');
    expect(readCommercialSnapshot).not.toHaveBeenCalled();
    ui.update({ identity: { mode: 'local', projectId, epoch: 2 }, guard: async () => {} });
    await screen.findByRole('alert'); expect(readCommercialSnapshot).not.toHaveBeenCalled(); expect(saveCommercialDraft).not.toHaveBeenCalled();
  });

  it.each([
    { name: '原始图片.png', actualMime: 'image/png', declaredMime: 'application/pdf', bytes: Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aSAAAAABJRU5ErkJggg=='), value => value.charCodeAt(0)) },
    { name: '原始图片.jpeg', actualMime: 'image/jpeg', declaredMime: 'image/jpeg', bytes: Uint8Array.of(255, 216, 255, 192, 0, 11, 8, 0, 1, 0, 1, 1, 1, 17, 0, 255, 217) },
  ])('preserves $name bytes and determines the actual format instead of trusting its declared MIME', async sample => {
    setup(); await beginCustomer(); change('本次录入人', '演练录入人'); openSection(/原件与来源/);
    chooseFile('添加草稿原件', new File([sample.bytes], sample.name, { type: sample.declaredMime }));
    await waitFor(() => expect(prepareCommercialOriginal).toHaveBeenCalledOnce()); await waitFor(() => expect(button('保存草稿').disabled).toBe(false));
    await save(); const original = vi.mocked(saveCommercialDraft).mock.calls[0][1].originals![0];
    expect(original.attachment.mimeType).toBe(sample.actualMime); expect(original.attachment.fileName).toBe(sample.name);
    expect(new Uint8Array(await original.blob.arrayBuffer())).toEqual(sample.bytes);
  });

  it('treats an unregistered source URL as pending input, blocks switching agreements and releases only on explicit source abandonment', async () => {
    const supplier = savedDraft({ title: '另一份供应演练' }); supplier.id = '10000000-0000-4000-8000-000000000002'; supplier.direction = 'supplier_engagement';
    supplier.draft!.id = '20000000-0000-4000-8000-000000000002'; supplier.draft!.draftToken = 'supplier-token';
    stored = present([savedDraft(), supplier]); const ui = setup(); await ready();
    fireEvent.click(within(screen.getByRole('region', { name: '客户委托' })).getByRole('button', { name: '编辑已存草稿' }));
    openSection(/原件与来源/); openSection(/登记外链或缺失来源/); change('外部来源地址', 'https://example.org/unregistered-rehearsal');
    await expect(ui.ref.current!.flush()).rejects.toThrow(); await expect(flushSourceScope(projectId)).rejects.toThrow();
    fireEvent.click(within(screen.getByRole('region', { name: '供应外包' })).getByRole('button', { name: '编辑已存草稿' }));
    expect((screen.getByLabelText('约定名称') as HTMLInputElement).value).toBe('已存客户演练');
    expect((screen.getByLabelText('外部来源地址') as HTMLInputElement).value).toBe('https://example.org/unregistered-rehearsal');
    fireEvent.click(button('保存草稿')); expect(saveCommercialDraft).not.toHaveBeenCalled();
    fireEvent.click(button('放弃来源输入')); await expect(ui.ref.current!.flush()).resolves.toBeUndefined(); await expect(flushSourceScope(projectId)).resolves.toBeUndefined();
    expect(saveCommercialDraft).not.toHaveBeenCalled(); expect(freezeCommercialVersion).not.toHaveBeenCalled(); expect(discardCommercialDraft).not.toHaveBeenCalled();
    expect(snapshot().dossier.attachmentRefs).toEqual([]);
  });

  it('treats an unconsumed fixing note as pending input and keeps it with its agreement until explicitly abandoned', async () => {
    const supplier = savedDraft({ title: '另一份供应演练' }); supplier.id = '10000000-0000-4000-8000-000000000002'; supplier.direction = 'supplier_engagement';
    supplier.draft!.id = '20000000-0000-4000-8000-000000000002'; supplier.draft!.draftToken = 'supplier-token';
    stored = present([savedDraft(), supplier]); const ui = setup(); await ready();
    fireEvent.click(within(screen.getByRole('region', { name: '客户委托' })).getByRole('button', { name: '编辑已存草稿' }));
    change('固定说明', '尚未固定的演练说明');
    await expect(ui.ref.current!.flush()).rejects.toThrow(); await expect(flushSourceScope(projectId)).rejects.toThrow();
    fireEvent.click(within(screen.getByRole('region', { name: '供应外包' })).getByRole('button', { name: '编辑已存草稿' }));
    expect((screen.getByLabelText('约定名称') as HTMLInputElement).value).toBe('已存客户演练');
    expect((screen.getByLabelText('固定说明') as HTMLTextAreaElement).value).toBe('尚未固定的演练说明');
    fireEvent.click(button('放弃固定说明')); await expect(ui.ref.current!.flush()).resolves.toBeUndefined(); await expect(flushSourceScope(projectId)).resolves.toBeUndefined();
    expect(saveCommercialDraft).not.toHaveBeenCalled(); expect(freezeCommercialVersion).not.toHaveBeenCalled(); expect(discardCommercialDraft).not.toHaveBeenCalled();
  });

  it('rejects a package above the frozen 64 MiB limit before reading its text or preflighting it', async () => {
    stored = history(); const before = commercialDossierSchema.parse(snapshot().dossier);
    const oversized = new File(['not-read'], '过大商务包.json', { type: 'application/json' });
    Object.defineProperty(oversized, 'size', { value: MAX_COMMERCIAL_BACKUP_BYTES + 1 }); const text = vi.spyOn(oversized, 'text');
    setup(); await ready(); chooseFile('选择商务包', oversized); await screen.findByRole('alert');
    expect(text).not.toHaveBeenCalled(); expect(preflightCommercialBackupJson).not.toHaveBeenCalled(); expect(readCommercialSnapshot).toHaveBeenCalledTimes(1);
    expect(restoreCommercialBackupJson).not.toHaveBeenCalled(); expect(snapshot().dossier).toEqual(before);
  });
});
