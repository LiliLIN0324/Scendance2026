import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {createApi} from '../supabase/functions/_shared/api.ts';
import {agentRunRequestSchema,agentRunSchema} from '../supabase/functions/_shared/agent-contract.ts';
import {database,owner,scene,session,studio} from './fixtures.ts';

const env:Record<string,string>={AGENT_CHAT_PROFILE:'minimax',MINIMAX_AGENT_TOOLS_ENABLED:'1',AGENT_CHAT_BASE_URL:'https://api.minimax.cn/v1',AGENT_CHAT_KEY:'fixture',AGENT_CHAT_MODEL:'MiniMax-M3.1-Flash'};
const call=(id:string,name:string,args:unknown)=>({id,type:'function',index:0,function:{name,arguments:JSON.stringify(args)}});
const toolReply=(calls:ReturnType<typeof call>[])=>Response.json({base_resp:{status_code:0},choices:[{finish_reason:'tool_calls',message:{role:'assistant',content:null,tool_calls:calls}}],usage:{total_tokens:10}});
const stopReply=(content:string)=>Response.json({base_resp:{status_code:0},choices:[{finish_reason:'stop',message:{role:'assistant',content,tool_calls:[]}}],usage:{total_tokens:10}});
const emptyCandidate={title:'待核验',explanation:'需要更多信息。',commands:[]};
const layout={layout:'one_desk_one_chair',count:1,deskSize:{width:.6,depth:.45,height:.75},chairSize:{width:.49,depth:.57,height:.9},deskChairGap:.1,columnGap:.3,rowGap:.5,edgeClearance:.3};

describe('MiniMax agent handoff: nudges and deadline',()=>{
 let f:Awaited<ReturnType<typeof database>>;
 beforeAll(async()=>{f=await database();},30000);
 afterAll(async()=>{await f.db.close();});
 async function setup(){
  const initial=scene(),project=await f.rpc(owner,'projects.create',{studioId:studio,name:'催办与收尾测试',scene:initial}),lease=await f.rpc(owner,'lease.acquire',{projectId:project.id,sessionId:session});
  return {project,initial,input:agentRunRequestSchema.parse({requestId:crypto.randomUUID(),sessionId:session,generation:lease.generation,expectedRevision:0,localRevision:0,scene:initial,selectedIds:[],instruction:'先探索布局',executionMode:'preview'})};
 }
 async function send(i:Awaited<ReturnType<typeof setup>>,fetcher:typeof fetch,agentClock?:()=>number){
  const backend=agentClock?{...f.backend,agentClock}:f.backend;
  const api=createApi(backend,key=>env[key],fetcher);
  const response=await api(new Request(`https://api.test/projects/${i.project.id}/agent-runs`,{method:'POST',headers:{authorization:`Bearer ${owner}`,'content-type':'application/json'},body:JSON.stringify(i.input)}));
  expect(response.status).toBe(202);return agentRunSchema.parse(await response.json());
 }

 it('nudges a plain-text first reply, then accepts the submitted candidate',async()=>{
  const i=await setup();
  const fetcher=vi.fn(async()=>{
   if(fetcher.mock.calls.length===1)return stopReply('建议在角落放一把椅子。');
   return toolReply([call('submit-1','submit_candidates',{candidates:[emptyCandidate]})]);
  });
  const run=await send(i,fetcher);
  expect(run.state).toBe('complete');expect(run.candidates).toHaveLength(1);expect(fetcher).toHaveBeenCalledTimes(2);
 });

 it('fails with a downgrade message after more than two plain-text turns',async()=>{
  const i=await setup();
  const fetcher=vi.fn(async()=>stopReply('还需要再想一下。'));
  const run=await send(i,fetcher);
  expect(run.state).toBe('failed');expect(run.errorCode).toBe('AGENT_SUBMIT_NOT_REACHED');
  expect(run.message).toContain('文字回复');expect(fetcher).toHaveBeenCalledTimes(3);
 });

 it('fails descriptively with no candidate when the budget is already spent at round start',async()=>{
  const i=await setup();
  const fetcher=vi.fn(async()=>toolReply([call('scene','get_scene',{})]));
  const run=await send(i,fetcher,()=>Date.now()+100_000);
  expect(run.state).toBe('failed');expect(run.errorCode).toBe('AGENT_INCOMPLETE');
  expect(run.message).toContain('阶段');expect(fetcher).not.toHaveBeenCalled();
 });

 it('keeps a prepared seating draft when the budget runs out mid-run',async()=>{
  const i=await setup();
  let clockMs=Date.now();
  const fetcher=vi.fn(async()=>{
   if(fetcher.mock.calls.length===1){
    clockMs=Date.now()+80_000;
    return toolReply([call('prepare-1','prepare_seating_candidate',layout)]);
   }
   throw new Error('budget handoff should not start another model round');
  });
  const run=await send(i,fetcher,()=>clockMs);
  expect(run.state).toBe('complete');expect(run.candidates).toHaveLength(1);
  expect(run.message).toContain('提交 1 个');expect(fetcher).toHaveBeenCalledTimes(1);
 });
});
