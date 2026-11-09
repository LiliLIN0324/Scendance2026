-- Explicit reviews for scenes whose ordinary API view is intentionally incomplete.
-- New private table/function only; existing tables and RPCs are unchanged.
create table scene_private.original_scene_reviews (
  id uuid primary key, project_id uuid not null references scene_private.projects,
  user_id uuid not null references auth.users, session_id uuid not null,
  generation bigint not null, base_revision bigint not null,
  base_scene jsonb not null, base_hash text not null, candidate jsonb not null,
  candidate_hash text not null, expires_at timestamptz not null default now()+interval '15 minutes',
  applied_at timestamptz, applied_revision bigint
);
alter table scene_private.original_scene_reviews enable row level security;
revoke all on scene_private.original_scene_reviews from public,anon,authenticated;
grant select,insert,update on scene_private.original_scene_reviews to service_role;

create function public.original_scene_review_rpc(p_actor uuid,p_action text,p_data jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare p scene_private.projects; r scene_private.original_scene_reviews; result jsonb;
begin
 if p_actor is null then raise exception 'UNAUTHENTICATED'; end if;
 if p_action='get' then
  select review.* into r from scene_private.original_scene_reviews review
   join scene_private.projects project on project.id=review.project_id
   where review.id=(p_data->>'id')::uuid and review.project_id=(p_data->>'projectId')::uuid
    and review.user_id=p_actor and scene_private.is_member(p_actor,project.studio_id);
  if not found then raise exception 'ORIGINAL_REVIEW_NOT_FOUND'; end if;
  return to_jsonb(r);
 end if;
 p:=scene_private.require_lease(p_actor,p_data);
 if p_action='create' then
  if p.scene is distinct from p_data->'baseScene' then raise exception 'ORIGINAL_SCENE_CHANGED'; end if;
  perform scene_private.check_assets(p_actor,p_data->'candidate');
  select * into r from scene_private.original_scene_reviews where id=(p_data->>'id')::uuid for update;
  if found then
   if r.project_id<>p.id or r.user_id<>p_actor or r.session_id is distinct from p.lease_session or r.generation<>p.lease_generation
    or r.base_revision<>p.revision or r.base_scene is distinct from p.scene or r.candidate is distinct from p_data->'candidate'
    or r.base_hash is distinct from p_data->>'baseHash' or r.candidate_hash is distinct from p_data->>'candidateHash'
    then raise exception 'ORIGINAL_REVIEW_CONFLICT'; end if;
   return to_jsonb(r)||'{"reused":true}';
  end if;
  insert into scene_private.original_scene_reviews(id,project_id,user_id,session_id,generation,base_revision,base_scene,base_hash,candidate,candidate_hash)
   values((p_data->>'id')::uuid,p.id,p_actor,p.lease_session,p.lease_generation,p.revision,p.scene,p_data->>'baseHash',p_data->'candidate',p_data->>'candidateHash') returning * into r;
  return to_jsonb(r)||'{"reused":false}';
 elsif p_action='apply' then
  select * into r from scene_private.original_scene_reviews where id=(p_data->>'id')::uuid and project_id=p.id and user_id=p_actor for update;
  if not found or r.applied_at is not null or r.expires_at<=clock_timestamp() or r.session_id is distinct from p.lease_session
    or r.generation<>p.lease_generation or r.base_revision<>p.revision or r.base_scene is distinct from p.scene
    or r.base_hash is distinct from p_data->>'baseHash' or r.candidate_hash is distinct from p_data->>'candidateHash'
    then raise exception 'ORIGINAL_REVIEW_STALE'; end if;
  result:=scene_private.save_scene(p_actor,p_data,r.candidate);
  update scene_private.original_scene_reviews set applied_at=clock_timestamp(),applied_revision=(result->>'revision')::bigint where id=r.id;
  return result;
 end if;
 raise exception 'UNKNOWN_ACTION';
end $$;
revoke all on function public.original_scene_review_rpc(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.original_scene_review_rpc(uuid,text,jsonb) to service_role;
