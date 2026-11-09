import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {createApi} from '../supabase/functions/_shared/api.ts';
import {agentRunRequestSchema,agentRunSchema} from '../supabase/functions/_shared/agent-contract.ts';
import {planSharedDesks} from '../supabase/functions/_shared/agent-shared-seating-layout.ts';
import {chair,database,owner,scene,session,studio} from './fixtures.ts';
const config:Record<string,string>={AGENT_CHAT_PROFILE:'minimax',MINIMAX_AGENT_TOOLS_ENABLED:'1',AGENT_CHAT_BASE_URL:'https://api.minimax.cn/v1',AGENT_CHAT_KEY:'fixture',AGENT_CHAT_MODEL:'MiniMax-M3.1-Flash'};
const call=(id:string,name:string,args:unknown)=>({id,type:'function',index:0,function:{name,arguments:JSON.stringify(args)}});
const reply=(calls:ReturnType<typeof call>[])=>Response.json({base_resp:{status_code:0},choices:[{finish_reason:'tool_calls',message:{role:'assistant',content:null,tool_calls:calls}}]});
const layout={layout:'two_people_per_desk' as const,count:30,deskSize:{width:1.2,depth:0.5,height:0.75},chairSize:{width:0.45,depth:0.5,height:0.85},deskChairGap:0.1,chairGap:0.1,columnGap:0.2,rowGap:0.2,edgeClearance:0.2};
const id=()=>crypto.randomUUID();
describe('shared seating',()=>{
 it('rejects a desk narrower than the two chairs and their stated gap',()=>{
  const base=scene();
  expect(()=>planSharedDesks(base,{...layout,deskSize:{...layout.deskSize,width:0.6}},id)).toThrow('SEATING_DESK_TOO_NARROW');
  expect(base.objects).toHaveLength(0);
 });
 it('creates 15 desks and 30 separate chairs preserving scene and gaps',()=>{
  const initial=scene(),result=planSharedDesks(initial,layout,id);
  expect(result).toMatchObject({requestedPeople:30,placedPeople:30,tables:15,shortfall:0,limitReason:null});
  expect(result.scene.objects.filter(o=>o.materialId==='table')).toHaveLength(15);
  const chairs=result.scene.objects.filter(o=>o.materialId==='chair');expect(chairs).toHaveLength(30);
  expect(chairs[1]!.position.x-chairs[0]!.position.x).toBeCloseTo(0.55);
  expect(initial.objects).toHaveLength(0);
 });
 it('reports object cap and preserves existing objects',()=>{
  const initial=scene();for(let i=0;i<6;i++){const existing=chair();existing.id=id();existing.position={x:19+i*0.1,z:19};initial.objects.push(existing);}
  const result=planSharedDesks(initial,layout,id);
  expect(result).toMatchObject({requestedPeople:30,placedPeople:29,tables:15,shortfall:1,limitReason:'object_limit'});
  expect(result.scene.objects.slice(0,6)).toEqual(initial.objects);expect(result.scene.objects).toHaveLength(50);
 });
 it('rejects duplicate generated identities and reports bounded search failures',()=>{
  expect(()=>planSharedDesks(scene(),layout,()=> '11111111-1111-4111-8111-111111111111')).toThrow();
  const result=planSharedDesks(scene(),{...layout,region:{x1:0,z1:0,x2:0.2,z2:0.2}},id);
  expect(result).toMatchObject({placedPeople:0,tables:0,shortfall:30,limitReason:'no_placement'});
 });
});
describe('shared seating tool loop',()=>{
 let f:Awaited<ReturnType<typeof database>>;
 beforeAll(async()=>{f=await database();},30000);afterAll(async()=>{await f.db.close();});
 async function setup(instruction:string,initial=scene()){
  const project=await f.rpc(owner,'projects.create',{studioId:studio,name:'Shared seats',scene:initial});
  const lease=await f.rpc(owner,'lease.acquire',{projectId:project.id,sessionId:session});
  const input=agentRunRequestSchema.parse({requestId:id(),sessionId:session,generation:lease.generation,expectedRevision:0,localRevision:0,scene:initial,selectedIds:[],instruction,executionMode:'preview'});
  return {initial,project,input};
 }
 async function run(i:Awaited<ReturnType<typeof setup>>,fetcher:typeof fetch){
  const response=await createApi(f.backend,key=>config[key],fetcher)(new Request(`https://api.test/projects/${i.project.id}/agent-runs`,{method:'POST',headers:{authorization:`Bearer ${owner}`,'content-type':'application/json'},body:JSON.stringify(i.input)}));
  expect(response.status).toBe(202);return agentRunSchema.parse(await response.json());
 }
 it('rejects a model reducing the stated 30-person target to two',async()=>{
  const i=await setup('请为30人按每2人一桌试排，必须保留所有原物');let responseCode='';
  const fetcher=vi.fn(async(_url:RequestInfo|URL,init?:RequestInit)=>{
   if(fetcher.mock.calls.length===1)return reply([call('short','prepare_shared_seating_candidate',{...layout,count:2})]);
   const body=JSON.parse(String(init?.body));responseCode=JSON.parse(body.messages.filter((v:any)=>v.role==='tool').at(-1).content).code;
   return reply([call('explain','submit_candidates',{candidates:[{title:'待确认',explanation:'人数需要重新核对',commands:[]}]})]);
  });
  const result=await run(i,fetcher);expect(responseCode).toBe('SEATING_HEADCOUNT_CONFLICT');
  expect(result.candidates[0]!.proposal.candidate).toEqual(i.initial);
  const saved=await f.rpc(owner,'projects.get',{projectId:i.project.id});expect(saved.scene).toEqual(i.initial);expect(saved.revision).toBe(0);
 });
 it('rejects an ordinary candidate that removes an item the user asked to retain',async()=>{
  const initial=scene(),existing=chair();initial.objects.push(existing);
  const i=await setup('请为30人排布，必须保留所有原物',initial);let errors:any[]=[];
  const fetcher=vi.fn(async(_url:RequestInfo|URL,init?:RequestInit)=>{
   if(fetcher.mock.calls.length===1)return reply([call('bad','submit_candidates',{candidates:[{title:'候选',explanation:'调整',commands:[{op:'remove',id:existing.id}]}]})]);
   const body=JSON.parse(String(init?.body));errors=JSON.parse(body.messages.filter((v:any)=>v.role==='tool').at(-1).content).errors;
   return reply([call('explain','submit_candidates',{candidates:[{title:'待确认',explanation:'保留原物',commands:[]}]})]);
  });
  const result=await run(i,fetcher);expect(errors[0]?.code).toBe('CANDIDATE_GEOMETRY_CONFLICT');
  expect(result.candidates[0]!.proposal.candidate).toEqual(initial);
  const saved=await f.rpc(owner,'projects.get',{projectId:i.project.id});expect(saved.scene).toEqual(initial);expect(saved.revision).toBe(0);
 });
 it('accepts user-provided two-person allocation, submits and independently reviews an immutable candidate',async()=>{
  const i=await setup('请给30人安排每2人一桌的课桌椅，保留已有物件');let observation:any;
  const fetcher=vi.fn(async(_url:RequestInfo|URL,init?:RequestInit)=>{
   const body=JSON.parse(String(init?.body));
   if(fetcher.mock.calls.length===1){expect(body.tools.map((v:any)=>v.function.name)).toContain('prepare_shared_seating_candidate');return reply([call('make','prepare_shared_seating_candidate',layout)]);}
   observation=JSON.parse(body.messages.filter((v:any)=>v.role==='tool').at(-1).content);
   return reply([call('submit','submit_candidates',{candidates:[{preparedId:observation.preparedId}]})]);
  });
  const result=await run(i,fetcher);expect(observation).toMatchObject({requestedPeople:30,placedPeople:30,tables:15,shortfall:0});
  expect(result.state).toBe('complete');expect(result.candidates[0]!.proposal.candidate.objects).toHaveLength(45);
  expect(result.candidates[0]!.proposal.explanation).toContain('30 个座位');
  expect(result.candidates[0]!.proposal.warnings).toContainEqual({code:'SAFETY_CHECKS_UNKNOWN',ids:[]});
 });
 it('retains zero-placement evidence and options for an unchanged shared-desk candidate',async()=>{
  const initial=scene(),existing=chair();initial.objects.push(existing);
  const i=await setup('请为30人按每2人一桌试排，保留原有物件',initial);let observation:any;
  const fetcher=vi.fn(async(_url:RequestInfo|URL,init?:RequestInit)=>{
   if(fetcher.mock.calls.length===1)return reply([call('make','prepare_shared_seating_candidate',{...layout,region:{x1:0,z1:0,x2:0.2,z2:0.2}})]);
   const body=JSON.parse(String(init?.body));observation=JSON.parse(body.messages.filter((v:any)=>v.role==='tool').at(-1).content);
   return reply([call('submit','submit_candidates',{candidates:[{title:'待讨论',explanation:'先核对需求。',commands:[]}]})]);
  });
  const result=await run(i,fetcher);expect(observation).toMatchObject({preparedId:null,placedPeople:0,shortfall:30});
  const proposal=result.candidates[0]!.proposal;expect(proposal.candidate).toEqual(initial);
  expect(proposal.explanation).toBe('先核对需求。');expect(proposal.warnings).toContainEqual({code:'SHARED_SEATING_SHORTFALL:30:0:0:no_placement',ids:[]});
  expect(observation.nextSteps.join('')).toContain('其他区域探索');
  expect((await f.rpc(owner,'projects.get',{projectId:i.project.id})).scene).toEqual(initial);
 });
 it('does not accept a handle from another run or fabricated warning overrides',async()=>{
  const first=await setup('请安排每2人一桌');let handle='';
  const firstFetcher=vi.fn(async(_url:RequestInfo|URL,init?:RequestInit)=>{
   if(firstFetcher.mock.calls.length===1)return reply([call('make','prepare_shared_seating_candidate',{...layout,count:2})]);
   const body=JSON.parse(String(init?.body));handle=JSON.parse(body.messages.filter((v:any)=>v.role==='tool').at(-1).content).preparedId;
   return reply([call('done','submit_candidates',{candidates:[{title:'待确认',explanation:'待确认',commands:[]}]})]);
  });await run(first,firstFetcher);expect(handle).toBeTruthy();
  const second=await setup('请安排每2人一桌');let error='';
  const secondFetcher=vi.fn(async(_url:RequestInfo|URL,init?:RequestInit)=>{
   if(secondFetcher.mock.calls.length===1)return reply([call('foreign','submit_candidates',{candidates:[{preparedId:handle}]})]);
   const body=JSON.parse(String(init?.body));error=JSON.parse(body.messages.filter((v:any)=>v.role==='tool').at(-1).content).errors?.[0]?.code;
   return reply([call('done','submit_candidates',{candidates:[{title:'待确认',explanation:'待确认',commands:[]}]})]);
  });const secondResult=await run(second,secondFetcher);expect(error).toBe('PREPARED_CANDIDATE_NOT_FOUND');expect(secondResult.candidates[0]!.proposal.candidate).toEqual(second.initial);
  const third=await setup('请安排每2人一桌');let spoofError='';let ownHandle='';
  const thirdFetcher=vi.fn(async(_url:RequestInfo|URL,init?:RequestInit)=>{
   const body=JSON.parse(String(init?.body));
   if(thirdFetcher.mock.calls.length===1)return reply([call('make','prepare_shared_seating_candidate',{...layout,count:2})]);
   const observation=JSON.parse(body.messages.filter((v:any)=>v.role==='tool').at(-1).content);
   if(thirdFetcher.mock.calls.length===2){ownHandle=observation.preparedId;return reply([call('spoof','submit_candidates',{candidates:[{preparedId:ownHandle,warnings:[],explanation:'全部安全通过'}]})]);}
   spoofError=observation.errors?.[0]?.code;
   return reply([call('done','submit_candidates',{candidates:[{preparedId:ownHandle}]})]);
  });const thirdResult=await run(third,thirdFetcher);expect(spoofError).toBeTruthy();expect(thirdResult.candidates[0]!.proposal.explanation).not.toContain('全部安全通过');expect(thirdResult.candidates[0]!.proposal.warnings).toContainEqual({code:'SAFETY_CHECKS_UNKNOWN',ids:[]});
 });
 it.each(['为30人安排桌椅','不要每2人一桌','每3人一桌'])('rejects model-invented allocation: %s',async instruction=>{
  const i=await setup(instruction);let code='';
  const fetcher=vi.fn(async(_url:RequestInfo|URL,init?:RequestInit)=>{
   const body=JSON.parse(String(init?.body));if(fetcher.mock.calls.length===1)return reply([call('make','prepare_shared_seating_candidate',layout)]);
   code=JSON.parse(body.messages.filter((v:any)=>v.role==='tool').at(-1).content).code;
   return reply([call('submit','submit_candidates',{candidates:[{title:'待确认',explanation:'配比待确认',commands:[]}]})]);
  });
  await run(i,fetcher);expect(code).toBe('SEATING_ALLOCATION_UNCONFIRMED');
 });
});
