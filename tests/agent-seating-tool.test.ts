import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {createApi} from '../supabase/functions/_shared/api.ts';
import {agentRunRequestSchema,agentRunSchema} from '../supabase/functions/_shared/agent-contract.ts';
import {chair,database,owner,scene,session,studio} from './fixtures.ts';
import {createChatTrialProvider} from '../scripts/local-chat-trial-provider.ts';

const settings:Record<string,string>={AGENT_CHAT_PROFILE:'minimax',MINIMAX_AGENT_TOOLS_ENABLED:'1',AGENT_CHAT_BASE_URL:'https://api.minimax.cn/v1',AGENT_CHAT_KEY:'fixture',AGENT_CHAT_MODEL:'MiniMax-M3.1-Flash'};
const tool=(id:string,name:string,args:unknown)=>({id,type:'function',index:0,function:{name,arguments:JSON.stringify(args)}});
const reply=(calls:ReturnType<typeof tool>[])=>Response.json({base_resp:{status_code:0},choices:[{finish_reason:'tool_calls',message:{role:'assistant',content:null,tool_calls:calls}}]});
const request={layout:'one_desk_one_chair',count:30,deskSize:{width:0.5,depth:0.5,height:0.75},chairSize:{width:0.5,depth:0.5,height:0.85},deskChairGap:0.1,columnGap:0.2,rowGap:0.2,edgeClearance:0.2};
const empty={title:'不修改',explanation:'需要进一步核验。',commands:[]};

describe('agent seating preview handles',()=>{
 let f:Awaited<ReturnType<typeof database>>;
 beforeAll(async()=>{f=await database();},30000);afterAll(async()=>{await f.db.close();});
 async function setup(withChair=false,selected=false){
  const initial=scene(),original=chair();original.locked=true;original.position={x:10,z:9};if(withChair)initial.objects.push(original);
  const project=await f.rpc(owner,'projects.create',{studioId:studio,name:'Seat test',scene:initial}),lease=await f.rpc(owner,'lease.acquire',{projectId:project.id,sessionId:session});
  const input=agentRunRequestSchema.parse({requestId:crypto.randomUUID(),sessionId:session,generation:lease.generation,expectedRevision:0,localRevision:0,scene:initial,selectedIds:selected?[original.id]:[],instruction:'预览30套一桌一椅，保留已有物件',executionMode:'preview'});
  return {initial,original,project,input};
 }
 async function send(i:Awaited<ReturnType<typeof setup>>,fetcher:typeof fetch){
  const response=await createApi(f.backend,key=>settings[key],fetcher)(new Request(`https://api.test/projects/${i.project.id}/agent-runs`,{method:'POST',headers:{authorization:`Bearer ${owner}`,'content-type':'application/json'},body:JSON.stringify(i.input)}));
  expect(response.status).toBe(202);return agentRunSchema.parse(await response.json());
 }
 it('keeps a cross-turn two-people-per-desk requirement and marks ordinary candidates unverified',async()=>{
  const i=await setup();
  i.input.instruction='为本场活动出方案。用户原话："每2人一桌"';
  i.input.context.seatingAllocation={status:'shared_desk',peoplePerDesk:2,evidence:'每2人一桌',source:'user'};
  let conflict='',exposed:unknown;
  const fetcher=vi.fn(async(_url:RequestInfo|URL,init?:RequestInit)=>{
   const messages=JSON.parse(String(init?.body)).messages;
   if(fetcher.mock.calls.length===1){exposed=JSON.parse(messages[1].content).context.seatingAllocation;return reply([tool('prepare','prepare_seating_candidate',{...request,count:2})]);}
   const result=JSON.parse(messages.filter((m:{role:string})=>m.role==='tool').at(-1).content);conflict=result.code;
   return reply([tool('submit','submit_candidates',{candidates:[{title:'普通候选',explanation:'配比仍待核验。',commands:[{op:'add',materialId:'chair',position:{x:4,z:4},rotation:0,color:'#ffffff'}]}]})]);
  });
  const run=await send(i,fetcher);expect(exposed).toMatchObject({status:'shared_desk',peoplePerDesk:2});expect(conflict).toBe('SEATING_ALLOCATION_CONFLICT');
  expect(run.state).toBe('complete');expect(run.candidates[0]!.proposal.warnings).toContainEqual({code:'SEATING_ALLOCATION_UNVERIFIED',ids:[]});
 });
 it('downgrades unsupported evidence to unknown and rejects a fabricated one-person ratio',async()=>{
  const i=await setup();i.input.instruction='请生成方案';
  i.input.context={brief:'',acceptedDecisions:[],recentMessages:[{role:'assistant',text:'每人一桌'}],seatingAllocation:{status:'one_per_desk',peoplePerDesk:1,evidence:'每人一桌',source:'user'}};
  let status='',source='',error='';const fetcher=vi.fn(async(_url:RequestInfo|URL,init?:RequestInit)=>{
   const messages=JSON.parse(String(init?.body)).messages;
   if(fetcher.mock.calls.length===1){const allocation=JSON.parse(messages[1].content).context.seatingAllocation;status=allocation.status;source=allocation.source;return reply([tool('prepare','prepare_seating_candidate',{...request,count:1})]);}
   error=JSON.parse(messages.filter((m:{role:string})=>m.role==='tool').at(-1).content).code;return reply([tool('submit','submit_candidates',{candidates:[empty]})]);
  });
  await send(i,fetcher);expect(status).toBe('unknown');expect(source).toBe('unverified');expect(error).toBe('SEATING_ALLOCATION_UNCONFIRMED');
 });
 it.each([
  {instruction:'每2人一桌',evidence:'每2人一桌'},
  {instruction:'不要一人一桌',evidence:'一人一桌'},
  {instruction:'不确定是否一人一桌',evidence:'不确定是否一人一桌'},
 ])('does not accept a claimed one-person ratio from contradictory or cropped evidence',async({instruction,evidence})=>{
  const i=await setup();i.input.instruction=instruction;
  i.input.context.seatingAllocation={status:'one_per_desk',peoplePerDesk:1,evidence,source:'user'};
  let error='';const fetcher=vi.fn(async(_url:RequestInfo|URL,init?:RequestInit)=>{
   if(fetcher.mock.calls.length===1)return reply([tool('prepare','prepare_seating_candidate',{...request,count:1})]);
   const messages=JSON.parse(String(init?.body)).messages;error=JSON.parse(messages.filter((m:{role:string})=>m.role==='tool').at(-1).content).code;
   return reply([tool('submit','submit_candidates',{candidates:[empty]})]);
  });
  await send(i,fetcher);expect(error).toBe('SEATING_ALLOCATION_UNCONFIRMED');
 });
 it('accepts JSON-escaped quoted user evidence without downgrading',async()=>{
  const i=await setup(),evidence='“一人一桌”\n请保留';i.input.instruction=`用户原话：${JSON.stringify(evidence)}`;
  i.input.context.seatingAllocation={status:'one_per_desk',peoplePerDesk:1,evidence,source:'user'};
  let receipt:Record<string,unknown>={};const fetcher=vi.fn(async(_url:RequestInfo|URL,init?:RequestInit)=>{
   const messages=JSON.parse(String(init?.body)).messages;
   if(fetcher.mock.calls.length===1)return reply([tool('prepare','prepare_seating_candidate',{...request,count:1})]);
   receipt=JSON.parse(messages.filter((m:{role:string})=>m.role==='tool').at(-1).content);return reply([tool('submit','submit_candidates',{candidates:[{preparedId:receipt.preparedId}]})]);
  });
  const run=await send(i,fetcher);expect(receipt).toMatchObject({requested:1,placed:1});expect(run.state).toBe('complete');expect(run.candidates[0]!.proposal.explanation).not.toContain('用户未明确指定');
 });
 it('labels one-per-desk as an assumption when the user supplied no allocation',async()=>{
  const i=await setup();i.input.instruction='探索课桌配椅';let summary='',nextSteps:string[]|undefined;
  const fetcher=vi.fn(async(_url:RequestInfo|URL,init?:RequestInit)=>{
   if(fetcher.mock.calls.length===1)return reply([tool('prepare','prepare_seating_candidate',{...request,count:1})]);
   const messages=JSON.parse(String(init?.body)).messages,result=JSON.parse(messages.filter((m:{role:string})=>m.role==='tool').at(-1).content);summary=result.summary;nextSteps=result.nextSteps;
   return reply([tool('submit','submit_candidates',{candidates:[{preparedId:result.preparedId}]})]);
  });
  const run=await send(i,fetcher);expect(summary).toContain('一人一桌为本次探索假设，用户未明确指定');expect(run.candidates[0]!.proposal.explanation).toContain('用户未明确指定');expect(nextSteps).toEqual([]);expect(summary).not.toContain('可考虑：');
 });
 it.each([
  {instruction:'30人，每2人一桌',recentMessages:[]},
  {instruction:'换一版',recentMessages:[{role:'user' as const,text:'每2人一桌'}]},
  {instruction:'换一版\n\n对话中识别的信息（请结合原话核对，未提及的信息不要猜）：课桌配椅',recentMessages:[{role:'user' as const,text:'每2人一桌'}]},
 ])('honors an explicitly stated ratio from an older client without the structured field',async value=>{
  const i=await setup();i.input.instruction=value.instruction;i.input.context.recentMessages=value.recentMessages;
  let error='';const fetcher=vi.fn(async(_url:RequestInfo|URL,init?:RequestInit)=>{
   if(fetcher.mock.calls.length===1)return reply([tool('prepare','prepare_seating_candidate',{...request,count:1})]);
   const messages=JSON.parse(String(init?.body)).messages;error=JSON.parse(messages.filter((m:{role:string})=>m.role==='tool').at(-1).content).code;
   return reply([tool('submit','submit_candidates',{candidates:[empty]})]);
  });
  await send(i,fetcher);expect(error).toBe('SEATING_ALLOCATION_CONFLICT');
 });
 it('does not attribute assistant-only legacy history to the user',async()=>{
  const i=await setup();i.input.instruction='探索课桌配椅';i.input.context.recentMessages=[{role:'assistant',text:'每2人一桌'}];let summary='';
  const fetcher=vi.fn(async(_url:RequestInfo|URL,init?:RequestInit)=>{
   if(fetcher.mock.calls.length===1)return reply([tool('prepare','prepare_seating_candidate',{...request,count:1})]);
   const messages=JSON.parse(String(init?.body)).messages,result=JSON.parse(messages.filter((m:{role:string})=>m.role==='tool').at(-1).content);summary=result.summary;
   return reply([tool('submit','submit_candidates',{candidates:[{preparedId:result.preparedId}]})]);
  });
  const run=await send(i,fetcher);expect(summary).toContain('用户未明确指定');expect(run.state).toBe('complete');
 });
 it('keeps an explicit unresolved ratio unknown for an older client',async()=>{
  const i=await setup();i.input.instruction='每桌人数还没确定';let error='';
  const fetcher=vi.fn(async(_url:RequestInfo|URL,init?:RequestInit)=>{
   if(fetcher.mock.calls.length===1)return reply([tool('prepare','prepare_seating_candidate',{...request,count:1})]);
   const messages=JSON.parse(String(init?.body)).messages;error=JSON.parse(messages.filter((m:{role:string})=>m.role==='tool').at(-1).content).code;
   return reply([tool('submit','submit_candidates',{candidates:[empty]})]);
  });
  await send(i,fetcher);expect(error).toBe('SEATING_ALLOCATION_UNCONFIRMED');
 });
 it('does not turn a previous event’s ratio into a current hard requirement',async()=>{
  const i=await setup();i.input.instruction='今年探索课桌配椅';i.input.context.recentMessages=[{role:'user',text:'去年每2人一桌'}];let summary='';
  const fetcher=vi.fn(async(_url:RequestInfo|URL,init?:RequestInit)=>{
   if(fetcher.mock.calls.length===1)return reply([tool('prepare','prepare_seating_candidate',{...request,count:1})]);
   const messages=JSON.parse(String(init?.body)).messages,result=JSON.parse(messages.filter((m:{role:string})=>m.role==='tool').at(-1).content);summary=result.summary;
   return reply([tool('submit','submit_candidates',{candidates:[{preparedId:result.preparedId}]})]);
  });
  const run=await send(i,fetcher);expect(run.state).toBe('complete');expect(summary).toContain('用户未明确指定');
 });
 it('treats an unmarked multiline instruction as unverified rather than the user’s choice',async()=>{
  const i=await setup();i.input.instruction='模型建议：\n每2人一桌';let allocation:unknown,error='';
  const fetcher=vi.fn(async(_url:RequestInfo|URL,init?:RequestInit)=>{
   const messages=JSON.parse(String(init?.body)).messages;
   if(fetcher.mock.calls.length===1){allocation=JSON.parse(messages[1].content).context.seatingAllocation;return reply([tool('prepare','prepare_seating_candidate',{...request,count:1})]);}
   error=JSON.parse(messages.filter((m:{role:string})=>m.role==='tool').at(-1).content).code;
   return reply([tool('submit','submit_candidates',{candidates:[empty]})]);
  });
  await send(i,fetcher);expect(allocation).toMatchObject({status:'unknown',source:'unverified'});expect(error).toBe('SEATING_ALLOCATION_UNCONFIRMED');
 });
 it('rejects contradictory structured allocation values and non-user sources',()=>{
  const base={...agentRunRequestSchema.parse({requestId:crypto.randomUUID(),sessionId:session,generation:1,expectedRevision:0,localRevision:0,scene:scene(),selectedIds:[],instruction:'探索桌椅',executionMode:'preview'})};
  for(const value of [
   {status:'one_per_desk',peoplePerDesk:2,evidence:'每人一桌',source:'user'},
   {status:'shared_desk',peoplePerDesk:1,evidence:'两人一桌',source:'user'},
   {status:'unknown',peoplePerDesk:2,evidence:'不确定',source:'user'},
   {status:'one_per_desk',peoplePerDesk:1,evidence:'每人一桌',source:'model'},
  ])expect(agentRunRequestSchema.safeParse({...base,context:{...base.context,seatingAllocation:value}}).success).toBe(false);
 });
 it('preserves the base, reports the true 50-object cap, rejects handle tampering and stores only a preview',async()=>{
  const i=await setup(true);let receipt:{preparedId:string;requested:number;placed:number;shortfall:number;limitReason:string;unknown:string[];nextSteps:string[]} | undefined;
  let rejected=0;
  const fetcher=vi.fn(async(_url:RequestInfo|URL,init?:RequestInit)=>{
   const body=JSON.parse(String(init?.body)),messages=body.messages as Array<{role:string;content:string}>;
   if(fetcher.mock.calls.length===1){expect(body.tools.map((entry:{function:{name:string}})=>entry.function.name)).toContain('prepare_seating_candidate');return reply([tool('prepare','prepare_seating_candidate',request)]);}
   if(fetcher.mock.calls.length===2){receipt=JSON.parse(messages.filter(message=>message.role==='tool').at(-1)!.content);return reply([tool('alter','submit_candidates',{candidates:[{preparedId:receipt!.preparedId,title:'已满足30套'}]})]);}
   rejected=JSON.parse(messages.filter(message=>message.role==='tool').at(-1)!.content).accepted;
   const stored=await f.db.query<{count:number}>('select count(*)::integer as count from scene_private.agent_proposals p join scene_private.agent_runs r on p.run_id=r.id where r.project_id=$1',[i.project.id]);expect(stored.rows[0]!.count).toBe(0);
   return reply([tool('submit','submit_candidates',{candidates:[{preparedId:receipt!.preparedId}]})]);
  });
  const trial=createChatTrialProvider(fetcher,()=>{},110_000,true);
  const run=await send(i,trial.fetcher);
  expect(receipt).toMatchObject({requested:30,placed:24,shortfall:6,limitReason:'object_limit'});expect(receipt!.unknown).toContain('实际家具规格和库存');expect(rejected).toBe(0);
  expect(receipt!.nextSteps.join('')).toContain('系统场景对象数量上限');expect(receipt!.nextSteps.join('')).toContain('用户愿意');expect(receipt!.nextSteps.join('')).toContain('不会擅自修改');
  expect(run.state).toBe('complete');expect(run.candidates).toHaveLength(1);expect(trial.used()).toBe(3);
  const proposal=run.candidates[0]!.proposal;
  expect(proposal.candidate.objects).toHaveLength(49);expect(proposal.candidate.objects.find(item=>item.id===i.original.id)).toEqual(i.original);
  expect(proposal.explanation).toContain('尚缺 6 套');expect(proposal.explanation).toContain('50 件');expect(proposal.explanation).toContain('两人共桌');expect(proposal.explanation).not.toContain('已满足30套');
  expect(proposal.warnings).toContainEqual({code:'SEATING_SHORTFALL:30:24:object_limit',ids:[]});
  expect(proposal.warnings).toContainEqual({code:'SAFETY_CHECKS_UNKNOWN',ids:[]});expect((await f.rpc(owner,'projects.get',{projectId:i.project.id})).scene).toEqual(i.initial);
 },30000);
 it('retains the truthful geometry shortfall separately from an object limit',async()=>{
  const i=await setup();let receipt:{preparedId:string;placed:number;shortfall:number;limitReason:string;nextSteps:string[]}|undefined;
  const fetcher=vi.fn(async(_url:RequestInfo|URL,init?:RequestInit)=>{
   if(fetcher.mock.calls.length===1)return reply([tool('prepare','prepare_seating_candidate',{...request,count:3,region:{x1:0,z1:0,x2:1.2,z2:1.5}})]);
   const messages=JSON.parse(String(init?.body)).messages;receipt=JSON.parse(messages.filter((message:{role:string})=>message.role==='tool').at(-1).content);
   return reply([tool('submit','submit_candidates',{candidates:[{preparedId:receipt!.preparedId}]})]);
  });
  const run=await send(i,fetcher);expect(receipt).toMatchObject({placed:1,shortfall:2,limitReason:'no_placement'});
  expect(receipt!.nextSteps.join('')).toContain('其他区域探索');expect(receipt!.nextSteps.join('')).not.toContain('系统场景对象数量上限');
  expect(run.candidates[0]!.proposal.warnings).toContainEqual({code:'SEATING_SHORTFALL:3:1:no_placement',ids:[]});
  expect(run.candidates[0]!.proposal.explanation).toContain('不代表场地最大容量');
 },30000);
 it('keeps the program-generated zero-placement explanation when the model submits an unchanged scene',async()=>{
  const i=await setup(true);let receipt:{preparedId:null;placed:number;shortfall:number;nextSteps:string[]}|undefined;
  const fetcher=vi.fn(async(_url:RequestInfo|URL,init?:RequestInit)=>{
   if(fetcher.mock.calls.length===1)return reply([tool('prepare','prepare_seating_candidate',{...request,region:{x1:0,z1:0,x2:0.2,z2:0.2}})]);
   const messages=JSON.parse(String(init?.body)).messages;receipt=JSON.parse(messages.filter((message:{role:string})=>message.role==='tool').at(-1).content);
   return reply([tool('submit','submit_candidates',{candidates:[{title:'进一步讨论',explanation:'请先讨论活动安排。',commands:[]}]})]);
  });
  const run=await send(i,fetcher);expect(receipt).toMatchObject({preparedId:null,placed:0,shortfall:30});
  const proposal=run.candidates[0]!.proposal;expect(proposal.candidate).toEqual(i.initial);
  expect(proposal.explanation).toBe('请先讨论活动安排。');
  expect(proposal.warnings).toContainEqual({code:'SEATING_SHORTFALL:30:0:no_placement',ids:[]});
  expect(receipt!.nextSteps.join('')).toContain('其他区域探索');
  expect((await f.rpc(owner,'projects.get',{projectId:i.project.id})).scene).toEqual(i.initial);
 },30000);
 it('clears a zero-placement observation after a successful new trial',async()=>{
  const i=await setup();let successfulHandle='';
  const fetcher=vi.fn(async(_url:RequestInfo|URL,init?:RequestInit)=>{
   if(fetcher.mock.calls.length===1)return reply([tool('zero','prepare_seating_candidate',{...request,region:{x1:0,z1:0,x2:0.2,z2:0.2}})]);
   if(fetcher.mock.calls.length===2)return reply([tool('retry','prepare_seating_candidate',request)]);
   const messages=JSON.parse(String(init?.body)).messages;successfulHandle=JSON.parse(messages.filter((message:{role:string})=>message.role==='tool').at(-1).content).preparedId;
   return reply([tool('submit','submit_candidates',{candidates:[{title:'说明',explanation:'暂不改变当前场景。',commands:[]}]})]);
  });
  const run=await send(i,fetcher);expect(successfulHandle).toBeTruthy();expect(run.candidates[0]!.proposal.candidate).toEqual(i.initial);
  expect(run.candidates[0]!.proposal.explanation).toBe('暂不改变当前场景。');expect(run.candidates[0]!.proposal.warnings.some(w=>w.code.startsWith('SEATING_SHORTFALL:'))).toBe(false);
 },30000);
 it('does not carry an old zero-placement observation across a new user instruction',async()=>{
  const i=await setup();
  const fetcher=vi.fn(async()=>{
   if(fetcher.mock.calls.length===1)return reply([tool('zero','prepare_seating_candidate',{...request,region:{x1:0,z1:0,x2:0.2,z2:0.2}})]);
   if(fetcher.mock.calls.length===2){
    const running=await f.backend.agent!(owner,'by_request',{projectId:i.project.id,requestId:i.input.requestId});
    await f.backend.agent!(owner,'note',{projectId:i.project.id,id:running.id,note:'先不排桌椅，只讨论活动。'});
    return reply([tool('read','get_bom',{})]);
   }
   return reply([tool('submit','submit_candidates',{candidates:[{title:'说明',explanation:'先讨论活动。',commands:[]}]})]);
  });
  const run=await send(i,fetcher);expect(run.state).toBe('complete');expect(run.candidates[0]!.proposal.candidate).toEqual(i.initial);
  expect(run.candidates[0]!.proposal.explanation).toBe('先讨论活动。');expect(run.candidates[0]!.proposal.warnings.some(w=>w.code.startsWith('SEATING_SHORTFALL:'))).toBe(false);
 },30000);
 it('does not invent a candidate when the model never submits after a zero-placement trial',async()=>{
  const i=await setup();
  const fetcher=vi.fn(async()=>fetcher.mock.calls.length===1
   ?reply([tool('zero','prepare_seating_candidate',{...request,region:{x1:0,z1:0,x2:0.2,z2:0.2}})])
   :reply([tool(`read${fetcher.mock.calls.length}`,'get_bom',{})]));
  const run=await send(i,fetcher);expect(run.state).toBe('failed');expect(run.candidates).toEqual([]);expect(run.errorCode).toBe('MINIMAX_INVALID_TOOL_RESPONSE');
 },30000);
 it('does not attach an empty trial warning to a changed scene',async()=>{
  const i=await setup();
  const fetcher=vi.fn(async()=>fetcher.mock.calls.length===1
   ?reply([tool('zero','prepare_seating_candidate',{...request,region:{x1:0,z1:0,x2:0.2,z2:0.2}})])
   :reply([tool('submit','submit_candidates',{candidates:[{title:'新增一椅',explanation:'尝试另一种布置。',commands:[{op:'add',materialId:'chair',position:{x:4,z:4},rotation:0,color:'#ffffff'}]}]})]));
  const run=await send(i,fetcher);expect(run.candidates[0]!.proposal.candidate).not.toEqual(i.initial);
  expect(run.candidates[0]!.proposal.explanation).toBe('尝试另一种布置。');expect(run.candidates[0]!.proposal.warnings.some(w=>w.code.startsWith('SEATING_SHORTFALL:'))).toBe(false);
 },30000);
 it('does not accept a candidate handle from another run',async()=>{
  const first=await setup();let handle='';
  const firstFetcher=vi.fn(async(_url:RequestInfo|URL,init?:RequestInit)=>{
   if(firstFetcher.mock.calls.length===1)return reply([tool('prepare','prepare_seating_candidate',{...request,count:1})]);
   const messages=JSON.parse(String(init?.body)).messages;handle=JSON.parse(messages.filter((message:{role:string})=>message.role==='tool').at(-1).content).preparedId;
   return reply([tool('done','submit_candidates',{candidates:[empty]})]);
  });await send(first,firstFetcher);expect(handle).toBeTruthy();
  const second=await setup();let error='';
  const fetcher=vi.fn(async(_url:RequestInfo|URL,init?:RequestInit)=>{
   if(fetcher.mock.calls.length===1)return reply([tool('foreign','submit_candidates',{candidates:[{preparedId:handle}]})]);
   const messages=JSON.parse(String(init?.body)).messages;error=JSON.parse(messages.filter((message:{role:string})=>message.role==='tool').at(-1).content).errors?.[0]?.code;
   return reply([tool('explain','submit_candidates',{candidates:[empty]})]);
  });const run=await send(second,fetcher);expect(error).toBe('PREPARED_CANDIDATE_NOT_FOUND');expect(run.state).toBe('complete');expect(run.candidates[0]!.proposal.candidate).toEqual(second.initial);
 },30000);
 it('does not create groups outside an existing selected-object scope',async()=>{
  const i=await setup(true,true);let error='';
  const fetcher=vi.fn(async(_url:RequestInfo|URL,init?:RequestInit)=>{
   if(fetcher.mock.calls.length===1)return reply([tool('prepare','prepare_seating_candidate',{...request,count:1})]);
   const messages=JSON.parse(String(init?.body)).messages;error=JSON.parse(messages.filter((message:{role:string})=>message.role==='tool').at(-1).content).code;
   return reply([tool('explain','submit_candidates',{candidates:[empty]})]);
  });const run=await send(i,fetcher);expect(error).toBe('INVALID_SELECTION');expect(run.candidates[0]!.proposal.candidate).toEqual(i.initial);
 },30000);
});
