-- Deterministic generation record (P2). Every paid generation job now stores the
-- exact prepared identity: lane decision, legacy idempotency fingerprint, a full
-- input hash that includes the explicit provider, the prompt hash, and the pinned
-- vendor. Archiving adds the output SHA-256 so a delivered asset can be traced to
-- the request that produced it. Cloud vendors stay non-deterministic; the record
-- makes the input reproducible and the output verifiable, not the pixels repeatable.
alter table scene_private.generation_jobs add column generation jsonb not null default '{}'::jsonb;

alter function public.job_rpc(uuid,text,jsonb) rename to job_rpc_generation_v2;
create function public.job_rpc(p_actor uuid,p_action text,p_data jsonb default '{}') returns jsonb
language plpgsql security invoker set search_path='' as $$
declare result jsonb; record_input jsonb;
begin
  if p_action='jobs.create' then
    record_input:=p_data->'generation';
    -- Prepared API/agent requests always carry the record. Service-role callers
    -- that predate this contract keep working with an empty audit only.
    if record_input is not null and (jsonb_typeof(record_input) is distinct from 'object'
      or record_input->>'version' is distinct from '1'
      or coalesce(record_input->>'fingerprint','') !~ '^[a-f0-9]{64}$'
      or coalesce(record_input->>'inputHash','') !~ '^[a-f0-9]{64}$'
      or coalesce(record_input->>'promptSha256','') !~ '^[a-f0-9]{64}$'
      or record_input->>'kind' is distinct from coalesce(p_data->>'kind','text')
      or record_input->>'lane' is null
      or record_input->>'lane' not in ('offline','library','parametric','hy3d','aholo')
      or record_input->>'providerMode' is distinct from coalesce(p_data->>'providerMode','tokenhub')
      or record_input->>'providerModel' is distinct from coalesce(p_data->>'providerModel','hy-3d-3.0')
      or nullif(record_input->>'referenceImageAssetId','')::uuid is distinct from (p_data->>'referenceImageAssetId')::uuid
      or nullif(record_input->>'sourceAssetId','')::uuid is distinct from (p_data->>'sourceAssetId')::uuid)
      then raise exception 'INVALID_GENERATION_RECORD'; end if;
    result:=public.job_rpc_generation_v2(p_actor,p_action,p_data);
    if record_input is not null and not coalesce((result->>'reused')::boolean,false) then
      update scene_private.generation_jobs set generation=record_input where id=(result->>'id')::uuid;
      select to_jsonb(j)||jsonb_build_object('reused',false) into result from scene_private.generation_jobs j where id=(result->>'id')::uuid;
    end if;
    return result;
  elsif p_action='jobs.complete' then
    result:=public.job_rpc_generation_v2(p_actor,p_action,p_data);
    update scene_private.generation_jobs
      set generation=generation||jsonb_build_object('outputSha256',p_data->'asset'->>'sha256','assetId',p_data->'asset'->>'id')
      where id=(p_data->>'id')::uuid returning to_jsonb(generation_jobs) into result;
    return result;
  end if;
  return public.job_rpc_generation_v2(p_actor,p_action,p_data);
end $$;
revoke all on function public.job_rpc(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.job_rpc(uuid,text,jsonb) to service_role;
