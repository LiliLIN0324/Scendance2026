-- 回滚脚本：20261105120000_pay_orders.sql
-- 仅移除本迁移新增的对象，不影响既有 scene/job 表。
-- 用法：在 Supabase SQL Editor 或 psql 中按顺序执行。

drop function if exists public.pay_release_stale(integer);
drop function if exists public.pay_release(text);
drop function if exists public.pay_reserve(text, text, text, integer);

drop table if exists public.pay_events;
drop table if exists public.scan_consumptions;
drop table if exists public.pay_orders;
drop table if exists public.pay_skus;
