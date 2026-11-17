-- C1 账本闭合：终态请求必须结算，预留额度必须释放。
--
-- 现状（20261002060307_scene_jobs.sql 起）：
--   * requests.actual_cents 只有建表声明，全库没有任何一处写入；
--   * budgets.committed_cents 只在创建请求时 +reserved，完成/失败/unknown 都不释放。
-- 后果：committed_cents 无界累加，永远对不上 actual_cents；一旦该 kind 设了 limit_cents
-- （历史默认 15000、预留 100），就会在 150 次后永久 BUDGET_EXCEEDED，而实际可能一分都没花。
-- 生产当前 limit_cents 为 NULL（不限量），所以眼下不报错，只是账永远不闭合。
-- worker 装不装都一样，因为结算根本不存在。
--
-- 本迁移只做一件事：在状态机落终态的同一个事务里结算一次，且天然幂等。
--   ready / complete                  -> reserved_cents
--   provider_job_id is not null       -> reserved_cents（确实派发过，vendor 可能已计费）
--   error_code LIKE 'SUBMIT_RESULT_UNKNOWN%' -> reserved_cents（响应丢失，保守记账）
--   failed / rejected（从未派发）      -> 0
--   unknown                           -> 不动（仍可能已计费；转 failed 后再结算）
-- committed_cents 无论成功失败都释放，它表示“未决预留”，不表示累计消费。
--
-- 口径：actual_cents 是幕景内部账本（分），不是 Aholo 积分。
-- Aholo 真实消耗看 generation_jobs.provider_usage / requests.provider_usage。

create or replace function public.scene_settle_requests() returns bigint
language plpgsql security definer set search_path = '' as $$
declare v_gen bigint := 0; v_text bigint := 0; v_held bigint;
begin
  -- text 链没有 worker，Edge 崩溃后请求会永远停在 reserved；AI_BUSY 只挡 2 分钟，
  -- 之后能继续新建，泄漏无上限。超过 60 分钟仍在 reserved 的按失败结算。
  update scene_private.requests
     set state = 'failed'
   where kind = 'text' and state = 'reserved'
     and created_at < clock_timestamp() - interval '60 minutes';

  -- generation：只结算已落终态、且从未结算过的行。
  with closed as (
    update scene_private.requests r
       set actual_cents = case
             when r.state = 'complete' then r.reserved_cents
             when g.state = 'ready' then r.reserved_cents
             when g.provider_job_id is not null then r.reserved_cents
             when coalesce(g.error_code, '') like 'SUBMIT_RESULT_UNKNOWN%' then r.reserved_cents
             else 0 end
      from scene_private.generation_jobs g
     where g.id = r.id
       and r.kind = 'generation'
       and r.actual_cents is null
       and r.state in ('complete', 'failed')
    returning r.reserved_cents
  )
  select coalesce(sum(reserved_cents), 0) into v_gen from closed;

  -- text：complete 记预留额，failed 记 0；unknown 超过 24 小时仍未核对，按上限保守记账并释放，
  -- 行本身保留为审计记录（state 不改）。
  with closed as (
    update scene_private.requests r
       set actual_cents = case when r.state in ('complete', 'unknown') then r.reserved_cents else 0 end
     where r.kind = 'text'
       and r.actual_cents is null
       and (r.state in ('complete', 'failed')
            or (r.state = 'unknown' and r.created_at < clock_timestamp() - interval '24 hours'))
    returning r.reserved_cents
  )
  select coalesce(sum(reserved_cents), 0) into v_text from closed;

  if v_gen > 0 then
    select committed_cents into v_held from scene_private.budgets where kind = 'generation' for update;
    if coalesce(v_held, 0) < v_gen then
      raise warning 'LEDGER_DRIFT generation: committed % < releasing %', v_held, v_gen;
    end if;
    update scene_private.budgets set committed_cents = greatest(0, committed_cents - v_gen)
     where kind = 'generation';
  end if;
  if v_text > 0 then
    select committed_cents into v_held from scene_private.budgets where kind = 'text' for update;
    if coalesce(v_held, 0) < v_text then
      raise warning 'LEDGER_DRIFT text: committed % < releasing %', v_held, v_text;
    end if;
    update scene_private.budgets set committed_cents = greatest(0, committed_cents - v_text)
     where kind = 'text';
  end if;
  return v_gen + v_text;
end $$;

comment on function public.scene_settle_requests() is
  'Settle terminal scene_private.requests exactly once: fill actual_cents and release the matching budgets.committed_cents hold. Idempotent.';

-- 轮询会反复跑这两条扫描，必须有部分索引，否则每次 claim 都是全表扫。
create index if not exists requests_unsettled_idx
  on scene_private.requests(kind) where actual_cents is null;

-- 无参、会改全库账本，绝不能暴露给登录用户（PostgREST 默认会把 public 函数挂成 RPC）。
revoke all on function public.scene_settle_requests() from public, anon, authenticated;
grant execute on function public.scene_settle_requests() to service_role;

-- 在 job_rpc 外面套一层，只负责“落终态后结算”，不改任何状态机语义。
alter function public.job_rpc(uuid, text, jsonb) rename to job_rpc_generation_v3;

create function public.job_rpc(p_actor uuid, p_action text, p_data jsonb default '{}') returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare result jsonb;
begin
  result := public.job_rpc_generation_v3(p_actor, p_action, p_data);
  -- 只有可能产生终态（或触发 submit_unknown 清扫）的动作才扫账，轮询路径不额外付代价。
  if p_action in ('jobs.complete', 'jobs.update', 'jobs.resolve_unknown', 'jobs.claim', 'requests.finish', 'reserve') then
    perform public.scene_settle_requests();
  end if;
  return result;
end $$;

revoke all on function public.job_rpc(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.job_rpc(uuid, text, jsonb) to service_role;
