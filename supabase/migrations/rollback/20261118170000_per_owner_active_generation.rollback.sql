-- 回滚 #123：按 owner 活跃闸 → 恢复全站唯一活跃。
--
-- 保护：只有当前没有「多个 owner 同时有活跃生成」时才允许回滚；否则全站唯一索引
-- 必然创建失败。先报出 active owners 数量，让人先清场再回滚，避免半途失败。
--
-- 顺序：先查并发 → 删 per-owner 索引 → 建全站唯一索引 → 状态机 BUSY 判据改回全站。
-- 任一步失败即中止，不会留下「索引已换、函数未换」的混合态。

do $$
declare
  active_owners integer;
begin
  select count(distinct owner_id)
    into active_owners
    from scene_private.generation_jobs
   where state in ('queued','submitting','submitted','processing','archiving','submit_unknown');

  if active_owners > 1 then
    raise exception 'ROLLBACK_BLOCKED: % owners still have active generations; drain them first', active_owners;
  end if;
end $$;

drop index if exists scene_private.generation_active_per_owner_idx;

create unique index if not exists generation_single_active_idx
  on scene_private.generation_jobs ((true))
  where state in ('queued','submitting','submitted','processing','archiving','submit_unknown');

do $$
declare
  definition text;
  global_guard text;
  owner_guard text;
begin
  definition := pg_get_functiondef('public.job_rpc_generation_v1(uuid,text,jsonb)'::regprocedure);

  global_guard := 'exists(select 1 from scene_private.generation_jobs where state in ('
    || '''queued'',''submitting'',''submitted'',''processing'',''archiving'',''submit_unknown''))';
  owner_guard := 'exists(select 1 from scene_private.generation_jobs where owner_id=p_actor and state in ('
    || '''queued'',''submitting'',''submitted'',''processing'',''archiving'',''submit_unknown''))';

  if strpos(definition, global_guard) > 0 then
    return;
  end if;

  if strpos(definition, owner_guard) = 0 then
    raise exception 'ROLLBACK_GUARD_NOT_FOUND: neither global nor owner-scoped BUSY guard found';
  end if;

  definition := replace(definition, owner_guard, global_guard);
  execute definition;
end $$;
