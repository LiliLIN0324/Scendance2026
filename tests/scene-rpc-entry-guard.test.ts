import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {database,owner,outsider,scene,session,studio} from './fixtures.ts';
import {agentRunRequestSchema} from '../supabase/functions/_shared/agent-contract.ts';
import {sceneHash} from '../supabase/functions/_shared/domain.ts';
import {PGlite} from '@electric-sql/pglite';
import {readFileSync,readdirSync} from 'node:fs';

const internal=['scene_rpc_before_agent_unguarded','scene_rpc_before_parametric','scene_rpc_before_material_variants','scene_rpc_before_studio_delete','scene_rpc_before_project_delete','scene_rpc_legacy'] as const;
describe('scene proposal entry protection',()=>{
 let f:Awaited<ReturnType<typeof database>>;
 beforeAll(async()=>{f=await database();},30000);afterAll(async()=>{await f?.db.close();});
 it('keeps the sole public entry available while denying every old internal entry to client and service roles',async()=>{
  for(const name of internal){
   const result=await f.db.query<{service:boolean;anon:boolean;authenticated:boolean}>(`select has_function_privilege('service_role','public.${name}(uuid,text,jsonb)','execute') as service,has_function_privilege('anon','public.${name}(uuid,text,jsonb)','execute') as anon,has_function_privilege('authenticated','public.${name}(uuid,text,jsonb)','execute') as authenticated`);
   expect(result.rows[0],name).toEqual({service:false,anon:false,authenticated:false});
  }
  const outer=await f.db.query<{service:boolean;anon:boolean;authenticated:boolean;definer:boolean;config:string[]|null}>("select has_function_privilege('service_role','public.scene_rpc(uuid,text,jsonb)','execute') as service,has_function_privilege('anon','public.scene_rpc(uuid,text,jsonb)','execute') as anon,has_function_privilege('authenticated','public.scene_rpc(uuid,text,jsonb)','execute') as authenticated,prosecdef as definer,proconfig as config from pg_proc where oid='public.scene_rpc(uuid,text,jsonb)'::regprocedure");
  expect(outer.rows[0]).toMatchObject({service:true,anon:false,authenticated:false,definer:false});expect(outer.rows[0]!.config).toContain('search_path=""');
  const proxy=await f.db.query<{service:boolean;anon:boolean;authenticated:boolean;definer:boolean;config:string[]|null}>("select has_function_privilege('service_role','public.scene_rpc_before_agent(uuid,text,jsonb)','execute') as service,has_function_privilege('anon','public.scene_rpc_before_agent(uuid,text,jsonb)','execute') as anon,has_function_privilege('authenticated','public.scene_rpc_before_agent(uuid,text,jsonb)','execute') as authenticated,prosecdef as definer,proconfig as config from pg_proc where oid='public.scene_rpc_before_agent(uuid,text,jsonb)'::regprocedure");
  expect(proxy.rows[0]).toMatchObject({service:true,anon:false,authenticated:false,definer:true});expect(proxy.rows[0]!.config).toContain('search_path=""');
 });
 it('denies stale proposal application through every old entry and preserves the public stale guard',async()=>{
  const base=scene(),project=await f.rpc(owner,'projects.create',{studioId:studio,name:'Scene entry fixture',scene:base});
  const lease=await f.rpc(owner,'lease.acquire',{projectId:project.id,sessionId:session});
  const input=agentRunRequestSchema.parse({requestId:crypto.randomUUID(),sessionId:session,generation:lease.generation,expectedRevision:0,localRevision:0,scene:base,selectedIds:[],instruction:'30人活动',executionMode:'preview'});
  const hash=await sceneHash(base),created=await f.backend.agent!(owner,'create',{projectId:project.id,input,fingerprint:'a'.repeat(64),baseHash:hash,executionMode:'preview'});
  const started=await f.backend.agent!(owner,'start',{projectId:project.id,id:created.id}),key={projectId:project.id,id:created.id,claim:started.claim};
  await f.backend.agent!(owner,'take_notes',key);
  const first=await f.backend.agent!(owner,'checkpoint',{...key,steerTotal:0,candidates:[{label:'A',title:'预览',scene:base,explanation:'待核对',warnings:[],commands:[]}]});
  const proposalId=first.candidates[0].proposal.id;
  await f.backend.agent!(owner,'note',{projectId:project.id,id:created.id,note:'保留原物'});
  const apply={projectId:project.id,proposalId,sessionId:session,generation:lease.generation,expectedRevision:0,localRevision:0,baseHash:hash};
  for(const name of internal){
   await expect(f.db.transaction(async tx=>{await tx.exec('set local role service_role');return tx.query(`select public.${name}($1,$2,$3::jsonb)`,[owner,'proposals.apply',JSON.stringify(apply)]);})).rejects.toThrow(/permission denied/i);
  }
  await expect(f.db.transaction(async tx=>{await tx.exec('set local role service_role');return tx.query('select public.scene_rpc_before_agent($1,$2,$3::jsonb)',[owner,'proposals.apply',JSON.stringify(apply)]);})).rejects.toThrow('STALE_PROPOSAL');
  await expect(f.rpc(owner,'proposals.apply',apply)).rejects.toMatchObject({code:'STALE_PROPOSAL'});
  await expect(f.rpc(outsider,'projects.get',{projectId:project.id})).rejects.toThrow();
  expect((await f.rpc(owner,'projects.get',{projectId:project.id})).revision).toBe(0);
 });
});

it.each([
 ['service_role','scene_rpc_before_agent'],['service_role','scene_rpc_before_parametric'],
 ['service_role','scene_rpc_before_material_variants'],['service_role','scene_rpc_before_studio_delete'],
 ['service_role','scene_rpc_before_project_delete'],['service_role','scene_rpc_legacy'],
 ['anon','scene_rpc_legacy'],['authenticated','scene_rpc_legacy'],
] as const)('atomically refuses %s inherited access to %s without revoking unknown roles',async (role,inherited)=>{
 const db=new PGlite(),dir=new URL('../supabase/migrations/',import.meta.url),guard='20261109010000_scene_rpc_entry_guard.sql';
 try{
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create table auth.users(id uuid primary key,email text); grant usage on schema auth,public to service_role; grant select on auth.users to service_role; grant usage on schema public to anon,authenticated; create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);');
  // The annotation migration depends on this guard and must not be installed
  // while testing this guard's own preflight against an earlier schema.
  for(const file of readdirSync(dir).filter(name=>name.endsWith('.sql')&&name!==guard&&name!=='20261109160000_annotation_preview_guard.sql'&&name!=='20261109170000_planning_zones_guard.sql').sort())await db.exec(readFileSync(new URL(file,dir),'utf8'));
  await db.exec(`create role fixture_inherited; grant execute on function public.${inherited}(uuid,text,jsonb) to fixture_inherited; grant fixture_inherited to ${role};`);
  expect((await db.query<{allowed:boolean}>(`select has_function_privilege('${role}','public.${inherited}(uuid,text,jsonb)','execute') as allowed`)).rows[0]!.allowed).toBe(true);
  await expect(db.exec(readFileSync(new URL(guard,dir),'utf8'))).rejects.toThrow('SCENE_RPC_GUARD_INHERITED_PRIVILEGE');
  const check=await db.query<{old_exists:boolean;new_exists:boolean;inherited:boolean;outer_invoker:boolean}>(`select to_regprocedure('public.scene_rpc_before_agent(uuid,text,jsonb)') is not null as old_exists,to_regprocedure('public.scene_rpc_before_agent_unguarded(uuid,text,jsonb)') is not null as new_exists,has_function_privilege('fixture_inherited','public.${inherited}(uuid,text,jsonb)','execute') as inherited,not prosecdef as outer_invoker from pg_proc where oid='public.scene_rpc(uuid,text,jsonb)'::regprocedure`);
  expect(check.rows[0]).toEqual({old_exists:true,new_exists:false,inherited:true,outer_invoker:true});
 }finally{await db.close();}
},30000);
