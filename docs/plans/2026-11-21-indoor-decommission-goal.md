# 去室内化终态目标与里程碑台账（2026-11-21）

> 承接 #79 收尾（main `2de462be`，与 origin/main 同步）。本文把「去室内化清理」定成可验收的终态目标与串行里程碑，作为本轮及后续开工的总台账。
> 依据：`2026-11-17-decouple-execution-plan.md`、`2026-11-17-b1-b4-execution-cards.md`、`2026-11-17-g1-closure-status.md`、`2026-11-17-indoor-deadcode-audit-3e376b41.md`、`2026-11-21-b1-session-scope-decouple.md`、`2026-11-21-first-principles-endstate.md`（第一性原理终态与因果路径）。
> 行号/路径以届时 `origin/main` 为准；开工前先 `git fetch` 复核。

## 1. 终态目标（完成定义）

> 全完成的 one-shot 收口定义、四不可再减条件、三股工作线收口时点与对抗核验清单，见 `2026-11-21-first-principles-endstate.md` §0；本节是里程碑侧的对应展开。

1. **地图 `SitePlanData` 是唯一正源**：会话身份、历史快照、导出、写守卫、场地事实全部消费 plan；不再以室内 `RoomLayout` 正源读写。
2. **室内壳体整组退役**：保活 Viewport、室内 three renderer/scene/camera、2D 编辑态、`layoutStore`/`layout-reducer`、室内墙模型/开门/碰撞/吸附、室内 `use-npcs`/`use-walkthrough` 段、二分概念与回写镜像全部删除或归并到地图侧。
3. **身份统一到项目/草稿槽 projectId**：会话槽、简报、库存、草稿围栏、归档键、环境偏好、评审链接全部按同一 projectId scope；无散落 `layout.id ?? 'local'` 裸回退。
4. **户外语境件保留**（不得随退役误删）：出入口节点、场地围墙 `walls`、户外预设 lawn/market、座位/桌排/群演/漫游/车流、宴会道具（吊灯/帷幔/屏风/桌花/桌牌）、D 层业务字段 `indoorOutdoor`/`venueIO`、当前活跃 `AgentRunPanel` 时间线、旧云项目「只读 + 复制为 plan 草稿」降级通路。
5. **验收状态**：根 + 前端 `tsc --noEmit` exit 0；全量 vitest 对照最新锚点台账无台账外新失败；`npm run build` exit 0；关键 flow 真机走查通过；对抗性 grep 无残留室内壳体概念（保留件除外）。

## 2. 串行里程碑（依赖硬门禁，顺序不可颠倒）

```
B1 会话/身份解耦 → B2 历史快照换 plan → B3 导出与写守卫 plan 化 → B4 回写镜像退役
                                                                              │
                                                                              ▼
                                                          E1 立壳入口 → E2 卸保活/室内 three/2D
                                                                              │
                                                                              ▼
                                                          E3 删 layoutStore/室内墙模型 → E4 删二分概念与回写
```

| 里程碑 | 范围要点 | 前置依赖 | 当前状态（2026-11-21） |
| --- | --- | --- | --- |
| **B1** 会话 scope 与身份解耦 | 主 `sessionScope`/`getStoreSessionScope`/tracker/散落 `activity:` 键收敛到 projectId 单一身份源；tracker scope 同源 | #79 flow 稳定；本机活动身份反推链路 | 🟡 部分落地（见 §3） |
| **B2** 历史快照换 plan | `useHistory` 快照 `RoomLayout`→`SitePlanData`；`commitHistoryNow` 物料/选中/墙操作挂 plan 历史；undo/redo 回写 plan 通路 | B1 验收并合入 | ⬜ pending |
| **B3** 导出与写守卫 plan 化 | CSV/GeoJSON/PNG/PDF 全量消费 plan；`assertLayoutWrite`→plan 写权限（capability + 项目级 lease + revision）；核对前置改地图语境 | B2 + C5=A（已拍板 A） | ⬜ pending |
| **B4** 回写镜像退役 | 删 `handleOutdoorPlanChange` false 侧 layout patch；地面底图/锚点写入落 plan/视图记忆；清残留镜像分支 | B1–B3 验收合入 | ⬜ pending |
| **E1** 立壳入口并入地图草稿 | 删 `startBlankVenue`、加号菜单「新建空白/模板」、`space-panel`、`scene-presets-panel`；新建落 `createStarterOutdoorPlan` 零边界草稿 | B1 草稿通路 | ⬜ pending（阻塞 B1） |
| **E2** 卸保活 Viewport 与室内 three/2D | 断 `.sc-scene-viewport` 保活容器；室内 renderer/scene/camera、`render.ts`、`use-canvas-2d-interaction`、`use-scene-effects` 编辑态；右轨/导出/漫游句柄先改派地图 ref | B2/B3 + M1 | ⬜ pending（阻塞 B2/B3） |
| **E3** 删 layoutStore 与室内墙模型 | `schema.ts` 室内分支、`layout-reducer`、`use-layout-store`、室内墙/开门/碰撞/吸附、室内 hooks；残留读取分支逐一改 plan 或删；后端预设分支成套评估 | M2 + E2 | ⬜ pending |
| **E4** 删二分概念与回写链路 | `isOutdoorProject` 恒真分支、`outdoorPlanState` layout.id 匹配回退、false 侧镜像回写、`seededPlanFromLayout` 投影适配器 | E3 | ⬜ pending |

> 并行支线（不阻塞退役主线）：C1 画布消费 `plan.walls`、C2 图纸墙线；D1 plan 级 DXF、D2 plan 级 SVG；F1 走廊占带相交、F2 OFM 证据线；G1 基线债、G2 工程卫生验收后一次清。

### 2.1 全完成收口路线与现状（2026-11-22）

终态判据沿用终态书 §0.2 四条件（状态正源单一 / 身份单一 / 呈现只留地图侧 / 通路 plan 化）与 §0.6 验收门禁；本节只标当前位置与剩余缺口，不跳卡。

| 卡 | 全完成判据 | 当前现状 | 剩余缺口 / 阻塞 |
| --- | --- | --- | --- |
| **B1** 会话/身份解耦 | 会话/简报/库存/草稿/归档/偏好/评审同一 projectId scope；无 `layout.id ??` 裸回退；B1-e 三 flow 真机通过 | 🟡 片 1 会话仓 + 片 2 记忆桶已切；A1 夹具 5 passed / 1 skipped；静态门禁（根/前端 tsc、底座套件）无增量回归；真机 flow1 ✅、flow3 ✅；flow2 写租约竞态突破后已能切到新槽 | ① flow2 已切新槽（裸 uuid `2538691c…`），但非预期 `house-*` 本机槽；槽轨道归属（云端 mint vs 本机槽）与保存→回写→独立本机槽 mint 全链属 B2/B3 口径，待拍板。② 例3 理解失败人数导出，两份 brief 打通归 B2/B3。③ 去 layout 回退随 B2/B4 成套 |
| **B2** 历史快照换 plan | `useHistory` 快照 `RoomLayout`→`SitePlanData`；undo/redo 回写 plan；两份 brief 打通 | ⬜ 阻塞于 B1 合入 | 例3 brief 打通在此卡落地 |
| **B3** 导出与写守卫 plan 化 | CSV/GeoJSON/PNG/PDF 消费 plan；`assertLayoutWrite`→plan 写权限；checkin/note scope 转 plan | ⬜ 阻塞 B2 | scene-delivery checkin、note scope |
| **B4** 回写镜像退役 | 删 false 侧 layout patch；地面底图/锚点写 plan/视图记忆；清镜像分支；草稿/偏好键退役 | ⬜ 阻塞 B1–B3 | 未发送草稿/恢复锁/run marker/图片源键；环境偏好键一次性迁移（C2） |
| **E1** 立壳入口并入地图草稿 | 删 `startBlankVenue`/加号菜单/`space-panel`/`scene-presets`；新建落 `createStarterOutdoorPlan` | ⬜ 阻塞 B1 草稿通路 | space-panel 入口退役 |
| **E2** 卸保活/室内 three/2D | 断 `.sc-scene-viewport`；`render.ts`/`use-canvas-2d`/场景特效；句柄改派地图 ref | ⬜ 阻塞 B2/B3 + M1 | floor tracker 随此移除 |
| **E3** 删 layoutStore/室内墙模型 | schema 室内分支/`layout-reducer`/`use-layout-store`/墙/开门/碰撞/吸附/室内 hooks | ⬜ 阻塞 M2 + E2 | activity epoch 派生随此清 |
| **E4** 删二分概念与回写 | `isOutdoorProject` 恒真分支/`seededPlanFromLayout`/`outdoorPlanState` 回退 | ⬜ 阻塞 E3 | — |

**待拍板口径**（到决策点停住，不代推）：C1 无参刷新草稿索引恢复档位；C2 旧 `activity:` 存量会话/偏好迁移或只读承接、环境偏好键换键一次性迁移；C3 165 例语义红逐条产品口径判定（身份前置落定后复核）；flow2 新槽裸 uuid 走云端 mint 还是本机 `house-*` 槽，随 B2/B3 身份口径拍板。

**夹具债与并行遗留**：A1 例3 skip 转 B2/B3；G1 基线锚点 B 线合入后重采；G2 工程卫生终态一次清。安全批次 #37、旧 79 backlog #4/#7/#9/#10/#11、C/D/F 线不阻塞主线，E4 后排一次清。

## 3. B1 内部切片与本轮状态

| 切片 | 内容 | 状态 |
| --- | --- | --- |
| B1-a 身份上提 state | `onBindProject` 绑定成功、`commitFreshActivityLayout` 新建活动后同步 `outdoorProjectIdProp`，与 layout.id/plan 槽对齐 | ✅ 已落地（过渡态，行为保持） |
| B1-b scope 正源收敛 | 主 `sessionScope`/`getStoreSessionScope`/activity tracker 源收敛到单一身份派生；最终去掉 `layout.id` 回退 | 🟡 第一小步已落地：`activeProjectId` 单点派生，三处同源（见 §3.2）；去 layout 回退 + 反推链路待 B2/B4 成套 |
| B1-c tracker 源重绑 | activity tracker 已注入 project 源；**floor tracker 随 E2 容器退役一并移除**；venue tracker 按几何 basis 不动 | 🟢 决策已定：floor 不单独改造 |
| B1-d 散落键归位 | creative-studio 简报/库存/订阅/草稿围栏、bingo scopeKey、评审 identity、scene-delivery note scope、环境偏好键 | ⬜ 待 B1-b 正源闭合后同批改（成套，不可拆两半） |
| B1-e 验收 | Node26 tsc + 定向测试 + 全量对照基线 + 真机切项目/新建活动/刷新续开不串会话 | ⬜ 待 b/d 闭合 |

### 3.1 本轮已落地与验证（未提交、未推 main）

- **B1-a**：`room-organizer.tsx` `:4123` 新建活动 `setOutdoorProjectId(created.id ?? DEFAULT)`；`:4647` 云绑定 `setOutdoorProjectId(projectId)`。
- **B1-b 第一小步（单点派生）**：新增 `activeProjectId`（显式云/replica 取 prop，否则 `layout.id ?? prop`）；`sessionScope`、`getStoreSessionScope`、`activityScopeSource.getScope` 三处同取该派生值，消除 tracker 纯 prop 与主 scope `layout.id ?? prop` 的口径分裂。未去掉 layout 兜底（终态去回退随 B2/B4）。
- 根 + 前端 `tsc --noEmit` exit 0。
- lib 会话组 13 绿；active react 5 红、壳体 react 四套件 5/17/7/6 红，与台账基线持平。
- 前端全量 126 failed / 715 passed（841 files）；比旧台账多出的 20 个失败文件，经 `git stash` 回 main 干净态定向复跑 **20/20 同样失败**，属 main 既有状态（台账快照过时 / Node 环境差异），非本轮引入。B1-b 单点对齐后复测失败文件集合与上一轮完全一致，无新增回归文件。

### 3.2 B1-d 为何本轮未动

`creative-studio.tsx` 的 `scope = layout.id ?? 'local'`（`:334`）直接用传入 `layout.id`，未接收壳体 projectId；简报存储、未发送草稿、候选库存、恢复锁、订阅频道全挂这套内部 scope。要归位须壳体把 `activeProjectId` 下传为 prop 并同批改这套链。该面板当前环境测试大面积红（夹具不全），按门禁「成套 + 定向测试 + 真机走查」要求，不能在无绿测、无真机验收下硬改；留待 B1-b 终态闭合后成套处理。

#### 3.2.1 测试红根因实测（2026-11-21，Node 26.2.0）

- **共同环境根因**：Node 26 预置了一个值为 `undefined` 的实验性 `localStorage` 占位（描述符 `{enumerable:false, configurable:true}`，无 getter/value）；jsdom 30 覆盖 `window.localStorage` 时未生效，导致 jsdom 套件里 `localStorage` 为 `undefined`（`sessionStorage` 不受影响、正常注入）。测试夹具里直接 `localStorage.clear()` / `setItem(...)` 在 setup 阶段即崩，整套快速失败。
- **试探：全局补内存 Storage polyfill（已回退，未入库）**：在 `test-setup.ts` 检测到 jsdom 环境 `localStorage` 缺失时挂一个内存 `Storage`。结果 creative-studio 从 **320 failed 降到 21 failed**、session-history 5→0 全绿、error 8→3、generation 6→4，均为改善。
- **不可全局落地的副作用（门禁否决）**：polyfill 补齐后，mock 不全的壳体套件（`canvas-session`、`brief-memory`）越过原本的早期崩溃，进入完整壳体渲染，`findByLabelText` 跑满 15s 超时 ×N 形成挂起。对照实测：main 干净态 `canvas-session` 19ms 快速 7/7 失败；仅 B1 壳体改动、无 polyfill 时 17ms 快速红；带 polyfill 时挂起。**挂起确系 polyfill 引起**，会破坏全量超时门禁，故 `test-setup.ts` 已 checkout 回 main 原版，无 diff。
- **creative-studio 剩余 21 红的深层夹具债**：测试还依赖真实 Storage 的 `Object.keys(localStorage)` 枚举已存键、以及 `vi.spyOn(Storage.prototype, 'setItem'|'getItem'|'removeItem')` 替换原型方法（`original.call(this,…)` 走原型实现）。简单 Map polyfill 不暴露键为可枚举自有属性、方法挂在实例而非原型，满足不了这两点。要救这批需重写该套件的存储测试基座（注入内存 storage 实例 + 原型可 spy），属独立夹具工程，不在 B1 本轮硬做。
- **#45 落地（2026-11-21，第一期）**：共享基座 `frontend/lib/test-support-memory-storage.ts`（`MemoryStorage`，WeakMap 隔离实例、键为可枚举自有属性、方法在原型可 spy），定向单测 5 例绿；按套件内部注入 creative-studio（beforeEach 自建实例 + stubGlobal `Storage`/`localStorage` + 同步 window 引用，afterEach `unstubAllGlobals` 还原）。实测该套件 **320 passed / 46 skipped / 0 failed**（基线 318 红清零），无挂起；前端 tsc exit 0。其余套件未批量推广：旧基线红名单在 Node22 沙箱下已部分自绿，须 Node26 门禁下逐文件实跑判根因。
- **#45 推广（2026-11-21，第二/三期）**：基座按套件内定向注入续接非壳体套件。第二/三期共转绿 **22 套件 / 223 测试**：受控面板与 hook（`session-history-panel` 5、`use-assistant-sessions-active` 5）；简报/待办/场地事实（`assistant-brief-memory` 17、`pending-brief` 9、`venue-facts-storage` 9、`reported-inventory` 13、`outdoor-plan-adoption` 5）；环境偏好与位置事务（`environment-preference` 4、`.strict` 12、`environment-write-reconciliation` 9、`environment-position-transaction` 8、`site-calibration-capability` 7）；图库/版本/分享/地图槽位/持久化（`library-lease` 5、`library` 17、`version-history-capability` 4、`review-link-versions` 7、`review-share` 3、`share-records` 8、`map-source-slots` 11、`unlinked-venue-export` 11、`persistence` 51）；根 lib `local-fresh-activity` 3。汇总 24 文件 **267 passed / 0 failed**（含基座单测 5、store 39），tsc exit 0。
- **仍未解锁**：两套壳体全渲染套件 `canvas-session`(7)、`session-generation`(6) 定向注入后越过 setup 崩溃、进入完整壳体渲染，但三/2D 与 Agent mock 不全，`findByLabelText` 跑满 15s 超时挂起（>5min 无输出）；注入已回退、保留基线快速红。`local-scans`(11) 走 `resetModules` 动态重载 + 资产登记域，结构复杂未接；`local-seating-draft`、`cloud-material-draft` 残留红为 `undefined.name` 非存储根因。基座只覆盖非壳体套件，壳体套件须先补齐场景/Agent mock 才能解锁，归 B1-e 夹具债。
- **#45 第四期（2026-11-22，Node26 实跑基线 + 续接）**：先在当前 main 干净态实跑全量建立锚点——**842 文件，105 failed / 737 passed；10771 测试，1476 failed / 9220 passed / 75 skipped**（Node v26.2.0，vitest 4.1.12）。续接基座 8 个非壳体纯逻辑套件，定向全绿：`local-project-restore` 3（另 17 例为方案 A 闸门 skip，见下）、`local-auto-login` 9、`pay/client` 5、`original-review-ledger-idb` 9（自带 fakeDb，IDB 已 mock）、`conversation-recorder` 5、`venue-scans` 4、`publish-flow` 7、`project-manifest` 10，合计 **52 passed / 0 failed**，前端 tsc exit 0。全量回归对照基线：**95 failed / 747 passed；1428 failed / 9268 passed**，失败文件 -10、失败测试 -48；唯一新增 `three/plan-traffic-layer` 定向复跑 14/14 绿，判为并行 flaky，**非增量回归**。
- **#45 第五期（2026-11-22，Node26 定向 + 全量对照）**：续接 6 个非壳体套件，定向 **39 passed / 0 failed**：`safe-storage` 3、`plan-ground-capture` 9（前两组纯计算本就过，仅 basemap-source 组接基座）、`load-generated-catalog-item` 1、`lux3d-import` 8、`agent-documents` 5（封装内 `localStorage.getItem/setItem`）、`aholo-assets` 13（含 `:126` `stubGlobal('window',{localStorage:blocked})` 故障注入例，基座在该例前注入、afterEach `unstubAllGlobals` 还原，未避让该例）；相邻 `lux3d-dialog-entry` 12、`lux3d-direct-test` 9 本就绿、未改。前端 tsc exit 0。全量对照：**93 failed / 749 passed 文件；1405 failed / 9291 passed / 75 skipped（10771）**，较上轮回归 95/747、1428/9268 失败文件 -2、失败测试 -23；本轮 6 套件全绿、生产代码 0 改动、夹具套件内隔离，无增量回归。
- **#45 第六期（2026-11-22，Node26 定向 + 全量对照）**：续接/修正 6 个非壳体套件，定向全绿：`site-plan-legend` 19（唯一生产代码改动：`:199` `formatPlanObjectSize` 返回值已自带 ` m`，源码去掉重复拼接 ` m`，修掉 `2 × 2 m m`；测试断言由过时 `2×2 m` 对齐为现行口径 `2 × 2 m`，相邻 `plan-size-format`、`site-plan-inventory` 40 例绿）、`case-activity-alignment` 5（误归语义类，实为 `readOutdoorProjectRecord` 走缺省全局存储，接基座贯通）、`bingo-feedback` 9（末例 `issueReviewShare/addReviewComment` 不传 storage 参数走全局，前 5 例传自建 `bucket()` Map 独立对象不受影响）、`aholo-model-placement` 15（beforeEach/afterEach 钩子原只 `clear()`，补基座注入）、`facility-generated-models` 28（5 例 `getItem` undefined + 1 例写盘落空连带断言红，接基座后 28/28）、`place-search` 25。前端 tsc exit 0。全量对照：**83 failed / 759 passed 文件；1376 failed / 9320 passed / 75 skipped（10771）**，较上轮 93/749、1405/9291 失败文件 -10、失败测试 -29；夹具套件内隔离，除 legend 单位去重外生产代码 0 改动，无增量回归。
- **第六期新定性（非存储，不盲改）**：`scene-layers` = `INITIAL_LAYOUT.floors[0].items[0]` 为 undefined 的结构/快照口径漂移（`setting 'handoff'/'id'/'position'`）；`shared-seating-placement` = 几何计数与 `backend-adapter.backendSceneToLayout` 适配（length 45 vs 50、position/rotation undefined）；`library-capabilities` = 物料登记/能力标签生成器债（目录每行须有标签，新增物料须重跑生成器）；`outdoor-layout-weights` = 文案口径语义红（期望「地图证据已压缩为摘要」，收到占位「已理解本轮需求。」）；`cloud-material-draft` 源码自身不碰存储，报错来自传递依赖，待沿 import 链追封装模块；`asset-cloud`/`local-scans`/`scan-upload`/`public-asset-recovery` 仍属 ⑤ `resetModules` 动态重载 + 复杂 fetch/XHR，不接。
- **#51 第七期（2026-11-22，Node26 定向 + 全量对照）**：按既有 MemoryStorage 基座标准模式续接 26 个测试文件（hooks / app·intro / components / lib），直用全局 `localStorage.clear/setItem/getItem` 与 lease 闸门 `getStorage:()=>window.localStorage` 的套件套件内定向注入；sessionStorage jsdom 自带不动，不进全局 `test-setup.ts`（全局 polyfill 已被挂起门禁否决）。定向出列全绿 22 文件：hooks `use-import-export-capability` 2、`use-layout-persistence-capability` 3、`use-layout-persistence-switch-race` 8（fakeTimers + clear）、`use-layout-persistence.hydrate` 7、`use-layout-persistence.react` 74、`use-layout-persistence.share-budget` 1、`use-material-checkins` 9（lease）、`use-silent-cloud-attach` 20、`use-splat-calibration-readonly` 2（lease）、`use-splat-preview` 1、`use-outdoor-agent-workflow.design` 21；app/intro `error` 10（混用 sessionStorage 与 localStorage）、`global-error` 4（spyOn `Storage.prototype.setItem`）、`intro/auth-card` 16；components `review-share-page` 11、`restore-startup-gate` 15（`inspectRestoreStartup(()=>localStorage)`）、`onboarding-host` 9、`outdoor-facility-generate`/`outdoor-plan-overlay.merge`/`outdoor-plan-save-lifecycle`/`plan-place-search`（4 文件合计 35/35）、`workspace-write-guards` 5（lease + 保留既有 indexedDB stub）。前端 `tsc --noEmit` exit 0。全量对照 batch8：**60 failed / 782 passed 文件；984 failed / 9712 passed / 75 skipped（10771）**，较 batch7 72/770、1113/9583/75 失败文件 -12、失败用例 -129、通过用例 +129、skipped 持平；差集出列 12 个全绿文件、**新入列 0**，无增量回归；生产代码 0 改动，夹具套件内隔离。
- **第七期接入后仍红（④ 语义/夹具，非存储根因，未改源码与断言）**：`use-outdoor-agent-workflow.react` 124 例余 1 文案红（期望「要分哪些用途」，收到「已理解本轮需求。」）；`app/layout` 6 例余 2 文案红（期望「上次恢复尚未核对完成」「无法读取或识别」，收到「上次恢复还没核对完」「读不到本机恢复记录」）；`app/page` 10 例余 2（`:175:3`、`:218:28` 控件夹具红，找不到按钮「按这份细表生成预览」）；`app/projects/page` 14 例余 1 导航语义红（期望 router push `/editor/`，未调用）。这些需逐条对照产品口径判定源码 bug / 过时断言 / 真实产品语义，当前证据不足不盲改。
- **#52 第八期（2026-11-22，Node26 定向 + 全量对照）**：复核 batch8 残留套件，把被粗判为 ③/⑤、实测仍是 ① `localStorage` undefined（clear/setItem 崩在 setup，fetch 已注入 mock、非网络/动态重载红）的 7 个套件按基座标准模式接入，定向 49 例全绿：lib `asset-cloud` 7、`local-scans` 11（四个 describe 各 beforeEach，注入置于 `unstubAllGlobals` 之后）、`scan-upload` 15；面板 `agent-chat-capability` 3（resetModules 动态重载 + lease + `Storage.prototype.setItem` spyOn）、`agent-supervision-picker` 3（原型 getItem/setItem spyOn 故障注入例）、`bingo-review-refresh` 5、`recovery-entry` 5（全走 `window.localStorage`）。另对齐 1 处过时断言：`app/projects/page` 新建项目跳转，源码现役 `router.replace('/editor/?new=1')`（`agent-panel.tsx:4249-4253` 读取 `new` 参数开场地选择后清除），测试原期望裸 `/editor/` 滞后于口径，断言改为现役 URL，14/14 绿；源码 0 改动。前端 `tsc --noEmit` exit 0。全量对照 batch9：**54 failed / 788 passed 文件；944 failed / 9752 passed / 75 skipped（10771）**，较 batch8 60/782、984/9712/75 失败文件 -6、失败用例 -40、通过 +40、skipped 持平；差集出列 7 个接入套件，唯一新入列 `lib/share.test.ts` 定向复跑 28/28 绿，判并行 flaky（同第四期 `plan-traffic-layer`），非增量回归。
- **第八期定性更正与残留**：`asset-cloud`/`local-scans`/`scan-upload` 第六期台账归 ⑤（resetModules + fetch/XHR），实测崩点为 `localStorage.clear` undefined，fetch 均走注入 `fetchImpl`/`stubGlobal('fetch')`，更正为 ①；`agent-chat-capability`/`agent-supervision-picker`/`bingo-review-refresh`/`recovery-entry` 原归 ③ mock 不全，实测为存储 setup 崩，更正为 ①。仍红未动：`cloud-material-draft`/`delivery-private-text` 为 `INITIAL_LAYOUT.floors[0].items` 空数组下取 `items[0..2]` 的过时夹具（④ 结构漂移，非存储）；`library-capabilities` 标签生成器债、`local-seating-draft`/`shared-seating-placement` 几何计数与后端适配、`outdoor-layout-weights` 摘要口径、`plan-facility-models` 素材映射缺口、`scene-layers` 快照漂移、`public-asset-recovery` 网络错误例，均属 ④/⑤ 不盲接；其余面板/壳体簇为 ③ mock 不全整渲染，注入基座只会进挂起。
- **#52 续（2026-11-22，文案断言对齐）**：`app/layout` 启动闸门两例文案断言滞后于现役口径——源码 `restore-startup-gate.tsx:30` pending 态「上次恢复还没核对完。」、unreadable 态「读不到本机恢复记录。」，同组件专项测试 `restore-startup-gate.react.test.tsx:37/:69` 已用现行文案；`app/layout.react.test.tsx:64/:76` 旧书面文案「上次恢复尚未核对完成」「无法读取或识别」对齐为现行口径，6/6 绿，源码 0 改动。全量对照 batch10：**52 failed / 790 passed 文件；941 failed / 9755 passed / 75 skipped（10771）**，较 batch9 54/788、944/9752/75 失败文件 -2、失败用例 -3、通过 +3；差集出列 `app/layout`、`app/projects/page`（后者第八期已对齐，batch9 并行残留入列），**新入列 0**，无增量回归。残留 ④：`use-outdoor-agent-workflow.react` 1 例追问 notice 文案（追问分支条件/夹具链路待对照）、`app/page` 2 例整渲染控件（`forcePreview` 态按钮 + 照片控件，壳体 mock 链不全），证据不足不盲改。
- **#53 第九期（2026-11-22，Node26 定向 + 全量对照）**：复核 batch10 面板残留，把仍被粗判 ③、实测仍是 ① `localStorage` undefined（`clear/setItem/getItem` 崩在 setup，会话/路由/存储模块已走注入 mock）的 20 个面板套件按 MemoryStorage 基座标准模式套件内定向注入。定向出列全绿 18 套件：`bingo-audit-card` 18、`bingo-rail-button` 13、`project-thumb` 5、`team-view` 5、`venue-picker` 12、`public-material-placement` 1、`environment-preview` 4、`local-activities-startup-save` 2、`venue-facts-panel` 5、`space-panel` 17、`amap-venue-picker` 17、`scendance-workspace` 37、`generated-model-library` 23、`generation-sheet` 20、`share-menu` 50、`online-model-library` 47、`activity-task-workspace` 55、`cloud-panel` 87。另对齐 1 处过时断言：`team-view` 未登录空态，组件 `account-team-panel.tsx:58` 现役正文「登录后这里会列出成员。」，测试旧文案「在账户中心登录后，这里会显示你所在团队的成员。」滞后，断言对齐，5/5 绿，源码 0 改动。前端 `tsc --noEmit` exit 0。
- **#53 第九期残留与回退**：`bingo-feedback-import` 7 例余 1（`finish is not a function`，读取 Promise 未挂起的时序夹具红，非存储）；`scene-delivery-panel` 102 例余 2（导出门控按钮 `disabled` 布尔断言，模板节点/后端场景门控语义，与存储隔离无关），均证据不足不盲改。`agent-panel` 457 例尝试接基座后越过 setup 进入整渲染，`findBy` 期望 DOM 未挂出、批量 1000ms+ 超时挂起（③ mock 不全整渲染），接入已回退、保留基线快速红；其余壳体簇 `room-organizer-*` 同属独立夹具工程，本轮不硬拆。全量对照 batch11：**34 failed / 808 passed 文件；552 failed / 10144 passed / 75 skipped（10771）**，较 batch10 52/790、941/9755/75 失败文件 -18、失败用例 -389、通过 +389、skipped 持平；差集出列 18 个本轮接入套件，**新入列 0**；`project-review-panel` 定向 39 绿、全量残留判并行 flaky（同 `share.test.ts`），非增量回归；生产代码 0 改动，夹具套件内隔离。
- **canvas-session 两层根因实测（2026-11-22）**：干净态 7 例 28ms 快速红，根因纯 `localStorage` undefined（setItem/clear）；注入基座后越过 setup 进入完整壳体渲染，agent-panel 输入框（`agent-panel.tsx:5109`）受 `activity && mode==='layout'` 门控未挂出，`findByLabelText('告诉 Agent 要改的')` 跑满超时挂起（>150s 无结果，已停）。接入已回退、保留基线快速红。通过的壳体套件里 0 个整渲染 `RoomOrganizer`；整壳体簇共享一套未补齐的后端会话/Agent/云适配 mock，属独立夹具工程，本轮不硬拆。
- **剩余失败分类（Node26 基线）**：① 纯 storage undefined（基座可解，待续）；② lease 闸门 `无法读取本机恢复状态，不能写入`（依赖 `local-write-lease` 存储探测，部分或随基座解锁，含产品闸门逻辑）；③ 超时挂起（creative-studio / local-activities-panel / project-review-panel，mock 不全）；④ 语义断言红（算法/文案/尺寸，如 share 距离、site-plan-legend 单位、plan-facility-models 计数、case-activity-alignment 前缀）；⑤ `resetModules` 动态重载 + 复杂 fetch/XHR mock（asset-cloud、scan-upload、local-scans）。`localRestoreAvailable()` 为方案 A 硬编码 `return false`，对应 describe 的 skip 是产品闸门，非夹具债。
- **整壳体簇 mock 分层路线图（2026-11-22 勘察，待施工）**：`RoomOrganizer` import 170+ 模块、30+ hooks；基线 0 个整渲染套件通过，历史未在 jsdom 下建立过这套夹具。临时探针（已删、未入库）实证：注入基座后 worker 被壳体未回收副作用（可见轮询/订阅/未决请求/地图与 three 定时器）挂住，连套件结果都不返回。
  - *AgentPanel 挂载链（已钉死）*：壳体 `:5358` 在 `!captureOpen && !generationOpen && !personChat && !messagesOpen && agentPanelVisible && !businessCardOpen` 时才挂 `AgentPanel`；`agentPanelVisible = (!agentCollapsed || agentClosing) && !sidePanel`（`:534`，初始 collapsed=false/Closing=false/sidePanel=null → 可见）。面板内 `activity = activeAgent==='door'`（默认 door），`mode = agent.callbacks.workbenchMode`（壳体 `:570` state，默认 `WORKBENCH_MODE_DEFAULT`）。输入框 label 在 `activity &&` 块的 form 内；静态初始条件应满足，找不到即面板未挂载或壳体未渲染到该层。
  - *补 mock 分层（按序）*：① 后端会话：壳体 `:331-332` 支持 prop `controller` 注入，`providedController ?? createBackendSession()`——优先传假控制器绕过构造，避免真实 IDB 账本（`backend-session.ts:99` `indexedDB.open`）、`navigator.locks`、30s 可见轮询（`:1585` `startVisiblePolling`）泄漏到 jsdom。已从壳体 38 处 controller 调用点钉出假控制器最小接口：`config.apiUrl`；`retain()`；`getSnapshot()` 返回 `{project?:{id},user?:{id}}`；`subscribe(fn)→unsubscribe`；`businessRequest<T>(path,method)`；`savePreferences(prefs)`/`getPreferences()`；`listStudios()`/`getStudioSettings(id)`；`localDraftAuthorityVersion()`；`authorizeAsset(assetId)`。② 会话/Agent 仓：`useAssistantSessions`、`agent-resolver.resolveBriefTurn`（pending promise）、`creative-studio.useStudioAgent`（参照 `agent-panel.react.test.tsx:43-94` 的 studioMock 全集）。③ 场景 hooks：`use-three-scene`/`use-canvas-2d-interaction`（canvas-session 已 mock）、`use-scene-effects/lighting/zoom`、`use-splat-preview`、`use-walkthrough/avatar`、`use-npcs/people-model`、`use-weather`——返回空/静止态，不留 rAF/定时器。④ 地图/物料：`place-search`/`road-network`/`openfreemap-buildings`/`research-area`/`online-models`/catalog 返回空或 stub。⑤ 上下文 `./contexts` room-editor/selection（参照面板测试 `:76-88`）。
  - *就绪信号替代*：canvas-session 断言的 two/three handlers 来自已 mock hook 的 capture 回填，不必等 AgentPanel 输入框；可把 `findByLabelText('告诉 Agent 要改的')` 换成稳定锚点（壳体容器或 capture 已回填），前提仍是壳体完整渲染不挂。
  - *风险*：无真机对照，mock 边界易出假绿；每套件补完须对照真实会话/拖拽语义。worker 不退出须在 afterEach 清轮询/订阅/rAF，或在 mock 层让定时器 no-op。
- B1-a 安全核对：`caseActivityAlignment` 只认 `replica-` 前缀，`house-*` 不误判云项目；plan 记录本就落 `created.id` 槽；分支进入条件旧代码同样满足。

## 4. B1-b 解除条件（下一轮开工第一关）

**缺口根因**：本机活动身份 `house-<uuid>` 存在 layout `STORAGE_KEY` 单槽与 outdoor plan 信封 `scendance-outdoor-plan-v1:<house-id>`；shell 载入 prop 只解析最近指针 / URL `project=` / 默认草稿，**不读 layout 槽**；本机活动刻意不顶最近指针（活动级规划不是续开项目）。直接去掉 `layout.id ??` 回退，刷新续开时会话槽会漂到 `default-outdoor`，与 plan 槽割裂串号。

**决策（方案 B，2026-11-21 拍板）**：无参刷新回默认草稿 / 最近云项目；本机 `house-*` 不自动续开，从列表或 `?project=` 链接进入时按指定 id 解析。**B1-b 去回退已落地**：`activeProjectId` 纯取 prop（空回落 default），会话域三处同源，不再读 `layout.id`；待 B1-e 壳体夹具补绿 + 真机走查验收。

**可行方向（落码前逐行复核，属 B1-b 同批改）**：
1. 建单一身份派生 `activeProjectId`：显式项目（云项目 / `replica-` 案例）取 prop；本机活动取 layout.id（即草稿槽 id）。所有 scope/槽位/比对点从该派生值读取，消除散落的 `layout.id ?? prop`。
2. 本机活动刷新续开：~~读 layout 槽反推~~（借影子，终态要删）——身份恢复走 plan 侧草稿索引。**地基已落地（2026-11-21）**：`listOutdoorProjectRecords()` 枚举 `scendance-outdoor-plan-v1:*` 信封按 `updatedAt` 降序返回；指针口径已修正为活动级 `trackLastProject=false`。shell 恢复档位（无参刷新是否自动续最近本机草稿）属产品语义，待口径确认 + 壳体绿测后接入。
3. 成套同批：activity tracker scope 源、壳体 scope 拼接、agent-panel / creative-studio 比对点一起改，避免 `isCurrent` 与 scope 比对失败导致提案/导出/拖拽全灭。
4. 旧草稿会话不回读属 G2 可接受过渡态；`legacySessionScope` 一次性承接保留到退役。

> 真正把身份从 layout 迁到 plan 槽、删掉 `layout.id` 读取，归 B2/B4；B1 只保证会话/记忆键按统一 projectId 派生，不越界删 layoutStore。

## 4.1 壳体身份读取点分域清单（2026-11-21，行号对应当前 main）

`room-organizer.tsx` 内 `layout.id` / prop 用法按域划分，B1 只收会话域，其余归后续卡：

| 域 | 行号 | 现状 | 归属 |
| --- | --- | --- | --- |
| 会话 scope | `:390` `sessionScope`、`:457` `getStoreSessionScope` | `projectSessionScope(layout.id ?? outdoorProjectIdProp)` | B1-b |
| activity tracker 源 | `:399-402` `activityScopeSource.getScope` | `projectSessionScope(outdoorProjectIdProp)`（纯 prop，与主 scope 口径分裂） | B1-b 同批改 |
| 会话比对/订阅 | `:437/:447/:451/:456/:4665-4737/:4849/:4945/:4979/:4980/:4984/:4985/:4989/:4992/:4995` | 读 `sessionScope` / `getStoreSessionScope` | 随主 scope 跟随 |
| 历史迁移 | `:389` `legacySessionScope`、`:394` `adoptScopeHistory`、`:395` `rememberScopeName` | 一次性承接旧草稿 | 过渡态保留，退役时删 |
| plan 槽匹配 | `:367-369` `outdoorPlanSlotId`、`:2017/:2050/:2057` `boundId/matchId` | 显式项目取 prop，否则 `layout.id ?? prop` | B2/B4 |
| 归档/源记录 | `:1145` `projectKey`、`:1204/:1210` `capturedScope`、`:1251/:1256` `controller.project ?? layout.id` | 按活动 id scope | B1-d/B4 |
| 环境偏好键 | `:2716/:2732/:2737/:2742`、`:3164-3271`、`:5702` | `layout.id` 作偏好/环境 scope | B1-d |
| 写守卫/只读/UI key | `:4837` `identity().scope`、`:4930` `readOnly`、`:5230` 组件 key | 读 layout.id | B3/E4 |
| 散落地板/场地事实 | `:412` floor tracker、`:414` venue tracker | floor 随 E2；venue 几何 basis 不动 | B1-c 决策已定 |

> 成套边界复核：主 scope、activity tracker 源、agent-panel（`LayoutAgentProvider` `key={sessionScope}:${epoch}`）与 creative-studio 比对点必须同批改；当前 `:400` 与 `:390` 口径分裂是过渡态裂缝，去回退前先在单一身份派生值上对齐。

### 4.2 B1-d 散落键逐点处置清单（2026-11-21 核实）

| 触点 | scope/键现状 | 配对存储/守卫 | 归属卡 | 本轮动作 |
| --- | --- | --- | --- | --- |
| `panels/bingo-audit-card.tsx:416/:431/:433` | `scopeKey` 由 agent-panel 传 `agent.sessionScope`；内部 `projectSessionScope(plan.projectKey)` 比对 | 评审快照回执 | B1 ✅ 已跟随主 scope | 无需改 |
| `panels/creative-studio.tsx:290/:334/:337/:340-352/:516/:579/:617-628/:634` | 内部 `scope = layout.id ?? 'local'`；片1 已切会话仓 `chatSessionScope`（`:336`）、片2 已切候选库存（`inventoryScope` 跟 chatScope，`:626/:631`）；剩余 brief 存储、未发送草稿、恢复锁、图片源仍挂 `layout.id` | briefStorage（B2/B3，随两份 brief 打通，同例3 挂账）/ unsentMessageDrafts·applyRecoveryKey·sourceCoordinator 图片源（B4，未发送草稿/恢复锁/run marker 不跨身份搬）/ material-checkin（B3，见 :133） | B1-d 余线拆到 B2/B3/B4 | ✅ 会话仓/库存段片1/片2 已归位；剩余不在 B1 成套硬切。壳体仅下传 `sessionScope`，未下传 plan 槽 id；换键需带一次性迁移防丢存量，随对应卡成套处理 |
| `panels/venue-facts-panel.tsx:15-40` | `scope = activity:${activityId}`，activityId 由调用方传入 | `venue-facts-storage` 键；面板当前休眠 | B1-c/E2 | 随 venue tracker 与休眠面板，E 线一起清；不单独改 |
| `panels/space-panel.tsx:244-272` | replica 案例创建 / 项目切换入口 | outdoor-project-store | **E1** | 不属 B1；随立壳入口退役整组删 |
| `panels/scene-delivery-panel.tsx:129/:297/:298/:595/:596` | `layout.id` 用于本地备份恢复比对、云绑定判定、checkin 面板 `projectId` | 本地备份 / material-checkin | **B3** | 导出/checkin plan 化时改；note `scope:'activity'` 是 HTML 标注字面量，非身份键 |
| 壳体 `:1150` 评审 `projectKey`、`:1209/:1215/:1222` 发布 `capturedScope`、`:1256/:1261` 回执 projectId | `layout.id ?? 'local'/'local-draft'` | 评审标记 / 发布回执 / share 日志 | **B4** | 归档/发布域，随镜像退役与 plan 正源迁移 |
| 壳体 `:4842` 切换守卫 `identity.scope` | `layout.id ?? ''`；传给 `unsavedSourceDrafts(scope)` 草稿检测 | 未存图片原件草稿键 | **B4** | scope 必须与草稿存储键同口径，不能直接换成会话 scope；随活动 id 域迁移 |
| 壳体 `:3169-3271` 环境偏好键 | `environmentPreferenceKey(layout.id)` / `{kind:'project',id:layout.id}` | environment-preference 结构化分桶 | B1-d（有迁移风险） | 旧存量按 layout.id 键存；换键需带一次性迁移，留成套处理，避免丢已存场地偏好 |
| 壳体 `:335/:366/:367-369/:2017/:2050/:2057` plan 槽 | 显式取 prop，否则 `layout.id ?? prop` | outdoor plan 信封 | **B2/B4** | 槽位匹配随历史/镜像卡 |

## 5. 硬约束与门禁（每卡复用）

- **环境**：Node v26.2.0（`C:\Program Files\nodejs`，命令前置 PATH）；Node22 禁跑全量/build；24/26 不混跑。
- **冻结面**：routeBridge 九方法签名、`SitePlanData` 既有字段、`OutdoorTaskProgress` 结构、物料生成链路入参不变；可新增桥接方法/可选契约集合。
- **每卡验收**：`tsc --noEmit` exit 0；相关定向 vitest 绿；`npm run build` exit 0；全量对照最新锚点台账无增量回归；交互卡真机走查。
- **提交纪律**：本地攒好 tsc + 测试 + 真机验收后按 `AGENTS.md §六` 处理；不 `git add -A`；不强推、禁 `--force`；不夹带并行在途文件；不主动 push main；不触发付费生成。
- **不碰在途**：people/漫游线（`person-behavior`/`idle-crowd-pacer`/`zone-walk`/`people-anim`/`person-route`/`plan-walk-context`/`outdoor-route-line-layout`/`human-figure`）、`scendance-workspace` 系列；不回灌、不 revert 他人提交。
- **预存基线债**：jsdom/localStorage 环境红、计时 flaky、`case-activity-alignment` 首条、attach 夹具、creative-studio 环境性失败归 G1，不计入本切片回归；里程碑后重采新锚点台账。

## 6. 本轮边界与未做事项

- 本轮未推进 B2/B3/B4/E1–E4：硬门禁要求前一套验收合入后再开，不跳卡。
- 未删除任何室内壳体文件；未换历史快照；未改导出/写守卫；未动镜像回写。
- 遗留本地改动（非本轮，不夹带提交）：`.gitignore`、`docs/INDEX.md`；未跟踪产物 `deliverables/`、`design-drafts/`、`design-sketches/`、`flow/tasks/`、`frontend/public/scene-presets/`、`tools/`、`.worktrees/` 等不入库。
- 旧 79 backlog（#4/#7/#8/#9/#10/#11）与并行安全批次（死簇/户型重建面板/旧 run 残留）不阻塞本主线，另行排期。

## 7. 终态达成度与阻塞突破路线（2026-11-22，「全部完成、突破阻塞」定标）

> 本节把终态四条件逐项盘点到当前代码状态，把阻塞分成「本地可攻坚 / 必须外部条件 / 必须拍板 / 串行门禁」四类，标清每一类的解锁条件与本轮可执行边界。对照终态书 `2026-11-21-first-principles-endstate.md` §0.2/§0.5。

### 7.1 四条件达成度盘点（对照终态书 §0.2）

| 条件 | 当前达成 | 差距归属 |
| --- | --- | --- |
| ① 状态正源单一 `SitePlanData` | **未达成**：`layoutStore` 仍是现役读写源；历史快照、物料/选中/墙操作、导出链路走 `RoomLayout` | B2 历史快照换 plan；B4 回写镜像退役 |
| ② 身份单一 projectId | **部分**：会话域（主 `sessionScope`/`getStoreSessionScope`/activity tracker 源）已收敛到 `activeProjectId` 同源（B1-a、B1-b 已落地提交 `e0620221`）；简报/候选库存/草稿围栏/订阅/归档/环境偏好仍挂 `layout.id` 或旧 `activity:` 仓 | B1-d 成套归位；B4 归档/发布域 |
| ③ 呈现只留地图侧 | **未达成**：保活 Viewport、室内 three renderer/scene/camera、2D 编辑态与驻留 hooks 仍在 | E2 卸保活/室内 three/2D；E3 删室内墙模型与 hooks |
| ④ 通路 plan 化 | **未达成**：云端读写、本地备份恢复、导出仍消费 layout；写守卫基于 layout 身份 | B3 导出与写守卫 plan 化 |

> B1-b 去回退已落地但属「待验收过渡态」：无壳体绿测保护、无真机走查；在 B1-e 验收合入前不算身份条件闭合。

### 7.2 阻塞分层（四类，解锁条件互不替代）

- **A 本地可攻坚**（夹具 / 静态 / 类型，不依赖真机与拍板）
  - **A1 壳体整渲染夹具（#47，阻塞 B1-e）**：`canvas-session`(7) / `session-generation`(6) + `agent-panel` 簇。分层补：① 假 controller prop 注入（壳体 `:324` 收 `controller`，`:331` `providedController ?? createBackendSession()`，传桩绕开真实 IDB 账本、`navigator.locks`、30s 可见轮询）；② 会话/Agent 仓桩；③ 场景 hooks 返回空/静止态，不留 rAF/定时器；④ 地图/物料 stub；⑤ `./contexts` provider 注入。就绪信号换稳定锚点（壳体容器或 hook capture 回填），不依赖 AgentPanel 输入框；afterEach 清轮询/订阅/rAF。
    - *假控制器桩实测必须面（2026-11-22 按壳体 33 处调用点去重钉出，对照 `BackendSession` 公开签名 `backend-session.ts:422-515/979/1258`）*：字段 `config.apiUrl`；`retain(): () => void`（`:355`）；`getSnapshot(): {project?:{id},user?:{id}}`（`:381/:726/:1190/:1213/:1253/:3690/:3713/:3757/:3774/:4074/:4100/:4140/:4682/:4690/:4934`）；`subscribe(fn): () => void`（`:1324/:3747/:3775`）；`businessRequest<T>(path,method)`（`:1224/:1255/:1260`）；`savePreferences(prefs)`（`:3696`）；`getPreferences()`（`:3731`）；`listStudios()`（`:3761`）；`getStudioSettings(id)`（`:3764`）；`localDraftAuthorityVersion(): string`（`:4683/:4690`）；`authorizeAsset(assetId)`（`:5535`）。`canCreateUnboundLocalDraft()`/`isGeometryBound()` 按面板实际调用补。参照现成桩模式 `app/page.test.tsx:78` mock `createBackendSession` 返回桩对象。
    - *A1 探针实测（2026-11-22，session-generation 第一对话链例临时去 skip，跑完回退、无入库半成品桩）*：现状 `canvas-session` 7 绿、`session-generation` readiness 2 绿/4 skip。去 skip 跑 `discards an old reply across A→B→A`：输入框可找到（壳体已渲染到 AgentPanel 输入层），但点「发送」后 `resolveBriefTurn` 调用计数 0。**崩点不在 renderer/three/2D，而在会话仓未绑定**：`useAssistantSessions` 模块单例在空草稿活动下 `ready/activeId` 为空，`:1127` effect `!assistantSessions.ready` 提前 return，`:1138` `boundSessionId.current` 不绑定；`:3934` `canForward` 要求 `!!session && getActiveAssistantSessionId(sessionScope)===session`，`:5251` 发送按钮 `canSend` 关闭，handler 不进模型链路。下一施工批桩序：**②会话仓优先**——`useAssistantSessions` 控面返回 `{ready:true,activeId:<固定id>}`，且 `getActiveAssistantSessionId(sessionScope)`/`sessionExists` 返回同 id（模块级 seed index 或 hook mock 二选一，参照 `agent-panel.react.test.tsx:21` 已注入面）；再补 studio controller/activeProvider（`trackModel` 判定 `:3612`）与 venue facts/scale current（`:3638/:3639`）。`sessionScopeIsCurrent`（`:709`）legacy 回退恒真，新源走壳体 `isSessionCurrent`，非本崩点。
    - *A1 探针实测第二、三轮（2026-11-22，会话仓桩面验证后回退，无入库半成品桩）*：按上批桩序在套件内 mock `./hooks/use-assistant-sessions`——必须 `importOriginal` 展开 actual 再覆写，纯对象 mock 会因面板 `:1157` 读 `getAssistantSessionBodies` 报「缺导出」；覆写面：`useAssistantSessions` 返回 `{ready:true,saveFailed:false,activeId:'probe-active-session',activeSession:{id,title:'新会话'},visible:[],totalCount:1,openSession()=>({id,verifiedFresh:false}),其余 no-op}`，并覆写 `getActiveAssistantSessionId→activeId`、`assistantSessionExists→true`、`subscribeActiveAssistantSession→no-op unsubscribe`、`scopedAssistantStorage→undefined`。**第一道崩点（会话仓未绑定）解除**：readiness 两例转绿，套件从 2 passed/4 skip 推进到 3 passed/1 failed/3 skipped。
      - **第二道崩点更正：登录门控 `loginBlocked`（非上一版误判的会话围栏）**。上一版「排除登录门控」的 disabled 快照读取时机在 `fireEvent.change` 之前，不准；第三轮 change 后实测 `inputDisabled=true`，body 出现登录卡与未登录视图。链路：`loginBlocked = outdoorWorkflow.loginRequired && !loginSatisfied`（`:4718`），未登录且「80 人的活动」非 `matchesLocalOutdoorCommand` 本地白名单句 → `composerEnabled=false`（`:4720`）→ textarea 与发送键禁用，`submitComposer:4510` 早退，不进 send。**桩路径已验证可行**：`probeController.snapshot.user={id,email,is_anonymous:false}` 注入非匿名 owner 后 `inputDisabled=false`、登录卡消失、视图切到已登录 owner，门控解除。注：`getStoreSessionScope()===sessionScope` 与 activity tracker 源三者同取 `activeProjectId`（`project-session-scope.ts` 恒等派生），`isSessionCurrent`（`:4511`）非当前崩点，降为后续候选。
      - **第三道定性：这不是又一道门控崩点，是测试锚点挂错链路（bridge 路由归属岔路）**。静态核查 `send()`：`routeBridgeRef.current?.applyPlan` 存在且 `workbenchMode==='layout'` 时，消息在 `:3324` 直接 `await outdoorWorkflow.handle(...)` 并 `return`，**不进** legacy brief 链路的 `:3657 resolveBriefTurn`；legacy resolver 仅在 bridge 未注册时兜底。bridge 由 `OutdoorPlanOverlay` 挂载 effect（`outdoor-plan-overlay.tsx:685`）注册，`applyPlan` 是函数即 truthy（内部 `canvasApiRef` 为 null 时返回 false 不影响外层存在性判定）；测试壳体渲染了 overlay（body 见用地红线/分区/图层），故 bridge 已注册，消息全走 workflow，mock 的 `agent-resolver.resolveBriefTurn` 计数恒 0——与门控、venue facts、`:3623/:3638` 无关。workflow 模型走 `controller.briefExtract`/`briefConversation`（`agent-resolver.ts:182`），其未启用/匿名回退「活动问答暂未启用」即 body 所见气泡。
      - **悬置决策点（2026-11-22 已拍板：路线 A）**：观测锚点换到 workflow 出口。4 例真实保护的语义是会话/批注捕获围栏（A→B→A 迟到回复丢弃+草稿留存、提交使旧 capture 失效+理解中拦新 capture、理解失败本地人数仍可导出、旧 zone 预览同批切回拒绝），`capture.dialogue`（`usePlanAnnotations`）锚点保留；中间量由 resolver 计数换成 `controller.assistantChat` 调用与 workflow 产物（proposal/bridge.applyPlan/say 气泡）。参照 `use-outdoor-agent-workflow.react.test.tsx:88-127` Harness：bridge 桩 `getPlan/applyPlan/applyVenue/...`，controller 桩 `assistantChat(message,history,signal,purpose,provider,model)` 返回 `{status:'ok',answer:JSON.stringify({action,reply,references,facts,...extra})}`。
      - 下一施工批桩序（路线 A，分批落地）：①会话仓绑定面 mock（已验证）→ ②controller 快照注入非匿名 owner user（已验证）+ `assistantChat` 桩返回契约化响应 → ③plan bridge：overlay 内 canvasApiRef 为 null 时补 `getPlan` 返回有效 StarterPlan（含 boundary/zones）、`applyPlan` 桩记录调用 → ④跑通到 `outdoorWorkflow.handle` 可观测出口，再逐例把 4 例 resolver 计数断言改写为 assistantChat/workflow 产物断言；mapContext/选址/流线等缺件按例补桩。legacy resolver 兜底链路不在本批覆盖。
      - *A1 探针实测第四轮（2026-11-22，路线 A 桩序 ①② 落地，代码桩本地攒着未提交 main）*：会话仓 mock + 非匿名 owner 快照 + chat 桩落进 `session-generation` 套件，capture 新增 `chatCalls` 观测面、beforeEach 清零。**关键坑：必须双桩 `assistantChat` 与 `assistantChatStream`**——理解层 `outdoor-agent-understanding.ts:373` 流路径优先（`onThought && controller.assistantChatStream` 即走流式），只覆写 `assistantChat` 时原型 `assistantChatStream` 仍走真实未配置后端，返回 `disabled/unavailable` → 面板落「活动问答暂未启用」气泡，`chatCalls=0`；双桩同返回 `{status:'ok',answer:JSON.stringify({action:'ask',reply:'',references:[],facts:{}})}` 后，第一例 `discards an old reply across A→B→A` 进 workflow 出口、`chatCalls=1` 转绿。实测套件 **3 passed / 3 skipped**，前端 `tsc --noEmit` exit 0；`snapshot` 为 private，注入 user 时整对象 `as unknown as {snapshot:{user:unknown}}` 遮蔽访问。
        - 待续下一批：③plan bridge 补有效 StarterPlan（boundary/zones）与 `applyPlan` 调用桩；④其余 3 例观测点从 legacy resolver `calls`/`capture.dialogue` 计数改写为 workflow 产物（proposal/bridge.applyPlan/busy 理解中态/ say 气泡）：例2 提交使旧 dialogue capture 失效+理解中拦新 capture、例3 理解失败本地人数仍可导出（桩返回 `disabled` 对照本地 brief headcount）、例4 旧 zone 预览同批切回拒绝（纯 annotation 预览守卫，不经过模型）。
        - *A1 探针第五轮（2026-11-22，例4 临时去 skip 探针后回退，无入库半成品桩）*：**例4 定性修正——不是「纯 annotation 预览守卫、不过模型」**。探针崩在 `findByRole('应用布置')` 超时：该按钮只在存在 zone 预览候选时渲染，真实壳体候选来自 workflow zones proposal（`zoneProposal`/`applyZoneProposal`），annotation `addZoneRects` 只落批注草稿、不挂可应用候选。例4 同样依赖桩序③先造出预览候选，再测 A→B→A 切回后的守卫拒绝，不能脱离 workflow proposal 独立转绿。
        - 例2/例3 接线面与挂起理由：`captureDialogue` 注入需仿 `room-organizer-dialogue-review.react.test.tsx:14-20` 包一层 `CreativeStudioProvider` 回填 `props.captureDialogue`；壳体 `captureDialogue`（`room-organizer.tsx:4727`）非 null 强依赖 `reviewedDialogueHistory`（先走完历史 review）、`sessionToken/floorToken/activitySession.isCurrent`、`briefCaptureEpoch` 等 review 通路围栏。这些多为 legacy review 通路产物，workflow 新通路是否保留等价围栏、headcount 本地兜底从哪份 brief 读，需逐例对照产品口径后再定观测点；本批不硬套旧 resolver 计数断言，挂起待桩序③与口径复核。
        - *A1 探针第六轮（2026-11-22，桩序③ bridge 桩面落地，临时 scope 探针取证后回退；代码桩本地攒着未提交 main）*：套件 mock `./components/outdoor-plan-overlay` 默认导出 `StubOverlay`，在 Provider 内 `useAgent()` 取实例、effect 注册桩 bridge——`getPlan` 返回带矩形 boundary 的 `createStarterOutdoorPlan()`、`projectId→'probe-project'`、`selectedIds→[]`、`applyPlan`/`applyZoneProposal` 计数并返 true（`applyPlan` 回写 `stubPlan`）、`applyVenue`/`beginVenueBoundary`/`applyRoutes→true`；capture 新增 `applyPlan`/`applyZone`/`agent` 观测面，beforeEach 清零。scope 临时探针：双 chat 桩返 `action:'scope'` 契约，发「帮我核对这次的实际活动场地」→ `chatCalls=1`、`applyPlan=1`、`stage='zones'`，scope 提案被**自动应用**（未停在确认卡），body 见「已应用『确认当前活动范围』」。证明 bridge 桩面在真实壳体可推进 workflow。
        - 新岔路（待口径复核）：面板并存两套分区预览——legacy 模板 `zoneProposal`（`setZoneProposal` :809、`buildZoneEventProposal` :1903，依赖 memory.event/headcount、`plan.nodes` 入口与 boundary，确认走 `confirmZoneProposal`→`applyZoneProposal`，plan 基线守卫 :1932）与 outdoor workflow `proposal.kind='zones'`。例4「应用布置」按钮归属哪一套、A→B→A 守卫语义对应哪条链路，需对照产品口径后再定观测点，本批不硬接。
        - 旁证留意：首条消息后 body 末出现「另一个窗口正在编辑这份活动；本窗口暂不保存」lease 并发提示，后续导出/回写例需确认其是否干扰 capture 与断言。
        - *A1 探针第七轮（2026-11-22，zones 双轮提案探针 + supervision 档位定性，临时例取证后回退；代码桩本地攒着未提交 main）*：双轮 turn 闭包桩第 1 次 `action:'scope'`、第 2 次 `action:'zones'`（facts.event/guests/zones 照抄 `agent-panel.react.test.tsx:5036`）。**默认 supervision 档（key-points）下 scope 与 zones 两轮提案都被自动落地**：`chatCalls=2`、`applyPlan=2`、`applyZone=0`、`stage='objects'`、`proposalKind=null`；zones 经 `applyPlan` 回写（非 `bridge.applyZoneProposal`），进到 objects 阶段后物料库缺「市集摊位」件，body 落「真实物料库尚未找到尺寸与模型可用的市集摊位；未自动创建收费生成」。
          - **挂起候选必须切 strict 档**。`agent-supervision.ts:91 gateAction`：`read` 任何档不问；`paid/external/irreversible` 必问；`auto` 普通写入不问；`destructive/bulk`（>100 件）在 key-points 也拦；**`strict` 档所有 write 都拦**；认不出回落 key-points。zones 提案动作是普通 write（非 destructive/bulk），故默认 key-points 档 `required=false` → `use-outdoor-agent-workflow.ts:1107 !checkpoint && !gate.required` 直接落地；要造出「挂起旧 zone 预览」候选态，测试壳体须预置 `localStorage['scendance.agent.supervision']='strict'`（`agent-supervision-store.ts:6/:11`，套件 MemoryStorage mount 前 `setItem`）。
          - **strict 档实测 zones 挂起成立**：预置 strict 后 scope 先挂起、点「确认并应用这一版」应用 1 次（`applyPlan=1`），再发 zones → `proposalKind='zones'`、`hasBase=true`（基座快照在 proposal.base）、`stage='zones'`、`busy=false`、`applyZone=0`、zones 未应用；body「已生成『分区用途与室内外属性』预览」「待你核对」「分区用途与室内外属性会写入画布，严格档下每步都先问你」。**zones 确认按钮文案是「确认分区并预览物料排布」（zones 专用），不是通用「确认并应用这一版」**（后者只在 scope 卡）；旁有「撤回预览」。
          - **workflow 确认守卫等价点（例4 候选观测位）**：`use-outdoor-agent-workflow.ts:1115 confirmProposal`——`:1117 expected && proposalRef.current !== expected` 过期卡比对；`:1124-1133` 无 p/plan/`callbacks.current.current(p.epoch)` →「当前规划已变化，旧提案已失效」；`:1146 baseStillIntact(baseObj,plan)` 基座被删改/边界锚点变了失效（`p.kind==='scope'` 特例只锁边界锚点）；`:1160-1173 mergeLatest` 按最新画布并回新增实体；`:1176-1187 owns()` 校 epoch/scope/actorId/current 围栏。例4「应用布置」A→B→A 切回拒绝在新通路对应这套守卫，**不是** legacy `zoneProposal` 的 `:1932` plan 基线守卫。
          - 待下一批：⑧ strict 档夹具下复跑例4——先挂起 zones 候选（proposal.base/epoch/scope 快照），同批切走再切回，点「确认分区并预览物料排布」断言被守卫拦下（过期/基座失效文案）；A→B→A 在 plan 新通路的等价切换物（projectId 源 / epoch 推进）需对照 B1 scope 口径再定，不硬套旧 layout.id 切换。例2/例3 的 dialogue capture 围栏与理解失败 headcount 兜底等价物仍悬置（见 :184）。
        - *A1 探针第八轮（2026-11-22，例2 转绿；例3/例4 定性挂账，临时探针例取证后回退；代码桩本地攒着未提交 main）*：套件补 `./panels/creative-studio` mock，仿 `room-organizer-dialogue-review.react.test.tsx:14-20` 包一层 `CreativeStudioProvider`，把 `props.captureDialogue`（getter 函数）回填到 `capture.dialogue`；注意运行态 `capture.dialogue` 存的是 **getter 函数引用**，取本体要再调一层 `getter()`，类型声明同此口径。
          - **例2 已转绿**（`invalidates an existing dialogue capture at submit and blocks new captures until interpretation finishes`）：桩面（会话仓 mock + 非匿名 owner 快照）下 capture 直接有效，无需点「按当前记录重新开始」review。围栏节奏实测成立：`send` 同步 `beginDialogueTurn`（`room-organizer.tsx:447` `pendingDialogueTurns.add` + `briefCaptureEpoch++`）→ 旧 capture `isCurrent()===false`、理解中 `getter()===null`（`:4729` pending 非空拦新 capture）；turn 结束 `release()`（`:448` 清空 + epoch++）→ 新 capture `isCurrent()===true`。断言从 legacy resolver `calls/resolve` 计数改为 workflow 产物（旧 capture 失效 / 理解中拦新 / 结束后新 capture 可用）。套件 **4 passed / 2 skipped**，前端 `tsc --noEmit` exit 0。
          - **例3 定性挂账（保持 skip，不硬做）**：`understanding fails 时本地人数仍可导出`。静态核查 + 探针：workflow 把人数存进内部 `plan.brief.guests`（`use-outdoor-agent-workflow.ts:1685/:1884/:1919`），**不回写** legacy `memoryRef` / `agentBriefRef`；壳体 `captureDialogue` 的 `project()` 读 `getActiveBrief()`（`agentBriefRef`，由 `onBriefMemoryChange` 喂）。探针实测新通路 `availability='available'`、`headcount={status:'unknown',value:null}`——两份 brief 未打通。workflow 分支 `agent-panel.tsx:3324` `handle(...)` 后直接 return，不走 legacy `saveMemory`/`onBriefMemoryChange`。**两条 brief 打通属 B2（历史快照换 plan）/ B3（导出 plan 化）范畴**，A1 夹具不补；理解失败兜底 headcount 从哪份 brief 读，待 B2/B3 口径。
          - **例4 定性挂账（保持 skip，不硬做）**：`旧 zone 预览同批 A→B→A 切回拒绝`。身份切回守卫在 `confirmProposal` 的 `owns()`（`:1176-1185`：abort token / `token.current===p.epoch` / `scopeRef.current===confirmationScope` / actorId / `current(p.epoch)`），回调接线 `agent-panel.tsx:1076`（`scope:sessionScope`、`begin:beginOutdoorTask`、`current:currentOutdoorTask`、`controller:studioRef.controller`）。要复现 A→B→A 必须能切会话/项目使 scope 与 epoch 失效；当前桩面会话仓 `activeId` 固定、bridge `projectId` 固定 `'probe-project'`，无切换入口。另一支 `baseStillIntact` 基座失效（`:1146`）虽可在桩面改 `stubPlan.boundary` 触发，但语义是「基座被删改/边界变」，不是旧例4 的「会话切回」，不能冒充同一条守卫。待 B1 scope 夹具可切会话/项目，或产品口径确认例4 观测点落到基座分支。（→ 第九轮已按新通路 A 转绿，见下条；本条为挂账期定性留档。）
          - *例4 桩面通道静态核查（2026-11-22 晚，未落码）*：scope 唯一切换入口是壳体 prop——`room-organizer.tsx:325` 收 `outdoorProjectId`，`:327` state、`:328` effect 同步；`:391 activeProjectId=prop??DEFAULT`、`:393 sessionScope=projectSessionScope(activeProjectId)`（`project-session-scope.ts:11-14` 按 id 产 `project:<id>`）。**不读 `layout.id`、不读会话仓 activeId**，故套件只 `layoutStore.setState` 换 layout.id 不改变 scope（例1/旧例4 体走的是这条无效路径）。夹具切口（未写）：重渲染换 `outdoorProjectId` prop 到另一 id → `sessionScope` 变 → `agent-panel.tsx:805` effect `stopOutdoorTask()`（`beginOutdoorTask(null)`：epoch++、kind=null、abort 旧请求）→ `confirmProposal` 的 `owns()` 同时丢 `scopeRef===confirmationScope`、`current(epoch)`（`:798` 校 epoch/kind/scope 三者）、`token.current===p.epoch`。**悬置决策（待拍板，不代选）**：观测点落新通路——workflow zones 挂起候选 + `confirmProposal` owns() 守卫（终态 plan 身份方向，zones 确认按钮「确认分区并预览物料排布」）；还是旧通路 legacy `zoneProposal`/annotation 预览守卫（随 E4 退役）。新通路需 strict 档预置 zones 挂起候选（第七轮桩序③⑦已验证可行）。
          - *A1 探针第九轮（2026-11-22 晚，例4 按新通路转绿；桩入套件本地攒批，未推 main）*：用户拍板「怎么快就选哪条」，择优落 **新通路 A**——旧通路连「应用布置」候选按钮都造不出（第五轮超时），且 legacy `zoneProposal`/annotation 预览随 E4 退役，保护价值低。落地改动（仅 `room-organizer-session-generation.react.test.tsx`）：① beforeEach 预置 `AGENT_SUPERVISION_KEY='strict'`（MemoryStorage mount 后写入）；② chat 桩改响应队列 `capture.responses`，按轮次 shift 返 scope / zones 契约，空回落 `ask`；③ 渲染带 `outdoorProjectId` prop，例内 `rerender` 换 `probe-project-b` 再回 `probe-project-a` 驱动 scope/epoch 失效。流程取证：scope 轮出 `proposal.kind='scope'` → 点「确认并应用这一版」→ `scopeConfirmed()` 真；zones 轮出 `proposal.kind='zones'` 挂起（metrics `preview` 挂起、`apply=null`，未 confirm/applied）；rerender B→A 后断言 `proposal===null`、`stubPlan.zones` 未增、`applyPlan` 计数未增、`applyZone===0`。测的是新通路 `confirmProposal` 守卫的 scope/epoch/current 围栏，**不冒充** `baseStillIntact` 基座被删改分支；legacy annotation/`zoneProposal` 通路本批未覆盖。结果：套件 **5 passed / 1 skipped**（例3 仍 skip）；底座三套件 54 passed / 1 skipped；前端 `tsc --noEmit` exit 0。
  - **A2 旧 `activity:` 仓写方图谱（#54，#48 前置）**：列全生产代码读写方，判定现役会话仓是否已全在 `project:` 前缀、旧仓残留是否仅只读兼容分支。纯静态读取，不动码。
  - **A3 ④ 语义/夹具残留定性（#55）**：batch11 残留 ④ 红逐条对照产品口径，定性源码 bug / 过时断言 / 真实产品语义；证据足才对齐断言或报 bug，不足挂账。
- **B 必须外部条件**（真机 / 账号，本环境不能伪造）
  - **B1-e 真机走查（#49 前置）**：切项目不串会话、新建活动各落各槽、无参刷新续开符合方案 B；需浏览器有效登录态。当前 in-app 浏览器登录状态以现场为准，不伪造账号或会话。
- **C 必须产品口径拍板**（到决策点停住等用户，不代补需求、不代确认路径、不代选候选）
  - **C1** 无参刷新草稿索引恢复档位/优先级：`listOutdoorProjectRecords` 读取地基已就位，是否自动续最近本机草稿未定。
  - **C2** 旧 `activity:` 存量会话/偏好的迁移或只读承接口径；环境偏好键换键的一次性迁移方案（防丢已存场地偏好，终态书 §0.5「身份迁移漂移」反例）。
  - **C3** ④ 语义红逐条产品口径判定（追问 notice、控件门控、几何计数/摘要口径等）。
- **D 串行门禁**（不跳卡）
  - B1-e 验收合入 → B2 → B3 → B4 → E1 → E2 → E3 → E4；前一套验收合入才开下一套。

### 7.3 解锁链条

```
A1 壳体绿测保护 ─┐
A2 旧仓图谱 ─────┼→ B1-d 成套归位（#48）→ B1-e 验收（#49：A3 定性 + B 真机 + C1/C2 口径）→ 合入
A3 残留定性 ─────┘                                                                      │
                                                                                        ▼
                                                              B2 → B3 → B4 → E1 → E2 → E3 → E4
```

### 7.4 本轮可执行边界

- 本地先推 A1 最小探针：传假 controller prop + 已识别 mock 层，取渲染期第一个真实崩点与缺失模块清单；不追求一次全绿；探针结论落台账，不入库半成品桩（避免终态书 §0.5「假绿」反例）。
- 不跳卡：B2–E4 不动码；不伪造登录态/降级路径；C 类口径停住等拍板；不触发付费生成。

### 7.5 旧 `activity:` 仓生产代码触点初表（2026-11-22 静态核查，A2 进行中）

| 触点 | 现状 | 归属 |
| --- | --- | --- |
| `panels/creative-studio.tsx:516/:579/:619/:634/:1908` | 订阅/读取旧 `activity:${layout.id}` 仓（brief 候选库存、未发送草稿、恢复锁比对、清缓存订阅、候选读取） | B1-d 切仓对象 |
| `lib/activity-session-epoch.ts:7/:20`、`lib/floor-session-epoch.ts:18` | `activityScope(layout.id)` epoch 派生 | 室内语义，E3 随 epoch 退役 |
| `lib/agent-annotation-review.ts:55`、`lib/agent-annotation-observation.ts:18` | `binding.activityScope` 校验 `startsWith('activity:')` 与尺度比对 | 标注 epoch 域，随退役成套评估 |
| `panels/agent-panel.tsx:2509` | `sessionScope.startsWith('activity:')` 旧仓只读兼容判断 | B1-d 后随旧仓退役评估 |
| `panels/venue-facts-panel.tsx:15`、`lib/venue-facts-storage.ts:6` | 场地事实记忆键 `activity:<activityId>` | B1-c/E2，随休眠面板清 |
| `panels/scene-delivery-panel.tsx:356` | note scope `activity:<id>` 字面量（导出时剥前缀） | B3 |

> 待 #54 补齐：现役会话仓写入方是否已全部走 `project:<activeProjectId>`（`LayoutAgentProvider` 注入），旧 `activity:` 仓是否还存在写入方，还是仅剩上述只读/派生触点。
>
> **#54 初判（2026-11-22，静态）**：现役 Agent 会话写入方 `useAssistantSessions(requireSessionWrite, sessionScope)`（`agent-panel.tsx:706`）的键即 Provider 注入的 `sessionScope`，壳体 `:4988` 传 `projectSessionScope(activeProjectId)` = `project:<id>`（`project-session-scope.ts:11-13`）。**Agent 会话链已切到 `project:` 新仓，旧 `activity:` 仓在该链上无现役写入方。** 未跟随的裂缝是 `creative-studio.tsx` 仍订阅/读取 `activity:<layout.id>`（:516/:579/:619/:634/:1908）：它订阅的旧仓与 Agent 写入的新仓是两个仓——候选库存/未发送草稿/恢复锁比对读不到新仓会话。其余 `activity:` 触点为 epoch 派生、标注 binding 校验/比对、旧仓只读兼容判断、venue-facts 记忆键、导出 note 字面量，均非会话写入。完整写方图谱留到 #48 成套前复核。

### 7.6 B1-d 第一性施工切片（2026-11-22 定标，待壳体夹具保护后落码）

**第一性口径（终态书 §1.1/§4.2/§4.3）**：身份只认 plan 槽 projectId；旧 `layout.id` / `activity:` 仓是室内历史层，随影子退役，**不做专门数据迁移**。未发送消息、agent-run 标记、apply-recovery 锁是会话临时物，不跨身份迁移；已保存方案内容（brief）随 plan 仓承接（B2）。`legacySessionScope` 一次性承接读到退役。此口径回答 C2：旧仓不搬、不强制只读降级，退役时清。

**会话仓裂缝实测证据**：
- 会话仓 `scopedStore(scope)` 以 scope 字符串直接分桶（`use-assistant-sessions.ts:350-356`），与 source-storage 持久桶是两套独立命名空间。
- 写入方 AgentPanel：Provider 注入 `sessionScope`（壳体 `:4988`）= `project:<id>`；壳体 `:449` 订阅同键。
- `creative-studio.tsx` 却订阅/读取 `activity:<layout.id>`，命中空旧仓：收不到现役会话失效通知、读不到现役 chatId。

**片 1 · 会话仓对齐（独立可落地，不碰持久桶）**：
- Props 加 `sessionScope?: string`；壳体 `:4942` 下传 `sessionScope={sessionScope}`。
- Provider 内派生 `chatSessionScope = sessionScope ?? \`activity:${layout.id ?? ''}\``（legacy 回退，测试路径不变）。
- 会话仓键触点逐点（2026-11-22 追全来源链）：
  1. `:516` 候选失效订阅 `subscribeActiveAssistantSession(\`activity:${layout.id??''}\`, …)`；effect dep `[pendingCandidates,controller,layout.id]` → 换 `chatSessionScope`，dep 补 `chatSessionScope`。
  2. `:579` 导出围栏 `chatScope=\`activity:${base.id}\``（base=layoutRef 快照）；`:585`/`:593`/`:596` 同围栏 `getActiveAssistantSessionId(chatScope)`/`subscribeActiveAssistantSession(chatScope,…)` 同源换键。
  3. `:617-621` `inventoryScope`：比对 `chatScope!==\`activity:${activity}\``（activity=layoutRef.current.id）→ 比对换 `chatSessionScope`；库存身份键 JSON `[apiUrl,actor,activity,chatId]`（`:620`）暂留 `activity=layout.id`，归片 2 持久桶切换。
  4. `:634` 清缓存订阅 `chatScope=\`activity:${layoutRef.current.id??''}\``；effect dep `[controller,layout.id]` → 换 `chatSessionScope`，dep 补 `chatSessionScope`。
  5. `:1908` `applyCandidate`：`chatScope=\`activity:${selected.layout.id??''}\``（**候选方案 id，不是当前会话源**）→ 片 1 必须改用当前 `chatSessionScope`，不得沿用候选 `selected.layout.id`；否则候选影子 id 会读错会话仓。
- 保护：面板 320 测试不传 `sessionScope`，走 legacy 回退；`project:` 新路径待壳体夹具 + 真机覆盖。

**片 1 本地落码记录（2026-11-22，未提交、未推 main）**：
- 改动文件：`panels/creative-studio.tsx`（Props 加 `sessionScope?`；解构；派生 `chatSessionScope`；上述 5 组键切换 + 2 处 effect 依赖补 `chatSessionScope`）；`room-organizer.tsx:4946` Provider 下传 `sessionScope={sessionScope}`。diff +12/−10，未触持久桶 `scope`/`agentScope`（片 2 范畴）。
- 验证：前端 `npx tsc --noEmit` exit 0；`creative-studio.react.test.tsx` 定向 320 passed / 46 skipped / 0 failed（与基线一致，legacy 回退路径无损）。
- 全量对照（日志 `%TEMP%\scendance-full-b1d1.log`，基线 `scendance-batch11.log`）：文件级 34 failed / 808 passed 与基线一致；测试级 553 failed / 10143 passed / 75 skipped（基线 552 / 10144 / 75）。差集仅 1 例新增：`app/page.test.tsx > …keeps the draft across the legacy /auth redirect`，15000ms 超时挂起；**单跑该例 4135ms 通过**，判定全量并发冷模块图时序偶发（#47 壳体夹具债族），非片 1 确定性断言破坏；无修复例、无其他新红。
- 门禁状态：片 1 本地攒着，不合入 main；待 #47 壳体夹具绿 + #49 真机三 flow 后随 B1 成套合入。片 2 仍前置片 1 合入 + 夹具 + 真机。
- **合入记录（2026-11-22）**：片 1 生产码 + 4 夹具 + 台账随提交 `945b5749` 推 main（`da3ecda2..945b5749 main -> main`，普通 push、未强推，本地/远端 0/0）；9 文件 +398/−42。提交前撤出暂存夹带 `.gitignore`（UU 冲突未决，工作区保留未入库）与 `docs/INDEX.md`，未跟踪目录/产物/凭证均未入库。flow2 新建 mint 独立槽对照仍挂账；片 2 持久桶切换待本批合入后开启。

**片 1 收尾复核（2026-11-22，本地攒批未提交）**：
- 两处订阅 effect 残留冗余 dep `layout.id` 已清：`:513-520` 候选失效订阅、`:635-645` 库存清缓存订阅。函数体均已不读 `layout.id`，订阅键变化由 `chatSessionScope` 捕获，去 dep 行为等价；dep 收敛为 `[pendingCandidates,controller,chatSessionScope]` / `[controller,chatSessionScope]`。
- 片 1 五触点复核到位：`:518` 候选订阅、`:581/:587/:595/:598` 导出围栏、`:621` 库存仓比对、`:643` 清缓存订阅、`:1910` applyCandidate 均取当前 `chatSessionScope`；`:1908` 不再沿用候选 `selected.layout.id`。库存身份键 JSON `[apiUrl,actor,activity,chatId]` 的 `activity=layoutRef.current.id` 仍留片 2 持久桶切换。
- 面板外触点核对：`bingo-audit-card` 的 `scopeKey` 由 agent-panel 传 `agent.sessionScope`（壳体注入的 `project:` 正源），内部 `projectSessionScope(plan.projectKey)` 比对一致，✅ 无 layout.id 残留；`original-scene-review-panel` 的 `scopeKey=${projectId}:${token.epoch}` 是旧云项目只读降级通路本地作用域键，属白名单保留。
- 验证（Node26）：`tsc --noEmit` exit 0；定向三套件 EXIT=0——canvas-session 7 passed、session-generation 2 passed/4 skipped、creative-studio 320 passed/46 skipped（合计 329/50，与基线持平，无回归）。
- **方案 B 本机活动兜底（同批落码，配套单测）**：`outdoor-project-store.ts` 加 `LOCAL_ACTIVITY_ID_PREFIX='house-'` 与 `latestLocalActivityRecord()`（枚举草稿索引取 updatedAt 最新的 `house-*`，跳过 `replica-*` 副本与 `default-outdoor`）；`workspace-shell.tsx` `decideDefaultOutdoorProject()` 优先级改为「最近指针（云项目/案例副本）→ 最近本机 `house-*` 活动 → 默认草稿」，无参兜底续回本机活动时把身份写进 URL（`project=<house-*>&mode=outdoor`），二次刷新走带参解析；`fresh` 判定同时要求指针与本机活动都缺失才弹云端找回。`outdoor-project-store.test.ts` 补 3 例（最新 house- 命中 / 仅 replica+默认返 null / 空存储返 null）。

**旧 `activity:` 前缀闸门挂账（A3 #55 / B1-d 成套复核，本轮不改码）**：新会话源统一 `project:<id>`（`projectSessionScope`），下列闸门仍按旧 `activity:` 前缀判定，在新源下语义需路线 1 真实挂载 + 真机逐条定性，不在无保护下动：
- `agent-panel.tsx:2509` `localDraftAllowed`：`sessionScope.startsWith('activity:')` 为第一条件。新源本地活动键已是 `project:house-<uuid>`，该条件恒 false；本地/云区分实际由 `isLocalActivityWorkspace(owner)` + `canCreateUnboundLocalDraft()` 承担。疑似误关本地课桌椅草案通路（`runLocalSeatingDraft` 入口 :2521 与守卫 :2338/:2348/:2572/:2684/:2735），待真机本地草稿 flow 核对后定夺：删冗余前缀条件还是换 `project:` 判定。
- `lib/agent-annotation-observation.ts:18` binding schema refine 要求 `activityScope` `startsWith('activity:')`。壳体 :4704/:4716 绑入 `activityScope:sessionScope`（`project:`）→ zod 校验失败回 `unavailable`，标注观察可能读不出；待复核是放宽前缀还是字段随 plan 槽正源改名。
- `lib/venue-facts-storage.ts:6` 本地键派生按 `activity:` 前缀分流，非该前缀返回 null；venue facts 面板休眠，随 B1-c/E2 域一起清，不单独改。
- **2026-11-22 源码复核（#55，只读定性，未改码）**：三处闸门行号未漂移、定性维持。`LayoutAgentProvider` 的 `sessionScope` prop 默认 `'legacy'`，壳体 `:4998` 传 `projectSessionScope(activeProjectId)=project:<id>`（片 1 已接）；`:2509` 前缀条件在新源下恒 false，本地/云区分仍由 `isLocalActivityWorkspace(owner)` + `canCreateUnboundLocalDraft()` 承担，前缀条是冗余旧闸；annotation-observation zod refine 与 venue-facts 键分流现状同上。三处均待 B1 身份口径落定后随退役成套处理，不在无保护下改。

**静态门禁对照（2026-11-22，Node26，本地攒批）**：
- `npm run build` **exit 0**：编译成功、类型/lint 检查过、静态导出完成、`check-oneplan-artifacts` 扫描 3466 产物文件违规 0、postbuild 剥除完成。
- 全量 `vitest run` 对照基线 batch11（34 failed / 808 passed 文件级；552 failed / 10144 passed / 75 skipped）：本轮 **33 failed / 810 passed** 文件级，**543 failed / 10158 passed / 79 skipped** 测试级。差集：基线红本轮转绿 2（canvas-session、session-generation，路线 2 兜底预期内）；本轮新红 1 个文件 `three/glb-anim-verify.test.ts`。
- 新红定性：`plays the baked clip…` 例 `ENOENT: …docs/evidence/aholo/sculpture-rig-local/sculpture-local-rig.glb`；该目录仅入库 `.blend` 源与 png/json，`.glb` 是未入库的本机导出产物（untracked、未 ignore），测试硬读本机产物。单跑复现同 ENOENT，与本轮会话 scope/dep 改动路径无关；基线两次绿是当时本机留有该 glb。**不伪造资产、不提交证据产物**；归测试资产夹具债（#55）。无其他台账外确定性代码回归。
- **2026-11-22 复现取证（Node26，定向 `three/glb-anim-verify.test.ts`）**：结果 1 failed / 3 passed（共 4）；失败即蒙皮动画例 `plays the baked clip…`，ENOENT 读 `sculpture-local-rig.glb`（测试 :23 `readFileSync`、:75 喂给 `texturelessGlb`）；同文件 table（无 clip 旧三轴缩放）、legacy 三轴对照、临时目录读写 3 例均绿。目录 `sculpture-rig-local/` 仅入库 `.blend` 源 + png/json/py，无 glb；`assets/models/` 入库 5 个 glb（chair/laptop/plant/speaker/table）均为无蒙皮静态件，**替代不了蒙皮骨骼 + 烘焙 clip + 贴地/统一缩放断言（:107–126）**。处置选项挂账：① 缺 RIGGED 时该例按 `existsSync` 门控 `it.skip`；② 把导出门控的 rigged glb 作为受控测试夹具入库——需人拍板是否放松「证据产物不入库」口径。当前不提交证据 glb，不换静态件冒充动画通路。
- 静态门禁（tsc / build / 全量对照）本地已过；#49 真机三 flow 现状：flow 3 刷新续开 ✅、flow 1 双项目不串不丢 ✅（见下，附绑定域残留观察）、flow 2 新建 mint 独立槽挂账待多项目环境。

**静态门禁复核（batch12，2026-11-22 晚，HEAD `52fab815`，Node26）**：根 `npm run typecheck` exit 0；前端 `tsc --noEmit` exit 0；`npm run build` exit 0（静态导出，3454 产物，oneplan 违规 0，postbuild 剥除完成）。B1 底座三套件复跑 **53 passed / 2 skipped**（outdoor-project-store 42 + canvas-session 7 + session-generation 4/2 skip），与基线一致无回归。
- 全量 `vitest run`：**33 failed 文件 / 256 failed / 10472 passed / 77 skipped（10805 tests，845 文件）**；对照最近本地基线 `scendance-full-b1d3`（33 文件 / 251 failed / 10450 passed / 79 skipped，10780 tests，843 文件）。差集逐条定性：
  - 新增红 `panels/team-section.react.test.tsx` 5 例：远端并行提交 `41e52bce feat(account)` 带入；jsdom 下 `localStorage` 为 undefined，beforeEach `localStorage.clear()`（:36）首行即炸、controller 未初始化致 afterEach `dispose()`（:44）二次炸；套件未按 `MemoryStorage` 标准注入 `localStorage`（样板见 `app/page.test.tsx:110-115`）。非 B1 改动路径，归 account 批次夹具债，挂 #55。
  - 新增红 `hooks/use-outdoor-agent-workflow.react.test.tsx` 1 例「真实个人库复用→子线岗位→同plan3D替换/上传/生成表单，不启动收费请求」：people 轮 `terminal=local_done` 未出 workers 提案，:1189 `expect(flow.proposal).not.toBeNull()` 挂；隔离 `-t` 单跑仍红，非套件内状态污染。属上游 `78f8dfec fix(outdoor-agent)` 既有未修（该提交说明自认 hooks 套件 3 例失败 stash 前后一致、未修）；B1 未改 `use-outdoor-agent-workflow.ts`。同套件另 2 例为 #55 文案口径红。
  - *workflow 套件 3 例复核（2026-11-22 晚，Node26 定向：122 passed / 3 failed）*：① 个人库复用→岗位→3D 表单（:1124）：objects 轮（:1183）通过、facilities 落位 1 件；people 轮 turn「展览区安排 2 名保安」后 :1211 `expect(flow.proposal).not.toBeNull()` 收到 null，岗位/people 子线未出 workers 提案；根因待沿 people 分支提案链定位，不冒充夹具过期，上游既有未修。② 缺分区追问（:2647）：断言旧反问「要分哪些用途」；生产已按用户拍板（:82「AI 先当设计师先出一版」）改 zones 直接出默认预览卡，旧反问行为退役；后置活「后面还有：最后再调通道」仍由 `deferredNote`（:2032）接上，该断言应保留，夹具跟新口径、待产品确认后对齐。③ Lux3D 入口（:2707）：断言「勾选额度」，生产文案精简为「生成要先勾额度」（`outdoor-workflow-card.tsx:1007`），计费事实句保留；夹具过期，待对齐。三例均非本批身份兜底改动引入。
  - `panels/project-review-panel.react.test.tsx` 由红转绿（-1）。
  - 其余既有红同 #55 语义/夹具挂账，无台账外确定性代码回归。
- 结论：B1 本批次（片 1 / 片 2 / A1 夹具）生产码 0 改动，静态门禁无增量回归；真机 flow1/flow3 结论沿用上午取证，flow2 新建 mint 独立槽仍挂账待多项目/预览环境。

**真机走查（2026-11-22，本地桩 54329 + dev 3210）**：
- 环境：本地后端 `dev:agent`（agent-model-stub，PGlite，退出重置，预置 1 个云项目「智能建造联调项目」uuid `0dff1114-a35b-4619-880b-723d7f0dac9e`，house 槽 `house-gc5xt47q`）；前端 dev 起在 CORS 白名单端口 3210（3000 被转塘艺讯占用顺延；首落到 3002 不在后端 origins 白名单、预检被 CORS 拦，换 3210 后通）。owner 桩账号 password grant 200 发证，浏览器登录进 `/projects`。
- **已验证**：登录态编辑器正常打开；左侧会话面板按当前项目归属渲染（「当前活动 · 智能建造联调项目」）；**flow 3 刷新续开**——无参 `/editor` 刷新由 `latestOutdoorProjectId()` 续到 A（`house-gc5xt47q`），A 会话「新会话 14:53」保留在 A 槽、未串入默认草稿槽，符合方案 B「无参刷新回最近云项目，house-* 不顶最近指针外的自动续开」。
- **flow 1 切项目不串会话（真机对照，补第二 seed 后已走通）**：桩仅预置 1 个云项目 A，遂不碰生产码、在桩侧经 HTTP `POST /functions/v1/scene-api/projects`（owner password grant 200 发证，body `{studioId, name, scene:sceneSchema 空场}`）补建项目 B `782df575-33ef-4bac-9978-d1a5cd6c49b7`「走查对照项目 B」，列表 A/B 并存。对照取证：
  - A 基线：槽 `house-gc5xt47q`，归属「当前项目 · 智能建造联调项目」，会话列表一条「新会话 14:53」。
  - 开 B（`?project=782df575…`）：云层 `projects/782df…/lease/acquire`、`/sources`、`GET projects/782df…` 均走 B；会话列表为空，**A 的「新会话 14:53」未串入 B**；归属文案「当前项目 · 走查对照项目 B」。
  - 切回 A：归属回到「智能建造联调项目」，**会话「新会话 14:53」仍在、未被 B 覆盖或丢失**。
  - 结论：双项目间会话不串、切回不丢，片 1 会话仓按身份槽隔离的真机判据通过。
- **flow 1 残留观察（归 B1-a 几何绑定 / 身份上提域，非片 1 会话仓回归，挂 #55 复核）**：B 的云 uuid 在本机无草稿绑定，壳层 `resolveOutdoorProjectId` 对无 mode 的 `?project=<云uuid>` 嗅探 `hasOutdoorPlanDraft` 不中 → 按方案 B `decideDefaultOutdoorProject()` 续到最近本机草稿 A（`house-gc5xt47q`）；`outdoor-history` 仍打 A 槽，而云项目 lease/sources/快照走 B——**本机草稿身份与云项目身份在打开无绑定云项目时分裂**。另 A 视图活动名短暂残留 B（云绑定身份未随 URL 重载重置）。这套跨身份口径统一属片 2 持久桶切换 / B1-a 绑定域，不在片 1 会话仓范围内修。
- **flow 2 新建活动各落各槽（仍未走通，挂账）**：前端「新建项目」按钮落 `/editor/?new=1`，壳层嗅探不到新草稿仍续最近 A，未 mint 独立第二 `house-*` 槽；完整「选场地 → mint `house-*` → 保存云项目 + 几何绑定」链在当前桩内未取得独立槽。新建路径隔离正确性由 `project-session-scope` 单测（`project:<id>`、空 → `default-outdoor`、不含 `activity:`）+ 片 1 五触点换 `chatSessionScope` 静态 diff 覆盖；真机新建 mint 对照待具备多项目/预览环境再补。
  - *flow 2 第十轮真机卡点（2026-11-22 晚，本地桩 54329 + dev 3210，owner 已登录）*：活动页 `?project=0dff1114…`（云 A），点面板内「新建活动」（`local-activities-panel` fresh activity 路径）后**未落新槽**——URL 仍云 uuid、本机列表仍 2 个、当前活动名「新活动 11-22 20:46」未变；页面落通知「本机存档尚待核对，未切换活动。」守卫定位 `use-layout-persistence.ts:534 flushPendingBeforeSwitch`：`mainSaveHeldRef.current || verifiedWriteRef.current || externalConflictRef.current` 任一置位即拦；三类细分文案见 :561（外部冲突）/:562（主保存挂起）/:563（任务存档待核对）。页面无显式冲突卡、无保存失败红，当前草稿容量待核验、物料 0 件；React ref 运行态不暴露、localStorage 按门禁不检视，**三选一未在只读条件下钉死**。定性：卡点在「切换/新建前当前活动存档须先保存核对」的既有围栏，**不是 mint 发号或身份槽逻辑**；放行需先处置当前草稿存档状态（保存核对 / 清冲突或待验证写），属状态处置决策，停住未代清。回写链路旁证：工作区在途未提交改动 `creative-studio.tsx:1013` 新建后经 `requestOutdoorProjectSwitch(proposedId)` 回写，`workspace-shell.tsx:171` 接住后 `replaceState` + `setOutdoorProjectId` + epoch 重挂；对应套件 :3238 断言 `switched=[current.id]` 单跑 1 例绿。本次真机未走到回写步，**未验成 mint 独立槽**，不冒充通过。
  - *flow 2 第十一轮真机卡点定位与突破（2026-11-22 晚，本地桩 54329 + dev 3210）*：先澄清环境——3210 实为 `next dev -p 3210`（pid 1420 → 子进程 6348，`dev-with-amap-proxy.mjs` 起；日志 `scendance-dev-3210.log` 大量 `Compiled`，watcher 实时活跃），**不是生产 `next start`**；`.next/BUILD_ID` 与 hash chunk 是 App Router dev 同样会写的产物，先前据此误判为生产构建。根因修正：页面常驻文案「另一个窗口正在编辑这份活动；本窗口暂不保存，避免两边互相覆盖…」来自 `lib/outdoor-write-guard.ts:125 blockedDetail()`，是 **Web Lock 写租约 blocked**，并非第十轮怀疑的 persistence 三 ref。guard 在 `outdoor-plan-overlay.tsx:638-656` 按 `slotId` 建独占锁（`scendance:outdoor-plan:writer:v1:<slotId>`）；槽/壳体重挂载瞬间旧锁 cleanup 异步未释放、新 guard `ifAvailable` 拿不到 → 判 blocked，`waitForTurn` 排队，稍后拿到锁翻 granted。persistence `flushPendingBeforeSwitch:534` 三 ref 围栏是叠加层，本轮页面无冲突卡、无保存失败红，主拦路者是写租约。突破动作：硬刷新释放本上下文残留锁后，点「新建活动」走通——URL 由云 A `0dff1114-a35b-4619-880b-723d7f0dac9e` 切到新槽 `2538691c-4de8-4c90-9062-f19a5da72bcd`，任务回初始「搜索目标地点」；新槽锁排队后自愈翻 granted，`outdoor-write-blocked` 瞬态后为 NONE，无「本机存档尚待核对」通知。遗留（决策点悬置，未代推）：新槽是**裸 uuid**，不是预期 `house-*` 本机槽；方案列表出现「他人编辑中 · 新活动 11-22 21:27 刚刚更新」；槽轨道归属（云端 mint vs 本机槽）属 B2/B3 身份口径，待拍板；保存→回写→独立本机槽 mint 全链本轮未验完，不冒充通过。诊断用 `window.__b1Diag/__b1Module` 探针已干净回退，hook 源码 0 残留；备用 dev 3211 未占端口、无残留 node 进程。
- **桩环境债（非片 1 回归，挂 #55）**：`outdoor-history` GET 返 500 `DATABASE_ERROR`（两个 projectId 均 500，PGlite 缺 `outdoor_card_history` 迁移/grant；前端按设计降级本机，不阻塞编辑器）；realtime websocket 握手 404（桩不支持 realtime，既有噪音）。



**片 2 · 持久桶身份切换（成套，不可半拆）**：
目标：会话/记忆/资料桶身份键从裸 `layout.id` 双源收敛到 projectId 源。2026-11-22 静态图谱按存储后端与耦合域三分类（行号对应当前 main，漂移以符号检索为准）：

- **A 类 · source-storage IDB 域（归 B3/B4，本轮不动）**：键落 IndexedDB `sources.scope` / `forms`，与云项目几何绑定、备份/恢复、点验围栏强耦合。触点：`:290` briefStorage.scope、`:334` `scope=layout.id??'local'`、`:337` scopeWriteGuards、`:342/:349` readonly draft reader(brief)、`:357/:359` sourceCoordinator、`:364` registerSourceEditor(lease)、`:396/:397/:441` source record `${scope}:brief`、`:754` useMaterialCheckins(projectId=layout.id)、`:835/:838/:846` 备份、`:1028/:1031` 恢复 targetScope；迁移 `copySourceScope(previous,next)`（source-storage.ts:626）在云绑定/新建时整 scope 复制。这一片随 B3 导出/守卫 plan 化、B4 镜像退役一起切，不在 B1 单独拆。
- **B 类 · 会话/记忆 localStorage + 内存域（B1 片 2 候选，受门禁阻塞）**：
  - `:93` runStorageKey(agentScope)：agent-run marker（localStorage，:1331/:1405/:1485/:1697）。
  - `:116` applyRecoveryKey(agentScope | projectRecoveryScope)：应用恢复标记（localStorage + withApplyLock 独占锁，:118-180/:1398/:1463/:1967）；云项目走 `projectRecoveryScope(apiUrl, cloud.project.id)`，本机活动走 agentScope。
  - `:262/:266` unsentMessageDrafts(agentScope)：未发送消息草稿（模块内存 Map，:350/:2228/:2360/:2465）。
  - `:619-622` inventoryScope：候选库存内存绑定键 `[apiUrl,actor,activity=layoutRef.current.id,chatId]`；lib `session-candidate-inventory.ts` 纯内存、scope 由调用方传入，自身无 layout.id 耦合。
  - 派生链：`agentScope=${apiUrl}:${user??'anonymous'}:${scope}`（:339），第三段复用 A 类 `scope`；切 B 类需把会话身份段换到 sessionScope/project 源，并与 A 类 scope 解耦。
- **C 类 · 几何/云绑定域（保留 layout.id，不随 B1 切）**：`:1217` proposal.project_id/base_revision/local_revision/session_id/generation 比对、`:1234` layout.id 漂移检查、`:2224` leaseLost `project.id===layout.id`、`:2451` geometryProjectId、`:2079` cloudMaterialDraftAvailable `layout.id===cloud.project.id`；备份序列化 scope、restore targetScope。

**门禁判定（2026-11-22）**：B 类虽属会话域，但键与 A 类共享 `scope` 变量，且 run/recovery/inventory 新鲜度核对依赖 sessionToken/lease/revision/epoch。当前前置未齐：① 壳体对话链 4 例仍 skip（session-generation），inventory/恢复链路无壳体绿测保护；② 真机 flow2 新建活动各落各槽未闭环（桩单云项目）；③ A 类迁移/备份/点验口径属 B3/B4。按 §11.8:197 口径，未满足前不在面板硬拆 scope 链路；旧桶 legacy 只读承接至退役。

**测试断言改动点（片 2，待落码时同步）**：`:1175` 附近 run 键 `scendance:agent-run:${apiUrl}:anonymous:${layout.id}`；各 probe `scope="legacy"`；320 例 scope 构造需同步传 `sessionScope` 对齐。

**片 2 落码切口分类（2026-11-22 静态，行号对应当前 main，漂移以符号检索为准）**：
- **派生现状**：`scope=layout.id??'local'`（:334，A/C 类线）；`chatSessionScope=sessionScope??activity:${layout.id}`（:336，片 1 已切会话仓）；`agentScope=${apiUrl}:${user??'anonymous'}:${scope}`（:339，第三段复用 A 类 `scope`）。
- **B 类记忆桶键（第三段待切会话源）**：run marker `runStorageKey(agentScopeRef.current)`（:1331/:1405/:1485/:1697）；本机 applyRecovery `applyRecoveryKey(agentScope)`（:120/:149/:162/:177/:377/:1405/:1406/:1463）；unsent drafts `unsentMessageDrafts(agentScope)`（:350/:2228/:2230）。云侧 recovery 已独立走 `projectRecoveryScope(apiUrl,projectId)`（:117/:1398/:1406/:1877/:1936/:1944），不依赖本机 agentScope。
- **候选指纹（与记忆桶键同源换，围栏比对逻辑不变）**：`Preview.scope` 生成时记 agentScope（:111）；连续围栏 `agentScopeRef.current===selected.scope`（:666）、stale `preview.scope!==agentScope`（:1217）、各 in-flight 围栏 `agentScopeRef.current===submittedScope/selected.scope`（:1446/:1489/:1503/:1523/:1669/:1780/:1882/:1943/:1959/:2004 等）。身份切换后残留旧候选被围栏拒、不续跑，符合跨身份隔离预期。
- **保留 layout.id（C 类几何/云绑定，不随 B1 切）**：`scopeRef` 喂 brief/source/checkins/备份/restore scope（:409/:771/:810/:835/:846/:1028/:1031/:1193/:1198/:1207/:1210）；`geometryProjectId(controller, scope|layout.id)`（:1188/:1340/:1694/:1707/:1710/:1790/:1830/:1850/:2451）；`leaseLost`（:2224）；`cloudMaterialDraftAvailable`（:2079）。
- **建议切口**：新派生字段与会话身份段同源（`chatSessionScope`/projectId 源），记忆桶键与候选指纹走新段；几何线仍用 `scope`(layout.id)，两条线解耦。`StudioValue.scope=agentScope`（:2079）暴露给下游，落码前须再核 `studio.scope` 消费方（drafts :2228 等）是否混入几何用途，避免换段带偏 C 类。
- **遗留口径**：旧桶内 run marker / recovery / unsent drafts 是会话临时物，不跨身份搬迁，退役时清；inventoryScope 身份段 `[apiUrl,actor,activity=layoutRef.current.id,chatId]`（:620）第三段同批评估。

**片 2 本地攒批落码记录（2026-11-22，未合入 main）**：
- 生产改动（`creative-studio.tsx`，仅 2 处派生）：
  - `agentScope` 第三段 `scope`(layout.id) → `chatSessionScope`；run marker / 本机 recovery / unsent drafts / 候选指纹同源换段。
  - `inventoryScope` 第三段 `layoutRef.current.id` → `chatSessionScope`。
  - 几何/云绑定线 `scope`(layout.id)、`geometryProjectId`、leaseLost、cloudMaterialDraftAvailable、source-storage 读写保持不动；`layoutRef` 其余围栏/几何消费保留。
  - 已核 `StudioValue.scope=agentScope` 下游仅 drafts（:2228/:2230/:2357/:2362/:2467）与会话围栏，无几何用途混入。
- 测试同步（`creative-studio.react.test.tsx`，10 处硬编码 run 键第三段补 `activity:` legacy 回退段；动态 startsWith/find 断言未动）。
- 本地门禁证据（Node26）：前端 `tsc --noEmit` exit 0；creative-studio 320 绿/46 skip；agent-panel 165 红/292 绿/1 skip（与基线持平，#55 挂账）；outdoor-store/canvas-session/session-generation 51 绿/4 skip；全量 250 红/10454 绿/79 skip，失败清单双向差集 NEW 为空（仅 share.test 1 例 deflate-bomb flaky 由红转绿，不触记忆桶）；`npm run build` exit 0，20/20 静态页导出。
- **未过门禁、未合入**：壳体对话链整渲染保护仍缺（#47 路线 1 阻塞于 B4 plan 域）；flow2 多项目/本机草稿态新建第二 house 活动真机对照未闭环；旧桶 run/recovery/drafts 临时物不搬迁。合入 main 前必须补齐 #49 真机走查。

**落码门禁**：片 1/片 2 代码可本地先写、本地面板定向 + tsc + 全量对照攒着；合入 main 前必须过 #47 壳体夹具绿测与 #49 真机走查，不在无保护下声称解耦完成。

### 7.7 全完成作战图（2026-11-22）

**终态验收（终态书 §0.4/§0.6）**：四条件达成；对抗 grep 白名单外 0 命中；根 + 前端 `tsc --noEmit` exit 0、定向 vitest 绿、全量对照新锚点无台账外增量失败、`npm run build` exit 0；真机走查三 flow 通过；户外保留件与在途人物/漫游线完整。

**真机条件现状（2026-11-22 线上实测）**：线上站 `https://scendance-scene-planner-ewz.pages.dev/` 当前为**活登录态**——账户中心加载出团队「endTree的工作室」「幕景」，项目列表可见当前草稿、「新活动 11-18 07:46」「自动验证-确认循环」。登录前置当前满足。注意：线上为旧部署，本地未推的 B1 改动须在本地 dev 站或重新部署后走查，不能用线上旧版验收新代码。会话若过期，按浏览器操控门禁由用户接管登录，不接收/转发明文密码、一次性码或凭证。

**串行卡剩余量与阻塞**：

| 卡 | 剩余代码任务 | 前置 | 当前阻塞 |
| --- | --- | --- | --- |
| B1 会话身份 | B1-d 片 1 会话仓对齐 + 片 2 持久桶切换（§7.6）；B1-e 验收 | #47 壳体夹具绿 + 面板定向 + 真机三 flow | #47 夹具挂起；#49 待改动落码后走查 |
| B2 历史快照换 plan | `useHistory` 快照 `RoomLayout`→`SitePlanData`；物料/选中/墙操作挂 plan；undo/redo 回写 plan | B1 验收合入 | 串行门禁 |
| B3 导出/守卫 plan 化 | CSV/GeoJSON/PNG/PDF 全消费 plan；`assertLayoutWrite`→plan 写权限（capability + 项目级 lease + revision） | B2 + C5=A（已拍板 A） | 串行门禁 |
| B4 镜像退役 | 删 plan→layout false 侧 patch；底图/锚点写 plan/视图记忆；清残留镜像分支 | B1–B3 验收合入 | 串行门禁 |
| E1 立壳入口退役 | 删 `startBlankVenue`、加号空白/模板、`space-panel`、`scene-presets-panel`；新建落 starter plan | B1 草稿通路 | 串行门禁 |
| E2 卸保活/室内 three/2D | 断保活容器；室内 renderer/scene/camera、`render.ts`、2D 交互、场景特效；句柄先改派地图 ref | B2/B3 + M1 | 串行门禁 |
| E3 删 layoutStore/墙模型 | schema 室内分支、`layout-reducer`、`use-layout-store`、室内墙/开门/碰撞/吸附、室内 hooks；残留逐一改 plan 或删 | E2 + M2 | 串行门禁 |
| E4 删二分概念 | `isOutdoorProject` 恒真分支、`outdoorPlanState` layout.id 回退、false 侧回写、`seededPlanFromLayout` | E3 | 串行门禁 |

**夹具债（随卡配套）**：#47 壳体两套件 + agent-panel 簇整渲染 mock；#55 ④ 语义残留逐条定性；G1 里程碑后重采基线锚点；G2 工程卫生终态一次清。

**并行遗留（不阻塞主线）**：#37 安全批次死簇/户型面板/旧 run 残留；旧 79 backlog #4/#7/#8/#9/#10/#11；C1/C2 画布图纸接 `plan.walls`、D1/D2 plan 级 DXF/SVG、F1/F2 走廊占带与 OFM 证据线。

**全完成不可省的外部条件**：
- 真机三 flow：切项目不串会话；新建活动各落各槽；无参刷新续开符合方案 B。
- 待拍板口径：C1 无参刷新草稿索引恢复档位；C3 ④ 语义红逐条产品口径。C2 旧仓承接口径第一性已定（§7.6：不迁临时会话物，旧桶 legacy 承接至退役，方案内容随 plan）。
- 每卡合入前：tsc + 定向测试 + 全量对照 + build；不 `git add -A`、不强推、不夹带在途文件、不触发付费生成。

### 7.8 #47 壳体夹具探针取证（2026-11-22，canvas-session 套件）

探针落点：`components/room-organizer/room-organizer-canvas-session.react.test.tsx`（改前原样备份 `$env:TEMP\canvas-session.bak.tsx`，未提交，取证后定保留/回退）。

**已接桩（越过 setup/存储/后端构造层）**：
- MemoryStorage 基座（`test-support-memory-storage.ts`），beforeEach 注入 `Storage`/`localStorage`/`window.localStorage`，afterEach `mem.clear()` 在 unstub 前。
- 未配置态 BackendSession 桩：`probeController = new BackendSession(getBackendConfig({url:'',anonKey:''}))`；`vi.mock('@/lib/backend-session', importOriginal => ({...actual, createBackendSession: () => probeController}))`（importOriginal 保留真实 `BackendSession`/`getBackendConfig`，否则类导出被 mock 抹掉）。
- `vi.stubGlobal('crypto', webcrypto)`（`webcrypto` 从 `node:crypto` 导入，jsdom 无全局 `webcrypto`）；fetch 桩返回 `Promise.reject`（不能同步 throw，否则冲出 promise 链）。

**取证结论**：
- 越过构造层后整棵 Provider 树挂载成功：AppearanceProvider → RoomEditorProvider → SelectionProvider → CreativeStudioProvider → LayoutAgentProvider → OutdoorPlanOverlay → OutdoorPlanCanvas。
- 第一片缺口：`outdoor-plan-canvas.tsx:4308/4310` 拉 `/oneplan-icons/manifest.json` 与 `packs.json`。`libraryPanelHostId` 由 `outdoor-plan-overlay.tsx:1194` 固定传 `"outdoor-panel-host-library"`，effect（`:4305`）不早退；fetch reject 后由生产 `.catch` 静默回落 `setLibraryStatus('failed')`，不崩。
- 兜住 manifest 后无同步异常，进入整渲染挂起：`findByLabelText('告诉 Agent 要改的')` 始终不出现（15s 超时），worker 无新增报错。挂起源候选：AgentPanel interval（`agent-panel.tsx:4377` 理解秒数、`:4556` 会话轮询）；canvas interval（`outdoor-plan-canvas.tsx:2303` facility 生成轮询、`:4273`）；rAF paint/ghost/loop；地图瓦片/物料订阅；会话仓 pending promise。

**套件断言真实依赖（夹具可裁剪边界）**：`capture.two/three` gesture handlers（来自已 mock 的 `use-three-scene`/`use-canvas-2d-interaction` 回调 options）；Agent 输入框 label（`agent-panel.tsx:5109`）；真实 `<canvas>` + ResizeObserver（已 mock）；`layoutStore` 写入。地图瓦片、three 渲染、manifest 物料、会话轮询对这 7 例断言非必需。

**下一步夹具两条路线（未选定，防假绿）**：
1. 逐 hook mock 常驻副作用（interval/rAF/地图/物料/会话轮询），保留真实挂载；工作量大、回归面小。
2. 重型 canvas/3D/地图/物料子树整体占位 mock，只留 Provider 壳 + Agent 输入 + canvas 占位 + gesture 归属；省 mock 但测试不再覆盖真实挂载，须在台账标注覆盖降级，不能据此声称壳体集成已保护。

**第二轮探针（门控排除）**：把首例行 `findByLabelText` 换成渲染后 `setTimeout(1200ms)` dump DOM，dump 回调未执行。据此排除「AgentPanel 被 workbenchMode/loginBlocked 门控 return null 导致 label 缺失」这一假设。注意：vitest 日志/console 全缓冲到进程结束，单凭 dump 回调未跑**不足以判定为同步死循环**，「同步卡死 vs worker 常驻句柄残留」二者尚未区分。

**第三轮二分（2026-11-22，临时探针已删、基线套件回退干净）**：
- 可越过 setup/构造层的探针基座：MemoryStorage、未配置态 `BackendSession(getBackendConfig({url:'',anonKey:''}))`（`importOriginal` 保留真实类，仅覆写 `createBackendSession`）、`webcrypto` from `node:crypto`、fetch 返回 `Promise.reject`。
- 补 `next/dynamic` 桩（react `lazy`+`Suspense` 占位，参照 `app/page.test.tsx:65-75`；壳体唯一直连 `dynamic()` 在 `room-organizer.tsx:276` `WorkbenchCaptureGuide`，常驻 `Suspense` 内 `:5233`）→ **未解除挂起**，排除 dynamic 懒加载边界。
- 摘除 `outdoor-plan-overlay` / `outdoor-plan-3d` 为占位组件 → **仍挂起**，排除这两个子树本身。
- 上轮 error boundary 栈已证树挂载到 `OutdoorPlanCanvas`；结合本轮，挂起点落在 Canvas 挂载之后：Canvas 内部 draw/rAF/interval、顶层 hooks 常驻句柄（模块单例订阅/轮询/pending promise），或 Provider 链 effect。尚未定位到具体 hook。

**第四轮二分（2026-11-22，同步/句柄定性 + 子树定位）**：
- **import 阶段挂起源锁定**：剥除 `@/lib/source-storage` 与 `@/lib/material-checkin-storage` 两个 `importOriginal`（展开真实模块再覆写函数）mock 后，进程正常 EXIT=1 退出、worker 不再常驻；确认这两个 mock 的循环依赖/求值副作用是 import 阶段挂起元凶。后续夹具若需挡持久层，改用「纯 Map/桩函数全量导出，不 `importOriginal` 展开」写法（参照 `use-reference-image.react.test.tsx:11`）。
- **render 阶段定性：同步阻塞，非 effect 句柄残留**：render 前挂 `setTimeout(0)` tick marker，render 同步返回后 tick 才会落盘；实测 marker 停在 `BEFORE_RENDER`、tick 未执行 → 事件循环在 `render()` 同步调用内被卡死，推翻此前「同步死循环 vs 常驻句柄」悬而未判的状态（第二轮 dump 回调未跑不足以区分，本轮 0ms timer 给出区分证据）。
- **子树定位：CreativeStudio / Agent 耦合族**：把 `./panels/agent-panel`（`AgentPanel`/`LayoutAgentProvider`/`AgentCanvasOverlay`/`MapVenueOverlay`/`VenuePickerOverlay`）与 `./panels/creative-studio`（`CreativeStudioProvider`/`CreativeAssistant`）整体占位为空组件/透传 Provider 后，render 203ms 返回、进程退出。再单独只占位 creative-studio、保留 agent-panel 真实：进程仍退出（不挂起），但 `LayoutAgentProvider` 报 `No "useStudioAgent" export` —— 二者经 `StudioContext` 耦合：Provider 提供 context，`useStudioAgent`/`useCreativeBrief`/`useLocalProjectBackup`/`useMaterialCheckinState` 等 hook 取值，`LayoutAgentProvider` 消费。挂起点在这条 Studio Provider→Agent 消费链上，不能对两棵子树独立二分。
- 占位剥 context 后出现的 `Cannot read properties of undefined (reading 'form')`、缺导出报错均为 mock 副作用，非原始卡点；320 绿的 `creative-studio.react.test.tsx` 是自包 Provider 的独立渲染，未接壳体 `LayoutAgentProvider`，故不复现整壳体挂起。
- **反向二分修正（2026-11-22）**：只占位 `agent-panel` 族、保留 `creative-studio` 真实挂载 → render 98ms 返回、进程退出（不挂起），仅在占位缺失 AgentContext 后抛 `'form'` undefined 副作用。三组对照：摘双侧=退出；摘 Studio 留 Agent=退出（缺 `useStudioAgent` 导出，Agent 侧没跑到真实阻塞）；摘 Agent 留 Studio=退出。**结论：阻塞不在 Studio Provider/Assistant 自身，落在 `agent-panel` 消费侧**（`LayoutAgentProvider` 内部 hook 链或 `AgentPanel` 面板 body）。静态排查 `useAssistantSessions`（`useSyncExternalStore` 返回稳定 `snapshot` 对象引用，`replaceSnapshot` 才换对象）与 `useVenueFactTracker`（`capture` 返回稳定 token 引用），snapshot 引用均稳定，未见 getSnapshot 不稳定导致的同步重渲染循环；具体同步阻塞点仍未定位到 hook。
- 下一轮（路线 1）重点转向 `agent-panel` 模块内二分：`LayoutAgentProvider`（`:689`，内部 `useRoomEditor`/`useStudioAgent`/`useVenueFactTracker`/`useAssistantSessions`/场地事实/预览派生）与 `AgentPanel`（`:4383`）body 逐段隔离；优先在 Node inspector 下抓同步栈定位死循环位置，其次逐 hook mock 常驻/派生。`useLayoutPersistence`/`useSilentCloudAttach`/Canvas interval/rAF 作为并列候选。

**下一轮 #47 起步**：① 在 Node inspector 下抓挂起同步栈（区分死循环 vs 句柄残留）；② 逐 hook mock 常驻句柄（`use-layout-persistence`/`use-silent-cloud-attach`/`use-team`/会话仓订阅/Canvas `:2303` 与 `:4273` interval、`:4243` rAF）；③ 路线 1 保留真实挂载优先，路线 2 整体占位仅作兜底并标注覆盖降级。

**第五轮探针（2026-11-22，路线 1 复现证伪）**：临时探针 `room-organizer-route1-probe.react.test.tsx`（取证后删），**双侧 `./panels/agent-panel` 与 `./panels/creative-studio` 均不 mock、真实挂载**，沿用探针基座（MemoryStorage、未配置态 `BackendSession`、`webcrypto`、fetch reject、自写 `navigator.locks`、matchMedia/ResizeObserver/canvas.getContext/Dialog 桩、next/navigation、next/dynamic、three-scene/2d-interaction 桩）。
- 结果：render 555ms / 复跑 811ms 同步返回，真实 `AgentPanel` 输入框（`agent-panel.tsx:5109` label，生产码唯一来源）2.5s 内找到，**两次 EXIT=0，不再挂起**；同步 fs 打点 `BEFORE_RENDER→RENDER_CALL_BEGIN→RENDER_CALL_RETURNED→INPUT_FOUND` 顺序完整。
- **结论修正**：第四轮「同步阻塞落在 agent-panel 消费侧」未在当前基座复现。静态复核 Provider 链四 hook（`useRoomEditor`/`useStudioAgent`/`useAssistantSessions`/`useVenueFactTracker`）均为纯 context 取值或模块级稳定 snapshot，body hook 为常规 useState/useContext，未见 render 期同步 while/for 死循环。挂起更可能源自 #47 两套件自筑重型基座的桩组合（`importOriginal` 展开持久层 mock 的循环依赖/求值副作用、双侧占位 Provider 经 StudioContext 耦合），**非壳体固有同步死循环**。
- 对照：`zone-race`/`annotation-capture`/`dialogue-review`/`map-preservation`/`route-provenance` 等既有壳体套件在基线 batch11 同为红，但失败例仅 2–18ms 快速报错（缺 controller/crypto/fetch/locks 等桩），不是 15s 超时挂起。
- **路线 1 新方向**：不再走 inspector 抓栈；以第五轮探针基座为底，去掉双侧 panel 占位 mock、保留真实挂载，逐例恢复 #47 两套件断言（先 readiness，再对话链）。探针临时文件待改造完成后删除、不入库。

**路线 1 落地（2026-11-22，两套件真实挂载恢复）**：
- 去掉 `./panels/agent-panel`、`./panels/creative-studio` 整体占位 mock，保留 three-scene/2d-interaction 捕获桩、next 路由/动态导入桩、未配置 controller、MemoryStorage、webcrypto/fetch/locks/全局桩。临时探针取证后已删，桩已并入两套件。
- `canvas-session`：**7 例全部真实挂载通过**（two/three ×3 手势归属守卫 + observer 重连），不再依赖 Agent/Studio 占位。
- `session-generation`：readiness 2 例（strict=false/true）真实挂载通过；对话链 4 例仍 `it.skip`。
- **对话链例阻塞定性**：真实壳体挂载后，发送在 `sendCore:3204` 被地点闸门拦下——设计指令在地点未定、无 outdoor plan 时退回选址写 pendingBrief，不发起模型调用，resolver `capture.calls=0`。agent-panel 单元测试是直挂 `LayoutAgentProvider` 并自传 callbacks/bridge 桩绕过该闸门；壳体套件整渲染时闸门由真实 outdoorWorkflow/bridge 驱动。恢复对话链例需二选一：① 壳体套件补「地点已定、可发模型」的 bridge/plan 前置桩；② 分层——对话链断言归 agent-panel 单元测试覆盖，壳体套件只保 readiness + 手势守卫。此分层口径待拍板。
- 验证（Node26）：`tsc --noEmit` exit 0；定向三套件 EXIT=0——canvas 7 passed、session 2 passed/4 skipped、creative-studio 320 passed/46 skipped，与基线持平无回归。

**第七期（2026-11-22，分层口径拍板 + agent-panel 大套件基座解锁）**：
- 口径拍板：补前置桩能恢复的就恢复，补不上的分层归单测，以突破为准。
- **对话链 4 例壳体层不可行（复核到第二道硬阻塞）**：除 `sendCore:3204` 地点闸外，`outdoorWorkflow.handle:2836/2853` 开头即要求 `callbacks.current.bridge()?.applyPlan` 存在且 `getPlan()` 返回有效 `SitePlanData`，否则直接 `return false`，到不了 `resolveBriefTurn`。jsdom 壳体无户外 plan，`routeBridgeRef.current` 为 null；补齐需在测试里重搭合法 `OutdoorAgentBridge` + 有效 SitePlanData + 非匿名登录态 + provider/model 全套前置，接口面见 `outdoor-agent-contract.ts:325`，耦合尚未完成的 B4 plan 域，脆弱且越界。**分层结论**：4 例断言意图归 agent-panel 直挂 `LayoutAgentProvider` 单测覆盖（该侧自传 callbacks/bridge/controller 桩，绕过户外闸门），壳体套件只保 readiness + 手势守卫。
- **覆盖映射（agent-panel.react.test.tsx，标题定位）**：例 2 迟到回复丢弃+草稿保留 → `:1859` 同批 A→B→A 丢弃迟到回复、`:1931` 会话间草稿隔离、`:1943` epoch 过期草稿保留、`:1741` 迟到结果不写回已切活动、`:2460` 同批切会话切回旧生成不续跑；例 3 提交作废既有对话捕获/理解完成前阻断新捕获 → `dialogue export in-flight fence` 组 `:573/:592/:622/:630/:639` + `dialogue-review` 套件 isCurrent 切换作废；例 4 理解失败本地人数留存 → `:1359` 保留前轮人数、`:598` 理解失败丢弃 seating 请求、`:747/:761/:776` fact 留存组；例 5 旧 zone 预览 A→B→A 被拒不改画布 → `:1180` 切活动后不套本地预览、`:1198` 账号 A→B→A 旧预览作废、`:1755` store 变更后即时拒 stale event、`:2011/:2022/:2034` 楼层/样式 stale candidate 组。
- **底座突破：agent-panel 大套件接入 #45 MemoryStorage 基座**。该套件 458 例此前整批炸在全局 `localStorage.clear()`（jsdom 在当前 Node 运行时下只注入 sessionStorage、`window.localStorage` 为 undefined 占位），漏接 #45 基座；与业务断言无关。按标准模式套件内注入 `MemoryStorage`（`Storage`/`localStorage`/`window.localStorage`），beforeEach 新建、afterEach `mem.clear()`。结果：**457 failed → 165 failed / 292 passed / 1 skipped**，基座成片解锁 292 例。
- **165 例失败聚类（日志 `%TEMP%\agent-panel-r1.log`）**：`TestingLibraryElementError` 125（找不到/多命中文本，产物未出现或查询歧义）、`AssertionError` 31、`TypeError`/`Cannot read` 5（均为测试侧拿到 null DOM 再读属性的前序连锁，非缺全局桩）、`ReferenceError` 0；**无成片公共桩缺口**（crypto/fetch/locks/matchMedia 主链路已被 studioMock/Provider mock 隔离）。剩余 156 例断言级红归 #55 语义/夹具残留，待产品口径逐条核对，本轮不盲改。
- 验证（Node26）：`tsc --noEmit` exit 0；agent-panel 定向 292 passed / 165 failed / 1 skipped；生产代码 0 改动，夹具套件内隔离。
- **全量对照（日志 `%TEMP%\scendance-full-b1d3.log`，对照基线 `scendance-full-b1d2.log`）**：文件级 **33 failed / 810 passed (843)**，与基线 33/810 一致；测试级 **251 failed / 10450 passed / 79 skipped (10780)**，基线 543 failed / 10158 passed / 79 skipped。失败文件清单双向差集皆空——**新入列 0、出列 0**，无台账外新增确定性代码回归；测试级失败 -292、通过 +292、skipped 持平，恰为 agent-panel 基座成片解锁的 292 例。剩余 251 = agent-panel 165 断言红（挂账 #55）+ 外部既有红 86（基线 543 - agent-panel 457），均为挂账既有红，本轮不盲改。
- **后置决策（2026-11-22 拍板）**：165 例断言红中凡属旧 `activity:` 口径/滞后文案/旧仓语义的，当前身份前置（B1 片 2、B2 快照）尚未落定，现在逐条抠是白弄；一律挂账 #55，随 B1 身份口径与 B2 plan 槽落定后复核，本轮不硬改、不阻塞 B1 合入门禁。本地精力转推 B1 验收前置（全量对照 + 真机三 flow），B2/B3/B4/E 按串行门禁不跳卡。


**处置**：临时探针文件已删，基线套件从 `$env:TEMP\canvas-session.bak.tsx` 回退原样（5955 字节），`git status` 壳体目录仅剩片 1 两文件改动，探针未提交、未入库。

**两套件同族对照（#47）**：`session-generation.react.test.tsx`（6 例）与 canvas-session 同属整渲染真实 `RoomOrganizer`、同以 `findByLabelText('告诉 Agent 要改的')` 等待。它已 mock：`next/navigation`、`use-plan-annotations`、`@/lib/agent-resolver`（pending promise）、`creative-studio` Provider 包装；**同缺**：MemoryStorage 基座（`:25` 裸 `localStorage.clear`）、未配置 controller 桩、`use-three-scene`/`use-canvas-2d-interaction`、`next/dynamic`、fetch/crypto 桩。一套件的基座+桩+挂起二分跑通后，另一套可复用同一套夹具。

### 7.8.1 路线 2 兜底夹具落地（2026-11-22，先出结果，真实保护留路线 1）

- **决策**：路线 1（逐 hook 补桩、保留真实挂载）尚未定位到同步阻塞 hook；用户拍板先做**路线 2**——把 Studio/Agent 重型子树整体占位降级，先让两套件跑出结果；整壳体真实挂载保护留待路线 1 再补。
- **复用基座与桩集**：两套件均接入共享 `lib/test-support-memory-storage.ts`；未配置态 `BackendSession(getBackendConfig({url:'',anonKey:''}))` + `importOriginal` 覆写 `createBackendSession`；`webcrypto` from `node:crypto`；`fetch` reject；自写 `navigator.locks`；`matchMedia`/`ResizeObserver`/`HTMLCanvasElement.getContext`/`HTMLDialogElement` 桩；`next/navigation`、`next/dynamic` 桩；`use-three-scene`/`use-canvas-2d-interaction` 桩并经 hoisted `capture` 回填 options。`./panels/agent-panel` 与 `./panels/creative-studio` 整体 mock：AgentPanel 渲染供 `findByLabelText` 的 `<textarea aria-label="告诉 Agent 要改的" />`，Provider 透传 children，Overlay 返回 null，`useAgentOptional` 返回 null、`useAgent` 返回宽松桩；Studio Provider 透传、Assistant null、`useStudioAgent` 空桩。
- **canvas-session（7 例）**：**7 passed**。保留壳体手势归属竞态（two/three ×3）与 observer 重连真实路径；Agent 输入框仅作挂载探针，Agent/Studio 内部行为不在覆盖范围。
- **session-generation（6 例）**：**2 passed / 4 skipped**。例 1 `real workspace initial readiness has no false unsaved warning`（it.each strict=false/true）保留壳体路径，在占位下无「会话未能保存在本机」误警；例 2–5（A→B→A 迟到回复丢弃与草稿保留、提交时作废既有对话捕获、人数导出在理解失败时留存、旧 zone 预览被拒）依赖真实对话链，占位下不成立，标 `it.skip`，待路线 1 恢复真实挂载后逐条补回。
- **验证（Node 26.2.0）**：前端 `tsc --noEmit` exit 0；定向三套件 `vitest run` EXIT=0——canvas-session 7 passed、session-generation 2 passed/4 skipped、`creative-studio.react.test.tsx` 320 passed/46 skipped（对照基线 320/46 无回归）。
- **覆盖降级口径（勿误读为整壳体保护）**：路线 2 下 canvas-session 只覆盖壳体手势守卫与 observer 重连；session-generation 只覆盖 readiness 一例。Agent 对话链、Studio Assistant、持久仓交互均未在真实挂载下断言。两套件头注释已标注该降级；夹具改动本地攒批，未提交、未推 main（连同片 1 生产码，待 tsc+测试+真机验收后一次性提交）。

