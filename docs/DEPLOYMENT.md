# 本地运行、云端维护与恢复

本说明适用于工作区根目录后端，记录日期为 2026-10-02。独立 Supabase 项目 `scendance-scene-planner`（ref `hrsrrduwbqxnqddkexoy`，区域 `ap-southeast-1`）已部署。继续使用该专用项目，无需重新创建或连接其他业务项目。已执行的配置与证据见 [云部署记录](CLOUD_DEPLOYMENT.md)，功能范围见 [PLAN 后端对照](PLAN_BACKEND_AUDIT.md)。

前端目标域名为 `https://scendance.charlestech.org`，本轮没有发布前端静态构建；Cloudflare 项目、DNS 与证书的实际状态以 [Cloudflare 配置记录](CLOUDFLARE_SETUP.md) 为准。

## 1. 本地测试（不依赖 Docker）

```sh
npm ci
npm run check
npm run check:edge
npm run smoke:edge
npm run check:config
```

需要 Node.js 24，依赖和 CLI 版本已锁定。`check` 会在临时 PGlite PostgreSQL 实例中运行全部迁移和业务测试，不修改已有项目或云端数据库。本轮部署记录中，8 个测试文件、103 项测试，以及 Deno 类型检查和运行时冒烟均通过。

`check:config` 验证核心服务，允许未配置的供应商关闭。完整模式 `npm run check:config:full` 当前准确报告 6 项供应商字段缺失；填写后应通过。预检只验证配置，不调用供应商。

可选执行免费公共素材实测：`npm run check:public-model`。它会通过真实网络读取 Poly Haven 目录和一个椅子模型，打包、校验、计算尺寸，仅输出统计，不调用付费服务或上传文件。

## 2. 完整 Supabase 本地服务（需要 Docker）

```sh
npx supabase start
npx supabase db push --local
npx supabase migration list --local
npx supabase db advisors --local --type security --fail-on warn
npx supabase db lint --local
```

本仓库已生成 `config.toml`：开放邮箱注册并要求确认，匿名登录关闭，PostgreSQL17，业务 schema 不暴露。不要用 `db reset` 清理已有本地数据。

现有 `.env.local` 和 `.env.edge.local` 保存本轮专用云配置，不要用本地模板覆盖它们。为本地开发另建 `.env.dev.local`，参考根目录 `.env.example`，填写 `supabase status` 提供的本地 URL/service role key/公钥，以及两个不同邮箱、至少 12 位独立密码和工作室 UUID。另建 `.env.edge.dev.local`，参考 `supabase/functions/.env.example`，配置本地 origin、单独的 worker secret 及需要启用的供应商。

本地配置预检和真实 Auth 用户初始化：

```sh
node scripts/check-config.mjs --mode core --demo --env .env.dev.local --env .env.edge.dev.local
node --env-file=.env.dev.local scripts/seed-demo.mjs
```

脚本复用已有同邮箱用户，不重置密码；成员关系不同的已有工作室会拒绝覆盖。若账号创建成功而工作室失败，保留账号供重试，不擅自删除。该脚本默认仅接受 localhost；直接运行脚本时，远端必须显式追加 `--remote`。本轮云端演示账号已经初始化，无需重复创建。

使用独立的本地 Edge 配置启动函数：

```sh
npx supabase functions serve --env-file .env.edge.dev.local
```

Supabase 自动注入函数使用的 `SUPABASE_URL` 与 service role key；不要把根目录含账号密码的 `.env.local` 整体用作云端 secrets 文件。前端仍需单独接入 Supabase Auth 与本后端 API。

若需在本地验证付费生成，先核对供应商配置并由用户明确创建任务，再在开发终端以独立 worker Bearer secret 对 `http://127.0.0.1:54321/functions/v1/generation-worker` 发 POST `{}`；后续查询间隔至少 30 秒。worker 密钥不进入浏览器。

## 3. 供应商配置与付费验收

本轮尚未调用 DeepSeek / Hunyuan。按 [供应商配置指南](PROVIDER_SETUP.md) 在已有 `.env.edge.local` 中填写 6 项待配置字段：`DEEPSEEK_API_KEY`、`AI_MAX_REQUEST_CENTS`、`HUNYUAN_API_KEY`、`GENERATION_MAX_TASK_CENTS`、`HUNYUAN_TERMS_URL`、`HUNYUAN_TERMS_REVIEWED_AT`。

DeepSeek 直连官方 `deepseek-flash`；一次应用请求的费用预留覆盖最多两次调用、每次最多 4096 输出 tokens 和相应输入。腾讯新账号使用已适配的 `HUNYUAN_API_MODE=tokenhub`，当前模型参数为 `hy-3d-3.0 / LowPoly / triangle`。真实账号权限、费用上界及适用条款由账号使用者核对，不把免费额度作为硬依赖。

保留已有 worker secret、应用 URL 与 CORS；worker secret 已与 Vault 配对，无需重新生成。填写并完成预检后，仅将 Edge 文件上传到当前专用项目：

```sh
npm run check:config:full
npx supabase secrets set --project-ref hrsrrduwbqxnqddkexoy --env-file .env.edge.local
```

写入 secrets 不提交生成请求。真实付费验收须由用户明确提交一件物件，再核对供应商记录、Storage GLB、预览、加入、保存与重开；不自动批量生成或重试结果未知的付费提交。

数据库累计预留上限为三维 150 元、文本 30 元；不自动释放失败/未知预留。预留不等于实际扣费，详见 [后端设计](BACKEND.md)。

## 4. 已部署服务与后续维护

| 项目 | 已证实的配置 |
| --- | --- |
| 数据库 | 四份迁移通过官方 HTTPS Management API 在一个事务中执行，原版本号及 SQL 已保存到迁移历史 |
| 迁移版本 | `20261002060304`、`20261002060307`、`20261002060309`、`20261002061700` |
| Edge | `scene-api`、`generation-worker` 均为 ACTIVE v1，`verify_jwt=false`，在服务内部验证 Auth JWT 或 worker secret |
| Auth | 邮箱注册与确认开启；独立 SMTP 由用户配置，真实收信按 [验证码验收](AUTH_EMAIL_OTP.md) 记录；匿名登录关闭，最短密码 12 位 |
| 站点与允许来源 | 正式站点 `https://scendance.charlestech.org`；CORS/跳转白名单另允许 `http://localhost:3000`、`http://127.0.0.1:3000` |
| 私有 Storage | `scene-assets`，最大文件 `10,485,760` 字节（10 MiB）；GLB/PNG/JPEG |
| 演示账号 | 两成员已初始化，真实密码登录成功 |

不要重新执行初始化迁移或重建已有资源。后续数据库变更先核对远端迁移历史、审阅新增迁移并备份；本轮通过管理 API 落地，不应据此假定本机 CLI 已连接正确项目。

后续函数更新部署到明确的专用项目：

```sh
npx supabase functions deploy scene-api generation-worker --project-ref hrsrrduwbqxnqddkexoy --use-api
```

部署前通过相关测试与类型检查，部署后复查函数状态并运行云端冒烟。`verify_jwt=false` 支持匿名分享入口和 worker 独立凭据，业务接口继续在函数内认证。

Auth 维护使用 [最小云端配置](../supabase/ops/cloud-config.toml)，在独立临时 Supabase 工作目录中应用并审阅差异，不直接向云端推送完整本地 `supabase/config.toml`。保持 `[auth].enable_signup=true`、`[auth.email].enable_signup=true` 和 `enable_confirmations=true`：允许注册，但确认邮箱后才能进入工作室。OTP 模板与云端限流见 [邮件注册与找回](AUTH_EMAIL_OTP.md)。本轮已发现并修复邮箱项设为 false 经 CLI 同步会关闭邮箱登录的问题，修复后真实登录通过。

`.env.local` 保存新项目 key 与演示密码，`.env.edge.local` 保存 Edge 配置，`.env.provision.local` 保存数据库密码及建项信息；三份文件均为 `0600` 并由 Git 排除。平台会向 Edge 注入内建 `SUPABASE_*` 变量。浏览器只配置 Supabase URL 与 anon/public key，服务端凭据不进入前端。

### 真实云端复验

```sh
npm run smoke:cloud -- --write --remote
```

此命令实际写入验收项目与资产，临时创建非成员账号；结束时撤销测试分享、释放租约、删除临时账号，保留验收项目和资产。它不调用付费模型。成功输出应为 `ok: true`、9 组检查通过、`cleanupIssues: []`。

本轮验收项目为 `6c59bbb1-b48c-4075-b161-01f288dcf769`。双账号登录、租约竞态、成员隔离、Storage、保存重开、发布与撤销均已实际通过。公共目录推荐返回 `200` 和 8 项，真实 GLB 导入返回 `201`，大小 `1,702,284` 字节；后续模型保存/发布及浏览器展示验证以 [云部署记录](CLOUD_DEPLOYMENT.md) 为准。

### 定时归档

Vault 已保存 `scene_project_url` 和与 Edge 一致的 `scene_worker_secret`，每分钟任务 `scene-generation-poll` 已安装，当前 **active=false**。供应商配置未完成时保持停用，无需重新运行安装脚本。已实测 Vault→pg_net→worker 手动请求返回预期缺配置 503；这不代表真实生成已可用。

云端供应商配置验证后，按 [供应商指南](PROVIDER_SETUP.md) 中的 SQL 启用或停用定时器，并检查 `cron.job_run_details` 和 `net._http_response` 的真实执行结果。启用会处理用户已明确提交的待办任务；空队列不创建生成任务。任务提交后超过 4 分钟失去 worker 认领会标记未知，不自动重新付费提交。

## 5. 账务、未知任务与恢复

- `submit_unknown`：先在提供商控制台核对该用户描述、时间和请求记录。**禁止直接改回 queued**。确认已创建任务后，由管理员在一次数据库事务内绑定正确 `provider_job_id` 并改为 submitted，同时把 requests.state 改回 reserved；随后 worker 只查询既有任务。确认根本未创建且没有费用时，可改 failed 后由用户发起新的意图。
- 账单核对后按请求填写 `actual_cents`，保留 provider_usage；若要降低过高预留，必须在同一事务锁定对应 budgets 行并按差额调整 committed_cents，避免重复退款。默认不自动退款。
- `rejected`：模型超过体积/复杂度、格式/纹理不兼容或结构校验失败。不能标记 ready；保留原始提供商 ID，另行优化或选择其他素材。
- `archiving`：Storage/下载临时失败会保留任务，定时器再次查询获取当前临时地址。任务超过23小时仍无法恢复会标记失败，避免永久占位；失败不自动重新付费。
- Storage 上传后 DB 写入失败可能留下无引用对象；短期保留用于恢复，不做激进自动删除。清理前对照 assets 和所有 publications，演示期手工核对。
- 编辑冲突/离线：客户端保持未保存草稿，不自动覆盖服务器，不把超时显示为已保存。重获租约重新加载云端数据后由用户处理本地差异。

## 6. 回滚与正式验收

保留部署前数据库备份和 Edge 版本。函数回滚不能撤销数据库迁移、已发任务或已经签发/下载的文件。紧急停用付费任务时先停 cron 并禁用对应调用配置；不要删除未确认的任务记录。

云端 HTTP 已实测真实账号登录/交接、非成员隔离、独立请求租约竞态、Storage、发布与撤销。仍需在实际前端与设备上验证：同用户两个标签页、掉线/过期租约交互、人工编辑使 AI 提案失效、真实付费三维结果的预览/加入/保存重开、复制删除模型、手机分享页面、大陆普通网络耗时与帧率。完整 Supabase Docker 本地栈及本地 Advisors/数据库连接检查未在本轮复验；其边界与云端已通过的检查分别记录。
