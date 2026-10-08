# 独立后端部署记录

> 本文为原交付过程记录，所述分离工作树路径属于历史环境。当前完整仓库的入口与部署边界见 [项目交接](PROJECT_STATUS.md)（已归档）。

> 归档于 2026-10-09：本文为 2026-10-02 首次后端配置阶段记录，其中的额度与部署状态已作废，仅用于追溯。当前入口见 [README](../../README.md)，部署与恢复见 [部署说明](../DEPLOYMENT.md)，AI 额度语义见 [AI 使用额度](../AI_USAGE_LIMITS.md)。


执行日期：2026-10-02（America/Chicago）。以工作区根目录后端为准；未修改或发布 `scendance/` 前端。

## 资源与隔离

| 项目 | 实际配置 |
| --- | --- |
| Supabase | 新建 `scendance-scene-planner`，ref `hrsrrduwbqxnqddkexoy`，区域 `ap-southeast-1` |
| 控制台 | https://supabase.com/dashboard/project/hrsrrduwbqxnqddkexoy |
| 数据 API / Auth / Storage | `https://hrsrrduwbqxnqddkexoy.supabase.co` |
| 业务 API | `https://hrsrrduwbqxnqddkexoy.supabase.co/functions/v1/scene-api` |
| 生成 worker | `https://hrsrrduwbqxnqddkexoy.supabase.co/functions/v1/generation-worker` |
| 前端目标域名 | `https://scendance.charlestech.org`；域名实际状态见 [Cloudflare 配置记录](CLOUDFLARE_SETUP.md) |
| 旧站隔离 | 未迁移或复用 CharlesTech 的数据库、Auth 用户、业务表、存储桶和 Worker；新项目使用独立密钥 |

## 已落地的服务配置

- 四份迁移 `20261002060304`、`20261002060307`、`20261002060309`、`20261002061700` 已在新项目执行，包含业务表、事务 RPC、私有桶和演示账号管理函数。
- CLI 数据库直连及连接池受当前网络影响不可用，改经官方 HTTPS Management API 在一个事务中执行迁移，同时保存原始版本号、名称和 SQL 到 `supabase_migrations.schema_migrations`。没有重置数据库。
- `scene-api`、`generation-worker` 已部署为 `ACTIVE` v1。两者 `verify_jwt=false`，分别由业务函数验证真实 Auth JWT、由 worker 校验独立服务密钥；匿名分享也在函数内校验令牌及撤销状态。
- `scene-assets` 为私有桶，上限 `10,485,760` 字节，允许 GLB/PNG/JPEG；匿名用户没有直接下载权限。
- 远端 Auth：允许邮箱密码登录，禁止公开注册及匿名登录，最小密码长度 12。站点为独立域名，跳转白名单和 CORS 包含该域名及 `localhost:3000`、`127.0.0.1:3000`。
- 云配置单独保存在 [cloud-config.toml](../../supabase/ops/cloud-config.toml)。实际发现 CLI 将 `auth.email.enable_signup=false` 映射为关闭邮箱 provider，已修正为该项 true、顶级 `auth.enable_signup=false`，并通过真实登录验证。
- 已初始化独立演示工作室 `8abe853a-31f1-4f60-83ae-1cbbd7a3738e` 及负责人、编辑成员两个真实 Auth 账号。两份随机密码不同，不复用原站用户。
- Vault 已保存 `scene_project_url`、`scene_worker_secret`。每分钟任务 `scene-generation-poll` 已安装，当前 **active=false**；提供商凭据未填齐前保持停用。

## 本轮验证

| 检查 | 结果 |
| --- | --- |
| 根目录类型与业务测试 | `npm run check`：8 个文件、103 项测试通过 |
| Edge 类型与运行 | `npm run check:edge`、`npm run smoke:edge` 通过，包含实际 Khronos GLB 校验器加载 |
| 配置预检 | `npm run check:config` 通过；完整模式准确报告 6 项未填供应商字段，没有把未配置服务当成功 |
| 公网健康检查 | `GET /scene-api/health` 返回 HTTP 200、`schemaVersion=1` |
| 真实 Auth 与隔离 | 两个真实账号登录、非成员读写拒绝、匿名业务请求 401、非白名单 Origin 403 |
| 实际并发编辑 | 两个独立 HTTP 会话竞争同一项目租约仅一方成功；另一成员被拒绝；续期、交接、旧租约与旧 revision 拒绝均通过 |
| 真实 Storage | PNG 上传、签名下载字节比对、匿名普通下载拒绝、私人资产与项目引用授权通过 |
| 保存与发布 | 保存重开、物料数量、发布快照不可变、内部备注和私人底图隐藏、撤销后新访问 404 均通过 |
| 数据库权限 | `anon`、`authenticated` 均无 `scene_rpc`/`job_rpc` 执行权及 `scene_private` 使用权；`service_role` 有权 |
| 免费公共素材 | 真实推荐返回 HTTP 200/8 项；Poly Haven `chinese_armchair` 导入返回 HTTP 201，GLB 为 1,702,284 字节，云端校验及私有归档成功 |

真实服务验收使用 [smoke-cloud.mjs](../../scripts/smoke-cloud.mjs)，未替换 Auth、Storage、PostgreSQL 或网络响应。验收项目 ID 为 `6c59bbb1-b48c-4075-b161-01f288dcf769`；项目和资产保留作证据，主验收临时非成员已删除、租约已释放、分享已撤销。这证明实际 HTTP 并发保护，不替代浏览器两标签页交互验收。

新增修复覆盖：根目录测试不再扫描独立 `scendance/`；TokenHub 新接口及旧接口显式选择；积压过期任务在付费提交前拒绝；worker 方法、认证和缺配置返回稳定的 JSON 405/401/503，错误不会领取付费任务。

## 私有配置与后续操作

| 文件 | 用途 |
| --- | --- |
| 根目录 `.env.local` | 新项目 service role、公钥、工作室 ID 和两个演示账号密码 |
| 根目录 `.env.edge.local` | 独立站点/CORS、worker 密钥及待填写的供应商配置 |
| 根目录 `.env.provision.local` | 本次新项目的数据库密码、组织与 project ref |

以上文件均为本机 `0600`，由 `.gitignore` 排除，不上传到前端或版本库。演示账号邮箱使用 `scendance.example`，通过管理员预置且已完成真实密码登录，不用于邮件收取或密码恢复。

按 [供应商配置指南](../PROVIDER_SETUP.md) 填写 DeepSeek、腾讯广州 TokenHub 密钥及费用/条款字段，再验证云端配置、启用调度。**本轮没有调用付费模型，没有真实 AI 提案或 HY-3D 生成成功记录。**

补充 GLB 保存后已从远端只读 SQL 确认验收项目为 revision 4、2 个物件；该次补充发布分享 `edc6bd8c-d989-4258-bca0-7e69afe49522` 已通过负责人业务 API 撤销，HTTP 200。补充流程未取得完整成功输出，不计为匿名 GLB 下载或浏览器绘制验收。

本次遵照用户选择没有发布前端；登录页面、三维编辑器、`/view/` 客户页和手机/大陆网络/FPS 仍需后续集成验收。完整逐项范围见 [PLAN 对照表](PLAN_BACKEND_AUDIT.md)。

## 运维待办与交付位置

在确认所有 cron 停用、pg_net 请求与响应表均为空后，已在单一事务中将 `pg_net` 从 `public` 重建到 `extensions`，远端查询确认新位置。随后 Security Advisor 复查，该项告警已消除；现在仅剩 `auth_leaked_password_protection` 一项 WARN 和 12 项服务表无浏览器 RLS policy 的 INFO。后者与主动撤销浏览器角色权限相符。

泄露密码保护尚未启用；官方文档注明该功能需要 Pro 或更高计划，本次未变更订阅。当前已经关闭公开注册、采用独立随机密码且最小密码长度为 12，不将 Advisor 记为全绿。[Supabase 密码保护说明](https://supabase.com/docs/guides/auth/password-security)

已通过真实 Vault → pg_net → generation-worker 手动请求验证服务密钥配对和网络链路：请求 ID 1 返回 HTTP 503、`SERVICE_NOT_CONFIGURED`、`timed_out=false`，符合供应商密钥未填齐时先拒绝、不给任务收费的设计。没有触发付费生成。每分钟 cron 保持 `active=false`；尚未验收实际定时触发、提供商任务处理或异步结果归档。

用户新增独立 worktree 规则后，本次后端交付已转入 `.worktrees/backend-services`，专属分支 `codex/backend-services-configuration`；依赖通过 `npm ci --offline` 在该目录单独安装，并重新通过 103 项测试、TS、Deno 检查和核心配置预检。后续维护与填写凭据以此 worktree 为准；原检出保留已有文件，未同步、重置或合并 main/dev。`scendance/` 独立仓库未改变。

原根仓库在本次提交前没有历史提交，本分支首个提交因此包含根后端的完整代码与配置材料；不包含原型、嵌套前端仓库、node_modules 或私有 env 文件。`docs/contracts/` 当前不存在，已有接口契约位于 `docs/API.md`；本轮没有另建共享接口层。
