import {afterEach,describe,expect,it,vi} from 'vitest';
import {cloudBriefMessage,initialBriefMemory,parseBriefTurn} from '@/components/room-organizer/lib/brief-agent';
import {resolveBriefTurn} from './agent-resolver';
import {localPlan} from '@/components/room-organizer/lib/local-plan';
import {makeFloor,makeLayout} from '@/components/room-organizer/lib/__testfixtures__/fixtures';
const context={venueUp:true,scaleTyped:false,hasBase:false,command:null} as const;
afterEach(()=>vi.unstubAllEnvs());
describe('explicit mobility needs',()=>{
 it('retains explicit need across unrelated turns and includes it in the cloud brief without claiming compliance',()=>{
  const first=parseBriefTurn('本场需要 1.5 米轮椅通道',initialBriefMemory(),context);
  expect(first.memory.mobilityRequirement).toEqual({decision:'needed',evidence:'本场需要 1.5 米轮椅通道'});
  const second=parseBriefTurn('80人',first.memory,context);
  expect(second.memory.mobilityRequirement?.decision).toBe('needed');
  expect(cloudBriefMessage('出方案',second.memory)).toContain('需要 1.5 米轮椅通道');
  expect(cloudBriefMessage('出方案',second.memory)).toContain('待核验');
 });
 it('does not infer an assistance need from age alone',()=>{
  const turn=parseBriefTurn('银发讲座',initialBriefMemory(),context);
  expect(turn.memory.mobilityRequirement).toBeUndefined();
 });
 it('records explicit negation and asks on conflict or uncertainty',()=>{
  const denied=parseBriefTurn('不需要轮椅通道',initialBriefMemory(),context);expect(denied.memory.mobilityRequirement?.decision).toBe('not_needed');
  for(const input of ['轮椅通道是否需要还没定','需要轮椅通道，不需要轮椅通道','没有说不需要轮椅通道','需要轮椅通道但不需要轮椅通道','不是不需要轮椅通道','去年需要轮椅通道','需要轮椅通道吗']){
    const turn=parseBriefTurn(input,denied.memory,context);expect(turn.memory.mobilityRequirement?.decision).toBe('unknown');expect(turn.memory.mobilityNeedsClarification).toBe(true);expect(turn.kind).toBe('ask');
    const attempt=parseBriefTurn('出方案',turn.memory,{...context,command:'first'});expect(attempt.kind).toBe('ask');
    const resolved=parseBriefTurn('需要',turn.memory,context);expect(resolved.memory.mobilityRequirement?.decision).toBe('needed');expect(resolved.memory.mobilityNeedsClarification).toBe(false);
  }
 });
 it('does not let hallucinated or contradictory model booleans override original text',async()=>{
  vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED','1');
  const transport={briefExtract:async()=>({enabled:true,extraction:{mobilityAssistance:false}})};
  const actual=await resolveBriefTurn('本场需要轮椅通道',initialBriefMemory(),context,transport);
  expect(actual.memory.mobilityRequirement?.decision).toBe('needed');
  const invented=await resolveBriefTurn('银发讲座',initialBriefMemory(),context,{briefExtract:async()=>({enabled:true,extraction:{mobilityAssistance:true}})});
  expect(invented.memory.mobilityRequirement).toBeUndefined();
 });
 it('keeps accessibility as a warning in the real local candidate',()=>{
  const base=makeLayout({width:12,height:9,floors:[makeFloor({items:[]})]});
  const plan=localPlan({base,floorIndex:0,widthM:12,depthM:9,variant:0,guests:8,stage:false,checkin:false,mobilityRequired:true,mobilityEvidence:'需要 1.5 米轮椅通道'});
  expect(plan.summary?.join(' ')).toContain('需要 1.5 米轮椅通道');expect(plan.summary?.join(' ')).toContain('现场通行与无障碍条件待核验');expect(plan.summary?.join(' ')).toContain('不代表合规通过');
 });
});
