import { z } from 'zod';
import { eventOperationTaskSchema, eventOperationsSchema } from './event-operations-contract.ts';
import { handoffEvidenceUrlsSchema } from './delivery-contract.ts';

export const materialCheckinLimits = { sheets: 100, agreements: 500, events: 2000, title: 120, party: 80, note: 1000, projectId: 128 } as const;
export const materialCheckinUnits = ['piece', 'set'] as const;
const id = z.uuid();
const key = (value: string) => value.toLowerCase();
const text = z.string().max(materialCheckinLimits.note);
const party = z.string().max(materialCheckinLimits.party);
const requiredText = (max: number) => z.string().min(1).max(max).refine(value => !!value.trim(), '文字不能为空白');
const timestamp = eventOperationTaskSchema.shape.plannedStartAt.unwrap().unwrap();
const quantity = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable().default(null);

/** Inspect descriptors before reading values, so validation never runs input serializers or getters. */
const strictJson = z.unknown().superRefine((input, ctx) => {
  let nodes = 0;
  const ancestors = new Set<object>();
  const visit = (value: unknown, depth: number): boolean => {
    if (++nodes > 200000 || depth > 64) return false;
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
    if (typeof value === 'number') return Number.isFinite(value);
    if (typeof value !== 'object') return false;
    const array = Array.isArray(value), prototype = Object.getPrototypeOf(value);
    if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) return false;
    if (ancestors.has(value) || Object.getOwnPropertySymbols(value).length) return false;
    const descriptors = Object.getOwnPropertyDescriptors(value), names = Object.keys(descriptors);
    if (array && (names.length !== value.length + 1 || names.some(name => name !== 'length' && !/^(0|[1-9]\d*)$/.test(name)))) return false;
    ancestors.add(value);
    for (const name of names) {
      if (array && name === 'length') continue;
      const descriptor = descriptors[name];
      if (!descriptor.enumerable || !('value' in descriptor) || !visit(descriptor.value, depth + 1)) return false;
    }
    ancestors.delete(value);
    return true;
  };
  if (!visit(input, 0)) ctx.addIssue({ code: 'custom', message: '点验账册必须是有限、无循环、无自定义序列化的严格JSON数据' });
});

const recorded = { id, recordedAt: timestamp, recordedBy: requiredText(materialCheckinLimits.party) };
const evidence = { evidenceNote: text.default(''), evidenceUrls: handoffEvidenceUrlsSchema.default([]) };
const hasEvidence = (value: { evidenceNote: string; evidenceUrls: string[] }) => !!value.evidenceNote.trim() || value.evidenceUrls.length > 0;
const checkPayloadObject = z.strictObject({
  batchRef: z.string().max(materialCheckinLimits.title).default(''), quantity,
  checkState: z.enum(['pending', 'checked', 'disputed']).default('pending'),
  occurredAt: eventOperationTaskSchema.shape.plannedStartAt,
  fromPartyName: party.default(''), toPartyName: party.default(''), ...evidence,
});
type CheckData = z.infer<typeof checkPayloadObject>;
function validateCheck(value: CheckData, ctx: z.RefinementCtx) {
  if (value.checkState !== 'checked') return;
  if (value.quantity === null) ctx.addIssue({ code: 'custom', path: ['quantity'], message: '已核数量必须明确，未知不能当零' });
  for (const field of ['batchRef', 'fromPartyName', 'toPartyName'] as const) {
    if (!value[field].trim()) ctx.addIssue({ code: 'custom', path: [field], message: '已核点验须注明批次和交接双方' });
  }
  if (!hasEvidence(value)) ctx.addIssue({ code: 'custom', path: ['evidenceNote'], message: '已核点验须保留说明或证据链接' });
}
const checkPayload = checkPayloadObject.superRefine(validateCheck);
const checkShape = checkPayloadObject.shape;
// Corrections replace a whole record; omitted fields must not silently erase its provenance.
const replacementPayload = z.strictObject({
  batchRef: checkShape.batchRef.removeDefault(), quantity: checkShape.quantity.removeDefault(),
  checkState: checkShape.checkState.removeDefault(), occurredAt: checkShape.occurredAt.removeDefault(),
  fromPartyName: checkShape.fromPartyName.removeDefault(), toPartyName: checkShape.toPartyName.removeDefault(),
  evidenceNote: checkShape.evidenceNote.removeDefault(), evidenceUrls: checkShape.evidenceUrls.removeDefault(),
}).superRefine(validateCheck);
const receive = z.strictObject({ ...recorded, ...checkShape, kind: z.literal('receive') }).superRefine(validateCheck);
const returned = z.strictObject({ ...recorded, ...checkShape, kind: z.literal('return') }).superRefine(validateCheck);
const correction = z.strictObject({ ...recorded, kind: z.literal('correction'), targetId: id,
  reason: requiredText(materialCheckinLimits.note), replacement: replacementPayload });
const voided = z.strictObject({ ...recorded, kind: z.literal('void'), targetId: id,
  reason: requiredText(materialCheckinLimits.note), ...evidence }).superRefine((value, ctx) => {
  if (!hasEvidence(value)) ctx.addIssue({ code: 'custom', path: ['evidenceNote'], message: '作废错误记录须保留依据' });
});
const eventObject = z.discriminatedUnion('kind', [receive, returned, correction, voided]);
export const materialCheckinEventSchema = strictJson.pipe(eventObject);
const agreementObject = z.strictObject({ ...recorded, supersedesId: id.optional(), agreedQuantity: quantity, basisNote: text.default('') }).superRefine((value, ctx) => {
  if (value.agreedQuantity !== null && !value.basisNote.trim()) ctx.addIssue({ code: 'custom', path: ['basisNote'], message: '已知约定数量包括零均须依据' });
});
export const materialCheckinAgreementSchema = strictJson.pipe(agreementObject);

const sheetObject = z.strictObject({
  id, acquisitionId: id,
  acquisitionSnapshot: z.strictObject({ title: requiredText(materialCheckinLimits.title), supplierName: party.default(''), specificationNote: text.default('') }),
  unit: z.enum(materialCheckinUnits),
  agreements: z.array(agreementObject).min(1).max(materialCheckinLimits.agreements),
  events: z.array(eventObject).max(materialCheckinLimits.events).default([]),
});
type SheetData = z.infer<typeof sheetObject>;
type EventData = z.infer<typeof eventObject>;
function validateSheet(sheet: SheetData, ctx: z.RefinementCtx) {
  const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: 'custom', path, message });
  const seen = new Set<string>();
  for (const [collection, values] of [['agreements', sheet.agreements], ['events', sheet.events]] as const) values.forEach((value, index) => {
    if (seen.has(key(value.id)) || key(value.id) === key(sheet.id)) issue([collection, index, 'id'], '记录编号不能重复');
    seen.add(key(value.id));
  });
  const agreements = new Map(sheet.agreements.map(value => [key(value.id), value]));
  const agreementChildren = new Map<string, string>();
  if (sheet.agreements.filter(value => !value.supersedesId).length !== 1) issue(['agreements'], '约定版本须有且只有一个根');
  sheet.agreements.forEach((value, index) => {
    if (!value.supersedesId) return;
    const target = agreements.get(key(value.supersedesId));
    if (!target) issue(['agreements', index, 'supersedesId'], '约定目标必须存在于本点验单');
    if (agreementChildren.has(key(value.supersedesId))) issue(['agreements', index, 'supersedesId'], '约定版本不能分叉');
    agreementChildren.set(key(value.supersedesId), key(value.id));
  });
  const events = new Map(sheet.events.map(value => [key(value.id), value]));
  const eventChildren = new Map<string, string>();
  sheet.events.forEach((value, index) => {
    if (!('targetId' in value)) return;
    const target = events.get(key(value.targetId));
    if (!target || target.kind === 'void') issue(['events', index, 'targetId'], '目标必须是本单收退或更正记录，不能覆盖已作废记录');
    if (eventChildren.has(key(value.targetId))) issue(['events', index, 'targetId'], '更正或作废不能分叉覆盖');
    eventChildren.set(key(value.targetId), key(value.id));
  });
  const cycle = (ids: Iterable<string>, children: Map<string, string>) => {
    const completed = new Set<string>();
    for (const start of ids) {
      const visiting = new Set<string>(); let current: string | undefined = start;
      while (current !== undefined && !completed.has(current)) {
        if (visiting.has(current)) return true;
        visiting.add(current); current = children.get(current);
      }
      for (const value of visiting) completed.add(value);
    }
    return false;
  };
  if (cycle(agreements.keys(), agreementChildren)) issue(['agreements'], '约定版本不能循环');
  if (cycle(events.keys(), eventChildren)) issue(['events'], '更正或作废不能循环');
}
export const materialCheckinSheetSchema = strictJson.pipe(sheetObject.superRefine(validateSheet));
const ledgerObject = z.strictObject({
  schemaVersion: z.literal(1).default(1), projectId: requiredText(materialCheckinLimits.projectId),
  dataKind: eventOperationsSchema.shape.dataKind,
  sheets: z.array(sheetObject.superRefine(validateSheet)).max(materialCheckinLimits.sheets).default([]),
}).superRefine((ledger, ctx) => {
  const seen = new Set<string>();
  ledger.sheets.forEach((sheet, index) => {
    for (const record of [sheet, ...sheet.agreements, ...sheet.events]) {
      if (seen.has(key(record.id))) ctx.addIssue({ code: 'custom', path: ['sheets', index], message: '账册内所有单及记录编号须唯一，不能跨单覆盖' });
      seen.add(key(record.id));
    }
  });
});
export const materialCheckinLedgerSchema = strictJson.pipe(ledgerObject);
export const optionalMaterialCheckinLedgerSchema = materialCheckinLedgerSchema.optional();
export type MaterialCheckinLedger = z.infer<typeof materialCheckinLedgerSchema>;
export type MaterialCheckinSheet = z.infer<typeof materialCheckinSheetSchema>;
export type MaterialCheckinAgreement = z.infer<typeof materialCheckinAgreementSchema>;
export type MaterialCheckinEvent = z.infer<typeof materialCheckinEventSchema>;
export type MaterialCheckinEffectiveEvent = z.infer<typeof checkPayload> & {
  rootEventId: string; effectiveEventId: string; kind: 'receive' | 'return'; recordedAt: string; recordedBy: string;
};
export interface MaterialCheckinProjection { agreement: MaterialCheckinAgreement; effectiveEvents: MaterialCheckinEffectiveEvent[]; voidedRootIds: string[] }

function project(sheet: SheetData): MaterialCheckinProjection {
  const agreements = new Map(sheet.agreements.map(value => [key(value.id), value]));
  const agreementChildren = new Map(sheet.agreements.filter(value => value.supersedesId).map(value => [key(value.supersedesId!), key(value.id)]));
  let agreement = sheet.agreements.find(value => !value.supersedesId)!;
  while (agreementChildren.has(key(agreement.id))) agreement = agreements.get(agreementChildren.get(key(agreement.id))!)!;
  const events = new Map(sheet.events.map(value => [key(value.id), value]));
  const children = new Map(sheet.events.filter(value => 'targetId' in value).map(value => [key((value as Extract<EventData, {targetId: string}>).targetId), key(value.id)]));
  const effectiveEvents: MaterialCheckinEffectiveEvent[] = [], voidedRootIds: string[] = [];
  for (const root of sheet.events) {
    if (root.kind !== 'receive' && root.kind !== 'return') continue;
    let current: EventData = root;
    while (children.has(key(current.id))) current = events.get(children.get(key(current.id))!)!;
    if (current.kind === 'void') { voidedRootIds.push(root.id); continue; }
    const payload = current.kind === 'correction' ? current.replacement : current;
    const { batchRef, quantity: value, checkState, occurredAt, fromPartyName, toPartyName, evidenceNote, evidenceUrls } = payload;
    effectiveEvents.push({ rootEventId: root.id, effectiveEventId: current.id, kind: root.kind,
      batchRef, quantity: value, checkState, occurredAt, fromPartyName, toPartyName, evidenceNote, evidenceUrls,
      recordedAt: current.recordedAt, recordedBy: current.recordedBy });
  }
  return { agreement, effectiveEvents, voidedRootIds };
}
export function projectMaterialCheckinEvents(input: MaterialCheckinSheet): MaterialCheckinProjection {
  return project(materialCheckinSheetSchema.parse(input));
}

export type MaterialCheckinConflictCode = 'PROJECT_MISMATCH' | 'LEDGER_METADATA_CONFLICT' | 'SHEET_METADATA_CONFLICT' | 'RECORD_CONFLICT' | 'INVALID_MERGE';
export class MaterialCheckinConflict extends Error {
  readonly code: MaterialCheckinConflictCode; declare readonly sheetId?: string; declare readonly recordId?: string;
  constructor(code: MaterialCheckinConflictCode, message: string, sheetId?: string, recordId?: string) {
    super(message); this.name = 'MaterialCheckinConflict'; this.code = code;
    if (sheetId !== undefined) this.sheetId = sheetId;
    if (recordId !== undefined) this.recordId = recordId;
  }
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(name => JSON.stringify(name) + ':' +
    canonical(['id', 'acquisitionId', 'targetId', 'supersedesId'].includes(name) && typeof (value as Record<string, unknown>)[name] === 'string'
      ? key((value as Record<string, string>)[name]) : (value as Record<string, unknown>)[name])).join(',') + '}';
  return JSON.stringify(value);
}
/** Merge complete snapshots without replacing original records, scope or source wording. */
export function mergeMaterialCheckinLedgers(existing: MaterialCheckinLedger, incoming: MaterialCheckinLedger): MaterialCheckinLedger {
  const left = materialCheckinLedgerSchema.parse(existing), right = materialCheckinLedgerSchema.parse(incoming);
  if (left.projectId !== right.projectId) throw new MaterialCheckinConflict('PROJECT_MISMATCH', '不能合并不同项目的点验账册');
  if (left.dataKind !== right.dataKind) throw new MaterialCheckinConflict('LEDGER_METADATA_CONFLICT', '不能混合不同资料性质的点验账册');
  const sheets = new Map(left.sheets.map(sheet => [key(sheet.id), sheet]));
  const mergeRecords = <T extends {id: string}>(before: T[], after: T[], sheetId: string): T[] => {
    const result = new Map(before.map(record => [key(record.id), record]));
    for (const record of after) {
      const prior = result.get(key(record.id));
      if (prior && canonical(prior) !== canonical(record)) throw new MaterialCheckinConflict('RECORD_CONFLICT', '同一记录有不同内容，请人工核对', sheetId, prior.id);
      if (!prior) result.set(key(record.id), record);
    }
    return [...result.values()];
  };
  for (const sheet of right.sheets) {
    const prior = sheets.get(key(sheet.id));
    if (!prior) { sheets.set(key(sheet.id), sheet); continue; }
    const header = ({ agreements: _agreements, events: _events, ...value }: MaterialCheckinSheet) => value;
    if (canonical(header(prior)) !== canonical(header(sheet))) throw new MaterialCheckinConflict('SHEET_METADATA_CONFLICT', '点验单口径或取得依据不同，不能覆盖', prior.id);
    sheets.set(key(sheet.id), { ...prior, agreements: mergeRecords(prior.agreements, sheet.agreements, prior.id), events: mergeRecords(prior.events, sheet.events, prior.id) });
  }
  const merged = materialCheckinLedgerSchema.safeParse({ ...left, sheets: [...sheets.values()] });
  if (!merged.success) throw new MaterialCheckinConflict('INVALID_MERGE', '合并产生缺失、重复、分叉或循环，请人工核对');
  return merged.data;
}

export type MaterialCheckinIssueCode = 'agreement-unknown' | 'quantity-unknown' | 'disputed' | 'missing-time' | 'time-after-recording' | 'recording-time-conflict' | 'return-before-receipt' | 'over-received' | 'over-returned' | 'quantity-overflow';
export interface MaterialCheckinSummary {
  sheetId: string; acquisitionId: string; unit: MaterialCheckinSheet['unit']; agreementId: string; agreedQuantity: number | null;
  knownReceivedQuantity: number | null; knownReturnedQuantity: number | null;
  receivedQuantity: number | null; returnedQuantity: number | null;
  notReceivedQuantity: number | null; notReturnedQuantity: number | null;
  overReceivedQuantity: number | null; overReturnedQuantity: number | null;
  pendingEventIds: string[]; disputedEventIds: string[];
  issues: { code: MaterialCheckinIssueCode; eventIds: string[] }[]; needsReview: boolean;
}
export function materialCheckinSummary(input: MaterialCheckinSheet): MaterialCheckinSummary {
  const sheet = materialCheckinSheetSchema.parse(input), projection = project(sheet), events = projection.effectiveEvents;
  const issues: MaterialCheckinSummary['issues'] = [];
  const add = (code: MaterialCheckinIssueCode, ids: string[] = []) => { if (!issues.some(issue => issue.code === code)) issues.push({ code, eventIds: ids }); };
  // Device clocks can disagree; preserve truthful corrections and diagnose the whole source chain.
  const agreementsById = new Map(sheet.agreements.map(value => [key(value.id), value]));
  const eventsById = new Map(sheet.events.map(value => [key(value.id), value]));
  const clockConflicts = [
    ...sheet.agreements.filter(value => value.supersedesId && Date.parse(value.recordedAt) < Date.parse(agreementsById.get(key(value.supersedesId))!.recordedAt)),
    ...sheet.events.filter(value => 'targetId' in value && Date.parse(value.recordedAt) < Date.parse(eventsById.get(key(value.targetId))!.recordedAt)),
  ].map(value => value.id);
  if (clockConflicts.length) add('recording-time-conflict', clockConflicts);
  const pendingEventIds = events.filter(event => event.checkState === 'pending').map(event => event.effectiveEventId);
  const disputedEventIds = events.filter(event => event.checkState === 'disputed').map(event => event.effectiveEventId);
  if (pendingEventIds.length) add('quantity-unknown', pendingEventIds);
  if (disputedEventIds.length) add('disputed', disputedEventIds);
  if (projection.agreement.agreedQuantity === null) add('agreement-unknown');
  const checked = events.filter(event => event.checkState === 'checked');
  const missingTime = checked.filter(event => event.occurredAt === null).map(event => event.effectiveEventId);
  if (missingTime.length) add('missing-time', missingTime);
  const future = checked.filter(event => event.occurredAt !== null && Date.parse(event.occurredAt) > Date.parse(event.recordedAt)).map(event => event.effectiveEventId);
  if (future.length) add('time-after-recording', future);
  const total = (kind: 'receive' | 'return') => {
    const rows = events.filter(event => event.kind === kind);
    const sum = rows.filter(event => event.checkState === 'checked').reduce((value, event) => value + BigInt(event.quantity!), 0n);
    const known = sum <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(sum) : null;
    if (known === null) add('quantity-overflow', rows.map(event => event.effectiveEventId));
    return { known, complete: rows.length > 0 && rows.every(event => event.checkState === 'checked') ? known : null };
  };
  const received = total('receive'), returned = total('return');
  if (received.complete === null || returned.complete === null) add('quantity-unknown');
  const gap = (base: number | null, actual: number | null) => base === null || actual === null ? null : base - actual;
  const deliveryGap = gap(projection.agreement.agreedQuantity, received.complete), returnGap = gap(received.complete, returned.complete);
  if (deliveryGap !== null && deliveryGap < 0) add('over-received', checked.filter(event => event.kind === 'receive').map(event => event.effectiveEventId));
  if (returnGap !== null && returnGap < 0) add('over-returned', checked.map(event => event.effectiveEventId));
  const timed = checked.filter(event => event.occurredAt !== null).sort((a, b) => Date.parse(a.occurredAt!) - Date.parse(b.occurredAt!));
  let balance = 0n, laterReceipts = timed.filter(event => event.kind === 'receive' && event.quantity! > 0).length;
  for (let index = 0; index < timed.length;) {
    const at = Date.parse(timed[index].occurredAt!), group: MaterialCheckinEffectiveEvent[] = [];
    while (index < timed.length && Date.parse(timed[index].occurredAt!) === at) group.push(timed[index++]);
    laterReceipts -= group.filter(event => event.kind === 'receive' && event.quantity! > 0).length;
    balance += group.reduce((sum, event) => sum + (event.kind === 'receive' ? BigInt(event.quantity!) : -BigInt(event.quantity!)), 0n);
    if (balance < 0n && laterReceipts > 0) {
      add('return-before-receipt', group.map(event => event.effectiveEventId));
    }
  }
  return { sheetId: sheet.id, acquisitionId: sheet.acquisitionId, unit: sheet.unit,
    agreementId: projection.agreement.id, agreedQuantity: projection.agreement.agreedQuantity,
    knownReceivedQuantity: received.known, knownReturnedQuantity: returned.known, receivedQuantity: received.complete, returnedQuantity: returned.complete,
    notReceivedQuantity: deliveryGap === null || deliveryGap < 0 ? null : deliveryGap,
    notReturnedQuantity: returnGap === null || returnGap < 0 ? null : returnGap,
    overReceivedQuantity: deliveryGap === null ? null : deliveryGap < 0 ? -deliveryGap : 0,
    overReturnedQuantity: returnGap === null ? null : returnGap < 0 ? -returnGap : 0,
    pendingEventIds, disputedEventIds, issues, needsReview: issues.length > 0 };
}
