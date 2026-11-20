-- 团队素材库（L2）：同室成员把自己的 3D 物料提交进工作室，owner 审核通过后同室全员可取用。
--
-- 三库分离口径（见权限方案 §3.4）：
--   · 个人库  assets.owner_id = me（L1）
--   · 团队库  studio_assets 行，status='approved'（L2）
--   · 公共目录 published_assets / library_assets（L3，注册用户可见）
-- 跨库流动走「提交—审核」：pending 不外泄，只有 approved 进 can_use_asset 与团队列表。
--
-- 回滚：drop table scene_private.studio_assets；把 scene_rpc / can_use_asset 换回
-- 20261119160000_published_assets_publish_flag.sql 那一版。

create table if not exists scene_private.studio_assets (
  studio_id uuid not null references scene_private.studios on delete cascade,
  asset_id uuid not null references scene_private.assets(id) on delete cascade,
  submitted_by uuid not null references auth.users on delete cascade,
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewer uuid references auth.users on delete set null,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  primary key (studio_id, asset_id)
);
create index if not exists studio_assets_studio_status_idx
  on scene_private.studio_assets (studio_id, status);

alter table scene_private.studio_assets enable row level security;
revoke all on table scene_private.studio_assets from public, anon, authenticated;
grant select, insert, update on scene_private.studio_assets to service_role;

-- 取用授权：在公开目录四分支之外，补「同室已审核团队库件」分支。
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
      and exists(select 1 from scene_private.library_assets where asset_id=a.id))
    or exists(select 1 from scene_private.studio_assets sa
      where sa.asset_id = a.id and sa.status = 'approved'
        and scene_private.is_member(actor, sa.studio_id))))
$$;

alter function public.scene_rpc(uuid, text, jsonb) rename to scene_rpc_before_studio_assets;

create function public.scene_rpc(p_actor uuid, p_action text, p_data jsonb default '{}') returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  asset_row scene_private.assets;
  sa_row scene_private.studio_assets;
  v_studio uuid;
  v_decision text;
begin
  if p_action in ('assets.team.submit', 'assets.team.review', 'assets.team.list') then
    if p_actor is null then raise exception 'UNAUTHENTICATED'; end if;

    if p_action = 'assets.team.list' then
      -- 本人所在工作室的团队件：已审核的全员可见；待审/被拒只看自己提交的那条。
      return coalesce((select jsonb_agg(to_jsonb(x) - 'storage_path') from (
        select a.*, ta.studio_id as team_studio_id, ta.status, ta.submitted_at, ta.reviewed_at
        from scene_private.studio_assets ta
        join scene_private.assets a on a.id = ta.asset_id
        where scene_private.is_member(p_actor, ta.studio_id)
          and (ta.status = 'approved' or ta.submitted_by = p_actor)
        order by ta.submitted_at desc limit 100) x), '[]'::jsonb);
    end if;

    v_studio := (p_data->>'studioId')::uuid;
    if p_action = 'assets.team.submit' then
      select * into asset_row from scene_private.assets where id = (p_data->>'assetId')::uuid;
      -- 只能提交自己的私有件；别人看不到它，也就无从抬进团队库。
      if not found or asset_row.owner_id is distinct from p_actor then raise exception 'ASSET_NOT_FOUND'; end if;
      if asset_row.format is distinct from 'glb' then raise exception 'ASSET_NOT_PUBLISHABLE'; end if;
      if not scene_private.is_member(p_actor, v_studio) then raise exception 'FORBIDDEN'; end if;

      insert into scene_private.studio_assets(studio_id, asset_id, submitted_by, status)
      values (v_studio, asset_row.id, p_actor, 'pending')
      on conflict (studio_id, asset_id) do update
        set submitted_by = p_actor, status = 'pending', submitted_at = clock_timestamp(),
            reviewed_at = null, reviewer = null
        where scene_private.studio_assets.status = 'rejected';

      select * into sa_row from scene_private.studio_assets where studio_id = v_studio and asset_id = asset_row.id;
      return jsonb_build_object('assetId', asset_row.id, 'studioId', v_studio, 'status', sa_row.status);
    end if;

    -- 审核：一期由工作室 owner 代管未来 admin 的库管理职责。
    if not exists(select 1 from scene_private.members
      where studio_id = v_studio and user_id = p_actor and role = 'owner') then
      raise exception 'FORBIDDEN';
    end if;
    select * into sa_row from scene_private.studio_assets
      where studio_id = v_studio and asset_id = (p_data->>'assetId')::uuid for update;
    if not found then raise exception 'ASSET_NOT_FOUND'; end if;

    v_decision := p_data->>'decision';
    if v_decision = 'approve' then
      update scene_private.studio_assets set status = 'approved', reviewed_at = clock_timestamp(), reviewer = p_actor
        where studio_id = v_studio and asset_id = sa_row.asset_id returning * into sa_row;
    elsif v_decision = 'reject' then
      update scene_private.studio_assets set status = 'rejected', reviewed_at = clock_timestamp(), reviewer = p_actor
        where studio_id = v_studio and asset_id = sa_row.asset_id returning * into sa_row;
    else
      raise exception 'INVALID_TEAM_DECISION';
    end if;
    return jsonb_build_object('assetId', sa_row.asset_id, 'studioId', v_studio, 'status', sa_row.status, 'reviewedAt', sa_row.reviewed_at);
  end if;

  -- assets.list 并入同室已审核团队件；published_at / team_studio_id 让前端分「我的 / 团队 / 公共」三段。
  if p_action = 'assets.list' then
    return coalesce((select jsonb_agg(to_jsonb(x) - 'storage_path') from (
      select a.*,
        (select p.published_at from scene_private.published_assets p where p.asset_id = a.id) as published_at,
        (select ts.studio_id from scene_private.studio_assets ts
          where ts.asset_id = a.id and ts.status = 'approved' limit 1) as team_studio_id
      from scene_private.assets a
      where a.owner_id = p_actor
        or (exists(select 1 from scene_private.members where user_id = p_actor)
          and exists(select 1 from scene_private.published_assets p where p.asset_id = a.id))
        or exists(select 1 from scene_private.studio_assets tsm
          where tsm.asset_id = a.id and tsm.status = 'approved'
            and scene_private.is_member(p_actor, tsm.studio_id))
      order by a.created_at desc limit 100) x), '[]'::jsonb);
  end if;

  return public.scene_rpc_before_studio_assets(p_actor, p_action, p_data);
end $$;

revoke all on function public.scene_rpc(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.scene_rpc(uuid, text, jsonb) to service_role;
