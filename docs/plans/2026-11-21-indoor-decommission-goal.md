# 去室内化终态目标与里程碑台账（2026-11-21）

> 承接 #79 收尾（main `2de462be`，与 origin/main 同步）。本文把「去室内化清理」定成可验收的终态目标与串行里程碑，作为本轮及后续开工的总台账。
> 依据：`2026-11-17-decouple-execution-plan.md`、`2026-11-17-b1-b4-execution-cards.md`、`2026-11-17-g1-closure-status.md`、`2026-11-17-indoor-deadcode-audit-3e376b41.md`、`2026-11-21-b1-session-scope-decouple.md`、`2026-11-21-first-principles-endstate.md`（第一性原理终态与因果路径）。
> 行号/路径以届时 `origin/main` 为准；开工前先 `git fetch` 复核。

## 1. 终态目标（完成定义）

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
| `panels/creative-studio.tsx:290/:334/:337/:340-352/:516/:579/:617-628/:634` | 内部 `scope = layout.id ?? 'local'`；brief 存储、未发送草稿、候选库存、恢复锁、订阅频道全挂这套 | briefStorage / unsentMessageDrafts / applyRecoveryKey / sourceCoordinator | B1-d | ⬜ 待壳体下传 `activeProjectId` 成套改；测试夹具不全，先补定向测试再动 |
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
