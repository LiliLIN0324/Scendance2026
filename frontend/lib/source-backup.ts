import { z } from 'zod';
import { dimensionSchema, uuid } from '../../supabase/functions/_shared/domain';
import type { ReferenceRegistration } from './reference-image';
import type { StoredSource } from './source-storage';

export const MAX_SOURCE_BYTES = 5 * 1024 * 1024;
export const MAX_SOURCE_DOCUMENTS = 12;
const identity = z.string().min(1).max(200).refine(value => value.trim().length > 0);
const pixels = z.number().int().positive().max(4096);
const kind = z.enum(['floorplan', 'photo']);
const mimeType = z.enum(['image/png', 'image/jpeg', 'image/webp']);
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function validBase64(value: string): boolean {
  if (!value.length || value.length % 4 || value.length > Math.ceil(MAX_SOURCE_BYTES / 3) * 4) return false;
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  const content = value.slice(0, value.length - padding);
  return !/[^A-Za-z0-9+/]/.test(content) && value.length / 4 * 3 - padding <= MAX_SOURCE_BYTES &&
    (!padding || alphabet.indexOf(content.at(-1)!) % (padding === 2 ? 16 : 4) === 0);
}

const registrationSchema = z.strictObject({
  sourceId: identity, points: z.array(z.strictObject({ x: z.number().min(0).max(4096), z: z.number().min(0).max(4096) })).max(3),
  worldWidth: z.number().positive().max(400).optional(), worldDepth: z.number().positive().max(400).optional(),
  sourceAssetId: uuid.optional(), imageWidth: pixels.optional(), imageHeight: pixels.optional(),
  appliedBasis: z.string().optional(), confirmationId: identity.optional(),
} satisfies Record<keyof ReferenceRegistration, z.ZodType>);
export const sourceBackupFormSchema = z.strictObject({
  width: z.string().optional(), depth: z.string().optional(), height: z.string().optional(), text: z.string().optional(),
  constraints: z.array(dimensionSchema).max(128).optional(), adjustment: z.string().optional(), registration: registrationSchema.optional(),
});
const sourceDocumentSchema = z.strictObject({
  id: identity, name: z.string().min(1).max(1024), kind, width: pixels, height: pixels, mimeType,
  base64: z.string().refine(validBase64, '图片内容不是完整规范的 Base64 或超过 5 MiB'),
  assetId: uuid.optional(), uploadedKind: kind.optional(),
});
export const sourceDocumentsSchema = z.strictObject({
  status: z.literal('present'), sources: z.array(sourceDocumentSchema).max(MAX_SOURCE_DOCUMENTS), form: sourceBackupFormSchema.optional(),
}).superRefine((value, context) => {
  const ids = value.sources.map(source => uuid.safeParse(source.id).success ? source.id.toLowerCase() : source.id);
  if (new Set(ids).size !== ids.length) context.addIssue({ code: 'custom', message: '图片原编号不能重复' });
});
export type SourceDocuments = z.infer<typeof sourceDocumentsSchema>;
export type RestoredSourceDocuments = SourceDocuments | { status: 'not-in-file' };
export interface SourceBackupSnapshot { scope: string; sources: StoredSource[]; form: unknown }

function parseDocuments(value: unknown): SourceDocuments {
  const parsed = sourceDocumentsSchema.safeParse(value);
  if (!parsed.success) throw new Error('图片附件或恢复表单无效，请核对原资料。');
  return parsed.data;
}

function imageMime(bytes: Uint8Array): string | undefined {
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)) return 'image/png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP') return 'image/webp';
  return undefined;
}

/** Select editable form fields; live job/request state is deliberately not portable. */
function portableForm(form: unknown): SourceDocuments['form'] {
  if (form === undefined) return undefined;
  if (!form || typeof form !== 'object' || Array.isArray(form)) throw new Error('图纸恢复表单无效。');
  const fields: Record<string, unknown> = {};
  for (const field of Object.keys(sourceBackupFormSchema.shape)) {
    const descriptor = Object.getOwnPropertyDescriptor(form, field);
    if (!descriptor) continue;
    if (!('value' in descriptor)) throw new Error('图纸恢复表单不能包含取值器。');
    if (descriptor.value !== undefined) fields[field] = descriptor.value;
  }
  const parsed = sourceBackupFormSchema.safeParse(fields);
  if (!parsed.success) throw new Error('图纸恢复表单字段无效。');
  return parsed.data;
}

/** Freeze metadata and Blob references before the first asynchronous read. Never fetch missing cloud bytes. */
export async function encodeSourceDocuments(snapshot: SourceBackupSnapshot): Promise<SourceDocuments> {
  if (!identity.safeParse(snapshot.scope).success || !Array.isArray(snapshot.sources) || snapshot.sources.length > MAX_SOURCE_DOCUMENTS) {
    throw new Error('图片备份范围无效或超过 12 张。');
  }
  const form = portableForm(snapshot.form);
  const entries = snapshot.sources.map(source => {
    if (source.scope !== snapshot.scope) throw new Error('图片与备份项目范围不一致。');
    if (!(source.blob instanceof Blob) || !source.blob.size) throw new Error(`图片“${source.name}”缺少本机原图；云端引用不能代替附件，请先补齐原图。`);
    if (source.blob.size > MAX_SOURCE_BYTES) throw new Error('每张图片不能超过 5 MiB。');
    const { id, name, kind, width, height, assetId, uploadedKind, blob } = source;
    return { blob, data: { id, name, kind, width, height, mimeType: blob.type,
      ...(assetId === undefined ? {} : { assetId }), ...(uploadedKind === undefined ? {} : { uploadedKind }) } };
  });
  const sources = [];
  for (const { blob, data } of entries) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (imageMime(bytes) !== data.mimeType) throw new Error('图片字节与声明格式不一致，仅支持 PNG、JPEG 或 WebP 原图。');
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
    sources.push({ ...data, base64: btoa(binary) });
  }
  return parseDocuments({ status: 'present', sources, ...(form === undefined ? {} : { form }) });
}

/** Fully decode every image before returning anything the caller can write into local storage. */
export async function decodeSourceDocuments(documents: SourceDocuments, scope: string): Promise<{ sources: StoredSource[]; form: unknown }> {
  if (!identity.safeParse(scope).success) throw new Error('图片恢复项目范围无效。');
  const checked = parseDocuments(documents), sources: StoredSource[] = [];
  for (const source of checked.sources) {
    const binary = atob(source.base64), bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    if (imageMime(bytes) !== source.mimeType) throw new Error('图片字节与声明格式不一致，未恢复附件。');
    const blob = new Blob([bytes], { type: source.mimeType });
    let bitmap: ImageBitmap;
    try { bitmap = await createImageBitmap(blob); }
    catch { throw new Error('图片无法真实解码，未恢复附件。'); }
    try {
      if (bitmap.width !== source.width || bitmap.height !== source.height) throw new Error('图片实际尺寸与备份记录不一致，未恢复附件。');
    } finally { bitmap.close(); }
    sources.push({ id: source.id, name: source.name, kind: source.kind, width: source.width, height: source.height, scope, blob,
      ...(source.assetId === undefined ? {} : { assetId: source.assetId }),
      ...(source.uploadedKind === undefined ? {} : { uploadedKind: source.uploadedKind }) });
  }
  return { sources, form: checked.form };
}
