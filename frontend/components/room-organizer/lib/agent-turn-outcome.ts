import type { ResolvedBriefTurn } from '@/lib/agent-resolver';
import type { BriefMemory } from './brief-agent';

/**
 * Outcome of the existing model-understanding branch, not the entire send
 * operation. It neither proves an action was executed nor identifies the
 * originating event for a later confirmation.
 */
export type TurnOutcome =
  | { kind: 'control'; control: 'confirmation_without_event_binding' | 'read_only' | 'local_command' }
  | { kind: 'understood'; next: 'reply' | 'ask' | 'generate' }
  | { kind: 'awaiting_confirmation'; reason: 'pending_fact' | 'pending_need' | 'layout' | 'mobility' | 'missing_input' }
  | { kind: 'unresolved'; reason: 'unhandled_requirement' | 'unhandled_question' | 'mixed_utility' | 'unproven' }
  | { kind: 'failed'; reason: 'model_failed' | 'model_unavailable' };

/** No raw user text or model prose is included in this outcome. */
export function resolvedTurnOutcome(turn: ResolvedBriefTurn, _previous: BriefMemory, mixedUtility: boolean, input: string): TurnOutcome {
  if (turn.resolution === 'failed') return {kind:'failed',reason:'model_failed'};
  if (turn.resolution === 'unavailable' || turn.resolution === 'not_connected') return {kind:'failed',reason:'model_unavailable'};
  if (mixedUtility) return {kind:'unresolved',reason:'mixed_utility'};
  if (turn.unhandled?.some(item => item.kind === 'action' || item.kind === 'other')) return {kind:'unresolved',reason:'unhandled_requirement'};
  if (turn.unhandled?.length) return {kind:'unresolved',reason:'unhandled_question'};
  // Current BriefMemory does not persist the originating event ID. A future
  // coordinator must not treat the word “confirm” as proof of which event was settled.
  if (turn.resolution === 'local_command') return {kind:'control',control:'local_command'};
  if (turn.readOnlyReply) return {kind:'control',control:'read_only'};
  if (turn.memory.pendingBasicFacts?.length) return {kind:'awaiting_confirmation',reason:'pending_fact'};
  if (turn.memory.pendingActivityNeeds.length || turn.memory.unresolvedActivityNeeds.length) return {kind:'awaiting_confirmation',reason:'pending_need'};
  if (turn.memory.layoutModeUnresolved) return {kind:'awaiting_confirmation',reason:'layout'};
  if (turn.memory.mobilityNeedsClarification || turn.memory.mobilityRequirement?.decision === 'unknown') return {kind:'awaiting_confirmation',reason:'mobility'};
  if (turn.resolution === 'confirmation') return {kind:'control',control:'confirmation_without_event_binding'};
  if (turn.resolution !== 'model') return {kind:'unresolved',reason:'unproven'};

  // An empty unhandled list is not a coverage certificate. Only clear an old
  // unresolved item when the entire input is a mechanically verifiable fact.
  // Unproven inputs still follow the normal conversation and generation path.
  const count = input.trim().match(/^(\d{1,5})\s*人[。！!]?$/u);
  if (!count || Number(count[1]) !== turn.extraction.headcount) return {kind:'unresolved',reason:'unproven'};
  return {kind:'understood',next:turn.kind === 'generate' ? 'generate' : turn.kind === 'ask' ? 'ask' : 'reply'};
}

/** Preserve prior unresolved entries unless this exact input is proven understood. */
export function incompleteUpdateForOutcome(outcome: TurnOutcome): 'mark' | 'clear_current' | 'preserve' {
  if (outcome.kind === 'failed') return 'mark';
  if (outcome.kind === 'unresolved' && (outcome.reason === 'unhandled_requirement' || outcome.reason === 'mixed_utility')) return 'mark';
  if (outcome.kind === 'understood') return 'clear_current';
  return 'preserve';
}

/** BriefMemory currently has no persisted headcount provenance; do not infer it. */
export function samePersistedHeadcount(actual: BriefMemory | null, expected: BriefMemory): boolean {
  if (!actual || actual.headcount !== expected.headcount || actual.headcountMode !== expected.headcountMode) return false;
  const pending = (memory: BriefMemory) => (memory.pendingBasicFacts ?? [])
    .filter(fact => fact.key === 'headcount')
    .map(fact => ({ key: fact.key, value: fact.value, requiresRestatement: fact.requiresRestatement ?? true }));
  return JSON.stringify(pending(actual)) === JSON.stringify(pending(expected));
}
