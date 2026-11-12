# 户外地图收敛：唯一一套可 2D↔3D 直切的地图（2026-11-13）

> 状态：规划 + 分阶段落地。按既定偏好本地攒好、tsc + 测试 + 真机验收通过后再一次性推 main，不逐小改开 PR。
> 基线：分支 `feat/continue-20261105`，HEAD = `origin/main` `7d38fb57`，0 ahead / 0 behind。

## 0. 用户口径（原话收拢，不改写）

- “需要根治，我们只要一套可以切换 2D 3D 的地图。”
- “我们 2D 和 3D 是直接切换的，这个很重要。”
- “新点开户外规划下面的这个图是唯一存在的；点选每个图标或者不选，都是下面这个画面。”
- “户外规划的选择与否只跟这个侧边栏有关系；取消户外规划，希望右边还是这个画面，只是左边在只点 Agent 时是 Agent 对话栏而已。”
- 已拍板：**保留带对话栏的这套工作台（B）作为唯一外壳**；独立户外工作台（A）下线；Agent/Bingo/空间/物料 对话轨与唯一地图打通。

## 1. 现状盘点（按工作树实读，HEAD 7d38fb57）

### 1.1 共用底层（两套外壳都引用，不重复，保留不动）

| 组件 | 作用 |
|---|---|
| `components/outdoor-plan-canvas.tsx` | 2D 地图画布（瓦片层 + 业务图层） |
| `components/outdoor-plan-3d.tsx` | 3D 场地视图（同一份渲染管线） |
| `components/plan-place-search.tsx` | 搜地点 / 场馆 / 地址 |
| `components/outdoor-view-switch.tsx` | 2D / 3D 分段胶囊（2026-11-13 定稿墨黑皮肤） |
| `components/outdoor-plan-icons.ts` / `outdoor-tool-icons.ts` | 图标 |
| `lib/site-plan-*.ts`（度量 / CSV / PNG / 分享 / PDF / GeoJSON） | 业务 lib |

两套外壳都通过 `view: '2d' | '3d'` 在这对底层组件间直切，不跳工作台。

### 1.2 外壳 A：独立户外工作台（待下线）

- 文件：`components/room-organizer/components/outdoor-plan-workspace.tsx`
- 挂载点：`components/workspace-shell.tsx:166`；入口 `?mode=outdoor` / `?start=outdoor`、根路径默认草稿、`panels/venue-picker.tsx:240` 跳转。
- 依赖轻：`controller` 仅取云端项目名；plan 为独立本机草稿（`lib/outdoor-project-store.ts`），不耦合室内 layout / three 场景。
- **无对话轨**：左轨只有品牌钮 / 项目 / 设置 / 保存态，没有 Agent / Bingo / 空间 / 物料。

### 1.3 外壳 B：室内工作台内嵌户外层（保留为唯一外壳）

- 文件：`components/room-organizer/room-organizer.tsx`（212 处 outdoor 引用）+ `components/outdoor-plan-overlay.tsx` + `.sc-outdoor-takeover` 全屏 3D 接管层。
- 对话轨完整：AgentPanel / BingoPanel / SpacePanel / ScendanceLibrary / AgentChatBridge，右轨工具齐备。
- 画布层（均在 `.sc-canvas-stage` 内绝对定位叠放）：
  1. `OutdoorPlanOverlay`（2D 户外层，内含保活编辑桥）：条件 `outdoor2DOpen || !!outdoorPlanState`；非 open 时 `visibility:hidden` 保活。
  2. `#outdoor-inspector-host`：接管态工具卡 portal 宿主。
  3. `OutdoorViewSwitch`：左下动作簇胶囊（room-organizer 独立挂载，`handleOutdoorViewSwitch`）。
  4. 室内 `Viewport`（`.sc-scene-viewport`，three 双 canvas）：**常驻**，`view2D` 控制 2D/3D 显隐，容器不随户外态卸载。
  5. `.sc-outdoor-takeover` 全屏 3D 接管：条件 `outdoorPlan && (outdoor3dTakeover || outdoor3dWarm) && !walkthroughActive && !scanIsolated`；visibility 跟 `outdoor3dTakeover`。
- 关键状态：`outdoor2DOpen:536`、`outdoor3dTakeoverActive:540`、`outdoor3dWarm:545`、`outdoorPanel:546`、`outdoorPlanState:565`、`outdoorView:542`。
- 耦合深：`outdoorPlan` 由 `outdoorPlanState` 回写，与室内 layout 双向联动——边界回写室内 layout + 重拼地面底图；室内 `layout.floors[].items` 经 `planSceneObjects` 派生户外壳体落位 `outdoorSceneObjects`。

### 1.4 分流判定（`lib/outdoor-project-store.ts`）

- `resolveOutdoorProjectId(search)`：`mode=indoor` → null；`mode=outdoor` → projectId 或默认草稿；`start=outdoor` → projectId；旧 `?project=` 按本机户外草稿嗅探；其余 null。
- `workspace-shell.tsx:104` `hasRecentActivity()`：室内草稿有 items 或 `latestOutdoorProjectId()` 非空。
- 根路径无参：有最近活动 → B；无活动 → `decideDefaultOutdoorProject()` → A。

## 2. 残留根因（真机已复现 + 代码定位）

- 进户外 → 切「3D 场地」挂全屏接管层；再点左轨 Agent/Bingo/空间/物料：`toggleAgent → showAgent`（`room-organizer.tsx:831 / 953`）只换左栏，**完全不碰** `outdoor2DOpen` / `outdoor3dTakeoverActive` / `outdoorView`。
- 结果：接管层保持 `visible` 盖在右侧，露出空屏 + OSM 比例尺 / 指北针 / 1F，Agent 对话浮其上 = 图1 残留。
- 普通从 2D 点「户外规划」收起能正常回室内网格；缺口集中在 **3D 接管态下切对话的复位路径**。
- `setOutdoor3dTakeoverActive(false)` 现有调用点仅：户外钮收起（:4306）、overlay `onViewChange` 切 3d（:4540 反向）、`handleOutdoorViewSwitch`（:2433 一带）。`showAgent` / `toggleAgent` 路径缺失。

## 3. 目标

1. 右侧户外地图在户外语境下唯一存在；左轨四个图标 / 不选都不更换底图画面，只切换左栏面板。
2. 2D ↔ 3D 经左下胶囊 / 右轨直切，互斥显隐，不与室内 three 画布叠加。
3. 下线外壳 A；户外项目统一进 B，对话轨与地图打通。
4. 退出户外（若产品保留室内语境）回到正确的室内画面，不留静态 / 3D 残留。

## 4. 分阶段落地

### 阶段 14a · 止血（低风险，先消残留）✅ 已完成 2026-11-13

- `showAgent`（`room-organizer.tsx:831`）增加条件化复位：`outdoor3dTakeoverActive && !outdoor2DOpen` 时退回户外 2D——`clearPendingPlacement()` + `setOutdoor3dTakeoverActive(false)` + `setOutdoor2DOpen(true)` + `setOutdoorPanel('library')` + `setOutdoorView('2d')`；**不整体关闭户外**。
- 成员私信入口 `RailTeamBlock onOpenChat`（:4324 一带）补同一复位，绕过 `showAgent` 的对话路径一并覆盖。
- 依赖只列前置 state（`outdoor2DOpen` / `outdoor3dTakeoverActive`）；`clearPendingPlacement` 留在回调体内，规避 `showAgent` 在前、后置 const 的 TDZ。
- 户外未开时不动任何户外状态；2D↔3D 胶囊直切链路未改。
- **真机验收（dev 3210）**：进户外 2D → 胶囊切 3D（接管层 `visible/active=true`）→ 点 Agent，接管层回落 `hidden/active=false`，左侧新会话栏、右侧回归 2D 地图，无空屏残留；Bingo/空间/物料 切换接管层不复活。取证 `residual-after-agent-fixed.png`。
- **类型/测试**：Node24 `tsc --noEmit` exit 0；map-preservation / rail-side-panels / bingo-rail-button 通过。剩余失败为基线既有测试债（agent-panel contexts mock 缺 `useSelectionOptional`、workbench-rail-head 旧四形体断言），非本次引入。

### 阶段 14b · 分流统一（下线 A）🟡 代码完成，待真机走查

- `workspace-shell.tsx`：移除 `OutdoorPlanWorkspace` dynamic 挂载与户外二选一；始终挂 `RoomOrganizer`，把判定出的 `outdoorProjectId` 作为 prop 传入。无 query 兜底（`/` 与 `/editor` 同口径）：室内草稿有物料续室内（null），否则续最近户外项目或起步户外；带参（`?mode=…` / `?restore=backup` / `?login=…`）仍走 `resolveOutdoorProjectId`。
- `room-organizer.tsx`：新增 `outdoorProjectId` prop 与 `isOutdoorProject` 派生；起步 effect 在纯户外时打开户外 2D、回读项目视角记忆；overlay 的 `projectId/anchor/activityName/seedPlan/sceneObjects` 按纯户外切换；`handleOutdoorPlanChange` 纯户外跳过室内壳体回写（不 `applyLayout`），只镜像 3D 地面；`outdoorPlan` 身份判定兼容户外项目 ID。
- 持久化复用 overlay 既有管线：`slotId=projectId` 已接 `readOutdoorProjectRecord`/防抖 `saveOutdoorProjectRecord`/`read·saveOutdoorPlanView`，未另写存储层。
- 测试：`app/page.test.tsx:229` 断言改为 B mock 的「打开 Bingo Agent」钮（旧 A 骨架文案不再出现）；`projects/page` 注释同步；app 子集 23 用例通过。
- 待办：A 文件 `outdoor-plan-workspace.tsx` 已无代码引用，先保留备用，14d 真机通过后再删；其独立导航/设置不进 B。

### 阶段 14c · 唯一地图（B 内地图层做减法）🟡 代码完成，待真机走查

- 纯户外语境下室内 `.sc-scene-viewport` 容器 `visibility:hidden` + `pointerEvents:none`（双 canvas 常驻维持渲染管线，暂未卸载 three；真机评估资源占用后再定是否卸载）。
- overlay 与接管 3D 的 `sceneObjects` 纯户外传 `[]`，室内物料壳体不投影到户外地图。
- 2D overlay 与 3D takeover 互斥沿用既有接管/保活逻辑；左轨对话切换只换左栏（14a 复位兜底），不改地图层显隐。
- 待真机核对：纯户外打开时室内 three 场景不与户外地图同帧叠加；户外地图为右侧唯一画面。

### 阶段 14d · 验收 🟡 静态验收通过，真机走查待浏览器后端恢复

- Node24 `tsc --noEmit` exit 0（`tsc-14b.log`）。
- 定向单测全绿：app 分流 23 通过（`vitest-14b-shell.log`）；B 侧房间组织器子集 12 通过（`vitest-14b-b.log`）；全量里被并发压挂的 4 个文件（brand-tokens / structure-satellite / scene-delivery / amap-venue-picker）单跑 55 通过。
- 全量对照：基线实测 22 失败文件 / 111 失败用例（`vitest-node24-post-ci-20261112.log`）；本次失败集合为既有测试债（scene-layers 12、structure-v2 9、scene-layers-panel 9、shared-seating 4 等）叠加并发超时/抖动，未发现本轮代码引入的真实回归。基线债归类仍挂 #12。
- 待真机走查（浏览器后端恢复后）：纯户外打开右侧仅户外 2D/3D、室内 Viewport 隐藏不叠；左轨 Agent/Bingo/空间/物料/私信切换不复活接管层、不留空屏；2D↔3D 胶囊直切镜头保持；草稿按项目续上、刷新后视角记忆恢复；室内草稿有物料时冷根仍续室内。

### 阶段 14e · 白屏诱因核查 + 纯户外空屏路径加固 🟡 代码完成，待真机

- **白屏直接诱因（2026-11-13 核查）**：本仓库 dev（3210）进程曾退出，3199 代理存活；浏览器旧页面壳/右轨/左栏会话仍在，但 three/地图 chunk 随重启 hash 变化、旧 chunk 取不到，画布整片白屏。已用 Node24 重启 `scripts/dev-with-amap-proxy.mjs --hostname 127.0.0.1 --port 3210`，3210 LISTEN、`/editor` 编译 200、3199 `/health` 200。旧页面需硬刷新（Ctrl+Shift+R）加载新 chunk。
- **代码层加固（room-organizer.tsx）**：
  1. 左轨「户外规划」钮收起分支加纯户外守卫：`if (isOutdoorProject) return;`——纯户外项目没有室内壳体可回退，整体收起会让户外 overlay 隐藏、室内 Viewport 又已让位，右侧直接空屏；纯户外下地图保持出镜，禁止收起。
  2. `showAgent` 复位条件由「仅接管态」扩为「接管态 或 纯户外双 false（`!outdoor2DOpen && !outdoor3dTakeoverActive`）」，兜底切对话时回 2D；deps 补 `isOutdoorProject`。
  3. `RailTeamBlock onOpenChat` 私信入口补同一纯户外双 false 兜底。
- 复核 `setOutdoor2DOpen(false)` 仅剩两处：切 3D 接管（保留 3D 画面，非空屏）与已加守卫的收起分支。
- Node24 `tsc --noEmit` exit 0（`tsc-14e.log`）；app 定向 23 通过（`vitest-14e-shell.log`）。
- **地图 key 现状**：仓库根 `.env.local` 缺失，代理读不到 `LUX3D_API_KEY`（`/health` `keyConfigured:false`）与 `TDT_KEY`；前端 `.env.local` 仅 Supabase。key 文件被 gitignore，不随 main 提交下发，需本机配置或由服务端 functions 持有。2D OSM 直连不受影响；3D aholo / 天地图瓦片仍挂 #13。
- **分支差距**：本地 HEAD `76ccbe6f` 落后 `origin/main` 一个提交 `72af5635`（POI 真实轮廓架构 + 选区体验 + 工作树批量入库；含瓦片链路、tdt-probe、aholo 代理改动，并直接删除 A 文件 `outdoor-plan-workspace.tsx`）。本地有未提交在制品（14b/14c 及并行设施模型改动），未合并；合入前先备份。
- 浏览器自动化：bu 产品浏览器后端 `sending window binding timed out`（守护未挂），cu 桌面会话 `NO_SESSION`；9222 端口非标准 DevTools 端点。真机走查暂由用户手动完成。

### 1.5 B 初始化耦合事实（2026-11-13 实读）

- `RoomOrganizer` 签名 :291：`{ controller, isActive, localWriteCapability, isolatedWriteSession }`，无户外项目 id 入参。
- 核心状态来自 `useLayoutState()`（室内 `RoomLayout` / layoutStore）；`sessionScope = activity:${layout.id}`，会话、历史、物料、导出全部绑室内 layout。
- `outdoorPlanState` 初始 `null`，由 overlay `onPlanChange` 回写；起步 plan 走 `seededPlanFromLayout(layout)`。**B 不调用 `readOutdoorProjectRecord`**，不从本机 SitePlanData 草稿恢复。
- 因此 14b 让纯户外项目进 B，需新增 `outdoorProjectId` 入参 + 草稿载入 effect（对齐 D1：SitePlanData 为真相），并处理室内 layout/会话在户外语境的空起步；14c 再让室内 Viewport 让位。

## 5. 风险与边界

- `room-organizer.tsx` 5000+ 行、Provider 深嵌套；阶段 14c 拆室内 Viewport 前必须先隔离会话 / 历史 / 物料 / 导出对 layout 的依赖，避免一次性大改炸链。
- 户外 plan 当前由室内 layout 派生（`seededPlanFromLayout`）；A 用独立本机草稿。阶段 14b 载入本机草稿时要定清唯一数据源（对齐 D1：SitePlanData 为真相）。
- 阶段 14a 只复位视图，不触碰数据；阶段 14b/14c 才动分流与画布层级。

## 6. 工作区并行在制品（必须保留，不得还原）

下列未提交改动分四条线，与地图收敛无关，叠加改动时保持：

1. **显示单位偏好**：`lib/types.ts`（`DisplayUnit` / `lengthUnit`）、`panels/settings-menu.tsx`（Settings→MoreHorizontal「更多」）、`panels/settings-menu.react.test.tsx`、`panels/scendance-workspace.tsx`（`GridSnapIcon`）、`lib/__testfixtures__/fixtures.ts`、`lib/backend-session.ts`（`AccountPreferences` / `getPreferences` / `savePreferences`）、`supabase/functions/_shared/api.ts`（`/preferences` GET/PATCH）。
2. **漫游退出收口**：`contexts/room-editor-context.tsx`（`exitWalkthrough`）、`room-organizer.tsx`（`exitWalkthrough` 接 `onExit`）、`panels/agent-panel.tsx`（`AgentCanvasOverlay` 用 `exitWalkthrough`）、`panels/viewport.tsx`（漫游文案）、`lib/splat-venue-fit.ts`（文案）。
3. **2D/3D 胶囊定稿**：`components/outdoor-view-switch.tsx`（墨黑皮肤 / 滑块）、`components/outdoor-plan-overlay.tsx`（移除内嵌胶囊，导出分享簇右让位 left 148）、`room-organizer.tsx`（独立挂载 `OutdoorViewSwitch` + `handleOutdoorViewSwitch`）。
4. **文案 / 测试微调**：`panels/agent-panel.css`、`panels/mobile-shell.css`、`app/globals.css`、`panels/online-model-library.react.test.tsx`、`panels/scendance-workspace.react.test.tsx`、`lib/splat-venue-fit.test.ts`。

## 附录 · 关键代码索引

- 分流：`workspace-shell.tsx:136-169`、`lib/outdoor-project-store.ts:137-155`
- B 状态：`room-organizer.tsx:536-565`；`outdoor3dTakeover` 派生 :2423；overlay 挂载 :4507-4548；inspectorHost :4554；视图胶囊 :4562-4571；室内 Viewport :4573；接管层 :4665-4684；户外钮 :4273-4312；`showAgent` :831；`toggleAgent` :953。
- 既有对齐计划：`docs/plans/outdoor-2d-one-flow-2026-11-10.md`（D1 一份 SitePlanData、D2 一张画布）；`docs/plans/sidebar-entry-unification-2026-11-12.md`（左轨视觉，与本计划互补）。
