-- 生成闭环的一次性只读体检（2026-11-18）。
--
-- 为什么要有这个文件：2026-11-17 的 C1 实跑最后卡在「生产库缺 pg_cron / pg_net、Vault 没 secret、
-- generation-worker 没触发器」，而这些都是**部署侧**状态——代码仓库里看不出来，只能去生产库问。
-- 在那之前，每次核对都要人工拼一堆 SQL，还容易漏掉「体积上限迁移到底应用了没」。
--
-- 用法：Supabase Dashboard → SQL Editor 全文粘贴执行；有直连的机器也可以
--   psql "$DATABASE_URL" -f supabase/ops/verify-generation-closure.sql
--
-- 全程只有 select / raise notice，没有 insert / update / ddl，可以随便跑。
-- 判读顺序：① 扩展 → ② Vault → ③ cron → ④ pg_net 回执 → ⑤ 三道体积闸门 → ⑥ 任务与产物。
-- 只要 ①~④ 里有缺件，后面「任务停在 queued」就是必然结果，不用再猜。

-- ① 触发器依赖的扩展。期望两行：pg_cron、pg_net。
select extname as extension, extversion as version
  from pg_extension
 where extname in ('pg_cron', 'pg_net')
 order by extname;

-- ①b pg_net 固定装在 net schema；这里为 0 行说明装了也用不了（worker 调用会解析失败）。
select nspname as pg_net_schema
  from pg_namespace
 where nspname = 'net';

-- ② Vault 里的两个键。只看名字与长度，不打印密钥本身。
--    期望两行：scene_project_url、scene_worker_secret（后者长度 >= 32）。
select name, length(decrypted_secret) as secret_length
  from vault.decrypted_secrets
 where name in ('scene_project_url', 'scene_worker_secret')
 order by name;

-- ③ cron 任务。缺 pg_cron 时这里只会打印一句 notice，不会中断后面的查询。
do $$
declare n integer; r record;
begin
  if to_regclass('cron.job') is null then
    raise notice 'CRON: pg_cron 未安装 —— 没有触发器，任务会永远停在 queued';
    return;
  end if;
  select count(*) into n from cron.job where jobname = 'scene-generation-poll';
  if n = 0 then
    raise notice 'CRON: 没有 scene-generation-poll —— 执行 supabase/ops/install-generation-cron.sql';
  else
    for r in select jobid, schedule, active, username from cron.job where jobname = 'scene-generation-poll' loop
      raise notice 'CRON: jobid=% schedule=% active=% user=%', r.jobid, r.schedule, r.active, r.username;
    end loop;
  end if;
end $$;

-- ④ 最近 5 次 pg_net 调用。status_code 必须是 200；401 = Vault 里的 secret 与
--    Edge Function 的 GENERATION_WORKER_SECRET 不一致；000 / timed_out = 函数没部署或 URL 错。
do $$
declare r record; n integer;
begin
  if to_regclass('net._http_response') is null then
    raise notice 'NET: 没有 net._http_response（pg_net 未工作），无法核对 worker 是否被调用';
    return;
  end if;
  select count(*) into n from net._http_response;
  if n = 0 then
    raise notice 'NET: 一次调用都没有 —— cron 装了但没触发，或还没跑满一分钟';
    return;
  end if;
  for r in select id, status_code, timed_out, left(coalesce(error_msg, ''), 120) as err
             from net._http_response order by id desc limit 5 loop
    raise notice 'NET: id=% status=% timed_out=% err=%', r.id, r.status_code, r.timed_out, r.err;
  end loop;
end $$;

-- ⑤ 三道体积闸门：都应是 33554432（32 MiB）。仍是 10485760 说明
--    20261118160000_provider_asset_size_ceiling.sql 没应用，Lux3D 的 10.06 MiB 产物会被拒收。
select conname as constraint_name, pg_get_constraintdef(oid) as definition
  from pg_constraint
 where conrelid = 'scene_private.assets'::regclass
   and contype = 'c'
   and pg_get_constraintdef(oid) like '%byte_size%';

select id as bucket, file_size_limit
  from storage.buckets
 where id = 'scene-assets';

-- ⑥a 全局任务分布。有 queued 但没有 cron，就是堵在触发器上；有 rejected + FILE_TOO_LARGE，
--     就是⑤里某道闸门没开。
select state, count(*) as jobs
  from scene_private.generation_jobs
 group by state
 order by jobs desc;

-- ⑥b 最近 10 单逐字段。provider_job_id 为 null 且 state 长期 queued = 从未派发；
--     asset_id 有值 = 产物已入库，可以直接拿来摆放（不必再开新单、不必再扣费）。
select id, state, provider_mode, provider_model, provider_job_id, asset_id,
       error_code, attempts, created_at, updated_at
  from scene_private.generation_jobs
 order by created_at desc
 limit 10;

-- ⑥c 卡住超过 10 分钟的非终态任务（正常单：1 分钟一次 cron，几轮内推进）。
select id, state, attempts, created_at, now() - created_at as waiting
  from scene_private.generation_jobs
 where state in ('queued', 'submitting', 'submitted', 'processing', 'archiving')
   and created_at < now() - interval '10 minutes'
 order by created_at;

-- ⑥d 可复用的成功产物（source='aholo' 即 Lux3D 产出）。数量 > 0 就先走入库/摆放，不要开新单。
select id, name, source, source_id, byte_size, created_at
  from scene_private.assets
 where source = 'aholo'
 order by created_at desc
 limit 10;

-- ⑥e 账本是否闭合：终态请求里 actual_cents 仍为 null 的行数，期望 0。
select count(*) as unsettled_terminal_requests
  from scene_private.requests
 where kind = 'generation'
   and actual_cents is null
   and state in ('complete', 'failed');
