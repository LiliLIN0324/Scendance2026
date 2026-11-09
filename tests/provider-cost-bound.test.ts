import { describe, expect, it } from 'vitest';
import { validateProviderCostBound, type EnforcedRequestBounds, type ProviderCostPolicy } from '../supabase/functions/_shared/provider-cost-bound.ts';

const now = Date.parse('2026-01-02T00:00:00.000Z');
const policy: ProviderCostPolicy = {
  provider: 'fixture', model: 'fixture-model', currency: 'CNY', accountType: 'pay_as_you_go', approved: true,
  verifiedAt: '2026-01-01T00:00:00.000Z', validUntil: '2026-01-03T00:00:00.000Z',
  inputPriceMicrosPerMillion: '1000000', outputPriceMicrosPerMillion: '4000000',
  inputTokenLimit: 1000, inputBoundEvidence: { kind: 'provider_hard_limit', url: 'https://provider.example/bounds', coversEntireRequest: true },
  outputTokenLimit: 100, maxCalls: 3, perCallBudgetMicros: '1400', totalBudgetMicros: '4200',
};
const request: EnforcedRequestBounds = { inputBoundProven: true, inputTokensUpperBound: 1000, outputTokenLimit: 100, maxCalls: 3 };

describe('provider cost bound (not an atomic reservation)', () => {
  it('returns a conservative per-call and total integer bound at the exact budget', () => {
    expect(validateProviderCostBound(policy, now, request)).toEqual({ ok: true, maxPerCallMicros: '1400', maxTotalMicros: '4200', currency: 'CNY' });
    expect(validateProviderCostBound({ ...policy, totalBudgetMicros: '4199' }, now, request)).toEqual({ ok: false, reason: 'BUDGET_EXCEEDED' });
    expect(validateProviderCostBound({ ...policy, perCallBudgetMicros: '1399' }, now, request)).toEqual({ ok: false, reason: 'BUDGET_EXCEEDED' });
  });
  it('rounds each call up using integer arithmetic, including values beyond safe integer precision', () => {
    const fractional = { ...policy, inputPriceMicrosPerMillion: '1', outputPriceMicrosPerMillion: '1' };
    expect(validateProviderCostBound(fractional, now, { ...request, inputTokensUpperBound: 1, outputTokenLimit: 1 })).toMatchObject({ ok: true, maxPerCallMicros: '1', maxTotalMicros: '3' });
    const big = { ...policy, inputPriceMicrosPerMillion: '9007199254740993', outputPriceMicrosPerMillion: '1', perCallBudgetMicros: '9007199254741', totalBudgetMicros: '27021597764223' };
    expect(validateProviderCostBound(big, now, request)).toEqual({ ok: true, maxPerCallMicros: '9007199254741', maxTotalMicros: '27021597764223', currency: 'CNY' });
  });
  it('rejects missing or unproven complete-request bounds and limits beyond the approved policy', () => {
    expect(validateProviderCostBound(policy, now)).toMatchObject({ ok: false });
    expect(validateProviderCostBound(policy, now, { ...request, inputBoundProven: undefined })).toMatchObject({ ok: false });
    expect(validateProviderCostBound(policy, now, { ...request, inputTokensUpperBound: 1001 })).toMatchObject({ ok: false });
    expect(validateProviderCostBound(policy, now, { ...request, outputTokenLimit: 101 })).toMatchObject({ ok: false });
    expect(validateProviderCostBound(policy, now, { ...request, maxCalls: 4 })).toMatchObject({ ok: false });
    expect(validateProviderCostBound({ ...policy, inputBoundEvidence: { ...policy.inputBoundEvidence, coversEntireRequest: false } as never }, now, request)).toMatchObject({ ok: false });
  });
  it.each([NaN, Infinity, -1, 0, 1.1, Number.MAX_SAFE_INTEGER + 1])('rejects invalid token counts: %s', value => {
    expect(validateProviderCostBound(policy, now, { ...request, inputTokensUpperBound: value })).toMatchObject({ ok: false });
  });
  it.each(['', '0', '-1', '1.2', 'NaN', 'Infinity', '1e9', '01'])('rejects invalid rates: %s', value => {
    expect(validateProviderCostBound({ ...policy, inputPriceMicrosPerMillion: value }, now, request)).toMatchObject({ ok: false });
  });
  it('requires approval, pay-as-you-go type, HTTPS evidence and a current verified policy', () => {
    expect(validateProviderCostBound({ ...policy, approved: false } as never, now, request)).toMatchObject({ ok: false });
    expect(validateProviderCostBound({ ...policy, accountType: 'subscription' } as never, now, request)).toMatchObject({ ok: false });
    expect(validateProviderCostBound({ ...policy, inputBoundEvidence: { ...policy.inputBoundEvidence, url: 'http://provider.example' } }, now, request)).toMatchObject({ ok: false });
    expect(validateProviderCostBound(policy, Date.parse(policy.validUntil), request)).toEqual({ ok: false, reason: 'POLICY_EXPIRED' });
    expect(validateProviderCostBound({ ...policy, verifiedAt: '2026-02-30T00:00:00.000Z' }, now, request)).toMatchObject({ ok: false });
    expect(validateProviderCostBound(policy, Infinity, request)).toMatchObject({ ok: false });
  });
});
