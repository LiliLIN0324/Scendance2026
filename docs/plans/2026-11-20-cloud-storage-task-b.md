# B 上传归档与完整保存（实施记录）

日期：2026-11-20。状态：**本地实现完成；云端验收未做**（真实管理员账号、数据库/Edge 人审、干净设备验收都不具备）。按主计划 §8：仅交付工作区补丁与本报告，未执行 git add/commit/push、迁移或部署。未删任何本机唯一副本；本机保存成功与云端成功在本实现里是两个明确分开的状态。

## 一、所有权与改动清单

本任务独占范围内的新增/修改（对照主计划 §8 分工表）：

**新增（B 声明所有权，命名带任务语境）**

- `frontend/components/room-organizer/lib/cloud-archive.ts` — A 契约客户端：传输结构探测、SHA-256 增量计算（零依赖，支持 2GiB 分块）、直传执行器（hash → prepare → 对象直传 → complete → 回执校验）、错误码人话映射、`parseCompleteProjectSnapshot`。
- `frontend/components/room-organizer/lib/archive-queue.ts`（接手前一轮骨架并扩展）— 浏览器持久上传 outbox：IndexedDB 队列、账号/工作室隔离、requestId 幂等、内容变更换新 requestId、中断恢复（uploading→pending）、`needs-file` 语义、订阅广播、进程内共享单例 `sharedArchiveQueue`。
- `frontend/components/room-organizer/lib/save-status.ts` — 统一保存状态机（C05）：本机/上传中/同步中/云端已保存/失败/冲突 六态派生；序号化的云端同步结算，旧回执不清空同步期间的新编辑；最近云端确认时间/版本、待同步计数、归档队列活动。
- `frontend/components/room-organizer/lib/project-manifest.ts` — 完整项目依赖清单（C06）：模型/扫描/资料三类依赖收集，只登记真实云端资产 ID，缺口如实列 gaps；`manifestCompletenessLabel`；**发布闸门**（`registerPublishGateProvider` / `publishGateSnapshot`，给 C 的发布链消费）。
- `frontend/components/room-organizer/lib/local-inventory.ts` — 本机存量盘点（C14）：物料/扫描/资料图/户外规划四类登记，只读不删，输出已归档/待补传/需原文件/失败明细；`enqueuePendingInventoryItems` 补传入队。
- `frontend/components/room-organizer/hooks/use-cloud-archive.ts` — 运行时接线：transport 探测、账号 scope、队列订阅、自动补传 drain（scope 变化即停）、惰性能力查询、上传活动上报状态机。
- 上述模块的测试：`cloud-archive.test.ts`（SHA-256 NIST 向量 + 平台 crypto 对照 + 执行器）、`archive-queue.test.ts`、`save-status.test.ts`、`project-manifest.test.ts`、`local-inventory.test.ts`。

**修改（B 独占文件）**

- `panels/cloud-panel.tsx` — 新增「归档」分区（能力真相、补传队列、存量盘点+补传、云端资产列表+临时地址、完整项目核对/恢复到画布）；`saveBoundSceneQuiet` 接状态机（start/finish/fail）；保存态文案带素材归档缺口，不再把「场景已保存」说成「全部归档」。
- `components/outdoor-plan-overlay.tsx` — 户外保存状态真实化：`OutdoorSaveState` 扩展为 saving/saved/syncing/cloud-saved/cloud-failed/conflict，带服务器版本与确认时间；推送失败不再只等下一次编辑，60s 定时静默重试；冲突/解决两侧接状态机。
- `room-organizer.tsx` — 注册发布闸门（读最新画布+归档回执+资料图，产出 readyForPublish）；`handleOutdoorSaveState` 类型随 OutdoorSaveState 加宽。
- 未改：`backend-session.ts`、`client/scene-client.ts`、`supabase/**`（A 所有）；`space-panel.tsx`、share/案例模块（C 所有）。

## 二、向 A 的接口对齐与需求

A 报告 v1 发布后，A 的 backendSession/scene-client 草案已进工作区。B 已按**实际落码**（非报告原文）接入，差异与确认点：

1. **已按实际代码消费**：`getCloudCapabilities`、`prepareArchiveUpload(ArchiveUploadInput)`、`completeArchiveUpload(uploadId)`、`listArchiveAssets(studioId?)`、直传走 A 的 `uploadArchiveToSignedUrl(receipt, body, mime, onProgress)`（有该方法就用，鉴权形态由 A 封装；B 自带的裸 PUT+Bearer 仅测试替身使用）；临时地址方法 B 兼容 `archiveAssetUrl`（实际名）与 `getArchiveAssetUrl`（报告草案名）。
2. **B 自行补的客户端校验**（A 不需要改，但请知悉）：format 按 A 的 `archiveFormats` 白名单预检，不在名单的扩展名在客户端直接失败并给可读文案（不撞 422）；回执要求 UUID 资产号 + byteSize 与文件一致 + sha256 64hex 且与本地哈希一致，任一不符不算上传成功。
3. **manifest wire 已对齐 strictObject**：依赖项只含 `{assetId, visibility}`（A 的 superRefine 还要求去重，B 端已去重）；`sources` 按 A 契约传 `Record<string, unknown>` 登记表。scene 由 `layoutToBackendScene` 产出后透传。
4. **待 A 确认**：
   - `getCompleteProject`/`saveCompleteProject` 在 session 上返回 `unknown`，B 用 `parseCompleteProjectSnapshot` 按 `CompleteProjectReceipt` 形状解析；若 A 最终改成 zod schema，请保持这五个字段名。
   - 大扫描（>阈值）服务端只做 size-only 校验（integrity 字段已有）：B 的回执校验仍要求 sha256 与本地一致，若 A 对 size-only 路径不回真实哈希，请提前告知，B 放宽该分支并如实标注「仅大小复核」。
   - `listArchiveAssets` 是否分页（当前按全量数组消费，物料量级大时需改）。
   - 生产桶 2GiB 与直传超时策略（A 报告已列为待验，B 的队列按 `needs-file`/`failed` 如实承接失败，不做无限重传）。

## 三、给 C 的集成要求（由 C 改其文件）

1. **发布闸门（最重要）**：`room-organizer` 已注册 `registerPublishGateProvider`。share-menu/share-panel 的发布动作在发送发布请求前 `await publishGateSnapshot()`（从 `lib/project-manifest.ts` 导入），检查 `readyForPublish`；`complete:false` 时展示 `gaps`（未归档依赖清单）与 `note`，**不发送发布请求**。provider 未注册/抛错时快照明确不可用（`readyForPublish:false`），按失败处理，不当作通过。
2. **扫描入口接入云归档**：`space-panel.tsx` 的 `submitScanFile` 在本机代理上传成功后，调用 B 的 hook `useCloudArchive(...)`（在 space-panel 顶部以 `controller`/`cloud.user.id`/`enabled: !!user && !anonymous` 实例化）的 `enqueueFile({localId: asset.assetId, name: 文件名, kind: 'scan', file})`，把原件补进私有归档队列。不调用 `space-panel` 以外 B 的私有函数即可，接口就是这两个方法。
3. **案例目录**（`cloud-case-catalog.tsx` 等 C 新文件）不要把编辑 URL 当公开分享的语义留给 cloud-panel 的 shareProject——那是 C12 范围，B 未改 shareProject。

## 四、任务映射与实现要点

- **C03 全类型可靠归档**：通用队列按 kind=model/scan/floorplan/photo/attachment 收件；GLB 走既有 `prepareLayoutAssetsForCloud`（保存前同步链），模型/扫描原件可经盘点页补传进队列；资料图缺口在清单里如实列出（本机 blob 未上传不算归档）。未接入通道时（transport 为 null）UI 明示「云端归档通道未接入」，队列只在本机积累。
- **C04 持久上传队列**：IndexedDB 持久化（含 Blob 原件或 localUrl）；进度为 UI 易变值不落盘，状态/尝试次数/错误/回执落盘；刷新后 uploading 任务恢复 pending；`needs-file` 标记原文件不可读（代理没开/文件被清），明确要求原设备补传而不是无限重试；requestId 幂等 + 内容变更换新 requestId（服务端指纹绑定语义）。
- **C05 统一保存状态**：六态派生优先级 冲突 > 同步中 > 素材归档中 > 失败 > 待同步 > 云端已保存 > 本机；云端确认带 revision/confirmedAt；绑定项目待同步数跟 session dirty 真值，户外按本地保存计数+回执抵扣；「同步中」期间的新编辑不被旧回执清空（序号结算）；队列活动并入上传态。
- **C06 完整项目保存**：`buildCompleteManifest` 产出 A wire 形状清单（scene/outdoor/sources/dependencies）；gaps 非零不算完整；发布闸门把「依赖全部归档 + 云端有确认版本 + 无待同步 + 无冲突」收成 `readyForPublish`。注：完整保存的**服务端落库**（saveCompleteProject）依赖 A 的 Edge 补丁上线，B 侧云面板已接「核对完整归档/恢复到画布」读取链。
- **C07 跨设备恢复**：云端项目卡列表恢复场景是既有链路；本次补「恢复到画布」：`getCompleteProject` → 解析 → `backendSceneToLayout` 换画布（不绑编辑权，与本机缓存打开同范式）+ 户外规划写回对应槽位（本机有更新版本时不静默覆盖）。素材短地址按权限换取（复制地址按钮），不把短地址当主键。
- **C14 存量盘点**：聚合 aholo 注册表、asset-cloud 映射、归档队列、资料图（当前活动 scope）、户外规划记录（localStorage 枚举）；明细区分「已归档（私有）/已上传云端资产/公共云资产库副本（非私有归档）/待补传/需原文件/失败」；一键把可读的 pending 物料/扫描登记进补传队列；不删任何本机副本。

## 五、验证

命令与原始输出（frontend 目录；2026-11-20）：

1. `npm run typecheck` — **B 的全部文件 0 错误**。残余错误全部位于 A 并行进行中的文件（`client/scene-client.ts` 5 条、`frontend/lib/backend-session.ts` 5 条、`supabase/functions/_shared/cloud-storage.ts` 1 条），B 未触碰。原始输出节选见下方留档。
2. `npx vitest run archive-queue.test cloud-archive.test save-status.test project-manifest.test local-inventory.test` → `Test Files 5 passed (5) / Tests 50 passed (50)`。
3. `npx vitest run cloud-panel.react.test` → `Test Files 1 passed / Tests 87 passed`。期间发现并修复一个真实回归：A 的方法进 backendSession 后，B 的 hook 若在挂载时就发 `getCloudCapabilities`，会给既有精确计数的请求序列插入未排队请求——已改为**惰性查询**（仅归档页可见时），并用 HEAD 基线对照（revert 我的文件后 87/87 过）确认失败确由该改动引入而非既有。
4. `npx vitest run outdoor-plan-overlay.merge.react.test gm-compass-host.test` → `Tests 21 passed (21)`。修复一个批处理吞帧问题：React 18 会把 `saved` 与推送结算合成一帧，`saved` 上报丢失；推送回执改为 macrotask 边界后结算。
5. `npx vitest run room-organizer`（vitest 把过滤词匹配到了全 frontend：617 个测试文件）→ `Test Files 29 failed | 585 passed / Tests 229 failed | 7555 passed | 56 skipped`。**归因**：失败套件包括 12 个 `room-organizer-*.react.test.tsx`，但用同一份 HEAD 基线对照（checkout 掉 B 的 3 个已跟踪改动文件后重跑）抽验 `room-organizer-switch-guard/zone-race/venue-epoch` 三个套件，失败数量与内容完全一致（3 文件 8 失败）——即这些失败来自共享工作区里其他并行任务的半成品（`agent-panel.react.test.tsx`、`scene-layers.test.ts`、`share.test.ts`、`outdoor-event-logic.ts`、`backend-session.ts` 等在 git status 里都是他任务已改状态），不是本任务引入。B 直接触碰的套件全部通过：本任务 5 个新模块 50/50、`cloud-panel.react.test` 87/87、`outdoor-plan-overlay.merge` + `gm-compass-host` 21/21。全量收口与全局绿由总集成在三个任务合流后串行执行。

未验证（如实声明）：

- **真实云端**：`/cloud/*` 接口在数据库/Edge 补丁人审并部署前返回 503 `CLOUD_STORAGE_UNAVAILABLE`。队列/状态机在该状态下的表现是「如实失败 + 本机保留」，已按 503 文案接好，但未对真实服务端跑过一次成功上传。
- **V01–V14 验收矩阵**全部待验（真实管理员 UUID、三账号、干净设备）。
- 大扫描（>10MiB，直至 2GiB）的 SHA-256 计算、直传与 complete 的端到端耗时/中断行为，仅有单元级证据（NIST 向量、分块一致性、平台 crypto 对照）。
- `enqueueFile`（扫描入口）在 space-panel 的接入由 C 落码，端到端未通。

## 六、下一批接手点

- 总集成：接通 A 的 backendSession 方法后，跑 `npm --prefix frontend run test` 全量 + 三账号验收；B 的云端路径只在 `resolveCloudArchiveTransport` 探测通过后生效，无 feature flag 需要移除。
- C：按 §三 接发布闸门与扫描补传；`replica-${id}` 覆盖问题按 C 卡自行处理。
- A：§二.4 的四项确认；`backend-session.ts`/`scene-client.ts` 的 tsc 错误（B 未触碰）。
- 后续批次：完整保存的服务端落库链（saveCompleteProject 写入）与户外/室内依赖清单的字段覆盖表（§5.2 要求）需要 A/B 联合收口。
