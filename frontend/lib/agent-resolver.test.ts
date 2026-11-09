import { afterEach, describe, expect, it, vi } from 'vitest';
import { initialBriefMemory } from '@/components/room-organizer/lib/brief-agent';
import { localPlan } from '@/components/room-organizer/lib/local-plan';
import { makeFloor, makeLayout } from '@/components/room-organizer/lib/__testfixtures__/fixtures';
import { resolveBriefTurn, type BriefExtractTransport } from './agent-resolver';
import { BRIEF_CLIENT_TIMEOUT_MS, briefConversationResponseSchema, parseBriefConversation } from '../../supabase/functions/_shared/brief-extract-contract';
import { SceneApiError } from '../../client/scene-client';

const context = { venueUp: true, scaleTyped: false, hasBase: false, command: null } as const;
afterEach(() => {vi.unstubAllEnvs();vi.useRealTimers();});

describe('model requirements', () => {
  it.each([false,true])('presents advice for the real conversation shape while keeping undecided check-in unresolved (extra unknown: %s)',async extraUnknown=>{
    vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED','1');
    const raw='为长者办一场室内讲座，预计30人，现有80把椅子；是否签到还没决定。请先给建议，不要改场景。';
    const reply='可先比较讲座座席和交流分组两种方向；椅子规格与实际可用量需核对，签到暂不决定。';
    const response={enabled:true,extraction:{headcount:30,venueIO:'indoor' as const,audienceTags:['elderly' as const],inventoryMentions:[{evidence:'80把椅子'}],activityNeeds:[{kind:'checkin' as const,decision:'unknown' as const,evidence:'是否签到还没决定'},...(extraUnknown?[{kind:'stage' as const,decision:'unknown' as const,evidence:'室内讲座'}]:[])]},reply,unhandled:[{kind:'action' as const,evidence:'请先给建议，不要改场景'}],factEvidence:[{key:'headcount' as const,evidence:'30人'},{key:'venueIO' as const,evidence:'室内'},{key:'audienceTags' as const,evidence:'长者'}]};
    expect(briefConversationResponseSchema.safeParse(response).success).toBe(true);
    expect(()=>parseBriefConversation({extraction:response.extraction,reply:response.reply,unhandled:response.unhandled,factEvidence:response.factEvidence},raw)).not.toThrow();
    const transport={briefExtract:vi.fn(),briefConversation:vi.fn().mockResolvedValue(response)};
    const turn=await resolveBriefTurn(raw,initialBriefMemory(),context,transport,undefined,{history:[]});
    expect(turn.kind).toBe('ack');expect(turn.text).toContain(reply);expect(turn.memory.headcount).toBe(30);
    expect(turn.usesModelText).toBe(true);expect(turn.modelReply).toBeUndefined();expect(turn.memory.pendingGeneration).toBeUndefined();
    expect(turn.unhandled).toEqual(response.unhandled);
    expect(turn.memory.zoneNeeds.checkin).toBeNull();expect(turn.memory.unresolvedActivityNeeds).toContain('checkin');
    if(extraUnknown)expect(turn.memory.zoneNeeds.stage).toBeNull();
    expect(turn.memory.reportedInventory).toEqual(expect.arrayContaining([expect.objectContaining({evidence:expect.stringContaining('80把椅子')})]));
    const next=await resolveBriefTurn('需要签到',turn.memory,context,transport,undefined,{history:[]});
    expect(next.memory.zoneNeeds.checkin).toBe(true);
  });
  it('does not let deferred check-in advice bypass another pending activity change',async()=>{
    vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED','1');
    const raw='签到还没决定，需要休息区，先给建议';
    const previous={...initialBriefMemory(),zoneNeeds:{checkin:null,rest:false,stage:null}};
    const transport={briefExtract:vi.fn(),briefConversation:vi.fn().mockResolvedValue({enabled:true,extraction:{activityNeeds:[{kind:'checkin',decision:'unknown',evidence:'签到还没决定'},{kind:'rest',decision:'needed',evidence:'需要休息区'}]},reply:'可以考虑多种安排。',unhandled:[],factEvidence:[]})};
    const turn=await resolveBriefTurn(raw,previous,context,transport,undefined,{history:[]});
    expect(turn.text).toContain('这样对吗');expect(turn.memory.zoneNeeds.rest).toBe(false);
    expect(turn.memory.pendingActivityNeeds).toEqual(expect.arrayContaining([expect.objectContaining({kind:'rest',value:true})]));
    expect(turn.memory.zoneNeeds.checkin).toBeNull();
  });
  it.each(['请先给建议，同时删除椅子','请先给建议并移动椅子','不要改场景，但发送给甲方'])('does not treat a mixed action as a read-only boundary: %s',async action=>{
    vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED','1');
    const raw=`30人，签到还没决定。${action}`;
    const unhandled=[{kind:'action' as const,evidence:action}];
    const transport={briefExtract:vi.fn(),briefConversation:vi.fn().mockResolvedValue({enabled:true,extraction:{headcount:30,activityNeeds:[{kind:'checkin',decision:'unknown',evidence:'签到还没决定'}]},reply:'可以先探索几个方向。',unhandled,factEvidence:[{key:'headcount',evidence:'30人'}]})};
    const turn=await resolveBriefTurn(raw,initialBriefMemory(),context,transport,undefined,{history:[]});
    expect(turn.usesModelText).not.toBe(true);expect(turn.unhandled).toEqual(unhandled);
    expect(turn.memory.zoneNeeds.checkin).toBeNull();expect(turn.memory.pendingGeneration).toBeUndefined();
  });
  it('keeps an explicit generation command out of the read-only advice path',async()=>{
    vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED','1');
    const raw='30人，签到还没决定，请先给建议，生成方案';
    const transport={briefExtract:vi.fn(),briefConversation:vi.fn().mockResolvedValue({enabled:true,extraction:{headcount:30,activityNeeds:[{kind:'checkin',decision:'unknown',evidence:'签到还没决定'}]},reply:'可以先探索几个方向。',unhandled:[{kind:'action',evidence:'请先给建议'}],factEvidence:[{key:'headcount',evidence:'30人'}]})};
    const turn=await resolveBriefTurn(raw,initialBriefMemory(),{...context,command:'first'},transport,undefined,{history:[]});
    expect(turn.usesModelText).not.toBe(true);expect(turn.memory.zoneNeeds.checkin).toBeNull();
  });
  it('does not let a read-only instruction bypass an ambiguous attendance fact',async()=>{
    vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED','1');
    const raw='30人和40人，签到还没决定，请先给建议，不要改场景';
    const transport={briefExtract:vi.fn(),briefConversation:vi.fn().mockResolvedValue({enabled:true,extraction:{headcount:30,activityNeeds:[{kind:'checkin',decision:'unknown',evidence:'签到还没决定'}]},reply:'可以先探索几个方向。',unhandled:[{kind:'action',evidence:'请先给建议，不要改场景'}],factEvidence:[{key:'headcount',evidence:'30人'}]})};
    const turn=await resolveBriefTurn(raw,initialBriefMemory(),context,transport,undefined,{history:[]});
    expect(turn.kind).toBe('ask');expect(turn.usesModelText).not.toBe(true);
    expect(turn.memory.pendingBasicFacts?.some(fact=>fact.key==='headcount')).toBe(true);
  });
  it.each(['先探索','先用假设探索'])('resolves the exact preview request %s without another model call',async raw=>{
    vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED','1');
    const briefExtract=vi.fn(async()=>({enabled:false,extraction:null}));
    const memory={...initialBriefMemory(),headcount:30,layoutModeConfirmed:true,unresolvedActivityNeeds:['checkin' as const],deferredActivityNeeds:['checkin' as const]};
    const turn=await resolveBriefTurn(raw,memory,{...context,command:'first'},{briefExtract});
    expect(turn.kind).toBe('generate');expect(turn.memory.unresolvedActivityNeeds).toEqual(['checkin']);expect(briefExtract).not.toHaveBeenCalled();
  });
  it('accepts an explicit bare local-draft command without calling the model',async()=>{
    vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED','1');
    const briefExtract=vi.fn(async()=>({enabled:false,extraction:null}));
    const memory={...initialBriefMemory(),headcount:30,lengthM:20,widthM:20,layoutMode:'desk-chair' as const,layoutModeConfirmed:true};
    const result=await resolveBriefTurn('生成本地草案',memory,{...context,command:'first'}, {briefExtract});
    expect(result.resolution).toBe('local_command');expect(result.kind).toBe('generate');expect(briefExtract).not.toHaveBeenCalled();
  });
  it.each([
    '30人，室内20×20，按一人一套课桌椅生成本地草案',
    '预计30位参加，每人一套课桌椅，现有80把椅子',
    '30人，2人一桌，已有80把椅子',
    '30人，1位讲师，现有80把椅子',
    '30人，工作人员2名，按一人一套布置',
  ])('keeps the event count separate from per-person furniture ratios: %s',async raw=>{
    vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED','0');
    const result=await resolveBriefTurn(raw,initialBriefMemory(),context);
    expect(result.memory.headcount).toBe(30);
    expect(result.memory.pendingBasicFacts?.some(fact=>fact.key==='headcount')).not.toBe(true);
  });
  it.each(['一人一套课桌椅','每2人一桌','我们有80把椅子'])('does not invent attendance from a ratio or furniture quantity: %s',async raw=>{
    vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED','0');
    const result=await resolveBriefTurn(raw,initialBriefMemory(),context);
    expect(result.memory.headcount).toBeNull();
  });
  it('accepts model-supported 30 people even when a one-person-per-set ratio is present',async()=>{
    vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED','1');
    const raw='30人，按一人一套课桌椅，现有80把椅子';
    const result=await resolveBriefTurn(raw,initialBriefMemory(),context,{briefExtract:async()=>({enabled:true,extraction:{headcount:30}})});
    expect(result.memory.headcount).toBe(30);
    expect(result.memory.pendingBasicFacts?.some(fact=>fact.key==='headcount')).not.toBe(true);
  });
  it.each(['2人每桌共30人','两人每桌共三十人','2位每张课桌共30人'])('does not take the per-desk count as total attendance: %s',async raw=>{
    vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED','1');
    const previous={...initialBriefMemory(),headcount:50};
    const result=await resolveBriefTurn(raw,previous,context,{briefExtract:async()=>({enabled:true,extraction:{headcount:2}})});
    expect(result.memory.headcount).toBe(50);
    expect(result.memory.pendingBasicFacts).toContainEqual({key:'headcount',value:2,requiresRestatement:true});
    const attempted=await resolveBriefTurn('确认',result.memory,context);
    expect(attempted.memory.headcount).toBe(50);
    expect(attempted.kind).toBe('ask');
    const corrected=await resolveBriefTurn('本场30人',result.memory,context,{briefExtract:async()=>({enabled:true,extraction:{headcount:30}})});
    expect(corrected.memory.headcount).toBe(30);
  });
  it.each(['2人每桌共30人','30人每桌2人'])('accepts the actual attendance count with desk ratio: %s',async raw=>{
    vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED','1');
    const result=await resolveBriefTurn(raw,initialBriefMemory(),context,{briefExtract:async()=>({enabled:true,extraction:{headcount:30}})});
    expect(result.memory.headcount).toBe(30);
    expect(result.memory.pendingBasicFacts?.some(fact=>fact.key==='headcount')).not.toBe(true);
  });
  it('does not invent attendance when only the per-desk count is mentioned',async()=>{
    vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED','1');
    const result=await resolveBriefTurn('2人每桌',initialBriefMemory(),context,{briefExtract:async()=>({enabled:true,extraction:{headcount:2}})});
    expect(result.memory.headcount).toBeNull();
    expect(result.kind).toBe('ask');
    expect(result.memory.pendingBasicFacts).toContainEqual({key:'headcount',value:2,requiresRestatement:true});
    const attempted=await resolveBriefTurn('确认',result.memory,context);
    expect(attempted.memory.headcount).toBeNull();expect(attempted.kind).toBe('ask');
  });
  it('does not present a model reply claiming attendance is unknown after a prior turn recorded it',async()=>{
    vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED','1');
    const prior={...initialBriefMemory(),headcount:30,venueIO:'indoor' as const};
    const controller={briefExtract:async()=>({enabled:false,extraction:null}),briefConversation:async()=>({enabled:true,extraction:{layoutMode:'desk-chair' as const},reply:'本场总人数尚未在当前表述中明确，暂按人数待定探索。',unhandled:[],factEvidence:[{key:'layoutMode' as const,evidence:'课桌椅'}]})};
    const turn=await resolveBriefTurn('采用课桌椅布局，每桌两人',prior,context,controller,undefined,{history:[]});
    expect(turn.memory.headcount).toBe(30);
    expect(`${turn.text} ${turn.modelReply??''}`).not.toMatch(/人数待定|总人数尚未/);
    expect(`${turn.text} ${turn.modelReply??''}`).toMatch(/30\s*人/);
  });
  it('keeps ordinary model answers and an explicit headcount correction',async()=>{
    vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED','1');
    const prior={...initialBriefMemory(),headcount:30,venueIO:'indoor' as const};
    const controller={briefExtract:async()=>({enabled:false,extraction:null}),briefConversation:async()=>({enabled:true,extraction:{headcount:40},reply:'已记下本场40人。',unhandled:[],factEvidence:[{key:'headcount' as const,evidence:'40人'}]})};
    const turn=await resolveBriefTurn('本场人数改成40人',prior,context,controller,undefined,{history:[]});
    expect(turn.memory.headcount).toBe(40);expect(turn.modelReply).toBe('已记下本场40人。');
  });
  it('keeps general hypothetical advice even when current attendance is already recorded',async()=>{
    vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED','1');
    const prior={...initialBriefMemory(),headcount:30};
    const controller={briefExtract:async()=>({enabled:false,extraction:null}),briefConversation:async()=>({enabled:true,extraction:{},reply:'如果人数未定，可以先按几种规模探索。',unhandled:[],factEvidence:[]})};
    const turn=await resolveBriefTurn('人数未定时活动场地怎么布置？',prior,context,controller,undefined,{history:[]});
    expect(turn.text).toBe('如果人数未定，可以先按几种规模探索。');expect(turn.memory.headcount).toBe(30);
  });
  it('does not present the old count as confirmed when the user makes it uncertain',async()=>{
    vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED','1');
    const prior={...initialBriefMemory(),headcount:30};
    const controller={briefExtract:async()=>({enabled:false,extraction:null}),briefConversation:async()=>({enabled:true,extraction:{},reply:'本场人数30人。',unhandled:[],factEvidence:[]})};
    const turn=await resolveBriefTurn('本场人数还没定',prior,context,controller,undefined,{history:[]});
    expect(turn.memory.pendingBasicFacts?.some(fact=>fact.key==='headcount')).toBe(true);
    expect(`${turn.text} ${turn.modelReply??''}`).not.toContain('本场人数30人');
    expect(`${turn.text} ${turn.modelReply??''}`).toContain('人数');
  });
  it.each(['30人40人','30人和40人','30人还有40人','30人加40人','三十人加四十人'])('asks again when a single clause contains different attendance counts: %s',async raw=>{
    vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED','1');
    const result=await resolveBriefTurn(raw,initialBriefMemory(),context,{briefExtract:async()=>({enabled:true,extraction:{headcount:30}})});
    expect(result.memory.headcount).toBeNull();
    expect(result.memory.pendingBasicFacts).toContainEqual({key:'headcount',value:30,requiresRestatement:true});
    const attempted=await resolveBriefTurn('确认',result.memory,context);
    expect(attempted.memory.headcount).toBeNull();
  });
  it('keeps a role-qualified count when it is the only event count',async()=>{
    vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED','0');
    const result=await resolveBriefTurn('为30位工作人员举办活动',initialBriefMemory(),context);
    expect(result.memory.headcount).toBe(30);
  });
  it('keeps the current role count when an unqualified count is only historical',async()=>{
    vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED','0');
    const result=await resolveBriefTurn('去年30人，今年20位工作人员',initialBriefMemory(),context);
    expect(result.memory.headcount).toBe(20);
  });
  it('does not assume that a separately counted guest is a non-attendee',async()=>{
    vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED','0');
    const result=await resolveBriefTurn('30人，另有40位嘉宾',initialBriefMemory(),context);
    expect(result.memory.headcount).toBeNull();
    expect(result.memory.pendingBasicFacts?.some(fact=>fact.key==='headcount')).toBe(true);
  });
  it.each(['unavailable','failed'] as const)('does not launch or queue generation after a %s model request',async outcome=>{
    vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED','1');
    const raw='为30人办室内讲座，场地长10米宽8米，采用课桌椅布局，生成方案';
    const transport:BriefExtractTransport={briefExtract:async()=>{
      if(outcome==='failed')throw new Error('provider failed');
      return {enabled:true,extraction:null,reason:'MODEL_INVALID_JSON'};
    }};
    const result=await resolveBriefTurn(raw,initialBriefMemory(),{...context,command:'first'},transport);
    expect(result.resolution).toBe(outcome);expect(result.kind).not.toBe('generate');
    expect(result.memory.pendingGeneration).toBeUndefined();
    if(result.memory.pendingBasicFacts?.length){
      const confirmed=await resolveBriefTurn('确认',result.memory,context,transport);
      expect(confirmed.kind).not.toBe('generate');
    }
  });
  it('explains invalid model output and never automatically generates or retries an unrecognized hard requirement',async()=>{
    vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED','1');
    const raw='30人，必须保留出口通畅，生成方案';
    const briefExtract=vi.fn().mockResolvedValue({enabled:true,extraction:null,reason:'MODEL_INVALID_RESPONSE'});
    const turn=await resolveBriefTurn(raw,initialBriefMemory(),{...context,command:'first'},{briefExtract});
    expect(briefExtract).toHaveBeenCalledOnce();expect(briefExtract.mock.calls[0]![0]).toBe(raw);
    expect(turn.resolution).toBe('unavailable');expect(turn.kind).not.toBe('generate');expect(turn.memory.pendingGeneration).toBeUndefined();
    expect(turn.modelNotice).toContain('未能完整理解本次要求');expect(turn.modelNotice).toContain('本次未生成方案');
  });
  it('continues an explicitly requested generation only after the pending facts are confirmed', async()=>{
    vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED','1');
    const raw='为30人办室内讲座，场地长12米宽10米，采用课桌椅布局，生成方案';
    const transport={briefExtract:async()=>({enabled:true,extraction:{event:'讲座',headcount:30,venueIO:'indoor' as const,lengthM:12,widthM:10,layoutMode:'desk-chair' as const}})};
    const first=await resolveBriefTurn(raw,initialBriefMemory(),{...context,command:'first'},transport);
    expect(first.kind).toBe('ask');expect(first.memory.pendingBasicFacts?.length).toBeGreaterThan(0);
    const accepted=await resolveBriefTurn('确认',first.memory,context,transport);
    expect(accepted.kind).toBe('generate');expect(accepted.resumeInstruction).toBe(raw);
    expect(accepted.memory.pendingGeneration).toBeUndefined();
    const rejected=await resolveBriefTurn('不对',first.memory,context,transport);
    expect(rejected.kind).toBe('ack');expect(rejected.memory.pendingGeneration).toBeUndefined();
    expect((await resolveBriefTurn('确认',rejected.memory,context,transport)).kind).not.toBe('generate');
  });
  it('does not generate after ordinary fact confirmation or stale/corrected requests',async()=>{
    vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED','1');
    const previous={...initialBriefMemory(),headcount:30,layoutMode:'desk-chair' as const,layoutModeConfirmed:true,pendingBasicFacts:[{key:'lengthM' as const,value:12,requiresRestatement:false}]};
    expect((await resolveBriefTurn('确认',previous,context)).kind).toBe('ack');
    const interrupted={...previous,pendingGeneration:{command:'first' as const,instruction:'出方案'}};
    const corrected=await resolveBriefTurn('尺寸不对',interrupted,context,{briefExtract:async()=>({enabled:true,extraction:{}})});
    expect(corrected.memory.pendingGeneration).toBeUndefined();
    const replaced=await resolveBriefTurn('出方案',interrupted,{...context,command:'first'});
    expect(replaced.memory.pendingGeneration).toBeUndefined();
  });
  it('does not resume an explicit request if the model also reports an unhandled action',async()=>{
    vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED','1');
    const raw='30人，12×9，出方案并发给甲方';
    const result=await resolveBriefTurn(raw,initialBriefMemory(),{...context,command:'first'},{
      briefExtract:async()=>({enabled:false,extraction:null}),
      briefConversation:async()=>({enabled:true,extraction:{headcount:30,lengthM:12,widthM:9},reply:'先核对场地。',unhandled:[{kind:'action',evidence:'发给甲方'}],factEvidence:[]}),
    },undefined,{history:[]});
    expect(result.memory.pendingGeneration).toBeUndefined();
  });
  it('resumes locally recognized standalone generation after fact confirmation when the model repeats that action as unhandled',async()=>{
    vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED','1');
    const raw='为30人办室内讲座，场地长10米宽8米，采用课桌椅布局，生成方案';
    const transport={briefExtract:async()=>({enabled:false,extraction:null}),briefConversation:async()=>({enabled:true,extraction:{headcount:30,lengthM:10,widthM:8},reply:'先核对场地。',unhandled:[{kind:'action' as const,evidence:'生成方案'}],factEvidence:[]})};
    const first=await resolveBriefTurn(raw,initialBriefMemory(),{...context,command:'first'},transport,undefined,{history:[]});
    expect(first.kind).toBe('ask');expect(first.unhandled).toEqual([]);expect(first.memory.pendingGeneration?.instruction).toBe(raw);
    const confirmed=await resolveBriefTurn('确认',first.memory,context,transport);
    expect(confirmed.kind).toBe('generate');expect(confirmed.resumeInstruction).toBe(raw);
  });
  it.each([
    {raw:'30人，场地长10米宽8米，生成方案，发给甲方',command:'first' as const,unhandled:[{kind:'action' as const,evidence:'生成方案'},{kind:'action' as const,evidence:'发给甲方'}],remaining:'发给甲方'},
    {raw:'30人，场地长10米宽8米，生成方案并发给甲方',command:'first' as const,unhandled:[{kind:'action' as const,evidence:'生成方案并发给甲方'}],remaining:'生成方案并发给甲方'},
    {raw:'30人，场地长10米宽8米，不要生成方案',command:'first' as const,unhandled:[{kind:'action' as const,evidence:'生成方案'}],remaining:'生成方案'},
    {raw:'30人，场地长10米宽8米，生成方案',command:null,unhandled:[{kind:'action' as const,evidence:'生成方案'}],remaining:'生成方案'},
    {raw:'30人，场地长10米宽8米，生成方案',command:'first' as const,unhandled:[{kind:'question' as const,evidence:'生成方案'}],remaining:'生成方案'},
  ])('retains unrelated, ambiguous or unrecognized unhandled action: $raw',async({raw,command,unhandled,remaining})=>{
    vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED','1');
    const result=await resolveBriefTurn(raw,initialBriefMemory(),{...context,command},{briefExtract:async()=>({enabled:false,extraction:null}),briefConversation:async()=>({enabled:true,extraction:{headcount:30,lengthM:10,widthM:8},reply:'先核对场地。',unhandled,factEvidence:[]})},undefined,{history:[]});
    expect(result.unhandled?.some(item=>item.evidence===remaining)).toBe(true);
    expect(result.memory.pendingGeneration).toBeUndefined();
  });
  it.each(['今年80人还是100人？','去年80人，今年人数未确定','场地12×9英寸，人数待定'])('asks for restatement on ambiguous current facts even with empty model output: %s',async raw=>{
    vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED','1');
    const prior={...initialBriefMemory(),headcount:40};
    const turn=await resolveBriefTurn(raw,prior,context,{briefExtract:async()=>({enabled:true,extraction:{}})});
    expect(turn.kind).toBe('ask');expect(turn.memory.headcount).toBe(40);
    expect(turn.memory.pendingBasicFacts?.some(fact=>fact.requiresRestatement)).toBe(true);
    expect((await resolveBriefTurn('确认',turn.memory,context)).kind).toBe('ask');
  });
  it('aborts a timed-out request and says provider billing may continue',async()=>{
    vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED','1');vi.useFakeTimers();let signal:AbortSignal|undefined;
    const transport:BriefExtractTransport={briefExtract:(_message,s)=>{signal=s;return new Promise(()=>{});}};
    const task=resolveBriefTurn('继续',initialBriefMemory(),context,transport);
    await vi.advanceTimersByTimeAsync(BRIEF_CLIENT_TIMEOUT_MS);
    const result=await task;expect(signal?.aborted).toBe(true);expect(result.resolution).toBe('failed');expect(result.modelNotice).toContain('可能仍会计费');
  });
  it('propagates explicit cancellation without producing a fallback or modifying the brief',async()=>{
    vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED','1');const cancel=new AbortController(),prior=initialBriefMemory();let providerSignal:AbortSignal|undefined;
    const task=resolveBriefTurn('8人，室内12×9米',prior,context,{briefExtract:(_message,signal)=>{providerSignal=signal;return new Promise(()=>{});}},cancel.signal);
    cancel.abort();await expect(task).rejects.toMatchObject({name:'AbortError'});expect(providerSignal?.aborted).toBe(true);expect(prior.headcount).toBeNull();
  });
  it('asks for a layout instead of generating default dining until the user chooses', async () => {
    vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED', '0');
    const turn = await resolveBriefTurn('30人，室内12×9', initialBriefMemory(), context);
    expect(turn.kind).toBe('ask');
    expect(turn.memory.layoutModeConfirmed).toBe(false);
    const answer = await resolveBriefTurn('课桌椅', turn.memory, context);
    expect(answer.memory.layoutMode).toBe('desk-chair');
    expect(answer.memory.layoutModeConfirmed).toBe(true);
    expect(answer.kind).toBe('generate');
  });
  it.each(['不要圆桌', '不确定是否用圆桌', '圆桌待定', '圆桌或站立'])('keeps an offline dining rejection or uncertainty unresolved: %s', async raw => {
    vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED', '0');
    const turn = await resolveBriefTurn(raw, initialBriefMemory(), context);
    expect(turn.kind).toBe('ask');
    expect(turn.memory.layoutModeUnresolved).toBe(true);
    expect((await resolveBriefTurn('出方案', turn.memory, { ...context, command: 'first' })).kind).toBe('ask');
    const choice = await resolveBriefTurn('改成课桌椅', turn.memory, context);
    expect(choice.memory.layoutMode).toBe('desk-chair');
    expect(choice.memory.layoutModeUnresolved).toBe(false);
  });

  it('does not let a model override an explicit dining rejection with either layout', async () => {
    vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED', '1');
    for (const layoutMode of ['dining', 'desk-chair']) {
      const transport = { briefExtract: vi.fn()
        .mockResolvedValueOnce({ enabled: true, extraction: { layoutMode } })
        .mockResolvedValueOnce({ enabled: true, extraction: { layoutMode: 'desk-chair' } }) };
      const turn = await resolveBriefTurn('不要圆桌', initialBriefMemory(), context, transport);
      expect(turn.kind).toBe('ask');
      expect(turn.memory.layoutModeUnresolved).toBe(true);
      expect(turn.memory.pendingBasicFacts?.find(fact => fact.key === 'layoutMode')).toBeUndefined();
      const choice = await resolveBriefTurn('改成课桌椅', turn.memory, context, transport);
      expect(choice.memory.layoutMode).toBe('desk-chair');
      expect(choice.memory.layoutModeUnresolved).toBe(false);
    }
  });
  it.each([
    ['办一场活动', { headcount: 80 }, 'headcount'],
    ['不要80人', { headcount: 80 }, 'headcount'],
    ['80人或者100人', { headcount: 80 }, 'headcount'],
    ['80人或100人', { headcount: 80 }, 'headcount'],
    ['去年80人，今年人数未定', { headcount: 80 }, 'headcount'],
    ['上一场80人，今年人数待定', { headcount: 80 }, 'headcount'],
    ['之前80人', { headcount: 80 }, 'headcount'],
    ['历史人数80人', { headcount: 80 }, 'headcount'],
    ['最多80人', { headcount: 80 }, 'headcount'],
    ['不超过80人', { headcount: 80 }, 'headcount'],
    ['80人，100人', { headcount: 80 }, 'headcount'],
    ['12×9厘米', { lengthM: 12, widthM: 9 }, 'lengthM'],
    ['12×9in', { lengthM: 12, widthM: 9 }, 'lengthM'],
    ['12×9 feet', { lengthM: 12, widthM: 9 }, 'lengthM'],
    ['室内还是室外', { venueIO: 'indoor' }, 'venueIO'],
    ['室内或室外', { venueIO: 'outdoor' }, 'venueIO'],
  ])('does not apply unsupported or ambiguous model facts from %s', async (raw, extraction, key) => {
    vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED', '1');
    const transport = { briefExtract: vi.fn().mockResolvedValue({ enabled: true, extraction }) };
    const turn = await resolveBriefTurn(raw, initialBriefMemory(), context, transport);
    expect(turn.kind).toBe('ask');
    expect(turn.memory.pendingBasicFacts?.some(fact => fact.key === key)).toBe(true);
    expect(turn.memory[key as 'headcount']).toBeNull();
    const offline = await resolveBriefTurn('出方案', turn.memory, { ...context, command: 'first' }, null);
    expect(offline.kind).toBe('ask');
  });

  it('does not overwrite an earlier count with an unsupported model value before confirmation', async () => {
    vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED', '1');
    const previous = { ...initialBriefMemory(), headcount: 80 };
    const transport = { briefExtract: vi.fn().mockResolvedValue({ enabled: true, extraction: { headcount: 200 } }) };
    const turn = await resolveBriefTurn('换个方式布置', previous, context, transport);
    expect(turn.memory.headcount).toBe(80);
    expect(turn.memory.pendingBasicFacts).toEqual([{ key: 'headcount', value: 200, requiresRestatement: false }]);
    const reject = await resolveBriefTurn('不对', turn.memory, context, transport);
    expect(reject.memory.headcount).toBe(80);
    expect(reject.memory.pendingBasicFacts).toEqual([]);
    const accepted = await resolveBriefTurn('确认', turn.memory, context, transport);
    expect(accepted.memory.headcount).toBe(200);
  });

  it('requires an explicit restatement before accepting legacy in-memory candidates', async () => {
    vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED', '0');
    const previous = { ...initialBriefMemory(), pendingBasicFacts: [{ key: 'headcount' as const, value: 80 }] };
    const attempted = await resolveBriefTurn('确认', previous, context);
    expect(attempted.kind).toBe('ask');
    expect(attempted.memory.headcount).toBeNull();
    const corrected = await resolveBriefTurn('60人', attempted.memory, context);
    expect(corrected.memory.headcount).toBe(60);
    expect(corrected.memory.pendingBasicFacts).toEqual([]);
  });

  it.each([
    ['不要80人', 'headcount'],
    ['80人或100人', 'headcount'],
    ['去年80人，今年人数未定', 'headcount'],
    ['上一场80人，今年人数待定', 'headcount'],
    ['之前80人', 'headcount'],
    ['历史人数80人', 'headcount'],
    ['最多80人', 'headcount'],
    ['不超过80人', 'headcount'],
    ['12×9厘米', 'lengthM'],
    ['12×9 feet', 'lengthM'],
    ['12×9in', 'lengthM'],
    ['12×9平方米', 'areaM2'],
    ['室内或室外', 'venueIO'],
  ])('applies the same fact gate while offline: %s', async (raw, key) => {
    vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED', '0');
    const turn = await resolveBriefTurn(raw, initialBriefMemory(), context);
    expect(turn.kind).toBe('ask');
    expect(turn.memory.pendingBasicFacts?.some(fact => fact.key === key)).toBe(true);
    expect(turn.memory[key as 'headcount']).toBeNull();
    expect(turn.memory.pendingBasicFacts?.find(fact => fact.key === key)?.requiresRestatement).toBe(true);
    const confirmed = await resolveBriefTurn('确认', turn.memory, context);
    expect(confirmed.memory[key as 'headcount']).toBeNull();
    expect(confirmed.kind).toBe('ask');
  });

  it('clears an old pending fact when the user provides an unambiguous correction', async () => {
    vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED', '1');
    const transport = { briefExtract: vi.fn()
      .mockResolvedValueOnce({ enabled: true, extraction: { headcount: 200 } })
      .mockResolvedValueOnce({ enabled: true, extraction: { headcount: 60 } }) };
    const first = await resolveBriefTurn('安排活动', initialBriefMemory(), context, transport);
    const corrected = await resolveBriefTurn('60人', first.memory, context, transport);
    expect(corrected.memory.headcount).toBe(60);
    expect(corrected.memory.pendingBasicFacts).toEqual([]);
  });
  it('retains multiple unresolved needs across turns and requires each answer before generation', async () => {
    vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED', '1');
    const transport = { briefExtract: vi.fn()
      .mockResolvedValueOnce({ enabled: true, extraction: { activityNeeds: [{ kind: 'checkin', decision: 'unknown', evidence: '是否签到' }] } })
      .mockResolvedValueOnce({ enabled: true, extraction: { activityNeeds: [{ kind: 'stage', decision: 'unknown', evidence: '是否设舞台' }] } })
      .mockResolvedValue({ enabled: true, extraction: {} }) };
    const first = await resolveBriefTurn('是否签到', { ...initialBriefMemory(), headcount: 30, layoutModeConfirmed: true }, context, transport);
    const second = await resolveBriefTurn('是否设舞台', first.memory, context, transport);
    expect(second.memory.unresolvedActivityNeeds).toEqual(['checkin', 'stage']);
    const blocked = await resolveBriefTurn('出方案', second.memory, { ...context, command: 'first' }, transport);
    expect(blocked.kind).toBe('ask');
    const firstAnswer = await resolveBriefTurn('需要', blocked.memory, context, transport);
    expect(firstAnswer.memory.zoneNeeds.checkin).toBe(true);
    expect(firstAnswer.memory.unresolvedActivityNeeds).toEqual(['stage']);
    const stillBlocked = await resolveBriefTurn('出方案', firstAnswer.memory, { ...context, command: 'first' }, transport);
    expect(stillBlocked.kind).toBe('ask');
    const secondAnswer = await resolveBriefTurn('不需要', stillBlocked.memory, context, transport);
    expect(secondAnswer.memory.zoneNeeds.stage).toBe(false);
    expect(secondAnswer.memory.unresolvedActivityNeeds).toEqual([]);
    const generated = await resolveBriefTurn('出方案', secondAnswer.memory, { ...context, command: 'first' }, transport);
    expect(generated.kind).toBe('generate');
  });

  it('blocks generation after conflicting model interpretations until explicitly resolved', async () => {
    vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED', '1');
    const previous = { ...initialBriefMemory(), headcount: 30, layoutModeConfirmed: true, zoneNeeds: { checkin: true, rest: null, stage: null } };
    const transport = { briefExtract: vi.fn()
      .mockResolvedValueOnce({ enabled: true, extraction: { activityNeeds: [
        { kind: 'checkin', decision: 'needed', evidence: '签到' },
        { kind: 'checkin', decision: 'not_needed', evidence: '签到' },
      ] } })
      .mockResolvedValue({ enabled: true, extraction: {} }) };
    const conflict = await resolveBriefTurn('签到怎么安排', previous, context, transport);
    expect(conflict.kind).toBe('ask');
    expect(conflict.memory.unresolvedActivityNeeds).toEqual(['checkin']);
    const blocked = await resolveBriefTurn('出方案', conflict.memory, { ...context, command: 'first' }, transport);
    expect(blocked.kind).toBe('ask');
    const resolved = await resolveBriefTurn('不需要', blocked.memory, context, transport);
    expect(resolved.memory.zoneNeeds.checkin).toBe(false);
    expect(resolved.memory.unresolvedActivityNeeds).toEqual([]);
    expect((await resolveBriefTurn('出方案', resolved.memory, { ...context, command: 'first' }, transport)).kind).toBe('generate');
  });
  it('accepts a transport whose optional reason is explicitly undefined', async () => {
    vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED', '1');
    const transport: BriefExtractTransport = { briefExtract: async () => ({ enabled: false, extraction: null, reason: undefined }) };
    const turn = await resolveBriefTurn('80人', initialBriefMemory(), context, transport);
    expect(turn.resolution).toBe('unavailable');
    expect(turn.modelNotice).toContain('尚未配置');
  });
  it('carries the model headcount and its strength across turns without attaching stale strength to a new number', async () => {
    vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED', '1');
    const transport = { briefExtract: vi.fn()
      .mockResolvedValueOnce({ enabled: true, extraction: { headcount: 80, requirements: [{ key: 'headcount', value: 80, mode: 'must' }] } })
      .mockResolvedValueOnce({ enabled: true, extraction: { event: '讲座' } })
      .mockResolvedValueOnce({ enabled: true, extraction: { headcount: 60, requirements: [{ key: 'headcount', value: 80, mode: 'must' }] } }) };
    const first = await resolveBriefTurn('必须容纳八十人', initialBriefMemory(), context, transport);
    expect(first.resolution).toBe('model');
    expect(first.memory.headcount).toBe(80);
    expect(first.memory.headcountMode).toBe('must');
    const second = await resolveBriefTurn('这是讲座', first.memory, context, transport);
    expect(second.memory.headcountMode).toBe('must');
    const third = await resolveBriefTurn('改为六十人', second.memory, context, transport);
    expect(third.memory.headcount).toBe(60);
    expect(third.memory.headcountMode).toBeNull();
  });

  it('uses a model-extracted mandatory seated audience to block an undersized candidate', async () => {
    vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED', '1');
    const transport = { briefExtract: vi.fn().mockResolvedValue({ enabled: true, extraction: {
      headcount: 200, layoutMode: 'desk-chair', requirements: [{ key: 'headcount', value: 200, mode: 'must' }],
    } }) };
    const turn = await resolveBriefTurn('课桌椅必须让二百人都坐下', initialBriefMemory(), context, transport);
    const plan = localPlan({ base: makeLayout({ width: 12, height: 9, floors: [makeFloor({ items: [] })] }),
      floorIndex: 0, widthM: 12, depthM: 9, variant: 0, guests: turn.memory.headcount,
      layoutMode: turn.memory.layoutMode, stage: false, checkin: false,
      requireSeats: turn.memory.headcountMode === 'must' && turn.memory.allGuestsSeated === true });
    expect(plan.seats ?? 0).toBeLessThan(200);
    expect(plan.blocked).toContain('200');
  });

  it('keeps confirmed memory and falls back if the model call fails', async () => {
    vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED', '1');
    const previous = { ...initialBriefMemory(), headcount: 80, headcountMode: 'must' as const };
    const turn = await resolveBriefTurn('继续', previous, context, { briefExtract: vi.fn().mockRejectedValue(new Error('unavailable')) });
    expect(turn.resolution).toBe('failed');
    expect(turn.memory.headcount).toBe(80);
    expect(turn.memory.headcountMode).toBe('must');
  });

  it('distinguishes disabled, disconnected and unavailable model paths', async () => {
    vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED', '0');
    expect((await resolveBriefTurn('80人', initialBriefMemory(), context)).resolution).toBe('disabled');
    vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED', '1');
    expect((await resolveBriefTurn('80人', initialBriefMemory(), context)).resolution).toBe('not_connected');
    expect((await resolveBriefTurn('80人', initialBriefMemory(), context, {
      briefExtract: vi.fn().mockResolvedValue({ enabled: false, extraction: null }),
    })).resolution).toBe('unavailable');
  });

  it.each([
    ['ROUTE_NOT_FOUND',404,'更新服务'],
    ['BRIEF_GUARD_NOT_READY',503,'完成配置'],
  ] as const)('reports backend readiness %s without losing recorded requirements or retrying',async(code,status,message)=>{
    vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED','1');
    const briefExtract=vi.fn().mockRejectedValue(new SceneApiError(code,status,{private:'secret diagnostic'}));
    const previous={...initialBriefMemory(),headcount:80,headcountMode:'must' as const};
    const turn=await resolveBriefTurn('继续',previous,context,{briefExtract});
    expect(turn.resolution).toBe('failed');expect(turn.modelNotice).toContain(message);
    expect(turn.modelNotice).not.toContain(code);expect(turn.modelNotice).not.toContain('secret diagnostic');
    expect(turn.modelDiagnostic).toMatchObject({code,status});
    expect(JSON.stringify(turn.modelDiagnostic)).not.toContain('secret');
    expect(turn.memory.headcount).toBe(80);expect(briefExtract).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['CONVERSATION_API_NOT_CONFIGURED',503,'config','完成配置'],
    ['SESSION_CHANGED',409,'session','登录状态已变化'],
    ['NETWORK_ERROR',0,'network','网络请求没有完成'],
    ['NON_JSON_RESPONSE',502,'non_json','无法读取'],
    ['INVALID_RESPONSE',502,'contract','未通过校验'],
    ['HTTP_ERROR',500,'http','暂不可用'],
  ] as const)('classifies thrown transport failure %s without the generic-only path',async(code,status,category,message)=>{
    vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED','1');
    const briefConversation=vi.fn().mockRejectedValue(new SceneApiError(code,status,{body:'<html>secret gateway</html>'}));
    const turn=await resolveBriefTurn('80人发布会，室内12×9，安排签到和主舞台',initialBriefMemory(),context,{briefExtract:vi.fn(),briefConversation},undefined,{history:[]});
    expect(turn.resolution).toBe('failed');
    expect(turn.modelNotice).toContain(message);
    expect(turn.modelNotice).not.toContain(code);
    expect(turn.modelNotice).not.toContain('secret gateway');
    expect(turn.modelDiagnostic).toEqual({category,code,status});
    expect(turn.modelReply).toBeUndefined();
  });

  it('keeps a classified model failure instead of the unclassified catch',async()=>{
    vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED','1');
    const briefConversation=vi.fn().mockResolvedValue({enabled:true,extraction:null,reply:null,unhandled:[],factEvidence:[],reason:'MODEL_INVALID_RESPONSE'});
    const turn=await resolveBriefTurn('80人发布会，室内12×9，安排签到和主舞台',initialBriefMemory(),context,{briefExtract:vi.fn(),briefConversation},undefined,{history:[]});
    expect(turn.resolution).toBe('unavailable');
    expect(turn.modelNotice).toContain('未通过校验');
    expect(turn.modelNotice).not.toContain('暂不可用');
    expect(turn.modelDiagnostic).toEqual({category:'provider',code:'MODEL_INVALID_RESPONSE'});
  });

  it.each([
    ['MODEL_PROVIDER_INCOMPLETE', '配置不完整'],
    ['MODEL_PROVIDER_URL_INVALID', '地址无效'],
    ['PROVIDER_HTTP_ERROR:401', '认证或权限'],
    ['PROVIDER_HTTP_ERROR:402', '余额或计费'],
    ['PROVIDER_HTTP_ERROR:429', '请求过多'],
    ['MODEL_TIMEOUT', '响应超时'],
    ['MODEL_EVIDENCE_MISMATCH', '未通过校验'],
    ['MODEL_INVALID_JSON', '未通过校验'],
    ['private-upstream-detail', '暂时不可用'],
  ])('maps safe provider error %s to a useful message without exposing raw errors', async (reason, expected) => {
    vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED', '1');
    const turn = await resolveBriefTurn('80人', initialBriefMemory(), context, {
      briefExtract: vi.fn().mockResolvedValue({ enabled: true, extraction: null, reason }),
    });
    expect(turn.resolution).toBe('unavailable');
    expect(turn.modelNotice).toContain(expected);
    expect(turn.modelNotice).not.toContain(reason);
    expect(turn.memory.headcount).toBe(80);
  });

  it('asks for confirmation before model-interpreted activity needs affect the plan', async () => {
    vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED', '1');
    const transport = { briefExtract: vi.fn().mockResolvedValue({ enabled: true, extraction: {
      activityNeeds: [{ kind: 'checkin', decision: 'not_needed', evidence: '不用安排接待台' }],
    } }) };
    const proposed = await resolveBriefTurn('宾客自行入场，不用安排接待台', initialBriefMemory(), context, transport);
    expect(proposed.memory.zoneNeeds.checkin).toBeNull();
    expect(proposed.text).toContain('不需要签到区');
    expect(proposed.text).toContain('这样对吗');
    const accepted = await resolveBriefTurn('确认', proposed.memory, context, transport);
    expect(accepted.resolution).toBe('confirmation');
    expect(accepted.memory.zoneNeeds.checkin).toBe(false);
    expect(accepted.memory.pendingActivityNeeds).toEqual([]);
    expect(transport.briefExtract).toHaveBeenCalledTimes(1);
  });

  it('allows a user to correct one proposed change without losing the others', async () => {
    vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED', '1');
    const previous = { ...initialBriefMemory(), zoneNeeds: { checkin: true, rest: null, stage: null } };
    const transport = { briefExtract: vi.fn()
      .mockResolvedValueOnce({ enabled: true, extraction: { activityNeeds: [
        { kind: 'checkin', decision: 'not_needed', evidence: '不用安排接待' },
        { kind: 'rest', decision: 'needed', evidence: '要休息区' },
      ] } })
      .mockResolvedValueOnce({ enabled: true, extraction: { activityNeeds: [
        { kind: 'checkin', decision: 'needed', evidence: '还是需要接待' },
      ] } }) };
    const first = await resolveBriefTurn('不用安排接待，要休息区', previous, context, transport);
    expect(first.memory.pendingActivityNeeds).toHaveLength(2);
    const corrected = await resolveBriefTurn('还是需要接待', first.memory, context, transport);
    expect(corrected.memory.pendingActivityNeeds.map(item => item.kind)).toEqual(['rest']);
    expect(corrected.memory.zoneNeeds.checkin).toBe(true);
    const confirmed = await resolveBriefTurn('确认', corrected.memory, context, transport);
    expect(confirmed.memory.zoneNeeds).toEqual({ checkin: true, rest: true, stage: null });
  });

  it('rejects invented evidence and asks about conflicting model interpretations', async () => {
    vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED', '1');
    const transport = { briefExtract: vi.fn().mockResolvedValueOnce({ enabled: true, extraction: {
      activityNeeds: [{ kind: 'rest', decision: 'needed', evidence: '必须休息区' }],
    } }).mockResolvedValueOnce({ enabled: true, extraction: { activityNeeds: [
      { kind: 'checkin', decision: 'needed', evidence: '接待台' },
      { kind: 'checkin', decision: 'not_needed', evidence: '接待台' },
    ] } }) };
    const invented = await resolveBriefTurn('我们办个讲座', initialBriefMemory(), context, transport);
    expect(invented.memory.zoneNeeds.rest).toBeNull();
    expect(invented.memory.pendingActivityNeeds).toEqual([]);
    const conflict = await resolveBriefTurn('接待台怎么办', invented.memory, context, transport);
    expect(conflict.kind).toBe('ask');
    expect(conflict.text).toMatch(/不确定|没能确定/);
    expect(conflict.memory.zoneNeeds.checkin).toBeNull();
  });

  it('preserves an explicitly deferred check-in need without forcing an immediate decision', async () => {
    vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED', '1');
    const transport = { briefExtract: vi.fn().mockResolvedValue({ enabled: true, extraction: {
      headcount: 80, lengthM: 12, widthM: 9,
      activityNeeds: [{ kind: 'checkin', decision: 'unknown', evidence: '签到还没想好' }],
    } }) };
    const turn = await resolveBriefTurn('80 人，12×9，签到还没想好', initialBriefMemory(), context, transport);
    expect(turn.kind).toBe('ack');
    expect(turn.text).toContain('签到区暂时待定');
    expect(turn.text).toContain('先用假设探索');
    expect(turn.memory.zoneNeeds.checkin).toBeNull();
    expect(turn.memory.unresolvedActivityNeeds).toContain('checkin');
    expect(turn.memory.headcount).toBe(80);
    const answered = await resolveBriefTurn('需要', turn.memory, context, transport);
    expect(answered.resolution).toBe('confirmation');
    expect(answered.memory.zoneNeeds.checkin).toBe(true);
    expect(answered.memory.unresolvedActivityNeeds).toEqual([]);
    expect(transport.briefExtract).toHaveBeenCalledTimes(1);
  });
});
