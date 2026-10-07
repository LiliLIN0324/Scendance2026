import { z } from 'zod';
import type { CreativeBrief } from '../components/room-organizer/lib/creative-brief';
import { MAX_LAYOUT_JSON_BYTES, parseStoredLayout } from '../components/room-organizer/lib/schema';
import type { RoomLayout } from '../components/room-organizer/lib/types';
import { layoutForExport } from './layout-export';

export const LOCAL_PROJECT_BACKUP_FORMAT = 'scendance-local-project-backup';
export const LOCAL_PROJECT_BACKUP_VERSION = 1;
export const MAX_LOCAL_PROJECT_BACKUP_BYTES = MAX_LAYOUT_JSON_BYTES;

/** Coverage describes editable records, not packaged external resources. */
export const LOCAL_PROJECT_BACKUP_COVERAGE = {
  layout: true, creativeBrief: true, eventOperations: true, materialHandoffs: true,
  reviewedBasis: true, attachments: false, modelFiles: false,
} as const;

// Local forms can save empty text, 0, fractions and counts beyond the AI service's
// limit. Preserve these values; generation validation belongs to briefInstruction.
const briefShape = {
  event: z.string(), guests: z.number(), description: z.string(), mustHave: z.string(),
  allowIdeas: z.boolean(), hasFloorplan: z.boolean().optional(),
  venueConditions: z.string().optional(), style: z.string().optional(),
  palette: z.string().optional(), atmosphere: z.string().optional(),
} satisfies Record<keyof CreativeBrief, z.ZodType>;
const briefSchema = z.strictObject(briefShape);
const backupBriefSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('present'), value: briefSchema }),
  z.strictObject({ status: z.literal('absent') }),
]);

export type BackupBrief = { status: 'present'; value: CreativeBrief } | { status: 'absent' };
/** Only a completed read/save for this layout scope can be exported. */
export type BackupBriefSnapshot =
  | { state: 'ready'; scope: string; brief: BackupBrief }
  | { state: 'loading' | 'saving' | 'error'; scope: string };

export interface LocalProjectBackup {
  format: typeof LOCAL_PROJECT_BACKUP_FORMAT;
  version: typeof LOCAL_PROJECT_BACKUP_VERSION;
  createdAt: string;
  coverage: typeof LOCAL_PROJECT_BACKUP_COVERAGE;
  layout: RoomLayout;
  brief: BackupBrief;
}

export interface LocalProjectRestoreCandidate {
  source: 'backup' | 'legacy-layout';
  createdAt: string | null;
  layout: RoomLayout;
  /** A legacy layout says nothing about the browser's current or former brief. */
  brief: BackupBrief | { status: 'not-in-file' };
  /** Existing legacy geometry repair must be shown before applying a candidate. */
  layoutWasRepaired: boolean;
}

const backupSchema = z.strictObject({
  format: z.literal(LOCAL_PROJECT_BACKUP_FORMAT), version: z.literal(LOCAL_PROJECT_BACKUP_VERSION),
  createdAt: z.iso.datetime({ offset: true }).max(32).refine(value =>
    !value.startsWith('0000-') && !value.endsWith('-00:00') &&
    !/\.\d{4,}/.test(value) && Number.isFinite(Date.parse(value))),
  coverage: z.strictObject({
    layout: z.literal(true), creativeBrief: z.literal(true), eventOperations: z.literal(true),
    materialHandoffs: z.literal(true), reviewedBasis: z.literal(true),
    attachments: z.literal(false), modelFiles: z.literal(false),
  }),
  layout: z.unknown(), brief: backupBriefSchema,
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Compare JSON values without treating object-key order as a data change. */
function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((value, index) => sameJson(value, b[index]));
  }
  if (!isRecord(a) || !isRecord(b)) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(key =>
    Object.prototype.hasOwnProperty.call(b, key) && sameJson(a[key], b[key]));
}

/** Shared execution schemas may fill missing defaults, but no supplied value may disappear or change. */
function retainsJson(input: unknown, output: unknown): boolean {
  if (input === output) return true;
  if (Array.isArray(input) && Array.isArray(output)) {
    return input.length === output.length && input.every((value, index) => retainsJson(value, output[index]));
  }
  if (!isRecord(input) || !isRecord(output)) return false;
  return Object.keys(input).every(key => Object.prototype.hasOwnProperty.call(output, key) &&
    retainsJson(input[key], output[key]));
}

/** Reject values JSON would omit/coerce and custom serializers before they can change a scope or record. */
function assertJsonValues(value: unknown, ancestors = new Set<object>(), depth = 0): void {
  // Legal layout/brief records are shallow; bound malformed in-memory input before recursive checks.
  if (depth > 128) throw new Error('备份资料嵌套过深，不能生成备份。');
  if (value === undefined || value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (!isRecord(value) && !Array.isArray(value)) throw new Error('备份资料包含不支持的 JSON 值。');
  const array = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value);
  if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) {
    throw new Error('备份资料包含不支持的 JSON 对象。');
  }
  if (ancestors.has(value)) throw new Error('备份资料包含循环引用。');
  if (Object.getOwnPropertySymbols(value).length) throw new Error('备份资料包含不支持的 JSON 字段。');
  const keys = Object.keys(value);
  if (array && (keys.length !== value.length || keys.some((key, index) => key !== String(index)))) {
    throw new Error('备份资料包含不支持的 JSON 数组。');
  }
  ancestors.add(value);
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    if (array && key === 'length') continue;
    if (!descriptor.enumerable || !('value' in descriptor) || (array && descriptor.value === undefined)) {
      throw new Error('备份资料包含不支持的 JSON 字段。');
    }
    assertJsonValues(descriptor.value, ancestors, depth + 1);
  }
  ancestors.delete(value);
}

function checkedText(text: string): string {
  if (new TextEncoder().encode(text).byteLength > MAX_LOCAL_PROJECT_BACKUP_BYTES) {
    throw new Error('场景与活动备份超过 8 MiB，未读取或生成文件。');
  }
  return text;
}

function encodeJson(value: unknown): string {
  try {
    return checkedText(JSON.stringify(value, null, 2));
  } catch (error) {
    if (error instanceof TypeError) throw new Error('备份资料无法保存为 JSON，请检查循环引用或不支持的值。');
    throw error;
  }
}

function parseJson(text: string): unknown {
  checkedText(text);
  try { return JSON.parse(text); }
  catch { throw new Error('文件不是有效的 JSON，当前项目未改变。'); }
}

/** Reuse the sole editor parser, but refuse lossy repairs in the new format. */
function checkedLayout(value: unknown, strict: boolean): { layout: RoomLayout; repaired: boolean } {
  const layout = parseStoredLayout(value);
  if (!layout) throw new Error('场景布局或执行资料无效，当前项目未改变。');
  const repaired = !sameJson(value, layout);
  if (strict && !retainsJson(value, layout)) {
    throw new Error('备份布局包含未知字段或需要修复的数据，无法保证完整恢复。');
  }
  return { layout: layoutForExport(layout), repaired };
}

/** Caller supplies a successfully flushed/read snapshot; this never reads storage. */
export function createLocalProjectBackup(
  layout: RoomLayout, snapshot: BackupBriefSnapshot, createdAt = new Date().toISOString(),
): LocalProjectBackup {
  if (snapshot.state !== 'ready') throw new Error('活动需求尚未完成读取或保存，不能生成备份。');
  if (snapshot.scope !== (layout.id ?? 'local')) throw new Error('活动需求与场景项目不一致，不能生成备份。');
  const parsed = backupSchema.safeParse({
    format: LOCAL_PROJECT_BACKUP_FORMAT, version: LOCAL_PROJECT_BACKUP_VERSION, createdAt,
    coverage: LOCAL_PROJECT_BACKUP_COVERAGE, layout, brief: snapshot.brief,
  });
  if (!parsed.success) throw new Error('备份信息或活动需求字段无效，不能生成备份。');
  // Validate the live values before JSON can omit functions or call toJSON.
  assertJsonValues(parsed.data.layout);
  const checked = checkedLayout(parsed.data.layout, true);
  const backup: LocalProjectBackup = { ...parsed.data, layout: checked.layout, brief: parsed.data.brief as BackupBrief };
  // The returned copy is detached and matches the actual file representation.
  return parseJson(encodeJson(backup)) as LocalProjectBackup;
}

/** UTF-8 JSON for the caller's existing download flow. No DOM or storage effects. */
export function serializeLocalProjectBackup(
  layout: RoomLayout, snapshot: BackupBriefSnapshot, createdAt?: string,
): string {
  return encodeJson(createLocalProjectBackup(layout, snapshot, createdAt));
}

/** Validate everything before returning a detached candidate; do not apply it here. */
export function parseLocalProjectBackupJson(text: string): LocalProjectRestoreCandidate {
  const value = parseJson(text);
  if (isRecord(value) && value.format === 'scendance-scene-delivery') {
    throw new Error('这是交付文件，缺少可恢复布局和完整核对依据；请使用场景与活动备份。');
  }
  if (isRecord(value) && ('format' in value || 'version' in value)) {
    if (value.format !== LOCAL_PROJECT_BACKUP_FORMAT) throw new Error('不支持此备份文件格式。');
    if (value.version !== LOCAL_PROJECT_BACKUP_VERSION) throw new Error('不支持此备份文件版本。');
    const parsed = backupSchema.safeParse(value);
    if (!parsed.success) throw new Error('备份信息或活动需求字段无效，当前项目未改变。');
    const checked = checkedLayout(parsed.data.layout, true);
    return { source: 'backup', createdAt: parsed.data.createdAt, layout: checked.layout,
      brief: parsed.data.brief as BackupBrief, layoutWasRepaired: false };
  }
  const checked = checkedLayout(value, false);
  return { source: 'legacy-layout', createdAt: null, layout: checked.layout,
    brief: { status: 'not-in-file' }, layoutWasRepaired: checked.repaired };
}

/** Size is checked before reading, then actual UTF-8 size is checked again. */
export async function readLocalProjectBackupFile(
  file: Pick<File, 'size' | 'text'>,
): Promise<LocalProjectRestoreCandidate> {
  if (!Number.isFinite(file.size) || file.size < 0 || file.size > MAX_LOCAL_PROJECT_BACKUP_BYTES) {
    throw new Error('场景与活动备份文件大小无效或超过 8 MiB，未读取文件。');
  }
  return parseLocalProjectBackupJson(await file.text());
}
