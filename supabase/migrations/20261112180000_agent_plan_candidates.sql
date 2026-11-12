-- #46-1b 户外平面候选持久化（备选 A）：与 scene proposal 并列的 planCandidate 独立成列，
-- 不改 proposals.store、不改室内 scene 提案路径。finish/checkpoint 把运行内存里组装好的
-- planCandidates 落到 agent_runs.plan_candidates，agent_view 透出给前端确认卡。
--
-- 边界：planCandidate 仍是待用户确认的预览草稿，落库不等于已应用到户外平面；
-- 真正装配到本地 plan 由前端确认回路完成（#46-1b 第 3 项）。

alter table scene_private.agent_runs
  add column if not exists plan_candidates jsonb not null default '[]'::jsonb;

create or replace function scene_private.agent_view(r scene_private.agent_runs) returns jsonb
language sql stable set search_path='' as $$
 select jsonb_build_object('id',r.id,'projectId',r.project_id,'requestId',r.request_key,'state',r.state,'progress',r.progress,
 'callCount',r.call_count,'phase',r.phase,'candidates',case when r.state='cancelled' then '[]'::jsonb else r.candidates end,
 'planCandidates',case when r.state='cancelled' then '[]'::jsonb else coalesce(r.plan_candidates,'[]'::jsonb) end,
 'evaluation',r.evaluation,
 'executionMode',r.execution_mode,'jevEnabled',(r.input->>'jevEnabled')::boolean,'expiresAt',r.deadline,
 'steerTotal',r.steer_total)
 || case when r.error_code is null then '{}'::jsonb else jsonb_build_object('errorCode',r.error_code) end
 || case when r.message is null then '{}'::jsonb else jsonb_build_object('message',r.message) end
$$;

-- 接续 20261105150000 的场景内部体（1108130000 已把旧体改名为 scene_unguarded_internal）。
-- 仅在 finish/checkpoint 分支读 p_data->'planCandidates'，其余室内 scene 提案流程原样保留。
create or replace function public.agent_rpc_scene_unguarded_internal(p_actor uuid,p_action text,p_data jsonb default '{}') returns jsonb
language plpgsql security invoker set search_path='' as $$
declare r scene_private.agent_runs; p scene_private.projects; c jsonb; stored jsonb; items jsonb:='[]'; v_day date;
  v_pending jsonb; v_plan jsonb;
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
  if p_action='by_request' then
    select * into r from scene_private.agent_runs where owner_id=p_actor and project_id=p.id and request_key=(p_data->>'requestId')::uuid for update;
  else
    select * into r from scene_private.agent_runs where id=(p_data->>'id')::uuid and owner_id=p_actor and project_id=p.id for update;
  end if;
  if not found then raise exception 'AGENT_RUN_NOT_FOUND'; end if;
  if r.state in ('queued','running') and r.deadline<=clock_timestamp() then
    update scene_private.agent_runs set state=case when jsonb_array_length(candidates)>0 or jsonb_array_length(coalesce(plan_candidates,'[]'::jsonb))>0 then 'complete' else 'failed' end,error_code='AGENT_DEADLINE',progress='执行已中断，保留有效结果',evaluation=case when (input->>'jevEnabled')::boolean then jsonb_build_object('status','partial','message','运行已中断，保留通过检查的方案，未完成评价。') else null end where id=r.id returning * into r;
  end if;
  if p_action in ('get','by_request') then return scene_private.agent_view(r); end if;
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
    update scene_private.agent_runs set state='cancelled',progress='已取消',execution_mode='preview' where id=r.id returning * into r;
    return scene_private.agent_view(r);
  end if;
  if p_action='start' then
    if r.state<>'queued' then return '{"claimed":false}'; end if;
    update scene_private.agent_runs set state='running',claim=gen_random_uuid(),progress='正在读取当前场景',phase=coalesce(phase,'survey') where id=r.id returning * into r;
    return jsonb_build_object('claimed',true,'claim',r.claim,'input',r.input,'deadline',r.deadline,'studioId',p.studio_id,'phase',r.phase);
  end if;
  if r.state<>'running' or r.claim is distinct from (p_data->>'claim')::uuid then raise exception 'AGENT_RUN_STOPPED'; end if;
  if p_action='take_notes' then
    v_pending:=r.steer_notes;
    if v_pending='[]'::jsonb then return '{"notes":[]}'; end if;
    update scene_private.agent_runs set steer_notes='[]' where id=r.id;
    return jsonb_build_object('notes',coalesce((select jsonb_agg(e->>'text') from jsonb_array_elements(v_pending) e),'[]'::jsonb));
  end if;
  if p_action='fail' then
    update scene_private.agent_runs set state=case when (jsonb_array_length(candidates)>0 or jsonb_array_length(coalesce(plan_candidates,'[]'::jsonb))>0) and p_data->>'errorCode' not in ('LEASE_LOST','LEASE_BUSY','REVISION_CONFLICT','FORBIDDEN','PROJECT_NOT_FOUND') then 'complete' else 'failed' end,
      error_code=p_data->>'errorCode',progress='执行中断，原场景与有效方案已保留',
      evaluation=case when (input->>'jevEnabled')::boolean then jsonb_build_object('status','partial','message','后续处理未完成，有效方案已保留，未生成推荐概率。') else null end
      where id=r.id returning * into r;
    return scene_private.agent_view(r);
  end if;
  perform scene_private.require_lease(p_actor,r.input||jsonb_build_object('projectId',p.id));
  if p_action='check' then return jsonb_build_object('active',true); end if;
  if p_action='step' then
    if r.call_count>=6 then raise exception 'AGENT_CALL_LIMIT'; end if;
    v_day:=(clock_timestamp() at time zone 'Asia/Shanghai')::date;
    insert into scene_private.text_daily_budgets(usage_day,committed_cents) values(v_day,20)
      on conflict(usage_day) do update set committed_cents=scene_private.text_daily_budgets.committed_cents+20;
    update scene_private.agent_runs set call_count=call_count+1,progress=p_data->>'progress',phase=coalesce(p_data->>'phase',phase) where id=r.id returning * into r;
    return jsonb_build_object('callCount',r.call_count,'phase',r.phase);
  elsif p_action='usage' then
    update scene_private.agent_runs set usage=usage||jsonb_build_array(p_data->'usage') where id=r.id;
    return '{}';
  elsif p_action='progress' then
    update scene_private.agent_runs set progress=left(p_data->>'progress',200),phase=coalesce(p_data->>'phase',phase) where id=r.id;
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
      evaluation=p_data->'evaluation',message=p_data->>'message' where id=r.id returning * into r;
    return scene_private.agent_view(r);
  end if;
  raise exception 'UNKNOWN_ACTION';
end $$;

-- 最新守卫包装层（接续 20261111170000）：接受改道备注时同时作废已存的户外候选，与室内提案同责。
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
  select * into r from scene_private.agent_runs where id=(p_data->>'id')::uuid and owner_id=p_actor and project_id=p.id for update;
  if not found then return public.agent_rpc_scene_unguarded_internal(p_actor,p_action,p_data); end if;
  if r.input->>'kind'='activity_tasks' then return public.agent_rpc(p_actor,p_action,p_data); end if;
  if p_action='note' then
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
