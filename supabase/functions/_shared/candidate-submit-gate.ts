/**
 * 带命令的候选在接受前要能对上一次 validate_candidate。
 * 截止时间迫使提交时不拦下，只标明这不是校验通过。
 * 空命令说明、组团句柄，以及已经校验过的场景，按原样接受。
 */

export const CANDIDATE_NOT_VALIDATED = 'CANDIDATE_NOT_VALIDATED';
export const DEADLINE_UNVALIDATED = 'DEADLINE_UNVALIDATED';

export type SubmitValidationDecision =
  | { action: 'accept'; flagged: false }
  | { action: 'accept'; flagged: true; code: typeof DEADLINE_UNVALIDATED }
  | { action: 'reject'; code: typeof CANDIDATE_NOT_VALIDATED };

export function classifySubmittedCandidate(input: {
  commandCount: number;
  prepared: boolean;
  previouslyValidated: boolean;
  forceSubmit: boolean;
}): SubmitValidationDecision {
  if (input.prepared || input.commandCount === 0 || input.previouslyValidated) return { action: 'accept', flagged: false };
  if (input.forceSubmit) return { action: 'accept', flagged: true, code: DEADLINE_UNVALIDATED };
  return { action: 'reject', code: CANDIDATE_NOT_VALIDATED };
}
