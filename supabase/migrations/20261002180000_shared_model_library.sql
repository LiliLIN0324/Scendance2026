-- Only the administrator's validated catalogue is shared. Existing private assets,
-- scene writes, leases, Auth, AI budgets and publication checks keep their contracts.
create table scene_private.library_assets (
  model_id text primary key check (model_id ~ '^[a-z0-9-]{1,200}$'),
  asset_id uuid not null unique references scene_private.assets(id)
);
alter table scene_private.library_assets enable row level security;
revoke all on scene_private.library_assets from public, anon, authenticated;
grant select, insert on scene_private.library_assets to service_role;

create or replace function scene_private.can_use_asset(actor uuid, asset uuid) returns boolean
language sql stable set search_path = '' as $$
  select exists(select 1 from scene_private.assets a where a.id = asset and
    (a.owner_id = actor or exists(select 1 from scene_private.project_assets pa
      join scene_private.projects p on p.id = pa.project_id
      where pa.asset_id = a.id and scene_private.is_member(actor,p.studio_id))
    or (exists(select 1 from scene_private.members where user_id=actor)
      and exists(select 1 from scene_private.library_assets where asset_id=a.id))))
$$;

-- Called by the batch importer with a service-role credential, after the exact
-- content-addressed GLB has been uploaded. No browser or user-facing import route.
create function public.register_library_asset(p_owner uuid, p_model_id text, p_record jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare existing scene_private.assets; result jsonb;
begin
  if p_model_id is null or p_model_id !~ '^[a-z0-9-]{1,200}$'
    or p_record->>'source' is distinct from 'upload'
    or p_record->>'sourceId' is distinct from p_model_id
    or p_record->>'sourceUrl' is distinct from 'https://3dassets.dev/assets/' || p_model_id
    or p_record->>'format' is distinct from 'glb'
    or p_record->'license'->>'id' is distinct from 'CC0-1.0'
    or p_record->'metadata'->>'catalog' is distinct from 'scendance-v041'
    or p_record->>'storagePath' is distinct from p_owner::text || '/' || (p_record->>'id') || '/' || (p_record->>'sha256') || '.glb'
    then raise exception 'INVALID_LIBRARY_ASSET'; end if;
  if not exists(select 1 from scene_private.members where user_id=p_owner) then raise exception 'FORBIDDEN'; end if;
  perform pg_advisory_xact_lock(hashtextextended('library:' || p_model_id,0));
  select a.* into existing from scene_private.library_assets l join scene_private.assets a on a.id=l.asset_id where l.model_id=p_model_id;
  if found then
    if existing.id is distinct from (p_record->>'id')::uuid or existing.sha256 is distinct from p_record->>'sha256'
      or existing.owner_id is distinct from p_owner or existing.storage_path is distinct from p_record->>'storagePath'
      then raise exception 'LIBRARY_ASSET_CONFLICT'; end if;
    return to_jsonb(existing)-'storage_path';
  end if;
  result := public.scene_rpc(p_owner,'assets.register',p_record);
  insert into scene_private.library_assets values(p_model_id,(p_record->>'id')::uuid);
  return result;
end $$;
revoke all on function public.register_library_asset(uuid,text,jsonb) from public, anon, authenticated;
grant execute on function public.register_library_asset(uuid,text,jsonb) to service_role;
