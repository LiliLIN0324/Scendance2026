-- scene_private 的每张业务表都必须开 RLS。
--
-- 20261002060304_scene_core.sql 里有一轮统一开关（给当时所有表开 RLS），
-- 但之后新增的表没有跟上：user_preferences / outdoor_card_history / outdoor_plans
-- 都是「经 service_role 调 RPC」的私有表，却漏了 RLS，
-- 于是 tests/database.test.ts 的「每张业务表都开 RLS」一直是红的。
--
-- 这里补齐，并且对以后新增的表同样生效：只处理当前没开 RLS 的表，
-- 不动已经开了的表和它们已有的策略。
--
-- 安全性：这些表只经 service_role 调 RPC 读写，客户端不直连；
-- service_role 带 BYPASSRLS，所以开 RLS 不影响现有读写路径。
-- 先查过：生产库里没有任何 scene_private 表对 anon/authenticated 授过权。

do $rls$
declare
  t text;
begin
  for t in
    select c.relname
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'scene_private' and c.relkind = 'r' and not c.relrowsecurity
  loop
    execute format('alter table scene_private.%I enable row level security', t);
    execute format('revoke all on table scene_private.%I from anon, authenticated', t);
  end loop;
end $rls$;
