-- 修正 assets.unpublish 的返回值：撤下之后还报 published=true 是在说假话。
--
-- 20261119150000 里这一行写的是
--   delete ... returning * into pub;  return jsonb_build_object('assetId', asset_row.id, 'published', pub.asset_id is not null);
-- delete 的 returning 把被删的那行填进 pub，所以 pub.asset_id 一定非空，
-- 于是「撤下成功」也回 published=true。库里状态是对的（行已删），但返回体在撒谎，
-- 以后接外部调用方会被带偏。
--
-- 这里把语义改成「撤下后这物料在不在公共目录里」，并让两个分支都带上
-- published / publishedAt，前端与外部调用方读同一个真源。
--
-- 回滚：把下面 create or replace function 换回 20261119150000 里那一版。

create or replace function public.scene_rpc(p_actor uuid, p_action text, p_data jsonb default '{}') returns jsonb
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
      return jsonb_build_object('assetId', pub.asset_id, 'published', true,
        'publishedAt', pub.published_at, 'catalog', pub.catalog);
    end if;

    delete from scene_private.published_assets where asset_id = asset_row.id returning * into pub;
    -- 撤下之后如实报「不在公共目录里」：看表里还有没有，而不是看刚删掉的那行。
    return jsonb_build_object('assetId', asset_row.id,
      'published', exists(select 1 from scene_private.published_assets p where p.asset_id = asset_row.id),
      'publishedAt', null);
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
