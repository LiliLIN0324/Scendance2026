-- 添加成员用已注册邮箱，不再要求对方抄 UUID。
-- auth.users 对 service_role 不可读，走 definer 助手；仅在 owner 已通过 studio_rpc 校验后调用。
create or replace function scene_private.member_id_by_email(p_email text)
returns uuid language sql security definer set search_path = '' as $$
  select u.id from auth.users u
  where lower(u.email) = lower(trim(p_email))
  limit 1
$$;
revoke all on function scene_private.member_id_by_email(text) from public,anon,authenticated;
grant execute on function scene_private.member_id_by_email(text) to service_role;

create or replace function public.studio_rpc(p_actor uuid,p_action text,p_data jsonb default '{}') returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare st scene_private.studios; m scene_private.members; msg scene_private.member_messages;
        peer uuid; target uuid; created boolean; marked integer; invite_email text;
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

  invite_email := nullif(lower(trim(coalesce(p_data->>'email',''))),'');
  if invite_email is not null then
    target := scene_private.member_id_by_email(invite_email);
    if target is null then raise exception 'USER_NOT_FOUND'; end if;
  else
    target := (p_data->>'userId')::uuid;
  end if;
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
    return jsonb_build_object('userId',m.user_id,'role',m.role,'displayName',m.display_name,'email',scene_private.member_email(m.user_id));
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
