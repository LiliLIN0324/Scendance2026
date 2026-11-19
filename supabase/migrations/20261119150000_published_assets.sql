-- 公开物料：本人生成物可以放进公共目录，任何注册用户都能在物料库看到并取用。
--
-- 为什么要单独一张表，而不是直接复用 scene_private.library_assets：
-- 那张表的 model_id 绑死 3dassets.dev 的目录约定（register_library_asset 会强校验
-- sourceId/sourceUrl/license/catalog 四件套），把服务商出件塞进去会污染那份契约。
-- 这里另起一摊，catalog 字段只记来源分组。
--
-- 回滚：drop table scene_private.published_assets；
-- 再把 public.scene_rpc 删掉，把 scene_rpc_before_published_assets 改回 scene_rpc，
-- 并把 scene_private.can_use_asset 改回 20261003120000_project_deletion.sql 里的那一版。

create table if not exists scene_private.published_assets (
  asset_id uuid primary key references scene_private.assets(id) on delete cascade,
  published_by uuid not null,
  published_at timestamptz not null default now(),
  catalog text not null default 'scendance-generated'
);

alter table scene_private.published_assets enable row level security;
revoke all on table scene_private.published_assets from public, anon, authenticated;
grant select, insert, update, delete on scene_private.published_assets to service_role;
create index if not exists published_assets_recent_idx on scene_private.published_assets(published_at desc);

-- 公开物料对任何有工作室身份的用户可用；没有身份的人拿不到物料。
create or replace function scene_private.can_use_asset(actor uuid, asset uuid) returns boolean
language sql stable set search_path = '' as $$
  select exists(select 1 from scene_private.assets a where a.id = asset and
    (a.owner_id = actor
    or (exists(select 1 from scene_private.members where user_id = actor)
      and exists(select 1 from scene_private.published_assets pa where pa.asset_id = a.id))
    or exists(select 1 from scene_private.project_assets pa
      join scene_private.projects p on p.id = pa.project_id
      where pa.asset_id = a.id and p.deleted_at is null and scene_private.is_member(actor,p.studio_id))
    or (exists(select 1 from scene_private.members where user_id=actor)
      and exists(select 1 from scene_private.library_assets where asset_id=a.id))))
$$;

alter function public.scene_rpc(uuid, text, jsonb) rename to scene_rpc_before_published_assets;

create function public.scene_rpc(p_actor uuid, p_action text, p_data jsonb default '{}') returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  asset_row scene_private.assets;
  pub scene_private.published_assets;
begin
  if p_action in ('assets.publish', 'assets.unpublish') then
    if p_actor is null then raise exception 'UNAUTHENTICATED'; end if;
    select * into asset_row from scene_private.assets where id = (p_data->>'assetId')::uuid;
    -- 只有物主能决定自己的东西要不要进公共目录；别人看不到它也就无从发布。
    if not found or asset_row.owner_id is distinct from p_actor then raise exception 'ASSET_NOT_FOUND'; end if;

    if p_action = 'assets.publish' then
      -- 只有 3D 物料进公共目录：平面图与参考图不是可摆放的物料。
      if asset_row.format is distinct from 'glb' then raise exception 'ASSET_NOT_PUBLISHABLE'; end if;
      insert into scene_private.published_assets(asset_id, published_by, catalog)
        values (asset_row.id, p_actor, coalesce(nullif(p_data->>'catalog',''), 'scendance-generated'))
        on conflict (asset_id) do update set published_at = clock_timestamp()
        returning * into pub;
      return jsonb_build_object('assetId', pub.asset_id, 'publishedAt', pub.published_at, 'catalog', pub.catalog);
    end if;

    delete from scene_private.published_assets where asset_id = asset_row.id returning * into pub;
    return jsonb_build_object('assetId', asset_row.id, 'published', pub.asset_id is not null);
  elsif p_action = 'assets.list' then
    -- 本人的物料 + 公共目录里的物料。published_at 让前端能标出「公共物料」。
    return coalesce((select jsonb_agg(to_jsonb(x) - 'storage_path') from (
      select a.*,
        (select p.published_at from scene_private.published_assets p where p.asset_id = a.id) as published_at
      from scene_private.assets a
      where a.owner_id = p_actor
        or (exists(select 1 from scene_private.members where user_id = p_actor)
          and exists(select 1 from scene_private.published_assets p where p.asset_id = a.id))
      order by a.created_at desc limit 100) x),'[]');
  end if;

  return public.scene_rpc_before_published_assets(p_actor, p_action, p_data);
end $$;

revoke all on function public.scene_rpc(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.scene_rpc(uuid, text, jsonb) to service_role;
