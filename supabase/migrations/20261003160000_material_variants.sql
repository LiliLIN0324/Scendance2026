-- Immutable material variants reuse the existing asset IDs and scene proposal path.
-- These idempotency records do not reserve or consume any AI budget.
create table scene_private.material_customizations (
  owner_id uuid not null references auth.users, request_key uuid not null,
  fingerprint text not null, source_asset_id uuid not null references scene_private.assets,
  source_sha256 text not null, asset_id uuid not null unique default gen_random_uuid(),
  created_at timestamptz not null default now(), primary key(owner_id,request_key)
);
create table scene_private.material_variant_proposals (
  owner_id uuid not null references auth.users, request_key uuid not null,
  fingerprint text not null, proposal_id uuid not null unique references scene_private.proposals on delete cascade,
  primary key(owner_id,request_key)
);
alter table scene_private.material_customizations enable row level security;
alter table scene_private.material_variant_proposals enable row level security;
revoke all on scene_private.material_customizations,scene_private.material_variant_proposals from public,anon,authenticated;
grant select,insert on scene_private.material_customizations,scene_private.material_variant_proposals to service_role;

alter function public.scene_rpc(uuid,text,jsonb) rename to scene_rpc_before_material_variants;
create function public.scene_rpc(p_actor uuid,p_action text,p_data jsonb default '{}') returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare request scene_private.material_customizations; source scene_private.assets; target scene_private.assets;
  prior scene_private.material_variant_proposals; result jsonb; proposal_id uuid;
begin
  if p_action not in ('materials.reserve','materials.complete','materials.propose') then
    return public.scene_rpc_before_material_variants(p_actor,p_action,p_data);
  end if;
  if p_actor is null or not exists(select 1 from scene_private.members where user_id=p_actor) then raise exception 'FORBIDDEN'; end if;
  perform pg_advisory_xact_lock(hashtextextended('material:'||p_actor::text||':'||(p_data->>'requestId'),0));
  if p_action='materials.propose' then
    perform scene_private.require_lease(p_actor,p_data);
    select * into prior from scene_private.material_variant_proposals where owner_id=p_actor and request_key=(p_data->>'requestId')::uuid;
    if found then
      if prior.fingerprint is distinct from p_data->>'fingerprint' then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
      result:=public.scene_rpc_before_material_variants(p_actor,'proposals.get',p_data||jsonb_build_object('proposalId',prior.proposal_id));
      return result||'{"reused":true}';
    end if;
    proposal_id:=gen_random_uuid();
    result:=public.scene_rpc_before_material_variants(p_actor,'proposals.store',p_data||jsonb_build_object('id',proposal_id));
    insert into scene_private.material_variant_proposals values(p_actor,(p_data->>'requestId')::uuid,p_data->>'fingerprint',proposal_id);
    return result||'{"reused":false}';
  end if;
  select * into request from scene_private.material_customizations where owner_id=p_actor and request_key=(p_data->>'requestId')::uuid;
  if found then
    if request.fingerprint is distinct from p_data->>'fingerprint' then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
  elsif p_action='materials.complete' then raise exception 'REQUEST_NOT_FOUND';
  else
    if not scene_private.can_use_asset(p_actor,(p_data->>'sourceAssetId')::uuid) then raise exception 'ASSET_NOT_FOUND'; end if;
    select * into source from scene_private.assets where id=(p_data->>'sourceAssetId')::uuid and format='glb';
    if not found then raise exception 'ASSET_NOT_FOUND'; end if;
    if source.sha256 is distinct from p_data->>'sourceSha256' then raise exception 'ASSET_VERSION_CONFLICT'; end if;
    insert into scene_private.material_customizations(owner_id,request_key,fingerprint,source_asset_id,source_sha256)
      values(p_actor,(p_data->>'requestId')::uuid,p_data->>'fingerprint',source.id,source.sha256) returning * into request;
  end if;
  if not scene_private.can_use_asset(p_actor,request.source_asset_id) then raise exception 'ASSET_NOT_FOUND'; end if;
  select * into target from scene_private.assets where id=request.asset_id;
  if found then
    return jsonb_build_object('assetId',request.asset_id,'asset',to_jsonb(target)-'storage_path','reused',true);
  end if;
  if p_action='materials.reserve' then return jsonb_build_object('assetId',request.asset_id,'reused',false); end if;
  if p_data->'asset'->>'id' is distinct from request.asset_id::text
    or p_data->'asset'->>'format' is distinct from 'glb'
    or p_data->'asset'->'metadata'->>'parentAssetId' is distinct from request.source_asset_id::text
    or p_data->'asset'->'metadata'->>'sourceSha256' is distinct from request.source_sha256
    or p_data->'asset'->'metadata'->>'changeMode' is distinct from 'material'
    or p_data->'asset'->'metadata'->'materialVariant'->'validation'->>'geometryUVPreserved' is distinct from 'true'
    or p_data->'asset'->>'storagePath' is distinct from p_actor::text||'/'||request.asset_id::text||'/'||(p_data->'asset'->>'sha256')||'.glb'
    then raise exception 'INVALID_MATERIAL_VARIANT'; end if;
  result:=public.scene_rpc_before_material_variants(p_actor,'assets.register',p_data->'asset');
  return jsonb_build_object('asset',result,'reused',false);
end $$;
revoke all on function public.scene_rpc(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.scene_rpc(uuid,text,jsonb) to service_role;
