-- Account authentication stays in Auth. This RPC manages only business membership.
create function public.studio_rpc(p_actor uuid,p_action text,p_data jsonb default '{}') returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare st scene_private.studios; m scene_private.members; target uuid; created boolean;
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
  if p_action='studios.members.list' then
    return coalesce((select jsonb_agg(jsonb_build_object('userId',user_id,'role',role,'displayName',display_name)
      order by role desc,display_name,user_id) from scene_private.members where studio_id=st.id),'[]');
  end if;
  if not exists(select 1 from scene_private.members where studio_id=st.id and user_id=p_actor and role='owner') then
    raise exception 'FORBIDDEN';
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
