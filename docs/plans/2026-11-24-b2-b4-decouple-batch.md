# B2/B3/B4 身份解耦批次底稿（2026-11-24）

> 承接 `2026-11-24-identity-source-decouple-proposal.md` §5 与 `2026-11-21-indoor-decommission-goal.md` §2.1。
> 状态：**B1 判定层已合入 `origin/main`**（`e89e951c` + 回执 `46fd0bf7`/`283598f8`/`e5ee6593`），前端 tsc 0、全量 10724 passed / 0 failed、build 0 违规；生产真机 flow1/flow3/flow2 对照闭合。本底稿只拆 B2/B3/B4 的开工面、触点与阻塞，**未落码**。
> 行号以 Grep 符号复核为准（壳体 `room-organizer.tsx` 超长，行号会漂移）。

## 0. 依赖链与成套边界

```
B1 会话/身份解耦 ✅ 合入 main
  └─ B2 历史快照换 plan（#40）→ 两份 brief 打通（#63）
       └─ B3 导出与写守卫 plan 化（#41）
            └─ B4 回写镜像退役 / 旧键归位（#42）
                 └─ #38 R 线壳体退役（阻塞于 B1–B4 成套）
```

- **不可孤立先撤镜像**：B4 的 false 侧 layout patch 是室内 3D 场地联动通路；E 线壳体未退役前单独删掉会断 3D 贴地/外墙。B4 必须等 B2/B3 验收合入。
- **换键必须带一次性迁移**：旧 `layout.id` 键存量（偏好 / 未发送草稿 / 库存 / 评审回执）直接换键会丢存量；迁移或只读承接口径见 §4 待拍板。
- **独占 / 基线硬边界不变**：动 `room-organizer.tsx`、`scendance-workspace.tsx`、`use-import-export.ts`、`use-splat-preview.ts`、`splat-preview.ts` 或 `scan-placement.ts`、`furniture-builders.ts` 前，先在 `HANDOFF.md`《协作区变更登记》加一行，人确认后动手。

### 0.1 长期目标与自主执行序（2026-11-24 用户全权授权）

**终态**：去室内化 C4——云端为唯一权威正源，本机仅离线缓存/待同步副本；B1–B4 成套落地后解除 #38 R 线壳体退役阻塞。授权范围：按成熟案例默认口径推进，决策点不再逐项停顿；**未解除的底线**：不删云端项目/不软删、不编造降级路径、不改 DB 迁移/后端契约/CI 治理配置、旧键换迁移必须防丢存量、独占/基线文件先登记。

**执行序（依赖驱动，本地攒批，不达标不推 main）**：
1. **B2-a 例3 打通（#63）**：夹具补 workflow 非匿名 controller + turn facts 桩；断言从 legacy capture.project().headcount 改读 workflow brief.guests；核对失败轮保留已录人数语义。**✅ 2026-11-25 已转绿**（观测出口取持久桶 `scendance:outdoor-flow:${scope}` 只读读回，生产码零改动；6 passed/0 skipped，详见 §2.3 末条）。剩余：导出可导出性断言等 B3 读源切换后补。
2. **B2-b 画布历史栈抽接**：**地基已备**——`plan-history.ts` 的 commit/undo/redo/equals/prune 纯函数均落并测（13 例，含 prune 相邻合并/尾部弹出/空栈/引用比较）；待组件接线：把内联双栈换成地基，保留 K2 合并键/zoneUndoRef/写守卫/选中清除/draw 旁路，补组件测试后真机 2D undo/redo 验收。
3. **B2-c 壳体 history 换型**：`useHistory<RoomLayout>` → `SitePlanData`，30+ `commitHistoryNow` 提交点逐一核对挂 plan 还是 layout；提交点施工地图已落档 §2.2；独占壳体，先登记 HANDOFF，成套验收。
4. **B3 导出/checkin plan 化（#41）**：导出读源、checkin scope、note scope 切 plan；写守卫已基于 capability/lease/revision 就位，**守卫替换成功路径与快照失败拒绝边界用例已补（7 例）**；触点行号已复核落档 §3.2。
5. **B4 镜像退役 + 旧键归位（#42）**：false 侧 layout patch 退役、底图/锚点改写 plan/视图记忆；持久桶旧键退役配一次性迁移防丢存量。

## 1. 门禁基线（每卡复用）

- Node v26.2.0（`C:\Program Files\nodejs`，命令前置 PATH）；Node22 禁跑全量 / build。
- 根 `tsc --noEmit`、前端 `tsc --noEmit` exit 0；定向 vitest 转绿；前端全量无增量回归；`npm --prefix frontend run build` exit 0。
- 2026-11-24 全量实测基线：10727 passed / 153 skipped / 1 failed；唯一失败 `lib/share.test.ts` deflate bomb 解压耗时断言（1716ms > 1000ms），全量并发高负载下抖动，**复跑单文件 28/28 绿**，非本轮改动链路（与 plan-history 无 import 交集）。
- 本地攒批：tsc + 测试 + 真机走查全绿后一次性推 main；只按明确路径 `git add`，不用 `-A`/`.`/`commit -a`。

## 2. B2 历史快照换 SitePlanData（#40，阻塞解除：B1 已合入）

**全完成判据**（goal §2.1 :49）：`useHistory` 快照 `RoomLayout` → `SitePlanData`；物料 / 选中 / 墙操作挂 plan 历史；undo/redo 回写 plan（经 overlay / `commitPlan`），不再 `actions.applyLayout`；两份 brief 打通（#63）。

### 2.1 现状（已就位）

- 地基纯函数 `lib/plan-history.ts`：`commitPlanHistory` / `undoPlanHistory` / `redoPlanHistory` / `planSnapshotsEqual` / `emptyPlanHistory`，30 步截断、栈顶去重、redo 分叉清空；`plan-history.test.ts` 9/9 绿。
- 2D 画布 `components/outdoor-plan-canvas.tsx` 已有内联双栈：`historyRef`/`redoRef`（:1851/:1853），提交 `commitPlan`（:2876）、撤销 `undoPlan`（:2925）、重做 `redoPlan`（:2943）、另一处 redo push（:3196）、prune（:8344）；`UNDO_LIMIT=30`（:1090）。
- 壳体 3D 历史仍是 `useHistory<RoomLayout>`：`room-organizer.tsx:1939`，`commitHistoryNow` 在 30+ 处提交点调用（物料摆放 / 选中 / 墙体 / 光照 / 运营计划 / 事件操作等）。
  - **2026-11-24 B2-c 施工地图（只读勘察，行号以动手前 Grep 复核为准）**：
    - 历史链路三要素（:1939-1956）：快照源 `layout`（RoomLayout）；apply 回调 `applyVenueHistorySnapshot(...)` → `actions.applyLayout` 回写 layoutStore；`canApply` 守卫依次过 `workspaceWriteGuards.assertLayoutWrite`、`environmentPreferenceReadyRef`/`pendingEnvironmentPositionRef`、场地 `venue.assetId` 比对。换型 SitePlanData 时这三处都要 plan 化，不能只改泛型。
    - `commitHistoryNow` 提交点（按操作域初分，逐点复核挂 plan 还是 layout）：物料摆放/选中/拖拽/复制/删除/旋转 :2122/:2140/:2162/:2197/:2266/:2375/:2389/:3823/:3847/:3851/:5646/:5816；墙体 :3847/:3851 邻近；恢复快照 `beforeReplace` :4106/:4128；生产计划/运营/事件操作 :4242/:4339/:4973(`onUpdateProductionPlan`)/:5007(`onUpdateItem`)/:5010(`onUpdateEventOperations`)/:5864(`onCommitOperations`)；光照 :5849；outdoor false 侧镜像 patch :2057（归 B4 退役，不在 B2-c 挂 plan）。
    - undo/redo 对外暴露 :3885/:3886、:3959/:3960；`clearHistory` 在切换/恢复流程 :4112/:4147 调用。
    - **阻塞**：室内物料编辑 undo 随 E2/E3 壳体退役成套；过渡阶段历史双轨，不能硬把 30+ 室内提交点全切到 SitePlanData，否则废掉室内物料撤销。独占壳体，动手前先在 HANDOFF.md 登记。

### 2.2 剩余触点（待核行号）

| 触点 | 现状 | 动作 |
| --- | --- | --- |
| 壳体 `useHistory` 泛型 | `RoomLayout` 快照 | plan 化后改挂 `SitePlanData`；30+ `commitHistoryNow` 提交点逐一核对挂 plan 还是 layout |
| 画布内联双栈 | `useRef<SitePlanData[]>` 手写 | 可先抽接 `plan-history.ts` 纯函数（行为等价重构，地基已测）；保留 `commitPlan` 入口 `samePlanContent` 内容守门与 K2 合并键 |
  - 2026-11-24 同构核对（`outdoor-plan-canvas.tsx`）：undo(:2925)/redo(:2943) 出栈+对侧入栈+30 步截断，与 `undoPlanHistory`/`redoPlanHistory` 同构；commit(:2876) 的 `samePlanContent(next,current)` 与 `refusePlanWrite` 守门在组件侧，地基只管入栈。**口径差异**：画布 commit 用「next vs current」守门，地基 `commitPlanHistory` 另有「栈顶 vs previous」去重——抽接时 equals 传 `Object.is` 或不启用栈顶去重，避免连续相同快照被额外跳过入栈。旁路须留在组件侧：K2 合并键 `commitPlanMerged`(:2901)、`zoneUndoRef` 一键回退(:3153/:3179/:3194)、`prune` 两栈内容剔除(:8344)。`samePlanContent`(`outdoor-project-store.ts:94`) 与 `planSnapshotsEqual` 口径等价（键序无关、数组保序、undefined 省略）。**前置缺口**：该画布历史栈无栈级单测兜底，抽接前先补 commit 去重/截断/redo 清空/undo-redo 乒乓/prune 的纯函数测试，再换内联数组操作；属组件内 ref + React count 联动，需真机 2D undo/redo 验收。
| 两份 brief | workflow 把人数存 `plan.brief.guests`（`use-outdoor-agent-workflow.ts:1685/:1884/:1919`），不回写 legacy `agentBriefRef`/`memoryRef`；导出 / 捕获读 `getActiveBrief()`（`creative-studio.tsx` briefStorage :291、scope :335） | 打通：legacy 读取侧兜底读 `plan.brief.guests`，或写侧回写；**兜底从哪份 brief 读见 §4** |

### 2.3 阻塞口径

- 例3（#63）：理解失败时本地人数仍可导出；新通路 `availability='available'`、`headcount={status:'unknown',value:null}` 两份 brief 未打通。headcount 兜底数据源待 B2/B3 定稿。
  - 2026-11-24 实测基线：套件 5 passed / 1 skipped；临时取消 skip 单跑例3，第一次 submit 后 `capture.calls===0`（resolver mock `resolveBriefTurn` 根本未被调用），并非失败轮人数丢失。
  - **根因定位（通路分流错配，非会话围栏）**：默认 `workbenchMode='layout'`（`workbench-mode.ts:14`），测试 StubOverlay 注册了 `applyPlan`（夹具 :63），故 `agent-panel.tsx:3242` 条件 `!queued && workbenchMode==='layout' && bridge.applyPlan` 成立；句子在 `:3339` 整句交 `outdoorWorkflow.handle(...)` 后 `return`，legacy resolver `:3672` 不可达。`resolveBriefTurn` mock 自然调用数为 0。例3 断言却读 legacy `capture.dialogue().project().fields.headcount`（resolver 通路产物），与当前默认新通路（`outdoorWorkflow.state.brief.guests`）错配——这正是「两份 brief 未打通」的测试表现。此前怀疑的会话围栏（`sessionScopeIsCurrent`/`boundSessionId`/`briefTurnSequence`）不是首因。
  - **转绿路径（按 §5 默认口径：优先 `plan.brief.guests`，缺省回退本机 brief）**：例3 需重写为新通路断言——读 workflow brief.guests，而非 legacy capture.project().headcount。注意 `forcedResolution='failed'` 桩只作用于 `agent-resolver`，对 workflow 通路无效；「理解失败轮保留已录人数」的语义要在 `use-outdoor-agent-workflow` 的 state.brief 写入/失败分支里核对，不能沿用 resolver 的 failed 轮模型。属测试口径对齐 + workflow 通路失败语义核对，不孤立改生产码。
  - **2026-11-24 续勘（观测出口与桩缺口，动手前复核行号）**：
    - workflow 返回对象（`use-outdoor-agent-workflow.ts:3950-4109`）**未直接暴露 `state`**；`brief.guests` 存在 `stateRef.current` 并由 `persist`(:634-647) 写入 `localStorage scendance:outdoor-flow:${scope}`。测试观测出口二选一：① 给 workflow 补只读 getter（生产码改动，须成套 + 测试 + 真机核对，不孤立加）；② jsdom 内经 `MemoryStorage` 读回该 scope 键 JSON 的 `brief.guests`（纯只读观测，不改生产码；scope 值需按 agent-panel 传入的 `sessionScope` 复算）。
    - 纯人数句落 brief 两条路径：`headcountOnlyAdjustment`(:1696/:1703-1704) 命中时只更新 `brief.guests`；否则 `mergeOutdoorFacts`(`outdoor-agent-contract.ts:114`) 过 proven（evidence 被本句/上句归一化包含，:130-133）与 `evidencedCount`（evidence 数字与 value 一致，:153）守门后，:231 落 `brief.guests`。
    - 失败轮语义：`handle` catch(:3125-3188) 除 UNAUTHENTICATED 落 pendingLogin(:3139)、DISABLED 摘登录卡(:3159) 外，其余失败分支只挂红卡 `status`，**不 persist**，`state.brief` 保留上一轮值。即新通路是「理解失败不清空已录人数、保留上一轮」，与原 legacy 测试期望「失败轮保留本句刚说的 40」有口径差——重写断言时对齐「保留上一轮已录」，不要沿用本句 40 的旧期望。
    - 桩缺口：夹具 `chatResult`(:84) 恒返回 `status:'ok'`，例3 失败轮需扩展 response 项支持 `status:'failed'`（或 DISABLED code）；response 形状 `{action, reply, references:[], facts}`，action 取枚举内值（`/search|scope|zones|objects|adjust|ask|…/`，见 `outdoor-agent-response-contract.ts:18`），`facts.guests` 为 `{value:int 1..100000, evidence}`，evidence 须逐字来自本句且数量一致。
    - 触发条件：例4 传 `outdoorProjectId="probe-project-a"` 走 workflow；例3 当前未传该 prop，重写时对照例4(:142-164) 的壳体挂载与 `capture.agent` 取法。
  - **2026-11-25 例3 已转绿（观测出口取方案②，生产码零改动）**：删除旧 `it.skip('keeps a locally recorded headcount exportable…')`，新增 `it('keeps the last recorded headcount when understanding fails, and only adopts a new number after a successful turn')`。夹具侧两处改动：`capture.responses` 项增 `status?: 'ok'|'failed'|'disabled'|'offline'|'rate-limited'`，`chatResult` 写回 `status:(next.status??'ok')`（对应 `lib/outdoor-agent-understanding.ts:376` 非 ok 即 throw）。用例推三轮 `ask`：30人（ok）→ 40人（failed，facts 空）→ 40人（ok）。观测出口为 `mem.getItem('scendance:outdoor-flow:project:dialogue-incomplete').brief.guests`（`outdoorProjectId="dialogue-incomplete"` 使 `projectSessionScope` 落该键，探针实证）。
    - **实测语义（写进用例的断言）**：失败轮 `handle` catch 只挂红卡、不 persist，`brief.guests` 保留上一轮 30，不被本句猜的 40 覆盖；重试成功轮才 `persist` 新值 40；三轮 `capture.applyPlan` 全程 0（纯人数句不动画布）。
    - **UI 失败卡文案实测**：`这一步没做成` / `智能理解 这次问答没有完成；…` / `重试这次请求`；此前预期的 `/当前Agent理解不可用/` 在 UI 上不出现（那是 throw 的 message，仅内部）。断言以 `/这一步没做成/` 为准。
    - **口径偏差记录**：旧 skip 用例名含「exportable」，但导出侧读源统一属 B3（`production-plan-export.ts` 现读 legacy brief）。本次用例只钉「记录留存 + 成功后收敛」这一段语义，用例名同步收窄；导出可导出性断言待 B3 读源切换后在同一用例追加（届时读 `plan.brief.guests`）。
    - 证据：`npx vitest run room-organizer-session-generation.react.test.tsx` → `Test Files 1 passed / Tests 6 passed (6)`（此前 5 passed/1 skipped）、`npm run typecheck` exit 0、`npx eslint` 该文件 0 error。
- 历史裸 UUID 本机槽迁移到 `house-*`：成熟案例口径下本轮只失效隔离、不迁；是否补「打开本机备份」入口见 §4。

## 3. B3 导出与写守卫 plan 化（#41，阻塞 B2）

**全完成判据**（goal §2.1 :50）：CSV / GeoJSON / PNG / PDF 全量消费 plan；`assertLayoutWrite` → plan 写权限；checkin / note scope 转 plan。

### 3.1 现状（已就位）

- 写守卫 lib `lib/workspace-write-guards.ts`：`assertLayoutWrite` 基于 `LocalWriteCapability`（本地 capability + 项目级 lease + revision），`localWriteCapabilityGuard` + `captureWorkspaceWriteFence`，不再靠 `layout.id` 判身份；`applyGuardedWorkspaceReplacement` 快照前后双校验。B3 主体守卫已就位，剩余是 scope 接线与导出读源切换。

### 3.2 剩余触点（待核行号）

| 触点 | 现状 | 归属 |
| --- | --- | --- |
| `panels/scene-delivery-panel.tsx:129/:375` | `saved.layout.id !== layout.id` 本地备份恢复比对 | checkin/备份 scope 转 plan |
| `panels/scene-delivery-panel.tsx:297/:298` | `requestedCloud` 比 URL `project` 参数；`cloudBound = cloud.project?.id === layout.id || requestedCloud` | 云绑定判定换 activeProjectId / plan 正源，不再比 layout.id |
| `panels/scene-delivery-panel.tsx:595/:596` | checkin 面板 `projectId={layout.id}` | checkin scope 转 plan |
| 导出读源：`frontend/lib/production-plan-export.ts:91` | `ledger.projectId !== layout.id` 账册一致性校验 | projectId 比对换 plan 正源 |
| 导出读源：`frontend/lib/production-plan-export.ts:130-133` | `createLocalProjectBackup` scope 用 `layout.id ?? 'local'`；人数读 `brief.value.guestsConfirmed/guests`（legacy brief） | 人数读源补 `plan.brief.guests` 兜底（口径见 §5）；plan 化后 scope 换正源 |
| 导出读源：`frontend/lib/production-plan-export.ts:388`、`frontend/lib/execution-timetable-export.ts:69/:155/:161` | 追溯附录/来源读 `layout.id`、`layout.name`；timetable :69 同账册校验 | 追溯编号/名称读 plan；PDF/CSV/GeoJSON/PNG 逐一核对读源 |
| note scope | `scope:'activity'` 是 HTML 标注字面量，非身份键，不动 | — |
| `panels/material-customization.tsx:31` | scope 拼 `apiUrl:user:layout.id` | 库存/定制键随 B4 成套 |

## 4. B4 回写镜像退役与旧键归位（#42，阻塞 B1–B3；#38 阻塞成套）

**全完成判据**（goal §2.1 :51）：删 false 侧 layout patch；地面底图 / 锚点写 plan / 视图记忆；清镜像分支；草稿 / 偏好键退役。

### 4.1 镜像回写触点（壳体独占，须先登记）

| 触点 | 现状 | 动作 |
| --- | --- | --- |
| `room-organizer.tsx:2030-2062` `handleOutdoorPlanChange` | 非纯户外项目时 `shellVenuePatchFromPlanBoundary` 把 plan 边界 patch 回室内 layout（:2054-2058），含 `sceneAnchor` 镜像 | E 线退役后删 false 侧 patch；纯户外分支保留 |
| `room-organizer.tsx:1971-2028` `applyOutdoorGroundBasemap` | 贴地截图写 layout `floorPlanImage`/`floorPlanOpacity`/`satelliteGroundRef`/`mapGroundPolygon`/`mapLngLat`/`mapGroundFrame`/`sceneAnchor` | 底图 / 锚点改落 plan 或视图记忆，不回写 layout 镜像 |
| `lib/outdoor-venue-sync.ts` | `shellVenuePatchFromPlanBoundary`/`applyOutdoorShellVenuePatch`/`sceneAnchorFromOutdoorPlan` 镜像换算 | 随 E4 `isOutdoorProject` 恒真分支退役清残留 |

### 4.2 持久桶身份键（换键带一次性迁移）

| 桶 | 现状键 | 归属 |
| --- | --- | --- |
| briefStorage / 未发送草稿 / 恢复锁 / 图片源 | `creative-studio.tsx:291/:335/:337/:2520`，`layout.id ?? 'local'`；`unsentMessageDrafts`/`applyRecoveryKey`/sourceCoordinator | B4 退役；未发送草稿 / 恢复锁 / run marker 不跨身份搬 |
| 环境偏好键 | 壳体 `:3169-3271` `environmentPreferenceKey(layout.id)` / `{kind:'project',id:layout.id}` | C2：旧存量按 layout.id 键存，换键需一次性迁移或只读承接 |
| 参考图缓存键 | `lib/reference-image.ts:33/:41`、`hooks/use-reference-image.ts:7` | B4 归位 plan 槽键 |
| 评审 / 发布回执 | 壳体 `:1150/:1215/:1221/:1256/:1261` `layout.id ?? 'local'/'local-draft'` | 归档 / 发布域，随镜像退役 |
| 切换守卫草稿检测 | 壳体 `:4865` `identity.scope = layout.id ?? ''`，喂 `unsavedSourceDrafts(scope)` | scope 必须与草稿存储键同口径，不能直接换会话 scope |

## 5. 待拍板口径（到决策点停住，不代选）+ 成熟案例默认建议

> 依据 proposal §7、goal :57。用户 2026-11-24 授权「按成熟案例走」；下列默认值为通行在线 SaaS 口径，拍板后落码。

| 口径 | 悬置项 | 成熟案例默认建议 |
| --- | --- | --- |
| orphan 本机槽处置 | 降级只读保留 / 迁 `house-*` / 标失效移出 | 失效区折叠、只读保留本机备份、不删不迁不改 id；是否补「打开本机缓存」入口待定 |
| 离线缓存副本档位 | 无网时是否进主列表、如何标注 | 进主列表但标「离线副本」只读，不参与写租约；联网可重新拉取 |
| 新建即时归属 | 后端即时发号 vs 先落本机草稿后换绑 | 过渡阶段维持「本机草稿 + 显式存为云项目」；后端即时发号随 B3 定稿（C4 云为主） |
| headcount 兜底 brief | 理解失败人数从 plan.brief.guests 还是 legacy brief 读 | 优先 `plan.brief.guests`，缺省回退本机 brief；两份都缺标 unknown，不虚报 |
| C1 无参刷新草稿索引 | 刷新后草稿恢复档位 | 待 B4 草稿键成套后定 |
| C2 旧 `activity:` 存量 | 会话 / 偏好迁移或只读承接 | 换键带一次性迁移；迁不动的旧存量只读承接，不静默丢 |

## 6. 本轮刻意不做

- 不动 7 个独占 / 基线文件；不删 / 软删云端项目；不清本机裸槽；不动 IndexedDB / localStorage 存量。
- 不改后端 RPC / 迁移 / 契约；生产 4 笔落后迁移（130→140→150→160）补跑属部署治理决策。
- 不孤立撤 B4 镜像；不把 B2/B3/B4 跳卡硬切生产码。
