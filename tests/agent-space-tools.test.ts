import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {createApi} from '../supabase/functions/_shared/api.ts';
import {agentRunRequestSchema,agentRunSchema} from '../supabase/functions/_shared/agent-contract.ts';
import {sceneSchema,type Scene} from '../supabase/functions/_shared/domain.ts';
import {database,owner,studio,session} from './fixtures.ts';

const env=(key:string)=>({DEEPSEEK_API_KEY:'fixture',TOKENDANCE_API_KEY:'fixture'}[key]);
const id=(n:number)=>`92000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const tool=(name:string,args:unknown)=>({id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}});
const completion=(calls:ReturnType<typeof tool>[])=>new Response(JSON.stringify({choices:[{finish_reason:'tool_calls',message:{content:null,tool_calls:calls}}],usage:{total_tokens:10}}));

/** A room the model has to reason about: walls, a door, a column and one table already standing. */
function room():Scene {
  return sceneSchema.parse({
    schemaVersion:2,
    venue:{shape:'rectangle',width:12,depth:10,height:3.2,heightSource:'confirmed',entrances:[{id:id(90),position:{x:0,z:5},width:1.6}]},
    structure:{
      walls:[
        {id:id(1),start:{x:0,z:0},end:{x:12,z:0},thickness:0.2,height:3.2,kind:'exterior',status:'confirmed'},
        {id:id(2),start:{x:12,z:0},end:{x:12,z:10},thickness:0.2,height:3.2,kind:'exterior',status:'confirmed'},
        {id:id(3),start:{x:12,z:10},end:{x:0,z:10},thickness:0.2,height:3.2,kind:'exterior',status:'confirmed'},
        {id:id(4),start:{x:0,z:0},end:{x:0,z:10},thickness:0.2,height:3.2,kind:'exterior',status:'confirmed'},
      ],
      openings:[{id:id(91),wallId:id(4),kind:'door',offset:4.2,width:1.6,height:2.1,sillHeight:0,status:'confirmed'}],
      columns:[{id:id(6),position:{x:6,z:5},size:{width:0.4,depth:0.4,height:3.2},rotation:0,status:'confirmed'}],
    },
    sources:[],dimensions:[],
    objects:[{id:id(21),materialId:'table',position:{x:2.5,z:2.5},rotation:0,size:{width:1.2,depth:0.6,height:0.75},color:'#ffffff',locked:false,notes:''}],
    camera:'overview',lighting:'neutral',
  });
}

describe('the agent can ask the engine where things fit',()=>{
  let f:Awaited<ReturnType<typeof database>>;
  beforeAll(async()=>{f=await database();},30000);afterAll(async()=>{await f.db.close();});

  async function input(scene:Scene,extra:Record<string,unknown>={}){
    const p=await f.rpc(owner,'projects.create',{studioId:studio,name:'Space tools',scene}),lease=await f.rpc(owner,'lease.acquire',{projectId:p.id,sessionId:session});
    return {projectId:p.id,...agentRunRequestSchema.parse({requestId:crypto.randomUUID(),sessionId:session,generation:lease.generation,expectedRevision:0,localRevision:0,scene,selectedIds:[],instruction:'直接把桌子摆到空地上',executionMode:'direct',...extra})};
  }
  async function send(i:Awaited<ReturnType<typeof input>>,fetcher:typeof fetch){
    const {projectId,...body}=i,response=await createApi(f.backend,env,fetcher)(new Request(`https://api.test/projects/${projectId}/agent-runs`,{method:'POST',headers:{authorization:`Bearer ${owner}`,'content-type':'application/json'},body:JSON.stringify(body)}));
    expect(response.status).toBe(202);return agentRunSchema.parse(await response.json());
  }

  it('sees a plan of the room before it picks coordinates',async()=>{
    const draft=room(),i=await input(draft);
    let opening:{planOverview?:{plan:{lines:string[]};structure:{walls:number};occupancy:{objects:number}}}={};
    let sites:{x:number;z:number}[]=[];
    const fetcher=vi.fn(async(_url:RequestInfo|URL,init?:RequestInit)=>{
      const body=JSON.parse(String(init?.body));
      if(fetcher.mock.calls.length===1){opening=JSON.parse(body.messages[1].content);return completion([tool('find_free_areas',{width:1.2,depth:0.6,clearance:0.5})]);}
      sites=JSON.parse(body.messages.filter((m:{role:string})=>m.role==='tool').pop().content).sites;
      const site=sites[0];
      return completion([tool('submit_candidates',{candidates:[{title:'摆一张桌子',explanation:'放到引擎给出的空位，入口旁留出净距。',commands:[{op:'add',materialId:'table',position:{x:site.x,z:site.z},rotation:0,color:'#ffffff'}]}]})]);
    });
    const run=await send(i,fetcher);
    expect(run.state).toBe('complete');
    // The first message carries a drawn overview, not just raw JSON.
    expect(opening.planOverview?.plan.lines.length).toBeGreaterThan(0);
    expect(opening.planOverview?.structure.walls).toBe(4);
    expect(opening.planOverview?.occupancy.objects).toBe(1);
    // The model placed at the anchor the engine computed, and the editor accepted it.
    expect(sites.length).toBeGreaterThan(0);
    const candidate=run.candidates[0].proposal;
    expect(candidate.warnings).toEqual([]);
    expect(candidate.candidate.objects).toHaveLength(2);
    const placed=candidate.candidate.objects.find(o=>o.id!==id(21))!;
    expect(placed.position.x).toBeCloseTo(sites[0].x,3);
    expect(placed.position.z).toBeCloseTo(sites[0].z,3);
  },30000);

  it('turns a refusal into one next action instead of a bare code',async()=>{
    const draft=room(),i=await input(draft,{selectedIds:[id(21)],instruction:'直接把选中的桌子换个位置'});
    let refusal:{code?:string;hint?:string}={};
    const fetcher=vi.fn(async(_url:RequestInfo|URL,init?:RequestInit)=>{
      const body=JSON.parse(String(init?.body));
      if(fetcher.mock.calls.length===1)return completion([tool('validate_candidate',{title:'挪动',explanation:'尝试移动未选中的物件',commands:[{op:'move',id:id(6),position:{x:4,z:4}}]})]);
      refusal=JSON.parse(body.messages.filter((m:{role:string})=>m.role==='tool').pop().content);
      return completion([tool('submit_candidates',{candidates:[{title:'挪动选中的桌子',explanation:'只改选中的实例。',commands:[{op:'move',id:id(21),position:{x:4,z:4}}]}]})]);
    });
    const run=await send(i,fetcher);
    expect(run.state).toBe('complete');
    expect(refusal.code).toBe('INVALID_SELECTION');
    expect(refusal.hint).toContain('selectedIds');
    expect(run.candidates[0].proposal.candidate.objects.find(o=>o.id===id(21))?.position).toEqual({x:4,z:4});
  },30000);

  it('进度报的是阶段，不是第几次模型调用',async()=>{
    const draft=room(),i=await input(draft);
    // 抓运行器写给界面的每一行进度：step 是轮首那一行，progress 是每次工具调用那一行。
    const steps:string[]=[];
    const backend={...f.backend,agent:async(a:string|null,action:string,data:Record<string,unknown>|undefined)=>{
      if((action==='step'||action==='progress')&&typeof data?.progress==='string')steps.push(data.progress);
      return f.backend.agent!(a,action,data);
    }};
    const fetcher=vi.fn(async(_url:RequestInfo|URL,init?:RequestInit)=>{
      const body=JSON.parse(String(init?.body));
      if(fetcher.mock.calls.length===1)return completion([tool('find_free_areas',{width:1.2,depth:0.6,clearance:0.5})]);
      const sites=JSON.parse(body.messages.filter((m:{role:string})=>m.role==='tool').pop().content).sites;
      return completion([tool('submit_candidates',{candidates:[{title:'摆一张桌子',explanation:'放到引擎给出的空位。',commands:[{op:'add',materialId:'table',position:{x:sites[0].x,z:sites[0].z},rotation:0,color:'#ffffff'}]}]})]);
    });
    const {projectId,...body}=i;
    const response=await createApi(backend,env,fetcher)(new Request(`https://api.test/projects/${projectId}/agent-runs`,{method:'POST',headers:{authorization:`Bearer ${owner}`,'content-type':'application/json'},body:JSON.stringify(body)}));
    expect(response.status).toBe(202);

    const stepLines=steps.filter(line=>line.includes('阶段'));
    // 每一轮开头都是一行阶段进度，且轮数在尾部作为预算读数保留。
    // 这一趟在第 2 轮就交付了，所以只有两行：第 1 轮看现状，第 2 轮已推进到定落点。
    expect(stepLines).toEqual([
      '第 1/4 阶段 · 看现状 · 第 1/6 轮',
      '第 2/4 阶段 · 定落点 · 第 2/6 轮',
    ]);
    // 阶段没有被阶段行写到的部分，靠每次工具调用那一行补齐——交付那一步必须看得见。
    expect(steps).toContain('正在整理候选方案');
    // 旧的「DeepSeek 正在处理（N/6）」这种只有机器账、没有工作含义的行不应该再出现。
    expect(steps.some(line=>line.includes('DeepSeek 正在处理'))).toBe(false);
  },30000);

  it('通过时回实测净距，不通过时指出第几条命令',async()=>{
    const draft=room(),i=await input(draft);
    let passed:{valid?:boolean;clearances?:{id:string;gap:number;nearest:{kind:string}}[]}={};
    let refused:{valid?:boolean;failedCommand?:number|null;issues?:{code?:string}[]}={};
    const fetcher=vi.fn(async(_url:RequestInfo|URL,init?:RequestInit)=>{
      const body=JSON.parse(String(init?.body));
      const lastTool=()=>JSON.parse(body.messages.filter((m:{role:string})=>m.role==='tool').pop().content);
      if(fetcher.mock.calls.length===1)return completion([tool('validate_candidate',{
        title:'两件一起摆',
        explanation:'先试算再加。',
        commands:[
          {op:'add',materialId:'table',position:{x:8,z:3},rotation:0,color:'#ffffff'},
          {op:'remove',id:id(77)},
        ],
      })]);
      if(fetcher.mock.calls.length===2){refused=lastTool();return completion([tool('validate_candidate',{
        title:'只摆桌子',
        explanation:'去掉不存在的那条命令。',
        commands:[{op:'add',materialId:'table',position:{x:8,z:3},rotation:0,color:'#ffffff'}],
      })]);}
      passed=lastTool();
      return completion([tool('submit_candidates',{candidates:[{title:'摆一张桌子',explanation:'通道留足。',commands:[{op:'add',materialId:'table',position:{x:8,z:3},rotation:0,color:'#ffffff'}]}]})]);
    });
    const run=await send(i,fetcher);
    expect(run.state).toBe('complete');
    // 第一条命令是好的，第二条删的是不存在的物件——回执必须指向第 2 条，而不是只说不合法。
    expect(refused.valid).toBe(false);
    expect(refused.failedCommand).toBe(2);
    expect(refused.issues?.[0]?.code).toBeTruthy();
    // 通过时给的是实测净距：引擎量的数，模型不必再猜通道够不够。
    expect(passed.valid).toBe(true);
    expect(passed.clearances?.length).toBe(1);
    expect(passed.clearances?.[0].gap).toBeGreaterThan(0);
    expect(['object','wall','column','edge']).toContain(passed.clearances?.[0].nearest.kind);
  },30000);
});
