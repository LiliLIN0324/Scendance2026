import {execFile,execFileSync,spawn} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {promisify} from 'node:util';
import {expect,it} from 'vitest';
const run=promisify(execFile);

// Opt in explicitly. Uses an existing local image, no network or host mounts.
it.skipIf(process.env.RUN_ISOLATED_POSTGRES_TESTS!=='1')('serializes concurrent reservations/dispatch and rolls back on disconnect in isolated PostgreSQL',async()=>{
  const name=`scendance-brief-prototype-${process.pid}-${Date.now()}`,image='public.ecr.aws/supabase/postgres:17.11.0.002';
  const docker=(args:string[],input?:string)=>execFileSync('docker',args,{encoding:'utf8',...(input===undefined?{}:{input}),stdio:['pipe','pipe','pipe']});
  const psql=(sql:string)=>docker(['exec','-i',name,'psql','-U','postgres','-d','briefguardtest','-v','ON_ERROR_STOP=1','-At'],sql);
  let started=false;
  try {
    docker(['run','--rm','-d','--network','none','--name',name,'-e','POSTGRES_HOST_AUTH_METHOD=trust',image]);started=true;
    let ready=false;for(let i=0;i<120;i++){try{const status=docker(['exec',name,'pg_isready','-U','postgres']);if(status.includes('accepting connections')){await new Promise(resolve=>setTimeout(resolve,4000));docker(['exec',name,'psql','-U','postgres','-d','postgres','-Atc','select 1']);ready=true;break;}}catch{/* The image restarts PostgreSQL after initial setup. */}await new Promise(resolve=>setTimeout(resolve,250));}
    expect(ready).toBe(true);docker(['exec',name,'createdb','-U','postgres','briefguardtest']);
    psql("create schema auth; create table auth.users(id uuid primary key); create schema scene_private; grant usage on schema auth,scene_private,public to service_role; grant select on auth.users to service_role; insert into auth.users values ('10000000-0000-4000-8000-000000000001'),('10000000-0000-4000-8000-000000000002');");
    psql(readFileSync(new URL('../supabase/migrations/20261107000100_brief_request_guard.sql',import.meta.url),'utf8'));
    const actor='10000000-0000-4000-8000-000000000001',request='20000000-0000-4000-8000-000000000001';
    const query=(action:string)=>`set role service_role; select public.brief_request_guard_rpc('${actor}','${action}',jsonb_build_object('requestId','${request}','fingerprint',repeat('a',64)));`;
    const concurrently=(sql:string)=>run('docker',['exec',name,'psql','-U','postgres','-d','briefguardtest','-v','ON_ERROR_STOP=1','-Atc',sql]);
    const reservations=await Promise.all([concurrently(query('reserve')),concurrently(query('reserve'))]);
    expect(reservations.map(r=>JSON.parse(r.stdout.trim().split('\n').at(-1)! ).created).sort()).toEqual([false,true]);
    const dispatches=await Promise.all([concurrently(query('dispatch')),concurrently(query('dispatch'))]);
    expect(dispatches.map(r=>JSON.parse(r.stdout.trim().split('\n').at(-1)!).dispatch).sort()).toEqual([false,true]);
    expect(psql(query('unknown'))).toContain('"unknown"');expect(psql(query('dispatch'))).toContain('"dispatch": false');
    const sql="set application_name='brief_guard_disconnect_test'; set role service_role; begin; select public.brief_request_guard_rpc('10000000-0000-4000-8000-000000000002','reserve',jsonb_build_object('requestId','20000000-0000-4000-8000-000000000002','fingerprint',repeat('b',64))); select pg_sleep(30); commit;";
    const child=spawn('docker',['exec',name,'psql','-U','postgres','-d','briefguardtest','-v','ON_ERROR_STOP=1','-Atc',sql],{stdio:'ignore'});
    let active=false;for(let i=0;i<60;i++){if(psql("select count(*) from pg_stat_activity where application_name='brief_guard_disconnect_test' and state='active';").trim()==='1'){active=true;break;}await new Promise(resolve=>setTimeout(resolve,100));}
    expect(active).toBe(true);psql("select pg_terminate_backend(pid) from pg_stat_activity where application_name='brief_guard_disconnect_test' and pid<>pg_backend_pid();");
    await new Promise<void>(resolve=>{if(child.exitCode!==null||child.signalCode!==null)resolve();else child.once('exit',()=>resolve());});
    expect(psql("select count(*) from scene_private.brief_request_fences where actor='10000000-0000-4000-8000-000000000002';").trim()).toBe('0');
  } finally {if(started)try{docker(['stop',name]);}catch{/* container already stopped */}}
},90_000);
