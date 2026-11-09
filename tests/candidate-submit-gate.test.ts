import { describe, expect, it } from 'vitest';
import { CANDIDATE_NOT_VALIDATED, DEADLINE_UNVALIDATED, classifySubmittedCandidate } from '../supabase/functions/_shared/candidate-submit-gate.ts';

describe('提交前的校验门', () => {
  it('空命令、组团句柄和已经校验过的场景直接接受', () => {
    expect(classifySubmittedCandidate({ commandCount: 0, prepared: false, previouslyValidated: false, forceSubmit: false })).toEqual({ action: 'accept', flagged: false });
    expect(classifySubmittedCandidate({ commandCount: 4, prepared: true, previouslyValidated: false, forceSubmit: false })).toEqual({ action: 'accept', flagged: false });
    expect(classifySubmittedCandidate({ commandCount: 1, prepared: false, previouslyValidated: true, forceSubmit: false })).toEqual({ action: 'accept', flagged: false });
  });

  it('单份带命令候选没校验过就拒绝，截止提交则标明而不是拦下', () => {
    expect(classifySubmittedCandidate({ commandCount: 1, prepared: false, previouslyValidated: false, forceSubmit: false })).toEqual({ action: 'reject', code: CANDIDATE_NOT_VALIDATED });
    expect(classifySubmittedCandidate({ commandCount: 3, prepared: false, previouslyValidated: false, forceSubmit: true })).toEqual({ action: 'accept', flagged: true, code: DEADLINE_UNVALIDATED });
  });
});
