-- place_shapes 索引
-- 目的：让按名称查场地从「全表扫描 30 万行」变成毫秒级。
-- 做法：粘到 Supabase → SQL Editor → Run。整段一次跑完，几秒钟。
--
-- 说明：
--   1) 主键被删掉后，name_norm 上没有任何索引，每次搜场地都要扫全表。
--   2) 第一条索引管「名字完全相同」的直接命中。
--   3) 第二条管「名字包含」的模糊命中（比如搜「黄龙」能带出「杭州黄龙饭店主楼」）。
--
-- 注意：这里故意不用 CREATE INDEX CONCURRENTLY。
--   Supabase SQL Editor 会把语句放在事务里执行，而 CONCURRENTLY 不允许在事务中运行，会直接报错。
--   30 万行建索引只需几秒，短暂锁表可以接受；若线上正在被写入且不能锁，改用 SQL 之外的 psql 连接执行 CONCURRENTLY 版本。

-- 1. 模糊匹配需要 trigram 扩展（已装过会跳过）
create extension if not exists pg_trgm;

-- 2. 精确命中：name_norm 等值查询
create index if not exists place_shapes_name_norm_idx
  on public.place_shapes (name_norm);

-- 3. 包含命中：name_norm ilike '*关键字*'
create index if not exists place_shapes_name_norm_trgm_idx
  on public.place_shapes using gin (name_norm gin_trgm_ops);

-- 4. 跑完自检：应该看到上面两个索引
select indexname, indexdef
from pg_indexes
where schemaname = 'public' and tablename = 'place_shapes'
order by indexname;