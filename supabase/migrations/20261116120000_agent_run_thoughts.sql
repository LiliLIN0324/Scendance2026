-- Bounded per-round visible self-report ("thought") for an agent run.
--
-- Why it lives next to tool observations: the run already has one ordered,
-- cursor-paged observation stream. Adding a second table would have meant a
-- second cursor, a second poller and a second ordering guarantee. A thought is
-- therefore another frame kind in the same stream, never a tool observation:
--
--   kind='tool'    -> tool/stage/outcome/error_code/args_summary/duration_ms
--   kind='thought' -> round/thought (no tool columns at all)
--
-- The text is a bounded, normalized summary of what the model itself made
-- visible for that round. Raw provider reasoning (reasoning_content /
-- reasoning_details) is never stored here: it stays in worker memory for the
-- next provider request only. A thought is contextual help, not evidence and
-- not a safety or requirement-conformance result.
--
-- Old rows keep kind='tool' through the column default; old clients ignore the
-- extra fields and keep working.

alter table scene_private.agent_run_events
  add column if not exists kind text not null default 'tool';
alter table scene_private.agent_run_events
  add column if not exists round integer;
alter table scene_private.agent_run_events
  add column if not exists thought text;

-- Thoughts carry no tool, so the tool/stage columns must allow NULL for them.
-- The original checks are `tool in (...)` / stage-driven: a NULL operand makes
-- those checks UNKNOWN, which PostgreSQL accepts. The frame check below is what
-- actually binds a kind to its columns.
alter table scene_private.agent_run_events alter column tool drop not null;
alter table scene_private.agent_run_events alter column stage drop not null;

alter table scene_private.agent_run_events
  add constraint agent_run_events_kind_check check (kind in ('tool','thought'));
alter table scene_private.agent_run_events
  add constraint agent_run_events_round_check check (round is null or round between 1 and 6);
alter table scene_private.agent_run_events
  add constraint agent_run_events_thought_check check (thought is null or char_length(thought) between 1 and 400);
alter table scene_private.agent_run_events
  add constraint agent_run_events_frame_check check (
    (kind='tool' and tool is not null and stage is not null and thought is null and round is null)
    or (kind='thought' and thought is not null and round is not null
        and tool is null and stage is null and outcome is null and error_code is null
        and args_summary is null and duration_ms is null)
  );

create or replace function public.agent_run_events_rpc(p_actor uuid,p_action text,p_data jsonb default '{}') returns jsonb
language plpgsql security invoker set search_path='' as $$
declare r scene_private.agent_runs; p scene_private.projects; cursor_value integer; next_seq integer; round_value integer; result jsonb;
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
    if jsonb_typeof(p_data->'event') <> 'object'
       or ((p_data->'event') - array['tool','stage','outcome','errorCode','argsSummary','durationMs','thought','round']) <> '{}'::jsonb
    then raise exception 'INVALID_AGENT_EVENT'; end if;
    select coalesce(max(seq),0)+1 into next_seq from scene_private.agent_run_events where run_id=r.id;
    if next_seq>128 then raise exception 'AGENT_EVENT_LIMIT'; end if;
    if p_data->'event' ? 'thought' then
      -- A thought frame carries exactly round + thought; anything else is refused.
      if ((p_data->'event') - array['thought','round']) <> '{}'::jsonb
         or jsonb_typeof(p_data->'event'->'thought') <> 'string'
         or char_length(p_data->'event'->>'thought') not between 1 and 400
      then raise exception 'INVALID_AGENT_EVENT'; end if;
      begin round_value:=(p_data->'event'->>'round')::integer;
      exception when others then raise exception 'INVALID_AGENT_EVENT'; end;
      if round_value is null or round_value<1 or round_value>6 then raise exception 'INVALID_AGENT_EVENT'; end if;
      insert into scene_private.agent_run_events(run_id,seq,kind,round,thought,tool,stage,outcome,error_code)
        values(r.id,next_seq,'thought',round_value,p_data->'event'->>'thought',null,null,null,null);
      return jsonb_build_object('seq',next_seq);
    end if;
    if p_data->'event'->>'argsSummary' is not null and char_length(p_data->'event'->>'argsSummary') > 240 then raise exception 'INVALID_AGENT_EVENT'; end if;
    insert into scene_private.agent_run_events(run_id,seq,kind,tool,stage,outcome,error_code,args_summary,duration_ms)
      values(r.id,next_seq,'tool',p_data->'event'->>'tool',p_data->'event'->>'stage',p_data->'event'->>'outcome',p_data->'event'->>'errorCode',
        p_data->'event'->>'argsSummary',
        case when p_data->'event'->'durationMs' is null then null else (p_data->'event'->>'durationMs')::integer end);
    return jsonb_build_object('seq',next_seq);
  elsif p_action='list' then
    cursor_value:=coalesce((p_data->>'after')::integer,0);
    if cursor_value<0 or cursor_value>128 then raise exception 'INVALID_AGENT_EVENT'; end if;
    select jsonb_build_object('events',coalesce(jsonb_agg(jsonb_build_object(
        'seq',seq,'kind',kind,'tool',tool,'stage',stage,'outcome',outcome,'errorCode',error_code,
        'argsSummary',args_summary,'durationMs',duration_ms,'round',round,'thought',thought) order by seq),'[]'::jsonb),
      'nextCursor',coalesce(max(seq),cursor_value),'mayBeIncomplete',true) into result
      from (select seq,kind,tool,stage,outcome,error_code,args_summary,duration_ms,round,thought
        from scene_private.agent_run_events where run_id=r.id and seq>cursor_value order by seq limit 50) e;
    return result;
  end if;
  raise exception 'UNKNOWN_ACTION';
end $$;
revoke all on function public.agent_run_events_rpc(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.agent_run_events_rpc(uuid,text,jsonb) to service_role;
