import {readFileSync,readdirSync} from 'node:fs';
import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {owner,outsider,session,scene,studio} from './fixtures.ts';
import {agentRunRequestSchema} from '../supabase/functions/_shared/agent-contract.ts';
import {ApiError,sceneHash} from '../supabase/functions/_shared/domain.ts';

const migration='20261109160000_annotation_preview_guard.sql';
const migrationDir=new URL('../supabase/migrations/',import.meta.url);
const migrationSql=()=>readFileSync(new URL(migration,migrationDir),'utf8');
async function databaseBeforeAnnotation(excludeEntryGuard=false){
 const db=new PGlite();
 await db.exec('create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create table auth.users(id uuid primary key,email text); grant usage on schema auth,public to service_role; grant select on auth.users to service_role; grant usage on schema public to anon,authenticated; create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);');
 for(const file of readdirSync(migrationDir).filter(name=>name.endsWith('.sql')&&name!==migration&&name!=='20261109170000_planning_zones_guard.sql'&&(!excludeEntryGuard||name!=='20261109010000_scene_rpc_entry_guard.sql')).sort())await db.exec(readFileSync(new URL(file,migrationDir),'utf8'));
 await db.query("insert into auth.users(id,email) values ($1,'owner@example.test'),($2,'outsider@example.test')",[owner,outsider]);
 await db.query('insert into scene_private.studios(id,name) values ($1,$2)',[studio,'Fixture studio']);
 await db.query("insert into scene_private.members values ($1,$2,'owner','Owner')",[studio,owner]);
 const call=(fn:string)=>async(actor:string,action:string,data:Record<string,unknown>={})=>{
  try{return (await db.transaction(async tx=>{await tx.exec('set local role service_role');return tx.query<{result:any}>(`select public.${fn}($1,$2,$3::jsonb) as result`,[actor,action,JSON.stringify(data)]);})).rows[0]!.result;}
  catch(error){const code=(error as Error).message;if(/^[A-Z_]+$/.test(code))throw new ApiError(code,409);throw error;}
 };
 const sceneRpc=call('scene_rpc'),agent=call('agent_rpc'),guarded=call('agent_steering_guard_rpc');
 return {db,rpc:sceneRpc,backend:{agent:(actor:string,action:string,data:Record<string,unknown>={})=>(['note','take_notes','checkpoint','finish'].includes(action)?guarded:agent)(actor,action,data)}};
}

/** All DDL and privilege behavior here is confined to a disposable PGlite fixture. */
describe('annotation preview guard migration in a local database',()=>{
 let f:Awaited<ReturnType<typeof databaseBeforeAnnotation>>,preexistingOrphan:Awaited<ReturnType<typeof finish>>,preexistingLinked:Awaited<ReturnType<typeof finish>>,preexistingOrdinary:Awaited<ReturnType<typeof finish>>,preexistingApplied:Awaited<ReturnType<typeof finish>>;
 let oldCandidate:unknown,appliedExpiry:unknown;
 async function begin(annotated:boolean){
  const base=scene(),project=await f.rpc(owner,'projects.create',{studioId:studio,name:'synthetic trigger case',scene:base});
  const lease=await f.rpc(owner,'lease.acquire',{projectId:project.id,sessionId:session});
  const context={brief:'',acceptedDecisions:[],recentMessages:[],...(annotated?{annotationObservation:{status:'unavailable' as const}}:{})};
  const input=agentRunRequestSchema.parse({requestId:crypto.randomUUID(),sessionId:session,generation:lease.generation,expectedRevision:0,localRevision:0,scene:base,selectedIds:[],instruction:'fixture',context,executionMode:'preview'});
  const hash=await sceneHash(base),created=await f.backend.agent!(owner,'create',{projectId:project.id,input,fingerprint:'c'.repeat(64),baseHash:hash,executionMode:'preview'});
  const started=await f.backend.agent!(owner,'start',{projectId:project.id,id:created.id});
  const payload={projectId:project.id,id:created.id,claim:started.claim,steerTotal:0,candidates:[{label:'A',title:'fixture',scene:base,explanation:'fixture',warnings:[],commands:[]}]};
  return {base,project,lease,hash,runId:created.id,payload};
 }
 async function finish(value:Awaited<ReturnType<typeof begin>>){
  const result=await f.backend.agent!(owner,'finish',value.payload),proposalId=result.candidates[0].proposal.id;
  return {...value,proposalId,candidateSnapshot:result.candidates[0].proposal,body:{projectId:value.project.id,proposalId,sessionId:session,generation:value.lease.generation,expectedRevision:0,localRevision:0,baseHash:value.hash}};
 }
 beforeAll(async()=>{
  f=await databaseBeforeAnnotation();
  // This intentionally models an orphan created before the fixture guard exists.
  preexistingOrphan=await finish(await begin(true));await f.db.query('delete from scene_private.agent_runs where id=$1',[preexistingOrphan.runId]);
  preexistingLinked=await finish(await begin(true));
  preexistingOrdinary=await finish(await begin(false));
  preexistingApplied=await finish(await begin(false));await f.rpc(owner,'proposals.apply',preexistingApplied.body);
  oldCandidate=(await f.db.query<{candidate:unknown}>('select candidate from scene_private.proposals where id=$1',[preexistingOrdinary.proposalId])).rows[0]!.candidate;
  appliedExpiry=(await f.db.query<{expires_at:unknown}>('select expires_at from scene_private.proposals where id=$1',[preexistingApplied.proposalId])).rows[0]!.expires_at;
  await f.db.exec(migrationSql());
 },30000);afterAll(async()=>{await f.db.close();});
 it('stamps the authoritative proposal and survives run deletion',async()=>{
  const value=await finish(await begin(true));
  const row=(await f.db.query<{warnings:unknown}>('select warnings from scene_private.proposals where id=$1',[value.proposalId])).rows[0]!;
  expect(row.warnings).toContainEqual({code:'ANNOTATION_PREVIEW_ONLY',ids:[]});
  expect(value.candidateSnapshot.warnings).toContainEqual({code:'ANNOTATION_PREVIEW_ONLY',ids:[]});
  await f.db.query('delete from scene_private.agent_runs where id=$1',[value.runId]);
  await expect(f.rpc(owner,'proposals.apply',value.body)).rejects.toThrow('ANNOTATION_PREVIEW_ONLY');
  expect((await f.rpc(owner,'projects.get',{projectId:value.project.id})).revision).toBe(0);
 });
 it('exposes readiness only after project membership is checked',async()=>{
  const value=await finish(await begin(false));
  expect(await f.rpc(owner,'annotations.readiness',{projectId:value.project.id})).toEqual({capability:'annotation_preview_guard',version:1});
  await expect(f.rpc(outsider,'annotations.readiness',{projectId:value.project.id})).rejects.toThrow();
  await expect(f.rpc(owner,'annotations.readiness',{projectId:crypto.randomUUID()})).rejects.toThrow();
 });
 it.each([true,false])('keeps checkpoint, finish and get warning copies consistent: annotated=%s',async annotated=>{
  const value=await begin(annotated),key={projectId:value.project.id,id:value.runId,claim:value.payload.claim,steerTotal:0};
  const checkpoint=await f.backend.agent!(owner,'checkpoint',value.payload),proposalId=checkpoint.candidates[0].proposal.id;
  const authoritative=(await f.db.query<{warnings:unknown}>('select warnings from scene_private.proposals where id=$1',[proposalId])).rows[0]!.warnings;
  expect(checkpoint.candidates[0].proposal.warnings).toEqual(authoritative);
  expect(authoritative).toEqual(annotated?[{code:'ANNOTATION_PREVIEW_ONLY',ids:[]}]:[]);
  const complete=await f.backend.agent!(owner,'finish',key);expect(complete.candidates[0].proposal.warnings).toEqual(authoritative);
  const reread=await f.backend.agent!(owner,'get',{projectId:value.project.id,id:value.runId});expect(reread.candidates[0].proposal.warnings).toEqual(authoritative);
 });
 it('keeps a newly recorded ordinary legacy run usable even after its run is removed',async()=>{
  const value=await finish(await begin(false));await f.db.query('delete from scene_private.agent_runs where id=$1',[value.runId]);
  await expect(f.rpc(owner,'proposals.apply',value.body)).resolves.toMatchObject({revision:1});
 });
 it('keeps a valid historical run with omitted context on the legacy path',async()=>{
  const value=await begin(false);
  await f.db.query("update scene_private.agent_runs set input=input-'context' where id=$1",[value.runId]);
  const finished=await finish(value);expect(finished.candidateSnapshot.warnings).toEqual([]);
  await expect(f.rpc(owner,'proposals.apply',finished.body)).resolves.toMatchObject({revision:1});
 });
 it.each([null,[], 'not-an-object'])('rejects a malformed present context during checkpoint: %s',async context=>{
  const value=await begin(false);
  await f.db.query("update scene_private.agent_runs set input=jsonb_set(input,'{context}',$1::jsonb,true) where id=$2",[JSON.stringify(context),value.runId]);
  await expect(finish(value)).rejects.toThrow('ANNOTATION_SOURCE_UNKNOWN');
  expect((await f.db.query('select id from scene_private.proposals where project_id=$1',[value.project.id])).rows).toHaveLength(0);
  await f.backend.agent!(owner,'cancel',{projectId:value.project.id,id:value.runId});
 });
 it('blocks ordinary service-role update from removing the fixed marker',async()=>{
  const value=await finish(await begin(true));
  await expect(f.db.transaction(async tx=>{await tx.exec('set local role service_role');return tx.query("update scene_private.proposals set warnings='[]'::jsonb where id=$1",[value.proposalId]);})).rejects.toThrow('ANNOTATION_MARKER_IMMUTABLE');
 });
 it('blocks the guarded old proxy and the pre-existing unguarded alias in the local fixture',async()=>{
  const value=await finish(await begin(true));await f.db.query('delete from scene_private.agent_runs where id=$1',[value.runId]);
  await expect(f.db.transaction(async tx=>{await tx.exec('set local role service_role');return tx.query('select public.scene_rpc_before_agent($1,$2,$3::jsonb)',[owner,'proposals.apply',JSON.stringify(value.body)]);})).rejects.toThrow('ANNOTATION_PREVIEW_ONLY');
  await expect(f.db.transaction(async tx=>{await tx.exec('set local role service_role');return tx.query('select public.scene_rpc_before_agent_unguarded($1,$2,$3::jsonb)',[owner,'proposals.apply',JSON.stringify(value.body)]);})).rejects.toThrow(/permission denied/i);
 });
 it('rolls back proposal and marker if the enclosing checkpoint transaction fails',async()=>{
  const value=await begin(true);
  await expect(f.db.transaction(async tx=>{await tx.query('select public.agent_steering_guard_rpc($1,$2,$3::jsonb)',[owner,'finish',JSON.stringify(value.payload)]);throw new Error('FIXTURE_ROLLBACK');})).rejects.toThrow('FIXTURE_ROLLBACK');
  expect((await f.db.query('select id from scene_private.proposals where project_id=$1',[value.project.id])).rows).toHaveLength(0);
  expect((await f.db.query<{state:string}>('select state from scene_private.agent_runs where id=$1',[value.runId])).rows[0]?.state).toBe('running');
  await f.backend.agent!(owner,'cancel',{projectId:value.project.id,id:value.runId});
 });
 it('expires pre-install orphan and ordinary candidates without removing their scenes or candidate data',async()=>{
  await expect(f.db.transaction(async tx=>{await tx.exec('set local role service_role');return tx.query("update scene_private.proposals set expires_at=clock_timestamp()+interval '10 minutes' where id=$1",[preexistingOrphan.proposalId]);})).rejects.toThrow('EXPIRED_PROPOSAL_IMMUTABLE');
  await expect(f.rpc(owner,'proposals.apply',preexistingOrphan.body)).rejects.toThrow('STALE_PROPOSAL');
  await expect(f.rpc(owner,'proposals.apply',preexistingOrdinary.body)).rejects.toThrow('STALE_PROPOSAL');
  const row=(await f.db.query<{candidate:unknown;expires_at:Date}>('select candidate,expires_at from scene_private.proposals where id=$1',[preexistingOrdinary.proposalId])).rows[0]!;
  expect(row.candidate).toEqual(oldCandidate);expect(new Date(row.expires_at).getTime()).toBeLessThanOrEqual(Date.now());
  expect((await f.rpc(owner,'projects.get',{projectId:preexistingOrdinary.project.id})).revision).toBe(0);
  const applied=(await f.db.query<{expires_at:unknown}>('select expires_at from scene_private.proposals where id=$1',[preexistingApplied.proposalId])).rows[0]!;expect(applied.expires_at).toEqual(appliedExpiry);
 });
 it('keeps a pre-install linked candidate expired even if its run is later deleted',async()=>{
  await expect(f.rpc(owner,'proposals.apply',preexistingLinked.body)).rejects.toThrow('ANNOTATION_PREVIEW_ONLY');
  await f.db.query('delete from scene_private.agent_runs where id=$1',[preexistingLinked.runId]);
  await expect(f.rpc(owner,'proposals.apply',preexistingLinked.body)).rejects.toThrow('STALE_PROPOSAL');
 });
 it('rolls back installation and expiry together if installation fails',async()=>{
  const other=await databaseBeforeAnnotation();
  try{
   const base=scene(),project=await other.rpc(owner,'projects.create',{studioId:studio,name:'synthetic install rollback',scene:base});
   const lease=await other.rpc(owner,'lease.acquire',{projectId:project.id,sessionId:session}),proposalId=crypto.randomUUID(),hash=await sceneHash(base);
   await other.rpc(owner,'proposals.store',{projectId:project.id,sessionId:session,generation:lease.generation,expectedRevision:0,localRevision:0,id:proposalId,baseHash:hash,scene:base,candidate:base,explanation:'fixture',warnings:[]});
   const prior=(await other.db.query<{expires_at:unknown}>('select expires_at from scene_private.proposals where id=$1',[proposalId])).rows[0]!.expires_at;
   const sql=migrationSql();if(!sql.includes('end $install$;'))throw new Error('migration terminator missing');
   await expect(other.db.exec(sql.replace('end $install$;',"raise exception 'FIXTURE_INSTALL_ABORT'; end $install$;"))).rejects.toThrow('FIXTURE_INSTALL_ABORT');
   expect((await other.db.query<{expires_at:unknown}>('select expires_at from scene_private.proposals where id=$1',[proposalId])).rows[0]!.expires_at).toEqual(prior);
   await expect(other.rpc(owner,'proposals.apply',{projectId:project.id,proposalId,sessionId:session,generation:lease.generation,expectedRevision:0,localRevision:0,baseHash:hash})).resolves.toMatchObject({revision:1});
  }finally{await other.db.close();}
 },30000);
 it('refuses missing entry guard before installing or expiring anything',async()=>{
  const other=await databaseBeforeAnnotation(true);
  try{
   await expect(other.db.exec(migrationSql())).rejects.toThrow('ANNOTATION_GUARD_PREREQUISITE_MISSING');
   expect((await other.db.query<{present:boolean}>("select to_regprocedure('scene_private.annotation_mark_proposal()') is not null as present")).rows[0]?.present).toBe(false);
  }finally{await other.db.close();}
 },30000);
 it.each(['service_role','anon','authenticated'] as const)('refuses an unsafe local internal grant to %s without expiring pending proposals',async role=>{
  const other=await databaseBeforeAnnotation();
  try{
   const base=scene(),project=await other.rpc(owner,'projects.create',{studioId:studio,name:'preflight fixture',scene:base});
   const lease=await other.rpc(owner,'lease.acquire',{projectId:project.id,sessionId:session}),proposalId=crypto.randomUUID(),hash=await sceneHash(base);
   await other.rpc(owner,'proposals.store',{projectId:project.id,sessionId:session,generation:lease.generation,expectedRevision:0,localRevision:0,id:proposalId,baseHash:hash,scene:base,candidate:base,explanation:'fixture',warnings:[]});
   const expiry=(await other.db.query<{expires_at:unknown}>('select expires_at from scene_private.proposals where id=$1',[proposalId])).rows[0]!.expires_at;
   await other.db.exec(`grant execute on function public.scene_rpc_before_agent_unguarded(uuid,text,jsonb) to ${role}`);
   await expect(other.db.exec(migrationSql())).rejects.toThrow('ANNOTATION_GUARD_UNSAFE_INTERNAL');
   expect((await other.db.query<{expires_at:unknown}>('select expires_at from scene_private.proposals where id=$1',[proposalId])).rows[0]!.expires_at).toEqual(expiry);
   expect((await other.db.query<{present:boolean}>("select to_regprocedure('scene_private.annotation_mark_proposal()') is not null as present")).rows[0]?.present).toBe(false);
  }finally{await other.db.close();}
 },30000);
 it('refuses a proxy with unexpected security mode',async()=>{
  const other=await databaseBeforeAnnotation();
  try{
   await other.db.exec('alter function public.scene_rpc_before_agent(uuid,text,jsonb) security invoker');
   await expect(other.db.exec(migrationSql())).rejects.toThrow('ANNOTATION_GUARD_UNEXPECTED_FUNCTION');
  }finally{await other.db.close();}
 },30000);
 it('refuses a proxy with unexpected search_path',async()=>{
  const other=await databaseBeforeAnnotation();
  try{
   await other.db.exec('alter function public.scene_rpc_before_agent(uuid,text,jsonb) set search_path=public');
   await expect(other.db.exec(migrationSql())).rejects.toThrow('ANNOTATION_GUARD_UNEXPECTED_FUNCTION');
  }finally{await other.db.close();}
 },30000);
});
