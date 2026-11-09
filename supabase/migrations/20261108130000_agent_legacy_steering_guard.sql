-- One serialization point for both legacy and current scene workers.
-- No tables change. Only the service-facing wrappers can execute the old body.
alter function public.agent_rpc_before_activity_tasks(uuid,text,jsonb)
  rename to agent_rpc_scene_unguarded_internal;
revoke all on function public.agent_rpc_scene_unguarded_internal(uuid,text,jsonb) from public,anon,authenticated,service_role;

create function public.agent_rpc_before_activity_tasks(p_actor uuid,p_action text,p_data jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare r scene_private.agent_runs; p scene_private.projects; result jsonb; expected integer;
begin
  -- Preserve the dispatcher contract for callers that accidentally invoke the
  -- scene entry for an activity-task run; activity tasks keep their own RPC.
  if p_action='create' and coalesce((p_data->'input') ? 'kind',false) then
    return public.agent_rpc(p_actor,p_action,p_data);
  end if;
  if p_action in ('create','by_request') then
    return public.agent_rpc_scene_unguarded_internal(p_actor,p_action,p_data);
  end if;
  select * into p from scene_private.projects where id=(p_data->>'projectId')::uuid;
  if p_actor is null or not found or not scene_private.is_member(p_actor,p.studio_id) then raise exception 'PROJECT_NOT_FOUND'; end if;
  select * into r from scene_private.agent_runs where id=(p_data->>'id')::uuid and owner_id=p_actor and project_id=p.id for update;
  if not found then return public.agent_rpc_scene_unguarded_internal(p_actor,p_action,p_data); end if;
  if r.input->>'kind'='activity_tasks' then return public.agent_rpc(p_actor,p_action,p_data); end if;
  if p_action='note' then
    if r.state not in ('queued','running') or r.deadline<=clock_timestamp() then raise exception 'AGENT_RUN_STOPPED'; end if;
    if jsonb_array_length(r.steer_notes)>=8 then raise exception 'AGENT_STEERING_QUEUE_FULL'; end if;
    -- One write: accepting a note invalidates all previous proposals atomically.
    update scene_private.agent_runs set
      steer_notes=steer_notes||jsonb_build_array(jsonb_build_object('text',left(coalesce(p_data->>'note',''),500),'at',clock_timestamp())),
      steer_total=steer_total+1,candidates='[]'::jsonb,evaluation=null
      where id=r.id returning * into r;
    return scene_private.agent_view(r)||'{"accepted":true}'::jsonb;
  elsif p_action='take_notes' then
    result:=public.agent_rpc_scene_unguarded_internal(p_actor,p_action,p_data);
    return result||jsonb_build_object('steerTotal',r.steer_total);
  elsif p_action in ('checkpoint','finish') then
    begin expected:=(p_data->>'steerTotal')::integer;
    exception when others then raise exception 'AGENT_STEERING_CHANGED'; end;
    if expected is null and r.steer_total=0 then expected:=0; end if;
    if expected is null or expected<0 or expected<>r.steer_total or jsonb_array_length(r.steer_notes)<>0 then raise exception 'AGENT_STEERING_CHANGED'; end if;
  end if;
  return public.agent_rpc_scene_unguarded_internal(p_actor,p_action,p_data);
end $$;
revoke all on function public.agent_rpc_before_activity_tasks(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.agent_rpc_before_activity_tasks(uuid,text,jsonb) to service_role;

create or replace function public.agent_steering_guard_rpc(p_actor uuid,p_action text,p_data jsonb default '{}') returns jsonb
language plpgsql security invoker set search_path='' as $$
declare p scene_private.projects;
begin
  if p_action='readiness' then
    select * into p from scene_private.projects where id=(p_data->>'projectId')::uuid;
    if p_actor is null or not found or p.deleted_at is not null or not scene_private.is_member(p_actor,p.studio_id) then raise exception 'PROJECT_NOT_FOUND'; end if;
    return jsonb_build_object('capability','agent_steering_guard','version',1);
  end if;
  if p_action not in ('note','take_notes','checkpoint','finish') then raise exception 'UNKNOWN_ACTION'; end if;
  return public.agent_rpc(p_actor,p_action,p_data);
end $$;
revoke all on function public.agent_steering_guard_rpc(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.agent_steering_guard_rpc(uuid,text,jsonb) to service_role;
