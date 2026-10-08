import { describe, expect, it } from 'vitest';
import {
  productionAcquisitionSchema,
  productionEstimateSchema,
  productionPlanLimits,
  productionPlanSchema,
  productionStaffingSchema,
  optionalProductionPlanSchema,
  productionEstimateSummary,
  resolveProductionPlanReferences,
  type ProductionPlan,
} from '../supabase/functions/_shared/production-plan-contract.ts';

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const staffing = (id = uuid(1), extra: Record<string, unknown> = {}) => ({
  id,
  roleName: '签到执行',
  ...extra,
});

const acquisition = (id = uuid(2), extra: Record<string, unknown> = {}) => ({
  id,
  title: '租椅',
  ...extra,
});

const estimate = (id = uuid(3), extra: Record<string, unknown> = {}) => ({
  id,
  title: '场地费用',
  ...extra,
});

describe('production plan contract', () => {
  it('publishes the frozen limits and makes an optional plan truly optional', () => {
    expect(productionPlanLimits).toMatchObject({
      records: 500,
      references: 500,
      objectId: 128,
      title: 120,
      party: 80,
      note: 1000,
    });
    expect(productionPlanSchema.parse({})).toEqual({
      schemaVersion: 1,
      dataKind: 'unspecified',
      currency: 'CNY',
      budget: null,
      staffing: [],
      acquisitions: [],
      estimates: [],
    });
    expect(optionalProductionPlanSchema.parse(undefined)).toBeUndefined();
    expect(optionalProductionPlanSchema.parse({})).toEqual(productionPlanSchema.parse({}));
  });

  it('keeps a rehearsal check-in and a rental acquisition as planning records only', () => {
    const input = {
      schemaVersion: 1,
      dataKind: 'rehearsal',
      currency: 'CNY',
      budget: { limitMinor: 0, scopeNote: '零预算', basisNote: '演练阶段预算确认' },
      staffing: [staffing(uuid(10).toUpperCase(), {
        roleName: ' 签到执行 ',
        shiftLabel: '午场',
        taskIds: [],
        headcount: 2,
        sourceType: 'internal',
        sourceName: ' 自有团队 ',
        plannedArrivalAt: '2026-10-07T09:30:00+08:00',
        plannedDepartureAt: '2026-10-07T01:30:00Z',
      })],
      acquisitions: [acquisition(uuid(11), {
        title: ' 20把租椅 ',
        taskIds: [],
        objectIds: [],
        method: 'rental',
        supplierName: '场务租赁',
        specificationNote: '20把标准椅',
        sourceNote: '电话确认',
        transportScope: '送达入口',
        installationScope: '现场摆位',
      })],
      estimates: [estimate(uuid(12), { taskIds: [], objectIds: [], amountMinor: 0, basisNote: '演练阶段不计场租' })],
    };
    const before = structuredClone(input);
    const parsed: ProductionPlan = productionPlanSchema.parse(input);
    expect(parsed).toEqual(input);
    expect(input).toEqual(before);
    expect(parsed.staffing[0].id).toBe(uuid(10).toUpperCase());
    expect(parsed.staffing[0].roleName).toBe(' 签到执行 ');
    expect(parsed.acquisitions[0].title).toBe(' 20把租椅 ');
    expect(parsed.estimates[0].amountMinor).toBe(0);
    expect(parsed.acquisitions[0]).not.toHaveProperty('quantity');
    expect(parsed.acquisitions[0]).not.toHaveProperty('object');
    expect(parsed.acquisitions[0]).not.toHaveProperty('price');
  });

  it('fills only the frozen planning defaults and does not invent identity or facts', () => {
    const parsed = productionPlanSchema.parse({
      staffing: [staffing(uuid(20))],
      acquisitions: [acquisition(uuid(21))],
      estimates: [estimate(uuid(22))],
    });
    expect(parsed.staffing[0]).toEqual({
      id: uuid(20), roleName: '签到执行', shiftLabel: '', taskIds: [], headcount: null,
      sourceType: 'unspecified', sourceName: '', plannedArrivalAt: null, plannedDepartureAt: null,
    });
    expect(parsed.acquisitions[0]).toEqual({
      id: uuid(21), title: '租椅', taskIds: [], objectIds: [], method: 'unspecified',
      supplierName: '', specificationNote: '', sourceNote: '', transportScope: '', installationScope: '',
    });
    expect(parsed.estimates[0]).toEqual({
      id: uuid(22), title: '场地费用', taskIds: [], objectIds: [], amountMinor: null, basisNote: '',
    });
    expect(productionPlanSchema.safeParse({ guestCount: 2 }).success).toBe(false);
    for (const field of ['actual', 'quote', 'paid'] as const) {
      expect(productionPlanSchema.safeParse({ [field]: 1 }).success).toBe(false);
      expect(productionPlanSchema.safeParse({ staffing: [staffing(uuid(23), { [field]: 1 })] }).success).toBe(false);
      expect(productionPlanSchema.safeParse({ acquisitions: [acquisition(uuid(24), { [field]: 1 })] }).success).toBe(false);
      expect(productionPlanSchema.safeParse({ estimates: [estimate(uuid(25), { [field]: 1 })] }).success).toBe(false);
    }
  });

  it('requires planning fields to remain strict and currency to stay CNY', () => {
    for (const currency of ['USD', '']) {
      expect(productionPlanSchema.safeParse({ currency }).success).toBe(false);
    }
    expect(productionPlanSchema.parse({ currency: undefined }).currency).toBe('CNY');
    for (const change of [
      { schemaVersion: 2 }, { schemaVersion: '1' }, { dataKind: 'confirmed' },
      { currency: 'CNY', revision: 1 }, { budget: { limitMinor: null, extra: true } },
      { staffing: [staffing(uuid(30), { extra: true })] },
      { acquisitions: [acquisition(uuid(31), { quantity: 20 })] },
      { estimates: [estimate(uuid(32), { recordedAt: '2026-10-07T09:00:00Z' })] },
    ]) {
      expect(productionPlanSchema.safeParse(change).success).toBe(false);
    }
  });

  it.each(['', ' \t\n '])('rejects blank role and titles without manufacturing a value: %j', blank => {
    expect(productionPlanSchema.safeParse({ staffing: [staffing(uuid(40), { roleName: blank })] }).success).toBe(false);
    expect(productionPlanSchema.safeParse({ acquisitions: [acquisition(uuid(41), { title: blank })] }).success).toBe(false);
    expect(productionPlanSchema.safeParse({ estimates: [estimate(uuid(42), { title: blank })] }).success).toBe(false);
  });

  it('allows an empty shift label, but validates nonempty shift labels as bounded text', () => {
    expect(productionStaffingSchema.parse({ ...staffing(uuid(43)), shiftLabel: '' }).shiftLabel).toBe('');
    expect(productionStaffingSchema.safeParse({ ...staffing(uuid(44)), shiftLabel: ' \t\n ' }).success).toBe(false);
    const shiftLabel = '班'.repeat(productionPlanLimits.title);
    expect(productionStaffingSchema.parse({ ...staffing(uuid(45)), shiftLabel }).shiftLabel).toBe(shiftLabel);
    expect(productionStaffingSchema.safeParse({ ...staffing(uuid(46)), shiftLabel: shiftLabel + '班' }).success).toBe(false);
  });

  it('supports explicit zero and enforces nonnegative safe integer planning amounts', () => {
    expect(productionStaffingSchema.parse({ ...staffing(uuid(50)), headcount: 0 }).headcount).toBe(0);
    expect(productionEstimateSchema.parse({ ...estimate(uuid(51)), amountMinor: 0, basisNote: '零元' }).amountMinor).toBe(0);
    expect(productionPlanSchema.parse({
      budget: { limitMinor: 0, scopeNote: '零', basisNote: '已确认' },
    }).budget?.limitMinor).toBe(0);

    for (const value of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, Number.POSITIVE_INFINITY, Number.NaN]) {
      expect(productionPlanSchema.safeParse({ staffing: [staffing(uuid(52), { headcount: value })] }).success).toBe(false);
      expect(productionPlanSchema.safeParse({ estimates: [estimate(uuid(53), { amountMinor: value, basisNote: '依据' })] }).success).toBe(false);
      expect(productionPlanSchema.safeParse({ budget: { limitMinor: value, scopeNote: '范围', basisNote: '依据' } }).success).toBe(false);
    }
    expect(productionPlanSchema.parse({ staffing: [staffing(uuid(54), { headcount: Number.MAX_SAFE_INTEGER })] }).staffing[0].headcount)
      .toBe(Number.MAX_SAFE_INTEGER);
    expect(productionPlanSchema.parse({ estimates: [estimate(uuid(55), { amountMinor: Number.MAX_SAFE_INTEGER, basisNote: '依据' })] }).estimates[0].amountMinor)
      .toBe(Number.MAX_SAFE_INTEGER);
  });

  it('requires basis notes for known budget and estimates, including zero, while preserving text', () => {
    for (const basisNote of ['', ' \t\n ']) {
      expect(productionPlanSchema.safeParse({
        budget: { limitMinor: 0, scopeNote: '范围', basisNote },
      }).success).toBe(false);
      expect(productionPlanSchema.safeParse({
        budget: { limitMinor: 0, scopeNote: basisNote, basisNote: '依据' },
      }).success).toBe(false);
      expect(productionPlanSchema.safeParse({
        estimates: [estimate(uuid(60), { amountMinor: 0, basisNote })],
      }).success).toBe(false);
    }
    expect(productionPlanSchema.parse({
      budget: { limitMinor: null, scopeNote: '', basisNote: '' },
      estimates: [estimate(uuid(61), { amountMinor: null, basisNote: ' \n未知 \t' })],
    }).estimates[0].basisNote).toBe(' \n未知 \t');
  });

  it('validates zoned calendar timestamps and compares departure by real instant', () => {
    const accepted = [
      '0001-01-01T00:00:00Z', '2024-02-29T09:30:00+08:00',
      '2026-10-07T09:30:00.123+08:00', '2026-10-07T09:30:00-05:30',
    ];
    for (const time of accepted) {
      const parsed = productionPlanSchema.parse({ staffing: [staffing(uuid(70), { plannedArrivalAt: time })] });
      expect(parsed.staffing[0].plannedArrivalAt).toBe(time);
    }
    for (const time of [
      '0000-01-01T00:00:00Z', '1900-02-29T09:30:00Z', '2026-02-30T09:30:00Z',
      '2026-10-07T24:00:00Z', '2026-10-07T09:60:00Z', '2026-10-07T09:30:60Z',
      '2026-10-07T09:30:00', '2026-10-07T09:30:00-00:00',
      '2026-10-07T09:30:00.1234Z', 'not-a-date', '',
    ]) {
      for (const field of ['plannedArrivalAt', 'plannedDepartureAt'] as const) {
        expect(productionPlanSchema.safeParse({ staffing: [staffing(uuid(71), { [field]: time })] }).success).toBe(false);
      }
    }
    expect(productionPlanSchema.safeParse({ staffing: [staffing(uuid(72), {
      plannedArrivalAt: '2026-10-07T09:30:00+08:00',
      plannedDepartureAt: '2026-10-07T01:30:00Z',
    })] }).success).toBe(true);
    expect(productionPlanSchema.safeParse({ staffing: [staffing(uuid(73), {
      plannedArrivalAt: '2026-10-07T09:30:00+08:00',
      plannedDepartureAt: '2026-10-07T10:00:00+09:00',
    })] }).success).toBe(false);
  });

  it('accepts only UUID task references and rejects duplicate aliases, while legacy object IDs stay verbatim', () => {
    const taskId = uuid(80);
    const objectUuid = uuid(81);
    expect(productionPlanSchema.safeParse({ staffing: [staffing(uuid(82), { taskIds: [taskId, taskId] })] }).success).toBe(false);
    expect(productionPlanSchema.safeParse({ staffing: [staffing(uuid(83), { taskIds: [taskId, taskId.toUpperCase()] })] }).success).toBe(false);
    expect(productionPlanSchema.safeParse({ staffing: [staffing(uuid(84), { taskIds: ['legacy-task'] })] }).success).toBe(false);
    expect(productionPlanSchema.safeParse({
      acquisitions: [acquisition(uuid(85), { objectIds: [objectUuid, objectUuid.toUpperCase()] })],
    }).success).toBe(false);
    expect(productionPlanSchema.safeParse({
      estimates: [estimate(uuid(86), { objectIds: [objectUuid, objectUuid.toUpperCase()] })],
    }).success).toBe(false);
    const legacyPlan = productionPlanSchema.parse({
      acquisitions: [acquisition(uuid(87), { objectIds: ['Chair-A', 'chair-a'] })],
    });
    expect(legacyPlan.acquisitions[0].objectIds).toEqual(['Chair-A', 'chair-a']);
    expect(productionPlanSchema.safeParse({
      acquisitions: [acquisition(uuid(88), { objectIds: ['Chair-A', 'Chair-A'] })],
    }).success).toBe(false);
  });

  it('keeps record IDs UUID-only and unique across all arrays, including case aliases', () => {
    const id = uuid(90);
    expect(productionPlanSchema.safeParse({ staffing: [staffing(id)], acquisitions: [acquisition(id)] }).success).toBe(false);
    expect(productionPlanSchema.safeParse({ staffing: [staffing(id), staffing(id.toUpperCase())] }).success).toBe(false);
    expect(productionPlanSchema.safeParse({ staffing: [staffing('not-a-uuid')] }).success).toBe(false);
    const uppercase = productionPlanSchema.parse({ staffing: [staffing(id.toUpperCase())] });
    expect(uppercase.staffing[0].id).toBe(id.toUpperCase());
  });

  it('bounds records, references and text without truncating valid originals', () => {
    const staffingRecords = Array.from({ length: productionPlanLimits.records }, (_, i) => staffing(uuid(1000 + i)));
    const acquisitionRecords = Array.from({ length: productionPlanLimits.records }, (_, i) => acquisition(uuid(2000 + i)));
    const estimateRecords = Array.from({ length: productionPlanLimits.records }, (_, i) => estimate(uuid(3000 + i)));
    expect(productionPlanSchema.parse({ staffing: staffingRecords, acquisitions: acquisitionRecords, estimates: estimateRecords })).toMatchObject({
      staffing: expect.arrayContaining([expect.objectContaining({ id: uuid(1000) })]),
    });
    expect(productionPlanSchema.safeParse({ staffing: [...staffingRecords, staffing(uuid(4000))] }).success).toBe(false);
    expect(productionPlanSchema.safeParse({ acquisitions: [...acquisitionRecords, acquisition(uuid(4000))] }).success).toBe(false);
    expect(productionPlanSchema.safeParse({ estimates: [...estimateRecords, estimate(uuid(4000))] }).success).toBe(false);

    const taskIds = Array.from({ length: productionPlanLimits.references }, (_, i) => uuid(5000 + i));
    const objectIds = Array.from({ length: productionPlanLimits.references }, (_, i) => `legacy-chair-${i}`);
    expect(productionPlanSchema.parse({ staffing: [staffing(uuid(4001), { taskIds })] }).staffing[0].taskIds).toHaveLength(500);
    expect(productionPlanSchema.safeParse({ staffing: [staffing(uuid(4002), { taskIds: [...taskIds, uuid(6000)] })] }).success).toBe(false);
    expect(productionPlanSchema.parse({ acquisitions: [acquisition(uuid(4003), { objectIds })] }).acquisitions[0].objectIds).toHaveLength(500);
    expect(productionPlanSchema.safeParse({ acquisitions: [acquisition(uuid(4004), { objectIds: [...objectIds, 'extra'] })] }).success).toBe(false);

    const title = '字'.repeat(productionPlanLimits.title);
    expect(productionPlanSchema.parse({ staffing: [staffing(uuid(4005), { roleName: title })] }).staffing[0].roleName).toBe(title);
    expect(productionPlanSchema.safeParse({ staffing: [staffing(uuid(4006), { roleName: title + '字' })] }).success).toBe(false);
    expect(productionPlanSchema.parse({ acquisitions: [acquisition(uuid(4007), { title })] }).acquisitions[0].title).toBe(title);
    expect(productionPlanSchema.safeParse({ estimates: [estimate(uuid(4008), { title: title + '字' })] }).success).toBe(false);

    const party = '甲'.repeat(productionPlanLimits.party);
    expect(productionPlanSchema.parse({ staffing: [staffing(uuid(4009), { sourceName: party })] }).staffing[0].sourceName).toBe(party);
    expect(productionPlanSchema.safeParse({ acquisitions: [acquisition(uuid(4010), { supplierName: party + '甲' })] }).success).toBe(false);
    const note = '注'.repeat(productionPlanLimits.note);
    expect(productionPlanSchema.parse({ acquisitions: [acquisition(uuid(4011), { specificationNote: note })] }).acquisitions[0].specificationNote).toBe(note);
    expect(productionPlanSchema.safeParse({ estimates: [estimate(uuid(4012), { basisNote: note + '注', amountMinor: 0 })] }).success).toBe(false);
  });

  it('resolves references in record order, distinguishing missing, ambiguous and unassigned work', () => {
    const knownTask = uuid(110);
    const missingTask = uuid(111);
    const ambiguousTask = uuid(112);
    const knownObject = uuid(113);
    const missingObject = uuid(114);
    const ambiguousObject = uuid(115);
    const plan: ProductionPlan = productionPlanSchema.parse({
      staffing: [
        staffing(uuid(120).toUpperCase(), { taskIds: [knownTask, missingTask], headcount: 2 }),
        staffing(uuid(121)),
      ],
      acquisitions: [
        acquisition(uuid(122), { taskIds: [knownTask], objectIds: [knownObject, missingObject, 'chair-a'] }),
        acquisition(uuid(123), { taskIds: [knownTask], objectIds: [knownObject, 'CHAIR-A'] }),
      ],
      estimates: [
        estimate(uuid(124), { taskIds: [ambiguousTask], objectIds: [ambiguousObject] }),
        estimate(uuid(125)),
      ],
    });
    const taskIds = [knownTask, ambiguousTask, ambiguousTask.toUpperCase()];
    const objectIds = [knownObject, ambiguousObject, ambiguousObject.toUpperCase(), 'CHAIR-A'];
    const before = { taskIds: [...taskIds], objectIds: [...objectIds] };
    expect(resolveProductionPlanReferences(plan, { taskIds, objectIds })).toEqual([
      {
        kind: 'staffing', id: uuid(120).toUpperCase(), missingTaskIds: [missingTask], missingObjectIds: [],
        ambiguousTaskIds: [], ambiguousObjectIds: [], unassigned: false, needsReview: true,
      },
      {
        kind: 'staffing', id: uuid(121), missingTaskIds: [], missingObjectIds: [],
        ambiguousTaskIds: [], ambiguousObjectIds: [], unassigned: true, needsReview: true,
      },
      {
        kind: 'acquisition', id: uuid(122), missingTaskIds: [], missingObjectIds: [missingObject, 'chair-a'],
        ambiguousTaskIds: [], ambiguousObjectIds: [], unassigned: false, needsReview: true,
      },
      {
        kind: 'acquisition', id: uuid(123), missingTaskIds: [], missingObjectIds: [],
        ambiguousTaskIds: [], ambiguousObjectIds: [], unassigned: false, needsReview: false,
      },
      {
        kind: 'estimate', id: uuid(124), missingTaskIds: [], missingObjectIds: [],
        ambiguousTaskIds: [ambiguousTask], ambiguousObjectIds: [ambiguousObject],
        unassigned: false, needsReview: true,
      },
      {
        kind: 'estimate', id: uuid(125), missingTaskIds: [], missingObjectIds: [],
        ambiguousTaskIds: [], ambiguousObjectIds: [], unassigned: false, needsReview: false,
      },
    ]);
    expect(taskIds).toEqual(before.taskIds);
    expect(objectIds).toEqual(before.objectIds);
  });

  it('allows shared references across records and does not mutate parsed plans', () => {
    const taskId = uuid(130);
    const objectId = uuid(131);
    const plan: ProductionPlan = productionPlanSchema.parse({
      staffing: [staffing(uuid(132), { taskIds: [taskId] }), staffing(uuid(133), { taskIds: [taskId] })],
      acquisitions: [acquisition(uuid(134), { objectIds: [objectId] }), acquisition(uuid(135), { objectIds: [objectId] })],
    });
    const before = structuredClone(plan);
    const result = resolveProductionPlanReferences(plan, { taskIds: [taskId], objectIds: [objectId] });
    expect(result.every(item => !item.needsReview)).toBe(true);
    expect(plan).toEqual(before);
    const summaryBefore = structuredClone(plan);
    productionEstimateSummary(plan);
    expect(plan).toEqual(summaryBefore);
  });

  it('summarizes empty, unknown, precise and over-budget estimates without inventing total cost', () => {
    expect(productionEstimateSummary(productionPlanSchema.parse({}))).toEqual({
      knownTotalMinor: 0, recordedTotalMinor: null, unknownEstimateIds: [],
      allRecordedAmountsKnown: false, overLimit: null,
    });

    const exact = productionPlanSchema.parse({
      budget: { limitMinor: 100, scopeNote: '活动范围', basisNote: '已确认预算' },
      estimates: [
        estimate(uuid(140), { amountMinor: 0, basisNote: '明确为零' }),
        estimate(uuid(141), { amountMinor: 40, basisNote: '供应商报价依据' }),
      ],
    });
    expect(productionEstimateSummary(exact)).toEqual({
      knownTotalMinor: 40, recordedTotalMinor: 40, unknownEstimateIds: [],
      allRecordedAmountsKnown: true, overLimit: false,
    });

    const unknownUnderLimit = productionPlanSchema.parse({
      budget: { limitMinor: 100, scopeNote: '范围', basisNote: '依据' },
      estimates: [
        estimate(uuid(142), { amountMinor: 40, basisNote: '已知' }),
        estimate(uuid(143)),
      ],
    });
    expect(productionEstimateSummary(unknownUnderLimit)).toEqual({
      knownTotalMinor: 40, recordedTotalMinor: null, unknownEstimateIds: [uuid(143)],
      allRecordedAmountsKnown: false, overLimit: null,
    });

    const overLimit = productionPlanSchema.parse({
      budget: { limitMinor: 100, scopeNote: '范围', basisNote: '依据' },
      estimates: [
        estimate(uuid(144), { amountMinor: 101, basisNote: '已知超额' }),
        estimate(uuid(145)),
      ],
    });
    expect(productionEstimateSummary(overLimit)).toEqual({
      knownTotalMinor: 101, recordedTotalMinor: null, unknownEstimateIds: [uuid(145)],
      allRecordedAmountsKnown: false, overLimit: true,
    });
    expect(overLimit.estimates[0].amountMinor).toBe(101);
  });

  it('rejects a known estimate sum that would exceed MAX_SAFE_INTEGER', () => {
    const result = productionPlanSchema.safeParse({
      estimates: [
        estimate(uuid(150), { amountMinor: Number.MAX_SAFE_INTEGER, basisNote: '最大安全整数' }),
        estimate(uuid(151), { amountMinor: 1, basisNote: '溢出一元' }),
      ],
    });
    expect(result.success).toBe(false);
  });
});
