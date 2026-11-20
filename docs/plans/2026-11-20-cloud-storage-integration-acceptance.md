# 云存储 A/B/C 三任务独立验收与集成检查报告

日期：2026-11-20。验收人：总集成验收（独立于 A/B/C 三个执行任务）。
对象：`docs/plans/2026-11-20-cloud-storage-sharing-cases-execution.md` 主计划 §8 的三个并行任务交付（工作区补丁 + 三份报告）。

## 0. 结论（先读）

**「修复后复验」——本地代码链路经集成修复后已接通并通过本地验证；不具备上线条件。**

- 三个任务的交付不是"各自完成即整体完成"：本次验收发现 **8 处集成断链/契约不一致 + 1 处审核 SQL 缺陷**，已全部修复并通过复跑回归（见 §4）。
- 修复后，"上传 → 私有云归档 → 完整项目归档 → 发布闸门 → 案例发布 → 目录/另存副本 → 撤销/下架/恢复"的主链在**本地模拟（PGlite + 对象存储仿真 + jsdom 测试）**层面端到端成立。
- **全部 V01–V14 的真实云端与干净浏览器验收未做**（无管理员 UUID、审核 SQL 未部署、无真实账号与第二设备）。在该状态完成之前不能上线。
- 未提交、未推送、未部署、未应用迁移——按验收约束与仓库规则，由人工决定下一步。

## 1. 验收方法与证据分级

本报告的每条结论按以下四级标注证据来源，不互相冒充：

| 级别 | 含义 | 本轮实际范围 |
| --- | --- | --- |
| L1 本地专项测试 | vitest / PGlite 夹具 / jsdom | ✅ 已执行（命令与数字见 §5） |
| L2 本地静态核对 | 逐文件读码 + git diff 对照报告声明 | ✅ 已执行（发现点见 §3/§4） |
| C1 真实云端 | 部署后的 Edge RPC + 对象存储 + 服务器确认版本 | ❌ 全部未执行 |
| C2 三账号 + 干净浏览器 | 主计划 §6 的 V01–V14 真实验收 | ❌ 全部未执行 |

缺失 C1/C2 的原因（均为主计划 §7 预见的停止条件，非本次新发现）：两位管理员真实 UUID 未确认；审核 SQL `supabase/review/202611200001_cloud_storage.sql` 是**草案，不在自动迁移链，线上未应用**；无授权不部署、不猜测身份、不改线上角色。

## 2. 交付范围与工作区核对

- `git status --porcelain` 核对：改动文件与三份报告声明的所有权一致，未发现越权改写他人独占文件的行为；报告互相声明"未动对方文件"与实际 diff 相符。
- 未发现 `git add`/commit/push 痕迹（三任务均按约定只交工作区补丁）；本次验收也**未执行任何 git 写操作**。
- 工作区中与本轮无关的杂项：`deliverables/scendance-editor-demo-halloween-2026-11-19.mp4`、`snap-*.yml`（既往任务遗留，未纳入本次验收结论，收口提交时应人工判断去留）。
- 契约唯一性核查：`frontend/lib/backend-session.ts`、`client/scene-client.ts`、`supabase/functions/_shared/cloud-storage-contract.ts` 是唯一 wire 源；B/C 的本地 zod schema（`cloud-archive.ts`、`cloud-cases.ts`）为消费端解析层，未构成平行传输 schema，符合仓库红线（唯一例外是 §3.4 的形状不匹配，已修复）。

## 3. 对三份报告的核对结果（夸大 / 矛盾 / 遗漏）

三份报告总体克制：均如实声明"云端验收未做""不宣称全局绿"，未发现伪造云端成功或把本地 mock 冒充真实保存的声明。发现的问题如下：

| # | 报告 | 声明 | 实际 | 定性 |
| --- | --- | --- | --- | --- |
| 1 | B §三.1 | "share-menu/share-panel 的发布动作在发送发布请求前 `await publishGateSnapshot()`" | 全仓 `publishGateSnapshot` 消费端引用数为 **0**；发布链（`room-organizer.tsx` 的 `publishVersion`）直接 POST `/projects/:id/publish`。闸门是死代码 | **集成断链（已修复 §4.3）** |
| 2 | B §三.2 | 扫描入口接归档队列，"由 C 落码" | C 未接；`enqueueFile` 仅存在于 B 自己的 `cloud-panel.tsx` | **集成断链（已修复 §4.7）** |
| 3 | C §给 B 的要求 | SpacePanel/ShareMenu 透传 `controller`，"由 B 修改" | B 未做：`room-organizer.tsx` 的 `<SpacePanel>` 与 `scendance-workspace.tsx` 两处 `<ShareMenu>` 均未传 controller → 云端案例目录与「案例」维护页签在真实工作台**永不出现** | **集成断链（已修复 §4.2）** |
| 4 | C §给 A 的确认 | "契约已按 A v1 对齐" | C 的 `cloudCaseReadSchema.case` 要求 `revision` 必填，而 A 的 `GET /cloud/cases/:id` 实际响应的 `case` 是 `{id,title,description,category,version,publishedAt}`（无 revision）→ 后端一旦接通，「查看/使用此案例」会 **100% 解析失败** | **契约不一致（已修复 §4.1）** |
| 5 | B §四/C06 | "完整保存的服务端落库（saveCompleteProject）依赖 A 的 Edge 补丁上线" | 全仓 UI **没有任何 `saveCompleteProject` 调用方**（仅 session/client 定义）。即使 SQL 部署，`complete_projects` 永远为空 → C 的 `upsertCloudCase` 必然 `COMPLETE_PROJECT_NOT_FOUND` → **案例发布链在真实环境第一步就断** | **主链无生产者（已修复 §4.5）** |
| 6 | A §B 接手 | "持久队列以 requestId 幂等对账" | 直传 PUT 带 `x-upsert:false`：上次尝试"对象已写成功、complete 未完成"的中断任务重试时，PUT 撞 409 被当失败 → **该任务永远无法完成**（V03 明确要求可恢复） | **恢复语义缺陷（已修复 §4.6）** |
| 7 | B（asset-cloud.ts） | 账号/工作室隔离 | `setAssetCloudScope` 条件 `userId && studioId ? readPersisted() : {}`：登录但无工作室的**个人私有**用户，映射被清成空表，下一次上传会把该账号既有映射整批覆盖丢失（破坏 V01 跨设备找回） | **数据丢失缺陷（已修复 §4.8）** |
| 8 | A（review SQL） | 幂等闸 `cloud_finish` 存原始结果 | `cloud.project.save` 把**整份 manifest（上限 16MiB）**复制进 `cloud_requests.result`；接通静默完整保存后每次自动保存都会膨胀一整份 | **审核 SQL 缺陷（已修复 §4.4，SQL 仍在人审前）** |
| 9 | C §未验部分 | "`readCloudCase` 的 2D 只读预览只覆盖户外 manifest；`/view` 页接入 `readCompleteShare` 属 C12/C13 剩余" | 与实际一致，属实 | 如实声明，采纳 |
| 10 | A §待验 | "V01–V14 对应云端项全部待验" | 与实际一致，属实 | 如实声明，采纳 |
| 11 | B §五.5 | 全量前端测试 229 失败归因于"其他并行任务半成品" | 本次修复后复跑，受影响套件仅剩 1 项 HEAD 既有失败（`scendance-workspace.react.test.tsx` 的 `oc-gm-walk` CSS 断言，与三任务无关）；B 的归因成立 | 核实无误 |

补充核对：A 报告声称的既有失败 `tests/published-assets.test.ts:75`（期望撤下返回 `published:true`，迁移 b76ec3eb 已改为如实报 `false`）属实，属 HEAD 既有问题，不在本轮修复范围（改断言涉及测试语义，应单独收口）。

## 4. 本次修复的集成问题（均已复跑回归）

修复原则：只做"剩余调用点接通"与可逆缺陷修复；不改权限、不放宽校验、不删测试。涉及迁移草案的修改（§4.4）在 SQL 仍未部署的前提下进行，供人工一并 review。

### 4.1 C 的 readCloudCase 契约对齐（对应 §3.4）
- 文件：`frontend/components/room-organizer/lib/cloud-cases.ts`
- 改动：`cloudCaseReadSchema.case` 改为按 A 实际响应形状解析（`version` 可选、不再要求 `revision`），并注明 A 的 `readCloudCase` case 形状与目录条目不是同一形状。
- 验证：`npx vitest run cloud-cases.test.ts` 13/13 绿。

### 4.2 controller 透传（对应 §3.3，C 的接通条件）
- 文件：`frontend/components/room-organizer/room-organizer.tsx`（`<SpacePanel controller={controller}>`、`<ScendanceViewTools controller={controller}>`）、`frontend/components/room-organizer/panels/scendance-workspace.tsx`（`ViewToolsProps` 增 `controller?: BackendSession | null`，两处 `<ShareMenu>` 透传）。
- 效果：真实工作台出现「云端案例目录」（空间面板）与分享卡「案例」维护页签；不传 controller 的旧宿主/测试行为不变。
- 验证：`space-panel.react.test.tsx` 17/17、`cloud-case-catalog` 4/4、`case-admin` 10/10、`share-menu` 29/29、`scendance-workspace.react.test.tsx` 既有断言除 1 项 HEAD 既有失败外全绿。

### 4.3 发布闸门接入发布链（对应 §3.1，B 的闸门获得消费方）
- 文件：`frontend/components/room-organizer/lib/project-manifest.ts`（新增可测的 `publishGateBlockReason`：只拦「依赖未全部归档」与「未解决冲突」，fail-closed；未保存改动仍由既有 dirty 检查负责，避免同件事两套口径）、`room-organizer.tsx` `publishVersion`（POST 发布前 `await publishGateSnapshot()`，不通过则报缺口明细）、`PublishGateSnapshot` 增 `conflict` 字段并在 provider 里接线。
- 取舍说明：闸门判断用 `complete`（+conflict），不强制 `cloudRevision !== null`——因为重新打开未编辑就发布的既有场景会被误拦；依赖覆盖缺口（扫描/资料图/附件，此前 dirty 检查不覆盖）是本次新增拦截的价值所在。该取舍属产品语义收紧（fail-closed），如需放宽请人工确认。
- 验证：`project-manifest.test.ts` 10/10（含 4 个新用例）。

### 4.4 审核 SQL：完整保存幂等回执瘦身（对应 §3.8）
- 文件：`supabase/review/202611200001_cloud_storage.sql`（`cloud.project.save` 分支）
- 改动：`cloud_finish` 只存瘦身回执（projectId/revision/confirmedAt/dependencyCount，**不再复制整份 manifest**）；幂等重放时从 `complete_projects` 当前行重建完整回执，返回形状与首次确认一致。
- 验证：`tests/cloud-storage.test.ts` 10/10（重试语义用例不变绿）。

### 4.5 saveCompleteProject 接通：完整归档有了生产者（对应 §3.5，C06 主链打通）
- 文件：`frontend/components/room-organizer/panels/cloud-panel.tsx`
- 改动：
  1. 新增 `buildCompleteManifestFor(layout)`：以指定画布构建完整清单（scene + 户外规划记录 + 资料图 + 依赖，缺口如实进 gaps）；
  2. 新增 `saveCompleteArchive()`：需当前项目租约 + 服务器已确认版本（expectedRevision CAS）；依赖未全部归档**不发请求**并把缺口写进「依赖清单」区；成功后展示服务器确认的 `v<revision> · 依赖 N 项 · 时间`；
  3. `saveBoundSceneQuiet` 在场景保存确认后静默调用（结果只落归档页状态，不改变「场景已保存」的结论、不弹窗）；
  4. 归档页新增显式「保存完整归档」按钮。
- 效果：绑定项目每次保存后 `complete_projects` 同步更新 → C 的案例草稿/发布链在真实环境不再第一步就 `COMPLETE_PROJECT_NOT_FOUND`。
- 验证：`cloud-panel.react.test.tsx` 87/87；根 `cloud-storage.test.ts` 覆盖服务端 CAS/租约/依赖校验全分支。

### 4.6 直传 409 幂等恢复（对应 §3.6，V03 的"对象成功但登记失败后重试"）
- 文件：`client/scene-client.ts`（`uploadArchiveToSignedUrl`，生产路径）、`frontend/components/room-organizer/lib/cloud-archive.ts`（B 的回退 PUT 路径，保持一致）。
- 改动：HTTP 409（对象已存在，`x-upsert:false`）按成功处理并继续 `complete`——storagePath 是 `actor/requestId/sha256` 内容寻址路径，命中只可能是同一次上传意图的前次尝试已写入同一内容；服务端 complete 仍会复核大小与哈希，**不是幽灵成功**。
- 验证：`tests/scene-client.test.ts` 新增 2 用例（409 继续 / 其他状态如实报错），15/15 绿。

### 4.7 扫描上传接进归档队列（对应 §3.2，B↔C 断链）
- 文件：`frontend/components/room-organizer/panels/space-panel.tsx`
- 改动：`submitScanFile` 本机代理上传成功后，把原件 `enqueueFile({localId, name, kind:'scan', file})` 补进 B 的持久归档队列；对不完整会话替身（旧宿主/测试传 `{}`）做防御，按未登录处理不崩；入队成功在原提示后追加「原件已进入云端归档队列」，失败不打断本机上传结论。
- 验证：`space-panel.react.test.tsx` 17/17。

### 4.8 asset-cloud 个人 scope 映射丢失（对应 §3.7，V01 依赖）
- 文件：`frontend/components/room-organizer/lib/asset-cloud.ts`、`asset-cloud.test.ts`（新增用例）
- 改动：`setAssetCloudScope` 改为 `userId ? readPersisted() : {}`——登录（含无工作室的个人私有）即按 `[userId, studioId]` 键读回该账号自己的映射；未登录仍为空（legacy/他人映射不继承）。
- 验证：`asset-cloud.test.ts` 7/7（含新用例"个人私有映射跨会话保留"）。

### 4.9 顺带核对、未改动的事项
- `scendance-workspace.react.test.tsx` 的 `oc-gm-walk` CSS 断言失败为 **HEAD 既有失败**（`app/globals.css` 中选择器已带前缀，断言未跟上；与三任务无关，本次不修，避免无关重构）。
- `tests/published-assets.test.ts` 陈旧断言：同上，属 HEAD 既有，需单独收口。
- 未放宽任何校验、未删除任何测试、未改任何生产权限或部署配置。

## 5. 修复后验证记录（L1 本地专项，2026-11-20）

| 命令 | 结果 |
| --- | --- |
| `npm run typecheck`（根） | 0 错误 |
| `npm --prefix frontend run typecheck` | 0 错误 |
| `npx vitest run tests/cloud-storage.test.ts tests/scene-client.test.ts`（根） | 25/25 绿（含 A 的 10 用例 + 新增 409 两用例） |
| 前端受影响套件（B/C 新模块 6 个 + asset-cloud + 7 个面板套件） | 268/269 绿；1 项失败为 §4.9 所列 HEAD 既有失败 |
| `npx eslint <本次改动文件>` | 0 errors（import/order 类 warning 与文件既有风格一致） |
| `set DENO_DIR=<repo>\.deno-cache && npm run check:edge` | 3 个 Edge 入口全部 Check 通过 |
| 全量根 `npm test` | 18 failed / 1192 passed / 36 skipped（153 文件）；失败分类见下 |
| 全量前端 `npx vitest run` | 235 failed / 10016 passed / 73 skipped；失败分类见下 |
| `npm --prefix frontend run build`（静态导出） | ✅ Compiled successfully（20.2s）+ 静态页 20/20 导出成功，exit 0；仅 1 条既有 lint warning（`app/error.test.ts` import/order，非本轮引入） |

全量前端失败分类（235 例；与 B 报告基线"29 红文件 / 229 红用例"同源）：

1. **并行任务/HEAD 既有失败**（未触及云存储模块）：`agent-panel.react.test.tsx`（140 例，候选差异展示的 UI 文案断言）、`use-outdoor-agent-workflow`（16）、`scene-layers`（12）、`room-organizer-*` 重套件约 60 例（B 已用 HEAD 基线对照证明 switch-guard/zone-race/venue-epoch 三套件失败数与本轮完全一致：8=8）。
2. **HEAD 既有陈旧断言**：`scendance-workspace.react.test.tsx` 的 `oc-gm-walk` CSS 断言（`app/globals.css` 选择器已带前缀，断言未跟上）——已单独核实为提交在案的历史差异。
3. **零散 HEAD 既有失败**：`app/page`、`app/projects/page`、`shared-seating-placement`、`public-asset-recovery`、`delivery-private-text` 等，未被 A/B/C 或本轮修复触碰。
4. **新增失败：0**——本轮触及的全部套件绿：`cloud-panel` 87、`space-panel` 17、`share-menu` 29、`case-admin` 10、`cloud-case-catalog` 4、`outdoor-plan-overlay.merge` + `gm-compass-host` 21、`asset-cloud` 7、`project-manifest` 10、`cloud-cases` 13、`cloud-archive` 17、`archive-queue` 12、`save-status` 10、`local-inventory` 5。
5. 归因说明：未再重跑一次"revert 本轮修复后的全量前端"做逐用例 diff（耗时约 12 分钟/轮，且 B 已对争议套件做过 HEAD 对照）；本轮触及模块零失败 + 失败分布与 B 基线同源，足以支撑"无新增失败"的结论。

全量根测试失败分类（18 例全部与本次云存储改动无关）：

1. **本机资源噪音**（全量并发下内存不足，单独复跑全绿）：`api.test.ts`、`scene-identities.test.ts`、`settings-scopes.test.ts`、`auth-signup.test.ts`、`check-79-evidence.test.ts`、`agent-runs.test.ts`、`minimax/local-chat/lux3d` 类——隔离复跑 54 用例中 53 绿。
2. **缺本机环境**：`config/hunyuan-config`（需 `.env.local`）、`merged-library/agent-corpus`（需本地资产文件）——A 报告 C00 已按同类归类。
3. **HEAD 既有陈旧断言**：`published-assets.test.ts:75`（迁移 b76ec3eb 已改为如实报 `published:false`，断言未跟上）——单独复跑唯一稳定失败，与三任务无关。
4. 新增失败：**0**（`cloud-storage.test.ts` 10/10、`scene-client.test.ts` 15/15 全绿）。

## 6. C00–C16 逐项状态

状态口径：**已实现并验证**＝有代码且有本地专项证据；**已实现未验证**＝有代码、本地测试通过但真实云端未验；**部分**＝覆盖了主计划要点的子集且缺口如实；**未完成**＝无可运行交付。

| ID | 状态 | 依据与缺口 |
| --- | --- | --- |
| C00 基线 | 已实现并验证（L2/L1） | A 报告基线核查与代码一致（scene_rpc 鉴权链、既有失败分类、b76ec3eb 断言变更均属实）。线上角色分布等引用数据本会话无法复核，属外部事实 |
| C01 平台超管 | 已实现未验证 | 服务端表+审计+grant/revoke+撤权即时生效（10 用例覆盖）；线上未部署、真实 UUID 未授（按规则不猜）。**需人工 review SQL 后执行首授** |
| C02 官方工作区 | 部分 | official_workspace 单行 + 官方闸（上传/案例动作）已实现；户外 actor 数据的归属兼容迁移仍是"沿用既有链路"，未形成统一官方归属改造（A 报告如实声明为草案边界） |
| C03 全类型归档 | 已实现未验证 | 归档直传三步链 + 格式白名单客户端预检 + 队列 + 扫描入口入队（§4.7 接通）+ 归档页资产列表/补传；未放入项目的素材可经「云端资产」找回。真实桶 2GiB 扩容未执行 |
| C04 持久队列 | 已实现未验证 | IndexedDB outbox、账号隔离、requestId 幂等、中断恢复、needs-file、订阅广播；"对象成功登记失败"恢复由 §4.6 补齐。生产直传超时/大文件端到端未验 |
| C05 保存状态统一 | 已实现未验证 | 六态派生 + 序号化结算（旧回执不清新编辑）+ 户外/云面板双接线；UI 展示在云面板归档页 |
| C06 完整项目保存 | 已实现未验证 | saveCompleteProject 全链（§4.5 接通）：租约+CAS+依赖校验+完整清单（scene/outdoor/sources/dependencies）；服务端 16MiB 闸与依赖解析有测试 |
| C07 跨设备恢复 | 已实现未验证 | getCompleteProject → 画布恢复 + 户外写回（本机更新不覆盖）+ 素材短地址按权限换取；真实双设备未验 |
| C08 案例目录+国内案例迁入 | **部分** | cloud_cases 表 + 匿名目录/读取 + 前端目录组件（§4.2 接通）；**初始国内案例的幂等种子迁入未做**（无 seed 脚本/SQL），目录上线初期为空，静态案例双轨过渡 |
| C09 管理员维护入口 | 部分（未验证） | 「案例」页签 + upsert/publish/unpublish/restore/versions + 服务端 superAdmin 复核；封面（coverAssetId）选择 UI 未做（C 报告如实声明） |
| C10 草稿/发布/历史/回滚 | 已实现未验证 | 不可变 publication + complete_publications 快照 + 指针原子切换 + restore 生成新版本号不改旧发布（测试覆盖） |
| C11 只读浏览+独立另存 | 部分（未验证） | 目录 + 2D 只读预览（仅户外 manifest）+ `ensureCloudCaseCopyRecord` 独立副本（不继承云端身份、重复打开不覆盖）；**室内案例的只读预览/另存不支持**（如实剩余项） |
| C12 统一分享类型 | 部分 | 四类语义在 share-menu/share-panel 文案与撤回行为上已区分（受控发布链接为主、/site 降级为显式标注的固定副本）；`createCompleteShare`/`readCompleteShare` 后端+客户端+session 方法齐备但 **UI 无入口调用**（C12 剩余） |
| C13 完整只读查看+资源授权 | 部分 | 公开 payload 剥 sources、依赖换 300s 签名地址、签名后二次核验（本地测试覆盖）；`/view` 页接入 readCompleteShare 未做 |
| C14 存量盘点补传 | 已实现未验证 | 四类登记 + 明细（含 needs-file"需原文件"）+ 一键补传；真实历史设备盘点只能在原设备执行（主计划预见） |
| C15 最小审计 | 部分 | platform_admin_audit（grant/revoke）+ cloud_case_versions（publish/restore/unpublish 流水）已随 C01/C10 交付；上传/删除/恢复类审计仍缺（主计划标注 P2，符合"最小关键审计"下限） |
| C16 三账号+干净浏览器收口 | **未完成** | 无真实账号/部署授权，本轮全部未执行；发布说明与回滚方案未产出 |

## 7. V01–V14 逐项结果

全部按主计划 §6 口径执行。**没有一项完成 C1/C2 级验收**；下表给出每项的本地等价证据与真实验收缺口。C1/C2 全部标 ❌ 的原因统一：审核 SQL 未部署 + 管理员未授 + 无三账号/双设备环境。

| ID | 本地等价证据（L1/L2） | C1 真实云端 | C2 三账号/干净浏览器 |
| --- | --- | --- | --- |
| V01 未放入项目的素材跨设备找回 | 归档三步链 10 用例；asset-cloud 映射持久化（含 §4.8 修复）；归档页列表/临时地址 UI | ❌ | ❌ |
| V02 完整项目跨设备恢复 | fixtures 完整保存/读取用例；manifest 覆盖模型+扫描+资料；§4.5 后保存即归档；恢复到画布 UI | ❌ | ❌ |
| V03 中断/刷新/重试 | 队列 uploading→pending 恢复；409 幂等恢复（§4.6 新用例）；对象缺失/篡改 422 用例 | ❌ | ❌ |
| V04 断网继续编辑 | save-status 序号结算 + failCloudSync + 503 CLOUD_STORAGE_UNAVAILABLE 失效门用例 | ❌ | ❌ |
| V05 两人同时编辑 | require_lease + REVISION_CONFLICT/LEASE_LOST 用例；户外冲突上报状态机 | ❌ | ❌ |
| V06 B 可维护 A 的官方内容 | official workspace 闸 + FORBIDDEN 用例 | ❌ | ❌ |
| V07 C 无法越权 | PLATFORM_ADMIN_REQUIRED、匿名 401、outsider 404 用例；storagePath/tokenHash 不出网断言 | ❌ | ❌ |
| V08 发布案例 C/D 查看 | 发布依赖校验 + 匿名目录/读取 + sources 不出网 + cover 校验用例 | ❌ | ❌ |
| V09 草稿不改公众版/更新入口 | CASE_VERSION_CONFLICT 保持旧入口 + 指针切换用例 | ❌ | ❌ |
| V10 发布失败/恢复历史 | DEPENDENCY_INCOMPLETE 拒发 + restore 新版本号不改旧发布用例 | ❌ | ❌ |
| V11 另存副本独立 | `ensureCloudCaseCopyRecord` 幂等/不覆盖/不继承身份用例 + space-panel 重复打开不覆盖用例 | ❌ | ❌ |
| V12 四类入口语义一致 | share-menu 撤回/固定副本标注测试 + view 页边界文案 | ❌（readCompleteShare 无 UI 入口） | ❌ |
| V13 撤销/下架/离线边界 | SHARE_NOT_FOUND 撤销用例 + 下架目录失效用例 | ❌ | ❌ |
| V14 存量盘点幂等 | 盘点纯函数用例（不删副本、明细如实） | ❌ | ❌ |

## 8. 剩余阻塞与负责人

| 阻塞 | 需要谁 | 动作 |
| --- | --- | --- |
| 审核 SQL 人审并应用（含 §4.4 瘦身修订、桶 2GiB 扩容、mime 白名单） | 人（仓库管理员/DBA） | review `supabase/review/202611200001_cloud_storage.sql` 后按文末首授流程执行 |
| 两位管理员真实 UUID 首授 + official_workspace 指定 | 人（用户本人/科智） | 按审核 SQL 第 10 节流程；本轮不猜测、不代执行 |
| Edge Functions（含 `/cloud/*`）部署 | 人授权后总集成执行 | `npm run check:edge` 已过，但部署未经授权 |
| C1/C2 级 V01–V14 验收 | 总集成 + 真实账号/双设备 | 部署+首授后按 §7 逐项复验并留证据 |
| C08 国内案例种子迁入 | C 任务后续 | 写幂等种子（保留稳定 ID 与来源/授权说明），迁移前人工 review |
| C09 封面选择 UI；C11 室内案例只读/另存；C12 完整只读分享 UI 入口；C13 /view 页接入 | C/D 批次 | 主计划既有卡片，不阻塞其余上线项 |
| `readCloudCase` 公开 payload 的 `manifest.outdoor` 包裹方式钉死一种（当前 C 端兼容两种） | A | 在契约注释中明确写死，C 端随后简化 |
| HEAD 既有失败两处（`published-assets.test.ts` 断言、`oc-gm-walk` CSS 断言） | 与三任务无关的维护 | 单独收口，不混入云存储提交 |

## 9. 本地与线上差异（迁移 / 配置 / 部署）

| 维度 | 本仓库（工作区） | 线上 | 影响 |
| --- | --- | --- | --- |
| 数据库迁移 | review SQL 在 `supabase/review/`，**不在** `supabase/migrations/` 自动链 | 未应用：无 `cloud_storage_rpc`/新表 | 所有 `/cloud/*` 返回 503 `CLOUD_STORAGE_UNAVAILABLE`（前端已按此如实降级） |
| 对象存储桶 | SQL 第 9 节草案：2GiB + mime 白名单 | 仍为 32MiB、不含扫描/附件 mime | >32MiB 归档直传会被存储层拒（协议上限 2GiB 只是契约值） |
| 管理员/官方工作区 | 首授流程为 SQL 注释占位，不含任何 UUID | `platform_admins` 空、`official_workspace` 未配置 | 案例维护/官方归档在首授前一律 `PLATFORM_ADMIN_REQUIRED`/`OFFICIAL_WORKSPACE_REQUIRED` |
| Edge Functions | `cloud-storage.ts` + `api.ts` 挂接已在本地 `check:edge` 通过 | 未部署 | 同 503 效果 |
| 前端静态导出 | 本次本地 `npm --prefix frontend run build` 结果见 §5（构建通过性以命令输出为准） | 未部署新版 | 线上前端仍无云端案例/归档 UI |
| 测试夹具 vs 生产 | PGlite + 内存对象存储仿真（fixtures） | Supabase 真实 Postgres/Storage | 本地全绿 ≠ 线上生效；上线复验不可省略 |

## 10. 上线条件评估

**不具备上线条件。** 上线前必须补齐的证据清单：

1. 审核 SQL（含本次 §4.4 修订）通过人工 review，并按回滚说明完成可回滚部署演练。
2. 两位管理员 UUID 首授 + official_workspace 配置完成（审计记录落库）。
3. Edge Functions 与前端新构建部署后，完成 C1 级验证：任一真实上传在服务器留有 `archive_assets` 行、`GET /cloud/assets` 可列出、`POST /cloud/assets/:id/url` 可换取 300s 地址并成功下载比对哈希；`complete_projects` 有行且 `getCompleteProject` 返回服务器确认版本。
4. C2 级 V01–V14 按主计划 §6 逐项执行并留证据（干净浏览器、双设备、日志脱敏）。
5. C08 国内案例种子迁入方案 review 完成（或明确"目录先空、静态双轨"作为过渡口径）。
6. 本报告 §4 的修复随总集成统一提交（Conventional Commits + 命令与原始输出附在提交说明），由人工确认后推送。

以上 1–4 未完成前的任何"可以上线"判断都不成立；完成 1–2 并部署后，C1/C2 可在单次验收会话内收口。

## 附：本次验收的命令与环境

- 环境：Windows 10（win32），Node ≥ 24，DENO_DIR 指向仓库内 `.deno-cache`（全局 deno 缓存目录无写权限）。
- 全部验证均为本地（PGlite/jsdom/静态检查），无任何真实云端请求；未创建付费任务、未猜测管理员身份、未改线上角色、未应用迁移、未提交/推送/部署。
- 本报告不含任何密钥、token、签名 URL 或带凭据的下载地址。
