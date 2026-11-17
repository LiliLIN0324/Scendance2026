-- 2026-11-17 工作室回收站互斥：只要工作室还有 7 天内可恢复的项目，就不允许删工作室。
--
-- 原因：删除工作室会清空成员关系；而项目回收站恢复依赖成员关系。
-- 若此时允许删工作室，用户会看到“7 天内可恢复”的项目却永远恢复不了。
-- 只在调用者是 owner 时做这个额外判断；其他角色仍走下游的 STUDIO_NOT_FOUND/FORBIDDEN，
-- 避免通过错误类型探测工作室里是否有回收站项目。

alter function public.studio_rpc(uuid,text,jsonb) rename to studio_rpc_before_trash_guard;

create function public.studio_rpc(p_actor uuid, p_action text, p_data jsonb default '{}') returns jsonb
language plpgsql security invoker set search_path = '' as $$
begin
  if p_action = 'studios.delete'
     and exists (
       select 1 from scene_private.members m
       where m.studio_id = (p_data->>'studioId')::uuid and m.user_id = p_actor and m.role = 'owner'
     )
     and exists (
       select 1 from scene_private.projects p
       where p.studio_id = (p_data->>'studioId')::uuid
         and p.deleted_at is not null
         and p.deleted_at > clock_timestamp() - interval '7 days'
     ) then
    raise exception 'STUDIO_TRASH_NOT_EMPTY';
  end if;
  return public.studio_rpc_before_trash_guard(p_actor, p_action, p_data);
end $$;

revoke all on function public.studio_rpc(uuid,text,jsonb) from public, anon, authenticated;
grant execute on function public.studio_rpc(uuid,text,jsonb) to service_role;
