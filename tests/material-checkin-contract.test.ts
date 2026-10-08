import { describe, expect, it } from 'vitest';
import {
  materialCheckinAgreementSchema,
  materialCheckinEventSchema,
  materialCheckinSheetSchema,
  materialCheckinLedgerSchema,
  optionalMaterialCheckinLedgerSchema,
  materialCheckinSummary,
  mergeMaterialCheckinLedgers,
  projectMaterialCheckinEvents,
  type MaterialCheckinConflict,
  type MaterialCheckinLedger,
  type MaterialCheckinProjection,
} from '../supabase/functions/_shared/material-checkin-contract.ts';

const uuid = (n: number) => `a0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const upper = (id: string) => id.toUpperCase();

const times = {
  agreementRoot: '2026-10-01T09:00:00+08:00',
  agreementLatest: '2026-10-02T09:00:00+08:00',
  recorded: '2026-10-03T09:00:00+08:00',
  recordedLater: '2026-10-04T09:00:00+08:00',
  occurred: '2026-10-03T08:00:00+08:00',
  occurredLater: '2026-10-03T10:00:00+08:00',
  correction: '2026-10-05T09:00:00+08:00',
};

const agreement = (id = uuid(1), extra: Record<string, unknown> = {}) => ({
  id,
  agreedQuantity: null,
  basisNote: '',
  recordedAt: times.agreementRoot,
  recordedBy: '记录员',
  ...extra,
});

const payload = (extra: Record<string, unknown> = {}) => ({
  batchRef: '',
  quantity: null,
  checkState: 'pending',
  occurredAt: null,
  fromPartyName: '',
  toPartyName: '',
  evidenceNote: '',
  evidenceUrls: [],
  ...extra,
});

const rootEvent = (id = uuid(2), kind: 'receive' | 'return' = 'receive', extra: Record<string, unknown> = {}) => ({
  id,
  kind,
  ...payload(),
  recordedAt: times.recorded,
  recordedBy: '记录员',
  ...extra,
});

const checked = (quantity: number, extra: Record<string, unknown> = {}) => payload({
  batchRef: '批次-1',
  quantity,
  checkState: 'checked',
  occurredAt: times.occurred,
  fromPartyName: '供方',
  toPartyName: '现场',
  evidenceNote: '现场点验',
  ...extra,
});

const correction = (
  id: string,
  targetId: string,
  replacement: Record<string, unknown> = {},
  extra: Record<string, unknown> = {},
) => ({
  id,
  kind: 'correction',
  targetId,
  reason: '更正依据',
  replacement: payload(replacement),
  recordedAt: times.correction,
  recordedBy: '复核员',
  ...extra,
});

const voidEvent = (id: string, targetId: string, extra: Record<string, unknown> = {}) => ({
  id,
  kind: 'void',
  targetId,
  reason: '作废依据',
  evidenceNote: '现场记录作废',
  evidenceUrls: [],
  recordedAt: times.correction,
  recordedBy: '复核员',
  ...extra,
});

const sheet = (id = uuid(10), extra: Record<string, unknown> = {}) => ({
  id,
  acquisitionId: uuid(900),
  acquisitionSnapshot: { title: '租椅', supplierName: '', specificationNote: '' },
  unit: 'piece',
  agreements: [agreement(uuid(11))],
  events: [],
  ...extra,
});

const ledger = (sheets: unknown[] = [], extra: Record<string, unknown> = {}) => ({
  projectId: 'layout-1',
  sheets,
  ...extra,
});

const checkConflict = (action: () => unknown, code: string) => {
  let error: MaterialCheckinConflict | undefined;
  try {
    action();
  } catch (caught) {
    error = caught as MaterialCheckinConflict;
  }
  expect(error).toMatchObject({ code });
  return error!;
};

const validCheckedReceive = (id: string, quantity: number, extra: Record<string, unknown> = {}) =>
  rootEvent(id, 'receive', { ...checked(quantity), ...extra });

describe('material check-in ledger contract', () => {
  it('defaults an explicit ledger without inventing a project identity, and keeps optional input optional', () => {
    expect(materialCheckinLedgerSchema.parse({ projectId: ' layout-1 ' })).toEqual({
      schemaVersion: 1,
      projectId: ' layout-1 ',
      dataKind: 'unspecified',
      sheets: [],
    });
    expect(optionalMaterialCheckinLedgerSchema.parse(undefined)).toBeUndefined();
    expect(optionalMaterialCheckinLedgerSchema.parse({ projectId: 'layout-1' })).toMatchObject({ sheets: [] });
    for (const projectId of ['', null, 42]) {
      expect(materialCheckinLedgerSchema.safeParse({ projectId }).success).toBe(false);
    }
    for (const dataKind of ['confirmed', '', null]) {
      expect(materialCheckinLedgerSchema.safeParse({ projectId: 'layout-1', dataKind }).success).toBe(false);
    }
  });

  it('creates sheet, agreement and event defaults without rewriting source text', () => {
    const parsed = materialCheckinLedgerSchema.parse({
      projectId: 'layout-1',
      sheets: [sheet(uuid(20), {
        acquisitionSnapshot: { title: ' 租椅 ', supplierName: ' 供方 ', specificationNote: ' 当时依据 ' },
        agreements: [agreement(uuid(21), { basisNote: ' 约定依据 ', recordedBy: ' 记录员 ' })],
        events: [rootEvent(uuid(22))],
      })],
    });
    expect(parsed.sheets[0]).toMatchObject({
      id: uuid(20), acquisitionId: uuid(900), unit: 'piece', events: [expect.objectContaining({ id: uuid(22) })],
    });
    expect(parsed.sheets[0].acquisitionSnapshot).toEqual({ title: ' 租椅 ', supplierName: ' 供方 ', specificationNote: ' 当时依据 ' });
    expect(parsed.sheets[0].agreements[0].basisNote).toBe(' 约定依据 ');
    expect(parsed.sheets[0].agreements[0].recordedBy).toBe(' 记录员 ');
    expect(parsed.sheets[0].events[0]).toEqual({
      id: uuid(22), kind: 'receive', batchRef: '', quantity: null, checkState: 'pending', occurredAt: null,
      fromPartyName: '', toPartyName: '', evidenceNote: '', evidenceUrls: [],
      recordedAt: times.recorded, recordedBy: '记录员',
    });
    expect(materialCheckinSheetSchema.parse(sheet(uuid(23))).events).toEqual([]);
    expect(materialCheckinAgreementSchema.parse(agreement(uuid(24)))).not.toHaveProperty('supersedesId');
  });

  it('requires acquisition identity, immutable header fields and at least one agreement', () => {
    for (const change of [
      { acquisitionSnapshot: { title: '', supplierName: '', specificationNote: '' } },
      { acquisitionSnapshot: { title: ' \t\n ', supplierName: '', specificationNote: '' } },
      { unit: 'box' }, { unit: '' }, { agreements: [] },
      { events: 'not-an-array' }, { revision: 1 },
    ]) {
      expect(materialCheckinSheetSchema.safeParse({ ...sheet(uuid(30)), ...change }).success).toBe(false);
    }
    expect(materialCheckinSheetSchema.safeParse({ ...sheet(uuid(32)), acquisitionId: 'not-a-uuid' }).success).toBe(false);
    expect(materialCheckinLedgerSchema.safeParse({ projectId: 'layout-1', sheets: 'not-an-array' }).success).toBe(false);
  });

  it('enforces agreement quantities, basis evidence, recorded time and recorder identity', () => {
    expect(materialCheckinAgreementSchema.parse(agreement(uuid(40), { agreedQuantity: 0, basisNote: '明确为零' })).agreedQuantity).toBe(0);
    expect(materialCheckinAgreementSchema.parse(agreement(uuid(41), { agreedQuantity: Number.MAX_SAFE_INTEGER, basisNote: '安全上限' })).agreedQuantity)
      .toBe(Number.MAX_SAFE_INTEGER);
    for (const value of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, Number.POSITIVE_INFINITY, Number.NaN]) {
      expect(materialCheckinAgreementSchema.safeParse(agreement(uuid(42), { agreedQuantity: value, basisNote: '依据' })).success).toBe(false);
    }
    for (const basisNote of ['', ' ' + String.fromCharCode(9, 10) + ' ']) {
      expect(materialCheckinAgreementSchema.safeParse(agreement(uuid(43), { agreedQuantity: 0, basisNote })).success).toBe(false);
    }
    const originalBasis = ' ' + String.fromCharCode(10) + '未知数量 ' + String.fromCharCode(9);
    expect(materialCheckinAgreementSchema.parse(agreement(uuid(44), { basisNote: originalBasis })).basisNote).toBe(originalBasis);
    for (const recordedBy of ['', ' ' + String.fromCharCode(9, 10) + ' ', null, 42]) {
      expect(materialCheckinAgreementSchema.safeParse(agreement(uuid(45), { recordedBy })).success).toBe(false);
    }
    for (const recordedAt of [
      '2024-02-29T09:30:00+08:00', '2026-10-03T01:30:00Z', '2026-10-03T09:30:00.123-05:30',
    ]) {
      expect(materialCheckinAgreementSchema.parse(agreement(uuid(46), { recordedAt })).recordedAt).toBe(recordedAt);
    }
    for (const recordedAt of [
      '0000-01-01T00:00:00Z', '2026-02-29T09:30:00Z', '2026-10-03T09:30:00',
      '2026-10-03T09:30:00-00:00', '2026-10-03T09:30:00.1234Z', 'not-a-date',
    ]) {
      expect(materialCheckinAgreementSchema.safeParse(agreement(uuid(47), { recordedAt })).success).toBe(false);
    }
  });

  it('validates root event payloads, explicit zero and checked evidence without inventing authentication', () => {
    const unknown = materialCheckinEventSchema.parse(rootEvent(uuid(50)));
    const zero = materialCheckinEventSchema.parse(validCheckedReceive(uuid(51), 0));
    const returned = materialCheckinEventSchema.parse(rootEvent(uuid(52), 'return', {
      ...checked(2), evidenceNote: '', evidenceUrls: ['https://example.test/check/2'],
    }));
    if (unknown.kind !== 'receive' || zero.kind !== 'receive' || returned.kind !== 'return') throw new Error('Expected check events');
    expect(unknown.quantity).toBeNull();
    expect(zero.quantity).toBe(0);
    expect(returned.evidenceUrls).toEqual(['https://example.test/check/2']);
    for (const kind of ['receive', 'return'] as const) {
      expect(materialCheckinEventSchema.safeParse(rootEvent(uuid(53), kind, {
        ...checked(2), quantity: null,
      })).success).toBe(false);
      for (const field of ['batchRef', 'fromPartyName', 'toPartyName'] as const) {
        expect(materialCheckinEventSchema.safeParse(rootEvent(uuid(54), kind, {
          ...checked(2), [field]: ' ' + String.fromCharCode(9, 10) + ' ',
        })).success).toBe(false);
      }
      expect(materialCheckinEventSchema.safeParse(rootEvent(uuid(55), kind, {
        ...checked(2), evidenceNote: '', evidenceUrls: [],
      })).success).toBe(false);
    }
    for (const value of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, Number.NaN]) {
      expect(materialCheckinEventSchema.safeParse(validCheckedReceive(uuid(56), value)).success).toBe(false);
    }
    expect(materialCheckinEventSchema.safeParse(rootEvent(uuid(57), 'receive', {
      verifiedBy: '签名人', actualQuantity: 2,
    })).success).toBe(false);
    expect(materialCheckinEventSchema.safeParse(rootEvent(uuid(58), 'receive', {
      evidenceUrls: ['javascript:alert(1)'],
    })).success).toBe(false);
  });

  it('requires complete correction and void records with immutable direction and evidence', () => {
    const root = validCheckedReceive(uuid(60), 18);
    const replacement = correction(uuid(61), root.id, checked(16));
    expect(materialCheckinEventSchema.parse(replacement)).toMatchObject({
      kind: 'correction', targetId: root.id, replacement: { quantity: 16, checkState: 'checked' },
    });
    expect(materialCheckinEventSchema.safeParse({ ...replacement, replacement: { quantity: 16 } }).success).toBe(false);
    for (const field of ['batchRef', 'quantity', 'checkState', 'occurredAt', 'fromPartyName', 'toPartyName', 'evidenceNote', 'evidenceUrls'] as const) {
      const incomplete: Record<string, unknown> = { ...checked(16) };
      delete incomplete[field];
      expect(materialCheckinEventSchema.safeParse({ ...replacement, replacement: incomplete }).success).toBe(false);
    }
    expect(materialCheckinEventSchema.safeParse({ ...replacement, replacement: { ...checked(16), kind: 'return' } }).success).toBe(false);
    expect(materialCheckinEventSchema.safeParse({ ...replacement, replacement: { ...checked(16), id: uuid(62) } }).success).toBe(false);
    expect(materialCheckinEventSchema.safeParse({ ...replacement, reason: ' ' + String.fromCharCode(9, 10) + ' ' }).success).toBe(false);
    const voided = voidEvent(uuid(63), root.id);
    expect(materialCheckinEventSchema.parse(voided)).toMatchObject({ kind: 'void', targetId: root.id, reason: '作废依据' });
    expect(materialCheckinEventSchema.safeParse({ ...voided, reason: '', evidenceNote: '', evidenceUrls: [] }).success).toBe(false);
    expect(materialCheckinEventSchema.safeParse({ ...voided, evidenceUrls: ['not-a-url'], evidenceNote: '' }).success).toBe(false);
  });

  it('accepts one agreement chain and rejects missing targets, roots, forks, cycles and cross-sheet links', () => {
    const root = agreement(uuid(70), { agreedQuantity: 20, basisNote: '初版约定' });
    const latest = agreement(uuid(71), {
      supersedesId: root.id, agreedQuantity: 18, basisNote: '修订约定', recordedAt: times.agreementLatest,
    });
    expect(materialCheckinSheetSchema.parse(sheet(uuid(72), { agreements: [root, latest] })).agreements).toHaveLength(2);
    expect(materialCheckinSheetSchema.safeParse(sheet(uuid(73), {
      agreements: [root, agreement(uuid(74), { supersedesId: uuid(999), agreedQuantity: 18, basisNote: '缺目标' })],
    })).success).toBe(false);
    expect(materialCheckinSheetSchema.safeParse(sheet(uuid(75), {
      agreements: [root, agreement(uuid(76), { agreedQuantity: 18, basisNote: '第二根' })],
    })).success).toBe(false);
    expect(materialCheckinSheetSchema.safeParse(sheet(uuid(77), {
      agreements: [root,
        agreement(uuid(78), { supersedesId: root.id, agreedQuantity: 18, basisNote: '分叉一' }),
        agreement(uuid(79), { supersedesId: root.id, agreedQuantity: 17, basisNote: '分叉二' }),
      ],
    })).success).toBe(false);
    const cycleA = agreement(uuid(80), { supersedesId: uuid(81), agreedQuantity: 20, basisNote: '循环A' });
    const cycleB = agreement(uuid(81), { supersedesId: cycleA.id, agreedQuantity: 19, basisNote: '循环B' });
    expect(materialCheckinSheetSchema.safeParse(sheet(uuid(82), { agreements: [cycleA, cycleB] })).success).toBe(false);
    const agreementFirstSheet = sheet(uuid(85), { agreements: [root] });
    const agreementSecondSheet = sheet(uuid(86), {
      agreements: [agreement(uuid(87), { supersedesId: root.id, agreedQuantity: 18, basisNote: '跨单' })],
    });
    expect(materialCheckinLedgerSchema.safeParse(ledger([agreementFirstSheet, agreementSecondSheet])).success).toBe(false);
  });

  it('rejects invalid event correction graphs while keeping a valid correction chain', () => {
    const root = validCheckedReceive(uuid(90), 18);
    const first = correction(uuid(91), root.id, checked(17));
    const second = correction(uuid(92), first.id, checked(16), { recordedAt: '2026-10-06T09:00:00+08:00' });
    expect(materialCheckinSheetSchema.parse(sheet(uuid(93), { events: [root, first, second] })).events).toHaveLength(3);
    expect(materialCheckinSheetSchema.safeParse(sheet(uuid(94), {
      events: [root, correction(uuid(95), uuid(999), checked(16))],
    })).success).toBe(false);
    expect(materialCheckinSheetSchema.safeParse(sheet(uuid(96), {
      events: [root, first, correction(uuid(97), root.id, checked(16), { recordedAt: '2026-10-06T09:00:00+08:00' })],
    })).success).toBe(false);
    const voided = voidEvent(uuid(100), root.id);
    expect(materialCheckinSheetSchema.safeParse(sheet(uuid(101), {
      events: [root, voided, correction(uuid(102), voided.id, checked(16))],
    })).success).toBe(false);
    const cycleA = correction(uuid(103), uuid(104), checked(15));
    const cycleB = correction(uuid(104), cycleA.id, checked(14), { recordedAt: '2026-10-06T09:00:00+08:00' });
    expect(materialCheckinSheetSchema.safeParse(sheet(uuid(105), { events: [root, cycleA, cycleB] })).success).toBe(false);
    const eventFirstSheet = sheet(uuid(106), { events: [root] });
    const eventSecondSheet = sheet(uuid(107), { events: [correction(uuid(108), root.id, checked(16))] });
    expect(materialCheckinLedgerSchema.safeParse(ledger([eventFirstSheet, eventSecondSheet])).success).toBe(false);
  });

  it('preserves clock regressions for agreements, corrections and voids and diagnoses the complete source chain', () => {
    const at = '2026-10-03T12:00:00+08:00', earlier = times.recorded;
    const baseline = agreement(uuid(700), { agreedQuantity: 20, basisNote: '原约定', recordedAt: at });
    const revised = agreement(uuid(701), { supersedesId: baseline.id, agreedQuantity: 18, basisNote: '第二设备核对', recordedAt: earlier });
    const received = validCheckedReceive(uuid(702), 19, { recordedAt: at });
    const corrected = correction(uuid(703), received.id, checked(18), { recordedAt: earlier });
    const returned = rootEvent(uuid(704), 'return', checked(18));
    const parsed = materialCheckinSheetSchema.parse(sheet(uuid(705), { agreements: [revised, baseline], events: [corrected, returned, received] }));
    expect(projectMaterialCheckinEvents(parsed).agreement.id).toBe(revised.id);
    expect(materialCheckinSummary(parsed)).toMatchObject({ receivedQuantity: 18, returnedQuantity: 18, needsReview: true,
      issues: [{ code: 'recording-time-conflict', eventIds: [revised.id, corrected.id] }] });
    expect(parsed.events.find(value => value.id === received.id)?.recordedAt).toBe(at);
    expect(parsed.events.find(value => value.id === corrected.id)?.recordedAt).toBe(earlier);
    const terminal = voidEvent(uuid(706), corrected.id, { recordedAt: times.recordedLater });
    const removed = materialCheckinSheetSchema.parse({ ...parsed, events: [...parsed.events, terminal] });
    expect(materialCheckinSummary(removed).issues).toContainEqual({ code: 'recording-time-conflict', eventIds: [revised.id, corrected.id] });
    const earlyVoid = materialCheckinSheetSchema.parse(sheet(uuid(707), {
      events: [received, voidEvent(uuid(708), received.id, { recordedAt: earlier })],
    }));
    expect(materialCheckinSummary(earlyVoid).issues).toContainEqual({ code: 'recording-time-conflict', eventIds: [uuid(708)] });
    const merged = mergeMaterialCheckinLedgers(materialCheckinLedgerSchema.parse(ledger([parsed])), materialCheckinLedgerSchema.parse(ledger([removed])));
    expect(merged.sheets[0].events).toHaveLength(4);
    expect(projectMaterialCheckinEvents(merged.sheets[0]).voidedRootIds).toEqual([received.id]);
  });

  it('does not report a recording conflict for equal instants, equivalent offsets or increasing clocks', () => {
    for (const recordedAt of [times.recorded, '2026-10-03T01:00:00Z', times.recordedLater]) {
      const baseline = agreement(uuid(710), { agreedQuantity: 18, basisNote: '原约定', recordedAt: times.recorded });
      const revised = agreement(uuid(711), { supersedesId: baseline.id, agreedQuantity: 18, basisNote: '复核', recordedAt });
      const received = validCheckedReceive(uuid(712), 18);
      const corrected = correction(uuid(713), received.id, checked(18), { recordedAt });
      const parsed = materialCheckinSheetSchema.parse(sheet(uuid(714), { agreements: [baseline, revised], events: [received, corrected, rootEvent(uuid(715), 'return', checked(18))] }));
      expect(materialCheckinSummary(parsed).issues.some(value => value.code === 'recording-time-conflict')).toBe(false);
    }
  });

  it('keeps all source IDs unique case-insensitively and preserves the accepted spelling', () => {
    const id = uuid(110);
    expect(materialCheckinLedgerSchema.safeParse(ledger([
      sheet(uuid(111), { agreements: [agreement(id)] }),
      sheet(uuid(112), { agreements: [agreement(upper(id))] }),
    ])).success).toBe(false);
    expect(materialCheckinLedgerSchema.safeParse(ledger([
      sheet(uuid(113), { events: [rootEvent(id)] }),
      sheet(uuid(114), { events: [rootEvent(upper(id))] }),
    ])).success).toBe(false);
    expect(materialCheckinLedgerSchema.safeParse(ledger([
      sheet(id), sheet(upper(id), { acquisitionId: uuid(901), agreements: [agreement(uuid(902))] }),
    ])).success).toBe(false);
    const preserved = materialCheckinLedgerSchema.parse(ledger([sheet(upper(uuid(115)), {
      agreements: [agreement(upper(uuid(116)))], events: [rootEvent(upper(uuid(117)))],
    })]));
    expect(preserved.sheets[0].id).toBe(upper(uuid(115)));
    expect(preserved.sheets[0].agreements[0].id).toBe(upper(uuid(116)));
    expect(preserved.sheets[0].events[0].id).toBe(upper(uuid(117)));
  });

  it('projects the latest agreement and effective events without deleting source records', () => {
    const agreementRoot = agreement(uuid(120), { agreedQuantity: 20, basisNote: '初版20' });
    const agreementLatest = agreement(uuid(121), {
      supersedesId: agreementRoot.id, agreedQuantity: 18, basisNote: '修订18', recordedAt: times.agreementLatest,
    });
    const receive = validCheckedReceive(uuid(122), 18, { batchRef: '收货-1' });
    const receiveFix = correction(uuid(123), receive.id, checked(17, { batchRef: '收货-1' }));
    const receiveFixLatest = correction(uuid(124), receiveFix.id, checked(16, { batchRef: '收货-1' }), {
      recordedAt: '2026-10-06T09:00:00+08:00',
    });
    const returned = rootEvent(uuid(125), 'return', { ...checked(18), batchRef: '归还-1' });
    const returnedVoid = voidEvent(uuid(126), returned.id);
    const source = materialCheckinSheetSchema.parse(sheet(uuid(127), {
      agreements: [agreementRoot, agreementLatest],
      events: [receive, receiveFix, receiveFixLatest, returned, returnedVoid],
    }));
    const before = structuredClone(source);
    const projection: MaterialCheckinProjection = projectMaterialCheckinEvents(source);
    expect(projection.agreement).toEqual(agreementLatest);
    expect(projection.effectiveEvents).toEqual([{
      rootEventId: receive.id,
      effectiveEventId: receiveFixLatest.id,
      kind: 'receive',
      batchRef: '收货-1', quantity: 16, checkState: 'checked', occurredAt: times.occurred,
      fromPartyName: '供方', toPartyName: '现场', evidenceNote: '现场点验', evidenceUrls: [],
      recordedAt: '2026-10-06T09:00:00+08:00', recordedBy: '复核员',
    }]);
    expect(projection.voidedRootIds).toEqual([returned.id]);
    expect(source).toEqual(before);
  });

  const quantityScenario = (receiveParts: readonly number[], returnParts: readonly number[], suffix: number) => {
    const events = [
      ...receiveParts.map((quantity, i) => validCheckedReceive(uuid(suffix + i), quantity, {
        batchRef: `收-${i + 1}`,
      })),
      ...returnParts.map((quantity, i) => rootEvent(uuid(suffix + 100 + i), 'return', {
        ...checked(quantity), batchRef: `还-${i + 1}`,
      })),
    ];
    return materialCheckinSheetSchema.parse(sheet(uuid(suffix + 200), {
      agreements: [agreement(uuid(suffix + 201), { agreedQuantity: 20, basisNote: '约定20' })],
      events,
    }));
  };

  it.each([
    [[18], [18], 130],
    [[12, 6], [5, 13], 140],
  ] as const)('summarizes %j received and %j returned against an agreed 20', (received, returned, suffix) => {
    expect(materialCheckinSummary(quantityScenario(received, returned, suffix))).toMatchObject({
      agreedQuantity: 20,
      knownReceivedQuantity: 18,
      knownReturnedQuantity: 18,
      receivedQuantity: 18,
      returnedQuantity: 18,
      notReceivedQuantity: 2,
      notReturnedQuantity: 0,
      overReceivedQuantity: 0,
      overReturnedQuantity: 0,
      pendingEventIds: [], disputedEventIds: [], issues: [], needsReview: false,
    });
  });

  it('keeps a direction unknown when it has no events or any pending/disputed event', () => {
    const empty = materialCheckinSheetSchema.parse(sheet(uuid(150), {
      agreements: [agreement(uuid(151), { agreedQuantity: 20, basisNote: '约定20' })],
    }));
    expect(materialCheckinSummary(empty)).toMatchObject({
      knownReceivedQuantity: 0, knownReturnedQuantity: 0,
      receivedQuantity: null, returnedQuantity: null,
      notReceivedQuantity: null, notReturnedQuantity: null,
      overReceivedQuantity: null, overReturnedQuantity: null,
      pendingEventIds: [], disputedEventIds: [],
      issues: [{ code: 'quantity-unknown', eventIds: [] }], needsReview: true,
    });

    const pending = rootEvent(uuid(152), 'receive', {
      batchRef: '待核-1', quantity: null, checkState: 'pending', occurredAt: times.occurred,
    });
    const checkedReceive = validCheckedReceive(uuid(153), 12);
    const disputed = rootEvent(uuid(154), 'return', {
      ...checked(4), batchRef: '争议-1', checkState: 'disputed',
    });
    const partial = materialCheckinSheetSchema.parse(sheet(uuid(155), {
      agreements: [agreement(uuid(156), { agreedQuantity: 20, basisNote: '约定20' })],
      events: [checkedReceive, pending, disputed],
    }));
    const summary = materialCheckinSummary(partial);
    expect(summary).toMatchObject({
      knownReceivedQuantity: 12, knownReturnedQuantity: 0,
      receivedQuantity: null, returnedQuantity: null,
      pendingEventIds: [pending.id], disputedEventIds: [disputed.id], needsReview: true,
    });
    expect(summary.issues).toEqual(expect.arrayContaining([
      { code: 'quantity-unknown', eventIds: [pending.id] },
      { code: 'disputed', eventIds: [disputed.id] },
    ]));
  });

  it('records missing and contradictory times while retaining checked quantities', () => {
    const missingTime = validCheckedReceive(uuid(160), 18, { occurredAt: null });
    const late = validCheckedReceive(uuid(161), 1, {
      occurredAt: times.occurredLater, recordedAt: times.recorded,
    });
    const earlyReturn = rootEvent(uuid(162), 'return', {
      ...checked(18), occurredAt: '2026-10-03T07:00:00+08:00', recordedAt: times.recordedLater,
    });
    const receiveAfter = validCheckedReceive(uuid(163), 18, {
      occurredAt: '2026-10-03T08:00:00+08:00', recordedAt: times.recordedLater,
    });
    const source = materialCheckinSheetSchema.parse(sheet(uuid(164), {
      agreements: [agreement(uuid(165), { agreedQuantity: 20, basisNote: '约定20' })],
      events: [missingTime, late, earlyReturn, receiveAfter],
    }));
    const summary = materialCheckinSummary(source);
    expect(summary.knownReceivedQuantity).toBe(37);
    expect(summary.knownReturnedQuantity).toBe(18);
    expect(summary.receivedQuantity).toBe(37);
    expect(summary.returnedQuantity).toBe(18);
    expect(summary.issues).toEqual(expect.arrayContaining([
      { code: 'missing-time', eventIds: [missingTime.id] },
      { code: 'time-after-recording', eventIds: [late.id] },
      { code: 'return-before-receipt', eventIds: [earlyReturn.id] },
    ]));
    expect(summary.needsReview).toBe(true);
  });

  it('uses effective corrections and treats void as removal of evidence, never as a physical reversal', () => {
    const rootReceive = validCheckedReceive(uuid(170), 18);
    const rootReturn = rootEvent(uuid(171), 'return', { ...checked(18), batchRef: '归还-1' });
    const receiveCorrection = correction(uuid(172), rootReceive.id, checked(16));
    const corrected = materialCheckinSheetSchema.parse(sheet(uuid(173), {
      agreements: [agreement(uuid(174), { agreedQuantity: 20, basisNote: '约定20' })],
      events: [rootReceive, rootReturn, receiveCorrection],
    }));
    expect(materialCheckinSummary(corrected)).toMatchObject({
      knownReceivedQuantity: 16, knownReturnedQuantity: 18,
      receivedQuantity: 16, returnedQuantity: 18,
      notReceivedQuantity: 4, notReturnedQuantity: null,
      overReceivedQuantity: 0, overReturnedQuantity: 2, needsReview: true,
    });
    expect(materialCheckinSummary(corrected).issues).toEqual(expect.arrayContaining([
      { code: 'over-returned', eventIds: expect.arrayContaining([rootReturn.id, receiveCorrection.id]) },
    ]));

    const voidedRoot = validCheckedReceive(uuid(175), 18);
    const voidEventRecord = voidEvent(uuid(176), voidedRoot.id);
    const voided = materialCheckinSheetSchema.parse(sheet(uuid(177), {
      agreements: [agreement(uuid(178), { agreedQuantity: 20, basisNote: '约定20' })],
      events: [voidedRoot, voidEventRecord],
    }));
    const voidSummary = materialCheckinSummary(voided);
    expect(voidSummary).toMatchObject({
      knownReceivedQuantity: 0, receivedQuantity: null, returnedQuantity: null,
      notReceivedQuantity: null, notReturnedQuantity: null,
    });
    expect(projectMaterialCheckinEvents(voided).voidedRootIds).toEqual([voidedRoot.id]);
  });

  it('keeps an unknown agreement unknown and reports over-receive and over-return without clamping', () => {
    const unknownAgreement = materialCheckinSheetSchema.parse(sheet(uuid(180), {
      agreements: [agreement(uuid(181))],
      events: [validCheckedReceive(uuid(182), 18)],
    }));
    expect(materialCheckinSummary(unknownAgreement)).toMatchObject({
      agreedQuantity: null, knownReceivedQuantity: 18, receivedQuantity: 18,
      notReceivedQuantity: null, overReceivedQuantity: null, needsReview: true,
    });
    expect(materialCheckinSummary(unknownAgreement).issues).toContainEqual({ code: 'agreement-unknown', eventIds: [] });

    const overReceived = materialCheckinSheetSchema.parse(sheet(uuid(183), {
      agreements: [agreement(uuid(184), { agreedQuantity: 20, basisNote: '约定20' })],
      events: [validCheckedReceive(uuid(185), 22)],
    }));
    expect(materialCheckinSummary(overReceived)).toMatchObject({
      receivedQuantity: 22, notReceivedQuantity: null, overReceivedQuantity: 2, needsReview: true,
    });
    expect(materialCheckinSummary(overReceived).issues).toContainEqual({ code: 'over-received', eventIds: [uuid(185)] });
  });

  it('keeps the ledger when a checked subtotal would overflow safe integer arithmetic', () => {
    const first = validCheckedReceive(uuid(190), Number.MAX_SAFE_INTEGER, { batchRef: '最大' });
    const second = validCheckedReceive(uuid(191), 1, { batchRef: '溢出' });
    const source = materialCheckinSheetSchema.parse(sheet(uuid(192), {
      agreements: [agreement(uuid(193), { agreedQuantity: Number.MAX_SAFE_INTEGER, basisNote: '上限约定' })],
      events: [first, second],
    }));
    const before = structuredClone(source);
    const summary = materialCheckinSummary(source);
    expect(summary.knownReceivedQuantity).toBeNull();
    expect(summary.receivedQuantity).toBeNull();
    expect(summary.issues).toEqual(expect.arrayContaining([
      { code: 'quantity-overflow', eventIds: expect.arrayContaining([first.id, second.id]) },
    ]));
    expect(source).toEqual(before);
  });

  it('merges complete snapshots idempotently by UUID identity and keeps existing spellings', () => {
    const sharedSheetId = uuid(200);
    const sharedAgreementId = uuid(201);
    const sharedEventId = uuid(202);
    const existing = materialCheckinLedgerSchema.parse(ledger([sheet(sharedSheetId, {
      acquisitionId: uuid(203),
      agreements: [agreement(sharedAgreementId, { agreedQuantity: 20, basisNote: '原始约定' })],
      events: [validCheckedReceive(sharedEventId, 18)],
    })], { dataKind: 'rehearsal', projectId: ' layout-1 ' }));
    const incoming = materialCheckinLedgerSchema.parse(ledger([
      sheet(upper(sharedSheetId), {
        acquisitionId: upper(uuid(203)),
        agreements: [agreement(upper(sharedAgreementId), { agreedQuantity: 20, basisNote: '原始约定' })],
        events: [validCheckedReceive(upper(sharedEventId), 18)],
      }),
      sheet(uuid(204), {
        acquisitionId: uuid(205), agreements: [agreement(uuid(206))], events: [rootEvent(uuid(207))],
      }),
    ], { dataKind: 'rehearsal', projectId: ' layout-1 ' }));
    const existingBefore = structuredClone(existing);
    const incomingBefore = structuredClone(incoming);
    const merged = mergeMaterialCheckinLedgers(existing, incoming);
    expect(merged.sheets).toHaveLength(2);
    expect(merged.sheets[0]).toEqual(existing.sheets[0]);
    expect(merged.sheets[1].id).toBe(uuid(204));
    expect(existing).toEqual(existingBefore);
    expect(incoming).toEqual(incomingBefore);
    expect(merged).not.toBe(existing);
  });

  it('reports project, ledger, sheet-header and record conflicts without overwriting existing data', () => {
    const base = materialCheckinLedgerSchema.parse(ledger([sheet(uuid(210), {
      agreements: [agreement(uuid(211), { agreedQuantity: 20, basisNote: '约定' })],
      events: [validCheckedReceive(uuid(212), 18)],
    })], { dataKind: 'rehearsal' }));
    const projectMismatch = materialCheckinLedgerSchema.parse(ledger(base.sheets, { projectId: 'other-project', dataKind: 'rehearsal' }));
    const projectError = checkConflict(() => mergeMaterialCheckinLedgers(base, projectMismatch), 'PROJECT_MISMATCH');
    expect(projectError).not.toHaveProperty('recordId');
    const ledgerMismatch = materialCheckinLedgerSchema.parse(ledger(base.sheets, { dataKind: 'real' }));
    checkConflict(() => mergeMaterialCheckinLedgers(base, ledgerMismatch), 'LEDGER_METADATA_CONFLICT');
    const sheetMismatch = materialCheckinLedgerSchema.parse(ledger([sheet(uuid(210), {
      acquisitionSnapshot: { title: '另一行', supplierName: '', specificationNote: '' },
      agreements: [agreement(uuid(211), { agreedQuantity: 20, basisNote: '约定' })],
      events: [validCheckedReceive(uuid(212), 18)],
    })], { dataKind: 'rehearsal' }));
    const sheetError = checkConflict(() => mergeMaterialCheckinLedgers(base, sheetMismatch), 'SHEET_METADATA_CONFLICT');
    expect(sheetError).toMatchObject({ sheetId: uuid(210) });
    const recordMismatch = materialCheckinLedgerSchema.parse(ledger([sheet(uuid(210), {
      agreements: [agreement(uuid(211), { agreedQuantity: 19, basisNote: '改过的约定' })],
      events: [validCheckedReceive(uuid(212), 18)],
    })], { dataKind: 'rehearsal' }));
    const recordError = checkConflict(() => mergeMaterialCheckinLedgers(base, recordMismatch), 'RECORD_CONFLICT');
    expect(recordError).toMatchObject({ sheetId: uuid(210), recordId: uuid(211) });
  });

  it('rejects merge forks and incomplete child snapshots instead of treating them as deltas', () => {
    const root = agreement(uuid(220), { agreedQuantity: 20, basisNote: '根约定' });
    const existing = materialCheckinLedgerSchema.parse(ledger([sheet(uuid(221), {
      agreements: [root, agreement(uuid(222), { supersedesId: root.id, agreedQuantity: 18, basisNote: '修订一' })],
    })], { dataKind: 'rehearsal' }));
    const incoming = materialCheckinLedgerSchema.parse(ledger([sheet(uuid(221), {
      agreements: [root, agreement(uuid(223), { supersedesId: root.id, agreedQuantity: 17, basisNote: '修订二' })],
    })], { dataKind: 'rehearsal' }));
    checkConflict(() => mergeMaterialCheckinLedgers(existing, incoming), 'INVALID_MERGE');
    const incomplete = ledger([sheet(uuid(221), {
      agreements: [agreement(uuid(224), { supersedesId: uuid(999), agreedQuantity: 17, basisNote: '增量伪装' })],
    })], { dataKind: 'rehearsal' });
    expect(() => mergeMaterialCheckinLedgers(existing, incomplete as unknown as MaterialCheckinLedger)).toThrow();
  });

  it('rejects non-JSON inputs before schema traversal, including explicit undefined and custom values', () => {
    const valid = ledger();
    const getter = { ...valid } as Record<string, unknown>;
    Object.defineProperty(getter, 'projectId', { enumerable: true, get: () => 'layout-1' });
    const customPrototype = Object.assign(Object.create({ inherited: true }), valid);
    const symbolKey = { ...valid } as Record<PropertyKey, unknown>;
    symbolKey[Symbol('metadata')] = 'hidden';
    const cycle = { ...valid } as Record<string, unknown>;
    cycle.self = cycle;
    const invalid: unknown[] = [
      { ...valid, sheets: undefined }, getter, customPrototype, symbolKey, cycle,
      { ...valid, toJSON: () => valid }, { ...valid, projectId: Symbol('id') },
      { ...valid, projectId: 1n }, { ...valid, projectId: () => 'layout-1' },
      { ...valid, projectId: new Date() },
      ledger([sheet(uuid(230), { agreements: [agreement(uuid(231), { agreedQuantity: NaN, basisNote: '坏数' })] })]),
    ];
    for (const input of invalid) {
      expect(() => materialCheckinLedgerSchema.safeParse(input)).not.toThrow();
      expect(materialCheckinLedgerSchema.safeParse(input).success).toBe(false);
    }
    expect(() => materialCheckinEventSchema.safeParse(rootEvent(uuid(232), 'receive', { batchRef: undefined }))).not.toThrow();
    expect(materialCheckinEventSchema.safeParse(rootEvent(uuid(232), 'receive', { batchRef: undefined })).success).toBe(false);
    expect(materialCheckinEventSchema.safeParse(rootEvent(uuid(233), 'receive', { quantity: Number.NaN })).success).toBe(false);
  });

  it('does not mutate input sheets, ledgers or reference arrays during parse, projection, summary or merge', () => {
    const sourceInput = ledger([sheet(uuid(240), {
      agreements: [agreement(uuid(241), { agreedQuantity: 20, basisNote: '约定' })],
      events: [validCheckedReceive(uuid(242), 18)],
    })]);
    const sourceBefore = structuredClone(sourceInput);
    const parsed = materialCheckinLedgerSchema.parse(sourceInput);
    expect(sourceInput).toEqual(sourceBefore);
    const parsedBefore = structuredClone(parsed);
    projectMaterialCheckinEvents(parsed.sheets[0]);
    materialCheckinSummary(parsed.sheets[0]);
    expect(parsed).toEqual(parsedBefore);
    const other = materialCheckinLedgerSchema.parse(ledger([sheet(uuid(243), {
      agreements: [agreement(uuid(244))], events: [rootEvent(uuid(245))],
    })]));
    const otherBefore = structuredClone(other);
    mergeMaterialCheckinLedgers(parsed, other);
    expect(parsed).toEqual(parsedBefore);
    expect(other).toEqual(otherBefore);
  });
});
