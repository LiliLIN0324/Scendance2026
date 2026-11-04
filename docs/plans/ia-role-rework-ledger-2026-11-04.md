# 四角色 IA 重划导演台账 — 活动 / 审校 Bingo / 空间 / 物料

> 日期：2026-11-04
> 基线分支：`feat/smart-build-scene-script`，基线提交 `a87c156`（P4 已固化，未 push、未合 main）
> 产品来源：同项目会话「项目逻辑问题讨论」2026-11-04 的结论（owner 已口头确认「第一个 agent 是活动」「Bingo 本来是做审校的，后面调错了」）
> 旧对照表：`C:\幕景\Scendance2026\docs\plans\ia-mapping\信息架构现状目标对照.html`（基于旧快照分支 `codex/delivery-research-20261007` 与 2026-10-10 Playwright 快照，**代码事实已过期，被本台账取代**）
> 核查方法：本台账每一行都以活仓库工作树的 `file:line` 为凭；未实测的一律标「待核验」，不照收旧表结论。

---

## 0. 一页结论

1. 左轨仍是**四形**（不加第五图标），但语义重划：**活动**（原「总控」，唯一真对话与生成入口）· **审校 Bingo**（钉评/回执/体检，不做布置生成）· **空间**（场与壳的工具面板）· **物料**（道具库与生成工具面板）。
2. 技术上**一套 Agent 壳 + 两套能力**：活动对话引擎（现有 `LayoutAgentProvider` + scene-script 家族）与审校钉评状态机（review-pins / review-share）；空间、物料不给人格化聊天。
3. **不建真多智能体调度台**。现有的「总控分派」只是同场气泡打标签，本轮到 S1 拆除；真队列/异步回执等硬需求出现后再议。
4. 旧对照表最大的偏差是**查错了目录**：它核的是 10/10 旧快照，活枝里四脸、审校闭环、Aholo/高斯集成、成员聊天都已落地，缺口从「新建」变成「收口、归位、云端化」。
5. 执行顺序 S0（本文档）→ S1+S2（活动/Bingo 归位，串行同刀）→ S3（空间/物料面板化）→ S4（清理回归）。每刀过同一组回归门，红线是 `onApplyCreative` 三道门不松。

---

## 1. 绑定产品决定（owner 已确认，作为后续切片的需求源）

| # | 决定 | 口径 |
|---|---|---|
| D1 | 四角色 = 活动 / 审校 Bingo / 空间 / 物料 | 异层范畴不再假装平级人格：活动是容器与主线，审校是动作，空间/物料是两类资产面板 |
| D2 | 活动是唯一接 LLM 干活的主对话 | 说目标 → 出布置方案 → 绿框预览 → 唯一确认；开场是活动画廊（过往/新建卡片），成员区沉底 |
| D3 | Bingo 回归审校本意 | 画面钉点 → 意见线程 → 标记解决 → 回流制作者台账；对标 Figma / Frame.io，不承担布置生成对话 |
| D4 | 空间/物料是工具面不是人设 | 库、预览、短指令/「＋」动作；物料在产品上分库，技术上与场地生成并管线，不造第二套生成故事 |
| D5 | 成员是真人团队，不是 agent 入口 | 私聊、在场、以后的分工待办挂在活动内；agent 只在左轨切 |
| D6 | 真多智能体后置 | 先把单 agent 多步工具调用与状态机做扎实；出现并行/异步/上下文隔离硬约束再上编排 |
| D7 | 评审云端化、成员协作上层后置 | 本轮先收本地闭环与 IA 归位，Supabase 持久化不进 S1-S3 范围 |

---

## 2. 旧快照核查的事实更正（六条，全部带活枝证据）

| 旧表/旧会话断言（10/10 快照口径） | 活枝实况（`a87c156`） | 对计划的影响 |
|---|---|---|
| 四 agent/总控/分派「全库零命中，是没落地的设计稿」 | 四脸已落地：`AgentId='door'|'bingo'|'space'|'material'` 与 `AGENT_META` 在 `panels/agent-panel.tsx:1742-1749`；假分派卡 `AgentControlCard`（`:1771`）、台账 `dispatchRecords`（`:1752`）、`talkTo` 标签（`:1863-1871`）真实存在 | S1 是「改职责」而非「从零建」，拆假分派有现成代码点 |
| 审校闭环断裂：客户页无评论、无钉点/线程/解决状态 | 本地闭环已具雏形：`lib/review-pins.ts:6-8,49,118` 有 open/resolved 钉状态机，`panels/review-pin-layer.tsx` 是画布钉层；`lib/review-share.ts:18,59,71,177` 有评论（含 `parentId` 线程、上限 80 条）与 BingoMark；`panels/review-share-page.tsx:146-152` 有评论/回复表单；路由 `app/review/[id]/page.tsx` + `review-link-client.tsx` 挂 `ReviewSharePage` | S2 是四碎片**收口**；唯一硬缺口是持久化仅 `local-demo`（localStorage，不上 Supabase），云端化按 D7 后置 |
| Binggo 是唯一 AI 名，改名牵动最深链路 | 活枝已统一命名 **Bingo**；生成/校验/回写在 `LayoutAgentProvider`（`agent-panel.tsx:264`）经 `onPreview`/`onApply` 运行，引擎 `useStudioAgent`（`:50` 引 `creative-studio`）与 P4 的 scene-script 家族都与「脸」解耦 | 换脸不动引擎，回归靠现有 46 个 react 测试与三道门 |
| MemberChat 零命中，成员聊天不存在 | `panels/member-chat.tsx` 已在枝（同一套气泡/输入条），`lib/team-messages.ts` 经 `@/lib/workspace-api` 收发与未读同步 | D5 有底座；本地/云端能力边界列入 S1 待核验 |
| 高斯/Aholo/Lux3d 全库零命中，是设计稿名词 | room-organizer 内实测命中：Aholo 329、Lux3d 60、高斯 43、Gaussian 23、HY-3D 14（文件命中数，2026-11-04 全量 grep） | 旧表「别按错误前提排期」的提醒作废；S3 面对的是**已集成**能力的入口收束 |
| 评审/执行是并列常驻工作台模式 | `lib/workbench-mode.ts` 已把一级模式收敛为只剩 `layout`；`demoteLegacyMode` 把 review/delivery 改导到分享链接与清单抽屉，不占常驻模式 | S2 顺着现状走：审校从分享链接进，不复活常驻模式轨 |

---

## 3. 活枝现状 → 目标 IA 逐行映射（只登记已核验项）

处置色：**复用**＝原样保留 · **改造**＝要动代码/挂载条件 · **收口**＝多碎片合并 · **后置**＝本轮不做。

### A · 活动（容器 / 主工作台）

| 现状能力（活枝证据） | 目标归属 | 处置 | 备注 |
|---|---|---|---|
| 四脸元数据与角色文案 `agent-panel.tsx:1742-1749`（door 现名「总控」，role「活动目标、信息汇总与任务分派」） | 活动 | 改造 | 改名「活动」、role 改为主对话/活动目标；`RailForm` 四形 `rail-avatar.tsx:5` 不动视觉只改语义 |
| 假分派：`AgentControlCard` `:1771`、`dispatchRecords` `:1752`、`talkTo` `:1863-1871`、`send(text,to)` `:1231` 与输入框头像叠选 `:2038-2044` | 活动 | 改造（拆除） | 不做真调度（D6）；点名控件与「先说一句，我来分派」空态（`:1944`）整块移除，台账能力若保留只做只读活动摘要 |
| 生成主 chrome：`PlanHome` `:1947`、`ProposalCard` `:1967`、计划卡 `:1968-1979`、会话历史/新开会话 `:1910-1930,1939`，目前全部 `bingo &&` 门控 | 活动 | 改造 | 挂到活动（door）脸；Bingo 脸不再渲染；注意 `AgentPanel` 默认 `activeAgent='bingo'`（`:1827`）要改默认落点 |
| 生成引擎与三道门：`LayoutAgentProvider` `:264`、`CreativeStudioProvider`（`room-organizer.tsx:1942`）、AgentPanel 宿主 `room-organizer.tsx:2017`、scene-script/local-plan/compiler（P4 提交 `a87c156`） | 活动 | 复用 | 引擎与脸无关；`onApplyCreative`、绿框预览、撤销三道门是回归红线，禁止改接线 |
| 本机活动列表面板 `panels/local-activities-panel.tsx`（逻辑内联，无独立 lib） | 活动·开场画廊 | 改造 | 升级为画廊卡片入口；云端活动库是否已通列入 S1 待核验，不通则保持本机口径并诚实标注 |
| 真人成员 `panels/member-chat.tsx`、`lib/team-messages.ts`、`panels/account-team-panel.tsx`、`lib/team-data.ts` | 活动·底部成员 | 复用 | 与 agent 槽位分清；待核验 workspace-api 在无云环境的降级行为 |

### B · 审校 Bingo（动作 / 钉评协作）

| 现状能力（活枝证据） | 目标归属 | 处置 | 备注 |
|---|---|---|---|
| 布置体检引擎 `lib/layout-review.ts:26-27`（6 类 issue / 6 类 fix）、`reviewLayout:240`、`proposeReviewFix:583` | Bingo | 收口 | 自动体检+一键修复归审校脸，作为制作者侧能力 |
| 画布评审钉 `lib/review-pins.ts`（open/resolved、筛选、计数 `:118-127`）+ `panels/review-pin-layer.tsx`（钉点输入层） | Bingo | 收口 | 审校核心交互，已在枝；S2 核验与评论线程的锚点映射是否端到端 |
| 对外评审页 `lib/review-share.ts` + `panels/review-share-page.tsx` + 路由 `app/review/[id]/` | Bingo·客户侧 | 复用→后置云端 | 客户可评论/回复（localStorage `local-demo`，`:18` 注释明示不上 Supabase）；云端持久化是本轮唯一「新建」性质的缺口，按 D7 后置 |
| 回流台账 `lib/bingo-feedback.ts`、`panels/bingo-audit-card.tsx:22-25`（甲方评审只读记录，含 `clientHref`/`pinCount`/`returned`） | Bingo | 收口 | 与评审钉、评论合为同一回执台账，不再分散挂在 Bingo 对话气泡下 |
| 评审模式槽位 `reviewSlot`（`room-organizer.tsx:2017`，`workbenchMode==='review'` 时挂 `ReviewIssuesCard`，定义在 `mode-shell.tsx:19`） | Bingo | 改造 | 模式入口已由 `demoteLegacyMode` 收为分享链接；S2 决定评审脸的进入路径与组件排布 |
| Bingo 脸上的布置生成对话（同 A 组生成 chrome 的现挂载点） | 活动 | 改造 | S1/S2 同刀：摘走生成、保留评审相关话术与「准备客户评审」类指令（是否保留输入条见开放项 Q3） |

### C · 空间（场 / 壳 / 舞台）

| 现状能力（活枝证据） | 目标归属 | 处置 | 备注 |
|---|---|---|---|
| 空间脸与槽位：`agent-panel.tsx:2006-2014`（space 工具 chips + `spaceSlot`，宿主传 `SpacePanel`，`room-organizer.tsx:2017`） | 空间 | 复用/面板化 | 保留工具面，去掉人格对话感（见 S3） |
| Aholo/高斯/Lux3d 建场与重建能力（room-organizer 内 329/60/43 命中）、`reconstruction-panel.tsx`、`splat-state` 环境槽 | 空间 | 复用 | 已集成能力，S3 只收入口与文案，不重写管线 |
| 场地上的多入口（地图/空白/换场地/模板/环境等） | 空间 | 改造（收束） | S3 先盘点全部入口再砍重复，保留一条主动线 |

### D · 物料（道具 / 可摆放的件）

| 现状能力（活枝证据） | 目标归属 | 处置 | 备注 |
|---|---|---|---|
| 物料脸与槽位：`materialSlot` 传 `ScendanceLibrary`（`room-organizer.tsx:2017`），面板分支 `agent-panel.tsx:2006` 起 | 物料 | 复用/面板化 | 库为主体，「＋」生成是库内动作 |
| HY-3D 生成件归档、材质、到场点验：`generated-model-library.tsx`、`material-customization.tsx`、`material-checkin-panel.tsx` 等（旧表逐行核过，文件在枝） | 物料 | 复用 | 执行阶段台账保留 |
| 「场地 \| 物料」双 Tab 备选 | 空间/物料 | 后置 | 仅在 S0/S3 文档定案，代码本轮不动轨 |

### E · 横切与红线

| 项 | 证据 | 口径 |
|---|---|---|
| 共用输入框 `agent-panel.tsx:2030-2056`（四脸同形，door 占位符 `:2047`） | 改造 | S1 后仅活动脸保留完整对话；空间/物料收为工具动作，具体形态 S3 出方案 |
| 三道门：绿框预览（onPreview）→ 唯一确认（`onApplyCreative`）→ 撤销整体退回 | 红线 | 任何切片不得绕过或新增第二套落盘；不 fork 第四套 wire schema |
| 左轨四形与导航注释 `lib/nav-chrome.ts`、`panels/rail-avatar.tsx` | 改造（文案/语义） | 不加第五图标；门洞钮品牌/展开/进总控三意问题留 S4 |
| 既有报错 `agent-panel.tsx:341` setState-in-render | S4 | 不在 P4 diff 内，单列修复，不顺手在 S1/S2 夹带 |

---

## 4. 切片挂载点清单（导演任务书）

### S1 活动归位（任务板 #6，与 S2 串行同刀）

- 改名与角色：`agent-panel.tsx:1744-1749`（AGENT_META door→活动、role 重写）；排查所有直写「总控」的文案与 `agent-panel.react.test.tsx` 断言（含 `activeAgent="door"` 用例）。
- 拆假分派：删/改 `AgentControlCard`（`:1771`）、`dispatchRecords`（`:1752`）、`talkTo/startTalk`（`:1863-1871`）、composer 头像叠选（`:2038-2044`）、空态话术（`:1942-1945`）、`AgentCapabilityPrompts owner="door"`（`:2028`）；先全局 grep `talkTo`/`dispatchRecords` 确认无外部消费者再删。
- 生成 chrome 换脸：`:1910-1930`、`:1939`、`:1947-1953`、`:1960-1980` 的 `bingo &&`/`door &&` 条件重挂；默认脸 `:1827` 与 `room-organizer.tsx:2017` 的 `activeAgent` 初始值同步改。
- 画廊入口：`local-activities-panel.tsx` 当前挂载点与数据流先核后接（标记为 S1.1，若体量超出则拆独立子切片，不阻塞归位主刀）。
- 必改测试：`agent-panel.react.test.tsx`、`rail-side-panels.react.test.tsx`（现有断言 `agentPanelVisible && <AgentPanel`），按新门补「活动脸出提案、Bingo 脸不出提案」用例。

### S2 Bingo 转审校（任务板 #7）

- 脸内容重排：Bingo 脸仅留评审入口/钉层/审计卡/`ReviewIssuesCard`/体检结果；摘除 PlanHome、ProposalCard、生成进度 `GenProgress`（`:1962`）等布置态。
- 闭环核验：串起 `review-share` 客户评论 → `bingo-feedback` 回流 → `review-pins` open/resolved → `BingoAuditCard` 计数，缺哪段补哪段并补测试；现有测试资产：`bingo-feedback.test.ts`、`bingo-status.test.ts`、`review-pins.test.ts`、`layout-review.test.ts`、`review-share.test.ts`、`review-copy.test.ts`。
- 文档写清 `local-demo` 边界与云端化接口预留点，但不实现 Supabase 同步（D7）。

### S3 空间/物料面板化（任务板 #8）

- 先审计后动手：两脸现存聊天行为（共用 composer 在非活动脸实际能触发什么）、全部场地/建场入口清单，产出一页入口对照表再定砍留。
- 收非活动脸对话入口、收束重复入口；双 Tab 方案只落文档决定。禁区：不动生成管线、不新增 wire schema。

### S4 清理与全量回归（任务板 #9）

- 修 `:341` setState-in-updater；处理门洞钮三意；全量过回归门并补浏览器冒烟；更新 `docs/research/` 与本文档的行号漂移。

### 回归门（每刀必过，node24 口径）

1. 7 个 lib 套件全绿（基线 96/96）+ `agent-panel.react` 全绿（基线 46/46），新增行为先补测试再改代码。
2. `tsc --noEmit` exit 0；`npm run build`（静态导出）exit 0。
3. `:3001 next dev` 浏览器冒烟：生成三道门、评审评论/钉解决回流、四脸切换各一条主路径。
4. git 纪律：本地 commit 粒度按切片，不 push、不合 main；不绕 `onApplyCreative`。

---

## 5. 不做清单（Non-goals，防止切片膨胀）

- 不新增第五个左轨图标、不做真多智能体任务队列/异步回执/调度器。
- 不实现评审与成员的 Supabase 云端化（仅留接口注释与诚实边界文案）。
- 不重写 3D 画布、scene-script 引擎、Aholo/HY-3D 管线。
- 不引入新色系（沿用冷石+品牌绿）；surface 文案继续遵守 10-29 备忘录的禁词，内部管线名不提「高斯/WorldGen」。
- 不动旧快照目录 `C:\幕景\Scendance2026`，所有工作只在 `C:\mujing\Scendance2026`。

---

## 6. 待 owner 拍板的开放项

- Q1【已决定 2026-11-04】显示名定「活动」；`door` 形态毛绒头像先保留（rail-avatar 四脸家族统一、零美术成本）。内部标识符 `'door'` 本切片不动，代码内以 `activity` 语义别名 + 注释标注，S4 再做标识符级重命名。
- Q2【已决定 2026-11-04】画廊拆独立切片 S1.1（任务板 #12），不阻塞 S1.0 归位主刀。
- Q3【已决定 2026-11-04】纯状态台 + 三钮：摘除 Bingo 脸自由输入框，改为「准备客户评审 / 导出评审包 / 立即体检」三个按钮（前置审计证实 `reviewNow()` 现唯一入口是自由口令，摘框前必须先按钮化，故为三钮而非两口令）；三钮复用 `onOpenReview` / `proposeExport` / `reviewNow`，零新 state、不碰三道门。
- Q4【待拍板，S2 输入】评审云端化的排期窗口（决定 S2 预留接口的形状，但不允许在 S2 偷偷实现）；调研倾向 S2 只留接口形状。

---

## 7. 切片交付记录

### S1.0 活动归位（2026-11-04 完工，任务板 #6）

- 改动文件：`panels/agent-panel.tsx`、`panels/agent-panel.react.test.tsx`、`panels/typed-suggestion.tsx`、`room-organizer.tsx`，共 4 个；未碰数据层、wire schema 与三道门。
- 落地内容：AGENT_META 改名「活动」并重写两脸角色文案；整块删除 `dispatchRecords`/`AgentControlCard` 与 `talkTo` 多选点名状态、头像叠选、分派结果卡、`Bubbles` 收发标签；空态统一为「先说一句就行」；会话历史/新开、PlanHome、布置生成 chrome（issue chips/GenProgress/ProposalCard/plan-summary）、StyleBundlePanel、能力芯片（地图选址 + 按风格配一套）全部改挂活动脸；Bingo 脸中间态仅留共用 composer 与 BingoAuditCard，无任何生成入口；默认脸与导航 aria 同步。
- 有意保留：`Bubble.to?` 与 `send(text, to?)` 为旧会话回放兼容路径（`assistant-session-bodies.ts` 依赖），UI 已无人传参，注释标 legacy，S4 随类型清理移除。
- 回归证据（node24 本机口径）：`tsc --noEmit` exit 0；`agent-panel.react` 46/46 全绿（含新增「S1 活动归位」3 条用例，删除 3 条假分派旧用例）；全量 vitest 4158 中 44 失败/15 文件，与冻结基线（45/16）逐文件比对**零新增失败文件、零新增失败用例**，差额为既有环境性波动文件 `lib/share.test.ts` 本轮转绿；`next build` Compiled successfully 并静态导出新鲜产物；:3001 浏览器冒烟四脸切换、活动脸双芯片/会话钮、Bingo 脸无生成 chrome、空间/物料面板原样、console 零报错（构建与 dev 共用 `.next` 导致的 chunk 失配已按老办法清目录重启恢复）。
