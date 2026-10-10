# Supabase 业务接入契约

场景类型与校验真源：`supabase/functions/_shared/domain.ts`。HTTP 完整协议见 [API.md](../API.md)。工作室业务不负责账号注册、邮件或会话签发。

| 请求 | 输入 | 输出及权限 |
|---|---|---|
| POST `/studios` | `{requestId,name,displayName}` | 当前用户成为新工作室 owner；同一请求 UUID 和内容幂等重放 |
| GET `/studios/:id/projects` | 无 | 当前工作室成员可读当前工作室全部项目，按更新时间排列，不受全局最近 100 个项目限制 |
| PATCH `/studios/:id` | `{name}` | 仅 owner 重命名，返回工作室；ID、项目归属和成员不变 |
| DELETE `/studios/:id` | 无 | 仅 owner 删除空工作室及成员关系，返回 `{removed:true}`；非空返回 `STUDIO_NOT_EMPTY` |
| GET `/studios/:id/members` | 无 | 当前工作室成员可读 `{userId,role,displayName}[]` |
| PUT `/studios/:id/members/:userId` | `{displayName}` | owner 添加已有账号为 editor 或更新显示名；不可改 owner |
| DELETE `/studios/:id/members/:userId` | 无 | owner 移除 editor 并同步废止其全部工作室租约 |
| DELETE `/projects/:id` | `{expectedRevision}` | 工作室 owner 删除空闲项目，幂等返回 `{deleted:true}`；撤销分享、过期提案，保留账单证据与个人素材 |

账号 ID 由已登录用户提供；不存在用户返回 `USER_NOT_FOUND`，无成员资格工作室返回 `STUDIO_NOT_FOUND`，负责人不可修改/删除返回 `OWNER_PROTECTED`。浏览器不能直接执行 `studio_rpc`。

项目删除在同一项目行锁内校验版本、有效编辑租约及执行中的重建任务。分别以 `REVISION_CONFLICT`、`PROJECT_BUSY`、`RECONSTRUCTION_BUSY` 阻止删除；前端只有成功响应后才从列表移除，并保留本地草稿。需要先发布数据库迁移，再发布 API；没有迁移的线上环境尚不具备删除能力。

前端共享 `BackendSession.businessRequest<T>` 取得现有会话 token。它不自动重试写请求，普通素材/成员请求错误不抢占编辑流程，401/租约丢失/版本冲突继续触发写保护。`renameProject` 必须携带有效租约和 expectedRevision，并使用后端返回版本。

跨工作室操作期间固定选择器；异步响应不能渲染到另一工作室。项目 URL 必须与成功打开的项目一致。同项目恢复存在未保存画布时保留本地改动，不用保存快照静默替换。

工作室是项目归属和成员权限的唯一边界，项目内的参与人员继承该工作室全部成员，不新增项目级角色。工作室删除在数据库中锁定工作室行并检查项目，项目外键阻止并发创建时误删；删除不删除账号，也不自动迁移或级联删除项目。浏览器须先完成内容加载才允许删除，并输入工作室名称确认；后端仍独立检查 owner 与非空状态。

首次确认邮箱时仍自动创建个人工作室。用户主动删除最后一个工作室后，后续账号更新不再自动重建；可通过创建工作室入口重新开始。
## 场景 Agent 资源契约

AI 输入与应用仍使用既有租约/修订协议。服务器提供受权限约束的资源索引，模型仅返回资源引用；新增资源命令、可选 `modelSuggestions` 响应与 HY3 转接行为见 [API.md](../API.md#binggo-资源-agent)。不新增数据库字段、公开 RPC 或客户端可指定的资产授权。
