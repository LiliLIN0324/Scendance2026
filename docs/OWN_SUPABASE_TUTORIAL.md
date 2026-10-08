# 用自己的 Supabase 项目当后端（tutorial）

目标项目：`wkhfvnzgopjdzxlmycks`

- Dashboard：https://supabase.com/dashboard/project/wkhfvnzgopjdzxlmycks
- 数据 API / Auth / Storage：`https://wkhfvnzgopjdzxlmycks.supabase.co`
- 业务 API：`https://wkhfvnzgopjdzxlmycks.supabase.co/functions/v1/scene-api`

本文把本仓库已经写好的后端（数据库迁移 + Edge Functions + Storage 桶 + Auth 规则）整体部署到你自己的这个 Supabase 项目上。原来的专用项目 `hrsrrduwbqxnqddkexoy` 不受影响，两个项目互相独立：各用各的 URL、各用各的密钥、各用各的数据。

整个过程不需要 Docker。Supabase CLI 只用来推迁移、传函数和写密钥；数据库、Auth、Storage 都由 Supabase 托管。

## 0. 这套后端包含什么

| 部分 | 内容 | 来源 |
| --- | --- | --- |
| 数据库 | 19 份迁移：业务表、事务 RPC、编辑租约、AI 账务、个人工作室触发器、私有 Storage 桶 | `supabase/migrations/` |
| Edge Functions | `scene-api`（业务与匿名分享）、`generation-worker`、`reconstruction-worker` | `supabase/functions/` |
| 私有 Storage | 桶 `scene-assets`，上限 10 MiB，允许 GLB/PNG/JPEG，匿名不可直接下载 | 迁移 `20261002060309_scene_storage.sql` |
| Auth | 邮箱密码登录、注册需确认、匿名登录关闭、最短密码 12 位 | `supabase/ops/cloud-config.toml` |

部署顺序固定为：**关联项目 → 推迁移 → 传函数 → 写 Secrets → 配 Auth → 接前端 → 验收**。数据库没推之前函数会报错，所以不要跳步。

### 日常在 Dashboard 哪里看

| 想看什么 | 去哪里 |
| --- | --- |
| 表里的实际数据 | Table Editor，把 schema 从 `public` 切到 `scene_private` |
| 手动查数、改数、执行 SQL | SQL Editor |
| 注册用户、登录记录 | Authentication → Users |
| 上传的 GLB / 图片 | Storage → `scene-assets` |
| 函数日志、报错 | Edge Functions → 选中函数 → Logs |
| 慢查询、报错统计 | Reports / Logs |

业务表全部放在 `scene_private` schema（`studios`、`members`、`projects`、`assets`、`shares`、`generation_jobs` 等），没有暴露给浏览器的 Data API，只能通过 Edge Functions、SQL Editor 或 service role 访问。这是有意的隔离设计，不是配置错误。

调试阶段最常用的是 SQL Editor，例如：

```sql
select id, name, updated_at from scene_private.projects order by updated_at desc;
select id, email, created_at from auth.users order by created_at desc;
```

## 1. 准备

1. Node.js 24（仓库有 `.nvmrc`，本机验证过 v24.12.0）。
2. 依赖：在仓库根目录执行

```sh
npm ci
```

3. 登录 Supabase CLI。先到 https://supabase.com/dashboard/account/tokens 建一个 Personal Access Token，然后：

```sh
npx supabase login
```

4. 在 Dashboard 里准备四样东西：

| 需要的值 | 在哪里拿 | 用途 |
| --- | --- | --- |
| 数据库密码 | 建项目时设的；忘了可在 Project Settings → Database 重置 | CLI 关联项目 |
| Project URL | Project Settings → API：`https://wkhfvnzgopjdzxlmycks.supabase.co` | 前端与函数 |
| publishable / anon key | Project Settings → API Keys | 前端浏览器 |
| service_role / secret key | 同上，仅服务端可见 | 备份或手动写密钥，正常不用 |

Dashboard 版本不同，API 页可能叫 "API" 或 "API Keys"。新版会显示 `sb_publishable_...` 和 `sb_secret_...`，旧版显示 `anon` 和 `service_role` JWT，两者都能用。

> 如果你的终端报了 `EPERM: operation not permitted, mkdir 'C:\Users\<你>\.supabase'`，说明当前终端被沙箱限制。请在你自己的普通 PowerShell 里执行，或放行该目录。

## 2. 关联项目

```sh
npx supabase link --project-ref wkhfvnzgopjdzxlmycks
```

会提示输入数据库密码。也可以一次性带上：

```sh
npx supabase link --project-ref wkhfvnzgopjdzxlmycks --password "<数据库密码>"
```

关联成功后，后续命令省略 `--project-ref` 也会作用于这个项目。但下面的命令仍然显式写上 `--project-ref`，避免连错项目。

## 3. 先本地验证迁移（推荐）

这一步不碰云端，用 PGlite 跑一遍真实 PostgreSQL 引擎：

```sh
npm run check
```

然后在真正写入前，先看一遍云端将要执行的迁移清单：

```sh
npx supabase db push --project-ref wkhfvnzgopjdzxlmycks --dry-run
```

`--dry-run` 只打印不执行。新项目应该列出全部 19 份迁移，版本从 `20261002060304` 到 `20261003210000`。

## 4. 推送数据库迁移

```sh
npx supabase db push --project-ref wkhfvnzgopjdzxlmycks
```

执行后会得到：业务表（项目、场景、资产、成员、分享、生成任务、账务、参数化资产、Agent 运行记录）、事务 RPC、私有桶 `scene-assets`，以及"邮箱确认后自动创建私人工作室"的触发器。

核对结果：

```sh
npx supabase migration list --project-ref wkhfvnzgopjdzxlmycks
```

左侧 local 和右侧 remote 应该一一对应，且没有 remote 独有的迁移。

注意：

- 不要在这个项目上执行 `db reset`，也不要用其他项目的迁移历史覆盖它。
- 迁移包含对 `anon`、`authenticated`、`service_role` 角色的授权，这些角色由 Supabase 托管项目自动提供，新项目直接可用。
- 迁移只向前。已经推过的版本号不要再改名，后续改动请新增 `supabase/migrations/<时间戳>_xxx.sql`。

## 5. 部署 Edge Functions

```sh
npx supabase functions deploy scene-api generation-worker reconstruction-worker --project-ref wkhfvnzgopjdzxlmycks --use-api
```

`--use-api` 表示通过官方 API 打包上传，不需要本地 Docker。

三个函数的鉴权方式写在 `supabase/config.toml` 里，都是 `verify_jwt = false`：

- `scene-api` 在函数内部校验 Auth JWT；匿名分享入口单独校验令牌和撤销状态。
- 两个 worker 用各自的 Bearer secret 校验，密钥不进浏览器。

打开 Dashboard → Edge Functions，应看到三个函数都是 ACTIVE。

## 6. 写函数 Secrets

先把模板复制成被 Git 忽略的本地文件：

```sh
Copy-Item supabase/functions/.env.example .env.edge.local
```

至少要填的字段：

```dotenv
PUBLIC_APP_URL=http://localhost:3000
ALLOWED_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
GENERATION_WORKER_SECRET=<随机 32 字节，自己生成>
RECONSTRUCTION_WORKER_SECRET=<另一个独立的随机值>
```

`ALLOWED_ORIGINS` 是 CORS 白名单，填错前端会收到 403。正式域名上线后要把它加进去，多个值用英文逗号分隔。

AI 供应商字段（`DEEPSEEK_API_KEY`、`AI_MAX_REQUEST_CENTS`、`HUNYUAN_*`）可以留空。留空时相关接口返回稳定的 `503 SERVICE_NOT_CONFIGURED`，不会伪造结果，也不影响项目保存、编辑租约、Storage 这些核心功能。要用 AI 时再按 `docs/PROVIDER_SETUP.md` 填写。

写入云端：

```sh
npx supabase secrets set --project-ref wkhfvnzgopjdzxlmycks --env-file .env.edge.local
```

`SUPABASE_URL` 和 `SUPABASE_SERVICE_ROLE_KEY` 由 Supabase 平台自动注入给 Edge Functions，不需要你写。如果某个接口返回 `503` 且 `setting: "SUPABASE_SERVICE_ROLE_KEY"`，说明该项目的密钥体系需要手动补，用 Dashboard 里的 secret key 执行一次 `npx supabase secrets set SUPABASE_SERVICE_ROLE_KEY="<secret key>" --project-ref wkhfvnzgopjdzxlmycks`。

## 7. 配置 Auth

在 Dashboard → Authentication 里操作：

1. Sign In / Providers → Email：**启用**，Confirm email **打开**。这样注册后必须确认邮箱才能进工作室。
2. URL Configuration：
   - Site URL 填前端地址（本地开发用 `http://localhost:3000`，上线后换成正式域名）。
   - Redirect URLs 加入 `http://localhost:3000/auth/callback`、`http://127.0.0.1:3000/auth/callback` 和正式域名的 `/auth/callback`。
3. 密码策略：最短 12 位，与前端和迁移里的约束一致。
4. 关闭匿名登录，公开注册按需开启。

仓库另外提供了一份最小配置 `supabase/ops/cloud-config.toml`，用于只更新注册开关和回调地址。不要直接把本仓库的本地 `supabase/config.toml` 整体推到云端，它包含本地开发地址和测试账号假设。用命令行应用时要在一个临时工作目录里操作并先审阅差异。

### 邮件发送（公开注册前必须处理）

Supabase 内置的发信服务只对项目组织成员有效，且有严格限流，不适合真实用户注册。用你自己的邮箱测试时可以先用内置服务；要让外部用户注册，必须在 Authentication → Emails / SMTP 里配置独立 SMTP（host、port、user、password、sender）。凭据只写进 Supabase 私密设置，不进仓库、不进浏览器。

## 8. 接入前端

复制 `frontend/.env.example` 为 `frontend/.env.local`，改成你的项目：

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://wkhfvnzgopjdzxlmycks.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<publishable key，形如 sb_publishable_...>
NEXT_PUBLIC_GENERATION_ENABLED=false
```

代码同时接受旧变量名 `NEXT_PUBLIC_SUPABASE_ANON_KEY`，`publishable` 优先。旧项目只有 `anon` JWT key 时写旧名字即可。

只放公开 key。`service_role` / `sb_secret_` 永远不能出现在 `NEXT_PUBLIC_*` 里，前端代码里也没有位置放它。

前端构建时读取这两个变量，所以改动后要重新构建或重启开发服务器，而不是热更新就能生效。

## 9. 验收

1. 函数健康检查（不需要登录，`verify_jwt=false`）：

```sh
curl https://wkhfvnzgopjdzxlmycks.supabase.co/functions/v1/scene-api/health
```

期望 `{"ok":true,"schemaVersion":1,"supportedSchemaVersions":[1,2]}`。

2. 用前端注册一个真实邮箱账号，确认邮件后登录。此时数据库触发器应该已经为它创建了一个私人工作室。
3. 新建项目、保存、刷新重开，确认云端版本能恢复。
4. 可选：初始化演示工作室（会真实创建 Auth 账号，远端必须显式加 `--remote`）。把 `.env.example` 里的 `DEMO_*` 和 `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` 填进 `.env.local` 后：

```sh
node --env-file=.env.local scripts/seed-demo.mjs --remote
```

该脚本复用同邮箱的已有用户，不重置密码。只接受两个不同的邮箱和 12 位以上密码。

## 10. 可选：定时轮询生成任务

只有在配置了 AI 供应商、真的要跑异步生成时才需要。步骤在 `supabase/ops/install-generation-cron.sql` 和 `install-reconstruction-cron.sql`：先用 Vault 保存项目 URL 和 worker secret，再执行安装脚本。

```sql
select vault.create_secret('https://wkhfvnzgopjdzxlmycks.supabase.co', 'scene_project_url');
select vault.create_secret('<GENERATION_WORKER_SECRET 的值>', 'scene_worker_secret');
```

然后在 SQL Editor 里执行对应的 `install-*.sql`。脚本创建的定时任务默认 `active=false`，确认供应商密钥配齐后再手动启用。空队列不会创建新任务，也不会产生费用。

## 11. 安全与常见坑

- **密钥分层**：浏览器只能用 publishable/anon key；service_role / secret key 只出现在服务端和 Supabase 自身设置里。
- **CORS**：`ALLOWED_ORIGINS` 没包含当前前端域名时，浏览器请求会被 403 拒绝；localhost 和正式域名都要列。
- **不要 reset 云端**：本项目已经承载真实数据后，任何 `db reset` 都会清空数据。改表一律新增迁移。
- **不要复用其他项目的密钥**：换项目时 URL 和 key 必须成套更换，混用会出现鉴权失败或写入错误项目。
- **迁移与函数要一起更新**：改了 RPC 签名又只部署函数不推迁移，会在运行时才暴露错误。
- **回归验证**：改动后跑 `npm run check` 和（如果装了 Deno）`npm run check:edge`，再对云端跑一次第 9 节的健康检查和登录流程。

## 12. 命令速查

```sh
# 关联
npx supabase link --project-ref wkhfvnzgopjdzxlmycks

# 本地验证
npm run check
npx supabase db push --project-ref wkhfvnzgopjdzxlmycks --dry-run

# 推迁移
npx supabase db push --project-ref wkhfvnzgopjdzxlmycks
npx supabase migration list --project-ref wkhfvnzgopjdzxlmycks

# 传函数
npx supabase functions deploy scene-api generation-worker reconstruction-worker --project-ref wkhfvnzgopjdzxlmycks --use-api

# 写密钥
npx supabase secrets set --project-ref wkhfvnzgopjdzxlmycks --env-file .env.edge.local

# 验收
curl https://wkhfvnzgopjdzxlmycks.supabase.co/functions/v1/scene-api/health
```
