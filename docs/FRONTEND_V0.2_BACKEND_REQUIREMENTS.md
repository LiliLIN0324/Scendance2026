# 前端 v0.3：现有协议与后端支持需求

更新日期：2026-10-02。交接对象：**成员 2（后端负责人 B）**。文件名沿用 v0.2，以保留已有链接；内容已更新到 v0.3。

本轮只修改 `frontend/` 与文档，没有修改 `supabase/`、数据库、`client/scene-client.ts` 或根依赖。**“现有协议”可在代码中核对；“建议协议”尚未实现，不得向现有 API 直接发送新增字段。** 涉及新增协议时，由 B 先确认并更新共享 schema，A 再接线；第六节模型替换维持现有协议。

**当前执行优先级：只推进 [第六节 GPT 核心生成链路](#gpt-handoff)。** 其余新增协议是能力缺口备忘，不是本次新增实施授权。

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

成员 2 当前按第六节完成 GPT 最小接入并保持既有协议。项目需求存储、照片生命周期、视觉理解及会话等建议，待核心链路通过且获得后续授权后再排期。A 负责字段接线、错误显示、临时三维预览、确认及保存状态，不通过前端关键词改名来伪装扩展资产。

本文示例不是云端调用记录。前端测试、mock 契约及本地预览不能证明真实 Supabase、视觉模型或付费三维生成已验收；真实环境必须另记部署版本、账号角色与每项结果。

<a id="gpt-handoff"></a>
## 六、交给成员 2：GPT → 可编辑三维场景的最小接入

核查基线：前端 `9943a687dc5a884e12cf8793bccd68d52b40cebe`，2026-10-02。本节是**成员 2 尚需实施的后端补丁方案**，不是已经接通 GPT 的声明。本次只更新交接文档，不改后端，不调用付费 API，不增加页面或按钮，不扩接混元。

### 6.1 已确认兼容的前端链路

`CreativeBriefPanel Generate → CreativeStudioProvider.generate → BackendSession.requestProposal → POST /projects/:id/proposals → SceneProposal.candidate → adapter/Three.js 临时预览 → 用户确认 → applySceneProposal → POST /proposals/apply → 返回实际已保存 Scene → 可编辑画布`。

- `frontend/components/room-organizer/panels/creative-studio.tsx`：完整需求/现场文字/风格/配色/氛围/上下文组成 instruction；照片字节不随请求发送。空场景用 layout，已有物件用 modify，不自动清空旧方案。
- `frontend/lib/backend-session.ts` 的 `requestProposal`、`applySceneProposal`：沿用 requestId、sessionId、generation、expectedRevision、localRevision、selectedIds、scene/currentScene。没有供应商专属字段。
- 提案保留项目、租约、版本、base_hash、expires_at、锁定校验；请求中途的编辑/切项目/需求变化不能被旧结果覆盖。只有服务端返回并被本地接受的 Scene 才正式应用。
- **后端保持现有 SceneProposal 和 apply 返回结构，前端就无需供应商专属修改。** 不把 OpenAI 的 Response 原样返回前端，不在浏览器调用 OpenAI，不增加 NEXT_PUBLIC_OPENAI_API_KEY。

### 6.2 成员 2 的准确改动位置

下列行号对应上述核查基线，提交前以函数名定位：

| 后端位置 | 当前实现 | 最小补丁 |
| --- | --- | --- |
| `supabase/functions/_shared/providers.ts:27–50`，generateProposal | 固定 DeepSeek chat/completions、deepseek-flash、json_object；读取 choices[0]；最多一次修复 | 改为 OpenAI Responses 与受约束输出；读取真实 output 项，最后继续调用 buildProposal，返回原 `{scene,explanation,commands,warnings,usage}` |
| `supabase/functions/_shared/api.ts:79–99` | lease.check 后独立检查 DEEPSEEK_API_KEY，再预留预算、生成、store、finish | 预留前改查 OPENAI_API_KEY、OPENAI_MODEL，并校验选定模式前提；不能只改 providers.ts 而保留旧 key 门槛。保留 requestId 指纹、租约检查、提案存储与费用状态 |
| `supabase/functions/_shared/ai.ts:23–94` | layoutSchema / modificationSchema / buildProposal | 复用作为输出真源和程序校验，不扩大模板、人数、命令、物料、Scene 字段 |
| `supabase/functions/_shared/http.ts`，fetchJson | 单次 25 秒超时、拒绝重定向、响应限长、上游 HTTP 错误清洗 | 保留。所选模型需验证能在该预算内完成；不要因为超时自动重发或放宽整站超时 |
| 根 `.env.example`、`supabase/functions/.env.example`、`docs/DEPLOYMENT.md`、相关 provider/API 测试 | 仍说明 DeepSeek | 成员 2 随自己的后端 PR 更新配置与测试；这些文件本次未改 |

`supabase/config.toml` 中 `[studio].openai_api_key` 是 Supabase Studio 的配置，不能据此认为 scene-api 已接入 GPT。生成链路需要 Edge Function 运行环境中的变量。

| 服务端变量 | 用途 |
| --- | --- |
| `OPENAI_API_KEY`（拟新增业务配置） | 成员 2 在本地隐藏环境文件或 Supabase Edge secrets 中配置；不进入聊天、GitHub、日志或前端构建 |
| `OPENAI_MODEL`（拟新增，必须明确填写） | 该账号实际可用、支持 Responses 和所用 strict schema 的 GPT 模型 ID；不设置猜测的默认型号，不推断账号额度 |
| `AI_MAX_REQUEST_CENTS`（已有） | 根据选定模型实际价格/输入上界/输出上界/最多两次调用复核的正整数费用预留；不能照搬 DeepSeek 估值 |
| `ALLOWED_ORIGINS`、Supabase 项目/Auth 配置（已有） | 允许实际前端 Origin，提供真实工作室成员、项目、租约；与模型 key 分开 |

**补齐确定性前置校验：** 当前后端仅在付费后的 buildProposal 内拒绝非空 layout，并可能再花一次修复调用。成员2应在 api.ts 的 reserve 之前增加 `input.mode === 'layout' && input.scene.objects.length > 0` 检查，返回 `LAYOUT_REQUIRES_EMPTY_SCENE`，测试必须证明零次模型调用、零次预留。前端已有同类保护不能替代服务器检查。

配置与计费校验失败必须在供应商请求之前返回。首个真实付费验收由成员 2 获得明确执行授权后运行，本次未执行。

### 6.3 请求与 schema 的最小映射

采用 `POST https://api.openai.com/v1/responses`，服务端 Bearer key。Responses 的结构化格式放在 `text.format`；不是原 Chat Completions 的 `response_format`，也不再发送 DeepSeek 的 thinking 字段。参见 [OpenAI 迁移文档](https://developers.openai.com/api/docs/guides/migrate-to-responses)。

下面是嵌入现有 generateProposal 的请求形状示意；`input` 是已通过现有 proposalRequestSchema 的请求，`wireSchema` 来自下文受限转换，代码尚未部署：

```ts
const body = {
  model: required(env, 'OPENAI_MODEL'),
  instructions: SYSTEM_PROMPT,
  input: [{ role: 'user', content: JSON.stringify({
    mode: input.mode, instruction: input.instruction,
    scene: input.scene, selectedIds: input.selectedIds, catalog,
  }) }],
  text: { format: {
    type: 'json_schema', name: input.mode === 'layout' ? 'scene_layout_v1' : 'scene_modify_v1',
    strict: true, schema: wireSchema,
  } },
  max_output_tokens: 4096, // 初始上限；需连同模型推理开销、25秒超时和费用预留一起验收
  store: false,
};
```

不请求模型直接创造任意 Scene、实例 UUID 或 assetId。模型先返回当前模板参数或命令，`buildProposal(input.scene,input.mode,parsed)` 产生并校验 candidate，然后 api.ts 按原协议存储提案。layout 仅 salon/networking、1–40人；modify 仅现有六类命令，总物件仍≤50。换 provider 不等于支持体育馆100人或任意场馆。现有模板也不会自动满足所有门窗/固定设施/动线文字条件，必须核对并如实说明未满足项。

strict schema 的根为 object，各对象拒绝额外字段，属性均列入 required；命令分支可用嵌套 anyOf。拒绝与未完成输出需要单独处理，不能视为合法场景。参见 [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)。

**本仓库已离线核查的 schema 陷阱：** 当前 Zod 的 colorSchema 有 transform；默认输出方向转换会失败。`z.toJSONSchema(schema,{io:'input'})` 可以导出输入约束，但 modify 的 discriminatedUnion 实际产生 `oneOf` 和 `const`，不能未经检查直接发送。成员 2 可仅对本项目这组 schema 作以下显式转换，并增加快照测试：

```ts
function proposalWireSchema(mode: 'layout' | 'modify') {
  const raw = z.toJSONSchema(mode === 'layout' ? layoutSchema : modificationSchema, { io: 'input' });
  function visit(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(visit);
    if (value === null || typeof value !== 'object') return value;
    const node = { ...(value as Record<string, unknown>) };
    delete node.$schema;
    if (node.format === 'uuid') delete node.format; // 保留 UUID pattern；程序端继续严格验证 UUID
    if ('const' in node) { node.enum = [node.const]; delete node.const; }
    // 仅适用于这里由不同 op 字面量区分、互斥的命令分支，不能泛化为任意 oneOf 转换。
    if (Array.isArray(node.oneOf)) { node.anyOf = node.oneOf; delete node.oneOf; }
    return Object.fromEntries(Object.entries(node).map(([key,item]) => [key,visit(item)]));
  }
  return visit(raw);
}
```

该转换不替代 layoutSchema/modificationSchema/sceneSchema/buildProposal，不自动删除其他不支持的限制。若所选模型拒绝 schema，应修复适配并通过离线测试后再做真实验证，不降级成无约束 JSON、不悄悄更换模型。

### 6.4 响应、修复与失败处理

先校验供应商响应结构与状态。provider envelope 的 ZodError 必须在适配器包装成脱敏 ApiError（可沿用 AI_INVALID_PROPOSAL）；否则 api.ts 会把它误报为客户端 VALIDATION_ERROR/400。直接 fetch 返回的对象应遍历 `output`，只从 `type:"message"` 的 content 中收集 `type:"output_text"` 的 text；不能假设 output[0] 一定是文本，更不能继续读取 choices[0]。遇到 refusal、status 非 completed、缺失/空文本、无效 JSON 时不产生 candidate。完成解析后再运行现有业务校验。

- 有完整 JSON 但违反业务约束时，最多执行现有的一次修复：携带上一段模型文本和程序校验错误，使用相同 schema；必须仍处于同一次业务 requestId 及费用预留内。
- HTTP 401/403/429/5xx、断网/超时、拒绝或 incomplete 不盲目修复重发。拒绝/incomplete 可暂以现有 `AI_INVALID_PROPOSAL` 和脱敏 details.reason 返回；若新增顶层错误码，成员 2 应同步通知前端。
- 保留每次已返回调用的 response id、实际 model、usage 与错误阶段以便对账，不记录 key。有未知费用的失败不自动释放预留，也不以新 requestId 自动再试。
- candidate 中 locked 对象、边界、尺寸、ID、物件上限仍由程序校验。Structured Outputs 约束 JSON 结构，不保证实际布局合理或符合现场条件。

模型成功输出示例（layout）——这不是发给浏览器的最终响应：

```json
{"explanation":"24人坐席交流会，米白与橄榄绿；请核对入口和通道。","template":"salon","attendees":24,"palette":["#f5f1e8","#65784c"]}
```

在空的12×10米、3米高矩形场景上，现有 buildProposal 离线验证生成26件物料（24椅子、1背景板、1签到台），warnings为空。UUID由程序生成；此结果仅证明程序夹具，不是 GPT 调用记录。对外成功响应仍为第二节的完整 SceneProposal（新提案 HTTP 201；幂等复用可为200），随后 apply 返回原 `{id,revision,scene,updatedAt,previousScene,undoGroup}`。

失败形状保持不变，示例均不含秘密：

```json
{"error":{"code":"SERVICE_NOT_CONFIGURED","details":{"setting":"OPENAI_MODEL"}}}
```

```json
{"error":{"code":"PROVIDER_HTTP_ERROR","details":{"status":429}}}
```

```json
{"error":{"code":"AI_INVALID_PROPOSAL","details":{"reason":"incomplete"}}}
```

前两项沿用现有码（分别503、502）；最后一项是成员2适配时可采用的422映射示例，当前 DeepSeek 实现未使用该 reason。失败/拒绝不返回假 Scene，不改已有场景。

### 6.5 首个真实案例的执行清单（成员 2 上线后）

1. **离线先过**：provider fetch mock 覆盖有效 layout/modify、reasoning item在文本之前、拒绝、incomplete、空文本、上游错误、一次修复、锁定对象、越界、预算和重复 requestId。补 API 测试证明未配置 OpenAI 时尚未预留费用、配置后不再要求 DeepSeek key。
2. **准备真实环境**：成员2在有授权的测试项目配置 Edge secrets、公开前端项目URL/key、CORS、真实工作室成员；记录后端commit、实际模型ID、预算和执行授权，不记录密钥。首例不需要混元、worker或三维资产生成服务。
3. **空场景首例**：登录 → 云项目中创建/打开一个专门验收项目 → 获取编辑权。确保画布为空；默认样例不为空时由测试者明确移除其物件，不能由 Generate 自动清场。设置12×10米、高3米；24人；需求“24人坐席沙龙，前方背景板和入口签到台，米白与橄榄绿”。只点一次 Generate。
4. **核实真实调用**：浏览器只访问自己的 scene-api，不直连 api.openai.com。成员2核对真实供应商 response id、model、usage 和业务 requestId；响应为现有提案格式。对这个明确要求 salon 的输入，预期26件、有效尺寸坐标；检查说明、warnings、现场条件与颜色，不能只看HTTP200。
5. **预览不落库**：显示可编辑三维物件的候选预览，确认前正式场景/云revision不变。先放弃一次确认原稿不变；第二次生成会是另一笔付费请求，只有额外授权后执行，不能把两次生成混作一次调用。
6. **确认与编辑**：可在首个提案直接选择确认（与上一步“放弃”二选一，优先走完整成功链）。确认后云revision前进、Three.js显示真实Scene；手动移动一把椅子→保存→刷新、重新登录并打开项目→核对位置与灯光。撤销作为本地编辑，须明确保存才同步云端。
7. **后续修改及失败**：有额外调用授权后请求修改非锁定椅子并确认；锁定对象、过期、lease丢失、生成中改稿、旧项目迟到结果、供应商故障的破坏性/重复场景优先用受控测试验证，不无谓消耗额度。最终记录“已通过/未测/失败”及真实日志证据。

当前阻塞由成员2处理：本次核查的代码基线没有 OpenAI 业务适配，实际部署状态、真实项目配置、账号、模型可用性与预算尚未核实，真实调用尚未授权执行。本次前端64项相关回归通过（5文件）；没有供应商专属前端代码改动，不重做UI，版本维持v0.3.0。

图片仍为本地blob，不会被 GPT 看到。未来图片上传/授权/视觉输入的缺口见第三节，本次首例按文字与实测场地执行。原体育馆仅作为视觉参考，不把体育馆建模、100人布局或自动还原照片纳入本次完成声明。
