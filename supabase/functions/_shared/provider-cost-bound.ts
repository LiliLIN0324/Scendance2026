/**
 * Validates administrator-supplied upper bounds; it does not reserve funds,
 * authenticate a price sheet, count tokens, or enforce any shared budget.
 * Amounts are integer millionths of the stated currency per million tokens.
 */
export interface ProviderCostPolicy {
  provider: string;
  model: string;
  currency: 'CNY' | 'USD';
  accountType: 'pay_as_you_go';
  approved: true;
  verifiedAt: string;
  validUntil: string;
  inputPriceMicrosPerMillion: string;
  outputPriceMicrosPerMillion: string;
  inputTokenLimit: number;
  inputBoundEvidence: { kind: 'provider_hard_limit'; url: string; coversEntireRequest: true };
  outputTokenLimit: number;
  maxCalls: number;
  perCallBudgetMicros: string;
  totalBudgetMicros: string;
}

type BoundResult = { ok: true; maxPerCallMicros: string; maxTotalMicros: string; currency: 'CNY' | 'USD' }
  | { ok: false; reason: 'POLICY_INVALID' | 'POLICY_EXPIRED' | 'BUDGET_EXCEEDED' };
export interface EnforcedRequestBounds {
  /** Caller must actually enforce a proven bound for the complete serialized request. */
  inputBoundProven: true;
  inputTokensUpperBound: number;
  outputTokenLimit: number;
  maxCalls: number;
}

function amount(value: unknown): bigint | null {
  if (typeof value !== 'string' || !/^[1-9]\d{0,23}$/.test(value)) return null;
  return BigInt(value);
}
function integer(value: unknown, max: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= max;
}
function timestamp(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) && new Date(ms).toISOString() === value ? ms : null;
}

/** Fail closed unless every asserted boundary is present, current and within both budgets. */
export function validateProviderCostBound(policy: Partial<ProviderCostPolicy>, nowMs: number, request?: Partial<EnforcedRequestBounds>): BoundResult {
  const invalid: BoundResult = { ok: false, reason: 'POLICY_INVALID' };
  if (!policy || typeof policy !== 'object' || !Number.isFinite(nowMs) || policy.approved !== true || policy.accountType !== 'pay_as_you_go' ||
      (policy.currency !== 'CNY' && policy.currency !== 'USD') || typeof policy.provider !== 'string' || !policy.provider.trim() ||
      typeof policy.model !== 'string' || !policy.model.trim()) return invalid;
  const verified = timestamp(policy.verifiedAt), expires = timestamp(policy.validUntil);
  if (verified === null || expires === null || verified > nowMs || expires <= verified) return invalid;
  if (nowMs >= expires) return { ok: false, reason: 'POLICY_EXPIRED' };
  const evidence = policy.inputBoundEvidence;
  if (!evidence || evidence.kind !== 'provider_hard_limit' || evidence.coversEntireRequest !== true || typeof evidence.url !== 'string') return invalid;
  try { const url = new URL(evidence.url); if (url.protocol !== 'https:' || url.username || url.password) return invalid; }
  catch { return invalid; }
  if (!integer(policy.inputTokenLimit, 1_000_000_000) || !integer(policy.outputTokenLimit, 1_000_000_000) || !integer(policy.maxCalls, 1_000)) return invalid;
  if (!request || request.inputBoundProven !== true || !integer(request.inputTokensUpperBound, policy.inputTokenLimit) ||
      !integer(request.outputTokenLimit, policy.outputTokenLimit) || !integer(request.maxCalls, policy.maxCalls)) return invalid;
  const inputPrice = amount(policy.inputPriceMicrosPerMillion), outputPrice = amount(policy.outputPriceMicrosPerMillion);
  const callBudget = amount(policy.perCallBudgetMicros), totalBudget = amount(policy.totalBudgetMicros);
  if (inputPrice === null || outputPrice === null || callBudget === null || totalBudget === null) return invalid;
  const numerator = BigInt(request.inputTokensUpperBound) * inputPrice + BigInt(request.outputTokenLimit) * outputPrice;
  const maxPerCall = (numerator + 999_999n) / 1_000_000n;
  const maxTotal = maxPerCall * BigInt(request.maxCalls);
  if (maxPerCall > callBudget || maxTotal > totalBudget) return { ok: false, reason: 'BUDGET_EXCEEDED' };
  return { ok: true, maxPerCallMicros: maxPerCall.toString(), maxTotalMicros: maxTotal.toString(), currency: policy.currency };
}
