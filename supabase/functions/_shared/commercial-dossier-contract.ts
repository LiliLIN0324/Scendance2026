import { z } from 'zod';
import { eventOperationTaskSchema, eventOperationsSchema } from './event-operations-contract.ts';
import { handoffEvidenceUrlsSchema } from './delivery-contract.ts';
import { productionEstimateSchema, productionPlanLimits } from './production-plan-contract.ts';

export const commercialDossierLimits = {
  agreements: 100, versions: 100, attachments: 100, reports: 500, paymentNodes: 50,
  references: productionPlanLimits.references, title: productionPlanLimits.title,
  party: productionPlanLimits.party, note: productionPlanLimits.note, projectId: 128,
  fileName: 1024, fileBytes: 10 * 1024 * 1024, projectFileBytes: 32 * 1024 * 1024,
} as const;
export const commercialAgreementDirections = ['customer_commission', 'supplier_engagement'] as const;
export const commercialAttachmentMimeTypes = ['application/pdf', 'image/png', 'image/jpeg'] as const;
const id = eventOperationTaskSchema.shape.id;
const uuidKey = (value: string) => value.toLowerCase();
const referenceKey = (value: string) => id.safeParse(value).success ? uuidKey(value) : value;
const text = z.string().max(commercialDossierLimits.note);
const requiredText = (max: number) => z.string().min(1).max(max).refine(value => !!value.trim(), '文字不能为空白');
const recordedAt = eventOperationTaskSchema.shape.plannedStartAt.unwrap().unwrap();
const day = z.iso.date().refine(value => !value.startsWith('0000-'), '日期年份须大于零');
const ids = z.array(id).max(commercialDossierLimits.references)
  .refine(values => new Set(values.map(uuidKey)).size === values.length, '引用编号不能重复');
const recorded = { recordedAt, recordedBy: requiredText(commercialDossierLimits.party) };

// Inspect descriptors before Zod traverses input; serializers/getters are not business JSON.
const strictJson = z.unknown().superRefine((input, ctx) => {
  const ancestors = new Set<object>(); let nodes = 0;
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
    ancestors.delete(value); return true;
  };
  if (!visit(input, 0)) ctx.addIssue({ code: 'custom', message: '商务记录须为有限、无循环、无自定义序列化的严格JSON' });
});

const amountObject = z.strictObject({
  amountMinor: productionEstimateSchema.shape.amountMinor,
  currency: z.literal('CNY').nullable().default(null), basisNote: text.default(''),
}).superRefine((value, ctx) => {
  if (value.amountMinor === null) return;
  if (value.currency !== 'CNY') ctx.addIssue({ code: 'custom', path: ['currency'], message: '已知金额包括零须明确CNY，未知币种金额只保留原文' });
  if (!value.basisNote.trim()) ctx.addIssue({ code: 'custom', path: ['basisNote'], message: '已知金额包括零须有依据' });
});
const partyObject = z.strictObject({ name: z.string().max(commercialDossierLimits.party).default(''), contactNote: text.default('') });
const referencesObject = z.strictObject({
  taskIds: ids.default([]), acquisitionIds: ids.default([]), staffingIds: ids.default([]),
  objectIds: z.array(requiredText(productionPlanLimits.objectId)).max(commercialDossierLimits.references)
    .refine(values => new Set(values.map(referenceKey)).size === values.length, '物件引用不能重复').default([]),
  designVariantId: requiredText(productionPlanLimits.objectId).optional(),
});
// Object defaults are shallow; factories keep nested fields independent across drafts and parses.
const paymentNodeObject = z.strictObject({
  id, label: z.string().max(commercialDossierLimits.title).default(''),
  direction: z.enum(['receivable', 'payable']).nullable().default(null),
  amount: amountObject.default(() => amountObject.parse({})), dueOn: day.nullable().default(null), triggerNote: text.default(''),
});
const contentObject = z.strictObject({
  title: z.string().max(commercialDossierLimits.title).default(''), agreementNumber: z.string().max(commercialDossierLimits.title).default(''),
  ourParty: partyObject.default(() => partyObject.parse({})), counterparty: partyObject.default(() => partyObject.parse({})),
  scopeIn: text.default(''), scopeOut: text.default(''), eventNote: text.default(''), unconfirmedNote: text.default(''),
  references: referencesObject.default(() => referencesObject.parse({})), documentRefs: ids.default([]), quoteDocumentId: id.optional(),
  fileAmount: amountObject.default(() => amountObject.parse({})), amountSourceText: text.default(''),
  taxTreatment: z.enum(['unknown', 'inclusive', 'exclusive']).default('unknown'),
  paymentPlanNodes: z.array(paymentNodeObject).max(commercialDossierLimits.paymentNodes)
    .refine(values => new Set(values.map(value => uuidKey(value.id))).size === values.length, '本版本计划节点编号不能重复').default([]),
  workState: z.enum(['preparing', 'awaiting_counterparty', 'archived']).default('preparing'),
});
const draftObject = z.strictObject({ id, draftToken: requiredText(128), basedOnVersionId: id.optional(),
  content: contentObject.default(() => contentObject.parse({})) });
const versionObject = z.strictObject({ id, basedOnVersionId: id.optional(), ...recorded,
  fixingNote: requiredText(commercialDossierLimits.note), content: contentObject,
}).superRefine((version, ctx) => {
  const content = version.content;
  if (!content.title.trim()) ctx.addIssue({ code: 'custom', path: ['content', 'title'], message: '固定版本须有标题' });
  if (!content.documentRefs.length) ctx.addIssue({ code: 'custom', path: ['content', 'documentRefs'], message: '固定版本须锚定原件或来源' });
  const incomplete = !content.ourParty.name.trim() || !content.counterparty.name.trim() || !content.scopeIn.trim() ||
    content.paymentPlanNodes.some(node => !node.label.trim() || node.direction === null || node.dueOn === null && !node.triggerNote.trim());
  if (incomplete && !content.unconfirmedNote.trim()) ctx.addIssue({ code: 'custom', path: ['content', 'unconfirmedNote'], message: '主体、范围或节点未录清须明确待核，不能造事实' });
});
const agreementObject = z.strictObject({ id, direction: z.enum(commercialAgreementDirections),
  draft: draftObject.nullable().default(null), versions: z.array(versionObject).max(commercialDossierLimits.versions).default([]) });

const attachmentObject = z.strictObject({
  id, agreementId: id, fileName: z.string().max(commercialDossierLimits.fileName).nullable().default(null),
  mimeType: z.string().max(128).regex(/^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/).nullable().default(null),
  purpose: z.enum(['agreement', 'quotation', 'signature_evidence', 'supporting']), documentLabel: z.string().max(commercialDossierLimits.title).default(''),
  sourceState: z.enum(['local-file', 'external-reference', 'missing']),
  byteSize: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable().default(null),
  sha256: z.string().regex(/^[a-f0-9]{64}$/).nullable().default(null),
  sourceUrl: handoffEvidenceUrlsSchema.element.nullable().default(null), ...recorded,
}).superRefine((value, ctx) => {
  if (value.sourceState === 'local-file' && (value.fileName === null || !value.fileName.trim())) {
    ctx.addIssue({ code: 'custom', path: ['fileName'], message: '声明本地原件须保留非空白原文件名，未知来源不补假名' });
  }
  if (value.sourceState === 'local-file' && (value.byteSize === null || value.sha256 === null)) {
    ctx.addIssue({ code: 'custom', path: ['sourceState'], message: '声明本地原件须有长度与摘要；这不验证实际Blob字节' });
  }
  if (value.sourceState === 'local-file' && (value.mimeType === null || !(commercialAttachmentMimeTypes as readonly string[]).includes(value.mimeType.toLowerCase()))) {
    ctx.addIssue({ code: 'custom', path: ['mimeType'], message: '声明本地原件须为PDF/PNG/JPEG，不能猜未知格式' });
  }
  if (value.sourceState === 'local-file' && value.byteSize !== null && (value.byteSize === 0 || value.byteSize > commercialDossierLimits.fileBytes)) {
    ctx.addIssue({ code: 'custom', path: ['byteSize'], message: '声明本地原件须有正长度且不超过10MiB' });
  }
  if (value.sourceState === 'external-reference' && value.sourceUrl === null) ctx.addIssue({ code: 'custom', path: ['sourceUrl'], message: '仅外链来源须有合法链接' });
});
const signaturePayload = z.strictObject({
  observedParties: z.array(z.enum(['our', 'counterparty'])).min(1).max(2)
    .refine(values => new Set(values).size === values.length, '所见签署方不能重复'),
  signedOn: day.nullable().default(null), evidenceNote: requiredText(commercialDossierLimits.note), attachmentIds: ids.min(1),
});
const signatureIdentity = { id, agreementId: id, versionId: id, ...recorded };
const reportObject = z.strictObject({ ...signatureIdentity, kind: z.literal('reported_signed'), ...signaturePayload.shape });
const correctionObject = z.strictObject({ ...signatureIdentity, kind: z.literal('correction'), targetId: id,
  reason: requiredText(commercialDossierLimits.note), replacement: signaturePayload.extend({ signedOn: day.nullable() }) });
const voidObject = z.strictObject({ ...signatureIdentity, kind: z.literal('void'), targetId: id,
  reason: requiredText(commercialDossierLimits.note), evidenceNote: requiredText(commercialDossierLimits.note), attachmentIds: ids.min(1) });
const signatureObject = z.discriminatedUnion('kind', [reportObject, correctionObject, voidObject]);

export const commercialDraftSchema = strictJson.pipe(draftObject);
export const commercialVersionSchema = strictJson.pipe(versionObject);
export const commercialAttachmentSchema = strictJson.pipe(attachmentObject);
export const commercialSignatureReportSchema = strictJson.pipe(signatureObject);
export const commercialContentSchema = strictJson.pipe(contentObject);
export const commercialPaymentPlanNodeSchema = strictJson.pipe(paymentNodeObject);

function hasCycle(keys: Iterable<string>, children: Map<string, string>): boolean {
  const completed = new Set<string>();
  for (const start of keys) {
    const visiting = new Set<string>(); let current: string | undefined = start;
    while (current !== undefined && !completed.has(current)) {
      if (visiting.has(current)) return true;
      visiting.add(current); current = children.get(current);
    }
    for (const value of visiting) completed.add(value);
  }
  return false;
}
const dossierObject = z.strictObject({
  schemaVersion: z.literal(1).default(1), projectId: requiredText(commercialDossierLimits.projectId), dataKind: eventOperationsSchema.shape.dataKind,
  agreements: z.array(agreementObject).max(commercialDossierLimits.agreements).default([]),
  attachmentRefs: z.array(attachmentObject).max(commercialDossierLimits.attachments).default([]),
  signatureReports: z.array(signatureObject).max(commercialDossierLimits.reports).default([]),
}).superRefine((dossier, ctx) => {
  const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: 'custom', path, message });
  const seen = new Set<string>();
  const unique = (record: { id: string }, path: (string | number)[]) => {
    if (seen.has(uuidKey(record.id))) issue(path, '约定、草稿、固定版本、附件及报告编号须唯一');
    seen.add(uuidKey(record.id));
  };
  const agreements = new Map(dossier.agreements.map(value => [uuidKey(value.id), value]));
  const attachments = new Map(dossier.attachmentRefs.map(value => [uuidKey(value.id), value]));
  const checkFiles = (agreementId: string, refs: string[], path: (string | number)[]) => {
    refs.forEach((ref, index) => {
      const attachment = attachments.get(uuidKey(ref));
      if (!attachment || uuidKey(attachment.agreementId) !== uuidKey(agreementId)) issue([...path, index], '附件须存在并属于本约定，不能跨委托或供应约定引用');
    });
  };
  dossier.attachmentRefs.forEach((attachment, index) => {
    unique(attachment, ['attachmentRefs', index, 'id']);
    if (!agreements.has(uuidKey(attachment.agreementId))) issue(['attachmentRefs', index, 'agreementId'], '附件的约定必须存在');
  });
  const declaredLocalBytes = dossier.attachmentRefs.filter(value => value.sourceState === 'local-file').reduce((sum, value) => sum + (value.byteSize ?? 0), 0);
  if (declaredLocalBytes > commercialDossierLimits.projectFileBytes) issue(['attachmentRefs'], '声明的本地原件合计超过32MiB；实际字节仍由存储/包校验');
  dossier.agreements.forEach((agreement, index) => {
    unique(agreement, ['agreements', index, 'id']);
    const versions = new Map(agreement.versions.map(value => [uuidKey(value.id), value])), children = new Map<string, string>();
    if (agreement.versions.length && agreement.versions.filter(value => !value.basedOnVersionId).length !== 1) issue(['agreements', index, 'versions'], '固定版本须有且只有一个根');
    const checkContent = (content: z.infer<typeof contentObject>, path: (string | number)[]) => {
      checkFiles(agreement.id, content.documentRefs, [...path, 'documentRefs']);
      if (content.quoteDocumentId && (!content.documentRefs.some(ref => uuidKey(ref) === uuidKey(content.quoteDocumentId!)) || attachments.get(uuidKey(content.quoteDocumentId))?.purpose !== 'quotation')) {
        issue([...path, 'quoteDocumentId'], '报价引用须在本版本文件中且标为报价文件');
      }
    };
    if (agreement.draft) {
      unique(agreement.draft, ['agreements', index, 'draft', 'id']);
      if (agreement.draft.basedOnVersionId && !versions.has(uuidKey(agreement.draft.basedOnVersionId))) issue(['agreements', index, 'draft', 'basedOnVersionId'], '草稿前版须在本约定');
      checkContent(agreement.draft.content, ['agreements', index, 'draft', 'content']);
    }
    agreement.versions.forEach((version, versionIndex) => {
      const path = ['agreements', index, 'versions', versionIndex] as (string | number)[];
      unique(version, [...path, 'id']); checkContent(version.content, [...path, 'content']);
      if (!version.basedOnVersionId) return;
      if (!versions.has(uuidKey(version.basedOnVersionId))) issue([...path, 'basedOnVersionId'], '固定前版须在本约定');
      if (children.has(uuidKey(version.basedOnVersionId))) issue([...path, 'basedOnVersionId'], '固定版本不能分叉');
      children.set(uuidKey(version.basedOnVersionId), uuidKey(version.id));
    });
    if (hasCycle(versions.keys(), children)) issue(['agreements', index, 'versions'], '固定版本不能循环');
  });
  const reports = new Map(dossier.signatureReports.map(value => [uuidKey(value.id), value])), children = new Map<string, string>();
  dossier.signatureReports.forEach((report, index) => {
    const path = ['signatureReports', index] as (string | number)[];
    unique(report, [...path, 'id']);
    const agreement = agreements.get(uuidKey(report.agreementId));
    if (!agreement?.versions.some(version => uuidKey(version.id) === uuidKey(report.versionId))) issue([...path, 'versionId'], '人工报告须锚定本约定已有固定版本，不能指向可变草稿');
    const payload = report.kind === 'correction' ? report.replacement : report;
    checkFiles(report.agreementId, payload.attachmentIds, [...path, ...(report.kind === 'correction' ? ['replacement', 'attachmentIds'] : ['attachmentIds'])]);
    if (!('targetId' in report)) return;
    const target = reports.get(uuidKey(report.targetId));
    if (!target || target.kind === 'void' || uuidKey(target.agreementId) !== uuidKey(report.agreementId) || uuidKey(target.versionId) !== uuidKey(report.versionId)) {
      issue([...path, 'targetId'], '更正或作废须指向同约定同版本的原报告或更正，不改变签署标的');
    }
    if (children.has(uuidKey(report.targetId))) issue([...path, 'targetId'], '报告更正/作废不能分叉');
    children.set(uuidKey(report.targetId), uuidKey(report.id));
  });
  if (hasCycle(reports.keys(), children)) issue(['signatureReports'], '报告更正/作废不能循环');
});
export const commercialDossierSchema = strictJson.pipe(dossierObject);
export const optionalCommercialDossierSchema = commercialDossierSchema.optional();
export type CommercialDossier = z.infer<typeof commercialDossierSchema>;
export type CommercialAgreement = z.infer<typeof agreementObject>;
export type CommercialDraft = z.infer<typeof commercialDraftSchema>;
export type CommercialVersion = z.infer<typeof commercialVersionSchema>;
export type CommercialContent = z.infer<typeof contentObject>;
export type CommercialAttachment = z.infer<typeof commercialAttachmentSchema>;
export type CommercialSignatureReport = z.infer<typeof commercialSignatureReportSchema>;
export type CommercialPaymentPlanNode = z.infer<typeof paymentNodeObject>;

export type CommercialConflictCode = 'PROJECT_MISMATCH' | 'DATA_KIND_CONFLICT' | 'IMMUTABLE_CONFLICT' | 'DRAFT_CONFLICT' | 'INVALID_MERGE';
export class CommercialDossierConflict extends Error {
  readonly code: CommercialConflictCode; declare readonly recordId?: string;
  constructor(code: CommercialConflictCode, message: string, recordId?: string) {
    super(message); this.name = 'CommercialDossierConflict'; this.code = code;
    if (recordId !== undefined) this.recordId = recordId;
  }
}
const uuidFields = new Set(['id', 'agreementId', 'versionId', 'basedOnVersionId', 'targetId', 'quoteDocumentId', 'designVariantId']);
const referenceArrays = new Set(['taskIds', 'objectIds', 'acquisitionIds', 'staffingIds', 'documentRefs', 'attachmentIds']);
function canonical(value: unknown, field = '', compareIdentities = true): string {
  if (typeof value === 'string') return JSON.stringify(compareIdentities && (uuidFields.has(field) || referenceArrays.has(field)) ? referenceKey(value) : value);
  if (Array.isArray(value)) return '[' + value.map(item => canonical(item, field, compareIdentities)).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(name => JSON.stringify(name) + ':' + canonical((value as Record<string, unknown>)[name], name, compareIdentities)).join(',') + '}';
  return JSON.stringify(value);
}
function checkScope(left: CommercialDossier, right: CommercialDossier): void {
  if (left.projectId !== right.projectId) throw new CommercialDossierConflict('PROJECT_MISMATCH', '不能合并不同本机活动的商务资料');
  if (left.dataKind !== right.dataKind) throw new CommercialDossierConflict('DATA_KIND_CONFLICT', '不同资料性质不能自动合并');
}
function mergeRecords<T extends { id: string }>(before: T[], after: T[]): T[] {
  const result = new Map(before.map(value => [uuidKey(value.id), value]));
  for (const value of after) {
    const original = result.get(uuidKey(value.id));
    if (original && canonical(original) !== canonical(value)) throw new CommercialDossierConflict('IMMUTABLE_CONFLICT', '同编号固定记录/附件/报告有不同内容，须人工核对', original.id);
    if (!original) result.set(uuidKey(value.id), value);
  }
  return [...result.values()];
}
/** Complete snapshots only. Mutable draft saves still require a target token CAS in storage. */
export function mergeCommercialDossiers(existing: CommercialDossier, incoming: CommercialDossier): CommercialDossier {
  const left = commercialDossierSchema.parse(existing), right = commercialDossierSchema.parse(incoming); checkScope(left, right);
  const agreements = new Map(left.agreements.map(value => [uuidKey(value.id), value]));
  for (const value of right.agreements) {
    const original = agreements.get(uuidKey(value.id));
    if (!original) { agreements.set(uuidKey(value.id), value); continue; }
    if (original.direction !== value.direction) throw new CommercialDossierConflict('IMMUTABLE_CONFLICT', '同约定不能改成另一业务方向', original.id);
    if (original.draft && value.draft) {
      const body = ({ draftToken: _token, ...draft }: CommercialDraft) => draft;
      if (canonical(body(original.draft)) !== canonical(body(value.draft))) throw new CommercialDossierConflict('DRAFT_CONFLICT', '两份可变草稿不同，不能按时间覆盖', original.draft.id);
    }
    agreements.set(uuidKey(value.id), { ...original, draft: original.draft ?? value.draft,
      versions: mergeRecords(original.versions, value.versions) });
  }
  const merged = commercialDossierSchema.safeParse({ ...left, agreements: [...agreements.values()],
    attachmentRefs: mergeRecords(left.attachmentRefs, right.attachmentRefs), signatureReports: mergeRecords(left.signatureReports, right.signatureReports) });
  if (!merged.success) throw new CommercialDossierConflict('INVALID_MERGE', '合并产生重复、缺目标、分叉或循环，原资料未覆盖');
  return merged.data;
}
/** CAS draft cleanup may remove temporary records, never fixed history or its evidence. No Blob bytes are checked here. */
export function assertCommercialHistoryPreserved(existing: CommercialDossier, next: CommercialDossier): void {
  const before = commercialDossierSchema.parse(existing), after = commercialDossierSchema.parse(next); checkScope(before, after);
  const contains = <T extends { id: string }>(old: T[], current: T[]) => {
    const records = new Map(current.map(value => [uuidKey(value.id), value]));
    for (const value of old) {
      const found = records.get(uuidKey(value.id));
      if (!found || canonical(found, '', false) !== canonical(value, '', false)) throw new CommercialDossierConflict('IMMUTABLE_CONFLICT', '既有固定历史不能被删除或改写', value.id);
    }
  };
  const agreements = new Map(after.agreements.map(value => [uuidKey(value.id), value]));
  for (const old of before.agreements) {
    const current = agreements.get(uuidKey(old.id));
    const historical = old.versions.length > 0 || before.signatureReports.some(report => uuidKey(report.agreementId) === uuidKey(old.id));
    if (!current && !historical) continue;
    if (!current || current.id !== old.id || current.direction !== old.direction) throw new CommercialDossierConflict('IMMUTABLE_CONFLICT', '既有约定及方向不能被删除或改写', old.id);
    contains(old.versions, current.versions);
  }
  const protectedFiles = new Set(before.agreements.flatMap(agreement => agreement.versions.flatMap(version => version.content.documentRefs)).map(uuidKey));
  for (const report of before.signatureReports) {
    const payload = report.kind === 'correction' ? report.replacement : report;
    for (const ref of payload.attachmentIds) protectedFiles.add(uuidKey(ref));
  }
  const files = new Map(after.attachmentRefs.map(value => [uuidKey(value.id), value]));
  for (const old of before.attachmentRefs) {
    const current = files.get(uuidKey(old.id));
    if (!current && !protectedFiles.has(uuidKey(old.id))) continue;
    contains([old], current ? [current] : []);
  }
  contains(before.signatureReports, after.signatureReports);
}
export interface CommercialSignatureProjection {
  effectiveReports: (z.infer<typeof signaturePayload> & { rootReportId: string; effectiveReportId: string;
    agreementId: string; versionId: string; recordedAt: string; recordedBy: string })[];
  voidedRootIds: string[];
  recordingTimeConflictIds: string[];
}
/** Effective manual reports only; this never decides signature validity or contract effectiveness. */
export function projectCommercialSignatures(input: CommercialDossier): CommercialSignatureProjection {
  const dossier = commercialDossierSchema.parse(input), reports = new Map(dossier.signatureReports.map(value => [uuidKey(value.id), value]));
  const children = new Map(dossier.signatureReports.filter(value => 'targetId' in value).map(value => [uuidKey((value as Extract<CommercialSignatureReport, { targetId: string }>).targetId), uuidKey(value.id)]));
  const effectiveReports: CommercialSignatureProjection['effectiveReports'] = [], voidedRootIds: string[] = [], recordingTimeConflictIds: string[] = [];
  for (const agreement of dossier.agreements) {
    const versions = new Map(agreement.versions.map(value => [uuidKey(value.id), value]));
    for (const version of agreement.versions) if (version.basedOnVersionId && Date.parse(version.recordedAt) < Date.parse(versions.get(uuidKey(version.basedOnVersionId))!.recordedAt)) recordingTimeConflictIds.push(version.id);
  }
  for (const report of dossier.signatureReports) if ('targetId' in report && Date.parse(report.recordedAt) < Date.parse(reports.get(uuidKey(report.targetId))!.recordedAt)) recordingTimeConflictIds.push(report.id);
  for (const root of dossier.signatureReports) {
    if (root.kind !== 'reported_signed') continue;
    let current: CommercialSignatureReport = root;
    while (children.has(uuidKey(current.id))) current = reports.get(children.get(uuidKey(current.id))!)!;
    if (current.kind === 'void') { voidedRootIds.push(root.id); continue; }
    const payload = current.kind === 'correction' ? current.replacement : current;
    effectiveReports.push({ observedParties: payload.observedParties, signedOn: payload.signedOn,
      evidenceNote: payload.evidenceNote, attachmentIds: payload.attachmentIds,
      rootReportId: root.id, effectiveReportId: current.id, agreementId: root.agreementId, versionId: root.versionId,
      recordedAt: current.recordedAt, recordedBy: current.recordedBy });
  }
  return { effectiveReports, voidedRootIds, recordingTimeConflictIds };
}
