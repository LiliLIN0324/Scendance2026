import { describe, expect, it } from 'vitest';
import type { ResolvedBriefTurn } from '@/lib/agent-resolver';
import { initialBriefMemory, parseBriefTurn } from './brief-agent';
import { incompleteUpdateForOutcome, resolvedTurnOutcome, sofaOnlyUnhandled } from './agent-turn-outcome';

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
  it.each(['约30人','预计30人','20到30人','不是30人','30位','30名'])('does not leave a handled freeform count %s as an incomplete chip', input => {
    const result=turn();result.extraction.headcount=30;
    const outcome=resolvedTurnOutcome(result,initialBriefMemory(),false,input);
    expect(outcome).toEqual({kind:'understood',next:'reply'});
    expect(incompleteUpdateForOutcome(outcome)).toBe('clear_current');
  });
  it('clears an ask the local rules already answered when the model fails', () => {
    const asked=turn();
    asked.resolution='failed';
    asked.kind='ask';
    asked.text='还差人数和场地尺寸。说一下，我再出预览。';
    const outcome=resolvedTurnOutcome(asked,initialBriefMemory(),false,'想把会场摆成围坐');
    expect(outcome).toEqual({kind:'understood',next:'ask'});
    expect(incompleteUpdateForOutcome(outcome)).toBe('clear_current');
    const recorded=turn();
    recorded.resolution='unavailable';
    recorded.kind='ack';
    recorded.text='已按本地规则记录可识别的信息；本次没有发起生成，请核对后重新提出。';
    expect(incompleteUpdateForOutcome(resolvedTurnOutcome(recorded,initialBriefMemory(),false,'80人'))).toBe('clear_current');
    const missed=turn();
    missed.resolution='failed';
    missed.kind='ack';
    missed.text='这句我没接住。已记下：80 人。';
    expect(incompleteUpdateForOutcome(resolvedTurnOutcome(missed,initialBriefMemory(),false,'圆桌'))).toBe('mark');
  });
  it('clears a freeform ask and waits to clear a preview until the candidate exists', () => {
    const asked=turn();asked.kind='ask';
    expect(incompleteUpdateForOutcome(resolvedTurnOutcome(asked,initialBriefMemory(),false,'想围坐着聊天'))).toBe('clear_current');
    const preview=turn();preview.kind='generate';preview.extraction.headcount=30;
    const outcome=resolvedTurnOutcome(preview,initialBriefMemory(),false,'围坐聊一聊，出一版');
    expect(outcome).toEqual({kind:'understood',next:'generate'});
    expect(incompleteUpdateForOutcome(outcome)).toBe('preserve');
  });
  it('asks about a sofa instead of filing another pending chip', () => {
    const result=turn();result.kind='ask';
    result.unhandled=[{kind:'other',evidence:'沙发布置'}];
    expect(sofaOnlyUnhandled(result,'沙发布置')).toBe(true);
    const outcome=resolvedTurnOutcome(result,initialBriefMemory(),false,'沙发布置');
    expect(outcome).toEqual({kind:'understood',next:'ask'});
    expect(incompleteUpdateForOutcome(outcome)).toBe('clear_current');
    result.unhandled=[{kind:'other',evidence:'沙发布置'},{kind:'action',evidence:'删除舞台'}];
    expect(resolvedTurnOutcome(result,initialBriefMemory(),false,'沙发布置，删除舞台')).toEqual({kind:'unresolved',reason:'unhandled_requirement'});
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
