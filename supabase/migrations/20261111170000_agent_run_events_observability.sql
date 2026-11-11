-- Observability extension for bounded agent tool events.
-- Added columns are nullable; old clients and old events keep working unchanged.
-- The argument digest is a whitelist-only, truncated summary — never full geometry, prompts or secrets.

alter table scene_private.agent_run_events
  add column if not exists args_summary text
  check (args_summary is null or char_length(args_summary) <= 240);
alter table scene_private.agent_run_events
  add column if not exists duration_ms integer
  check (duration_ms is null or (duration_ms between 0 and 300000));

create or replace function public.agent_run_events_rpc(p_actor uuid,p_action text,p_data jsonb default '{}') returns jsonb
language plpgsql security invoker set search_path='' as $$
declare r scene_private.agent_runs; p scene_private.projects; cursor_value integer; next_seq integer; result jsonb;
begin
  if p_actor is null then raise exception 'UNAUTHENTICATED'; end if;
  select * into p from scene_private.projects where id=(p_data->>'projectId')::uuid and deleted_at is null;
  if not found or not scene_private.is_member(p_actor,p.studio_id) then raise exception 'PROJECT_NOT_FOUND'; end if;
  if p_action='append' then
    -- Observability must yield promptly to the actual run when its row is busy.
    perform set_config('lock_timeout','75ms',true);
    select * into r from scene_private.agent_runs where id=(p_data->>'id')::uuid and project_id=p.id and owner_id=p_actor for update;
  else
    select * into r from scene_private.agent_runs where id=(p_data->>'id')::uuid and project_id=p.id and owner_id=p_actor;
  end if;
  if not found then raise exception 'AGENT_RUN_NOT_FOUND'; end if;
  if p_action='append' then
    if r.state<>'running' or r.deadline<=clock_timestamp() or r.claim is distinct from (p_data->>'claim')::uuid then raise exception 'AGENT_RUN_STOPPED'; end if;
    -- Match the running agent's existing run-then-project lock order and lease/revision guard.
    -- The short lock timeout is telemetry-only: competing user actions must not wait on it.
    perform scene_private.require_lease(p_actor,r.input||jsonb_build_object('projectId',p.id));
    if jsonb_typeof(p_data->'event') <> 'object' or ((p_data->'event') - array['tool','stage','outcome','errorCode','argsSummary','durationMs']) <> '{}'::jsonb then raise exception 'INVALID_AGENT_EVENT'; end if;
    if p_data->'event'->>'argsSummary' is not null and char_length(p_data->'event'->>'argsSummary') > 240 then raise exception 'INVALID_AGENT_EVENT'; end if;
    select coalesce(max(seq),0)+1 into next_seq from scene_private.agent_run_events where run_id=r.id;
    if next_seq>128 then raise exception 'AGENT_EVENT_LIMIT'; end if;
    insert into scene_private.agent_run_events(run_id,seq,tool,stage,outcome,error_code,args_summary,duration_ms)
      values(r.id,next_seq,p_data->'event'->>'tool',p_data->'event'->>'stage',p_data->'event'->>'outcome',p_data->'event'->>'errorCode',
        p_data->'event'->>'argsSummary',
        case when p_data->'event'->'durationMs' is null then null else (p_data->'event'->>'durationMs')::integer end);
    return jsonb_build_object('seq',next_seq);
  elsif p_action='list' then
    cursor_value:=coalesce((p_data->>'after')::integer,0);
    if cursor_value<0 or cursor_value>128 then raise exception 'INVALID_AGENT_EVENT'; end if;
    select jsonb_build_object('events',coalesce(jsonb_agg(jsonb_build_object('seq',seq,'tool',tool,'stage',stage,'outcome',outcome,'errorCode',error_code,'argsSummary',args_summary,'durationMs',duration_ms) order by seq),'[]'::jsonb),
      'nextCursor',coalesce(max(seq),cursor_value),'mayBeIncomplete',true) into result
      from (select seq,tool,stage,outcome,error_code,args_summary,duration_ms from scene_private.agent_run_events where run_id=r.id and seq>cursor_value order by seq limit 50) e;
    return result;
  end if;
  raise exception 'UNKNOWN_ACTION';
end $$;
revoke all on function public.agent_run_events_rpc(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.agent_run_events_rpc(uuid,text,jsonb) to service_role;

-- Surface the human-readable downgrade message on a failed scene run. The internal fail update
-- leaves the message column untouched; this guarded wrapper persists it before delegating.
create or replace function public.agent_rpc_before_activity_tasks(p_actor uuid,p_action text,p_data jsonb default '{}') returns jsonb
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
  elsif p_action='fail' then
    update scene_private.agent_runs set message=coalesce(p_data->>'message',message) where id=r.id;
  end if;
  return public.agent_rpc_scene_unguarded_internal(p_actor,p_action,p_data);
end $$;
revoke all on function public.agent_rpc_before_activity_tasks(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.agent_rpc_before_activity_tasks(uuid,text,jsonb) to service_role;
