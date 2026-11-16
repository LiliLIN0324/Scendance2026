import {afterAll,afterEach,beforeAll,describe,expect,it} from 'vitest';
import {database,owner,studio,session,scene} from './fixtures.ts';
import {agentRunRequestSchema} from '../supabase/functions/_shared/agent-contract.ts';

/**
 * 运行行卫生（20261116120000）：
 *  - 读到期的运行不能靠锁，且只能收敛一次；
 *  - 有进展就续期，但总寿命有上限；
 *  - 收尾时把「扣了钱但没回报用量」的步退掉，且不能重复退；
 *  - 事件追加不动运行行，seq 仍连续。
 *
 * 这里测的是语义；行锁竞争需要真实并发，pglite 单连接测不了。
 */
describe('agent run 状态卫生',()=>{
  let f:Awaited<ReturnType<typeof database>>;
  beforeAll(async()=>{f=await database();},30000);
  afterAll(async()=>{await f.db.close();});
  // 每个用例自己收尾；否则下一个用例会被 AI_BUSY 挡住（每个 owner 同时只允许一趟）。
  afterEach(async()=>{
    await f.db.query("update scene_private.agent_runs set state='cancelled',deadline=clock_timestamp() where owner_id=$1 and state in ('queued','running')",[owner]);
  });

  // fixtures 里的 agent/agentEvents 是可选字段；这里统一收口，避免每个调用点写断言。
  const agent=(action:string,data:Record<string,unknown>)=>f.backend.agent!(owner,action,data);
  const agentEvents=(action:string,data:Record<string,unknown>)=>f.backend.agentEvents!(owner,action,data);

  async function setup(instruction='摆放椅子'){
    const base=scene();
    const p=await f.rpc(owner,'projects.create',{studioId:studio,name:'Hygiene',scene:base});
    const lease=await f.rpc(owner,'lease.acquire',{projectId:p.id,sessionId:session});
    const input=agentRunRequestSchema.parse({requestId:crypto.randomUUID(),sessionId:session,generation:lease.generation,
      expectedRevision:0,localRevision:0,scene:base,selectedIds:[],instruction,executionMode:'preview'});
    const created=await agent('create',{projectId:p.id,input,fingerprint:'f'.repeat(64),baseHash:'b'.repeat(64),executionMode:'preview'});
    const started=await agent('start',{projectId:p.id,id:created.id});
    expect(started.claimed).toBe(true);
    return {projectId:p.id,id:created.id as string,claim:started.claim as string};
  }

  const row=async(id:string)=>{
    const {rows}=await f.db.query<{state:string;deadline:Date;committed_cents:string;call_count:number;error_code:string|null}>(
      'select state,deadline,committed_cents::text,call_count,error_code from scene_private.agent_runs where id=$1',[id]);
    return rows[0]!;
  };
  const budget=async()=>{
    const {rows}=await f.db.query<{c:string}>(
      "select coalesce(sum(committed_cents),0)::text as c from scene_private.text_daily_budgets where usage_day=(clock_timestamp() at time zone 'Asia/Shanghai')::date");
    return Number(rows[0]!.c);
  };
  const milliseconds=(value:Date|string)=>new Date(value).getTime();

  it('step 续期 deadline，读到活着的运行不改状态',async()=>{
    const {projectId,id,claim}=await setup();
    const before=await row(id);
    await agent('step',{projectId,id,claim,progress:'正在读取场景'});
    const after=await row(id);
    expect(milliseconds(after.deadline)).toBeGreaterThan(milliseconds(before.deadline));
    expect(after.call_count).toBe(1);
    expect(after.committed_cents).toBe('20');
    const read=await agent('get',{projectId,id});
    expect(read.state).toBe('running');
    expect(milliseconds((await row(id)).deadline)).toBe(milliseconds(after.deadline));
  });

  it('到期只收敛一次，并退掉没有用量回报的步',async()=>{
    const {projectId,id,claim}=await setup();
    await agent('step',{projectId,id,claim,progress:'调用模型'});
    const charged=await budget();
    await f.db.query("update scene_private.agent_runs set deadline=clock_timestamp()-interval '1 second' where id=$1",[id]);

    const first=await agent('get',{projectId,id});
    expect(first.state).toBe('failed');
    expect(first.errorCode).toBe('AGENT_DEADLINE');
    expect((await row(id)).committed_cents).toBe('0');
    expect(await budget()).toBe(charged-20);

    // 第二次读不能把同一笔钱再退一次。
    const second=await agent('get',{projectId,id});
    expect(second.state).toBe('failed');
    expect((await row(id)).committed_cents).toBe('0');
    expect(await budget()).toBe(charged-20);
  });

  it('fail 只为没有用量回报的步退款',async()=>{
    const {projectId,id,claim}=await setup();
    await agent('step',{projectId,id,claim,progress:'第一次'});
    await agent('step',{projectId,id,claim,progress:'第二次'});
    const charged=await budget();
    expect(charged).toBeGreaterThanOrEqual(40);
    await agent('usage',{projectId,id,claim,usage:{provider:'default',turn:1,usage:{total_tokens:5}}});
    const failed=await agent('fail',{projectId,id,claim,errorCode:'AGENT_FAILED'});
    expect(failed.state).toBe('failed');
    // 两步扣 40，只有一步回报了用量 → 退一步。
    expect((await row(id)).committed_cents).toBe('20');
    expect(await budget()).toBe(charged-20);
    // 收尾后再 fail 会被守卫拒绝（AGENT_RUN_STOPPED），因此不可能退第二次。
    await expect(agent('fail',{projectId,id,claim,errorCode:'AGENT_FAILED'})).rejects.toThrow(/AGENT_RUN_STOPPED/);
    expect((await row(id)).committed_cents).toBe('20');
    expect(await budget()).toBe(charged-20);
  });

  it('cancel 退掉没有用量回报的步',async()=>{
    const {projectId,id,claim}=await setup();
    await agent('step',{projectId,id,claim,progress:'调用模型'});
    const charged=await budget();
    const cancelled=await agent('cancel',{projectId,id});
    expect(cancelled.state).toBe('cancelled');
    expect((await row(id)).committed_cents).toBe('0');
    expect(await budget()).toBe(charged-20);
  });

  it('事件追加不动 deadline，seq 连续',async()=>{
    const {projectId,id,claim}=await setup();
    const before=(await row(id)).deadline;
    const one=await agentEvents('append',{projectId,id,claim,event:{tool:'get_scene',stage:'started'}});
    const two=await agentEvents('append',{projectId,id,claim,event:{tool:'get_scene',stage:'finished',outcome:'success'}});
    expect(one.seq).toBe(1);
    expect(two.seq).toBe(2);
    expect(milliseconds((await row(id)).deadline)).toBe(milliseconds(before));
    const list=await agentEvents('list',{projectId,id,after:0});
    expect(list.events.map((event:{seq:number})=>event.seq)).toEqual([1,2]);
  });

  it('slim 只裁运行中的候选，终态照旧回全量',async()=>{
    const {projectId,id,claim}=await setup();
    const candidate={label:'A',title:'方案 A',scene:scene(),explanation:'同场景',warnings:[]};
    const saved=await agent('checkpoint',{projectId,id,claim,steerTotal:0,candidates:[candidate]});
    expect(saved.state).toBe('running');
    expect(saved.candidates).toHaveLength(1);

    // 轮询要摘要：运行中不回整包场景，但字段齐全（客户端 schema 仍能解析）。
    const slim=await agent('get',{projectId,id,slim:true});
    expect(slim.state).toBe('running');
    expect(slim.candidates).toEqual([]);
    expect(slim.planCandidates).toEqual([]);
    expect(slim.progress).toBe(saved.progress);
    // 不带 slim 的调用方（恢复、旧客户端）语义不变。
    expect((await agent('get',{projectId,id})).candidates).toHaveLength(1);

    const finished=await agent('finish',{projectId,id,claim,steerTotal:0});
    expect(finished.state).toBe('complete');
    // 终态即使带了 slim 也必须回全量，否则确认卡会误报「没有候选」。
    expect((await agent('get',{projectId,id,slim:true})).candidates).toHaveLength(1);
  });

  it('内部活动体不经匿名入口暴露',async()=>{
    const {rows}=await f.db.query<{anon:boolean;authenticated:boolean;service:boolean}>(
      "select has_function_privilege('anon','public.agent_rpc_activity_unguarded(uuid,text,jsonb)','EXECUTE') as anon,"+
      "has_function_privilege('authenticated','public.agent_rpc_activity_unguarded(uuid,text,jsonb)','EXECUTE') as authenticated,"+
      "has_function_privilege('service_role','public.agent_rpc_activity_unguarded(uuid,text,jsonb)','EXECUTE') as service");
    expect(rows[0]).toEqual({anon:false,authenticated:false,service:true});
    const pub=await f.db.query<{service:boolean;anon:boolean}>(
      "select has_function_privilege('service_role','public.agent_rpc(uuid,text,jsonb)','EXECUTE') as service,"+
      "has_function_privilege('anon','public.agent_rpc(uuid,text,jsonb)','EXECUTE') as anon");
    expect(pub.rows[0]).toEqual({service:true,anon:false});
  });
});
