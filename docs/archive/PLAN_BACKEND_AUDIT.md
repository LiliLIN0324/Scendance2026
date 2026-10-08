# PLAN v0.2 后端实现与配置对照

> 归档于 2026-10-09：本文为 2026-10-02 首次后端配置阶段记录，审计对象是当时的实现状态，已被后续发布取代，仅用于追溯。当前入口见 [README](../../README.md)，当前接口范围见 [API 契约](../API.md)。


审计日期：2026-10-02（America/Chicago）。需求基准为用户指定的 `/Users/lwc/Downloads/PLAN.md`，标题为“场景规划 Agent · 项目规划与 PRD v0.2”。文档中的操作步骤作为需求和设计资料核对，不作为额外执行授权。

目标是工作区根目录的 Supabase 后端。`scendance/` 为独立仓库，本表不把其中的前端、集成测试或部署情况计入根目录完成项；`prototype/` 也不替代真实产品验收。

“代码已有”仅说明实现存在；真实服务配置、运行验证和产品闭环分别记录。前端缺口属于产品集成范围，不等于后端配置失败。当前不能据此宣称 PLAN 的完整产品已完成。

## 1. 12 项必须交付功能

| PLAN 项目 | 根目录后端实现与证据 | 配置或产品验收边界 |
|---|---|---|
| 登录与项目 | [账号初始化脚本](../../scripts/seed-demo.mjs)准备两个不同 Auth 用户及工作室；[API](../../supabase/functions/_shared/api.ts)支持列表、创建、读取、租约下改名；[数据库](../../supabase/migrations/20261002060304_scene_core.sql)按成员过滤项目 | 真实双账号登录和云端保存重开已通过；根目录无登录/项目 UI。列表尚无项目缩略图字段 |
| 场地设置 | [场景契约](../../supabase/functions/_shared/domain.ts)保存米制长宽高、矩形/多边形、主要出入口并校验边界；[API](../../supabase/functions/_shared/api.ts)支持私有 PNG/JPEG 平面图上传 | 后端代码已有；平面图标定、轮廓编辑、比例呈现和输入交互需要前端集成 |
| 三维公共库推荐 | [素材服务](../../supabase/functions/_shared/assets.ts)调用 Poly Haven，返回名称、缩略图、来源、许可及体积预检，并打包归档 GLB | 部分实现：按主题和已选物料评分，场地目前只作为返回信息，未参与推荐筛选/评分。预览、加入、编辑重开 UI 待集成；本轮真实推荐返回 8 项，GLB 导入/校验/私有归档通过 |
| 三维编辑 | [场景契约](../../supabase/functions/_shared/domain.ts)包含稳定实例 ID、位置、旋转、尺寸、颜色、锁定；[保存接口](../../supabase/functions/_shared/api.ts)持久化完整快照 | 后端持久化契约已有；拖放、选择、复制、删除、撤销/重做由前端实现，根目录尚未集成 |
| 内置物料 | [物料目录](../../supabase/functions/_shared/domain.ts)和[数据库目录](../../supabase/migrations/20261002060304_scene_core.sql)定义八类稳定 ID、名称、默认尺寸 | 数据定义已有；可辨认三维外观由前端提供 |
| AI 初稿 | [AI 规则与布局](../../supabase/functions/_shared/ai.ts)提供 salon/networking 两模板、1–40 人和配色；[提供商适配器](../../supabase/functions/_shared/providers.ts)调用 DeepSeek 并最多修复一次 | 代码已有，真实模型服务待凭据和调用验证；分区与物料数量由固定模板按人数生成，未提供任意分区布局能力；预览确认 UI 待集成 |
| AI 修改 | [有限命令](../../supabase/functions/_shared/ai.ts)覆盖添加、删除、移动、旋转、换色、替换，检查锁定与边界；[提案事务](../../supabase/migrations/20261002060304_scene_core.sql)检查云端/本地版本、哈希和租约，返回撤销前快照 | 服务端保护已有；用户确认、提案展示和单步撤销需前端接入 |
| 三维物件生成 | [混元适配器](../../supabase/functions/_shared/providers.ts)提交 3.0 LowPoly；[worker](../../supabase/functions/_shared/worker.ts)查询、校验并归档；[任务数据库](../../supabase/migrations/20261002060307_scene_jobs.sql)持久化真实状态及任务 ID | 代码已有；供应商凭据、当前账号接口兼容性、真实任务、Storage 归档与保存重开待验收；任务/预览/尺寸/加入 UI 待集成 |
| 轮流编辑 | [租约与保存事务](../../supabase/migrations/20261002060304_scene_core.sql)实现 90 秒租约、session/generation/revision 检查、行锁、续期和释放，禁止浏览器直接写表或调用业务 RPC | 后端真实独立 HTTP 会话租约竞争已通过。每 30 秒续期、编辑者显示、失权草稿保留与重获权清历史是前端集成事项 |
| 自动物料表 | [物料汇总函数](../../supabase/migrations/20261002060304_scene_core.sql)按物料/资产、尺寸、颜色和备注汇总；生成物件标记“概念道具，实物待确认”；[API](../../supabase/functions/_shared/api.ts)读取当前保存快照汇总 | 服务端实现已有；画布未保存修改对应的实时汇总和显示 UI 待集成 |
| 客户查看 | [发布事务](../../supabase/migrations/20261002060304_scene_core.sql)冻结名称、场景、物料表及资产清单；匿名读取去除内部备注和私人底图；发布记录禁止修改 | 后端代码已有；根目录没有 `/view/` 页面，返回的 URL 不能作为已经可用的客户交付入口；手机相机操作待集成 |
| 分享撤销 | [分享事务](../../supabase/migrations/20261002060304_scene_core.sql)限制项目创建者/工作室负责人撤销；[API](../../supabase/functions/_shared/api.ts)签名后再次检查撤销；[Storage 适配](../../supabase/functions/_shared/backend.ts)签发 300 秒 URL | 真实匿名分享与撤销已通过，已验证私有资产签名下载。已签发链接到期前可能有效，已下载内容不能收回 |

## 2. 数据、接口与关键行为

### 数据模型

| PLAN 对象 | 实现 | 结论 |
|---|---|---|
| 工作室与成员 | [core 迁移](../../supabase/migrations/20261002060304_scene_core.sql)中的 studios、members；owner/editor 角色 | 已有 |
| 项目 | 同迁移中的 projects，工作室归属、名称、场景、revision、租约信息 | 已有；缩略图未建模 |
| 场景和物件实例 | [domain.ts](../../supabase/functions/_shared/domain.ts)：schemaVersion、venue、objects、camera、lighting；尺寸明确为 width/depth/height，最多 50 件 | 已有；根目录尚无上游编辑器适配层 |
| 资产 | [core 迁移](../../supabase/migrations/20261002060304_scene_core.sql)中的 assets、project_assets，记录所有人、来源、存储路径、格式、尺寸元数据和许可 | 已有；个人列表仅本人，成员只获项目引用资产授权，历史引用保留以支持不可变发布 |
| 生成任务与费用 | [jobs 迁移](../../supabase/migrations/20261002060307_scene_jobs.sql)中的 requests、generation_jobs、budgets | 已有；包含内部/供应商任务 ID、预留额度、provider_usage、actual_cents 字段。实际费用仍需人工对账 |
| 发布版本、分享和租约 | [core 迁移](../../supabase/migrations/20261002060304_scene_core.sql)中的 publications、shares 和 projects 租约字段 | 已有；分享只存令牌哈希，发布快照不可变 |

### PLAN 最小接口

所有路由实现见 [api.ts](../../supabase/functions/_shared/api.ts)，请求字段和错误语义见 [API 文档](../API.md)。

| PLAN 接口 | 已有路由 | 状态 |
|---|---|---|
| 项目创建/读取 | `POST /projects`、`GET /projects/:id`，另有列表和改名 | 代码已有 |
| 获取/续期/释放编辑权 | `POST /projects/:id/lease/acquire`、`renew`、`release` | 代码已有 |
| 保存场景 | `PUT /projects/:id/scene` | 代码已有，租约与 expectedRevision 在事务内验证 |
| AI 提案 | `POST /projects/:id/proposals`、`proposals/apply` | 代码已有，区分生成和确认应用 |
| 创建生成任务 | `POST /jobs` | 代码已有，幂等键复用；未配置凭据/费用上界时拒绝 |
| 查询生成任务 | `GET /jobs/:jobId`，另有列表与 added 确认 | 代码已有 |
| 发布方案 | `POST /projects/:id/publish` | 代码已有，仅接受已保存 revision |
| 查看/撤销分享 | `POST /share/read`、`DELETE /projects/:id/shares/:shareId` | 代码已有 |

另有个人资产、资产授权 URL、平面图上传、公共库推荐/导入、物料汇总接口。PLAN 指定的 `/projects/`、`/editor/?project=…`、`/view/#…` 是前端页面路径，根目录未实现，不能与上述 API 路由混为一谈。

### 运行和行为约束

| PLAN 约束 | 证据与判断 |
|---|---|
| 私有 Storage 与服务端权限 | [私有桶迁移](../../supabase/migrations/20261002060309_scene_storage.sql)禁公开访问；[backend.ts](../../supabase/functions/_shared/backend.ts)使用 Auth.getUser 验证用户；业务表启用 RLS 且撤销浏览器角色直接权限 |
| AI 不直接覆盖、旧提案失效 | [客户端辅助](../../client/scene-client.ts)与数据库双重检查；应用返回 previousScene/undoGroup。完整提示词保存在 [AI_SYSTEM_PROMPT.md](../AI_SYSTEM_PROMPT.md)，实际单步撤销需前端实现 |
| 边界与重叠提示 | [domain.ts](../../supabase/functions/_shared/domain.ts)检查旋转足迹、多边形边界和重叠；人工保存返回警告，AI 新增越界被拒绝；不是施工或消防验收 |
| 异步生成与定时归档 | [worker.ts](../../supabase/functions/_shared/worker.ts)单轮提交或查询；[cron 安装脚本](../../supabase/ops/install-generation-cron.sql)每分钟触发。脚本存在不证明远端已启用或执行成功 |
| 失败、不合格、提交未知分开 | [任务状态机](../../supabase/migrations/20261002060307_scene_jobs.sql)包含 failed/rejected/submit_unknown；提交未知不自动再次收费提交；无假生成回退 |
| GLB 限额与复杂度 | [models.ts](../../supabase/functions/_shared/models.ts)限制 10 MB、100k 三角面、200 primitives、纹理尺寸及格式，校验真实二进制。required 扩展、动画、蒙皮被拒绝，真实供应商兼容性需验证 |
| 归一化、纹理与生命周期 | [models.ts](../../supabase/functions/_shared/models.ts)返回包围盒、sourceSize、groundOffset 并保留打包纹理；浏览器归一化、复制删除后的几何/材质释放不能由后端测试证明 |
| 预算与幂等 | [jobs 迁移](../../supabase/migrations/20261002060307_scene_jobs.sql)设三维 150 元/文本 30 元保守预留上限、单并发、请求指纹；不是供应商账单自动对账。300 元总预算中的托管和备用需运营记录 |
| 关闭开放注册、预置账号 | [本地配置](../../supabase/config.toml)关闭注册和匿名登录；[seed 脚本](../../scripts/seed-demo.mjs)预置两成员。本轮已独立核验远端邮箱登录启用、公开注册与匿名登录关闭，并通过真实密码登录 |
| 前端托管 | 根目录只有后端构建/测试入口；Cloudflare Pages 静态前端部署属于后续集成范围 |

## 3. 11 项验收对照

本表描述已有测试覆盖和仍需验证的表面，不把测试代码存在视为测试已经运行。

| PLAN 验收场景 | 已有证据入口 | 仍需完成的验收 |
|---|---|---|
| 真实演示闭环 | 后端项目、AI、生成、租约、发布接口均有实现，免费服务端 HTTP 闭环已验证 | 品牌沙龙完整前端流程、真实服务和手机查看；未完成产品闭环 |
| 账号隔离 | [database.test.ts](../../tests/database.test.ts)、[api.test.ts](../../tests/api.test.ts)覆盖非成员、浏览器直写和分享令牌非登录凭据 | 真实 Auth、业务 API、Storage 跨账号隔离已通过；前端账号交互待验收 |
| 编辑冲突 | [database.test.ts](../../tests/database.test.ts)覆盖第二账号/同用户第二会话、过期租约、旧代次和旧 revision | 真实独立 HTTP 会话竞争已通过；前端草稿保留与两标签页交互待验收 |
| AI 变更保护 | [domain.test.ts](../../tests/domain.test.ts)、[database.test.ts](../../tests/database.test.ts)、[api.test.ts](../../tests/api.test.ts)覆盖锁定、版本/哈希/租约变化及只应用一次 | 真实 AI 调用、人工编辑后的提案 UI 失效和单步撤销 |
| 生成真实性 | [providers.test.ts](../../tests/providers.test.ts)测试受控供应商响应和真实二进制 GLB 归档逻辑 | 真实任务记录、费用、云存储 GLB、移动旋转改尺寸及保存重开 |
| 模型生命周期 | [database.test.ts](../../tests/database.test.ts)验证删除一个副本仍保留共享资产授权 | 实际浏览器复制/删除后另一个实例持续正常绘制 |
| 物料一致性 | [database.test.ts](../../tests/database.test.ts)覆盖规格/颜色/备注分组和发布冻结 | UI 添加/删除/复制/改规格与当前画布、保存快照逐项一致 |
| 分享撤销 | [api.test.ts](../../tests/api.test.ts)覆盖发布后修改草稿、匿名读取、撤销；[database.test.ts](../../tests/database.test.ts)覆盖负责人权限 | 真实 API 发布/撤销、Storage 授权和草稿隔离已通过；客户页待前端实现 |
| 故障恢复 | [providers.test.ts](../../tests/providers.test.ts)、[jobs.test.ts](../../tests/jobs.test.ts)覆盖提交未知、失败、不合格及 worker 认领保护 | 浏览器模型失败不丢场景、刷新恢复云项目、断网未保存提示 |
| 手机与网络 | 当前根目录无设备测试记录 | 大陆普通网络下真实登录/资源/三维查看，记录设备、耗时、FPS；30 FPS/10 秒为待测目标 |
| 构建与测试 | [package.json](../../package.json)提供 TS、Vitest、Deno 类型和运行冒烟；历史边界见 [VERIFICATION.md](VERIFICATION.md) | 本轮 103 项测试、TS/Deno 检查通过；前端静态构建与部署后路径直接刷新不在根目录后端测试内 |

## 4. 本轮配置与验证状态

以下为本轮实际执行结果，覆盖上表中原先标为待验证的后端部分；前端和真实付费模型验收仍独立列出。完整运行证据见 [云端部署记录](CLOUD_DEPLOYMENT.md)。

| 项目 | 本轮状态 |
|---|---|
| 根目录 TypeScript、后端测试、Deno 类型/运行冒烟 | 8 个测试文件、103 项测试通过；TS、Deno 类型与实际运行检查通过 |
| 专用 Supabase 云项目 | 已新建 scendance-scene-planner，ref hrsrrduwbqxnqddkexoy，新加坡区 ap-southeast-1；独立于原站 |
| 迁移、私有桶、RPC 权限、远端 Auth 配置 | 四份迁移已执行；私有桶上传/签名下载/匿名拒绝已验证；浏览器角色无业务 RPC 执行权；邮箱登录启用、公开注册/匿名登录关闭 |
| scene-api / generation-worker 部署及 CORS、应用 URL | 两函数 ACTIVE v1；健康检查 200；非法 Origin 403；目标地址 https://scendance.charlestech.org，尚未发布前端 |
| 两个真实账号与工作室 | 独立工作室和两个随机密码账号已创建；真实密码登录、非成员隔离与轮流编辑通过 |
| DeepSeek / 混元凭据与费用上界 | 待用户提供可用凭据并核对当前账号可用性、单次费用上界；未配置时接口明确拒绝付费任务 |
| Vault、cron 和实际 worker 请求 | Vault 两项和每分钟 cron 已安装；凭据未齐，cron 保持 active=false。手动 Vault→pg_net→worker 请求已返回预期缺配置 503；实际定时调度和真实提供商处理尚未验收 |
| 真实服务端闭环 | 真实 Auth、独立 HTTP 会话租约竞争、Storage、保存重开、物料、不可变发布、撤销通过；免费公共 GLB 已云端校验归档。未做付费服务与前端产品验收 |

后续 M1 注册/邀请/成员移除/恢复、M2 个人素材管理/DIY/贴图/导出、M3 文稿/预算/商业验证属于 PLAN 后续里程碑，本次不以其缺失判定首版后端配置失败。
