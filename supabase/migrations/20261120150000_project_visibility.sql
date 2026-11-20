-- 项目可见三档（L2 内部分层）：team 同室全员可读写 / view-only 同室只读 / private 仅创建人。
--
-- 口径（见权限方案 §3.3）：
--   · team：现状行为，同室成员可见可编辑。
--   · view-only：同室成员能打开、能看物料与方案，但不能抢锁、保存、改名、提候选或发布。
--   · private：只有创建人自己可见可取用；同室其他成员列表里看不到、读取报 PROJECT_NOT_FOUND。
-- 一期 private 仅绑定创建人；「显式受邀人」不另建并行权限表，留待后续角色/邀请模型一起做。
--
-- 回滚：drop 下方辅助函数；alter table projects drop column visibility；把 scene_rpc
-- 换回 20261120130000_studio_assets.sql 那一版。

alter table scene_private.projects add column if not exists visibility text not null default 'team'
  check (visibility in ('team', 'view-only', 'private'));

-- 读：物主本人，或同室成员且项目不是 private。
create or replace function scene_private.can_read_project(actor uuid, pr scene_private.projects) returns boolean
language sql stable set search_path = '' as $$
  select pr.created_by = actor
    or (pr.visibility in ('team', 'view-only') and scene_private.is_member(actor, pr.studio_id))
$$;

-- 写：物主本人，或同室成员且项目是 team（view-only 与 private 对非物主只读/不可见）。
create or replace function scene_private.can_edit_project(actor uuid, pr scene_private.projects) returns boolean
language sql stable set search_path = '' as $$
  select pr.created_by = actor
    or (pr.visibility = 'team' and scene_private.is_member(actor, pr.studio_id))
$$;

alter function public.scene_rpc(uuid, text, jsonb) rename to scene_rpc_before_project_visibility;

create function public.scene_rpc(p_actor uuid, p_action text, p_data jsonb default '{}') returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_pr scene_private.projects;
  v_pid uuid;
  v_visibility text;
  -- 改变项目内容或状态的动作；view-only / private 下非物主一律拦在进入下游前。
  v_writes text[] := array[
    'projects.rename', 'projects.delete', 'projects.restore',
    'lease.acquire', 'lease.renew', 'scene.save',
    'proposals.store', 'proposals.apply', 'history.restore', 'publish'
  ];
  -- 读取动作：private 项目对非物主不可见，同样在进入下游前挡掉。
  v_reads text[] := array[
    'projects.get', 'lease.check', 'proposals.get', 'sources.list', 'materials'
  ];
begin
  if p_action = 'projects.list' then
    if p_actor is null then raise exception 'UNAUTHENTICATED'; end if;
    return coalesce((select jsonb_agg(to_jsonb(x)) from (
      select pr.id, pr.name, pr.studio_id, pr.revision, pr.updated_at, pr.visibility,
        case when pr.lease_expires > clock_timestamp() then m.display_name end as current_editor,
        pr.lease_expires
      from scene_private.projects pr
      left join scene_private.members m on m.studio_id = pr.studio_id and m.user_id = pr.lease_user
      where pr.deleted_at is null and (
        pr.created_by = p_actor
        or (pr.visibility in ('team', 'view-only') and scene_private.is_member(p_actor, pr.studio_id))
      )
      order by pr.updated_at desc limit 100) x), '[]'::jsonb);
  end if;

  if p_action = 'projects.set_visibility' then
    if p_actor is null then raise exception 'UNAUTHENTICATED'; end if;
    v_pid := (p_data->>'projectId')::uuid;
    select * into v_pr from scene_private.projects where id = v_pid for update;
    if not found or not scene_private.can_read_project(p_actor, v_pr) then raise exception 'PROJECT_NOT_FOUND'; end if;
    -- 只有物主或工作室 owner 能调整可见性；editor 不能把别人的方案改成私有或只读。
    if v_pr.created_by <> p_actor and not exists(select 1 from scene_private.members
      where studio_id = v_pr.studio_id and user_id = p_actor and role = 'owner') then
      raise exception 'FORBIDDEN';
    end if;
    v_visibility := p_data->>'visibility';
    if v_visibility not in ('team', 'view-only', 'private') then raise exception 'INVALID_VISIBILITY'; end if;
    update scene_private.projects set visibility = v_visibility, updated_at = clock_timestamp()
      where id = v_pr.id returning * into v_pr;
    return to_jsonb(v_pr);
  end if;

  v_pid := (p_data->>'projectId')::uuid;
  if v_pid is not null and (p_action = any(v_writes) or p_action = any(v_reads)) then
    select * into v_pr from scene_private.projects where id = v_pid;
    if found then
      -- 不可读一律按不存在处理，不向同室非受邀成员泄露项目存在。
      if not scene_private.can_read_project(p_actor, v_pr) then raise exception 'PROJECT_NOT_FOUND'; end if;
      if p_action = any(v_writes) and not scene_private.can_edit_project(p_actor, v_pr) then raise exception 'FORBIDDEN'; end if;
    end if;
  end if;

  return public.scene_rpc_before_project_visibility(p_actor, p_action, p_data);
end $$;

revoke all on function public.scene_rpc(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.scene_rpc(uuid, text, jsonb) to service_role;

-- 工作室项目列表（前端 /projects 页走这条）同样按可见性过滤，并回带 visibility。
-- studio_rpc 历史上是整表 replace 演进；这里复制顶端 20261103223000 的其余分支，
-- 只收窄 projects.list 的可见条件。
create or replace function public.studio_rpc(p_actor uuid, p_action text, p_data jsonb default '{}') returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare st scene_private.studios; m scene_private.members; msg scene_private.member_messages;
        peer uuid; target uuid; created boolean; marked integer; invite_email text;
begin
  if p_actor is null then raise exception 'UNAUTHENTICATED'; end if;
  if p_action='studios.create' then
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
      select pr.id,pr.name,pr.studio_id,pr.revision,pr.updated_at,pr.visibility,pr.lease_expires,
        case when pr.lease_expires>clock_timestamp() then membership.display_name end as current_editor
      from scene_private.projects pr left join scene_private.members membership on membership.studio_id=pr.studio_id and membership.user_id=pr.lease_user
      where pr.studio_id=st.id and pr.deleted_at is null
        and (pr.created_by=p_actor or pr.visibility in ('team','view-only'))
    ) x),'[]');
  end if;
  if p_action='studios.members.list' then
    return coalesce((select jsonb_agg(jsonb_build_object('userId',user_id,'role',role,'displayName',display_name,'email',scene_private.member_email(user_id))
      order by role desc,display_name,user_id) from scene_private.members where studio_id=st.id),'[]');
  end if;

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
    perform id from scene_private.projects where studio_id=st.id order by id for update;
    delete from scene_private.members where studio_id=st.id and user_id=target and role='editor';
    update scene_private.projects set lease_user=null,lease_session=null,lease_expires=null,lease_generation=lease_generation+1
      where studio_id=st.id and lease_user=target;
    return '{"removed":true}';
  end if;
  raise exception 'UNKNOWN_ACTION';
end $$;

revoke all on function public.studio_rpc(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.studio_rpc(uuid, text, jsonb) to service_role;
