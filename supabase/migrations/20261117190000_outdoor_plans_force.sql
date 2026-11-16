-- 2026-11-17 冲突「用我这版」：给 outdoor-plan.put 加 force（叠加迁移，不改历史迁移）。
--
-- 为什么单独一条：
--  · `20261117180000_outdoor_plans.sql` 可能已经在某台环境上应用过；改它需要回滚重建，
--    所以把「force 覆盖」作为新的一层叠上去，旧的 `scene_rpc` 改名保留为下游。
--  · 行为差异只有一处：`force:true` 时跳过 `baseRevision` 比对直接覆盖，`revision` 仍 +1。
--    不带 `force` 的调用与之前完全一致（版本不匹配 → 返回 conflict、不落库）。
alter function public.scene_rpc(uuid,text,jsonb) rename to scene_rpc_before_outdoor_force;

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
    -- force 只由用户点「用我这版」触发：跳过版本比对，直接覆盖，revision 仍 +1。
    if row_rec.revision <> base and not coalesce((p_data->>'force')::boolean, false) then
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

  return public.scene_rpc_before_outdoor_force(p_actor, p_action, p_data);
end $$;

revoke all on function public.scene_rpc(uuid,text,jsonb) from public, anon, authenticated;
grant execute on function public.scene_rpc(uuid,text,jsonb) to service_role;
