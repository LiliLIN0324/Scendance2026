-- Default-off brief request fence. Applying this migration alone does not route
-- traffic through it and does not provide any monetary budget guarantee.
create table scene_private.brief_request_actors(actor uuid primary key references auth.users(id));
create table scene_private.brief_request_fences(
  actor uuid not null references auth.users(id), request_id uuid not null,
  fingerprint text not null check(fingerprint ~ '^[0-9a-f]{64}$'),
  state text not null check(state in ('reserved','dispatched','completed','cancelled','unknown')),
  created_at timestamptz not null default clock_timestamp(), primary key(actor,request_id)
);
create index brief_request_fences_rate on scene_private.brief_request_fences(actor,created_at);
alter table scene_private.brief_request_actors enable row level security;
alter table scene_private.brief_request_fences enable row level security;
revoke all on scene_private.brief_request_actors,scene_private.brief_request_fences from public,anon,authenticated;
grant select,insert,update on scene_private.brief_request_actors,scene_private.brief_request_fences to service_role;

create function public.brief_request_guard_rpc(p_actor uuid,p_action text,p_data jsonb default '{}') returns jsonb
language plpgsql security invoker set search_path='' as $$
declare item scene_private.brief_request_fences; next_state text; v_request_id uuid; v_fingerprint text;
begin
  if p_actor is null or not exists(select 1 from auth.users where id=p_actor) then raise exception 'FORBIDDEN'; end if;
  v_request_id:=(p_data->>'requestId')::uuid;v_fingerprint:=p_data->>'fingerprint';
  if v_request_id is null or v_fingerprint is null or v_fingerprint !~ '^[0-9a-f]{64}$' then raise exception 'INVALID_BRIEF_REQUEST'; end if;
  insert into scene_private.brief_request_actors(actor) values(p_actor) on conflict do nothing;
  perform 1 from scene_private.brief_request_actors where actor=p_actor for update;
  select * into item from scene_private.brief_request_fences r where r.actor=p_actor and r.request_id=v_request_id for update;
  if found then
    if item.fingerprint<>v_fingerprint then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    if p_action in ('reserve','get') then return jsonb_build_object('state',item.state,'created',false,'dispatch',false); end if;
    if p_action='dispatch' and item.state='reserved' then next_state:='dispatched';
    elsif p_action='complete' and item.state='dispatched' then next_state:='completed';
    elsif p_action='unknown' and item.state='dispatched' then next_state:='unknown';
    elsif p_action='cancel_before_dispatch' and item.state='reserved' then next_state:='cancelled';
    else return jsonb_build_object('state',item.state,'created',false,'dispatch',false); end if;
    update scene_private.brief_request_fences r set state=next_state where r.actor=p_actor and r.request_id=v_request_id;
    return jsonb_build_object('state',next_state,'created',false,'dispatch',p_action='dispatch');
  end if;
  if p_action<>'reserve' then raise exception 'REQUEST_NOT_FOUND'; end if;
  if exists(select 1 from scene_private.brief_request_fences r where r.actor=p_actor and r.state in ('reserved','dispatched','unknown')) then raise exception 'BRIEF_BUSY'; end if;
  if (select count(*) from scene_private.brief_request_fences r where r.actor=p_actor and r.created_at>clock_timestamp()-interval '1 minute')>=5 then raise exception 'BRIEF_RATE_LIMIT'; end if;
  insert into scene_private.brief_request_fences(actor,request_id,fingerprint,state) values(p_actor,v_request_id,v_fingerprint,'reserved');
  return jsonb_build_object('state','reserved','created',true,'dispatch',false);
end $$;
revoke all on function public.brief_request_guard_rpc(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.brief_request_guard_rpc(uuid,text,jsonb) to service_role;
