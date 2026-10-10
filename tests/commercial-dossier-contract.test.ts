import { describe, expect, it, vi } from 'vitest';
import {
  commercialAgreementDirections,
  commercialAttachmentMimeTypes,
  commercialAttachmentSchema,
  commercialContentSchema,
  commercialDossierSchema,
  optionalCommercialDossierSchema,
  commercialDraftSchema,
  commercialPaymentPlanNodeSchema,
  commercialSignatureReportSchema,
  commercialVersionSchema,
  commercialDossierLimits,
  mergeCommercialDossiers,
  assertCommercialHistoryPreserved,
  projectCommercialSignatures,
  type CommercialDossier,
} from '../supabase/functions/_shared/commercial-dossier-contract.ts';

const id = (n: number) => `a0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ts = (day: number) => `2026-10-${String(day).padStart(2, '0')}T09:00:00+08:00`;
const day = (dayNumber: number) => `2026-10-${String(dayNumber).padStart(2, '0')}`;

const content = (extra: Record<string, unknown> = {}) => ({
  title: '', agreementNumber: '',
  ourParty: { name: '', contactNote: '' }, counterparty: { name: '', contactNote: '' },
  scopeIn: '', scopeOut: '', eventNote: '', unconfirmedNote: '',
  references: { taskIds: [], acquisitionIds: [], staffingIds: [], objectIds: [] },
  documentRefs: [],
  fileAmount: { amountMinor: null, currency: null, basisNote: '' }, amountSourceText: '',
  taxTreatment: 'unknown', paymentPlanNodes: [], workState: 'preparing',
  ...extra,
});

const fixedContent = (attachmentId: string, extra: Record<string, unknown> = {}) => content({
  title: '承办约定', agreementNumber: 'AG-001',
  ourParty: { name: '我方主体', contactNote: '项目负责人' },
  counterparty: { name: '客户主体', contactNote: '联系人' },
  scopeIn: '活动策划与现场承办', scopeOut: '不含媒体投放', eventNote: '活动说明',
  documentRefs: [attachmentId],
  fileAmount: { amountMinor: 0, currency: 'CNY', basisNote: '明确为零的演练金额' },
  paymentPlanNodes: [], workState: 'awaiting_counterparty',
  ...extra,
});

const draft = (agreementId: string, draftId: string, token = 'opaque-draft-token', extra: Record<string, unknown> = {}) => ({
  id: draftId, draftToken: token, content: content(), ...extra,
});

const version = (versionId: string, attachmentId: string, extra: Record<string, unknown> = {}) => ({
  id: versionId, recordedAt: ts(9), recordedBy: '记录员', fixingNote: '固定依据',
  content: fixedContent(attachmentId), ...extra,
});

const agreement = (agreementId: string, direction: typeof commercialAgreementDirections[number] = 'customer_commission', extra: Record<string, unknown> = {}) => ({
  id: agreementId, direction, draft: null, versions: [], ...extra,
});

const attachment = (attachmentId: string, agreementId: string, extra: Record<string, unknown> = {}) => ({
  id: attachmentId, agreementId, fileName: 'agreement.pdf', mimeType: null,
  purpose: 'agreement', documentLabel: '', sourceState: 'missing', byteSize: null, sha256: null, sourceUrl: null,
  recordedAt: ts(9), recordedBy: '记录员', ...extra,
});

const report = (reportId: string, agreementId: string, versionId: string, attachmentId: string, extra: Record<string, unknown> = {}) => ({
  id: reportId, agreementId, versionId, kind: 'reported_signed',
  observedParties: ['our', 'counterparty'], signedOn: day(9), evidenceNote: '人工查看签署页', attachmentIds: [attachmentId],
  recordedAt: ts(9), recordedBy: '记录员', ...extra,
});

const dossier = (extra: Record<string, unknown> = {}) => ({
  projectId: 'project-commercial-1', dataKind: 'unspecified', agreements: [], attachmentRefs: [], signatureReports: [], ...extra,
});

const conflict = (action: () => unknown, code: string) => {
  let error: unknown;
  try { action(); } catch (caught) { error = caught; }
  expect(error).toMatchObject({ code });
  return error;
};

describe('commercial dossier contract', () => {
  it('keeps optional dossiers absent and defaults an explicit empty root', () => {
    expect(commercialDossierSchema.parse({ projectId: 'project-commercial-1' })).toEqual({
      schemaVersion: 1, projectId: 'project-commercial-1', dataKind: 'unspecified',
      agreements: [], attachmentRefs: [], signatureReports: [],
    });
    expect(commercialDossierSchema.parse({ projectId: 'project-commercial-1', dataKind: 'rehearsal' }).dataKind).toBe('rehearsal');
    expect(commercialDossierSchema.parse({ projectId: 'project-commercial-1', dataKind: 'real' }).dataKind).toBe('real');
    expect(optionalCommercialDossierSchema.parse(undefined)).toBeUndefined();
    expect(commercialAgreementDirections).toEqual(['customer_commission', 'supplier_engagement']);
    expect(commercialAttachmentMimeTypes).toEqual(['application/pdf', 'image/png', 'image/jpeg']);
  });

  it('allows a completely blank draft while fixed versions require title, source and reason', () => {
    const blank = commercialDraftSchema.parse({ id: id(1), draftToken: ' opaque token ' });
    expect(blank).toMatchObject({ id: id(1), draftToken: ' opaque token ', content: { title: '', documentRefs: [], workState: 'preparing' } });
    expect(blank.content.fileAmount).toEqual({ amountMinor: null, currency: null, basisNote: '' });
    expect(commercialVersionSchema.safeParse({
      id: id(2), recordedAt: ts(9), recordedBy: '记录员', fixingNote: '', content: fixedContent(id(3), { title: '', documentRefs: [] }),
    }).success).toBe(false);
    expect(commercialVersionSchema.safeParse({
      id: id(2), recordedAt: ts(9), recordedBy: '记录员', fixingNote: '固定依据', content: fixedContent(id(3), { title: '', documentRefs: [] }),
    }).success).toBe(false);
    expect(commercialVersionSchema.parse({ id: id(2), recordedAt: ts(9), recordedBy: '记录员', fixingNote: '固定依据', content: fixedContent(id(3)) }).content.title)
      .toBe('承办约定');
  });

  it.each([false, true])('constructs independent nested defaults for repeated and different projects, explicit content=%s', explicit => {
    const make = (projectId: string) => ({ projectId, dataKind: 'rehearsal', agreements: [{ id: id(200), direction: 'customer_commission',
      draft: { id: id(201), draftToken: 'Token', ...(explicit ? { content: {} } : {}) } }] });
    const input = make('draft-A'), a = commercialDossierSchema.parse(input), b = commercialDossierSchema.parse(input),
      other = commercialDossierSchema.parse(make('draft-B'));
    const first = a.agreements[0].draft!.content, second = b.agreements[0].draft!.content;
    expect(first).not.toBe(second); expect(first.references).not.toBe(second.references);
    expect(first.ourParty).not.toBe(second.ourParty); expect(first.counterparty).not.toBe(second.counterparty);
    expect(first.fileAmount).not.toBe(second.fileAmount); expect(first.paymentPlanNodes).not.toBe(second.paymentPlanNodes);
    first.references.taskIds.push(id(202)); first.references.objectIds.push('probe-object');
    first.references.acquisitionIds.push(id(203)); first.references.staffingIds.push(id(204));
    first.ourParty.name = 'A主体'; first.counterparty.contactNote = 'A联系人';
    first.documentRefs.push(id(205)); first.fileAmount.amountMinor = 7;
    first.paymentPlanNodes.push(commercialPaymentPlanNodeSchema.parse({ id: id(206) }));
    expect(second.references).toEqual({ taskIds: [], objectIds: [], acquisitionIds: [], staffingIds: [] });
    expect(second.ourParty.name).toBe(''); expect(second.counterparty.contactNote).toBe('');
    expect(second.documentRefs).toEqual([]); expect(second.paymentPlanNodes).toEqual([]);
    expect(second.fileAmount.amountMinor).toBeNull();
    expect(other.agreements[0].draft!.content).toEqual(second);
    expect(commercialDossierSchema.parse(input).agreements[0].draft!.content).toEqual(second);
    expect(input).toEqual(make('draft-A'));
    a.attachmentRefs.push(commercialAttachmentSchema.parse(attachment(id(207), id(200))));
    a.signatureReports.push(commercialSignatureReportSchema.parse(report(id(209), id(200), id(208), id(207))));
    a.agreements[0].versions.push(commercialVersionSchema.parse(version(id(208), id(207))));
    expect(b.attachmentRefs).toEqual([]); expect(b.agreements[0].versions).toEqual([]);
    expect(b.signatureReports).toEqual([]); expect(commercialDossierSchema.parse(input).signatureReports).toEqual([]);
  });

  it('keeps explicit input children and plan-node default amounts independent without changing the original input', () => {
    const input = { references: { objectIds: ['original'] }, ourParty: { name: '原主体' }, paymentPlanNodes: [{ id: id(210) }, { id: id(211) }] };
    const a = commercialContentSchema.parse(input), b = commercialContentSchema.parse(input);
    expect(a.paymentPlanNodes[0].amount).not.toBe(a.paymentPlanNodes[1].amount);
    expect(a.paymentPlanNodes[0].amount).not.toBe(b.paymentPlanNodes[0].amount);
    a.references.objectIds.push('added'); a.ourParty.name = '已修改';
    a.paymentPlanNodes[0].amount.amountMinor = 123; a.paymentPlanNodes[0].amount.currency = 'CNY';
    expect(a.paymentPlanNodes[1].amount).toEqual({ amountMinor: null, currency: null, basisNote: '' });
    expect(b.references.objectIds).toEqual(['original']); expect(b.ourParty.name).toBe('原主体');
    expect(b.paymentPlanNodes[0].amount).toEqual({ amountMinor: null, currency: null, basisNote: '' });
    expect(commercialContentSchema.parse(input)).toEqual(b);
    expect(input).toEqual({ references: { objectIds: ['original'] }, ourParty: { name: '原主体' }, paymentPlanNodes: [{ id: id(210) }, { id: id(211) }] });
  });

  it('requires an explicit unconfirmed note when fixed subjects, scope or payment nodes are incomplete', () => {
    const incomplete = fixedContent(id(10), {
      ourParty: { name: '', contactNote: '' }, counterparty: { name: '', contactNote: '' }, scopeIn: '',
      paymentPlanNodes: [{ id: id(11), label: '', direction: null, amount: { amountMinor: null, currency: null, basisNote: '' }, dueOn: null, triggerNote: '' }],
    });
    const base = { id: id(12), recordedAt: ts(9), recordedBy: '记录员', fixingNote: '固定依据', content: incomplete };
    expect(commercialVersionSchema.safeParse(base).success).toBe(false);
    expect(commercialVersionSchema.safeParse({ ...base, content: { ...incomplete, unconfirmedNote: '客户主体、范围和付款节点待核' } }).success).toBe(true);
    expect(commercialPaymentPlanNodeSchema.safeParse({ id: id(13), label: '首款', direction: 'receivable', amount: { amountMinor: 0, currency: 'CNY', basisNote: '明确为零' }, dueOn: null, triggerNote: '客户确认后' }).success).toBe(true);
  });

  it('separates unknown, zero, currency, tax and source text for amounts', () => {
    expect(commercialContentSchema.parse({ fileAmount: { amountMinor: null, currency: null, basisNote: '' }, amountSourceText: '币种待确认的客户原文' }).fileAmount)
      .toEqual({ amountMinor: null, currency: null, basisNote: '' });
    expect(commercialContentSchema.parse({ fileAmount: { amountMinor: 0, currency: 'CNY', basisNote: '演练阶段明确零金额' }, taxTreatment: 'unknown' }).fileAmount.amountMinor).toBe(0);
    for (const fileAmount of [
      { amountMinor: 0, currency: null, basisNote: '依据' },
      { amountMinor: 1, currency: 'CNY', basisNote: '' },
      { amountMinor: 1, currency: 'USD', basisNote: '依据' },
    ]) expect(commercialContentSchema.safeParse({ fileAmount }).success).toBe(false);
    expect(commercialContentSchema.safeParse({ actualPaidMinor: 1 }).success).toBe(false);
    expect(commercialContentSchema.safeParse({ cashReceived: true, paymentStatus: 'paid' }).success).toBe(false);
    expect(commercialContentSchema.parse({ amountSourceText: '  原文写“待核币种”  ' }).amountSourceText).toBe('  原文写“待核币种”  ');
  });

  it('accepts missing external task/object references without pretending they are contracts', () => {
    const parsed = commercialContentSchema.parse({ references: { taskIds: [id(20)], objectIds: ['legacy-missing-object'] } });
    expect(parsed.references.taskIds).toEqual([id(20)]);
    expect(parsed.references.objectIds).toEqual(['legacy-missing-object']);
    const document = attachment(id(21), id(22), { sourceState: 'external-reference', sourceUrl: 'https://example.test/quote' });
    const saved = commercialDossierSchema.parse(dossier({ agreements: [agreement(id(22), 'supplier_engagement')], attachmentRefs: [document] }));
    expect(saved.attachmentRefs[0].sourceUrl).toBe('https://example.test/quote');
  });

  it('validates attachment provenance, MIME policy and project local-file byte caps', () => {
    const local = attachment(id(30), id(31), { sourceState: 'local-file', mimeType: 'application/pdf', byteSize: 1, sha256: 'a'.repeat(64) });
    expect(commercialAttachmentSchema.parse(local)).toMatchObject({ sourceState: 'local-file', mimeType: 'application/pdf', byteSize: 1 });
    expect(commercialAttachmentSchema.parse({ ...local, mimeType: 'application/PDF' }).mimeType).toBe('application/PDF');
    expect(commercialAttachmentSchema.parse(attachment(id(32), id(31), { sourceState: 'external-reference', mimeType: 'application/x-unknown', sourceUrl: 'https://example.test/file' })).sourceState)
      .toBe('external-reference');
    expect(commercialAttachmentSchema.parse(attachment(id(33), id(31), { sourceState: 'missing', mimeType: null })).sourceState).toBe('missing');
    for (const change of [
      { sourceState: 'local-file', mimeType: null, byteSize: 1, sha256: 'a'.repeat(64) },
      { sourceState: 'local-file', mimeType: 'application/msword', byteSize: 1, sha256: 'a'.repeat(64) },
      { sourceState: 'local-file', mimeType: 'application/pdf', byteSize: 0, sha256: 'a'.repeat(64) },
      { sourceState: 'local-file', mimeType: 'application/pdf', byteSize: 1, sha256: 'A'.repeat(64) },
      { sourceState: 'external-reference', mimeType: null, sourceUrl: null },
    ]) expect(commercialAttachmentSchema.safeParse({ ...local, ...change }).success).toBe(false);
    const agreementId = id(31);
    const exact = [10, 10, 10, 2].map((size, index) => attachment(id(40 + index), agreementId, {
      fileName: `part-${index}.pdf`, sourceState: 'local-file', mimeType: 'application/pdf', byteSize: size * 1024 * 1024, sha256: `${String(index + 1).repeat(64)}`,
    }));
    expect(commercialDossierSchema.parse(dossier({ agreements: [agreement(agreementId)], attachmentRefs: exact })).attachmentRefs).toHaveLength(4);
    expect(commercialDossierSchema.safeParse(dossier({ agreements: [agreement(agreementId)], attachmentRefs: [...exact, attachment(id(45), agreementId, { fileName: 'one-byte.pdf', sourceState: 'local-file', mimeType: 'application/pdf', byteSize: 1, sha256: 'f'.repeat(64) })] })).success).toBe(false);
    expect(commercialDossierSchema.safeParse(dossier({ agreements: [agreement(agreementId)], attachmentRefs: [exact[0], attachment(id(46), id(99), { fileName: exact[0].fileName })] })).success).toBe(false);
    expect(commercialDossierSchema.parse(dossier({ agreements: [agreement(agreementId)], attachmentRefs: [exact[0], { ...exact[1], id: id(47), sha256: 'b'.repeat(64) }] })).attachmentRefs).toHaveLength(2);
    const unknownLink = commercialAttachmentSchema.parse({ id: id(48), agreementId, purpose: 'supporting',
      sourceState: 'external-reference', sourceUrl: 'https://example.test/uninspected', recordedAt: ts(9), recordedBy: '记录员' });
    expect(unknownLink).toMatchObject({ fileName: null, mimeType: null, byteSize: null, sha256: null });
    expect(commercialAttachmentSchema.safeParse({ ...local, fileName: null }).success).toBe(false);
    expect(commercialAttachmentSchema.safeParse({ ...local, byteSize: commercialDossierLimits.fileBytes + 1 }).success).toBe(false);
  });

  it('rejects orphan, cross-agreement, version graph and report graph references', () => {
    const a = id(50), b = id(51), aFile = attachment(id(52), a), bFile = attachment(id(53), b);
    const aVersion = version(id(54), aFile.id);
    const bVersion = version(id(55), bFile.id);
    expect(commercialDossierSchema.safeParse(dossier({ agreements: [agreement(a)], attachmentRefs: [attachment(id(56), id(999))] })).success).toBe(false);
    expect(commercialDossierSchema.safeParse(dossier({ agreements: [agreement(a, 'customer_commission', { versions: [version(id(57), aFile.id, { basedOnVersionId: id(999) })] })], attachmentRefs: [aFile] })).success).toBe(false);
    expect(commercialDossierSchema.safeParse(dossier({ agreements: [agreement(a, 'customer_commission', { versions: [aVersion, version(id(58), aFile.id, { basedOnVersionId: aVersion.id }), version(id(59), aFile.id, { basedOnVersionId: aVersion.id })] })], attachmentRefs: [aFile] })).success).toBe(false);
    const cycleA = version(id(60), aFile.id, { basedOnVersionId: id(61) }), cycleB = version(id(61), aFile.id, { basedOnVersionId: cycleA.id });
    expect(commercialDossierSchema.safeParse(dossier({ agreements: [agreement(a, 'customer_commission', { versions: [cycleA, cycleB] })], attachmentRefs: [aFile] })).success).toBe(false);
    expect(commercialDossierSchema.safeParse(dossier({ agreements: [agreement(a, 'customer_commission', { versions: [aVersion] }), agreement(b, 'supplier_engagement', { versions: [bVersion] })], attachmentRefs: [aFile, bFile], signatureReports: [report(id(62), a, bVersion.id, aFile.id)] })).success).toBe(false);
    expect(commercialDossierSchema.safeParse(dossier({ agreements: [agreement(a, 'customer_commission', { versions: [version(id(63), aFile.id, { content: fixedContent(bFile.id) })] }), agreement(b, 'supplier_engagement', { versions: [bVersion] })], attachmentRefs: [aFile, bFile] })).success).toBe(false);
    expect(commercialDossierSchema.safeParse(dossier({ agreements: [agreement(a, 'customer_commission', { versions: [version(id(64), aFile.id, { content: fixedContent(aFile.id, { quoteDocumentId: aFile.id }) })] })], attachmentRefs: [aFile] })).success).toBe(false);
  });

  it('keeps signed-on date separate from recordedAt and projects correction/void chains without legal conclusions', () => {
    const agreementId = id(70), fileId = id(71), fixedId = id(72), correctionFileId = id(73), rootReportId = id(74), correctionId = id(75), voidRootId = id(76), voidId = id(77);
    const fixed = version(fixedId, fileId, { recordedAt: ts(10) });
    const corrected = { id: correctionId, agreementId, versionId: fixedId,
      kind: 'correction', targetId: rootReportId, reason: '更正报告依据',
      replacement: { observedParties: ['our'], signedOn: null, evidenceNote: '更正后的人工记录', attachmentIds: [correctionFileId] },
      recordedAt: ts(8), recordedBy: '复核员',
    };
    const voided = { id: voidId, agreementId, versionId: fixedId, kind: 'void', targetId: voidRootId, reason: '作废理由', evidenceNote: '作废凭据', attachmentIds: [correctionFileId], recordedAt: ts(11), recordedBy: '复核员' };
    const source = commercialDossierSchema.parse(dossier({
      agreements: [agreement(agreementId, 'customer_commission', { versions: [fixed] })],
      attachmentRefs: [attachment(fileId, agreementId), attachment(correctionFileId, agreementId, { purpose: 'signature_evidence' })],
      signatureReports: [
        report(rootReportId, agreementId, fixedId, fileId, { signedOn: day(7), recordedAt: ts(9) }),
        corrected, report(voidRootId, agreementId, fixedId, correctionFileId, { signedOn: null, recordedAt: ts(10) }), voided,
      ],
    }));
    const projected = projectCommercialSignatures(source);
    expect(projected.effectiveReports).toEqual([expect.objectContaining({
      rootReportId, effectiveReportId: correctionId, agreementId, versionId: fixedId,
      observedParties: ['our'], signedOn: null, recordedAt: ts(8), recordedBy: '复核员',
    })]);
    expect(projected.voidedRootIds).toEqual([voidRootId]);
    expect(projected.recordingTimeConflictIds).toEqual(expect.arrayContaining([correctionId]));
    expect(projected.effectiveReports[0]).not.toHaveProperty('legalValidity');
    expect(commercialSignatureReportSchema.safeParse({ ...report(rootReportId, agreementId, fixedId, fileId), legalValidity: 'valid', cashReceived: true }).success).toBe(false);
    expect(commercialSignatureReportSchema.parse(corrected).kind).toBe('correction');
    for (const field of ['observedParties', 'signedOn', 'evidenceNote', 'attachmentIds']) {
      const replacement: Record<string, unknown> = { ...corrected.replacement }; delete replacement[field];
      expect(commercialSignatureReportSchema.safeParse({ ...corrected, replacement }).success).toBe(false);
    }
    expect(commercialSignatureReportSchema.safeParse({ ...voided, evidenceNote: '', attachmentIds: [] }).success).toBe(false);
  });

  it('merges complete snapshots without replacing left draft tokens and reports immutable conflicts', () => {
    const agreementId = id(80), draftId = id(81);
    const left = commercialDossierSchema.parse(dossier({ agreements: [agreement(agreementId, 'customer_commission', { draft: draft(agreementId, draftId, 'left-token') })] }));
    const right = commercialDossierSchema.parse(dossier({ agreements: [agreement(agreementId, 'customer_commission', { draft: draft(agreementId, draftId, 'right-token') }), agreement(id(82), 'supplier_engagement')] }));
    const merged: CommercialDossier = mergeCommercialDossiers(left, right);
    expect(merged.agreements).toHaveLength(2);
    expect(merged.agreements.find(value => value.id === agreementId)?.draft?.draftToken).toBe('left-token');
    const changedDraft = commercialDossierSchema.parse(dossier({ agreements: [agreement(agreementId, 'customer_commission', { draft: draft(agreementId, draftId, 'changed', { content: content({ scopeIn: '新的范围' }) }) })] }));
    conflict(() => mergeCommercialDossiers(left, changedDraft), 'DRAFT_CONFLICT');
    const file = attachment(id(83), agreementId), fixed = version(id(84), file.id);
    const fixedLeft = commercialDossierSchema.parse(dossier({ agreements: [agreement(agreementId, 'customer_commission', { versions: [fixed] })], attachmentRefs: [file] }));
    const fixedRight = commercialDossierSchema.parse(dossier({ agreements: [agreement(agreementId, 'customer_commission', { versions: [version(fixed.id, file.id, { content: fixedContent(file.id, { title: '改写固定版本' }) })] })], attachmentRefs: [file] }));
    const fixedError = conflict(() => mergeCommercialDossiers(fixedLeft, fixedRight), 'IMMUTABLE_CONFLICT');
    expect(fixedError).toMatchObject({ recordId: fixed.id });
    const attachmentRight = commercialDossierSchema.parse(dossier({ agreements: [agreement(agreementId)], attachmentRefs: [{ ...file, sha256: 'c'.repeat(64) }] }));
    conflict(() => mergeCommercialDossiers(commercialDossierSchema.parse(dossier({ agreements: [agreement(agreementId)], attachmentRefs: [file] })), attachmentRight), 'IMMUTABLE_CONFLICT');
  });

  it('allows draft cleanup shapes but preserves fixed history; storage CAS is still required separately', () => {
    const agreementId = id(90), fixedFileId = id(91), tempFileId = id(92), signatureFileId = id(93), fixedId = id(94), reportId = id(95);
    const base = commercialDossierSchema.parse(dossier({
      agreements: [
        agreement(agreementId, 'customer_commission', {
          draft: draft(agreementId, id(96), 'temp-token', { content: content({ documentRefs: [tempFileId], scopeIn: '临时草稿' }) }),
          versions: [version(fixedId, fixedFileId)],
        }),
        agreement(id(97), 'supplier_engagement'),
      ],
      attachmentRefs: [attachment(fixedFileId, agreementId), attachment(tempFileId, agreementId), attachment(signatureFileId, agreementId, { purpose: 'signature_evidence' })],
      signatureReports: [report(reportId, agreementId, fixedId, signatureFileId)],
    }));
    const cleaned = structuredClone(base);
    cleaned.agreements[0].draft = null;
    cleaned.agreements = cleaned.agreements.filter(value => value.id !== id(97));
    cleaned.attachmentRefs = cleaned.attachmentRefs.filter(value => value.id !== tempFileId);
    expect(() => assertCommercialHistoryPreserved(base, cleaned)).not.toThrow();
    const changedDraft = structuredClone(base);
    changedDraft.agreements[0].draft!.content.scopeIn = '新的草稿范围';
    expect(() => assertCommercialHistoryPreserved(base, changedDraft)).not.toThrow();
    const draftStillReferencesDeleted = structuredClone(base);
    draftStillReferencesDeleted.attachmentRefs = draftStillReferencesDeleted.attachmentRefs.filter(value => value.id !== tempFileId);
    expect(() => assertCommercialHistoryPreserved(base, draftStillReferencesDeleted)).toThrow();
    const deletedFixedFile = structuredClone(base);
    deletedFixedFile.attachmentRefs = deletedFixedFile.attachmentRefs.filter(value => value.id !== fixedFileId);
    expect(() => assertCommercialHistoryPreserved(base, deletedFixedFile)).toThrow();
    const deletedReportFile = structuredClone(base);
    deletedReportFile.attachmentRefs = deletedReportFile.attachmentRefs.filter(value => value.id !== signatureFileId);
    expect(() => assertCommercialHistoryPreserved(base, deletedReportFile)).toThrow();
    const changedTemp = structuredClone(base);
    changedTemp.attachmentRefs.find(value => value.id === tempFileId)!.sha256 = 'd'.repeat(64);
    expect(() => assertCommercialHistoryPreserved(base, changedTemp)).toThrow();
    const removedReport = structuredClone(base);
    removedReport.signatureReports = [];
    expect(() => assertCommercialHistoryPreserved(base, removedReport)).toThrow();
  });

  it('keeps customer and supplier histories distinct even with the same file name and external task reference', () => {
    const a = id(100), b = id(101), fileA = attachment(id(102), a, { sha256: 'a'.repeat(64) }),
      fileB = attachment(id(103), b, { sha256: 'b'.repeat(64) });
    const sharedTask = id(999);
    const source = commercialDossierSchema.parse(dossier({ dataKind: 'rehearsal',
      agreements: [agreement(a, 'customer_commission', { versions: [version(id(104), fileA.id, {
        content: fixedContent(fileA.id, { references: { taskIds: [sharedTask] },
          paymentPlanNodes: [{ id: id(105), label: '首款', direction: 'receivable', triggerNote: '按原约定', amount: { amountMinor: 0, currency: 'CNY', basisNote: '明确零' } }] }),
      })] }), agreement(b, 'supplier_engagement', { versions: [version(id(106), fileB.id, {
        content: fixedContent(fileB.id, { references: { taskIds: [sharedTask] },
          paymentPlanNodes: [{ id: id(107), label: '租赁款', direction: 'payable', dueOn: day(12) }] }),
      })] })], attachmentRefs: [fileA, fileB],
      signatureReports: [report(id(108), a, id(104), fileA.id), report(id(109), b, id(106), fileB.id, { signedOn: null })],
    }));
    expect(source.attachmentRefs.map(value => value.fileName)).toEqual(['agreement.pdf', 'agreement.pdf']);
    expect(source.attachmentRefs.map(value => value.sha256)).toEqual(['a'.repeat(64), 'b'.repeat(64)]);
    expect(source.agreements.map(value => value.versions[0].content.paymentPlanNodes[0].direction)).toEqual(['receivable', 'payable']);
    expect(source.agreements[1].versions[0].content.paymentPlanNodes[0].amount.amountMinor).toBeNull();
    expect(projectCommercialSignatures(source).effectiveReports).toHaveLength(2);
    expect(source).not.toHaveProperty('actualPayments');
  });

  it('rejects report orphans, forks, cycles, retargeting and drafts used as fixed versions', () => {
    const a = id(120), b = id(121), fileA = attachment(id(122), a), fileB = attachment(id(123), b);
    const fixedA = version(id(124), fileA.id), fixedB = version(id(125), fileB.id), root = report(id(126), a, fixedA.id, fileA.id);
    const correction = { id: id(127), agreementId: a, versionId: fixedA.id, kind: 'correction', targetId: root.id,
      reason: '更正', replacement: { observedParties: ['our'], signedOn: null, evidenceNote: '原件待核', attachmentIds: [fileA.id] }, recordedAt: ts(10), recordedBy: '复核员' };
    const base = dossier({ agreements: [agreement(a, 'customer_commission', { versions: [fixedA], draft: draft(a, id(128)) }),
      agreement(b, 'supplier_engagement', { versions: [fixedB] })], attachmentRefs: [fileA, fileB] });
    expect(commercialDossierSchema.safeParse({ ...base, signatureReports: [root, correction] }).success).toBe(true);
    for (const reports of [
      [root, { ...correction, targetId: id(999) }],
      [root, correction, { ...correction, id: id(129) }],
      [root, { ...correction, targetId: id(130) }, { ...correction, id: id(130), targetId: correction.id }],
      [root, { ...correction, agreementId: b, versionId: fixedB.id, replacement: { ...correction.replacement, attachmentIds: [fileB.id] } }],
      [{ ...root, versionId: id(128) }],
      [{ ...root, attachmentIds: [fileB.id] }],
      [root, { id: id(131), agreementId: a, versionId: fixedA.id, kind: 'void', targetId: root.id,
        reason: '误录', evidenceNote: '保留旧报告', attachmentIds: [fileA.id], recordedAt: ts(10), recordedBy: '复核员' },
        { ...correction, targetId: id(131) }],
    ]) expect(commercialDossierSchema.safeParse({ ...base, signatureReports: reports }).success).toBe(false);
    for (const signedOn of ['0000-01-01', '2026-02-29', '2026-10-09T00:00:00Z']) {
      expect(commercialSignatureReportSchema.safeParse({ ...root, signedOn }).success).toBe(false);
    }
  });

  it('rejects union forks and cross-project/nature imports while preserving existing history and original UUID spelling', () => {
    const a = id(140), file = attachment(id(141), a), fixed = version(id(142), file.id);
    const initial = commercialDossierSchema.parse(dossier({ agreements: [agreement(a, 'customer_commission', { versions: [fixed] })], attachmentRefs: [file] }));
    const alias = structuredClone(initial); alias.agreements[0].id = a.toUpperCase();
    alias.agreements[0].versions[0].id = fixed.id.toUpperCase();
    alias.agreements[0].versions[0].content.documentRefs = [file.id.toUpperCase()];
    alias.attachmentRefs[0].id = file.id.toUpperCase(); alias.attachmentRefs[0].agreementId = a.toUpperCase();
    expect(mergeCommercialDossiers(initial, alias)).toEqual(initial);
    expect(mergeCommercialDossiers(initial, commercialDossierSchema.parse(dossier()))).toEqual(initial);
    conflict(() => assertCommercialHistoryPreserved(initial, alias), 'IMMUTABLE_CONFLICT');
    conflict(() => mergeCommercialDossiers(initial, { ...initial, projectId: initial.projectId.toUpperCase() }), 'PROJECT_MISMATCH');
    conflict(() => mergeCommercialDossiers(initial, { ...initial, dataKind: 'real' }), 'DATA_KIND_CONFLICT');
    const branch = (versionId: string) => commercialDossierSchema.parse(dossier({ agreements: [agreement(a, 'customer_commission', {
      versions: [fixed, version(versionId, file.id, { basedOnVersionId: fixed.id, recordedAt: ts(10) })],
    })], attachmentRefs: [file] }));
    conflict(() => mergeCommercialDossiers(branch(id(143)), branch(id(144))), 'INVALID_MERGE');
    const before = structuredClone(initial); mergeCommercialDossiers(initial, branch(id(143)));
    expect(initial).toEqual(before);
    const duplicate = { ...initial, attachmentRefs: [file, { ...file, id: file.id.toUpperCase() }] };
    expect(commercialDossierSchema.safeParse(duplicate).success).toBe(false);
    expect(commercialDossierSchema.safeParse({ ...initial, agreements: [{ ...initial.agreements[0], draft: draft(a, id(145), 'Token', { basedOnVersionId: id(999) }) }] }).success).toBe(false);
  });

  it('preserves earlier report evidence after a void and does not infer anything from a backward recording clock', () => {
    const a = id(160), baseFile = attachment(id(161), a), oldFile = attachment(id(162), a), voidFile = attachment(id(163), a);
    const fixed = version(id(164), baseFile.id), older = version(id(165), baseFile.id, { basedOnVersionId: fixed.id, recordedAt: ts(8) });
    const root = report(id(166), a, fixed.id, oldFile.id);
    const correction = { id: id(167), agreementId: a, versionId: fixed.id, kind: 'correction', targetId: root.id,
      reason: '纠正误录', replacement: { observedParties: ['counterparty'], signedOn: null, evidenceNote: '重新核对', attachmentIds: [baseFile.id] }, recordedAt: ts(8), recordedBy: '复核员' };
    const voided = { id: id(168), agreementId: a, versionId: fixed.id, kind: 'void', targetId: correction.id,
      reason: '误报告', evidenceNote: '保留源依据', attachmentIds: [voidFile.id], recordedAt: ts(10), recordedBy: '复核员' };
    const source = commercialDossierSchema.parse(dossier({ agreements: [agreement(a, 'customer_commission', { versions: [older, fixed] })],
      attachmentRefs: [baseFile, oldFile, voidFile], signatureReports: [root, correction, voided] }));
    const result = projectCommercialSignatures(source);
    expect(result).toMatchObject({ effectiveReports: [], voidedRootIds: [root.id] });
    expect(result.recordingTimeConflictIds).toEqual([older.id, correction.id]);
    const changedOld = structuredClone(source); changedOld.attachmentRefs[1].sha256 = 'a'.repeat(64);
    conflict(() => assertCommercialHistoryPreserved(source, changedOld), 'IMMUTABLE_CONFLICT');
    const removedVersion = structuredClone(source); removedVersion.agreements[0].versions = [source.agreements[0].versions.find(value => value.id === fixed.id)!];
    conflict(() => assertCommercialHistoryPreserved(source, removedVersion), 'IMMUTABLE_CONFLICT');
    for (const recordedAt of [ts(9), '2026-10-09T01:00:00Z', ts(10)]) {
      const legal = commercialDossierSchema.parse({ ...source, agreements: [{ ...source.agreements[0], versions: [fixed] }],
        signatureReports: [root, { ...correction, recordedAt }] });
      expect(projectCommercialSignatures(legal).recordingTimeConflictIds).toEqual([]);
    }
  });

  it('does not acquire clock/random/I/O facts and strictly rejects money or legal effects at any level', () => {
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => { throw new Error('clock unavailable'); });
    const random = vi.spyOn(Math, 'random').mockImplementation(() => { throw new Error('random unavailable'); });
    try {
      const parsed = commercialDossierSchema.parse(dossier({ agreements: [agreement(id(180), 'supplier_engagement', { draft: draft(id(180), id(181), ' Exact opaque Token ') })] }));
      expect(projectCommercialSignatures(parsed).effectiveReports).toEqual([]);
      expect(mergeCommercialDossiers(parsed, parsed)).toEqual(parsed);
      expect(parsed.agreements[0].draft?.draftToken).toBe(' Exact opaque Token ');
      expect(clock).not.toHaveBeenCalled(); expect(random).not.toHaveBeenCalled();
    } finally { clock.mockRestore(); random.mockRestore(); }
    for (const key of ['actualPayments', 'refunds', 'invoices', 'legallyEffective', 'signedByPlatform']) {
      expect(commercialDossierSchema.safeParse({ ...dossier(), [key]: [] }).success).toBe(false);
      expect(commercialContentSchema.safeParse({ [key]: true }).success).toBe(false);
      expect(commercialPaymentPlanNodeSchema.safeParse({ id: id(182), [key]: 0 }).success).toBe(false);
    }
    for (const amountMinor of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity]) {
      expect(commercialContentSchema.safeParse({ fileAmount: { amountMinor, currency: 'CNY', basisNote: '来源' } }).success).toBe(false);
    }
    expect(commercialContentSchema.safeParse({ references: { objectIds: [id(183), id(183).toUpperCase()] } }).success).toBe(false);
    expect(commercialContentSchema.parse({ references: { objectIds: ['Legacy', 'legacy'] } }).references.objectIds).toEqual(['Legacy', 'legacy']);
  });

  it('rejects non-JSON business values without performing I/O', () => {
    const valid = dossier();
    const getter = { ...valid } as Record<string, unknown>;
    const getProject = vi.fn(() => 'project-commercial-1');
    Object.defineProperty(getter, 'projectId', { enumerable: true, get: getProject });
    const cycle = { ...valid } as Record<string, unknown>;
    cycle.self = cycle;
    const fetcher = vi.spyOn(globalThis, 'fetch');
    expect(() => commercialDossierSchema.parse({ projectId: 'project-commercial-1' })).not.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
    expect(commercialDossierSchema.safeParse(getter).success).toBe(false);
    expect(getProject).not.toHaveBeenCalled();
    expect(commercialDossierSchema.safeParse(cycle).success).toBe(false);
    expect(commercialDossierSchema.safeParse({ ...valid, projectId: undefined }).success).toBe(false);
    fetcher.mockRestore();
  });
});
