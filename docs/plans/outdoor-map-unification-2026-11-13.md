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
- **地图 key 现状（2026-11-13 晚更新）**：仓库根 `.env.local` 已由本机补齐 `LUX3D_API_KEY` / `TDT_KEY` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` 等；代理旧进程重启后 `/health` 返回 `keyConfigured:true`，`/api/tdt-search?keywords=西湖` 200 返回 POI，LUX3D 与天地图搜索链路打通。3D 地面瓦片三层 `paintTilePyramid` count=0 仍挂 #13（独立瓦片渲染链路，非 key 缺失）。
- **分支差距**：本地 HEAD `76ccbe6f` 落后 `origin/main` 一个提交 `72af5635`（POI 真实轮廓架构 + 选区体验 + 工作树批量入库；含瓦片链路、tdt-probe、aholo 代理改动，并直接删除 A 文件 `outdoor-plan-workspace.tsx`）。本地有未提交在制品（14b/14c 及并行设施模型改动），未合并；合入前先备份。
- 浏览器自动化：bu 产品浏览器后端 `sending window binding timed out`（守护未挂），cu 桌面会话 `NO_SESSION`；9222 端口非标准 DevTools 端点。真机走查暂由用户手动完成。

### 阶段 14f · 房间画布退役，右侧唯一户外地图 🟡 出镜退役完成，死代码清理后置

- **用户拍板（2026-11-13）**：右侧这套户外地图是工作台**唯一常驻画布**，不是"纯户外专属"；"户外模式"只决定左栏面板（Agent/Bingo/空间/物料/户外规划）形态，右侧去哪都是这套地图 2D/3D。室内房间 three 画布（桌椅/墙体/第一人称漫游/NPC）退役，不再占右侧主画布。
- 本轮改动（room-organizer.tsx，先让出镜退役、保活管线保留）：
  1. `.sc-scene-viewport` 容器由"纯户外才隐藏"改为**无条件 `visibility:hidden` + `pointerEvents:none`**：房间 three 组件仍挂载保活（renderer/canvas ref/isReady 被环境、漫游、就绪态逻辑复用），但画面不再出镜。
  2. 起步 effect 由"仅纯户外进 2D"扩为**所有项目起步进户外 2D**；视角记忆仍只按户外 projectId 回读，室内项目默认 2D。
  3. 停用房间语境浮标 `CanvasHeading`（室内"2D 平面 + 容量/座位"徽标），移除其 import；地图标题/比例尺由户外 overlay 自带。
  4. **按钮只控左栏户外面板、地图常驻**（14g 口径修正）：「户外规划」钮不再负责收起地图；已开启时再点只 `setOutdoorPanel(null)` 收起左栏户外物料卡，右侧地图保留。左栈 `leftStackCards` 与户外卡挂载条件均加 `outdoorPanel !== null` 联动；地图 overlay 挂载只看 `outdoor2DOpen/outdoorPlanState`，不收面板。`setOutdoor2DOpen(false)` 仅剩 2D→3D 接管一处。
- 校验：Node24 `tsc --noEmit` exit 0（`tsc-14e.log`）；app 定向 23 通过（`vitest-14e-shell.log`）；户外画布 lib 43 通过（`vitest-14e-b.log`）。
- **后续清理（未做，避免本轮回归面过大）**：
  - 彻底卸载 `Viewport` 组件与室内 layout 回写链路（assertLayoutWrite / shellVenuePatchFromPlanBoundary / applyLayout）、three renderer/NPC/墙体/漫游状态；
  - 室内漫游接管（walkthroughActive）、场景隔离（scanIsolated）、环境加载遮罩、选中物件属性气泡等房间语境浮层的入口收口；
  - 物料落位从室内 layoutStore 打通到地图（当前室内物料仍写室内草稿、不投影到地图）；
  - shell 分流（室内草稿续接 / `mode=indoor`）在房间退役后是否还需要保留，复盘后再定。
- **待真机核对**：任一项目起步右侧即户外地图；左栏 Agent/Bingo/空间/物料/户外规划互切，右侧地图不换、不空白、不残留房间 3D/比例尺/标题；2D↔3D 胶囊直切保持。

### 阶段 14g · 拆除室内/户外二分，墙体并入素材库 🟡 出镜与分流收口，深耦合链路后置

- **用户拍板（2026-11-13 晚）**：项目不再有室内/户外概念二分，墙体本身就是素材库里的一种物件；右侧只保留地图。
- 本轮已落地：
  1. 删除退役旧工作台 A 文件 `outdoor-plan-workspace.tsx`（无 import/测试引用；main `72af5635` 已删同名文件）。
  2. `workspace-shell.tsx`：无参数不再续室内草稿（`hasLocalIndoorDraft` 分支移除），一律 `decideDefaultOutdoorProject()`；显式 `?mode=indoor` 入口暂留，待后置拆除。
  3. 户外钮改为面板开关（见 14f 第 4 条），左栈/户外卡条件联动 `outdoorPanel !== null`。
  4. 真机：刷新后地图（OSM/天地图 POI、选址多边形、2D/3D、指北针、比例尺）出镜；切 Bingo/空间地图不换；点户外钮左栏户外卡退出、地图保留；2D→3D→2D 闭环正常。
- **已知残留（#19）**：
  - 收左栏户外面板后，画布内「已放置物件 / 测量 / 标注 / 底图图层」回落浮窗仍浮在地图上：原因是 aside 卸载后 `#outdoor-panel-host-*` 宿主丢失，`PanelPortal`（`outdoor-plan-canvas.tsx:828`）回落到画布内原地渲染。需把"面板可见"透传 overlay→canvas，回落分支在面板收起时不渲染（或 aside 保活隐藏不卸载宿主）。
  - 室内深耦合仍在 RoomOrganizer 主组件：`layoutStore`、墙体 `interiorWalls`/`drawWallMode`/`selectedWall`、`useNpcs`、`walkthroughActive`/`scanIsolated`、室内 layout 回写（`applyLayout`/`assertLayoutWrite`/`shellVenuePatchFromPlanBoundary`）、会话/历史跟踪绑 `layout.id`；`isOutdoorProject` 二分仍散布 1695/1725/1732/4542-4551/4693 等。312 处引用，需分步拆，不能本轮盲删。
  - `mode=indoor` 入口（`resolveOutdoorProjectId`、`venue-picker.tsx:246` 跳转）拆除；墙体从室内墙体工具转为地图素材库物件。
- 校验：tsc exit 0；app + store + canvas 定向 77 通过（`vitest-14e-b.log`）。

### 阶段 14h · 合并 origin/main（72af5635）冲突融合 🟡 已解决未提交

- 合并卡在 4 个 UU 文件：`app/page.test.tsx`、`outdoor-plan-overlay.tsx`、`room-organizer.tsx`、`workspace-shell.tsx`。冲突本质是两代分流架构：本地 HEAD 用 `outdoorProjectId` 传参（14b 统一 + 房间退役），main 用 `startOutdoor` 布尔 + `hasRecentActivity`。
- 取舍（用户确认"继续融合"）：**以本地 `outdoorProjectId` 架构为基底**，并入 main 纯新增地图链路；丢弃 main 旧的 `startOutdoor`/`hasRecentActivity` 分流与已删的新手引导（`tour-machine`/`tour-reel`/`onboarding-steps`）。
- 具体解决：
  1. `workspace-shell.tsx`：保留 `decideDefaultOutdoorProject()` + `resolveOutdoorProjectId()` + `outdoorProjectId` state；去掉 `startOutdoor`/`hasRecentActivity`/`requestsOutdoorMode` 组件调用（store 内旧导出 `requestsOutdoorMode` 暂留，#19 清）。
  2. `room-organizer.tsx`：签名保留 `outdoorProjectId`；`:4930` 工具排去掉 main 塞入的 `outdoorStage` prop（本地 `ScendanceViewTools` 的 `ViewToolsProps` 不收该属性，2D/3D 直切由独立 `OutdoorViewSwitch` + `handleOutdoorViewSwitch` 负责）；悬空 `TourReel` JSX 随冲突块移除。
  3. `outdoor-plan-overlay.tsx`：import 双侧合并（`facility-footprint-lock` + `place-area.fetchPlaceShape`，均在用）；保留 main 的"正在圈范围…"加载胶囊；删除未使用的 `OutdoorViewSwitch` import。
  4. `page.test.tsx`：保留本地 14b 断言（`打开 Bingo Agent`），去掉 main 的 `data-start-outdoor=1` 断言。
- 并入的 main 新链路：`place-area.ts`(+test)、`functions/api/place-shape.ts`、`functions/api/tdt-area.ts`、`lib/tdt-probe.ts`、`lib/plan-tile-cache.ts`、`lib/place-search.ts`、`app/tdt-probe`、`app/cases/garden-flower-show/**`。
- 校验：Node24 `tsc --noEmit` exit 0（`tsc-merge.log`）；前端定向 86 通过（app 9 + projects 14 + store 23 + canvas 31 + place-area 9，`vitest-merge.log`）；lib 48 通过（tdt-probe 11 + plan-tile-cache 18 + place-search 19，`vitest-merge-lib.log`）；后端 13 通过（api-place-shape 6 + tdt-search 7，`vitest-merge-api.log`）。
- 状态：冲突已解决并完成 merge commit，随后合入本地 main 并推送 origin/main；本次一并带入 #51 足迹锁、统一交付面板、14e 房间退役与阵列预览在制品。

### 阶段 14i · 右轨控件口径：五颗钮保留（不分室内室外）🟡 已落盘未提交

- 基底：HEAD `9f2c811a`，与 `origin/main` 顶端一致；无进行中 merge。
- 口径修正（用户 2026-11-13 拍板）：项目不再分室内/室外。上一轮被当作"室内概念"隐藏的五颗工具钮**不删除、不分室内室外、都保留可用**：
  1. `.sc-floor-switcher` 楼层切换器（`1F` + 上下三角 / 新建第 2 层）。
  2. `#tool-walk` 第一人称漫游 / 退出漫游。
  3. `#tool-preset` 相机视角预设（整体/俯视…）。
  4. `#tool-dims` 尺寸标注（`showMeasurements`）。
  5. `#tool-grid` 网格吸附（`snapToGrid`）。
- 处置：此前 `!outdoorEditing` 条件包裹已逐段回退，五颗钮 JSX 回到 HEAD 原状。`scendance-workspace.tsx` 相对 HEAD 仅剩分享菜单 / 导出钮两处历史在制品 diff（统一交付面板接线：户外语境旧 ShareMenu、旧导出钮让位给新 `OutdoorDeliveryPanel`），与五颗钮无关，保留。
- 真机取证（`http://127.0.0.1:3210/editor`，硬刷新后探针）：右轨含楼层上下三角、`tool-walk`、`tool-preset`、`tool-dims`、`tool-grid`；文案依次为 `1F` / `第一人称漫游` / `视角切换：当前整体，点击切到俯视` / `尺寸标注` / `网格吸附`。截图 `docs/plans/ia-mapping/_shots/adversarial-five-restored.png`。
- 校验：清掉陈旧 `frontend/tsconfig.tsbuildinfo` 后 Node24 `tsc --noEmit` exit 0（此前 6133/1005 报错系增量缓存陈旧误报，三处被报"未使用"的符号在文件内均有真实调用/导出）；定向 8 文件 264 测试通过（`vitest-adversarial.log`）。
- 待核（未决）：五颗钮回调当前仍接室内 `view`/`layout`/history（`cyclePreset`、`toggle showMeasurements`/`snapToGrid`、`changeVisibleFloor`、`toggleWalk`），户外地图语境下逐颗实际行为（是否空转、是否需接户外对应能力）尚未逐颗验证。
- 未拆、留 #19 深耦合：
  - 左轨「拍摄场地」钮（Aholo 扫描/重建、`scanIsolated`/splat/environment/floorIndex/walkthrough 链路），落地到地图素材库前不退役。
  - `venue-picker.tsx:247` 旧项目/空白走 `mode=indoor`；`resolveOutdoorProjectId` 的 `explicitMode==='indoor'` 返回 null 分支；`requestsOutdoorMode` 死代码。
  - 收左栏后画布内「已放置物件/测量/标注/底图」回落浮窗（`PanelPortal` host 随 aside 卸载丢失）。
  - 室内容器隐藏但保活挂载，仍收完整室内 layout/选中/墙体/漫游 props；layoutStore、墙体、useNpcs、室内回写、会话绑 layout.id、`isOutdoorProject` 二分仍散布。

### 阶段 14j · 去室内化 A 层：分流二分与入口收口 🟡 代码完成，B/C 深耦合后置

- 基底：HEAD `9f2c811a`，本地未提交在制品之上继续；目标口径（用户 2026-11-13 再升级）：室内接的东西全部拿出、室内概念整体删除、不分室内户外、所有功能接到地图对应能力、深耦合想办法合并，最终不能残留室内，验收后合 main。
- **A 层（分流二分，本轮已落地）：**
  1. `lib/outdoor-project-store.ts`：`resolveOutdoorProjectId` 删除 `explicitMode==='indoor' → null` 分支；`mode=outdoor` 仍返回 `projectId || ensureDefaultOutdoorProject(storage)`；无 projectId 返回 null；`start=outdoor` 命中。整段零引用死函数 `requestsOutdoorMode` 删除；文件头注释由"户外项目/不挂室内 RoomOrganizer"改为"地图项目"。
  2. `lib/outdoor-project-store.test.ts`：两条 indoor 断言改写——`mode=indoor` 不再切独立通路，无草稿回落 null、有草稿照常命中；`start=outdoor&mode=indoor` 时 start=outdoor 优先返回 PID。
  3. `panels/venue-picker.tsx`：`confirm()` 抽出共用创建跳转——`map` 带所选地点锚点、`new` 用默认预置锚点，两者都 `saveOutdoorProjectRecord` + `window.location.assign('/editor/?project=<id>&mode=outdoor')`；`new` 原先 `router.push('…&mode=indoor')` 删除。底部按钮文案「开始布置」统一为「开始规划」。`blank` 仍走 `onBlankVenue`（C 层未改）；`project` 已有项目分支保留 `router.push('/editor/?project=<id>')`。
  4. `panels/venue-picker.react.test.tsx`：三处按钮名 `开始布置`→`开始规划`；`new` 用例断言从 `push('/editor/?project=p-new&mode=indoor')` 改为 push 未调用 + 本机地图草稿落盘（读 `scendance-outdoor-plan-v1:p-new`，boundary 空、name 春夏市集）。
  5. `workspace-shell.tsx`：二分注释去"显式 ?mode=indoor 入口"表述；带参 `resolveOutdoorProjectId` 返回 null 时兜底 `decideDefaultOutdoorProject()`，旧链接/登录回跳/恢复备份也统一落默认地图草稿，不再回退室内壳体。
- **B 层（`isOutdoorProject` 恒真拉直，未做）：** 定义 `room-organizer.tsx:302`，false 侧依赖室内 `layoutStore` 壳体（`layout.id` 绑定、`layout.sceneAnchor/mapLngLat/name`、`outdoorSeedPlan/outdoorSceneObjects` 喂地图、`applyLayout`/`shellVenuePatchFromPlanBoundary` 室内回写）。生产入口（shell）已恒真；`isolated-room-organizer.tsx:53` 是未接线遗留封装（当前无生产挂载），仍走 false 通路。壳体依赖未隔离前不强拆 false 分支。
- **C 层（深耦合壳体与数据模型，本轮未动）：** Viewport 保活容器 `:4633`；layoutStore；`interiorWalls` 深入布局 schema/碰撞/安置/预览/导出/Agent 提案/2D 渲染/分享；`useNpcs`；墙体 draft（`wallDraft/selectedWall/drawWallMode/wallSnapResult`）；`walkthroughActive/walkthroughPhase/scanIsolated`；楼层 `activeFloor`；会话绑 `layout.id`；室内回写 `applyLayout/assertLayoutWrite/shellVenuePatchFromPlanBoundary`；`blank` 卡片 `startBlankVenue` 立壳回调与 `BLANK_VENUE` 12×8m 室内尺寸文案。物料放置/选中/历史/会话/导出仍走壳体管线再镜像地图。Provider 深嵌套，拆 Viewport 前必须先隔离会话/历史/物料/导出对 layout 的依赖。
- **D 层（业务场地类型事实，保留）：** `venueIO`/`indoorOutdoor` 是 Agent 对话解析、recipe、投资人报告、地图室内场地判定的业务字段（`agent-resolver.ts`、`recipe.ts`、`investor-report.ts`、`amap-venue.ts`、`blank-venue.ts` 等，命中数百处），不属工作台室内模式，不删，否则需求理解链路破裂。
- **五钮出镜复核（#24 部分，以当前磁盘为准）：** 定向 27 测试绿，测试固定断言 `#tool-dims`、`#tool-preset` 均为 null。
  - 当前并行版本口径：右轨**不放** `tool-dims` / `tool-preset` 两颗。`showMeasurements` 作为账户偏好存 `lib/account-preferences.ts`（默认 `true`），渲染消费仍在室内 2D `render.ts` 与 three `use-scene-effects.ts`；右轨无对应开关钮。
  - `tool-preset`（视角轮换）链路已整段移除——`preset` 状态 / `presetAt` / `onApplyPreset` prop / `choosePreset·cyclePreset` 在 `scendance-workspace.tsx` 中不存在；`OutdoorPlan3D` api 仅暴露 `zoomBy/focusLngLat/captureImage`，无 iso/top 机位切换。若要恢复右轨视角钮，需先在户外 3D 补机位切换 API，归 #24。
  - 仍出镜：楼层上下三角、`tool-walk` 第一人称漫游、`tool-grid` 网格吸附；回调仍接室内 `view`/`layout`/history（`changeVisibleFloor`/`toggleWalk`/`toggle snapToGrid`），户外地图语境下逐颗实际行为与是否接地图能力（3D 相机/放置吸附/第一人称行走/地图测量）未验证。
  - **口径冲突待用户拍板：** 14i 用户拍板五颗钮都保留可用；当前磁盘并行版本把尺寸标注、视角轮换两颗从右轨撤下。两者需对齐：是回到 HEAD 五钮右轨版，还是接受 dims 归账户偏好、preset 待户外相机能力再回。
- 校验：清陈旧 `frontend/tsconfig.tsbuildinfo` 后 Node24 `tsc --noEmit` exit 0；定向 64 测试通过（store 23 + picker 11 + shell 1 + floor-structure 2 + workspace 27）。
- 全量 vitest（Node24，`vitest-full-out.txt`）：33 失败文件 / 284 失败用例 / 7535 通过 / 74 跳过；本轮改动的 store/picker/shell 三个测试文件均不在失败清单。失败集中在 three 解码/几何碰撞/场景图层/Agent 面板夹具/交付分享等既有基线债（#12/#13），未逐文件回退到 HEAD 对照，需在 #12 专项补齐时核对是否本轮回归。

### 阶段 14k · 对抗性残留分级与五钮定稿 🟡 排查落盘，C 层拆除后置

- **五钮定稿口径（2026-11-13 用户拍板）：**
  - 楼层、第一人称漫游、网格吸附：保留出镜；回调待接到地图能力。
  - 尺寸标注：保留在账户偏好链路（`lib/account-preferences.ts` `showMeasurements`，默认 true），**不回右轨圆钮**；渲染消费目前仍在室内 2D `render.ts` 与 three `use-scene-effects.ts`，后续随壳体迁移。
  - 视角预设：**彻底删除、不恢复**。右轨轮换链路（`preset`/`presetAt`/`choosePreset`/`cyclePreset`/`onApplyPreset` prop）已在 `scendance-workspace.tsx` 清空，panels 目录零残留死引用；测试固定断言 `#tool-preset` 为 null。注意：`CameraPreset` 类型与导出/交付机位册（`ANGLE_PRESETS`/`EXPORT_VIEWS`/share-snapshot/delivery-package/shot-list/use-import-export）是**导出成图机位**，不是右轨轮换钮，保留不动。
  - **真机探针取证（dev 3210 `/editor`，2026-11-13）：** `.sc-scene-viewport` display=block 但 visibility=hidden（室内容器保活在 DOM、视觉已退役）；右轨出镜钮 = 楼层上下、tool-select、tool-measure、tool-annotate、tool-selection、tool-walk、tool-grid、tool-undo、tool-redo、tool-zoom-out、tool-zoom-in；`#tool-preset` 与 `#tool-dims` 均不在列（符合定稿）；户外规划钮 aria-pressed=true，文案「户外规划：在地图上画边界分区动线」。待核：该钮「再点取消」语义（用户反馈点开不能取消），归 #24 地图能力接入时定。
- **对抗性残留分级（全前端 56 个含 indoor 的文件，按拆除先后）：**
  - **L0 · 已清（本轮）：** `mode=indoor`/`start=indoor` 链接拼接、`requestsOutdoorMode` 死函数、store indoor 通路分支；生产代码无室内模式链接。
  - **L1 · 活跃入口（低风险，可独立关）：** `venue-picker` 的 `blank` 卡片→`startBlankVenue` 立 12×8m 室内壳（`blank-venue.ts`/`createBlankVenue`→`RoomLayout`→layoutStore）；`project` 旧项目分支跳 `/editor/?project=<id>` 不带地图通路；左轨「拍摄场地」Aholo 扫描/重建入口（`openAholoWorkflow`/`startStoredScene`/`applyRealVenue`/`scanIsolated`）。
  - **L2 · 保活壳体状态（中风险，须先隔离依赖）：** Viewport 保活容器 `room-organizer.tsx:4633`；layoutStore；`interiorWalls`（schema/碰撞/安置/预览/导出/Agent 提案/2D 渲染/分享）；useNpcs；墙体 draft；walkthroughActive/scanIsolated；楼层 activeFloor；会话绑 `layout.id`；室内回写 `applyLayout/assertLayoutWrite/shellVenuePatchFromPlanBoundary`。物料放置/选中/历史/会话/导出仍走壳体管线再镜像地图。
  - **L3 · 零引用原型遗留（可独立删，但牵连草稿导出）：** `isolated-room-organizer.tsx`（`IsolatedRoomOrganizer`/`captureIsolatedPageDrafts`）、`isolated-workspace-session.tsx`（`IsolatedWorkspaceSession`）——生产零挂载，仅各自测试引用；连带 `readonly-draft-registry`/`readonly-draft-bundle`/`local-draft-delivery` 需一并核引用。
  - **L4 · 业务事实字段（保留，不删）：** `venueIO`/`indoorOutdoor` 是 Agent 解析、recipe、投资人报告、地图场地判定字段（`agent-resolver.ts`/`recipe.ts`/`investor-report.ts`/`amap-venue.ts`/`blank-venue.ts` 等），不属工作台室内模式；评审只读页 `review-share-page` 的 `RoomLayout` 是其自身钉评审模型，保留。
- **拆除顺序建议：** 先 L1 活跃入口改走地图草稿通路 → 隔离会话/历史/物料/导出对 layout 的依赖 → L2 卸载保活容器与室内数据模型 → L3 删原型遗留封装 → L4 字段维持。每步守 tsc + 定向测试绿。
- **基线债聚类（#12）：** three/几何碰撞真债（shared-seating-placement footprint 45 vs 50、position undefined、SceneAdapterError；structure-v2/structure-satellite/blueprint/geometry）；Agent/面板夹具脱节（agent-panel 185、local-activities-panel 22、scene-layers-panel 9）；源码静态结构断言脱节（workbench-rail-head 左轨四形）。修债前须回退 HEAD 对照是否本轮回归。
- **tsc 类型债（2026-11-13 全量 `tsc --noEmit`，清 tsbuildinfo 后复现）：**
  - `outdoor-plan-canvas.tsx` 9 条 TS6133 未使用声明：`:505 ANNOTATE_COLOR_SWATCHES`、`:830 ANNOTATE_SHAPE_ICONS`、`:837 ANNOTATE_SHAPE_META`、`:1211 annotateColor/setAnnotateColor`、`:1212 annotateStrokeWidth/setAnnotateStrokeWidth`、`:1213 annotateMenuOpen/setAnnotateMenuOpen`。HEAD 基线无这三个新常量，属标注面板并行在制品半成品；实际草稿渲染走 `annotateColorRef`/`annotateStrokeWidthRef` 双轨。处置需该标注线确认：要么补回未接上的挂载，要么删死 state 与常量；不要在去室内化主线里擅自拆。
  - `cloud-panel.react.test.tsx` jest-dom 匹配器类型缺失（test-setup 未引 `@testing-library/jest-dom` 类型）：`:969 toBeChecked` 已改原生 `checkbox.checked` 断言；`:966/967` 已是 `getAttribute('aria-pressed')` 原生写法。

### 阶段 14l · blank 入口转地图草稿 + tsc 转绿复核 🟡 代码完成，未提交

- 基底：HEAD `9f2c811a`，沿用本地未提交在制品；本轮用户拍板：室内数据模型都是物料、墙体也是物料；「从空白开始」先转成地图空白选址草稿；`venueIO`/`indoorOutdoor` 业务字段由我判断——维持 D 层保留。
- **L1 blank 入口已改（picker 弹层通路）：**
  1. `panels/venue-picker.tsx`：props 去掉 `onBlankVenue`；import 去 `BLANK_VENUE`、加 `ensureDefaultOutdoorProject`；`confirm()` 重写——`project` 分支仍 `router.push('/editor/?project=<id>')`；非 ready（访客/云列表未就绪）落 `ensureDefaultOutdoorProject()` 本机默认草稿整页跳 `mode=outdoor`；ready 态 `blank` 用默认名 `NEW_PROJECT_DEFAULT`、`new/map` 用输入名，`map` 带选点锚点，统一 `createProject` → `saveOutdoorProjectRecord`（`createStarterOutdoorPlan`，零边界）→ 跳 `mode=outdoor`。blank 卡片 meta 由「12×8m · 立刻开工」改为「地图空白选址 · 进 2D 规划后再画边界」；头注改三入口统一地图口径。
  2. `panels/agent-panel.tsx`：`VenuePickerOverlay` 去掉 `onBlankVenue` 回调（`startBlankVenue` 不再被弹层调用）；头注/副文案改地图草稿口径。
  3. `panels/venue-picker.react.test.tsx`：批量移除 `onBlankVenue` prop；blank 登录态用例改写为断言 `createProject('studio-1','我的活动方案',…)` + 本机草稿 `p-new` boundary 空、push 未调；overlay 用例改写为走 `createProject` 通路、`onApply` 未被调；点击前 `findByRole` 等云列表 ready（否则落访客分支）。
- **校验：** Node24 清 `tsconfig.tsbuildinfo` 后全量 `tsc --noEmit` **exit 0**；14k 记录的 9 条 TS6133（标注面板 `ANNOTATE_*`/annotate state）本轮不复现，已被并行标注线接上或消除。定向测试：picker 11 + store 23 + shell 1 全绿（35）。
- **真机复核（dev 3210 `/editor`，2026-11-13，bu 探针 + 截图 `_shots/residual-check-20261113.png`）：**
  - 右侧为 2D 地图规划面：绿边界、紫分区、舞台/座椅图元、OSM 版权、2D/3D 胶囊、N 指北针、比例尺；左栏物料库 + 新会话正常。
  - `.sc-scene-viewport` display=block / visibility=hidden：室内容器仍保活在 DOM；console 两条 `Too many active WebGL contexts` 警告，旁证室内 three 场景上下文仍驻留（C 层卸载目标）。
  - 右轨出镜：楼层上下、select、measure、annotate、selection、walk、grid、undo、redo、zoom-out、zoom-in；`tool-preset`/`tool-dims` 不在列（符合定稿）。户外规划钮 `aria-pressed=true`，「再点取消」语义归 #24。
  - 瓦片：network 直连 `tile.openstreetmap.org` 多枚 `ERR_CONNECTION_TIMED_OUT`，底图停在「底图加载中…」兜底——#13 网络/代理另线，非去室内化回归。
- **L1 补充退役（本轮随后）：**
  - `agent-panel.tsx:3223` 简报卡「空白空间 · 12×8 m」立壳钮整段移除（`!known` 出镜的室内空白壳入口）；选址统一走「地图圈画」，空白草稿由 picker「从空白开始」承担。`startBlankVenue` 函数/接口/导出暂留（#27 连壳退役）；`SquareDashed` 在 :3402 仍用，导入保留。
  - `agent-panel.react.test.tsx`：两条按钮清单断言去掉空白钮（`['地图圈画']` / `['图纸与照片','地图圈画']`）；删除两条测已退役入口的用例（一键立 12×8 壳、有物料区域拒绝替换）。定向 `-t` 两条清单用例绿。
- **L3 原型封装删除（本轮）：** 生产零挂载、仅各自测试引用的 `isolated-room-organizer.tsx`（`IsolatedRoomOrganizer`/`captureIsolatedPageDrafts`）、`isolated-workspace-session.tsx`（`IsolatedWorkspaceSession`）及两个测试文件已删；全前端零残留 import。连带草稿模块（`readonly-draft-registry`/`-bundle`/`local-draft-delivery`/`readonly-draft-export`）被生产 `use-layout-persistence`/`creative-studio`/`scene-delivery-panel`/`delivery-private-text` 复用，**模块本体保留**。`isolatedWriteSession` prop 与 `isolatedRef` 写守卫 seam 生产恒空，留 #23 随壳体退役，本轮未动写守卫。
- **校验复核：** 两轮删增量缓存后全量 `tsc --noEmit` 均 exit 0；定向回归全绿——store 23 + picker 11 + shell 1 = 35；草稿交付/持久化/交付面板 196（local-draft-delivery、readonly-draft-export、use-layout-persistence 74、scene-delivery-panel 98）；未改面板 space-panel 3 + scene-presets 10 + agent-chat 12 = 25；agent-panel 简报清单 2。删 isolated 原型后被复用草稿模块无回归。
- **真机复核（dev 3210，2026-11-13）：** 硬刷新后 2D 地图规划面正常出图（绿边界/紫分区/舞台图元/OSM 版权/2D·3D 胶囊/N 指北针/比例尺）；本轮第二次刷新瓦片成功加载，#13 直连 OSM `ERR_CONNECTION_TIMED_OUT` 属偶发网络超时，非硬空屏。`.sc-scene-viewport` 仍 visibility=hidden 保活，console `Too many active WebGL contexts` 旁证室内 three 上下文仍驻留（#23 卸载目标）。简报「空白空间」钮在新会话态不出镜。
- **遗留边界：** 对话内 `startBlankVenue`（agent-panel:1863）函数体、`agent-chat.tsx:140/141` 加号菜单「新建空白空间/从模板开始」、`space-panel:99/160/275`、`scene-presets-panel:58/96/97` 仍 `createBlankVenue`/`createHardFinishHall`/`loadScenePreset` 立室内壳，深绑 layoutStore/onApply，归 #27（C 层隔离会话/历史/物料/导出后并入地图草稿）。B 层 `isOutdoorProject` 生产恒真，false 侧室内镜像回写待 C 层隔离后物理删。

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
