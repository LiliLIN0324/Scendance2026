import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {database,owner,studio,session,scene} from './fixtures.ts';
import {createApi} from '../supabase/functions/_shared/api.ts';
import {agentRunRequestSchema,agentRunSchema} from '../supabase/functions/_shared/agent-contract.ts';
import {AGENT_PHASES} from '../supabase/functions/_shared/agent-progress.ts';

/**
 * 阶段落库（第 13 批）：阶段不只是进度串里的文字，它得是一个字段。
 *
 * 这一组钉三件事：
 *  1. 阶段真的落在运行行上——界面顶卡要单独显示「第 2/4 阶段 · 定落点」，
 *     就不能靠解析最后一行文案；
 *  2. 刷新页面重新读档还看得到（行上的值还在）；
 *  3. 阶段只前进不后退——模型回头看细节时，落库读数不能倒退。
 */
const env=(key:string)=>({DEEPSEEK_API_KEY:'fixture',TOKENDANCE_API_KEY:'fixture',HY3_RETIRED:'true'}[key]);
const tool=(name:string,args:unknown)=>({id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}});
const completion=(calls:ReturnType<typeof tool>[])=>new Response(JSON.stringify({choices:[{finish_reason:'tool_calls',message:{content:null,tool_calls:calls}}],usage:{total_tokens:10}}));
const plan=()=>({title:'布局',explanation:'已规划桌子，待程序应用。',commands:[{op:'add',materialId:'table',position:{x:2,z:3},rotation:0,color:'#ffffff'}]});
/** 阶段在表里的次序：越大越靠后。 */
const rank=(phase:string|null)=>{const index=AGENT_PHASES.indexOf(phase as never);return index<0?-1:index;};

describe('阶段落库与续看',()=>{
  let f:Awaited<ReturnType<typeof database>>;
  beforeAll(async()=>{f=await database();},30000);
  afterAll(async()=>{await f.db.close();});
  async function input() {
    const base=scene(),p=await f.rpc(owner,'projects.create',{studioId:studio,name:'Phase test',scene:base});
    const lease=await f.rpc(owner,'lease.acquire',{projectId:p.id,sessionId:session});
    return {projectId:p.id,...agentRunRequestSchema.parse({requestId:crypto.randomUUID(),sessionId:session,generation:lease.generation,expectedRevision:0,localRevision:0,scene:base,selectedIds:[],instruction:'直接添加桌子',executionMode:'direct'})};
  }
  const send=(api:ReturnType<typeof createApi>,i:Awaited<ReturnType<typeof input>>)=>{
    const {projectId,...body}=i;
    return api(new Request(`https://api.test/projects/${projectId}/agent-runs`,{method:'POST',headers:{authorization:`Bearer ${owner}`,'content-type':'application/json'},body:JSON.stringify(body)}));
  };
  const read=(api:ReturnType<typeof createApi>,projectId:string,runId:string)=>
    api(new Request(`https://api.test/projects/${projectId}/agent-runs/${runId}`,{headers:{authorization:`Bearer ${owner}`}}));
  /** 读运行行上的阶段——这是界面顶卡拿到的那个真值。 */
  const phaseOnRow=async(requestId:string)=>{
    const {rows}=await f.db.query<{phase:string|null}>('select phase from scene_private.agent_runs where request_key=$1',[requestId]);
    return rows[0]?.phase??null;
  };

  it('阶段落在行上，重新读档还看得到',async()=>{
    const i=await input();
    const fetcher=vi.fn(async()=>{
      if(fetcher.mock.calls.length===1)return completion([tool('get_scene',{})]);
      if(fetcher.mock.calls.length===2)return completion([tool('find_free_areas',{width:1.2,depth:1.2})]);
      return completion([tool('submit_candidates',{candidates:[plan()]})]);
    });
    const api=createApi(f.backend,env,fetcher);
    const run=agentRunSchema.parse(await (await send(api,i)).json());
    expect(run.state).toBe('complete');
    // 最后一步是 submit_candidates → 交付阶段。
    expect(run.phase).toBe('deliver');
    // 行上真的有这一列，不是只在内存里算了一遍。
    expect(await phaseOnRow(i.requestId)).toBe('deliver');
    // 刷新页面重新读档：阶段还在，这才叫「可续看」。
    const again=agentRunSchema.parse(await (await read(api,i.projectId,run.id)).json());
    expect(again.phase).toBe('deliver');
  });

  it('回头看细节不算退步：落库读数只前进不后退',async()=>{
    const i=await input();
    const seen:(string|null)[]=[];
    const fetcher=vi.fn(async()=>{
      // 模型桩每次被叫到时，行上的阶段就是此刻界面上会显示的那个。
      seen.push(await phaseOnRow(i.requestId));
      if(fetcher.mock.calls.length===1)return completion([tool('get_scene',{})]);
      if(fetcher.mock.calls.length===2)return completion([tool('validate_candidate',plan())]);
      if(fetcher.mock.calls.length===3)return completion([tool('get_scene',{})]);
      return completion([tool('submit_candidates',{candidates:[plan()]})]);
    });
    const api=createApi(f.backend,env,fetcher);
    const run=agentRunSchema.parse(await (await send(api,i)).json());
    expect(run.state).toBe('complete');
    // 读过现状、试算过方案之后，模型又回头读了一次现状——阶段不能退回「看现状」。
    expect(seen).toContain('compose');
    const firstCompose=seen.indexOf('compose');
    expect(firstCompose).toBeGreaterThanOrEqual(0);
    expect(seen.slice(firstCompose)).not.toContain('survey');
    const ranks=seen.map(rank);
    expect(ranks).toEqual([...ranks].sort((a,b)=>a-b));
    // 最后仍然是交付阶段。
    expect(run.phase).toBe('deliver');
  });

  it('老记录没有阶段时，界面拿不到就不显示（不拿轮数顶替）',async()=>{
    const i=await input();
    const api=createApi(f.backend,env,vi.fn(async()=>completion([tool('submit_candidates',{candidates:[plan()]})])));
    const run=agentRunSchema.parse(await (await send(api,i)).json());
    // 这一趟跑过，阶段一定有；但把 phase 抹掉模拟「没有阶段账的老记录」，
    // 契约必须接受（可空可选），而不是报错。
    await f.db.query('update scene_private.agent_runs set phase=null where request_key=$1',[i.requestId]);
    const again=agentRunSchema.parse(await (await read(api,i.projectId,run.id)).json());
    expect(again.phase).toBeNull();
  });
});
