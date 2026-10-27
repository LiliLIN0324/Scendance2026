-- Aholo Lux3D joins as a second cloud vendor (docs/AHOLO-INTEGRATION-PLAN.md M1).
-- Provider identity stays pinned per job: a job created for Lux3D must never be
-- polled or archived through HY-3D configuration, and vice versa.
alter table scene_private.assets drop constraint assets_source_check;
alter table scene_private.assets add constraint assets_source_check check (source in ('hunyuan','polyhaven','upload','parametric','aholo'));
alter table scene_private.generation_jobs drop constraint generation_jobs_provider_mode_check;
alter table scene_private.generation_jobs drop constraint generation_jobs_provider_model_check;
alter table scene_private.generation_jobs
  add constraint generation_jobs_provider_mode_check check(provider_mode in ('tokenhub','legacy','aholo')),
  add constraint generation_jobs_provider_model_check check(provider_model in ('hy-3d-3.0','hy-3d-3.1','hy-3d-texture','lux3d'));
-- Replaces the 20261003161000 wrapper (which only accepted tokenhub/legacy). The chain stays
-- two levels: this validator -> job_rpc_generation_v1 (the original jobs RPC), never the old
-- validator, or aholo jobs would be rejected by it.
create or replace function public.job_rpc(p_actor uuid,p_action text,p_data jsonb default '{}') returns jsonb
language plpgsql security invoker set search_path='' as $$
declare result jsonb; v_kind text; v_mode text; v_model text; v_image_id uuid; v_source_id uuid;
begin
  if p_action='jobs.create' then
    v_kind:=coalesce(p_data->>'kind','text');v_mode:=coalesce(p_data->>'providerMode','tokenhub');v_model:=coalesce(p_data->>'providerModel','hy-3d-3.0');
    v_image_id:=(p_data->>'referenceImageAssetId')::uuid;v_source_id:=(p_data->>'sourceAssetId')::uuid;
    if v_kind not in ('text','image','texture') or v_mode not in ('tokenhub','legacy','aholo') or v_model not in ('hy-3d-3.0','hy-3d-3.1','hy-3d-texture','lux3d') then raise exception 'INVALID_GENERATION_INPUT'; end if;
    if (v_mode='aholo' and (v_model<>'lux3d' or v_kind='texture')) or (v_mode<>'aholo' and v_model='lux3d') then raise exception 'INVALID_GENERATION_INPUT'; end if;
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
