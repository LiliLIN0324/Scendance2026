-- Append-only agent audit log. Every state transition keeps its own row next to
-- the run, so the story survives later progress overwrites. Reads do not log.
create table scene_private.agent_events (
  id bigint generated always as identity primary key,
  run_id uuid not null references scene_private.agent_runs on delete cascade,
  owner_id uuid not null,
  project_id uuid not null,
  seq integer not null check(seq > 0),
  action text not null check(action in ('create','start','step','usage','progress','checkpoint','finish','fail','cancel','apply')),
  state text not null check(state in ('queued','running','complete','failed','cancelled')),
  detail jsonb not null default '{}'::jsonb check(jsonb_typeof(detail)='object'),
  created_at timestamptz not null default clock_timestamp(),
  unique(run_id,seq)
);
create index agent_events_project_time_idx on scene_private.agent_events(project_id,created_at desc);
alter table scene_private.agent_events enable row level security;
revoke all on scene_private.agent_events from public,anon,authenticated;
grant select,insert on scene_private.agent_events to service_role;
revoke all on sequence scene_private.agent_events_id_seq from public,anon,authenticated;
grant usage,select on sequence scene_private.agent_events_id_seq to service_role;

create function scene_private.agent_events_append_only() returns trigger
language plpgsql set search_path='' as $$
begin
  raise exception 'AGENT_EVENTS_APPEND_ONLY';
end $$;
revoke all on function scene_private.agent_events_append_only() from public,anon,authenticated;
grant execute on function scene_private.agent_events_append_only() to service_role;
create trigger agent_events_append_only before update or delete on scene_private.agent_events
  for each row execute function scene_private.agent_events_append_only();

-- Audit the run state transitions produced by agent_rpc. The inner function
-- already locks the run row for every mutating action, so seq allocation in the
-- same transaction cannot race another writer of the same run.
alter function public.agent_rpc(uuid,text,jsonb) rename to agent_rpc_before_event_log;
create function public.agent_rpc(p_actor uuid,p_action text,p_data jsonb default '{}') returns jsonb
language plpgsql security invoker set search_path='' as $$
declare
  result jsonb; r scene_private.agent_runs; v_id uuid;
begin
  if p_action='events' then
    if not exists(
      select 1 from scene_private.agent_runs a join scene_private.projects p on p.id=a.project_id
      where a.id=(p_data->>'id')::uuid and a.owner_id=p_actor
        and a.project_id=(p_data->>'projectId')::uuid and p.deleted_at is null
        and scene_private.is_member(p_actor,p.studio_id)
    ) then raise exception 'AGENT_RUN_NOT_FOUND'; end if;
    select coalesce(jsonb_agg(jsonb_build_object('seq',e.seq,'action',e.action,'state',e.state,
      'detail',e.detail,'at',e.created_at) order by e.seq),'[]'::jsonb)
      into result from scene_private.agent_events e where e.run_id=(p_data->>'id')::uuid;
    return result;
  end if;

  result:=public.agent_rpc_before_event_log(p_actor,p_action,p_data);
  if p_action not in ('create','start','step','usage','progress','checkpoint','finish','fail','cancel') then
    return result;
  end if;
  -- An idempotent replay or an already-claimed start changes no state.
  if p_action='create' and coalesce((result->>'reused')::boolean,false) then return result; end if;
  if p_action='start' and not coalesce((result->>'claimed')::boolean,false) then return result; end if;

  v_id:=coalesce((result->>'id')::uuid,(p_data->>'id')::uuid);
  if v_id is null then return result; end if;
  select * into r from scene_private.agent_runs where id=v_id;
  if not found then return result; end if;

  insert into scene_private.agent_events(run_id,owner_id,project_id,seq,action,state,detail)
  values(r.id,r.owner_id,r.project_id,
    (select coalesce(max(e.seq),0)+1 from scene_private.agent_events e where e.run_id=r.id),
    p_action,r.state,
    case p_action
      when 'create' then jsonb_build_object('baseHash',r.base_hash,'executionMode',r.execution_mode)
      when 'start' then jsonb_build_object('claim',r.claim,'deadline',r.deadline)
      when 'step' then jsonb_build_object('callCount',r.call_count,'progress',r.progress)
      when 'progress' then jsonb_build_object('progress',r.progress)
      -- Tool/provider telemetry stays compact: full usage already lives on the run.
      when 'usage' then jsonb_strip_nulls(jsonb_build_object(
        'provider',p_data->'usage'->>'provider','mode',p_data->'usage'->>'mode',
        'tool',p_data->'usage'->>'tool','turn',p_data->'usage'->'turn',
        'errorCode',p_data->'usage'->>'errorCode'))
      when 'checkpoint' then jsonb_build_object('candidateCount',jsonb_array_length(r.candidates))
      -- p_data->'evaluation' may be a JSON null; compare by type, not SQL NULL.
      when 'finish' then jsonb_build_object('candidateCount',jsonb_array_length(r.candidates),
        'hasEvaluation',jsonb_typeof(r.evaluation) is distinct from 'null','errorCode',r.error_code)
      when 'fail' then jsonb_build_object('errorCode',r.error_code,'state',r.state)
      when 'cancel' then jsonb_build_object('state',r.state)
      else '{}'::jsonb
    end);
  return result;
end $$;
revoke all on function public.agent_rpc(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.agent_rpc(uuid,text,jsonb) to service_role;

-- Applying an agent candidate is the last transition in the same story.
alter function public.scene_rpc(uuid,text,jsonb) rename to scene_rpc_before_event_log;
create function public.scene_rpc(p_actor uuid,p_action text,p_data jsonb default '{}') returns jsonb
language plpgsql security invoker set search_path='' as $$
declare result jsonb; r scene_private.agent_runs;
begin
  result:=public.scene_rpc_before_event_log(p_actor,p_action,p_data);
  if p_action='proposals.apply' then
    select a.* into r from scene_private.agent_runs a
      join scene_private.agent_proposals link on link.run_id=a.id
      where link.proposal_id=(p_data->>'proposalId')::uuid;
    if found then
      insert into scene_private.agent_events(run_id,owner_id,project_id,seq,action,state,detail)
      values(r.id,r.owner_id,r.project_id,
        (select coalesce(max(e.seq),0)+1 from scene_private.agent_events e where e.run_id=r.id),
        'apply',r.state,
        jsonb_strip_nulls(jsonb_build_object('proposalId',p_data->>'proposalId',
          'undoGroup',result->>'undoGroup',
          'revision',case when result->>'revision' ~ '^[0-9]+$' then (result->>'revision')::integer else null end)));
    end if;
  end if;
  return result;
end $$;
revoke all on function public.scene_rpc(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.scene_rpc(uuid,text,jsonb) to service_role;
