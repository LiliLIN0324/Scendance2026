-- 生成活跃闸：全站限 1 → 按 owner_id 限 1。
--
-- 原口径（20261002060307_scene_jobs.sql）：部分唯一索引在 ((true)) 上建，活跃状态全表
-- 至多一行；内层状态机 job_rpc_generation_v1 下单时 exists(全站活跃) 抛 GENERATION_BUSY。
-- 后果不是「限 1」本身，而是一行卡住锁死全站：某个任务在 queued/submit_unknown 期间，
-- 平台上任何其他人（包括同一个 owner 的另一单）都被 429 挡下。
--
-- 本迁移收窄到「每人同时一个活跃生成」：
--   1. 索引按 owner_id 建部分唯一索引（同一 owner 活跃任务至多一行；不同 owner 互不影响）；
--   2. 状态机 BUSY 判据只查 owner_id=p_actor 的活跃行；
--
-- 不变的部分：
--   * budgets.committed_cents 仍是全局整池校验，不按人分账；
--   * jobs.claim 用 for update skip locked 串行领单，worker 消费节奏不变；
--   * submit_unknown 10 分钟宽限解围与 owner-scoped 的 resolve_unknown 不变；
--   * 幂等键 unique(owner_id,kind,request_key) 不变。
--
-- 唯一索引是兜底双保险：正常路径 RPC 先抛可读的 GENERATION_BUSY；索引只在并发直插时挡重。

drop index if exists scene_private.generation_single_active_idx;

create unique index if not exists generation_active_per_owner_idx
  on scene_private.generation_jobs(owner_id)
  where state in ('queued','submitting','submitted','processing','archiving','submit_unknown');

-- 幂等校验：已存在同名索引但定义不对时不能静默放过（重复执行迁移也要能判定）。
do $$
begin
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'scene_private'
      and indexname = 'generation_active_per_owner_idx'
      and indexdef like '%(owner_id)%'
      and indexdef like '%submit_unknown%'
  ) then
    raise exception 'PER_OWNER_INDEX_INVALID: generation_active_per_owner_idx missing or wrong definition';
  end if;
end $$;

-- 只收窄 BUSY 判据，不整体重写状态机：从库里取当前函数定义，替换全站活跃判据为同 owner 判据，
-- 其余分支（text 预留、幂等、领取、终态、added 校验）与既有 numeric 补丁原样保留。
do $$
declare
  definition text;
  old_guard text;
  new_guard text;
begin
  definition := pg_get_functiondef('public.job_rpc_generation_v1(uuid,text,jsonb)'::regprocedure);

  old_guard := 'exists(select 1 from scene_private.generation_jobs where state in ('
    || '''queued'',''submitting'',''submitted'',''processing'',''archiving'',''submit_unknown''))';
  new_guard := 'exists(select 1 from scene_private.generation_jobs where owner_id=p_actor and state in ('
    || '''queued'',''submitting'',''submitted'',''processing'',''archiving'',''submit_unknown''))';

  -- 迁移可重复执行：已经按 owner 收口就直接跳过。
  if strpos(definition, new_guard) > 0 then
    return;
  end if;

  if strpos(definition, old_guard) = 0 then
    raise exception 'BUSY_GUARD_NOT_FOUND: active-generation guard clause not present in job_rpc_generation_v1';
  end if;

  definition := replace(definition, old_guard, new_guard);
  execute definition;
end $$;
