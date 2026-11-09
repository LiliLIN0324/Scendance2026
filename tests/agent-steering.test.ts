import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {database,owner,studio,session,scene,chair} from './fixtures.ts';
import {createApi} from '../supabase/functions/_shared/api.ts';
import {agentRunRequestSchema,agentRunSchema} from '../supabase/functions/_shared/agent-contract.ts';

/**
 * 运行中改道：用户在 agent 跑着的时候追加一句要求。
 *
 * 这一组只钉三件事，都是「说了就得算数」的部分：
 *  1. 备注在**下一轮模型调用之前**进入上下文，而不是这一轮的尾巴上；
 *  2. 取走即清空——同一条不会在之后每一轮反复出现；
 *  3. 任务收尾后送来的备注必须被拒，不能回一个假的「已收到」。
 */
const env=(key:string)=>({DEEPSEEK_API_KEY:'fixture',TOKENDANCE_API_KEY:'fixture',HY3_RETIRED:'true'}[key]);
const plan=()=>({title:'布局',explanation:'已规划桌子，待程序应用。',commands:[{op:'add',materialId:'table',position:{x:2,z:3},rotation:0,color:'#ffffff'}]});
const tool=(name:string,args:unknown)=> ({id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}});
const completion=(calls:ReturnType<typeof tool>[])=>new Response(JSON.stringify({choices:[{finish_reason:'tool_calls',message:{content:null,tool_calls:calls}}],usage:{total_tokens:10}}));
const NOTE='主桌换成圆桌，背景板不要动';

describe('运行中改道（steering）',()=>{
 let f:Awaited<ReturnType<typeof database>>;
 beforeAll(async()=>{f=await database();},30000);afterAll(async()=>{await f.db.close();});
 async function input() {
  const base=scene(),p=await f.rpc(owner,'projects.create',{studioId:studio,name:'Steering test',scene:base});
  const lease=await f.rpc(owner,'lease.acquire',{projectId:p.id,sessionId:session});
  return {projectId:p.id,...agentRunRequestSchema.parse({requestId:crypto.randomUUID(),sessionId:session,generation:lease.generation,expectedRevision:0,localRevision:0,scene:base,selectedIds:[],instruction:'直接添加桌子',executionMode:'direct'})};
 }
 const send=(api:ReturnType<typeof createApi>,i:Awaited<ReturnType<typeof input>>)=> {
  const {projectId,...body}=i;
  return api(new Request(`https://api.test/projects/${projectId}/agent-runs`,{method:'POST',headers:{authorization:`Bearer ${owner}`,'content-type':'application/json'},body:JSON.stringify(body)}));
 };
 const postNote=(api:ReturnType<typeof createApi>,projectId:string,runId:string,note:string)=>
  api(new Request(`https://api.test/projects/${projectId}/agent-runs/${runId}/notes`,{method:'POST',headers:{authorization:`Bearer ${owner}`,'content-type':'application/json'},body:JSON.stringify({note})}));

 it('在下一轮模型调用之前注入，并在取走后不再重复',async()=>{
  const i=await input();
  const requests:{messages:{role:string;content:string}[]}[]=[];
  const fetcher=vi.fn(async(_url,init)=>{
   requests.push(JSON.parse(String(init?.body)));
   if(requests.length===1)return completion([tool('get_scene',{})]);
   if(requests.length===2){
    // 模型正在第 2 轮里干活时，用户把备注送了进来——这正是真实的时序。
    const running=await f.backend.agent!(owner,'by_request',{projectId:i.projectId,requestId:i.requestId});
    await f.backend.agent!(owner,'note',{projectId:i.projectId,id:running.id,note:NOTE});
    return completion([tool('get_bom',{})]);
   }
   return completion([tool('submit_candidates',{candidates:[plan()]})]);
  });
  const run=agentRunSchema.parse(await (await send(createApi(f.backend,env,fetcher),i)).json());
  expect(run.state).toBe('complete');
  const userText=(index:number)=>requests[index]!.messages.filter(m=>m.role==='user').map(m=>m.content).join('\n');
  // 第 2 轮那次调用发生时备注才刚送到，所以它不该出现在第 2 轮里；
  // 第 3 轮（下一轮）必须带上它，而且是「后说的盖过先说的」这条口径。
  expect(userText(1)).not.toContain(NOTE);
  expect(userText(2)).toContain(NOTE);
  expect(userText(2)).toContain('后说的盖过先说的');
  expect(run.steerTotal).toBe(1);
 });

 it('任务收尾后送来的备注被拒，而不是假装收到',async()=>{
  const i=await input(),api=createApi(f.backend,env,vi.fn(async()=>completion([tool('submit_candidates',{candidates:[plan()]})])));
  const run=agentRunSchema.parse(await (await send(api,i)).json());
  expect(run.state).toBe('complete');
  const response=await postNote(api,i.projectId,run.id,NOTE);
  expect(response.status).toBe(409);
  expect((await response.json()).error.code).toBe('AGENT_RUN_STOPPED');
  const after=agentRunSchema.parse(await (await api(new Request(`https://api.test/projects/${i.projectId}/agent-runs/${run.id}`,{headers:{authorization:`Bearer ${owner}`}}))).json());
  expect(after.steerTotal).toBe(0);
 });

 it('空备注与超长备注在入口就被挡掉',async()=>{
  const i=await input(),api=createApi(f.backend,env,vi.fn(async()=>completion([tool('submit_candidates',{candidates:[plan()]})])));
  const run=agentRunSchema.parse(await (await send(api,i)).json());
  expect((await postNote(api,i.projectId,run.id,'   ')).status).toBe(400);
  expect((await postNote(api,i.projectId,run.id,'桌'.repeat(501))).status).toBe(400);
 });

 it('收到新的保留原物要求后，不能提交删除原物的候选',async()=>{
  const initial=scene(),item=chair();initial.objects.push(item);
  const p=await f.rpc(owner,'projects.create',{studioId:studio,name:'Steer preservation',scene:initial});
  const lease=await f.rpc(owner,'lease.acquire',{projectId:p.id,sessionId:session});
  const i={projectId:p.id,...agentRunRequestSchema.parse({requestId:crypto.randomUUID(),sessionId:session,generation:lease.generation,expectedRevision:0,localRevision:0,scene:initial,selectedIds:[],instruction:'为30人安排活动',executionMode:'preview'})};
  let rejected='';
  const fetcher=vi.fn(async(_url,init)=>{
   if(fetcher.mock.calls.length===1){const run=await f.backend.agent!(owner,'by_request',{projectId:i.projectId,requestId:i.requestId});await f.backend.agent!(owner,'note',{projectId:i.projectId,id:run.id,note:'必须保留所有原物'});return completion([tool('get_scene',{})]);}
   if(fetcher.mock.calls.length===2)return completion([tool('submit_candidates',{candidates:[{title:'候选',explanation:'调整',commands:[{op:'remove',id:item.id}]}]})]);
   const body=JSON.parse(String(init?.body));rejected=JSON.parse(body.messages.filter((m:{role:string})=>m.role==='tool').at(-1).content).errors?.[0]?.code;
   return completion([tool('submit_candidates',{candidates:[{title:'待确认',explanation:'保留原物',commands:[]}]})]);
  });
  const run=agentRunSchema.parse(await (await send(createApi(f.backend,env,fetcher),i)).json());
  expect(rejected).toBe('CANDIDATE_GEOMETRY_CONFLICT');expect(run.candidates[0]!.proposal.candidate).toEqual(initial);
 });

 it('收到更新后的明确人数时按新人数试排，而不是被旧人数锁住',async()=>{
  const base=scene(),p=await f.rpc(owner,'projects.create',{studioId:studio,name:'Steer attendance',scene:base});
  const lease=await f.rpc(owner,'lease.acquire',{projectId:p.id,sessionId:session});
  const i={projectId:p.id,...agentRunRequestSchema.parse({requestId:crypto.randomUUID(),sessionId:session,generation:lease.generation,expectedRevision:0,localRevision:0,scene:base,selectedIds:[],instruction:'请为30人按每2人一桌试排',executionMode:'preview'})};
  let result:Record<string,unknown>={};
  const fetcher=vi.fn(async(_url,init)=>{
   if(fetcher.mock.calls.length===1){const run=await f.backend.agent!(owner,'by_request',{projectId:i.projectId,requestId:i.requestId});await f.backend.agent!(owner,'note',{projectId:i.projectId,id:run.id,note:'人数改为40人'});return completion([tool('get_scene',{})]);}
   if(fetcher.mock.calls.length===2)return completion([tool('prepare_shared_seating_candidate',{layout:'two_people_per_desk',count:40,deskSize:{width:1.2,depth:0.5,height:0.75},chairSize:{width:0.45,depth:0.5,height:0.85},deskChairGap:0.1,chairGap:0.1,columnGap:0.2,rowGap:0.2,edgeClearance:0.2})]);
   const body=JSON.parse(String(init?.body));result=JSON.parse(body.messages.filter((m:{role:string})=>m.role==='tool').at(-1).content);
   return completion([tool('submit_candidates',{candidates:[{title:'待确认',explanation:'人数及场地需核对',commands:[]}]})]);
  });
  await send(createApi(f.backend,env,fetcher),i);
  expect(result.code).not.toBe('SEATING_HEADCOUNT_CONFLICT');expect(result.requestedPeople).toBe(40);
 });

 it('模型调用期间收到改道时丢弃旧候选并按新要求继续',async()=>{
  const i=await input();
  const fetcher=vi.fn(async(_url,init)=>{
   if(fetcher.mock.calls.length===1){
    const run=await f.backend.agent!(owner,'by_request',{projectId:i.projectId,requestId:i.requestId});
    await f.backend.agent!(owner,'note',{projectId:i.projectId,id:run.id,note:'保留所有原物'});
    return completion([tool('submit_candidates',{candidates:[plan()]})]);
   }
   const body=JSON.parse(String(init?.body));expect(JSON.stringify(body.messages)).toContain('保留所有原物');
   return completion([tool('submit_candidates',{candidates:[{title:'更新后',explanation:'保留原物',commands:[]}]})]);
  });
  const run=agentRunSchema.parse(await (await send(createApi(f.backend,env,fetcher),i)).json());
  expect(run.state).toBe('complete');expect(run.candidates).toHaveLength(1);
  expect(run.candidates[0]!.proposal.candidate.objects).toEqual([]);expect(fetcher).toHaveBeenCalledTimes(2);
  const after=await f.rpc(owner,'projects.get',{projectId:i.projectId});expect(after.revision).toBe(0);
 });

 it('提交候选后最终结束前收到改道时重新理解，不发布旧版本',async()=>{
  const i=await input(),original=f.backend.agent!;let injected=false;
  const backend={...f.backend,agent:async(actor:string|null,action:string,data?:Record<string,unknown>)=>{
   if(action==='finish'&&!injected){injected=true;await original(owner,'note',{projectId:i.projectId,id:data!.id,note:'改成40人'});}
   return original(actor,action,data);
  }};
  const fetcher=vi.fn(async(_url,init)=>{
   if(fetcher.mock.calls.length===1)return completion([tool('submit_candidates',{candidates:[plan()]})]);
   const body=JSON.parse(String(init?.body));expect(JSON.stringify(body.messages)).toContain('改成40人');
   return completion([tool('submit_candidates',{candidates:[{title:'新方案',explanation:'40人待核对',commands:[]}]})]);
  });
  const run=agentRunSchema.parse(await (await send(createApi(backend,env,fetcher),i)).json());
  expect(run.state).toBe('complete');expect(run.candidates).toHaveLength(1);
  expect(run.candidates[0]!.proposal.candidate.objects).toEqual([]);expect(fetcher).toHaveBeenCalledTimes(2);
 });

 it('checkpoint 与新要求竞争时继续执行，但不重复同批已执行工具',async()=>{
  const i=await input(),original=f.backend.agent!;let injected=false,reads=0;
  const backend={...f.backend,agent:async(actor:string|null,action:string,data?:Record<string,unknown>)=>{
   if(action==='usage'&&(data?.usage as {tool?:string})?.tool==='get_scene')reads++;
   if(action==='checkpoint'&&!injected){injected=true;await original(owner,'note',{projectId:i.projectId,id:data!.id,note:'改成40人'});}
   return original(actor,action,data);
  }};
  const fetcher=vi.fn(async(_url,init)=>{
   if(fetcher.mock.calls.length===1)return completion([tool('get_scene',{}),tool('submit_candidates',{candidates:[plan()]})]);
   const body=JSON.parse(String(init?.body));expect(JSON.stringify(body.messages)).toContain('改成40人');
   return completion([tool('submit_candidates',{candidates:[{title:'新方案',explanation:'人数已更新',commands:[]}]})]);
  });
  const run=agentRunSchema.parse(await (await send(createApi(backend,env,fetcher),i)).json());
  expect(run.state).toBe('complete');expect(fetcher).toHaveBeenCalledTimes(2);expect(reads).toBe(1);
  expect(run.candidates[0]!.proposal.candidate.objects).toEqual([]);
 });

 it('竞争期间用户取消后不再发模型请求或发布候选',async()=>{
  const i=await input(),original=f.backend.agent!;let injected=false;
  const backend={...f.backend,agent:async(actor:string|null,action:string,data?:Record<string,unknown>)=>{
   if(action==='checkpoint'&&!injected){injected=true;await original(owner,'note',{projectId:i.projectId,id:data!.id,note:'改成40人'});await original(owner,'cancel',{projectId:i.projectId,id:data!.id});}
   return original(actor,action,data);
  }};
  const fetcher=vi.fn(async()=>completion([tool('submit_candidates',{candidates:[plan()]})]));
  const run=agentRunSchema.parse(await (await send(createApi(backend,env,fetcher),i)).json());
  expect(run.state).toBe('cancelled');expect(run.candidates).toEqual([]);expect(fetcher).toHaveBeenCalledTimes(1);
 });

 it('剩余时间不足时保留明确的改道中断，不重复模型调用',async()=>{
  const i=await input(),original=f.backend.agent!;let injected=false;const clock=vi.spyOn(Date,'now');
  try{
   const backend={...f.backend,agent:async(actor:string|null,action:string,data?:Record<string,unknown>)=>{
    if(action==='checkpoint'&&!injected){injected=true;const current=await original(owner,'get',{projectId:i.projectId,id:data!.id});
     await original(owner,'note',{projectId:i.projectId,id:data!.id,note:'改成40人'});clock.mockReturnValue(Date.parse(current.expiresAt)-500);}
    return original(actor,action,data);
   }};
   const fetcher=vi.fn(async()=>completion([tool('submit_candidates',{candidates:[plan()]})]));
   const run=agentRunSchema.parse(await (await send(createApi(backend,env,fetcher),i)).json());
   expect(run.state).toBe('failed');expect(run.errorCode).toBe('AGENT_STEERING_CHANGED');expect(run.candidates).toEqual([]);expect(fetcher).toHaveBeenCalledTimes(1);
  }finally{clock.mockRestore();}
 });

 it('最后一轮收到新要求时不发布旧候选，也不超预算重试',async()=>{
  const i=await input();
  const fetcher=vi.fn(async()=>{
   if(fetcher.mock.calls.length<6)return completion([tool('get_scene',{})]);
   const run=await f.backend.agent!(owner,'by_request',{projectId:i.projectId,requestId:i.requestId});
   await f.backend.agent!(owner,'note',{projectId:i.projectId,id:run.id,note:'改成40人'});
   return completion([tool('submit_candidates',{candidates:[plan()]})]);
  });
  const run=agentRunSchema.parse(await (await send(createApi(f.backend,env,fetcher),i)).json());
  expect(run.state).toBe('failed');expect(run.errorCode).toBe('AGENT_STEERING_CHANGED');expect(run.candidates).toEqual([]);expect(fetcher).toHaveBeenCalledTimes(6);
 });

 it('改道后旧的已验证句柄不再可提交',async()=>{
  const i=await input();let oldHandle='',failure='';
  const fetcher=vi.fn(async(_url,init)=>{
   const body=JSON.parse(String(init?.body));
   if(fetcher.mock.calls.length===1)return completion([tool('validate_candidate',plan())]);
   if(fetcher.mock.calls.length===2){
    oldHandle=JSON.parse(body.messages.filter((m:{role:string})=>m.role==='tool').at(-1).content).validatedId;
    const run=await f.backend.agent!(owner,'by_request',{projectId:i.projectId,requestId:i.requestId});
    await f.backend.agent!(owner,'note',{projectId:i.projectId,id:run.id,note:'人数改为40人'});
    return completion([tool('get_scene',{})]);
   }
   if(fetcher.mock.calls.length===3)return completion([tool('submit_candidates',{candidates:[{validatedId:oldHandle}]})]);
   failure=JSON.parse(body.messages.filter((m:{role:string})=>m.role==='tool').at(-1).content).errors?.[0]?.code;
   return completion([tool('submit_candidates',{candidates:[{title:'待确认',explanation:'需重新核对',commands:[]}]})]);
  });
  await send(createApi(f.backend,env,fetcher),i);
  expect(oldHandle).toBeTruthy();expect(failure).toBe('VALIDATED_CANDIDATE_NOT_FOUND');
 });
});
