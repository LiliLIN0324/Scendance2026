'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { MAX_COMMERCIAL_BACKUP_BYTES, preflightCommercialBackupJson, restoreCommercialBackupJson, serializeCommercialBackup, type CommercialRestoreCandidate } from '@/lib/commercial-dossier-backup';
import {
  appendCommercialSignatureReport, CommercialReadbackError, discardCommercialDraft, freezeCommercialVersion,
  prepareCommercialOriginal, readCommercialSnapshot, saveCommercialDraft, verifyCommercialOriginal,
  type CommercialContextGuard, type CommercialRead, type PreparedCommercialOriginal,
} from '@/lib/commercial-dossier-storage';
import { formatMoneyMinor, parseMoneyMinor, productionReferenceKey } from '@/lib/production-plan';
import { registerSourceFlush } from '@/lib/source-storage';
import {
  commercialAttachmentSchema, commercialContentSchema, commercialDossierLimits, commercialPaymentPlanNodeSchema,
  commercialSignatureReportSchema, mergeCommercialDossiers, projectCommercialSignatures,
  type CommercialAgreement, type CommercialAttachment, type CommercialContent, type CommercialDossier, type CommercialSignatureReport, type CommercialVersion,
} from '../../../../supabase/functions/_shared/commercial-dossier-contract';
import { canonical } from '../../../../supabase/functions/_shared/domain';
import { downloadTextFile } from '../lib/plan-export/download';
import type { RoomLayout } from '../lib/types';
import './commercial-dossier-panel.css';

export interface CommercialDossierPanelProps {
  identity: { mode: 'local' | 'cloud'; projectId: string | null; epoch: number };
  flushScope: string; layout: RoomLayout; guard: CommercialContextGuard; disabled?: boolean;
  onStateChange?(state: { dirty: boolean; busy: boolean; needsReadback: boolean }): void;
}
export interface CommercialDossierPanelHandle { flush(): Promise<void> }
type Editor = {
  agreementId: string; direction: CommercialAgreement['direction']; draftId: string; draftToken: string | null;
  basedOnVersionId?: string; content: CommercialContent; money: Record<string, string>;
  refs: CommercialAttachment[]; files: PreparedCommercialOriginal[];
};
type ReportEditor = {
  id: string; agreementId: string; versionId: string; kind: CommercialSignatureReport['kind']; targetId?: string;
  observedParties: ('our' | 'counterparty')[]; signedOn: string; evidenceNote: string; reason: string; attachmentIds: string[];
  refs: CommercialAttachment[]; files: PreparedCommercialOriginal[];
};
type SourceInput = { state: 'external-reference' | 'missing'; name: string; url: string; purpose: CommercialAttachment['purpose']; label: string };
type Ticket = { id: number; generation: number; projectId: string };
type Work = 'read' | 'save' | 'file' | 'download' | 'freeze' | 'report' | 'delete' | 'export' | 'preflight' | 'restore';
type Recovery = { kind: 'save' | 'freeze' | 'report' | 'delete' | 'restore'; agreementId?: string; id?: string; expected?: unknown };
const directionNames = { customer_commission: '客户委托', supplier_engagement: '供应外包' };
const kindNames = { unspecified: '资料性质未标注', rehearsal: '演练资料', real: '真实资料标识' };
const purposeNames = { agreement: '约定原件', quotation: '报价文件', signature_evidence: '人工报告依据', supporting: '补充资料' };
const workNames = { preparing: '准备中', awaiting_counterparty: '待对方核对', archived: '归档' };
const key = productionReferenceKey;
const recordedTime = (value: string) => new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
const freshSource = (): SourceInput => ({ state: 'external-reference', name: '', url: '', purpose: 'agreement', label: '' });
const moneyInputs = (content: CommercialContent) => Object.fromEntries([['file', formatMoneyMinor(content.fileAmount.amountMinor)],
  ...content.paymentPlanNodes.map(node => [node.id, formatMoneyMinor(node.amount.amountMinor)])]);
function editorFor(agreement: CommercialAgreement, version?: CommercialVersion): Editor {
  const draft = version ? null : agreement.draft;
  const content = commercialContentSchema.parse(version?.content ?? draft?.content ?? {});
  const previous = version?.id ?? draft?.basedOnVersionId;
  return { agreementId: agreement.id, direction: agreement.direction, draftId: draft?.id ?? crypto.randomUUID(),
    draftToken: draft?.draftToken ?? null, ...(previous ? { basedOnVersionId: previous } : {}), content,
    money: moneyInputs(content), refs: [], files: [] };
}
function converted(edit: Editor): CommercialContent {
  return commercialContentSchema.parse({ ...edit.content,
    fileAmount: { ...edit.content.fileAmount, amountMinor: parseMoneyMinor(edit.money.file ?? '') },
    paymentPlanNodes: edit.content.paymentPlanNodes.map(node => ({ ...node, amount: { ...node.amount, amountMinor: parseMoneyMinor(edit.money[node.id] ?? '') } })),
  });
}
function safeMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && /[\u4e00-\u9fff]/.test(error.message) && error.message.length < 220 &&
    !/[{}\[\]\n]|token|sha256|UUID|Promise/i.test(error.message)) return error.message;
  return fallback;
}
function downloadOriginal(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  try { const link = document.createElement('a'); link.href = url; link.download = name; link.click(); }
  finally { setTimeout(() => URL.revokeObjectURL(url), 0); }
}
function Field({ label, value, onChange, multiline = false, type = 'text', limit = commercialDossierLimits.note, disabled = false }: {
  label: string; value: string; onChange(value: string): void; multiline?: boolean; type?: string; limit?: number; disabled?: boolean;
}): JSX.Element {
  return <label className="sc-field">{label}{multiline ? <textarea disabled={disabled} value={value} maxLength={limit} onChange={event => onChange(event.currentTarget.value)}/> :
    <input disabled={disabled} type={type} value={value} maxLength={limit} onChange={event => onChange(event.currentTarget.value)}/>}</label>;
}
function References({ label, selected, options, onChange, disabled }: {
  label: string; selected: string[]; options: { id: string; label: string }[]; onChange(ids: string[]): void; disabled: boolean;
}): JSX.Element {
  const groups = new Map<string, { id: string; labels: string[] }>();
  for (const option of options) { const found = groups.get(key(option.id)); if (found) found.labels.push(option.label); else groups.set(key(option.id), { id: option.id, labels: [option.label] }); }
  for (const id of selected) if (!groups.has(key(id))) groups.set(key(id), { id, labels: [] });
  return <fieldset className="sc-commercial-reference-list" disabled={disabled}><legend>{label}</legend>
    {!groups.size && <p className="sc-commercial-subtle">尚无可关联资料，可独立登记约定。</p>}
    {[...groups].map(([normal, option]) => <label key={normal}><input type="checkbox" checked={selected.some(id => key(id) === normal)} onChange={event => {
      if (disabled) return; onChange(event.currentTarget.checked ? [...selected, option.id] : selected.filter(id => key(id) !== normal));
    }}/>{option.labels.length === 1 ? option.labels[0] : option.labels.length ? '同编号资料不唯一，需核对' : '原关联未找到，保留待核'}
      {option.labels.length !== 1 && <small>（原编号 {option.id}）</small>}</label>)}
  </fieldset>;
}

export const CommercialDossierPanel = forwardRef<CommercialDossierPanelHandle, CommercialDossierPanelProps>(function CommercialDossierPanel(props, ref) {
  const latest = useRef(props); latest.current = props;
  const identityKey = canonical([props.identity, props.flushScope]);
  const context = useRef({ key: identityKey, generation: 0 });
  if (context.current.key !== identityKey) context.current = { key: identityKey, generation: context.current.generation + 1 };
  const generation = context.current.generation;
  const viewGeneration = useRef(generation), readyGeneration = useRef(-1);
  const mounted = useRef(true), sequence = useRef(0), operation = useRef<{ ticket: Ticket; kind: Work } | null>(null);
  const [loaded, setLoaded] = useState<{ generation: number; read: CommercialRead } | null>(null);
  const loadedRef = useRef<CommercialRead | null>(null);
  const [readState, setReadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const readStateRef = useRef(readState); readStateRef.current = readState;
  const [editor, setEditor] = useState<Editor | null>(null), editorRef = useRef<Editor | null>(null), baseline = useRef<Editor | null>(null);
  const [report, setReport] = useState<ReportEditor | null>(null), reportRef = useRef<ReportEditor | null>(null);
  const [selected, setSelected] = useState<string | null>(null), [dirtyEditor, setDirtyEditor] = useState(false), dirtyEditorRef = useRef(false);
  const [dirtyReport, setDirtyReport] = useState(false), dirtyReportRef = useRef(false);
  const [busy, setBusy] = useState<Work | null>(null), [recovery, setRecovery] = useState<Recovery | null>(null), recoveryRef = useRef<Recovery | null>(null);
  const [recoveryRead, setRecoveryRead] = useState<CommercialRead | null>(null);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [recorder, setRecorder] = useState(''), recorderRef = useRef(''); recorderRef.current = recorder;
  const [dataKind, setDataKind] = useState<CommercialDossier['dataKind']>('unspecified');
  const [fixingNote, setFixingNote] = useState(''), fixingNoteRef = useRef('');
  const [sourceInput, setSourceInput] = useState<SourceInput>(freshSource), [deleteConfirm, setDeleteConfirm] = useState(false);
  const sourceInputRef = useRef<SourceInput>(freshSource());
  const [preview, setPreview] = useState<{ text: string; candidate: CommercialRestoreCandidate; target: CommercialRead } | null>(null), previewRef = useRef<typeof preview>(null);
  const [restoreConfirm, setRestoreConfirm] = useState(false);
  function eligible(): boolean {
    const value = latest.current;
    return value.identity.mode === 'local' && !!value.identity.projectId?.trim() && value.layout.id === value.identity.projectId;
  }
  function current(ticket: Ticket): boolean {
    return mounted.current && context.current.generation === ticket.generation && latest.current.identity.mode === 'local' &&
      latest.current.identity.projectId === ticket.projectId && operation.current?.ticket.id === ticket.id;
  }
  function checkedGuard(ticket: Ticket): void {
    if (!current(ticket) || !eligible()) throw new Error('本机活动身份已变化，本次操作已停止。');
    const result = (latest.current.guard as () => unknown)();
    if (result && typeof (result as { then?: unknown }).then === 'function') throw new Error('当前身份未能核对，请重新读取。');
  }
  function editable(): boolean { return eligible() && readyGeneration.current === context.current.generation && !latest.current.disabled && !operation.current && !recoveryRef.current && readStateRef.current === 'ready'; }
  function assignEditor(value: Editor | null, dirty = false): void {
    editorRef.current = value; setEditor(value); dirtyEditorRef.current = dirty; setDirtyEditor(dirty); setDeleteConfirm(false);
  }
  function assignReport(value: ReportEditor | null, dirty = false): void { reportRef.current = value; setReport(value); dirtyReportRef.current = dirty; setDirtyReport(dirty); }
  function assignSource(value: SourceInput): void { sourceInputRef.current = value; setSourceInput(value); }
  function changeSource(update: (value: SourceInput) => SourceInput): void { if (editable() && previewRef.current?.candidate.status !== 'present') assignSource(update(sourceInputRef.current)); }
  function assignFixingNote(value: string): void { fixingNoteRef.current = value; setFixingNote(value); }
  function pendingSource(): boolean { const value = sourceInputRef.current; return !!(value.name.trim() || value.url.trim() || value.label.trim()); }
  function pendingAuxiliary(): boolean { return pendingSource() || !!fixingNoteRef.current.trim(); }
  function markRecovery(value: Recovery | null): void { recoveryRef.current = value; setRecovery(value); setRecoveryRead(null); }
  function adopt(read: CommercialRead): void {
    readyGeneration.current = context.current.generation;
    loadedRef.current = read; setLoaded({ generation, read }); setReadState('ready'); readStateRef.current = 'ready';
    if (read.status === 'present') setDataKind(read.value.dossier.dataKind);
  }
  async function run(kind: Work, action: (ticket: Ticket) => Promise<void>, fallback: string, attempt?: Recovery): Promise<boolean> {
    if (!eligible() || operation.current || kind !== 'read' && (latest.current.disabled || recoveryRef.current)) return false;
    const ticket = { id: ++sequence.current, generation: context.current.generation, projectId: latest.current.identity.projectId! };
    operation.current = { ticket, kind }; setBusy(kind); setError(''); setNotice('');
    try { checkedGuard(ticket); await action(ticket); checkedGuard(ticket); return true; }
    catch (caught) {
      if (current(ticket)) {
        if (caught instanceof CommercialReadbackError || !!(caught && typeof caught === 'object' && 'committed' in caught && caught.committed === true)) {
          markRecovery(attempt ?? { kind: 'restore' }); setError('资料已提交，但尚未确认读回。当前输入已保留，请重新读取核对，勿重复固定或报告。');
        } else setError(safeMessage(caught, fallback));
        if (kind === 'read') { setReadState('error'); readStateRef.current = 'error'; }
      }
      return false;
    } finally { if (current(ticket)) { operation.current = null; setBusy(null); } }
  }
  function flush(): Promise<void> {
    if (!eligible()) return Promise.resolve();
    if (operation.current || readStateRef.current !== 'ready') return Promise.reject(new Error('商务资料正在处理或尚未读取，请完成核对后再切换或备份。'));
    if (dirtyEditorRef.current || dirtyReportRef.current || pendingAuxiliary() || previewRef.current?.candidate.status === 'present') return Promise.reject(new Error('商务资料有未保存修改，请先保存、放弃修改或取消包预检。'));
    if (recoveryRef.current) return Promise.reject(new Error('商务资料已提交但尚未确认，请先重新读取核对。'));
    return Promise.resolve();
  }
  useImperativeHandle(ref, () => ({ flush }));
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; operation.current = null; }; }, []);
  useEffect(() => {
    viewGeneration.current = generation; readyGeneration.current = -1;
    operation.current = null; loadedRef.current = null; readStateRef.current = 'loading'; editorRef.current = null; reportRef.current = null; baseline.current = null;
    dirtyEditorRef.current = false; dirtyReportRef.current = false; recoveryRef.current = null; previewRef.current = null;
    setLoaded(null); setEditor(null); setReport(null); setSelected(null); setDirtyEditor(false); setDirtyReport(false); setRecovery(null); setRecoveryRead(null);
    setBusy(null); setError(''); setNotice(''); setPreview(null); setRestoreConfirm(false); setDeleteConfirm(false); setReadState('loading'); setRecorder(''); assignFixingNote(''); assignSource(freshSource()); setDataKind('unspecified');
    if (eligible()) void run('read', async ticket => { const read = await readCommercialSnapshot(ticket.projectId, () => checkedGuard(ticket)); checkedGuard(ticket); adopt(read); }, '本机商务资料未能读取，请重新读取核对。');
    // Identity is intentionally independent of geometry, task text and active design revision.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generation]);
  useEffect(() => {
    if (!eligible()) return;
    return registerSourceFlush(props.flushScope, async () => { if (context.current.generation === generation) await flush(); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.flushScope, generation]);
  const auxiliaryDirty = !!(sourceInput.name.trim() || sourceInput.url.trim() || sourceInput.label.trim() || fixingNote.trim());
  useEffect(() => { latest.current.onStateChange?.({ dirty: dirtyEditor || dirtyReport || auxiliaryDirty || preview?.candidate.status === 'present', busy: busy !== null, needsReadback: recovery !== null }); }, [dirtyEditor, dirtyReport, auxiliaryDirty, preview, busy, recovery, generation]);

  const read = loaded?.generation === generation ? loaded.read : null;
  const dossier = read?.status === 'present' ? read.value.dossier : null;
  const agreements = dossier?.agreements ?? [], agreement = agreements.find(row => key(row.id) === key(selected ?? ''));
  const shownEditor = loaded?.generation === generation ? editor : null, shownReport = loaded?.generation === generation ? report : null;
  const blocked = !!props.disabled || busy !== null || recovery !== null || readState !== 'ready' || !eligible() || readyGeneration.current !== generation;
  const formBlocked = blocked || preview?.candidate.status === 'present';
  function choose(agreementId: string): void {
    if (!editable()) return;
    if (dirtyEditorRef.current || dirtyReportRef.current || pendingAuxiliary()) { setError('请先保存、登记或放弃未保存输入，再选择其他约定。'); return; }
    const found = agreements.find(row => key(row.id) === key(agreementId)); if (!found) return;
    setSelected(found.id); const edit = found.draft ? editorFor(found) : null; baseline.current = edit ? structuredClone(edit) : null; assignEditor(edit); assignReport(null); assignSource(freshSource()); assignFixingNote(''); setNotice('');
  }
  function newAgreement(direction: CommercialAgreement['direction']): void {
    if (!editable() || previewRef.current?.candidate.status === 'present') return;
    if (dirtyEditorRef.current || dirtyReportRef.current || pendingAuxiliary()) { setError('请先保存、登记或放弃未保存输入，再新建约定。'); return; }
    const edit = editorFor({ id: crypto.randomUUID(), direction, draft: null, versions: [] }); baseline.current = null; setSelected(edit.agreementId); assignEditor(edit, true); assignReport(null); assignSource(freshSource()); assignFixingNote(''); setError('');
  }
  function changeEdit(update: (value: Editor) => Editor): void {
    if (!editable() || previewRef.current?.candidate.status === 'present' || !editorRef.current) return;
    assignEditor(update(editorRef.current), true); setError('');
  }
  function changeContent(update: (value: CommercialContent) => CommercialContent): void { changeEdit(edit => ({ ...edit, content: update(edit.content) })); }
  function changeReport(update: (value: ReportEditor) => ReportEditor): void {
    if (!editable() || previewRef.current?.candidate.status === 'present' || !reportRef.current) return;
    assignReport(update(reportRef.current), true); setError('');
  }
  function abandon(): void {
    if (!editable()) return;
    assignEditor(baseline.current ? structuredClone(baseline.current) : null); assignReport(null); assignSource(freshSource()); assignFixingNote(''); setError(''); setNotice('未保存修改已放弃；已存草稿和历史仍保留。');
  }
  function acceptWrite(readback: CommercialRead, keepEditor = true): void {
    adopt(readback);
    const found = readback.status === 'present' ? readback.value.dossier.agreements.find(row => key(row.id) === key(editorRef.current?.agreementId ?? selected ?? '')) : undefined;
    const edit = keepEditor && found?.draft ? editorFor(found) : null; baseline.current = edit ? structuredClone(edit) : null; assignEditor(edit);
  }
  async function save(): Promise<boolean> {
    const edit = editorRef.current;
    if (!editable() || !edit || previewRef.current?.candidate.status === 'present') return false;
    if (pendingSource()) { setError('来源输入尚未登记，请先登记或放弃来源输入。'); return false; }
    let content: CommercialContent;
    try { content = converted(edit); } catch (caught) { setError(safeMessage(caught, '请核对金额、币种和依据；已填内容保留。')); return false; }
    const attempt: Recovery = { kind: 'save', agreementId: edit.agreementId, id: edit.draftId, expected: content };
    return run('save', async ticket => {
      const result = await saveCommercialDraft(ticket.projectId, { agreementId: edit.agreementId, direction: edit.direction, dataKind,
        expectedDraftToken: edit.draftToken, draft: { id: edit.draftId, ...(edit.basedOnVersionId ? { basedOnVersionId: edit.basedOnVersionId } : {}), content },
        attachmentRefs: edit.refs, originals: edit.files }, () => checkedGuard(ticket));
      checkedGuard(ticket); acceptWrite(result); setNotice(fixingNoteRef.current.trim() ? '草稿已保存；固定说明尚未提交，请明确固定或放弃说明。' : '草稿已保存到本机，尚未固定版本。');
    }, '草稿未能保存，请保留输入，重新读取后核对。', attempt);
  }
  function requireClean(replacingPreview = false, fixing = false): boolean {
    if (!editable()) return false;
    if (dirtyEditorRef.current || dirtyReportRef.current) { setError('请先保存或放弃未保存修改。'); return false; }
    if (pendingSource() || !fixing && fixingNoteRef.current.trim()) { setError('请先登记或放弃来源输入，提交或放弃固定说明。'); return false; }
    if (!replacingPreview && previewRef.current?.candidate.status === 'present') { setError('请先恢复或取消当前商务包预检。'); return false; }
    return true;
  }
  async function reload(): Promise<void> {
    if (!eligible() || viewGeneration.current !== context.current.generation || operation.current || props.disabled) return;
    const pending = recoveryRef.current;
    const preserveInput = dirtyEditorRef.current || dirtyReportRef.current || pendingAuxiliary();
    await run('read', async ticket => {
      const result = await readCommercialSnapshot(ticket.projectId, () => checkedGuard(ticket)); checkedGuard(ticket); adopt(result);
      if (pending) {
        setRecoveryRead(result);
        const value = result.status === 'present' ? result.value.dossier : null;
        const target = value?.agreements.find(row => key(row.id) === key(pending.agreementId ?? ''));
        const targetDraft = target?.draft;
        const confirmed = pending.kind === 'save' ? !!targetDraft && targetDraft.id === pending.id && canonical(targetDraft.content) === canonical(pending.expected) :
          pending.kind === 'freeze' ? target?.versions.some(version => key(version.id) === key(pending.id ?? '')) :
          pending.kind === 'report' ? value?.signatureReports.some(item => key(item.id) === key(pending.id ?? '') && canonical(item) === canonical(pending.expected)) :
          pending.kind === 'delete' ? !target?.draft : (() => {
            try { return !!value && canonical(mergeCommercialDossiers(value, pending.expected as CommercialDossier)) === canonical(value); }
            catch { return false; }
          })();
        if (!confirmed) { setError('已重新读取，但本次提交仍未确认。输入与原操作已保留，请核对历史，不要重复提交。'); return; }
        markRecovery(null); assignReport(null); setPreview(null); previewRef.current = null; if (pending.kind === 'freeze') assignFixingNote(''); acceptWrite(result, pending.kind === 'save'); setNotice('已重新读取并核对本次提交。');
      } else if (preserveInput) { setNotice('最新已存资料已读取；本次输入和原编辑基线保留，请核对差异。'); }
      else { acceptWrite(result); assignReport(null); setNotice('已重新读取当前本机商务资料。'); }
    }, '商务资料仍未能读取，请保留当前输入并重试。');
  }
  function startVersion(value: CommercialAgreement, version: CommercialVersion): void {
    if (!requireClean()) return;
    if (value.draft) { setError('已有可编辑草稿，请先继续或明确删除已存草稿。'); return; }
    const edit = editorFor(value, version); baseline.current = null; setSelected(value.id); assignEditor(edit, true); assignReport(null); assignSource(freshSource()); assignFixingNote('');
  }
  async function freeze(): Promise<void> {
    if (!requireClean(false, true) || !editorRef.current?.draftToken) return;
    const edit = editorRef.current;
    if (!recorderRef.current.trim() || !fixingNoteRef.current.trim()) { setError('固定版本前请填写录入人和固定说明。'); return; }
    const metadata = { id: crypto.randomUUID(), recordedAt: new Date().toISOString(), recordedBy: recorderRef.current.trim(), fixingNote: fixingNoteRef.current.trim() };
    await run('freeze', async ticket => { const result = await freezeCommercialVersion(ticket.projectId, edit.agreementId, edit.draftToken!, metadata, () => checkedGuard(ticket));
      checkedGuard(ticket); acceptWrite(result, false); assignFixingNote(''); setNotice('当前版本已固定；这不表示已发送、已签署或生效。');
    }, '固定前请核对名称、原件引用和待确认说明。', { kind: 'freeze', agreementId: edit.agreementId, id: metadata.id });
  }
  async function removeSavedDraft(): Promise<void> {
    if (!requireClean() || !deleteConfirm || !editorRef.current?.draftToken) return;
    const edit = editorRef.current;
    await run('delete', async ticket => { const result = await discardCommercialDraft(ticket.projectId, edit.agreementId, edit.draftToken!, () => checkedGuard(ticket));
      checkedGuard(ticket); acceptWrite(result, false); setDeleteConfirm(false); setNotice('已存可编辑草稿已删除；固定版本与人工报告仍保留。');
    }, '草稿未能删除，请重新读取核对。', { kind: 'delete', agreementId: edit.agreementId });
  }
  function ownerFiles(owner: 'draft' | 'report'): CommercialAttachment[] {
    const value = owner === 'draft' ? editorRef.current : reportRef.current;
    if (!value) return [];
    return [...(dossier?.attachmentRefs.filter(row => key(row.agreementId) === key(value.agreementId)) ?? []), ...value.refs];
  }
  function stageFile(owner: 'draft' | 'report', attachment: CommercialAttachment, file?: PreparedCommercialOriginal): void {
    if (owner === 'draft') {
      const edit = editorRef.current; if (!edit) return;
      assignEditor({ ...edit, refs: [...edit.refs, attachment], files: file ? [...edit.files, file] : edit.files,
        content: { ...edit.content, documentRefs: [...edit.content.documentRefs, attachment.id] } }, true);
    } else {
      const value = reportRef.current; if (!value) return;
      assignReport({ ...value, refs: [...value.refs, attachment], files: file ? [...value.files, file] : value.files, attachmentIds: [...value.attachmentIds, attachment.id] }, true);
    }
  }
  async function upload(owner: 'draft' | 'report', files: FileList | null): Promise<void> {
    const file = files?.[0], value = owner === 'draft' ? editorRef.current : reportRef.current;
    if (!editable() || previewRef.current?.candidate.status === 'present' || !file || !value) return;
    if (!recorderRef.current.trim()) { setError('添加原件前请填写录入人。'); return; }
    const info = { id: crypto.randomUUID(), agreementId: value.agreementId, fileName: file.name,
      purpose: owner === 'report' ? 'signature_evidence' as const : sourceInputRef.current.purpose, documentLabel: sourceInputRef.current.label,
      sourceUrl: null, recordedAt: new Date().toISOString(), recordedBy: recorderRef.current.trim() };
    await run('file', async ticket => { const prepared = await prepareCommercialOriginal(info, file); checkedGuard(ticket); stageFile(owner, prepared.attachment, prepared); assignSource({ ...sourceInputRef.current, label: '' });
      setNotice('原件字节已核对，将随本次草稿或报告保存。');
    }, '原件未能核对。仅支持PDF、PNG、JPEG，每件不超过10MiB，原文件未转换。');
  }
  function addSource(owner: 'draft' | 'report'): void {
    const value = owner === 'draft' ? editorRef.current : reportRef.current;
    if (!editable() || previewRef.current?.candidate.status === 'present' || !value) return;
    try {
      latest.current.guard();
      const source = sourceInputRef.current;
      const attachment = commercialAttachmentSchema.parse({ id: crypto.randomUUID(), agreementId: value.agreementId,
        fileName: source.name.trim() || null, purpose: owner === 'report' ? 'signature_evidence' : source.purpose, documentLabel: source.label,
        sourceState: source.state, sourceUrl: source.state === 'external-reference' ? source.url : null,
        recordedAt: new Date().toISOString(), recordedBy: recorderRef.current.trim() });
      stageFile(owner, attachment); assignSource({ ...freshSource(), purpose: owner === 'report' ? 'signature_evidence' : 'agreement' }); setError('');
    } catch { setError('请填写录入人；外部来源需完整http或https地址，未知内容可登记为缺失。'); }
  }
  async function download(attachment: CommercialAttachment): Promise<void> {
    if (!editable() || attachment.sourceState !== 'local-file') return;
    await run('download', async ticket => {
      const fresh = await readCommercialSnapshot(ticket.projectId, () => checkedGuard(ticket)); checkedGuard(ticket);
      const actual = fresh.status === 'present' ? fresh.value.dossier.attachmentRefs.find(row => key(row.id) === key(attachment.id)) : undefined;
      const blob = fresh.status === 'present' ? fresh.value.originals[key(attachment.id)] : undefined;
      if (!actual || !blob || canonical(actual) !== canonical(attachment)) throw new Error('本机原件与当前所选记录不一致，请重新读取核对。');
      await verifyCommercialOriginal(actual, blob); checkedGuard(ticket); downloadOriginal(blob, actual.fileName!); setNotice('已发起原件下载，请确认文件已保存。');
    }, '原件未能读取或核对，未发起下载。');
  }
  async function cleanFiles(): Promise<void> {
    if (!requireClean() || !editorRef.current?.draftToken) return;
    const edit = editorRef.current;
    await run('save', async ticket => { const result = await saveCommercialDraft(ticket.projectId, { agreementId: edit.agreementId, direction: edit.direction, dataKind,
      expectedDraftToken: edit.draftToken, draft: { id: edit.draftId, ...(edit.basedOnVersionId ? { basedOnVersionId: edit.basedOnVersionId } : {}), content: converted(edit) }, cleanupUnreferenced: true }, () => checkedGuard(ticket));
      checkedGuard(ticket); acceptWrite(result); setNotice('已清理本约定未引用的临时附件，历史原件保留。');
    }, '临时附件未能清理，请保留资料并重新读取。', { kind: 'save', agreementId: edit.agreementId, id: edit.draftId, expected: converted(edit) });
  }
  function startReport(value: CommercialAgreement, version: CommercialVersion, target?: CommercialSignatureReport, kind: ReportEditor['kind'] = 'reported_signed'): void {
    if (!requireClean()) return;
    const payload = target ? target.kind === 'correction' ? target.replacement : target.kind === 'reported_signed' ? target : null : null;
    setSelected(value.id); assignReport({ id: crypto.randomUUID(), agreementId: value.id, versionId: version.id, kind,
      ...(target ? { targetId: target.id } : {}), observedParties: payload?.observedParties ?? [], signedOn: payload?.signedOn ?? '',
      evidenceNote: '', reason: '', attachmentIds: payload?.attachmentIds ?? [], refs: [], files: [] }); assignSource({ ...freshSource(), purpose: 'signature_evidence' }); assignFixingNote('');
  }
  async function saveReport(): Promise<void> {
    if (!editable() || !reportRef.current) return;
    if (pendingSource()) { setError('来源输入尚未登记，请先登记或放弃来源输入。'); return; }
    const value = reportRef.current;
    let proposal: CommercialSignatureReport;
    try {
      const common = { id: value.id, agreementId: value.agreementId, versionId: value.versionId, recordedAt: new Date().toISOString(), recordedBy: recorderRef.current.trim() };
      const payload = { observedParties: value.observedParties, signedOn: value.signedOn || null, evidenceNote: value.evidenceNote, attachmentIds: value.attachmentIds };
      proposal = commercialSignatureReportSchema.parse(value.kind === 'reported_signed' ? { ...common, kind: value.kind, ...payload } :
        value.kind === 'correction' ? { ...common, kind: value.kind, targetId: value.targetId, reason: value.reason, replacement: payload } :
          { ...common, kind: value.kind, targetId: value.targetId, reason: value.reason, evidenceNote: value.evidenceNote, attachmentIds: value.attachmentIds });
    } catch { setError('请填写录入人、所见方、说明及依据；更正或作废还需原因。发生日期可留空。'); return; }
    await run('report', async ticket => { const result = await appendCommercialSignatureReport(ticket.projectId, proposal, { attachmentRefs: value.refs, originals: value.files }, () => checkedGuard(ticket));
      checkedGuard(ticket); adopt(result); assignReport(null); assignSource(freshSource()); setNotice('人工报告已保存，原历史未改写。');
    }, '人工报告未能保存。请保留输入并核对版本及报告沿革。', { kind: 'report', agreementId: value.agreementId, id: value.id, expected: proposal });
  }
  async function exportPackage(): Promise<void> {
    if (!requireClean() || previewRef.current?.candidate.status === 'present') return;
    const metadata = { id: crypto.randomUUID(), generatedAt: new Date().toISOString() };
    await run('export', async ticket => { const fresh = await readCommercialSnapshot(ticket.projectId, () => checkedGuard(ticket)); checkedGuard(ticket);
      const text = await serializeCommercialBackup(fresh, metadata); checkedGuard(ticket); downloadTextFile(`商务资料_${metadata.id}.json`, 'application/json;charset=utf-8', text);
      setNotice('已发起商务台账与已有原件包下载。外链和缺失来源按清单保留，请确认文件已保存。');
    }, '商务包未能生成。原件读取或核对失败时不会自动改成仅台账包。');
  }
  async function inspectPackage(file: File | undefined): Promise<void> {
    if (!requireClean(true) || !file) return;
    previewRef.current = null; setPreview(null); setRestoreConfirm(false);
    await run('preflight', async ticket => {
      if (file.size > MAX_COMMERCIAL_BACKUP_BYTES) throw new Error('文件超过商务包64MiB上限，未读取；当前资料未改变。');
      const text = await file.text(); checkedGuard(ticket);
      const target = await readCommercialSnapshot(ticket.projectId, () => checkedGuard(ticket)); checkedGuard(ticket);
      const candidate = await preflightCommercialBackupJson(text, ticket.projectId); checkedGuard(ticket);
      const value = { text, candidate, target }; previewRef.current = value; setPreview(value); setRestoreConfirm(false);
      setNotice(candidate.status === 'not-in-file' ? '所选文件不是商务包，不包含商务领域。当前商务资料未改变。' : candidate.status === 'absent' ? '该包明确没有商务记录，不会清空当前资料。' : '预检完成。核对项目和携带范围后，可明确恢复。');
    }, '包预检未通过，当前商务资料未改变。请核对文件、项目和原件。');
  }
  async function restore(): Promise<void> {
    const value = previewRef.current;
    if (!editable() || !restoreConfirm || value?.candidate.status !== 'present' || dirtyEditorRef.current || dirtyReportRef.current) return;
    const tokens: Record<string, string | null> = {};
    for (const row of value.candidate.value.dossier.agreements) if (row.draft) tokens[row.id] = value.target.status === 'present' ? value.target.value.dossier.agreements.find(target => key(target.id) === key(row.id))?.draft?.draftToken ?? null : null;
    await run('restore', async ticket => { const result = await restoreCommercialBackupJson(value.text, ticket.projectId, tokens, () => checkedGuard(ticket)); checkedGuard(ticket);
      adopt(result); assignReport(null); acceptWrite(result); previewRef.current = null; setPreview(null); setRestoreConfirm(false); setNotice('商务包已按同项目合并，既有固定历史保留。');
    }, '商务包未能恢复，原资料及导入候选保留；请核对草稿冲突或历史沿革。', { kind: 'restore', expected: value.candidate.value.dossier });
  }

  return <section className="sc-commercial" aria-label="合同与约定">
    <header className="sc-commercial-heading"><div><h2>合同与约定</h2><p className="sc-commercial-subtle">登记已有资料、保存原件与版本。金额和收付款节点为手工记录，人工报告不代替验签。</p></div></header>
    {!eligible() ? <p className="sc-commercial-warning">请先打开编号明确的本机活动。正式云项目暂不读取本机商务资料。</p> : <>
      <div className="sc-commercial-toolbar"><button type="button" className="sc-button" disabled={!!props.disabled || busy !== null} onClick={() => void reload()}>重新读取核对</button>
        <Field label="本次录入人" value={viewGeneration.current === generation ? recorder : ''} limit={commercialDossierLimits.party} disabled={!!formBlocked} onChange={value => { if (editable() && previewRef.current?.candidate.status !== 'present') setRecorder(value); }}/>
        <label className="sc-field">资料性质<select value={dataKind} disabled={!!formBlocked || read?.status === 'present'} onChange={event => { if (editable() && previewRef.current?.candidate.status !== 'present' && read?.status === 'absent') setDataKind(event.currentTarget.value as typeof dataKind); }}>{Object.entries(kindNames).map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select></label></div>
      {readState === 'loading' && <p role="status">正在读取本机商务资料…</p>}
      {readState === 'ready' && <>
        <div className="sc-commercial-lists">{(['customer_commission', 'supplier_engagement'] as const).map(direction => <section key={direction} aria-label={directionNames[direction]}><h3>{directionNames[direction]}</h3>
          {!agreements.some(row => row.direction === direction) && <p className="sc-commercial-subtle">尚未登记{directionNames[direction]}。</p>}
          {agreements.filter(row => row.direction === direction).map(row => <article className="sc-commercial-agreement" key={row.id}><strong>{row.draft?.content.title || row.versions.at(-1)?.content.title || '未命名约定'}</strong>
            <p>{row.draft ? '已有可编辑草稿' : '无可编辑草稿'} · 固定版本 {row.versions.length} 份</p>
            {(() => { const content = row.draft?.content ?? row.versions.at(-1)?.content; const missing = content ? [!content.ourParty.name.trim() && '我方主体', !content.counterparty.name.trim() && '对方主体', !content.scopeIn.trim() && '范围', !content.documentRefs.length && '原件或来源'].filter(Boolean) : [];
              const node = content?.paymentPlanNodes[0]; return <>{!!missing.length && <p className="sc-commercial-warning">待补：{missing.join('、')}</p>}{node && <p className="sc-commercial-subtle">首条已录计划：{node.label || '名称待填写'} · {node.dueOn || node.triggerNote || '日期或条件待核'}</p>}</>; })()}
            <button type="button" className="sc-button" disabled={blocked} onClick={() => choose(row.id)}>{row.draft ? '编辑已存草稿' : '查看固定历史'}</button></article>)}
          <button type="button" className="sc-button" disabled={formBlocked || agreements.length >= commercialDossierLimits.agreements} onClick={() => newAgreement(direction)}>{direction === 'customer_commission' ? '新建客户委托' : '新建供应约定'}</button></section>)}</div>
        {/* The editor and histories below use the frozen public record, without automatic terms or legal conclusions. */}
        {shownEditor && !shownReport && <form onSubmit={event => { event.preventDefault(); void save(); }} aria-label="约定草稿"><h3>{directionNames[shownEditor.direction]}草稿</h3><fieldset disabled={!!formBlocked}>
          <div className="sc-commercial-grid"><Field label="约定名称" value={shownEditor.content.title} limit={commercialDossierLimits.title} onChange={value => changeContent(content => ({ ...content, title: value }))}/>
            <Field label="原文件编号" value={shownEditor.content.agreementNumber} limit={commercialDossierLimits.title} onChange={value => changeContent(content => ({ ...content, agreementNumber: value }))}/></div>
          <details className="sc-commercial-section" open><summary>双方与范围</summary><div className="sc-commercial-grid">
            {(['ourParty', 'counterparty'] as const).map((field, index) => <div key={field}><Field label={index ? '对方主体' : '我方主体'} value={shownEditor.content[field].name} limit={commercialDossierLimits.party} onChange={value => changeContent(content => ({ ...content, [field]: { ...content[field], name: value } }))}/>
              <Field label={index ? '对方联系人说明' : '我方联系人说明'} value={shownEditor.content[field].contactNote} onChange={value => changeContent(content => ({ ...content, [field]: { ...content[field], contactNote: value } }))}/></div>)}</div>
            {(['scopeIn', 'scopeOut', 'eventNote', 'unconfirmedNote'] as const).map((field, index) => <Field key={field} label={['包含范围', '不含事项', '活动时间地点原文', '待确认说明'][index]!} value={shownEditor.content[field]} multiline onChange={value => changeContent(content => ({ ...content, [field]: value }))}/>)}
          </details>
          {renderMoneyAndPlans(shownEditor)}
          <details className="sc-commercial-section"><summary>原件与来源</summary>{renderFiles('draft')}</details>
          <details className="sc-commercial-section"><summary>关联资料</summary>{renderReferences(shownEditor)}</details>
          <label className="sc-field">资料工作状态<select value={shownEditor.content.workState} onChange={event => changeContent(content => ({ ...content, workState: event.currentTarget.value as CommercialContent['workState'] }))}>{Object.entries(workNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <p className="sc-commercial-subtle">保存草稿不会固定版本或记录签署。归档只整理资料。</p>
          <Field label="固定说明" value={fixingNote} multiline onChange={value => { if (editable() && previewRef.current?.candidate.status !== 'present') assignFixingNote(value); }}/>
          {!!fixingNote.trim() && <button className="sc-button" type="button" onClick={() => { if (editable()) assignFixingNote(''); }}>放弃固定说明</button>}
        </fieldset><div className="sc-commercial-actions"><button className="sc-button" type="submit" disabled={!!formBlocked}>保存草稿</button><button className="sc-button" type="button" disabled={blocked} onClick={abandon}>放弃未保存修改</button>
          <button className="sc-button" type="button" disabled={!!formBlocked || dirtyEditor || dirtyReport || !shownEditor.draftToken} onClick={() => void freeze()}>固定当前版本</button>
          <button className="sc-button" type="button" disabled={!!formBlocked || dirtyEditor || dirtyReport || !shownEditor.draftToken} onClick={() => { if (requireClean()) setDeleteConfirm(true); }}>删除已存草稿</button></div>
          {deleteConfirm && <div className="sc-commercial-confirm" role="group" aria-label="删除草稿确认"><p>仅删除已存可编辑草稿及未被引用的临时原件，固定版本和全部人工报告保留。</p><button type="button" className="sc-button" disabled={blocked} onClick={() => void removeSavedDraft()}>确认删除已存草稿</button><button type="button" className="sc-button" disabled={blocked} onClick={() => setDeleteConfirm(false)}>取消删除</button></div>}
        </form>}
        {agreement && renderHistory(agreement)}
        {shownEditor && agreement?.draft && agreement.draft.draftToken !== shownEditor.draftToken && <details className="sc-commercial-section"><summary>最新已存草稿摘要（本次输入保留）</summary><ContentView content={agreement.draft.content}/></details>}
        {shownReport && renderReport(shownReport)}
        <details className="sc-commercial-section" open><summary>商务原件包</summary><p className="sc-commercial-subtle">内部保存台账与已有原件。外链及缺失来源会标明；场景V1–V4不包含本领域。</p>
          <div className="sc-commercial-actions"><button type="button" className="sc-button" disabled={blocked || dirtyEditor || dirtyReport || preview?.candidate.status === 'present'} onClick={() => void exportPackage()}>导出商务原件包</button>
            <label className="sc-field">选择商务包<input type="file" accept="application/json,.json" aria-label="选择商务包" disabled={blocked || dirtyEditor || dirtyReport} onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; void inspectPackage(file); }}/></label></div>
          {preview && <div className="sc-commercial-confirm" aria-label="商务包预检结果">{preview.candidate.status === 'present' ? <>
            <p>同项目包 · {kindNames[preview.candidate.value.dossier.dataKind]} · {preview.candidate.value.dossier.agreements.length} 份约定</p>
            <p>已有原件 {Object.keys(preview.candidate.value.originals).length} 份；外链 {preview.candidate.value.dossier.attachmentRefs.filter(row => row.sourceState === 'external-reference').length} 份；缺失来源 {preview.candidate.value.dossier.attachmentRefs.filter(row => row.sourceState === 'missing').length} 份。</p>
            <p>仅按同项目合并。固定历史保留；冲突会停止，原资料不清空。</p><label><input type="checkbox" aria-label="确认恢复" checked={restoreConfirm} disabled={blocked} onChange={event => { if (!blocked) setRestoreConfirm(event.currentTarget.checked); }}/>我已核对项目与携带范围，确认恢复商务资料</label>
            <button type="button" className="sc-button" disabled={blocked || !restoreConfirm} onClick={() => void restore()}>确认恢复商务资料</button>
          </> : <p>{preview.candidate.status === 'not-in-file' ? '这不是商务包；文件不含商务领域，当前资料未改变。' : '包中没有商务记录，当前资料不会被清空。'}</p>}
            <button type="button" className="sc-button" disabled={blocked} onClick={() => { if (!editable()) return; previewRef.current = null; setPreview(null); setRestoreConfirm(false); }}>取消预检</button></div>}
        </details>
      </>}
      {busy && <p className="sc-commercial-status" role="status">正在处理，请等待本次操作完成…</p>}
      {viewGeneration.current === generation && error && <p className="sc-commercial-error" role="alert">{error}</p>}{viewGeneration.current === generation && notice && <p className="sc-commercial-status" role="status">{notice}</p>}
      {recovery && readState === 'ready' && recoveryRead && <div className="sc-commercial-confirm"><p>可先查看已重新读取的历史。若本次输入已不适用，可明确采用这些已存资料，停止本次提交核对。</p>
        <button type="button" className="sc-button" disabled={!!props.disabled || busy !== null} onClick={() => {
          if (!eligible() || operation.current || latest.current.disabled) return;
          markRecovery(null); acceptWrite(recoveryRead); assignReport(null); assignSource(freshSource()); assignFixingNote(''); previewRef.current = null; setPreview(null); setRestoreConfirm(false); setError(''); setNotice('已采用重新读取的资料，未重复提交或删除已存记录。');
        }}>放弃本次输入并采用已读资料</button></div>}
    </>}
  </section>;

  function renderMoneyAndPlans(edit: Editor): JSX.Element {
    return <details className="sc-commercial-section"><summary>文件金额与收付款计划</summary><p className="sc-commercial-subtle">只抄录已有依据，不生成报价或实际收付。未知留空；其他币种保留原文待核。</p>
      <div className="sc-commercial-grid"><Field label="文件记载金额（元）" value={edit.money.file ?? ''} onChange={value => changeEdit(editor => ({ ...editor, money: { ...editor.money, file: value } }))}/>
        <label className="sc-field">文件金额币种<select value={edit.content.fileAmount.currency ?? ''} onChange={event => changeContent(content => ({ ...content, fileAmount: { ...content.fileAmount, currency: event.currentTarget.value === 'CNY' ? 'CNY' : null } }))}><option value="">未核对或其他币种</option><option value="CNY">人民币</option></select></label></div>
      <Field label="文件金额依据" value={edit.content.fileAmount.basisNote} multiline onChange={value => changeContent(content => ({ ...content, fileAmount: { ...content.fileAmount, basisNote: value } }))}/>
      <Field label="金额原文" value={edit.content.amountSourceText} multiline onChange={value => changeContent(content => ({ ...content, amountSourceText: value }))}/>
      <label className="sc-field">税费原文口径<select value={edit.content.taxTreatment} onChange={event => changeContent(content => ({ ...content, taxTreatment: event.currentTarget.value as CommercialContent['taxTreatment'] }))}><option value="unknown">未核对</option><option value="inclusive">含税</option><option value="exclusive">未含税</option></select></label>
      {edit.content.paymentPlanNodes.map((node, index) => <fieldset className="sc-commercial-plan-node" aria-label={`计划节点${index + 1}`} key={node.id}><legend>计划节点 {index + 1}</legend>
        <Field label={`节点${index + 1}名称`} value={node.label} limit={commercialDossierLimits.title} onChange={value => changeContent(content => ({ ...content, paymentPlanNodes: content.paymentPlanNodes.map(row => row.id === node.id ? { ...row, label: value } : row) }))}/>
        <label className="sc-field">计划方向<select value={node.direction ?? ''} onChange={event => { const direction = event.currentTarget.value as 'receivable' | 'payable' | ''; changeContent(content => ({ ...content, paymentPlanNodes: content.paymentPlanNodes.map(row => row.id === node.id ? { ...row, direction: direction || null } : row) })); }}><option value="">待核对</option><option value="receivable">应收计划</option><option value="payable">应付计划</option></select></label>
        <Field label={`节点${index + 1}金额（元）`} value={edit.money[node.id] ?? ''} onChange={value => changeEdit(editor => ({ ...editor, money: { ...editor.money, [node.id]: value } }))}/>
        <label className="sc-field">节点币种<select value={node.amount.currency ?? ''} onChange={event => { const currency = event.currentTarget.value === 'CNY' ? 'CNY' : null; changeContent(content => ({ ...content, paymentPlanNodes: content.paymentPlanNodes.map(row => row.id === node.id ? { ...row, amount: { ...row.amount, currency } } : row) })); }}><option value="">未核对或其他币种</option><option value="CNY">人民币</option></select></label>
        <Field label={`节点${index + 1}金额依据`} value={node.amount.basisNote} onChange={value => changeContent(content => ({ ...content, paymentPlanNodes: content.paymentPlanNodes.map(row => row.id === node.id ? { ...row, amount: { ...row.amount, basisNote: value } } : row) }))}/>
        <Field label={`节点${index + 1}计划日期`} value={node.dueOn ?? ''} type="date" onChange={value => changeContent(content => ({ ...content, paymentPlanNodes: content.paymentPlanNodes.map(row => row.id === node.id ? { ...row, dueOn: value || null } : row) }))}/>
        <Field label={`节点${index + 1}触发条件`} value={node.triggerNote} onChange={value => changeContent(content => ({ ...content, paymentPlanNodes: content.paymentPlanNodes.map(row => row.id === node.id ? { ...row, triggerNote: value } : row) }))}/>
        <button type="button" className="sc-button" onClick={() => changeContent(content => ({ ...content, paymentPlanNodes: content.paymentPlanNodes.filter(row => row.id !== node.id) }))}>移除节点{index + 1}</button>
      </fieldset>)}<button type="button" className="sc-button" disabled={!!formBlocked || edit.content.paymentPlanNodes.length >= commercialDossierLimits.paymentNodes} onClick={() => changeContent(content => ({ ...content, paymentPlanNodes: [...content.paymentPlanNodes, commercialPaymentPlanNodeSchema.parse({ id: crypto.randomUUID() })] }))}>添加计划节点</button>
    </details>;
  }
  function renderReferences(edit: Editor): JSX.Element {
    const options = {
      taskIds: props.layout.eventOperations?.tasks.map(row => ({ id: row.id, label: row.title })) ?? [],
      objectIds: props.layout.floors.flatMap(floor => floor.items.map(row => ({ id: row.id, label: `${floor.name} · ${row.name}` }))),
      acquisitionIds: props.layout.productionPlan?.acquisitions.map(row => ({ id: row.id, label: row.title || '未命名取得资料' })) ?? [],
      staffingIds: props.layout.productionPlan?.staffing.map(row => ({ id: row.id, label: row.roleName || '未命名岗位' })) ?? [],
    };
    return <>{(['taskIds', 'objectIds', 'acquisitionIds', 'staffingIds'] as const).map((field, index) => <References key={field} label={['关联活动任务', '关联场景物件', '关联取得资料', '关联岗位'][index]!}
      selected={edit.content.references[field]} options={options[field]} disabled={!!formBlocked} onChange={ids => changeContent(content => ({ ...content, references: { ...content.references, [field]: ids } }))}/>)}
      <label className="sc-field">关联方案版本<select value={edit.content.references.designVariantId ?? ''} onChange={event => { const id = event.currentTarget.value; changeContent(content => { const references = { ...content.references }; if (id) references.designVariantId = id; else delete references.designVariantId; return { ...content, references }; }); }}><option value="">未关联</option>
        {props.layout.designBook?.variants.map(row => <option value={row.id} key={row.id}>{row.name}</option>)}
        {edit.content.references.designVariantId && !props.layout.designBook?.variants.some(row => key(row.id) === key(edit.content.references.designVariantId!)) && <option value={edit.content.references.designVariantId}>原方案未找到，保留待核</option>}</select></label>
      <p className="sc-commercial-subtle">只关联确切资料；删除或变更的原关联保留待核，不按名称重新挂接。</p></>;
  }
  function renderFiles(owner: 'draft' | 'report'): JSX.Element {
    const value = owner === 'draft' ? shownEditor : shownReport;
    if (!value) return <></>;
    const files = ownerFiles(owner), selectedFiles = owner === 'draft' ? (value as Editor).content.documentRefs : (value as ReportEditor).attachmentIds;
    return <><p className="sc-commercial-subtle">PDF、PNG、JPEG按原字节保存，每件10MiB、项目已有原件合计32MiB。外链不自动读取。</p>
      <label className="sc-field">文件用途<select value={sourceInput.purpose} disabled={owner === 'report'} onChange={event => { const purpose = event.currentTarget.value as SourceInput['purpose']; changeSource(source => ({ ...source, purpose })); }}>{Object.entries(purposeNames).map(([purpose, label]) => <option value={purpose} key={purpose}>{label}</option>)}</select></label>
      <Field label="文件版本标识" value={sourceInput.label} limit={commercialDossierLimits.title} onChange={label => changeSource(source => ({ ...source, label }))}/>
      <label className="sc-field">添加{owner === 'draft' ? '草稿' : '报告'}原件<input type="file" accept="application/pdf,image/png,image/jpeg" aria-label={owner === 'draft' ? '添加草稿原件' : '添加报告原件'} disabled={!!formBlocked || !recorder.trim()} onChange={event => { const files = event.currentTarget.files; void upload(owner, files); event.currentTarget.value = ''; }}/></label>
      <details><summary>登记外链或缺失来源</summary><label className="sc-field">来源状态<select value={sourceInput.state} onChange={event => { const state = event.currentTarget.value as SourceInput['state']; changeSource(source => ({ ...source, state })); }}><option value="external-reference">仅外部来源</option><option value="missing">原件缺失或未取得</option></select></label>
        <Field label="来源文件名（可未知）" value={sourceInput.name} limit={commercialDossierLimits.fileName} onChange={name => changeSource(source => ({ ...source, name }))}/>
        {sourceInput.state === 'external-reference' && <Field label="外部来源地址" value={sourceInput.url} onChange={url => changeSource(source => ({ ...source, url }))}/>}<button type="button" className="sc-button" onClick={() => addSource(owner)}>登记来源</button>
        <button type="button" className="sc-button" onClick={() => { if (editable()) assignSource(freshSource()); }}>放弃来源输入</button></details>
      <div className="sc-commercial-files">{files.map((file, index) => { const staged = value.refs.some(row => key(row.id) === key(file.id)); return <article className="sc-commercial-file" key={file.id}><strong>{file.fileName || file.documentLabel || '未命名来源'}</strong><p>{purposeNames[file.purpose]} · {staged ? '待随本次资料保存' : file.sourceState === 'local-file' ? '本机原件' : file.sourceState === 'external-reference' ? '仅外部来源，原件未携带' : '原件待取得'}</p><p className="sc-commercial-subtle">版本标识：{file.documentLabel || '未填写'}</p>
        <label><input type="checkbox" aria-label={`使用文件 ${file.fileName || file.documentLabel || `未知来源${index + 1}`}`} checked={selectedFiles.some(id => key(id) === key(file.id))} onChange={event => {
          const checked = event.currentTarget.checked;
          if (owner === 'draft') changeContent(content => { const documentRefs = checked ? [...content.documentRefs, file.id] : content.documentRefs.filter(id => key(id) !== key(file.id)); const next = { ...content, documentRefs }; if (next.quoteDocumentId && !documentRefs.some(id => key(id) === key(next.quoteDocumentId!))) delete next.quoteDocumentId; return next; });
          else changeReport(report => ({ ...report, attachmentIds: checked ? [...report.attachmentIds, file.id] : report.attachmentIds.filter(id => key(id) !== key(file.id)) }));
        }}/>用于本次{owner === 'draft' ? '草稿' : '报告'}</label>
        {!staged && file.sourceState === 'local-file' && <button type="button" className="sc-button" onClick={() => void download(file)} disabled={blocked}>下载原件</button>}
        <details><summary>原编号与摘要</summary><p>{file.documentLabel || '文件版本标识未填写'} · {file.id}</p><p>{file.mimeType || '格式未知'} · {file.byteSize === null ? '长度未知' : `${file.byteSize} 字节`}</p><p>{file.sha256 || '摘要未知'}</p>{file.sourceUrl && <p>{file.sourceUrl}</p>}</details>
      </article>; })}</div>
      {owner === 'draft' && <><label className="sc-field">关联报价原件<select value={(value as Editor).content.quoteDocumentId ?? ''} onChange={event => { const id = event.currentTarget.value; changeContent(content => { const next = { ...content }; if (id) next.quoteDocumentId = id; else delete next.quoteDocumentId; return next; }); }}><option value="">未关联</option>{files.filter(file => file.purpose === 'quotation' && selectedFiles.some(id => key(id) === key(file.id))).map(file => <option value={file.id} key={file.id}>{file.fileName || file.documentLabel || '报价来源'}</option>)}</select></label>
        <button type="button" className="sc-button" disabled={!!formBlocked || dirtyEditor || dirtyReport || !shownEditor?.draftToken} onClick={() => void cleanFiles()}>清理已解除引用的临时附件</button><p className="sc-commercial-subtle">先保存解除引用，再明确清理。固定版本与所有人工报告的依据不会删除。</p></>}
    </>;
  }
  function renderHistory(value: CommercialAgreement): JSX.Element {
    const projection = dossier ? projectCommercialSignatures(dossier) : null;
    const reports = dossier?.signatureReports.filter(row => key(row.agreementId) === key(value.id)) ?? [];
    return <section className="sc-commercial-history" aria-label="固定版本与人工报告"><h3>固定版本与人工报告</h3>
      {!value.versions.length && <p className="sc-commercial-subtle">还没有固定版本。</p>}
      {value.versions.map((version, index) => <details className="sc-commercial-version" key={version.id}><summary>固定第{index + 1}版 · {version.content.title}</summary>
        <ContentView content={version.content}/><p>录入人 {version.recordedBy} · {recordedTime(version.recordedAt)}（北京时间）</p><p>{version.fixingNote}</p>
        {version.content.documentRefs.map(id => dossier?.attachmentRefs.find(row => key(row.id) === key(id))).filter((row): row is CommercialAttachment => !!row).map(file => <div className="sc-commercial-file" key={file.id}><strong>{file.fileName || file.documentLabel || '原来源'}</strong><p>{file.sourceState === 'local-file' ? '本机原件' : '原件未携带，来源待核'}</p>{file.sourceState === 'local-file' && <button type="button" className="sc-button" disabled={blocked} onClick={() => void download(file)}>下载原件</button>}
          <details><summary>原编号与摘要</summary><p>{file.id} · {file.documentLabel || '版本标识未填写'}</p><p>{file.sha256 || '摘要未知'}</p>{file.sourceUrl && <p>{file.sourceUrl}</p>}</details></div>)}
        <details><summary>版本原编号</summary><p>{version.id}</p>{version.basedOnVersionId && <p>前版 {version.basedOnVersionId}</p>}</details>
        <div className="sc-commercial-actions"><button type="button" className="sc-button" disabled={blocked || dirtyEditor || dirtyReport || !!value.draft} onClick={() => startVersion(value, version)}>从此版起新草稿</button>
          <button type="button" className="sc-button" disabled={blocked || dirtyEditor || dirtyReport} onClick={() => startReport(value, version)}>记录所见签署</button></div>
      </details>)}
      <p className="sc-commercial-subtle">人工报告只记录所见，不验证签署效力。更正和作废仅处理本页报告。</p>
      {reports.map(item => { const payload = item.kind === 'correction' ? item.replacement : item; const leaf = !reports.some(row => 'targetId' in row && key(row.targetId) === key(item.id)); const version = value.versions.find(row => key(row.id) === key(item.versionId));
        return <article className="sc-commercial-agreement" key={item.id}><strong>{item.kind === 'reported_signed' ? '原人工报告' : item.kind === 'correction' ? '追加更正报告' : '追加作废报告'}</strong><p>{item.kind !== 'void' && projection?.effectiveReports.some(row => key(row.effectiveReportId) === key(item.id)) ? '当前有效报告记录' : '原历史保留'}</p>
          <p>{payload.evidenceNote}</p><p>录入人 {item.recordedBy} · {recordedTime(item.recordedAt)}</p>{'reason' in item && <p>原因：{item.reason}</p>}
          {item.kind !== 'void' && <p>所见标记 {('observedParties' in payload ? payload.observedParties : []).map(side => side === 'our' ? '我方' : '对方').join('、')} · 签署日期 {'signedOn' in payload ? payload.signedOn || '未记录' : '未记录'}</p>}
          <details><summary>报告原编号与依据</summary><p>{item.id} · 版本 {item.versionId}</p>{'targetId' in item && <p>前报告 {item.targetId}</p>}{payload.attachmentIds.map(id => { const file = dossier?.attachmentRefs.find(row => key(row.id) === key(id)); return <p key={id}>{file?.fileName || file?.documentLabel || '原依据'} {file?.sourceState === 'local-file' && <button type="button" className="sc-button" disabled={blocked} onClick={() => void download(file)}>下载原件</button>}</p>; })}</details>
          {leaf && item.kind !== 'void' && version && <div className="sc-commercial-actions"><button type="button" className="sc-button" disabled={blocked || dirtyEditor || dirtyReport} onClick={() => startReport(value, version, item, 'correction')}>更正这条报告</button><button type="button" className="sc-button" disabled={blocked || dirtyEditor || dirtyReport} onClick={() => startReport(value, version, item, 'void')}>作废这条报告</button></div>}
        </article>; })}
      {!!projection?.recordingTimeConflictIds.length && <p className="sc-commercial-warning">部分录入时间顺序需核对，原时点已保留。</p>}
    </section>;
  }
  function renderReport(value: ReportEditor): JSX.Element {
    return <form aria-label="人工签署报告" onSubmit={event => { event.preventDefault(); void saveReport(); }} className="sc-commercial-section"><h3>{value.kind === 'reported_signed' ? '人工签署报告' : value.kind === 'correction' ? '更正人工报告' : '作废人工报告'}</h3><fieldset disabled={!!formBlocked}>
      {value.kind !== 'void' && <><fieldset><legend>所见签署方</legend>{(['our', 'counterparty'] as const).map(side => <label key={side}><input type="checkbox" checked={value.observedParties.includes(side)} onChange={event => { const checked = event.currentTarget.checked; changeReport(report => ({ ...report, observedParties: checked ? [...report.observedParties, side] : report.observedParties.filter(value => value !== side) })); }}/>{side === 'our' ? '我方所见签署标记' : '对方所见签署标记'}</label>)}</fieldset>
        <Field label="所见签署日期（可未知）" type="date" value={value.signedOn} onChange={signedOn => changeReport(report => ({ ...report, signedOn }))}/></>}
      {value.kind !== 'reported_signed' && <Field label="更正或作废原因" value={value.reason} multiline onChange={reason => changeReport(report => ({ ...report, reason }))}/>}<Field label="人工报告说明" value={value.evidenceNote} multiline onChange={evidenceNote => changeReport(report => ({ ...report, evidenceNote }))}/>
      {renderFiles('report')}</fieldset><div className="sc-commercial-actions"><button type="submit" className="sc-button" disabled={!!formBlocked}>保存人工报告</button><button type="button" className="sc-button" disabled={blocked} onClick={() => { if (editable()) { assignReport(null); assignSource(freshSource()); } }}>放弃报告输入</button></div>
    </form>;
  }
});

function ContentView({ content }: { content: CommercialContent }): JSX.Element {
  return <div className="sc-commercial-summary"><p>我方：{content.ourParty.name || '待填写'} · 对方：{content.counterparty.name || '待填写'}</p><p>{content.ourParty.contactNote}</p><p>{content.counterparty.contactNote}</p>
    <p>包含范围：{content.scopeIn || '待填写'}</p><p>不含事项：{content.scopeOut || '待填写'}</p><p>待确认：{content.unconfirmedNote || '未填写'}</p><p>{content.eventNote}</p>
    <p>文件记载金额 {content.fileAmount.amountMinor === null ? '未知' : `人民币 ${formatMoneyMinor(content.fileAmount.amountMinor)} 元`} · 依据 {content.fileAmount.basisNote || '未填写'}</p><p>金额原文 {content.amountSourceText || '未填写'}</p>
    {content.paymentPlanNodes.map(node => <p key={node.id}>{node.label || '未命名计划'} · {node.direction === 'receivable' ? '应收计划' : node.direction === 'payable' ? '应付计划' : '方向未知'} · {node.amount.amountMinor === null ? '金额未知' : `${formatMoneyMinor(node.amount.amountMinor)}元`} · {node.dueOn || '日期未知'} · {node.triggerNote || '条件未填写'} · 依据 {node.amount.basisNote || '未填写'}</p>)}
  </div>;
}
