# PLAN 接口复核与正式发布

> 归档于 2026-10-09：本文是 1.0 之前的发布或验收记录，内容以记录当日为准，仅用于追溯。当前入口见 [README](../../README.md)，当前部署见 [自有 Supabase 部署](../OWN_SUPABASE_TUTORIAL.md)。

2026-10-02。用户授权按重大改版后的实际网站重新对接并上线，业务验收由用户完成；登录注册服务不在本任务范围。依据 `/Users/lwc/Desktop/PLAN.md`，文档中的未来提案不自动构成新增服务的执行要求。

## 发布基线与归属

以 Cloudflare Pages 实际正式版本 `a08f12f` 为基线，保留 0.5.0 首页与统一登录、现场照片本机预览、创意助手、234 个公共模型、体育馆/快闪场景预设和鼠标滚轮分类。专用分支 `codex/supabase-live-reconcile`，没有合并 main/dev。

历史业务分支基于旧编辑器，不能整分支覆盖新版。本次仅移植项目/团队、个人资产/任务、不可变发布与客户查看；保留新版 `BackendSession` 的会话代次、请求归属、GLB 授权验证和付费幂等保护。恢复同项目链接时保留本地未保存画布；普通素材、成员或已知 AI 服务错误不会中断有效编辑租约。

## 需要的接口与接入位置

所有业务 API 位于 `https://hrsrrduwbqxnqddkexoy.supabase.co/functions/v1/scene-api`。除匿名发布读取外，使用现有 Auth 的用户 access token；浏览器不访问 service_role 或直接写数据库。

| 业务 | API | 网页接入 |
| --- | --- | --- |
| 工作室与成员 | GET/POST `/studios`；GET/PUT/DELETE `/studios/:id/members[/userId]` | `/projects/` 管理项目与团队；owner 添加已有用户或移除 editor |
| 项目 | GET/POST `/projects`；GET/PATCH `/projects/:id` | 云项目弹层及 `/projects/`；`/editor/?project=…` 为当前编辑器的兼容入口，原 `/` 保留 |
| 轮流编辑、保存 | POST `/projects/:id/lease/{acquire,renew,release}`；PUT `/projects/:id/scene` | 90 秒租约、30 秒续期、版本检查、丢权保留草稿 |
| 文字 AI | POST `/projects/:id/proposals`、`/proposals/apply` | 沿用新版创意助手；预览后明确确认；仍是两种基础模板/有限命令 |
| 个人素材与公共模型授权 | GET `/assets`；POST `/assets/:id/url` | 个人模型预览与尺寸确认加入；现有 234 个公共模型继续走相同私有授权 |
| 生成任务恢复 | GET `/jobs`、`/jobs/:id`；POST `/jobs/:id/added` | 查看真实任务状态；资产已保存到项目后再同步 added |
| 单体模型生成 | POST `/jobs`，worker 查询/归档 | 接口保留；未完成 TokenHub 开通、密钥和费用配置，付费按钮和 cron 关闭 |
| 发布与撤销 | POST `/projects/:id/publish`；GET `/projects/:id/shares`；DELETE `/projects/:id/shares/:shareId` | 云项目弹层中发布已保存版本、复制新链接与撤销 |
| 匿名客户查看 | POST `/share/read` | `/view/#token`，只读场景、物料表与来源许可，短期资源授权 |

## 与图纸 v2 的统一发布

用户随后在聊天「部署图纸到三维工作流」明确授权协调并保留两项改动。本分支停止独立生产写入，由 `codex/floorplan-safe-release` 统一合入并发布。以下 v1 基线边界仅记录本分支，不能当作统一发布后的能力结论；统一版本的图片上传、结构 v2 与重建接口由该发布任务配置：

- POST `/assets/sources`，GET `/projects/:id/sources`，DELETE `/projects/:id/sources/:assetId`：项目私有图纸/照片来源。
- POST `/projects/:id/reconstructions` 与 GET `/projects/:id/reconstructions/:jobId`：识别/核对/规划任务及持久化查询。
- POST `/projects/:id/history/restore`：受租约与版本约束的恢复。
- 独立 `reconstruction-worker`、费用预留、任务迁移与定时处理：不能以混元单体生成 worker 代替；混元关闭不妨碍单独配置重建服务。

对方合入时须保留本分支工作室路由与迁移，并适配 `/view/` 的 v2 场地轮廓、墙体、开口、柱子；不可用只画矩形的客户页声称完整发布新结构。来源图片、尺寸标定、图像证据及内部备注继续对匿名客户隐藏。最终部署版本与验证由统一发布记录确认。

## 本分支无需新增或开启

| 部分 | 处理与原因 |
| --- | --- |
| 第二套公共库推荐/导入面板 | 当前工作台已有 234 个云端登记公共模型及推荐；不叠加旧 Poly Haven UI。原 `/catalog/recommendations`、`/assets/import` API 保留兼容，不删除资源或数据库 |
| 新登录 API / Auth 配置 | 复用已上线登录注册与邮箱流程；不推送旧全量 Supabase Auth 配置 |
| 现场照片识别 | 本分支沿用 v1 本机预览；统一发布将使用来源上传与重建队列，不把旧 `/assets/floorplan` 当识图接口 |
| 多边形/复杂场地图云端结构 | 本分支 v1 基线不实现；统一发布按上述授权接入图纸 v2，避免旧客户端降级保存 |
| 通用聊天、设计 brief 持久化、视觉分析 v2 | 不照抄旧建议 endpoint；统一发布使用已有图纸分支的实际重建契约，通用永久聊天仍非本分支新增功能 |
| TRELLIS、自托管 GPU、R3F 迁移、SSR | PLAN 明确为未来候选；不部署、不产生额外账号或付费资源 |
| 公共存储桶与绕过租约的直接表写入 | 不需要，也不启用；仍使用私有 Storage 与服务端权限 |

体育馆/快闪示例仍明确标为本地场景预设，其整体舞台模型不冒充已可通过 v1 场景协议云保存。234 个公共素材的真实 assetId 和签名授权继续沿用当前线上登记。

## 云端配置复核

只读核对：已执行 8 份迁移（含 `20261002150000_scene_studios`、`20261002180000_shared_model_library`）；私有桶 `scene-assets`；234 个公共素材已登记。`studio_rpc` 的 anon/authenticated 执行权均为 false，service_role 为 true。`scene-api` ACTIVE v5、`generation-worker` ACTIVE v3，与本次业务协议一致。

已上线的工作室迁移和路由同步回当前网站仓库，以免日后部署旧副本覆盖成员接口；本次不重复执行迁移，不重建表，不改动既有账号/项目/发布资源。DeepSeek 与费用设置沿用当前服务；混元密钥、费用与条款为空，`scene-generation-poll.active=false`。

腾讯手工开通与配置步骤见 [HUNYUAN_ACTIVATION.md](HUNYUAN_ACTIVATION.md)。本次没有提交真实付费任务。

## 技术检查与发布记录

本分支技术检查：后端 12 文件 / 119 项测试通过，前端 116 文件 / 1512 项测试通过，最后补充项目交接与过期 GLB 恢复保护后相关 14 项回归通过；后端与前端 TypeScript、Deno Edge 类型、生产静态构建和 Git diff 检查通过。构建保留原有 introduction JSX 与静态 export/rewrites 提醒；本次新增文件无 ESLint 错误。静态产物包含 `/projects`、`/editor`、`/view` 及既有首页/登录/介绍页；Cloudflare Pages 沿用 extensionless HTML 路由。

按用户协调授权，本分支不单独部署旧 v1 后端或抢先覆盖 Pages，由 `codex/floorplan-safe-release` 整合后一次发布。这里的测试结果不能证明合并后 v2 或生产环境已经验收，最终部署 ID/提交以统一发布记录为准。单元测试、类型与构建检查不代表业务验收；本次不使用真实账号创建验收项目、不做浏览器端到端或手机验收。
