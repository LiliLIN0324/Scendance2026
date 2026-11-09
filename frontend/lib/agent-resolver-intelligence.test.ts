import {afterEach,describe,expect,it,vi} from 'vitest';
import {initialBriefMemory,parseBriefTurn} from '@/components/room-organizer/lib/brief-agent';
import {resolveBriefTurn} from './agent-resolver';
const context={venueUp:true,scaleTyped:false,hasBase:false,command:null} as const;
afterEach(()=>vi.unstubAllEnvs());
describe('brief understanding across model boundary',()=>{
 it('accepts an explicitly undecided headcount while preserving unconfirmed model proposals',async()=>{
  vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED','1');
  const raw='我想和杭州一家养老社区先交流，筹划一场让居民参与的活动，场地、人数和物料都还没确定。你会怎样帮我开始？';
  const model=vi.fn(async()=>({enabled:true,extraction:{event:'居民参与活动'},reply:'可以先了解居民兴趣，再一起选择活动方向；人数和场地先保留待定。',unhandled:[],factEvidence:[{key:'event' as const,evidence:'居民参与的活动'}]}));
  const result=await resolveBriefTurn(raw,initialBriefMemory(),{...context,venueUp:false},{briefExtract:async()=>({enabled:false,extraction:null}),briefConversation:model},undefined,{history:[]});
  expect(result.text).toContain('人数和场地先保留待定');expect(result.text).not.toContain('请重新说明');
  expect(result.memory.headcount).toBeNull();expect(result.memory.pendingBasicFacts).toContainEqual({key:'headcount',value:'待重新说明',requiresRestatement:true});expect(result.memory.askedScale).toBe(false);
 });
 it('answers a general question without changing existing pending requirement state',async()=>{
  vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED','1');
  const previous={...initialBriefMemory(),headcount:30,askedScale:true};
  const conversation=vi.fn(async()=>({enabled:true,extraction:{},reply:'签到可用于核对到场情况，也可以不设。',unhandled:[],factEvidence:[]}));
  const legacy=vi.fn(async()=>({enabled:false,extraction:null}));const result=await resolveBriefTurn('签到有什么作用？',previous,{...context,venueUp:false},{briefExtract:legacy,briefConversation:conversation},undefined,{history:[]});
  expect(result.readOnlyReply).toBe(true);expect(result.memory).toEqual(previous);expect(result.text).toContain('签到可用于');expect(conversation).toHaveBeenCalledOnce();expect(legacy).not.toHaveBeenCalled();
 });
 it('answers a wheelchair information question without changing a pending activity decision',async()=>{
  vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED','1');
  const previous={...initialBriefMemory(),unresolvedActivityNeeds:['checkin' as const]};
  const result=await resolveBriefTurn('为什么需要轮椅通道？',previous,context,{briefExtract:async()=>({enabled:false,extraction:null}),briefConversation:async()=>({enabled:true,extraction:{},reply:'需要结合实际人员和场地核对通行条件。',unhandled:[],factEvidence:[]})},undefined,{history:[]});
  expect(result.readOnlyReply).toBe(true);expect(result.memory).toEqual(previous);expect(result.text).toContain('通行条件');
 });
 it('keeps explicit local requirements even when the model omits them',async()=>{
  vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED','1');
  const result=await resolveBriefTurn('不要签到',initialBriefMemory(),context,{briefExtract:async()=>({enabled:false,extraction:null}),briefConversation:async()=>({enabled:true,extraction:{},reply:'好的，先梳理入场安排。',unhandled:[],factEvidence:[]})},undefined,{history:[]});
  expect(result.memory.zoneNeeds.checkin).toBe(false);expect(result.readOnlyReply).not.toBe(true);
 });
 it('requires confirmation of model-extracted activity needs and preserves literal evidence',async()=>{
  vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED','1');
  const turn=await resolveBriefTurn('我要一个签到区',initialBriefMemory(),context,{briefExtract:async()=>({enabled:true,extraction:{activityNeeds:[{kind:'checkin',decision:'needed',evidence:'要一个签到区'}]}})});
  expect(turn.memory.pendingActivityNeeds).toEqual([{kind:'checkin',value:true,evidence:'要一个签到区'}]);expect(turn.memory.zoneNeeds.checkin).toBeNull();
  const confirmed=await resolveBriefTurn('确认',turn.memory,context);expect(confirmed.memory.zoneNeeds.checkin).toBe(true);
 });
 it.each(['不要签到','签到还没定'])('cannot use cropped evidence to reverse or assume the actual wording: %s',async text=>{
  vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED','1');
  const turn=await resolveBriefTurn(text,initialBriefMemory(),context,{briefExtract:async()=>({enabled:true,extraction:{activityNeeds:[{kind:'checkin',decision:'needed',evidence:'签到'}]}})});
  expect(turn.memory.zoneNeeds.checkin).toBeNull();expect(turn.memory.unresolvedActivityNeeds).toContain('checkin');expect(turn.kind).toBe('ask');
 });
 it('does not turn an ambiguous denial into a negative requirement',async()=>{
  vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED','1');
  const turn=await resolveBriefTurn('没有说不要签到',initialBriefMemory(),context,{briefExtract:async()=>({enabled:true,extraction:{activityNeeds:[{kind:'checkin',decision:'not_needed',evidence:'签到'}]}})});
  expect(turn.memory.pendingActivityNeeds).toEqual([]);expect(turn.memory.unresolvedActivityNeeds).toContain('checkin');expect(turn.kind).toBe('ask');
 });
 it('does not accept a made-up number, metric or layout without explicit user confirmation',async()=>{
  vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED','1');
  const turn=await resolveBriefTurn('办一场活动',initialBriefMemory(),context,{briefExtract:async()=>({enabled:true,extraction:{headcount:80,lengthM:12,widthM:9,layoutMode:'dining'}})});
  expect(turn.memory.headcount).toBeNull();expect(turn.memory.lengthM).toBeNull();expect(turn.memory.layoutModeConfirmed).toBe(false);expect(turn.kind).toBe('ask');
 });
 it('accepts 1 person without silently increasing the attendance',()=>{
  expect(parseBriefTurn('1人，室内12×9米，圆桌',initialBriefMemory(),context).memory.headcount).toBe(1);
 });
 it.each(['我们有80套课桌椅','场地现有80套课桌椅','我们有80套圆桌'])('离线库存不能成为人数或布置选择：%s',async text=>{
  vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED','0');
  const turn=await resolveBriefTurn(text,initialBriefMemory(),context);
  expect(turn.memory.headcount).toBeNull();expect(turn.memory.layoutModeConfirmed).toBe(false);expect(turn.kind).not.toBe('generate');expect(turn.text).not.toContain('80 人');
 });
 it('库存不能覆盖之前确认的人数或改变已有布置选择',async()=>{
  vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED','0');
  const previous={...initialBriefMemory(),headcount:30,layoutMode:'dining' as const,layoutModeConfirmed:true};
  const turn=await resolveBriefTurn('我们有80套课桌椅',previous,context);
  expect(turn.memory.headcount).toBe(30);expect(turn.memory.layoutMode).toBe('dining');expect(turn.memory.layoutModeConfirmed).toBe(true);
 });
 it('模型把库存套数猜成人数时必须重新说明，不能用一句确认通过',async()=>{
  vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED','1');
  const turn=await resolveBriefTurn('我们有80套课桌椅',initialBriefMemory(),context,{briefExtract:async()=>({enabled:true,extraction:{headcount:80,layoutMode:'desk-chair'}})});
  expect(turn.memory.headcount).toBeNull();expect(turn.memory.layoutModeConfirmed).toBe(false);expect(turn.memory.pendingBasicFacts).toContainEqual({key:'headcount',value:80,requiresRestatement:true});
  const confirmation=await resolveBriefTurn('确认',turn.memory,context);expect(confirmation.memory.headcount).toBeNull();expect(confirmation.kind).toBe('ask');
 });
 it.each(['我们有80把椅子','有12张桌子','有八十把椅子','库存有80个椅子','有24盏灯'])('模型误将物品数量当人数时不能通过确认：%s',async text=>{
  vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED','1');const old={...initialBriefMemory(),headcount:40};
  const turn=await resolveBriefTurn(text,old,context,{briefExtract:async()=>({enabled:true,extraction:{headcount:80}})});
  expect(turn.memory.headcount).toBe(40);expect(turn.memory.pendingBasicFacts).toContainEqual({key:'headcount',value:80,requiresRestatement:true});
  const accepted=await resolveBriefTurn('确认',turn.memory,context);expect(accepted.memory.headcount).toBe(40);expect(accepted.kind).toBe('ask');
 });
 it('同时给出本场人数与库存时，模型正确提取的本场人数可更新',async()=>{
  vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED','1');const old={...initialBriefMemory(),headcount:40};
  const turn=await resolveBriefTurn('这场30人，我们有80把椅子',old,context,{briefExtract:async()=>({enabled:true,extraction:{headcount:30}})});
  expect(turn.memory.headcount).toBe(30);expect(turn.memory.pendingBasicFacts??[]).not.toContainEqual(expect.objectContaining({key:'headcount'}));
 });
 it('同时给出人数与库存时，模型误取库存不会覆盖此前人数',async()=>{
  vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED','1');const old={...initialBriefMemory(),headcount:40};
  const turn=await resolveBriefTurn('这场30人，我们有80把椅子',old,context,{briefExtract:async()=>({enabled:true,extraction:{headcount:80}})});
  expect(turn.memory.headcount).toBe(40);expect(turn.memory.pendingBasicFacts).toContainEqual({key:'headcount',value:80,requiresRestatement:true});
 });
 it('明确人数和选用课桌椅仍可生成',async()=>{
  vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED','0');
  const turn=await resolveBriefTurn('30人，采用课桌椅',initialBriefMemory(),context);
  expect(turn.memory.headcount).toBe(30);expect(turn.memory.layoutMode).toBe('desk-chair');expect(turn.memory.layoutModeConfirmed).toBe(true);expect(turn.kind).toBe('generate');
 });
 it.each(['上一场要签到','上届要舞台','去年所有人都入座'])('历史活动需求不会变成本场要求：%s',async text=>{
  vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED','0');const turn=await resolveBriefTurn(text,initialBriefMemory(),context);
  expect(turn.memory.zoneNeeds.checkin).toBeNull();expect(turn.memory.zoneNeeds.stage).toBeNull();expect(turn.memory.allGuestsSeated).toBeNull();expect(turn.kind).toBe('ask');expect(turn.memory.unresolvedActivityNeeds.length).toBeGreaterThan(0);
 });
 it('模型引用历史要求时保持未知，明确本场要求优先',async()=>{
  vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED','1');
  const text='上一场要签到，这场不需要签到';const turn=await resolveBriefTurn(text,initialBriefMemory(),context,{briefExtract:async()=>({enabled:true,extraction:{activityNeeds:[{kind:'checkin',decision:'needed',evidence:'上一场要签到'},{kind:'checkin',decision:'not_needed',evidence:'这场不需要签到'}]}})});
  expect(turn.memory.unresolvedActivityNeeds).not.toContain('checkin');expect(turn.memory.pendingActivityNeeds).toContainEqual({kind:'checkin',value:false,evidence:'这场不需要签到'});expect(turn.memory.zoneNeeds.checkin).toBeNull();
  const confirmation=await resolveBriefTurn('确认',turn.memory,context);expect(confirmation.memory.zoneNeeds.checkin).toBe(false);
 });
 it('上次的布置不会覆盖本次明确选择，即使模型错误选择旧方案',async()=>{
  vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED','1');const turn=await resolveBriefTurn('上次使用圆桌，这次采用课桌椅，30人',initialBriefMemory(),context,{briefExtract:async()=>({enabled:true,extraction:{headcount:30,layoutMode:'dining'}})});
  expect(turn.memory.layoutMode).toBe('desk-chair');expect(turn.memory.layoutModeConfirmed).toBe(true);expect(turn.memory.headcount).toBe(30);
 });
 it('上次与这次分句中，采用本场明确的全员入座要求',async()=>{
  vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED','0');const turn=await resolveBriefTurn('上次人人都入座，这次人人都入座',initialBriefMemory(),context);
  expect(turn.memory.allGuestsSeated).toBe(true);expect(turn.memory.unresolvedActivityNeeds).not.toContain('all_seated');
 });
 it('本场入座要求相互矛盾时保留未知并追问',async()=>{
  vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED','0');const turn=await resolveBriefTurn('人人都入座，不要求人人都入座',initialBriefMemory(),context);
  expect(turn.memory.allGuestsSeated).toBeNull();expect(turn.memory.unresolvedActivityNeeds).toContain('all_seated');expect(turn.kind).toBe('ask');
 });
 it.each(['0','1'])('不同活动明确报数时采用本场人数（模型开关 %s）',async enabled=>{
  vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED',enabled);const turn=await resolveBriefTurn('上次100人，这次30人，采用课桌椅',initialBriefMemory(),context,{briefExtract:async()=>({enabled:true,extraction:{headcount:30,layoutMode:'desk-chair'}})});
  expect(turn.memory.headcount).toBe(30);expect(turn.memory.pendingBasicFacts??[]).not.toContainEqual(expect.objectContaining({key:'headcount'}));expect(turn.memory.layoutModeConfirmed).toBe(true);
 });
 it('只有上一场人数时不能用确认键将其写为本场人数',async()=>{
  vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED','1');const turn=await resolveBriefTurn('上一场100人',initialBriefMemory(),context,{briefExtract:async()=>({enabled:true,extraction:{headcount:100}})});
  expect(turn.memory.headcount).toBeNull();expect(turn.memory.pendingBasicFacts).toContainEqual({key:'headcount',value:100,requiresRestatement:true});const accepted=await resolveBriefTurn('确认',turn.memory,context);expect(accepted.memory.headcount).toBeNull();
 });
 it('uses only the current statement to determine a wheelchair requirement even if the model says false',async()=>{
  vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED','1');
  const turn=await resolveBriefTurn('需要轮椅通道',initialBriefMemory(),context,{briefExtract:async()=>({enabled:true,extraction:{mobilityAssistance:false}})});
  expect(turn.memory.mobilityRequirement?.decision).toBe('needed');
 });
 it('propagates explicit cancellation rather than silently falling back or retrying',async()=>{
  vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED','1');const controller=new AbortController();let received:AbortSignal|undefined;
  const fetcher=vi.fn((_raw:string,signal?:AbortSignal)=>{received=signal;return new Promise<never>(()=>{});});
  const work=resolveBriefTurn('80人',initialBriefMemory(),context,{briefExtract:fetcher},controller.signal);
  controller.abort();await expect(work).rejects.toMatchObject({name:'AbortError'});expect(received?.aborted).toBe(true);expect(fetcher).toHaveBeenCalledOnce();
 });
 it('reports an unavailable provider while retaining the local fallback',async()=>{
  vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED','1');
  const turn=await resolveBriefTurn('1人',initialBriefMemory(),context,{briefExtract:async()=>({enabled:true,extraction:null,reason:'PROVIDER_HTTP_ERROR:429'})});
  expect(turn.resolution).toBe('unavailable');expect(turn.modelNotice).toContain('请求过多');expect(turn.memory.headcount).toBe(1);
 });
 it('tells the user when a network failure falls back to local rules',async()=>{
  vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED','1');
  const turn=await resolveBriefTurn('1人',initialBriefMemory(),context,{briefExtract:async()=>{throw new Error('network error');}});
  expect(turn.resolution).toBe('failed');expect(turn.modelNotice).toContain('本地规则');expect(turn.memory.headcount).toBe(1);
 });

});
