-- 2026-11-17 户外引导卡历史跟活动存后端（换设备 / 清缓存不丢）。
--
-- 只存"决策流水"：这张卡当时问了什么（title/notes）、你选了哪一项（decision）、
-- 当时给了哪些按钮（actions）与时间戳；不存规划本体，也不改动任何规划口径。
-- 表放 scene_private，与其他业务表一致：经 service_role 调 RPC，客户端不能直连。
create table if not exists scene_private.outdoor_card_history (
  actor uuid not null references auth.users on delete cascade,
  project_id text not null check (length(project_id) between 1 and 200),
  entries jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (actor, project_id),
  constraint outdoor_card_history_entries_shape
    check (jsonb_typeof(entries) = 'array' and jsonb_array_length(entries) <= 200)
);
-- scene_rpc 是 security invoker，实际以 service_role 跑；新表必须显式授权（同其它迁移口径）。
grant select,insert,update,delete on scene_private.outdoor_card_history to service_role;

-- 顶层分发器接续现有链：历史动作在本层拦截，其余原样下放给改名前的旧顶层。
alter function public.scene_rpc(uuid,text,jsonb) rename to scene_rpc_before_card_history;

create function public.scene_rpc(p_actor uuid, p_action text, p_data jsonb default '{}') returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare entries jsonb; project text;
begin
  if p_action in ('outdoor-history.get', 'outdoor-history.put') then
    if p_actor is null then raise exception 'UNAUTHENTICATED'; end if;

    project := coalesce(p_data->>'projectId', '');
    if length(project) = 0 or length(project) > 200 then raise exception 'PROJECT_REQUIRED'; end if;

    if p_action = 'outdoor-history.get' then
      return coalesce((
        select h.entries from scene_private.outdoor_card_history h
         where h.actor = p_actor and h.project_id = project
      ), '[]'::jsonb);
    end if;

    entries := p_data->'entries';
    if jsonb_typeof(entries) is distinct from 'array' then raise exception 'INVALID_HISTORY'; end if;
    if jsonb_array_length(entries) > 200 then raise exception 'HISTORY_TOO_LARGE'; end if;
    -- 最小把门：每条至少要有数字 at 与字符串 title；其余字段由客户端负责。
    if exists (
      select 1 from jsonb_array_elements(entries) e
       where jsonb_typeof(e->'at') is distinct from 'number'
          or jsonb_typeof(e->'title') is distinct from 'string'
    ) then
      raise exception 'INVALID_HISTORY_ENTRY';
    end if;

    insert into scene_private.outdoor_card_history(actor, project_id, entries, updated_at)
    values (p_actor, project, entries, clock_timestamp())
    on conflict (actor, project_id) do update set entries = excluded.entries, updated_at = clock_timestamp();
    return entries;
  end if;

  return public.scene_rpc_before_card_history(p_actor, p_action, p_data);
end $$;

revoke all on function public.scene_rpc(uuid,text,jsonb) from public, anon, authenticated;
grant execute on function public.scene_rpc(uuid,text,jsonb) to service_role;
