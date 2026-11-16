-- 2026-11-17 户外活动本体入库（换设备继续编辑整个活动）。
--
-- 口径：
--  · 一行 = 一个活动；`activity_id` 由后端发号（换设备靠它找回，不依赖本机 id）；
--  · `local_activity_id` 只用于把本机草稿接到同一行，避免同一活动重复发号；
--  · `revision` 单调递增；写入必须带 `baseRevision`，不匹配就返回冲突、不落库——
--    两台设备先后保存时不会静默覆盖对方的编辑。
create table if not exists scene_private.outdoor_plans (
  actor uuid not null references auth.users on delete cascade,
  activity_id uuid not null default gen_random_uuid(),
  local_activity_id text check (local_activity_id is null or length(local_activity_id) between 1 and 200),
  name text not null check (length(name) between 1 and 120),
  plan jsonb not null,
  revision bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (actor, activity_id)
);
create unique index if not exists outdoor_plans_actor_local_idx
  on scene_private.outdoor_plans (actor, local_activity_id)
  where local_activity_id is not null;
create index if not exists outdoor_plans_actor_updated_idx
  on scene_private.outdoor_plans (actor, updated_at desc);
-- scene_rpc 是 security invoker，实际以 service_role 跑；新表必须显式授权。
grant select,insert,update,delete on scene_private.outdoor_plans to service_role;

alter function public.scene_rpc(uuid,text,jsonb) rename to scene_rpc_before_outdoor_plans;

create function public.scene_rpc(p_actor uuid, p_action text, p_data jsonb default '{}') returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare row_rec scene_private.outdoor_plans; new_id uuid; base bigint; target uuid;
begin
  if p_action in ('outdoor-plan.list', 'outdoor-plan.get', 'outdoor-plan.put') then
    if p_actor is null then raise exception 'UNAUTHENTICATED'; end if;

    if p_action = 'outdoor-plan.list' then
      return coalesce((
        select jsonb_agg(jsonb_build_object(
          'activityId', p.activity_id,
          'name', p.name,
          'revision', p.revision,
          'updatedAt', p.updated_at,
          'localActivityId', p.local_activity_id
        ) order by p.updated_at desc)
        from scene_private.outdoor_plans p where p.actor = p_actor
      ), '[]'::jsonb);
    end if;

    if p_action = 'outdoor-plan.get' then
      target := (p_data->>'activityId')::uuid;
      select * into row_rec from scene_private.outdoor_plans
       where actor = p_actor and activity_id = target;
      if not found then
        return jsonb_build_object('found', false);
      end if;
      return jsonb_build_object(
        'found', true, 'activityId', row_rec.activity_id, 'name', row_rec.name,
        'revision', row_rec.revision, 'plan', row_rec.plan, 'updatedAt', row_rec.updated_at
      );
    end if;

    -- put：新建（无 activityId）或按 baseRevision 做乐观并发更新。
    if p_data->>'name' is null or length(p_data->>'name') = 0 then raise exception 'NAME_REQUIRED'; end if;
    if jsonb_typeof(p_data->'plan') is distinct from 'object' then raise exception 'INVALID_PLAN'; end if;

    if p_data->>'activityId' is null or p_data->>'activityId' = '' then
      insert into scene_private.outdoor_plans(actor, local_activity_id, name, plan)
      values (p_actor, nullif(p_data->>'localActivityId',''), p_data->>'name', p_data->'plan')
      returning activity_id, revision into new_id, base;
      return jsonb_build_object('conflict', false, 'activityId', new_id, 'revision', base);
    end if;

    target := (p_data->>'activityId')::uuid;
    base := coalesce((p_data->>'baseRevision')::bigint, 0);
    select * into row_rec from scene_private.outdoor_plans
     where actor = p_actor and activity_id = target for update;
    if not found then raise exception 'PLAN_NOT_FOUND'; end if;
    if row_rec.revision <> base then
      -- 冲突不落库：把服务器当前版本回给客户端，由用户决定以哪一版为准。
      return jsonb_build_object(
        'conflict', true, 'activityId', row_rec.activity_id,
        'revision', row_rec.revision, 'updatedAt', row_rec.updated_at, 'name', row_rec.name
      );
    end if;

    update scene_private.outdoor_plans
       set plan = p_data->'plan',
           name = p_data->>'name',
           local_activity_id = coalesce(nullif(p_data->>'localActivityId',''), local_activity_id),
           revision = revision + 1,
           updated_at = clock_timestamp()
     where actor = p_actor and activity_id = target
     returning revision into base;
    return jsonb_build_object('conflict', false, 'activityId', target, 'revision', base);
  end if;

  return public.scene_rpc_before_outdoor_plans(p_actor, p_action, p_data);
end $$;

revoke all on function public.scene_rpc(uuid,text,jsonb) from public, anon, authenticated;
grant execute on function public.scene_rpc(uuid,text,jsonb) to service_role;
