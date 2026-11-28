-- 会员订阅（PAYATHON 2026 参赛用 · 订阅制收费）
--
-- 订阅与「按次重建」是两条履约路径：pay_orders.kind 区分，共用同一张订单表。
-- 金额一律整数分；成交金额由 pay_skus 表决定，前端只传 code，不采信前端金额。
-- 只由 Edge Function（service_role）读写：开启 RLS 且不建任何策略。
--
-- 幂等约定：
--   - pay_events.event_id 唯一，回调重复投递只履约一次；
--   - subscriptions 的 (provider, provider_order_id) 唯一，同一订单不会开两次；
--   - pay_fulfill_subscription 内层用行锁 + 存在性判断，重复调用安全。

-- ── SKU 表扩展：kind 区分「按次」与「订阅」 ──────────────────────────────
alter table public.pay_skus add column if not exists kind text not null default 'times';
alter table public.pay_skus add column if not exists plan_code text;
alter table public.pay_skus add column if not exists period_months integer;
alter table public.pay_skus add column if not exists seats integer;
alter table public.pay_skus add column if not exists entitlements jsonb;

update public.pay_skus set kind = 'times' where kind is null;

alter table public.pay_skus drop constraint if exists pay_skus_kind_check;
alter table public.pay_skus add constraint pay_skus_kind_check check (kind in ('times', 'subscription'));

-- 订阅档位：金额与权益一起 seed；前端只展示后端下发的这一份。
-- 专业版 ¥99/月、¥999/年；团队版 ¥399/月、¥3,999/年（3 席位）。
insert into public.pay_skus
  (code, title, times, amount_cents, sort, kind, plan_code, period_months, seats, entitlements)
values
  ('sub_pro_m', '专业版 · 按月', 1, 9900, 10, 'subscription', 'pro', 1, 1,
   '{"maxProjects":null,"exportResolution":"1080p","watermark":false,"whiteLabel":false,"inventoryExport":true,"sharedLibrary":false,"approvalTrail":false,"monthlyScanQuota":2,"extraSeatCents":0}'::jsonb),
  ('sub_pro_y', '专业版 · 按年', 1, 99900, 11, 'subscription', 'pro', 12, 1,
   '{"maxProjects":null,"exportResolution":"1080p","watermark":false,"whiteLabel":false,"inventoryExport":true,"sharedLibrary":false,"approvalTrail":false,"monthlyScanQuota":2,"extraSeatCents":0}'::jsonb),
  ('sub_team_m', '团队版 · 按月', 1, 39900, 12, 'subscription', 'team', 1, 3,
   '{"maxProjects":null,"exportResolution":"1080p","watermark":false,"whiteLabel":true,"inventoryExport":true,"sharedLibrary":true,"approvalTrail":true,"monthlyScanQuota":8,"extraSeatCents":9900}'::jsonb),
  ('sub_team_y', '团队版 · 按年', 1, 399900, 13, 'subscription', 'team', 12, 3,
   '{"maxProjects":null,"exportResolution":"1080p","watermark":false,"whiteLabel":true,"inventoryExport":true,"sharedLibrary":true,"approvalTrail":true,"monthlyScanQuota":8,"extraSeatCents":9900}'::jsonb)
on conflict (code) do nothing;

-- ── 订单表扩展：kind / plan_code / period_months ─────────────────────────
alter table public.pay_orders add column if not exists kind text not null default 'times';
alter table public.pay_orders add column if not exists plan_code text;
alter table public.pay_orders add column if not exists period_months integer;

-- 订阅订单没有「次数」，times_purchased 记 0；原约束是 > 0，必须放宽。
alter table public.pay_orders drop constraint if exists pay_orders_times_purchased_check;
alter table public.pay_orders add constraint pay_orders_times_purchased_check check (times_purchased >= 0);

alter table public.pay_orders drop constraint if exists pay_orders_kind_check;
alter table public.pay_orders add constraint pay_orders_kind_check check (kind in ('times', 'subscription'));

-- ── 订阅表 ──────────────────────────────────────────────────────────────
create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  owner_key text not null,
  user_id uuid references auth.users(id) on delete set null,
  plan_code text not null,
  seats integer not null default 1 check (seats > 0),
  period_start timestamptz not null,
  period_end timestamptz not null,
  status text not null default 'active'
    check (status in ('active', 'expired', 'canceled')),
  provider text not null default 'alipay',
  provider_order_id text,
  order_id uuid references public.pay_orders(id) on delete set null,
  entitlements jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (provider, provider_order_id)
);

create index if not exists subscriptions_owner_idx
  on public.subscriptions (owner_key, status, period_end desc);

alter table public.subscriptions enable row level security;
revoke all on public.subscriptions from anon, authenticated;

-- ── 预扣：只认「按次」订单 ──────────────────────────────────────────────
-- 订阅订单的 times_purchased = 0，本身就不会被选中；这里再加一道 kind 过滤，
-- 防止将来有人把订阅订单的次数改大后被当成额度池。
create or replace function public.pay_reserve(
  p_owner_key text,
  p_idem text,
  p_job_id text,
  p_times integer default 1
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing public.scan_consumptions;
  v_order public.pay_orders;
  v_remaining integer;
begin
  select * into v_existing from public.scan_consumptions where idempotency_key = p_idem;
  if found then
    select (times_purchased - times_used) into v_remaining
      from public.pay_orders where id = v_existing.order_id;
    return jsonb_build_object(
      'orderId', v_existing.order_id,
      'state', v_existing.status,
      'times', v_existing.times,
      'remaining', coalesce(v_remaining, 0),
      'idempotent', true
    );
  end if;

  select * into v_order
    from public.pay_orders
   where owner_key = p_owner_key
     and kind = 'times'
     and status = 'paid'
     and expires_at is not null
     and expires_at > now()
     and times_purchased - times_used >= p_times
   order by (times_purchased - times_used) desc, paid_at asc
   limit 1
   for update;

  if not found then
    raise exception 'INSUFFICIENT_CREDITS';
  end if;

  insert into public.scan_consumptions (order_id, owner_key, job_id, idempotency_key, times, status)
  values (v_order.id, p_owner_key, p_job_id, p_idem, p_times, 'reserved');

  update public.pay_orders
     set times_used = times_used + p_times
   where id = v_order.id;

  return jsonb_build_object(
    'orderId', v_order.id,
    'state', 'committed',
    'times', p_times,
    'remaining', v_order.times_purchased - v_order.times_used - p_times,
    'idempotent', false
  );
end;
$$;

-- ── 订阅履约：订单已支付 → 开订阅 ───────────────────────────────────────
-- 幂等：同一订单重复调用只会存在一行订阅（provider, provider_order_id 唯一）。
-- 提前续费时从原 period_end 往后接，不吃掉用户已买的时长。
create or replace function public.pay_fulfill_subscription(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.pay_orders;
  v_sku public.pay_skus;
  v_sub public.subscriptions;
  v_start timestamptz;
  v_end timestamptz;
begin
  select * into v_order from public.pay_orders where id = p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if v_order.kind <> 'subscription' then raise exception 'NOT_SUBSCRIPTION_ORDER'; end if;
  if v_order.status <> 'paid' then raise exception 'ORDER_NOT_PAID'; end if;

  select * into v_sub from public.subscriptions
   where provider = v_order.provider
     and provider_order_id = v_order.id::text;
  if found then
    return jsonb_build_object(
      'subscriptionId', v_sub.id,
      'planCode', v_sub.plan_code,
      'periodStart', v_sub.period_start,
      'periodEnd', v_sub.period_end,
      'idempotent', true
    );
  end if;

  select * into v_sku from public.pay_skus where code = v_order.sku;
  if not found then raise exception 'SKU_NOT_FOUND'; end if;

  select period_end into v_start
    from public.subscriptions
   where owner_key = v_order.owner_key
     and plan_code = v_order.plan_code
     and status = 'active'
     and period_end > now()
   order by period_end desc
   limit 1;
  if not found or v_start is null or v_start < now() then
    v_start := now();
  end if;
  v_end := v_start + make_interval(months => coalesce(v_order.period_months, v_sku.period_months, 1));

  insert into public.subscriptions
    (owner_key, user_id, plan_code, seats, period_start, period_end, status, provider, provider_order_id, order_id, entitlements)
  values
    (v_order.owner_key, v_order.user_id, v_order.plan_code, coalesce(v_sku.seats, 1),
     v_start, v_end, 'active', v_order.provider, v_order.id::text, v_order.id, coalesce(v_sku.entitlements, '{}'::jsonb))
  returning * into v_sub;

  return jsonb_build_object(
    'subscriptionId', v_sub.id,
    'planCode', v_sub.plan_code,
    'periodStart', v_sub.period_start,
    'periodEnd', v_sub.period_end,
    'idempotent', false
  );
end;
$$;

-- ── 权益查询：唯一的判定入口 ────────────────────────────────────────────
-- 没有有效订阅时返回免费版基线；UI 只读这个返回值，不自己判断 plan 字符串。
create or replace function public.pay_subscription_for(p_owner_key text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sub public.subscriptions;
begin
  select * into v_sub
    from public.subscriptions
   where owner_key = p_owner_key
     and status = 'active'
     and period_end > now()
   order by period_end desc
   limit 1;

  if not found then
    return jsonb_build_object(
      'planCode', 'free',
      'seats', 1,
      'periodStart', null,
      'periodEnd', null,
      'entitlements', '{"maxProjects":1,"exportResolution":"720p","watermark":true,"whiteLabel":false,"inventoryExport":false,"sharedLibrary":false,"approvalTrail":false,"monthlyScanQuota":1,"extraSeatCents":0}'::jsonb
    );
  end if;

  return jsonb_build_object(
    'planCode', v_sub.plan_code,
    'seats', v_sub.seats,
    'periodStart', v_sub.period_start,
    'periodEnd', v_sub.period_end,
    'entitlements', v_sub.entitlements
  );
end;
$$;

revoke all on function public.pay_fulfill_subscription(uuid) from public, anon, authenticated;
revoke all on function public.pay_subscription_for(text) from public, anon, authenticated;
grant execute on function public.pay_fulfill_subscription(uuid) to service_role;
grant execute on function public.pay_subscription_for(text) to service_role;
