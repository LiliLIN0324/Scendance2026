-- 官方通知（平台/运营广播）：与一对一私信（scene_private.member_messages）同套三件套——
-- list / unread / read，但受众是登录用户本人，不依赖工作室成员身份门禁。
--
-- 口径（草案，待 review；未部署到云端）：
--   · 通知由服务端/运营写入，客户端只读，不提供发送 RPC；
--   · 粒度：studio_id 为 null 表示全平台广播；否则只投该工作室成员；
--   · target_role 为 null 表示不限角色，否则只投 owner / editor；
--   · expires_at 为 null 表示长期有效；过期通知不进列表、不计未读；
--   · 已读回执按 (通知, 用户) 落一行，未读数 = 可见通知里没有回执的条数。
--
-- 回滚：drop table scene_private.official_notification_reads; drop table scene_private.official_notifications;
-- 把 scene_rpc 换回 20261120130000_studio_assets.sql 那一版。

create table if not exists scene_private.official_notifications (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('announcement', 'version', 'event', 'system')),
  title text not null check (length(title) between 1 and 120),
  body text not null check (length(body) between 1 and 4000),
  link text check (link is null or (link ~* '^https?://' and length(link) between 1 and 480)),
  studio_id uuid references scene_private.studios on delete cascade,
  target_role text check (target_role is null or target_role in ('owner', 'editor')),
  created_at timestamptz not null default now(),
  expires_at timestamptz
);
create index official_notifications_created_idx
  on scene_private.official_notifications (created_at desc);

create table if not exists scene_private.official_notification_reads (
  notification_id uuid not null references scene_private.official_notifications on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  read_at timestamptz not null default now(),
  primary key (notification_id, user_id)
);
create index official_notification_reads_user_idx
  on scene_private.official_notification_reads (user_id);

alter table scene_private.official_notifications enable row level security;
alter table scene_private.official_notification_reads enable row level security;
revoke all on table scene_private.official_notifications from public, anon, authenticated;
revoke all on table scene_private.official_notification_reads from public, anon, authenticated;
grant select, insert on scene_private.official_notifications to service_role;
grant select, insert on scene_private.official_notification_reads to service_role;

-- 可见性判定：未过期 + 广播范围匹配 + 角色匹配。list / unread / read 三处共用，避免口径漂移。
create or replace function scene_private.notice_visible(
  actor uuid, v_studio uuid, v_role text, v_expires timestamptz
) returns boolean
language sql stable set search_path = '' as $$
  select (v_expires is null or v_expires > now())
    and (v_studio is null or scene_private.is_member(actor, v_studio))
    and (v_role is null or exists(
      select 1 from scene_private.members m
      where m.user_id = actor
        and (v_studio is null or m.studio_id = v_studio)
        and m.role = v_role));
$$;

alter function public.scene_rpc(uuid, text, jsonb) rename to scene_rpc_before_official_notices;

create function public.scene_rpc(p_actor uuid, p_action text, p_data jsonb default '{}') returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  notice_row scene_private.official_notifications;
  v_notice uuid;
begin
  if p_action in ('official.notices.list', 'official.notices.unread', 'official.notices.read') then
    if p_actor is null then raise exception 'UNAUTHENTICATED'; end if;

    if p_action = 'official.notices.list' then
      return coalesce((select jsonb_agg(x order by x."createdAt" desc, x.id) from (
        select n.id, n.kind, n.title, n.body, n.link,
          n.created_at as "createdAt",
          (select r.read_at from scene_private.official_notification_reads r
            where r.notification_id = n.id and r.user_id = p_actor) as "readAt"
        from scene_private.official_notifications n
        where scene_private.notice_visible(p_actor, n.studio_id, n.target_role, n.expires_at)
        order by n.created_at desc, n.id desc
      ) x), '[]'::jsonb);
    end if;

    if p_action = 'official.notices.unread' then
      return jsonb_build_object('count', (
        select count(*) from scene_private.official_notifications n
        where scene_private.notice_visible(p_actor, n.studio_id, n.target_role, n.expires_at)
          and not exists(select 1 from scene_private.official_notification_reads r
            where r.notification_id = n.id and r.user_id = p_actor)
      ));
    end if;

    v_notice := (p_data->>'noticeId')::uuid;
    select * into notice_row from scene_private.official_notifications where id = v_notice;
    if not found or not scene_private.notice_visible(p_actor, notice_row.studio_id, notice_row.target_role, notice_row.expires_at) then
      raise exception 'NOTICE_NOT_FOUND';
    end if;
    insert into scene_private.official_notification_reads(notification_id, user_id)
      values (v_notice, p_actor) on conflict do nothing;
    return jsonb_build_object('marked', 1);
  end if;

  return public.scene_rpc_before_official_notices(p_actor, p_action, p_data);
end $$;

revoke all on function public.scene_rpc(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.scene_rpc(uuid, text, jsonb) to service_role;
