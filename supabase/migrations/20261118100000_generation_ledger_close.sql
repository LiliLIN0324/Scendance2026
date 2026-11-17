-- C1 账本闭合：终态请求必须结算，预留额度必须释放。
--
-- 现状（20261002060307_scene_jobs.sql 起）：
--   * requests.actual_cents 只有建表声明，全库没有任何一处写入；
--   * budgets.committed_cents 只在创建请求时 +reserved，完成/失败/unknown 都不释放。
-- 后果不是“看不到金额”这么轻：每建一个任务就永久占掉 reserve 分，15000/100 = 150 次之后
-- 该 kind 永久 BUDGET_EXCEEDED，而实际可能一分都没花。worker 装不装都一样，因为结算根本不存在。
--
-- 本迁移只做一件事：在状态机落终态的同一个事务里结算一次，且天然幂等。
--   ready / complete                 -> actual_cents = reserved_cents（内部账本按预留上限记账）
--   failed / rejected                -> actual_cents = 0
--   failed 且 error_code LIKE 'SUBMIT_RESULT_UNKNOWN%' -> actual_cents = reserved_cents
--                                       （响应丢失可能已计费，保守按上限记账，不虚报 0）
--   unknown                          -> 不动（仍可能已计费；10 分钟清扫或人工 resolve 后转 failed，再结算）
-- committed_cents 无论成功失败都释放，它表示“未决预留”，不表示累计消费。
--
-- 口径要说清楚：actual_cents 是幕景内部账本（分），不是 Aholo 积分。
-- Aholo 真实消耗看 generation_jobs.provider_usage / requests.provider_usage。

create or replace function public.scene_settle_requests() returns integer
language plpgsql security invoker set search_path = '' as $$
declare v_gen integer := 0; v_text integer := 0;
begin
  -- generation：只结算已经落终态、且从未结算过的行。
  with closed as (
    update scene_private.requests r
       set actual_cents = case
             when r.state = 'complete' then r.reserved_cents
             when g.state = 'ready' then r.reserved_cents
             when coalesce(g.error_code, '') like 'SUBMIT_RESULT_UNKNOWN%' then r.reserved_cents
             else 0 end
      from scene_private.generation_jobs g
     where g.id = r.id
       and r.actual_cents is null
       and r.state in ('complete', 'failed')
    returning r.reserved_cents
  )
  select coalesce(sum(reserved_cents), 0) into v_gen from closed;

  -- text：Agent 提案链同一套预留模型，同样会泄漏。
  with closed as (
    update scene_private.requests r
       set actual_cents = case when r.state = 'complete' then r.reserved_cents else 0 end
     where r.kind = 'text'
       and r.actual_cents is null
       and r.state in ('complete', 'failed')
    returning r.reserved_cents
  )
  select coalesce(sum(reserved_cents), 0) into v_text from closed;

  if v_gen > 0 then
    update scene_private.budgets set committed_cents = greatest(0, committed_cents - v_gen)
     where kind = 'generation';
  end if;
  if v_text > 0 then
    update scene_private.budgets set committed_cents = greatest(0, committed_cents - v_text)
     where kind = 'text';
  end if;
  return v_gen + v_text;
end $$;

comment on function public.scene_settle_requests() is
  'Settle terminal scene_private.requests exactly once: fill actual_cents and release the matching budgets.committed_cents hold. Idempotent.';

-- 在 job_rpc 外面套一层，只负责“落终态后结算”，不改任何状态机语义。
alter function public.job_rpc(uuid, text, jsonb) rename to job_rpc_generation_v3;

create function public.job_rpc(p_actor uuid, p_action text, p_data jsonb default '{}') returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare result jsonb;
begin
  result := public.job_rpc_generation_v3(p_actor, p_action, p_data);
  -- 只有可能产生终态（或触发 submit_unknown 清扫）的动作才扫账，轮询路径不额外付代价。
  if p_action in ('jobs.complete', 'jobs.update', 'jobs.resolve_unknown', 'jobs.claim', 'requests.finish') then
    perform public.scene_settle_requests();
  end if;
  return result;
end $$;

revoke all on function public.job_rpc(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.job_rpc(uuid, text, jsonb) to service_role;

-- 一次性回填：把历史上已经完成/失败、却一直占着预留的请求结算掉。
select public.scene_settle_requests();
