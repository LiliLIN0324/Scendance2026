import { z } from 'zod';
import { ApiError, canonical, colorSchema, leaseSchema, uuid } from './domain.ts';
import { eventOperationsLimits, eventOperationsSchema, eventOperationTaskSchema } from './event-operations-contract.ts';

export const activityReferenceKey = (id: string) => uuid.safeParse(id).success ? id.toLowerCase() : id;
const unique = (ids: readonly string[]) => new Set(ids.map(activityReferenceKey)).size === ids.length;
const objectIds = eventOperationTaskSchema.shape.objectIds.unwrap().refine(unique);
const localId = objectIds.element;
const localProjectId = localId.refine(id => id !== 'local');
const taskContext = z.strictObject({
  id: eventOperationTaskSchema.shape.id, title: eventOperationTaskSchema.shape.title,
  phase: eventOperationTaskSchema.shape.phase, acceptance: eventOperationTaskSchema.shape.acceptance.unwrap(),
  plannedStartAt: eventOperationTaskSchema.shape.plannedStartAt.unwrap(),
  plannedEndAt: eventOperationTaskSchema.shape.plannedEndAt.unwrap(),
  status: eventOperationTaskSchema.shape.status.unwrap().or(z.literal('needs_review')), objectIds,
});
const objectContext = z.strictObject({
  id: localId, name: z.string().max(200), type: z.string().min(1).max(200),
  floorId: localId, floorName: z.string().max(200),
  size: z.strictObject({ width: z.number().nonnegative(), depth: z.number().nonnegative(), height: z.number().nonnegative() }),
  color: colorSchema, position: z.strictObject({ x: z.number(), z: z.number() }).nullable(),
  rotation: z.number().nullable(), elevation: z.number().nullable(),
});

/** Explicit disclosure only; this is user-provided context, not verified on-site facts. */
export const activityTaskContextSchema = z.strictObject({
  projectId: localProjectId, dataKind: eventOperationsSchema.shape.dataKind.unwrap(), briefText: z.string().max(12000),
  tasks: z.array(taskContext).max(eventOperationsLimits.tasks).refine(tasks => unique(tasks.map(task => task.id))),
  objects: z.array(objectContext).max(eventOperationsLimits.objectIds).refine(objects => unique(objects.map(object => object.id))),
}).superRefine((context, ctx) => {
  const disclosed = new Set(context.objects.map(object => activityReferenceKey(object.id)));
  if (context.tasks.some(task => task.objectIds.some(id => !disclosed.has(activityReferenceKey(id))))) {
    ctx.addIssue({ code: 'custom', path: ['tasks'], message: 'Task references must belong to the disclosed objects' });
  }
});
export const activityTaskRunRequestSchema = z.strictObject({
  kind: z.literal('activity_tasks'), ...leaseSchema.shape, requestId: uuid,
  instruction: z.string().trim().min(1).max(6000), activityContext: activityTaskContextSchema,
});
export const activityTaskSuggestionSchema = z.strictObject({
  title: eventOperationTaskSchema.shape.title, phase: eventOperationTaskSchema.shape.phase,
  acceptance: eventOperationTaskSchema.shape.acceptance.unwrap().min(1), objectIds: objectIds.default([]),
});
export const activityTaskResultSchema = z.strictObject({
  suggestions: z.array(activityTaskSuggestionSchema).min(1).max(eventOperationsLimits.tasks).refine(suggestions =>
    new Set(suggestions.map(suggestion => canonical({ ...suggestion, objectIds: suggestion.objectIds.map(activityReferenceKey).sort() }))).size === suggestions.length),
});
export const activityTaskRunSchema = z.strictObject({
  kind: z.literal('activity_tasks'), id: uuid, projectId: uuid, requestId: uuid,
  state: z.enum(['queued', 'running', 'complete', 'failed', 'cancelled']), progress: z.string(),
  callCount: z.number().int().min(0).max(1), activityId: localProjectId, contextHash: z.string().regex(/^[a-f0-9]{64}$/),
  activityResult: activityTaskResultSchema.nullable(), expiresAt: z.string(),
  errorCode: z.string().optional(), message: z.string().optional(), reused: z.boolean().optional(),
}).superRefine((run, ctx) => {
  if ((run.state === 'complete') !== (run.activityResult !== null)) {
    ctx.addIssue({ code: 'custom', path: ['activityResult'], message: 'Only a complete activity run has a result' });
  }
});

export type ActivityTaskContext = z.infer<typeof activityTaskContextSchema>;
export type ActivityTaskRunRequest = z.infer<typeof activityTaskRunRequestSchema>;
export type ActivityTaskResult = z.infer<typeof activityTaskResultSchema>;
export type ActivityTaskRun = z.infer<typeof activityTaskRunSchema>;

/** No task identities, side effects or repair calls: validate the whole result and retain original references. */
export function validateActivityTaskResult(raw: unknown, context: ActivityTaskContext): ActivityTaskResult {
  const parsed = activityTaskResultSchema.safeParse(raw);
  if (!parsed.success) throw new ApiError('AGENT_INVALID_ACTIVITY_RESPONSE', 502);
  const disclosed = new Map(context.objects.map(object => [activityReferenceKey(object.id), object.id]));
  return { suggestions: parsed.data.suggestions.map(suggestion => ({ ...suggestion, objectIds: suggestion.objectIds.map(id => {
    const original = disclosed.get(activityReferenceKey(id));
    if (original === undefined) throw new ApiError('AGENT_INVALID_ACTIVITY_RESPONSE', 502);
    return original;
  }) })) };
}
