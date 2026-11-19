-- 生成活跃闸：每人 1 个 → 每人 3 个（槽位制），批量跑件从串行变并行。
--
-- 20261118170000 把闸门从「全站 1 个」收窄到「每人 1 个」，解决了「一行卡住锁死全站」。
-- 但「每人 1 个」对批量出物料仍然是硬串行：实测单件端到端 5.8–7.1 分钟，
-- 一次只跑一件，30+ 件物料要跑三小时。
--
-- 本迁移把闸门改成「每人最多 3 个活跃」：
--   1. generation_jobs 增加 active_slot 列；同一 owner 的活跃任务占用不同槽位（1..3）；
--   2. 部分唯一索引从 (owner_id) 改成 (owner_id, active_slot)，槽位满时数据库直接挡住；
--   3. 下单时不再「有活跃就拒」，而是找最小空闲槽位；三个槽位都占满才抛 GENERATION_BUSY；
--   4. jobs.claim 的排序改成「优先 queued、再按 next_poll_at 最早」——
--      原排序是 order by created_at，多任务并行时最早创建的那单会被反复优先领取，
--      后面的 queued 单会饿死（这是并行化后必须一起改的，否则等于没放开）。
--
-- 不变的部分：
--   * worker 代码一行不改（每分钟领 1 单、走一步的节奏照旧），三单靠轮转并行推进；
--   * budgets.committed_cents 仍是全局整池校验，不按人分账；
--   * submit_unknown 10 分钟宽限解围、owner-scoped 的 resolve_unknown 不变；
--   * 幂等键 unique(owner_id,kind,request_key) 不变；
--   * 失败单全额退分、不自动重派付费请求的口径不变。
--
-- 上限 3 是按「Lux3D 单账号并发」定的保守值：厂商侧对同一账号的并发有软限制，
-- 放到更大之前要先有实测读数支撑，不能靠猜。

alter table scene_private.generation_jobs add column if not exists active_slot smallint;

drop index if exists scene_private.generation_active_per_owner_idx;

create unique index if not exists generation_active_slot_idx
  on scene_private.generation_jobs(owner_id, active_slot)
  where active_slot is not null
    and state in ('queued','submitting','submitted','processing','archiving','submit_unknown');

-- 索引定义自检：重复执行迁移也要能判定槽位索引是否真的建对了。
do $$
begin
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'scene_private'
      and indexname = 'generation_active_slot_idx'
      and indexdef like '%(owner_id, active_slot)%'
      and indexdef like '%submit_unknown%'
  ) then
    raise exception 'ACTIVE_SLOT_INDEX_INVALID: generation_active_slot_idx missing or wrong definition';
  end if;
end $$;

-- 状态机改三处：声明槽位变量、下单取空闲槽位、领单排序防饿死。
do $$
declare
  definition text;
  old_declare text;
  new_declare text;
  old_guard text;
  new_guard text;
  old_insert text;
  new_insert text;
  old_order text;
  new_order text;
begin
  definition := pg_get_functiondef('public.job_rpc_generation_v1(uuid,text,jsonb)'::regprocedure);

  old_declare := 'v_kind text; existing boolean; next_state text; v_day date; v_spent numeric; v_attempt integer;';
  new_declare := old_declare || ' v_slot smallint;';

  old_guard := 'if v_kind=''generation'' and exists(select 1 from scene_private.generation_jobs where owner_id=p_actor and state in (''queued'',''submitting'',''submitted'',''processing'',''archiving'',''submit_unknown'')) then raise exception ''GENERATION_BUSY''; end if;';
  new_guard := 'if v_kind=''generation'' then' || chr(10)
    || '      select min(s) into v_slot from generate_series(1,3) s' || chr(10)
    || '        where not exists(select 1 from scene_private.generation_jobs g where g.owner_id=p_actor and g.active_slot=s' || chr(10)
    || '          and g.state in (''queued'',''submitting'',''submitted'',''processing'',''archiving'',''submit_unknown''));' || chr(10)
    || '      if v_slot is null then raise exception ''GENERATION_BUSY''; end if;' || chr(10)
    || '    end if;';

  old_insert := 'insert into scene_private.generation_jobs(id,owner_id,prompt) values(req.id,p_actor,p_data->>''prompt'') returning * into j;';
  new_insert := 'insert into scene_private.generation_jobs(id,owner_id,prompt,active_slot) values(req.id,p_actor,p_data->>''prompt'',v_slot) returning * into j;';

  old_order := 'order by created_at for update skip locked limit 1;';
  new_order := 'order by (state=''queued'') desc, next_poll_at, created_at for update skip locked limit 1;';

  -- 迁移可重复执行：四段都改完就跳过。
  if strpos(definition, new_guard) > 0 and strpos(definition, new_insert) > 0 and strpos(definition, new_order) > 0 then
    return;
  end if;

  if strpos(definition, old_declare) = 0 or strpos(definition, old_guard) = 0
     or strpos(definition, old_insert) = 0 or strpos(definition, old_order) = 0 then
    raise exception 'CONCURRENCY_PATCH_TARGET_MISSING: job_rpc_generation_v1 no longer matches the expected shape';
  end if;

  definition := replace(definition, old_declare, new_declare);
  definition := replace(definition, old_guard, new_guard);
  definition := replace(definition, old_insert, new_insert);
  definition := replace(definition, old_order, new_order);
  execute definition;
end $$;

-- 迁移后自检：函数里三处改动必须都在。
do $$
declare
  definition text;
begin
  definition := pg_get_functiondef('public.job_rpc_generation_v1(uuid,text,jsonb)'::regprocedure);
  if strpos(definition, 'active_slot') = 0 then
    raise exception 'ACTIVE_SLOT_PATCH_INCOMPLETE: active_slot not wired into job_rpc_generation_v1';
  end if;
  if strpos(definition, 'generate_series(1,3)') = 0 then
    raise exception 'ACTIVE_SLOT_PATCH_INCOMPLETE: free-slot lookup not wired into job_rpc_generation_v1';
  end if;
  if strpos(definition, 'state=''queued'') desc') = 0 then
    raise exception 'ACTIVE_SLOT_PATCH_INCOMPLETE: claim order not fixed in job_rpc_generation_v1';
  end if;
end $$;
