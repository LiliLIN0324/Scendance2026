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

### 阶段 14a · 止血（低风险，先消残留）

- 在 `showAgent`（及 `toggleAgent` 收口）增加条件化复位：若户外已开（`outdoor2DOpen || outdoor3dTakeover`）且当前处于 3D 接管态，退回户外 2D 地图——`setOutdoor3dTakeoverActive(false)`、`setOutdoor2DOpen(true)`、`setOutdoorView('2d')`；**不整体关闭户外**。
- 户外未开时不动任何户外状态（室内物料 / 空间路径不受影响）。
- 不改动 2D↔3D 胶囊直切链路。
- 验收：3D 接管态点 Agent/Bingo/空间/物料，右侧回到同一幅户外 2D 地图，无接管空屏残留。

### 阶段 14b · 分流统一（下线 A）

- `workspace-shell.tsx`：移除 `OutdoorPlanWorkspace` dynamic 挂载与户外二选一；始终挂 `RoomOrganizer`，把判定出的 `outdoorProjectId`（户外语境信号）作为 prop 传入。
- B 按 `outdoorProjectId` 经 `readOutdoorProjectRecord` 载入本机户外草稿；无记录用 `createStarterOutdoorPlan(anchor)` 起步；默认打开户外 2D。
- 调整 `venue-picker.tsx` 跳转、`resolveOutdoorProjectId` 用途；更新 `app/page.test.tsx:229`、`app/projects/page.react.test.tsx:73` 断言与注释。
- 待评估：A 文件 `outdoor-plan-workspace.tsx` 在无引用后删除或保留备用；其导入的独立导航/设置是否被 B 复用。

### 阶段 14c · 唯一地图（B 内地图层做减法）

- 户外语境下室内 `Viewport` 让位（隐藏或不初始化 three）；不再与户外 overlay / 接管层同帧叠加。
- 2D overlay 与 3D takeover 严格互斥显隐；overlay 保活隐藏仅作为编辑桥，不出镜。
- 核对 `outdoorSceneObjects`（室内 items → 壳体落位）与边界回写在唯一地图口径下的去留；与既有计划 D1（SitePlanData 唯一真相）对齐。
- 左轨对话切换只改左栏，不触动地图层显隐。

### 阶段 14d · 验收

- Node24 `tsc --noEmit` exit 0。
- `vitest run` 对照基线（52 用例失败 / 21 文件，均为既有测试债）不新增失败。
- 真机走查：2D↔3D 直切镜头保持；切对话不残留接管层；户外草稿刷新续上；退出户外画面正确；对话轨可与地图联动。

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
