create function public.provision_demo_studio(p_studio uuid,p_name text,p_owner uuid,p_editor uuid)
returns uuid language plpgsql security invoker set search_path = '' as $$
begin
  if p_owner is null or p_editor is null or p_owner=p_editor then raise exception 'TWO_DISTINCT_USERS_REQUIRED'; end if;
  if exists(select 1 from scene_private.studios where id=p_studio) then
    if not exists(select 1 from scene_private.members where studio_id=p_studio and user_id=p_owner and role='owner') or
       not exists(select 1 from scene_private.members where studio_id=p_studio and user_id=p_editor and role='editor') then raise exception 'STUDIO_ALREADY_EXISTS'; end if;
    return p_studio;
  end if;
  insert into scene_private.studios(id,name) values(p_studio,p_name);
  insert into scene_private.members(studio_id,user_id,role,display_name) values
    (p_studio,p_owner,'owner','项目负责人'),(p_studio,p_editor,'editor','协作成员');
  return p_studio;
end $$;
revoke all on function public.provision_demo_studio(uuid,text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.provision_demo_studio(uuid,text,uuid,uuid) to service_role;
