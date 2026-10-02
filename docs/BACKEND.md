# 后端设计

## 范围与验收边界

依据 `/Users/lwc/Downloads/PLAN.md`，采用 v0.2 的活动工作室定位，覆盖其中服务端职责。前端三维编辑器、撤销 UI、移动端渲染和大陆网络实测属于后续联调。本次没有改动旧原型，也未将旧的私人聚会范围作为实现基线。

成功标准：迁移可执行；非成员不能访问项目；浏览器不能绕过租约写库；保存具有版本冲突保护；AI 只能生成受控提案；生成任务可恢复且幂等；发布不泄漏草稿和内部备注；撤销阻止新的分享和资源授权。

## 请求与信任边界

```text
浏览器 ── Supabase Auth 登录 ── access_token
  │
  └── scene-api ── Auth.getUser(token) ── service_role RPC
                                               │
                            scene_private 表、成员检查、行锁、版本检查
                                               │
                  DeepSeek / Hunyuan / Poly Haven / 私有 Storage

Vault + pg_cron ── 独立 worker secret ── generation-worker
客户 /view/#token ── POST share/read ── 哈希与撤销检查 ── 发布快照 + 5分钟资源 URL
```

`verify_jwt=false` 是为了允许匿名分享，并支持服务内用 `getUser` 验证 Auth token；它**不代表业务接口免认证**。仅 `/health` 和 `/share/read` 允许匿名。worker 使用另一枚独立随机密钥。

所有业务表位于不暴露给 Data API 的 `scene_private` schema，启用 RLS、撤销 `anon/authenticated` 的权限，不建立浏览器写策略。公开 schema 中仅有供 `service_role` 执行的 `SECURITY INVOKER` RPC，显式撤销 PostgreSQL 默认的 `PUBLIC EXECUTE`。调用者 UUID 来自 Edge 验证，不能从 HTTP 请求正文指定。没有 `SECURITY DEFINER` 提权函数，也不使用用户可编辑 metadata 授权。

这是服务端集中鉴权的设计：成员隔离由 RPC 内的成员谓词实现，RLS 和 schema ACL 阻止浏览器旁路。它不是浏览器直接访问业务表的 RLS 客户端方案。

## 数据表

| 表 | 用途 |
|---|---|
| studios / members | 工作室、负责人/编辑成员、展示名；预置真实 Auth 用户 |
| projects | 名称、当前 JSON 场景、revision、编辑者/会话/代次/到期时间 |
| materials | 8 类稳定物料编号、名称、默认米制尺寸 |
| assets | 所有者、来源/许可记录、不可覆盖的 Storage 路径、哈希、格式、尺寸与归一化信息 |
| project_assets | 已获准在项目中使用的资源；保留引用授权，保证已发布版本可以继续打开 |
| publications | 不可变场景、物料表、资源 ID 清单、标题与发布时间 |
| shares | 随机令牌的 SHA-256 哈希、发布版本、撤销时间；不保存明文令牌 |
| proposals | 本地场景快照及哈希、云端/本地版本、编辑会话、候选结果、过期/应用时间 |
| generation_jobs | 提供商任务 ID、任务状态、worker 认领代次、结果资产、错误和积分记录 |
| requests / budgets | 请求幂等键、指纹、保守费用预留、返回结果与可核对的使用量 |

没有开放注册/邀请、支付、自动采购、实时多人编辑接口。`provision_demo_studio` 只供管理员初始化两个独立账号。

## 事务规则

项目行是编辑事务的锁定点。获取、续期、交接、保存、发布、提案应用均锁定同一项目行，避免“先检查后写入”竞态。远端 HTTP 调用在数据库事务之外执行。

- 租约 90 秒；前端每 30 秒续期。一次浏览器编辑会话用一个新的 UUID，不能跨标签页复用。
- 同用户同会话在有效期内重复获取为幂等；过期或交接后增加代次，防止旧请求复活。
- 保存同时校验成员、会话、代次、未过期和 `expectedRevision`，再更新场景及 revision。
- 续期只延长当前有效租约，不能复活过期代次。释放不会自动保存。
- 前端遇到 `409` 必须保留本地草稿。重新获取编辑权时载入返回的最新场景并清空旧撤销历史。
- 项目创建者或工作室负责人可发布/撤销；普通编辑成员不能发布他人创建的项目。
- 发布校验已保存 revision；每次创建独立发布和新链接，不修改旧版本。

## AI

初稿模板为坐席沙龙、开放交流。AI 选择模板、人数和配色，代码生成分区坐标；初稿接口仅对空场景使用，放不下就返回具体错误，不缩小尺寸蒙混通过。

修改只允许添加、删除、移动、旋转、换色、替换内置物料。锁定对象禁止修改；Zod 使用严格字段校验；非法结果最多一次修复，第二次仍不合法就失败。手动保存可保留越界对象并返回警告，AI 新提案不得引入越界。重叠仅为布置提示，不构成施工安全判断。

AI 返回不会直接保存。提案绑定当前云端 revision、本地 revision、场景哈希和租约代次，10 分钟过期。确认应用时再次验证，一次事务提交，并返回 `previousScene` 和 `undoGroup` 供前端做一个撤销条目。后端无法知道客户端未提交的状态变化，因此前端必须正确递增 localRevision，并传入当前场景；辅助函数 `assertFreshProposal` 已实现这个检查。完整提示词见同目录文档和 `_shared/ai.ts`。

## 生成任务和预算

```text
queued → submitting → submitted → processing → archiving → ready → added
             └→ submit_unknown        └→ failed / rejected
```

`submitting` 由数据库先认领再请求提供商。超时、无法解析响应、提交后的崩溃均保留未知状态，绝不自动创建第二个付费任务。未知任务会占用唯一并发位，管理员核对提供商记录后才能解除。轮询认领带 token 和 4 分钟有效期，旧 worker 不能覆盖新 worker。

服务只提交异步任务、查询和归档，不在一个 Edge 请求里持续等模型完成。定时器每分钟取一个任务；任务和提供商 ID 均在数据库中，关闭页面不影响任务恢复。归档期间崩溃可重新查询提供商并写入同一个内容哈希路径。原文件不覆盖、实例不删除共享资产。

预算按最保守预留计：三维 15,000 分、文本 3,000 分。单次三维最大费用和包含一次修复的 AI 请求最大费用必须先由运营依据实际账号定价配置，空值禁止发起。`committed_cents` 包含未完成/未知/失败任务的预留；不自动退款，不将预留说成实际扣费。提供商积分或 token usage 单独保存；`actual_cents` 仅供人工账单核对。此实现不负责控制 Supabase 托管费、账号在其他应用的支出或提供商超出已核定单价的计费。

## 资产

公共模型接入 Poly Haven 的真实目录和 1K glTF 文件，依据主题、已有物料排序，先检查格式和预计体积，再按用户选择导入。中文常用物料词映射到检索词。未命中返回空列表，不生成虚构素材。推荐并不代表已满足场地尺寸，加入时按用户指定的大小运行场景边界检查。

导入时只下载固定提供商域名，禁止重定向、任意 URL、外部 GLB 资源。保留 glTF JSON 和纹理，打包 GLB。归档门槛：10 MB、10 万三角面、200 个绘制 primitive、500 节点、64 材质、32 张纹理，纹理仅 PNG/JPEG 且不超过 2048 像素。骨骼、动画、必需扩展/压缩超出首版加载能力时明确拒绝。Khronos validator 检查结构与索引，再用 glTF Transform 读取并计算包围盒；这不能替代浏览器和手机的实际渲染验收。

原始纹理与 GLB 保留，返回 `sourceSize` 和 `groundOffset`。前端需把模型放到内层组施加偏移，外层按 `目标尺寸 / sourceSize` 逐轴缩放，再施加实例旋转和平移；不要直接对原模型忽略已有节点变换。实例复制共享 assetId，不发起 Storage 删除。

个人素材列表只返回本人资产。项目成员只可访问自己或其项目曾引用的资源，不能浏览他人的整个素材库；客户只收到发布清单中的 GLB，不包含私人平面图或内部备注。

## 官方资料核查

2026-10-02 核对了以下资料。Supabase 近期 PostgreSQL 15.19/17.11 breaking changes 涉及旧 pgcrypto 密码、ltree 等，本实现没有使用相关功能。

- [Supabase Edge Auth](https://supabase.com/docs/guides/functions/auth)
- [Supabase 定时 Edge Functions](https://supabase.com/docs/guides/functions/schedule-functions)
- [Supabase Storage 下载](https://supabase.com/docs/guides/storage/serving/downloads)
- [Supabase PostgreSQL 变更](https://supabase.com/changelog/postgres-15-19-17-11-breaking-changes)
- [DeepSeek JSON 模式](https://api-docs.deepseek.com/guides/json_mode/)
- [腾讯 OpenAI 兼容提交/查询](https://cloud.tencent.com/document/product/1804/126189)
- [腾讯 3.0 LowPoly 参数](https://cloud.tencent.com/document/api/1804/123447)
- [腾讯查询结果字段](https://cloud.tencent.com/document/api/1804/123448)
- [Poly Haven API](https://polyhaven.com/our-api)、[许可](https://polyhaven.com/license)

腾讯适配器默认使用 `HUNYUAN_API_MODE=tokenhub`，端点为 `https://tokenhub.tencentmaas.com/v1/api/3d`，通过 Bearer key 调用 `hy-3d-3.0 / LowPoly / triangle`。仅既有旧平台账号可显式选择 `legacy`，对应 `api.ai3d.cloud.tencent.com`；没有自动跨平台重试。当前实现已按官方请求格式测试，真实账号权限、任务结果与费用仍待凭据配置后验收。

任务记录没有保存提供商模式。存在未完成或提交结果未知的任务时，不得切换 `HUNYUAN_API_MODE`；须先核对并处理既有任务，避免用另一平台查询旧任务或重复付费提交。配置步骤见 [供应商指南](PROVIDER_SETUP.md)。
