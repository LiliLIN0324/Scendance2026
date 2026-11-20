-- 评审短链吊销闭环。
--
-- 上一版（20261119120000_review_share_links.sql）只能创建、读取，链接一旦发出
-- 就只能等 180 天过期；物主没法主动作废。本迁移：
--   1. 补 revoked_at 列（可空，旧行不受影响）；
--   2. read 过滤已吊销的短码（匿名评审者拿到的是「不存在/已失效」，不区分原因）；
--   3. 新增仅物主本人可调的 revoke RPC，重复吊销、非物主、未登录都拒绝。
--
-- 表本身仍不对 anon/authenticated 暴露；能力全部走 security definer 函数。

alter table public.review_share_links
  add column if not exists revoked_at timestamptz;

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
     and revoked_at is null
     and (expires_at is null or expires_at > now())
$$;

create or replace function public.review_share_link_revoke(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.review_share_links;
begin
  if auth.uid() is null then
    raise exception 'UNAUTHENTICATED';
  end if;
  if p_code is null or p_code !~ '^[a-z0-9]{12,24}$' then
    raise exception 'REVIEW_LINK_NOT_FOUND';
  end if;

  select * into v_row
    from public.review_share_links
   where code = p_code
   for update;

  if not found or v_row.revoked_at is not null then
    raise exception 'REVIEW_LINK_NOT_FOUND';
  end if;
  if v_row.created_by is distinct from auth.uid() then
    raise exception 'FORBIDDEN';
  end if;

  update public.review_share_links
     set revoked_at = coalesce(revoked_at, clock_timestamp())
   where code = p_code;

  return jsonb_build_object('code', p_code, 'revoked', true);
end;
$$;

revoke all on function public.review_share_link_revoke(text) from public;
grant execute on function public.review_share_link_revoke(text) to authenticated;
