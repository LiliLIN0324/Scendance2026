-- Tombstones retain immutable publications and provider/billing evidence.
alter table scene_private.projects add column deleted_at timestamptz;

create or replace function scene_private.require_lease(actor uuid, input jsonb, check_revision boolean default true)
returns scene_private.projects language plpgsql set search_path = '' as $$
declare p scene_private.projects;
begin
  select * into p from scene_private.projects where id=(input->>'projectId')::uuid for update;
  if not found or p.deleted_at is not null or not scene_private.is_member(actor,p.studio_id) then raise exception 'PROJECT_NOT_FOUND'; end if;
  if p.lease_user is distinct from actor or p.lease_session is distinct from (input->>'sessionId')::uuid or
    p.lease_generation is distinct from (input->>'generation')::bigint or p.lease_expires is null or p.lease_expires <= clock_timestamp() then raise exception 'LEASE_LOST'; end if;
  if check_revision and p.revision is distinct from (input->>'expectedRevision')::bigint then raise exception 'REVISION_CONFLICT'; end if;
  return p;
end $$;

alter function public.scene_rpc(uuid,text,jsonb) rename to scene_rpc_before_project_delete;
create function public.scene_rpc(p_actor uuid,p_action text,p_data jsonb default '{}') returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare p scene_private.projects;
begin
  if p_action='projects.list' then
    if p_actor is null then raise exception 'UNAUTHENTICATED'; end if;
    return coalesce((select jsonb_agg(to_jsonb(x)) from (select pr.id,pr.name,pr.studio_id,pr.revision,pr.updated_at,
      case when pr.lease_expires>clock_timestamp() then m.display_name end as current_editor,pr.lease_expires
      from scene_private.projects pr left join scene_private.members m on m.studio_id=pr.studio_id and m.user_id=pr.lease_user
      where pr.deleted_at is null and scene_private.is_member(p_actor,pr.studio_id) order by pr.updated_at desc limit 100) x),'[]');
  end if;
  if p_data ? 'projectId' then
    select * into p from scene_private.projects where id=(p_data->>'projectId')::uuid for update;
    if not found or not scene_private.is_member(p_actor,p.studio_id) then raise exception 'PROJECT_NOT_FOUND'; end if;
    if p_action='projects.delete' then
      if not exists(select 1 from scene_private.members where studio_id=p.studio_id and user_id=p_actor and role='owner') then raise exception 'FORBIDDEN'; end if;
      if p.deleted_at is not null then return '{"deleted":true}'; end if;
      if p.revision is distinct from (p_data->>'expectedRevision')::bigint then raise exception 'REVISION_CONFLICT'; end if;
      if p.lease_expires>clock_timestamp() then raise exception 'PROJECT_BUSY'; end if;
      if exists(select 1 from scene_private.reconstruction_jobs where project_id=p.id and state in ('queued','recognizing','planning','validating')) then raise exception 'RECONSTRUCTION_BUSY'; end if;
      update scene_private.projects set deleted_at=clock_timestamp(),updated_at=clock_timestamp(),
        lease_user=null,lease_session=null,lease_expires=null,lease_generation=lease_generation+1 where id=p.id;
      update scene_private.shares set revoked_at=clock_timestamp() where revoked_at is null and publication_id in
        (select id from scene_private.publications where project_id=p.id);
      update scene_private.proposals set expires_at=clock_timestamp() where project_id=p.id;
      return '{"deleted":true}';
    end if;
    if p.deleted_at is not null then raise exception 'PROJECT_NOT_FOUND'; end if;
  end if;
  return public.scene_rpc_before_project_delete(p_actor,p_action,p_data);
end $$;
revoke all on function public.scene_rpc(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.scene_rpc(uuid,text,jsonb) to service_role;

create or replace function scene_private.can_use_asset(actor uuid, asset uuid) returns boolean
language sql stable set search_path = '' as $$
  select exists(select 1 from scene_private.assets a where a.id = asset and
    (a.owner_id = actor or exists(select 1 from scene_private.project_assets pa
      join scene_private.projects p on p.id = pa.project_id
      where pa.asset_id = a.id and p.deleted_at is null and scene_private.is_member(actor,p.studio_id))
    or (exists(select 1 from scene_private.members where user_id=actor)
      and exists(select 1 from scene_private.library_assets where asset_id=a.id))))
$$;

alter function public.reconstruction_rpc(uuid,text,jsonb) rename to reconstruction_rpc_before_project_delete;
create function public.reconstruction_rpc(p_actor uuid,p_action text,p_data jsonb default '{}') returns jsonb
language plpgsql security invoker set search_path = '' as $$
begin
  if p_action='get' then perform public.scene_rpc(p_actor,'projects.get',p_data); end if;
  return public.reconstruction_rpc_before_project_delete(p_actor,p_action,p_data);
end $$;
revoke all on function public.reconstruction_rpc(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.reconstruction_rpc(uuid,text,jsonb) to service_role;
