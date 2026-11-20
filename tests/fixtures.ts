import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { sceneSchema, type Scene } from '../supabase/functions/_shared/domain.ts';
import type { Backend, Rpc } from '../supabase/functions/_shared/backend.ts';
import { ApiError } from '../supabase/functions/_shared/domain.ts';

export const owner='10000000-0000-4000-8000-000000000001';
export const editor='10000000-0000-4000-8000-000000000002';
export const outsider='10000000-0000-4000-8000-000000000003';
export const studio='20000000-0000-4000-8000-000000000001';
export const session='30000000-0000-4000-8000-000000000001';
export function scene():Scene {return sceneSchema.parse({schemaVersion:1,venue:{shape:'rectangle',width:12,depth:10,height:3,entrances:[]},objects:[],camera:'overview',lighting:'neutral'});}
export function chair(notes='') {return {id:crypto.randomUUID(),materialId:'chair' as const,position:{x:3,z:3},rotation:0,size:{width:0.5,depth:0.5,height:0.85},color:'#ffffff',locked:false,notes};}
export async function database(dataDir?: string, options?:{excludeMigrations?:readonly string[]}) {
  const db=new PGlite(dataDir);
  const initialized = await db.query<{ present: boolean }>("select to_regnamespace('auth') is not null as present");
  if (!initialized.rows[0].present) await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    grant usage on schema auth,public to service_role; grant select on auth.users to service_role;
    grant usage on schema public to anon,authenticated;
    create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);`);
  // The team list reads the sign-up email through a definer helper, so the stand-in auth table needs the column too.
  await db.exec('alter table auth.users add column if not exists email text');
  // 真实 Supabase 里 auth.uid() 是内置函数；迁移可能拿它做列默认值，本地夹具要跟着有这个函数。
  await db.exec(`create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$`);
  await db.exec('create table if not exists public.local_fixture_migrations(name text primary key, checksum text not null)');
  const migrations = new URL('../supabase/migrations/', import.meta.url);
  for(const file of readdirSync(migrations).filter(f=>f.endsWith('.sql')&&!options?.excludeMigrations?.includes(f)).sort()) {
    const sql = readFileSync(new URL(file,migrations),'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    const existing = await db.query<{ checksum: string }>('select checksum from public.local_fixture_migrations where name=$1',[file]);
    if (existing.rows.length) {
      if (existing.rows[0].checksum !== checksum) throw new Error(`Local fixture migration changed: ${file}. Choose a new SCENDANCE_DEV_DATA directory; existing data has been preserved.`);
      continue;
    }
    await db.exec(sql);
    await db.query('insert into public.local_fixture_migrations values ($1,$2)',[file,checksum]);
  }
  await db.query("insert into auth.users(id,email) values ($1,'owner@example.test'),($2,'editor@example.test'),($3,'outsider@example.test') on conflict (id) do update set email=excluded.email",[owner,editor,outsider]);
  await db.query('insert into scene_private.studios(id,name) values ($1,$2) on conflict do nothing',[studio,'Test studio']);
  await db.query("insert into scene_private.members values ($1,$2,'owner','Owner'),($1,$3,'editor','Editor') on conflict do nothing",[studio,owner,editor]);
  // 本地联调用官方通知样例：全平台广播，owner/editor/outsider 登录都能看到；真实通知由服务端写入。
  await db.query(
    `insert into scene_private.official_notifications(id,kind,title,body) values
       ($1,'announcement',$2,$3),($4,'version',$5,$6)
     on conflict (id) do nothing`,
    ['10000000-0000-4000-8000-000000000091', '欢迎使用幕景 Scendance',
      '这是本地联调样例通知：公告、版本更新、活动提醒与系统通知都会出现在这里。',
      '10000000-0000-4000-8000-000000000092', '工作台 0.2 版本更新',
      '左侧消息面板已接通官方通知：点开一条会自动记为已读，未读红点在列表与左轨同步。']
  );
  const call=(fn:string):Rpc=>async(actor,action,data={})=>{
    try {
      const result=await db.transaction(async tx=>{
        await tx.exec('set local role service_role');
        return tx.query<{result:unknown}>(`select public.${fn}($1,$2,$3::jsonb) as result`,[actor,action,JSON.stringify(data)]);
      });
      return result.rows[0].result;
    } catch(error) {
      const code=(error as Error).message;
      if(/^[A-Z_]+$/.test(code)) throw new ApiError(code,code.endsWith('NOT_FOUND')?404:code==='UNAUTHENTICATED'?401:/FORBIDDEN/.test(code)?403:code==='PLATFORM_ADMIN_REQUIRED'?403:/BUDGET|BUSY/.test(code)?429:/LEASE|CONFLICT|STALE|CLAIM/.test(code)?409:/INTEGRITY|INCOMPLETE|TOO_LARGE|OBJECT_MISSING|STATE_INVALID|WORKSPACE_REQUIRED/.test(code)?422:409);
      // 与真实 backend.ts 同口径：非 ALL_CAPS 的数据库错误按 DATABASE_ERROR 汇报。
      throw new ApiError('DATABASE_ERROR',500);
    }
  };
  const core=call('scene_rpc'),studios=call('studio_rpc'),jobs=call('job_rpc'),reconstruction=call('reconstruction_rpc');
  const cloudRpc=call('cloud_storage_rpc');
  const sceneRpc:Rpc=(actor,action,data)=>(action.startsWith('studios.')?studios:action.startsWith('cloud.')?cloudRpc:core)(actor,action,data);
  const rawAgent=call('agent_rpc'),guardedAgent=call('agent_steering_guard_rpc');
  // 直传仿真：upload()/objects 模拟对象存储桶；stat/readSourceBytes 供完整性复核。
  const objects=new Map<string,Uint8Array>();
  const backend:Backend={
    scene:sceneRpc,cloud:call('cloud_storage_rpc'),jobs,reconstruction,
    originalSceneReview:call('original_scene_review_rpc'),
    agent:(actor,action,data)=>(['note','take_notes','checkpoint','finish'].includes(action)?guardedAgent:rawAgent)(actor,action,data),
    agentGuardReady:guardedAgent,agentEvents:call('agent_run_events_rpc'),
    user:async token=>{if([owner,editor,outsider].includes(token))return token;throw new ApiError('UNAUTHENTICATED',401);},
    upload:async(path,bytes)=>{objects.set(path,bytes);},
    readSourceBytes:async path=>{const hit=objects.get(path);if(!hit)throw new ApiError('STORAGE_DOWNLOAD_FAILED',502);return hit;},
    sign:async path=>`https://storage.example/signed/${path}`,
    stat:async path=>{const hit=objects.get(path);if(!hit)throw new ApiError('OBJECT_NOT_FOUND',404);return {size:hit.length};},
    createUploadUrl:async path=>({url:`https://storage.example/upload/${path}`,token:'fixture-upload-token'}),
  };
  return {db,rpc:sceneRpc,jobs,reconstruction,backend,objects};
}
