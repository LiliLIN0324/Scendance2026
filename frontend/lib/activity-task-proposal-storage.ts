import { z } from 'zod';
import {
  activityReferenceKey, activityTaskContextSchema, activityTaskRunRequestSchema, activityTaskRunSchema,
  validateActivityTaskResult, type ActivityTaskRun,
} from '../../supabase/functions/_shared/activity-task-contract';
import { canonical, sha256, uuid } from '../../supabase/functions/_shared/domain';
import { eventOperationsLimits, eventOperationsSchema, eventOperationTaskSchema, type EventOperations } from '../../supabase/functions/_shared/event-operations-contract';
import {
  prepareActivityTaskSuggestions, type ActivityTaskAcceptance, type ActivityTaskContext,
  type ActivityTaskSelection, type ActivityTaskSuggestionProposal, type ActivityTaskSuggestionReceipt,
} from './activity-task-suggestions';
import { readSourceRecord, updateSourceForm, type SourceFormKey } from './source-storage';

export type ActivityTaskStorageGuard = () => void;
const localId = z.string().min(1).max(eventOperationsLimits.objectId).refine(id => !!id.trim() && id !== 'local');
const dataKind = eventOperationsSchema.shape.dataKind.unwrap();
const unique = (ids: readonly string[]) => new Set(ids.map(activityReferenceKey)).size === ids.length;
const taskIds = z.array(uuid).min(1).max(eventOperationsLimits.tasks).refine(unique);
const sourceSchema = z.strictObject({ projectId: localId, dataKind, fingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/) });
const identitySchema = z.strictObject({ apiUrl: z.string().url().max(2000), userId: uuid, activityId: localId, remoteProjectId: uuid });
const selectionSchema = z.strictObject({
  briefText: z.string().max(12000), taskIds: z.array(uuid).max(eventOperationsLimits.tasks).refine(unique),
  objectIds: eventOperationTaskSchema.shape.objectIds.unwrap().refine(unique),
});
const contextSchema = z.strictObject({ summary: activityTaskContextSchema, source: sourceSchema });
const proposalSchema = z.strictObject({
  id: uuid, source: sourceSchema, sourceLabel: eventOperationTaskSchema.shape.title,
  tasks: z.array(eventOperationTaskSchema).min(1).max(eventOperationsLimits.tasks).refine(rows => unique(rows.map(row => row.id))),
});
const receiptSchema = z.strictObject({ proposalId: uuid, projectId: localId, acceptedTaskIds: taskIds });
const pendingSchema = z.strictObject({ operations: eventOperationsSchema, receipt: receiptSchema });
const markerSchema = z.strictObject({
  schemaVersion: z.literal(1), identity: identitySchema, requestId: uuid,
  instruction: activityTaskRunRequestSchema.shape.instruction, selection: selectionSchema, context: contextSchema,
  contextHash: z.string().regex(/^[a-f0-9]{64}$/),
  state: z.enum(['requested', 'prepared', 'saving', 'closed', 'cancelled', 'failed']),
  run: activityTaskRunSchema.nullable(), proposal: proposalSchema.nullable(), pending: pendingSchema.nullable(), receipt: receiptSchema.nullable(),
});

export type ActivityTaskRequestIdentity = z.infer<typeof identitySchema>;
export type ActivityTaskRequestMarker = z.infer<typeof markerSchema>;
export interface ActivityTaskRequestInput {
  identity: ActivityTaskRequestIdentity; requestId: string; instruction: string;
  selection: ActivityTaskSelection; context: ActivityTaskContext;
}
export class ActivityTaskReadbackError extends Error {
  readonly committed = true;
  constructor() {
    super('任务建议记录已提交，但读回未确认。请保留原请求编号并重新读取，不要重新发送或重复添加任务。');
    this.name = 'ActivityTaskReadbackError';
  }
}
function fail(message: string): never { throw new Error(message); }
function check(guard: ActivityTaskStorageGuard): void {
  if (typeof guard !== 'function') fail('任务建议需要同步活动身份检查。');
  const result = (guard as () => unknown)();
  if (result !== undefined) fail('任务建议的活动身份检查必须同步且不返回值。');
}
function identityOf(value: ActivityTaskRequestIdentity): ActivityTaskRequestIdentity {
  const parsed = identitySchema.parse(value);
  const url = new URL(parsed.apiUrl);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) fail('任务建议服务地址无效。');
  return { ...parsed, apiUrl: parsed.apiUrl.replace(/\/+$/, ''), userId: parsed.userId.toLowerCase(), remoteProjectId: parsed.remoteProjectId.toLowerCase() };
}
/** One current request per complete service/user/local/remote identity, in the existing forms store. */
export function activityTaskRequestStorageKey(identity: ActivityTaskRequestIdentity): SourceFormKey {
  return ['activity-task-request', canonical(identityOf(identity))];
}
function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return canonical(left.map(activityReferenceKey).sort()) === canonical(right.map(activityReferenceKey).sort());
}
function receiptMatches(proposal: ActivityTaskSuggestionProposal, receipt: ActivityTaskSuggestionReceipt): void {
  if (receipt.projectId !== proposal.source.projectId || activityReferenceKey(receipt.proposalId) !== activityReferenceKey(proposal.id)
    || receipt.acceptedTaskIds.some(id => !proposal.tasks.some(task => activityReferenceKey(task.id) === activityReferenceKey(id)))) fail('任务接纳记录与本次建议不一致。');
}
function checked(identity: ActivityTaskRequestIdentity, value: unknown): ActivityTaskRequestMarker {
  const parsed = markerSchema.safeParse(value);
  if (!parsed.success || canonical(parsed.data) !== canonical(value)) fail('本机任务建议记录无法完整读取，原记录已保留。');
  const marker = parsed.data;
  if (canonical(marker.identity) !== canonical(identity) || canonical(identityOf(marker.identity)) !== canonical(marker.identity)) fail('任务建议记录属于另一活动或账号，未读取或覆盖。');
  const { summary, source } = marker.context;
  if (summary.projectId !== identity.activityId || source.projectId !== identity.activityId || summary.dataKind !== source.dataKind
    || marker.selection.briefText !== summary.briefText || !sameIds(marker.selection.taskIds, summary.tasks.map(task => task.id))
    || !sameIds(marker.selection.objectIds, summary.objects.map(object => object.id))) fail('任务建议的披露内容与本机活动不一致。');
  if (marker.run) {
    const run = marker.run;
    if (run.projectId.toLowerCase() !== identity.remoteProjectId || run.requestId.toLowerCase() !== marker.requestId.toLowerCase()
      || run.activityId !== identity.activityId || run.contextHash !== marker.contextHash) fail('任务建议运行记录与原请求不一致。');
  }
  if (marker.proposal) {
    const proposal = marker.proposal, run = marker.run;
    if (!run || run.state !== 'complete' || canonical(proposal.source) !== canonical(source)) fail('任务建议缺少对应的完整运行结果。');
    const result = validateActivityTaskResult(run.activityResult, summary);
    const content = proposal.tasks.map(task => ({ title: task.title, phase: task.phase, acceptance: task.acceptance, objectIds: task.objectIds }));
    if (canonical(content) !== canonical(result.suggestions) || proposal.tasks.some(task => task.status !== 'todo' || task.ownerName || task.contractorName
      || task.plannedStartAt !== null || task.plannedEndAt !== null || task.actualStartedAt !== null || task.actualFinishedAt !== null
      || task.evidenceNote || task.evidenceUrls.length || task.reviewedBasis !== undefined)) fail('任务建议包含未经确认的执行记录。');
  }
  if (marker.pending) {
    if (!marker.proposal) fail('拟写任务缺少对应建议。');
    receiptMatches(marker.proposal, marker.pending.receipt);
    const selected = new Set(marker.pending.receipt.acceptedTaskIds.map(activityReferenceKey));
    if (marker.pending.operations.dataKind !== source.dataKind || marker.proposal.tasks.some(task => {
      const saved = marker.pending!.operations.tasks.find(row => activityReferenceKey(row.id) === activityReferenceKey(task.id));
      return selected.has(activityReferenceKey(task.id)) ? canonical(saved) !== canonical(task) : saved !== undefined;
    })) fail('拟写任务与人工勾选的建议不一致。');
  }
  if (marker.receipt && (!marker.pending || canonical(marker.receipt) !== canonical(marker.pending.receipt))) fail('已保存回执与拟写任务不一致。');
  if (marker.state === 'requested' && (marker.proposal || marker.pending || marker.receipt || marker.run && !['queued', 'running'].includes(marker.run.state))
    || marker.state === 'prepared' && (!marker.proposal || marker.pending || marker.receipt)
    || marker.state === 'saving' && (!marker.proposal || !marker.pending || marker.receipt)
    || marker.state === 'closed' && (!marker.proposal || !marker.pending || !marker.receipt)
    || marker.state !== 'closed' && marker.receipt) fail('任务建议记录的保存阶段不一致。');
  return marker;
}
export async function readActivityTaskRequest(identity: ActivityTaskRequestIdentity, guard: ActivityTaskStorageGuard): Promise<ActivityTaskRequestMarker | undefined> {
  const own = identityOf(identity); check(guard);
  const raw = await readSourceRecord<unknown>(activityTaskRequestStorageKey(own)); check(guard);
  if (raw === undefined) return undefined;
  const marker = checked(own, raw);
  const hash = await sha256(canonical(marker.context.summary)); check(guard);
  if (hash !== marker.contextHash) fail('任务建议披露摘要与原请求不一致，原记录已保留。');
  return marker;
}
async function readback(identity: ActivityTaskRequestIdentity, committed: ActivityTaskRequestMarker, guard: ActivityTaskStorageGuard): Promise<ActivityTaskRequestMarker> {
  check(guard);
  let current: ActivityTaskRequestMarker | undefined;
  try { current = await readActivityTaskRequest(identity, guard); }
  catch (error) { check(guard); throw error instanceof ActivityTaskReadbackError ? error : new ActivityTaskReadbackError(); }
  check(guard);
  if (!current || canonical(current) !== canonical(committed)) throw new ActivityTaskReadbackError();
  return current;
}
/** Return only after the original marker is committed and read back. POST is the caller's next explicit action. */
export async function beginActivityTaskRequest(input: ActivityTaskRequestInput, guard: ActivityTaskStorageGuard,
  options: { replaceRequestId?: string } = {}): Promise<ActivityTaskRequestMarker> {
  check(guard); const snapshot = structuredClone(input), replaceRequestId = options.replaceRequestId;
  const identity = identityOf(snapshot.identity), context = contextSchema.parse(snapshot.context);
  const hash = await sha256(canonical(context.summary)); check(guard);
  const desired = checked(identity, markerSchema.parse({ schemaVersion: 1, identity, requestId: snapshot.requestId.toLowerCase(),
    instruction: snapshot.instruction, selection: snapshot.selection, context, contextHash: hash,
    state: 'requested', run: null, proposal: null, pending: null, receipt: null }));
  const before = await readActivityTaskRequest(identity, guard); check(guard);
  const committed = await updateSourceForm(activityTaskRequestStorageKey(identity), raw => {
    check(guard);
    if (raw === undefined) {
      if (before || replaceRequestId !== undefined) fail('原任务建议记录已变化，请先重新读取。');
      return desired;
    }
    const current = checked(identity, raw);
    if (!before || current.requestId !== before.requestId || canonical(current.context) !== canonical(before.context) || current.contextHash !== before.contextHash) fail('任务建议已有新请求，请先重新读取。');
    if (current.requestId === desired.requestId) {
      if (current.instruction !== desired.instruction || canonical(current.selection) !== canonical(desired.selection)
        || canonical(current.context) !== canonical(desired.context)) fail('同一请求编号的任务建议内容不同，未重新发送。');
      return current;
    }
    if (!['closed', 'cancelled', 'failed'].includes(current.state) && replaceRequestId?.toLowerCase() !== current.requestId) fail('请先结束原任务，或明确开始一项新的任务建议。');
    return desired;
  }); check(guard);
  return readback(identity, committed, guard);
}
async function change(identity: ActivityTaskRequestIdentity, requestId: string, guard: ActivityTaskStorageGuard,
  update: (current: ActivityTaskRequestMarker) => ActivityTaskRequestMarker): Promise<ActivityTaskRequestMarker> {
  const own = identityOf(identity); uuid.parse(requestId); check(guard);
  const before = await readActivityTaskRequest(own, guard); check(guard);
  if (!before || before.requestId !== requestId.toLowerCase()) fail('没有对应的原任务请求，请先重新读取。');
  const committed = await updateSourceForm(activityTaskRequestStorageKey(own), raw => {
    check(guard);
    const current = checked(own, raw);
    if (current.requestId !== before.requestId || current.contextHash !== before.contextHash || canonical(current.context) !== canonical(before.context)) fail('原任务请求已变化，本次结果未覆盖新记录。');
    const next = checked(own, update(current)); check(guard); return next;
  }); check(guard);
  return readback(own, committed, guard);
}
/** Preparation runs synchronously inside the native transaction, once for this completed request. */
export async function storeActivityTaskRun(identity: ActivityTaskRequestIdentity, requestId: string, rawRun: unknown,
  sourceLabel: string, guard: ActivityTaskStorageGuard): Promise<ActivityTaskRequestMarker> {
  const run: ActivityTaskRun = activityTaskRunSchema.parse(structuredClone(rawRun)); check(guard);
  return change(identity, requestId, guard, current => {
    if (run.projectId.toLowerCase() !== current.identity.remoteProjectId || run.activityId !== current.identity.activityId
      || run.requestId.toLowerCase() !== current.requestId || run.contextHash !== current.contextHash) fail('返回结果与原活动请求不一致。');
    if (current.run && current.run.id !== run.id) fail('原请求对应的运行编号已变化，请先核对。');
    if (current.run?.state === 'complete') {
      if (run.state !== 'complete' || canonical(run.activityResult) !== canonical(current.run.activityResult)) fail('原任务的完整结果已变化，未重新准备建议。');
      return current;
    }
    if (['closed', 'cancelled', 'failed'].includes(current.state)) return current;
    if (run.state === 'complete') {
      const result = validateActivityTaskResult(run.activityResult, current.context.summary);
      const proposal = prepareActivityTaskSuggestions(current.context, result, sourceLabel);
      return { ...current, run, proposal, state: 'prepared' };
    }
    if (current.run?.state === 'running' && run.state === 'queued') return current;
    return { ...current, run, state: run.state === 'failed' || run.state === 'cancelled' ? run.state : 'requested' };
  });
}
/** An accepted helper result is still only a proposed write, retained for recovery with its stable IDs. */
export async function stageActivityTaskAcceptance(identity: ActivityTaskRequestIdentity, requestId: string,
  accepted: Extract<ActivityTaskAcceptance, { status: 'accepted' }>, guard: ActivityTaskStorageGuard): Promise<ActivityTaskRequestMarker> {
  check(guard);
  const pending = pendingSchema.parse(structuredClone({ operations: accepted.operations, receipt: accepted.receipt }));
  if (accepted.status !== 'accepted' || !sameIds(accepted.addedTaskIds, pending.receipt.acceptedTaskIds)) fail('拟写任务与本次接纳结果不一致。');
  return change(identity, requestId, guard, current => {
    if (current.state === 'closed') {
      if (canonical(current.pending) !== canonical(pending)) fail('本批建议已经结束，不能更改勾选项。');
      return current;
    }
    if (current.state === 'saving') {
      if (canonical(current.pending) !== canonical(pending)) fail('本批任务正在核对保存，不能更改拟写内容。');
      return current;
    }
    if (current.state !== 'prepared') fail('当前建议不能确认，请先核对原请求。');
    return { ...current, pending, state: 'saving' };
  });
}
/** Caller supplies the actual completed save's readback; matching a proposed write alone is insufficient. */
export async function closeActivityTaskAcceptance(identity: ActivityTaskRequestIdentity, requestId: string,
  saved: { activityId: string; operations: EventOperations }, guard: ActivityTaskStorageGuard): Promise<ActivityTaskRequestMarker> {
  check(guard); const proof = structuredClone(saved), operations = eventOperationsSchema.parse(proof.operations);
  return change(identity, requestId, guard, current => {
    if (!['saving', 'closed'].includes(current.state) || !current.pending || proof.activityId !== current.identity.activityId
      || canonical(operations) !== canonical(current.pending.operations)) fail('活动任务保存尚未读回确认，拟写记录已保留。');
    return { ...current, receipt: current.pending.receipt, state: 'closed' };
  });
}
export async function finishActivityTaskRequest(identity: ActivityTaskRequestIdentity, requestId: string,
  state: 'cancelled' | 'failed', guard: ActivityTaskStorageGuard): Promise<ActivityTaskRequestMarker> {
  if (!['cancelled', 'failed'].includes(state)) fail('任务建议结束状态无效。');
  return change(identity, requestId, guard, current => {
    if (current.state === 'closed') return current;
    if (state === 'failed' && current.run?.state !== 'failed') fail('原请求尚未确认失败，请按原编号查询，不要重新发送。');
    if (['cancelled', 'failed'].includes(current.state) && current.state !== state) fail('原任务已经结束，请先重新读取。');
    return { ...current, state };
  });
}
