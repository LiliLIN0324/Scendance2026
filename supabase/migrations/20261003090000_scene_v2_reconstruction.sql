-- Additive, independent development migration. No existing scene/snapshot is rewritten.
do $$ declare constraint_name text; begin
 select conname into constraint_name from pg_constraint where conrelid='scene_private.projects'::regclass and contype='c' and pg_get_constraintdef(oid) like '%schemaVersion%';
 if constraint_name is not null then execute format('alter table scene_private.projects drop constraint %I',constraint_name); end if;
end $$;
alter table scene_private.projects add constraint projects_scene_version_check check(jsonb_typeof(scene->'objects')='array' and jsonb_array_length(scene->'objects')<=50 and scene->>'schemaVersion' in ('1','2'));
alter table scene_private.assets drop constraint assets_format_check;
alter table scene_private.assets add constraint assets_format_check check(format in ('glb','png','jpeg','webp'));
update storage.buckets set allowed_mime_types=array['model/gltf-binary','image/png','image/jpeg','image/webp'] where id='scene-assets';
create or replace function scene_private.check_assets(actor uuid, doc jsonb) returns void
language plpgsql set search_path = '' as $$
declare o jsonb; aid uuid;
begin
  if (doc->>'schemaVersion') not in ('1','2') or jsonb_typeof(doc->'objects') is distinct from 'array' or jsonb_array_length(doc->'objects') > 50 then raise exception 'INVALID_SCENE'; end if;
  for o in select value from jsonb_array_elements(doc->'objects') loop
    if o->>'materialId' = 'asset' then
      aid := (o->>'assetId')::uuid;
      if not scene_private.can_use_asset(actor,aid) or not exists(select 1 from scene_private.assets where id=aid and format='glb') then raise exception 'ASSET_FORBIDDEN'; end if;
    elsif not exists(select 1 from scene_private.materials where id=o->>'materialId') or o ? 'assetId' then raise exception 'INVALID_MATERIAL';
    end if;
  end loop;
  if doc->'venue' ? 'floorplanAssetId' then
    aid := (doc->'venue'->>'floorplanAssetId')::uuid;
    if not scene_private.can_use_asset(actor,aid) or not exists(select 1 from scene_private.assets where id=aid and format in ('png','jpeg','webp')) then raise exception 'ASSET_FORBIDDEN'; end if;
  end if;
  if doc->>'schemaVersion'='2' then
    if jsonb_typeof(doc->'structure'->'walls') is distinct from 'array' or jsonb_typeof(doc->'structure'->'openings') is distinct from 'array' or jsonb_typeof(doc->'structure'->'columns') is distinct from 'array' or jsonb_typeof(doc->'sources') is distinct from 'array' or jsonb_array_length(doc->'sources')>12 then raise exception 'INVALID_SCENE'; end if;
    for o in select value from jsonb_array_elements(doc->'sources') loop
      aid := (o->>'assetId')::uuid;
      if not scene_private.can_use_asset(actor,aid) or not exists(select 1 from scene_private.assets where id=aid and format in ('png','jpeg','webp')) then raise exception 'ASSET_FORBIDDEN'; end if;
    end loop;
  end if;
end $$;
create or replace function scene_private.save_scene(actor uuid, input jsonb, doc jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare p scene_private.projects;
begin
  p := scene_private.require_lease(actor,input);
  if p.scene->>'schemaVersion'='2' and doc->>'schemaVersion'='1' and input->>'restoreFromProposal' is null then raise exception 'SCHEMA_DOWNGRADE_FORBIDDEN'; end if;
  perform scene_private.check_assets(actor,doc);
  update scene_private.projects set scene=doc, revision=revision+1, updated_at=clock_timestamp() where id=p.id returning * into p;
  -- Reference grants survive removal so immutable publications keep their resource access.
  insert into scene_private.project_assets(project_id,asset_id)
    select p.id,(o->>'assetId')::uuid from jsonb_array_elements(doc->'objects') o where o ? 'assetId'
    union select p.id,(doc->'venue'->>'floorplanAssetId')::uuid where doc->'venue' ? 'floorplanAssetId'
    union select p.id,(o->>'assetId')::uuid from jsonb_array_elements(coalesce(doc->'sources','[]')) o
    on conflict do nothing;
  return jsonb_build_object('id',p.id,'revision',p.revision,'scene',p.scene,'updatedAt',p.updated_at);
end $$;


create or replace function scene_private.public_scene(doc jsonb) returns jsonb
language sql immutable set search_path='' as $$
 with sanitized as (select jsonb_set(jsonb_set(doc-'sources'-'dimensions','{venue}',(doc->'venue')-'floorplanAssetId'),'{objects}',coalesce((select jsonb_agg(o-'notes') from jsonb_array_elements(doc->'objects') o),'[]')) as scene)
 select case when doc->>'schemaVersion'='2' then jsonb_set(scene,'{structure,walls}',coalesce((select jsonb_agg(w-'evidence') from jsonb_array_elements(doc->'structure'->'walls') w),'[]')) else scene end from sanitized
$$;

create table scene_private.source_images (
 project_id uuid not null references scene_private.projects on delete cascade,
 asset_id uuid not null references scene_private.assets,
 kind text not null check(kind in ('floorplan','photo')),
 primary key(project_id,asset_id)
);
alter table scene_private.source_images enable row level security;
revoke all on scene_private.source_images from public,anon,authenticated;
grant select,insert,update,delete on scene_private.source_images to service_role;
alter table scene_private.proposals add column restored_at timestamptz;
alter function public.scene_rpc(uuid,text,jsonb) rename to scene_rpc_legacy;
create function public.scene_rpc(p_actor uuid,p_action text,p_data jsonb default '{}') returns jsonb
language plpgsql security invoker set search_path='' as $$
declare p scene_private.projects; result jsonb; previous scene_private.proposals;
begin
 if p_action='history.restore' then
  p:=scene_private.require_lease(p_actor,p_data);
  select * into previous from scene_private.proposals where id=(p_data->>'proposalId')::uuid and project_id=p.id and user_id=p_actor for update;
  if not found or previous.applied_at is null or previous.restored_at is not null or p.scene is distinct from previous.candidate or p_data->'currentScene' is distinct from previous.candidate then raise exception 'STALE_HISTORY_RESTORE'; end if;
  result:=scene_private.save_scene(p_actor,p_data||jsonb_build_object('restoreFromProposal',previous.id),previous.base_scene);
  update scene_private.proposals set restored_at=clock_timestamp() where id=previous.id;
  return result||jsonb_build_object('previousScene',previous.candidate,'undoGroup',previous.id);
 end if;
 if p_action='proposals.get' then
  select * into p from scene_private.projects where id=(p_data->>'projectId')::uuid;
  if not found or not scene_private.is_member(p_actor,p.studio_id) then raise exception 'PROJECT_NOT_FOUND'; end if;
  select to_jsonb(proposal) into result from scene_private.proposals proposal where project_id=p.id and user_id=p_actor and id=(p_data->>'proposalId')::uuid;
  if result is null then raise exception 'PROPOSAL_NOT_FOUND'; end if;
  return result;
 end if;
 if p_action in ('sources.list','sources.register','sources.unlink','sources.find') then
  select * into p from scene_private.projects where id=(p_data->>'projectId')::uuid for update;
  if not found or not scene_private.is_member(p_actor,p.studio_id) then raise exception 'PROJECT_NOT_FOUND'; end if;
  if p_action='sources.unlink' then
   delete from scene_private.source_images where project_id=p.id and asset_id=(p_data->>'assetId')::uuid;
   if not found then raise exception 'SOURCE_NOT_FOUND'; end if;
   return '{"removed":true}';
  end if;
  if p_action in ('sources.register','sources.find') then
   select jsonb_build_object('assetId',image.id,'kind',link.kind,'name',image.name,'width',image.metadata->'width','height',image.metadata->'height') into result from scene_private.source_images link join scene_private.assets image on image.id=link.asset_id where link.project_id=p.id and link.kind=p_data->>'kind' and image.sha256=coalesce(p_data->>'sha256',p_data->'asset'->>'sha256');
   if result is not null or p_action='sources.find' then return result; end if;
  end if;
  if p_action='sources.list' then
   return coalesce((select jsonb_agg(jsonb_build_object('assetId',a.id,'kind',s.kind,'name',a.name,'width',a.metadata->'width','height',a.metadata->'height') order by a.created_at) from scene_private.source_images s join scene_private.assets a on a.id=s.asset_id where s.project_id=p.id),'[]');
  end if;
  if (select count(*) from scene_private.source_images where project_id=p.id)>=12 then raise exception 'SOURCE_LIMIT_EXCEEDED'; end if;
  if p_data->'asset'->>'format' not in ('png','jpeg','webp') then raise exception 'INVALID_SOURCE_IMAGE'; end if;
  result:=public.scene_rpc_legacy(p_actor,'assets.register',p_data->'asset');
  insert into scene_private.source_images values(p.id,(p_data->'asset'->>'id')::uuid,p_data->>'kind');
  insert into scene_private.project_assets values(p.id,(p_data->'asset'->>'id')::uuid) on conflict do nothing;
  return jsonb_build_object('assetId',result->'id','kind',p_data->'kind','name',result->'name','width',result->'metadata'->'width','height',result->'metadata'->'height');
 end if;
 result:=public.scene_rpc_legacy(p_actor,p_action,p_data);
 if p_action='projects.create' and p_data->'scene'->>'schemaVersion'='2' then
  insert into scene_private.project_assets select (result->>'id')::uuid,(o->>'assetId')::uuid from jsonb_array_elements(p_data->'scene'->'sources') o on conflict do nothing;
 end if;
 return result;
end $$;
revoke all on function public.scene_rpc(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.scene_rpc(uuid,text,jsonb) to service_role;

create table scene_private.reconstruction_jobs (
 id uuid primary key default gen_random_uuid(),project_id uuid not null references scene_private.projects,
 owner_id uuid not null references auth.users,request_key uuid not null,fingerprint text not null,
 input jsonb not null,base_hash text not null,state text not null default 'queued' check(state in ('queued','recognizing','needs_review','planning','validating','ready','failed')),
 candidate jsonb,issues jsonb not null default '[]',proposal_id uuid references scene_private.proposals,
 worker_token uuid,worker_until timestamptz,error_code text,usage jsonb not null default '[]',
 reserve_cents integer not null check(reserve_cents>0),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(owner_id,request_key)
);
create index reconstruction_queue on scene_private.reconstruction_jobs(created_at) where state='queued';
create table scene_private.reconstruction_calls (
 job_id uuid not null references scene_private.reconstruction_jobs,stage text not null check(stage in ('recognition','planning')),usage_day date not null references scene_private.text_daily_budgets,reserved_cents integer not null check(reserved_cents>0),primary key(job_id,stage)
);
alter table scene_private.reconstruction_jobs enable row level security;
alter table scene_private.reconstruction_calls enable row level security;
revoke all on scene_private.reconstruction_jobs,scene_private.reconstruction_calls from public,anon,authenticated;
grant select,insert,update,delete on scene_private.reconstruction_jobs,scene_private.reconstruction_calls to service_role;
create function public.reconstruction_rpc(p_actor uuid,p_action text,p_data jsonb default '{}') returns jsonb
language plpgsql security invoker set search_path='' as $$
declare p scene_private.projects; j scene_private.reconstruction_jobs; b scene_private.budgets; result jsonb; source jsonb; cost integer; day date; spent integer; next_state text;
begin
 if p_action='review.check' then
  p:=scene_private.require_lease(p_actor,p_data->'input');
  select * into j from scene_private.reconstruction_jobs where id=(p_data->'input'->>'reviewedJobId')::uuid and project_id=p.id and owner_id=p_actor;
  if not found or j.state<>'needs_review' or j.candidate is null or j.base_hash is distinct from p_data->>'baseHash' or j.input->'expectedRevision' is distinct from p_data->'input'->'expectedRevision' or j.input->'sources' is distinct from p_data->'input'->'sources' then raise exception 'STALE_RECONSTRUCTION_REVIEW'; end if;
  return '{"valid":true}';
 end if;
 if p_action='create' then
  p:=scene_private.require_lease(p_actor,p_data->'input');
  if p_data->'input' ? 'reviewedJobId' then perform public.reconstruction_rpc(p_actor,'review.check',p_data); end if;
  select * into j from scene_private.reconstruction_jobs where owner_id=p_actor and request_key=(p_data->'input'->>'requestId')::uuid;
  if found then
   if j.fingerprint<>p_data->>'fingerprint' then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
   return (to_jsonb(j)-'input'-'worker_token'-'worker_until'-'base_hash')||'{"reused":true}';
  end if;
  for source in select value from jsonb_array_elements(p_data->'input'->'sources') loop
   if not exists(select 1 from scene_private.source_images where project_id=p.id and asset_id=(source->>'assetId')::uuid) then raise exception 'ASSET_FORBIDDEN'; end if;
  end loop;
  cost:=(p_data->>'reserveCents')::integer;
  if cost is null or cost<=0 then raise exception 'BILLING_NOT_CONFIGURED'; end if;
  select * into b from scene_private.budgets where kind='text' for update;
  if b.committed_cents+cost>b.limit_cents then raise exception 'BUDGET_EXCEEDED'; end if;
  if exists(select 1 from scene_private.reconstruction_jobs where project_id=p.id and state in ('queued','recognizing','planning','validating')) then raise exception 'RECONSTRUCTION_BUSY'; end if;
  update scene_private.budgets set committed_cents=committed_cents+cost where kind='text';
  insert into scene_private.reconstruction_jobs(project_id,owner_id,request_key,fingerprint,input,base_hash,reserve_cents)
   values(p.id,p_actor,(p_data->'input'->>'requestId')::uuid,p_data->>'fingerprint',p_data->'input',p_data->>'baseHash',cost) returning * into j;
  -- New reviewed input invalidates older reconstruction candidates, including already stored proposals.
  update scene_private.proposals set expires_at=clock_timestamp() where id in(select proposal_id from scene_private.reconstruction_jobs where project_id=p.id and id<>j.id and proposal_id is not null);
  return (to_jsonb(j)-'input'-'worker_token'-'worker_until'-'base_hash')||'{"reused":false}';
 elsif p_action='get' then
  select r.* into j from scene_private.reconstruction_jobs r join scene_private.projects proj on proj.id=r.project_id where r.id=(p_data->>'id')::uuid and r.project_id=(p_data->>'projectId')::uuid and scene_private.is_member(p_actor,proj.studio_id);
  if not found then raise exception 'RECONSTRUCTION_NOT_FOUND'; end if;
  return (to_jsonb(j)-'input'-'worker_token'-'worker_until'-'base_hash')||jsonb_build_object('proposal',(select to_jsonb(proposal) from scene_private.proposals proposal where id=j.proposal_id));
 elsif p_action='claim' then
  -- A provider call interrupted after dispatch is unknown, never silently billed twice.
  update scene_private.reconstruction_jobs set state='failed',error_code='PROVIDER_RESULT_UNKNOWN',worker_token=null,worker_until=null where state in('recognizing','planning','validating') and worker_until<clock_timestamp();
  select * into j from scene_private.reconstruction_jobs where state='queued' order by created_at for update skip locked limit 1;
  if not found then return 'null'; end if;
  update scene_private.reconstruction_jobs set state='recognizing',worker_token=gen_random_uuid(),worker_until=clock_timestamp()+interval '8 minutes',updated_at=clock_timestamp() where id=j.id returning * into j;
  return to_jsonb(j);
 end if;
 select * into j from scene_private.reconstruction_jobs where id=(p_data->>'id')::uuid for update;
 if not found or j.worker_token is distinct from (p_data->>'workerToken')::uuid or j.worker_token is null or j.worker_until<=clock_timestamp() then raise exception 'WORKER_CLAIM_LOST'; end if;
 if p_action='reserve_call' then
  if exists(select 1 from scene_private.reconstruction_calls where job_id=j.id and stage=p_data->>'stage') then raise exception 'AI_CALL_ALREADY_RESERVED'; end if;
  cost:=j.reserve_cents/2;
  day:=(clock_timestamp() at time zone 'Asia/Shanghai')::date;
  insert into scene_private.text_daily_budgets(usage_day) values(day) on conflict do nothing;
  update scene_private.text_daily_budgets set committed_cents=committed_cents+cost where usage_day=day and committed_cents+cost<=1000 returning committed_cents into spent;
  if not found then raise exception 'DAILY_BUDGET_EXCEEDED'; end if;
  insert into scene_private.reconstruction_calls values(j.id,p_data->>'stage',day,cost);
  return jsonb_build_object('reservedCents',cost,'committedCents',spent);
 elsif p_action='update' then
  next_state:=p_data->>'state';
  if not ((j.state='recognizing' and next_state in('planning','needs_review','failed')) or (j.state='planning' and next_state in('validating','needs_review','failed')) or (j.state='validating' and next_state in('ready','needs_review','failed'))) then raise exception 'INVALID_JOB_TRANSITION'; end if;
  if next_state='ready' then
   result:=public.scene_rpc(j.owner_id,'proposals.store',j.input||jsonb_build_object('projectId',j.project_id,'id',j.id,'baseHash',j.base_hash,'candidate',p_data->'candidate','explanation',p_data->>'explanation','warnings',coalesce(p_data->'warnings','[]')));
  end if;
  update scene_private.reconstruction_jobs set state=next_state,candidate=coalesce(p_data->'candidate',candidate),issues=coalesce(p_data->'issues',issues),error_code=p_data->>'errorCode',usage=coalesce(p_data->'usage',usage),proposal_id=case when next_state='ready' then j.id else proposal_id end,worker_token=case when next_state in('ready','needs_review','failed') then null else worker_token end,worker_until=case when next_state in('ready','needs_review','failed') then null else worker_until end,updated_at=clock_timestamp() where id=j.id returning * into j;
  return to_jsonb(j)-'input'-'worker_token'-'worker_until'-'base_hash';
 end if;
 raise exception 'UNKNOWN_ACTION';
end $$;
revoke all on function public.reconstruction_rpc(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.reconstruction_rpc(uuid,text,jsonb) to service_role;
