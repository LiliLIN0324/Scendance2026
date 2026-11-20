# 云存储能力上线 runbook

日期：2026-11-20。用户已指定两位管理员邮箱并要求接手完成，无需再次逐项审批。**本次执行结果见下表；下文保留可复用步骤，不能把步骤本身当成验证证据。**
配套：验收报告 `docs/plans/2026-11-20-cloud-storage-integration-acceptance.md`、审核 SQL `supabase/review/202611200001_cloud_storage.sql`（含 2026-11-20 集成验收修订：`cloud.project.save` 幂等回执瘦身）。

## 本次执行记录（2026-11-20）

| 步骤 | 实际结果 |
| --- | --- |
| S1 | 无专用预发配置，Docker 不可用。PGlite 专项通过；另在目标 Postgres 事务内应用、以 service_role 检查能力与权限后 rollback，确认 RPC 不存在、桶仍为 32MiB。此项不是独立预发环境验收。 |
| S2/S3 | 已定向事务应用 review SQL，未执行全量 db push、未修改既有迁移历史。桶 2GiB，20 个 MIME，覆盖 archiveMime 的全部类型。另补完整清单的资源授权检查，防止仅凭私有资源 ID 转成公开分享。 |
| S4 | scene-api 已部署，匿名目录 200、匿名管理 401、普通用户管理 403。未部署其他函数，未改供应商密钥。 |
| S5/S6 | 按已确认邮箱匹配 verified auth.users；两位管理员首授完成。复用“幕景”工作室，两人已分别为 owner/editor，无需新建或挪动项目。 |
| S7 | 最终生产前端发布及浏览器证据见配套验收报告 §0。Pages 从仓库根执行，以包含根 functions/；静态包仅排除 gitignored 的本地 scans 缓存，线上扫描继续走既有 R2。 |
| S8 | 12 个国内案例迁入并发布；重复运行后仍为 12。海外 OnePlan 案例未迁入。 |
| S9 | 两位真实管理员 + 既有 walkthrough QA 普通账号完成真实 API 验收。干净浏览器结果与尚未覆盖项见报告 §0；不能标为 V01–V14 全部通过。 |

种子命令：`npm run seed:cn-cases`。默认只校验 payload，远程执行必须设置 `CLOUD_SEED_REMOTE=1`；管理员凭据仅从已有安全配置注入进程环境。脚本已修复工作目录与租约释放认证，不打印密码或 token。

非破坏性应急回退：先暂停云端写入并确认无正在执行的操作，回退 Pages 部署；必要时撤销 `service_role` 对 `public.cloud_storage_rpc(uuid,text,jsonb)` 的执行权，新能力按不可用返回。保留新增表、文件和审计数据，不自动删表或清库。恢复时重新授予执行权。桶原值为 33554432，原 MIME 为 glb/png/jpeg/webp；缩回前必须评估已归档大文件的后续写入。

## 0. 部署前事实快照（历史，不代表当前状态）

| 项 | 当前状态 | 核对命令/方式 |
| --- | --- | --- |
| 审核 SQL 未进自动迁移链 | ✅（在 `supabase/review/`，不在 `supabase/migrations/`） | `git status` / 目录核对 |
| 线上无 `cloud_storage_rpc` | ✅（`/cloud/*` 一律 503 `CLOUD_STORAGE_UNAVAILABLE`） | 对生产 URL `GET /functions/v1/scene-api/cloud/capabilities`，期望 503 |
| 生产桶 32MiB、mime 白名单不含扫描/附件 | ✅（SQL 第 9 节待人审执行） | Supabase Dashboard → Storage → Policies |
| `platform_admins` / `official_workspace` 不存在 | ✅（表随审核 SQL 创建） | 同上 |
| 两位管理员 UUID | **未确认，本 runbook 全程不含任何 UUID** | 见 §3 需要你提供的材料 |

## 1. 执行顺序总览（每步之间必须完成"验证"才可进入下一步）

```
S1 预发演练（本地/预发库应用 SQL → 冒烟）
S2 生产应用审核 SQL（表 + RPC + 幂等闸）
S3 生产桶扩容（与 S2 同一 SQL 的第 9 节，可单独放行）
S4 部署 Edge Functions（scene-api，含 /cloud/* 处理器）
S5 首授平台管理员（两位，人工核对身份后 insert）
S6 配置官方共同工作区（official_workspace 指定承载 studio）
S7 部署前端静态导出
S8 种子迁入国内案例（npm run seed:cn-cases，幂等）
S9 三账号 + 干净浏览器真实验收（V01–V14）
```

S2/S3 可以合并执行（同一 SQL 文件）；S4/S7 与 S2/S3 无依赖冲突但建议 SQL 先行，避免新前端对着未部署的后端显示"未接通"。

## 2. 各步骤：内容 / 影响 / 验证 / 回滚

### S1 预发演练（强烈建议，不改任何生产数据）

- 内容：`supabase start`（本地）或预发 Supabase 项目 → `supabase db reset`（自动跑 migrations）→ `psql` 应用 `supabase/review/202611200001_cloud_storage.sql` → 跑根专项测试确认同一 SQL 在真实 Postgres 行为一致（`npx vitest run tests/cloud-storage.test.ts`，该测试用 PGlite 显式 exec 同一份 SQL）。
- 影响：仅本地/预发。
- 验证：专项测试 10/10；`select * from scene_private.cloud_cases limit 1` 空表可查。
- 回滚：不涉及。

### S2 生产应用审核 SQL

- 内容：人工 review 全文后，由运维在生产库执行 `supabase/review/202611200001_cloud_storage.sql`（一次事务建议包 `begin; ... commit;`）。涉及：
  - 新表 10 张：`platform_admins`、`platform_admin_audit`、`official_workspace`、`cloud_requests`、`archive_assets`、`upload_intents`、`complete_projects`、`complete_publications`、`cloud_cases`、`cloud_case_versions`；
  - 新函数：`is_platform_admin`、`official_studio`、`cloud_claim/finish`、`cloud_dep_row`、`cloud_published_deps`、`cloud_check_scene_covered`、`cloud_publish_snapshot`、`cloud_check_manifest`、`cloud_case_view`、`public.cloud_storage_rpc`（security invoker，仅 service_role 可执行）；
  - **注意**：SQL 末尾的第 9 节（桶扩容）是 `update storage.buckets` 语句，如需把"建表"与"扩容"分开批准，可先注释掉该节执行，桶部分走 S3。
- 影响：只新增对象，不改既有表/RPC；`cloud_storage_rpc` 不挂进 `scene_rpc` 委托链。既有功能零影响。
- 验证：
  - `GET /functions/v1/scene-api/cloud/capabilities`（带任一普通用户 JWT）→ 200 `{version:1,superAdmin:false,officialStudioId:null}`；
  - 匿名 `GET /cloud/cases` → 200 `[]`；
  - 匿名 `GET /cloud/cases/manage` → 401。
- 回滚：`drop function public.cloud_storage_rpc(uuid,text,jsonb);` + `drop schema 依赖函数与 10 张表`（SQL 文头有回滚说明，逐对象列出：先 drop 引用函数，再 drop 表，`cloud_case_versions`/`complete_publications`/`upload_intents` 带 FK 先删）。**回滚前必须确认无在写业务**（上线初期无存量时零风险）。

### S3 生产桶扩容

- 内容：`update storage.buckets set file_size_limit=2147483648, allowed_mime_types=array[...] where id='scene-assets'`（审核 SQL 第 9 节）。
- 影响：所有经 `scene-assets` 桶的上传（既有 GLB/平面图 + 新归档直传）共享新上限与 mime 集。mime 集保留了既有 glb/png/jpeg/webp/pdf/zip/json/text/csv/octet-stream，新增视频与 spz/ply 的 octet-stream 形态；**缩小 mime 集需在批准时定稿**（现行集合是 A 报告契约配套值）。
- 验证：小于 32MiB 的既有上传回归（`npm run smoke:cloud`）；一个 >32MiB 的 .spz 经归档直传链成功（管理员账号，走前端归档页或 V03 步骤）。
- 回滚：`update storage.buckets set file_size_limit=33554432, allowed_mime_types=<原集合> where id='scene-assets'`；回滚前先记录原 mime 集合（Dashboard 导出）。

### S4 部署 Edge Functions

- 内容：按现有部署流程发布 `scene-api`（本地 `npm run check:edge` 已通过：3 入口）。
- 影响：`/cloud/*` 路由开始服务；部署窗口内旧版本无 `/cloud/*`，前端如实显示 503"未接通"，无兼容风险。
- 验证：S2 的三条验证全部转 200；`POST /cloud/uploads`（管理员 JWT）能拿到直传地址。
- 回滚：回退到上一函数版本（Supabase functions 历史版本），`/cloud/*` 回到 503；无数据副作用。

### S5 首授平台管理员（人工执行；本 runbook 不含 UUID）

- 前提：两位管理员真实身份已确认（见 §3 材料清单 1）。
- 内容（在 S2 之后的生产库执行）：
  ```sql
  insert into scene_private.platform_admins(user_id, note)
    values ('<已核对UUID-甲>', '首次授权：<日期>/<审批人>/<凭据方式>'),
           ('<已核对UUID-乙>', '首次授权：<日期>/<审批人>/<凭据方式>');
  ```
  （`granted_by` 留空表示首次库内手工授权；审计口径见 `platform_admin_audit` 的 grant/revoke 触发链——首次手工 insert 不产生审计行，审批记录以本文档 + 运维工单为准。）
- 影响：仅新增两行授权；普通用户无感知。
- 验证：两位账号调 `GET /cloud/capabilities` → `superAdmin:true`；第三个账号 → `false`；`select action,target from scene_private.platform_admin_audit` 此时应为空（手工首授不入审计表）。
- 回滚（撤权，即时生效）：`update scene_private.platform_admins set revoked_at=now() where user_id='<UUID>';` 撤权后旧页面上的下一次写动作即被 `PLATFORM_ADMIN_REQUIRED` 拒绝。

### S6 配置官方共同工作区

- 前提：决定了"官方内容放哪个工作室"（见 §3 材料清单 2）。
- 内容：
  ```sql
  insert into scene_private.official_workspace(studio_id, enabled_by)
    values ('<承载工作室ID>', '<已核对UUID-甲>');
  ```
  并确认两位管理员在该 studio 的 `scene_private.members` 里有成员行（owner/editor）——否则 `cloud.project.save` 的 `require_lease` 会以成员校验拒绝管理员。
- 影响：所有"官方"语义（官方归档、案例发布）以此 studio 为界；不挪动任何既有个人项目。
- 验证：`GET /cloud/capabilities`（管理员）→ `officialStudioId` 非 null；管理员 `POST /cloud/uploads`（带 studioId）→ 201。
- 回滚：`delete from scene_private.official_workspace where id='official';`（单行注册表；已归档数据留在表内，不影响个人内容）。

### S7 部署前端静态导出

- 内容：`npm --prefix frontend run build`（本地已验证通过）→ 按现有托管流程发布 `frontend/out`。
- 影响：编辑器新增「归档」页、「案例」页签、云端案例目录、完整只读链接区块；未部署后端时全部如实显示不可用，部署后自动接通（能力探测）。
- 验证：登录管理员 → 分享卡出现「案例」页签且显示"正在向服务端确认案例管理权限…"或权限结论；账户面板出现「归档」页。
- 回滚：回退上一版静态资源。

### S8 种子迁入国内案例

- 内容：`npm run seed:cn-cases`（幂等；仅迁 `origin==='cn'` 的官网中国案例，海外 OnePlan 学习案**不迁**）。需要环境变量：`CLOUD_SEED_REMOTE=1`、`CLOUD_SEED_URL`、`CLOUD_SEED_ANON_KEY`、`CLOUD_SEED_EMAIL`/`CLOUD_SEED_PASSWORD`（管理员账号）、`ALLOWED_ORIGINS`。凭据走 .env.local 或会话环境，不落库不打印。
- 影响：每个未迁入案例创建 1 个官方项目 + 1 份完整清单 + 1 个案例草稿 + 1 个不可变发布；重复执行全部 skip。
- 验证：测试输出 summary（12 条 published/skipped）；匿名 `GET /cloud/cases` 返回 12 条；前端「国内案例」段云端目录出现卡片；「使用此案例」另存副本成功。
- 回滚：案例下架（`POST /cloud/cases/:id/unpublish`，服务端置空指针）→ 目录立即消失；种子项目可从回收站删除（7 天窗口）。不需要清库。

### S9 三账号 + 干净浏览器真实验收（V01–V14）

按验收报告 §11 的逐项操作步骤执行（部署后版本），证据留档到 `docs/plans/` 或工单。

## 3. 本次已落实的配置

| # | 类型 | 内容 | 用途 |
| --- | --- | --- | --- |
| 1 | 账号 | lily1326685527@gmail.com、2487238628@qq.com，均已确认邮箱并有既有登录记录；UUID 由目标 auth.users 精确查询。复用本机已有管理员凭据，没有向用户索取密码。 | S5/S8 |
| 2 | 工作室 | 复用“幕景”：5169a8c2-d2c0-4399-a395-e9b9bdfbb32c；两位管理员已有 owner/editor 成员行。 | S6 |
| 3 | 存储 | 2GiB；MIME 按修订后的 SQL 第 9 节，覆盖协议内所有格式。 | S3 |
| 4 | 环境 | 目标项目 wkhfvnzgopjdzxlmycks；未把其他可访问项目当作预发。事务回滚演练后定向生产应用。 | S1/S9 |
| 5 | 授权内容 | 本轮 OnePlan 不迁入、不公开；不替用户作永久授权决定。 | C08 |
| 6 | 执行授权 | 用户要求无需再逐项审核、由接手者完成；接受 fail-closed。已执行必要 SQL、首授与部署，未进行不可恢复的数据删除。 | S2/发布闸门 |

## 4. 全程禁止项（与仓库规范一致）

- 不把 service-role key、密码、token 写进前端、文档或提交；`.env.local` 不入库。
- 不按昵称/邮箱猜测管理员身份；不跳过身份核对直接授 UUID。
- 不在未获批准时执行 S2–S8 的任何生产动作；本 runbook 的验证命令都是只读或已有既定流程的。
- 回滚只允许在确认无在写业务后按 §2 对应节执行；任何强删表/清数据需单独审批。
