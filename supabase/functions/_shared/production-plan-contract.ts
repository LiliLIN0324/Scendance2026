import { z } from 'zod';
import { eventOperationTaskSchema, eventOperationsSchema, eventOperationsLimits } from './event-operations-contract.ts';

export const productionPlanLimits = {
  records: 500, references: 500, objectId: eventOperationsLimits.objectId,
  title: eventOperationsLimits.title, party: eventOperationsLimits.ownerName, note: 1000,
} as const;
export const productionStaffSources = ['unspecified', 'internal', 'outsourced'] as const;
export const productionAcquisitionMethods = ['unspecified', 'existing', 'rental', 'purchase', 'fabrication'] as const;

const idSchema = eventOperationTaskSchema.shape.id;
const safeInteger = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const text = z.string().max(productionPlanLimits.note);
const party = z.string().max(productionPlanLimits.party);
const title = z.string().min(1).max(productionPlanLimits.title).refine(value => value.trim().length > 0, '请填写非空白名称');
const objectId = z.string().min(1).max(productionPlanLimits.objectId).refine(value => value.trim().length > 0, '物件编号不能为空');
// Only UUID identities ignore case; opaque legacy object IDs keep their original spelling.
const referenceKey = (value: string) => idSchema.safeParse(value).success ? value.toLowerCase() : value;
const uniqueReferences = (ids: string[]) => new Set(ids.map(referenceKey)).size === ids.length;
const taskIds = z.array(idSchema).max(productionPlanLimits.references).refine(uniqueReferences, '任务引用不能重复').default([]);
const objectIds = z.array(objectId).max(productionPlanLimits.references).refine(uniqueReferences, '物件引用不能重复').default([]);

export const productionBudgetSchema = z.strictObject({
  limitMinor: safeInteger.nullable().default(null),
  scopeNote: text.default(''), basisNote: text.default(''),
}).superRefine((budget, ctx) => {
  if (budget.limitMinor === null) return;
  for (const field of ['scopeNote', 'basisNote'] as const) {
    if (!budget[field].trim()) ctx.addIssue({ code: 'custom', path: [field], message: '已录入预算上限须说明覆盖范围与依据' });
  }
});

export const productionStaffingSchema = z.strictObject({
  id: idSchema, roleName: title, shiftLabel: title.or(z.literal('')).default(''),
  taskIds, headcount: safeInteger.nullable().default(null),
  sourceType: z.enum(productionStaffSources).default('unspecified'), sourceName: party.default(''),
  plannedArrivalAt: eventOperationTaskSchema.shape.plannedStartAt,
  plannedDepartureAt: eventOperationTaskSchema.shape.plannedEndAt,
}).superRefine((row, ctx) => {
  if (row.plannedArrivalAt !== null && row.plannedDepartureAt !== null &&
      Date.parse(row.plannedDepartureAt) < Date.parse(row.plannedArrivalAt)) {
    ctx.addIssue({ code: 'custom', path: ['plannedDepartureAt'], message: '计划离场不能早于计划到场' });
  }
});

export const productionAcquisitionSchema = z.strictObject({
  id: idSchema, title, taskIds, objectIds,
  method: z.enum(productionAcquisitionMethods).default('unspecified'),
  supplierName: party.default(''), specificationNote: text.default(''), sourceNote: text.default(''),
  transportScope: text.default(''), installationScope: text.default(''),
});

export const productionEstimateSchema = z.strictObject({
  id: idSchema, title, taskIds, objectIds,
  amountMinor: safeInteger.nullable().default(null), basisNote: text.default(''),
}).superRefine((row, ctx) => {
  if (row.amountMinor !== null && !row.basisNote.trim()) {
    ctx.addIssue({ code: 'custom', path: ['basisNote'], message: '已录入人工估算须填写非空白依据，零金额也须说明' });
  }
});

/** Local planning only: no attendance, quotes, incurred costs, payments or extra tasks. */
export const productionPlanSchema = z.strictObject({
  schemaVersion: z.literal(1).default(1), dataKind: eventOperationsSchema.shape.dataKind,
  currency: z.literal('CNY').default('CNY'), budget: productionBudgetSchema.nullable().default(null),
  staffing: z.array(productionStaffingSchema).max(productionPlanLimits.records).default([]),
  acquisitions: z.array(productionAcquisitionSchema).max(productionPlanLimits.records).default([]),
  estimates: z.array(productionEstimateSchema).max(productionPlanLimits.records).default([]),
}).superRefine((plan, ctx) => {
  const ids = new Set<string>();
  for (const collection of ['staffing', 'acquisitions', 'estimates'] as const) {
    plan[collection].forEach((row, index) => {
      const key = row.id.toLowerCase();
      if (ids.has(key)) ctx.addIssue({ code: 'custom', path: [collection, index, 'id'], message: '制作计划记录编号不能重复' });
      ids.add(key);
    });
  }
  let total = 0;
  for (const row of plan.estimates) {
    if (row.amountMinor === null) continue;
    if (total > Number.MAX_SAFE_INTEGER - row.amountMinor) {
      ctx.addIssue({ code: 'custom', path: ['estimates'], message: '已录入估算合计超过安全整数范围' });
      break;
    }
    total += row.amountMinor;
  }
});
// Missing is distinct from an explicitly created empty planning block.
export const optionalProductionPlanSchema = productionPlanSchema.optional();

export type ProductionBudget = z.infer<typeof productionBudgetSchema>;
export type ProductionStaffing = z.infer<typeof productionStaffingSchema>;
export type ProductionAcquisition = z.infer<typeof productionAcquisitionSchema>;
export type ProductionEstimate = z.infer<typeof productionEstimateSchema>;
export type ProductionPlan = z.infer<typeof productionPlanSchema>;
export interface ProductionReferenceReview {
  kind: 'staffing' | 'acquisition' | 'estimate'; id: string;
  missingTaskIds: string[]; missingObjectIds: string[];
  ambiguousTaskIds: string[]; ambiguousObjectIds: string[];
  unassigned: boolean; needsReview: boolean;
}

/** Callers provide IDs from the same current project snapshot, not a global directory. */
export function resolveProductionPlanReferences(
  input: ProductionPlan, known: { taskIds: readonly string[]; objectIds: readonly string[] },
): ProductionReferenceReview[] {
  const plan = productionPlanSchema.parse(input);
  const counts = (values: readonly string[]) => {
    const result = new Map<string, number>();
    for (const value of values) { const key = referenceKey(value); result.set(key, (result.get(key) ?? 0) + 1); }
    return result;
  };
  const tasks = counts(known.taskIds), objects = counts(known.objectIds);
  const check = (refs: readonly string[], candidates: Map<string, number>) => {
    const missing: string[] = [], ambiguous: string[] = [];
    for (const ref of refs) {
      const count = candidates.get(referenceKey(ref)) ?? 0;
      if (count === 0) missing.push(ref); else if (count > 1) ambiguous.push(ref);
    }
    return { missing, ambiguous };
  };
  const review = (kind: ProductionReferenceReview['kind'], row: { id: string; taskIds: string[]; objectIds?: string[] }) => {
    const task = check(row.taskIds, tasks), object = check(row.objectIds ?? [], objects);
    const unassigned = kind === 'staffing' ? row.taskIds.length === 0 : kind === 'acquisition' && (row.objectIds?.length ?? 0) === 0;
    return { kind, id: row.id, missingTaskIds: task.missing, missingObjectIds: object.missing,
      ambiguousTaskIds: task.ambiguous, ambiguousObjectIds: object.ambiguous, unassigned,
      needsReview: unassigned || task.missing.length + object.missing.length + task.ambiguous.length + object.ambiguous.length > 0 };
  };
  return [...plan.staffing.map(row => review('staffing', row)),
    ...plan.acquisitions.map(row => review('acquisition', row)), ...plan.estimates.map(row => review('estimate', row))];
}

/** Totals cover recorded estimate rows only, never supplier quotes or full project coverage. */
export function productionEstimateSummary(input: ProductionPlan): {
  knownTotalMinor: number; recordedTotalMinor: number | null; unknownEstimateIds: string[];
  allRecordedAmountsKnown: boolean; overLimit: boolean | null;
} {
  const plan = productionPlanSchema.parse(input);
  const unknownEstimateIds = plan.estimates.filter(row => row.amountMinor === null).map(row => row.id);
  const knownTotalMinor = plan.estimates.reduce((sum, row) => sum + (row.amountMinor ?? 0), 0);
  const allRecordedAmountsKnown = plan.estimates.length > 0 && unknownEstimateIds.length === 0;
  const recordedTotalMinor = allRecordedAmountsKnown ? knownTotalMinor : null;
  const limit = plan.budget?.limitMinor ?? null;
  const overLimit = limit === null ? null : knownTotalMinor > limit ? true : allRecordedAmountsKnown ? false : null;
  return { knownTotalMinor, recordedTotalMinor, unknownEstimateIds, allRecordedAmountsKnown, overLimit };
}
