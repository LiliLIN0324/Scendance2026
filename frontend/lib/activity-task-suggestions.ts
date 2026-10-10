import { z } from 'zod';
import { agentContextSchema } from '../../supabase/functions/_shared/agent-contract';
import { canonical, sha256, uuid } from '../../supabase/functions/_shared/domain';
import { eventOperationsLimits, eventOperationsSchema, eventOperationTaskSchema, type EventOperations, type EventOperationTask } from '../../supabase/functions/_shared/event-operations-contract';
import { createOperation, operationBasis, operationReview } from '../components/room-organizer/lib/event-operations';
import { materialCheckinTaskBasis } from './material-checkin-basis';
import { productionObjectBasis, productionReferenceKey, productionTaskBasis } from './production-plan';
import type { MaterialCheckinLedger } from '../../supabase/functions/_shared/material-checkin-contract';
import type { FurnitureItem, RoomLayout } from '../components/room-organizer/lib/types';

export interface ActivityTaskSelection {
  briefText: string;
  taskIds: readonly string[];
  objectIds: readonly string[];
}
export interface ActivityTaskSuggestionInput {
  layout: RoomLayout;
  selection: ActivityTaskSelection;
  checkins?: MaterialCheckinLedger;
  /** Required for a new activity without EventOperations; existing records keep their own kind. */
  dataKind?: EventOperations['dataKind'];
}
export interface ActivityTaskSource {
  projectId: string;
  dataKind: EventOperations['dataKind'];
  /** Local change detection only, never a fact check or an authorization token. */
  fingerprint: string;
}
export interface ActivityTaskContext {
  /** Only this explicit whitelist is suitable for a user-reviewed model input. Text is not redacted. */
  summary: {
    projectId: string;
    dataKind: EventOperations['dataKind'];
    briefText: string;
    tasks: (Pick<EventOperationTask, 'id' | 'title' | 'phase' | 'acceptance' | 'plannedStartAt' | 'plannedEndAt' | 'objectIds'> & {
      status: EventOperationTask['status'] | 'needs_review';
    })[];
    objects: {
      id: string; name: string; type: string; floorId: string; floorName: string;
      size: { width: number; depth: number; height: number }; color: string;
      position: FurnitureItem['position'] | null; rotation: number | null; elevation: number | null;
    }[];
  };
  source: ActivityTaskSource;
}
export interface ActivityTaskSuggestionProposal {
  id: string;
  source: ActivityTaskSource;
  sourceLabel: string;
  tasks: EventOperationTask[];
}
export interface ActivityTaskSuggestionReceipt {
  proposalId: string;
  projectId: string;
  acceptedTaskIds: string[];
}
/** `accepted` is a proposed local write, not a persistence acknowledgement. */
export type ActivityTaskAcceptance = {
  status: 'accepted'; operations: EventOperations; addedTaskIds: string[]; receipt: ActivityTaskSuggestionReceipt;
} | {
  status: 'closed'; operations: EventOperations | undefined; addedTaskIds: string[]; receipt: ActivityTaskSuggestionReceipt;
};

const key = productionReferenceKey;
const unique = (ids: readonly string[]) => new Set(ids.map(key)).size === ids.length;
const projectIdSchema = z.string().min(1).max(eventOperationsLimits.objectId).refine(id => !!id.trim() && id !== 'local');
const dataKindSchema = eventOperationsSchema.shape.dataKind.unwrap();
const taskIdsSchema = z.array(uuid).max(eventOperationsLimits.tasks).refine(unique);
const objectIdsSchema = eventOperationTaskSchema.shape.objectIds.unwrap().refine(unique);
const selectionSchema = z.strictObject({ briefText: agentContextSchema.shape.brief.unwrap(), taskIds: taskIdsSchema, objectIds: objectIdsSchema });
const sourceSchema = z.strictObject({ projectId: projectIdSchema, dataKind: dataKindSchema, fingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/) });
const suggestionSchema = z.strictObject({
  title: eventOperationTaskSchema.shape.title, phase: eventOperationTaskSchema.shape.phase,
  acceptance: eventOperationTaskSchema.shape.acceptance.unwrap().min(1), objectIds: objectIdsSchema.default([]),
});
const responseSchema = z.strictObject({ suggestions: z.array(suggestionSchema).min(1).max(eventOperationsLimits.tasks)
  .refine(rows => new Set(rows.map(row => canonical({ ...row, objectIds: row.objectIds.map(key).sort() }))).size === rows.length) });
const receiptSchema = z.strictObject({ proposalId: uuid, projectId: projectIdSchema, acceptedTaskIds: taskIdsSchema.min(1) });

function read<T>(schema: z.ZodType<T>, value: unknown, message: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new Error(message);
  return parsed.data;
}
function operationsFor(input: ActivityTaskSuggestionInput): EventOperations {
  const chosen = input.dataKind === undefined ? undefined : read(dataKindSchema, input.dataKind, '请检查活动资料性质。');
  if (input.layout.eventOperations === undefined) {
    if (chosen === undefined) throw new Error('请先选择活动资料性质，再准备任务建议。');
    return eventOperationsSchema.parse({ dataKind: chosen, tasks: [] });
  }
  const operations = read(eventOperationsSchema, input.layout.eventOperations, '当前活动安排无法读取，请先检查或重新载入。');
  if (chosen !== undefined && chosen !== operations.dataKind) throw new Error('活动资料性质已变化，请重新核对。');
  return operations;
}
function disclosedObjects(layout: RoomLayout, ids: readonly string[]) {
  const index = new Map<string, { floorId: string; floorName: string; item: FurnitureItem }[]>();
  for (const floor of layout.floors) for (const item of floor.items) {
    index.set(key(item.id), [...(index.get(key(item.id)) ?? []), { floorId: floor.id, floorName: floor.name, item }]);
  }
  return ids.map(id => {
    const matches = index.get(key(id));
    if (!matches?.length || matches.length !== 1) throw new Error('所选物件缺失或编号重复，请先核对场景。');
    const found = matches[0], item = found.item;
    if (![item.width, item.depth, item.height].every(value => Number.isFinite(value) && value >= 0)) {
      throw new Error('请先检查所选物件的尺寸。');
    }
    return found;
  });
}

/** Capture synchronously before any review/hash awaits; never mutate or persist the live inputs. */
export async function buildActivityTaskContext(input: ActivityTaskSuggestionInput): Promise<ActivityTaskContext> {
  const snapshot = structuredClone(input);
  const projectId = read(projectIdSchema, snapshot.layout.id, '请先保存活动编号，再准备任务建议。');
  const selection = read(selectionSchema, snapshot.selection, '请检查选定的需求、任务和物件。');
  const operations = operationsFor(snapshot), layout = { ...snapshot.layout, eventOperations: operations };
  const tasks = selection.taskIds.map(id => {
    const task = operations.tasks.find(row => key(row.id) === key(id));
    if (!task || !unique(task.objectIds)) throw new Error('所选任务缺失或关联编号重复，请先核对活动安排。');
    return task;
  });
  const objects = disclosedObjects(layout, selection.objectIds);
  const disclosed = new Map(objects.map(({ item }) => [key(item.id), item.id]));
  const objectProduction = objects.map(({ item }) => ({ id: key(item.id), basis: productionObjectBasis(layout.productionPlan, item.id) }))
    .filter(row => row.basis !== null).sort((a, b) => a.id.localeCompare(b.id));
  const productionUsed = tasks.some(task => productionTaskBasis(layout.productionPlan, task.id, task.objectIds) !== null)
    || objectProduction.length > 0;
  if (productionUsed && layout.productionPlan!.dataKind !== operations.dataKind) throw new Error('相关制作资料与活动安排性质不同，请先核对。');
  const relatedTaskIds = new Set(tasks.map(task => key(task.id))), relatedObjectIds = new Set(tasks.flatMap(task => task.objectIds.map(key)));
  const relatedAcquisitions = new Set((layout.productionPlan?.acquisitions ?? []).filter(row =>
    row.taskIds.some(id => relatedTaskIds.has(key(id))) || row.objectIds.some(id => relatedObjectIds.has(key(id)))).map(row => key(row.id)));
  const relatedCheckins = relatedAcquisitions.size > 0 && snapshot.checkins?.sheets.some(sheet => relatedAcquisitions.has(key(sheet.acquisitionId)))
    ? snapshot.checkins : undefined;
  const checkinsUsed = tasks.some(task => materialCheckinTaskBasis(layout, task, relatedCheckins) !== null);
  if (checkinsUsed && snapshot.checkins!.dataKind !== operations.dataKind) throw new Error('相关点验资料与活动安排性质不同，请先核对。');
  const checkins = checkinsUsed ? snapshot.checkins : undefined;
  const reviews = await Promise.all(tasks.map(async task => ({ task, review: await operationReview(layout, task, checkins), basis: await operationBasis(layout, task, checkins) })));
  const summary: ActivityTaskContext['summary'] = {
    projectId, dataKind: operations.dataKind, briefText: selection.briefText,
    tasks: reviews.map(({ task, review }) => ({ id: task.id, title: task.title, phase: task.phase, acceptance: task.acceptance,
      plannedStartAt: task.plannedStartAt, plannedEndAt: task.plannedEndAt, status: review.status,
      objectIds: task.objectIds.flatMap(id => disclosed.has(key(id)) ? [disclosed.get(key(id))!] : []),
    })),
    objects: objects.map(({ floorId, floorName, item }) => ({ id: item.id, name: item.name, type: item.type, floorId, floorName,
      size: { width: item.width, depth: item.depth, height: item.height }, color: item.color,
      position: item.position ?? null, rotation: item.rotation ?? null, elevation: item.elevation ?? null,
    })),
  };
  const physical = objects.map(({ floorId, floorName, item }) => {
    const basis: Record<string, unknown> = { ...item };
    for (const field of ['icon', 'price', 'category', 'groupId']) delete basis[field];
    if (item.assetId) delete basis.glbUrl;
    return { floorId, floorName, item: basis };
  }).sort((a, b) => key(String(a.item.id)).localeCompare(key(String(b.item.id))));
  const fingerprint = 'sha256:' + await sha256(canonical({ projectId, dataKind: operations.dataKind,
    hasOperations: snapshot.layout.eventOperations !== undefined, operations,
    selection: { briefText: selection.briefText, taskIds: selection.taskIds.map(key).sort(), objectIds: selection.objectIds.map(key).sort() },
    physical, objectProduction, taskBasis: reviews.map(({ task, basis }) => ({ id: key(task.id), basis })).sort((a, b) => a.id.localeCompare(b.id)),
  }));
  return { summary, source: { projectId, dataKind: operations.dataKind, fingerprint } };
}

/** Validate the entire synthetic/model payload before assigning fresh, stable local draft identities. */
export function prepareActivityTaskSuggestions(context: ActivityTaskContext, response: unknown, sourceLabel: string): ActivityTaskSuggestionProposal {
  const source = read(sourceSchema, context.source, '建议来源无法读取，请按当前资料重新准备。');
  if (context.summary.projectId !== source.projectId || context.summary.dataKind !== source.dataKind) throw new Error('建议与当前活动来源不一致。');
  const label = read(eventOperationTaskSchema.shape.title, sourceLabel, '请填写建议来源说明。');
  const { suggestions } = read(responseSchema, response, '建议内容不完整或超出允许范围，请重新准备。');
  const objects = new Map<string, string>();
  for (const item of context.summary.objects) {
    if (objects.has(key(item.id))) throw new Error('建议来源的物件编号重复，请先核对。');
    objects.set(key(item.id), item.id);
  }
  const referenced = suggestions.map(suggestion => ({ ...suggestion, objectIds: suggestion.objectIds.map(id => {
    const original = objects.get(key(id));
    if (!original) throw new Error('建议引用了未选定的物件，请重新核对。');
    return original;
  }) }));
  const tasks = referenced.map(suggestion => ({ ...createOperation(suggestion.title, suggestion.phase), acceptance: suggestion.acceptance, objectIds: suggestion.objectIds }));
  if (!unique(tasks.map(task => task.id))) throw new Error('建议编号重复，请重新准备。');
  return { id: crypto.randomUUID(), source, sourceLabel: label, tasks };
}

/**
 * Check the supplied snapshot against the proposal; edits made by the caller during awaits are not observed.
 * After this resolves and before applying/saving, the UI must recheck its live scope epoch, immutable layout/ref
 * and relevant selected-input baseline. `accepted` does not mean saved; retain the receipt and close the batch
 * only after verified persistence. This module has no live-state callback or storage responsibility.
 */
export async function acceptActivityTaskSuggestions(
  input: ActivityTaskSuggestionInput, proposal: ActivityTaskSuggestionProposal, selectedTaskIds: readonly string[], confirmedReceipt?: ActivityTaskSuggestionReceipt,
): Promise<ActivityTaskAcceptance> {
  const snapshot = structuredClone(input), candidate = structuredClone(proposal);
  const projectId = read(projectIdSchema, snapshot.layout.id, '请先保存活动编号，再接纳任务建议。');
  const source = read(sourceSchema, candidate.source, '建议来源无法读取，请重新准备。');
  const proposalId = read(uuid, candidate.id, '建议编号无法读取，请重新准备。');
  if (projectId !== source.projectId) throw new Error('活动已切换，请按当前资料重新准备建议。');
  const selected = read(taskIdsSchema.min(1), selectedTaskIds, '请勾选有效的任务建议，不能重复选择。');
  const drafts = read(z.array(eventOperationTaskSchema).min(1).max(eventOperationsLimits.tasks).refine(rows => unique(rows.map(row => row.id))), candidate.tasks, '任务建议无法读取，请重新准备。');
  const draftIds = new Set(drafts.map(task => key(task.id)));
  if (selected.some(id => !draftIds.has(key(id)))) throw new Error('勾选项不属于本次建议，请重新核对。');
  if (confirmedReceipt !== undefined) {
    const receipt = read(receiptSchema, confirmedReceipt, '接纳记录无法读取，请重新核对。');
    if (receipt.projectId !== projectId || key(receipt.proposalId) !== key(proposalId) || receipt.acceptedTaskIds.some(id => !draftIds.has(key(id)))) {
      throw new Error('接纳记录与本次建议不一致。');
    }
    if (canonical(receipt.acceptedTaskIds.map(key).sort()) !== canonical(selected.map(key).sort())) throw new Error('本批建议已结束，请按当前资料重新准备。');
    const operations = snapshot.layout.eventOperations === undefined ? undefined
      : read(eventOperationsSchema, snapshot.layout.eventOperations, '当前活动安排无法读取，请先检查或重新载入。');
    return { status: 'closed', operations, addedTaskIds: [], receipt };
  }
  const operations = operationsFor(snapshot), existing = new Set(operations.tasks.map(task => key(task.id)));
  if (drafts.some(task => existing.has(key(task.id)))) throw new Error('建议编号已存在，请核对保存结果，不要重复添加。');
  const current = await buildActivityTaskContext(snapshot);
  if (current.source.fingerprint !== source.fingerprint || current.source.dataKind !== source.dataKind) throw new Error('活动资料已变化，请按当前内容重新准备建议。');
  const allowed = new Set(current.summary.objects.map(item => key(item.id)));
  if (drafts.some(task => task.status !== 'todo' || task.ownerName || task.contractorName || task.plannedStartAt !== null || task.plannedEndAt !== null
    || task.actualStartedAt !== null || task.actualFinishedAt !== null || task.evidenceNote || task.evidenceUrls.length || task.reviewedBasis !== undefined
    || !task.acceptance || !unique(task.objectIds) || task.objectIds.some(id => !allowed.has(key(id))))) throw new Error('任务建议包含未经确认的记录，请重新准备。');
  const selectedSet = new Set(selected.map(key)), additions = drafts.filter(task => selectedSet.has(key(task.id)));
  const merged = read(eventOperationsSchema, { ...operations, tasks: [...operations.tasks, ...additions] }, '活动任务数量超出允许范围，请减少勾选项。');
  const addedTaskIds = additions.map(task => task.id);
  return { status: 'accepted', operations: merged, addedTaskIds,
    receipt: { proposalId, projectId, acceptedTaskIds: [...addedTaskIds] } };
}
