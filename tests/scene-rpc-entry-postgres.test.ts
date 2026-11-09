import {execFile,execFileSync,spawn} from 'node:child_process';
import {readFileSync,readdirSync} from 'node:fs';
import {promisify} from 'node:util';
import {expect,it} from 'vitest';

// Explicit opt-in: disposable PostgreSQL only; no network, host mounts or production data.
it.skipIf(process.env.RUN_ISOLATED_POSTGRES_TESTS!=='1')('guards all old scene entries across an upgrade and an already-warmed worker',async()=>{
 const run=promisify(execFile),name=`scendance-scene-entry-${process.pid}-${Date.now()}`;
 const image='public.ecr.aws/supabase/postgres:17.11.0.002';
 const docker=(args:string[],input?:string)=>execFileSync('docker',args,{encoding:'utf8',...(input===undefined?{}:{input}),stdio:['pipe','pipe','pipe'],maxBuffer:8*1024*1024});
 const psql=(sql:string)=>docker(['exec','-i',name,'psql','-U','postgres','-d','sceneguardtest','-v','ON_ERROR_STOP=1','-qAt'],sql);
 const migrations=new URL('../supabase/migrations/',import.meta.url),guard='20261109010000_scene_rpc_entry_guard.sql';
 const migration=readFileSync(new URL(guard,migrations),'utf8');let started=false;
 try{
  docker(['run','--rm','-d','--network','none','--name',name,'-e','POSTGRES_HOST_AUTH_METHOD=trust',image]);started=true;
  let ready=false;for(let i=0;i<120;i++){try{if(docker(['exec',name,'pg_isready','-U','postgres']).includes('accepting connections')){await new Promise(resolve=>setTimeout(resolve,4000));docker(['exec',name,'psql','-U','postgres','-d','postgres','-Atc','select 1']);ready=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,250));}expect(ready).toBe(true);
  docker(['exec',name,'createdb','-U','postgres','sceneguardtest']);
  psql('create schema if not exists auth; create table if not exists auth.users(id uuid primary key,email text); create schema if not exists storage; create table if not exists storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]); grant usage on schema auth,public to service_role; grant select on auth.users to service_role;');
  for(const file of readdirSync(migrations).filter(item=>item.endsWith('.sql')&&item!==guard&&item!=='20261109170000_planning_zones_guard.sql').sort())psql(readFileSync(new URL(file,migrations),'utf8'));
  // A mismatched owner must abort the whole migration without changing the old function.
  expect(()=>psql(`begin; create role fixture_other_owner; alter function public.scene_rpc_legacy(uuid,text,jsonb) owner to fixture_other_owner; ${migration} commit;`)).toThrow();
  expect(psql("select prosecdef from pg_proc where oid='public.scene_rpc(uuid,text,jsonb)'::regprocedure").trim()).toBe('f');
  expect(psql("select has_function_privilege('service_role','public.scene_rpc_before_agent(uuid,text,jsonb)','execute')").trim()).toBe('t');
  // Direct REVOKE cannot remove an inherited grant: migration must fail as one
  // statement and leave the unrelated role and old entry untouched.
  psql('create role fixture_inherited; grant execute on function public.scene_rpc_legacy(uuid,text,jsonb) to fixture_inherited; grant fixture_inherited to service_role;');
  expect(()=>psql(migration)).toThrow();
  expect(psql("select to_regprocedure('public.scene_rpc_before_agent_unguarded(uuid,text,jsonb)') is null,has_function_privilege('fixture_inherited','public.scene_rpc_legacy(uuid,text,jsonb)','execute'),has_function_privilege('service_role','public.scene_rpc_legacy(uuid,text,jsonb)','execute');").trim()).toBe('t|t|t');
  psql('revoke fixture_inherited from service_role;');
  const actor='10000000-0000-4000-8000-000000000001',studio='20000000-0000-4000-8000-000000000001',project='30000000-0000-4000-8000-000000000001',session='40000000-0000-4000-8000-000000000001',task='50000000-0000-4000-8000-000000000001',claim='60000000-0000-4000-8000-000000000001';
  const scene={schemaVersion:1,venue:{shape:'rectangle',width:12,depth:10,height:3,entrances:[]},objects:[],camera:'overview',lighting:'neutral'};
  const input={requestId:'70000000-0000-4000-8000-000000000001',sessionId:session,generation:1,expectedRevision:0,localRevision:0,scene,selectedIds:[],instruction:'虚构30人活动',executionMode:'preview',jevEnabled:false};
  const json=(value:unknown)=>JSON.stringify(value).replaceAll("'","''");
  psql(`insert into auth.users(id) values ('${actor}'); insert into scene_private.studios(id,name) values ('${studio}','fixture'); insert into scene_private.members values ('${studio}','${actor}','owner','fixture'); insert into scene_private.projects(id,studio_id,created_by,name,scene,revision,lease_user,lease_session,lease_generation,lease_expires) values ('${project}','${studio}','${actor}','fixture','${json(scene)}'::jsonb,0,'${actor}','${session}',1,clock_timestamp()+interval '10 minutes'); insert into scene_private.agent_runs(id,owner_id,project_id,request_key,fingerprint,input,base_hash,state,claim,execution_mode,deadline) values ('${task}','${actor}','${project}','${input.requestId}',repeat('a',64),'${json(input)}'::jsonb,repeat('b',64),'running','${claim}','preview',clock_timestamp()+interval '10 minutes');`);
  const call=(fn:string,action:string,data:unknown)=>`select public.${fn}('${actor}','${action}','${json(data)}'::jsonb);`;
  const key={projectId:project,id:task,claim};
  const candidate={label:'A',title:'旧候选',scene,explanation:'仅测试',warnings:[],commands:[]};
  const receipt=JSON.parse(psql(`set role service_role; ${call('agent_steering_guard_rpc','checkpoint',{...key,steerTotal:0,candidates:[candidate]})}`));
  const proposalId=receipt.candidates[0].proposal.id;
  psql(`set role service_role; ${call('agent_steering_guard_rpc','note',{projectId:project,id:task,note:'保留原物'})}`);
  const apply={projectId:project,proposalId,sessionId:session,generation:1,expectedRevision:0,localRevision:0,baseHash:'b'.repeat(64)};
  const escaped=json(apply);
  // Warm both invoker and old delegate plans in one long-lived worker before upgrade.
  const worker=spawn('docker',['exec',name,'psql','-U','postgres','-d','sceneguardtest','-v','ON_ERROR_STOP=1','-qAt',
   '-c',"set application_name='scendance_scene_warm'; set role service_role",
   '-c',`select public.scene_rpc('${actor}','projects.get','{"projectId":"${project}"}'::jsonb)`,
   '-c','select pg_sleep(6)',
   '-c',`select public.scene_rpc_before_agent('${actor}','proposals.apply','${escaped}'::jsonb)`],{stdio:['ignore','ignore','pipe']});
  let workerError='';worker.stderr.setEncoding('utf8').on('data',chunk=>workerError+=chunk);
  let sleeping=false;for(let i=0;i<80;i++){if(psql("select count(*) from pg_stat_activity where application_name='scendance_scene_warm' and wait_event='PgSleep';").trim()==='1'){sleeping=true;break;}await new Promise(resolve=>setTimeout(resolve,100));}expect(sleeping).toBe(true);
  psql(migration);
  const exit=await new Promise<number|null>(resolve=>{if(worker.exitCode!==null)resolve(worker.exitCode);else worker.once('exit',resolve);});
  expect(exit).not.toBe(0);expect(workerError).toContain('STALE_PROPOSAL');
  expect(psql("select prosecdef from pg_proc where oid='public.scene_rpc(uuid,text,jsonb)'::regprocedure").trim()).toBe('f');
  for(const fn of ['scene_rpc_before_agent_unguarded','scene_rpc_before_parametric','scene_rpc_before_material_variants','scene_rpc_before_studio_delete','scene_rpc_before_project_delete','scene_rpc_legacy']){
   expect(psql(`select has_function_privilege('service_role','public.${fn}(uuid,text,jsonb)','execute');`).trim(),fn).toBe('f');
   await expect(run('docker',['exec',name,'psql','-U','postgres','-d','sceneguardtest','-v','ON_ERROR_STOP=1','-qAtc',`set role service_role; ${call(fn,'proposals.apply',apply)}`])).rejects.toMatchObject({stderr:expect.stringContaining('permission denied')});
  }
  expect(psql(`select revision from scene_private.projects where id='${project}';`).trim()).toBe('0');
  // An accepted new requirement owns the same run lock as direct proxy apply.
  // The apply waits, then must see the cleared candidate rather than publish it.
  const task2='50000000-0000-4000-8000-000000000002',request2='70000000-0000-4000-8000-000000000002';
  psql(`insert into scene_private.agent_runs(id,owner_id,project_id,request_key,fingerprint,input,base_hash,state,claim,execution_mode,deadline) values ('${task2}','${actor}','${project}','${request2}',repeat('c',64),'${json({...input,requestId:request2})}'::jsonb,repeat('b',64),'running','${claim}','preview',clock_timestamp()+interval '10 minutes');`);
  const key2={projectId:project,id:task2,claim};
  const receipt2=JSON.parse(psql(`set role service_role; ${call('agent_steering_guard_rpc','checkpoint',{...key2,steerTotal:0,candidates:[candidate]})}`));
  const apply2={...apply,proposalId:receipt2.candidates[0].proposal.id};
  const note=spawn('docker',['exec',name,'psql','-U','postgres','-d','sceneguardtest','-v','ON_ERROR_STOP=1','-qAtc',`set application_name='scendance_scene_note'; set role service_role; begin; ${call('agent_steering_guard_rpc','note',{projectId:project,id:task2,note:'改变座席'})} select pg_sleep(3); commit;`],{stdio:'ignore'});
  let noting=false;for(let i=0;i<80;i++){if(psql("select count(*) from pg_stat_activity where application_name='scendance_scene_note' and wait_event='PgSleep';").trim()==='1'){noting=true;break;}await new Promise(resolve=>setTimeout(resolve,100));}expect(noting).toBe(true);
  const direct=run('docker',['exec',name,'psql','-U','postgres','-d','sceneguardtest','-v','ON_ERROR_STOP=1','-qAtc',`set role service_role; ${call('scene_rpc_before_agent','proposals.apply',apply2)}`]).then(()=>({ok:true,stderr:''}),error=>({ok:false,stderr:String(error.stderr??'')}));
  const noteExit=await new Promise<number|null>(resolve=>{if(note.exitCode!==null)resolve(note.exitCode);else note.once('exit',resolve);});
  expect(noteExit).toBe(0);expect(await direct).toEqual({ok:false,stderr:expect.stringContaining('STALE_PROPOSAL')});
  expect(psql(`select revision from scene_private.projects where id='${project}';`).trim()).toBe('0');
  const outsider='10000000-0000-4000-8000-000000000003';
  await expect(run('docker',['exec',name,'psql','-U','postgres','-d','sceneguardtest','-v','ON_ERROR_STOP=1','-qAtc',`set role service_role; select public.scene_rpc_before_agent('${outsider}','projects.get','{"projectId":"${project}"}'::jsonb);`])).rejects.toThrow();
 }finally{if(started)try{docker(['stop',name]);}catch{}}
},120000);
