import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {database,owner,studio,session,scene} from './fixtures.ts';
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
});
