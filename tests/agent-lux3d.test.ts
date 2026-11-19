import { afterAll,beforeAll,beforeEach,describe,expect,it,vi } from 'vitest';
import { createApi } from '../supabase/functions/_shared/api.ts';
import { agentRunRequestSchema,agentRunSchema } from '../supabase/functions/_shared/agent-contract.ts';
import { database,owner,studio,session,scene } from './fixtures.ts';
import type { Env } from '../supabase/functions/_shared/http.ts';

const baseEnv:Record<string,string>={
  TOKENDANCE_API_KEY:'fixture',DEEPSEEK_AGENT_MODE:'tools',GENERATION_MAX_TASK_CENTS:'100',
  LUX3D_API_KEY:'lux-key',LUX3D_TERMS_URL:'https://example.test/aholo-terms',LUX3D_TERMS_REVIEWED_AT:'2026-10-28',
  HUNYUAN_API_KEY:'test',HUNYUAN_TERMS_URL:'https://example.test/terms',HUNYUAN_TERMS_REVIEWED_AT:'2026-10-03',
};
const env=(over:Record<string,string|undefined>={}):Env=>key=>({ ...baseEnv, ...over })[key];
const tool=(name:string,args:unknown)=>({id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}});
const completion=(calls:ReturnType<typeof tool>[])=>new Response(JSON.stringify({choices:[{finish_reason:'tool_calls',message:{content:null,tool_calls:calls}}],usage:{total_tokens:10}}));
const candidate=()=>({title:'等待生成确认',explanation:'定制物件的生成需求已准备，待用户在物料生成面板单独确认；尚未创建任务。',commands:[]});

describe('agent start_lux3d_model tool (T-AHOLO-UI 形态②)',()=>{
  let f:Awaited<ReturnType<typeof database>>;
  beforeAll(async()=>{f=await database();},30000);
  beforeEach(async()=>{await f.db.exec('delete from scene_private.generation_jobs;');});
  afterAll(async()=>{await f.db.close();});
  async function input() {
    const draft=scene();
    const p=await f.rpc(owner,'projects.create',{studioId:studio,name:'Lux3D tool',scene:draft});
    const lease=await f.rpc(owner,'lease.acquire',{projectId:p.id,sessionId:session});
    return {projectId:p.id,...agentRunRequestSchema.parse({requestId:crypto.randomUUID(),sessionId:session,generation:lease.generation,expectedRevision:0,localRevision:4,scene:draft,selectedIds:[],instruction:'帮我生成一个雕花木质讲台',executionMode:'preview'})};
  }
  async function send(i:Awaited<ReturnType<typeof input>>,fetcher:typeof fetch,envOver:Record<string,string|undefined>={}) {
    const {projectId,...body}=i,response=await createApi(f.backend,env(envOver),fetcher)(new Request(`https://api.test/projects/${projectId}/agent-runs`,{method:'POST',headers:{authorization:`Bearer ${owner}`,'content-type':'application/json'},body:JSON.stringify(body)}));
    expect(response.status).toBe(202);return agentRunSchema.parse(await response.json());
  }
  const toolNames=(init?:RequestInit)=>JSON.parse(String(init?.body)).tools.map((t:{function:{name:string}})=>t.function.name);

  it.each(['preview','direct'] as const)('自主权限：%s模式只准备生成需求，不将模型工具调用当成付费确认',async mode=>{
    const i=await input();
    const seen:{tools?:string[]}[]=[];let submitted:Record<string,unknown>|undefined;
    const fetcher=vi.fn(async(_url:RequestInfo|URL,init?:RequestInit)=>{
      seen.push({tools:toolNames(init)});
      if(fetcher.mock.calls.length===1)return completion([tool('start_lux3d_model',{prompt:'雕花木质讲台'})]);
      const toolMsgs=JSON.parse(String(init?.body)).messages.filter((m:{role:string})=>m.role==='tool');
      submitted=JSON.parse(toolMsgs[0].content);
      return completion([tool('submit_candidates',{candidates:[candidate()]})]);
    });
    const run=await send({...i,executionMode:mode},fetcher);
    expect(seen[0]!.tools).toContain('start_lux3d_model');
    expect(submitted).toMatchObject({submitted:false,confirmationRequired:true,prompt:'雕花木质讲台'});
    expect(submitted).not.toHaveProperty('jobId');
    const jobs=await f.db.query('select * from scene_private.generation_jobs where prompt=$1',['雕花木质讲台']);
    expect(jobs.rows).toHaveLength(0);
    expect(run.state).toBe('complete');expect(run.candidates).toHaveLength(1);
  });
  it('自主权限：非MiniMax模型也不能调用本轮未开放工具，整批先拒绝且不执行其他动作',async()=>{
    const i=await input();let results:Array<{code:string}>=[];
    const fetcher=vi.fn(async(_url:RequestInfo|URL,init?:RequestInit)=>{
      if(fetcher.mock.calls.length===1)return completion([tool('get_scene',{}),tool('start_lux3d_model',{prompt:'未授权生成'})]);
      results=JSON.parse(String(init?.body)).messages.filter((m:{role:string})=>m.role==='tool').map((m:{content:string})=>JSON.parse(m.content));
      return completion([tool('submit_candidates',{candidates:[candidate()]})]);
    });
    const run=await send(i,fetcher,{LUX3D_API_KEY:undefined});
    expect(results.map(result=>result.code)).toEqual(['AGENT_BATCH_NOT_EXECUTED','UNKNOWN_TOOL']);
    expect(run.state).toBe('complete');
    const jobs=await f.db.query<{n:number}>('select count(*)::int as n from scene_private.generation_jobs');
    expect(jobs.rows[0].n).toBe(0);
  });
  it('hides the tool and never submits when the vendor is unconfigured',async()=>{
    const i=await input();
    let sawTool=true;
    const fetcher=vi.fn(async(_url:RequestInfo|URL,init?:RequestInit)=>{
      sawTool=toolNames(init).includes('start_lux3d_model');
      return completion([tool('submit_candidates',{candidates:[candidate()]})]);
    });
    const run=await send(i,fetcher,{LUX3D_API_KEY:undefined});
    expect(sawTool).toBe(false);
    expect(run.state).toBe('complete');
    const jobs=await f.db.query<{n:number}>('select count(*)::int as n from scene_private.generation_jobs');
    expect(jobs.rows[0]!.n).toBe(0);
  });
});
