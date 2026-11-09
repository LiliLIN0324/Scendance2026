import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { evaluateRequirementCoverage, type CoverageCase, type ObservedDelivery } from '../evals/brief/coverage-evaluator';

const cases = JSON.parse(readFileSync(new URL('../evals/brief/coverage-cases.json', import.meta.url), 'utf8')) as CoverageCase[];
const synthetic = JSON.parse(readFileSync(new URL('../evals/brief/coverage-synthetic-responses.json', import.meta.url), 'utf8')) as Record<string, unknown>;
const get = (id: string) => {
  const found = cases.find(item => item.id === id);
  if (!found) throw new Error(`missing fictional case ${id}`);
  return found;
};
const response = (extraction: Record<string, unknown>, factEvidence: unknown[] = [], unhandled: unknown[] = []) => ({
  extraction, factEvidence, unhandled, reply: '我会按已知信息继续核对。',
});
const observed = (overrides: Partial<ObservedDelivery> = {}): ObservedDelivery => ({
  candidate: 'applied', userConfirmed: true, requirements: { guests: 'pass' },
  safety: { egress: 'pass', accessibility: 'pass' }, ...overrides,
});

describe('human-labelled fictional requirement coverage', () => {
  it('runs every synthetic fixture and still detects its intentional missing requirement', () => {
    const evaluated=cases.map(item=>evaluateRequirementCoverage(item,synthetic[item.id]));
    expect(evaluated).toHaveLength(6);
    expect(evaluated.every(item=>item.extraction==='checked' && item.unlabeled.length===0)).toBe(true);
    expect(evaluated.find(item=>item.id==='compound_light')?.coverage.find(item=>item.id==='lighting')?.state).toBe('missing');
    expect(evaluated.find(item=>item.id==='checkin_undecided')?.delivery).toBe('not_ready');
  });
  it('exposes omitted warm lighting even when the model claims no unhandled items', () => {
    const result = evaluateRequirementCoverage(get('compound_light'), response({ headcount: 30 }, [{ key: 'headcount', evidence: '30人' }]));
    expect(result.coverage).toEqual([
      { id: 'guests', state: 'recognized', requiredForDelivery: true },
      { id: 'lighting', state: 'missing', requiredForDelivery: true },
    ]);
    expect(result.delivery).toBe('not_ready');
    const flagged = evaluateRequirementCoverage(get('compound_light'), response({ headcount: 30 }, [{ key: 'headcount', evidence: '30人' }], [{ kind: 'other', evidence: '灯光必须保持暖白' }]));
    expect(flagged.coverage[1]?.state).toBe('reported_unhandled');
    expect(flagged.delivery).toBe('not_ready');
  });
  it('separates 30 guests from 80 chairs and never treats an oral mention as verified stock', () => {
    const result = evaluateRequirementCoverage(get('chairs_vs_guests'), response({ headcount: 30, requirements: [{ key: 'headcount', value: 30, mode: 'prefer' }], inventoryMentions: [{ evidence: '现有80把椅子' }] }, [{ key: 'headcount', evidence: '30人' }]));
    expect(result.coverage.map(item => item.state)).toEqual(['recognized', 'recognized']);
    expect(result.delivery).toBe('not_verified');
    const erroneous = response({ headcount: 80, inventoryMentions: [{ evidence: '现有80把椅子' }] }, [{ key: 'headcount', evidence: '80把椅子' }]);
    const wrong = evaluateRequirementCoverage(get('chairs_vs_guests'), erroneous);
    // Score the model's original value, even if the parser drops it later.
    expect(wrong.extraction).toBe('checked');
    expect(wrong.coverage.map(item => item.state)).toEqual(['contradicted', 'recognized']);
    expect(wrong.systemCoverage).toHaveLength(2);
    expect(wrong.delivery).toBe('not_ready');
    // HEAD currently retains the model's wrong number; a candidate parser may
    // conservatively remove it. Neither behavior changes the raw model grade.
    expect(['missing', 'contradicted']).toContain(wrong.systemCoverage[0]?.state);
    expect(wrong.systemCoverage[1]?.state).toBe('recognized');
    expect(wrong.delivery).not.toBe('observed_ready_for_human_review');
    const lostMode = evaluateRequirementCoverage(get('chairs_vs_guests'), response({ headcount: 30 }, [{ key: 'headcount', evidence: '30人' }]));
    expect(lostMode.coverage[0]?.state).toBe('missing');
  });
  it('independently detects a contradictory field even when the quoted words exist', () => {
    const test: CoverageCase = { id: 'venue', message: '活动在室内。', task: 'planning', criticalSafety: ['egress'],
      labels: [{ id: 'venue', source: '室内', kind: 'fact', field: 'venueIO', value: 'indoor', requiredForDelivery: true }] };
    const result = evaluateRequirementCoverage(test, response({ venueIO: 'outdoor' }, [{ key: 'venueIO', evidence: '室内' }]));
    expect(result.coverage[0]?.state).toBe('contradicted');
    expect(result.delivery).toBe('not_ready');
  });
  it('keeps other grounded facts while independently exposing a lost count and omitted lighting', () => {
    const test: CoverageCase = { id: 'mixed', message: '预计30人，室内，现有80把椅子，灯光必须保持暖白。', task: 'planning', criticalSafety: ['egress'], labels: [
      { id: 'guests', source: '30人', kind: 'fact', field: 'headcount', value: 30, mode: 'prefer', requiredForDelivery: true },
      { id: 'venue', source: '室内', kind: 'fact', field: 'venueIO', value: 'indoor', requiredForDelivery: true },
      { id: 'chairs', source: '80把椅子', kind: 'inventory', requiredForDelivery: false },
      { id: 'lighting', source: '灯光必须保持暖白', kind: 'unmodeled', requiredForDelivery: true },
    ] };
    const model = response({ headcount: 80, venueIO: 'indoor', inventoryMentions: [{ evidence: '现有80把椅子' }] },
      [{ key: 'headcount', evidence: '80把椅子' }, { key: 'venueIO', evidence: '室内' }]);
    const result = evaluateRequirementCoverage(test, model);
    expect(result.extraction).toBe('checked');
    expect(result.coverage.map(item => [item.id, item.state])).toEqual([
      ['guests', 'contradicted'], ['venue', 'recognized'], ['chairs', 'recognized'], ['lighting', 'missing'],
    ]);
    expect(result.delivery).toBe('not_ready');
    expect(result.systemCoverage.find(item => item.id === 'venue')?.state).toBe('recognized');
    expect(result.systemCoverage.find(item => item.id === 'chairs')?.state).toBe('recognized');
  });
  it('keeps undecided, explicitly negative and ordinary questions distinct', () => {
    const pending = evaluateRequirementCoverage(get('checkin_undecided'), response({ activityNeeds: [{ kind: 'checkin', decision: 'unknown', evidence: '签到还没决定' }] }));
    expect(pending.coverage[0]?.state).toBe('recognized');
    expect(pending.delivery).toBe('not_ready');
    const negative = evaluateRequirementCoverage(get('explicit_no_checkin'), response({ activityNeeds: [{ kind: 'checkin', decision: 'not_needed', evidence: '不需要签到' }] }));
    expect(negative.coverage[0]?.state).toBe('recognized');
    const question = evaluateRequirementCoverage(get('ordinary_question'), response({}, [], [{ kind: 'question', evidence: '活动签到一般怎么安排？' }]));
    expect(question.coverage).toEqual([]);
    expect(question.delivery).toBe('not_applicable');
  });
  it('does not let parser-side number filtering hide a wrong raw model value', () => {
    const test = get('single_count');
    const wrong = response({ headcount: 2 }, [{ key: 'headcount', evidence: '30人' }]);
    const result = evaluateRequirementCoverage(test, wrong, observed());
    expect(result.coverage[0]?.state).toBe('contradicted');
    expect(result.delivery).not.toBe('observed_ready_for_human_review');
  });
  it('keeps a correctly labelled raw count visible even if the system parser filters it', () => {
    const test: CoverageCase = {id:'sum',message:'30人加40人，共70人。',task:'planning',criticalSafety:['egress'],labels:[{id:'guests',source:'70人',kind:'fact',field:'headcount',value:70,requiredForDelivery:true}]};
    const result=evaluateRequirementCoverage(test,response({headcount:70},[{key:'headcount',evidence:'70人'}]));
    expect(result.coverage[0]?.state).toBe('recognized');
    expect(['recognized', 'missing']).toContain(result.systemCoverage[0]?.state);
    expect(result.delivery).not.toBe('observed_ready_for_human_review');
  });
  it('flags unlabelled model facts for review rather than treating a question as a clean success', () => {
    const question = get('ordinary_question');
    const invented = response({ headcount: 30 }, [{ key: 'headcount', evidence: '活动' }]);
    const result = evaluateRequirementCoverage(question, invented);
    expect(result.unlabeled).toContain('headcount');
    expect(result.delivery).toBe('not_applicable');
    const extraNeed = response({ headcount: 30, activityNeeds: [{kind:'stage',decision:'needed',evidence:'活动'}] }, [{key:'headcount',evidence:'30人'}]);
    const planning = evaluateRequirementCoverage(get('single_count'), extraNeed, observed());
    expect(planning.unlabeled).toContain('need.stage');
    expect(planning.delivery).toBe('not_ready');
  });
  it('does not promote an explicit unknown need into a ready delivery even if other evidence passes', () => {
    const result = evaluateRequirementCoverage(get('checkin_undecided'), response({activityNeeds:[{kind:'checkin',decision:'unknown',evidence:'签到还没决定'}]}), observed({requirements:{}}));
    expect(result.coverage[0]?.state).toBe('recognized');
    expect(result.delivery).toBe('not_ready');
  });
  it('requires separately observed application, confirmation, each labelled requirement and named safety checks', () => {
    const test = get('single_count');
    const model = response({ headcount: 30 }, [{ key: 'headcount', evidence: '30人' }]);
    expect(evaluateRequirementCoverage(test, model).delivery).toBe('not_verified');
    expect(evaluateRequirementCoverage(test, model, observed({ candidate: 'preview' })).delivery).toBe('not_verified');
    expect(evaluateRequirementCoverage(test, model, observed({ userConfirmed: false })).delivery).toBe('not_verified');
    expect(evaluateRequirementCoverage(test, model, observed({ requirements: { guests: 'unknown' } })).delivery).toBe('not_verified');
    expect(evaluateRequirementCoverage(test, model, observed({ requirements: { guests: 'pass', other: 'violated' } })).delivery).toBe('not_verified');
    expect(evaluateRequirementCoverage(test, model, observed({ safety: { egress: 'pass', accessibility: 'unknown' } })).delivery).toBe('not_verified');
    expect(evaluateRequirementCoverage(test, model, observed({ safety: { egress: 'violated', accessibility: 'pass' } })).delivery).toBe('not_verified');
    expect(evaluateRequirementCoverage(test, model, observed({ safety: { egress: 'pass', accessibility: 'pass', fire: 'unknown' } })).delivery).toBe('not_verified');
    expect(evaluateRequirementCoverage(test, model, observed({ safety: { unrelated: 'pass' } })).delivery).toBe('not_verified');
    expect(evaluateRequirementCoverage(test, model, observed({ safety: { egress: 'pass', accessibility: 'not_applicable' } })).delivery).toBe('not_verified');
    expect(evaluateRequirementCoverage({ ...test, allowNotApplicable: ['accessibility'] }, model, observed({ safety: { egress: 'pass', accessibility: 'not_applicable' } })).delivery).toBe('observed_ready_for_human_review');
    expect(evaluateRequirementCoverage(test, model, observed()).delivery).toBe('observed_ready_for_human_review');
  });
  it('rejects malformed model responses, fabricated evidence and invalid gold labels', () => {
    expect(evaluateRequirementCoverage(get('single_count'), undefined).extraction).toBe('invalid');
    expect(evaluateRequirementCoverage(get('single_count'), response({ headcount: 30 }, [{ key: 'headcount', evidence: '三十人' }])).extraction).toBe('invalid');
    const inventedWrapper = evaluateRequirementCoverage(get('single_count'), response({ headcount: 30 }, [{ key: 'headcount', evidence: '假的30人' }]));
    expect(inventedWrapper.extraction).toBe('invalid');expect(inventedWrapper.coverage[0]?.state).toBe('missing');
    expect(() => evaluateRequirementCoverage({ ...get('single_count'), labels: [{ id: 'x', source: '不存在', kind: 'unmodeled', requiredForDelivery: true }] }, response({}))).toThrow('invalid evaluation labels');
    expect(() => evaluateRequirementCoverage({ ...get('single_count'), task: 'question' }, response({}))).toThrow('mixed questions and requirements');
  });
});
