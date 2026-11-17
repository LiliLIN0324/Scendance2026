# 室内壳引用面扫描（R3 前置只读盘点）

> 基线 `origin/main @ 2e2bc478`（2026-11-17）。口径：在远端干净基底上按 **import 路径**统计引用方，排除测试与自身；不按目录名删，不按常见英文词（entrance/roof/stairs）的语义命中计数。
> 目的：为 R2/R3/R4 退役把「可整组退的链」和「跨线仍存活、不能删」的模块分档。本清单只读，不含删除动作。

## 0. 一句话结论

main 上**基本没有可直接删的生产孤岛**。室内残留是成链耦合：three 场景簇挂在室内场景装配 hook 上，状态/schema 主干被壳体、面板、提案、持久化、分享页深引用，业务纯函数簇部分被智能体提案链借用。退役只能按 `M3 → R2 → R3 → R4` 顺序整组卸，不能先挑零散文件删。

## 1. 引用面计数（main，import 路径口径，生产文件数）

### 1.1 状态 / schema 主干（R3 最后卸，引用最深）

| 模块 | 生产引用 | 归属 |
| --- | --- | --- |
| `hooks/use-layout-store.ts` | 60 | 室内状态主干，壳体/面板/提案/epoch/持久化全挂 |
| `lib/structural-layout.ts` | 50 | 室内结构布局，提案/编排/3D/导出多链 |
| `lib/schema.ts`（RoomLayout 等） | 46 | 类型唯一定义，264 文件借类型，最后删 |
| `lib/initial-layout.ts` | 41 | 初始室内布局，持久化/恢复/分享页 |
| `hooks/use-layout-state.ts` | 18 | 壳体状态 |
| `hooks/layout-reducer.ts` | 17 | 室内 reducer |
| `hooks/use-history.ts` | 8 | 历史仍绑 RoomLayout（M3b 待换 plan） |
| `hooks/use-layout-persistence.ts` | 5 | 室内草稿持久化（M3c 待 plan 化） |

### 1.2 室内 three 场景簇（R2 随 Viewport/three 链路整组退）

共同枢纽：`hooks/use-scene-effects.ts`（室内 three 装配）、`three/room-builder.ts`、`three/structure-builder.ts`、`three/furniture-builders.ts`、`lib/scene-delivery.ts`、`three/proposal-preview.ts`。

| 模块 | 生产引用 | 备注 |
| --- | --- | --- |
| `three/room-builder.ts` | 13 | 室内场景主装配 |
| `three/wall-openings.ts` | 7 | 墙开口，连 interior-walls/room-builder |
| `three/dormers.ts`(lib+three) | 6 | 阁楼/屋顶件，连 schema/reducer/roof/neighbours |
| `three/structure-builder.ts` | 4 | 结构建造 |
| `three/interior-walls.ts` | 4 | 室内墙，连 layout-preview/scene-preview/structure-builder |
| `three/drag-handlers.ts` | 4 | 室内拖拽，连 canvas-2d/three-scene |
| `three/neighbours.ts` | 1 | 邻楼，连 use-scene-effects |
| `three/floor-patterns.ts` | 2 | 地面贴图，连 room/structure-builder |
| `three/baseboard.ts` | 2 | 踢脚线，连 interior-walls/room-builder |
| `three/footprint-outline.ts` | 2 | 连 use-scene-effects/proposal-preview |
| `three/roof.ts`(three) | 3 | 屋顶，连 scene-effects/dormers/neighbours |
| `three/wall-patterns.ts` | 3 | 墙面贴图 |
| `three/scan-placement.ts` | 1 | 连 splat-preview |
| `three/item-labels.ts` | 1 | 连 use-scene-effects |
| `three/entrance.ts`(three) | 2 | 连 use-scene-effects（注意：勿与户外 node/entrance 语义混） |

**室内家具 builders 簇**（被 `three/furniture-builders.ts` 聚合，R2 随聚合入口整组退）：
`builders-bathroom / bedroom / kitchen / electronics / storage / decor / seating / tables`，各 1–2 引用方，唯一生产入口是 `furniture-builders.ts`；后者被 layout-preview、use-scene-effects、scene-delivery、proposal-preview、脚本引用。

### 1.3 室内业务纯函数簇（R4 按提案链借用情况重估）

**座位编排链**（服务室内宴席/座席提案，被 agent-proposal / brief-agent / event-layout-agent / agent-panel 借用）：
`table-seat-plan`(10)、`seat-requirement`(6)、`ring-seating`(4)、`local-seating-draft`(4)、`local-seating-witness`(3)、`seating-allocation`(2)、`local-seating-specs`(2)、`walk-seat`(1→use-walkthrough)。
- 处置：不是孤岛，先登记；户外提案若仍借 agent-proposal 的座席能力，R4 重估去留，不随 three 簇删。

**室内构件规则**（连室内 schema/geometry/碰撞链）：
`opening-snap`(17)、`floor-keep-out`(13)、`stairs`(lib,7)、`furniture-sets`(10)、`furnishing-select`(8)、`furniture-catalog`(5)、`floor-reading`(4)、`wall-snap`(1)、`entrance-block-check`(1)、`rest-area-plan`(1)、`stage-platform-plan`(3)。
- `opening-snap / wall-snap / floor-keep-out / walk-collision` 属室内放置与碰撞，随 R3 墙模型退；`furniture-catalog/sets` 连评分/提案链，R4 重估。

**旧室内方案**：`local-plan`(9)、`legacy-brief`(4)、`rest-area-plan`(1)、`stage-platform-plan`(3)。

### 1.4 室内 hooks（壳体直挂，R2/R3 随壳退）

`use-npcs`(1)、`use-walkthrough`(2)、`use-item-placement`(1)、`use-item-drag`(2)、`use-floor-keep-out`(1)、`use-canvas-2d-interaction`(2)、`use-scene-effects`(1)、`use-three-scene`(1)、`use-walk-avatar`(1)。
- 全部引用方为 `room-organizer.tsx` / 室内 `viewport.tsx` / `use-canvas-2d-interaction`，无户外线直挂。

### 1.5 立壳入口面板（R1 成套退役，依赖 M3a 草稿通路）

| 模块 | 生产引用 | 备注 |
| --- | --- | --- |
| `lib/blank-venue.ts` | 2 | agent-panel、scene-presets-panel |
| `three/scene-presets.ts` | 21 | 预设清单 + GLB 解析，引用面广，后端 preset-manifest 须成套评估 |
| `panels/space-panel.tsx` | 1 | 挂壳体 spaceSlot |
| `panels/scene-presets-panel.tsx` | 2 | space-panel、creative-studio |

## 2. 跨线存活——不得按室内残留删除

下列模块名字像室内，但被户外线或在途线生产引用，**保留**：

| 模块 | 户外/在途引用方 | 判定 |
| --- | --- | --- |
| `lib/sub-entrance.ts` | `use-outdoor-agent-workflow`、`outdoor-agent-planning` | 户外子出入口逻辑，保留 |
| `lib/place-area.ts` | `place-search-options`、`use-place-shape-lookup`、`plan-place-search` | 户外选址，保留 |
| `lib/glb-import.ts` / `glb-normalize` / `glb-limits` | `outdoor-plan-canvas`、`generation-sheet`、`three/glb-assets` | 户外物料/生成线，保留 |
| `lib/lux3d-import.ts` | `character-generate`、`online-model-library`、`character-design-panel` | 人物/模型库在途线，保留 |
| `three/people-model` / `people-anim` / `person-follow`、`hooks/use-outdoor-walk` | 户外人群/漫游在途线 | 不并入退役（与 PR113 人员线拆开） |

## 3. 已排除的「疑似孤岛」（实测为存活或名不副实）

- `room-shapes.ts`、`bounded-edit-validation.ts`：main 上源文件已不存在，无需动作。
- `local-shared-seating-draft.test.ts`：文件名像独立模块，实际 import 存活的 `./local-seating-draft` 函数 `planLocalSharedDeskDraft`，非孤儿测试。
- `three/wall-mount-heights.test.ts`：未测已删同名源，实际覆盖 `wall-openings` / `camera-vision` / `builders-decor/electronics/structure`，依赖存活。
- `lib/collision.test.ts`：测存活 `geometry` 的 `hasCollisions/itemsOverlap/autoOrganize` 与 `floor-keep-out`，非孤儿。
- `catalog-placement`：无同名源；存活的是 `catalog-placement-guard.ts`、`catalog-placement-position.ts`，勿混。

## 4. 退役动作建议（不改变既定 M→R 顺序）

1. **现在不动 R 线**：M3 仅完成 3a；3b 历史、3c 导出/守卫、3d 回写镜像仍读 layout，R2 断壳前置不满足。
2. **R2 候选已明确**：1.2 整簇 + 1.4 hooks，枢纽是 `use-scene-effects`；等缩放/导出/漫游句柄全部改派 `outdoorPlan3DRef/canvasApiRef` 后整组断。
3. **R3 候选**：1.1 状态/schema 主干 + 1.3 中随墙模型退的放置/碰撞件；`schema.ts` 类型最后删（264 文件借类型）。
4. **R4 候选**：1.3 座位编排/家具目录/旧方案中仍被提案链借用的部分，先确认户外提案是否还依赖，再定去留；删 `isOutdoorProject` 恒真分支与 false 侧回写镜像。
5. **R1**：1.5 立壳入口成套退，后端预设清单（preset-manifest/domain/scene-resources）同步评估，不能只删前端。

## 5. 待决（动工前拍板）

- 旧云项目 `/editor/?project=<id>` 读旧室内 schema：只读提示还是一次性投影到 plan（决定 R3 是否留迁移降级通路）。
- 户外旧预设 `lawn` / `market`：迁 SitePlan 草稿体系还是先留作户外样例；其余 8 个室内预设随 G3 整组卸。
- walls 独立集合 vs facility 模板类（M2 遗留），影响 R3 室内墙模型退役口径。
