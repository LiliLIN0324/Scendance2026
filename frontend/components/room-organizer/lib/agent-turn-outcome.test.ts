import { describe, expect, it } from 'vitest';
import type { ResolvedBriefTurn } from '@/lib/agent-resolver';
import { initialBriefMemory, parseBriefTurn } from './brief-agent';
import { incompleteUpdateForOutcome, resolvedTurnOutcome } from './agent-turn-outcome';

const context = { venueUp:false, scaleTyped:false, hasBase:false, command:null } as const;
function turn(): ResolvedBriefTurn {
  return { ...parseBriefTurn('', initialBriefMemory(), context), kind:'ack', resolution:'model' };
}

describe('model turn outcome', () => {
  it('marks validated facts as understood without claiming a proposal or safety pass', () => {
    const result=turn();result.extraction.headcount=30;
    const outcome=resolvedTurnOutcome(result,initialBriefMemory(),false,'30人');
    expect(outcome).toEqual({kind:'understood',next:'reply'});
    expect(incompleteUpdateForOutcome(outcome)).toBe('clear_current');
  });
  it.each(['约30人','预计30人','20到30人','不是30人','30位','30名'])('does not overstate the meaning of %s', input => {
    const result=turn();result.extraction.headcount=30;
    expect(incompleteUpdateForOutcome(resolvedTurnOutcome(result,initialBriefMemory(),false,input))).toBe('preserve');
  });
  it('retains each previously unresolved item while facts or needs remain to be confirmed', () => {
    const result=turn();result.extraction.headcount=30;
    result.memory.pendingBasicFacts=[{key:'headcount',value:30,requiresRestatement:false}];
    const outcome=resolvedTurnOutcome(result,initialBriefMemory(),false,'30人');
    expect(outcome).toEqual({kind:'awaiting_confirmation',reason:'pending_fact'});
    expect(incompleteUpdateForOutcome(outcome)).toBe('preserve');
  });
  it('does not equate a later confirmation word with an identified source event', () => {
    const result=turn();result.resolution='confirmation';result.kind='generate';
    const outcome=resolvedTurnOutcome(result,initialBriefMemory(),false,'30人');
    expect(outcome).toEqual({kind:'control',control:'confirmation_without_event_binding'});
    expect(incompleteUpdateForOutcome(outcome)).toBe('preserve');
  });
  it('marks mixed or unhandled modifications unresolved, without embedding text', () => {
    const result=turn();result.extraction.headcount=30;
    result.unhandled=[{kind:'other',evidence:'PRIVATE_FIXTURE'}];
    const unresolved=resolvedTurnOutcome(result,initialBriefMemory(),false,'30人');
    expect(unresolved).toEqual({kind:'unresolved',reason:'unhandled_requirement'});
    expect(incompleteUpdateForOutcome(unresolved)).toBe('mark');
    expect(JSON.stringify(unresolved)).not.toContain('PRIVATE_FIXTURE');
    expect(resolvedTurnOutcome(result,initialBriefMemory(),true,'30人')).toEqual({kind:'unresolved',reason:'mixed_utility'});
  });
  it('does not mark a reply without evidence or local fallback as understood', () => {
    const result=turn();
    expect(resolvedTurnOutcome(result,initialBriefMemory(),false,'30人')).toEqual({kind:'unresolved',reason:'unproven'});
    result.resolution='disabled';result.extraction.headcount=30;
    expect(resolvedTurnOutcome(result,initialBriefMemory(),false,'30人')).toEqual({kind:'unresolved',reason:'unproven'});
    result.resolution='local_command';
    expect(resolvedTurnOutcome(result,initialBriefMemory(),false,'30人')).toEqual({kind:'control',control:'local_command'});
  });
  it('distinguishes provider failure, a read-only reply and an unanswered question', () => {
    const result=turn();result.resolution='failed';
    expect(resolvedTurnOutcome(result,initialBriefMemory(),false,'30人')).toEqual({kind:'failed',reason:'model_failed'});
    expect(incompleteUpdateForOutcome(resolvedTurnOutcome(result,initialBriefMemory(),false,'30人'))).toBe('mark');
    result.resolution='model';result.readOnlyReply=true;
    expect(resolvedTurnOutcome(result,initialBriefMemory(),false,'30人')).toEqual({kind:'control',control:'read_only'});
    result.unhandled=[{kind:'question',evidence:'PRIVATE_FIXTURE'}];
    const unanswered=resolvedTurnOutcome(result,initialBriefMemory(),false,'30人');
    expect(unanswered).toEqual({kind:'unresolved',reason:'unhandled_question'});
    expect(incompleteUpdateForOutcome(unanswered)).toBe('preserve');
  });
});
