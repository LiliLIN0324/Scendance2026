# 去室内化后续执行计划（成文锚点 main @ `8446b33f`，2026-11-17）

> 用途：分派给执行 agent 的可落地切片计划。依据 `outdoor-map-decommission-2026-11-13.md` 退役框架与 `2026-11-17-g1-closure-status.md` 收口现状。
> 锚点：成文时 main `8446b33f`；代码现状以开工时 `origin/main` 为准，文中行号/路径仅作参考。
> 本计划只排切片、前置、验收门禁与禁止事项；§C 六项口径**待用户拍板**，执行 agent 不得替定。

## 0. 所有执行 agent 必读纪律

### 0.1 依赖顺序（硬性）
- 绞杀者模式：**先建新（M）在地图侧接住，再拆旧（R）**；不允许先拆旧再补能力。
- 关键路径：`M3 → R2 → R3 → R4`。M3 不解耦，R2/R3 不得动。
- 每个切片走完「建 → 验一致 → 切流 → 卸」再进下一个；不攒跨切片大改。

### 0.2 冻结面（G1 稳定面，动 M3 前不得改）
- routeBridge 九方法签名、`SitePlanData` 既有字段、`OutdoorTaskProgress` 结构、物料生成链路入参不变。
- 可新增桥接方法、可新增可选契约集合；不改既有字段与签名。
- 不碰并行在途文件（people/漫游线、`scendance-workspace` 系列），不回灌、不 revert。

### 0.3 环境与门禁
- Node 版本档固定：台账锚定 v26.2.0；engines `>=24.15 <25 || >=26`。**Node22 禁跑全量/build**；24 与 26 不混跑（失败集会漂移）。
- 每切片提交前：`tsc --noEmit` exit 0；定向 vitest 跑相关文件；`npm run build` exit 0。
- 全量对照基线台账 `docs/quality/vitest-baseline-63b11ae1.md/.csv`：台账外新失败文件、或台账内 failed 数上涨，先单独 `npx vitest run <file>` 复跑，仍失败才算回归。旧台账 `vitest-baseline-0a59f7b0.*` 保留为历史债务快照，**不再用于对照**。
- 不引入新红；既有 jsdom/localStorage 债与计时 flaky 归 #12，不计入本切片回归。

### 0.4 提交纪律
- 本地攒好 tsc + 定向测试 +（涉及交互的）真机验收后，**按 `AGENTS.md §六` 开 PR 到 main**，由人评审合并；不直推 main，不为小改动拆多个 PR。
- 提交前 `git diff --cached --name-only` 与 `git show --stat HEAD` 双核对；不夹带他人在途文件。
- 不主动 push main；不触发付费生成。
- 文档先行：代码切片对应的口径/现状先写进 `docs/plans/`，再落码。

## 1. 路线总览（关卡与依赖）

```
关卡 A §C 决策（人拍板）
   │  C1/C4 先定；C5 解 3c 守卫；C3/C2/C6 影响面小
   ▼
关卡 B G2 壳体解耦  B1 3a 残留 → B2 3b 历史 → B3 3c 导出/守卫 → B4 3d 镜像退役
   │  前置：#79 V1–V5 真机 flow 稳定；B3 依赖 C5
   ▼
关卡 C 渲染线接墙体  C1 画布消费 plan.walls → C2 PNG/PDF 图面墙线（随快照带出）
   ▼
关卡 D plan 级导出器（新功能，渲染线后可独立排期）
   D1 plan 级 DXF · D2 plan 级 SVG

关卡 E R 线退役（严格依赖顺序）
   E1 R1 立壳入口（依赖 B1 草稿通路）
   E2 R2 卸保活 Viewport/three（依赖 B2/B3）
   E3 R3 删 layoutStore/墙模型（依赖 M2 + E2）
   E4 R4 删二分概念与回写（依赖 E3）

关卡 F 并行支线（不阻塞退役主线）
   F1 走廊判据改占带相交 · F2 OFM 证据线（#80）

关卡 G 基线债与工程卫生（验收后一次清）
```

## 2. 关卡 A：§C 决策准备（待拍板，agent 只读准备）

> 现状与推荐口径见 `g1-closure-status.md §8`。拍板前**不得**：改 `planFacilitySchema`/`sourceAssetId`/`modelOverride` 约束；在纯函数层加载 manifest；把 3D 特化字段写进 notes；新建 plan 租约；动 lawn/market 与室内预设清单。

| 项 | 决策点 | 推荐（待拍板） | 拍板后解锁 |
| --- | --- | --- | --- |
| C1 | assetId ↔ 物料库 slug 命名空间 | A 严格分离：assetId 只存后端 id，`modelOverride` 只存 slug；迁移不硬猜；G2 再收紧 `sourceAssetId` | 3D 选型按 slug 稳定回查；facility 壳体注入点收口 |
| C4 | 旧云项目 `/editor/?project=<id>` 投影策略 | A 只读旧室内视图 + 显式「复制为 plan 草稿」，不自动改写原项目 | 定 R3 是否保留迁移降级通路 |
| C5 | plan lease 语义 | A 复用本地 capability + 后端项目级 lease；plan 落盘加 revision 检查；多人编辑专用租约后议 | B3 写守卫可 plan 化 |
| C3 | 室内特化字段（WiFi/CCTV/锥角/elevation/structural 引用/price/handoff） | A 留 3D/RoomLayout，不迁 plan、不塞 notes；契约不膨胀 | 迁移器如实标记 lossy |
| C2 | manifest 加载链路 | A 壳体启动静态加载一次并注入 entries；纯函数继续只吃注入条目 | 迁移拿真实占地尺寸，纯函数仍可测 |
| C6 | lawn/market 户外旧预设 | A 保留为户外样例，按 `scene-preset:` 前缀落 plan；不新增预设 schema | 无 G1 代码动作；室内 8 预设随 E3 整组卸 |

**建议拍板顺序**：C1 → C4 → C5 → C3 → C2 → C6。C1、C4 先定即可继续。

## 3. 关卡 B：G2 壳体解耦（前置：#79 flow 稳定；B3 依赖 C5）

### B1 · 3a 会话 scope 残留收尾（task #48）
- **前置核对**：#128（`8446b33f..956afdc7`）已改 `room-organizer.tsx` / `creative-studio.tsx` / `space-panel.tsx` / `scendance-workspace.tsx` / `workspace-shell.tsx`；开工前先重对 scope 拼接点、空间面板与 tracker 注入点，行号以届时 `origin/main` 为准。
- **范围**：主 `sessionScope` 去掉 `layout.id` 回退，纯走 `projectSessionScope(projectId)`；`activityScopeSource` 已注入 project 源，核对全链路；floor/venue tracker 订阅源从 layoutStore 重绑到 plan.levels / 边界几何。
- **遗留 `activity:` 键按域归位**：`creative-studio.tsx` 内部 chatScope、`bingo-audit-card.tsx` scopeKey、`venue-facts-panel.tsx`/`space-panel.tsx` venueFactScope、`floor-session-epoch.ts` scope、`scene-delivery-panel.tsx` note scope、环境偏好键分桶、评审链接 identity scope。
- **成套边界**：activity tracker scope 源、壳体 scope 拼接、agent-panel 比对须同批改，不可拆两半（否则 `isCurrent` 与 scope 比对失败，提案/导出/拖拽全灭）。
- **验收**：切项目不串会话；会话切换定向测试（activity/project/floor/venue/assistant-active）绿；旧草稿会话不回读属 G2 可接受。
- **回滚**：layoutStore 影子双写保留；地图侧异常可回退读 layout 投影。

### B2 · 3b 历史快照换 plan（task #49）
- **范围**：壳体 `useHistory(layout, actions.applyLayout)`（约 `room-organizer.tsx:1701`，参考值）快照对象从 RoomLayout 换 `SitePlanData`；`commitHistoryNow` 散布的物料增删/选中/墙操作改挂 plan 历史；apply 回写 plan（经 overlay/commitPlan 通路），不再 `actions.applyLayout`。
- **复用地基**：`lib/plan-history.ts`（栈/上限 30/规范化序列化去重，不含 React/时钟/存储）；`useHistory` 已是泛型 `<T>`，换类型只在调用点。
- **验收**：撤销/重做定向测试；历史回滚只动 plan；可 Undo/Redo 状态上报不回归。

### B3 · 3c 导出与写守卫 plan 化（task #50，依赖 C5）
- **范围**：导出三套（CSV/GeoJSON/PNG/PDF）全量消费 plan；写守卫 `assertLayoutWrite` 换成 plan 写权限（复用 C5 定的 capability + 项目级 lease）；环境/场地核对前置改为地图语境。
- **已就位**：plan-export download/dxf/print/svg/visibility/geometry；GeoJSON 测量/标注、CSV 测量备注、图例墙体组已接。
- **验收**：导出定向测试；plan 写守卫拦截非法写；导出内容与 plan 快照一致。

### B4 · 3d 回写镜像退役（task #51）
- **范围**：删 `handleOutdoorPlanChange` false 侧 layout patch（`shellVenuePatchFromPlanBoundary`）；`applyOutdoorGroundBasemap` 对 layout 的 `floorPlanImage`/`sceneAnchor` 写入改挂 plan/视图记忆。
- **前置**：真侧 plan 正源稳定、B1–B3 验收通过。
- **验收**：plan↔layout 镜像字段无漂移；环境/基线图写入落 plan 侧；无残留回写分支。

## 4. 关卡 C：渲染线接墙体（前置：B 线 M2 壳体接线）

### C1 · 画布消费 `plan.walls`
- **范围**：2D 画布渲染墙线段（复用 `PLANNING_WALL_KIND_COLORS`/`PLANNING_WALL_COLOR`、`brick-wall` 图标，与图例同源「图例即所见」）；墙体放置/拖动/选中交互；墙链在 `nodes` 坐标处留开口，不封堵节点。
- **契约已就位**：`walls` 集合（points[2]/thicknessM/heightM/kind/status/color/zoneId/levelId，上限 500）；迁移执行器已并入总入口。
- **验收**：墙放置/拖动/开门/围合内放物的纯函数测试；2D 渲染 + 3D 投影对照；console 无新报错。

### C2 · PNG/PDF 图纸墙线
- **范围**：随 2D 画布快照带出，不单独出图链路；`composePlanPng`/`buildDeckPages` 已共用 `buildPlanLegend` 图例，图面墙线随 C1 就位后自然生效。
- **验收**：PNG/PDF 图纸可见墙线段；图例段数/总长与图面一致。

## 5. 关卡 D：plan 级导出器（新功能，渲染线后可独立排期）

### D1 · plan 级 DXF
- **现状**：`plan-export/dxf.ts` 的 `layoutToDxf(layout, floor)` 是室内 layout 级，画 `floor.interiorWalls`；无 plan 级导出。
- **范围**：新建 plan 级 DXF 导出器，消费 plan.walls/facilities/routes/nodes/zone 多边形；对齐现有图层/线型口径。
### D2 · plan 级 SVG
- **现状**：`layoutToSvg(layout, floor)` 同属室内 layout 级。
- **范围**：新建 plan 级 SVG sheet，消费 plan 实体；复用 `planSheetSize`/`planBounds` 几何口径。
- **验收**：导出定向测试；plan 实体与图面一致；旧 layout 级导出器在 E3 退役前保留。

## 6. 关卡 E：R 线退役（严格依赖顺序，不可提前）

### E1 · R1 立壳入口并入地图草稿（task #27，依赖 B1 草稿通路）
- **退役**：`startBlankVenue` 函数体与接口、agent-chat 加号菜单「新建空白空间/从模板开始」、`space-panel`、`scene-presets-panel`；`blank-venue.ts`/`createHardFinishHall`/`emptyProjectScene`/`BLANK_VENUE_SIZE` 清空或删。
- **去向**：统一 picker「从空白开始」→ 地图空白选址草稿；模板提案由 zone/facility 模板承接。
- **验收**：无立壳钮出镜；新建项目落 `createStarterOutdoorPlan` 零边界草稿。

### E2 · R2 卸保活 Viewport 与室内 three/2D（task #23，依赖 B2/B3）
- **删除**：`.sc-scene-viewport` 保活容器与 Viewport 挂载；室内 three renderer/scene/camera 上下文、2D `render.ts`、`use-canvas-2d-interaction`、`use-scene-effects` 编辑态驻留。
- **前置核对**：右轨缩放/导出/漫游句柄全部改派 `outdoorPlan3DRef`/`canvasApiRef` 后再断室内 ref。
- **验收**：DOM 无 `.sc-scene-viewport`；canvas 数降到地图所需；无 WebGL 上下文泄漏；2D/3D 直切正常。

### E3 · R3 删 layoutStore 与室内墙模型（task #32，依赖 M2 + E2）
- **删除**：`schema.ts` 室内 RoomLayout/floors/items/interiorWalls、`layout-reducer` 室内分支、`use-layout-store`、室内墙渲染/开门/碰撞/吸附（`interior-walls`/`wall-openings`/`walk-collision`/`opening-snap`/`wall-snap`/`structural-layout`）、`use-npcs`/`use-walkthrough` 室内段。
- **残留清扫**：安置/预览/导出/Agent 提案/分享页读室内墙与楼层的分支逐一改 plan 或删。
- **成套评估**：后端 preset-manifest/domain/scene-resources/backend-adapter 预设分支随前端面板成套处置。
- **验收**：tsc 无未用符号（`noUnusedLocals`）；全量测试绿；物料/墙体/分区在地图闭环。
- **注意**：`types.ts` RoomLayout 被 170+ 文件借用，类型最后删；D 层业务字段（`indoorOutdoor`/`venueIO`）保留。
- **保留（#128 在途人物/漫游线）**：`person-behavior.ts`、`idle-crowd-pacer.ts`、`zone-walk.ts`、`people-anim.ts`、`person-route.ts`、`plan-walk-context.ts`、`outdoor-route-line-layout.ts`、`human-figure.ts` 及 `docs/plans/2026-11-17-roam-behavior-layer.md` 不得随 R3 误删；与室内 `use-npcs`/`use-walkthrough` 的退役分开处理。

### E4 · R4 删二分概念与回写链路（task #33，依赖 E3）
- **删除**：`isOutdoorProject` 恒真分支、`outdoorPlanState` 的 layout.id 匹配回退、false 侧室内镜像回写、`seededPlanFromLayout` 投影适配器。
- **验收**：对抗性 grep 无室内壳体概念、无 layout 残留引用（D 层业务字段除外）；全量 tsc/测试/真机走查。

## 7. 关卡 F：并行支线（不阻塞退役主线）

### F1 · 走廊判据改「占带 × 建筑多边形相交」
- **现状**：主体放置/占用已用 `outdoorCorridorStrips(points, width)` 生成占带 + `outdoorRingsOverlap(ring, strip)` 多边形相交（`outdoor-agent-planning.ts` 多处）。残留旧口径两处（`outdoor-event-logic.ts`）：
  1. 入口打分软启发：`distanceToRoute(node.position, route) > (route.widthM ?? 3)/2 + 1`（非硬拦）；
  2. 车行线 BBox 外扩：`pad = (route.widthM ?? 4)/2 + 1`，`pathCrossesRing` 粗判。
- **样本现状（2026-11-17）**：仓库未找到真实 plan 导出 JSON；`docs/evidence` 只有资产/地图证据，plan 相关测试均为合成夹具。先用真实项目导出一份 GeoJSON 量分布，禁止拿合成夹具定阈值。
- **步骤**：① 先量真实间距——用导出几何测中心线/占带边缘到足迹距离分布，对照已验证可行解定阈值；② 再把两处从「半宽+1 距离 / BBox pad」改为复用 strips/ringsOverlap 的占带相交判据。
- **验收**：既有可行解不被误拦；新增占带相交定向测试；计时/距离口径注释更新。

### F2 · OFM 证据线（task #80）
- 定位生产 0 OFM 请求、退 `/api/site-context` 兜底的根因；Overpass 公共源边缘不可达/超时的后手保持 fail-closed。
- 验收后删除临时诊断旁路：`openfreemap-evidence.ts` 的 `debug()`/`window.__ofmDebug`、`.verify-ofm-evidence.test.ts`。

## 8. 关卡 G：基线债与工程卫生（验收后一次清）

### G1 · 基线债（task #12）
- 台账只是对照机制，失败本体未清：three 几何碰撞、Agent/面板夹具、静态结构断言脱节；tsc 类型债（未用标注、jest-dom 匹配器）。
- 处置前回退 HEAD 对照是否本轮回归；修复后刷新基线台账锚点。

### G2 · 工程卫生（验收后）
- 删对照分支：`feat/m2-*`、`feat/m3-*`、`feat/plan-legend-walls`、`release/*`。
- 删临时 worktree：`.worktrees/baseline-origin`、`.worktrees/legend-walls` 等。
- 重置旧本地 `main` 分叉（`0f831efa`，落后远端）对齐 origin/main。
- 清散落：`.verify-*.txt`、`.tmp-*` 截图与未跟踪副本；OFM 诊断旁路（见 F2）。

## 9. 任务映射

| 关卡 | task | 状态 | 依赖 |
| --- | --- | --- | --- |
| B1 | #48 M3-3a 会话 scope 与 tracker 解耦 | in_progress | flow 稳定 |
| B2 | #49 M3-3b 历史快照改 SitePlanData | pending | B1 |
| B3 | #50 M3-3c 导出与写守卫 plan 化 | pending | B2、C5 |
| B4 | #51 M3-3d 退役回写镜像 | pending | B1–B3 |
| E1 | #27 R1 立壳入口 | pending | B1 |
| E2 | #23 R2 卸保活容器与室内状态链路 | pending | B2/B3、M1 |
| E3 | #32 R3 删 layoutStore/墙模型 | pending | M2、E2 |
| E4 | #33 R4 删二分概念与回写 | pending | E3 |
| 主线 | #29 M2 物料与墙体落地 | in_progress | 壳体接线挂 C 线 |
| 主线 | #30 M3 会话/历史/导出解耦 | in_progress | 关卡 B |
| 基线 | #12 vitest 基线失败梳理 | pending | 验收期 |
| 走查 | #79 V1–V5 端到端走查 | in_progress | B 线前置 |
| 支线 | #80 OFM 切源 | in_progress | 独立 |
| 遗留 | #75/#76/#78 旧基底复核 | pending | 择期清理，不阻塞 |

## 10. 风险与待决（引用规划）

- **断壳炸链**：R2/R3 早于 M3 即炸链；死守依赖顺序。
- **双写不一致**：过渡期 plan↔layout 镜像漂移；影子双写期以 plan 为准，回写只做投影并比对校验。
- **物料归属丢失**：迁移 zoneId/尺寸/旋转错位；靠纯函数迁移单 + 对照快照 + footprint 锁。
- **待决决策**：见规划 §8（墙体归属已定独立 walls 集合；旧云项目投影见 C4；右轨尺寸/视角口径维持 14k 定稿）。
- **模型槽位**：tokendance 有额度；deepseek-flash 耗尽、bailian 欠费、minimax 上限待核；兜底一家活不瘫。
