import {describe, expect, it} from 'vitest';
import {
  PRODUCT_ENTRIES,
  createRequirementRecoveryLoop,
  createSharedJournal,
  draftStagedJournal,
  hydrateRecoveryJournal,
  serializeRecoveryJournal,
  type ProductEntry,
  type RecoveryIdentity,
} from './requirement-recovery-loop';

const identity: RecoveryIdentity = {projectId:'project-1', activityId:'activity-1', actorId:'actor-1', store:'backend'};

function loop(journal = createSharedJournal(identity)) {
  return createRequirementRecoveryLoop({identity, journal});
}

function receive(target: ReturnType<typeof loop>, sessionId: string, text: string) {
  const staged = target.stageInput(sessionId, text);
  expect(staged.ok).toBe(true);
  if (!staged.ok) throw new Error('stage failed');
  expect(staged.received).toBe(false);
  const claimed = target.claimReceived(staged.eventId);
  expect(claimed).toMatchObject({ok:true, received:true, eventId:staged.eventId});
  return staged;
}

describe('requirement recovery loop', () => {
  it('records an utterance before it can be called received, and keeps the four ids distinct', () => {
    const target = loop();
    const staged = target.stageInput('session-1', '30人');
    expect(staged).toMatchObject({ok:true, received:false, sessionId:'session-1', text:'30人', requirementRevision:1});
    if (!staged.ok) return;
    expect(staged.eventId).not.toContain(identity.projectId);
    expect(new Set([identity.projectId, identity.activityId, identity.actorId, staged.sessionId, staged.eventId]).size).toBe(5);
    expect(target.claimReceived('missing')).toMatchObject({ok:false, received:false});
    expect(target.read().turns[0]?.disposition).toBe('recorded');
    expect(target.claimReceived(staged.eventId).received).toBe(true);
    expect(target.read().turns[0]?.disposition).toBe('pending');
  });

  it('does not let a later acceptance clear an earlier unresolved turn, even when the text matches', () => {
    const target = loop();
    const first = receive(target, 'session-1', '30人');
    expect(target.abandon(first.eventId).ok).toBe(true);
    const second = receive(target, 'session-2', '30人');
    expect(first.eventId).not.toBe(second.eventId);
    expect(target.canCapture(first.eventId)).toBe(false);
    expect(target.canCapture(second.eventId)).toBe(true);
    expect(target.completeTurn(second.eventId, 'accepted').ok).toBe(true);
    const bound = target.bindCommand('proposal');
    expect(bound.ok).toBe(true);
    if (!bound.ok) return;
    expect(target.submitPrepared(bound.requestId).ok).toBe(true);
    expect(target.observeOriginal(bound.requestId, 'complete').ok).toBe(true);
    const confirmed = target.confirm(bound.candidateId, bound.requirementRevision);
    expect(confirmed).toMatchObject({ok:true, unresolvedEventIds:[first.eventId]});
    expect(target.unresolved('session-1').map(turn => turn.eventId)).toEqual([first.eventId]);
    expect(target.unresolved('session-2')).toEqual([]);
    const withdrawn = target.withdraw(first.eventId);
    expect(withdrawn.ok).toBe(true);
    expect(withdrawn.unresolvedEventIds).toEqual([]);
    const kept = receive(target, 'session-1', '灯光暂白');
    const other = receive(target, 'session-1', '加一扇门');
    expect(target.abandon(kept.eventId).ok).toBe(true);
    expect(target.abandon(other.eventId).ok).toBe(true);
    expect(target.withdraw(kept.eventId).unresolvedEventIds).toEqual([other.eventId]);
  });

  it('blocks capture while a second turn is queued, including on another device sharing the journal', () => {
    const journal = createSharedJournal(identity);
    const left = createRequirementRecoveryLoop({identity, journal});
    const right = createRequirementRecoveryLoop({identity, journal});
    const first = receive(left, 'session-1', '30人');
    expect(right.canCapture(first.eventId)).toBe(true);
    const second = left.stageInput('session-1', '室内');
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(left.canCapture(first.eventId)).toBe(false);
    expect(right.canCapture(second.eventId)).toBe(false);
    expect(left.bindCandidate('proposal', first.eventId).ok).toBe(false);
    expect(left.claimReceived(second.eventId).received).toBe(true);
    expect(left.completeTurn(first.eventId, 'accepted').ok).toBe(true);
    expect(right.canCapture(second.eventId)).toBe(true);
  });

  it.each(PRODUCT_ENTRIES)('binds, completes and confirms one %s candidate at its exact revision', (entry: ProductEntry) => {
    const target = loop();
    const staged = receive(target, 'session-1', `${entry}：30人`);
    const bound = target.bindCandidate(entry, staged.eventId);
    expect(bound.ok).toBe(true);
    if (!bound.ok) return;
    expect(bound.requirementRevision).toBe(staged.requirementRevision);
    const premature = target.confirm(bound.candidateId, bound.requirementRevision);
    expect(premature.ok).toBe(false);
    if (!premature.ok) expect(premature.reason).toBe('run_not_ready');
    expect(target.submitPrepared(bound.requestId)).toMatchObject({ok:true, paidSubmissionCount:1, phase:'submitted'});
    expect(target.submitPrepared(bound.requestId)).toMatchObject({ok:false, reason:'already_submitted', paidSubmissionCount:1});
    expect(target.observeOriginal(bound.requestId, 'complete')).toMatchObject({ok:true, phase:'complete', paidSubmissionCount:1});
    expect(target.completeTurn(staged.eventId, 'accepted').ok).toBe(true);
    const confirmed = target.confirm(bound.candidateId, bound.requirementRevision);
    expect(confirmed).toMatchObject({ok:true, candidateId:bound.candidateId, requirementRevision:bound.requirementRevision, unresolvedEventIds:[]});
    expect(target.confirm(bound.candidateId, bound.requirementRevision)).toMatchObject({ok:false, reason:'candidate_not_open'});
    expect(target.confirm('other-candidate', bound.requirementRevision)).toMatchObject({ok:false, reason:'unknown_candidate'});
  });

  it('invalidates the open candidate when a newer input lands, without deleting its request', () => {
    const target = loop();
    const staged = receive(target, 'session-1', '30人');
    const bound = target.bindCandidate('proposal', staged.eventId);
    expect(bound.ok).toBe(true);
    if (!bound.ok) return;
    const command = target.bindCommand('rebuild');
    expect(command.ok).toBe(false);
    expect(target.completeTurn(staged.eventId, 'accepted').ok).toBe(true);
    const replacement = target.bindCommand('material');
    expect(replacement.ok).toBe(true);
    if (!replacement.ok) return;
    expect(replacement.requirementRevision).toBe(staged.requirementRevision);
    expect(target.read().revision).toBe(staged.requirementRevision);
    expect(target.confirm(bound.candidateId, bound.requirementRevision)).toMatchObject({ok:false, reason:'candidate_not_open'});
    const added = target.stageInput('session-1', '改成40人');
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    expect(added.received).toBe(false);
    expect(added.requirementRevision).toBe(staged.requirementRevision + 1);
    expect(target.lookup(replacement.requestId)?.phase).toBe('prepared');
    expect(target.confirm(replacement.candidateId, replacement.requirementRevision)).toMatchObject({ok:false, reason:'candidate_not_open'});
    expect(target.confirm('missing-candidate', added.requirementRevision)).toMatchObject({ok:false, reason:'unknown_candidate'});
  });

  it('does not resend a timed-out request and can read it back after refresh', () => {
    const journal = createSharedJournal(identity);
    const target = createRequirementRecoveryLoop({identity, journal});
    const staged = receive(target, 'session-1', '30人');
    const bound = target.bindCandidate('review', staged.eventId);
    expect(bound.ok).toBe(true);
    if (!bound.ok) return;
    expect(target.submitPrepared(bound.requestId)).toMatchObject({ok:true, paidSubmissionCount:1});
    expect(target.noteOutcomeUnknown(bound.requestId)).toMatchObject({ok:true, phase:'outcome_unknown', paidSubmissionCount:1});
    expect(target.resubmit(bound.requestId)).toEqual({ok:false, reason:'paid_request_not_replayed', requestId:bound.requestId, paidSubmissionCount:1});
    const restored = createRequirementRecoveryLoop({identity, journal:hydrateRecoveryJournal(serializeRecoveryJournal(journal))});
    expect(restored.lookup(bound.requestId)).toMatchObject({requestId:bound.requestId, phase:'outcome_unknown', paidSubmissionCount:1, requirementRevision:staged.requirementRevision});
    expect(restored.readback(bound.requestId)?.requestId).toBe(bound.requestId);
    expect(restored.resubmit(bound.requestId).ok).toBe(false);
    expect(restored.observeOriginal(bound.requestId, 'still_unknown')).toMatchObject({phase:'outcome_unknown', paidSubmissionCount:1});
    expect(restored.confirm(bound.candidateId, staged.requirementRevision)).toMatchObject({ok:false, reason:'run_not_ready'});
    expect(restored.observeOriginal(bound.requestId, 'complete')).toMatchObject({phase:'complete', paidSubmissionCount:1});
    expect(restored.confirm(bound.candidateId, staged.requirementRevision).ok).toBe(true);
  });

  it('keeps a submitted request readable when the local marker write fails', () => {
    const journal = createSharedJournal(identity);
    const target = createRequirementRecoveryLoop({identity, journal});
    const staged = receive(target, 'session-1', '30人');
    const bound = target.bindCandidate('restore', staged.eventId);
    expect(bound.ok).toBe(true);
    if (!bound.ok) return;
    expect(target.submitPrepared(bound.requestId, {localWrite:'fail'})).toMatchObject({ok:true, phase:'local_write_failed', paidSubmissionCount:1});
    expect(target.readback(bound.requestId)).toMatchObject({requestId:bound.requestId, phase:'local_write_failed', paidSubmissionCount:1});
    expect(target.resubmit(bound.requestId).reason).toBe('paid_request_not_replayed');
    const restored = createRequirementRecoveryLoop({identity, journal:hydrateRecoveryJournal(serializeRecoveryJournal(journal))});
    expect(restored.readback(bound.requestId)?.paidSubmissionCount).toBe(1);
    expect(restored.lookup(bound.requestId)?.phase).toBe('local_write_failed');
  });

  it('lets only one of two concurrent records commit, then retries the loser without reviving the old candidate', () => {
    const journal = createSharedJournal(identity);
    const base = journal.read();
    const left = draftStagedJournal(base, {sessionId:'session-1', text:'30人', eventId:'event-left'});
    const right = draftStagedJournal(base, {sessionId:'session-1', text:'40人', eventId:'event-right'});
    expect(journal.commit(base.serial, left)).toBe(true);
    expect(journal.commit(base.serial, right)).toBe(false);
    expect(journal.read().turns.map(turn => turn.text)).toEqual(['30人']);
    const target = createRequirementRecoveryLoop({identity, journal});
    expect(target.claimReceived('event-left').received).toBe(true);
    const bound = target.bindCandidate('proposal', 'event-left');
    expect(bound.ok).toBe(true);
    if (!bound.ok) return;
    const retry = target.stageInput('session-1', '40人');
    expect(retry).toMatchObject({ok:true, received:false, text:'40人'});
    expect(target.confirm(bound.candidateId, bound.requirementRevision)).toMatchObject({ok:false, reason:'candidate_not_open'});
    expect(target.lookup(bound.requestId)?.requestId).toBe(bound.requestId);
    expect(target.read().turns.map(turn => turn.eventId)).toEqual(['event-left', retry.ok ? retry.eventId : '']);
  });

  it('refuses another account on the same journal and an empty utterance', () => {
    const journal = createSharedJournal(identity);
    expect(() => createRequirementRecoveryLoop({identity:{...identity, actorId:'actor-2'}, journal})).toThrow('OWNER_MISMATCH');
    const target = createRequirementRecoveryLoop({identity, journal});
    expect(target.stageInput('session-1', '   ')).toMatchObject({ok:false, received:false, reason:'empty', text:'   '});
    expect(target.read().revision).toBe(0);
    expect(target.coverage()).toEqual({entries:PRODUCT_ENTRIES, runtimeWired:false, singleAgent:true});
  });

  it('keeps a queued turn unresolved across refresh until that exact event is withdrawn', () => {
    const journal = createSharedJournal(identity);
    const target = createRequirementRecoveryLoop({identity, journal});
    const staged = target.stageInput('session-1', '先别改座位');
    expect(staged.ok).toBe(true);
    if (!staged.ok) return;
    expect(target.abandon(staged.eventId).ok).toBe(true);
    const restored = createRequirementRecoveryLoop({identity, journal:hydrateRecoveryJournal(serializeRecoveryJournal(journal))});
    expect(restored.unresolved().map(turn => turn.eventId)).toEqual([staged.eventId]);
    expect(restored.claimReceived(staged.eventId).received).toBe(false);
    expect(restored.canCapture(staged.eventId)).toBe(false);
  });
});
