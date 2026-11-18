-- G4：评审钉跨设备持久化。
-- 链接本身仍带方案快照（#layout=），这里只存「哪份快照上的哪颗钉」。
-- 匿名评审者通过 RPC 读写；表本身不对 anon 暴露，避免任意枚举。

create table if not exists public.review_share_pins (
  id text primary key,
  share_key text not null,
  floor_id text not null default '',
  body text not null,
  item_id text,
  x double precision not null,
  y double precision not null,
  z double precision not null,
  pin_offset jsonb,
  camera jsonb not null,
  status text not null default 'open',
  author text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint review_share_pins_key_len check (char_length(share_key) between 8 and 120),
  constraint review_share_pins_body_len check (char_length(body) between 1 and 80),
  constraint review_share_pins_status check (status in ('open', 'resolved'))
);

create index if not exists review_share_pins_key_created_idx
  on public.review_share_pins (share_key, created_at);

alter table public.review_share_pins enable row level security;
revoke all on table public.review_share_pins from anon, authenticated;

create or replace function public.review_pins_list(p_share_key text)
returns setof public.review_share_pins
language sql
security definer
set search_path = public
as $$
  select *
  from public.review_share_pins
  where share_key = p_share_key
  order by created_at asc
  limit 200;
$$;

create or replace function public.review_pins_append(
  p_share_key text,
  p_id text,
  p_floor_id text,
  p_body text,
  p_item_id text,
  p_x double precision,
  p_y double precision,
  p_z double precision,
  p_offset jsonb,
  p_camera jsonb,
  p_author text default null
)
returns public.review_share_pins
language plpgsql
security definer
set search_path = public
as $$
declare
  row_out public.review_share_pins;
begin
  if char_length(coalesce(p_share_key, '')) < 8 or char_length(p_share_key) > 120 then
    raise exception 'invalid share key';
  end if;
  if char_length(coalesce(p_body, '')) < 1 or char_length(p_body) > 80 then
    raise exception 'invalid pin body';
  end if;
  if p_camera is null then
    raise exception 'missing camera';
  end if;

  insert into public.review_share_pins (
    id, share_key, floor_id, body, item_id, x, y, z, pin_offset, camera, status, author
  ) values (
    p_id, p_share_key, coalesce(p_floor_id, ''), p_body, p_item_id, p_x, p_y, p_z,
    p_offset, p_camera, 'open', nullif(btrim(coalesce(p_author, '')), '')
  )
  on conflict (id) do nothing
  returning * into row_out;

  if row_out.id is null then
    select * into row_out
    from public.review_share_pins
    where id = p_id and share_key = p_share_key;
  end if;

  return row_out;
end;
$$;

create or replace function public.review_pins_set_status(
  p_share_key text,
  p_id text,
  p_status text
)
returns public.review_share_pins
language plpgsql
security definer
set search_path = public
as $$
declare
  row_out public.review_share_pins;
begin
  if p_status not in ('open', 'resolved') then
    raise exception 'invalid pin status';
  end if;
  update public.review_share_pins
     set status = p_status, updated_at = now()
   where id = p_id and share_key = p_share_key
  returning * into row_out;
  return row_out;
end;
$$;

revoke all on function public.review_pins_list(text) from public;
revoke all on function public.review_pins_append(text, text, text, text, text, double precision, double precision, double precision, jsonb, jsonb, text) from public;
revoke all on function public.review_pins_set_status(text, text, text) from public;

grant execute on function public.review_pins_list(text) to anon, authenticated;
grant execute on function public.review_pins_append(text, text, text, text, text, double precision, double precision, double precision, jsonb, jsonb, text) to anon, authenticated;
grant execute on function public.review_pins_set_status(text, text, text) to anon, authenticated;
