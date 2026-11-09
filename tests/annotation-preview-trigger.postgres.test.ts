import {execFile,execFileSync,spawn} from 'node:child_process';
import {readFileSync,readdirSync} from 'node:fs';
import {promisify} from 'node:util';
import {expect,it} from 'vitest';

// Isolated local image only; no host mounts, network, or existing containers.
it.skipIf(process.env.RUN_ISOLATED_POSTGRES_TESTS!=='1')('checks annotation preview guard on isolated PostgreSQL',async()=>{
 const name=`scendance-annotation-${process.pid}-${Date.now()}`,run=promisify(execFile);
 const docker=(args:string[],input?:string)=>execFileSync('docker',args,{encoding:'utf8',...(input===undefined?{}:{input}),stdio:['pipe','pipe','pipe'],maxBuffer:8*1024*1024});
 const psql=(sql:string)=>docker(['exec','-i',name,'psql','-U','postgres','-d','annotationtest','-v','ON_ERROR_STOP=1','-qAt'],sql);
 const asyncSql=(sql:string)=>run('docker',['exec',name,'psql','-U','postgres','-d','annotationtest','-v','ON_ERROR_STOP=1','-qAtc',sql]);
 const migrations=new URL('../supabase/migrations/',import.meta.url),guard='20261109160000_annotation_preview_guard.sql',fixture=readFileSync(new URL(guard,migrations),'utf8');
 const json=(v:unknown)=>JSON.stringify(v).replaceAll("'","''");
 const actor='10000000-0000-4000-8000-000000000001',studio='20000000-0000-4000-8000-000000000001',session='40000000-0000-4000-8000-000000000001',claim='60000000-0000-4000-8000-000000000001';
 const scene={schemaVersion:1,venue:{shape:'rectangle',width:12,depth:10,height:3,entrances:[]},objects:[],camera:'overview',lighting:'neutral'};
 const call=(fn:string,action:string,data:unknown)=>`select public.${fn}('${actor}','${action}','${json(data)}'::jsonb);`;
 let started=false;
 try {
  docker(['run','--rm','-d','--network','none','--name',name,'-e','POSTGRES_HOST_AUTH_METHOD=trust','public.ecr.aws/supabase/postgres:17.11.0.002']);started=true;
  let ready=false;for(let i=0;i<120;i++){try{if(docker(['exec',name,'pg_isready','-U','postgres']).includes('accepting connections')){await new Promise(r=>setTimeout(r,4000));docker(['exec',name,'psql','-U','postgres','-d','postgres','-Atc','select 1']);ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,250));}expect(ready).toBe(true);
  docker(['exec',name,'createdb','-U','postgres','annotationtest']);
  psql('create schema if not exists auth; create table if not exists auth.users(id uuid primary key,email text); create schema if not exists storage; create table if not exists storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]); grant usage on schema auth,public to service_role; grant select on auth.users to service_role;');
  for(const file of readdirSync(migrations).filter(f=>f.endsWith('.sql')&&f!==guard&&f!=='20261109170000_planning_zones_guard.sql').sort())psql(readFileSync(new URL(file,migrations),'utf8'));
  psql(`insert into auth.users(id) values ('${actor}'); insert into scene_private.studios(id,name) values ('${studio}','fixture'); insert into scene_private.members values ('${studio}','${actor}','owner','fixture');`);
  const make=(n:number,annotated:boolean)=>{
   const project=`30000000-0000-4000-8000-${String(n).padStart(12,'0')}`,task=`50000000-0000-4000-8000-${String(n).padStart(12,'0')}`,request=`70000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
   const context={brief:'',acceptedDecisions:[],recentMessages:[],...(annotated?{annotationObservation:{status:'unavailable'}}:{})};
   const input={requestId:request,sessionId:session,generation:1,expectedRevision:0,localRevision:0,scene,selectedIds:[],instruction:'fixture',context,executionMode:'preview',jevEnabled:false};
   psql(`insert into scene_private.projects(id,studio_id,created_by,name,scene,revision,lease_user,lease_session,lease_generation,lease_expires) values ('${project}','${studio}','${actor}','fixture','${json(scene)}'::jsonb,0,'${actor}','${session}',1,clock_timestamp()+interval '10 minutes'); insert into scene_private.agent_runs(id,owner_id,project_id,request_key,fingerprint,input,base_hash,state,claim,execution_mode,deadline) values ('${task}','${actor}','${project}','${request}',repeat('a',64),'${json(input)}'::jsonb,repeat('b',64),'running','${claim}','preview',clock_timestamp()+interval '10 minutes');`);
   const candidate={label:'A',title:'fixture',scene,explanation:'fixture',warnings:[],commands:[]};
   const receipt=JSON.parse(psql(`set role service_role; ${call('agent_steering_guard_rpc','finish',{projectId:project,id:task,claim,steerTotal:0,candidates:[candidate]})}`));
   const proposalId=receipt.candidates[0].proposal.id;
   return {project,task,receipt,proposalId,body:{projectId:project,proposalId,sessionId:session,generation:1,expectedRevision:0,localRevision:0,baseHash:'b'.repeat(64)}};
  };
  const pre=make(1,false);
  // Hold a conflicting table lock, observe installation wait, then commit.
  const holder=spawn('docker',['exec',name,'psql','-U','postgres','-d','annotationtest','-v','ON_ERROR_STOP=1','-qAtc',"set application_name='annotation_holder'; begin; lock table scene_private.proposals in access share mode; select pg_sleep(3); commit;"],{stdio:'ignore'});
  let sleeping=false;for(let i=0;i<80;i++){if(psql("select count(*) from pg_stat_activity where application_name='annotation_holder' and wait_event='PgSleep';").trim()==='1'){sleeping=true;break;}await new Promise(r=>setTimeout(r,100));}expect(sleeping).toBe(true);
  const installation=asyncSql(`set application_name='annotation_install'; begin; ${fixture} commit;`);
  let waiting=false;for(let i=0;i<40;i++){if(psql("select count(*) from pg_stat_activity where application_name='annotation_install' and wait_event_type='Lock';").trim()==='1'){waiting=true;break;}await new Promise(r=>setTimeout(r,50));}expect(waiting).toBe(true);
  expect(await new Promise(resolve=>holder.once('exit',resolve))).toBe(0);await installation;
  expect(()=>psql(`set role service_role; ${call('scene_rpc','proposals.apply',pre.body)}`)).toThrow();
  const marked=make(2,true);
  const row=JSON.parse(psql(`select json_build_object('warnings',warnings) from scene_private.proposals where id='${marked.proposalId}';`));
  expect(row.warnings).toContainEqual({code:'ANNOTATION_PREVIEW_ONLY',ids:[]});
  const read=JSON.parse(psql(`set role service_role; ${call('agent_rpc','get',{projectId:marked.project,id:marked.task})}`));
  expect(marked.receipt.candidates[0].proposal.warnings).toEqual(row.warnings);
  expect(read.candidates[0].proposal.warnings).toEqual(row.warnings);
  // Run deletion obtains its row lock first; subsequent apply must still reject.
  const deleter=spawn('docker',['exec',name,'psql','-U','postgres','-d','annotationtest','-v','ON_ERROR_STOP=1','-qAtc',`set application_name='annotation_delete'; begin; delete from scene_private.agent_runs where id='${marked.task}'; select pg_sleep(3); commit;`],{stdio:'ignore'});
  let deleting=false;for(let i=0;i<80;i++){if(psql("select count(*) from pg_stat_activity where application_name='annotation_delete' and wait_event='PgSleep';").trim()==='1'){deleting=true;break;}await new Promise(r=>setTimeout(r,100));}expect(deleting).toBe(true);
  const blocked=asyncSql(`set role service_role; ${call('scene_rpc','proposals.apply',marked.body)}`).then(()=>'',e=>String(e.stderr));
  expect(await new Promise(resolve=>deleter.once('exit',resolve))).toBe(0);expect(await blocked).toContain('ANNOTATION_PREVIEW_ONLY');
  const ordinary=make(3,false),apply=`set role service_role; ${call('scene_rpc','proposals.apply',ordinary.body)}`;
  const outcomes=await Promise.allSettled([asyncSql(apply),asyncSql(apply)]);
  expect(outcomes.filter(v=>v.status==='fulfilled')).toHaveLength(1);expect(outcomes.filter(v=>v.status==='rejected')).toHaveLength(1);
  expect(psql(`select revision from scene_private.projects where id='${ordinary.project}';`).trim()).toBe('1');
 } finally {if(started)try{docker(['stop',name]);}catch{}}
},120000);
