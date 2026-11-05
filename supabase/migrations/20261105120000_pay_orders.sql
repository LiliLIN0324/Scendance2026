-- 付费与额度（PAYATHON 2026 · Vibe Pay 验证用）
-- 金额一律整数分；一次重建任务 = 1 次额度，与照片张数无关。
-- 只由 Edge Function（service_role）读写：开启 RLS 且不建任何策略。

create table if not exists public.pay_skus (
  code text primary key,
  title text not null,
  times integer not null check (times > 0),
  amount_cents integer not null check (amount_cents > 0),
  active boolean not null default true,
  sort integer not null default 0,
  created_at timestamptz not null default now()
);

insert into public.pay_skus (code, title, times, amount_cents, sort) values
  ('scan_1',  '单次重建',   1,  490, 1),
  ('scan_3',  '3 次重建',   3,  990, 2),
  ('scan_10', '10 次重建', 10, 2990, 3)
on conflict (code) do nothing;

create table if not exists public.pay_orders (
  id uuid primary key default gen_random_uuid(),
  -- owner_key 是额度归属的唯一查询键：网页登录用户用 "user:<uuid>"，
  -- 小程序匿名设备用 "anon:<device-hash>"。
  owner_key text not null,
  user_id uuid references auth.users(id) on delete set null,
  anon_id text,
  sku text not null references public.pay_skus(code),
  times_purchased integer not null check (times_purchased > 0),
  times_used integer not null default 0 check (times_used >= 0),
  amount_cents integer not null check (amount_cents > 0),
  status text not null default 'pending'
    check (status in ('pending', 'paid', 'cancelled', 'refunded', 'expired')),
  provider text not null default 'alipay',
  provider_order_id text,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  expires_at timestamptz,
  unique (idempotency_key),
  unique (provider, provider_order_id)
);

create index if not exists pay_orders_owner_idx on public.pay_orders (owner_key, status, expires_at);
create index if not exists pay_orders_status_idx on public.pay_orders (status, created_at);

-- 扣次流水：一行对应一次重建任务。idempotency_key 由「owner + jobId + attempt」生成，
-- 重复提交只会命中同一行，不会重复扣次。
create table if not exists public.scan_consumptions (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.pay_orders(id) on delete cascade,
  owner_key text not null,
  job_id text not null,
  idempotency_key text not null unique,
  times integer not null default 1 check (times > 0),
  status text not null default 'reserved'
    check (status in ('reserved', 'committed', 'released')),
  created_at timestamptz not null default now(),
  released_at timestamptz
);

create index if not exists scan_consumptions_owner_idx on public.scan_consumptions (owner_key, created_at);

-- 支付回调事件表：回调可能重复投递，靠 event_id 去重。
create table if not exists public.pay_events (
  id bigserial primary key,
  event_id text not null unique,
  provider text not null,
  payload jsonb not null,
  received_at timestamptz not null default now()
);

alter table public.pay_skus enable row level security;
alter table public.pay_orders enable row level security;
alter table public.scan_consumptions enable row level security;
alter table public.pay_events enable row level security;

revoke all on public.pay_skus from anon, authenticated;
revoke all on public.pay_orders from anon, authenticated;
revoke all on public.scan_consumptions from anon, authenticated;
revoke all on public.pay_events from anon, authenticated;

-- 预扣：原子地选一张仍有余额的订单并写流水。
-- 幂等：同一 idempotency_key 直接返回既有状态，不重复扣。
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

-- 失败/超时返还：退回次数，不退款。幂等。
create or replace function public.pay_release(p_idem text) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.scan_consumptions;
  v_remaining integer;
begin
  select * into v_row from public.scan_consumptions where idempotency_key = p_idem;
  if not found then
    raise exception 'CONSUMPTION_NOT_FOUND';
  end if;
  if v_row.status = 'released' then
    select (times_purchased - times_used) into v_remaining from public.pay_orders where id = v_row.order_id;
    return jsonb_build_object('orderId', v_row.order_id, 'state', 'released', 'remaining', coalesce(v_remaining, 0), 'idempotent', true);
  end if;

  update public.scan_consumptions
     set status = 'released', released_at = now()
   where id = v_row.id;

  update public.pay_orders
     set times_used = greatest(0, times_used - v_row.times)
   where id = v_row.order_id;

  select (times_purchased - times_used) into v_remaining from public.pay_orders where id = v_row.order_id;

  return jsonb_build_object('orderId', v_row.order_id, 'state', 'released', 'remaining', coalesce(v_remaining, 0), 'idempotent', false);
end;
$$;

-- 超时自动退：超过 p_minutes 仍未确认的预扣统一返还（供定时任务调用）。
create or replace function public.pay_release_stale(p_minutes integer default 30) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.scan_consumptions;
  v_count integer := 0;
begin
  for v_row in
    select * from public.scan_consumptions
     where status = 'reserved'
       and created_at < now() - make_interval(mins => p_minutes)
     for update
  loop
    update public.scan_consumptions set status = 'released', released_at = now() where id = v_row.id;
    update public.pay_orders set times_used = greatest(0, times_used - v_row.times) where id = v_row.order_id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.pay_reserve(text, text, text, integer) from public, anon, authenticated;
revoke all on function public.pay_release(text) from public, anon, authenticated;
revoke all on function public.pay_release_stale(integer) from public, anon, authenticated;
grant execute on function public.pay_reserve(text, text, text, integer) to service_role;
grant execute on function public.pay_release(text) to service_role;
grant execute on function public.pay_release_stale(integer) to service_role;
