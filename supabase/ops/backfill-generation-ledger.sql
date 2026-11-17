-- 一次性回填：把历史上已经完成/失败、却一直占着预留的请求结算掉。
-- 不放进迁移，避免在迁移事务里长时间持有行锁、阻塞 worker 的 jobs.update/complete。
--
-- 执行：Supabase Dashboard → SQL Editor，整段粘贴。
-- 幂等：可以反复执行；第二次返回 0。
-- 大表提示：若 scene_private.requests 很大，先 `set statement_timeout='5min'` 分次跑，
--           或按 created_at 范围切开（本文件末尾给了切片写法）。
-- 回滚：结算不可回滚（actual_cents 一旦写入就会作为审计记录保留）；执行前先备份这两张表。

select public.scene_settle_requests() as released_cents;

-- 核对：执行后应满足
--   * 不再存在 state in ('complete','failed') and actual_cents is null 的行（除非命中 failed 的 last batch）
--   * budgets.committed_cents = 当前仍未决的 reserved/unknown 预留之和
select
  (select count(*) from scene_private.requests where actual_cents is null and state in ('complete','failed')) as unsettled,
  (select committed_cents from scene_private.budgets where kind = 'generation') as generation_committed,
  (select committed_cents from scene_private.budgets where kind = 'text') as text_committed;

-- 大表切片写法（按需）：
-- do $$ begin
--   loop
--     with closed as (
--       update scene_private.requests r set actual_cents = 0
--        where r.id in (select id from scene_private.requests
--                        where actual_cents is null and state in ('complete','failed')
--                        order by created_at limit 2000)
--       returning 1) select count(*) into ...;
--     exit when not found;
--   end loop;
-- end $$;
-- 注意：切片写法只是示例，真正执行请直接用上面的 scene_settle_requests()，它带有正确的记账分支。
