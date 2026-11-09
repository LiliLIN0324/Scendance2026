import {describe,expect,it,vi} from 'vitest';
import {createApi} from '../supabase/functions/_shared/api.ts';
import {briefConversationResponseSchema,BRIEF_CONVERSATION_PROMPT,parseBriefConversation,parseModelBrief} from '../supabase/functions/_shared/brief-extract-contract.ts';
import type {Backend} from '../supabase/functions/_shared/backend.ts';

const backend={user:vi.fn(async()=> 'fixture-user')} as unknown as Backend;
const settings:Record<string,string>={BRIEF_CONVERSATION_ENABLED:'1',AGENT_CHAT_BASE_URL:'https://model.example/v1',AGENT_CHAT_KEY:'fixture-secret',AGENT_CHAT_MODEL:'fixture'};
const env=(key:string)=>settings[key];
const message='30人，需要签到，再加一张桌子';
const input={responseMode:'conversation_v1',message,history:[{role:'user',text:'我在准备一场讲座'}]};
const output={extraction:{headcount:30,activityNeeds:[{kind:'checkin',decision:'needed',evidence:'需要签到'}]},reply:'我理解需要签到；添加桌子的操作还需另行核对。',unhandled:[{kind:'action',evidence:'加一张桌子'}],factEvidence:[{key:'headcount',evidence:'30人'}]};
const provider=(value:unknown)=>Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(value)}}]});
const request=(body:unknown,auth=true)=>new Request('https://fixture.invalid/brief/extract',{method:'POST',headers:{'Content-Type':'application/json',...(auth?{Authorization:'Bearer fixture'}:{})},body:JSON.stringify(body)});

describe('explicit seating evidence',()=>{
 it('drops inferred layout and all-seated claims without discarding known facts or advice',()=>{
  const raw='为长者办一场室内讲座，预计30人，现有80把椅子；是否签到还没决定。请先给建议，不要改场景。';
  const value={extraction:{event:'讲座',headcount:30,venueIO:'indoor',layoutMode:'desk-chair',inventoryMentions:[{evidence:'80把椅子'}],activityNeeds:[{kind:'checkin',decision:'unknown',evidence:'是否签到还没决定'},{kind:'all_seated',decision:'needed',evidence:'为长者办一场室内讲座'}],requirements:[{key:'layoutMode',value:'desk-chair',mode:'must'}]},reply:'可以先比较讲座椅与课桌椅方案，签到稍后决定。',unhandled:[{kind:'action',evidence:'不要改场景'}],factEvidence:[{key:'event',evidence:'讲座'},{key:'headcount',evidence:'30人'},{key:'venueIO',evidence:'室内'},{key:'layoutMode',evidence:'椅子'}]};
  const result=parseBriefConversation(value,raw);
  expect(result.extraction).toMatchObject({headcount:30,venueIO:'indoor',inventoryMentions:[{evidence:'80把椅子'}],activityNeeds:[{kind:'checkin',decision:'unknown',evidence:'是否签到还没决定'}],requirements:[]});
  expect(result.extraction.layoutMode).toBeUndefined();expect(result.factEvidence.some(row=>row.key==='layoutMode')).toBe(false);expect(result.reply).toBe(value.reply);
 });
 it('retains explicitly chosen classroom seating and all-attendees-seated',()=>{
  const raw='采用课桌椅布局，要求全员落座。';
  const result=parseBriefConversation({extraction:{layoutMode:'desk-chair',activityNeeds:[{kind:'all_seated',decision:'needed',evidence:'全员落座'}]},reply:'先按这项要求讨论。',unhandled:[],factEvidence:[{key:'layoutMode',evidence:'课桌椅布局'}]},raw);
  expect(result.extraction.layoutMode).toBe('desk-chair');expect(result.extraction.activityNeeds).toEqual([{kind:'all_seated',decision:'needed',evidence:'全员落座'}]);
 });
 it.each([['采用圆桌布局',true],['圆桌',true],['圆桌式',true],['现有8张圆桌',false],['为长者办宴请',false]] as const)('distinguishes chosen round tables from inventory or event type: %s', (raw,expected)=>{
  const evidence=raw.includes('圆桌')?'圆桌':'宴请';
  const result=parseBriefConversation({extraction:{layoutMode:'dining'},reply:'可以先讨论。',unhandled:[],factEvidence:[{key:'layoutMode',evidence}]},raw);
  expect(result.extraction.layoutMode).toBe(expected?'dining':undefined);
 });
 it.each(['现有80套课桌椅','不采用课桌椅布局','是否采用课桌椅布局还没决定','可能采用课桌椅布局','可以考虑课桌椅布局','有80套课桌椅按剧院式摆放'])('does not turn ambiguous or negative layout language into a choice: %s',raw=>{
  const result=parseBriefConversation({extraction:{layoutMode:'desk-chair'},reply:'可以继续讨论。',unhandled:[],factEvidence:[{key:'layoutMode',evidence:'课桌椅'}]},raw);
  expect(result.extraction.layoutMode).toBeUndefined();expect(result.factEvidence).toEqual([]);
 });
 it.each(['不要全员落座','全员是否落座还没决定','不安排所有人坐下','不一定全员落座'])('does not turn a denial or open question into mandatory seating: %s',raw=>{
  const evidence=raw.includes('全员')?'全员':'所有人';
  const full=raw.includes('全员')?(raw.includes('落座')?raw.slice(raw.indexOf(evidence),raw.indexOf('落座')+2):raw):'所有人坐下';
  const result=parseBriefConversation({extraction:{activityNeeds:[{kind:'all_seated',decision:'needed',evidence:full}]},reply:'可以继续讨论。',unhandled:[],factEvidence:[]},raw);
  expect(result.extraction.activityNeeds).toEqual([]);
 });
 it('retains the explicitly selected layout after correcting a different alternative',()=>{
  const raw='不排圆桌改用课桌椅';
  const result=parseBriefConversation({extraction:{layoutMode:'desk-chair'},reply:'先按课桌椅讨论。',unhandled:[],factEvidence:[{key:'layoutMode',evidence:'课桌椅'}]},raw);
  expect(result.extraction.layoutMode).toBe('desk-chair');
 });
 it('distinguishes an explicit absence of a seating requirement from an unavailable capacity',()=>{
  const parse=(raw:string,evidence:string)=>parseBriefConversation({extraction:{activityNeeds:[{kind:'all_seated',decision:'not_needed',evidence}]},reply:'可以继续讨论。',unhandled:[],factEvidence:[]},raw).extraction.activityNeeds;
  expect(parse('不要求全员落座','全员落座')).toHaveLength(1);
  expect(parse('无法让全员落座','全员落座')).toEqual([]);
  expect(parse('现在不是所有人都有座','所有人都有座')).toEqual([]);
 });
 it('still rejects fabricated evidence instead of silently dropping it',()=>{
  expect(()=>parseBriefConversation({extraction:{layoutMode:'desk-chair'},reply:'可以讨论。',unhandled:[],factEvidence:[{key:'layoutMode',evidence:'课桌椅'}]},'有80把椅子')).toThrow('MODEL_EVIDENCE_MISMATCH');
 });
 it('keeps the legacy extractor conservative without changing other validated fields',()=>{
  const raw='为长者办讲座，预计30人，现有80把椅子';
  const result=parseModelBrief({headcount:30,layoutMode:'desk-chair',inventoryMentions:[{evidence:'80把椅子'}],activityNeeds:[{kind:'all_seated',decision:'needed',evidence:'为长者办讲座'}]},raw);
  expect(result).toMatchObject({headcount:30,inventoryMentions:[{evidence:'80把椅子'}],activityNeeds:[]});expect(result.layoutMode).toBeUndefined();
  expect(parseModelBrief({layoutMode:'desk-chair'},'采用课桌椅布局').layoutMode).toBe('desk-chair');
 });
 it('returns the remaining information through the API with one provider call',async()=>{
  const raw='为长者办一场室内讲座，预计30人，现有80把椅子；是否签到还没决定。请先给建议，不要改场景。';
  const model={extraction:{headcount:30,venueIO:'indoor',layoutMode:'desk-chair',inventoryMentions:[{evidence:'80把椅子'}],activityNeeds:[{kind:'checkin',decision:'unknown',evidence:'是否签到还没决定'},{kind:'all_seated',decision:'needed',evidence:'为长者办一场室内讲座'}]},reply:'可以先比较不同座椅布局。',unhandled:[],factEvidence:[{key:'headcount',evidence:'30人'},{key:'venueIO',evidence:'室内'},{key:'layoutMode',evidence:'椅子'}]};
  const fetcher=vi.fn<typeof fetch>().mockResolvedValue(provider(model));
  const response=await createApi(backend,env,fetcher)(request({responseMode:'conversation_v1',message:raw,history:[]}));const result=await response.json();
  expect(result.enabled).toBe(true);expect(result.extraction).toMatchObject({headcount:30,venueIO:'indoor',inventoryMentions:[{evidence:'80把椅子'}],activityNeeds:[{kind:'checkin',decision:'unknown',evidence:'是否签到还没决定'}]});
  expect(result.extraction.layoutMode).toBeUndefined();expect(result.reply).toBe(model.reply);expect(fetcher).toHaveBeenCalledOnce();
 });
});

describe('single-call conversation_v1 extraction',()=>{
 it('uses the product namespace instead of the old MiniMax profile and fails closed if incomplete',async()=>{
  const config:Record<string,string>={...settings,AGENT_CHAT_PROFILE:'minimax',BAILIAN_PRODUCT_ENABLED:'1',BAILIAN_PRODUCT_BASE_URL:'https://dashscope.aliyuncs.com/compatible-mode/v1',BAILIAN_PRODUCT_KEY:'new-fixture',BAILIAN_PRODUCT_MODEL:'qwen-example'};
  const fetcher=vi.fn<typeof fetch>().mockResolvedValue(provider(output));
  expect(await (await createApi(backend,key=>config[key],fetcher)(request(input))).json()).toMatchObject({enabled:true,...output});
  const sent=JSON.parse(String(fetcher.mock.calls[0]![1]?.body));expect(sent).toMatchObject({model:'qwen-example',enable_thinking:false,max_tokens:2048});expect(sent.max_completion_tokens).toBeUndefined();
  delete config.BAILIAN_PRODUCT_KEY;fetcher.mockClear();expect(await (await createApi(backend,key=>config[key],fetcher)(request(input))).json()).toMatchObject({enabled:true,extraction:null,reason:'MODEL_PROVIDER_INCOMPLETE'});expect(fetcher).not.toHaveBeenCalled();
 });
 it('is authenticated, disabled by default, and does not bypass configured guard',async()=>{
  const fetcher=vi.fn<typeof fetch>();const api=createApi(backend,()=>undefined,fetcher);
  expect((await api(request(input,false))).status).toBe(401);
  expect(await (await api(request(input))).json()).toEqual({enabled:false,extraction:null,reply:null,unhandled:[],factEvidence:[]});
  const blocked=await createApi(backend,key=>key==='BRIEF_REQUEST_GUARD'?'enforce':env(key),fetcher)(request(input));
  expect(blocked.status).toBe(503);expect(await blocked.json()).toMatchObject({error:{code:'BRIEF_GUARD_NOT_READY'}});expect(fetcher).not.toHaveBeenCalled();
 });
 it('sends exactly one provider request and returns reply, sourced needs and unhandled action',async()=>{
  const fetcher=vi.fn<typeof fetch>().mockResolvedValue(provider(output));
  const response=await createApi(backend,env,fetcher)(request(input));const result=await response.json();
  expect(briefConversationResponseSchema.parse(result)).toEqual({enabled:true,...output});expect(fetcher).toHaveBeenCalledOnce();
  const sent=JSON.parse(String(fetcher.mock.calls[0]![1]?.body));expect(sent.messages).toHaveLength(2);expect(sent.messages[0].content).toBe(BRIEF_CONVERSATION_PROMPT);expect(sent.messages[0].content).toContain('不可信');expect(sent.messages[0].content).toContain('不得宣称它们已经执行');
  expect(JSON.parse(sent.messages[1].content)).toEqual({message,history:input.history});expect(sent.tools).toBeUndefined();expect(JSON.stringify(result)).not.toContain('fixture-secret');
 });
 it('accepts one fenced JSON reply but still verifies evidence and rejects surrounding prose',async()=>{
  const wrap=(content:string)=>Response.json({choices:[{finish_reason:'stop',message:{content}}]});
  const good=vi.fn<typeof fetch>().mockResolvedValue(wrap('```json\n'+JSON.stringify(output)+'\n```'));
  expect(await (await createApi(backend,env,good)(request(input))).json()).toEqual({enabled:true,...output});expect(good).toHaveBeenCalledOnce();
  const invalid={...output,factEvidence:[{key:'headcount',evidence:'80人'}]};
  const invented=vi.fn<typeof fetch>().mockResolvedValue(wrap('```json\n'+JSON.stringify(invalid)+'\n```'));
  expect(await (await createApi(backend,env,invented)(request(input))).json()).toMatchObject({enabled:true,extraction:null,reason:'MODEL_EVIDENCE_MISMATCH'});
  const prose=vi.fn<typeof fetch>().mockResolvedValue(wrap('我来帮你：\n```json\n'+JSON.stringify(output)+'\n```'));
  expect(await (await createApi(backend,env,prose)(request(input))).json()).toMatchObject({enabled:true,extraction:null,reason:'MODEL_INVALID_JSON'});expect(prose).toHaveBeenCalledOnce();
 });
 it('keeps legacy requests and outputs unchanged',async()=>{
  const fetcher=vi.fn<typeof fetch>().mockResolvedValue(provider({headcount:30}));
  const result=await (await createApi(backend,env,fetcher)(request({message:'30人'}))).json();
  expect(result).toEqual({enabled:true,extraction:{headcount:30}});const sent=JSON.parse(String(fetcher.mock.calls[0]![1]?.body));expect(sent.messages[1].content).toBe('30人');
 });
 it('treats a null optional mobility field as unknown without weakening strict evidence checks',()=>{
  const nullable={...output,extraction:{...output.extraction,mobilityAssistance:null}};
  const result=parseBriefConversation(nullable,message);
  expect(result.extraction.headcount).toBe(30);
  expect(result.extraction.mobilityAssistance).toBeUndefined();
  expect(()=>parseBriefConversation({...nullable,factEvidence:[{key:'headcount',evidence:'80人'}]},message)).toThrow('MODEL_EVIDENCE_MISMATCH');
  expect(()=>parseBriefConversation({...nullable,extraction:{...nullable.extraction,extra:'unexpected'}},message)).toThrow();
  const explicit={extraction:{mobilityAssistance:false},reply:'已记录。',unhandled:[],factEvidence:[{key:'mobilityAssistance',evidence:'不需要轮椅'}]};
  expect(parseBriefConversation(explicit,'本次不需要轮椅').extraction.mobilityAssistance).toBe(false);
  expect(()=>parseBriefConversation({...nullable,factEvidence:[...output.factEvidence,{key:'mobilityAssistance',evidence:'需要签到'}]},message)).toThrow('MODEL_EVIDENCE_MISMATCH');
 });
 it('keeps unknown explicit and lets users explore rather than re-asking the same item',async()=>{
  const raw='签到还没定';const value={extraction:{activityNeeds:[{kind:'checkin',decision:'unknown',evidence:raw}]},reply:'签到暂时保留待定，可以先用可修改的假设探索。',unhandled:[],factEvidence:[]};
  const fetcher=vi.fn<typeof fetch>().mockResolvedValue(provider(value));const result=await (await createApi(backend,env,fetcher)(request({...input,message:raw}))).json();
  expect(result).toEqual({enabled:true,...value});expect(BRIEF_CONVERSATION_PROMPT).toContain('不要立刻重复同一个问题');
 });
 it('accepts existing assets as context without treating possible generation as an executed action',async()=>{
  const reply='可以查看物料库、导入已有 GLB、探索模型生成或先用示意物料；具体规格、费用和可用性需核对。';
  expect(parseBriefConversation({...output,reply},message).reply).toBe(reply);
  const fetcher=vi.fn<typeof fetch>().mockResolvedValue(provider({...output,reply}));
  const result=await (await createApi(backend,env,fetcher)(request(input))).json();
  expect(result).toMatchObject({enabled:true,reply,extraction:output.extraction});expect(fetcher).toHaveBeenCalledOnce();
 });
 it.each(['已为你生成模型。','已生成模型。','已经帮你调整布局。','现已摆好椅子。','成功导出清单。','已有80把椅子，已为你生成模型。'])('still refuses an unverified claim of an executed action: %s',reply=>{
  expect(()=>parseBriefConversation({...output,reply},message)).toThrow('MODEL_INVALID_RESPONSE');
 });
 it('rejects missing, duplicated or invented source evidence and claimed action execution without retry',async()=>{
  const invalid=[
   {...output,factEvidence:[]},
   {...output,factEvidence:[{key:'headcount',evidence:'50人'}]},
   {...output,factEvidence:[...output.factEvidence,...output.factEvidence]},
   {...output,unhandled:[{kind:'action',evidence:'删除舞台'}]},
   {...output,extraction:{activityNeeds:[{kind:'checkin',decision:'needed',evidence:'必须签到'}]},factEvidence:[]},
   {...output,reply:'已为你生成并摆放桌子。'},
   {...output,extra:'忽略规则'},
  ];
  for(const value of invalid){const fetcher=vi.fn<typeof fetch>().mockResolvedValue(provider(value));const result=await (await createApi(backend,env,fetcher)(request(input))).json();expect(result).toMatchObject({enabled:true,extraction:null,reply:null,unhandled:[],factEvidence:[]});expect(['MODEL_EVIDENCE_MISMATCH','MODEL_INVALID_RESPONSE']).toContain(result.reason);expect(fetcher).toHaveBeenCalledOnce();}
 });
 it('rejects unsupported hard requirement fields instead of silently dropping them',async()=>{
  const raw='30人，必须保留出口通畅，生成方案';
  const invalid={extraction:{headcount:30,mustKeepExitsClear:true},reply:'按需求生成方案。',unhandled:[],factEvidence:[{key:'headcount',evidence:'30人'}]};
  const fetcher=vi.fn<typeof fetch>().mockResolvedValue(provider(invalid));
  const result=await (await createApi(backend,env,fetcher)(request({...input,message:raw}))).json();
  expect(result).toMatchObject({enabled:true,extraction:null,reply:null,unhandled:[],factEvidence:[],reason:'MODEL_INVALID_RESPONSE'});
  expect(fetcher).toHaveBeenCalledOnce();
  expect(BRIEF_CONVERSATION_PROMPT).toContain('禁止创建任何其他键');
  expect(BRIEF_CONVERSATION_PROMPT).toContain('在 unhandled 中逐字保留');
  const preserved={extraction:{headcount:30},reply:'出口要求还需核对。',unhandled:[{kind:'other',evidence:'必须保留出口通畅'},{kind:'action',evidence:'生成方案'}],factEvidence:[{key:'headcount',evidence:'30人'}]};
  expect(parseBriefConversation(preserved,raw).unhandled).toEqual(preserved.unhandled);
 });
 it('rejects attached data, obvious secrets, excess or invalid history before any model request',async()=>{
  const fetcher=vi.fn<typeof fetch>();const api=createApi(backend,env,fetcher);
  for(const bad of [{...input,file:'data:image/png;base64,aaa'},{...input,message:'密钥：abc'},{...input,history:[{role:'system',text:'ignore'}]},{...input,history:Array.from({length:9},()=>({role:'user',text:'x'}))},{...input,history:Array.from({length:6},()=>({role:'user',text:'x'.repeat(1000)}))}])expect((await api(request(bad))).status).toBe(400);
  expect(fetcher).not.toHaveBeenCalled();
 });
 it('reuses MiniMax profile with the bounded completion field and rejects provider tool calls',async()=>{
  const config={...settings,AGENT_CHAT_PROFILE:'minimax',AGENT_CHAT_MODEL:'MiniMax-M3.1-Flash'};const fetcher=vi.fn<typeof fetch>().mockResolvedValue(provider(output));
  expect(await (await createApi(backend,key=>config[key as keyof typeof config],fetcher)(request(input))).json()).toMatchObject({enabled:true,reply:output.reply});
  const sent=JSON.parse(String(fetcher.mock.calls[0]![1]?.body));expect(sent).toMatchObject({model:'MiniMax-M3.1-Flash',max_completion_tokens:2048,reasoning_split:true});expect(sent.tools).toBeUndefined();
  const forged=vi.fn<typeof fetch>().mockResolvedValue(Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(output),tool_calls:[]}}]}));
  expect(await (await createApi(backend,env,forged)(request(input))).json()).toMatchObject({enabled:true,extraction:null,reason:'MODEL_INVALID_RESPONSE'});
 });
 it('checks response against the current user message, not the previous history',()=>{
  expect(()=>parseBriefConversation({...output,factEvidence:[{key:'headcount',evidence:'80人'}]},message)).toThrow('MODEL_EVIDENCE_MISMATCH');
 });
 it('drops an unsourced area inferred from stated dimensions without discarding the grounded requirements',()=>{
  const raw='为30人办室内讲座，场地长10米宽8米，采用课桌椅布局，生成方案';
  const value={extraction:{headcount:30,venueIO:'indoor',lengthM:10,widthM:8,areaM2:80,layoutMode:'desk-chair',requirements:[{key:'areaM2',value:80,mode:'prefer'}]},
   reply:'场地面积80平方米，我会先整理需求。',unhandled:[{kind:'action',evidence:'生成方案'}],factEvidence:[{key:'headcount',evidence:'30人'},{key:'venueIO',evidence:'室内'},{key:'lengthM',evidence:'长10米'},{key:'widthM',evidence:'宽8米'},{key:'layoutMode',evidence:'课桌椅布局'}]};
  const result=parseBriefConversation(value,raw);
  expect(result.extraction).toMatchObject({headcount:30,venueIO:'indoor',lengthM:10,widthM:8,layoutMode:'desk-chair',requirements:[]});
  expect(result.extraction.areaM2).toBeUndefined();expect(result.factEvidence.some(row=>row.key==='areaM2')).toBe(false);
  expect(result.unhandled).toEqual(value.unhandled);expect(result.reply).not.toContain('80');expect(result.reply).toContain('仍需核验');
  const conversational=parseBriefConversation({...value,reply:'我会先整理活动需求。'},raw);
  expect(conversational.reply).toBe('我会先整理活动需求。');
  // An invented quotation, a different claimed area, and unsupported dimensions
  // are not repaired or silently accepted by this narrow degradation.
  expect(()=>parseBriefConversation({...value,factEvidence:[...value.factEvidence,{key:'areaM2',evidence:'面积80平米'}]},raw)).toThrow('MODEL_EVIDENCE_MISMATCH');
  expect(()=>parseBriefConversation({...value,extraction:{...value.extraction,areaM2:90,requirements:[]}},raw)).toThrow('MODEL_EVIDENCE_MISMATCH');
  expect(()=>parseBriefConversation({...value,factEvidence:value.factEvidence.filter(row=>row.key!=='widthM')},raw)).toThrow('MODEL_EVIDENCE_MISMATCH');
 });
 it('rejects a contradicted or ambiguous Arabic-digit attendance claim without conflating furniture counts',()=>{
  const result=(text:string,evidence:string,count:number)=>parseBriefConversation({extraction:{headcount:count},reply:'先梳理需求。',unhandled:[],factEvidence:[{key:'headcount',evidence}]},text);
  expect(result('为30人办活动，已有80把椅子','30人',30).extraction.headcount).toBe(30);
  expect(result('预计30人左右','30人',30).extraction.headcount).toBe(30);
  expect(()=>result('为30人办活动','30人',99)).toThrow('MODEL_EVIDENCE_MISMATCH');
  expect(()=>result('不超过30人','30人',30)).toThrow('MODEL_EVIDENCE_MISMATCH');
  expect(()=>result('不是30人','30人',30)).toThrow('MODEL_EVIDENCE_MISMATCH');
  expect(()=>result('约30至40人','40人',40)).toThrow('MODEL_EVIDENCE_MISMATCH');
  expect(()=>result('30人到40人','30人',30)).toThrow('MODEL_EVIDENCE_MISMATCH');
  expect(()=>result('30人或40人','30人或40人',30)).toThrow('MODEL_EVIDENCE_MISMATCH');
  // Complex Chinese numerals are intentionally not parsed as Arabic digits.
  expect(result('为一百二十三人办活动','一百二十三人',123).extraction.headcount).toBe(123);
  expect(()=>result('为三十余人办活动','三十余人',30)).toThrow('MODEL_EVIDENCE_MISMATCH');
 });
 it('returns only current-turn material search terms with literal evidence and does not add them to legacy output',async()=>{
  const value={...output,materialQueries:[{query:'桌子',evidence:'加一张桌子'}]};
  const fetcher=vi.fn<typeof fetch>().mockResolvedValue(provider(value));const result=await (await createApi(backend,env,fetcher)(request(input))).json();
  expect(result).toEqual({enabled:true,...value});expect(briefConversationResponseSchema.parse(result)).toEqual(result);expect(fetcher).toHaveBeenCalledOnce();
  const legacy=vi.fn<typeof fetch>().mockResolvedValue(provider({headcount:30}));
  expect(await (await createApi(backend,env,legacy)(request({message:'30人'}))).json()).toEqual({enabled:true,extraction:{headcount:30}});
 });
 it('rejects invented terms, unsupported evidence, duplicate queries and excess material queries',async()=>{
  const invalid=[
   [{query:'椅子',evidence:'加一张桌子'}],
   [{query:'椅子',evidence:'需要椅子'}],
   [{query:'桌子',evidence:'加一张桌子'},{query:'桌子',evidence:'一张桌子'}],
   Array.from({length:4},()=>({query:'桌子',evidence:'加一张桌子'})),
   [{query:'',evidence:'加一张桌子'}],
   [{query:'桌子'.repeat(21),evidence:'加一张桌子'}],
   [{query:'桌子',evidence:'加一张桌子',price:0}],
  ];
  for(const materialQueries of invalid){
   const fetcher=vi.fn<typeof fetch>().mockResolvedValue(provider({...output,materialQueries}));
   const result=await (await createApi(backend,env,fetcher)(request(input))).json();
   expect(result).toMatchObject({enabled:true,extraction:null,reply:null,unhandled:[],factEvidence:[]});expect(['MODEL_EVIDENCE_MISMATCH','MODEL_INVALID_RESPONSE']).toContain(result.reason);expect(fetcher).toHaveBeenCalledOnce();
  }
  expect(()=>parseBriefConversation({...output,materialQueries:[{query:'椅子',evidence:'椅子'}]},message)).toThrow('MODEL_EVIDENCE_MISMATCH');
 });
 it('does not accept material results in a failed response and allows older success without the field',()=>{
  expect(briefConversationResponseSchema.safeParse({enabled:false,extraction:null,reply:null,unhandled:[],factEvidence:[],materialQueries:[{query:'桌子',evidence:'桌子'}]}).success).toBe(false);
  expect(briefConversationResponseSchema.parse({enabled:true,...output})).toEqual({enabled:true,...output});
  expect(BRIEF_CONVERSATION_PROMPT).toContain('不推断真实库存');
  expect(BRIEF_CONVERSATION_PROMPT).toContain('query 必须是 evidence 的原样子串');
 });
});
