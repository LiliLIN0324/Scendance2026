import { z } from 'zod';
import { productionPlanSchema } from '../../supabase/functions/_shared/production-plan-contract';
import { MAX_LAYOUT_JSON_BYTES, parseStoredLayout } from '../components/room-organizer/lib/schema';
import { layoutForExport } from './layout-export';
import type { CreativeBrief } from '../components/room-organizer/lib/creative-brief';
import type { RoomLayout } from '../components/room-organizer/lib/types';

export const LOCAL_PROJECT_BACKUP_FORMAT = 'scendance-local-project-backup';
export const LOCAL_PROJECT_BACKUP_VERSION = 2;
export const MAX_LOCAL_PROJECT_BACKUP_BYTES = MAX_LAYOUT_JSON_BYTES;

/** Coverage describes editable records, not packaged external resources. */
export const LOCAL_PROJECT_BACKUP_V1_COVERAGE = {
  layout: true, creativeBrief: true, eventOperations: true, materialHandoffs: true,
  reviewedBasis: true, attachments: false, modelFiles: false,
} as const;
export const LOCAL_PROJECT_BACKUP_COVERAGE = { ...LOCAL_PROJECT_BACKUP_V1_COVERAGE, productionPlan: true } as const;

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
  /** Legacy layouts have no envelope version; old V1 has no production-plan coverage. */
  backupVersion?: 1 | 2;
  createdAt: string | null;
  layout: RoomLayout;
  /** A legacy layout says nothing about the browser's current or former brief. */
  brief: BackupBrief | { status: 'not-in-file' };
  /** Existing legacy geometry repair must be shown before applying a candidate. */
  layoutWasRepaired: boolean;
}

const envelopeFields = {
  format: z.literal(LOCAL_PROJECT_BACKUP_FORMAT),
  createdAt: z.iso.datetime({ offset: true }).max(32).refine(value =>
    !value.startsWith('0000-') && !value.endsWith('-00:00') &&
    !/\.\d{4,}/.test(value) && Number.isFinite(Date.parse(value))),
  layout: z.unknown(), brief: backupBriefSchema,
};
const coverageFields = {
  layout: z.literal(true), creativeBrief: z.literal(true), eventOperations: z.literal(true),
  materialHandoffs: z.literal(true), reviewedBasis: z.literal(true),
  attachments: z.literal(false), modelFiles: z.literal(false),
};
const backupV1Schema = z.strictObject({
  ...envelopeFields, version: z.literal(1), coverage: z.strictObject(coverageFields),
});
const backupSchema = z.strictObject({
  ...envelopeFields, version: z.literal(LOCAL_PROJECT_BACKUP_VERSION),
  coverage: z.strictObject({ ...coverageFields, productionPlan: z.literal(true) }),
});
const candidateFields = { layout: z.unknown(), layoutWasRepaired: z.boolean() };
const candidateSchema = z.discriminatedUnion('source', [
  z.strictObject({ ...candidateFields, source: z.literal('backup'),
    backupVersion: z.union([z.literal(1), z.literal(2)]).optional(),
    createdAt: envelopeFields.createdAt, brief: backupBriefSchema }),
  z.strictObject({ ...candidateFields, source: z.literal('legacy-layout'),
    backupVersion: z.undefined().optional(), createdAt: z.null(),
    brief: z.strictObject({ status: z.literal('not-in-file') }) }),
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Only visit actual layout/variant slots; do not invent a parallel layout schema. */
function layoutRecords(value: unknown): Record<string, unknown>[] {
  const pending = [value], records: Record<string, unknown>[] = [], seen = new Set<object>();
  while (pending.length) {
    const next = pending.pop();
    if (!isRecord(next) || seen.has(next)) continue;
    seen.add(next); records.push(next);
    if (isRecord(next.designBook) && Array.isArray(next.designBook.variants)) {
      for (const variant of next.designBook.variants) if (isRecord(variant)) pending.push(variant.layout);
    }
  }
  return records;
}

function validateProductionPlans(value: unknown, forbid = false): void {
  for (const layout of layoutRecords(value)) {
    if (forbid && Object.prototype.hasOwnProperty.call(layout, 'productionPlan')) {
      throw new Error('V1 备份未覆盖制作计划，不能在旧版本中混入新资料，请使用 V2 备份。');
    }
    if (layout.productionPlan !== undefined && !productionPlanSchema.safeParse(layout.productionPlan).success) {
      throw new Error('制作计划字段或金额无效，当前项目未改变。');
    }
  }
}

function objectIdsInLayout(layout: Record<string, unknown>): unknown[] {
  const items = Array.isArray(layout.floors) ? layout.floors.flatMap(floor =>
    isRecord(floor) && Array.isArray(floor.items) ? floor.items : []) : layout.items;
  return Array.isArray(items) ? items.map(item => isRecord(item) ? item.id : undefined) : [];
}

function taskIdsInLayout(layout: Record<string, unknown>): unknown[] {
  return isRecord(layout.eventOperations) && Array.isArray(layout.eventOperations.tasks)
    ? layout.eventOperations.tasks.map(task => isRecord(task) ? task.id : undefined) : [];
}

/** Legacy repair must not drop plans or turn a missing reference into a new association. */
function assertProductionPlansRetained(input: unknown, output: RoomLayout): void {
  const source = layoutRecords(input), restored = layoutRecords(output);
  for (let index = 0; index < source.length; index++) {
    const before = source[index]!, after = restored[index];
    if (!after) throw new Error('制作计划所在方案未完整保留，当前项目未改变。');
    const hasPlan = before.productionPlan !== undefined;
    if (hasPlan !== (after.productionPlan !== undefined) ||
        (hasPlan && (!retainsJson(before.productionPlan, after.productionPlan) || before.id !== after.id ||
          !sameJson(objectIdsInLayout(before), objectIdsInLayout(after)) ||
          !sameJson(taskIdsInLayout(before), taskIdsInLayout(after)) ||
          (Array.isArray(before.floors) && !sameJson(before.floors.map(floor => isRecord(floor) ? floor.id : undefined),
            Array.isArray(after.floors) ? after.floors.map(floor => isRecord(floor) ? floor.id : undefined) : []))))) {
      throw new Error('制作计划或关联编号需要修复，无法保证完整恢复。');
    }
  }
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
  validateProductionPlans(value);
  const layout = parseStoredLayout(value);
  if (!layout) throw new Error('场景布局或执行资料无效，当前项目未改变。');
  assertProductionPlansRetained(value, layout);
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

/** Revalidate mutable/direct candidates without silently upgrading an explicitly declared V1 source. */
export function validateLocalProjectRestoreCandidate(candidate: unknown): LocalProjectRestoreCandidate {
  if (isRecord(candidate) && candidate.backupVersion !== undefined &&
      candidate.backupVersion !== 1 && candidate.backupVersion !== 2) {
    throw new Error('不支持此恢复候选的备份版本。');
  }
  const parsed = candidateSchema.safeParse(candidate);
  if (!parsed.success || !isRecord(parsed.data.layout)) {
    throw new Error('备份候选格式无效，请重新选择文件。');
  }
  const candidateLayout = parsed.data.layout;
  const input = parsed.data;
  // Old callers may omit provenance. Validate current complete data, but do not fabricate a source version.
  const backup = createLocalProjectBackup(candidateLayout as unknown as RoomLayout, {
    state: 'ready', scope: typeof candidateLayout.id === 'string' ? candidateLayout.id : 'local',
    brief: input.brief.status === 'present' ? input.brief as BackupBrief : { status: 'absent' },
  }, input.createdAt ?? undefined);
  if (input.source === 'legacy-layout') {
    return { source: input.source, createdAt: null, layout: backup.layout,
      brief: { status: 'not-in-file' }, layoutWasRepaired: input.layoutWasRepaired };
  }
  if (input.backupVersion === 1) validateProductionPlans(backup.layout, true);
  return { source: input.source, ...(input.backupVersion === undefined ? {} : { backupVersion: input.backupVersion }),
    createdAt: backup.createdAt, layout: backup.layout, brief: backup.brief, layoutWasRepaired: input.layoutWasRepaired };
}

/** Validate everything before returning a detached candidate; do not apply it here. */
export function parseLocalProjectBackupJson(text: string): LocalProjectRestoreCandidate {
  const value = parseJson(text);
  if (isRecord(value) && value.format === 'scendance-scene-delivery') {
    throw new Error('这是交付文件，缺少可恢复布局和完整核对依据；请使用场景与活动备份。');
  }
  if (isRecord(value) && ('format' in value || 'version' in value)) {
    if (value.format !== LOCAL_PROJECT_BACKUP_FORMAT) throw new Error('不支持此备份文件格式。');
    if (value.version !== 1 && value.version !== LOCAL_PROJECT_BACKUP_VERSION) throw new Error('不支持此备份文件版本。');
    const parsed = value.version === 1 ? backupV1Schema.safeParse(value) : backupSchema.safeParse(value);
    if (!parsed.success) throw new Error('备份信息或活动需求字段无效，当前项目未改变。');
    if (parsed.data.version === 1) validateProductionPlans(parsed.data.layout, true);
    const checked = checkedLayout(parsed.data.layout, true);
    return { source: 'backup', backupVersion: parsed.data.version, createdAt: parsed.data.createdAt, layout: checked.layout,
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
