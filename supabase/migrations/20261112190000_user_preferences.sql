-- 用户级界面偏好（长度单位、标注显隐）。工程底稿仍存米；偏好只驱动展示与导出读数。
-- 表放 scene_private，与其他业务表一致：经 service_role 调用 RPC，客户端不能直连。
create table if not exists scene_private.user_preferences (
  user_id uuid primary key references auth.users on delete cascade,
  prefs jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- 顶层分发器接续现有链：偏好动作在本层拦截，其余原样下放给改名前的旧顶层。
alter function public.scene_rpc(uuid,text,jsonb) rename to scene_rpc_before_preferences;

create function public.scene_rpc(p_actor uuid, p_action text, p_data jsonb default '{}') returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare prefs jsonb;
begin
  if p_action in ('preferences.get', 'preferences.put') then
    if p_actor is null then raise exception 'UNAUTHENTICATED'; end if;

    if p_action = 'preferences.get' then
      return coalesce((select p.prefs from scene_private.user_preferences p where p.user_id = p_actor), '{}'::jsonb);
    end if;

    -- put：只接受白名单键，其余忽略；不把任意 JSON 写进用户偏好。
    select p.prefs into prefs from scene_private.user_preferences p where p.user_id = p_actor;
    prefs := coalesce(prefs, '{}'::jsonb);

    if p_data ? 'unit' then
      if p_data->>'unit' not in ('m', 'ft') then raise exception 'INVALID_PREFERENCE_UNIT'; end if;
      prefs := jsonb_set(prefs, '{unit}', to_jsonb(p_data->>'unit'));
    end if;
    if p_data ? 'showMeasurements' then
      if jsonb_typeof(p_data->'showMeasurements') is distinct from 'boolean' then raise exception 'INVALID_PREFERENCE_VALUE'; end if;
      prefs := jsonb_set(prefs, '{showMeasurements}', p_data->'showMeasurements');
    end if;

    insert into scene_private.user_preferences(user_id, prefs, updated_at)
    values (p_actor, prefs, clock_timestamp())
    on conflict (user_id) do update set prefs = excluded.prefs, updated_at = clock_timestamp();
    return prefs;
  end if;

  return public.scene_rpc_before_preferences(p_actor, p_action, p_data);
end $$;

revoke all on function public.scene_rpc(uuid,text,jsonb) from public, anon, authenticated;
grant execute on function public.scene_rpc(uuid,text,jsonb) to service_role;
