-- 只读校验：#123 按 owner 活跃闸是否按预期生效。
-- 部署 20261118170000_per_owner_active_generation.sql 之后运行；不改任何数据。

-- 1) 两个索引只能存在 per-owner 那个，且定义必须带 owner_id + 活跃状态谓词。
select indexname, indexdef
  from pg_indexes
 where schemaname = 'scene_private'
   and indexname in ('generation_active_per_owner_idx', 'generation_single_active_idx')
 order by indexname;

-- 2) 状态机里 BUSY 判据必须已收窄到 owner_id = p_actor。
select position('owner_id=p_actor' in pg_get_functiondef('public.job_rpc_generation_v1(uuid,text,jsonb)'::regprocedure)) > 0
         as busy_guard_scoped_to_owner;

-- 3) 同一 owner 的活跃任务最多 1 条；应返回 0 行。
select owner_id, count(*) as active_jobs
  from scene_private.generation_jobs
 where state in ('queued','submitting','submitted','processing','archiving','submit_unknown')
 group by owner_id
having count(*) > 1;
