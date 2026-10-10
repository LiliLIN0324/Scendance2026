import {
  assertCommercialHistoryPreserved, commercialAttachmentSchema, commercialDossierLimits, commercialDossierSchema,
  commercialDraftSchema, commercialSignatureReportSchema, commercialVersionSchema, mergeCommercialDossiers,
  type CommercialAgreement, type CommercialAttachment, type CommercialDossier, type CommercialDraft,
  type CommercialSignatureReport, type CommercialVersion,
} from '../../supabase/functions/_shared/commercial-dossier-contract';
import { canonical, uuid } from '../../supabase/functions/_shared/domain';
import { readSourceRecord, updateSourceForm, type SourceFormKey } from './source-storage';

export type CommercialContextGuard = () => void;
export interface CommercialStoredSnapshot {
  schemaVersion: 1; storageToken: string; dossier: CommercialDossier; originals: Record<string, Blob>;
}
export type CommercialRead = { status: 'absent'; projectId: string } |
  { status: 'present'; projectId: string; value: CommercialStoredSnapshot };
export interface PreparedCommercialOriginal { attachment: CommercialAttachment; blob: Blob }
export interface CommercialFileAdditions { attachmentRefs?: CommercialAttachment[]; originals?: PreparedCommercialOriginal[] }
export interface CommercialDraftSave extends CommercialFileAdditions {
  agreementId: string; direction: CommercialAgreement['direction']; dataKind: CommercialDossier['dataKind'];
  expectedDraftToken: string | null; draft: Omit<CommercialDraft, 'draftToken'>; cleanupUnreferenced?: boolean;
}
export class CommercialReadbackError extends Error {
  readonly committed = true;
  constructor() { super('商务资料已提交，但读回未确认。请保留当前输入，重新读取核对，不要重复固定版本或报告。'); this.name = 'CommercialReadbackError'; }
}
class ConcurrentCommercialWrite extends Error {}
const key = (id: string) => id.toLowerCase();
const token = () => crypto.randomUUID();
function fail(message: string): never { throw new Error(message); }
function guardContext(guard: CommercialContextGuard): void {
  if (typeof guard !== 'function') fail('商务操作需要同步项目上下文检查。');
  const result = (guard as () => unknown)();
  if (result && typeof (result as { then?: unknown }).then === 'function') fail('商务上下文检查必须同步，不能返回Promise。');
}
function plain(value: unknown, seen = new Set<object>(), depth = 0): void {
  if (depth > 64) fail('商务输入嵌套过深。');
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) return;
  if (!value || typeof value !== 'object' || seen.has(value)) fail('商务输入不是普通JSON资料。');
  const array = Array.isArray(value), prototype = Object.getPrototypeOf(value);
  if ((array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) || Object.getOwnPropertySymbols(value).length) fail('商务输入不能含自定义对象。');
  seen.add(value);
  for (const [name, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    if (array && name === 'length') continue;
    if (!descriptor.enumerable || !('value' in descriptor)) fail('商务输入不能含取值器或隐藏字段。');
    plain(descriptor.value, seen, depth + 1);
  }
  seen.delete(value);
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value)) || Object.getOwnPropertySymbols(value).length) fail('本机商务容器无法完整读取。');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.values(descriptors).some(item => !item.enumerable || !('value' in item))) fail('本机商务容器包含不可读取字段。');
  return value as Record<string, unknown>;
}
function arrayValues(value: unknown): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || Object.getOwnPropertySymbols(value).length) fail('商务文件增量须为普通数组。');
  const descriptors = Object.getOwnPropertyDescriptors(value), length = Object.getOwnPropertyDescriptor(value, 'length')!.value as number;
  if (length > commercialDossierLimits.attachments || Object.keys(descriptors).length !== length + 1) fail('商务文件增量数组不完整或过大。');
  const result: unknown[] = [];
  for (let index = 0; index < length; index++) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) fail('商务文件增量不能含取值器或稀疏元素。');
    result.push(descriptor.value);
  }
  return result;
}
function blobSize(blob: Blob): number {
  try { return Object.getOwnPropertyDescriptor(Blob.prototype, 'size')!.get!.call(blob) as number; }
  catch { return fail('商务原件不是可读取的Blob。'); }
}
function basicMime(bytes: Uint8Array): string {
  const starts = (values: number[]) => values.every((value, index) => bytes[index] === value);
  if (starts([0x25, 0x50, 0x44, 0x46, 0x2d])) {
    const head = new TextDecoder('ascii').decode(bytes.subarray(0, 8));
    const tail = new TextDecoder('ascii').decode(bytes.subarray(Math.max(0, bytes.length - 1024)));
    if (/^%PDF-[12]\.\d/.test(head) && /%%EOF\s*$/.test(tail)) return 'application/pdf';
  }
  if (starts([137, 80, 78, 71, 13, 10, 26, 10]) && bytes.length >= 45) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const name = (start: number) => String.fromCharCode(...bytes.subarray(start, start + 4));
    if (view.getUint32(8) === 13 && name(12) === 'IHDR' && view.getUint32(16) > 0 && view.getUint32(20) > 0 &&
      view.getUint32(bytes.length - 12) === 0 && name(bytes.length - 8) === 'IEND') return 'image/png';
  }
  if (starts([255, 216]) && bytes[bytes.length - 2] === 255 && bytes[bytes.length - 1] === 217) {
    let offset = 2;
    while (offset + 4 < bytes.length) {
      if (bytes[offset++] !== 255) break;
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 0x01 || marker >= 0xd0 && marker <= 0xd7) continue;
      const length = bytes[offset] * 256 + bytes[offset + 1];
      if (length < 2 || offset + length > bytes.length) break;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker) && length >= 8 &&
        bytes[offset + 3] * 256 + bytes[offset + 4] > 0 && bytes[offset + 5] * 256 + bytes[offset + 6] > 0) return 'image/jpeg';
      offset += length;
    }
  }
  return fail('原件基础格式不符合PDF、PNG或JPEG；未压缩、转换或保存。');
}
async function fileBytes(blob: Blob): Promise<Uint8Array> {
  const size = blobSize(blob);
  if (!size || size > commercialDossierLimits.fileBytes) fail('商务原件须有正长度，单个文件不能超过10MiB。');
  const bytes = new Uint8Array(await Blob.prototype.arrayBuffer.call(blob));
  if (bytes.byteLength !== size) fail('商务原件实际字节长度与Blob不一致。');
  return bytes;
}
async function digest(bytes: Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle) fail('当前环境不能核对商务原件摘要，请使用安全连接或本机浏览器。');
  const result = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(result), byte => byte.toString(16).padStart(2, '0')).join('');
}
/** Checks only format basics and byte identity; it does not validate signatures or legal content. */
export async function verifyCommercialOriginal(attachment: CommercialAttachment, blob: Blob): Promise<void> {
  const record = commercialAttachmentSchema.parse(attachment);
  if (record.sourceState !== 'local-file') fail('外链或缺失来源不能当作已保全的本地原件。');
  if (blobSize(blob) !== record.byteSize) fail('商务原件长度与附件记录不一致。');
  const bytes = await fileBytes(blob);
  if (basicMime(bytes) !== record.mimeType!.toLowerCase() || await digest(bytes) !== record.sha256) fail('商务原件格式或SHA-256与附件记录不一致。');
}
/** Original bytes are copied into an immutable Blob, never recompressed or fetched from a URL. */
export async function prepareCommercialOriginal(metadata: Omit<CommercialAttachment, 'sourceState' | 'mimeType' | 'byteSize' | 'sha256'>,
  blob: Blob): Promise<PreparedCommercialOriginal> {
  plain(metadata); const info = structuredClone(metadata), bytes = await fileBytes(blob), mimeType = basicMime(bytes);
  const attachment = commercialAttachmentSchema.parse({ ...info, sourceState: 'local-file', mimeType, byteSize: bytes.byteLength, sha256: await digest(bytes) });
  return { attachment, blob: new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mimeType }) };
}
export function commercialDossierStorageKey(projectId: string): SourceFormKey {
  if (typeof projectId !== 'string' || !projectId.trim() || projectId.length > commercialDossierLimits.projectId) fail('请先保存有稳定编号的本机活动，再记录商务资料。');
  return ['commercial-domain', projectId];
}
function checked(projectId: string, value: unknown): CommercialStoredSnapshot {
  const input = object(value);
  if (Object.keys(input).some(name => !['schemaVersion', 'storageToken', 'dossier', 'originals'].includes(name)) || input.schemaVersion !== 1 ||
    typeof input.storageToken !== 'string' || !input.storageToken.trim() || input.storageToken.length > 128) fail('本机商务容器版本或存储标识无效。');
  const dossier = commercialDossierSchema.parse(input.dossier);
  if (dossier.projectId !== projectId) fail('商务资料属于另一个本机活动，未读取或覆盖。');
  const files = object(input.originals), originals: Record<string, Blob> = {};
  const local = new Map(dossier.attachmentRefs.filter(row => row.sourceState === 'local-file').map(row => [key(row.id), row]));
  let size = 0;
  for (const [id, blob] of Object.entries(files)) {
    if (id !== key(id) || !local.has(id)) fail('商务原件没有对应的本地附件记录。');
    const length = blobSize(blob as Blob);
    if (length !== local.get(id)!.byteSize) fail('商务原件实际长度与记录不一致。');
    size += length; originals[id] = blob as Blob;
  }
  if (size > commercialDossierLimits.projectFileBytes) fail('本机商务原件合计不能超过32MiB。');
  for (const id of local.keys()) if (!originals[id]) fail('记录声明本地原件，但实际字节缺失；原件未保全。');
  return { schemaVersion: 1, storageToken: input.storageToken, dossier, originals };
}
export async function validateCommercialSnapshot(projectId: string, value: unknown): Promise<CommercialStoredSnapshot> {
  commercialDossierStorageKey(projectId);
  const snapshot = checked(projectId, value);
  await Promise.all(snapshot.dossier.attachmentRefs.filter(row => row.sourceState === 'local-file')
    .map(row => verifyCommercialOriginal(row, snapshot.originals[key(row.id)])));
  return snapshot;
}
export async function readCommercialSnapshot(projectId: string, guard: CommercialContextGuard): Promise<CommercialRead> {
  const scope = commercialDossierStorageKey(projectId); guardContext(guard);
  const value = await readSourceRecord<unknown>(scope); guardContext(guard);
  if (value === undefined) return { status: 'absent', projectId };
  const snapshot = await validateCommercialSnapshot(projectId, value); guardContext(guard);
  return { status: 'present', projectId, value: snapshot };
}
function frozenAdditions(input: CommercialFileAdditions): CommercialFileAdditions {
  const own = object(input), refs = arrayValues(own.attachmentRefs ?? []), originals = arrayValues(own.originals ?? []);
  return { attachmentRefs: refs.map(value => commercialAttachmentSchema.parse(value)), originals: originals.map(value => {
    const file = object(value), attachment = commercialAttachmentSchema.parse(file.attachment); blobSize(file.blob as Blob);
    return { attachment, blob: file.blob as Blob };
  }) };
}
async function prepareAdditions(input: CommercialFileAdditions): Promise<CommercialFileAdditions> {
  const additions = frozenAdditions(input);
  const ids = new Set<string>(); let bytes = 0;
  for (const file of additions.originals!) {
    const id = key(file.attachment.id), size = blobSize(file.blob);
    if (ids.has(id)) fail('同一原件增量不能包含重复附件编号。');
    ids.add(id);
    if (!size || size > commercialDossierLimits.fileBytes) fail('商务原件须有正长度，单个文件不能超过10MiB。');
    bytes += size;
  }
  if (bytes > commercialDossierLimits.projectFileBytes) fail('本次商务原件增量超过32MiB，未读取或保存。');
  await Promise.all(additions.originals!.map(file => verifyCommercialOriginal(file.attachment, file.blob)));
  return additions;
}
function addFiles(next: CommercialStoredSnapshot, additions: CommercialFileAdditions): void {
  const refs = [...additions.attachmentRefs ?? [], ...additions.originals?.map(row => row.attachment) ?? []];
  for (const row of refs) {
    const old = next.dossier.attachmentRefs.find(value => key(value.id) === key(row.id));
    if (old && canonical(old) !== canonical(row)) fail('同附件编号已有不同内容，换文件必须使用新编号。');
    if (!old) next.dossier.attachmentRefs.push(row);
  }
  for (const row of additions.originals ?? []) {
    const existing = next.originals[key(row.attachment.id)];
    // Existing blobs have been byte-verified before this revision's native CAS.
    if (!existing) next.originals[key(row.attachment.id)] = row.blob;
  }
}
function cleanup(next: CommercialStoredSnapshot, agreementId: string): void {
  const referenced = new Set(next.dossier.agreements.flatMap(agreement => [
    ...agreement.versions.flatMap(version => version.content.documentRefs), ...(agreement.draft?.content.documentRefs ?? []),
  ]).map(key));
  for (const report of next.dossier.signatureReports) for (const id of (report.kind === 'correction' ? report.replacement : report).attachmentIds) referenced.add(key(id));
  next.dossier.attachmentRefs = next.dossier.attachmentRefs.filter(row => {
    if (key(row.agreementId) !== key(agreementId) || referenced.has(key(row.id))) return true;
    delete next.originals[key(row.id)]; return false;
  });
}
function cas(draft: CommercialDraft | null | undefined, expected: string | null): void {
  if (expected !== (draft?.draftToken ?? null)) fail('商务草稿已有新变化，请保留输入并重新读取，未覆盖新草稿。');
}
function sameRevision(left: CommercialStoredSnapshot | undefined, right: CommercialStoredSnapshot | undefined): boolean {
  if (!left || !right) return left === right;
  if (left.storageToken !== right.storageToken || canonical(left.dossier) !== canonical(right.dossier)) return false;
  const ids = Object.keys(left.originals).sort(), others = Object.keys(right.originals).sort();
  return canonical(ids) === canonical(others) && ids.every(id => blobSize(left.originals[id]) === blobSize(right.originals[id]));
}
async function mutate(projectId: string, guard: CommercialContextGuard,
  update: (current: CommercialStoredSnapshot | undefined) => { next: CommercialStoredSnapshot; touchedDrafts?: string[]; touchedOriginals?: string[] }): Promise<CommercialRead> {
  const scope = commercialDossierStorageKey(projectId);
  for (let attempt = 0; attempt < 3; attempt++) {
    const before = await readCommercialSnapshot(projectId, guard), expected = before.status === 'present' ? before.value : undefined;
    guardContext(guard); let touched: string[] = [], touchedOriginals: string[] = [];
    let committed: CommercialStoredSnapshot;
    try {
      committed = await updateSourceForm(scope, value => {
        guardContext(guard);
        const current = value === undefined ? undefined : checked(projectId, value);
        if (!sameRevision(expected, current)) throw new ConcurrentCommercialWrite();
        const result = update(current); touched = result.touchedDrafts ?? []; touchedOriginals = result.touchedOriginals ?? [];
        const next = checked(projectId, result.next);
        if (current) assertCommercialHistoryPreserved(current.dossier, next.dossier);
        guardContext(guard); return next;
      });
    } catch (error) {
      if (error instanceof ConcurrentCommercialWrite && attempt < 2) continue;
      if (error instanceof ConcurrentCommercialWrite) fail('商务资料正在被其他页面更新，请保留输入并重试。');
      throw error;
    }
    try {
      const after = await readCommercialSnapshot(projectId, guard);
      if (after.status !== 'present') throw new Error('missing');
      assertCommercialHistoryPreserved(committed.dossier, after.value.dossier);
      for (const id of touched) {
        const draft = committed.dossier.agreements.find(row => key(row.id) === key(id))?.draft;
        const current = after.value.dossier.agreements.find(row => key(row.id) === key(id))?.draft;
        if (draft && (draft.draftToken !== current?.draftToken || canonical(draft) !== canonical(current))) throw new Error('draft changed');
      }
      // Unrelated temporary files can be legally discarded while this operation is being read back.
      // Current bytes and all immutable history are already checked above; confirm only this operation's files.
      const priorAttachments = new Set(expected?.dossier.attachmentRefs.map(row => key(row.id)) ?? []);
      const requiredOriginals = new Set([
        ...touchedOriginals,
        ...committed.dossier.attachmentRefs.filter(row => row.sourceState === 'local-file' && !priorAttachments.has(key(row.id))).map(row => row.id),
        ...committed.dossier.agreements.filter(row => touched.some(id => key(id) === key(row.id))).flatMap(row => row.draft?.content.documentRefs ?? []),
      ].map(key));
      for (const row of committed.dossier.attachmentRefs) if (row.sourceState === 'local-file' && requiredOriginals.has(key(row.id))) {
        const actual = after.value.dossier.attachmentRefs.find(file => key(file.id) === key(row.id));
        if (!actual || canonical(actual) !== canonical(row) || !after.value.originals[key(row.id)]) throw new Error('original missing');
      }
      guardContext(guard); return after;
    } catch { throw new CommercialReadbackError(); }
  }
  return fail('商务资料并发检查未完成。');
}
function newSnapshot(projectId: string, dataKind: CommercialDossier['dataKind']): CommercialStoredSnapshot {
  return { schemaVersion: 1, storageToken: token(), dossier: commercialDossierSchema.parse({ projectId, dataKind }), originals: {} };
}
export async function saveCommercialDraft(projectId: string, input: CommercialDraftSave, guard: CommercialContextGuard): Promise<CommercialRead> {
  guardContext(guard); const own = object(input);
  plain(own.draft); const draftInput = structuredClone(input.draft);
  const agreementId = input.agreementId, direction = input.direction, dataKind = input.dataKind, expectedToken = input.expectedDraftToken,
    clean = input.cleanupUnreferenced === true;
  const additions = await prepareAdditions(input); guardContext(guard);
  const proposed = commercialDraftSchema.parse({ ...draftInput, draftToken: token() });
  return mutate(projectId, guard, current => {
    const next = current ? structuredClone(current) : newSnapshot(projectId, dataKind);
    if (next.dossier.dataKind !== dataKind) fail('不同资料性质不能自动合并。');
    let agreement = next.dossier.agreements.find(row => key(row.id) === key(agreementId));
    if (agreement && agreement.direction !== direction) fail('同约定不能改变客户委托或供应外包方向。');
    cas(agreement?.draft, expectedToken);
    if (!agreement) { agreement = { id: agreementId, direction, draft: null, versions: [] }; next.dossier.agreements.push(agreement); }
    if (agreement.draft && agreement.draft.id !== proposed.id) fail('现有草稿编号不能被另一个草稿替换，请先明确放弃。');
    const body = ({ draftToken: _token, ...value }: CommercialDraft) => value;
    const changed = !agreement.draft || canonical(body(agreement.draft)) !== canonical(body(proposed));
    agreement.draft = changed ? proposed : agreement.draft;
    addFiles(next, additions); if (clean) cleanup(next, agreementId);
    next.storageToken = token(); return { next, touchedDrafts: [agreementId] };
  });
}
export async function freezeCommercialVersion(projectId: string, agreementId: string, expectedDraftToken: string,
  metadata: Pick<CommercialVersion, 'id' | 'recordedAt' | 'recordedBy' | 'fixingNote'>, guard: CommercialContextGuard): Promise<CommercialRead> {
  guardContext(guard); plain(metadata); const info = structuredClone(metadata);
  if (Object.keys(info).some(name => !['id', 'recordedAt', 'recordedBy', 'fixingNote'].includes(name))) fail('固定版本信息包含未知字段。');
  return mutate(projectId, guard, current => {
    if (!current) return fail('当前商务草稿不存在，未固定版本。');
    const next = structuredClone(current), agreement = next.dossier.agreements.find(row => key(row.id) === key(agreementId));
    cas(agreement?.draft, expectedDraftToken);
    if (!agreement?.draft) return fail('当前商务草稿不存在，未固定版本。');
    const draft = agreement.draft;
    const version = commercialVersionSchema.parse({ ...info, ...(draft.basedOnVersionId ? { basedOnVersionId: draft.basedOnVersionId } : {}), content: draft.content });
    agreement.versions.push(version); agreement.draft = null; next.storageToken = token(); return { next };
  });
}
export async function appendCommercialSignatureReport(projectId: string, report: CommercialSignatureReport,
  input: CommercialFileAdditions, guard: CommercialContextGuard): Promise<CommercialRead> {
  guardContext(guard); const proposal = commercialSignatureReportSchema.parse(report), additions = await prepareAdditions(input); guardContext(guard);
  return mutate(projectId, guard, current => {
    if (!current) return fail('当前商务固定版本不存在，未记录人工报告。');
    const next = structuredClone(current); addFiles(next, additions);
    const existing = next.dossier.signatureReports.find(row => key(row.id) === key(proposal.id));
    if (existing && canonical(existing) !== canonical(proposal)) fail('同报告编号已有不同内容，请追加更正而不是覆盖。');
    if (!existing) next.dossier.signatureReports.push(proposal);
    next.storageToken = token(); return { next };
  });
}
export async function discardCommercialDraft(projectId: string, agreementId: string, expectedDraftToken: string,
  guard: CommercialContextGuard): Promise<CommercialRead> {
  return mutate(projectId, guard, current => {
    if (!current) return fail('当前商务草稿不存在。');
    const next = structuredClone(current), agreement = next.dossier.agreements.find(row => key(row.id) === key(agreementId));
    cas(agreement?.draft, expectedDraftToken);
    if (!agreement?.draft) return fail('当前商务草稿不存在。');
    agreement.draft = null; cleanup(next, agreementId);
    if (!agreement.versions.length && !next.dossier.signatureReports.some(row => key(row.agreementId) === key(agreementId))) next.dossier.agreements = next.dossier.agreements.filter(row => row !== agreement);
    next.storageToken = token(); return { next };
  });
}
/** Same-project import only. Source tokens are never authority over the target mutable draft. */
export async function restoreCommercialSnapshot(projectId: string, incoming: CommercialStoredSnapshot | undefined,
  expectedDraftTokens: Record<string, string | null>, guard: CommercialContextGuard): Promise<CommercialRead> {
  guardContext(guard); plain(expectedDraftTokens); const expectations = structuredClone(expectedDraftTokens);
  const entries = Object.entries(expectations);
  if (entries.length > commercialDossierLimits.agreements || new Set(entries.map(([id]) => key(id))).size !== entries.length ||
    entries.some(([id, expected]) => !uuid.safeParse(id).success || expected !== null && (typeof expected !== 'string' || !expected.trim() || expected.length > 128))) {
    fail('目标草稿token清单包含无效编号、重复编号或不明确状态。');
  }
  if (incoming === undefined) return readCommercialSnapshot(projectId, guard);
  const proposal = await validateCommercialSnapshot(projectId, incoming); guardContext(guard);
  return mutate(projectId, guard, current => {
    for (const agreement of proposal.dossier.agreements) if (agreement.draft) {
      const expectation = Object.entries(expectations).find(([id]) => key(id) === key(agreement.id));
      if (!expectation) fail('恢复草稿须提供目标当前token或明确不存在状态。');
      cas(current?.dossier.agreements.find(row => key(row.id) === key(agreement.id))?.draft, expectation[1]);
    }
    const dossier = current ? mergeCommercialDossiers(current.dossier, proposal.dossier) : commercialDossierSchema.parse(proposal.dossier);
    for (const agreement of dossier.agreements) if (agreement.draft && !current?.dossier.agreements.find(row => key(row.id) === key(agreement.id))?.draft) agreement.draft.draftToken = token();
    const originals = { ...current?.originals ?? {} };
    for (const [id, blob] of Object.entries(proposal.originals)) if (!originals[id]) originals[id] = blob;
    return { next: { schemaVersion: 1, storageToken: token(), dossier, originals },
      touchedDrafts: proposal.dossier.agreements.filter(row => row.draft).map(row => row.id), touchedOriginals: Object.keys(proposal.originals) };
  });
}
