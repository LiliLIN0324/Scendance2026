# Task A — 后端权限与统一契约（2026-11-20）

状态：**本轮补丁已落码并通过本地专项验证；接口为待人审草案，未部署、未迁移、未提交。** 不猜测管理员 UUID；首授/撤权与桶扩容的具体变更见审核 SQL 文末，供人工执行。

## 已核对基线 C00（2026-11-20 当前 main）

- 鉴权链：Bearer JWT → `backend.user()`（Auth.getUser）→ `scene_rpc(p_actor,…)`；`scene_rpc` 为 security invoker + 仅 service_role 可执行，客户端无法自报 actor（supabase/functions/_shared/backend.ts:51、migrations/20261002060304_scene_core.sql:160）。
- 既有可复用能力：projects/studio 成员（owner/editor）、租约 `lease.acquire/renew/release` + `expectedRevision` CAS、不可变 publications（触发器拦 update/delete）、shares（token hash + revoked_at 可撤销）、GLB 上传按 `sha256(actor:文件hash)` 确定性去重、`assets.byte_size` 上限 32MiB、存储桶 `scene-assets` 32MiB 且 mime 白名单不含扫描/附件。
- 已核实缺口：publish 快照只含室内 scene+materials+asset_ids，**无户外/附件/依赖清单**；无平台管理员概念；户外 outdoor_plans 按 actor 隔离、未接工作室归属；无案例目录概念。
- 既有失败（本机全量根测试，150 文件：18 红文件 / 23 红用例 / 50 资源错误）分类：①本机资源噪音（agent-phase、agent-run-state-hygiene、agent-relaxed-submission 报 `Array buffer allocation failed`/`WebAssembly.Memory` 内存不足，asset-upload 全量跑崩、单独跑 6/6 绿）；②缺本机环境（config/hunyuan-config 预检需 .env.local、annotation/multi-file prototype 需本地数据目录、merged-library/agent-corpus 需本地资产文件）；③**HEAD 既有陈旧断言：tests/published-assets.test.ts:75 期望撤下返回 `published:true`，而迁移 b76ec3eb（20261119160000）已把语义改为如实报 `false`——与本轮改动无关（git diff HEAD 为空），需另行修断言**。
- 根 `npm run typecheck` 0 错；`npm --prefix frontend run typecheck` 0 错；`npm run check:edge` 三入口全过（DENO_DIR 指向仓库内 .deno-cache）。

## B/C 可消费接口（v1.1 定稿；v1 的指纹语义有修订）

新增共享契约 `supabase/functions/_shared/cloud-storage-contract.ts`；新增 `public.cloud_storage_rpc`（独立入口，不挂进 scene_rpc 委托链，撤除不影响现有动作）；HTTP 侧 `/cloud/*` 统一走 `scene-api`（`_shared/cloud-storage.ts`），前端统一 `backendSession` 方法，B/C 不自建传输。未部署审核 SQL 时所有 `/cloud/*` 一律 **503 CLOUD_STORAGE_UNAVAILABLE**，无任何本机 mock 降级。

| 方法 / HTTP | 请求与返回 | 鉴权与语义 |
|---|---|---|
| getCloudCapabilities / GET /cloud/capabilities | `{version:1,superAdmin,officialStudioId}` | JWT；每次实时查表，撤权即时生效 |
| prepareArchiveUpload / POST /cloud/uploads | archiveUploadSchema → ArchiveUploadReceipt（uploadId/storagePath 稳定，uploadUrl/token 每次新鲜签发） | JWT；studioId 省略=个人私有；官方工作室需管理员；同 requestId 重试同一 receipt |
| uploadArchiveToSignedUrl | 浏览器→对象存储直传 PUT（`x-upsert:false`），不经过 Edge body | 协议上限 2GiB；生产桶当前 32MiB，扩容在人审 SQL |
| completeArchiveUpload / POST /cloud/uploads/:id/complete | → CloudArchiveAsset（integrity=full/size-only） | JWT；≤64MiB 逐字节复核 SHA-256，超阈值只核大小并如实标记；登记失败可对同 uploadId 重试；内容寻址 id 防重复登记 |
| listArchiveAssets / GET /cloud/assets[?studioId=] | CloudArchiveAsset[] | 个人私有或官方工作室（管理员）；未放入项目也可找回 |
| archiveAssetUrl / POST /cloud/assets/:id/url | `{url,expiresIn:300}` | 每次服务端鉴权换取；稳定 assetId 是主键，地址不是 |
| saveCompleteProject / PUT /cloud/projects/:id | completeSaveSchema（含 sessionId/generation/expectedRevision）→ CompleteProjectReceipt | JWT+成员+**租约+CAS**（复用 require_lease）；依赖必须可解析、场景引用必须列入依赖；sources 私有；同 requestId 重试返回原确认 |
| getCompleteProject / GET /cloud/projects/:id | 同 receipt | JWT+成员；无记录 → 404 COMPLETE_PROJECT_NOT_FOUND，不降级冒充完整保存 |
| upsertCloudCase / PUT /cloud/cases/:stableId | caseWriteSchema → CloudCaseDraft | 管理员+官方项目；expectedVersion CAS（新建=0）；**草稿由服务端从完整清单复制，客户端不传内容**；封面必须∈已发布依赖 |
| listCloudCaseDrafts / GET /cloud/cases/manage | CloudCaseDraft[] | 管理员 |
| publishCloudCase / POST /cloud/cases/:stableId/publish | casePublishSchema → CloudCaseDraft | 依赖校验→不可变 publication→complete_publications（户外+已发布依赖快照）→案例指针原子切换；失败公众保持旧版 |
| unpublishCloudCase / POST /cloud/cases/:stableId/unpublish | → CloudCaseDraft | 目录与公开入口同时失效；版本流水记 action=unpublish |
| restoreCloudCase / POST /cloud/cases/:stableId/restore | caseRestoreSchema → CloudCaseDraft | 只允许恢复本案例历史 publication；生成新版本号，不改旧发布 |
| listCloudCaseVersions / GET /cloud/cases/:stableId/versions | CloudCaseVersion[]（含 publish/restore/unpublish 流水） | 管理员；最小审计（C15 随 C01/C10 交付的部分） |
| listCloudCases / GET /cloud/cases | CloudCasePublic[] | **匿名公开**；仅已发布元信息；封面经发布依赖校验后才签地址 |
| readCloudCase / GET /cloud/cases/:stableId | CompletePublicRead（manifest 无 sources） | 匿名；scene 走 public_scene（剥备注/平面图引用）；storagePath 换 300s 签名且**签名后二次核验入口未变** |
| createCompleteShare / POST /cloud/projects/:id/shares | completeShareSchema → `{shareId,publicationId,revision,token}` | JWT+成员；复用 shares（可撤销走既有 DELETE /projects/:id/shares/:shareId）；**token 只发一次**，服务端仅存哈希；重试同 requestId 得原确认但 token=null，如实恢复路径=shares.list+撤销重建 |
| readCompleteShare / POST /cloud/shares/read | CompletePublicRead | 匿名+token；撤销后（签名后二次核验）404 SHARE_NOT_FOUND |

**幂等语义（v1.1 修订）**：指纹 = `canonical(含 requestId 的请求体)` SHA-256。重试=同 requestId 同内容→原确认；同 requestId 不同内容→409 IDEMPOTENCY_CONFLICT；**新 requestId 同内容=新的主动操作，允许再执行**（v1 草案「指纹去 requestId」会让刷新草稿等合法重复操作无法进行，已修正）。

错误码（HTTP 映射在 Edge，沿用 ApiError）：UNAUTHENTICATED 401、PLATFORM_ADMIN_REQUIRED/FORBIDDEN 403、NOT_FOUND 类 404、CASE_VERSION_CONFLICT/IDEMPOTENCY_CONFLICT/REVISION_CONFLICT/LEASE_LOST 409、DEPENDENCY_INCOMPLETE/UPLOAD_INTEGRITY_FAILED/UPLOAD_OBJECT_MISSING/MANIFEST_TOO_LARGE/OFFICIAL_WORKSPACE_REQUIRED 422、CLOUD_STORAGE_UNAVAILABLE 503。

## 已落码文件（全部在 §8 任务 A 独占范围）

- `supabase/functions/_shared/cloud-storage-contract.ts`（契约 schema+类型；扩展了此前会话的初稿）
- `supabase/functions/_shared/cloud-storage.ts`（/cloud/* HTTP 处理：JWT、直传签发、完整性复核、签名换地址、签名后二次核验）
- `supabase/functions/_shared/backend.ts`（Backend 接口 + cloud RPC、stat、createUploadUrl）
- `supabase/functions/_shared/api.ts`（/cloud/* 挂接，最小 diff）
- `client/scene-client.ts`（17 个云方法 + 直传带进度 helper）
- `frontend/lib/backend-session.ts`（BackendSession 云方法 + 失败文案表；B/C 统一从这里接）
- `tests/fixtures.ts`（cloud RPC 路由、对象存储仿真 objects/stat/createUploadUrl、非 ALL_CAPS→DATABASE_ERROR 对齐真实 backend）
- `tests/cloud-storage.test.ts`（10 用例）
- `supabase/review/202611200001_cloud_storage.sql`（**审核草案，不在自动迁移链**：platform_admins+审计、official_workspace、archive_assets、upload_intents、cloud_requests 幂等闸、complete_projects、complete_publications、cloud_cases+版本流水、桶扩容至 2GiB+mime 白名单、首授/撤权流程占位——**不含任何 UUID**）

## 本轮验证（全部为本地模拟，不代表线上）

- `npx vitest run tests/cloud-storage.test.ts` → **10/10 绿**：未部署→503 失效门；首授仅经服务端表+审计 grant/revoke 即时生效；官方工作区闸；归档 prepare→直传→完整性→登记→列表→取地址全链；同号不同内容 409；对象缺失/大小篡改 422；完整保存租约+CAS/依赖校验；发布仅认已发布依赖、下架恢复原子切换、私有 sources 不出网；匿名目录/读取；完整分享 token 单次发放+可撤销。
- `npm run typecheck` 0 错；`npm --prefix frontend run typecheck` 0 错；`npm run check:edge` 3 入口全过；既有相关子集（api/asset-upload/published-assets/scene-client/domain/outdoor-plans/project-delete/studios，73 用例）72 绿 + 1 条 HEAD 既有陈旧断言（见 C00）。
- 修复过程中在本轮补丁内发现并修正的 SQL 缺陷：plpgsql 变量遮蔽 SQL 别名（cp/pcp）、`on conflict` 列名撞同名变量（request_id→claim_request）、unpublish 流水撞 `unique(case_id,version)`、幂等闸补 (actor,request_id) 轴、指纹语义修订（见 v1.1）。

## 待验 / 待人审 / 交接

- **人审**：审核 SQL 全文（表结构、RLS 授权、桶扩容 2GiB 与 mime、首授流程）；上线迁移与部署由总集成另行授权，本轮未做。
- **待真实环境**：管理员真实 UUID（不猜）、生产桶实际可承载上限、2GiB 直传/校验超时策略、Edge 下载复核 64MiB 阈值在生产内存下的表现、V01–V14 对应云端项（三账号+干净设备）全部待验。
- **B 接手**：上传队列接 `backendSession.prepareArchiveUpload → uploadArchiveToSignedUrl → completeArchiveUpload`（receipt.uploadUrl 可能为 null 的 complete 态不需要直传）；持久队列以 requestId 幂等对账；保存状态接 getCompleteProject 的 confirmedAt/dependencyCount。
- **C 接手**：案例运营接 listCloudCaseDrafts/publish/unpublish/restore/listCloudCaseVersions（管理员 gate= getCloudCapabilities().superAdmin）；公开目录/读取走 listCloudCases/readCloudCase（未登录可用）；固定副本覆盖问题所需 stableId 入口已备好。
- 已知取舍：archive_assets 与 assets 分表（大扫描不塞 32MiB 物料契约）；>64MiB 直传 integrity=size-only（Edge 内存约束，如实标注而非假成功）；complete_projects 单行最新清单（历史依赖后续按需）。
