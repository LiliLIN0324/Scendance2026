-- Guard steering and candidate publication in one transaction without changing existing tables.
-- Deploy this RPC before routing new application traffic to it; never fall back to agent_rpc
-- for these actions when it is absent, since that would silently drop the guard.
create function public.agent_steering_guard_rpc(p_actor uuid,p_action text,p_data jsonb default '{}') returns jsonb
language plpgsql security invoker set search_path='' as $$
declare r scene_private.agent_runs; p scene_private.projects; result jsonb; expected integer;
begin
  select * into p from scene_private.projects where id=(p_data->>'projectId')::uuid;
  if p_actor is null or not found or not scene_private.is_member(p_actor,p.studio_id) then raise exception 'PROJECT_NOT_FOUND'; end if;
  -- Read-only, versioned capability probe. It runs before a task is created,
  -- so missing/old migrations never leave a queued run that cannot finish.
  if p_action='readiness' then
    if p.deleted_at is not null then raise exception 'PROJECT_NOT_FOUND'; end if;
    return jsonb_build_object('capability','agent_steering_guard','version',1);
  end if;
  select * into r from scene_private.agent_runs where id=(p_data->>'id')::uuid and owner_id=p_actor and project_id=p.id for update;
  -- The shared dispatcher also serves activity-task runs. Delegate non-scene
  -- IDs to it so its original authorization and action semantics remain intact.
  if not found then return public.agent_rpc(p_actor,p_action,p_data); end if;
  if p_action='note' then
    -- The original RPC validates membership, state, deadline and note input.
    -- Do not inherit its drop-oldest behaviour: an acknowledged user request
    -- must not silently disappear when the bounded queue fills.
    if jsonb_array_length(r.steer_notes)>=8 then raise exception 'AGENT_STEERING_QUEUE_FULL'; end if;
    result:=public.agent_rpc(p_actor,p_action,p_data);
    -- Any already-checkpointed proposal predates the newly accepted request.
    -- scene_rpc's proposal-apply check consults the run's current candidates.
    update scene_private.agent_runs set candidates='[]'::jsonb,evaluation=null where id=r.id returning * into r;
    return scene_private.agent_view(r)||'{"accepted":true}'::jsonb;
  elsif p_action='take_notes' then
    result:=public.agent_rpc(p_actor,p_action,p_data);
    return result||jsonb_build_object('steerTotal',r.steer_total);
  elsif p_action in ('checkpoint','finish') then
    begin expected:=(p_data->>'steerTotal')::integer;
    exception when others then raise exception 'AGENT_STEERING_CHANGED'; end;
    -- Old workers without this field remain compatible only before any note has
    -- ever been accepted. Once steering exists a precise consumed version is mandatory.
    if expected is null and r.steer_total=0 then expected:=0; end if;
    if expected is null or expected<0 or expected<>r.steer_total or jsonb_array_length(r.steer_notes)<>0 then
      raise exception 'AGENT_STEERING_CHANGED';
    end if;
    return public.agent_rpc(p_actor,p_action,p_data);
  end if;
  raise exception 'UNKNOWN_ACTION';
end $$;
revoke all on function public.agent_steering_guard_rpc(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.agent_steering_guard_rpc(uuid,text,jsonb) to service_role;
