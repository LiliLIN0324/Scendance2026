import { z } from 'zod';
import {
  commercialAttachmentMimeTypes, commercialDossierLimits, commercialDossierSchema,
} from '../../supabase/functions/_shared/commercial-dossier-contract';
import { eventOperationTaskSchema, eventOperationsSchema } from '../../supabase/functions/_shared/event-operations-contract';
import {
  CommercialReadbackError, restoreCommercialSnapshot, validateCommercialSnapshot,
  type CommercialContextGuard, type CommercialRead, type CommercialStoredSnapshot,
} from './commercial-dossier-storage';
import { MAX_LOCAL_PROJECT_BACKUP_V4_BYTES, parseLocalProjectBackupJson } from './local-project-backup';

export const COMMERCIAL_BACKUP_FORMAT = 'scendance-commercial-domain-backup';
export const COMMERCIAL_BACKUP_VERSION = 1;
/** Raw originals remain limited to 10 MiB each / 32 MiB total, independently of this encoded JSON ceiling. */
export const MAX_COMMERCIAL_BACKUP_BYTES = 64 * 1024 * 1024;
export const MAX_COMMERCIAL_BASE64_CHARACTERS = Math.ceil(commercialDossierLimits.projectFileBytes / 3) * 4 + commercialDossierLimits.attachments * 4;
export const COMMERCIAL_BACKUP_COVERAGE = { commercialDossier: true, originalFiles: true } as const;

const identity = z.string().min(1).max(128).refine(value => !!value.trim());
const time = eventOperationTaskSchema.shape.plannedStartAt.unwrap().unwrap();
const metadataSchema = z.strictObject({ id: identity, generatedAt: time });
export type CommercialBackupMetadata = z.infer<typeof metadataSchema>;
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function canonicalBase64(value: string): boolean {
  if (!value.length || value.length % 4 || value.length > Math.ceil(commercialDossierLimits.fileBytes / 3) * 4) return false;
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  const content = value.slice(0, value.length - padding);
  return !/[^A-Za-z0-9+/]/.test(content) && value.length / 4 * 3 - padding <= commercialDossierLimits.fileBytes &&
    (!padding || alphabet.indexOf(content.at(-1)!) % (padding === 2 ? 16 : 4) === 0);
}

const attachmentId = eventOperationTaskSchema.shape.id;
const fileSchema = z.discriminatedUnion('status', [
  z.strictObject({ attachmentId, status: z.literal('included'), mimeType: z.enum(commercialAttachmentMimeTypes),
    byteSize: z.number().int().positive().max(commercialDossierLimits.fileBytes), sha256: z.string().regex(/^[a-f0-9]{64}$/),
    base64: z.string().refine(canonicalBase64, '原件不是完整规范的 Base64 或超过 10 MiB') }),
  z.strictObject({ attachmentId, status: z.literal('external-reference') }),
  z.strictObject({ attachmentId, status: z.literal('missing') }),
]);
const backupSchema = z.strictObject({
  format: z.literal(COMMERCIAL_BACKUP_FORMAT), version: z.literal(COMMERCIAL_BACKUP_VERSION), ...metadataSchema.shape,
  projectId: identity, dataKind: eventOperationsSchema.shape.dataKind.unwrap().nullable(),
  coverage: z.strictObject({ commercialDossier: z.literal(true), originalFiles: z.literal(true) }),
  records: z.discriminatedUnion('status', [
    z.strictObject({ status: z.literal('present'), value: commercialDossierSchema }),
    z.strictObject({ status: z.literal('absent') }),
  ]),
  files: z.array(fileSchema).max(commercialDossierLimits.attachments),
}).superRefine((backup, context) => {
  const fail = (message: string) => context.addIssue({ code: 'custom', message });
  if (backup.records.status === 'absent') {
    if (backup.dataKind !== null || backup.files.length) fail('无资料状态不能声明资料性质或携带文件');
    return;
  }
  const dossier = backup.records.value;
  if (dossier.projectId !== backup.projectId || dossier.dataKind !== backup.dataKind) fail('商务根记录与包的项目或资料性质不一致');
  const refs = new Map(dossier.attachmentRefs.map(ref => [ref.id.toLowerCase(), ref]));
  const seen = new Set<string>(); let rawBytes = 0, base64Characters = 0;
  for (const file of backup.files) {
    const key = file.attachmentId.toLowerCase(), ref = refs.get(key);
    if (seen.has(key)) fail('原件清单编号不能重复');
    seen.add(key);
    if (!ref) { fail('原件清单不能包含台账没有的附件'); continue; }
    if (file.status !== (ref.sourceState === 'local-file' ? 'included' : ref.sourceState)) fail('原件清单与台账来源状态不一致');
    if (file.status !== 'included') continue;
    const padding = file.base64.endsWith('==') ? 2 : file.base64.endsWith('=') ? 1 : 0;
    const decodedSize = file.base64.length / 4 * 3 - padding;
    if (file.byteSize !== ref.byteSize || decodedSize !== file.byteSize || file.sha256 !== ref.sha256 || file.mimeType !== ref.mimeType?.toLowerCase()) {
      fail('携带原件的长度、格式或摘要与台账不一致');
    }
    rawBytes += decodedSize; base64Characters += file.base64.length;
  }
  if (seen.size !== refs.size) fail('每份台账附件须有明确清单，不能漏原件或来源');
  if (rawBytes > commercialDossierLimits.projectFileBytes || base64Characters > MAX_COMMERCIAL_BASE64_CHARACTERS) fail('原件合计超过 32 MiB 或编码上限');
});
export type CommercialBackup = z.infer<typeof backupSchema>;
export type CommercialRestoreCandidate =
  | { status: 'present'; projectId: string; id: string; generatedAt: string; value: CommercialStoredSnapshot }
  | { status: 'absent'; projectId: string; id: string; generatedAt: string }
  | { status: 'not-in-file'; projectId: string };

/** Copy data properties only. Never execute a caller's getters or serializers at the async boundary. */
function fields(value: unknown, allowed?: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value)) || Object.getOwnPropertySymbols(value).length) throw new Error('商务包输入须为普通数据对象。');
  const descriptors = Object.getOwnPropertyDescriptors(value), result: Record<string, unknown> = {};
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!descriptor.enumerable || !('value' in descriptor) || allowed && !allowed.includes(key)) throw new Error('商务包输入不能包含取值器或额外字段。');
    Object.defineProperty(result, key, { value: descriptor.value, enumerable: true, writable: true, configurable: true });
  }
  return result;
}

function frozenRead(snapshot: CommercialRead): CommercialRead {
  const read = fields(snapshot, ['status', 'projectId', 'value']), projectId = identity.parse(read.projectId);
  if (read.status === 'absent' && !('value' in read)) return { status: 'absent', projectId };
  if (read.status !== 'present') throw new Error('商务读取尚未完成，不能导出原件包。');
  const value = fields(read.value, ['schemaVersion', 'storageToken', 'dossier', 'originals']);
  if (value.schemaVersion !== 1) throw new Error('商务本机容器版本无效。');
  const dossier = commercialDossierSchema.parse(value.dossier), storageToken = identity.parse(value.storageToken);
  const originals = fields(value.originals) as Record<string, Blob>;
  if (dossier.projectId !== projectId) throw new Error('商务记录与导出项目不一致。');
  return { status: 'present', projectId, value: { schemaVersion: 1, storageToken, dossier, originals } };
}

function checkedJson(value: CommercialBackup): string {
  const text = JSON.stringify(value, null, 2);
  if (new TextEncoder().encode(text).byteLength > MAX_COMMERCIAL_BACKUP_BYTES) throw new Error('商务台账与原件包超过 64 MiB，未生成文件。');
  return text;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  return btoa(binary);
}
function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value), bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function guardContext(guard: CommercialContextGuard): void {
  if (typeof guard !== 'function') throw new Error('恢复商务资料须提供当前本机上下文守卫。');
  const result = (guard as () => unknown)();
  if (result && typeof (result as { then?: unknown }).then === 'function') throw new Error('商务上下文守卫必须同步，不能返回 Promise。');
}

/** Pure full export: freeze the whole read before awaiting bytes; a missing/unreadable local original stops the export. */
export async function encodeCommercialBackup(snapshot: CommercialRead, metadata: CommercialBackupMetadata): Promise<CommercialBackup> {
  const read = frozenRead(snapshot), fixedMetadata = metadataSchema.parse(fields(metadata, ['id', 'generatedAt']));
  const base = { format: COMMERCIAL_BACKUP_FORMAT, version: COMMERCIAL_BACKUP_VERSION, ...fixedMetadata,
    projectId: read.projectId, coverage: COMMERCIAL_BACKUP_COVERAGE };
  if (read.status === 'absent') {
    const backup = backupSchema.parse({ ...base, dataKind: null, records: { status: 'absent' }, files: [] });
    checkedJson(backup); return backup;
  }
  const value = await validateCommercialSnapshot(read.projectId, read.value);
  const files: CommercialBackup['files'] = [];
  for (const attachment of value.dossier.attachmentRefs) {
    if (attachment.sourceState !== 'local-file') {
      files.push({ attachmentId: attachment.id, status: attachment.sourceState }); continue;
    }
    const blob = value.originals[attachment.id.toLowerCase()];
    const bytes = new Uint8Array(await Blob.prototype.arrayBuffer.call(blob));
    files.push({ attachmentId: attachment.id, status: 'included', byteSize: bytes.byteLength,
      mimeType: attachment.mimeType!.toLowerCase() as (typeof commercialAttachmentMimeTypes)[number],
      sha256: attachment.sha256!, base64: toBase64(bytes) });
  }
  const backup = backupSchema.parse({ ...base, dataKind: value.dossier.dataKind,
    records: { status: 'present', value: value.dossier }, files });
  checkedJson(backup); return backup;
}

export async function serializeCommercialBackup(snapshot: CommercialRead, metadata: CommercialBackupMetadata): Promise<string> {
  return checkedJson(await encodeCommercialBackup(snapshot, metadata));
}

/** Preflight only: validate every byte before returning a detached candidate, never read or write local storage. */
export async function preflightCommercialBackupJson(text: string, targetProjectId: string): Promise<CommercialRestoreCandidate> {
  identity.parse(targetProjectId);
  const size = new TextEncoder().encode(text).byteLength;
  if (size > MAX_LOCAL_PROJECT_BACKUP_V4_BYTES) throw new Error('导入文件超过 96 MiB，未预检。');
  let input: unknown;
  try { input = JSON.parse(text); } catch { throw new Error('文件不是有效的 JSON，商务记录未改变。'); }
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('不支持此商务包或旧布局文件。');
  const header = input as Record<string, unknown>;
  if (header.format !== COMMERCIAL_BACKUP_FORMAT) {
    const old = parseLocalProjectBackupJson(text);
    if (old.source === 'legacy-layout' && old.layoutWasRepaired) throw new Error('旧布局需要修复，不能作为可信的商务缺领域文件。');
    if (old.layout.id !== targetProjectId) throw new Error('仅允许同一项目恢复商务资料。');
    return { status: 'not-in-file', projectId: targetProjectId };
  }
  if (size > MAX_COMMERCIAL_BACKUP_BYTES) throw new Error('商务台账与原件包超过 64 MiB，未预检。');
  const backup = backupSchema.parse(input);
  if (backup.projectId !== targetProjectId) throw new Error('仅允许同一项目恢复商务资料。');
  const metadata = { projectId: backup.projectId, id: backup.id, generatedAt: backup.generatedAt };
  if (backup.records.status === 'absent') return { status: 'absent', ...metadata };
  const originals: Record<string, Blob> = {};
  for (const file of backup.files) if (file.status === 'included') {
    const attachment = backup.records.value.attachmentRefs.find(ref => ref.id.toLowerCase() === file.attachmentId.toLowerCase())!;
    originals[attachment.id.toLowerCase()] = new Blob([fromBase64(file.base64)], { type: file.mimeType });
  }
  const value = await validateCommercialSnapshot(targetProjectId, { schemaVersion: 1, storageToken: 'package-preflight',
    dossier: backup.records.value, originals });
  return { status: 'present', ...metadata, value };
}

/** Only this wrapper touches storage. The UI guard must synchronously check local mode, project identity and its monotonic epoch. */
export async function restoreCommercialBackupJson(
  text: string, projectId: string, expectedDraftTokens: Record<string, string | null>, guard: CommercialContextGuard,
): Promise<CommercialRead> {
  guardContext(guard);
  const tokens = fields(expectedDraftTokens);
  const tokenIds = new Set<string>();
  for (const [id, value] of Object.entries(tokens)) {
    if (!attachmentId.safeParse(id).success || tokenIds.has(id.toLowerCase()) || value !== null && !identity.safeParse(value).success) throw new Error('目标草稿编号或令牌无效，编号不能重复。');
    tokenIds.add(id.toLowerCase());
  }
  const candidate = await preflightCommercialBackupJson(text, projectId);
  guardContext(guard);
  const result = await restoreCommercialSnapshot(projectId, candidate.status === 'present' ? candidate.value : undefined,
    tokens as Record<string, string | null>, guard);
  try { guardContext(guard); }
  catch (error) {
    if (candidate.status === 'present') throw new CommercialReadbackError();
    throw error;
  }
  return result;
}
