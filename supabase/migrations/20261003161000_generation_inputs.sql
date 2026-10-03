-- Existing production jobs used TokenHub 3.0. Persist the provider identity so
-- future configuration changes cannot query an old paid job through a new model.
alter table scene_private.generation_jobs
  add column kind text not null default 'text' check(kind in ('text','image','texture')),
  add column provider_mode text not null default 'tokenhub' check(provider_mode in ('tokenhub','legacy')),
  add column provider_model text not null default 'hy-3d-3.0' check(provider_model in ('hy-3d-3.0','hy-3d-3.1','hy-3d-texture')),
  add column reference_image_asset_id uuid references scene_private.assets,
  add column source_asset_id uuid references scene_private.assets;
alter table scene_private.generation_jobs add constraint generation_input_shape check(
  (kind='text' and reference_image_asset_id is null and source_asset_id is null) or
  (kind='image' and reference_image_asset_id is not null and source_asset_id is null) or
  (kind='texture' and reference_image_asset_id is not null and source_asset_id is not null)
);
alter function public.job_rpc(uuid,text,jsonb) rename to job_rpc_generation_v1;
create function public.job_rpc(p_actor uuid,p_action text,p_data jsonb default '{}') returns jsonb
language plpgsql security invoker set search_path='' as $$
declare result jsonb; v_kind text; v_mode text; v_model text; v_image_id uuid; v_source_id uuid;
begin
  if p_action='jobs.create' then
    v_kind:=coalesce(p_data->>'kind','text');v_mode:=coalesce(p_data->>'providerMode','tokenhub');v_model:=coalesce(p_data->>'providerModel','hy-3d-3.0');
    v_image_id:=(p_data->>'referenceImageAssetId')::uuid;v_source_id:=(p_data->>'sourceAssetId')::uuid;
    if v_kind not in ('text','image','texture') or v_mode not in ('tokenhub','legacy') or v_model not in ('hy-3d-3.0','hy-3d-3.1','hy-3d-texture') then raise exception 'INVALID_GENERATION_INPUT'; end if;
    if (v_mode='legacy' and (v_kind<>'text' or v_model<>'hy-3d-3.0')) or (v_kind='texture')<>(v_model='hy-3d-texture') then raise exception 'INVALID_GENERATION_INPUT'; end if;
    if not ((v_kind='text' and v_image_id is null and v_source_id is null) or (v_kind='image' and v_image_id is not null and v_source_id is null) or (v_kind='texture' and v_image_id is not null and v_source_id is not null)) then raise exception 'INVALID_GENERATION_INPUT'; end if;
    if v_image_id is not null and not exists(select 1 from scene_private.assets where id=v_image_id and owner_id=p_actor and format in ('png','jpeg')) then raise exception 'REFERENCE_IMAGE_FORBIDDEN'; end if;
    if v_source_id is not null and (not scene_private.can_use_asset(p_actor,v_source_id) or not exists(select 1 from scene_private.assets where id=v_source_id and format='glb')) then raise exception 'ASSET_FORBIDDEN'; end if;
    result:=public.job_rpc_generation_v1(p_actor,p_action,p_data);
    if not (result->>'reused')::boolean then
      update scene_private.generation_jobs set kind=v_kind,provider_mode=v_mode,provider_model=v_model,reference_image_asset_id=v_image_id,source_asset_id=v_source_id where id=(result->>'id')::uuid;
      select to_jsonb(j)||jsonb_build_object('reused',false) into result from scene_private.generation_jobs j where id=(result->>'id')::uuid;
    end if;
    return result;
  end if;
  return public.job_rpc_generation_v1(p_actor,p_action,p_data);
end $$;
revoke all on function public.job_rpc(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.job_rpc(uuid,text,jsonb) to service_role;
