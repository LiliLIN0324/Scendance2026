import { uuid as uuidSchema } from '../../supabase/functions/_shared/domain';
import { eventOperationsSchema, type EventOperations } from '../../supabase/functions/_shared/event-operations-contract';
import { productionPlanSchema, type ProductionPlan } from '../../supabase/functions/_shared/production-plan-contract';
import { listSourceRecords, readSourceRecord, updateSourceForm, deleteSourceForm, type SourceFormKey, type SourceWriteGuard } from './source-storage';

/**
 * 侧车独立记录桶（D6-2 纯层）：活动安排 / 制作计划各为一条独立本机记录，
 * plan 正源只存记录引用 id（operationsRef? / planRef?），不整包塞 eventOperations / productionPlan。
 *
 * 口径（用户 P3 拍板）：
 * - 先存独立记录成功，再把 ref 写回 plan，不留悬空引用（写回编排归 D6-2 集成片，本批只提供纯层）；
 * - 双读回落：ref 命中独立记录走记录；ref 缺失回退调用方传入的旧整包字段（只读语义由调用方保证）；
 * - 异 projectId 隔离不并入；ref 指向找不到 / 属别的项目 → missing，绝不静默替换成当前最新记录；
 * - 本机本地记录，不进 Edge / DB 契约，不发布。
 *
 * 存储复用 `source-storage` 的 IndexedDB forms 桶元组键；不照搬 localStorage 前缀写法。
 */

export type SidecarKind = 'operations' | 'plan';

/** 侧车记录信封：`id` 即 plan 引用的 ref id；`data` 按 kind 走对应契约 schema 校验。 */
export interface SidecarRecord {
  id: string;
  projectId: string;
  kind: SidecarKind;
  data: EventOperations | ProductionPlan;
  savedAt: string;
}

export type SidecarResolveResult =
  | { status: 'record'; record: SidecarRecord; data: EventOperations | ProductionPlan }
  | { status: 'fallback-legacy'; data: EventOperations | ProductionPlan | undefined }
  | { status: 'missing' };

const SIDECAR_SCHEMAS: Record<SidecarKind, typeof eventOperationsSchema | typeof productionPlanSchema> = {
  operations: eventOperationsSchema,
  plan: productionPlanSchema,
};

const SIDECAR_NAMESPACES: Record<SidecarKind, string> = {
  operations: 'event-operations-record',
  plan: 'production-plan-record',
};

function sidecarKey(kind: SidecarKind, recordId: string): SourceFormKey {
  return [SIDECAR_NAMESPACES[kind], recordId];
}

function newRecordId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `sidecar-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** 信封外层结构校验；`data` 再按记录 kind 走对应契约 schema。属别的项目返回 null，损坏抛错。 */
function parseEnvelope(raw: unknown, expectedProjectId: string, expectedKind?: SidecarKind): SidecarRecord | null {
  if (raw === null || typeof raw !== 'object') throw new Error('侧车记录无法完整读取，原资料已保留，请先核对备份。');
  const envelope = raw as Record<string, unknown>;
  if (typeof envelope.id !== 'string' || !uuidSchema.safeParse(envelope.id).success) {
    throw new Error('侧车记录编号无效，原资料已保留。');
  }
  if (typeof envelope.projectId !== 'string' || !envelope.projectId.trim()) {
    throw new Error('侧车记录缺少项目编号，原资料已保留。');
  }
  if (envelope.projectId !== expectedProjectId) return null; // 属别的项目：隔离不串台
  const kind = envelope.kind as SidecarKind;
  if (kind !== 'operations' && kind !== 'plan') throw new Error('侧车记录类型无效，原资料已保留。');
  if (expectedKind !== undefined && kind !== expectedKind) return null;
  if (typeof envelope.savedAt !== 'string' || !envelope.savedAt.trim()) {
    throw new Error('侧车记录缺少保存时间，原资料已保留。');
  }
  const checked = SIDECAR_SCHEMAS[kind].safeParse(envelope.data);
  if (!checked.success) throw new Error('侧车记录资料无法完整读取，原资料已保留，请先核对备份。');
  return { id: envelope.id, projectId: envelope.projectId, kind, data: checked.data, savedAt: envelope.savedAt };
}

/** 校验入参项目编号；空 / 超长不写半成品。 */
function requireProjectId(projectId: string): string {
  const id = projectId.trim();
  if (!id || id.length > 160) throw new Error('请先保存有明确编号的本地项目，再保存活动安排或制作计划。');
  return id;
}

/**
 * 保存一条侧车记录：先过契约校验与项目一致性，再写入；校验失败抛结构化错误，不落半成品。
 * 返回记录编号与回读信封，供上层把 ref 写回 plan。
 */
export async function saveSidecarRecord(
  projectId: string,
  kind: 'operations',
  data: EventOperations,
): Promise<{ recordId: string; record: SidecarRecord }>;
export async function saveSidecarRecord(
  projectId: string,
  kind: 'plan',
  data: ProductionPlan,
): Promise<{ recordId: string; record: SidecarRecord }>;
export async function saveSidecarRecord(
  projectId: string,
  kind: SidecarKind,
  data: EventOperations | ProductionPlan,
): Promise<{ recordId: string; record: SidecarRecord }> {
  const scopeId = requireProjectId(projectId);
  const checked = SIDECAR_SCHEMAS[kind].safeParse(data);
  if (!checked.success) throw new Error('活动安排或制作计划资料无效，未保存。');
  const record: SidecarRecord = {
    id: newRecordId(),
    projectId: scopeId,
    kind,
    data: checked.data,
    savedAt: new Date().toISOString(),
  };
  await updateSourceForm(sidecarKey(kind, record.id), () => record);
  return { recordId: record.id, record };
}

/**
 * 按记录编号读取。记录属别的项目 → 视为不存在（异 id 不并入、不报错串台）；
 * 信封 / 资料损坏按读取错误抛出，不吞。
 */
export async function readSidecarRecord(
  projectId: string,
  kind: SidecarKind,
  recordId: string,
): Promise<SidecarRecord | undefined> {
  const scopeId = requireProjectId(projectId);
  const id = recordId.trim();
  if (!id) return undefined;
  const raw = await readSourceRecord<unknown>(sidecarKey(kind, id));
  if (raw === undefined) return undefined;
  const envelope = parseEnvelope(raw, scopeId, kind);
  return envelope ?? undefined;
}

/** 列该项目该类记录，按 savedAt 倒序；异 id / 损坏条目不进列表（单条读取路径仍会报错）。 */
export async function listSidecarRecords(projectId: string, kind: SidecarKind): Promise<SidecarRecord[]> {
  const scopeId = requireProjectId(projectId);
  const records: SidecarRecord[] = [];
  const entries = await listSourceRecords<unknown>(SIDECAR_NAMESPACES[kind]);
  for (const entry of entries) {
    try {
      const envelope = parseEnvelope(entry.value, scopeId, kind);
      if (envelope) records.push(envelope);
    } catch {
      // 损坏条目不阻塞整份列表；上层按需按单条读取定位报错。
    }
  }
  return records.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

/**
 * 删除一条侧车记录（T1 纯层）：先归属校验，通过再删 forms 桶本条 key。
 * - 空/空白 id、记录不存在 → 幂等 resolve，不抛；
 * - 信封属别 projectId 或 kind 不符 → 拒绝删除（不串台、不删别项目记录），抛结构化错误；
 * - 信封损坏 / 编号无效 → 按读取错误抛出，不吞；
 * - 只删本条 key，不连带同项目其他 kind 或其他记录。
 */
export async function deleteSidecarRecord(
  projectId: string,
  kind: SidecarKind,
  recordId: string,
  guard?: SourceWriteGuard,
): Promise<void> {
  const scopeId = requireProjectId(projectId);
  const id = recordId?.trim();
  if (!id) return;
  const raw = await readSourceRecord<unknown>(sidecarKey(kind, id));
  if (raw === undefined) return;
  const envelope = parseEnvelope(raw, scopeId, kind);
  if (!envelope) throw new Error('记录属别的项目或类型，不能删除，原资料已保留。');
  await deleteSourceForm(sidecarKey(kind, id), guard);
}

/**
 * 解析 plan 引用：
 * - `record`：ref 命中独立记录；
 * - `fallback-legacy`：ref 为空 / 空白，用调用方传入的旧整包字段（只读语义由调用方保证）；
 * - `missing`：ref 存在但记录找不到 / 属别的项目；不静默替换成当前最新记录，由上层标「原方案未找到 / 已变动，待核」。
 */
export async function resolveSidecarRef(input: {
  projectId: string;
  kind: SidecarKind;
  refId: string | undefined;
  legacyFallback: EventOperations | ProductionPlan | undefined;
}): Promise<SidecarResolveResult> {
  const scopeId = requireProjectId(input.projectId);
  const refId = input.refId?.trim();
  if (!refId) return { status: 'fallback-legacy', data: input.legacyFallback };
  const record = await readSidecarRecord(scopeId, input.kind, refId);
  if (!record) return { status: 'missing' };
  return { status: 'record', record, data: record.data };
}

export interface BackupSidecarLookup {
  projectId: string;
  kind: SidecarKind;
  refId: string | undefined;
  /** 本机 IDB 已读出的记录（或 undefined）。 */
  localRecord: SidecarRecord | undefined;
  /** 备份信封内嵌的冻结副本（或 undefined）。 */
  packetRecord: SidecarRecord | undefined;
  legacyFallback: EventOperations | ProductionPlan | undefined;
}

/**
 * 备份 / 离线恢复双读回落（D6-4-2，拍板 4.1）：纯函数、不碰存储。
 * - ref 为空 → 旧整包字段回落（fallback-legacy）；
 * - ref 存在 → 本机记录命中（同项目 / 同 id / 同槽位）先用本机，否则包内冻结副本命中用包内；
 * - 两者都没有 → missing，由上层标「待核」，不阻断载入，绝不静默替换成当前最新记录。
 * 异 projectId / 异 id / 异槽位的记录视同缺失，不并入当前草稿。
 */
export function resolveBackupSidecar(input: BackupSidecarLookup): SidecarResolveResult {
  const scopeId = input.projectId.trim();
  const refId = input.refId?.trim();
  if (!refId) return { status: 'fallback-legacy', data: input.legacyFallback };
  const matches = (record: SidecarRecord | undefined): record is SidecarRecord =>
    !!record && record.projectId === scopeId && record.id === refId && record.kind === input.kind;
  if (matches(input.localRecord)) return { status: 'record', record: input.localRecord, data: input.localRecord.data };
  if (matches(input.packetRecord)) return { status: 'record', record: input.packetRecord, data: input.packetRecord.data };
  return { status: 'missing' };
}

/** 可注入当前草稿的侧车投影形状（T1 E2 纯层；接线到独占恢复编排归 S2，本轮不接）。 */
export interface SidecarDraftProjection {
  operations?: EventOperations;
  plan?: ProductionPlan;
  /** 记录缺失 / 属别项目的槽位：标「待核」，不塞空壳、不粗算条数。 */
  missingKinds: SidecarKind[];
  /** 是否有任一槽位回落自旧整包内嵌副本（只读语义，由上层标注）。 */
  legacyUsed: boolean;
}

/**
 * 把两个槽位的解析三态投影成草稿可消费的形状：
 * - `record`：取独立记录数据；
 * - `fallback-legacy`：取旧内嵌副本数据并标 `legacyUsed`（只读）；旧副本为空则不塞；
 * - `missing`：进 `missingKinds`，不填数据、不替换成当前最新记录。
 * 双读回落顺序（本机 > 包内冻结副本）仍由 `resolveBackupSidecar` 负责，本函数只消费三态。
 */
export function projectSidecarDraft(input: {
  operations?: SidecarResolveResult;
  plan?: SidecarResolveResult;
}): SidecarDraftProjection {
  const projection: SidecarDraftProjection = { missingKinds: [], legacyUsed: false };
  const slots: Array<{ kind: SidecarKind; result?: SidecarResolveResult | undefined; key: 'operations' | 'plan' }> = [
    { kind: 'operations', result: input.operations, key: 'operations' },
    { kind: 'plan', result: input.plan, key: 'plan' },
  ];
  for (const slot of slots) {
    const result = slot.result;
    if (!result) continue;
    if (result.status === 'record') {
      projection[slot.key] = result.data as never;
    } else if (result.status === 'fallback-legacy') {
      if (result.data !== undefined) {
        projection[slot.key] = result.data as never;
        projection.legacyUsed = true;
      }
    } else {
      projection.missingKinds.push(slot.kind);
    }
  }
  return projection;
}
