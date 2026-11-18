-- 个人偏好补读数精度和建造画布吸附；团队默认放工作室，不塞进 /preferences。
--
-- 回滚：把 public.scene_rpc 删掉，再把 scene_rpc_before_settings_scopes 改回 scene_rpc，
-- 并 drop table scene_private.studio_settings。旧客户端只写 unit / showMeasurements 时，
-- 本层 jsonb_set 只动提交的键，已有的新键会留下来。

create table if not exists scene_private.studio_settings (
  studio_id uuid primary key references scene_private.studios on delete cascade,
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table scene_private.studio_settings enable row level security;
revoke all on table scene_private.studio_settings from public, anon, authenticated;
grant select, insert, update, delete on scene_private.studio_settings to service_role;
grant select, insert, update, delete on scene_private.user_preferences to service_role;

alter function public.scene_rpc(uuid, text, jsonb) rename to scene_rpc_before_settings_scopes;

create function public.scene_rpc(p_actor uuid, p_action text, p_data jsonb default '{}') returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  prefs jsonb;
  studio uuid;
  member_role text;
begin
  if p_action in ('preferences.get', 'preferences.put') then
    if p_actor is null then raise exception 'UNAUTHENTICATED'; end if;

    if p_action = 'preferences.get' then
      return coalesce((select p.prefs from scene_private.user_preferences p where p.user_id = p_actor), '{}'::jsonb);
    end if;

    select p.prefs into prefs from scene_private.user_preferences p where p.user_id = p_actor;
    prefs := coalesce(prefs, '{}'::jsonb);

    if p_data ? 'unit' then
      if p_data->>'unit' not in ('m', 'ft') then raise exception 'INVALID_PREFERENCE_VALUE'; end if;
      prefs := jsonb_set(prefs, '{unit}', to_jsonb(p_data->>'unit'));
    end if;
    if p_data ? 'showMeasurements' then
      if jsonb_typeof(p_data->'showMeasurements') is distinct from 'boolean' then raise exception 'INVALID_PREFERENCE_VALUE'; end if;
      prefs := jsonb_set(prefs, '{showMeasurements}', p_data->'showMeasurements');
    end if;
    if p_data ? 'lengthPrecisionM' then
      if (p_data->>'lengthPrecisionM') not in ('0.01', '0.1', '1') then raise exception 'INVALID_PREFERENCE_VALUE'; end if;
      prefs := jsonb_set(prefs, '{lengthPrecisionM}', to_jsonb((p_data->>'lengthPrecisionM')::numeric));
    end if;
    if p_data ? 'snapToGrid' then
      if jsonb_typeof(p_data->'snapToGrid') is distinct from 'boolean' then raise exception 'INVALID_PREFERENCE_VALUE'; end if;
      prefs := jsonb_set(prefs, '{snapToGrid}', p_data->'snapToGrid');
    end if;
    if p_data ? 'snapToWall' then
      if jsonb_typeof(p_data->'snapToWall') is distinct from 'boolean' then raise exception 'INVALID_PREFERENCE_VALUE'; end if;
      prefs := jsonb_set(prefs, '{snapToWall}', p_data->'snapToWall');
    end if;
    if p_data ? 'snapToItems' then
      if jsonb_typeof(p_data->'snapToItems') is distinct from 'boolean' then raise exception 'INVALID_PREFERENCE_VALUE'; end if;
      prefs := jsonb_set(prefs, '{snapToItems}', p_data->'snapToItems');
    end if;

    insert into scene_private.user_preferences(user_id, prefs, updated_at)
    values (p_actor, prefs, clock_timestamp())
    on conflict (user_id) do update set prefs = excluded.prefs, updated_at = clock_timestamp();
    return prefs;
  end if;

  if p_action in ('studio-settings.get', 'studio-settings.put') then
    if p_actor is null then raise exception 'UNAUTHENTICATED'; end if;
    studio := nullif(p_data->>'studioId', '')::uuid;
    if studio is null then raise exception 'STUDIO_NOT_FOUND'; end if;
    select m.role into member_role
      from scene_private.members m
      where m.studio_id = studio and m.user_id = p_actor;
    if member_role is null then raise exception 'STUDIO_NOT_FOUND'; end if;

    if p_action = 'studio-settings.get' then
      return coalesce((select s.settings from scene_private.studio_settings s where s.studio_id = studio), '{}'::jsonb);
    end if;

    if member_role is distinct from 'owner' then raise exception 'FORBIDDEN'; end if;

    select s.settings into prefs from scene_private.studio_settings s where s.studio_id = studio;
    prefs := coalesce(prefs, '{}'::jsonb);

    if p_data ? 'companyName' then
      if jsonb_typeof(p_data->'companyName') = 'null' or coalesce(p_data->>'companyName', '') = '' then
        prefs := prefs - 'companyName';
      elsif jsonb_typeof(p_data->'companyName') is distinct from 'string' or length(p_data->>'companyName') > 120 then
        raise exception 'INVALID_STUDIO_SETTING';
      else
        prefs := jsonb_set(prefs, '{companyName}', to_jsonb(p_data->>'companyName'));
      end if;
    end if;
    if p_data ? 'quoteContact' then
      if jsonb_typeof(p_data->'quoteContact') = 'null' or coalesce(p_data->>'quoteContact', '') = '' then
        prefs := prefs - 'quoteContact';
      elsif jsonb_typeof(p_data->'quoteContact') is distinct from 'string' or length(p_data->>'quoteContact') > 120 then
        raise exception 'INVALID_STUDIO_SETTING';
      else
        prefs := jsonb_set(prefs, '{quoteContact}', to_jsonb(p_data->>'quoteContact'));
      end if;
    end if;
    if p_data ? 'logoUrl' then
      if jsonb_typeof(p_data->'logoUrl') = 'null' or coalesce(p_data->>'logoUrl', '') = '' then
        prefs := prefs - 'logoUrl';
      elsif jsonb_typeof(p_data->'logoUrl') is distinct from 'string'
        or length(p_data->>'logoUrl') > 80000
        or (
          p_data->>'logoUrl' !~ '^data:image/(png|jpeg|webp);base64,[[:space:]A-Za-z0-9+/=]+$'
          and p_data->>'logoUrl' !~ '^https://[^[:space:]]{1,480}$'
        ) then
        raise exception 'INVALID_STUDIO_SETTING';
      else
        prefs := jsonb_set(prefs, '{logoUrl}', to_jsonb(p_data->>'logoUrl'));
      end if;
    end if;
    if p_data ? 'currency' then
      if jsonb_typeof(p_data->'currency') = 'null' then
        prefs := prefs - 'currency';
      elsif p_data->>'currency' not in ('CNY', 'USD', 'EUR', 'GBP', 'JPY') then
        raise exception 'INVALID_STUDIO_SETTING';
      else
        prefs := jsonb_set(prefs, '{currency}', to_jsonb(p_data->>'currency'));
      end if;
    end if;
    if p_data ? 'defaultUnit' then
      if jsonb_typeof(p_data->'defaultUnit') = 'null' then
        prefs := prefs - 'defaultUnit';
      elsif p_data->>'defaultUnit' not in ('m', 'ft') then
        raise exception 'INVALID_STUDIO_SETTING';
      else
        prefs := jsonb_set(prefs, '{defaultUnit}', to_jsonb(p_data->>'defaultUnit'));
      end if;
    end if;
    if p_data ? 'defaultAisleClearM' then
      if jsonb_typeof(p_data->'defaultAisleClearM') = 'null' then
        prefs := prefs - 'defaultAisleClearM';
      elsif jsonb_typeof(p_data->'defaultAisleClearM') is distinct from 'number'
        or (p_data->>'defaultAisleClearM')::numeric < 0.6
        or (p_data->>'defaultAisleClearM')::numeric > 12 then
        raise exception 'INVALID_STUDIO_SETTING';
      else
        prefs := jsonb_set(prefs, '{defaultAisleClearM}', p_data->'defaultAisleClearM');
      end if;
    end if;
    if p_data ? 'defaultBoothSpacingM' then
      if jsonb_typeof(p_data->'defaultBoothSpacingM') = 'null' then
        prefs := prefs - 'defaultBoothSpacingM';
      elsif jsonb_typeof(p_data->'defaultBoothSpacingM') is distinct from 'number'
        or (p_data->>'defaultBoothSpacingM')::numeric < 0
        or (p_data->>'defaultBoothSpacingM')::numeric > 5 then
        raise exception 'INVALID_STUDIO_SETTING';
      else
        prefs := jsonb_set(prefs, '{defaultBoothSpacingM}', p_data->'defaultBoothSpacingM');
      end if;
    end if;

    insert into scene_private.studio_settings(studio_id, settings, updated_at)
    values (studio, prefs, clock_timestamp())
    on conflict (studio_id) do update set settings = excluded.settings, updated_at = clock_timestamp();
    return prefs;
  end if;

  return public.scene_rpc_before_settings_scopes(p_actor, p_action, p_data);
end $$;

revoke all on function public.scene_rpc(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.scene_rpc(uuid, text, jsonb) to service_role;
