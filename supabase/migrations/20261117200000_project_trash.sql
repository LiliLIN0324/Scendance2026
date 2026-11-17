-- 2026-11-17 项目回收站：软删保留 7 天，可恢复；过期后不再出现在列表。
--
-- 为什么不改历史迁移：`projects.delete` 已经在 20261003120000 里改成软删并撤销分享，
-- 线上环境可能已应用多层 `scene_rpc` 包装；这里继续叠一层，只加两个动作，
-- 其余动作原样转给下游，避免重写整条 RPC。
--
-- 口径：
--  · 删除 = 打 deleted_at + 撤销分享 + 清编辑权；项目本体、版本号、物料都还在。
--  · 恢复 = 清 deleted_at，revision + 1，编辑权保持清空（避免恢复后旧租约“复活”）。
--  · 分享链接在删除时已撤销，恢复不自动重新签发；用户重新分享即可。
--  · 只有工作室 owner 能看回收站和恢复；7 天窗口外的项目视为已过期，不提供恢复。

alter function public.scene_rpc(uuid,text,jsonb) rename to scene_rpc_before_project_trash;

create function public.scene_rpc(p_actor uuid, p_action text, p_data jsonb default '{}') returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare p scene_private.projects;
begin
  if p_action = 'projects.trash' then
    if p_actor is null then raise exception 'UNAUTHENTICATED'; end if;
    return coalesce((
      select jsonb_agg(to_jsonb(x))
      from (
        select pr.id, pr.name, pr.studio_id, pr.revision, pr.updated_at, pr.deleted_at
        from scene_private.projects pr
        where pr.deleted_at is not null
          and pr.deleted_at > clock_timestamp() - interval '7 days'
          and exists (
            select 1 from scene_private.members m
            where m.studio_id = pr.studio_id and m.user_id = p_actor and m.role = 'owner'
          )
        order by pr.deleted_at desc
        limit 100
      ) x
    ), '[]'::jsonb);
  end if;

  if p_action = 'projects.restore' then
    if p_actor is null then raise exception 'UNAUTHENTICATED'; end if;
    if p_data->>'projectId' is null then raise exception 'PROJECT_NOT_FOUND'; end if;
    select * into p from scene_private.projects where id = (p_data->>'projectId')::uuid for update;
    if not found or p.deleted_at is null or not scene_private.is_member(p_actor, p.studio_id) then
      raise exception 'PROJECT_NOT_FOUND';
    end if;
    if not exists (
      select 1 from scene_private.members
      where studio_id = p.studio_id and user_id = p_actor and role = 'owner'
    ) then raise exception 'FORBIDDEN'; end if;
    if p.deleted_at <= clock_timestamp() - interval '7 days' then raise exception 'TRASH_EXPIRED'; end if;
    if p_data->>'expectedRevision' is not null
       and p.revision is distinct from (p_data->>'expectedRevision')::bigint then
      raise exception 'REVISION_CONFLICT';
    end if;
    update scene_private.projects
       set deleted_at = null,
           updated_at = clock_timestamp(),
           revision = revision + 1,
           lease_user = null,
           lease_session = null,
           lease_expires = null,
           lease_generation = lease_generation + 1
     where id = p.id;
    return jsonb_build_object('restored', true, 'projectId', p.id, 'revision', p.revision + 1);
  end if;

  return public.scene_rpc_before_project_trash(p_actor, p_action, p_data);
end $$;

revoke all on function public.scene_rpc(uuid,text,jsonb) from public, anon, authenticated;
grant execute on function public.scene_rpc(uuid,text,jsonb) to service_role;
