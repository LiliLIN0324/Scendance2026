import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {createApi} from '../supabase/functions/_shared/api.ts';
import {agentRunRequestSchema,agentRunSchema} from '../supabase/functions/_shared/agent-contract.ts';
import {database,owner,scene,session,studio} from './fixtures.ts';

const env:Record<string,string>={AGENT_CHAT_PROFILE:'minimax',MINIMAX_AGENT_TOOLS_ENABLED:'1',AGENT_CHAT_BASE_URL:'https://api.minimax.cn/v1',AGENT_CHAT_KEY:'fixture',AGENT_CHAT_MODEL:'MiniMax-M3.1-Flash'};
const call=(id:string,name:string,args:unknown)=>({id,type:'function',index:0,function:{name,arguments:JSON.stringify(args)}});
const reply=(calls:ReturnType<typeof call>[])=>Response.json({base_resp:{status_code:0},choices:[{finish_reason:'tool_calls',message:{role:'assistant',content:null,tool_calls:calls}}]});
const layout={layout:'one_desk_one_chair',count:1,deskSize:{width:.6,depth:.45,height:.75},chairSize:{width:.49,depth:.57,height:.9},deskChairGap:.1,columnGap:.3,rowGap:.5,edgeClearance:.3};
const empty={title:'待核验',explanation:'当前尚不能确认。',commands:[]};
const fact=(status:'reported'|'unknown',valueM:number|null,evidence:string)=>({status,valueM,evidence,source:'user' as const});

describe('selected seating specifications in agent runs',()=>{
 let f:Awaited<ReturnType<typeof database>>;
 beforeAll(async()=>{f=await database();},30000);afterAll(async()=>{await f.db.close();});
 async function setup(){
  const initial=scene(),project=await f.rpc(owner,'projects.create',{studioId:studio,name:'规格测试',scene:initial}),lease=await f.rpc(owner,'lease.acquire',{projectId:project.id,sessionId:session});
  return {project,initial,input:agentRunRequestSchema.parse({requestId:crypto.randomUUID(),sessionId:session,generation:lease.generation,expectedRevision:0,localRevision:0,scene:initial,selectedIds:[],instruction:'先探索布局',executionMode:'preview'})};
 }
 async function send(i:Awaited<ReturnType<typeof setup>>,fetcher:typeof fetch){
  const response=await createApi(f.backend,key=>env[key],fetcher)(new Request(`https://api.test/projects/${i.project.id}/agent-runs`,{method:'POST',headers:{authorization:`Bearer ${owner}`,'content-type':'application/json'},body:JSON.stringify(i.input)}));
  expect(response.status).toBe(202);return agentRunSchema.parse(await response.json());
 }
 it('feeds a mismatch back and accepts the corrected explicitly selected size',async()=>{
  const i=await setup(),evidence='桌宽1.8米';i.input.instruction=`本场用户原话：${JSON.stringify(evidence)}`;
  i.input.context.seatingSpecs={desk:{width:fact('reported',1.8,evidence) as {status:'reported';valueM:number;evidence:string;source:'user'}}};
  let error='',summary='',validated:unknown;
  const fetcher=vi.fn(async(_url:RequestInfo|URL,init?:RequestInit)=>{
   const messages=JSON.parse(String(init?.body)).messages;
   if(fetcher.mock.calls.length===1){validated=JSON.parse(messages[1].content).context.seatingSpecs;return reply([call('bad','prepare_seating_candidate',layout)]);}
   const result=JSON.parse(messages.filter((m:{role:string})=>m.role==='tool').at(-1).content);
   if(fetcher.mock.calls.length===2){error=result.code;return reply([call('good','prepare_seating_candidate',{...layout,deskSize:{...layout.deskSize,width:1.8}})]);}
   summary=result.summary;return reply([call('submit','submit_candidates',{candidates:[{preparedId:result.preparedId}]})]);
  });
  const run=await send(i,fetcher);expect(validated).toMatchObject({desk:{width:{status:'reported',valueM:1.8,source:'user'}}});expect(error).toBe('SEATING_SPEC_CONFLICT');
  expect(run.state).toBe('complete');expect(run.candidates[0]!.proposal.candidate.objects.some(item=>item.materialId==='table'&&item.size.width===1.8)).toBe(true);
  expect(summary).toContain('1.8（用户提供）');expect(summary).toContain('假设');
 });
 it.each([
  {evidence:'现有桌宽1.8米',instruction:'现有桌宽1.8米'},
  {evidence:'桌宽1.8米',instruction:'不要桌宽1.8米'},
  {evidence:'桌宽1.8米',instruction:'用户说桌子待定'},
  {evidence:'椅子宽1.8米',instruction:'椅子宽1.8米'},
 ])('keeps unselected, cropped, absent or wrong-item evidence unknown',async({evidence,instruction})=>{
  const i=await setup();i.input.instruction=instruction;i.input.context.seatingSpecs={desk:{width:{status:'reported',valueM:1.8,evidence,source:'user'}}};
  let exposed:unknown,error='';const fetcher=vi.fn(async(_url:RequestInfo|URL,init?:RequestInit)=>{
   const messages=JSON.parse(String(init?.body)).messages;
   if(fetcher.mock.calls.length===1){exposed=JSON.parse(messages[1].content).context.seatingSpecs;return reply([call('prepare','prepare_seating_candidate',layout)]);}
   error=JSON.parse(messages.filter((m:{role:string})=>m.role==='tool').at(-1).content).code;return reply([call('done','submit_candidates',{candidates:[empty]})]);
  });
  await send(i,fetcher);expect(exposed).toMatchObject({desk:{width:{status:'unknown',valueM:null,source:'unverified'}}});expect(error).toBe('SEATING_SPEC_UNCONFIRMED');
 });
 it('accepts explicit selected centimetres and leaves other axes visibly assumed',async()=>{
  const i=await setup(),evidence='使用现有桌子宽180厘米';i.input.instruction=evidence;
  i.input.context.seatingSpecs={desk:{width:{status:'reported',valueM:1.8,evidence,source:'user'}}};
  let summary='';const fetcher=vi.fn(async(_url:RequestInfo|URL,init?:RequestInit)=>{
   if(fetcher.mock.calls.length===1)return reply([call('prepare','prepare_seating_candidate',{...layout,deskSize:{...layout.deskSize,width:1.8}})]);
   const messages=JSON.parse(String(init?.body)).messages,result=JSON.parse(messages.filter((m:{role:string})=>m.role==='tool').at(-1).content);summary=result.summary;
   return reply([call('done','submit_candidates',{candidates:[{preparedId:result.preparedId}]})]);
  });
  const run=await send(i,fetcher);expect(run.state).toBe('complete');expect(summary).toContain('1.8（用户提供）');expect(summary).toContain('0.45（假设）');
 });
 it('treats unknown size as unknown even if the model supplies a plausible value',async()=>{
  const i=await setup(),evidence='桌宽待定';i.input.instruction=evidence;
  i.input.context.seatingSpecs={desk:{width:{status:'unknown',valueM:null,evidence,source:'user'}}};let code='';
  const fetcher=vi.fn(async(_url:RequestInfo|URL,init?:RequestInit)=>{
   if(fetcher.mock.calls.length===1)return reply([call('prepare','prepare_seating_candidate',layout)]);
   const messages=JSON.parse(String(init?.body)).messages;code=JSON.parse(messages.filter((m:{role:string})=>m.role==='tool').at(-1).content).code;
   return reply([call('done','submit_candidates',{candidates:[empty]})]);
  });await send(i,fetcher);expect(code).toBe('SEATING_SPEC_UNCONFIRMED');
 });
 it('marks an ordinary model candidate as not verified against selected sizes',async()=>{
  const i=await setup(),evidence='桌宽1.8米';i.input.instruction=evidence;
  i.input.context.seatingSpecs={desk:{width:{status:'reported',valueM:1.8,evidence,source:'user'}}};
  const fetcher=vi.fn(async()=>reply([call('done','submit_candidates',{candidates:[{title:'候选',explanation:'模型说明。',commands:[{op:'add',materialId:'table',position:{x:4,z:4},rotation:0,color:'#ffffff'}]}]})]));
  const run=await send(i,fetcher);expect(run.state).toBe('complete');expect(run.candidates[0]!.proposal.warnings).toContainEqual({code:'SEATING_SPECS_UNVERIFIED',ids:[]});
 });
 it('does not treat unselected inventory as a chosen dimension',async()=>{
  const i=await setup();i.input.instruction='现有桌宽1.8米，先探索';let summary='';
  const fetcher=vi.fn(async(_url:RequestInfo|URL,init?:RequestInit)=>{
   if(fetcher.mock.calls.length===1)return reply([call('prepare','prepare_seating_candidate',layout)]);
   const messages=JSON.parse(String(init?.body)).messages,result=JSON.parse(messages.filter((m:{role:string})=>m.role==='tool').at(-1).content);summary=result.summary;
   return reply([call('done','submit_candidates',{candidates:[{preparedId:result.preparedId}]})]);
  });const run=await send(i,fetcher);expect(run.state).toBe('complete');expect(summary).toContain('0.6（假设）');expect(summary).not.toContain('1.8（用户提供）');
 });
 it.each([
  {instruction:'桌宽1.8米，先探索',history:[]},
  {instruction:'换一版',history:[{role:'user' as const,text:'桌宽1.8米'}]},
 ])('protects explicitly selected dimensions from an older client without the field',async({instruction,history})=>{
  const i=await setup();i.input.instruction=instruction;i.input.context.recentMessages=history;let code='';
  const fetcher=vi.fn(async(_url:RequestInfo|URL,init?:RequestInit)=>{
   if(fetcher.mock.calls.length===1)return reply([call('prepare','prepare_seating_candidate',layout)]);
   const messages=JSON.parse(String(init?.body)).messages;code=JSON.parse(messages.filter((m:{role:string})=>m.role==='tool').at(-1).content).code;
   return reply([call('done','submit_candidates',{candidates:[empty]})]);
  });await send(i,fetcher);expect(code).toBe('SEATING_SPEC_CONFLICT');
 });
 it('uses the later explicit user correction instead of a previous size',async()=>{
  const i=await setup();i.input.instruction='桌宽改为1.6米';i.input.context.recentMessages=[{role:'user',text:'桌宽1.8米'}];let details:unknown;
  const fetcher=vi.fn(async(_url:RequestInfo|URL,init?:RequestInit)=>{
   if(fetcher.mock.calls.length===1)return reply([call('prepare','prepare_seating_candidate',{...layout,deskSize:{...layout.deskSize,width:1.8}})]);
   const messages=JSON.parse(String(init?.body)).messages;details=JSON.parse(messages.filter((m:{role:string})=>m.role==='tool').at(-1).content).details;
   return reply([call('done','submit_candidates',{candidates:[empty]})]);
  });await send(i,fetcher);expect(details).toMatchObject({target:'desk',axis:'width',expectedMeters:1.6});
 });
 it('honors a later explicit return to the default rather than a stale selected dimension',async()=>{
  const i=await setup();i.input.instruction='桌子按默认规格';i.input.context.recentMessages=[{role:'user',text:'桌宽1.8米'}];
  i.input.context.seatingSpecs={desk:{width:{status:'reported',valueM:1.8,evidence:'桌宽1.8米',source:'user'}}};let summary='';
  const fetcher=vi.fn(async(_url:RequestInfo|URL,init?:RequestInit)=>{
   if(fetcher.mock.calls.length===1)return reply([call('prepare','prepare_seating_candidate',layout)]);
   const messages=JSON.parse(String(init?.body)).messages,result=JSON.parse(messages.filter((m:{role:string})=>m.role==='tool').at(-1).content);summary=result.summary;
   return reply([call('done','submit_candidates',{candidates:[{preparedId:result.preparedId}]})]);
  });const run=await send(i,fetcher);expect(run.state).toBe('complete');expect(summary).toContain('0.6（假设）');expect(summary).not.toContain('1.8（用户提供）');
 });
 it('honors explicit dimensions supplied after a same-turn return to defaults',async()=>{
  const i=await setup();i.input.instruction='桌子按默认规格，桌宽1.6米';i.input.context.recentMessages=[{role:'user',text:'桌宽1.8米'}];
  i.input.context.seatingSpecs={desk:{width:{status:'reported',valueM:1.8,evidence:'桌宽1.8米',source:'user'}}};let details:unknown;
  const fetcher=vi.fn(async(_url:RequestInfo|URL,init?:RequestInit)=>{
   if(fetcher.mock.calls.length===1)return reply([call('prepare','prepare_seating_candidate',{...layout,deskSize:{...layout.deskSize,width:1.8}})]);
   const messages=JSON.parse(String(init?.body)).messages;details=JSON.parse(messages.filter((m:{role:string})=>m.role==='tool').at(-1).content).details;
   return reply([call('done','submit_candidates',{candidates:[empty]})]);
  });await send(i,fetcher);expect(details).toMatchObject({target:'desk',axis:'width',expectedMeters:1.6});
 });
 it('does not let an empty structured object erase the current explicit size',async()=>{
  const i=await setup();i.input.instruction='桌宽1.8米';i.input.context.seatingSpecs={};let code='';
  const fetcher=vi.fn(async(_url:RequestInfo|URL,init?:RequestInit)=>{
   if(fetcher.mock.calls.length===1)return reply([call('prepare','prepare_seating_candidate',layout)]);
   const messages=JSON.parse(String(init?.body)).messages;code=JSON.parse(messages.filter((m:{role:string})=>m.role==='tool').at(-1).content).code;
   return reply([call('done','submit_candidates',{candidates:[empty]})]);
  });await send(i,fetcher);expect(code).toBe('SEATING_SPEC_CONFLICT');
 });
 it('downgrades stale structured data when it conflicts with the current user sentence',async()=>{
  const i=await setup();i.input.instruction='桌宽2米';i.input.context.recentMessages=[{role:'user',text:'桌宽1.8米'}];
  i.input.context.seatingSpecs={desk:{width:{status:'reported',valueM:1.8,evidence:'桌宽1.8米',source:'user'}}};let code='',exposed:unknown;
  const fetcher=vi.fn(async(_url:RequestInfo|URL,init?:RequestInit)=>{
   const messages=JSON.parse(String(init?.body)).messages;
   if(fetcher.mock.calls.length===1){exposed=JSON.parse(messages[1].content).context.seatingSpecs;return reply([call('prepare','prepare_seating_candidate',{...layout,deskSize:{...layout.deskSize,width:2}})]);}
   code=JSON.parse(messages.filter((m:{role:string})=>m.role==='tool').at(-1).content).code;return reply([call('done','submit_candidates',{candidates:[empty]})]);
  });await send(i,fetcher);expect(exposed).toMatchObject({desk:{width:{status:'unknown',source:'unverified'}}});expect(code).toBe('SEATING_SPEC_UNCONFIRMED');
 });
 it('does not attribute assistant-only legacy dimensions to the user',async()=>{
  const i=await setup();i.input.instruction='探索桌椅';i.input.context.recentMessages=[{role:'assistant',text:'桌宽1.8米'}];let summary='';
  const fetcher=vi.fn(async(_url:RequestInfo|URL,init?:RequestInit)=>{
   if(fetcher.mock.calls.length===1)return reply([call('prepare','prepare_seating_candidate',layout)]);
   const messages=JSON.parse(String(init?.body)).messages,result=JSON.parse(messages.filter((m:{role:string})=>m.role==='tool').at(-1).content);summary=result.summary;
   return reply([call('done','submit_candidates',{candidates:[{preparedId:result.preparedId}]})]);
  });const run=await send(i,fetcher);expect(run.state).toBe('complete');expect(summary).toContain('0.6（假设）');
 });
 it('does not let a later unselected inventory observation overwrite a chosen size',async()=>{
  const i=await setup();i.input.instruction='现有桌宽1.8米';i.input.context.recentMessages=[{role:'user',text:'桌宽1.6米'}];
  i.input.context.seatingSpecs={desk:{width:{status:'reported',valueM:1.6,evidence:'桌宽1.6米',source:'user'}}};let expected:unknown;
  const fetcher=vi.fn(async(_url:RequestInfo|URL,init?:RequestInit)=>{
   if(fetcher.mock.calls.length===1)return reply([call('prepare','prepare_seating_candidate',{...layout,deskSize:{...layout.deskSize,width:1.8}})]);
   const messages=JSON.parse(String(init?.body)).messages;expected=JSON.parse(messages.filter((m:{role:string})=>m.role==='tool').at(-1).content).details;
   return reply([call('done','submit_candidates',{candidates:[empty]})]);
  });await send(i,fetcher);expect(expected).toMatchObject({target:'desk',axis:'width',expectedMeters:1.6});
 });
 it('rejects malformed values and non-user claimed sources at the boundary',()=>{
  const base=agentRunRequestSchema.parse({requestId:crypto.randomUUID(),sessionId:session,generation:1,expectedRevision:0,localRevision:0,scene:scene(),selectedIds:[],instruction:'桌宽1.8米'});
  for(const value of [
   {status:'reported',valueM:null,evidence:'桌宽1.8米',source:'user'},
   {status:'unknown',valueM:1.8,evidence:'桌宽待定',source:'user'},
   {status:'reported',valueM:1.8,evidence:'桌宽1.8米',source:'model'},
   {status:'reported',valueM:100,evidence:'桌宽100米',source:'user'},
  ])expect(agentRunRequestSchema.safeParse({...base,context:{...base.context,seatingSpecs:{desk:{width:value}}}}).success).toBe(false);
 });
});
