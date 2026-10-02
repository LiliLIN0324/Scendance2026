# 前端 v0.3：现有协议与后端支持需求

更新日期：2026-10-02。交接对象：后端负责人 B。文件名沿用 v0.2，以保留已有链接；内容已更新到 v0.3。

本轮只修改 `frontend/` 与文档，没有修改 `supabase/`、数据库、`client/scene-client.ts` 或根依赖。**“现有协议”可在代码中核对；“建议协议”尚未实现，不得向现有 API 直接发送新增字段。** B 先确认并更新共享 schema，A 再接线。

## 一、v0.3 七项要求与当前边界

| 要求 | 前端当前实现／本轮落地位置 | 现有后端能力与缺口 |
| --- | --- | --- |
| 1. 图片 input | 物料区“现场照片（选填）”，与场地情况、活动需求一起填写。PNG/JPEG/WebP，最多 3 张、单张 5 MiB、宽高各不超过 4096；本机 blob 预览 | **未上传、未识别，刷新需重选**。现有 `/assets/floorplan` 仅是 PNG/JPEG 底图存储；需新增项目现场照片、授权、处理状态、删除和真实视觉输入 |
| 2. UI 配色 | 页面配色由前端 CSS 控制，与客户活动方案的配色偏好区分 | CSS 无需新后端接口。实际物件 color 可存 Scene，活动配色说明需另随需求保存；不能混同网页主题和场景颜色 |
| 3. 风格要求 | 需求区填写场地情况、风格、配色、氛围，作为完整需求发送；缺物料和规格差异保守提示，替代须确认 | 现有 instruction 可接受文字；Scene 没有 style/brief/palette 字段。需结构化需求持久化、能力匹配、未满足项和确认记录 |
| 4. 登录介绍页 | 介绍产品用途，可登录工作室或进入本地体验，与工作台共用会话 | 沿用 Supabase Auth 和 studio/project/lease 权限；需要真实工作室账号、Origin 和公开配置，不另造登录 API |
| 5. 右下角助手 | 文字布置／修改提案，保留完整需求、已确认决定、近期对话、最近提案说明及当前请求；先确认再应用 | 当前只有 proposal 入口，尚无通用问答或永久会话服务；需区分纯建议与修改提案，保存上下文版本和真实图像输入 |
| 6. 3D 优先 | 主要结果是可编辑三维场地；候选差异只临时预览。物料区保持独立物料列表，不提供额外桌椅组合入口 | Scene、GLB 授权、原子应用已存在。完整创意布局及扩展资产待补，不能只回效果图便声称完成可编辑 3D |
| 7. 灯光氛围 | 真实灯光、阴影；自然／暖／冷映射 neutral/warm/cool，经 RoomLayout.backendLighting 保存 | adapter 映射 Scene.lighting，现有本地／云 Scene 保存可承载三个枚举。灯串、灯具位置、HDRI、时间和强度需要新资产或协议 |

风格、配色说明、场地文字与对话属于前端上下文，不能视作已经云存储的项目需求。实际物件颜色与 lighting 可以随 Scene 保存；填写“暖色串灯”不等于已生成／保存串灯资产。当前不往严格 Scene 塞新增表单字段。

## 二、现有协议：以实现为真源

真源：`supabase/functions/_shared/domain.ts`、`api.ts`、`ai.ts`、`client/scene-client.ts` 和 `supabase/migrations/`；前端包装层为 `frontend/lib/backend-session.ts`。

业务基址 `<SUPABASE_URL>/functions/v1/scene-api`。登录用 `/auth/v1/token?grant_type=password` 和公开 anon/publishable key；业务请求带用户 `Authorization: Bearer <access_token>`。service-role、模型 key、worker secret 不进入前端。

| 现有接口 | 真实字段与返回 |
| --- | --- |
| `GET /studios`、`GET /projects`、`GET /projects/:id` | 成员工作室、可见项目及 Scene；项目使用 studio_id 等实际数据库字段 |
| `POST /projects` | `{studioId,name,scene}` → 项目；name 不在 Scene 内 |
| `PATCH /projects/:id` | `{sessionId,generation,expectedRevision,name}`；不是任意元数据更新接口 |
| `POST /projects/:id/lease/acquire` | `{sessionId}` → `{sessionId,generation,expiresAt,revision,scene}` |
| `POST .../lease/renew`、`.../release` | `{sessionId,generation}`；现有租约约 90 秒，前端约 30 秒续期 |
| `PUT /projects/:id/scene` | `{sessionId,generation,expectedRevision,scene}` → `{id,revision,scene,updatedAt,warnings}` |
| `POST /projects/:id/proposals` | `{requestId,sessionId,generation,expectedRevision,localRevision,scene,instruction,mode,selectedIds}`；前端还传与路径一致的 projectId。instruction 最多 3000 个 JavaScript 字符；mode=layout/modify |
| `POST .../proposals/apply` | `{proposalId,sessionId,generation,expectedRevision,localRevision,currentScene}` → `{id,revision,scene,updatedAt,previousScene,undoGroup}`。应用已原子保存，不再多保存一遍 |
| `GET /catalog`、`GET /assets`、`POST /assets/:id/url` | 真实目录、资产、短期授权；授权包含资产元数据、url、expiresIn=300。正式 Scene 只持久化稳定 assetId |
| `POST /assets/floorplan` | PNG/JPEG 原始字节；最大 5 MiB、宽高各不超过 4096；是底图存储，不是照片理解 |
| `POST /jobs` | `{requestId,prompt}`，prompt≤1024；返回单体资产生成任务，通常 HTTP 202，非整套场景 |
| `GET /jobs`、`GET /jobs/:id`、`POST /jobs/:id/added` | added 传 `{projectId}`；资产必须已出现在保存的 Scene。service 已封装，本版无独立单体生成 UI |

Scene 为严格 `schemaVersion:1`，只包括 venue、objects、camera、lighting。每个物件保存 UUID、materialId、可选真实 assetId、XZ 位置、角度、米制尺寸、color、locked、notes。内置仅 chair/table/reception/backdrop/display/partition/carpet/decoration；asset 必须有资产 UUID。物件上限 50，camera=overview/top/customer，lighting=neutral/warm/cool，未知字段会被拒绝。

现有 layout 只适用于空场景，模型选择 salon/networking 两种程序模板，人数 1–40；modify 只有 add/remove/move/rotate/recolor/replace 等有限指令。前端不清空画布来绕过 layout 限制，也不把 table 重命名为帐篷。非空场景的整体重规划尚无专门意图。

### 现有请求／响应示例

UUID 和时间是文档示例，不代表真实项目。以下是合法的文字 modify 场景；不要把单把椅子的例子当完整创意方案。

```http
POST /projects/10000000-0000-4000-8000-000000000001/proposals
Authorization: Bearer <用户 access_token>
Content-Type: application/json
```

```json
{
  "projectId":"10000000-0000-4000-8000-000000000001",
  "requestId":"20000000-0000-4000-8000-000000000001",
  "sessionId":"30000000-0000-4000-8000-000000000001",
  "generation":3,"expectedRevision":4,"localRevision":2,
  "mode":"modify","selectedIds":[],
  "instruction":"添加一把椅子，先返回提案。本次未提交图片，不得声称读图。",
  "scene":{
    "schemaVersion":1,
    "venue":{"shape":"rectangle","width":12,"depth":10,"height":3,"entrances":[]},
    "objects":[],"camera":"overview","lighting":"warm"
  }
}
```

成功响应使用数据库的 snake_case；不是 `{scene,message}`。base_hash 为规范化 base_scene 的 SHA-256，当前有效期约 10 分钟：

```json
{
  "id":"40000000-0000-4000-8000-000000000001",
  "project_id":"10000000-0000-4000-8000-000000000001",
  "user_id":"50000000-0000-4000-8000-000000000001",
  "session_id":"30000000-0000-4000-8000-000000000001",
  "generation":3,"base_revision":4,"local_revision":2,
  "base_hash":"a52a46ac1db79b01318baeefea91c61235c61bd7e344b1ee23b37950becdf164",
  "base_scene":{
    "schemaVersion":1,
    "venue":{"shape":"rectangle","width":12,"depth":10,"height":3,"entrances":[]},
    "objects":[],"camera":"overview","lighting":"warm"
  },
  "candidate":{
    "schemaVersion":1,
    "venue":{"shape":"rectangle","width":12,"depth":10,"height":3,"entrances":[]},
    "objects":[{
      "id":"60000000-0000-4000-8000-000000000001","materialId":"chair",
      "position":{"x":2,"z":3},"rotation":0,
      "size":{"width":0.5,"depth":0.5,"height":0.85},
      "color":"#ffffff","locked":false,"notes":""
    }],"camera":"overview","lighting":"warm"
  },
  "explanation":"新增一把椅子，尚未应用，请核对位置。",
  "warnings":[],"expires_at":"2026-10-02T10:10:00Z","applied_at":null
}
```

确认应用传 proposalId、生成时对应的 currentScene 以及租约／云版本／本地版本。返回 previousScene 为提案前场景，undoGroup 为提案 ID；没有 warnings 字段。前端额外的 acceptedLocally 是本地保护标志，不是后端 JSON：请求期间发生新编辑时，不能用旧响应覆盖草稿。

## 三、建议新协议：B 评审后再实现

本节 endpoint、类型和错误码均为**提案**，尚不能调用。建议与 v1 分开版本化，由共享 schema 统一定义，避免第二份自行生效的协议。

### 1. 能力声明与请求状态

建议 `GET /capabilities` 响应合同版本、功能开关、物料与限制，实际部署后才将功能改为 true：

```json
{
  "contractVersion":2,
  "features":{"sitePhotoStorage":false,"imageUnderstanding":false,"creativePlanning":false,"assistantConversation":false},
  "limits":{"instructionCharacters":3000,"maxSceneObjects":50,"maxGuests":40,"maxPhotos":3,"maxPhotoBytes":5242880,"maxImageEdge":4096},
  "supportedMaterialIds":["chair","table","reception","backdrop","display","partition","carpet","decoration"]
}
```

建议增设按用户／项目隔离的 AI 请求状态查询，用同一 requestId 找回不确定结果。重复点击不重复付费；未知失败不自动换 ID 重试。已知成功但提案过期后，用户主动再生成可开启新逻辑请求；相同 ID 搭配不同请求体继续返回幂等冲突。

### 2. 需求、风格、配色与氛围持久化

建议 `PUT /v2/projects/:id/design-brief`，与项目 revision 共用事务：先检查租约与版本，修改后使旧提案失效，不另开绕过租约的写入口。请求示例：

```json
{
  "requestId":"70000000-0000-4000-8000-000000000001",
  "sessionId":"30000000-0000-4000-8000-000000000001",
  "generation":3,"expectedRevision":4,
  "brief":{
    "eventType":"品牌快闪","guests":24,
    "description":"产品体验与小组交流，保留宽敞通道。",
    "mustHave":"帐篷交流区、签到与产品展示。",
    "venueConditions":"左侧有固定柱子，入口位于南侧；尺寸由用户确认。",
    "style":"自然、轻露营；不用奢华装饰。",
    "palette":{"description":"米白与森林绿","colors":["#f5f1e8","#365a44"]},
    "atmosphere":{"description":"傍晚暖光，不刺眼","lightingPreset":"warm"},
    "allowIdeas":true,"photoIds":[],
    "materialDecisions":[{
      "requirementKey":"tent","requestedLabel":"帐篷",
      "decision":"keep_unfulfilled","replacementMaterialId":null,
      "acceptedAt":"2026-10-02T10:00:00Z"
    }]
  }
}
```

建议响应 `{projectId,revision,brief,updatedAt}`，回传规范化完整 brief，项目读取也返回它及其版本。明确选择替代时 decision=replace，记录真实 replacementMaterialId 或资产 ID、原要求及差异；只同意“先生成支持部分”不能被当作接受具体替代。

- **意图层**：style、palette 说明、atmosphere 说明、场地文字保存在项目需求，重开恢复，不假称已转换成渲染效果。
- **场景层**：实际 objects[].color 和 Scene.lighting 随 Scene 保存；风格文字改变不直接改正式物体，必须先提案后确认。
- **灯光层**：当前三个枚举已可保存。灯串、灯具布点及更丰富 environment 参数须扩展协议，并参与提案哈希和版本检查。
- **页面层**：网页主题由前端管理，不误写为客户场景 palette 或物件颜色。

### 3. 现场照片存储、授权和分析

建议与 GLB／底图分用途管理，使用项目范围私有存储。B 可选择经过边界校验的 multipart 上传或如下两阶段协议，但应保留状态及权限语义。

`POST /v2/projects/:id/site-photos` 请求和建议响应：

```json
{"requestId":"80000000-0000-4000-8000-000000000001","fileName":"venue-south.jpg","contentType":"image/jpeg","sizeBytes":245760}
```

```json
{
  "photoId":"90000000-0000-4000-8000-000000000001","status":"awaiting_upload",
  "upload":{"method":"PUT","url":"https://storage.example.invalid/temporary-upload","expiresIn":120,"maxBytes":5242880}
}
```

URL 是示例占位域名。上传后 `POST /v2/projects/:id/site-photos/:photoId/complete` 校验真实字节、格式和尺寸，建议返回：

```json
{
  "photoId":"90000000-0000-4000-8000-000000000001",
  "projectId":"10000000-0000-4000-8000-000000000001",
  "purpose":"site-photo","status":"ready","contentType":"image/jpeg",
  "width":1600,"height":1200,"sizeBytes":245760,"analysisStatus":"not_requested"
}
```

存储及生命周期要求：

1. 服务端复核数量、实际字节、MIME、尺寸；若视觉模型不接受 WebP，明确转换结果，不能假称原图已发送。
2. 记录上传者、工作室、项目、purpose、内容 hash、尺寸和状态。模型请求只引用经授权 photoIds，不接受浏览器 blob URL 或任意外链。
3. 浏览器通过短期授权 URL 查看；brief/Scene 只存稳定 ID，不存签名 URL、Base64 大图或 File 对象。日志和响应不得泄露 key。
4. 文件状态区分 awaiting_upload/validating/ready/failed；分析状态另分 not_requested/queued/processing/succeeded/failed。上传成功不等于识别成功。
5. 提供列举、移除和重新授权。B 明确未完成上传清理期限、软删除／正式删除期限，以及仍被项目／发布版本引用的保留规则。移除照片让依赖旧照片的提案失效，不能只撤掉缩略图。
6. 分析结果包含 findings、对应 photoId 及不确定项。门窗、柱子、固定设施先供用户确认；普通照片不直接宣称精确米制尺寸，尺寸仍需填写或专门标定。

建议独立 `POST /v2/projects/:id/site-analyses`，输入 photoIds、已知场地尺寸和幂等 ID，输出任务 ID／状态。只有实际 succeeded 的识别结果参与规划；未发送、失败或处理中的照片不能被助手描述为“已看过”。

### 4. 助手上下文与完整创意规划

现有 v1 仍只接 instruction。前端 `frontend/lib/assistant-context.ts` 拼接完整需求、**已确认**的物料决定、最近提案说明、近期对话与本轮消息。预算不足时仅从最旧开始整条删除对话，并返回 omittedHistory 给 UI 提示；完整需求、决定、最近提案说明和本次请求不截断，必需上下文超 3000 字符时明确报错。用户问照片时仍携带“本次未提交图像”的约束。

这不等于新增了通用问答或持久化会话。建议 `POST /v2/projects/:id/assistant/messages` 使用结构化上下文：

```json
{
  "requestId":"a0000000-0000-4000-8000-000000000001",
  "conversationId":"b0000000-0000-4000-8000-000000000001",
  "sessionId":"30000000-0000-4000-8000-000000000001",
  "generation":3,"expectedRevision":5,"localRevision":2,
  "intent":"advice","message":"在不占用通道的前提下，还能增加什么体验亮点？",
  "briefRevision":5,"photoIds":[],
  "confirmedMaterialDecisions":[{"requirementKey":"tent","decision":"keep_unfulfilled"}],
  "recentMessages":[{"role":"user","text":"中央需要小组交流。"},{"role":"assistant","text":"可保留中央交流区，建议尚未应用。"}],
  "lastProposalExplanation":"签到安排在入口右侧，帐篷资产尚缺。","selectedIds":[],
  "scene":{"schemaVersion":1,"venue":{"shape":"rectangle","width":12,"depth":10,"height":3,"entrances":[]},"objects":[],"camera":"overview","lighting":"warm"}
}
```

建议纯建议响应：

```json
{
  "kind":"advice","conversationId":"b0000000-0000-4000-8000-000000000001",
  "messageId":"c0000000-0000-4000-8000-000000000001",
  "text":"可以在展示区旁设置留言互动点，请先确认是否采用。",
  "suggestions":[{"id":"idea-1","label":"留言互动点","adopted":false}],
  "unmetRequirements":[{"key":"tent","reason":"缺少可用帐篷资产","resolution":"keep_unfulfilled"}],
  "imageContext":{"usedPhotoIds":[],"status":"not_provided"},"omittedHistory":0
}
```

修改场景则用明确的 proposal 分支，建议类型关系如下；其中 Idea/Zone/RequirementResult 等名称只是概念，待 B 定义共享 schema：

```ts
type PlannedAssistantResponse =
  | { kind: "advice"; text: string; suggestions: Idea[]; unmetRequirements: RequirementResult[] }
  | {
      kind: "proposal";
      proposal: SceneProposal; // 保留真实 candidate、base_hash、租约、版本和有效期
      plan: { theme: string; zones: Zone[]; circulation: string[]; fulfillment: RequirementResult[] };
      adoptedIdeaIds: string[]; // 仅来自已确认建议
      imageContext: { usedPhotoIds: string[]; analysisIds: string[] };
    };
```

RequirementResult 建议区分 fulfilled/pending_asset/requires_confirmation/unsupported，不能靠关键词命中声称复杂要求已满足。纯建议不写 Scene；新创意需用户采纳后成为约束；完整规划表达主题、分区、动线、必需物料、可选创意、规格、位置及缺项。整体重规划与局部修改应区分，均保留锁定保护与确认步骤；上限不能静默削减。

帐篷、舞台、拱门、灯具优先通过真实 GLB 与稳定 assetId 接入，每项须有名称、尺寸、原点、朝向、来源许可、加载状态。生成中返回 pending，失败保留缺项，不能以占位物、改名桌椅或效果图冒充可编辑资产。

## 四、错误、并发与费用验收

现有错误形状 `{error:{code,details?}}`。HTTP 202 或空 candidate 不等于“完成”。下表前七行为现有代码，最后两行为建议扩展：

| 情况 | 码／状态 | 验收行为 |
| --- | --- | --- |
| 身份／权限 | UNAUTHENTICATED、FORBIDDEN | 保留草稿，提示身份／权限问题，不绕过项目隔离 |
| 编辑权／版本 | LEASE_LOST、LEASE_BUSY、REVISION_CONFLICT、STALE_PROPOSAL | 只阻断当前失效请求所属会话；旧 A 项目错误不能清掉 B 项目登录或停止新 generation 续期，旧提案不覆盖新画布 |
| 参数／布局 | VALIDATION_ERROR、INVALID_SELECTION、LAYOUT_REQUIRES_EMPTY_SCENE、OUT_OF_BOUNDS、LAYOUT_DOES_NOT_FIT | 指出问题，不清场、改名或丢掉必需物件来伪造成功 |
| 配置／预算 | SERVICE_NOT_CONFIGURED、BILLING_NOT_CONFIGURED、BUDGET_EXCEEDED | 不模拟成功，不自动反复付费。参数、权限、布局前提应在计费预留前校验；目前前端先拒绝非空 layout，服务端仍需提前做同样检查 |
| 幂等／进行中 | IDEMPOTENCY_CONFLICT、AI_IN_PROGRESS、AI_PREVIOUS_REQUEST_FAILED、GENERATION_BUSY | 双击不重复付费；未知提交结果保留 ID 并查询，不自动重提 |
| 模型／资产 | PROVIDER_HTTP_ERROR、PROVIDER_INVALID_JSON、AI_INVALID_PROPOSAL、资产授权或 GLB 加载失败 | 不应用候选，保留原画布，说明生成、授权或加载哪个环节失败 |
| 单体任务失败／不确定 | state=submit_unknown/failed/rejected，可带 error_code | 不显示为 ready，不重交未知任务。ready/added 必须有真实 asset_id |
| 照片问题（建议） | PHOTO_NOT_READY、PHOTO_ACCESS_DENIED、PHOTO_ANALYSIS_FAILED | 不声称已识别；上传失败保留文字需求 |
| 缺项／上下文过长（建议） | MISSING_REQUIRED_MATERIAL、CONTEXT_TOO_LONG | 给出缺口或长度，未经确认不替代，不截断硬约束后继续付费 |

前端本地 ASSISTANT_CONTEXT_TOO_LONG、ASSISTANT_MESSAGE_REQUIRED 是 instruction 构建错误，不是已上线的后端码。

联调需逐项记录：

1. 介绍页登录 → 创建／打开项目 → 获取编辑权 → 保存 → 刷新重开 → 第二账号接手；区分真实 Auth/Storage 与测试实现。
2. 照片上传完成但未分析、分析成功／失败、删除、授权过期、跨项目访问分别验证；usedPhotoIds 只能列真正送入模型的照片。
3. 风格、配色、场地情况、氛围、物料决定重开可恢复；实际物件 color 与 lighting 正确恢复，网页主题不误写进 Scene。
4. 连续两轮对话保留完整需求及确认决定，能解释“把刚才的签到区移到另一边”；省略旧历史有提示，必需上下文超限时不发送请求。
5. 必需帐篷有资产则加载真实模型，缺资产则列明；同意“先生成支持部分”仍保留未满足项，只有明确替代可改变要求。
6. 候选只预览，不保存、不进入正式撤销历史；确认后原子保存且成为一次可撤销编辑；放弃、过期、需求变化、切项目或本地拖动均清理旧预览。
7. 断网、生成／授权失败、续租失败、双击、旧请求迟到、过期后再生成分别验证：保留草稿，不影响新项目，不重交未知付费任务。

## 五、交接顺序与实际验收范围

B 先确认协议／共享类型及迁移，依次补项目需求存储、照片生命周期、能力声明，再接视觉理解、完整创意规划与会话服务，每步提供可复现请求及失败示例。A 负责字段接线、错误显示、临时三维预览、确认及保存状态，不通过前端关键词改名来伪装扩展资产。

本文示例不是云端调用记录。前端测试、mock 契约及本地预览不能证明真实 Supabase、视觉模型或付费三维生成已验收；真实环境必须另记部署版本、账号角色与每项结果。
