-- 左轨成员头像点开的一对一私信。消息存云端，所以丽丽在她机器上说的话，终树在自己机器上也看得到。
-- 只允许同一工作室的两位成员之间收发；给自己发是允许的（当备忘），这种消息一落库就算已读，否则永远挂在未读上。
create table scene_private.member_messages (
  id uuid primary key,
  studio_id uuid not null references scene_private.studios on delete cascade,
  from_user uuid not null references auth.users on delete cascade,
  to_user uuid not null references auth.users on delete cascade,
  body text not null check (length(body) between 1 and 2000),
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index member_messages_thread_idx on scene_private.member_messages (studio_id, from_user, to_user, created_at);
create index member_messages_unread_idx on scene_private.member_messages (studio_id, to_user, created_at) where read_at is null;
alter table scene_private.member_messages enable row level security;
revoke all on table scene_private.member_messages from public,anon,authenticated;
grant select,insert,update,delete on table scene_private.member_messages to service_role;

create or replace function public.studio_rpc(p_actor uuid,p_action text,p_data jsonb default '{}') returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare st scene_private.studios; m scene_private.members; msg scene_private.member_messages;
        peer uuid; target uuid; created boolean; marked integer;
begin
  if p_actor is null then raise exception 'UNAUTHENTICATED'; end if;
  if p_action='studios.create' then
    -- The caller keeps the same requestId when retrying an uncertain response.
    insert into scene_private.studios(id,name) values ((p_data->>'requestId')::uuid,p_data->>'name')
      on conflict (id) do nothing;
    created := found;
    select * into st from scene_private.studios where id=(p_data->>'requestId')::uuid for update;
    select * into m from scene_private.members where studio_id=st.id and role='owner';
    if not created then
      if m.user_id is distinct from p_actor or st.name is distinct from p_data->>'name' or m.display_name is distinct from p_data->>'displayName' then
        raise exception 'IDEMPOTENCY_CONFLICT';
      end if;
    else
      insert into scene_private.members(studio_id,user_id,role,display_name)
        values (st.id,p_actor,'owner',p_data->>'displayName') returning * into m;
    end if;
    return jsonb_build_object('id',st.id,'name',st.name,'role',m.role,'displayName',m.display_name);
  end if;

  select * into st from scene_private.studios where id=(p_data->>'studioId')::uuid for update;
  if not found or not scene_private.is_member(p_actor,st.id) then raise exception 'STUDIO_NOT_FOUND'; end if;
  if p_action='studios.projects.list' then
    return coalesce((select jsonb_agg(to_jsonb(x) order by x.updated_at desc,x.id) from (
      select pr.id,pr.name,pr.studio_id,pr.revision,pr.updated_at,pr.lease_expires,
        case when pr.lease_expires>clock_timestamp() then membership.display_name end as current_editor
      from scene_private.projects pr left join scene_private.members membership on membership.studio_id=pr.studio_id and membership.user_id=pr.lease_user
      where pr.studio_id=st.id and pr.deleted_at is null
    ) x),'[]');
  end if;
  if p_action='studios.members.list' then
    return coalesce((select jsonb_agg(jsonb_build_object('userId',user_id,'role',role,'displayName',display_name,'email',scene_private.member_email(user_id))
      order by role desc,display_name,user_id) from scene_private.members where studio_id=st.id),'[]');
  end if;

  -- Messages are member-to-member, so these branches sit above the owner-only gate below.
  peer := nullif(p_data->>'peerId','')::uuid;
  if p_action='studios.messages.list' then
    if not scene_private.is_member(peer,st.id) then raise exception 'USER_NOT_FOUND'; end if;
    return coalesce((select jsonb_agg(x order by x."createdAt",x.id) from (
      select id,from_user as "fromUserId",to_user as "toUserId",body,created_at as "createdAt",read_at as "readAt"
      from scene_private.member_messages
      where studio_id=st.id and ((from_user=p_actor and to_user=peer) or (from_user=peer and to_user=p_actor))
      order by created_at desc,id desc limit 200
    ) x),'[]');
  end if;
  if p_action='studios.messages.send' then
    if not scene_private.is_member(peer,st.id) then raise exception 'USER_NOT_FOUND'; end if;
    insert into scene_private.member_messages(id,studio_id,from_user,to_user,body,read_at)
      values ((p_data->>'requestId')::uuid,st.id,p_actor,peer,p_data->>'body',
        case when peer=p_actor then clock_timestamp() end)
      on conflict (id) do nothing;
    created := found;
    select * into msg from scene_private.member_messages where id=(p_data->>'requestId')::uuid;
    if not found then raise exception 'MESSAGE_NOT_FOUND'; end if;
    if not created and (msg.studio_id<>st.id or msg.from_user<>p_actor or msg.to_user<>peer
      or msg.body is distinct from p_data->>'body') then
      raise exception 'IDEMPOTENCY_CONFLICT';
    end if;
    return jsonb_build_object('id',msg.id,'fromUserId',msg.from_user,'toUserId',msg.to_user,
      'body',msg.body,'createdAt',msg.created_at,'readAt',msg.read_at);
  end if;
  if p_action='studios.messages.read' then
    update scene_private.member_messages set read_at=clock_timestamp()
      where studio_id=st.id and to_user=p_actor and from_user=peer and read_at is null;
    get diagnostics marked = row_count;
    return jsonb_build_object('marked',marked);
  end if;
  if p_action='studios.messages.unread' then
    return coalesce((select jsonb_agg(jsonb_build_object('userId',user_id,'count',unread) order by user_id) from (
      select from_user as user_id,count(*) as unread from scene_private.member_messages
      where studio_id=st.id and to_user=p_actor and read_at is null and from_user<>p_actor
      group by from_user
    ) x),'[]');
  end if;

  if not exists(select 1 from scene_private.members where studio_id=st.id and user_id=p_actor and role='owner') then
    raise exception 'FORBIDDEN';
  end if;
  if p_action='studios.rename' then
    update scene_private.studios set name=p_data->>'name' where id=st.id returning * into st;
    select * into m from scene_private.members where studio_id=st.id and user_id=p_actor;
    return jsonb_build_object('id',st.id,'name',st.name,'role',m.role,'displayName',m.display_name);
  elsif p_action='studios.delete' then
    if exists(select 1 from scene_private.projects where studio_id=st.id and deleted_at is null) then raise exception 'STUDIO_NOT_EMPTY'; end if;
    -- Retain the studio row for deleted-project audit FKs; remove all access atomically.
    update scene_private.studios set deleted_at=clock_timestamp() where id=st.id;
    delete from scene_private.members where studio_id=st.id;
    return '{"removed":true}';
  end if;
  target := (p_data->>'userId')::uuid;
  if exists(select 1 from scene_private.members where studio_id=st.id and user_id=target and role='owner') then
    raise exception 'OWNER_PROTECTED';
  end if;
  if p_action='studios.members.put' then
    begin
      insert into scene_private.members(studio_id,user_id,role,display_name) values (st.id,target,'editor',p_data->>'displayName')
        on conflict (studio_id,user_id) do update set display_name=excluded.display_name returning * into m;
    exception when foreign_key_violation then
      raise exception 'USER_NOT_FOUND';
    end;
    return jsonb_build_object('userId',m.user_id,'role',m.role,'displayName',m.display_name);
  elsif p_action='studios.members.remove' then
    -- Serialize revocation with existing project edits, including lease acquisition.
    perform id from scene_private.projects where studio_id=st.id order by id for update;
    delete from scene_private.members where studio_id=st.id and user_id=target and role='editor';
    update scene_private.projects set lease_user=null,lease_session=null,lease_expires=null,lease_generation=lease_generation+1
      where studio_id=st.id and lease_user=target;
    return '{"removed":true}';
  end if;
  raise exception 'UNKNOWN_ACTION';
end $$;
revoke all on function public.studio_rpc(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.studio_rpc(uuid,text,jsonb) to service_role;
