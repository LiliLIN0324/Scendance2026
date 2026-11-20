# 右上角发布改造 · A/B/集成 共同接口约定

日期：2026-11-20。状态：生效中（集成方维护；A/B 有异议在各自报告里提出，由集成方合入本文）。
依据：`docs/plans/2026-11-20-publish-flow-closure-plan.md`（下称主计划）、当前工作树代码、云存储验收报告 `2026-11-20-cloud-storage-integration-acceptance.md`。

## 0. 文件所有权（防并发覆盖）

| 角色 | 范围 |
| --- | --- |
| A（流程一致性） | `panels/share-menu.tsx`（+`share-menu.react.test.tsx`）、发布状态机/预检消费逻辑所在的 A 新模块 |
| B（界面与客户页） | `panels/share-panel.tsx`、`app/view/page.tsx`、`components/business/scene-preview.tsx`、`app/globals.css` 相关段（+各自测试） |
| 集成（本任务） | `room-organizer.tsx`、跨 A/B 共享前端类型、集成与验收测试、主计划 §8 回填 |
| 交接规则 | 对方文件不得直接改；需要对方改动时在报告写「精确集成要求」；交接（对方明确停笔）后才能接管。工作树里另一任务（场地自主规划交互/新手引导）的未提交改动属于他人，一律保留。 |

共享类型约定：新增跨 A/B 的前端类型统一由集成方落在 **`lib/publish-flow.ts`**（新建，集成所有）；A/B 只消费。wire 契约（`supabase/functions/_shared/*`、`client/scene-client.ts`、`frontend/lib/backend-session.ts`）本轮**不授权修改**；缺能力如实报告，不做生产降级、不造平行 schema。

## 1. 发布上下文（项目、会话、版本与快照身份）

### 1.1 会话快照（唯一上下文来源）

`controller.getSnapshot()` → `BackendSnapshot`（`frontend/lib/backend-session.ts:184`）。A/B 一律从这里读，不另建镜像 state：

| 字段 | 权威性 | 说明 |
| --- | --- | --- |
| `configured` | 服务端配置派生 | false 时一切云动作不可用 |
| `sessionId` | 前端会话 id | 请求头用，不进 UI |
| `user`（`{id,email?,is_anonymous?}`） | 服务端 | `null` 或 `is_anonymous===true` = 未登录 |
| `project`（`{id,name,studio_id,revision,…}`） | **服务端权威** | 发布对象；`project.id ?? layout.id` 是现有兜底（见 1.3） |
| `lease`（`{projectId,sessionId,generation,expiresAt,revision}`） | **服务端权威** | 有编辑权的凭据 |
| `revision` | **服务端权威** | 最近确认版本；发布请求体用它做 `expectedRevision` |
| `localRevision` / `dirty` / `draft` | **前端态** | 未保存修改的判定；`dirty` 由保存链维护 |
| `status` / `writeBlocked` / `error` | 服务端交互派生 | `writeBlocked=true` = 只读（无编辑权） |

### 1.2 前端会话身份（迟到结果防线，PUB-05/PUB-06）

- `ActivitySessionToken {scope, epoch}`（`lib/activity-session-epoch.ts`）+ `activitySession.isCurrent(token)`；`FloorSessionToken {scope, floorIndex, floorId, epoch}`（`lib/floor-session-epoch.ts`）+ `floorSession.isCurrent(floorToken)`。
- **约定**：每个发布/预检异步动作入口捕获一次上下文 `{sessionToken, floorToken, capturedRevision, layoutClone, projectId, outdoorPlan}`；每个 `await` 之后、写 state/写缓存/写服务端之前校验 `activitySession.isCurrent(token) && floorSession.isCurrent(floorToken) && layoutStore.getState().revision === capturedRevision`。不通过就丢弃结果并如实提示，**不写缓存、不记分享记录**。
- 现成范式：`issueReviewLink`（`room-organizer.tsx:1126`）的 `isCurrent()` 闭包模式，返回 `{url, isCurrent}`；A 在 share-menu 侧消费时同样调 `result.isCurrent()` 后再展示（评审链已这么做，发布链照搬）。

### 1.3 版本与快照身份

- 发布版本 = `publicationId`（服务端发号、不可变）+ `revision`。**没有独立「快照 id」，不要发明**。
- 普通发布：`POST /projects/:id/publish`，请求体 `{expectedRevision: snapshot.revision}`，响应经 `publicationSchema`（`frontend/lib/share-api.ts:20`）校验为 `Publication {shareId, publicationId, revision, createdAt, url, token}`。**`url`/`token` 只在该响应出现一次**，服务端清单不回传。
- 完整分享：`controller.createCompleteShare(projectId, {requestId, expectedRevision})` → `{shareId, publicationId, revision, token|null}`（`backend-session.ts:1099`）。`requestId` 幂等：同 id 重试返回 `token:null`（含义=「此前已生成」），不视为失败。
- 项目身份兜底口径保持现状：`snapshot.project?.id ?? layoutStore.getState().layout.id`（未挂云项目时 `layout.id` 不是云项目 id，只能用于判定「未绑定」，不能拿去发发布请求）。
- 附属产物（离线场地页 `siteUrl`，`@/lib/site-share` 的 `siteShareLink`）：**前端拼装的本机快照链接，非服务端记录**。约定它必须从 1.2 捕获的同一份 `outdoorPlan`/`layoutClone` 生成（修复现状：`publishVersion` 在 POST 之后才读 `outdoorFullPlanRef.current` 与 `layoutStore.getState()`，可能已混入新编辑——PUB-06 的集成修点在 `room-organizer.tsx`，集成方负责）。生成失败**不否定**已成功的云端发布。

### 1.4 发布闸门快照

`PublishGateSnapshot`（`lib/project-manifest.ts:139`），由 `room-organizer.tsx:708` 注册的 provider 提供，`publishGateSnapshot()` 消费。字段权威性：`manifest/gaps/complete/note/readyForPublish` 为**本机派生**（清单按 wire 形状 `completeManifestSchema` 构建，但落库与否以服务端为准）；`conflict` 来自 save-status 的**服务端冲突上报**；`cloudRevision` 来自保存状态机的最近服务端确认。provider 未注册/抛错 → fail-closed（`publishGateBlockReason` 返回原因，不当作通过）。

## 2. 预检结果与阻塞项、处理动作

数据源固定两个：`controller.getSnapshot()` + `await publishGateSnapshot()`。**不新开第二套探测，不做重复请求。**

阻塞项枚举（code → 判据 → 处理动作，按序短路）：

| code | 判据 | 处理动作（给 B 的动作语义） |
| --- | --- | --- |
| `not-configured` | `!configured` | 无恢复动作；文案如实说明服务未配置 |
| `login-required` | `!user \|\| user.is_anonymous` | 打开既有登录入口（/auth 或账户面板）；**回来后只重查预检，绝不自动发布** |
| `no-project` | `project===null` | 走既有「保存为云项目」链；成功后重查 |
| `read-only` | `writeBlocked===true` | 既有取回编辑权入口；成功后重查 |
| `unsaved` | `revision` 非有限 `\|\| dirty===true` | 保存当前修改（既有保存链）；保存成功后用**新 revision** 重查 |
| `local-assets` | dirty 且 `localAssetIdsInLayout` 有未 uploaded | 保存（模型随保存上云）或引导归档页补传 |
| `archive-gaps` | `gate.complete===false` | 归档页补传；文案列 gap 名称（`publishGateBlockReason` 现成文案） |
| `conflict` | `gate.conflict !== null` | 既有冲突处理（项目卡/户外提示选择保留哪一版）；处理后重查 |

- 预检模型（A 状态机、B 渲染共用）：`{ phase:'checking'|'done', ready:boolean, blockers: Array<{code, message, action?}> }`。这是**纯前端类型**，放 `lib/publish-flow.ts`（集成创建）；不进 wire。
- 预检时机（PUB-02）：打开发布页签即跑一次；处理动作完成后**原地重查**；`projectId` 变化立即清空旧预检与旧结果（含 `completeShare`，见 §4.4）。
- 预检只读，不改画布、不发写请求；`readyForPublish` 是唯一「可发布」布尔，B 的绿色按钮只看它（外加 `readOnly` 短路）。
- 复核补充（2026-11-20）：`checking` 只在「已有结果的重查」时出现——首查只差一个微任务，先闪一下检查中再拿掉主按钮反而更差；提前退出或异常必须落成可重查的阻塞项，不得把面板卡在检查中。
- 复核补充（2026-11-20）：阻塞动作由宿主用 `ShareMenuActions.precheckActions` 声明**真实接得上**的 code，未声明的只说明原因。当前只接 `login`（账户中心登录卡）与 `archive-page`（账户中心「归档」页）；保存/编辑权/冲突没有现成一键入口，不做假按钮（PUB-03 部分覆盖）。
- 复核补充（2026-11-20）：发布摘要（`summary` / `visibilityLine`）由 share-menu 依门禁快照 + 画布生成，逐类列场地/楼层/物件/依赖/户外/缺口，口径与客户页「对外可见内容」一致。

## 3. 发布任务阶段、成功、失败与结果待确认

### 3.1 阶段（普通发布主路径）

`S0 预检（§2）→ S1 闸门核对（publishGateSnapshot，含 fail-closed）→ S2 POST /projects/:id/publish → S3 附属产物 siteUrl（可失败，不否定 S2）→ S4 交付（复制/二维码/记录写入）`

状态枚举（前端态，对齐主计划 §4 表）：`checking | blocked | ready | publishing | published | new-changes | confirm-result | failed | revoked`。`publishing` 需带阶段文案（S2/S3 分开说），不再共用一个裸 `busy`（PUB-10：busy 按「动作 × 项目」隔离，页签切换不清进度）。

### 3.2 成功 / 失败 / 结果待确认

- **成功**：`publicationSchema.parse` 通过 → `published` 态 + `appendShareRecord` + 尝试复制。复制失败 → 提示「发布成功，复制没成功，请点复制」，**不得诱导重复发布**（PUB-09/V11）。
- **失败**：`shareErrorMessage(error)` 映射文案；`REVISION_CONFLICT` → 回预检（conflict 分支）。失败保留草稿与已成功阶段，不重建已有发布。
- **结果待确认**（超时/网络中断）：**不得直接判失败**。恢复路径 = `GET /projects/:id/shares` 按 `revision` 核对：已有该版本 share → 转 `published`；URL 不可再得（响应只回一次），此时如实展示「v N 已发布，链接未保存，可从发布记录撤回或发布新版」，不伪造链接。核对仍无 → `failed`，可安全重试（S2 重试前先核对，防重复发布）。
- **重复提交**：UI 防抖（busy/阶段禁用）之外，S2 无服务端幂等键（publish 无 `requestId`）——**重试前必须先查 shares 核对**，这与完整分享（有 requestId）不同，不要混用语义（主计划 §4.3）。
- **关闭面板 ≠ 取消**：发布任务不随面板关闭终止；完成回执按 §1.2 当前性校验后照常落账。**不提供无取消能力的「取消发布」假动作**。

## 4. 已发布记录、新版发布与撤回

- **服务端权威**：`GET /projects/:id/shares` → `ServerShare[]`（`lib/share-records.ts:12`：`shareId/publicationId/revision/createdAt/revokedAt`）。**不含 url/token**；完整分享与普通分享同在这份清单（撤销同走 `DELETE /projects/:id/shares/:shareId`）。
- **本机仅存 url**：`ShareRecord` 日志（`scendance.shareLog.v1.<projectId>`）+ 旧单条键（读取时迁移）。`mergeShareRows(local, server)` 出渲染行；服务端不可达时退化为纯本机行并如实标注。
- **新版发布**（PUB-07/V10）：同一 projectId 再次 POST publish（revision 前进）→ 新 share，旧链接独立保留。「当前修改未发布」标记 = `dirty || localRevision > revision`（前端派生）；已发布页展示「已发布版本 v N + 时间（createdAt，服务端权威）+ 是否有新修改」。
- **撤回**（V15）：按具体 `shareId` 操作；成功后清本机对应记录、同步清单行与二维码态；文案保留「已下载/离线副本无法收回」边界。撤回范围只限这一条 share，不碰其他版本。
- **令牌丢失**（PUB-08/V12）：完整分享 token 只回一次且不落盘——刷新/换设备后 `completeShare` 内存态清空是**正确行为**；管理入口以服务端 shares 清单为准（可见、可撤销），「重新生成」= 先撤销旧 share 再 createCompleteShare（新 requestId）。**不做**「从哈希恢复令牌」类假恢复。
- **切项目清理**（PUB-05）：`projectId` 变化时清空 `published/completeShare/notice/qr/预检/任务态`（现状只清 `published` 与 notice，`completeShare` 不清——A 的集成修点）。

## 5. 普通发布／完整分享的兼容与默认主路径

| 入口 | 端点 | 链接形状 | 内容范围 | 撤销 |
| --- | --- | --- | --- | --- |
| 发布（现行默认） | `POST /projects/:id/publish` | `/view/#<64hex>` | scene + materials + 授权 assets（无户外规划） | shares 清单按 shareId |
| 完整只读链接 | `POST /cloud/projects/:id/shares` | `/view/#c<64hex>` | scene + outdoor + published 依赖签名地址；sources 不出网 | 同上（同清单） |
| 评审链接 | `issueReviewLink` | `/review/…` | 当前方案快照 + 钉评权限 | 既有评审记录链 |
| 离线场地页 | `siteShareLink` | `/site#s2=…` | 本机快照，不随项目更新、不可远程撤回 | 无（边界如实标注） |

**本轮决定（集成方口径，A/B 照此执行）**：

1. 默认主路径**维持「发布」页签的 POST publish，本轮不切换**。切换前提是补齐差异核对（普通发布响应含 materials/assets 展示与授权链、完整分享含户外与资源签名地址，客户页清单能力不同——主计划 PUB-04/PUB-11），核对结论先回填主计划再切；只隐藏旧按钮不算切换。
2. 已发普通链接按原语义读取/撤销，不静默改写为完整分享；两种 token 前缀（`#`/`#c`）不互换。
3. 完整分享生成前必须 `ensurePublishedArchiveNow()`（published 口径落库，`lib/complete-archive.ts`）；普通发布不需要 published 口径清单，但必须过闸门（依赖归档 + 无冲突）。
4. 对外内容范围如实展示（发布摘要）：发布前把「这次发布包含什么（场地/分区/设施/模型/附件）」按 1.4 的 manifest + layout 概括展示；**不默认所有私有资料都公开**（sources 保持既有私有边界，完整分享里 sources 不出网是契约行为，不是 UI 可选项）。

## 6. 验证分工口径

- 本地保存 / 模拟接口 / 真实浏览器 / 真实云端**分开汇报**，不互相冒充。
- 真实云端写入仅用已获授权的 QA 项目与范围（云存储验收报告 §0.3 的既有三账号口径）；缺少授权时如实报「未验证」。
- 本任务不授权部署、tag、release，不自动公开用户方案；数据库/Edge 契约变更须交人 review。

> AI生成
