-- All scene actions must enter through the agent-aware dispatcher. Older
-- dispatchers predate the candidate-version check and must not be callable
-- directly by API roles. No existing table or stored data is changed.
--
-- The existing dispatcher remains SECURITY INVOKER, with its body and actor/
-- lease checks unchanged. Its first delegate is replaced by an equivalent
-- guarded SECURITY DEFINER proxy; only that proxy can invoke the old chain.
-- Fail closed rather than changing behaviour on an unexpected ownership or
-- role-inheritance configuration; verify the target database before deploy.
-- A single DO statement keeps the preflight, revocations and replacement
-- atomic even when the migration runner does not wrap a file in a transaction.
do $guard$
declare
  expected_owner oid;
  old_name text;
  old_proc regprocedure;
  role_name text;
begin
  select p.proowner into expected_owner
    from pg_catalog.pg_proc p
    where p.oid='public.scene_rpc(uuid,text,jsonb)'::regprocedure;
  if expected_owner is null then raise exception 'SCENE_RPC_GUARD_OWNER_MISSING'; end if;
  if expected_owner is distinct from (select r.oid from pg_catalog.pg_roles r where r.rolname=current_user)
     or (select p.prosecdef from pg_catalog.pg_proc p where p.oid='public.scene_rpc(uuid,text,jsonb)'::regprocedure) then
    raise exception 'SCENE_RPC_GUARD_UNEXPECTED_OWNER_OR_MODE';
  end if;
  if pg_catalog.to_regprocedure('public.scene_rpc_before_agent_unguarded(uuid,text,jsonb)') is not null then
    raise exception 'SCENE_RPC_GUARD_ALREADY_EXISTS';
  end if;
  if pg_catalog.pg_has_role('service_role',expected_owner,'MEMBER')
     or pg_catalog.pg_has_role('anon',expected_owner,'MEMBER')
     or pg_catalog.pg_has_role('authenticated',expected_owner,'MEMBER') then
    raise exception 'SCENE_RPC_GUARD_UNSAFE_OWNER';
  end if;
  foreach old_name in array array[
    'public.scene_rpc_before_agent(uuid,text,jsonb)',
    'public.scene_rpc_before_parametric(uuid,text,jsonb)',
    'public.scene_rpc_before_material_variants(uuid,text,jsonb)',
    'public.scene_rpc_before_studio_delete(uuid,text,jsonb)',
    'public.scene_rpc_before_project_delete(uuid,text,jsonb)',
    'public.scene_rpc_legacy(uuid,text,jsonb)'
  ] loop
    old_proc:=pg_catalog.to_regprocedure(old_name);
    if old_proc is null then raise exception 'SCENE_RPC_GUARD_ENTRY_MISSING'; end if;
    if (select p.proowner from pg_catalog.pg_proc p where p.oid=old_proc) is distinct from expected_owner then
      raise exception 'SCENE_RPC_GUARD_OWNER_MISMATCH';
    end if;
  end loop;
  execute 'alter function public.scene_rpc_before_agent(uuid,text,jsonb) rename to scene_rpc_before_agent_unguarded';
  foreach old_name in array array[
    'public.scene_rpc_before_agent_unguarded(uuid,text,jsonb)',
    'public.scene_rpc_before_parametric(uuid,text,jsonb)',
    'public.scene_rpc_before_material_variants(uuid,text,jsonb)',
    'public.scene_rpc_before_studio_delete(uuid,text,jsonb)',
    'public.scene_rpc_before_project_delete(uuid,text,jsonb)',
    'public.scene_rpc_legacy(uuid,text,jsonb)'
  ] loop
    execute pg_catalog.format('revoke all on function %s from public,anon,authenticated,service_role',old_name);
    foreach role_name in array array['service_role','anon','authenticated'] loop
      if pg_catalog.has_function_privilege(role_name,pg_catalog.to_regprocedure(old_name),'EXECUTE') then
        raise exception 'SCENE_RPC_GUARD_INHERITED_PRIVILEGE';
      end if;
    end loop;
  end loop;

  execute $create$create function public.scene_rpc_before_agent(p_actor uuid,p_action text,p_data jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $body$
declare r scene_private.agent_runs;
begin
  -- Same locked check as the public invoker, also enforced when an old worker
  -- calls this delegate directly instead of entering through scene_rpc.
  if p_action='proposals.apply' then
    select a.* into r from scene_private.agent_runs a join scene_private.agent_proposals link on link.run_id=a.id
      where link.proposal_id=(p_data->>'proposalId')::uuid for update of a;
    if found and (r.state<>'complete' or not exists(select 1 from pg_catalog.jsonb_array_elements(r.candidates) c where c->'proposal'->>'id'=p_data->>'proposalId') or r.owner_id is distinct from p_actor or r.project_id is distinct from (p_data->>'projectId')::uuid) then raise exception 'STALE_PROPOSAL'; end if;
  end if;
  return public.scene_rpc_before_agent_unguarded(p_actor,p_action,p_data);
end $body$;$create$;
  execute 'revoke all on function public.scene_rpc_before_agent(uuid,text,jsonb) from public,anon,authenticated';
  execute 'grant execute on function public.scene_rpc_before_agent(uuid,text,jsonb) to service_role';
  if pg_catalog.has_function_privilege('anon','public.scene_rpc_before_agent(uuid,text,jsonb)','EXECUTE')
     or pg_catalog.has_function_privilege('authenticated','public.scene_rpc_before_agent(uuid,text,jsonb)','EXECUTE') then
    raise exception 'SCENE_RPC_GUARD_UNSAFE_PROXY_GRANT';
  end if;
end $guard$;
