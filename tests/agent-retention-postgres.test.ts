import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {database,owner,studio,session,scene} from './fixtures.ts';

/**
 * 保留期与删号（20261116130000）：
 *  - 只清终态且过期的运行，queued/running 一律不动；
 *  - 只清「已过期且未应用」的 proposal，且留出宽限期；
 *  - 删账号不再被外键挡住，业务记录保留、个人标识置空。
 */
describe('agent 数据保留期与删号',()=>{
  let f:Awaited<ReturnType<typeof database>>;
  let projectId:string;
  beforeAll(async()=>{
    f=await database();
    const p=await f.rpc(owner,'projects.create',{studioId:studio,name:'Retention',scene:scene()});
    projectId=p.id;
  },30000);
  afterAll(async()=>{await f.db.close();});

  const insertRun=async(options:{state:string;ageDays:number;ownerId?:string})=>{
    const id=crypto.randomUUID();
    await f.db.query(
      `insert into scene_private.agent_runs(id,owner_id,project_id,request_key,fingerprint,input,base_hash,state,execution_mode,created_at,deadline)
       values($1,$2,$3,$4,'f','{}'::jsonb,'b',$5,'preview',clock_timestamp()-make_interval(days=>$6),clock_timestamp()-make_interval(days=>$6))`,
      [id,options.ownerId??owner,projectId,crypto.randomUUID(),options.state,options.ageDays]);
    return id;
  };
  const exists=async(table:'agent_runs'|'proposals',id:string)=>{
    const {rows}=await f.db.query<{n:number}>(`select count(*)::int as n from scene_private.${table} where id=$1`,[id]);
    return rows[0]!.n===1;
  };
  const insertProposal=async(options:{expiredDays:number;applied:boolean;userId?:string})=>{
    const id=crypto.randomUUID();
    await f.db.query(
      `insert into scene_private.proposals(id,project_id,user_id,session_id,generation,base_revision,local_revision,base_hash,base_scene,candidate,explanation,warnings,expires_at,applied_at)
       values($1,$2,$3,$4,1,0,0,'b',$5::jsonb,$5::jsonb,'说明','[]'::jsonb,clock_timestamp()-make_interval(days=>$6),case when $7 then clock_timestamp() else null end)`,
      [id,projectId,options.userId??owner,session,JSON.stringify(scene()),options.expiredDays,options.applied]);
    return id;
  };

  it('只清终态且超过保留期的运行',async()=>{
    const oldComplete=await insertRun({state:'complete',ageDays:40});
    const oldFailed=await insertRun({state:'failed',ageDays:40});
    const freshComplete=await insertRun({state:'complete',ageDays:1});
    const oldRunning=await insertRun({state:'running',ageDays:40});
    const result=await f.backend.agent!(owner,'get',{projectId,id:oldComplete});
    expect(result).not.toBeNull();
    const purged=await callPurge(30,24);
    expect(purged.runsDeleted).toBe(2);
    expect(await exists('agent_runs',oldComplete)).toBe(false);
    expect(await exists('agent_runs',oldFailed)).toBe(false);
    expect(await exists('agent_runs',freshComplete)).toBe(true);
    expect(await exists('agent_runs',oldRunning)).toBe(true);
  });

  it('只清已过期且未应用的 proposal，并留宽限期',async()=>{
    const longExpired=await insertProposal({expiredDays:2,applied:false});
    const justExpired=await insertProposal({expiredDays:0,applied:false});
    const applied=await insertProposal({expiredDays:2,applied:true});
    const purged=await callPurge(30,24);
    expect(purged.proposalsDeleted).toBe(1);
    expect(await exists('proposals',longExpired)).toBe(false);
    expect(await exists('proposals',justExpired)).toBe(true);
    expect(await exists('proposals',applied)).toBe(true);
  });

  it('删账号不再被外键挡住，记录保留但不再指向个人',async()=>{
    const userId=crypto.randomUUID();
    await f.db.query("insert into auth.users(id,email) values($1,'leaving@example.test')",[userId]);
    const runId=await insertRun({state:'complete',ageDays:0,ownerId:userId});
    const proposalId=await insertProposal({expiredDays:-1,applied:false,userId});
    await f.db.query('delete from auth.users where id=$1',[userId]);
    const run=await f.db.query<{owner_id:string|null}>('select owner_id from scene_private.agent_runs where id=$1',[runId]);
    const proposal=await f.db.query<{user_id:string|null}>('select user_id from scene_private.proposals where id=$1',[proposalId]);
    expect(run.rows[0]!.owner_id).toBeNull();
    expect(proposal.rows[0]!.user_id).toBeNull();
  });

  it('清理入口不对匿名与登录用户开放',async()=>{
    const {rows}=await f.db.query<{anon:boolean;authenticated:boolean;service:boolean}>(
      "select has_function_privilege('anon','scene_private.purge_agent_data(integer,integer)','EXECUTE') as anon,"+
      "has_function_privilege('authenticated','scene_private.purge_agent_data(integer,integer)','EXECUTE') as authenticated,"+
      "has_function_privilege('service_role','scene_private.purge_agent_data(integer,integer)','EXECUTE') as service");
    expect(rows[0]).toEqual({anon:false,authenticated:false,service:true});
  });

  it('非法保留参数被拒绝',async()=>{
    await expect(callPurge(0,24)).rejects.toThrow(/INVALID_RETENTION/);
  });

  async function callPurge(days:number,grace:number){
    const {rows}=await f.db.query<{result:{runsDeleted:number;proposalsDeleted:number}}>(
      'select scene_private.purge_agent_data($1,$2) as result',[days,grace]);
    return rows[0]!.result;
  }
});
