# 去室内化 · 第一性原理终态目标书（2026-11-21）

> 目的：不沿用历史卡片的保守切片，回到「这个系统剥掉室内宴会厅历史后，还剩什么不可再删的内核」，从本质推导终态、因果顺序、阻塞解法与验收口径。
> 配套台账：`2026-11-21-indoor-decommission-goal.md`（里程碑状态）、`2026-11-21-b1-session-scope-decouple.md`（B1 现状）、`2026-11-17-decouple-execution-plan.md`（门禁）。
> 硬约束不变：绞杀者模式先建新接住再拆旧；每卡 tsc + 定向测试 + build + 全量对照 + 真机走查；冻结面（routeBridge 签名、`SitePlanData` 既有字段、`OutdoorTaskProgress`、物料入参）不动。

## 1. 第一性拆解：剥到不可再删的内核

### 1.1 系统本质在做什么
一个户外场地策划编辑器：用户在一块场地边界内布置设施、分区、出入口、路线、人员/车辆、墙体与标注，产出一份可浏览、可导出、可提交云端的方案。

剥掉一切历史实现后，不可再删的内核只有四样：

| 内核 | 本质职责 | 现役正源 |
| --- | --- | --- |
| **方案状态** | 场地几何 + 图层 + 五类实体 + 测量/标注/墙 | `SitePlanData`（`supabase/functions/_shared/site-plan.ts:384`：boundary/designScope/levels/zones/facilities/routes/nodes/workers/vehicles/measurements/buildings/annotations/walls/anchor） |
| **方案身份** | 隔离不同方案的会话、简报、草稿、库存、归档、偏好、历史 | 项目/草稿槽 `projectId`（云项目 id、`replica-*` 案例伪 id、本机草稿槽 `house-*`、`default-outdoor` 空草稿） |
| **呈现与交互** | 2D 平面、地图底图、3D 预览的渲染与编辑句柄 | 地图侧 `outdoorPlan3DRef` / `canvasApiRef` / outdoor plan overlay |
| **出入通路** | 云端读取/提交、本地备份与恢复、导出 | controller / source-storage / plan-export |

### 1.2 历史层（可退役，不是本质）

| 历史层 | 为什么存在 | 终态 |
| --- | --- | --- |
| `RoomLayout` 室内状态模型（floors/items/interiorWalls/开门/碰撞/吸附/2D 坐标） | 早期室内宴会厅编辑器 | 删除；`SitePlanData` 为唯一状态 |
| 室内 three renderer/scene/camera 保活容器、`render.ts`、2D 交互/场景特效驻留 | 旧 3D/2D 壳体 | 删除；渲染只留地图侧所需 |
| 身份第二源 `layout.id` 与 `layout.id ?? prop` 回退 | 室内期用 layout.id 区分活动，户外接入云项目后又引入 projectId | 删除；身份单一派生自 plan 槽 id |
| plan → layout 反向回写镜像（`shellVenuePatchFromPlanBoundary`、地面底图/锚点写 layout） | 过渡期把 plan 投影喂给旧壳体 | 删除；写入只落 plan / 视图记忆 |
| 二分 `isOutdoorProject` 恒真分支、`seededPlanFromLayout` 投影适配器 | 双态并存 | 删除；无 false 侧 |

### 1.3 一条本质判据
> 凡是「为了让旧室内链路能读懂户外方案」而存在的转换、回写、双源、分支，都是影子；影子的删除时点是**所有消费者改读 plan 之后**，而不是之前。

## 2. 终态完成定义（可验证）

1. **单一正源**：会话身份、历史快照、导出、写守卫、场地事实、归档、偏好全部消费 `SitePlanData` / projectId；代码库无 `RoomLayout` 作为现役状态被读写（类型引用在最后清扫）。
2. **单一身份**：会话槽、简报、库存、草稿围栏、归档键、环境偏好、评审链接按同一 projectId scope；无 `layout.id ?? 'local'` 裸回退、无第二身份源。
3. **影子清空**：无 `.sc-scene-viewport` 保活容器、无室内 three/2D 编辑态驻留、无 layoutStore/室内墙模型/开门碰撞吸附、无 plan→layout 回写、无 `isOutdoorProject` 恒真分支。
4. **户外语义保留**（本质户外件，不随退役误删）：出入口节点、场地围墙 `walls`、户外预设 lawn/market、座位/桌排/群演/漫游/车流、宴会道具（吊灯/帷幔/屏风/桌花/桌牌）、D 层业务字段 `indoorOutdoor`/`venueIO`、当前活跃 `AgentRunPanel` 时间线、旧云项目「只读 + 复制为 plan 草稿」降级通路（C4=A）；人物/漫游线 8 文件保留。
5. **验收**：根 + 前端 `tsc --noEmit` exit 0；全量 vitest 对照新锚点台账无台账外新失败；`npm run build` exit 0；关键 flow 真机走查；对抗性 grep 无残留室内壳体概念（保留件除外）。

## 3. 因果顺序（本质依赖，而非历史卡片顺序）

解耦顺序由「谁依赖谁」推出，不可颠倒：

```
① 身份唯一化（先定方案标识从哪来、刷新后怎么恢复）
        │  所有记忆/会话/归档键都挂身份，身份不定后面全串号
        ▼
② 状态正源切换（让每个消费者改读 plan）
   ├─ 2a 历史快照（内存 undo/redo，最贴近编辑器当前状态）
   ├─ 2b 导出与写守卫（读 plan；写权限走 capability + 项目级 lease，C5=A）
   └─ 2c 镜像回写退役（plan→layout 反向通道，消费者已改读 plan 后拆）
        │  影子已无人现役读取
        ▼
③ 影子退役
   ├─ 3a 立壳入口并入地图草稿（新建落 createStarterOutdoorPlan 零边界草稿）
   ├─ 3b 卸保活 Viewport 与室内 three/2D（句柄先改派地图 ref 再断室内 ref）
   ├─ 3c 删 layoutStore 与室内墙模型/开门/碰撞/吸附/室内 hooks
   └─ 3d 删二分概念与投影适配器
```

| 本质阶段 | 对应旧里程碑 | 本质任务 | 解除的影子 | 前置 |
| --- | --- | --- | --- | --- |
| ① 身份唯一化 | B1 | 单一 `activeProjectId` 派生；会话/记忆/草稿/库存键同源；补齐草稿槽恢复链路 | 身份第二源 `layout.id` 回退 | 本机草稿索引恢复 |
| ②a 历史换 plan | B2 | `useHistory` 泛型快照 `RoomLayout`→`SitePlanData`；物料/选中/墙操作挂 plan 历史；undo/redo 回写 plan | history 读 layout | ① 验收合入 |
| ②b 导出/守卫 plan 化 | B3 | CSV/GeoJSON/PNG/PDF 全量消费 plan；`assertLayoutWrite`→plan 写权限 | 导出/守卫读 layout | ②a + C5=A（已拍板） |
| ②c 镜像退役 | B4 | 删 `handleOutdoorPlanChange` false 侧 layout patch；底图/锚点写 plan/视图记忆 | plan→layout 回写 | ①②a②b 验收合入 |
| ③a 立壳入口退役 | E1 | 删 `startBlankVenue`、加号菜单空白/模板、`space-panel`、`scene-presets-panel`；新建落 starter plan | 室内新建入口 | ① 草稿通路 |
| ③b 卸保活/室内 three/2D | E2 | 断保活容器；室内 renderer/scene/camera、`render.ts`、2D 交互、场景特效驻留；句柄先改派地图 ref | 室内渲染驻留 | ②a/②b + M1 |
| ③c 删 layoutStore/墙模型 | E3 | `schema.ts` 室内分支、`layout-reducer`、`use-layout-store`、室内墙/开门/碰撞/吸附、室内 hooks；残留读取逐一改 plan 或删 | layoutStore 与室内几何模型 | ③b + M2 |
| ③d 删二分概念 | E4 | `isOutdoorProject` 恒真分支、`outdoorPlanState` layout.id 回退、false 侧回写、`seededPlanFromLayout` | 双态二分与投影适配 | ③c |

> 并行支线（不阻塞主线）：C1/C2 画布与图纸接 `plan.walls`；D1/D2 plan 级 DXF/SVG；F1 走廊占带相交；F2 OFM 证据线；G1 基线债、G2 工程卫生验收后一次清。

## 4. 当前阻塞的本质解法（B1-b 第一性回答）

### 4.1 阻塞是什么
不是「少删一行 `layout.id ??` 回退」，而是**方案标识的持久化与恢复链路不完整**：
- 本机草稿 `house-<uuid>` 同时存在 layout 单槽（`STORAGE_KEY`）与 plan 信封（`scendance-outdoor-plan-v1:<house-id>`）；
- shell 载入（`workspace-shell.tsx:117-141`）只从最近指针 `latestOutdoorProjectId()` / URL `project=` / 默认草稿解析身份；本机草稿刻意不顶最近指针（活动级规划不是续开项目）；
- 刷新续开本机草稿时，prop 回落到 `default-outdoor`，会话槽与 plan 槽割裂串号（旧病：一个 id 全活动共享、历史全摊一起）。

### 4.2 本质解法：草稿槽索引，而不是借影子反推
- **纠正方向**：不要让 shell 去读 layout 单槽反推身份——那仍是借室内影子恢复身份，影子终态要删。身份恢复应来自 **plan 侧草稿索引**。
- 已有地基：`outdoor-project-store` 按 projectId 存取 plan 记录（名/更新时间/plan）、最近指针、默认草稿、`createStarterOutdoorPlan`；`local-activities.ts` 的 `listLocalActivities()` / `readLocalActivity(projectId)` 可列本机归档草稿（IndexedDB 命名空间，仅覆盖已归档活动）。
- **已落地（2026-11-21）**：`listOutdoorProjectRecords(storage?)` 枚举 plan 草稿信封（`scendance-outdoor-plan-v1:*`），按 `updatedAt` 降序返回有效记录，过滤元键与坏信封；纯读取地基，未接 shell。
- **要补的一环（仍待定）**：shell 无参数载入时在「最近云项目 / 本机草稿索引 / 空草稿」间按明确优先级恢复现役方案 id；云项目、`replica-*` 案例、`house-*` 本机草稿三类身份各走各的恢复源，不互相冒充。恢复档位属产品语义（现状：续最近云项目 → 否则默认草稿，本机活动从列表切回），须口径确认 + 壳体绿测保护后再接入；不借 layout 单槽反推。
- 边界：索引与恢复通路属 ① 身份阶段同批改；历史记录迁移（`legacySessionScope`）作为一次性承接保留到退役。

### 4.3 身份派生终态（方案 B）
```
activeProjectId:
  显式云项目 / replica 案例  → 传入 prop
  本机草稿 house-*           → 列表 / ?project= 链接进入时传入的 plan 草稿槽 id（不再读 layout.id；无参刷新不自动续开）
  空草稿                     → default-outdoor
```
`sessionScope`、`getStoreSessionScope`、activity tracker 源已从该派生值读取，**会话域 `layout.id` 回退已去除**（2026-11-21，待 B1-e 壳体绿测 + 真机验收）；agent-panel key、bingo scopeKey、creative-studio 内部 scope、归档/偏好键归 B1-d 同批改。

## 5. 测试基座债的本质定位

### 5.1 根因（已实测，见台账 §3.2.1）
Node 26 预置 `undefined` 的实验性 `localStorage` 占位，jsdom 30 覆盖 `window.localStorage` 未生效；jsdom 套件里 `localStorage` 为 `undefined`，夹具在 setup 阶段即崩。全局补内存 polyfill 会让 mock 不全的壳体套件越过早期崩溃、进入完整壳体渲染并跑满 15s 超时挂起，破坏全量门禁——已回退，`test-setup.ts` 无 diff。

### 5.2 本质解法（独立于业务解耦的前置工程）
- 提供一套**标准内存 Storage 基座**：键作为可枚举自有属性（满足 `Object.keys(localStorage)`）、原型方法可被 `vi.spyOn(Storage.prototype, …)` 替换（`original.call(this,…)` 走原型实现）。
- **按套件注入**到需要的测试文件内部（beforeEach 自建/注入实例），不进全局 setup，避免把 mock 不全的套件拖进渲染超时。
- 优先级：先解锁 B1-d 直接依赖的 creative-studio 简报/库存/围栏链路；其余壳体套件随对应里程碑补夹具。
- 基线债（three 几何碰撞、计时 flaky、attach 夹具、`case-activity-alignment` 首条）归 G1，里程碑验收后重采新锚点台账。

### 5.3 落地记录（2026-11-21，#45 第一期）
- 共享基座：`frontend/lib/test-support-memory-storage.ts`，导出 `MemoryStorage`（`implements Storage`）。数据用 `WeakMap` 按实例隔离，实例自身不留可枚举内部字段；写盘同步成可枚举自有属性（满足 `Object.keys`）；方法在类原型上（满足 `spyOn(Storage.prototype, …)` 与 `original.call(this, …)`）。定向单测 `test-support-memory-storage.test.ts` 5 例绿。
- 接入方式（仅套件内部，不进全局 setup）：beforeEach `new MemoryStorage()` → `stubGlobal('Storage', MemoryStorage)` + `stubGlobal('localStorage', mem)`，并同步 `window.localStorage` / `window.Storage`；afterEach 既有 `unstubAllGlobals` 自动还原。
- 实测：`creative-studio.react.test.tsx` 由基线 318 failed / 364 total 落到 **320 passed / 46 skipped / 0 failed**，无超时挂起；前端 `tsc --noEmit` exit 0。
- 未推广：基线 CSV 旧红名单在当前 Node22 沙箱下已部分自绿（如 `safe-storage` 3/3），红数与 Node26 基线快照不完全一致；其余套件须在 Node26 门禁下逐文件实跑判根因，不凭旧名单批量注入（避免壳体渲染超时挂起重演）。

## 6. 门禁与风险（沿用，不放松）

- **断壳炸链**：② 未完成不进 ③；3b 前所有右轨缩放/导出/漫游句柄必须已改派地图 ref。
- **双写漂移**：过渡期 plan↔layout 影子双写以 plan 为准，回写只做投影并比对校验；②c 拆除前不得删回写分支。
- **物料归属**：迁移 zoneId/尺寸/旋转错位靠纯函数迁移单 + 对照快照 + footprint 锁。
- **提交纪律**：本地攒好 tsc + 测试 + 真机验收后按 `AGENTS.md §六`；不 `git add -A`；不强推、禁 `--force`；不夹带在途文件；不主动 push main；不触发付费生成。
- **不碰在途**：人物/漫游线 8 文件、`scendance-workspace` 系列；不回灌、不 revert 他人提交。

## 7. 本轮边界

- 本目标书只定终态与因果路径，不跳卡硬拆；当前工作区 tracked 改动：B1 壳体 `room-organizer.tsx`（B1-a 两处身份上提 + B1-b 三处同源），以及 #45 基座 `test-support-memory-storage.ts`(+`.test.ts`) 与 creative-studio 套件内部注入；`test-setup.ts` 已回退无 diff。
- 下一步开工第一关：§4.2 草稿槽索引恢复链路（① 身份阶段解除条件）；§5.2 creative-studio 基座第一期已落地，其余套件随对应里程碑补夹具。
