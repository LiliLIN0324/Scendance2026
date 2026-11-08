import {execFile,execFileSync,spawn} from 'node:child_process';
import {readFileSync,readdirSync} from 'node:fs';
import {promisify} from 'node:util';
import {expect,it} from 'vitest';

// Explicit opt-in: a fresh disposable container, existing local image, no network
// and no host mounts. This characterizes a mixed-version risk, not a release pass.
it.skipIf(process.env.RUN_ISOLATED_POSTGRES_TESTS!=='1')('shows that old workers bypass the guard after an accepted note in real PostgreSQL',async()=>{
 const run=promisify(execFile),name=`scendance-mixed-worker-${process.pid}-${Date.now()}`;
 const image='public.ecr.aws/supabase/postgres:17.11.0.002';
 const docker=(args:string[],input?:string)=>execFileSync('docker',args,{encoding:'utf8',...(input===undefined?{}:{input}),stdio:['pipe','pipe','pipe'],maxBuffer:8*1024*1024});
 const psql=(sql:string)=>docker(['exec','-i',name,'psql','-U','postgres','-d','mixedguardtest','-v','ON_ERROR_STOP=1','-qAt'],sql);
 let started=false;
 try{
  docker(['run','--rm','-d','--network','none','--name',name,'-e','POSTGRES_HOST_AUTH_METHOD=trust',image]);started=true;
  let ready=false;
  for(let i=0;i<120;i++){
   try{if(docker(['exec',name,'pg_isready','-U','postgres']).includes('accepting connections')){await new Promise(resolve=>setTimeout(resolve,4000));docker(['exec',name,'psql','-U','postgres','-d','postgres','-Atc','select 1']);ready=true;break;}}catch{/* database is starting */}
   await new Promise(resolve=>setTimeout(resolve,250));
  }
  expect(ready).toBe(true);
  docker(['exec',name,'createdb','-U','postgres','mixedguardtest']);
  psql('create schema if not exists auth; create table if not exists auth.users(id uuid primary key,email text); create schema if not exists storage; create table if not exists storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]); grant usage on schema auth,public to service_role; grant select on auth.users to service_role;');
  const dir=new URL('../supabase/migrations/',import.meta.url);
  for(const file of readdirSync(dir).filter(item=>item.endsWith('.sql')).sort())psql(readFileSync(new URL(file,dir),'utf8'));
  const actor='10000000-0000-4000-8000-000000000001',studio='20000000-0000-4000-8000-000000000001';
  const project='30000000-0000-4000-8000-000000000001',session='40000000-0000-4000-8000-000000000001';
  const task='50000000-0000-4000-8000-000000000001',claim='60000000-0000-4000-8000-000000000001';
  const scene={schemaVersion:1,venue:{shape:'rectangle',width:12,depth:10,height:3,entrances:[]},objects:[],camera:'overview',lighting:'neutral'};
  const input={requestId:'70000000-0000-4000-8000-000000000001',sessionId:session,generation:1,expectedRevision:0,localRevision:0,scene,selectedIds:[],instruction:'虚构30人活动',executionMode:'preview',jevEnabled:false};
  const candidate={label:'A',title:'旧候选',scene,explanation:'仅测试',warnings:[],commands:[]};
  const json=(value:unknown)=>JSON.stringify(value).replaceAll("'","''");
  psql(`insert into auth.users(id) values ('${actor}'); insert into scene_private.studios(id,name) values ('${studio}','fixture'); insert into scene_private.members values ('${studio}','${actor}','owner','fixture'); insert into scene_private.projects(id,studio_id,created_by,name,scene,revision,lease_user,lease_session,lease_generation,lease_expires) values ('${project}','${studio}','${actor}','fixture','${json(scene)}'::jsonb,0,'${actor}','${session}',1,clock_timestamp()+interval '10 minutes'); insert into scene_private.agent_runs(id,owner_id,project_id,request_key,fingerprint,input,base_hash,state,claim,execution_mode,deadline) values ('${task}','${actor}','${project}','${input.requestId}',repeat('a',64),'${json(input)}'::jsonb,repeat('b',64),'running','${claim}','preview',clock_timestamp()+interval '10 minutes');`);
  const data={projectId:project,id:task,claim};
  const noteData={projectId:project,id:task,note:'保留原物'};
  const checkpointData={...data,candidates:[candidate]};
  const call=(fn:string,action:string,arg:unknown)=>`select public.${fn}('${actor}','${action}','${json(arg)}'::jsonb);`;
  const slowNote=`set application_name='scendance_mixed_note'; set role service_role; begin; ${call('agent_steering_guard_rpc','note',noteData)} select pg_sleep(3); commit;`;
  const note=spawn('docker',['exec',name,'psql','-U','postgres','-d','mixedguardtest','-v','ON_ERROR_STOP=1','-qAtc',slowNote],{stdio:'ignore'});
  let waiting=false;
  for(let i=0;i<80;i++){
   if(psql("select count(*) from pg_stat_activity where application_name='scendance_mixed_note' and wait_event='PgSleep';").trim()==='1'){waiting=true;break;}
   await new Promise(resolve=>setTimeout(resolve,100));
  }
  expect(waiting).toBe(true);
  const legacy=run('docker',['exec',name,'psql','-U','postgres','-d','mixedguardtest','-v','ON_ERROR_STOP=1','-qAtc',`set role service_role; ${call('agent_rpc','checkpoint',checkpointData)} ${call('agent_rpc','finish',data)}`]);
  const noteExit=await new Promise<number|null>(resolve=>{if(note.exitCode!==null)resolve(note.exitCode);else note.once('exit',resolve);});
  expect(noteExit).toBe(0);
  await legacy;
  expect(psql(`select state||':'||jsonb_array_length(steer_notes)||':'||jsonb_array_length(candidates) from scene_private.agent_runs where id='${task}';`).trim()).toBe('complete:1:1');
  // A clean second race tests the new worker path: once the note has acquired
  // the same row lock first, a stale guarded checkpoint must be rejected.
  psql(`update scene_private.agent_runs set state='running',steer_notes='[]'::jsonb,steer_total=0,candidates='[]'::jsonb where id='${task}';`);
  const guardedNote=`set application_name='scendance_guarded_note'; set role service_role; begin; ${call('agent_steering_guard_rpc','note',noteData)} select pg_sleep(3); commit;`;
  const note2=spawn('docker',['exec',name,'psql','-U','postgres','-d','mixedguardtest','-v','ON_ERROR_STOP=1','-qAtc',guardedNote],{stdio:'ignore'});
  let waiting2=false;
  for(let i=0;i<80;i++){
   if(psql("select count(*) from pg_stat_activity where application_name='scendance_guarded_note' and wait_event='PgSleep';").trim()==='1'){waiting2=true;break;}
   await new Promise(resolve=>setTimeout(resolve,100));
  }
  expect(waiting2).toBe(true);
  const guarded=run('docker',['exec',name,'psql','-U','postgres','-d','mixedguardtest','-v','ON_ERROR_STOP=1','-qAtc',`set role service_role; ${call('agent_steering_guard_rpc','checkpoint',{...checkpointData,steerTotal:0})}`])
   .then(()=>({ok:true,stderr:''}),error=>({ok:false,stderr:String(error.stderr??'')}));
  const noteExit2=await new Promise<number|null>(resolve=>{if(note2.exitCode!==null)resolve(note2.exitCode);else note2.once('exit',resolve);});
  expect(noteExit2).toBe(0);
  expect(await guarded).toEqual({ok:false,stderr:expect.stringContaining('AGENT_STEERING_CHANGED')});
  expect(psql(`select state||':'||jsonb_array_length(steer_notes)||':'||jsonb_array_length(candidates) from scene_private.agent_runs where id='${task}';`).trim()).toBe('running:1:0');
  psql(`update scene_private.agent_runs set state='running',steer_notes='[]'::jsonb,steer_total=0,candidates='[]'::jsonb where id='${task}';`);
  const finishNote=`set application_name='scendance_finish_note'; set role service_role; begin; ${call('agent_steering_guard_rpc','note',noteData)} select pg_sleep(3); commit;`;
  const note3=spawn('docker',['exec',name,'psql','-U','postgres','-d','mixedguardtest','-v','ON_ERROR_STOP=1','-qAtc',finishNote],{stdio:'ignore'});
  let waiting3=false;
  for(let i=0;i<80;i++){
   if(psql("select count(*) from pg_stat_activity where application_name='scendance_finish_note' and wait_event='PgSleep';").trim()==='1'){waiting3=true;break;}
   await new Promise(resolve=>setTimeout(resolve,100));
  }
  expect(waiting3).toBe(true);
  const guardedFinish=run('docker',['exec',name,'psql','-U','postgres','-d','mixedguardtest','-v','ON_ERROR_STOP=1','-qAtc',`set role service_role; ${call('agent_steering_guard_rpc','finish',{...data,steerTotal:0})}`])
   .then(()=>({ok:true,stderr:''}),error=>({ok:false,stderr:String(error.stderr??'')}));
  const noteExit3=await new Promise<number|null>(resolve=>{if(note3.exitCode!==null)resolve(note3.exitCode);else note3.once('exit',resolve);});
  expect(noteExit3).toBe(0);
  expect(await guardedFinish).toEqual({ok:false,stderr:expect.stringContaining('AGENT_STEERING_CHANGED')});
  expect(psql(`select state||':'||jsonb_array_length(steer_notes)||':'||jsonb_array_length(candidates) from scene_private.agent_runs where id='${task}';`).trim()).toBe('running:1:0');
 }finally{if(started)try{docker(['stop',name]);}catch{/* only this test's disposable container */}}
},120000);
