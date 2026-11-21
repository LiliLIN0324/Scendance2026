# B1 会话 scope 解耦 · 现状与切片口径（2026-11-21）

> 承接 #79 户外门禁收尾（main `2de462be`）。产品决策：去室内化优先走 **B 线壳体解耦**（B1→B2→B3→B4），R 线壳体退役（E1–E4）排在 B 线成套之后。
> 本文是 B1 开工前的只读现状盘点与改动口径；行号对应当前 main，漂移以符号检索为准。
> 口径沿用 `2026-11-17-decouple-execution-plan.md` 关卡 B1 与 `indoor-decouple-targets-2026-11-14.md` §3.1。

## 1. 目标

会话 / 记忆 / 标注 / 场地事实的身份键从室内 `layout.id` 双源回退，收敛为纯地图 projectId 源：

1. 主 `sessionScope` 去掉 `layout.id` 回退，纯走 `projectSessionScope(projectId)`。
2. floor / venue tracker 订阅源从 `layoutStore.layout.id` 重绑到 plan 侧身份（projectId / plan.levels / 边界几何）。
3. 遗留 `activity:${layout.id}` / `layout.id ?? 'local'` 键按域归位到 project scope。
4. 成套边界：tracker 源、壳体 scope 拼接、agent-panel / creative-studio 比对点**同批改**，不可拆两半（否则 `isCurrent` 比对失败，提案 / 导出 / 拖拽全灭）。

## 2. 身份模型现状（三源并存）

| 源 | 落点 | 说明 |
| --- | --- | --- |
| 地图 projectId | `outdoorProjectIdProp`（`room-organizer.tsx:326`），由 `workspace-shell.tsx:109/179` 解析 URL `project=` / 最近项目 / 找回后传入 | 云项目 id、`replica-*` 案例伪 id、`default-outdoor` 默认草稿槽 |
| 室内 layout.id | `useLayoutState()`（`:359`）；云项目打开时由 `backendSceneToLayout` 把 projectId 写进 layout.id；replica 案例由 `caseActivityAlignment` 对齐 | 本机活动创建时发号；当前承担「本机不同活动」的身份区分 |
| 默认草稿槽 | `DEFAULT_OUTDOOR_PROJECT_ID = 'default-outdoor'`（`outdoor-project-store.ts:275`） | 无 id 草稿兜底 |

会话键两种口径并存：
- `projectSessionScope(id) = project:${id}`（`project-session-scope.ts:11`）——M3a 地图侧口径。
- `activityScope(id) = activity:${id} | draft:unidentified`（`activity-session-epoch.ts:7`）——旧室内口径。

## 3. 当前双源回退点（B1 要收的位置）

### 3.1 壳体 `room-organizer.tsx`

| 行号 | 现状 | B1 目标 |
| --- | --- | --- |
| `:367-369` `outdoorPlanSlotId` | 非显式项目时 `layout.id ?? outdoorProjectIdProp` | 草稿槽身份改由 plan 侧 projectId 派生（见 §5 前置缺口） |
| `:389` `legacySessionScope` | `projectSessionScope(outdoorProjectIdProp)` | 仅作历史迁移读取源；迁移完成后退役 |
| `:390` `sessionScope` | `projectSessionScope(layout.id ?? outdoorProjectIdProp)` | 纯 `projectSessionScope(projectId 源)` |
| `:393-396` `adoptScopeHistory` / `rememberScopeName` | 在 legacy→session 间搬历史、记活动名 | 保留一次性迁移；身份源切正源后复评 |
| `:399-403` `activityScopeSource` | 已注入 project 源（`getScope: projectSessionScope(outdoorProjectIdProp)`） | ✅ 已接住，保留 |
| `:412` `useFloorSessionTracker(layoutStore)` | 默认 store 源（layout.id） | **随 E2 容器退役一并移除**：楼层是室内壳体语义、户外 plan 无 levels，不在 B1 单独注入 |
| `:414` `useVenueFactTracker(layoutStore)` | 按几何 basis（非 scope 键） | 保持不动；几何 basis 源随 plan 几何迁移归 B2 |
| `:437/:447/:456/:457` | `dialogueSessionKey`、`subscribeActiveAssistantSession`、brief 比对、`getStoreSessionScope` 均读 `sessionScope` / `layout.id ?? prop` | 随 `sessionScope` 正源一并收敛 |
| `:4687/:4699` | 标注观察 binding.`activityScope: sessionScope` | 正源切换后跟随 |

### 3.2 tracker 地基 `activity-session-epoch.ts`

- `storeScopeSource`（`:18-23`）默认 `activityScope(store.getState().layout.id)`。
- `createActivitySessionTracker(store, source?)` 已支持注入源；activity tracker 壳体已接，floor/venue 未接。

### 3.3 散落 `activity:` / layout.id 键（按域归位清单）

| 文件 | 行号 | 现状键 | 归属域 |
| --- | --- | --- | --- |
| `panels/creative-studio.tsx` | `:290` | `layout.id ?? 'local'`（briefStorage scope） | 简报记忆 |
| `panels/creative-studio.tsx` | `:334` | `scope = layout.id ?? 'local'` | 简报记忆 |
| `panels/creative-studio.tsx` | `:516` | `subscribeActiveAssistantSession('activity:' + layout.id)` | 候选清单失效订阅 |
| `panels/creative-studio.tsx` | `:579` | `chatScope = activity:${base.id}` | 会话清单 / 草稿完整性围栏 |
| `panels/creative-studio.tsx` | `:617-628` | `inventoryScope` 比对 `activity:${activity}` | 候选库存会话绑定 |
| `panels/creative-studio.tsx` | `:634` | `activity:${layoutRef.current.id}` | 清缓存订阅 |
| `panels/bingo-audit-card.tsx` | `:416/:431-433` | `scopeKey` 由 props 传入；内部已用 `projectSessionScope(plan.projectKey)` 比对 | 评审快照（核对壳体传入的 scopeKey 正源） |
| `lib/floor-session-epoch.ts` | `:18` | `activityScope(state.layout.id)` | 楼层会话 epoch |
| `lib/venue-fact-epoch.ts` | `:12/:15/:20` | **不按 scope 键隔离**：按 `venueScaleBasis(layout)`（宽/深/面积几何）派生 generation/epoch，订阅 layoutStore | 场地事实记忆新鲜度；几何 basis 源随 plan 几何迁移，非 B1 scope 键范畴 |
| `panels/venue-facts-panel.tsx` / `space-panel.tsx` / `scene-delivery-panel.tsx` | 待复核 | `venueFactScope` / note scope 传入链 | 场地事实 / 导出备注 |
| `lib/environment-preference.ts` | `:196-197` | 已用结构化 scope：`{kind:'project',id}` / `{kind:'draft'}`，非裸 layout.id 字符串；核对壳体传入的 scope 对象正源 | 环境偏好分桶 |

## 4. 前置缺口（B1 能否安全收敛的关键）

当前**本机活动身份落在 `layout.id`**，而 `outdoorProjectIdProp` 在默认草稿场景是固定 `default-outdoor`。若只在壳体删掉 `layout.id ??` 回退，所有本机活动的会话/记忆会摊回同一 `default-outdoor`（即历史注释 `:387-388` 记录的旧病：「一个 id 全活动共享，历史全摊在一起」）。

因此收敛前必须先接上：**新建 / 切换本机活动时，活动身份上提到 plan 草稿槽 id（projectId 源）**，使 plan 侧草稿槽能区分不同本机活动。现状参照：
- `outdoor-plan-overlay.tsx:484` `activityScopedPlan`：slotId 非 `LOCAL_DRAFT_SLOT` / legacy 才按活动存。
- `:602` `adoptLegacyOutdoorPlanForActivity(slotId, legacyPlanProjectId)`：旧共用规划一次性接管给活动槽。
- `outdoor-project-store.ts:288` 按活动 id 落本机记录。

> 落码顺序建议：先补「活动 id → plan 草稿槽 / projectId 源」的上提链路，再收壳体双源回退；两步同批提交，不先删回退。

## 5. 必须保留、不得随 B1 误删的户外语境件

- 出入口节点（入口/出口/两用、分区归属、属性卡）——户外场地出入口，非室内门。
- 场地围墙 `walls` 集合、迁移器、图例三桶、GeoJSON/CSV 墙导出——户外围挡。
- 户外预设 `lawn` / `market`；迁移器与旧云项目「只读 + 复制为 plan 草稿」降级通路（C4 A）。
- 座位 / 桌排 / 人物群演 / 漫游 / 车流线（地图侧尚未完全接住）。
- 当前 `AgentRunPanel` 运行时间线（活跃智能体链路，非旧云 run 归档）。
- D 层业务字段 `indoorOutdoor` / `venueIO`（Agent 提案输入，保留）。
- 道具家具库不做室内外过滤。

## 6. 验收口径

1. 清 `*.tsbuildinfo` 后 `tsc --noEmit` exit 0。
2. 定向 vitest：activity/project/floor/venue/assistant-active 会话组、creative-studio 简报与库存围栏、bingo 评审快照组绿；不引入台账外新失败。
3. 成套核对：切项目不串会话；新建活动会话/记忆落在各自草稿槽；旧草稿会话不回读属 G2 可接受。
4. 真机探针（页面空闲时）：DOM 会话槽、切项目历史分组、console 无新报错。

## 7. 阻塞与环境

- **Node 环境已定位**：`C:\Program Files\nodejs\node.exe` = v26.2.0（台账锚定档），npm 11.13.0；PATH 被沙箱运行时的 Node v22.23.2 抢先。跑 tsc / vitest / build 前先 `$env:Path = "C:\Program Files\nodejs;$env:Path"` 前置 Node26，禁用 Node22 跑全量。
- 全量套件对照基线台账 `docs/quality/vitest-baseline-63b11ae1.md/.csv`。
- #79 走查以通道 B 风险接受放行，8 条 partial 残余风险在 backlog；B1 不依赖这些待取证项，但真机 flow 稳定性仍参照执行计划关卡 B 前置。
- B1 成套边界未解除前，不推进 B2/B3/B4，更不动 E2/E3/E4。

## 8. 待落码前复核项

- `scene-delivery-panel` 导出 note scope 归属键。
- 评审链接 identity scope（壳体 `identity().scope` 拼接点）。
- `workspace-shell` 新建活动 / 切换活动时 projectId 上提与 URL `project=` 参数的同步路径。
- 已核实：`venue-fact-epoch` 按几何 basis 而非 scope 键；`environment-preference` 已是结构化 project/draft scope。

## 9. 已核实的身份链路（2026-11-21 main `2de462be` 实测）

### 9.1 身份载体现状
- 户外 plan 草稿槽：`outdoorPlanSlotId`（`room-organizer.tsx:367-369`）= 显式项目 `prop`，否则 `layout.id ?? prop`；overlay `projectId={outdoorPlanSlotId}`（:5403），槽内 `slotId = projectId || LOCAL_DRAFT_SLOT`。
- 会话身份：`sessionScope = projectSessionScope(layout.id ?? outdoorProjectIdProp)`（:390）；`getStoreSessionScope()` 同口径（:457）。
- 户外 plan 快照：`outdoorPlanState = { projectId, plan }`（:780），由 overlay 按 slotId 载入回填；匹配 `matchId = isOutdoorProject ? slotId : layout.id`（:2057）。

### 9.2 云项目绑定链路（身份写 layout.id，prop 滞后）
- `use-silent-cloud-attach.ts`：建项目 → `copySourceScope(previousScope, projectId)` → `bindRef.current(projectId)`（:143）→ `onBindProject`。
- `onBindProject`（`room-organizer.tsx:4641-4647`）：仅 `actions.applyLayout({ ...before, id: projectId })`，**未调 `setOutdoorProjectId`**；URL 写 `?project=`（attach :145）。壳体 prop 靠 shell 重渲染/switch 事件滞后同步。
- 后果：云绑定后身份写进 `layout.id`，`sessionScope` 取 `layout.id` 才正确；prop 不是现役身份源。

### 9.3 本机新建活动链路（身份写新活动 id，prop 被重置回默认）
- `commitFreshActivityLayout`（:4095-4125）：新活动 id = `house-<uuid>`（`local-project-restore.ts:37` `FRESH_ACTIVITY_ID`）；plan 记录落 `created.id` 槽（:4117，`trackLastProject=false` 不顶最近指针）；:4121 删 URL `project=`；:4123 `setOutdoorProjectId(DEFAULT_OUTDOOR_PROJECT_ID)` —— **prop 被重置回默认草稿，与 plan 槽 / 会话身份割裂**。
- 归档键域：封面 / 简报 / 点验 / 图纸 / 源记录均按 scope=活动 id 存取（`local-project-restore.ts:56-62`）。这些键随身份源一起迁，不在 B1 单独拆。

### 9.4 切换 / 找回链路
- shell `onOutdoorProjectSwitch` 事件（`workspace-shell.tsx:158-167`）：换案例 / 找回采纳 → `setOutdoorProjectId(projectId)` + `projectEpoch` 重挂；URL `project=` + `mode=outdoor`。
- 经典案例对齐：`caseActivityAlignment` 把 `layout.id/name` 对齐到 `replica-*` 记录（`case-activity-alignment.ts:27-34`）。

## 10. B1 有序切片（成套推进，每切片 tsc + 定向测试绿）

> 成套边界：tracker 源、壳体 scope 拼接、agent-panel / creative-studio 比对点必须同批改；不先删双源回退再补源。

- **B1-a 身份上提 state（行为保持过渡，已落地）**：壳体把「当前活动/项目身份」收敛到一个内部 state；`onBindProject` 与 `commitFreshActivityLayout` 两条路径同步该 state。scope 读取口径暂不变（仍 `layout.id ?? prop`），保证过渡态行为等价。核对点：云绑定 / 新建活动后 plan 槽不换错、overlay 不重复载入、`explicitOutdoorProject` 分支不误判。
- **B1-b scope 正源切换（去回退已落地，待 B1-e 验收）**：方案 B 拍板后，`activeProjectId` 纯取外壳 prop（空回落 default），`sessionScope` / `getStoreSessionScope` / activity tracker 源三处同源，会话域去掉 `layout.id` 回退。验证：tsc exit 0、lib 纯函数组持平基线；壳体 react 套件受存量 jsdom 夹具红阻挡，无绿测保护，待 B1-e 补夹具 + 真机走查。plan 槽回写、环境偏好键、活动守卫分别归 B4 / B1-d / 保留。
- **B1-c tracker 源重绑（拆分调整）**：venue tracker 已核实按几何 basis、非 scope 键，不动。**floor tracker 判定随 R 线容器退役（E2）一并移除**：楼层是室内壳体语义、户外 plan 无 levels；注入 project 源需双订阅并改 shared WeakMap 缓存键，户外链路不活跃、收益有限，不在 B1 单独改造。
- **B1-d 散落键归位**：creative-studio 简报 scope、库存围栏、订阅频道；bingo `scopeKey` 传入正源；评审链接 identity；scene-delivery note scope。依赖 B1-b 正源闭合后同批改。
- **B1-e 验收**：Node26 下 `tsc --noEmit` exit 0；会话/身份/围栏定向测试绿；全量 vitest 对照基线不增红；真机切项目不串会话、新建活动记忆落各自槽。

## 11.5 B1-a 落地记录（壳体侧，未提交）

已落 `room-organizer.tsx` 两处身份同步（行为保持过渡，scope 口径未变）：

1. `onBindProject`（:4645 后）：绑定云项目成功后 `setOutdoorProjectId(projectId)`，prop 与 `layout.id` 对齐。
2. `commitFreshActivityLayout`（:4123）：新建活动后 `setOutdoorProjectId(created.id ?? DEFAULT_OUTDOOR_PROJECT_ID)`，替代原重置回 `default-outdoor`；仍不写 URL `project=`、不顶最近指针。

验证（Node26）：
- `tsc --noEmit` exit 0。
- 定向对照基线：`local-project-restore` 3 failed / 17 skipped（同基线）；`creative-studio.react` 改动前后均 320 failed / 46 skipped（当前环境基线状态，非本次引入）；`use-silent-cloud-attach` 20 failed、`case-activity-alignment` 1 failed 均为台账存量红。未新增失败。

**B1-b 前置仍缺一环**：初始载入 / 刷新续开本机活动时，shell 要把现役活动身份恢复到 prop（当前 shell 只从最近项目 / URL / default 解析 prop，本机活动 id 存于壳体 layout）。这一环接住前，`sessionScope` 不能去掉 `layout.id ??` 回退，否则刷新后 prop 回落 default/最近项目，会话槽漂移串号。该链路在 `workspace-shell.tsx` 载入 effect 与 outdoor-plan 续开处，属 B1-b 同批改范围。

## 11.6 B1-b 尝试落地与回退记录（2026-11-21，未提交）

- **尝试**：`sessionScope`（:390）与 `getStoreSessionScope`（:457）改为纯 `projectSessionScope(outdoorProjectIdProp)`，去掉 `layout.id ??` 回退；`activityScopeSource` 本就是 project 源。改后 Node26 `tsc --noEmit` exit 0，lib 会话组 13 绿；壳体 react 四套件对照基线持平：`session-history-panel` 5/5、`assistant-brief-memory` 17/17、`canvas-session` 7/7、`session-generation` 6/6（均为台账存量 jsdom 环境红，未增红）。
- **回退原因（门禁 §4 复核成立）**：`workspace-shell.tsx:117-141` 载入 effect 的 prop 只来自 `latestOutdoorProjectId()` 最近指针 / URL `project=` / `decideDefaultOutdoorProject()`；本机活动 `house-<uuid>` 在 `commitFreshActivityLayout` 里刻意 `trackLastProject=false` 不顶最近指针。刷新续开本机活动时 prop 回不到活动 id，回退去掉后会话槽按 `default-outdoor` 派生，与 plan 槽（仍 `layout.id ?? prop`）割裂，正是 §4 警告的「一个 id 全活动共享、历史全摊一起」旧病。
- **回退结果**：两处 scope 恢复 `projectSessionScope(layout.id ?? outdoorProjectIdProp)`；`room-organizer.tsx` 当前 diff 仅保留 B1-a 两处 `setOutdoorProjectId`（:4123 新建活动、:4647 云绑定），过渡态行为等价。`tsc --noEmit` exit 0。
- **B1-b 解除条件**：先补 shell/壳体的「现役本机活动记录 → prop」反推链路（刷新续开能把 house id 恢复到 prop），并核对刷新后 plan 槽与会话槽一致；再同批切正源、去回退。在此之前维持双源回退。
- **B1-c 判定**：floor tracker 不单独注入 project 源，随 E2 容器退役移除；venue tracker 保持几何 basis 不动。
- **B1-a 安全核对（2026-11-21）**：新建活动 `prop=house-<uuid>` 后 `explicitOutdoorProject=true`，但 `caseActivityAlignment`（`case-activity-alignment.ts:29`）只对 `replica-` 前缀生效，house-id 返回 null、不改 layout.id/name；plan 记录本就按 `created.id` 落槽（:4117），新旧一致；:4115 分支旧代码在 `prop=default-outdoor` 时同样进入。过渡态行为保持成立，无误入云项目回写/只读通路。
- **全量对照（Node26，2026-11-21）**：前端全量 126 failed files / 715 passed（841 files）；基线台账 `63b11ae1` 记 116 个失败文件。多出的 20 个文件经 `git stash` 回到 main 干净态定向复跑，**20/20 同样失败**，属 main 既有状态（基线快照过时 / Node 环境差异），非 B1-a 引入。lib 会话组 13 绿；active react 5 红、壳体 react 四套件 5/17/7/6 红，均与基线持平。根 / 前端 `tsc --noEmit` 均 exit 0。

## 11.7 creative-studio 夹具红根因排查（2026-11-21，未入库代码）

- **根因**：Node 26 预置 `undefined` 的实验性 `localStorage` 占位，jsdom 30 覆盖未生效，jsdom 套件 `localStorage` 为 `undefined`（`sessionStorage` 正常）。夹具直接 `localStorage.clear()/setItem()` 在 setup 阶段崩，整套快速失败。
- **试探**：`test-setup.ts` 全局补内存 Storage polyfill → creative-studio 320→21 failed、history 5→0、error 8→3、generation 6→4。
- **否决理由**：polyfill 让 mock 不全的 `canvas-session`/`brief-memory` 越过早期崩溃、进入完整壳体渲染并跑满 15s 超时挂起（对照：main 19ms 快速 7/7；仅 B1 壳体改动 17ms 快速红；带 polyfill 挂起）。破坏全量超时门禁，**已回退 `test-setup.ts` 至 main 原版，无 diff**。
- **剩余夹具债**：creative-studio 测试另依赖 `Object.keys(localStorage)` 枚举键 + `spyOn(Storage.prototype,…)` 原型替换；需重写该套件存储基座（注入内存 storage 实例、原型可 spy），属独立工程，不在 B1 本轮。详见目标台账 §3.2.1。

## 11.8 B1-b 解除条件推进记录（2026-11-21，未提交）

**口径矛盾定论（壳体 `:4122`）**：新建本机活动调 `saveOutdoorProjectRecord` 原本漏传第三参 `trackLastProject`（缺省 `true`，会把最近指针顶成 house-id）。三处既定口径一致指向活动级记录不顶指针：overlay `:853` `!activityScopedPlan`、store 测试 `:260-261`（house 记录写入后指针仍是云项目 PID）、壳体注释「本机活动保持本机入口」。判定为 main 既有口径漂移，本轮补传 `false` 对齐；无壳体测试断言新建活动顶指针，未打破既有断言。

**草稿索引枚举地基（纯 lib，未接 shell）**：`outdoor-project-store.ts` 新增 `listOutdoorProjectRecords(storage?)`——枚举 `scendance-outdoor-plan-v1:*` 前缀信封，读回有效记录、按 `updatedAt` 降序（同时间按 id 字典序），过滤最近指针/接管标记等元键与坏信封。枚举能力结构探测：优先标准 Storage `length`/`key()`，退回对象自有可枚举键；存储不提供枚举能力时安静返回空、不抛错。未扩 `KeyValueStorage` 三方法契约，不牵动现有 Map mock。定向单测 2 例（降序过滤 / 无枚举能力返回空），store 套件 39 绿；Node26 `tsc --noEmit` exit 0。

**仍阻塞（不硬拆）**：
- shell 恢复策略未定：无参刷新是否自动从草稿索引续最近本机草稿，属产品语义（现状设计为「续最近云项目 → 否则默认草稿」，本机活动从列表手动切回）。枚举函数已就位，但恢复档位与优先级须产品口径确认 + 壳体套件绿测保护后再接。
- `sessionScope` 仍维持 `layout.id ?? prop` 回退；`activeProjectId` 派生第一小步同源已落地，去回退随草稿索引闭合同批改。
- 受影响本机活动定向组（local-fresh-activity / outdoor-plan-adoption / case-activity-alignment）9 failed / 4 passed，与基线台账持平，失败根因均为 jsdom `localStorage` 占位 undefined 的存量夹具债，非本轮引入。

### 11.8.1 方案 B 拍板与 B1-b 去回退落地（2026-11-21，未提交）

**产品决策（方案 B）**：无参刷新 / 重打开回默认草稿或最近云项目；本机 `house-*` 草稿**不自动续开**，只在从活动列表切换或带 `?project=` 链接进入时按指定 id 解析。身份恢复走 plan 槽，不借室内 layout 单槽反推。

**落地**：`activeProjectId` 派生由 `explicit ? prop : (layout.id ?? prop)` 改为纯 `prop ?? DEFAULT_OUTDOOR_PROJECT_ID`；`sessionScope`、`getStoreSessionScope`、activity tracker 源三处同取该派生值，会话身份域不再读 `layout.id`。逐路径核对 prop 均就绪：云绑定 / 新建活动（B1-a 已上提 prop）、列表切换、带链接进入由 shell 解析 id；无参刷新按 B 回默认/最近云项目。`projectSessionScope` 对空 id 本就回落 default，初始 `INITIAL_LAYOUT` 无顶层 id，无串号。

**未越界保留**：plan 槽 `outdoorPlanSlotId` 与镜像回写（B4）、环境偏好键 `layout.id`（B1-d）、活动变更守卫 epoch 判定、发布项目 id 解析，均不在本次会话域去回退范围。

**验证（Node26）**：`tsc --noEmit` exit 0；lib 会话/身份纯函数组 56 passed / 1 failed（唯一红为 `case-activity-alignment` 基线存量红）；壳体 react 四套件 23 failed，与基线合计 23 持平，失败根因均为 `localStorage.clear()` 占位 undefined 的存量夹具债，84ms 快速失败、无挂起。**未取得壳体绿测保护与真机走查**，去回退过渡态留待 B1-e 验收。

**B1-d 下一轮接入点（已勘察，未动码；成套不可拆两半）**：`CreativeStudioProvider`（panels/creative-studio.tsx:275）Props 目前**不收 scope/projectId**。壳体渲染点 room-organizer.tsx:4942 已传 `sessionToken`/`isSessionCurrent`，未传会话 scope 字符串。

*键空间分裂事实（2026-11-21 核实）*：`LayoutAgentProvider`（agent-panel.tsx:706）`useAssistantSessions(requireSessionWrite, sessionScope)` 把会话仓建在 `project:<activeProjectId>` 键空间（壳体 :392 `sessionScope = projectSessionScope(activeProjectId)`）；而 creative-studio 面板仍读旧 `activity:` 前缀键——:516 `subscribeActiveAssistantSession(\`activity:${layout.id??''}\`)`、:1908 `chatScope=\`activity:${selected.layout.id??''}\``。`scopedStores` 按 scope 字符串分仓，两前缀是两个仓，会话订阅/活跃会话读取存在裂缝。**改订阅前须先核旧 `activity:` 仓是否仍有写入方**（旧 house 活动路径），避免切仓后失效监听丢失。

*触点三类归属*：
- 当前活动会话订阅（B1-d 身份域）：:516 订阅；:518/:643 effect 依赖 layout.id。
- 候选方案会话（跨项目语义，成套时细校）：:1908 用 `selected.layout.id`（候选 proposal 的 id，非当前活动），不能直接换当前 sessionScope。
- 面板内部裸 id 存储（自洽局部 scope，B1-d 成套 / B3-B4 分域）：:290 briefStorage.scope、:334 `scope=layout.id??'local'`、:333 preservingPreparation 比对、:335 scopeWriteGuards、:336 scopeRef、:340/:347 readonly draft reader、:355 coordinator.scope 比对、:362 editorLease；:752 `useMaterialCheckins({projectId: layout.id})`；:833/:836/:844 备份域；:1026/:1029 恢复；:2077/:2222/:2449/:2511 库存/几何/源冲刷比对。点验/备份/几何域归 B3/B4。

*测试现状与保护缺口（门禁前置）*：面板 320 套件把 `subscribeActiveAssistantSession`/`getActiveAssistantSessionId` 整体 mock，**不校验传入 scope 字符串**，故改键名面板单测仍绿；但真实仓连通性（订阅谁的仓、活跃会话是否同仓）没有壳体绿测、也没有真机兜底。B1-d 成套改造前必须先：① 解除壳体两套件（canvas-session 7、session-generation 6）夹具挂起、取得壳体绿测保护；② 同步更新面板测试的 scope 构造（现靠 rerender 换 layout.id 构造活动隔离）；③ 真机核对切项目不串会话、新建活动记忆各落各槽。未满足前不在面板上硬拆 scope 链路。

### 11.8.2 基座推广：可控套件转绿，壳体全渲染套件挂起判定（2026-11-21，未提交）

`MemoryStorage` 基座按「套件内定向注入、不进全局 `test-setup.ts`」模式继续推广：

- **已转绿（22 套件 / 223 测试，另基座单测 5 + store 39）**：基座按套件内定向注入（beforeEach 建 `MemoryStorage` + `stubGlobal('Storage'|'localStorage',…)` + 同步 `window.localStorage`；afterEach 先清实例再 `unstubAllGlobals`），只覆盖受控面板 / renderHook / 纯 lib 存储读取套件，不进全局 setup。
  - 受控面板与 hook：`session-history-panel` 5、`use-assistant-sessions-active` 5。
  - 简报 / 待办 / 场地事实：`assistant-brief-memory` 17、`pending-brief` 9、`venue-facts-storage` 9、`reported-inventory` 13、`outdoor-plan-adoption` 5。
  - 环境偏好与位置事务：`environment-preference` 4、`environment-preference.strict` 12、`environment-write-reconciliation` 9、`environment-position-transaction` 8、`site-calibration-capability` 7。
  - 图库 / 版本 / 分享 / 地图槽位 / 持久化：`library-lease` 5、`library` 17、`version-history-capability` 4、`review-link-versions` 7、`review-share` 3、`share-records` 8、`map-source-slots` 11、`unlinked-venue-export` 11、`persistence` 51；根 lib `local-fresh-activity` 3。
  - 汇总复跑 24 文件 **267 passed / 0 failed**（含基座单测、store 套件），Node26 `tsc --noEmit` exit 0；`persistence` 等套件 stderr 的配额 / 安全错误日志是测试故意触发的容错分支，非失败。
- **挂起判定（已回退，不接入）**：`room-organizer-canvas-session.react.test.tsx`（7）与 `room-organizer-session-generation.react.test.tsx`（6）是壳体全渲染套件（`render(<RoomOrganizer/>)` + `findByLabelText(..., {timeout:15000})`）。定向注入基座后越过 setup 阶段崩溃、进入完整壳体渲染，但三/2D 场景、Agent 解析等 mock 不全，断言等待跑满 15s 超时，实测后台 >5min 无任何输出；与 §11.7 全局 polyfill 挂起结论一致。`canvas-session` 注入三处已回退至基线（`localStorage.clear()` 裸调、无 MemoryStorage 引用），`session-generation` 未动码；两套件保留基线快速红，归入存量壳体夹具债。
- **未接入的存量债**：`local-scans`（11）走 `vi.resetModules()` 动态重载 + 资产文件 / 登记域，四个 describe 各带 beforeEach，注入时机需先于重载，结构复杂、易残留非存储根因红，本轮不强行接；`local-seating-draft`、`cloud-material-draft` 残留红根因为 `Cannot set properties of undefined (setting 'name')`，非存储占位，不在基座范围。
- **基座覆盖边界**：仅适用于「受控面板 / renderHook / 纯 lib 存储读取」套件；壳体全渲染套件须先补齐场景与 Agent mock、能稳定找到输入框，再谈存储基座，归 B1-e 验收前的夹具工程。

## 11. 本轮基线记录（Node26，main `2de462be`）

- `npm run typecheck`（tsc --noEmit）：**exit 0**。
- 定向会话/身份组（activity-session-epoch / project-session-scope / floor-session-epoch / venue-fact-epoch / case-activity-alignment / outdoor-project-store）：**54 passed，1 failed**。
- 唯一失败：`case-activity-alignment.test.ts`「案例打开时把当前活动身份换成案例记录的 id 与名字」`expected null not to be null`（:29）——**pre-existing 基线红**，纯函数、与 B1 改动无关；B1 完成后不得新增失败，该条另行定位修复。
