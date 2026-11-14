# 室内去耦合 · 目标落点登记（main 基底，2026-11-14）

> 基底：本地 `main` HEAD `492dcc8b`（远端 `origin/main` `f6409fb6`，仅差一个 `.dsh/skills` 手册 commit，非前端业务代码）。
> 本文是退役规划 `outdoor-map-decommission-2026-11-13.md` 的**当前实读盘点**：把残留耦合按域登记到切片、标清门禁与可达性，供后续切片接手。**本轮只定目标，不拆 blocked 旧链、不合 wip 隔离切片。**
> 口径：行号随合并可能微移；路径除标注 `frontend/lib` 外均相对 `frontend/components/room-organizer/`。

## 1. 终局目标（沿用退役规划 §1，完成定义）

1. 生产链路不再挂载室内 Viewport / three 室内场景：DOM 只剩唯一地图画布（2D↔3D 直切），无保活室内容器、无残留室内 WebGL 上下文。
2. 唯一正源是地图契约 `SitePlanData`；物料 / 墙体 / 出入口 / 分区 / 动线 / 人员 / 测量 / 标注 / 会话 / 历史 / 导出全部消费这份 plan。
3. 会话绑定项目 id（`outdoorProjectId` / 本地草稿槽），不绑室内 `layout.id`；undo/redo 基于 plan 快照；导出从 plan 出图。
4. 产品概念无「室内 / 室外」二分；`venueIO` / `indoorOutdoor` 仅作 Agent 提案业务输入字段保留（D 层，不动）。
5. 合 main 门槛：全量 `tsc --noEmit` 0、定向 + 全量测试不扩红（基线债 #12 单列）、真机走查通过。

## 2. 当前三态盘点（2026-11-14 实读）

### 2.1 已合 main（G1，可作基底）

- M1 五钮地图化、M4 出入口收尾、M5 智能体工具桥接扩充、残留死代码清除、户外面板视觉收口、漫游一期裸步行。
- M2 物料 / 分区 / 动线 / 工人 / 楼层**迁移纯函数**：`lib/plan-migration-frame.ts`、`lib/plan-facility-migration.ts`、`lib/plan-layout-migration.ts`、`lib/plan-facility-mapping.ts`。
- M3a 主体：`lib/project-session-scope.ts` 地基 + 壳体 `sessionScope` / `getStoreSessionScope` / `isScopedSessionCurrent` / 各守卫拼接已走 `projectSessionScope(outdoorProjectIdProp)`；`LayoutAgentProvider` 用独立 `sessionScope`。

### 2.2 隔离在 wip 分支（G2，待 #110 V1–V5 确认后再合 main）

分支 `wip/m2-agent-slots-20261113`（本地，未 push），含：

- **M2 walls**：`site-plan.ts` 的 `planWallSchema` / `walls` 可选集合、`lib/site-plan-walls.ts`（`buildWall` / `inferWallZoneId`）、`lib/plan-wall-migration.ts`（`migrateWalls`）及对应测试。
- **M2 续增量**：facility / layout 迁移器小改、`site-plan-facilities.ts` 微调。
- **智能体线 model 槽位**：`agent-contract/agent-runner/api/assistant-chat/chat-provider/providers` 及前端 `agent-panel/creative-studio/use-outdoor-agent-workflow/outdoor-agent-understanding`、`agent-resolver/backend-session`。
- 左栏 padding WIP（壳体 `#outdoor-panel-host-layers/library` 10→8），未验收视觉草稿。
- 12 份未裁决续写快照归档于 wip `docs/plans/wip-rescue-20261114/`。

### 2.3 blocked 未动（G3，智能体全迁地图桥后最后拆）

R1 立壳入口退役、R2 卸保活容器 / three 链路、R3 删 layoutStore 与室内墙模型、R4 删二分与回写镜像。关键路径 `M3 → R2 → R3 → R4`，M3 不成套不断壳。

## 3. 残留耦合域登记表

> "本轮可否动" 指在 main 基底、不越 G2/G3 门禁的前提下。

### 3.1 会话身份（M3a 主体已接，残留影子域）

| 域 | 符号 / 落点（实读） | 归属切片 | 解锁前置 | 本轮可否动 |
|---|---|---|---|---|
| 工作台内部 chatScope | `creative-studio.tsx` 内 `activity:${layout.id \| base.id \| selected.layout.id}` 拼接 | 3c/3d：provider 传入 scope 与内部 chatScope 统一到 project 身份 | M3 成套 | 否 |
| 评审卡审计键 | `bingo-audit-card.tsx` `scopeKey = activity:${projectKey}` | 评审链接 / R3-R4 域 | R3-R4 | 否 |
| 场地事实 scope | `venue-facts-panel.tsx`、`space-panel.tsx` `venueFactScope`（壳体 `activityScope(layout.id)` 传入，:4635） | 3c 场地事实重映射 | plan 边界 / 面积 / 锚点几何稳定 | 否 |
| 楼层 tracker 影子 | `room-organizer.tsx:344` `useFloorSessionTracker(layoutStore)`；`lib/floor-session-epoch.ts` scope 同 layout.id | 3a 遗留：等 plan.levels 接住后重绑 | M2 plan.levels 接线 | 否 |
| 导出 note scope | `scene-delivery-panel.tsx` 导出 note scope | 3c / R4 导出链路 | 3c | 否 |
| 环境偏好桶 | 壳体 `writeEnvironments/readEnvironments/clearEnvironment` 按 `layout.id` 分桶（:2455–2922 一批） | R2 / 3c：环境 / 场地核对前置改地图语境 | R2 卸 three 链路 | 否 |
| 评审链接身份 | 壳体 `identity().scope = layout.id`（:4210） | 评审链接域 | R3-R4 | 否 |

### 3.2 历史（M3b）

| 域 | 落点 | 现状 | 归属切片 | 本轮可否动 |
|---|---|---|---|---|
| 户外 plan 历史栈 | `outdoor-plan-canvas.tsx` 内 `historyRef/redoRef`（`SitePlanData[]`，上限 30）→ `commitPlan/undoPlan/redoPlan` → `outdoorActions.undo/redo` | **已接住**，canUndo/canRedo 取自户外 `outdoorHistory`，不读壳体 layout 栈 | — | 无需动 |
| 壳体室内命令集历史栈 | `room-organizer.tsx:1650` `useHistory(layout, …)` + `applyVenueHistorySnapshot`（:1652）；服务尚未迁 plan 的室内物料 / 墙 / 灯光 / 事件操作 | hook 已泛型 `<T>`，不绑 RoomLayout；换类型只在壳体调用点 | R2/R3 卸壳对象；3b 随 M2 物料 / 墙落 plan 后迁 | 否 |

### 3.3 导出 / 写守卫（M3c）

| 域 | 落点 | 现状 | 归属切片 | 本轮可否动 |
|---|---|---|---|---|
| 户外导出 | overlay `exportPlanDraft` 取 `canvasApiRef.getEditVisuals().plan ?? planRef.current`；`exportPlanPng` 走 canvas；智能体 `getPlan()` 返回 plan 快照 | **已读 plan** | — | 无需动 |
| 写守卫 lease | `workspaceWriteGuards.assertLayoutWrite`（壳体 20+ 处调用） | 是编辑权 lease（校验会话 / 权限），**不读 layout 内容**；改名与判据换 plan 域 | 3c 成套，不单独抽 | 否 |

### 3.4 回写镜像（M3d）

| 域 | 落点 | 现状 | 归属切片 | 本轮可否动 |
|---|---|---|---|---|
| false 侧回写 | `handleOutdoorPlanChange`（:1740）false 侧 `shellVenuePatchFromPlanBoundary`（:1765）把边界 patch 回 layout | 过渡期 plan↔layout 影子双写 | 3d：真侧正源稳定后删除 | 否 |
| 投影适配器 | `seededPlanFromLayout`（:838 import / 调用） | 旧模型到新契约的 ACL 投影 | R4 随壳体一并移除 | 否 |
| 底图回写 | `applyOutdoorGroundBasemap` 对 layout 的 `floorPlanImage/sceneAnchor` 写入 | 待改挂 plan / 视图记忆 | 3d | 否 |

### 3.5 壳体容器 / three 链路（R2）

- `room-organizer.tsx:4635` `.sc-scene-viewport` 保活容器与 `Viewport` 挂载；室内 three renderer / scene / camera 上下文、2D `render.ts` / `use-canvas-2d-interaction` / `use-scene-effects` 在编辑态驻留。
- 前置：右轨缩放 / 导出 / 漫游句柄全部改派 `outdoorPlan3DRef` / `canvasApiRef` 后，再断室内 ref（依赖 M3b/3c 完成）。
- 本轮可否动：**否**。

### 3.6 室内数据模型（R3）

生产源码（非测试）引用面实读：

| 符号 | 生产引用文件数 | 归属 |
|---|---|---|
| `use-walkthrough` | 6 | R3 室内段退役 |
| `use-walk-avatar` | 1 | R3（对照件，户外三期独立复用） |
| `walk-collision` | 8 | R3 |
| `interior-walls` | 9 | R3 |
| `walk-seat` | 1 | R3（对照件） |
| `use-npcs` | 4 | R3 |
| `drop-zone` | 2 | R3 落点改 plan |
| `layout-reducer` | 7 | R3 室内分支删除 |

另有 `schema.ts`（RoomLayout/floors/items/interiorWalls）、`use-layout-store`、`wall-openings` / `opening-snap` / `wall-snap` / `structural-layout`、`use-item-placement` / `use-item-drag`。前置 M2 + R2。本轮可否动：**否**。

### 3.7 二分概念（R4）

- `isOutdoorProject` 壳体分支 18 处（:306 定义；:1744/:1777/:1784/:4662–4672/:4815 等）；`outdoorPlanState` 的 layout.id 匹配回退；false 侧室内镜像；`seededPlanFromLayout` 适配器。
- 前置 R3。本轮可否动：**否**。

### 3.8 立壳入口（R1）

- `agent-panel.tsx:2321` `startBlankVenue` 定义、:3644 注入；`space-panel.tsx` 整轨；`scene-presets-panel.tsx`；`lib/blank-venue.ts`（`createHardFinishHall` / `BLANK_VENUE`）；`lib/workspace-api.ts`（`emptyProjectScene` / `BLANK_VENUE_SIZE`）；`agent-chat.tsx` 加号菜单。
- 去向：统一走 picker「从空白开始」→ 地图空白选址草稿；模板提案由地图 zone/facility 模板承接。
- 前置：M3a 草稿通路验收通过。本轮可否动：**否**。

## 4. 门禁梯度（沿用 §7.5）

| 梯度 | 切片 | 状态 | 合 main 条件 |
|---|---|---|---|
| G0 基线 | #110 + A 层退役 | ✅ 已达成 | — |
| G1 并行可合 | M1 / M4 / M5 / 五钮 / 死代码清除 / 视觉收口 / 漫游一期 | ✅ 已合 | 只动画布内部与地图工具，不改契约字段、不改 bridge 签名、不换 scope |
| G2 待确认 | M3a 剩余 tracker 重映射、M3b 历史快照换 plan、M2 walls 写契约字段、智能体线 model 槽位 | ⚠️ wip 隔离 | #110 V1–V5 确认不依赖旧绑定；会动会话连续性 / 快照比对 / 提案解析字段 |
| G3 最后合 | R1–R4 壳体退役、provider `onApply(RoomLayout)` 签名改造 | ⛔ blocked | 智能体提案全部经 routeBridge 落地后 |

## 5. 本轮可达动作（不越门禁）

1. **侦察登记**（本文档）：残留耦合按域落到切片与前置，后续切片照表接手。
2. **只读核对**：新增切片前先核对 §3 表内符号是否仍在该落点；行号漂移以符号检索为准。
3. **零引用死代码清扫**：仅当对抗性核实（生产 + 测试 + 动态挂载路径）零引用后删除；当前 §3.6 清单内符号均有生产引用，无可直接删项。
4. 不新增任何对 `SitePlanData` 既有字段、routeBridge 九方法签名、会话 scope 的改动；不接入 wip 隔离契约。

## 6. 阻塞清单与解锁条件

| 阻塞项 | 解锁条件 |
|---|---|
| G2 切片合 main（walls 契约、M2 续、3a 剩余、智能体线槽位） | #110 V1–V5 确认智能体链路不依赖旧 layout 绑定；会话连续性 / 快照比对基线复核不红 |
| R2 卸保活容器 | M3b 历史、M3c 导出 / 写守卫成套接住；右轨句柄全部改派户外 ref |
| R3 删 layoutStore / 墙模型 | M2 物料 / 墙落 plan；R2 完成 |
| R4 删二分与回写 | R3 完成；真侧正源稳定 |
| R1 立壳入口退役 | M3a 草稿通路验收通过 |
| #12 基线债（空布局夹具 / contexts mock 缺 hook） | 用户明确要求不顺手清；单列已知失败，不混入去耦合回归 |

## 7. 建议推进顺序（关键路径）

1. **等 #110 确认** → 合 G2：walls 契约 + 迁移、M2 续接线、3a 剩余 floor/venue tracker 重绑 plan.levels / 几何。
2. **M3c 成套**：写守卫 lease 改名换 plan 判据、导出链路彻底读 plan；随后 **M3d** 退役 false 侧回写镜像与投影适配器。
3. **R2** 断保活容器与室内 three/2D 上下文 → **R3** 删 layoutStore 与室内墙 / 碰撞 / 步行 / npcs 模型 → **R4** 删 `isOutdoorProject` 二分与残留回写。
4. **R1** 立壳入口在草稿通路通后先行并入地图空白草稿。

## 8. 验收口径（每片提交前）

1. Node24 清 `tsconfig.tsbuildinfo` → 全量 `tsc --noEmit` exit 0。
2. 定向 vitest 跑该切片相关文件；不引入新全量失败（对照 #12 基线债）。
3. dev 3210 真机探针：DOM 结构、右轨钮清单、canvas 数、地图图层、console 无新报错。
4. 每片独立可回滚；不攒跨切片大改；不 revert 在途他人文件；杂物截图 / 草稿不入库。

## 9. 开放问题（沿用退役规划 §8）

1. 旧云项目 `/editor/?project=<id>` 无 mode 读旧室内 schema 的迁移 / 降级策略（只读提示或一次性投影到 plan）——未定。
2. 第三人称 / 坐姿等人物漫游能力属三期新对话，不在本去耦合线。

## 10. 2026-11-14 夜间基线复核记录

> 执行前提：main 基底本地推进；G2/G3 门禁维持不变，未拆任何旧链、未合 wip 隔离切片。

### 10.1 基线结果（清 `*.tsbuildinfo` 后干净编译为准）

- 前端 `tsc --noEmit`：**exit 0**。夜间曾出现两次单文件类型错（可选 `provider`/`model` 形参漏 `| undefined`，`exactOptionalPropertyTypes` 下调用方传 `T|undefined` 不兼容），已在本地 commit `5b9fae2e` 对齐到 `chatModelAllowed` 的 `string|null|undefined` 口径；纯类型收窄，运行侧空值仍由既有判空兜底，不改契约 / bridge 签名。
- 定向 vitest 全绿、无新增红：
  - 前端户外 + M2 + 契约组 84 绿（walk-boundary 13、three/outdoor 9、walk-engage 6、use-outdoor-walk 3、facility-migration 13、layout-migration 10、routes 12、footprint-lock 18）。
  - 根契约组 25 绿（site-plan 16、models 9）。
  - `agent-panel` 全量 39 failed / 403 passed / 1 skipped 为 #12 已知基线债，本轮不顺手清、不混入去耦合回归。
- 根 `tests/` 全量快照（非去耦合定向范围）：18 failed / 1432 passed / 10 skipped（132 文件）。失败集中在后端配置预飞、资产库计数、守卫 RLS、简报供应商 mock（`config` 2、`hunyuan-config` 7、`merged-library` 3、`agent-guard-readiness` 2、`brief-conversation-api` 2、`brief-extract-api` 1、`database` 1、`asset-upload` suite 1），属缺 env / 本地资产未齐 / 在途智能体线的既有基线债；本轮源码改动仅 `5b9fae2e` 三处形参补 `| undefined`（纯注解、零运行分支），未触碰这些域。去耦合定向口径仍以前列 84 + 25 绿为准。

### 10.2 零引用复核（#70）

对 §3.6 十四室内模块逐个统计**非测试生产源码**引用文件数，结果全部 ≥1，与盘点一致，当前基底无可直接删项：

| 模块 | 生产引用 | 模块 | 生产引用 |
|---|---|---|---|
| use-walkthrough | 6 | drop-zone | 2 |
| use-walk-avatar | 1 | layout-reducer | 7 |
| walk-collision | 8 | wall-openings | 6 |
| interior-walls | 9 | opening-snap | 17 |
| walk-seat | 1 | wall-snap | 3 |
| use-npcs | 4 | structural-layout | 44 |
| use-item-placement | 2 | use-item-drag | 5 |

`structural-layout`(44)、`opening-snap`(17) 引用面最大，断链风险高，均留待 R3 成套退役。

另扫到一批座位编排 / 布置域（`local-seating-*`、`ring-seating`、`table-seat-plan`、`seating-allocation`、`seat-requirement`、`builders-seating`、`catalog-placement-*`、`aholo/online-model-placement`、`plan-crowd/scene/splat-placement`、`placement-rules/settle-placement`）：户外 plan 侧目前只接住 facility / worker / route / zone，座位编排尚未被地图侧接住，属 R3/R4 拆旧对象，门禁下不单独删、不做零引用裁决。

### 10.3 纯函数测试加固（#71，本地 commit `ed9a4758` / `636b2a8a`）

未改实现、未动壳体，只钉住既有兜底分支：

- facility 迁移：空 / 纯空白名回落「通用物件」、超长名截 60、非法 hex 色丢弃、NaN 旋转归零、空布局退空。
- layout 迁移：空布局五类实体全空、人员空角色回落「人员」、分区非法色丢弃后工厂按语义回落默认灰。
- 映射表：类型 `trim` 归一、空串 / 纯空白回落 misc、`glb-asset` 回落 misc。
- 迁移共享坐标帧：`makeFrame`/`framePoint` 投影往返、`hexOrUndefined` 非法色丢弃边界。

第二批（commit `5096d602` / `e2482c96`，均纯函数、无状态/网络/副作用，未碰 R 线与门禁邻近域）：

- 单位换算 `display-units`（7）：米/英尺长宽面积换算、非有限回落 `—`、precision 覆盖、未知单位回落米制。
- 扫描坏档 `splat-meters`（5）：各维有限校验、跨度 0.5–120m 可用、越界 null、结果 round 1 位、负向 max 按绝对值取跨度。
- 资产引用 `glb-url`（6）：相对路径 / 同源 packaged 放行，带 hash/凭据/空格/反斜杠拒绝，http 仅 localhost/127.0.0.1/[::1]，超长/非字符串/解析失败拒绝。
- 路网等级 `road-network`（6）：highway→人行/车行/后勤映射、未知 null、三类中文标签、坏段裁剪、缺 id 回首点坐标拼接。
- 素材分类 `material-taxonomy`（3）：空家族→「其他」、已知折叠类目 / 未知原样、筛选直等与折叠后命中、类目标签判定。
- 选区几何 `place-shape-quality`（10）：名称归一、线长 / 外接框面积、轮廓 hint、同名去城市前缀与短码后缀匹配、line 不可入库、坏多边形 / 越界点 / 公交往返标记拒绝、可信面与够长线可展示。

甄别后明确排除（不越门禁、不写脆弱测试）：`lane-status`/`plan-basemap-source`（模块级状态 + 订阅器 + localStorage，跨用例污染高）；`outdoor-plan-handoff`（build 纯构造但属 3c 导出邻近域，download 走 DOM/URL 副作用）；`general-activity-question`（智能体读侧分类器，另一会话在途领域，避开回写冲突）；R 线 / 座位域 / 门禁邻近件（`structural-layout`、`initial-layout`、`blank-venue`、`furnishing-select`、`table-shape`、`online-model-placement`、`floor-reading`、`scene-presets`、`venue-history`、`workspace-write-guards`、`readonly-draft-bundle/registry`）均不动。

### 10.4 回写机制与处置口径（夜间实记）

- 智能体线（wip）文件被另一并行会话持有缓冲，会反复回写 main 工作树 / index：已观察到 `agent-resolver`、`backend-session`、`agent-panel`、`creative-studio`、`use-outdoor-agent-workflow`、`outdoor-agent-understanding`、`agent-panel.react.test`、`brief-extract-contract`、`chat-provider.test` 等多批浮现。
- 处置：对单文件 `git restore --staged --worktree -- <file>`（同时清 index 与工作树，`--worktree` 默认不清 index）；恢复后必须 `git status --short` 复查 tracked，排除 `??` 与被回写半状态污染的 tsc 诊断。
- 提交前只 `git add` 本轮有意改动，不夹带 `.dsh` 手册在途更新与 wip 残留。

### 10.5 门禁维持状态

- G2（walls 契约 / M2 续接线 / 3a 剩余 tracker / 智能体 model 槽位）仍隔离在 wip，等 #110 V1–V5 确认。
- G3（R1–R4 壳体退役、`onApply(RoomLayout)` 签名改造）仍 blocked，等智能体提案全部经 routeBridge 落地、M3 成套接住。
- 夜间未推进任何拆旧；关键路径仍是 `M3 → R2 → R3 → R4`。
- 任务链成套阻塞关系（夜间复核）：#29 M2 walls 接线 blocked by #30；#48 3a 可达部分已落地（遗留 floor/venue 影子），#49 3b 历史快照 blocked by #48，#50 3c 导出/写守卫、#51 3d 回写镜像随 #49 成套；#48–#51 互相成套，不能在 main 单独抽离。R 线 #23/#27/#32/#33 全部等 M3 接住后退役。
- 夜间本侧本地提交（未 push，攒好一次性推）：`5b9fae2e` 类型止血、`ed9a4758` facility/layout 迁移边界、`636b2a8a` 映射边界、`d582af79` 迁移坐标帧边界、`5096d602` 单位/扫描/资产引用边界、`e2482c96` 路网/分类/选区几何边界、`48866ccb`/`cd98d24c`/`9447062f` 文档登记。验收：前端 tsc exit 0；收尾定向 17 文件 176 绿（含新第二批 6 文件 37 用例）；根契约 site-plan 16 + models 9 绿。
- 真机探针受既存 3D 主线程 CDP op-lock 阻塞（navigate/js 排队超时），非本轮改动所致；运行时背书由 tsc + 定向测试承担，真机 undo/redo/图层走查留待页面空闲或用户醒后补。
