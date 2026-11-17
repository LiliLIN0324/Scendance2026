-- 供应商产物入库上限：10 MiB → 32 MiB（只放宽「服务商给的产物」这一档）。
--
-- 2026-11-17 生产 C1 实跑踩到的：Lux3D G1 的 textured.glb 实测 10,546,592 字节（10.06 MiB），
-- 比 10 MiB 多 59 KB。供应商那边模型已经生成好了，却在我们自己的闸门前被挡住：
-- 任务落到 rejected + FILE_TOO_LARGE，额度按「已派发」记了实付，模型没进模型库，用户只看到一句「失败」。
--
-- 一共三道闸门，缺一不可：
--   1. Edge Function 侧的模型上限 —— 代码里，见 supabase/functions/_shared/models.ts 的 MAX_PROVIDER_GLB_BYTES（32 MiB）；
--   2. scene_private.assets.byte_size 的 CHECK（本迁移）；
--   3. storage.buckets.file_size_limit（本迁移）——对象存储直传的硬上限，不改这里上传会被 Storage 拒。
--
-- 只放宽服务商产物这一档：用户本机导入仍守 10 MiB（前端文案与前端上传校验都没变，
-- api.ts 的 readBounded 也仍按 10 MiB 收），所以这条约束放宽不会让用户上传超大文件。
--
-- 上限取 32 MiB 而不是更大：Lux3D G1 实测 10.06 MiB，32 MiB 留了三倍余量；
-- 再往上会撑破浏览器解析与对象存储的成本，得不偿失。

do $$
declare
  constraint_name text;
begin
  select conname into constraint_name
    from pg_constraint
   where conrelid = 'scene_private.assets'::regclass
     and contype = 'c'
     and pg_get_constraintdef(oid) like '%byte_size%';
  if constraint_name is not null then
    execute format('alter table scene_private.assets drop constraint %I', constraint_name);
  end if;
end $$;

alter table scene_private.assets
  add constraint assets_byte_size_check check (byte_size between 1 and 33554432);

update storage.buckets set file_size_limit = 33554432 where id = 'scene-assets';
