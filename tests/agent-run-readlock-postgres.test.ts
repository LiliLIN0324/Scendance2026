import {execFileSync,spawn} from 'node:child_process';
import {readFileSync,readdirSync} from 'node:fs';
import {expect,it} from 'vitest';

/**
 * 真 PostgreSQL 并发验证（显式 opt-in，不联网、不挂宿主目录）：
 *  pglite 是单连接，证明不了「读不再被写锁挡住」。这里让一个连接持住
 *  agent_runs 行锁 4 秒，再用另一个连接：
 *   1) agent_rpc('get') 必须很快返回（改造前会在 for update 上排队到超时）；
 *   2) agent_run_events_rpc('append') 必须成功（改造前抢同一行锁，75ms 就失败）。
 * 写动作仍然锁行，这一点不测——那是预期行为。
 */
it.skipIf(process.env.RUN_ISOLATED_POSTGRES_TESTS!=='1')('reads and telemetry do not queue behind the run row lock',async()=>{
  const name=`scendance-readlock-${process.pid}-${Date.now()}`;
  const image='public.ecr.aws/supabase/postgres:17.11.0.002';
  const docker=(args:string[],input?:string)=>execFileSync('docker',args,{encoding:'utf8',...(input===undefined?{}:{input}),stdio:['pipe','pipe','pipe'],maxBuffer:8*1024*1024});
  const psql=(sql:string)=>docker(['exec','-i',name,'psql','-U','postgres','-d','readlocktest','-v','ON_ERROR_STOP=1','-qAt'],sql);
  const quoted=(value:unknown)=>JSON.stringify(value).replaceAll("'","''");
  let started=false;
  try{
    docker(['run','--rm','-d','--network','none','--name',name,'-e','POSTGRES_HOST_AUTH_METHOD=trust',image]);started=true;
    let ready=false;
    for(let i=0;i<120;i++){
      try{if(docker(['exec',name,'pg_isready','-U','postgres']).includes('accepting connections')){await new Promise(resolve=>setTimeout(resolve,4000));ready=true;break;}}catch{/* database is starting */}
      await new Promise(resolve=>setTimeout(resolve,250));
    }
    expect(ready).toBe(true);
    docker(['exec',name,'createdb','-U','postgres','readlocktest']);
    psql("create schema if not exists auth; create table if not exists auth.users(id uuid primary key,email text); create schema if not exists storage; create table if not exists storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]); grant usage on schema auth,public to service_role; grant select on auth.users to service_role;");
    const dir=new URL('../supabase/migrations/',import.meta.url);
    for(const file of readdirSync(dir).filter(item=>item.endsWith('.sql')).sort())psql(readFileSync(new URL(file,dir),'utf8'));

    const actor='10000000-0000-4000-8000-000000000001',studio='20000000-0000-4000-8000-000000000001';
    const project='30000000-0000-4000-8000-000000000001',session='40000000-0000-4000-8000-000000000001';
    const run='50000000-0000-4000-8000-000000000001',claim='60000000-0000-4000-8000-000000000001';
    const scene={schemaVersion:1,venue:{shape:'rectangle',width:12,depth:10,height:3,entrances:[]},objects:[],camera:'overview',lighting:'neutral'};
    const input={requestId:'70000000-0000-4000-8000-000000000001',sessionId:session,generation:1,expectedRevision:0,localRevision:0,
      scene,selectedIds:[],instruction:'并发只读验证',executionMode:'preview',jevEnabled:false};
    psql(`insert into auth.users(id) values ('${actor}'); insert into scene_private.studios(id,name) values ('${studio}','fixture'); insert into scene_private.members values ('${studio}','${actor}','owner','fixture'); insert into scene_private.projects(id,studio_id,created_by,name,scene,revision,lease_user,lease_session,lease_generation,lease_expires) values ('${project}','${studio}','${actor}','fixture','${quoted(scene)}'::jsonb,0,'${actor}','${session}',1,clock_timestamp()+interval '10 minutes'); insert into scene_private.agent_runs(id,owner_id,project_id,request_key,fingerprint,input,base_hash,state,claim,execution_mode,deadline,progress) values ('${run}','${actor}','${project}','${input.requestId}',repeat('a',64),'${quoted(input)}'::jsonb,repeat('b',64),'running','${claim}','preview',clock_timestamp()+interval '5 minutes','跑着');`);

    const call=(fn:string,action:string,arg:unknown)=>`select public.${fn}('${actor}','${action}','${quoted(arg)}'::jsonb);`;
    // 持锁方：锁住 run 行 4 秒，模拟工作线程正在更新。
    const holder=spawn('docker',['exec',name,'psql','-U','postgres','-d','readlocktest','-v','ON_ERROR_STOP=1','-qAtc',
      `set application_name='row_holder'; set role service_role; begin; select 1 from scene_private.agent_runs where id='${run}' for update; select pg_sleep(4); commit;`],
      {stdio:'ignore'});
    let locked=false;
    for(let i=0;i<40;i++){
      const waiting=psql("select count(*) from pg_locks l join pg_stat_activity a on a.pid=l.pid where l.mode='RowShareLock' and l.granted and a.application_name='row_holder' and l.relation='scene_private.agent_runs'::regclass;").trim();
      if(waiting!=='0'){locked=true;break;}
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    expect(locked).toBe(true);

    // 1) 读：不许排队。
    const readStarted=Date.now();
    const read=psql(`set statement_timeout='1500ms'; set role service_role; ${call('agent_rpc','get',{projectId:project,id:run})}`).trim();
    const readMs=Date.now()-readStarted;
    expect(read).toContain('running');
    expect(readMs).toBeLessThan(1500);

    // 2) 遥测：不许抢同一把锁（旧实现 75ms 内就失败）。
    const eventsStarted=Date.now();
    const appended=psql(`set statement_timeout='1500ms'; set role service_role; ${call('agent_run_events_rpc','append',{projectId:project,id:run,claim,event:{tool:'get_scene',stage:'started'}})}`).trim();
    const eventsMs=Date.now()-eventsStarted;
    expect(appended).toContain('seq');
    expect(eventsMs).toBeLessThan(1500);
    holder.kill();
  }finally{
    if(started){try{docker(['rm','-f',name]);}catch{/* container already gone */}}
  }
},60000);
