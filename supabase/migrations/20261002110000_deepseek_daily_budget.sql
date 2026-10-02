-- Beijing-day, site-wide DeepSeek cap. Reserve before EVERY provider attempt,
-- including repairs. Failed/unknown calls are never automatically refunded.
create table scene_private.text_daily_budgets (
  usage_day date primary key,
  committed_cents integer not null default 0 check(committed_cents between 0 and 1000)
);
create table scene_private.text_provider_calls (
  request_id uuid not null references scene_private.requests on delete cascade,
  attempt integer not null check(attempt in (0,1)),
  usage_day date not null references scene_private.text_daily_budgets,
  reserved_cents integer not null default 20 check(reserved_cents=20),
  created_at timestamptz not null default clock_timestamp(),
  primary key(request_id,attempt)
);
alter table scene_private.text_daily_budgets enable row level security;
alter table scene_private.text_provider_calls enable row level security;
revoke all on scene_private.text_daily_budgets,scene_private.text_provider_calls from public,anon,authenticated;
grant select,insert,update,delete on scene_private.text_daily_budgets,scene_private.text_provider_calls to service_role;

create or replace function public.job_rpc(p_actor uuid,p_action text,p_data jsonb default '{}') returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare req scene_private.requests; j scene_private.generation_jobs; b scene_private.budgets;
  v_kind text; existing boolean; next_state text; v_day date; v_spent integer; v_attempt integer;
begin
  if p_action='text.reserve_call' then
    v_attempt := (p_data->>'attempt')::integer;
    if v_attempt is null or v_attempt not in (0,1) then raise exception 'INVALID_AI_ATTEMPT'; end if;
    select * into req from scene_private.requests where id=(p_data->>'id')::uuid and owner_id=p_actor and kind='text' and state='reserved' for update;
    if not found then raise exception 'REQUEST_NOT_FOUND'; end if;
    if exists(select 1 from scene_private.text_provider_calls where request_id=req.id and attempt=v_attempt) then raise exception 'AI_CALL_ALREADY_RESERVED'; end if;
    if v_attempt=1 and not exists(select 1 from scene_private.text_provider_calls where request_id=req.id and attempt=0) then raise exception 'INVALID_AI_ATTEMPT'; end if;
    v_day := (clock_timestamp() at time zone 'Asia/Shanghai')::date;
    insert into scene_private.text_daily_budgets(usage_day) values(v_day) on conflict do nothing;
    update scene_private.text_daily_budgets set committed_cents=committed_cents+20
      where usage_day=v_day and committed_cents+20<=1000 returning committed_cents into v_spent;
    if not found then raise exception 'DAILY_BUDGET_EXCEEDED'; end if;
    insert into scene_private.text_provider_calls(request_id,attempt,usage_day) values(req.id,v_attempt,v_day);
    return jsonb_build_object('usageDay',v_day,'reservedCents',20,'committedCents',v_spent,'limitCents',1000);
  elsif p_action in ('reserve','jobs.create') then
    if p_actor is null or not exists(select 1 from scene_private.members where user_id=p_actor) then raise exception 'FORBIDDEN'; end if;
    v_kind := case when p_action='jobs.create' then 'generation' else 'text' end;
    select * into b from scene_private.budgets where budgets.kind=v_kind for update;
    select * into req from scene_private.requests where owner_id=p_actor and requests.kind=v_kind and request_key=(p_data->>'requestId')::uuid;
    existing := found;
    if existing then
      if req.fingerprint is distinct from p_data->>'fingerprint' then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
      if v_kind='generation' then select * into j from scene_private.generation_jobs where id=req.id; return to_jsonb(j)||'{"reused":true}'; end if;
      return to_jsonb(req)||'{"reused":true}';
    end if;
    if (p_data->>'reserveCents')::integer is null or (p_data->>'reserveCents')::integer <=0 then raise exception 'BILLING_NOT_CONFIGURED'; end if;
    if b.committed_cents+(p_data->>'reserveCents')::integer > b.limit_cents then raise exception 'BUDGET_EXCEEDED'; end if;
    if v_kind='generation' and exists(select 1 from scene_private.generation_jobs where state in ('queued','submitting','submitted','processing','archiving','submit_unknown')) then raise exception 'GENERATION_BUSY'; end if;
    if v_kind='text' and exists(select 1 from scene_private.requests where owner_id=p_actor and requests.kind='text' and state='reserved' and created_at>clock_timestamp()-interval '2 minutes') then raise exception 'AI_BUSY'; end if;
    insert into scene_private.requests(owner_id,kind,request_key,fingerprint,reserved_cents)
      values(p_actor,v_kind,(p_data->>'requestId')::uuid,p_data->>'fingerprint',(p_data->>'reserveCents')::integer) returning * into req;
    update scene_private.budgets set committed_cents=committed_cents+req.reserved_cents where budgets.kind=v_kind;
    if v_kind='generation' then
      insert into scene_private.generation_jobs(id,owner_id,prompt) values(req.id,p_actor,p_data->>'prompt') returning * into j;
      return to_jsonb(j)||'{"reused":false}';
    end if;
    return to_jsonb(req)||'{"reused":false}';
  elsif p_action='requests.finish' then
    update scene_private.requests set state=p_data->>'state',result=p_data->'result',provider_usage=coalesce(p_data->'usage','{}')
      where id=(p_data->>'id')::uuid and owner_id=p_actor and kind='text' and state='reserved' returning * into req;
    if not found then raise exception 'REQUEST_NOT_FOUND'; end if; return to_jsonb(req);
  elsif p_action='jobs.list' then
    return coalesce((select jsonb_agg(to_jsonb(x)-'worker_token'-'worker_until') from (select * from scene_private.generation_jobs where owner_id=p_actor order by created_at desc limit 100) x),'[]');
  elsif p_action='jobs.get' then
    select * into j from scene_private.generation_jobs where id=(p_data->>'id')::uuid and owner_id=p_actor;
    if not found then raise exception 'JOB_NOT_FOUND'; end if; return to_jsonb(j)-'worker_token'-'worker_until';
  elsif p_action='jobs.claim' then
    -- A crash after dispatch is ambiguous: never resubmit a paid request automatically.
    update scene_private.generation_jobs set state='submit_unknown',error_code='SUBMIT_RESULT_UNKNOWN',worker_token=null,worker_until=null,updated_at=clock_timestamp()
      where state='submitting' and worker_until<clock_timestamp();
    update scene_private.requests r set state='unknown' from scene_private.generation_jobs g
      where g.id=r.id and g.state='submit_unknown' and r.state='reserved';
    select * into j from scene_private.generation_jobs where state in ('queued','submitted','processing','archiving')
      and next_poll_at<=clock_timestamp() and (worker_until is null or worker_until<clock_timestamp())
      order by created_at for update skip locked limit 1;
    if not found then return 'null'; end if;
    update scene_private.generation_jobs set worker_token=gen_random_uuid(),worker_until=clock_timestamp()+interval '4 minutes',
      state=case when state='queued' then 'submitting' else state end, attempts=attempts+1,updated_at=clock_timestamp()
      where id=j.id returning * into j;
    return to_jsonb(j);
  elsif p_action in ('jobs.update','jobs.complete','jobs.archive_start') then
    select * into j from scene_private.generation_jobs where id=(p_data->>'id')::uuid for update;
    if not found or j.worker_token is null or j.worker_until is null or j.worker_token is distinct from (p_data->>'workerToken')::uuid or j.worker_until<=clock_timestamp() then raise exception 'WORKER_CLAIM_LOST'; end if;
    if p_action='jobs.archive_start' then
      if j.state not in ('submitted','processing','archiving') then raise exception 'INVALID_JOB_TRANSITION'; end if;
      update scene_private.generation_jobs set state='archiving',updated_at=clock_timestamp() where id=j.id returning * into j;
    elsif p_action='jobs.complete' then
      if j.state not in ('submitted','processing','archiving') then raise exception 'INVALID_JOB_TRANSITION'; end if;
      perform public.scene_rpc(j.owner_id,'assets.register',p_data->'asset');
      update scene_private.generation_jobs set state='ready',asset_id=(p_data->'asset'->>'id')::uuid,worker_token=null,worker_until=null,error_code=null,
        provider_usage=coalesce(p_data->'usage','{}'),updated_at=clock_timestamp() where id=j.id returning * into j;
      update scene_private.requests set state='complete',provider_usage=j.provider_usage where id=j.id;
    else
      next_state := p_data->>'state';
      if not ((j.state='submitting' and next_state in ('submitted','failed','submit_unknown')) or
              (j.state in ('submitted','processing','archiving') and next_state in ('processing','archiving','failed','rejected'))) then raise exception 'INVALID_JOB_TRANSITION'; end if;
      if next_state='submitted' and coalesce(p_data->>'providerJobId','')='' then raise exception 'MISSING_PROVIDER_JOB_ID'; end if;
      update scene_private.generation_jobs set state=next_state,provider_job_id=coalesce(p_data->>'providerJobId',provider_job_id),
        worker_token=null,worker_until=null,next_poll_at=clock_timestamp()+interval '30 seconds',error_code=p_data->>'errorCode',
        provider_usage=coalesce(p_data->'usage',provider_usage),updated_at=clock_timestamp() where id=j.id returning * into j;
      if next_state in ('failed','rejected','submit_unknown') then update scene_private.requests set state=case when next_state='submit_unknown' then 'unknown' else 'failed' end,provider_usage=j.provider_usage where id=j.id; end if;
    end if;
    return to_jsonb(j);
  elsif p_action='jobs.added' then
    if not exists(select 1 from scene_private.projects p where p.id=(p_data->>'projectId')::uuid and scene_private.is_member(p_actor,p.studio_id)
      and exists(select 1 from jsonb_array_elements(p.scene->'objects') o join scene_private.generation_jobs g on g.asset_id=(o->>'assetId')::uuid where g.id=(p_data->>'id')::uuid and g.owner_id=p_actor)) then raise exception 'ASSET_NOT_IN_SAVED_SCENE'; end if;
    update scene_private.generation_jobs set state='added',updated_at=clock_timestamp() where id=(p_data->>'id')::uuid and owner_id=p_actor and state in ('ready','added') returning * into j;
    if not found then raise exception 'JOB_NOT_FOUND'; end if; return to_jsonb(j)-'worker_token'-'worker_until';
  end if;
  raise exception 'UNKNOWN_ACTION';
end $$;
