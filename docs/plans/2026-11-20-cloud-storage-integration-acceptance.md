# 云存储 A/B/C 三任务独立验收与集成检查报告

日期：2026-11-20（第一轮验收 + 第二轮收口，同日完成）。验收人：总集成验收（独立于 A/B/C 三个执行任务）。
对象：`docs/plans/2026-11-20-cloud-storage-sharing-cases-execution.md` 主计划 §8 的三个并行任务交付（工作区补丁 + 三份报告）。
配套：部署 runbook `docs/plans/2026-11-20-cloud-storage-deployment-runbook.md`（执行顺序/影响/验证/回滚）。

## 0. 接手执行后的当前状态（2026-11-20）

**生产主链已部署，国内案例 12 条可匿名读取；两位管理员与官方工作室已配置。以下新增证据覆盖真实 API 与匿名干净浏览器，不把它等同于 V01–V14 全场景验收完成。**

执行依据：用户指定本人及科智的邮箱，明确要求无需再逐项审核并由接手者做完。凭据复用已有本机配置与 CLI 会话；无新建假账号、无密码重置、无发送登录邮件。

### 0.1 实际部署与配置

| 项目 | 已核对的生产结果 |
| --- | --- |
| Supabase | wkhfvnzgopjdzxlmycks；仅定向应用 review SQL 及本次修订，未 db push 全量迁移、未 repair 既有历史。 |
| 演练 | PGlite 测试；目标 Postgres 在事务内创建能力、切 service_role 验证后 rollback。回滚后 `cloudRpcAfterRollback:null`、`bucketLimitAfterRollback:33554432`。无专用预发配置、无可用 Docker，不能称为独立 staging 验收。 |
| 管理员 | lily1326685527@gmail.com、2487238628@qq.com；精确匹配 verified auth.users、核对既有成员关系后首授，最终 active 管理员 2 位。 |
| 官方工作室 | 复用“幕景” 5169a8c2-d2c0-4399-a395-e9b9bdfbb32c，两人已有 owner/editor 成员关系；未挪动个人项目。 |
| 存储 | scene-assets 仍为私有桶，上限 2147483648，MIME 20 项；契约内 SVG/CAD/Office 类型均覆盖。33MiB 上传真实完成并逐字节校验，未实测接近 2GiB 的文件。 |
| Edge | scene-api **v70 ACTIVE**，bundle SHA-256 `be9a26dd0821dac639c55258308aff444d36a73006141bcfb9daeda55c0cf0bf`。未部署其他函数、未改供应商密钥。 |
| 前端 | 最终 Pages 部署 **369d35f4**；[生产站](https://scendance.lilicoding.space)、[本次固定部署](https://369d35f4.scendance-scene-planner-ewz.pages.dev)。从仓库根发布，含 Pages Functions；API 参数缺失探针返回原生 400，而非静态 404。 |
| 种子 | 12 个 CN 案例、12 个种子项目；多次重复运行仍为 12，没有重复迁入。OnePlan 海外案例未迁入、未公开。 |
| 版本号 | 4.17.16 的来源已定位到既有提交 `a890e9f8`（人物登记表任务），不再属于来源不明的未提交修改。 |

Pages 首次直接上传 out 时被本地 403MiB 扫描缓存挡住，未成功发布；最终静态包只排除了 gitignored 的 `scans/` 本机缓存，保留原文件，生产扫描继续使用既有 R2 注册。中间部署已由上述最终部署替代；最终明确上传了 Functions bundle。

### 0.2 接手中复现并修复的问题

1. `createSceneClient.createCompleteShare` 对 Promise 直接做 Zod 校验：补 await；原复现失败，修后回归通过。
2. `readCompleteShare` 使用 `#<token>` 校验 `#c<token>` 语义，所有有效链接均被本地拒绝：补前缀；原回归与真实浏览器均复现，修后匿名浏览器可打开。
3. 生产 `PLATFORM_ADMIN_REQUIRED` 返回 422，而测试夹具返回 403：修正真实 backend 映射，复验普通账号 403。
4. 桶 MIME 漏 SVG/CAD/Office：真实 SVG 直传 HTTP 400 复现；补全后 HTTP 200，登记 `integrity:full`。
5. 普通用户可把他人私有资源 ID 填入个人 manifest，再通过分享换取地址：本地复现保存 200；新增 SQL `cloud_check_manifest_access`，保存、创建分享、发布案例均复核资源使用权限。修后普通账号真实请求 404；公开案例依赖仍允许独立副本保存。
6. 完整分享页只有户外数据、没有图与附件入口：补只读户外示意、完整设施清单和归档资源链接；全尺寸不沿用卡片的 90 件设施裁剪；撤销后移除内容。
7. 种子脚本工作目录导致 preload 文件找不到；改为调用前端已有 test 脚本。草稿幂等按 stableId 匹配，租约释放补认证并提前登记清理项。

### 0.3 真实云端证据

既有三账号：A/B 为上述两位管理员，C 为既有 `walkthrough-79@scendance.test` 普通 QA 账号。B/C 的测试会话通过受控管理 API 为既有账号生成并兑换登录链接，未发送邮件、未重置密码；测试后仅注销本次会话。

实际探针输出（`.tmp/cloud-live.mjs`，脱敏结果 `.tmp/cloud-live-results.json`；不输出 token、密码或签名地址）：

```text
three-existing-account-capabilities passed
anonymous-and-ordinary-user-management-denied passed
twelve-cn-cases-anonymous-read-and-source-redaction passed count=12
ordinary-user-independent-copy-and-private-dependency-denial passed
33MiB-direct-upload-and-idempotent-complete passed byteSize=34603008 integrity=full
cross-admin-download-hash-and-outsider-denial passed
complete-save-reload-idempotency-and-conflict passed
complete-share-one-time-token-public-read-and-revocation passed
case-draft-publish-conflict-restore-and-unpublish passed
two-admin-lease-handoff-and-complete-save passed
supported-svg-mime-upload passed
```

33MiB 文件明确为合成传输夹具，不是可用于场地重建的真实 SPZ。临时公开测试案例验后已下架，测试分享已撤销；最终匿名目录仍仅有 12 个 CN 案例。4 个本次 QA 项目已通过既有 `projects.delete` 软删除进入可恢复回收站；归档夹具与不可变发布记录保留，不物理删文件或清库。收尾读数：`{"publicCaseCount":12,"qaProjectsSoftDeleted":4}`。

最终数据库只读核对原始关键输出：

```json
{"adminCount":2,"bucketLimit":2147483648,"cnCaseCount":12,"mimeCount":20,"publicCaseCount":12,"rpcExecute":{"anon":false,"authenticated":false,"serviceRole":true},"seedProjectCount":12}
```

匿名全新 Chromium 上已通过：桌面 1440px 与手机宽度 390px 打开真实受控分享，显示 7 件设施、资源链接 1 条；无编辑控件，手机无横向溢出；撤销后重新载入显示“分享链接不存在或已撤销”，不再保留图与资源链接。截图保存在本机 `.tmp/cloud-browser/complete-share-desktop.png`、`complete-share-mobile.png`、`revoked-share.png`；未将含令牌的访问 URL 写入报告。

另在新的浏览器上下文通过真实表单登录管理员 A（Auth HTTP 200），关闭登录后账户面板，打开“空间 → 国内案例”：云端列表恰为 12 项，点“查看云端案例”出现只读 SVG 预览。探针 `.tmp/cloud-admin-browser.mjs` 原始结果：`{"login":"passed","catalogCount":12,"preview":"passed"}`；截图 `.tmp/cloud-browser/admin-workbench.png`。前两轮自动化因未先关闭账户模态框而超时，调整操作顺序后通过，未改产品来规避弹窗。

### 0.4 本轮验证命令与原始结果摘要

```text
vitest run tests/cloud-storage.test.ts tests/backend-auth.test.ts tests/scene-client.test.ts --no-file-parallelism
Test Files  3 passed (3)
Tests  32 passed (32)

npm --prefix frontend run test -- lib/share-api.test.ts app/view/page.react.test.tsx components/room-organizer/panels/share-menu.react.test.tsx components/room-organizer/panels/cloud-case-catalog.react.test.tsx components/room-organizer/lib/complete-archive.test.ts components/room-organizer/lib/cloud-cases.test.ts lib/cloud-case-seed.integration.test.ts --no-file-parallelism
Test Files  7 passed (7)
Tests  69 passed | 2 skipped (71)

npm run seed:cn-cases
Test Files  1 passed (1)
Tests  2 passed | 2 skipped (4)

CLOUD_SEED_REMOTE=1 [凭据仅进程内注入] 运行种子集成用例
Test Files  1 passed (1)
Tests  3 passed | 1 skipped (4)

npm run typecheck / npm --prefix frontend run typecheck
exit 0
npm run check:edge [DENO_DIR=.deno-cache]
Check scene-api / generation-worker / reconstruction-worker; exit 0
npm --prefix frontend run build
check-oneplan-artifacts: 扫描 3533 个产物文件，oneplan-icons 下随产物发布 592 个（图标资源），违规 0 条。
[strip-internal-learning] 已从静态导出剥除 out/_internal-learning（版权参考图仅本机保留）
exit 0
改动前端文件 ESLint：0 errors / 5 warnings
```

默认种子测试的两个 skipped 为显式远程门控；远程执行剩余 1 skipped 为未配置普通账号密码的专项，等价的真实普通账号越权拒绝已在三账号探针单独验证。没有为追求全绿取消任何断言。本轮未重跑全仓全量；下文 §6 是此前基线对照的历史证据，不能外推成当前全仓绿灯。

### 0.5 验收边界与非阻断后续项

- V01/V02/V03/V05–V13 已有上述范围的真实云端证据，但并非各条全组合均覆盖：没有真实模型/真实扫描组合的双物理设备恢复，也未做上传过程刷新、断网后编辑再同步的完整浏览器操作。
- V04、历史原设备的 V14，以及 V01–V14 全套三账号 UI 走查不能标为完成。匿名分享的干净浏览器验证与三账号真实 API 验证分别记录。
- 接近 2GiB 大文件、旧设备唯一副本盘点、C09 封面选择 UI、C11 室内案例另存、C15 上传/删除完整审计沿用既定后续范围；未擅自扩大成本或删除数据。
- SQL 与所有必要配置已执行，不再等待用户重复审批或提供同一批材料。回退优先禁用新增 RPC、回退静态版本并保留数据，具体见 runbook。
- 接手过程中另有会话修改 `room-organizer.tsx` 并新增 `onboarding/`、`.tmp-audit/`；未改动或纳入本次提交。生产部署来自本轮已验证构建，后续会话的工作区增量不算本次部署内容。

## 历史：部署前结论（以下 §1–§13 为接手前本地验收记录）

**「修复后复验」——本地代码链路经两轮集成修复后已全部接通并通过本地验证；具备"待部署复验"状态，不具备上线条件。**

- 第一轮发现 **8 处集成断链/契约不一致 + 1 处审核 SQL 缺陷**并全部修复（§4.1–4.8）。
- 第二轮补齐了剩余三个"阻断核心链路"缺口并又发现修复 **1 处语义级断链**（发布依赖可见性，§3.12/§4.9）：**国内案例云端种子迁入（C08）**、**完整只读分享入口与 /view 读取（C12/C13）**、**案例查看/另存链路端到端测试**；分级依据见 §1。
- "上传 → 私有云归档 → 完整归档（published 口径按需）→ 发布闸门 → 案例发布 → 目录/查看/另存副本 → 完整分享/撤销 → 下架/恢复"的**全部主链在本地测试层面端到端成立**。
- 全量失败已做**同版本、同环境（git worktree @ HEAD 0dc827b4 + node_modules junction + 复制未跟踪 .env.local）的逐项双向对照**：结论"新增失败为零"由逐项隔离证据支撑，不是分布相似性推断（§6）。
- 全部 V01–V14 的真实云端验收未做；部署与首授后的具体操作步骤已就绪（§11），最小预发部署范围见 §10。
- 未提交、未推送、未部署、未应用迁移、未改线上权限（按验收约束）。

## 1. 剩余缺口分级（阻断 vs 可延期）

### 1.1 阻断核心链路（本轮必须补齐 → 已全部补齐）

| 缺口 | 阻断理由 | 状态 |
| --- | --- | --- |
| 国内案例云端种子迁入（C08） | "国内案例可在产品内持续更新"是用户目标；目录上线即空、官方更新无对象，主链"发布不可变版本 → 案例入口"无起始内容 | ✅ `cloud-case-seed.ts` + 远程幂等迁入测试 + `npm run seed:cn-cases`（部署后执行） |
| 完整只读分享入口与读取页（C12/C13） | 主计划 §3.6"受控分享支持撤销"与 V12/V13 的验证对象；后端与客户端早已就绪但无 UI 入口/无查看页，是主链上"第三个入口类型"的空白 | ✅ 分享卡「完整只读链接」生成/复制/撤销 + `/view/#c<token>` 匿名读取渲染 |
| 案例查看/另存链路的端到端证明 | C 的"契约已按 A v1 对齐"声明在第一轮被证伪（case 形状不符）；需要用 A 的**真实响应形状**证明 查看→另存→幂等 全链 | ✅ `cloud-cases.test.ts` 新增 A 实际形状端到端用例（另存/幂等/不覆盖） |
| 发布依赖可见性断链（二轮新发现） | 服务端 `cloud.case.publish` 与 `cloud.share.create` 的发布快照只取 `visibility='published'` 的依赖并要求覆盖场景；而私有完整归档按 private 口径保存 → 案例发布/完整分享在真实环境必然 `DEPENDENCY_INCOMPLETE` | ✅ `complete-archive.ts`（published 口径保障，幂等 CAS）+ case-admin/分享链接入 |

### 1.2 可延期（有依据，不阻断核心链路）

| 缺口 | 可延期依据 |
| --- | --- |
| C09 封面（coverAssetId）选择 UI | 契约允许封面为空；目录卡与发布链不依赖封面字段，后续补 UI 不动数据 |
| C11 室内案例的只读预览/另存 | 当前全部种子案例与静态案例均为**户外规划**（CN_SPECS/REPLICA_CASES 的 buildPlan 都是 SitePlanData）；室内另存需要另建室内本机活动切换链路，不影响 V08/V11（户外口径）的验收 |
| C15 完整审计（上传/删除/恢复类） | 主计划明确"最小关键审计随 C01/C10 交付"已达成（授权审计 + 案例版本流水）；P2 批次既定 |
| C14 真实历史设备盘点 | 只能在原设备执行（浏览器存储不可跨设备读取），盘点/补传入口已就绪 |
| >32MiB 大文件的真机直传实测 | 依赖 S3 桶扩容（runbook）后才具备条件；协议与分块实现有单元级证据 |
| 管理页草稿表单打磨（封面/拖拽排序等） | 非链路功能 |

## 2. 交付范围与工作区核对

- `git status --porcelain` 核对：改动与三份报告声明的所有权一致，未发现越权改写；报告互相声明"未动对方文件"与实际 diff 相符。
- 三任务均按约定只交工作区补丁，未发现 git add/commit/push 痕迹；本次验收**未执行任何 git 写操作**。
- 契约唯一性：`cloud-storage-contract.ts` / `scene-client.ts` / `backend-session.ts` 是唯一 wire 源；B/C 的本地 zod schema 是消费端解析层（§3.4 的形状不匹配已修复）。
- 工作区无关遗留（不属于本轮任何任务，保留不动）：`deliverables/scendance-editor-demo-halloween-2026-11-19.mp4`、`snap-*.yml`。

## 3. 对三份报告的核对结果（夸大 / 矛盾 / 遗漏）

三份报告总体克制：均如实声明"云端验收未做""不宣称全局绿"，未发现伪造云端成功或以本地 mock 冒充真实保存的声明。发现的问题如下：

| # | 报告 | 声明 | 实际 | 定性 |
| --- | --- | --- | --- | --- |
| 1 | B §三.1 | "share-menu/share-panel 的发布动作在发送发布请求前 `await publishGateSnapshot()`" | 全仓 `publishGateSnapshot` 消费端引用数为 **0**；发布链直接 POST `/projects/:id/publish` | **集成断链（已修复 §4.3）** |
| 2 | B §三.2 | 扫描入口接归档队列，"由 C 落码" | C 未接；`enqueueFile` 仅存在于 B 自己的 cloud-panel | **集成断链（已修复 §4.7）** |
| 3 | C §给 B 的要求 | SpacePanel/ShareMenu 透传 `controller`，"由 B 修改" | B 未做 → 云端案例目录与「案例」页签在真实工作台永不出现 | **集成断链（已修复 §4.2）** |
| 4 | C §给 A 的确认 | "契约已按 A v1 对齐" | C 的 `cloudCaseReadSchema.case` 要求 `revision` 必填，而 A 的 `GET /cloud/cases/:id` 实际响应的 case 无 revision → 接通后「查看/使用此案例」100% 解析失败 | **契约不一致（已修复 §4.1）** |
| 5 | B §四/C06 | "saveCompleteProject 依赖 A 的 Edge 补丁上线" | 全仓 UI 无任何 `saveCompleteProject` 调用方 → `complete_projects` 永远为空 → 案例发布链必然 `COMPLETE_PROJECT_NOT_FOUND` | **主链无生产者（已修复 §4.5）** |
| 6 | A §B 接手 | "持久队列以 requestId 幂等对账" | 直传 PUT `x-upsert:false`：上次"对象已写成功、complete 未完成"的中断任务重试必撞 409 被当失败 → 永远无法完成 | **恢复语义缺陷（已修复 §4.6）** |
| 7 | B（asset-cloud.ts） | 账号/工作室隔离 | `userId && studioId` 条件使**个人私有**（无工作室）登录用户的映射被清空，下次上传覆盖丢失旧记录（破坏 V01） | **数据丢失缺陷（已修复 §4.8）** |
| 8 | A（review SQL） | 幂等闸存原始结果 | `cloud.project.save` 把整份 manifest（≤16MiB）复制进 `cloud_requests.result`；接通静默完整保存后每次自动保存膨胀一份 | **审核 SQL 缺陷（已修复 §4.4，SQL 仍在人审前）** |
| 9 | ——（三任务均未发现） | —— | 服务端发布快照只认 `visibility='published'` 依赖并要求场景覆盖；私有口径的完整归档直接发布/分享必然 `DEPENDENCY_INCOMPLETE`——A 的接口表写了 visibility 字段但没有任何一方实现"published 口径落库"的接通点 | **语义级断链（二轮发现并修复 §4.9）** |
| 10 | C §未验部分 | "2D 只读预览只覆盖户外；/view 接入 readCompleteShare 属 C12/C13 剩余" | 与实际一致 | 如实声明，二轮已补齐 |
| 11 | A §待验 / B §五.8 / C §未验部分 | "V01–V14 全部待验""不宣称全局绿" | 与实际一致 | 如实声明，采纳 |
| 12 | B §五.5 | 全量前端失败归因于"其他并行任务半成品" | 经本轮 HEAD 基线逐项对照成立（§6） | 核实无误 |

补充核对：A 报告声称的 `tests/published-assets.test.ts:75` 既有陈旧断言（迁移 b76ec3eb 已改语义）属实，属 HEAD 既有问题。

## 4. 本次修复与补齐（均已复跑回归）

修复原则：只做"剩余调用点接通"与可逆缺陷修复；不改权限、不放宽校验、不删测试。涉及迁移草案的修改（§4.4）在 SQL 未部署的前提下进行，供人工一并 review。

### 4.1 C 的 readCloudCase 契约对齐（对应 §3.4）
`frontend/components/room-organizer/lib/cloud-cases.ts`：`cloudCaseReadSchema.case` 改为按 A 实际响应形状解析（version 可选、不再要求 revision）。

### 4.2 controller 透传（对应 §3.3）
`room-organizer.tsx`（SpacePanel / ScendanceViewTools）与 `scendance-workspace.tsx`（ViewToolsProps + 两处 ShareMenu）：真实工作台出现云端案例目录与「案例」页签；不传 controller 的旧宿主行为不变。

### 4.3 发布闸门接入发布链（对应 §3.1）
`project-manifest.ts` 新增可测的 `publishGateBlockReason`（只拦「依赖未全部归档」与「未解决冲突」，fail-closed）；`room-organizer.tsx` `publishVersion` 在 POST 发布前核对闸门，不通过则报缺口明细；`PublishGateSnapshot` 增 `conflict` 字段。取舍：不强制 `cloudRevision !== null`，避免"重新打开未编辑即发布"被误拦；依赖覆盖缺口（扫描/资料图/附件）是新增拦截的价值所在，属产品语义收紧（fail-closed），如需放宽请人工确认。

### 4.4 审核 SQL：完整保存幂等回执瘦身（对应 §3.8）
`supabase/review/202611200001_cloud_storage.sql` 的 `cloud.project.save`：`cloud_finish` 只存瘦身回执，幂等重放时从 `complete_projects` 当前行重建完整回执（返回形状与首次确认一致）。

### 4.5 saveCompleteProject 接通（对应 §3.5，C06 主链打通）
`cloud-panel.tsx`：`buildCompleteManifestFor`（含户外规划记录的完整清单）+ `saveCompleteArchive`（租约 + expectedRevision CAS + 依赖未归档不发请求）+ 场景保存确认后静默同步（结果只落归档页状态）+ 归档页显式「保存完整归档」按钮。

### 4.6 直传 409 幂等恢复（对应 §3.6，V03）
`client/scene-client.ts`（生产路径）与 `cloud-archive.ts`（B 的回退路径）：HTTP 409（对象已存在）按成功处理并继续 complete——storagePath 是 `actor/requestId/sha256` 内容寻址路径，命中只可能是同一次上传意图的前次尝试；服务端 complete 仍复核大小与哈希，不是幽灵成功。

### 4.7 扫描上传接进归档队列（对应 §3.2）
`space-panel.tsx`：`submitScanFile` 本机代理成功后原件入持久归档队列；对不完整会话替身防御；入队成功在原提示后追加说明，失败不打断本机上传结论。

### 4.8 asset-cloud 个人 scope 映射丢失（对应 §3.7）
`asset-cloud.ts`：`setAssetCloudScope` 改为 `userId ? readPersisted() : {}`——个人私有（登录无工作室）按 `[userId, studioId]` 键读回自己的映射；未登录仍为空。

### 4.9 published 口径的完整归档保障（对应 §3.12，二轮新发现）
新模块 `complete-archive.ts`：`toPublishedManifest`（依赖整体翻 published，纯函数）+ `ensurePublishedArchive`（持当前租约 + expectedRevision CAS 把清单按 published 口径落库；未绑定/缺归档/无租约/未保存/场景转码失败都不发请求并如实返回原因）。接入两处：
- `case-admin.tsx` 保存草稿前调用（草稿由服务端整份复制 → 发布快照可用）；
- `share-menu.tsx` 生成完整只读链接前调用。
云面板静默完整归档保持 private 口径（个人私有归档语义不变），只在发布/分享动作时按需切换——`saveCompleteProject` 幂等 CAS 不改 `projects.revision`，两种口径互不破坏。

### 4.10 二轮补齐（对应 §1.1）
1. **国内案例种子（C08）**：`frontend/components/room-organizer/lib/cloud-case-seed.ts`（payload 纯函数：只迁 `origin==='cn'` 的官网中国案例，海外 OnePlan 内部学习授权案**不公开**；provenance = locationNote + 来源链接，≤4000 字；plan 过 sitePlanDataSchema；幂等判定 `needsSeeding`）+ `frontend/lib/cloud-case-seed.integration.test.ts`（默认只做本地校验；`CLOUD_SEED_REMOTE=1` 时对已部署后端执行真实迁入：建官方项目 → 租约 → 完整清单 → 草稿 → 发布 → 匿名读取断言 sources 不出网；同 stableId 已存在即 skip）+ 根 `package.json` 新增 `seed:cn-cases`。
2. **完整只读分享（C12/C13）**：`share-api.ts` 增 `completeShareTokenFromHash`（`#c<64hex>` 前缀，与固定发布链接 `#<64hex>` 区分）+ `readCompleteShare`（匿名，`completePublicReadSchema` 解析）；`share-menu.tsx`/`share-panel.tsx` 增「完整只读链接」区块（生成 → 令牌仅内存保存一次 → 复制 → 撤销走既有项目分享口）；`app/view/page.tsx` 增完整分享模式（ScenePreview + 资源临时地址 + 过期提示 + "撤销后新访问被拒、已下载副本无法收回"边界文案；户外规划数据随链接提供、本页暂不绘制 2D 的说明）。
3. **案例查看/另存端到端测试**：`cloud-cases.test.ts` 新增用例，按 A 服务端实际构造的响应形状（case 无 revision、含 version/publishedAt；manifest 含 scene/outdoor/dependencies；assets 含签名地址）验证 另存→独立副本→二次打开幂等→不继承云端身份。
4. 未放宽任何校验、未删除任何测试、未改任何生产权限或部署配置。

### 4.11 核对后不改的事项
- `scendance-workspace.react.test.tsx` 的 `oc-gm-walk` CSS 断言失败与 `tests/published-assets.test.ts` 陈旧断言均为 **HEAD 既有失败**（§6 逐项对照确认两树同现），不混入云存储收口，应单独修复。

## 5. 验证记录（L1 本地专项，2026-11-20）

| 命令 | 结果 |
| --- | --- |
| `npm run typecheck` / `npm --prefix frontend run typecheck` | 各 0 错误 |
| `npx vitest run tests/cloud-storage.test.ts tests/scene-client.test.ts`（根） | 25/25 绿（A 的 10 用例 + 新增 409 两用例） |
| 一轮受影响套件（B/C 模块 6 + asset-cloud + 7 面板套件，269 用例） | 268 通过；唯一失败为 `scendance-workspace` 的 `oc-gm-walk` CSS 断言——该套件**被本轮改动触及**（scendance-workspace.tsx 是透传 controller 的文件），但失败本体是读 `app/globals.css` 的源码断言，与改动无关，且 HEAD 基线同失败（§6） |
| 二轮受影响套件（12 个：complete-archive、cloud-cases、cloud-case-seed 集成、share-menu、case-admin、cloud-case-catalog、view 页、share-api、cloud-panel、space-panel、project-manifest、asset-cloud） | 198 通过 / 2 跳过（远程种子用例无 env 按设计跳过） |
| `npx eslint <一/二轮改动文件>` | 0 errors（import/order 类 warning 与既有风格一致；种子集成测试保留 1 处 no-console 的 operator 输出） |
| `set DENO_DIR=<repo>\.deno-cache && npm run check:edge` | 3 个 Edge 入口全部通过 |
| `npm --prefix frontend run build` | Compiled successfully（20.2s）+ 静态页 20/20 导出，exit 0 |
| 全量根 / 全量前端（含 HEAD 基线对照） | 见 §6 |

**"268/269" 与 "触及模块零失败" 的准确口径**：268/269 是一轮时 14 个直接受影响套件的合计；其中唯一失败所在套件虽然 import 了本轮改动的文件，但失败断言与改动无关（HEAD 同挂）。因此准确表述是"**受影响套件内与本轮改动相关的断言零失败**"，而不是"触及模块零失败"——后者不准确，已在此更正。

## 6. 全量失败逐项基线对照（同版本、同环境）

方法：`git worktree add ..\Scendance2026-accept-baseline 0dc827b4`（与主工作区同 commit），node_modules 以 junction 复用同一份依赖（同版本），并把未跟踪的 `.env.local` / `frontend/.env.local` 复制进基线使环境一致；两棵树在同一台机器、同一 Node 下各自独占运行全量。对全量中任何一侧独有的失败文件，在两棵树分别**隔离复跑**定性。

### 6.1 根（`vitest run tests/`）

| 运行 | 结果 |
| --- | --- |
| HEAD 基线 | 26 failed / 1584 passed / 26 skipped（1715 用例） |
| 当前工作区 | 18 failed / 1192 passed / 36 skipped（1689 用例；部分文件在全量并发下因内存直接崩溃未计入用例数——A 报告 C00 记录的"50 资源错误"同源） |

逐项定性（两侧全量失败文件的并集，逐一隔离复跑）：

| 文件 | 基线全量 | 当前全量 | 隔离（基线） | 隔离（当前） | 定性 |
| --- | --- | --- | --- | --- | --- |
| published-assets | 1 | 1 | — | 1 | **两树同挂**：HEAD 既有陈旧断言（b76ec3eb 语义变更） |
| brief-conversation-api | 2 | 0 | 2 | 2 | **两树同挂**：环境既有（需本地数据/配置） |
| merged-library | 3 | 3 | 3 | 0* | **两树同挂**：需本地资产文件（当前树隔离跑未含该文件，全量两侧同数） |
| config / hunyuan-config | 2+2 | 4+3 | 大量失败（worktree 侧无 .env.local，后已复制） | 4+3 | **环境依赖（.env.local 内容）**：两树同源 |
| agent-corpus-cases / venue-layouts | 1+1 | 1+1 | — | 0 | 需本地数据；当前树隔离通过 |
| agent-runs | 3 | 3 | 0 | 0 | **全量并发噪音**（两树隔离均通过） |
| scene-rpc-entry-guard / annotation-preview-trigger.prototype / agent-steering | 8+2+1 | 0 | 0* | 0 | **基线侧并发噪音**（当前树隔离通过；annotation prototype 两树隔离同数） |
| api / auth-signup / scene-identities / settings-scopes / check-79 / minimax / local-chat-agent-loop / local-lux3d | 0 | 1+1+1+1+1+2+2+1 | 0 | 0 | **当前侧并发噪音**（两树隔离均通过；check-79 另依赖 .env.local） |

\* 该文件未列入该侧的隔离批次，以全量同数 + 另一侧隔离通过为准。**结论：根侧没有任何失败可归因于 A/B/C 交付或集成修复；两树稳定失败集相同（published-assets、brief-conversation-api、merged-library、config/hunyuan 的环境子集）。**

### 6.2 前端（`vitest run`，含二轮改动后的最终全量）

| 运行 | 结果 |
| --- | --- |
| HEAD 基线 | 239 failed / 9926 passed / 73 skipped（792 文件，35 红文件） |
| 当前工作区（二轮补齐后的最终态） | **239 failed / 10036 passed / 75 skipped（803 文件，35 红文件）——失败数与 HEAD 完全相同，通过数 +110（全部为本轮新增测试）** |

逐项定性（全量失败文件的并集；含最终态运行）：

| 组 | 基线 | 当前 | 隔离证据 | 定性 |
| --- | --- | --- | --- | --- |
| agent-panel.react.test | 140 | 140 | 两侧全量同数；失败为候选差异展示的 UI 文案断言，与云存储无关 | HEAD 既有（并行半成品） |
| use-outdoor-agent-workflow / scene-layers / canvas-session / session-generation / zone-race / route-provenance / dialogue-review / annotation ×2 / catalog-placement / map-preservation / outcome / switch-guard / venue-epoch | 有 | 有（全量计数 ±1~2 浮动） | **5 个最重套件（142 用例）在两棵树隔离复跑：41 失败完全一致（同一批测试名）** | HEAD 既有；全量计数差为并发噪音 |
| map-venue-overlay | 1 | 6 | 同上（该文件在上述 5 套件隔离批内，两树同样失败） | HEAD 既有 + 并发噪音 |
| event-layout-agent / pinghu-banquet.eval / project-review-panel | 2+1+1 | 2+1+1（最终态运行同数；中间一轮运行 0） | **两棵树隔离均 58/58 通过** | 全量并发噪音（两侧均有波动） |
| commercial-dossier-panel | 0 | 1（仅最终态运行出现） | **当前树隔离 55/55 通过** | 当前侧全量并发噪音 |
| scendance-workspace（oc-gm-walk CSS 断言） | 1 | 1 | 源码断言，两树同挂 | HEAD 既有陈旧断言 |
| app/page / app/projects/page / shared-seating / public-asset-recovery / delivery-private-text / plan-card(-safety) / scene-delivery-panel / bingo-feedback-import / site-plan-inventory / plan-facility-models / site-plan-legend / outdoor-layout-weights / local-seating-draft / cloud-material-draft | 1~2 | 同或 0 | 未被 A/B/C 或集成修复触碰的文件 | HEAD 既有 + 并发噪音 |

**结论：前端没有任何失败可归因于 A/B/C 交付或集成修复**——全量差异全部落在"两树隔离行为完全一致"的并发噪音集合内；稳定失败集（agent-panel 140 等）在 HEAD 与当前树同数同名。清理项：基线 worktree 与其中复制的 `.env.local` 在对照完成后已删除。

## 7. C00–C16 逐项状态

| ID | 状态 | 依据与缺口 |
| --- | --- | --- |
| C00 基线 | 已实现并验证（L2/L1） | A 报告基线核查与代码一致；线上角色分布等引用属外部事实 |
| C01 平台超管 | 已实现未验证 | 服务端表+审计+grant/revoke+撤权即时生效（10 用例）；**部署+首授后生效**（runbook S5） |
| C02 官方工作区 | 部分 | official_workspace + 官方闸已实现；户外 actor 归属兼容迁移仍是"沿用既有链路"（A 报告如实声明） |
| C03 全类型归档 | 已实现未验证 | 三步直传链 + 白名单预检 + 队列 + 扫描入口入队（§4.7）+ 归档页资产列表/补传 |
| C04 持久队列 | 已实现未验证 | IndexedDB outbox、账号隔离、requestId 幂等、中断恢复、needs-file；409 恢复（§4.6） |
| C05 保存状态统一 | 已实现未验证 | 六态派生 + 序号化结算 + 户外/云面板双接线 |
| C06 完整项目保存 | 已实现未验证 | saveCompleteProject 全链（§4.5）+ published 口径保障（§4.9） |
| C07 跨设备恢复 | 已实现未验证 | getCompleteProject → 画布/户外恢复 + 素材短地址按权限换取 |
| C08 案例目录+种子迁入 | 已实现未验证 | **二轮补齐**：`cnCaseSeedPayloads`（12 个官网 CN 案例幂等 payload）+ 远程迁入链（建项目→完整清单→草稿→发布→匿名读取）+ `npm run seed:cn-cases`；部署后执行（runbook S8）。海外学习授权案明确不迁 |
| C09 管理员维护入口 | 部分（未验证） | 「案例」页签 + 全套服务端动作 + 保存草稿前自动落 published 清单（§4.9）；封面选择 UI 未做 |
| C10 草稿/发布/历史/回滚 | 已实现未验证 | 不可变 publication + 指针原子切换 + restore 生成新版本号 |
| C11 只读浏览+独立另存 | 部分（未验证） | 目录 + 户外 2D 只读预览 + 独立副本（A 实际形状端到端用例）；**室内案例另存不支持**（§1.2） |
| C12 统一分享类型 | 已实现未验证 | **二轮补齐**：四类入口语义齐备——评审链接 / 受控发布链接 / 完整只读链接（生成/复制/撤销）/ 固定交付（显式标注）；不再把编辑地址称公共分享 |
| C13 完整只读查看+资源授权 | 已实现未验证 | **二轮补齐**：`/view/#c<token>` 匿名读取（published 依赖换 300s 签名地址、签名后二次核验、sources 永不出网、撤销后 404） |
| C14 存量盘点补传 | 已实现未验证 | 四类登记 + 明细 + 一键补传；真实历史设备盘点只能在原设备执行 |
| C15 最小审计 | 部分 | platform_admin_audit + cloud_case_versions 流水随 C01/C10 交付；上传/删除类审计 P2 |
| C16 三账号+干净浏览器收口 | **未完成** | 无真实账号/部署授权；§11 提供部署后逐项操作步骤 |

## 8. V01–V14 验收矩阵状态（本地等价证据）

全部按主计划 §6 口径。**没有一项完成 C1/C2 级验收**；本地等价证据与真实验证缺口如下（部署后的具体操作步骤见 §11）：

| ID | 本地等价证据（L1/L2） | C1 真实云端 | C2 三账号/干净浏览器 |
| --- | --- | --- | --- |
| V01 | 归档三步链 10 用例；asset-cloud 映射持久化（§4.8）；归档页列表/临时地址 | ❌ | ❌ |
| V02 | fixtures 完整保存/读取；manifest 覆盖模型+扫描+资料+户外；§4.5 保存即归档 | ❌ | ❌ |
| V03 | 队列中断恢复；409 幂等恢复（§4.6 新用例）；对象缺失/篡改 422 | ❌ | ❌ |
| V04 | save-status 序号结算 + failCloudSync + 503 失效门 | ❌ | ❌ |
| V05 | require_lease + REVISION_CONFLICT/LEASE_LOST；户外冲突上报状态机 | ❌ | ❌ |
| V06 | official workspace 闸 + FORBIDDEN | ❌ | ❌ |
| V07 | PLATFORM_ADMIN_REQUIRED、匿名 401、outsider 404；storagePath/tokenHash 不出网断言 | ❌ | ❌ |
| V08 | 发布依赖校验 + 匿名目录/读取 + sources 不出网 + 种子发布链测试 | ❌ | ❌ |
| V09 | CASE_VERSION_CONFLICT 保持旧入口 + 指针切换 | ❌ | ❌ |
| V10 | DEPENDENCY_INCOMPLETE 拒发 + restore 新版本号 | ❌ | ❌ |
| V11 | ensureCloudCaseCopyRecord 幂等/不覆盖/不继承身份（A 实际形状端到端用例） | ❌ | ❌ |
| V12 | share-menu 四类入口测试 + 完整分享生成/撤销用例 + view 页边界文案 | ❌ | ❌ |
| V13 | SHARE_NOT_FOUND 撤销用例 + 下架目录失效用例 | ❌ | ❌ |
| V14 | 盘点纯函数用例（不删副本、明细如实） | ❌ | ❌ |

## 9. 剩余阻塞与负责人

| 阻塞 | 需要谁 | 动作 |
| --- | --- | --- |
| 审核 SQL（含 §4.4/幂等回执修订）人审 + 应用 | 人（DBA/仓库管理员） | runbook S1–S3 |
| 两位管理员身份核对与首授 | 用户本人 | runbook S5（需要 §13 材料 1） |
| 官方承载工作室决定与成员配置 | 用户本人 | runbook S6（需要 §13 材料 2） |
| Edge Functions / 前端静态导出部署 | 人授权后总集成执行 | runbook S4/S7 |
| 种子迁入执行 | 用户本人或授权操作员 | runbook S8（需要一位管理员凭据） |
| V01–V14 真实验收 | 总集成 + 真实账号/双设备 | runbook S9 + 本报告 §11 |
| C09 封面 UI；C11 室内案例另存；C15 完整审计 | 后续批次 | 主计划既有卡片 |
| HEAD 既有失败两处（published-assets 断言、oc-gm-walk 断言） | 与三任务无关的维护 | 单独收口 |

## 10. 本地与线上差异、最小预发部署范围

### 10.1 本地与线上差异

| 维度 | 本仓库（工作区） | 线上 | 影响 |
| --- | --- | --- | --- |
| 数据库迁移 | review SQL 在 `supabase/review/`（含幂等回执瘦身修订），不在自动迁移链 | 未应用：无 `cloud_storage_rpc`/新表 | `/cloud/*` 一律 503（前端如实降级"未接通"） |
| 对象存储桶 | SQL 第 9 节草案（2GiB + mime 白名单） | 32MiB、不含扫描/附件 mime | >32MiB 归档直传会被存储层拒 |
| 管理员/官方工作区 | 首授流程为 SQL 注释占位，不含 UUID | `platform_admins` 空、`official_workspace` 未配置 | 案例维护/官方归档一律 `PLATFORM_ADMIN_REQUIRED`/`OFFICIAL_WORKSPACE_REQUIRED` |
| Edge Functions | 本地 `check:edge` 通过 | 未部署 | 同 503 效果 |
| 前端 | 本地构建通过 | 未部署新版 | 线上无归档/案例/完整分享 UI |
| 种子 | payload + 远程迁入测试就绪 | 未迁入 | 目录为空（静态案例双轨过渡不受影响） |

### 10.2 最小预发部署范围（供人工批准）

1. **一个预发 Supabase 项目**（或本地 `supabase start`）：跑既有 migrations + 应用 review SQL + S3 桶配置。
2. **scene-api Edge Function** 部署到预发。
3. **前端静态导出**部署到预发域名；`ALLOWED_ORIGINS` 增加该域名。
4. **预发库内测试管理员**：直接 insert 一个测试账号到 `platform_admins` + 建 `official_workspace` + 加成员行（不需要真实管理员 UUID）。
5. **种子脚本试跑一次**（幂等，可重复）。
6. 不需要：生产授权、生产数据迁移、任何生产配置变更。

目的：§11 的 V01–V14 全部可在预发走完；生产只做同栈部署 + 数据审查后复验关键项。

## 11. 部署后 V01–V14 逐项操作步骤

角色：A=用户本人（管理员甲）、B=科智（管理员乙）、C=普通登录用户、D=未登录。设备二 = 全新隐身窗口（干净上下文）。每项证据 = 命令/HTTP 状态 + 服务器记录 + 截图（脱敏）。

| ID | 步骤（部署后执行） | 必须观察 |
| --- | --- | --- |
| V01 | 设备一 A：物料面板导入本机 GLB → 保存触发上云；空间面板上传 .spz（自动入队）→ 归档页看队列 uploaded + 「云端资产」两条记录（记 ID/大小）。设备二隐身登录 A → 「云端资产」可见 → 「复制地址」下载原件，哈希与原件比对 | 云端资产行、HTTP 200、下载哈希一致 |
| V02 | 设备一 A：打开含模型+扫描+资料图+户外规划的官方项目 → 保存 → 归档页「保存完整归档」显示服务器确认 vN/依赖 N 项。设备二隐身登录 A → 项目卡打开，画布/户外/资料完整；或「核对完整归档」 | getCompleteProject 返回、依赖数量、户外 payload |
| V03 | 上传 >50MiB 文件中途刷新 → 归档页任务 pending（"上次上传被中断…可重试"）→ 点重试 → 完成；另一例：complete 前断网 → 恢复后重试 → 同 uploadId 幂等 | 状态流转、无重复资产行 |
| V04 | DevTools offline → 编辑保存 → 状态「云端未同步」+ 本机保留 → 恢复网络 → 自动保存 → 最新改动上云、版本连续 | 待同步→云端已确认；旧回执不清新编辑 |
| V05 | A 持租约编辑保存；B 打开同一项目（只读提示）→ A 释放 → B 取得编辑权保存；B 用过期版本强推 → REVISION_CONFLICT | 租约互斥、冲突可见可恢复 |
| V06 | B 在 A 创建的官方项目编辑并保存完整归档（共同归属）；C 打开同一项目只读、无归档/发布入口；C 直调 `GET /cloud/cases/manage` → 403 | 管理员共管；普通用户被拒 |
| V07 | C 用 DevTools 篡改角色/ID 调管理接口 → 403/404；撤 A 权后 A 旧页面动作 → 403（撤权即时） | 服务端拒绝，不靠隐藏按钮 |
| V08 | A 在官方项目分享卡「案例」页签 → 填稳定 ID/标题/来源说明 → 保存草稿（自动落 published 清单）→ 发布 → 目录出现；设备二未登录打开工作台空间面板 → 云端目录卡片 →「查看」2D 预览 →「使用此案例」另存 | 匿名目录可读、另存成功、私有 sources 不出网 |
| V09 | B 修改草稿不发布 → C/D 仍见旧版；B 发布更新 → 同一入口显示新版（revision+1） | 草稿不公开、发布后入口切换 |
| V10 | B 用过期 expectedVersion 发布 → 报错且公众仍旧版；历史 → 恢复旧版本 → 入口指向旧 publication（版本流水 +1） | 发布失败保留入口；回滚不改旧发布 |
| V11 | C 使用案例另存 → 修改 → 重复点击/官方更新 → 副本不被覆盖；副本无 remoteActivityId | 个人副本独立 |
| V12 | 逐一生成四类入口：评审链接（可钉评）/ 受控发布链接 / 完整只读链接（含户外+资源、令牌只显示一次）/ 案例入口；对照各入口文案与行为 | 与入口说明一致 |
| V13 | 撤销完整链接 → 新开 `/view/#c…` → 404；下架案例 → 目录与稳定入口失效；已导出离线快照仍能打开（边界如实说明） | 受控可撤、下架生效、离线边界如实 |
| V14 | 归档页盘点 → 补传 → 重复执行 → 不重复入队/不重复资产行；needs-file 项要求原设备补传 | 幂等、不删唯一副本、缺件有明细 |

## 12. 改动归属清单（可审阅交付）

文件级归属（混合文件在括号内列出集成修复新增的函数/区块）：

**任务 A（后端权限与云端契约）**
- 新增：`supabase/functions/_shared/cloud-storage-contract.ts`、`cloud-storage.ts`、`supabase/review/202611200001_cloud_storage.sql`、`tests/cloud-storage.test.ts`
- 修改：`supabase/functions/_shared/api.ts`、`backend.ts`、`tests/fixtures.ts`、`frontend/lib/backend-session.ts`
- 修改（混合）：`client/scene-client.ts`（A：17 个云方法 + 直传 helper；集成：`uploadArchiveToSignedUrl` 的 409 幂等恢复）

**任务 B（上传与完整保存）**
- 新增：`lib/cloud-archive.ts(+test)`、`archive-queue.ts(+test)`、`save-status.ts(+test)`、`local-inventory.ts(+test)`、`hooks/use-cloud-archive.ts`
- 修改：`components/outdoor-plan-overlay.tsx`、`panels/cloud-panel.tsx`
- 修改（混合）：`lib/project-manifest.ts(+test)`（B：闸门提供方；集成：`publishGateBlockReason`+`conflict` 字段）、`lib/asset-cloud.ts`（B：scope 隔离；集成：个人 scope 条件修复 + 测试）、`room-organizer.tsx`（B：闸门注册/OutdoorSaveState；集成：闸门消费 + SpacePanel/ViewTools controller 透传）、`panels/cloud-panel.tsx`（集成：buildCompleteManifestFor/saveCompleteArchive/按钮/静默调用）

**任务 C（案例库与共享）**
- 新增：`lib/cloud-cases.ts(+test)`、`panels/cloud-case-catalog.tsx(+test)`、`panels/case-admin.tsx(+css+test)`、`panels/space-browser.css`
- 修改：`panels/space-panel.tsx(+test)`、`panels/share-menu.tsx(+test)`、`panels/share-panel.tsx`、`app/view/page.tsx`（C：边界文案）
- 修改（混合）：`lib/cloud-cases.ts`（集成：readCloudCase 契约修复 + A 实际形状端到端用例）、`panels/case-admin.tsx`（集成：ensurePublishedArchiveNow）、`panels/share-menu.tsx`/`share-panel.tsx`（集成：完整分享区块）、`panels/space-panel.tsx`（集成：扫描入队）、`app/view/page.tsx`（集成：完整分享模式）

**集成验收（本轮）**
- 新增：`lib/complete-archive.ts(+test)`、`lib/cloud-case-seed.ts`、`frontend/lib/cloud-case-seed.integration.test.ts`、`frontend/lib/share-api.ts`（修改）、`tests/scene-client.test.ts`（修改）、`package.json`（seed:cn-cases）、`panels/scendance-workspace.tsx`（修改）、本报告与 runbook、三份任务报告（A/B/C 各自交付）

**版本归属已查明（接手复核）**：`package.json` 与 `frontend/package.json` 的 `4.17.15 → 4.17.16` 已随既有提交 `a890e9f8` 的人物登记表任务提交；保留 4.17.16，不再要求用户确认来源。本次只修复根包中的种子执行命令，不改版本与依赖。

**无关遗留（保留，不纳入提交）**：`deliverables/*.mp4`、`snap-*.yml`、`..\Scendance2026-baseline` 空残留目录。

**提交建议**（一次性收口提交，Conventional Commits，正文附命令与原始输出）：
`feat(cloud): 云存储/完整保存/官方案例三任务合流与集成修复（C00–C13 本地链路）`
正文要点：A/B/C 范围 + 集成修复清单（§4.1–4.10）+ 验证命令与输出（§5/§6）+ 未验部分（C1/C2 全部）+ 刻意未做（C09 封面 UI、C11 室内另存、C15 完整审计）。

## 13. 需要你提供的材料与决定（一次性清单）

| # | 类型 | 内容 | 用途 |
| --- | --- | --- | --- |
| 1 | 账号材料 | 两位平台管理员的 Supabase UUID（运维按你确认的账号从 `auth.users` 核对取出，或你直接提供）；种子脚本需一位管理员的登录邮箱+临时密码（跑完即改） | runbook S5/S8 |
| 2 | 决定 | 官方内容放哪个工作室（新建官方 studio / 现有 studio 及其成员配置） | runbook S6 |
| 3 | 决定 | 桶上限 2GiB 或调小；mime 集是否按 SQL 第 9 节原样 | runbook S3 |
| 4 | 决定 | 预发环境有无（staging Supabase 项目/域名）；没有则 S1 用本地 supabase start、S9 上生产只读验证 | §10.2 |
| 5 | 决定 | 海外 OnePlan 案例是否永久不公开（当前口径：不迁入种子） | C08 边界 |
| 6 | 审批 | 审核 SQL 全文（含幂等回执瘦身）批准/修改意见；本报告 §4.3 的 fail-closed 取舍是否接受 | S2 / 闸门口径 |

## 附：验收环境与脱敏声明

- Windows 10（win32）、Node ≥ 24；DENO_DIR 指向仓库内 `.deno-cache`（全局 deno 缓存目录无写权限）。
- 全部验证为本地（PGlite/jsdom/静态检查）；无真实云端请求；未创建付费任务、未猜测管理员身份、未改线上角色、未应用迁移、未提交/推送/部署。
- 基线对照使用的 worktree 及其内复制的 `.env.local` 已在对照完成后删除。
- 本报告不含任何密钥、token、签名 URL 或带凭据的下载地址。
