-- Activity task suggestions use the existing durable run and lease boundaries.
alter table scene_private.agent_runs add column activity_result jsonb;
alter table scene_private.agent_runs add constraint agent_runs_activity_result_check check (
  activity_result is null or (coalesce(input->>'kind'='activity_tasks',false) and jsonb_typeof(activity_result)='object')
);

create function scene_private.activity_agent_reference_key(value text) returns text
language sql immutable set search_path='' as $$
  select case when value ~* '^([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$'
    then lower(value) else value end
$$;
revoke all on function scene_private.activity_agent_reference_key(text) from public,anon,authenticated;
grant execute on function scene_private.activity_agent_reference_key(text) to service_role;

create function scene_private.activity_agent_view(r scene_private.agent_runs) returns jsonb
language sql stable set search_path='' as $$
  select jsonb_build_object('kind','activity_tasks','id',r.id,'projectId',r.project_id,'requestId',r.request_key,
    'state',r.state,'progress',r.progress,'callCount',r.call_count,'activityId',r.input->'activityContext'->>'projectId',
    'contextHash',r.base_hash,'activityResult',case when r.state='complete' then r.activity_result else null end,'expiresAt',r.deadline)
    || case when r.error_code is null then '{}'::jsonb else jsonb_build_object('errorCode',r.error_code) end
    || case when r.message is null then '{}'::jsonb else jsonb_build_object('message',r.message) end
$$;
revoke all on function scene_private.activity_agent_view(scene_private.agent_runs) from public,anon,authenticated;
grant execute on function scene_private.activity_agent_view(scene_private.agent_runs) to service_role;

alter function public.agent_rpc(uuid,text,jsonb) rename to agent_rpc_before_activity_tasks;
create function public.agent_rpc(p_actor uuid,p_action text,p_data jsonb default '{}') returns jsonb
language plpgsql security invoker set search_path='' as $$
declare
  r scene_private.agent_runs; p scene_private.projects;
  v_input jsonb; v_context jsonb; v_item jsonb; v_ref jsonb; v_result jsonb;
  v_allowed jsonb:='{}'; v_task_ids jsonb:='{}'; v_seen_refs jsonb; v_seen_rows jsonb:='{}';
  v_rows jsonb:='[]'; v_refs jsonb; v_row jsonb; v_sorted_refs jsonb;
  v_key text; v_row_key text; v_title text; v_acceptance text; v_day date;
  v_uuid_pattern constant text := '^([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$';
begin
  if p_action='create' then
    v_input:=p_data->'input';
    -- A missing discriminator remains the original Scene protocol, including its fingerprint and response.
    if not coalesce(v_input ? 'kind',false) then
      return public.agent_rpc_before_activity_tasks(p_actor,p_action,p_data);
    end if;
    if jsonb_typeof(v_input) is distinct from 'object' or v_input->>'kind' is distinct from 'activity_tasks' then
      raise exception 'INVALID_ACTIVITY_INPUT';
    end if;
  else
    if p_action='by_request' then
      select * into r from scene_private.agent_runs where owner_id=p_actor and project_id=(p_data->>'projectId')::uuid
        and request_key=(p_data->>'requestId')::uuid for update;
    else
      select * into r from scene_private.agent_runs where id=(p_data->>'id')::uuid and owner_id=p_actor
        and project_id=(p_data->>'projectId')::uuid for update;
    end if;
    if not found or r.input->>'kind' is distinct from 'activity_tasks' then
      return public.agent_rpc_before_activity_tasks(p_actor,p_action,p_data);
    end if;
  end if;

  select * into p from scene_private.projects where id=(p_data->>'projectId')::uuid;
  if p_actor is null or not found or p.deleted_at is not null or not scene_private.is_member(p_actor,p.studio_id) then
    raise exception 'PROJECT_NOT_FOUND';
  end if;

  if p_action='create' then
    if not (v_input ?& array['kind','requestId','sessionId','generation','expectedRevision','instruction','activityContext'])
      or exists(select 1 from jsonb_object_keys(v_input) k where k not in ('kind','requestId','sessionId','generation','expectedRevision','instruction','activityContext'))
      or jsonb_typeof(v_input->'requestId') is distinct from 'string' or (v_input->>'requestId') !~* v_uuid_pattern
      or jsonb_typeof(v_input->'sessionId') is distinct from 'string' or (v_input->>'sessionId') !~* v_uuid_pattern
      or jsonb_typeof(v_input->'generation') is distinct from 'number'
      or jsonb_typeof(v_input->'expectedRevision') is distinct from 'number'
      or jsonb_typeof(v_input->'instruction') is distinct from 'string'
      or length(v_input->>'instruction') not between 1 and 6000 or (v_input->>'instruction') ~ '^[[:space:]]*$'
      or jsonb_typeof(p_data->'fingerprint') is distinct from 'string' or length(p_data->>'fingerprint') not between 1 and 256
      or jsonb_typeof(p_data->'baseHash') is distinct from 'string' or (p_data->>'baseHash') !~ '^[a-f0-9]{64}$'
      or (p_data ? 'executionMode' and p_data->>'executionMode' is distinct from 'preview') then
      raise exception 'INVALID_ACTIVITY_INPUT';
    end if;
    if (v_input->>'generation')::numeric not between 1 and 9007199254740991
      or (v_input->>'generation')::numeric <> trunc((v_input->>'generation')::numeric)
      or (v_input->>'expectedRevision')::numeric not between 0 and 9007199254740991
      or (v_input->>'expectedRevision')::numeric <> trunc((v_input->>'expectedRevision')::numeric) then
      raise exception 'INVALID_ACTIVITY_INPUT';
    end if;
    v_context:=v_input->'activityContext';
    if jsonb_typeof(v_context) is distinct from 'object' then raise exception 'INVALID_ACTIVITY_INPUT'; end if;
    if not (v_context ?& array['projectId','dataKind','briefText','tasks','objects'])
      or exists(select 1 from jsonb_object_keys(v_context) k where k not in ('projectId','dataKind','briefText','tasks','objects'))
      or jsonb_typeof(v_context->'projectId') is distinct from 'string' or length(v_context->>'projectId') not between 1 and 128
      or v_context->>'projectId'='local' or (v_context->>'projectId') ~ '^[[:space:]]*$'
      or jsonb_typeof(v_context->'dataKind') is distinct from 'string' or v_context->>'dataKind' not in ('unspecified','rehearsal','real')
      or jsonb_typeof(v_context->'briefText') is distinct from 'string' or length(v_context->>'briefText')>12000
      or jsonb_typeof(v_context->'tasks') is distinct from 'array' or jsonb_typeof(v_context->'objects') is distinct from 'array' then
      raise exception 'INVALID_ACTIVITY_INPUT';
    end if;
    if jsonb_array_length(v_context->'tasks')>500 or jsonb_array_length(v_context->'objects')>500 then raise exception 'INVALID_ACTIVITY_INPUT'; end if;
    -- The edge validates the full context schema; the database protects identity and reference boundaries.
    for v_item in select value from jsonb_array_elements(v_context->'objects') loop
      if jsonb_typeof(v_item) is distinct from 'object' then raise exception 'INVALID_ACTIVITY_INPUT'; end if;
      if exists(select 1 from jsonb_object_keys(v_item) k where k not in ('id','name','type','floorId','floorName','size','color','position','rotation','elevation'))
        or jsonb_typeof(v_item->'id') is distinct from 'string' or length(v_item->>'id') not between 1 and 128
        or (v_item->>'id') ~ '^[[:space:]]*$' then raise exception 'INVALID_ACTIVITY_INPUT'; end if;
      v_key:=scene_private.activity_agent_reference_key(v_item->>'id');
      if v_allowed ? v_key then raise exception 'INVALID_ACTIVITY_INPUT'; end if;
      v_allowed:=v_allowed||jsonb_build_object(v_key,v_item->>'id');
    end loop;
    for v_item in select value from jsonb_array_elements(v_context->'tasks') loop
      if jsonb_typeof(v_item) is distinct from 'object' then raise exception 'INVALID_ACTIVITY_INPUT'; end if;
      if exists(select 1 from jsonb_object_keys(v_item) k where k not in ('id','title','phase','acceptance','plannedStartAt','plannedEndAt','status','objectIds'))
        or jsonb_typeof(v_item->'id') is distinct from 'string' or (v_item->>'id') !~* v_uuid_pattern
        or jsonb_typeof(v_item->'title') is distinct from 'string' or length(v_item->>'title') not between 1 and 120
        or (v_item->>'title') ~ '^[[:space:]]*$'
        or jsonb_typeof(v_item->'phase') is distinct from 'string' or v_item->>'phase' not in ('preparation','setup','event','teardown')
        or jsonb_typeof(v_item->'acceptance') is distinct from 'string' or length(v_item->>'acceptance')>1000
        or jsonb_typeof(v_item->'status') is distinct from 'string' or v_item->>'status' not in ('todo','doing','review','accepted','needs_review')
        or jsonb_typeof(v_item->'objectIds') is distinct from 'array' then raise exception 'INVALID_ACTIVITY_INPUT'; end if;
      v_key:=scene_private.activity_agent_reference_key(v_item->>'id');
      if v_task_ids ? v_key or jsonb_array_length(v_item->'objectIds')>500 then raise exception 'INVALID_ACTIVITY_INPUT'; end if;
      v_task_ids:=v_task_ids||jsonb_build_object(v_key,true);
      v_seen_refs:='{}';
      for v_ref in select value from jsonb_array_elements(v_item->'objectIds') loop
        if jsonb_typeof(v_ref) is distinct from 'string' or length(v_ref#>>'{}') not between 1 and 128
          or (v_ref#>>'{}') ~ '^[[:space:]]*$' then raise exception 'INVALID_ACTIVITY_INPUT'; end if;
        v_key:=scene_private.activity_agent_reference_key(v_ref#>>'{}');
        if not (v_allowed ? v_key) or v_seen_refs ? v_key then raise exception 'INVALID_ACTIVITY_INPUT'; end if;
        v_seen_refs:=v_seen_refs||jsonb_build_object(v_key,true);
      end loop;
    end loop;

    perform pg_advisory_xact_lock(hashtextextended('agent-owner:'||p_actor::text,0));
    perform pg_advisory_xact_lock(hashtextextended('agent:'||p_actor::text||':'||p.id::text||':'||(v_input->>'requestId'),0));
    select * into r from scene_private.agent_runs where owner_id=p_actor and project_id=p.id
      and request_key=(v_input->>'requestId')::uuid for update;
    if found then
      if r.fingerprint is distinct from p_data->>'fingerprint' or r.input->>'kind' is distinct from 'activity_tasks' then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
      return scene_private.activity_agent_view(r)||'{"reused":true}';
    end if;
    perform scene_private.require_lease(p_actor,v_input||jsonb_build_object('projectId',p.id));
    if exists(select 1 from scene_private.agent_runs where owner_id=p_actor and state in ('queued','running') and deadline>clock_timestamp()) then raise exception 'AI_BUSY'; end if;
    insert into scene_private.agent_runs(owner_id,project_id,request_key,fingerprint,input,base_hash,execution_mode)
      values(p_actor,p.id,(v_input->>'requestId')::uuid,p_data->>'fingerprint',v_input,p_data->>'baseHash','preview') returning * into r;
    return scene_private.activity_agent_view(r)||'{"reused":false}';
  end if;

  if r.state in ('queued','running') and r.deadline<=clock_timestamp() then
    update scene_private.agent_runs set state='failed',error_code='AGENT_DEADLINE',progress='执行已超时',activity_result=null
      where id=r.id returning * into r;
  end if;
  if p_action in ('get','by_request') then return scene_private.activity_agent_view(r); end if;
  if p_action='cancel' then
    update scene_private.agent_runs set state='cancelled',progress='已取消',execution_mode='preview',activity_result=null
      where id=r.id returning * into r;
    return scene_private.activity_agent_view(r);
  end if;
  if p_action='start' then
    if r.state<>'queued' then return '{"claimed":false}'; end if;
    update scene_private.agent_runs set state='running',claim=gen_random_uuid(),progress='正在读取活动资料' where id=r.id returning * into r;
    return jsonb_build_object('claimed',true,'claim',r.claim,'input',r.input,'deadline',r.deadline,'studioId',p.studio_id);
  end if;
  if r.state<>'running' or r.claim is distinct from (p_data->>'claim')::uuid then raise exception 'AGENT_RUN_STOPPED'; end if;
  if p_action='fail' then
    update scene_private.agent_runs set state='failed',error_code=p_data->>'errorCode',progress='执行中断，请重新准备建议',activity_result=null
      where id=r.id returning * into r;
    return scene_private.activity_agent_view(r);
  end if;
  perform scene_private.require_lease(p_actor,r.input||jsonb_build_object('projectId',p.id));
  if p_action='check' then return jsonb_build_object('active',true); end if;
  if p_action='step' then
    if r.call_count>=1 then raise exception 'AGENT_CALL_LIMIT'; end if;
    v_day:=(clock_timestamp() at time zone 'Asia/Shanghai')::date;
    insert into scene_private.text_daily_budgets(usage_day,committed_cents) values(v_day,20)
      on conflict(usage_day) do update set committed_cents=scene_private.text_daily_budgets.committed_cents+20;
    update scene_private.agent_runs set call_count=call_count+1,progress=left(p_data->>'progress',200) where id=r.id returning * into r;
    return jsonb_build_object('callCount',r.call_count);
  elsif p_action='usage' then
    update scene_private.agent_runs set usage=usage||jsonb_build_array(p_data->'usage') where id=r.id;
    return '{}';
  elsif p_action='progress' then
    update scene_private.agent_runs set progress=left(p_data->>'progress',200) where id=r.id;
    return '{}';
  elsif p_action='finish' then
    if p_data ?| array['candidates','evaluation','proposal','scene'] then raise exception 'INVALID_ACTIVITY_RESULT'; end if;
    v_result:=p_data->'activityResult';
    if jsonb_typeof(v_result) is distinct from 'object' then raise exception 'INVALID_ACTIVITY_RESULT'; end if;
    if not (v_result ? 'suggestions') or exists(select 1 from jsonb_object_keys(v_result) k where k<>'suggestions')
      or jsonb_typeof(v_result->'suggestions') is distinct from 'array' then raise exception 'INVALID_ACTIVITY_RESULT'; end if;
    if jsonb_array_length(v_result->'suggestions') not between 1 and 500 then raise exception 'INVALID_ACTIVITY_RESULT'; end if;
    for v_item in select value from jsonb_array_elements(r.input->'activityContext'->'objects') loop
      v_allowed:=v_allowed||jsonb_build_object(scene_private.activity_agent_reference_key(v_item->>'id'),v_item->>'id');
    end loop;
    for v_item in select value from jsonb_array_elements(v_result->'suggestions') loop
      if jsonb_typeof(v_item) is distinct from 'object' then raise exception 'INVALID_ACTIVITY_RESULT'; end if;
      if not (v_item ?& array['title','phase','acceptance'])
        or exists(select 1 from jsonb_object_keys(v_item) k where k not in ('title','phase','acceptance','objectIds'))
        or jsonb_typeof(v_item->'title') is distinct from 'string' or length(v_item->>'title') not between 1 and 120
        or (v_item->>'title') ~ '^[[:space:]]*$'
        or jsonb_typeof(v_item->'phase') is distinct from 'string' or v_item->>'phase' not in ('preparation','setup','event','teardown')
        or jsonb_typeof(v_item->'acceptance') is distinct from 'string' or length(v_item->>'acceptance') not between 1 and 1000
        or (v_item->>'acceptance') ~ '^[[:space:]]*$'
        or (v_item ? 'objectIds' and jsonb_typeof(v_item->'objectIds') is distinct from 'array') then raise exception 'INVALID_ACTIVITY_RESULT'; end if;
      v_refs:=coalesce(v_item->'objectIds','[]');
      if jsonb_array_length(v_refs)>500 then raise exception 'INVALID_ACTIVITY_RESULT'; end if;
      v_seen_refs:='{}'; v_row:='[]';
      for v_ref in select value from jsonb_array_elements(v_refs) loop
        if jsonb_typeof(v_ref) is distinct from 'string' or length(v_ref#>>'{}') not between 1 and 128
          or (v_ref#>>'{}') ~ '^[[:space:]]*$' then raise exception 'INVALID_ACTIVITY_RESULT'; end if;
        v_key:=scene_private.activity_agent_reference_key(v_ref#>>'{}');
        if not (v_allowed ? v_key) or v_seen_refs ? v_key then raise exception 'INVALID_ACTIVITY_RESULT'; end if;
        v_seen_refs:=v_seen_refs||jsonb_build_object(v_key,true);
        v_row:=v_row||jsonb_build_array(v_allowed->>v_key);
      end loop;
      v_title:=regexp_replace(v_item->>'title','^[[:space:]]+|[[:space:]]+$','','g');
      v_acceptance:=regexp_replace(v_item->>'acceptance','^[[:space:]]+|[[:space:]]+$','','g');
      select coalesce(jsonb_agg(k order by k),'[]') into v_sorted_refs from jsonb_object_keys(v_seen_refs) k;
      v_row_key:=jsonb_build_object('title',v_title,'phase',v_item->>'phase','acceptance',v_acceptance,'objectIds',v_sorted_refs)::text;
      if v_seen_rows ? v_row_key then raise exception 'INVALID_ACTIVITY_RESULT'; end if;
      v_seen_rows:=v_seen_rows||jsonb_build_object(v_row_key,true);
      v_rows:=v_rows||jsonb_build_array(jsonb_build_object('title',v_title,'phase',v_item->>'phase','acceptance',v_acceptance,'objectIds',v_row));
    end loop;
    -- Result storage and the completed state are one commit; no Scene proposal is created.
    update scene_private.agent_runs set state='complete',progress='任务建议已准备好',activity_result=jsonb_build_object('suggestions',v_rows),
      error_code=null,message=p_data->>'message' where id=r.id returning * into r;
    return scene_private.activity_agent_view(r);
  end if;
  raise exception 'UNKNOWN_ACTION';
end $$;
revoke all on function public.agent_rpc(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.agent_rpc(uuid,text,jsonb) to service_role;
