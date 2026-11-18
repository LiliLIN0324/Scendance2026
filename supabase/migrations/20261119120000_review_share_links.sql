-- 评审短链：/review/#review=<code>。
--
-- 长链把整份方案压进 #layout=，转发时又长又容易在聊天工具里被截断。
-- 这张表只存「短码 → 快照 + 规范长哈希」：评审页仍用长哈希算版本，
-- 所以同一条方案的长链和短链共享同一组钉、同一份回执。
--
-- 读取对匿名开放（甲方不需要登录）；写入要求登录（含匿名登录），
-- 并按用户做每小时配额，避免公开表变成任意写入点。表本身不对 anon 暴露。

create table if not exists public.review_share_links (
  code text primary key,
  long_hash text not null,
  payload jsonb not null,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '180 days',
  constraint review_share_links_code check (code ~ '^[a-z0-9]{12,24}$'),
  constraint review_share_links_hash check (long_hash ~ '^#layout=.+' and char_length(long_hash) <= 65536),
  constraint review_share_links_payload check (jsonb_typeof(payload) = 'object' and pg_column_size(payload) <= 524288)
);

create index if not exists review_share_links_created_idx
  on public.review_share_links (created_by, created_at desc);

alter table public.review_share_links enable row level security;
revoke all on table public.review_share_links from public, anon, authenticated;

create or replace function public.review_share_link_create(
  p_code text,
  p_long_hash text,
  p_payload jsonb
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recent integer;
begin
  if auth.uid() is null then
    raise exception 'review link requires sign-in';
  end if;
  if p_code is null or p_code !~ '^[a-z0-9]{12,24}$' then
    raise exception 'invalid review code';
  end if;
  if p_long_hash is null or p_long_hash !~ '^#layout=.+' or char_length(p_long_hash) > 65536 then
    raise exception 'invalid review hash';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' or pg_column_size(p_payload) > 524288 then
    raise exception 'invalid review payload';
  end if;

  select count(*) into v_recent
    from public.review_share_links
   where created_by = auth.uid()
     and created_at > now() - interval '1 hour';
  if v_recent >= 20 then
    raise exception 'review link rate limited';
  end if;

  insert into public.review_share_links (code, long_hash, payload)
  values (p_code, p_long_hash, p_payload)
  on conflict (code) do nothing;

  if not found then
    raise exception 'review code collision';
  end if;

  return p_code;
end;
$$;

create or replace function public.review_share_link_read(p_code text)
returns jsonb
language sql
security definer
stable
set search_path = public
as $$
  select jsonb_build_object('longHash', long_hash, 'payload', payload)
    from public.review_share_links
   where code = p_code
     and (expires_at is null or expires_at > now())
$$;

revoke all on function public.review_share_link_create(text, text, jsonb) from public;
revoke all on function public.review_share_link_read(text) from public;

grant execute on function public.review_share_link_create(text, text, jsonb) to authenticated;
grant execute on function public.review_share_link_read(text) to anon, authenticated;
