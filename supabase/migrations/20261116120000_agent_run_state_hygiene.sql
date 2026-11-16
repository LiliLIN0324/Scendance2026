-- Agent run state hygiene.
--
-- Problems this migration fixes (all observable in the shipped RPCs before it):
--   1. GET polled every 2s took `for update` on the run row three times over
--      (agent_rpc -> agent_rpc_before_activity_tasks -> internal body), so a
--      reader serialized with the worker updating the same row.
--   2. `deadline` was fixed at create + 90s and never renewed, while a run may
--      legitimately make six model calls. Expiry was then converged inside GET,
--      turning a read into a write on the hottest row.
--   3. A charged step that never produced a usage report (provider error, run
--      cancelled, deadline) stayed on the daily budget forever, and there was no
--      per-run cost ledger to audit.
--   4. Event appends locked the run row and the project row (through
--      require_lease) for a 128-row telemetry stream that must never block work.
--
-- Design rules kept intact:
--   * fingerprint/idempotency semantics stay in the caller; this file only adds
--     the per-run cost ledger.
--   * `agent_view` output is unchanged (the client schema is strict).
--   * Writes still lock the run row; only read paths stop locking.
--   * A run may renew its deadline while it makes progress, capped at ten
--     minutes of total lifetime so a crashed worker cannot block forever.

alter table scene_private.agent_runs
  add column if not exists committed_cents numeric not null default 0
  check (committed_cents >= 0);

-- Refund the daily budget for steps that were charged but never reported usage.
-- Callers must pass the freshly locked run row and apply the returned amount to
-- agent_runs.committed_cents themselves, so a retried terminal transition cannot
-- refund twice. The daily bucket is keyed by the run's own creation day: that is
-- the bucket `step` charged when the run started.
create or replace function scene_private.refund_unused_agent_calls(p_run uuid)
returns numeric language plpgsql security definer set search_path='' as $$
declare r scene_private.agent_runs; v_paid integer; v_refund numeric;
begin
  select * into r from scene_private.agent_runs where id=p_run;
  if not found then return 0; end if;
  -- Paid model calls report usage with `turn` (tool loop) or `mode` (legacy
  -- single-shot). Tool events and JEV evaluation carry neither and were never
  -- prepaid by `step`.
  select count(*) into v_paid
    from jsonb_array_elements(coalesce(r.usage,'[]'::jsonb)) e
    where jsonb_typeof(e)='object' and (e ? 'turn' or e ? 'mode');
  v_refund := greatest(0, r.call_count - v_paid) * 20;
  if v_refund <= 0 then return 0; end if;
  update scene_private.text_daily_budgets
    set committed_cents=greatest(0,committed_cents-v_refund)
    where usage_day=(r.created_at at time zone 'Asia/Shanghai')::date;
  return v_refund;
end $$;
revoke all on function scene_private.refund_unused_agent_calls(uuid) from public,anon,authenticated;
grant execute on function scene_private.refund_unused_agent_calls(uuid) to service_role;

-- The previous public entry keeps its activity-task body verbatim under a new
-- name; only the dispatcher in front of it changes.
alter function public.agent_rpc(uuid,text,jsonb) rename to agent_rpc_activity_unguarded;
-- The new dispatcher is SECURITY INVOKER and calls this body directly, so the
-- service role keeps EXECUTE. It stays internal-only: anon/authenticated and
-- PUBLIC never get it, and the scene path is reached through the definer wrapper.
revoke all on function public.agent_rpc_activity_unguarded(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.agent_rpc_activity_unguarded(uuid,text,jsonb) to service_role;

-- Route by a plain read. A read must never take the run row lock just to learn
-- whether it belongs to the activity-task protocol.
create function public.agent_rpc(p_actor uuid,p_action text,p_data jsonb default '{}') returns jsonb
language plpgsql security invoker set search_path='' as $$
declare r scene_private.agent_runs;
begin
  if p_action='create' then
    if coalesce((p_data->'input') ? 'kind',false) then
      return public.agent_rpc_activity_unguarded(p_actor,p_action,p_data);
    end if;
    return public.agent_rpc_before_activity_tasks(p_actor,p_action,p_data);
  end if;
  if p_action='by_request' then
    select * into r from scene_private.agent_runs
      where owner_id=p_actor and project_id=(p_data->>'projectId')::uuid
        and request_key=(p_data->>'requestId')::uuid;
  else
    select * into r from scene_private.agent_runs
      where id=(p_data->>'id')::uuid and owner_id=p_actor
        and project_id=(p_data->>'projectId')::uuid;
  end if;
  if not found or r.input->>'kind' is distinct from 'activity_tasks' then
    return public.agent_rpc_before_activity_tasks(p_actor,p_action,p_data);
  end if;
  return public.agent_rpc_activity_unguarded(p_actor,p_action,p_data);
end $$;
revoke all on function public.agent_rpc(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.agent_rpc(uuid,text,jsonb) to service_role;

-- Scene body: read paths stop locking, writes renew the deadline, and terminal
-- transitions settle the step ledger.
create or replace function public.agent_rpc_scene_unguarded_internal(p_actor uuid,p_action text,p_data jsonb default '{}') returns jsonb
language plpgsql security invoker set search_path='' as $$
declare r scene_private.agent_runs; p scene_private.projects; c jsonb; stored jsonb; items jsonb:='[]'; v_day date;
  v_pending jsonb; v_plan jsonb; v_refund numeric; v_hit uuid;
begin
  select * into p from scene_private.projects where id=(p_data->>'projectId')::uuid;
  if p_actor is null or not found or not scene_private.is_member(p_actor,p.studio_id) then raise exception 'PROJECT_NOT_FOUND'; end if;
  if p_action='create' then
    perform pg_advisory_xact_lock(hashtextextended('agent-owner:'||p_actor::text,0));
    perform pg_advisory_xact_lock(hashtextextended('agent:'||p_actor::text||':'||p.id::text||':'||(p_data->'input'->>'requestId'),0));
    select * into r from scene_private.agent_runs where owner_id=p_actor and project_id=p.id and request_key=(p_data->'input'->>'requestId')::uuid for update;
    if found then
      if r.fingerprint is distinct from p_data->>'fingerprint' then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
      return scene_private.agent_view(r)||'{"reused":true}';
    end if;
    perform scene_private.require_lease(p_actor,p_data->'input'||jsonb_build_object('projectId',p.id));
    perform scene_private.check_assets(p_actor,p_data->'input'->'scene');
    if exists(select 1 from scene_private.agent_runs where owner_id=p_actor and state in ('queued','running') and deadline>clock_timestamp()) then raise exception 'AI_BUSY'; end if;
    insert into scene_private.agent_runs(owner_id,project_id,request_key,fingerprint,input,base_hash,execution_mode)
      values(p_actor,p.id,(p_data->'input'->>'requestId')::uuid,p_data->>'fingerprint',p_data->'input',p_data->>'baseHash',p_data->>'executionMode') returning * into r;
    return scene_private.agent_view(r)||'{"reused":false}';
  end if;
  -- Read without a row lock first. Writes re-select with `for update` below.
  if p_action='by_request' then
    select * into r from scene_private.agent_runs where owner_id=p_actor and project_id=p.id and request_key=(p_data->>'requestId')::uuid;
  else
    select * into r from scene_private.agent_runs where id=(p_data->>'id')::uuid and owner_id=p_actor and project_id=p.id;
  end if;
  if not found then raise exception 'AGENT_RUN_NOT_FOUND'; end if;
  if r.state in ('queued','running') and r.deadline<=clock_timestamp() then
    -- Conditional convergence: exactly one caller wins, everyone else reads the
    -- converged row. Refund only after a row was actually updated.
    update scene_private.agent_runs set
      state=case when jsonb_array_length(candidates)>0 or jsonb_array_length(coalesce(plan_candidates,'[]'::jsonb))>0 then 'complete' else 'failed' end,
      error_code='AGENT_DEADLINE',
      progress='执行已中断，保留有效结果',
      evaluation=case when (input->>'jevEnabled')::boolean then jsonb_build_object('status','partial','message','运行已中断，保留通过检查的方案，未完成评价。') else null end
      where id=r.id and state in ('queued','running') and deadline<=clock_timestamp()
      returning id into v_hit;
    if v_hit is not null then
      v_refund:=scene_private.refund_unused_agent_calls(r.id);
      if v_refund>0 then
        update scene_private.agent_runs set committed_cents=greatest(0,committed_cents-v_refund) where id=r.id;
      end if;
    end if;
    if p_action='by_request' then
      select * into r from scene_private.agent_runs where owner_id=p_actor and project_id=p.id and request_key=(p_data->>'requestId')::uuid;
    else
      select * into r from scene_private.agent_runs where id=(p_data->>'id')::uuid and owner_id=p_actor and project_id=p.id;
    end if;
    if not found then raise exception 'AGENT_RUN_NOT_FOUND'; end if;
  end if;
  if p_action in ('get','by_request') then return scene_private.agent_view(r); end if;
  -- Every remaining action mutates (or must observe a stable row): lock now.
  select * into r from scene_private.agent_runs where id=r.id for update;
  if not found then raise exception 'AGENT_RUN_NOT_FOUND'; end if;
  if p_action='note' then
    if r.state not in ('queued','running') or r.deadline<=clock_timestamp() then raise exception 'AGENT_RUN_STOPPED'; end if;
    update scene_private.agent_runs
      set steer_notes=case when jsonb_array_length(steer_notes)>=8 then steer_notes - 0 else steer_notes end
        || jsonb_build_array(jsonb_build_object('text',left(coalesce(p_data->>'note',''),500),'at',clock_timestamp())),
      steer_total=steer_total+1
      where id=r.id returning * into r;
    return scene_private.agent_view(r)||'{"accepted":true}';
  end if;
  if p_action='cancel' then
    if r.state in ('queued','running') then
      v_refund:=scene_private.refund_unused_agent_calls(r.id);
    else
      v_refund:=0;
    end if;
    update scene_private.agent_runs set state='cancelled',progress='已取消',execution_mode='preview',
      committed_cents=greatest(0,committed_cents-coalesce(v_refund,0))
      where id=r.id returning * into r;
    return scene_private.agent_view(r);
  end if;
  if p_action='start' then
    if r.state<>'queued' then return '{"claimed":false}'; end if;
    update scene_private.agent_runs set state='running',claim=gen_random_uuid(),progress='正在读取当前场景',phase=coalesce(phase,'survey'),
      deadline=least(clock_timestamp()+interval '90 seconds',created_at+interval '10 minutes')
      where id=r.id returning * into r;
    return jsonb_build_object('claimed',true,'claim',r.claim,'input',r.input,'deadline',r.deadline,'studioId',p.studio_id,'phase',r.phase);
  end if;
  if r.state<>'running' or r.claim is distinct from (p_data->>'claim')::uuid then raise exception 'AGENT_RUN_STOPPED'; end if;
  if p_action='take_notes' then
    v_pending:=r.steer_notes;
    if v_pending='[]'::jsonb then return '{"notes":[]}'; end if;
    update scene_private.agent_runs set steer_notes='[]',
      deadline=least(clock_timestamp()+interval '90 seconds',created_at+interval '10 minutes') where id=r.id;
    return jsonb_build_object('notes',coalesce((select jsonb_agg(e->>'text') from jsonb_array_elements(v_pending) e),'[]'::jsonb));
  end if;
  if p_action='fail' then
    -- A retried fail must not refund the same charge twice: only a transition
    -- out of queued/running owns the unused-step refund.
    if r.state in ('queued','running') then
      v_refund:=scene_private.refund_unused_agent_calls(r.id);
    else
      v_refund:=0;
    end if;
    update scene_private.agent_runs set state=case when (jsonb_array_length(candidates)>0 or jsonb_array_length(coalesce(plan_candidates,'[]'::jsonb))>0) and p_data->>'errorCode' not in ('LEASE_LOST','LEASE_BUSY','REVISION_CONFLICT','FORBIDDEN','PROJECT_NOT_FOUND') then 'complete' else 'failed' end,
      error_code=p_data->>'errorCode',progress='执行中断，原场景与有效方案已保留',
      evaluation=case when (input->>'jevEnabled')::boolean then jsonb_build_object('status','partial','message','后续处理未完成，有效方案已保留，未生成推荐概率。') else null end,
      committed_cents=greatest(0,committed_cents-coalesce(v_refund,0))
      where id=r.id returning * into r;
    return scene_private.agent_view(r);
  end if;
  perform scene_private.require_lease(p_actor,r.input||jsonb_build_object('projectId',p.id));
  if p_action='check' then
    update scene_private.agent_runs set deadline=least(clock_timestamp()+interval '90 seconds',created_at+interval '10 minutes') where id=r.id;
    return jsonb_build_object('active',true);
  end if;
  if p_action='step' then
    if r.call_count>=6 then raise exception 'AGENT_CALL_LIMIT'; end if;
    v_day:=(clock_timestamp() at time zone 'Asia/Shanghai')::date;
    insert into scene_private.text_daily_budgets(usage_day,committed_cents) values(v_day,20)
      on conflict(usage_day) do update set committed_cents=scene_private.text_daily_budgets.committed_cents+20;
    update scene_private.agent_runs set call_count=call_count+1,progress=p_data->>'progress',phase=coalesce(p_data->>'phase',phase),
      committed_cents=committed_cents+20,
      deadline=least(clock_timestamp()+interval '90 seconds',created_at+interval '10 minutes')
      where id=r.id returning * into r;
    return jsonb_build_object('callCount',r.call_count,'phase',r.phase);
  elsif p_action='usage' then
    update scene_private.agent_runs set usage=usage||jsonb_build_array(p_data->'usage'),
      deadline=least(clock_timestamp()+interval '90 seconds',created_at+interval '10 minutes') where id=r.id;
    return '{}';
  elsif p_action='progress' then
    update scene_private.agent_runs set progress=left(p_data->>'progress',200),phase=coalesce(p_data->>'phase',phase),
      deadline=least(clock_timestamp()+interval '90 seconds',created_at+interval '10 minutes') where id=r.id;
    return '{}';
  elsif p_action in ('finish','checkpoint') then
    if jsonb_array_length(p_data->'candidates')>3 then raise exception 'INVALID_CANDIDATES'; end if;
    v_plan:=coalesce(p_data->'planCandidates','[]'::jsonb);
    if jsonb_typeof(v_plan) is distinct from 'array' then raise exception 'INVALID_PLAN_CANDIDATES'; end if;
    if jsonb_array_length(v_plan)>3 then raise exception 'INVALID_CANDIDATES'; end if;
    if p_data ? 'candidates' then
    for c in select value from jsonb_array_elements(p_data->'candidates') loop
      stored:=public.scene_rpc(p_actor,'proposals.store',r.input||jsonb_build_object('projectId',p.id,'id',gen_random_uuid(),
        'baseHash',r.base_hash,'candidate',c->'scene','explanation',c->>'explanation','warnings',c->'warnings'));
      stored:=stored||jsonb_build_object('modelSuggestions',coalesce(c->'modelSuggestions','[]'),'materialSuggestions',coalesce(c->'materialSuggestions','[]'));
      insert into scene_private.agent_proposals values((stored->>'id')::uuid,r.id);
      items:=items||jsonb_build_array(jsonb_build_object('label',c->>'label','title',c->>'title','proposal',stored));
    end loop;
    end if;
    update scene_private.agent_runs set state=case when p_action='checkpoint' then 'running' else 'complete' end,
      progress=case when p_action='checkpoint' then '已保存通过检查的候选方案' else '方案已准备好' end,
      candidates=case when p_data ? 'candidates' then items else candidates end,
      plan_candidates=case when p_data ? 'planCandidates' then v_plan else plan_candidates end,
      evaluation=p_data->'evaluation',message=p_data->>'message',
      deadline=least(clock_timestamp()+interval '90 seconds',created_at+interval '10 minutes')
      where id=r.id returning * into r;
    return scene_private.agent_view(r);
  end if;
  raise exception 'UNKNOWN_ACTION';
end $$;

-- Guard wrapper: kind probe and read paths stop locking; note/checkpoint/finish
-- still lock because they validate and mutate steering state.
create or replace function public.agent_rpc_before_activity_tasks(p_actor uuid,p_action text,p_data jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare r scene_private.agent_runs; p scene_private.projects; result jsonb; expected integer;
begin
  if p_action='create' and coalesce((p_data->'input') ? 'kind',false) then
    return public.agent_rpc(p_actor,p_action,p_data);
  end if;
  if p_action in ('create','by_request') then
    return public.agent_rpc_scene_unguarded_internal(p_actor,p_action,p_data);
  end if;
  select * into p from scene_private.projects where id=(p_data->>'projectId')::uuid;
  if p_actor is null or not found or not scene_private.is_member(p_actor,p.studio_id) then raise exception 'PROJECT_NOT_FOUND'; end if;
  select * into r from scene_private.agent_runs where id=(p_data->>'id')::uuid and owner_id=p_actor and project_id=p.id;
  if not found then return public.agent_rpc_scene_unguarded_internal(p_actor,p_action,p_data); end if;
  if r.input->>'kind'='activity_tasks' then return public.agent_rpc(p_actor,p_action,p_data); end if;
  if p_action='note' then
    select * into r from scene_private.agent_runs where id=r.id for update;
    if r.state not in ('queued','running') or r.deadline<=clock_timestamp() then raise exception 'AGENT_RUN_STOPPED'; end if;
    if jsonb_array_length(r.steer_notes)>=8 then raise exception 'AGENT_STEERING_QUEUE_FULL'; end if;
    update scene_private.agent_runs set
      steer_notes=steer_notes||jsonb_build_array(jsonb_build_object('text',left(coalesce(p_data->>'note',''),500),'at',clock_timestamp())),
      steer_total=steer_total+1,candidates='[]'::jsonb,plan_candidates='[]'::jsonb,evaluation=null
      where id=r.id returning * into r;
    return scene_private.agent_view(r)||'{"accepted":true}'::jsonb;
  elsif p_action='take_notes' then
    result:=public.agent_rpc_scene_unguarded_internal(p_actor,p_action,p_data);
    return result||jsonb_build_object('steerTotal',r.steer_total);
  elsif p_action in ('checkpoint','finish') then
    select * into r from scene_private.agent_runs where id=r.id for update;
    begin expected:=(p_data->>'steerTotal')::integer;
    exception when others then raise exception 'AGENT_STEERING_CHANGED'; end;
    if expected is null and r.steer_total=0 then expected:=0; end if;
    if expected is null or expected<0 or expected<>r.steer_total or jsonb_array_length(r.steer_notes)<>0 then
      raise exception 'AGENT_STEERING_CHANGED';
    end if;
  elsif p_action='fail' then
    update scene_private.agent_runs set message=coalesce(p_data->>'message',message) where id=r.id;
  end if;
  return public.agent_rpc_scene_unguarded_internal(p_actor,p_action,p_data);
end $$;
revoke all on function public.agent_rpc_before_activity_tasks(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.agent_rpc_before_activity_tasks(uuid,text,jsonb) to service_role;

-- Read-only lease check for telemetry: same conditions, no project row lock.
create or replace function scene_private.check_lease_current(actor uuid, input jsonb)
returns scene_private.projects language plpgsql set search_path='' as $$
declare p scene_private.projects;
begin
  select * into p from scene_private.projects where id=(input->>'projectId')::uuid;
  if not found or p.deleted_at is not null or not scene_private.is_member(actor,p.studio_id) then raise exception 'PROJECT_NOT_FOUND'; end if;
  if p.lease_user is distinct from actor or p.lease_session is distinct from (input->>'sessionId')::uuid or
    p.lease_generation is distinct from (input->>'generation')::bigint or p.lease_expires is null or p.lease_expires<=clock_timestamp() then raise exception 'LEASE_LOST'; end if;
  if p.revision is distinct from (input->>'expectedRevision')::bigint then raise exception 'REVISION_CONFLICT'; end if;
  return p;
end $$;
revoke all on function scene_private.check_lease_current(uuid,jsonb) from public,anon,authenticated;
grant execute on function scene_private.check_lease_current(uuid,jsonb) to service_role;

-- Event appends are append-only telemetry. Serialize only against other appends
-- of the same run (advisory lock for seq allocation); never hold the run or
-- project row that the actual work needs.
create or replace function public.agent_run_events_rpc(p_actor uuid,p_action text,p_data jsonb default '{}') returns jsonb
language plpgsql security invoker set search_path='' as $$
declare r scene_private.agent_runs; p scene_private.projects; cursor_value integer; next_seq integer; result jsonb;
begin
  if p_actor is null then raise exception 'UNAUTHENTICATED'; end if;
  select * into p from scene_private.projects where id=(p_data->>'projectId')::uuid and deleted_at is null;
  if not found or not scene_private.is_member(p_actor,p.studio_id) then raise exception 'PROJECT_NOT_FOUND'; end if;
  select * into r from scene_private.agent_runs where id=(p_data->>'id')::uuid and project_id=p.id and owner_id=p_actor;
  if not found then raise exception 'AGENT_RUN_NOT_FOUND'; end if;
  if p_action='append' then
    perform set_config('lock_timeout','75ms',true);
    if r.state<>'running' or r.deadline<=clock_timestamp() or r.claim is distinct from (p_data->>'claim')::uuid then raise exception 'AGENT_RUN_STOPPED'; end if;
    perform scene_private.check_lease_current(p_actor,r.input||jsonb_build_object('projectId',p.id));
    if jsonb_typeof(p_data->'event') <> 'object' or ((p_data->'event') - array['tool','stage','outcome','errorCode','argsSummary','durationMs']) <> '{}'::jsonb then raise exception 'INVALID_AGENT_EVENT'; end if;
    if p_data->'event'->>'argsSummary' is not null and char_length(p_data->'event'->>'argsSummary') > 240 then raise exception 'INVALID_AGENT_EVENT'; end if;
    perform pg_advisory_xact_lock(hashtextextended('agent-events:'||r.id::text,0));
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
