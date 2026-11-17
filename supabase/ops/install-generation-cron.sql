-- 生成任务的唯一推进器：每分钟调用一次 generation-worker。
-- 不是自动迁移，必须人工执行（Supabase Dashboard → SQL Editor，或 supabase db execute）。
--
-- 前置（缺一不可，脚本会自己挡住）：
--   1) 库里已有 public.scene_settle_requests() 与 job_rpc 包装层（迁移 20261118100000_generation_ledger_close.sql）；
--      否则 worker 跑完也只是把任务推到 ready，账本仍然不闭合。
--   2) Vault 里有且各只有一条：
--        scene_project_url  = https://<project-ref>.supabase.co
--        scene_worker_secret = 与 Edge Function 的 GENERATION_WORKER_SECRET 完全一致
--   3) 扩展 pg_cron、pg_net 可用（Supabase 自带；本脚本 create extension if not exists）。
--
-- 幂等：重复执行会先 unschedule 同名任务再重建，不会堆出第二条轮询。
-- 回滚：select cron.unschedule('scene-generation-poll');
--
-- 为什么每分钟一次 + 120s 超时是安全的：
--   jobs.claim 用 `for update skip locked` 抢单，并给中签行写 4 分钟的 worker_until；
--   重叠触发时后来的调用拿不到同一行，不会重复提交给 Aholo（重复提交=重复计费）。

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

do $$ begin
  if (select count(*) from vault.decrypted_secrets where name in ('scene_project_url','scene_worker_secret')) <> 2 then
    raise exception 'Configure exactly one scene_project_url and scene_worker_secret in Vault first';
  end if;
  if (select length(decrypted_secret) from vault.decrypted_secrets where name = 'scene_worker_secret') < 32 then
    raise exception 'scene_worker_secret looks too short; it must equal GENERATION_WORKER_SECRET';
  end if;
  if (select decrypted_secret from vault.decrypted_secrets where name = 'scene_project_url') !~ '^https://[a-z0-9]+\.supabase\.co$' then
    raise exception 'scene_project_url must be https://<ref>.supabase.co (no trailing slash, no path)';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'scene_settle_requests') then
    raise exception 'Run 20261118100000_generation_ledger_close.sql first; without settlement the ledger never closes';
  end if;
end $$;

-- 重复执行时先摘掉旧任务，避免同一个 jobname 堆两条。
do $$ begin
  if exists (select 1 from cron.job where jobname = 'scene-generation-poll') then
    perform cron.unschedule('scene-generation-poll');
  end if;
end $$;

select cron.schedule('scene-generation-poll', '* * * * *', $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'scene_project_url') || '/functions/v1/generation-worker',
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'scene_worker_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
$job$);

-- 装完立刻自检：应当恰好 1 行、active、schedule = '* * * * *'。
select jobid, jobname, schedule, active from cron.job where jobname = 'scene-generation-poll';

-- 排查用（跑过一两分钟后再看 net._http_response 最新几条，status_code 200 才算通）：
--   select id, status_code, timed_out, error_msg, left(content, 200)
--     from net._http_response order by id desc limit 5;
