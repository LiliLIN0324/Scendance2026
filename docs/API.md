# HTTP API 与前端接入

Base URL：`https://<project-ref>.supabase.co/functions/v1/scene-api`。
本地：`http://127.0.0.1:54321/functions/v1/scene-api`。

除 health 和分享读取外，所有请求发送 `Authorization: Bearer <Supabase Auth access_token>`。JSON 正文需 `Content-Type: application/json`，最多 256 KB。返回 `Cache-Control: no-store`。仅允许配置的 CORS origins；没有 Cookie 会话。不要把 service role key 或 worker secret 放入前端。

## 接口清单

路径中 `:id` 为项目 UUID，`:assetId/:jobId/:shareId` 同理。下表的对象均为严格字段校验，多余字段会被拒绝。数据库实体字段遵循 SQL 的 snake_case；请求、租约和发布结果使用下表 camelCase。客户端可直接导入 `client/scene-client.ts` 与 `_shared/domain.ts` 的类型/校验器。

| Method / 路径 | 正文 | 返回 |
|---|---|---|
| GET `/health` | 无 | `{ok:true,schemaVersion:1}` |
| GET `/studios` | 无 | 当前成员的工作室、角色、展示名 |
| POST `/studios` | `{requestId,name,displayName}` | 201，新增工作室 `{id,name,role:"owner",displayName}`；相同请求可重放 |
| GET `/studios/:studioId/members` | 无 | 当前工作室成员 `[{userId,role,displayName}]` |
| PUT `/studios/:studioId/members/:userId` | `{displayName}` | 负责人添加/更新已存在账号的编辑成员，返回 `{userId,role:"editor",displayName}` |
| DELETE `/studios/:studioId/members/:userId` | 无 | 负责人移除编辑成员，返回 `{removed:true}`；重复删除幂等 |
| GET `/catalog` | 无 | 8 种内置物料的 id/name/size |
| GET `/projects` | 无 | 最近 100 个可访问项目；id/name/studio_id/revision/updated_at/current_editor/lease_expires |
| POST `/projects` | `{studioId,name,scene}` | 201，项目（revision=0） |
| GET `/projects/:id` | 无 | 项目完整当前场景、物料表、编辑者 |
| PATCH `/projects/:id` | `{sessionId,generation,expectedRevision,name}` | 名称与 revision 更新后的项目 |
| POST `/projects/:id/lease/acquire` | `{sessionId}` | `{sessionId,generation,expiresAt,revision,scene}` |
| POST `/projects/:id/lease/renew` | `{sessionId,generation}` | 当前租约、revision |
| POST `/projects/:id/lease/release` | `{sessionId,generation}` | 已到期租约；不会自动保存 |
| PUT `/projects/:id/scene` | `{sessionId,generation,expectedRevision,scene}` | `{id,revision,scene,updatedAt,warnings}` |
| GET `/projects/:id/materials` | 无 | 当前保存快照的物料汇总 |
| POST `/projects/:id/proposals` | 见 AI 请求 | 201，提案；重复成功请求重放相同提案 |
| POST `/projects/:id/proposals/apply` | `{proposalId,sessionId,generation,expectedRevision,localRevision,currentScene}` | `{id,revision,scene,updatedAt,previousScene,undoGroup}` |
| POST `/projects/:id/publish` | `{expectedRevision}` | 201，`{shareId,publicationId,revision,createdAt,url,token}` |
| GET `/projects/:id/shares` | 无 | 分享 ID、发布版本和撤销状态；不返回明文 token |
| DELETE `/projects/:id/shares/:shareId` | 无 | `{revoked:true}`，重复撤销幂等 |
| POST `/share/read` | `{token}`，匿名 | 发布名称、时间、场景、去除内部备注的物料表和带短期 URL 的资产 |
| GET `/assets` | 无 | 最近 100 个本人资产；不返回存储路径 |
| POST `/assets/:assetId/url` | 无 | 已授权资产信息 + `url/expiresIn:300` |
| POST `/assets/floorplan` | PNG/JPEG 二进制，Content-Type 对应图片 | 201，私有图片资产；<=5MB、4096像素 |
| POST `/catalog/recommendations` | `{theme,scene}` | 最多 8 条真实公共素材（名称、缩略图、来源、许可、导入体积预检） |
| POST `/assets/import` | `{modelId}` | 201，打包并归档后的 Poly Haven GLB 资产 |
| POST `/jobs` | `{requestId,prompt}` | 202，持久化生成任务；幂等重放为200 |
| GET `/jobs` | 无 | 最近 100 个本人任务 |
| GET `/jobs/:jobId` | 无 | 任务真实状态、provider_job_id、asset_id、错误与 usage；不暴露 worker token |
| POST `/jobs/:jobId/added` | `{projectId}` | 确认资产已存在于保存的项目后标记 added |

`GET /projects` 和 `/assets` 当前固定返回最近 100 项，尚无分页 UI；演示账号范围下足够，扩大团队规模前增加游标分页。

v0.4.1 公共模型目录随前端完整提供，不依赖 `/assets` 的本人最近 100 项列表。管理员用 `register_library_asset(p_owner,p_model_id,p_record)` RPC 批量登记后，工作室成员通过原 `/assets/:assetId/url` 和场景保存接口使用这些模型。RPC 仅 service_role 可调用；原 `/assets/import` 仍只导入 Poly Haven。登记、授权范围与上线顺序见 [v0.4.1 兼容记录](V041_COMPATIBILITY.md)。

## 场景契约

```json
{
  "schemaVersion": 1,
  "venue": {
    "shape": "rectangle",
    "width": 12,
    "depth": 10,
    "height": 3,
    "entrances": [
      {"id":"40000000-0000-4000-8000-000000000001","position":{"x":0,"z":5},"width":1.2}
    ]
  },
  "objects": [
    {
      "id":"50000000-0000-4000-8000-000000000001",
      "materialId":"chair",
      "position":{"x":3,"z":3},
      "rotation":0,
      "size":{"width":0.5,"depth":0.5,"height":0.85},
      "color":"#ffffff",
      "locked":false,
      "notes":"内部准备备注"
    }
  ],
  "camera":"overview",
  "lighting":"neutral"
}
```

- 全部米制；地面为 XZ，Y 竖直，落点在地面；rotation 是绕 Y 轴的角度（-360 至 360）。平面原点为场地包围矩形的左下角，x 在 `[0,width]`、z 在 `[0,depth]`。
- `shape=polygon` 增加 `polygon:[{x,z},...]`，3–32 个不重复、不自交顶点，范围不能超出 width/depth。矩形不附 polygon。出入口点必须在边界上。
- 图片上传后可在 venue 添加 `floorplanAssetId`，作为参考图保存，不自动识图重建；客户发布不含此私人图片。
- 物件尺寸上限 width/depth=200m、height=30m；场景最多50个对象。UUID 稳定且不能重复。
- 内置 materialId：`chair/table/reception/backdrop/display/partition/carpet/decoration`。
- 外部资源使用 `materialId:"asset"`，必须携带 `assetId`；内置物料不得携带 assetId。
- `camera`: overview/top/customer；`lighting`: neutral/warm/cool。
- 客户只读场景刻意不含内部 `notes`；客户端如需用统一 schema 解析，notes 会被补为空字符串。
- 上传物料/项目名称没有任意 HTML 语义，前端用文本节点展示。

## 前端最小接法

使用发布密钥创建 Supabase 客户端，调用 `auth.signInWithPassword`，再把当前 access token 交给业务辅助客户端：

```ts
const api = createSceneClient(
  `${SUPABASE_URL}/functions/v1/scene-api`,
  async () => (await supabase.auth.getSession()).data.session?.access_token ?? null,
);
// getSession 仅用于取本地 token；服务端会独立调用 getUser 验证。
const studios = await api.request('/studios');
```

### 工作室与成员

个人工作室由账号确认流程自动创建；`POST /studios` 用于用户明确新增工作室，不能在每次页面加载时调用。创建前生成一次 `requestId=crypto.randomUUID()`，网络失败重试时复用同一个 ID 和正文；改名或修改展示名后重用该 ID 会返回 `409 IDEMPOTENCY_CONFLICT`。工作室名称最多 120 字，成员展示名最多 80 字，均会去除前后空白。

任一成员可查看本工作室的成员列表；只有负责人可按对方已有账号的 UUID 添加或移除编辑成员。账号 ID 可由前端当前 Auth session 展示给本人复制；这里不搜索邮箱、不创建 Auth 账号、不发送邀请邮件。不能通过此接口提升角色、变更或移除负责人；返回 `OWNER_PROTECTED`。不存在的账号返回 `404 USER_NOT_FOUND`；非成员读取/管理工作室返回 `404 STUDIO_NOT_FOUND`。

移除成员会立即作废该成员在工作室项目中的编辑租约；保存的项目、发布分享及已授予项目的资产引用保留。成员本人资产仍归本人，负责人若需停止客户访问应另行撤销相应分享。重新添加成员不会恢复旧租约代次，需要重新获取编辑权。

进入一次编辑会话生成 `crypto.randomUUID()`。不要用账号 UUID 代替 sessionId，也不要把同一个编辑会话 ID 复制到多个标签页。获取租约后使用返回场景/云端 revision，清空旧历史；每30秒续期。保存成功只更新返回的新 revision，不凭前端加一推测。失去租约/断网时保留当前草稿和未保存提示。

### AI 请求和应用

```json
{
  "requestId":"60000000-0000-4000-8000-000000000001",
  "sessionId":"30000000-0000-4000-8000-000000000001",
  "generation":1,
  "expectedRevision":0,
  "localRevision":7,
  "scene":{},
  "instruction":"安排20人的暖色坐席沙龙",
  "mode":"layout",
  "selectedIds":[]
}
```

此处 `scene` 必须替换为上述完整场景，不是空对象。`mode` 为 layout 或 modify。每次本地操作（包括撤销/重做、颜色、锁定、场地调整）递增 localRevision。等待 AI 时可编辑；发生变化则旧提案不能应用。仅用户确认后调用 `api.applyProposal(proposal,currentState)`。

应用发起后短暂冻结编辑，直到返回结果；将 `previousScene → scene` 作为一个历史条目。撤销时恢复 previousScene，再正常保存（会产生新的云端 revision，不回退计数器）。前端不能把提案解释文本当作已完成保存。

### 模型预览/加入

生成任务 ready 或公共素材导入成功后，请求 `/assets/:id/url` 加载 GLB。预览确认后由用户设定整体 width/depth/height，按资产 metadata 中的包围盒归一化，构造新的 `materialId:"asset"` 实例。通过普通场景保存提交，再标记任务 added。预览/复制/删除实例不删除共享文件。

### 分享

发布只接受云端已保存 revision。返回的 token 仅此时展示；在前端保存/复制链接。丢失后重新发布生成新链接，不能从哈希恢复。查看页从 `location.hash` 读 token，调用 POST `/share/read`，不要把 token 放到 query、日志或第三方分析服务。

资源 URL 有效5分钟；需要刷新时重新请求 share/read，由服务器重新检查撤销。撤销不能收回已下载内容或立即使已签发资源 URL 失效。只读页不要加载工作台编辑能力，也不要显示内部备注。

## 错误语义

统一返回 `{"error":{"code":"...","details":...}}`，无原始数据库/提供商异常堆栈。

| 状态 | 典型 code | 客户端行为 |
|---|---|---|
| 400 | VALIDATION_ERROR / INVALID_JSON | 展示字段问题，不自动提交 |
| 401 | UNAUTHENTICATED | 重新登录，保留本地草稿 |
| 403 | FORBIDDEN / ORIGIN_FORBIDDEN | 不允许对应操作 |
| 404 | PROJECT_NOT_FOUND / ASSET_NOT_FOUND / SHARE_NOT_FOUND | 同时用于无访问权和资源不存在，避免枚举 |
| 409 | LEASE_LOST / REVISION_CONFLICT / STALE_PROPOSAL / IDEMPOTENCY_CONFLICT | 保留草稿、停止自动保存，重新获得租约/更新提案 |
| 413 | FILE_TOO_LARGE | 更换或优化模型 |
| 422 | AI_INVALID_PROPOSAL / OUT_OF_BOUNDS / MODEL_TOO_COMPLEX | 显示具体问题；不能当作成功 |
| 429 | GENERATION_BUSY / AI_BUSY / BUDGET_EXCEEDED | 等任务结束或人工核对预算，不更换幂等键重试付费提交 |
| 502/503 | PROVIDER_HTTP_ERROR / SERVICE_NOT_CONFIGURED / BILLING_NOT_CONFIGURED | 保留现有场景，报告服务不可用 |

数据库业务冲突主要为409；AI 校验问题为422。提交付费任务必须在一次用户意图内复用同一个 requestId，网络重试不能生成新 UUID。

## DeepSeek 每日预算

AI 提案接口按北京时间执行全站共享的 10 元日预留上限；每次提供商调用（含修复）先预留 0.20 元。超额返回 `429 DAILY_BUDGET_EXCEEDED`，重复 attempt 拒绝再次发出模型请求；输入过大返回 `413 AI_INPUT_TOO_LARGE`。现有场景/提案 JSON 契约不变，客户端不能指定限额、费用或日期。详细语义见 [每日预算记录](DEEPSEEK_DAILY_LIMIT.md)。
