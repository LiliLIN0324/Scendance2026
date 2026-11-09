import {execFileSync} from 'node:child_process';
import {readFileSync,readdirSync} from 'node:fs';
import {expect,it} from 'vitest';

// Explicit opt-in: a new local container without a network, host mounts or user data.
it.skipIf(process.env.RUN_ISOLATED_POSTGRES_TESTS!=='1')('checks planning-zone save guard in isolated PostgreSQL',async()=>{
 const name=`scendance-planning-zones-${process.pid}-${Date.now()}`;
 const docker=(args:string[],input?:string)=>execFileSync('docker',args,{encoding:'utf8',...(input===undefined?{}:{input}),stdio:['pipe','pipe','pipe'],maxBuffer:8*1024*1024});
 const psql=(sql:string)=>docker(['exec','-i',name,'psql','-U','postgres','-d','planningtest','-v','ON_ERROR_STOP=1','-qAt'],sql);
 const dir=new URL('../supabase/migrations/',import.meta.url),guard='20261109170000_planning_zones_guard.sql';
 const actor='10000000-0000-4000-8000-000000000001',studio='20000000-0000-4000-8000-000000000001',project='30000000-0000-4000-8000-000000000001',session='40000000-0000-4000-8000-000000000001';
 const base={schemaVersion:1,venue:{shape:'rectangle',width:12,depth:10,height:3,entrances:[]},objects:[],camera:'overview',lighting:'neutral'};
 const zones={version:1,zones:[{id:'zone-1',name:'合成签到区',color:'#4A7C59',x:0,z:0,width:2,depth:1,zoneType:'checkin',source:'unverified'}]};
 const json=(value:unknown)=>JSON.stringify(value).replaceAll("'","''");
 const call=(action:string,data:unknown)=>`select public.scene_rpc('${actor}','${action}','${json(data)}'::jsonb);`;
 let started=false;
 try{
  docker(['run','--rm','-d','--network','none','--name',name,'-e','POSTGRES_HOST_AUTH_METHOD=trust','public.ecr.aws/supabase/postgres:17.11.0.002']);started=true;
  let ready=false;for(let i=0;i<120;i++){try{if(docker(['exec',name,'pg_isready','-U','postgres']).includes('accepting connections')){await new Promise(resolve=>setTimeout(resolve,4000));ready=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,250));}expect(ready).toBe(true);
  docker(['exec',name,'createdb','-U','postgres','planningtest']);
  psql('create schema if not exists auth; create table if not exists auth.users(id uuid primary key,email text); create schema if not exists storage; create table if not exists storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]); grant usage on schema auth,public to service_role; grant select on auth.users to service_role;');
  for(const file of readdirSync(dir).filter(file=>file.endsWith('.sql')&&file!==guard).sort())psql(readFileSync(new URL(file,dir),'utf8'));
  const oid=psql("select 'scene_private.save_scene(uuid,jsonb,jsonb)'::regprocedure::oid;").trim();
  psql(readFileSync(new URL(guard,dir),'utf8'));
  expect(psql("select 'scene_private.save_scene(uuid,jsonb,jsonb)'::regprocedure::oid;").trim()).toBe(oid);
  psql(`insert into auth.users(id) values ('${actor}'); insert into scene_private.studios(id,name) values ('${studio}','fixture'); insert into scene_private.members values ('${studio}','${actor}','owner','fixture'); insert into scene_private.projects(id,studio_id,created_by,name,scene,revision,lease_user,lease_session,lease_generation,lease_expires) values ('${project}','${studio}','${actor}','fixture','${json(base)}'::jsonb,0,'${actor}','${session}',1,clock_timestamp()+interval '10 minutes');`);
  expect(JSON.parse(psql(`set role service_role; ${call('planning_zones.readiness',{projectId:project})}`))).toEqual({capability:'planning_zones',version:1});
  const state={projectId:project,sessionId:session,generation:1,expectedRevision:0};
  expect(()=>psql(`set role service_role; ${call('scene.save',{...state,scene:{...base,planningZones:zones}})}`)).toThrow();
  const saved=JSON.parse(psql(`set role service_role; ${call('scene.save',{...state,scene:{...base,planningZones:zones},planningZonesEdit:{version:1,previous:null}})}`));
  expect(saved.revision).toBe(1);expect(saved.scene.planningZones).toEqual(zones);
  expect(()=>psql(`set role service_role; ${call('scene.save',{...state,expectedRevision:1,scene:base})}`)).toThrow();
  expect(psql(`select revision from scene_private.projects where id='${project}';`).trim()).toBe('1');
 }finally{if(started)try{docker(['stop',name]);}catch{}}
},120000);
