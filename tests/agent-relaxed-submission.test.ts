import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {database,owner,studio,session,scene} from './fixtures.ts';
import {createApi} from '../supabase/functions/_shared/api.ts';
import {agentRunRequestSchema,agentRunSchema} from '../supabase/functions/_shared/agent-contract.ts';
import {wantsAlternativePlans} from '../supabase/functions/_shared/agent-runner.ts';
const env=(key:string)=>({DEEPSEEK_API_KEY:'fixture',TOKENDANCE_API_KEY:'fixture',HY3_RETIRED:'true'}[key]);
const plan=(x:number)=>({title:`布局 ${x}`,explanation:'已规划桌子，待程序应用。',commands:[{op:'add',materialId:'table',position:{x,z:3},rotation:0,color:'#ffffff'}]});
const tool=(name:string,args:unknown,id:string=crypto.randomUUID())=>({id,type:'function',function:{name,arguments:JSON.stringify(args)}});
const completion=(calls:ReturnType<typeof tool>[])=>new Response(JSON.stringify({choices:[{finish_reason:'tool_calls',message:{content:null,tool_calls:calls}}],usage:{total_tokens:10}}));
const text=(content:string)=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content}}],usage:{total_tokens:5}}));

describe('候选数与只回话：放宽产品规则，不放宽句柄与白名单',()=>{
 let f:Awaited<ReturnType<typeof database>>;
 beforeAll(async()=>{f=await database();},60000);afterAll(async()=>{await f.db.close();});
 async function input(extra:Record<string,unknown>={}) {
  const base=scene(),p=await f.rpc(owner,'projects.create',{studioId:studio,name:'Relaxed test',scene:base});
  const lease=await f.rpc(owner,'lease.acquire',{projectId:p.id,sessionId:session});
  return {projectId:p.id,...agentRunRequestSchema.parse({requestId:crypto.randomUUID(),sessionId:session,generation:lease.generation,expectedRevision:0,localRevision:0,scene:base,selectedIds:[],instruction:'直接添加桌子',executionMode:'preview',...extra})};
 }
 const send=(api:ReturnType<typeof createApi>,i:Awaited<ReturnType<typeof input>>)=>{
  const {projectId,...body}=i;
  return api(new Request(`https://api.test/projects/${projectId}/agent-runs`,{method:'POST',headers:{authorization:`Bearer ${owner}`,'content-type':'application/json'},body:JSON.stringify(body)}));
 };
 it('只回话的一趟以答复收尾，不伪造候选，也不算失败',async()=>{
  const i=await input();
  const fetcher=vi.fn(async()=>fetcher.mock.calls.length===1?text('需要先确认场地入口在哪一侧。'):text('入口在东侧，我会按东侧入口排布。'));
  const run=agentRunSchema.parse(await (await send(createApi(f.backend,env,fetcher),i)).json());
  expect(run.state).toBe('complete');expect(run.errorCode).toBeUndefined();
  expect(run.candidates).toEqual([]);expect(run.message).toBe('入口在东侧，我会按东侧入口排布。');
  expect(fetcher).toHaveBeenCalledTimes(2);
 });
 it('JEV 多方案允许一轮一轮增量提交，收满三份才结束',async()=>{
  const i=await input({jevEnabled:true});
  const fetcher=vi.fn(async()=>completion([tool('submit_candidates',{candidates:[plan(2+fetcher.mock.calls.length*2)]})]));
  const run=agentRunSchema.parse(await (await send(createApi(f.backend,env,fetcher),i)).json());
  expect(run.state).toBe('complete');expect(run.candidates).toHaveLength(3);
  expect(run.candidates.map(candidate=>candidate.label)).toEqual(['A','B','C']);
  // 三次提交各一轮；收满后才额外跑一次 JEV 评价（同一个 fetch 桩）。
  expect(fetcher).toHaveBeenCalledTimes(4);
 });
 it('默认只要一版：交一份就结束，不追着要三份',async()=>{
  const i=await input();
  const fetcher=vi.fn(async()=>completion([tool('submit_candidates',{candidates:[plan(2)]})]));
  const run=agentRunSchema.parse(await (await send(createApi(f.backend,env,fetcher),i)).json());
  expect(run.state).toBe('complete');expect(run.candidates).toHaveLength(1);expect(fetcher).toHaveBeenCalledTimes(1);
 });
 it('priorRun 只作为承接信息进入首条消息，仍是当前草稿起算',async()=>{
  const i=await input({context:{brief:'',acceptedDecisions:[],recentMessages:[],priorRun:{id:'prior-run',finishedSteps:['get_scene','find_free_areas'],pendingSteps:['布置剩余展位'],candidateTitles:['方案 A'],errorCodes:['OUT_OF_BOUNDS'],objectCount:2}}});
  let first='';
  const fetcher=vi.fn(async(_url,init)=>{
   if(fetcher.mock.calls.length===1){first=String(init?.body);return completion([tool('submit_candidates',{candidates:[plan(2)]})]);}
   return completion([tool('submit_candidates',{candidates:[plan(2)]})]);
  });
  const run=agentRunSchema.parse(await (await send(createApi(f.backend,env,fetcher),i)).json());
  expect(run.state).toBe('complete');
  expect(first).toContain('布置剩余展位');expect(first).toContain('OUT_OF_BOUNDS');expect(first).toContain('find_free_areas');
 });
 it('只有明确要多个方案时才按多方案收',()=>{
  expect(wantsAlternativePlans('给我三个方案')).toBe(true);
  expect(wantsAlternativePlans('出两版对比一下')).toBe(true);
  expect(wantsAlternativePlans('先做一版')).toBe(false);
  expect(wantsAlternativePlans('加三把椅子')).toBe(false);
  expect(wantsAlternativePlans('只要一版，不要多个方案')).toBe(false);
 });
});
