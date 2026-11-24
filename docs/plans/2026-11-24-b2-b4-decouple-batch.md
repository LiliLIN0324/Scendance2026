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

## 1. 门禁基线（每卡复用）

- Node v26.2.0（`C:\Program Files\nodejs`，命令前置 PATH）；Node22 禁跑全量 / build。
- 根 `tsc --noEmit`、前端 `tsc --noEmit` exit 0；定向 vitest 转绿；前端全量无增量回归；`npm --prefix frontend run build` exit 0。
- 本地攒批：tsc + 测试 + 真机走查全绿后一次性推 main；只按明确路径 `git add`，不用 `-A`/`.`/`commit -a`。

## 2. B2 历史快照换 SitePlanData（#40，阻塞解除：B1 已合入）

**全完成判据**（goal §2.1 :49）：`useHistory` 快照 `RoomLayout` → `SitePlanData`；物料 / 选中 / 墙操作挂 plan 历史；undo/redo 回写 plan（经 overlay / `commitPlan`），不再 `actions.applyLayout`；两份 brief 打通（#63）。

### 2.1 现状（已就位）

- 地基纯函数 `lib/plan-history.ts`：`commitPlanHistory` / `undoPlanHistory` / `redoPlanHistory` / `planSnapshotsEqual` / `emptyPlanHistory`，30 步截断、栈顶去重、redo 分叉清空；`plan-history.test.ts` 9/9 绿。
- 2D 画布 `components/outdoor-plan-canvas.tsx` 已有内联双栈：`historyRef`/`redoRef`（:1851/:1853），提交 `commitPlan`（:2876）、撤销 `undoPlan`（:2925）、重做 `redoPlan`（:2943）、另一处 redo push（:3196）、prune（:8344）；`UNDO_LIMIT=30`（:1090）。
- 壳体 3D 历史仍是 `useHistory<RoomLayout>`：`room-organizer.tsx:1939`，`commitHistoryNow` 在 30+ 处提交点调用（物料摆放 / 选中 / 墙体 / 光照 / 运营计划 / 事件操作等）。

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
  - **转绿路径（按 §5 默认口径：优先 `plan.brief.guests`，缺省回退本机 brief）**：例3 需重写为新通路断言——读 `capture.agent.outdoorWorkflow.state.brief.guests`，而非 legacy capture.project().headcount。注意 `forcedResolution='failed'` 桩只作用于 `agent-resolver`，对 workflow 通路无效；「理解失败轮保留已录人数」的语义要在 `use-outdoor-agent-workflow` 的 state.brief 写入/失败分支里核对，不能沿用 resolver 的 failed 轮模型。属测试口径对齐 + workflow 通路失败语义核对，不孤立改生产码。
- 历史裸 UUID 本机槽迁移到 `house-*`：成熟案例口径下本轮只失效隔离、不迁；是否补「打开本机备份」入口见 §4。

## 3. B3 导出与写守卫 plan 化（#41，阻塞 B2）

**全完成判据**（goal §2.1 :50）：CSV / GeoJSON / PNG / PDF 全量消费 plan；`assertLayoutWrite` → plan 写权限；checkin / note scope 转 plan。

### 3.1 现状（已就位）

- 写守卫 lib `lib/workspace-write-guards.ts`：`assertLayoutWrite` 基于 `LocalWriteCapability`（本地 capability + 项目级 lease + revision），`localWriteCapabilityGuard` + `captureWorkspaceWriteFence`，不再靠 `layout.id` 判身份；`applyGuardedWorkspaceReplacement` 快照前后双校验。B3 主体守卫已就位，剩余是 scope 接线与导出读源切换。

### 3.2 剩余触点（待核行号）

| 触点 | 现状 | 归属 |
| --- | --- | --- |
| `panels/scene-delivery-panel.tsx:129/:297/:298/:595/:596` | `layout.id` 用于本地备份恢复比对、云绑定判定、checkin 面板 `projectId` | checkin scope 转 plan |
| 导出读源：`lib/execution-timetable-export.ts:161`、`lib/production-plan-export.ts:131/:388` | 追溯附录读 `layout.id` / layout 快照 | 导出改读 plan；PDF/CSV/GeoJSON/PNG 逐一核对读源 |
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
