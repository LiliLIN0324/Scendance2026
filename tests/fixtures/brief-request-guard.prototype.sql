-- ISOLATED PROTOTYPE ONLY. Not a migration or a production endpoint.
-- A trusted authenticated service must compute the fingerprint from the exact
-- payload/provider configuration and pass the verified actor; never trust a browser digest.
create table scene_private.brief_guard_actors (
  actor uuid primary key references auth.users(id)
);
create table scene_private.brief_guard_requests (
  actor uuid not null references auth.users(id), request_id uuid not null,
  fingerprint text not null check(fingerprint ~ '^[0-9a-f]{64}$'),
  state text not null check(state in ('reserved','dispatched','completed','cancelled','unknown')),
  created_at timestamptz not null default clock_timestamp(),
  primary key(actor,request_id)
);
create index brief_guard_rate on scene_private.brief_guard_requests(actor,created_at);
alter table scene_private.brief_guard_actors enable row level security;
alter table scene_private.brief_guard_requests enable row level security;
revoke all on scene_private.brief_guard_actors,scene_private.brief_guard_requests from public,anon,authenticated;
grant select,insert,update on scene_private.brief_guard_actors,scene_private.brief_guard_requests to service_role;

create function public.brief_guard_prototype(p_actor uuid,p_action text,p_request uuid,p_fingerprint text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare row_value scene_private.brief_guard_requests; new_state text;
begin
  if p_actor is null or p_request is null or p_fingerprint is null or p_fingerprint !~ '^[0-9a-f]{64}$' then raise exception 'INVALID_BRIEF_REQUEST'; end if;
  if not exists(select 1 from auth.users where id=p_actor) then raise exception 'FORBIDDEN'; end if;
  insert into scene_private.brief_guard_actors(actor) values(p_actor) on conflict do nothing;
  perform 1 from scene_private.brief_guard_actors where actor=p_actor for update;
  select * into row_value from scene_private.brief_guard_requests where actor=p_actor and request_id=p_request for update;
  if found then
    if row_value.fingerprint<>p_fingerprint then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    if p_action='reserve' or p_action='get' then return jsonb_build_object('state',row_value.state,'created',false,'dispatch',false); end if;
    if p_action='dispatch' and row_value.state='reserved' then new_state:='dispatched';
    elsif p_action='complete' and row_value.state='dispatched' then new_state:='completed';
    elsif p_action='unknown' and row_value.state='dispatched' then new_state:='unknown';
    elsif p_action='cancel_before_dispatch' and row_value.state='reserved' then new_state:='cancelled';
    else return jsonb_build_object('state',row_value.state,'created',false,'dispatch',false); end if;
    update scene_private.brief_guard_requests set state=new_state where actor=p_actor and request_id=p_request;
    return jsonb_build_object('state',new_state,'created',false,'dispatch',p_action='dispatch');
  end if;
  if p_action<>'reserve' then raise exception 'REQUEST_NOT_FOUND'; end if;
  if exists(select 1 from scene_private.brief_guard_requests where actor=p_actor and state in ('reserved','dispatched','unknown')) then raise exception 'BRIEF_BUSY'; end if;
  if (select count(*) from scene_private.brief_guard_requests where actor=p_actor and created_at>clock_timestamp()-interval '1 minute')>=5 then raise exception 'BRIEF_RATE_LIMIT'; end if;
  insert into scene_private.brief_guard_requests(actor,request_id,fingerprint,state) values(p_actor,p_request,p_fingerprint,'reserved');
  return jsonb_build_object('state','reserved','created',true,'dispatch',false);
end $$;
revoke all on function public.brief_guard_prototype(uuid,text,uuid,text) from public,anon,authenticated;
grant execute on function public.brief_guard_prototype(uuid,text,uuid,text) to service_role;
