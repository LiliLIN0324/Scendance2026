# 室内壳体退役 × 地图能力迁建：详细规划（2026-11-13）

> 基底 HEAD `2cb342c2`（merge origin/main #110）。本文是对 `outdoor-map-unification-2026-11-13.md` 的退役路线细化：把「取消室内」和「建构地图」拆成可独立验收的切片，明确依赖顺序、关卡、验证与回滚。
> 口径：不分室内室外，唯一一套地图规划；墙体是实体物料；五颗钮（楼层 / 漫游 / 视角 / 尺寸 / 网格）在地图语境保留可用——视角预设钮已定稿删除，机位能力归导出成图链路，不回右轨圆钮。

## 1. 终局目标（完成定义）

1. 生产链路**不再挂载室内 Viewport / three 室内场景**：DOM 里只剩唯一地图画布（2D ↔ 3D 直切），无保活室内容器、无残留室内 WebGL 上下文。
2. **唯一正源是地图契约 `SitePlanData`**（`supabase/functions/_shared/site-plan.ts`）：物料、墙体、出入口、分区、动线、人员、测量、标注、会话、历史、导出全部消费这份 plan。
3. 会话绑定**项目 id**（`outdoorProjectId` / 本地草稿槽），不再绑室内 `layout.id`；undo/redo 基于地图 plan 快照；导出从 plan 出图。
4. 五颗钮在地图语境逐颗可用；墙体作为实体物料可放置、围合、墙内放物体。
5. 产品概念上无「室内 / 室外」二分；`venueIO` / `indoorOutdoor` 仅作为 Agent 提案的业务输入字段保留（D 层，不动）。
6. 合 main 门槛：全量 `tsc --noEmit` 0、定向 + 全量测试绿（基线债 #12 另清）、真机走查通过。

## 2. 参照的成熟迁移模式与本项目映射

| 成熟模式 | 做法 | 本项目映射 |
|---|---|---|
| **绞杀者模式 Strangler Fig** | 新旁路逐块接管旧系统能力，旧系统功能被一块块「绞杀」，全程不停机 | 地图 overlay/canvas 是新旁路；旧 `room-organizer` 壳体在旁保活，每接管一块就退役一块 |
| **防腐层 ACL** | 在旧模型与新契约之间加适配器，隔离两侧变化，不让旧概念漏进新侧 | 现有 `scene-objects bridge` / `seededPlanFromLayout` / `shellVenuePatchFromPlanBoundary` 即投影适配器；终局随壳体一并移除 |
| **垂直切片 Vertical Slice** | 按功能域走「建新 → 验一致 → 切流 → 拆旧」闭环，不做跨域大爆炸 | 按 会话 / 历史 / 物料 / 五钮 / 墙体 / 导出 逐个切片推进 |
| **双写影子镜像 Shadow / Dual-write** | 过渡期新旧双写并对比，验证一致后停镜像 | 过渡期 `plan ↔ layout` 镜像（`handleOutdoorPlanChange`）；新侧正源稳定后停掉 false 侧回写 |
| **正源切换 Single Source of Truth** | 先定新契约为正源，旧数据只读投影，再切读写 | `SitePlanData` 为正源；`layout` 退为只读过渡镜像，最终删除 |

**核心约束**：拆旧（R）必须等对应建新（M）在地图侧接住；不允许先拆旧再补能力。关键路径 `M3 → R2 → R3 → R4`。

## 3. 基线快照（2026-11-13 实读）

### 3.1 已完成（A 层与低风险退役）
- 分流二分下线；blank 入口转地图空白选址草稿；简报卡室内空白钮退役。
- isolated 原型（`isolated-room-organizer` / `isolated-workspace-session`）、写会话 seam（`workspace-write-session`）生产零引用已删；全前端无悬空 import。
- 合入 main `#110`：`OutdoorFacilityGenerate` 物料生成面板、`OutdoorTaskCard` 任务卡、event-logic/turn、route-proposal、place-search-options 等接线就位。
- 校验：tsc exit 0；定向 137 绿（地图纯函数 80 + 新组件/store 57）。

### 3.2 真机现状（dev 3210 `/editor`）
- 2D 地图规划面正常（边界 / 分区 / 图元 / 指北针 / 比例尺 / 2D·3D 胶囊）。
- `.sc-scene-viewport` display=block / visibility=hidden 保活；6 个 canvas（室内 three 上下文驻留）。
- 右轨在位：楼层上下、select、measure、annotate、selection、walk、grid、undo、redo、zoom-out/in；`tool-preset` / `tool-dims` 不在列（符合定稿）。

### 3.3 残留耦合点（代码符号定位，行号随合并可能微移）
- **壳体入口**：`room-organizer.tsx`（5000+ 行），`useLayoutState()` 取室内 `RoomLayout`；`layoutStore`（`hooks/use-layout-store.ts`）。
- **会话绑定**：`sessionScope = activity:${layout.id}`（:320）；`useActivitySessionTracker` / `useFloorSessionTracker` / `useVenueFactTracker` 均订阅 layoutStore；助理会话订阅（:365）、brief memory（:374）按 scope+epoch 匹配。
- **历史**：`useHistory(layout, …)`（:1599）快照 `RoomLayout`；`applyVenueHistorySnapshot` 回写 layoutStore；`commitHistoryNow` 散布物料增删 / 选中 / 分组 / 墙操作。
- **物料放置**：`placeDiscrete` / `suggestDropPoint`（`lib/drop-zone.ts`）落点走 `activeFloor.items` / `keepOut` / 室内墙碰撞。
- **回写镜像**：`handleOutdoorPlanChange`（:1689）——`isOutdoorProject` 真侧只镜像 3D 地面；false 侧把边界 patch 回 layout（`shellVenuePatchFromPlanBoundary`）。
- **写守卫**：`workspaceWriteGuards.assertLayoutWrite`；环境位置 / 场地核对前置。
- **室内数据模型**：`schema.ts`（RoomLayout / floors / interiorWalls / items）、`layout-reducer.ts`、`three/interior-walls.ts`、`three/wall-openings.ts`、`lib/walk-collision.ts`、`lib/opening-snap.ts`、`lib/wall-snap.ts`、`structural-layout.ts`、`use-npcs.ts`、`use-walkthrough.ts`、`use-item-placement.ts`、`use-item-drag.ts`。
- **立壳入口（#27）**：`startBlankVenue`（agent-panel:1863）、`agent-chat.tsx:140/141` 加号菜单、`space-panel.tsx`、`scene-presets-panel.tsx`、`lib/blank-venue.ts`、`lib/workspace-api.ts`（`BLANK_VENUE_SIZE` / `emptyProjectScene`）。

### 3.4 保留不动（D 层业务事实）
- `agent-proposal.ts` `indoorOutdoor` 枚举、`assistant-brief-memory.ts` `venueIO`、`amap-venue.ts` 判定、`recipe.ts` / `investor-report.ts` 等提案消费字段——是 Agent 对场地类型的业务输入，不是产品壳体概念，退役时保留。

## 4. 切片路线图

> 状态标记：⬜ 未开始 / 🟡 代码进行 / ✅ 完成。每个切片走完「建 → 验 → 切 → 卸」再进下一个；切片内小步提交，每步 tsc + 定向测试保绿。

### M 线 · 迁建（地图侧把能力接住）

#### M1 五钮地图化 ✅ 代码完成（本地未提交，真机 2D/3D 已走查）
- **目的**：楼层 / 漫游 / 网格 / 测量 / 标注回调从 layoutStore 改派到地图 canvas / 3D 句柄；属性选择桥接收尾。
- **落地（实读户外能力后定）**：
  1. 楼层钮：户外态**隐藏**。户外 `levels` 是独立方案层（非室内楼层高度），切换走画布自身左栏图层面板 + `onActiveLevelChange` 既有桥接；右轨室内 `activeFloorIndex` 楼层钮不再露出。
  2. 漫游钮：户外态**禁用**并提示「户外地图为环绕视角，暂不支持第一人称漫游」；不触发室内 walkthrough/pointer lock。户外 3D 是环绕轨道，无第一人称句柄。
  3. 网格吸附钮：户外态**禁用**并提示「放置时自动按网格吸附」；画布放置由 `snapPointToGrid` 纯函数自动吸附，无独立吸附开关可挂。
  4. 测量 / 标注 / 属性（selection）：既有 `setInspector` 三卡桥在 2D/3D 两态可达，按下态走 `outdoorInspector.openTabs`，核对通过。
- **未接住的钮**：置灰/隐藏并保留提示，不回退室内壳；室内兜底分支原样保留供纯室内场景。
- **验证**：tsc 0；真机 2D/3D 复核——楼层钮不出镜、漫游/网格禁用带提示、测量/标注/属性可点、底图出图、console 空。
- **遗留**：户外第一人称漫游、独立网格吸附开关属后续地图能力，本批不虚构承接。

#### M2 物料与墙体落地 ⬜
- **目的**：物料放置 / 选中 / 归入地图 facility 体系；墙体作为实体物料入契约并渲染、参与围合与碰撞。
- **物料侧**：现有 `facilities`（position / rotationDeg / size / zoneId / templateId）已是地图物料实例；放置落点从 `activeFloor.items` 迁到 plan facilities 增删；选中态走地图选中。
- **墙体侧（方案 B，用户拍板实体）**：
  - 几何：点列折线（可不闭合）+ 厚度 + 高度 + 可选门位；`zoneId` 归属分区；墙两侧可放物体；参与碰撞 / 遮挡。
  - **待决子项**：墙体是契约新增独立 `walls` 集合，还是 `facilities` 的一种模板类别（矩形 vs 折线几何）——落地前对照物料模板体系（`oneplan-catalog` / `plan-facility-models`）定。
  - 与出入口协同：墙链在 `nodes` 坐标处留开口，不封堵节点；旧 `structuralOpeningId` / `venueEntranceId` 映射到 `nodes`，不留在墙体数据。
- **前置**：M1 选中 / 放置桥接稳定；M3 物料历史可落 plan。
- **验证**：墙放置 / 拖动 / 开门 / 围合内放物 / 碰撞提示的纯函数测试；2D 渲染 + 3D 投影对照；导出 GeoJSON/CSV/PDF/PNG 含墙体。
- **回滚**：墙体作为独立物料类别挂在物料库后置开关，未接住前旧室内墙 draft 不出现在地图语境。

#### M3 会话 / 历史 / 导出解耦（关键路径）⬜
- **目的**：把最深的三处对 layout 的依赖从壳体剥到地图 plan / projectId，为 R2/R3 拆壳铺路。
- **3a 会话**：scope 键从 `activity:${layout.id}` 改为 `project:${outdoorProjectId ?? LOCAL_DRAFT_SLOT}`；三个 tracker（活动 / 楼层 / 场地事实）订阅源从 layoutStore 换到 plan / project 状态；助理会话、brief memory 的 scope+epoch 匹配口径同步改。
- **3b 历史**：`useHistory` 快照对象从 `RoomLayout` 换成 `SitePlanData` 快照；apply 回写 plan（经 overlay/commitPlan 通路），不再 `actions.applyLayout`；物料增删 / 选中 / 墙操作的 `commitHistoryNow` 改挂 plan 历史。
- **3c 导出 / 写守卫**：导出消费 plan（已有 CSV/GeoJSON/PNG/PDF 链路）；写守卫断言从 `assertLayoutWrite` 换成 plan 写权限；环境 / 场地核对前置改为地图语境。
- **3d 回写镜像退役**：`handleOutdoorPlanChange` 的 false 侧 layout patch（`shellVenuePatchFromPlanBoundary`）在真侧正源稳定后删除；`applyOutdoorGroundBasemap` 对 layout 的 `floorPlanImage`/`sceneAnchor` 写入改挂 plan / 视图记忆。
- **前置**：无（最先做，是 R 线闸门）。
- **验证**：会话切换 / 历史撤销重做 / 导出三套定向测试；切项目不串会话；历史回滚只动 plan。
- **回滚**：解耦期间保留 layoutStore 影子双写；任一环节地图侧异常，回退读 layout 投影。

#### M4 出入口工具收尾 ✅ 代码完成（本地未提交，目录三型点击走查并入 #25）
- **目的**：补齐已盘点的两个小缺口。
- 1. 创建节点前置选类型（入口 / 出口 / 两用），工具箱直选（对齐动线三类分列），不再放下后改属性卡。✅ 目录三型 `NODE_KIND_OPTIONS` 分列，`nodeKind` state + `nodeKindRef` 双写。
- 2. 节点归属分区：落点 `inferNodeZoneId`（复用 `inferWorkerZoneId` 口径），可显式覆盖。✅ 契约 `PlanNode.zoneId` 可选 + 存在性校验；纯函数 `buildNode`；`placeNodeAt` 自动归属，属性卡下拉显式覆盖。
- **前置**：无。
- **验证**：`site-plan-routes.test` 12 绿（buildNode/inferNodeZoneId 归属/越界/坏分区/越界坐标/空名）；`tests/site-plan.test` 16 绿（节点悬空 zoneId 拒绝）；tsc 0。

#### M5 智能体工具桥接扩充 ✅ 桥方法面完成（本地未提交；提案生成/确认卡链属后续研究层）
- **目的**：把画布已有、但尚未暴露给智能体的写能力，逐条补成 canvas `handle` + `routeBridge` 工具方法，供后续 Agent 研究调用。沿用既有范式：**预览态不进 plan → 确认后 `commitPlan` 写入、可撤销**；每个工具带纯函数校验与问题提示。
- **已接给 agent（九方法保持原样未动）**：选址边界 `applyVenue`、地点预览 `previewVenuePoint`、动线+节点 `applyRoutes`、分区+物料提案 `applyZoneProposal`、物料巡检 `inspectFacility`、读 plan `getPlan`。
- **本批新增桥方法（canvas handle → overlay 转发 → bridge 类型两处 → AgentValue 工具表入口，四层同形）**：
  - `applyWorkers(workers)`：handle 内逐条 `buildWorker` 校验（岗位/人数/范围/归属分区），合法才合并，全非法/空回 false。
  - `applyMeasurements(measurements)`：逐条 `buildMeasurement` 几何校验；`applyAnnotations(annotations)`：逐条 `buildAnnotation` 几何校验。
  - `getLevels()` / `setActiveLevel(levelId)`：读楼层方案列表、切层（不存在回 false），复用 `switchLevel`。
  - `addFacility(facility)` / `removeFacility(id)` / `updateFacility(id, patch)`：单条物料增/删/改，复用 `deleteFacility`/`updateFacility`，id 不存在回 false。
- **原则守住**：只新增桥方法，未改既有九方法签名、未改 `SitePlanData` 既有字段；入参复用契约 `PlanWorker/PlanMeasurement/PlanAnnotation/PlanLevel/PlanFacility` 类型。
- **遗留（后续切片）**：对话内各实体的提案生成 + 预览确认卡链（参照 route/zone 的 `propose*Plan`/confirm/dismiss）、墙体工具随 M2 落地后接入。
- **验证**：tsc 0；`site-plan-routes` 12 绿、契约 `tests/site-plan` 16 绿、底图定向 77 绿；agent-panel 组件测试基线 40 失败为 #12 既有债，stash 对照未新增回归。
- **前置**：无（与 M1 / M4 并行）；墙体部分随 M2。

#### 残留死代码清除 ✅ 本地完成（对抗性计数通过，未提交）
- **背景**：用户质疑编辑器内存在两套地图 tsx / 两处图层。静态代码 + 真机 DOM 双重核查结论：编辑器内 2D 画布 `outdoor-plan-canvas`（经 overlay 挂一次）、3D 场地 `outdoor-plan-3d`（壳体接管层挂一次）；图层行 `outdoor-levels-row` 只渲染一份，左栏/右栏面板是同一画布的不同 portal 落点。
- **本轮已清（受控编辑器态不可达的旧自治 3D / 视图记忆链）**：
  1. `outdoor-plan-overlay.tsx` 删除内部旧 `OutdoorPlan3D` 挂载分支、`plan3dApiRef`、`mapView/captureMapView`、切 3D 拍视口 effect、缩放/选址聚焦的 3D 旁路；3D 唯一由壳体全屏接管实例负责。
  2. 退役旧自治视图状态：壳体 `outdoorView` / `setCanvasView` 动作 / `readOutdoorPlanView` 持久化读回；overlay `view` prop、uncontrolled 视图态；`scendance-workspace` 动作接口里的 `view?/setCanvasView?` 声明。
  3. `outdoor-project-store.ts` 删除已无生产调用的 `readOutdoorPlanView` / `saveOutdoorPlanView` / `outdoorPlanViewStorageKey` / `OutdoorPlanView` 类型及对应单测。
- **保留待 R2（依赖 M3，不可本轮硬删）**：壳体 `.sc-scene-viewport` 室内保活容器与 three/2D 上下文、室内 layout 回写镜像链——renderer/canvas ref 仍被环境、漫游、就绪态逻辑复用，随 R2/R3/R4 卸载。
- **对抗性验收**：tsc `--noEmit` exit 0；前端定向 148 绿（store 21 / routes 12 / measure 15 / annotate 20 / 底图与画布 80）+ 根契约 16 绿；agent-panel react 40 failed / 378 passed / 1 skipped，与 #12 基线一致，无新增回归。真机 2D/3D：户外活跃 3D 仅 1 个、overlay 接管态隐藏、图层行 1 份；室内保活 webgl 祖先链 `visibility:hidden` 不出镜；console 0 报错；2D/3D 高德底图均出图。
- **验证**：每个新工具补 agent 调用定向测试（预览 → 确认 → 撤销 / 回滚）；`getPlan()` 快照比对基线不破。

### R 线 · 退役（室内壳体卸载，依赖对应 M 完成）

#### R1 立壳入口并入地图草稿 ⬜（依赖 M3a 草稿通路）
- 退役：`startBlankVenue` 函数体与接口、`agent-chat` 加号菜单「新建空白空间 / 从模板开始」、`space-panel` 整轨、`scene-presets-panel` 模板轨；`blank-venue.ts` / `createHardFinishHall` / `emptyProjectScene` / `BLANK_VENUE_SIZE` 清空或删除。
- 去向：统一走 picker「从空白开始」→ 地图空白选址草稿；模板提案改由地图 zone/facility 模板承接。
- **验证**：无立壳钮出镜；新建项目落 `createStarterOutdoorPlan` 零边界草稿。

#### R2 卸保活 Viewport 与室内 three/2D 链路 ⬜（依赖 M1 + M3b/3c）
- 删除 `room-organizer.tsx:4635` `.sc-scene-viewport` 保活容器与 `Viewport` 挂载；停掉室内 three renderer / scene / camera 上下文与 2D `render.ts` / `use-canvas-2d-interaction` / `use-scene-effects` 在编辑态的驻留。
- 确认右轨缩放 / 导出 / 漫游句柄全部改派 `outdoorPlan3DRef` / `canvasApiRef` 后再断室内 ref。
- **验证**：DOM 无 `.sc-scene-viewport`；canvas 数降到地图所需；无 `Too many active WebGL contexts`；2D/3D 直切正常。

#### R3 删 layoutStore 与 interiorWalls 数据模型 ⬜（依赖 M2 + R2）
- 删 `schema.ts` 室内 RoomLayout/floors/items/interiorWalls、`layout-reducer` 室内分支、`use-layout-store`、室内墙渲染 / 开门 / 碰撞 / 吸附（`interior-walls` / `wall-openings` / `walk-collision` / `opening-snap` / `wall-snap` / `structural-layout`）、`use-npcs` / `use-walkthrough` 室内段。
- 残留引用清扫：安置 / 预览 / 导出 / Agent 提案 / 分享页里读室内墙与楼层的分支逐一改 plan 或删。
- **验证**：tsc 无未用符号（`noUnusedLocals`）；全量测试绿；物料 / 墙体 / 分区在地图闭环。

#### R4 二分概念与回写链路物理删除 ⬜（依赖 R3）
- 删 `isOutdoorProject` 恒真分支、`outdoorPlanState` 的 layout.id 匹配回退、false 侧室内镜像回写、`seededPlanFromLayout` 投影适配器。
- 代码检索：生产链路无 `indoor` 壳体分支、无 `layout` 残留引用（D 层业务字段除外）。
- **验证**：对抗性 grep 无室内壳体概念；全量 tsc / 测试 / 真机走查。

## 5. 依赖关系与关键路径

```
M3 会话/历史/导出解耦 ──┬─→ R1 立壳入口退役
                        ├─→ R2 卸保活 Viewport/three ─→ R3 删 layoutStore/墙模型 ─→ R4 删二分与回写
M1 五钮地图化 ──────────┘            ↑
M2 物料/墙体落地 ─────────────────────┘
M4 出入口收尾（独立，可任意时点）
M5 智能体工具桥接扩充（独立，不依赖 R 线）
```

- **关键路径**：`M3 → R2 → R3 → R4`。M3 不完成，R2/R3 不能动（历史 / 会话 / 导出还读 layout，断壳即炸链）。
- 可并行：M1、M2、M4 与 M3 并行小步推进；R1 在 M3a 草稿通路通了即可先行。

## 6. 关卡与验证节奏

每个切片提交前：
1. Node24 清 `tsconfig.tsbuildinfo` → 全量 `tsc --noEmit` exit 0。
2. 定向 vitest 跑该切片相关文件；不引入新的全量失败（对照基线 #12：33 文件 / 284 用例失败为既有债）。
3. dev 3210 真机探针：DOM 结构、右轨钮清单、canvas 数、地图图层、console 无新报错。
4. 不攒跨切片大改；每片独立可回滚。

**合 main 总关卡（#25）**：全量 tsc 0；全量测试通过（或基线债单列已知）；真机走查 新建 → 选址 → 物料 → 墙体 → 出入口 → 动线 → 五钮 → 会话切换 → 撤销重做 → 导出 全链路；无室内容器 / 上下文残留；再一次性合 main（不为小改动开 PR）。

## 7. 风险登记册

| 风险 | 触发条件 | 缓解 |
|---|---|---|
| 断壳炸链 | R2/R3 早于 M3，历史 / 会话 / 导出仍读 layout | 死守依赖顺序；M3 完成并测试通过才进 R2 |
| 双写不一致 | 过渡期 plan ↔ layout 镜像字段漂移 | 影子双写期间以 plan 为准；回写只做投影，比对校验 |
| 物料归属丢失 | 室内 items/墙迁 plan 时 zoneId/尺寸/旋转错位 | M2 纯函数迁移单 + 对照快照测试；footprint 锁（`facility-footprint-lock`）复用 |
| 五钮地图语境不可用 | 地图缺对应能力时硬切，钮失效 | M1 逐颗接，未接住的钮置灰并保留提示，不回退室内壳 |
| 基线债混淆 | #12 既有失败被当成新回归 | 每片对照基线失败清单；只堵新增回归 |
| 瓦片/网络 | #13 OSM 偶发超时 | 另线排查，不计入去室内化验收 |

## 7.5 合 main 给智能体线（#110 V1–V5）的交接边界

丽丽正在做的智能体链路跑在户外地图语境，退役重构不能打断她。先冻结她依赖的**稳定面**，再按梯度合入。

### 7.5.1 智能体依赖的稳定面（合 main 不得破坏）
- **routeBridge 桥接签名**（`agent-panel.tsx` `registerRouteBridge`）：`applyVenue` / `beginVenueBoundary` / `inspectFacility` / `cancelVenueBoundary` / `previewVenuePoint` / `clearVenuePreview` / `applyRoutes` / `applyZoneProposal` / `getPlan` 九方法，入参出参类型不变。
- **`SitePlanData` 契约结构**：anchor / boundary / zones / facilities / routes / nodes / workers；提案解析（`parseOutdoorEventTurn`）、facilities 名匹配、`getPlan()` 快照比对都读这份结构。
- **`OutdoorTaskProgress` 结构**：`outdoorTask` 的 intent / state / action / steps / focusFacilityId，`OutdoorTaskCard` 据此渲染。
- **物料生成链路**：`OutdoorFacilityGenerate` 入参 target / projectId / controller / onClose。
- **会话与记忆**：`sessionScope` + brief memory + event intent（当前绑 `layout.id`，归 M3a 改造）。

### 7.5.2 合入梯度
| 梯度 | 切片 | 能否此时合 main | 原因 |
|---|---|---|---|
| **G0 基线（已达成）** | merge `2cb342c2`（#110 + 我方 A 层退役） | ✅ 已是基线 | tsc 0、定向 137 绿；分流下线 / blank 草稿 / isolated 删除均不碰桥接面 |
| **G1 并行可合** | M1 五钮地图化、M4 出入口收尾、M5 智能体工具桥接扩充 | ✅ 可小步合 | 只动画布内部交互与地图工具、新增桥接方法；不改既有契约字段、不改既有 bridge 签名、不换会话 scope |
| **G2 待她 flow 稳定后合** | M3a 会话 scope 改 projectId、M3b 历史快照换 plan、M2 墙体写新契约字段 | ⚠️ 分支隔离，暂缓合 main | 会动会话连续性、快照比对基线、提案解析字段；需她这轮 V1–V5 确认不依赖旧绑定 |
| **G3 智能体全迁地图桥后合** | R1–R4 壳体退役；provider `onApply(RoomLayout)` 签名改造 | ⛔ 最后合 | 她若仍走旧壳体 apply / 预览，先断壳会炸智能体；等提案全部经 routeBridge 落地后再卸 |

### 7.5.3 G1 合 main 前给丽丽的验收清单
1. routeBridge 九方法签名、`SitePlanData`、`OutdoorTaskProgress` 类型零变更（`tsc` 守住）。
2. 她相关测试保持绿：`outdoor-event-logic` / `outdoor-event-turn` / `route-proposal` / `outdoor-facility-generate` / `outdoor-task-card` / `place-search-options` / `site-plan-*`。
3. 真机走通：选址确认 → 流线提案 applyRoutes → 区域提案 applyZoneProposal → 子出入口 → 设施巡检 inspectFacility → 生成/上传物料，全程可撤销、不崩。
4. 全量 `tsc --noEmit` 0；无新增全量测试回归（基线债 #12 单列）。

## 8. 未决决策

1. **墙体归属**：独立 `walls` 集合 vs `facilities` 物料类别——M2 动工前对照物料模板体系定；倾向先按独立折线实体建模，再评估是否归并 facility 模板。
2. **旧云项目兼容**：`/editor/?project=<id>` 无 mode 读取旧室内 schema 的迁移 / 降级策略（只读提示或一次性投影到 plan）。
3. **右轨尺寸 / 视角口径**：dims 归账户偏好 `showMeasurements`；preset 机位归导出成图链路——维持 14k 定稿，若用户再要求回圆钮需重评。

## 9. 附录 · 关键索引

- 契约：`supabase/functions/_shared/site-plan.ts`（boundary / levels / zones / facilities / routes / nodes / workers / measurements / annotations）。
- 纯函数：`lib/site-plan-routes.ts`（动线 / 节点 / 人员）、`lib/site-plan-editing.ts`（几何与问题）、`lib/site-plan-facilities.ts`。
- 画布：`components/outdoor-plan-canvas.tsx`（工具 / 放置 / 吸附 / 选中 / 导出消费）；覆盖层 `components/outdoor-plan-overlay.tsx`（句柄 / 草稿载入 / 保存 / 生成面板桥）。
- 壳体：`room-organizer.tsx`；store `hooks/use-layout-store.ts`；历史 `hooks/use-history.ts`；放置 `lib/drop-zone.ts`。
- 存储：`lib/outdoor-project-store.ts`（projectId 解析 / 草稿读写 / 默认锚点 / 视图记忆）。
