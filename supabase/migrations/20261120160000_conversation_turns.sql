-- 全链路对话留痕：每一轮用户输入与系统响应落同一张表，不区分是否调用模型。
-- 只新增对象；写入由 service_role 经 conversation_rpc 完成。
create table if not exists scene_private.conversation_turns (
  id uuid primary key default gen_random_uuid(),
  -- 客户端生成的幂等键：同一轮重试只留一条。
  turn_key uuid not null,
  owner_id uuid not null,
  studio_id uuid,
  project_id uuid,
  session_id text not null,
  turn_index integer not null default 0 check (turn_index >= 0),
  surface text not null check (surface in ('brief','assistant','agent','activity','local_command')),
  user_text text not null,
  assistant_text text,
  provider text,
  model text,
  tool_summary jsonb not null default '[]'::jsonb,
  outcome text not null check (outcome in ('answered','preview','applied','failed','local_only','queued')),
  error_code text,
  latency_ms integer check (latency_ms is null or latency_ms >= 0),
  -- 不设外键：清理任务按各自保留期独立执行。
  agent_run_id uuid,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (owner_id, turn_key)
);
create index if not exists conversation_turns_owner_idx on scene_private.conversation_turns(owner_id, created_at desc);
create index if not exists conversation_turns_session_idx on scene_private.conversation_turns(project_id, session_id, turn_index);
create index if not exists conversation_turns_run_idx on scene_private.conversation_turns(agent_run_id);
alter table scene_private.conversation_turns enable row level security;
revoke all on scene_private.conversation_turns from public, anon, authenticated;
grant select, insert, update, delete on scene_private.conversation_turns to service_role;

create or replace function public.conversation_rpc(p_actor uuid, p_action text, p_data jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  p scene_private.projects;
  v_project uuid;
  v_studio uuid;
  v_id uuid;
  v_rows jsonb;
begin
  if p_actor is null then raise exception 'UNAUTHENTICATED'; end if;

  if p_action = 'turn.put' then
    v_project := nullif(p_data->>'projectId','')::uuid;
    if v_project is not null then
      select * into p from scene_private.projects where id = v_project and deleted_at is null;
      if not found or not scene_private.is_member(p_actor, p.studio_id) then
        raise exception 'PROJECT_NOT_FOUND';
      end if;
      v_studio := p.studio_id;
    end if;
    insert into scene_private.conversation_turns(
      turn_key, owner_id, studio_id, project_id, session_id, turn_index, surface,
      user_text, assistant_text, provider, model, tool_summary, outcome, error_code, latency_ms, agent_run_id)
    values (
      (p_data->>'turnKey')::uuid, p_actor, v_studio, v_project,
      left(coalesce(p_data->>'sessionId','unknown'), 120),
      coalesce((p_data->>'turnIndex')::int, 0),
      p_data->>'surface',
      left(p_data->>'userText', 8000),
      left(nullif(p_data->>'assistantText',''), 40000),
      nullif(p_data->>'provider',''), nullif(p_data->>'model',''),
      coalesce(p_data->'toolSummary', '[]'::jsonb),
      p_data->>'outcome',
      nullif(p_data->>'errorCode',''),
      nullif(p_data->>'latencyMs','')::int,
      nullif(p_data->>'agentRunId','')::uuid)
    on conflict (owner_id, turn_key) do update set
      -- 同一轮先记 queued、收尾时补回复：只补不覆盖已有内容。
      assistant_text = coalesce(excluded.assistant_text, scene_private.conversation_turns.assistant_text),
      provider = coalesce(excluded.provider, scene_private.conversation_turns.provider),
      model = coalesce(excluded.model, scene_private.conversation_turns.model),
      tool_summary = case when jsonb_array_length(excluded.tool_summary) > 0
        then excluded.tool_summary else scene_private.conversation_turns.tool_summary end,
      outcome = excluded.outcome,
      error_code = coalesce(excluded.error_code, scene_private.conversation_turns.error_code),
      latency_ms = coalesce(excluded.latency_ms, scene_private.conversation_turns.latency_ms),
      agent_run_id = coalesce(excluded.agent_run_id, scene_private.conversation_turns.agent_run_id),
      updated_at = clock_timestamp()
    returning id into v_id;
    return jsonb_build_object('id', v_id);
  end if;

  if p_action = 'turn.list' then
    v_project := nullif(p_data->>'projectId','')::uuid;
    if v_project is null then raise exception 'INVALID_ARGUMENT'; end if;
    select * into p from scene_private.projects where id = v_project and deleted_at is null;
    if not found or not scene_private.is_member(p_actor, p.studio_id) then
      raise exception 'PROJECT_NOT_FOUND';
    end if;
    select coalesce(jsonb_agg(row order by turn_index, created_at), '[]'::jsonb) into v_rows
    from (
      select jsonb_build_object(
        'id', id, 'turnIndex', turn_index, 'surface', surface, 'userText', user_text,
        'assistantText', assistant_text, 'outcome', outcome, 'errorCode', error_code,
        'createdAt', created_at) as row
      from scene_private.conversation_turns
      where project_id = v_project
        and (nullif(p_data->>'sessionId','') is null or session_id = p_data->>'sessionId')
      order by turn_index, created_at
      limit least(coalesce((p_data->>'limit')::int, 100), 200)
    ) t;
    return v_rows;
  end if;

  raise exception 'UNKNOWN_ACTION';
end $$;
revoke all on function public.conversation_rpc(uuid,text,jsonb) from public, anon, authenticated;
grant execute on function public.conversation_rpc(uuid,text,jsonb) to service_role;

-- 清理：对话留痕与 agent 运行统一为 180 天；排队中的轮次视为在途证据，不清理。
create or replace function scene_private.purge_agent_data(p_keep_days integer default 180, p_proposal_grace_hours integer default 24)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_runs integer:=0; v_props integer:=0; v_turns integer:=0;
begin
  if p_keep_days is null or p_keep_days<1 or p_proposal_grace_hours is null or p_proposal_grace_hours<1 then
    raise exception 'INVALID_RETENTION';
  end if;
  delete from scene_private.proposals p
    where p.applied_at is null
      and p.expires_at < clock_timestamp() - make_interval(hours=>p_proposal_grace_hours);
  get diagnostics v_props = row_count;
  delete from scene_private.conversation_turns t
    where t.outcome <> 'queued'
      and t.created_at < clock_timestamp() - make_interval(days=>p_keep_days);
  get diagnostics v_turns = row_count;
  delete from scene_private.agent_runs r
    where r.state in ('complete','failed','cancelled')
      and r.created_at < clock_timestamp() - make_interval(days=>p_keep_days);
  get diagnostics v_runs = row_count;
  delete from scene_private.agent_run_events e
    where not exists(select 1 from scene_private.agent_runs r where r.id=e.run_id);
  return jsonb_build_object('runsDeleted',v_runs,'proposalsDeleted',v_props,'turnsDeleted',v_turns);
end $$;
revoke all on function scene_private.purge_agent_data(integer,integer) from public, anon, authenticated;
grant execute on function scene_private.purge_agent_data(integer,integer) to service_role;
