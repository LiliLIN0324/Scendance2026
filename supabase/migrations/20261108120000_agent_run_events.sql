-- Optional, bounded execution observations. Existing tables and RPCs stay unchanged.
-- A missing event never means a tool did not execute or that safety was checked.
create table scene_private.agent_run_events (
  run_id uuid not null references scene_private.agent_runs(id) on delete cascade,
  seq integer not null check (seq between 1 and 128),
  tool text not null check (tool in ('get_scene','search_resources','search_places','inspect_zone','find_free_areas','prepare_seating_candidate','prepare_shared_seating_candidate','create_parametric_model','inspect_materials','customize_material','validate_candidate','submit_candidates','get_bom','start_lux3d_model')),
  stage text not null check (stage in ('started','finished')),
  outcome text check (outcome in ('success','failed','unknown')),
  error_code text check (error_code in ('INVALID_TOOL_INPUT','UNKNOWN_TOOL','AGENT_TOOL_FAILED','CANDIDATE_GEOMETRY_CONFLICT','CANDIDATES_NOT_DISTINCT','DIMENSION_CONFLICT','INVALID_SELECTION','INVALID_MATERIAL_TARGET','OBJECT_LOCKED','OBJECT_NOT_FOUND','OUT_OF_BOUNDS','STRUCTURAL_COLLISION','RESOURCE_NOT_FOUND','PREPARED_CANDIDATE_NOT_FOUND','VALIDATED_CANDIDATE_NOT_FOUND','SEATING_ALLOCATION_CONFLICT','SEATING_ALLOCATION_UNCONFIRMED','SEATING_SPEC_CONFLICT','SEATING_SPEC_UNCONFIRMED','PLACE_SEARCH_FAILED','PLACE_SEARCH_UNAVAILABLE')),
  primary key (run_id, seq),
  check ((stage='started' and outcome is null and error_code is null) or (stage='finished' and outcome is not null)),
  check (error_code is null or outcome='failed')
);
alter table scene_private.agent_run_events enable row level security;
revoke all on scene_private.agent_run_events from public,anon,authenticated;
grant select,insert,delete on scene_private.agent_run_events to service_role;

create function public.agent_run_events_rpc(p_actor uuid,p_action text,p_data jsonb default '{}') returns jsonb
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
    if jsonb_typeof(p_data->'event') <> 'object' or ((p_data->'event') - array['tool','stage','outcome','errorCode']) <> '{}'::jsonb then raise exception 'INVALID_AGENT_EVENT'; end if;
    select coalesce(max(seq),0)+1 into next_seq from scene_private.agent_run_events where run_id=r.id;
    if next_seq>128 then raise exception 'AGENT_EVENT_LIMIT'; end if;
    insert into scene_private.agent_run_events(run_id,seq,tool,stage,outcome,error_code)
      values(r.id,next_seq,p_data->'event'->>'tool',p_data->'event'->>'stage',p_data->'event'->>'outcome',p_data->'event'->>'errorCode');
    return jsonb_build_object('seq',next_seq);
  elsif p_action='list' then
    cursor_value:=coalesce((p_data->>'after')::integer,0);
    if cursor_value<0 or cursor_value>128 then raise exception 'INVALID_AGENT_EVENT'; end if;
    select jsonb_build_object('events',coalesce(jsonb_agg(jsonb_build_object('seq',seq,'tool',tool,'stage',stage,'outcome',outcome,'errorCode',error_code) order by seq),'[]'::jsonb),
      'nextCursor',coalesce(max(seq),cursor_value),'mayBeIncomplete',true) into result
      from (select seq,tool,stage,outcome,error_code from scene_private.agent_run_events where run_id=r.id and seq>cursor_value order by seq limit 50) e;
    return result;
  end if;
  raise exception 'UNKNOWN_ACTION';
end $$;
revoke all on function public.agent_run_events_rpc(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.agent_run_events_rpc(uuid,text,jsonb) to service_role;
