# 户外 Agent 强化执行进度

计划见 [户外 Agent 强化执行计划](2026-11-16-outdoor-agent-upgrade.md)。每轮执行先更新「当前续跑点」，完成后更新「执行记录」。所有状态以实际文件差异、提交和验收输出为准。

## 当前续跑点

- 总状态：**M0 已收口**；**M1a 1–3 已交付**；**M2/M3 已验收**；**M6 375/768 已验**；**M4 阻塞（分区分流仍要登录/模型，证据见轮次 28）**；**M5 进行中**（幂等票号 + 刷新恢复已交）；**M7 进行中**（31 门禁、32 回退手册、33 对照表、34–40 指标四层、41 会话报告、42 报告落成 .txt、43 发布前自检、44 验收声明行、45 门禁复跑、46 基线校正；**另：正式站走查在正式站登录态跑通 V1 场地范围与 V3 分区，V2 定位到两个死结并已修**；11 条用例仍 0 条三条全绿，旧基线已失效）。
- 正式站走查最重要的一条：**户外主链 V1–V5 已在正式站登录态整条跑通**（V1 场地/范围 → V3 分区 → V2 入口与通道 → V4 物料复用 → V4 子动线 → V5 岗位点位）。一共修掉四个死结：①确认窗口只有 60 秒；②场地自己的建筑足迹当障碍（OSM 把整座商场画成一块 800+ 环的建筑多边形，站内步行街全被包在里面）；③需求分区对不上画布（「餐饮区」永远清不掉）；④签到台没有 service 通道（邻区口只有 4m，被「离既有节点 15m 内不重复立口」整区跳过）。四处的正式站证据、根因、修法与未采纳项都写在本文件「执行记录」里。
- 正式站走查下一条操作：把 v4.15.6 / v4.15.7 / v4.16.1 三轮复验结果写回本文件与证据对照表并推 main；两条限制要如实写明——账号物料库是空的（没有真实物料可复用）、画布仍是本机草稿。用户提的「主通道改走场地北侧仁和路、观众从北门进场」这条偏好**仍未被采纳**（路网仍按等级与长度选湖滨路、入口候选仍只有延安路口），选路与入口候选口径本轮没有改。
- 验收口径：以计划 §0「用户口径」为准（不卡第一步 / 地图听懂人话 / 每步有下一步 / 会做设计 / 分层指令 / 一口气做完 / 可回看取证），优先级高于功能清单；任一不满足不得标已验收。
- 推送规则（2026-11-16 用户授权）：每轮验证通过即推 `main`，不 force；改动跨模块 → minor（当前 4.14.0 → 4.15.0），单点 → patch（4.14.0 → 4.14.1），两个 `package.json` 与 CHANGELOG 同步。**首次推送会把在途的 26 改 + 11 新增一起带上 main**，按模块拆成可回退的提交，不揉成一个。
- 调度现状：定时任务仍为 `*/30`（创建入口未返回可用的 automationId，按名更新返回 “Automation is unavailable”，未能改成 45 分钟）。文件侧要求「距上轮提交不足 40 分钟则本轮只核对退出」，实际节奏接近 45 分钟。
- 初始基线：`main` 在 `f1c5a525`，并带下列在途未提交改动。**本轮复现直接用这份工作树，不新建干净 checkout**——`place-first` 等守卫只存在于未提交文件里，干净检出会跑出与文档不符的另一种行为。
- 下一条操作：新增 `outdoor-release-bundle.ts`——`releaseStatusBundle()` 只算一次台账，卡片与快照共用，并给出 `gateReady`；`gateSummaryLine(reading)` 把读数压成一行。**本地 main = origin = `3edf35a7`（`div 0/0`，开工即齐）**；但**工作区这回真的在 `main` 上**（脏文件 6）——下轮若 origin 再前进，`branch -f` 会因“已 check out”失败，需先判能否 ff。待 PR 分支 `agent/outdoor-m7-walkthrough-wire` 已含 71–83 十三个切片。9222 三十九轮不通。下一条：把 `releaseStatusBundle()` 接进 hook 的 `logReleaseStatus()`（一次拿卡+快照，日志两段一起打）。首条命令 `cd frontend; npm test -- components/room-organizer/lib/outdoor-release-bundle.test.ts`。
- 本轮 dev server：**无**。轮次 29 起的 :3210 早已不响（/editor 探不通），但其 node 子进程（pid 19180）仍在内存里吃 2.8GB，轮次 31 已 `Stop-Process` 消掉——不消的话 `next build` 在 4.6GB 空闲内存下必 OOM。要跑浏览器再现先启：`cd frontend; $env:NODE_OPTIONS='--max-old-space-size=4096'; npm run dev > ..\.temp\dev-r32.log 2>&1`（默认 :3210）。
- 轮次 27 的 tsc 口径（必看）：工作树 `npx tsc --noEmit` 当前有用户在途改动引入的报错（`supabase/functions/_shared/api.ts:439` 的 `backend.agent` 可能为 undefined，及 `creative-studio.tsx` 引 `appendAgentRunThoughts`、`AgentRunEventPage.thoughts` 几处时有时无）。这些都不是本轮文件；本轮提交在隔离 worktree 上单独 typedcheck 验证（见执行记录）。
- 冲突处置留痕（轮次 11）：4 个文件的四段冲突全取了上游（已推的 `32844f72`，含 2026-11-16“室内不卡分区”新口径）；放弃的那一版已存成 `.temp/round11-stash.patch`（3299 行），`stash@{0}` 也仍在。
- 上一步已验（不依赖登录）：turnId/attemptId 不重复且无身份字段；每轮恰一个终态（第二次只留 `conflictingTerminal`）；重试复用 turnId、换 attemptId；错误码按“像不像错误码”判定，自然语言整体丢成 null。
- 阻塞（轮次 7 实浏）：待恢复槽写入后可验，但「地图上圈范围 → 确认边界」这一步要先进选址，而选址卡在未登录时只给“登录后继续这次选址”，成品页没有无登录的圈选入口。解除条件：有一个可用的登录态（或内测账号）在 3210 上跑一次圈选。
- 分支状态（轮次 7）：本地与远端同为 `e8a95e02`（快进 18 笔，含用户合并后的分支）。做法：`git stash` 46 项在途 → `git merge --ff-only origin/main` → `git stash pop`，零冲突、无重复提交。
- 未提交在途（本轮新增，因文件带用户 WIP，未单独提交）：`panels/agent-panel.tsx`——退回分支 `writePendingBrief(...)` 两行 + 范围确认后的接回 effect（`shouldResumeBrief` 门控、先清槽再发）。
- 已核实的第一失败点（已闭环）：① `placeStillPending` 把“地名未定”当成“整句待定”，补 `rangeConfirmed` 后不再误拦；② `matchVenueCommand` 将“在+地名+做”整句吞成选址，补 `isCompositeDesignBrief` 后设计部分入槽。
- 协作依赖：当前工作区有未提交改动，服务端段由 B 主责。M1a 可独立推进，M1b/c 的最终服务端验收需对应环境和权限。

| 批次 | 状态 | 当前切片或验收证据 |
| --- | --- | --- |
| M0 固定复现 | 已收口 | 首断点两条已定位并修复：`placeStillPending` 增加 `rangeConfirmed`；复合句不再被 `matchVenueCommand` 整句吃掉。浏览器重验：零 `/assistant/chat`，待恢复槽已写入原句。 |
| M1 诊断 | 进行中 | 切片 1：`turn-trace.ts` 14 条。切片 2：`turn-trace-log.ts` 7 条。切片 3：`turn-failure-diag.ts` 5 条 + 面板接线（失败卡显示编号与可做动作），面板 30 条 react 测试仍绿。待验：真实失败下的浏览器实证（需登录）；M1b 待 B。 |
| M2 恢复需求 | 已验收（接回链） | 2a：`pending-brief.ts` 9 条。2b：`shouldResumeBrief` 按边界去重。2c：`outdoor-pending-task.ts` 12 条。2d：`outdoor-task-brief-bridge.ts` 9 条。轮次 14：退回气泡带唯一下一步且零 `/assistant/chat`。**轮次 21（登录态真实浏览器）：搜索目标地点 → 在地图上手画活动范围 → 四点闭合 → 确认并应用这一版，卡片自动前进到「分区用途与室内外依据」，红线已写进画布，静置 14 秒 xhr/fetch = 0。** 遗留：进度行「正在把…写入画布…」在 14 秒后仍显示（滞留守卫还是卡住未判定）；「跨活动不串」未验。 |
| M3 分流与上下文 | 进行中（解析层已交，接线未做） | 切片 3a：复合句保留整句、设计入槽，8 条测试通过。**轮次 25 实测：在已确认范围后发「无室内，后续是造墙」，xhr/fetch = 0，brief 与卡片均无变化，提示被「登录后继续这次选址」顶掉，也不追问——即这句现在说了等于没说。** 已交付 `lib/instruction-layers.ts`（环境口径 / 后置动作 / 当前指令三层拆分，9 条测试），接线到 brief 是下一步。 |
| M4 组合预览 | 阻塞（需登录/模型） | 以首条代表需求和直接编辑为中心。**轮次 28 实测：范围已确认后发「200 人市集，签到靠近入口，留出通道」→ 零请求、zones 仍 0、无任何气泡；发「帮我分区」→ 输入框被禁并写“登录后继续这次选址”；点卡片上的「预览分区用途与室内外依据」→ 请求 `/api/site-context` 后停在“正在处理”。结论：在线下/未登录环境拿不到组合预览，问题不在匹配器而在登录门。** 已交付其前置切片（v4.15.1：范围已确认后不再说“这次选址”）。 |
| M5 应用与恢复 | 进行中 | 补版本、应用幂等、撤销及中断验收。**轮次 29**：`ApplyOnce` 票号接在分区确认前（同一 epoch + 基准版本只写一次），6/6。**轮次 30**：刷新恢复改为逐项取舍（旧草稿不再整份丢掉、过期登录等待作废、未确认边界仍以“待确认”回来），9/9；`use-outdoor-agent-workflow.react.test.tsx` 40/40 全过。剩余：双击确认/切换活动/撤销的真实浏览器验收（需登录态）。 |
| M6 工作台体验 | 已验收（375/768） | 375/768 退回流程端到端已过。**375 卡片收口已修**：根因是 `mobile-shell.css:244` 的手机规则把左栏所有 `.sc-left-heading` 藏了，连同户外卡片标题栏里那枚唯一的关闭钮；改为只给 `.sc-left-drawer.is-outdoor-card` 放回标题栏。真实浏览器复验：关闭钮 32×32、点后 `cardOpen=false`、`railOpen=false`、入口可命中；768 同样通过且无横向溢出。**遗留：卡片打开时入口仍被盖住，只能靠顶部关闭钮退出（不再算缺陷）。480 全流程未跑。** |
| M7 验收和发布准备 | 进行中（已拦发布） | 31 门禁 / 32 回退手册 / 33 对照表 / 34–43 指标与自检 / 44 验收声明 / 45 门禁复跑；**46 基线校正**：两条旧基线在 main 上已失效（IN77 文件无历史、hook 套件 47/47）。9222 四轮不通。剩：真浏览器（需 9222）、面板按钮（面板仍在改）。 |

## 未提交改动清单（2026-11-16 08:12 基线 f1c5a525 实读；08:30 后 HEAD 已前进）

`git status --porcelain`，共 26 处修改、11 个新增未跟踪。这些文件都属于本轮基线，不得当作干净检出处理。

修改（M，26）：

```text
HANDOFF.md
README.md
package.json
frontend/components/agent-task-examples.react.test.tsx
frontend/components/agent-task-examples.tsx
frontend/components/room-organizer/components/outdoor-plan-canvas.tsx
frontend/components/room-organizer/components/outdoor-plan-overlay.tsx
frontend/components/room-organizer/components/outdoor-workflow-card.tsx
frontend/components/room-organizer/hooks/use-outdoor-agent-workflow.react.test.tsx
frontend/components/room-organizer/hooks/use-outdoor-agent-workflow.ts
frontend/components/room-organizer/lib/outdoor-agent-planning.test.ts
frontend/components/room-organizer/lib/outdoor-agent-planning.ts
frontend/components/room-organizer/lib/outdoor-plan-protection.test.ts
frontend/components/room-organizer/lib/outdoor-plan-protection.ts
frontend/components/room-organizer/lib/plan-ground-capture.ts
frontend/components/room-organizer/lib/sub-entrance.test.ts
frontend/components/room-organizer/lib/sub-entrance.ts
frontend/components/room-organizer/panels/agent-panel.tsx
frontend/components/room-organizer/panels/capability-suggestion-cards.tsx
frontend/components/room-organizer/panels/outdoor-stage-suggestion.tsx
frontend/components/room-organizer/panels/scendance-workspace.react.test.tsx
frontend/components/room-organizer/panels/scendance-workspace.tsx
frontend/components/room-organizer/panels/typed-suggestion.tsx
frontend/components/room-organizer/room-organizer.tsx
frontend/components/room-organizer/three/plan-basemap-tiles.ts
supabase/functions/_shared/outdoor-agent-response-contract.ts
```

新增（??，11）：

```text
deliverables/basemap-zoom-probe.json
docs/plans/2026-11-16-outdoor-agent-progress.md
docs/plans/2026-11-16-outdoor-agent-upgrade.md
frontend/components/room-organizer/lib/basemap-zoom-caps.test.ts
frontend/components/room-organizer/lib/basemap-zoom-caps.ts
frontend/components/room-organizer/lib/focus-place-search.ts
frontend/components/room-organizer/lib/outdoor-place-handover.test.ts
frontend/components/room-organizer/lib/outdoor-place-handover.ts
frontend/components/room-organizer/lib/place-first.test.ts
frontend/components/room-organizer/lib/place-first.ts
scripts/probe-basemap-zoom.mjs
```

其中与地图优先直接相关、本轮必须保留在基线的四个文件：`lib/place-first.ts`（入口守卫，07:30）、`lib/outdoor-place-handover.ts`（地图→对话交接，07:11）、`lib/focus-place-search.ts`（焦点送到地名搜索，07:57）、`panels/agent-panel.tsx` 中的守卫接线（08:04）。

## M7 发版门禁记录（2026-11-16 轮次 31）

环境：Windows，15.8 GB 内存，工作树 = `3e9d2aba`（含用户在途 41 项，未提任何一项）。任何人想重做这套验收，按下面三条命令原样跑。

| 门禁 | 命令 | 结果 | 备注 |
| --- | --- | --- | --- |
| 类型 | `cd frontend; npm run typecheck` | **0 错** | 即 `tsc --noEmit`，无输出 |
| 构建 | `cd frontend; $env:NODE_OPTIONS='--max-old-space-size=8192'; npm run build` | **通过** | `package-pages` + `next build` + `check-oneplan-artifacts`；未尾输出「扫描 3422 个产物文件，oneplan-icons 随产物发布 590 个，违规 0 条」 |
| 定向回归 | `cd frontend; npm test -- outdoor` | **34 文件 / 398 条全过** | 29.95s；涵盖 outdoor 画布/画框/分区/画具/登录文案/分层指令/刷新恢复/体验卡 |

**构建遇到的两个环境坑（已确认并绕开，不是代码问题）**：
1. 默认 4096 MB 堆 **不够**：本机空闲 4.6 GB 时 `next build` 报 `NewSpace::EnsureCurrentCapacity Allocation failed`，worker 退出码 134。
2. 空闲内存被一个 **陈旧 dev server 子进程**（`next/dist/server/lib/start-server.js`，pid 19180，2.8 GB，但 :3210 已不响）吃掉了。停掉它后空闲回到 7.4 GB，给 8192 MB 堆一次过。

**尚未覆盖（不得当已验）**：主流程浏览器验收与生产验证（需 9222 登录态与发布授权）；Edge 契约/权限/迁移检查（B 角色）；真实云端请求与日志关联。

## 执行记录

### 2026-11-18 17:00 · 自动轮次 83 · 一次算齐（卡片与快照共用一份台账）

```text
日期时间（中国标准时间）及运行 ID：2026-11-18 17:00，自动轮次 83
批次 / 切片 / 状态：合并（无待合）+ M7 / releaseStatusBundle / 已交付（分支待 PR）
开工事实：HEAD = `3edf35a7`，**分支就是 `main`**（脏文件 6）；local main = origin = `3edf35a7`（`div 0/0`）
合并：main 无待合；分支 `merge --no-edit main` 零冲突 → `1f540d33`
交付：`outdoor-release-bundle.ts`（`releaseStatusBundle()`：台账算一次，卡片/快照/全绿/门禁就绪同源；`gateSummaryLine()` 压一行）+ 6 条用例
验证（固定数据）：新用例 6/6（首跑 1 挂：手撕的 `GateReading` 形状不对，改用 `readGates({})` 表示“三项都没跑”），`tsc --noEmit` 0 行
真实浏览器/云端：仍未验（9222 第三十九轮 down）
未完成：#2 真实搜索、#5 浏览器行为；bundle 接进 hook
```

- **同一事实不要算两次**：卡片与快照各自调 `defaultLedger()`，少传一个参数就会在工单里自相矛盾；`releaseStatusBundle()` 的价值就是让这件事不可能发生。
- **“没跑”的道具不要手撕**：`GateReading` 有 `types/tests/build/verdict/line`，手写假对象容易长得像“跑过且干净”；用 `readGates({})` 表达“三项都没跑”才是真的。

### 2026-11-18 16:00 · 自动轮次 82 · 云端列为空时的提示语（把“空”和“都行”分开）

```text
日期时间（中国标准时间）及运行 ID：2026-11-18 16:00，自动轮次 82
批次 / 切片 / 状态：合并（无待合）+ M7 / 空列提示 / 已交付（分支待 PR）
开工事实：HEAD = `680a0b13`（`agent/outdoor-copy-pass-1`），脏文件 6；**local main 已等于 origin/main `712b6331`（`div 0/0`）——本轮无待合**
合并（分支）：`merge --no-edit main` 零冲突 → `3a4491f9`（分支已含主干最新 6 笔）
交付：`cloudLine()` 在 `pass === 0` 时追加“（要么没跑、要么还没声明）”；只要有 1 条通过，括注自动消失。新增 2 条用例（0 条时包含括注 / 1 条后不包含），连同状态卡与落盘 58/58
验证（固定数据）：`tsc --noEmit` 0 行
真实浏览器/云端：仍未验（9222 第三十八轮 down）——**声明仍是 0 条**
未完成：#2 真实搜索、#5 浏览器行为；三者一次返回的 bundle
```

- **“0 条”是最容易被误读的数字**：它既可能是“没跑”，也可能是“跑了没声明”；把两种原因并列写在同一个括号里，比单独加图例有效。

### 2026-11-18 15:00 · 自动轮次 81 · 云端声明落盘（单独一个键，与记录本互不覆盖）

```text
日期时间（中国标准时间）及运行 ID：2026-11-18 15:00，自动轮次 81
批次 / 切片 / 状态：合并 + M7 / 云端声明落盘 / 已交付（分支待 PR）
开工事实：HEAD = `fb7e8dc8`（`agent/outdoor-copy-pass-1`），脏文件 29；local main = `d52fefde`，origin/main = `9612c3c2`（落后 6 笔）
合并：`git branch -f main origin/main` → `div 0/0`；分支 `merge --no-edit main` 过程中 PowerShell 报了 `fatal: Out of memory, malloc failed`（同时 `git rev-parse` 也失败），**但复查发现合并提交已生成**（`56974606`，2 parents、main 为祖先、工作区干净）——不重复跑合并，只重建了 node_modules junction
交付：`outdoor-walkthrough-store.ts` 新增 `CLOUD_KEY` / `encodeCloud` / `decodeCloud` / `saveCloud` / `loadCloud`（去重升序、只留 1..11、坏数据当空、写失败返回 false）；hook 开局 `useRef(loadCloud())`，`declareCloud()` 成功即 `saveCloud()`。用例：store 13/13（新增 5，含“两个键互不覆盖”）、hook + 面板 85/85（新增 1：标完 `localStorage` 里有 `pass:[4]`，撤回后 `[]`）
验证（固定数据）：`tsc --noEmit` 0 行
真实浏览器/云端：仍未验（9222 第三十七轮 down）——**声明仍为空**
未完成：#2 真实搜索、#5 浏览器行为；空云端列的提示语
```

- **OOM 报错的合并未必没成**：先 `git log -1 --parents` 看是否已生成合并提交，再决定要不要重跑——重跑可能把干净状态弄成冲突。
- **两类事实分两个键**：走查记录本（看了哪几条）与云端声明（哪几条真跑过）语义不同，合存一份以后改格式会互相影响。

### 2026-11-18 14:00 · 自动轮次 80 · 面板第四个键：云端（声明/撤回）

```text
日期时间（中国标准时间）及运行 ID：2026-11-18 14:00，自动轮次 80
批次 / 切片 / 状态：合并 + M7 / 云端声明入面板 / 已交付（分支待 PR）
开工事实：HEAD = `fb7e8dc8`（`agent/outdoor-copy-pass-1`），脏文件 23；local main = `a3bff73b`，origin/main = `d52fefde`（落后 8 笔）；`.temp` 目录再次不存在
合并：`git branch -f main origin/main` → `main = origin = d52fefde div 0/0`；分支 `merge --no-edit main` 零冲突 → `22c62cfc`
交付：`outdoor-walkthrough-board.tsx` 可选 `cloudPass` / `onCloud`——不传 `onCloud` 就还是三键（默认界面一字不变），传了每行多一个“云端”键（`aria-label="用例 N 云端是否已跑"`，点击切换）；`outdoor-walkthrough-section.tsx` 透传（用条件展开避开 `exactOptionalPropertyTypes`）；工作流卡把 `flow.cloudPass()` / `flow.declareCloud()` 接上。新增 3 条用例：没传就三键、已声明才是按下态、点一下声明再点撤回
验证（固定数据）：面板 8 + 走查区 5 + hook 69 = 82/82；`tsc --noEmit` 0 行
真实浏览器/云端：仍未验（9222 第三十六轮 down）——**键有了，声明仍是空的**
未完成：#2 真实搜索、#5 浏览器行为；云端声明落盘
```

- **新键必须“不传就不渲染”**：默认三键的旧断言一条都没改，说明这个扩展真的向后兼容。
- **安全键与事实键并排但不等价**：“云端”键只记“跑过”，能不能发布仍由三类全绿算；提示语直接写“只有它不会让全绿变成 1”。

### 2026-11-18 13:00 · 自动轮次 79 · 云端声明接到 hook（人点才算，仍不自己凑绿）

```text
日期时间（中国标准时间）及运行 ID：2026-11-18 13:00，自动轮次 79
批次 / 切片 / 状态：合并 + M7 / 云端声明入 hook / 已交付（分支待 PR）
开工事实：HEAD = `3c03017d`（`agent/outdoor-clear-zone`），脏文件 17；local main = `139f42c4`，origin/main = `a3bff73b`（落后 4 笔）；`.temp` 目录已不存在（前一轮清理掉了）
合并：main 未被 checkout → `git branch -f main origin/main` → `main = origin = a3bff73b div 0/0`；分支 `merge --no-edit main` 零冲突 → `8de9c906`
交付：hook 新增 `cloudPass` ref 与 `declareCloud(id, pass)`（编号不在 1..11 返回 `null`、不生效；返回升序数组）/`cloudPass()`；`logReleaseStatus()` 改用 `defaultLedger(record, cloudPass.current)`。hook 套件新增 1 条：开场空、声明 #2 → `[2]`、99 不生效、撤回→ `[]`
验证（固定数据）：hook 套件 69/69；`tsc --noEmit` 0 行
真实浏览器/云端：仍未验（9222 第三十五轮 down）——**声明入口有，声明仍然为空，因为没人真跑过云端**
未完成：#2 真实搜索、#5 浏览器行为；云端声明接到面板键
```

- **“有入口”不等于“有证据”**：本轮只把声明通道打通，默认值仍为空；进度里必须写清“声明仍为空”而不是“云端已支持”。
- **`.temp` 也会被清**：写锁前先 `New-Item -ItemType Directory -Force .temp`，否则锁文件根本没落盘，并发保护形同虚设。

### 2026-11-18 12:00 · 自动轮次 78 · 云端那一列可以声明了（但不许自己变绿）

```text
日期时间（中国标准时间）及运行 ID：2026-11-18 12:00，自动轮次 78
批次 / 切片 / 状态：M7 / 云端列可声明 / 已交付（分支待 PR）
开工事实：HEAD = `60d6871d`（`agent/outdoor-objects-packed`），脏文件 35；**local main = origin = `139f42c4`（`div 0/0`）——本轮无需合并**
交付：`ledgerFromEvidence(fixedDataIds, evidence?, cloudPassIds?)` / `defaultLedger(evidence?, cloudPassIds?)`：云端只接“显式给的号”，不在 1..11 的丢掉；未声明整列 `none`。新增 `outdoor-release-cloud-ledger.test.ts` 5 条，钉住三种情形：只声明云端 → `allGreen` 仍 0；云端 + 浏览器 pass + 固定数据 → 计 1 条（卡末行也写 1）；夹带 0/12 → 不凭空长行
验证（固定数据）：云端台账 5/5 + 状态卡 38/38 = 43/43；`tsc --noEmit` 0 行
过程中两次红：① 写盘时首行引号坏了（`from "vitest';`），vitest 直接报 `[PARSE_ERROR] Unterminated string`；② 断言默认常量里 #2 是 `partial`，实际是 `none`（`BROWSER_EVIDENCE` 里 #2、#5 都是无证据）——改断言不改常量
真实浏览器/云端：仍未验（9222 第三十四轮 down）
未完成：#2 真实搜索、#5 浏览器行为；云端声明入口接到 hook/面板
```

- **“可声明”与“可推出”要分开**：云端那一列只能人来声明；只声明云端、浏览器没 pass 时全绿仍为 0，这样卡就不可能被参数“凑绿”。
- **默认常量不是凭印象**：`BROWSER_EVIDENCE` 里 #2/#5 是 `none`（无任何证据），#2 的固定数据来自 `outdoor-venue-candidates`，两者不是一回事。

### 2026-11-18 11:00 · 自动轮次 77 · 走查区抽件（能单测的开关 + 面板）

```text
日期时间（中国标准时间）及运行 ID：2026-11-18 11:00，自动轮次 77
批次 / 切片 / 状态：合并 + M7 / 走查区抽件 / 已交付（分支待 PR）
开工事实：HEAD = `60d6871d`（`agent/outdoor-objects-packed`，别人的分支），脏文件 23；local main = `7731f59b`，origin/main = `139f42c4`（落后 2 笔）
合并：main 未被 checkout → `git branch -f main origin/main`（已 fetch 过）→ `main = origin = 139f42c4 div 0/0`；分支 `merge --no-edit main` 零冲突 → `c134fec2`
交付：新 `outdoor-walkthrough-section.tsx`（开关 + 面板 + 显示用副本，`onMark` 返回非空才 `setBook`）+ 5 条用例；`outdoor-workflow-card.tsx` 从 18 行内联块减为 4 行挂载
验证（固定数据）：区/面板/hook 三文件 77/77（首跑 67 挂，原因是把 import 改成了 `OutdoorWalkthroughSection` 而定义没引进来，`ReferenceError`；补上 import 后全绿），`tsc --noEmit` 0 行
真实浏览器/云端：仍未验（9222 第三十三轮 down）
未完成：#2 真实搜索、#5 浏览器行为；台账与记录本联动
```

- **800 行的卡里那块状态机必须抽出来**：抽成 40 行的区之后，“展开→点→按压态”才可能在 5 秒内单测完。
- **删旧引而没加新引的报错长这样**：`ReferenceError: X is not defined` 在组件里，但根因在文件头的 import 行——先看 import 再看 JSX。

### 2026-11-18 10:00 · 自动轮次 76 · 合并（含一次真冲突）+ 面板接进工作流卡

```text
日期时间（中国标准时间）及运行 ID：2026-11-18 10:00，自动轮次 76
批次 / 切片 / 状态：合并 + M7 / 面板接线 / 已交付（分支待 PR）
开工事实：HEAD = `ad675228`（`agent/outdoor-designer-draft`，别人的分支），脏文件 14；local main = `d1d01673`，origin/main = `7731f59b`（落后 5 笔）
合并一：`git fetch origin main:main` 撞上 `schannel: SSL/TLS handshake failed`（网络），改用 `git branch -f main origin/main`（首次 fetch 已把 origin/main 拉下来）→ `main = origin = 7731f59b div 0/0`
合并二：分支 `agent/outdoor-m7-walkthrough-wire`（自 `agent/outdoor-m7-walkthrough-panel`）`merge main` → **1 处真冲突** `use-outdoor-agent-workflow.react.test.tsx`（两边都在文件尾追加用例，我的走查用例 vs 别人的默认方案两用例）。按行拼接：保留对方两个 `it` 并各自补 `});`，再附我的用例；`markers=0` 后提交 → `21503eec`
交付：hook 增 `walkthroughBook()` getter；`outdoor-workflow-card.tsx` 底部加可收起区（`aria-expanded`）——“走查记录（验收时逐条标记）”，展开才渲染面板；受控：`onMark` 拿到新记录本才 `setWalkthrough`
验证（固定数据）：hook + 面板 70/70（61 + 9 中的两文件合并计数），`tsc --noEmit` 0 行
真实浏览器/云端：仍未验（9222 第三十二轮 down）
未完成：#2 真实搜索、#5 浏览器行为；卡片层“展开→点→按压态”用例
```

- **冲突多发生在文件尾**：两边都往测试文件末追加用例，git 会把两段当成同一位置，**必须两边都留**，不能选一边。
- **fetched 过的 ref 不必再联网**：`git fetch origin main:main` 报 SSL 时，本地 `origin/main` 已可用 `git branch -f` 追上，不必重试网络。

### 2026-11-18 09:00 · 自动轮次 75 · 走查面板（11 行 × 三键，受控且不下结论）

```text
日期时间（中国标准时间）及运行 ID：2026-11-18 09:00，自动轮次 75
批次 / 切片 / 状态：M7 / 走查面板 / 已交付（分支待 PR）
开工事实：HEAD = `a1fd523d`（**detached**），脏文件 10；local main = `c0869f62`，origin/main = `d1d01673`（落后 2 笔）
合并：main 未被 checkout → `git fetch origin main:main`（c0869f62..d1d01673）只更新 ref；收工 `main = origin = d1d01673 div 0/0`
分支：`agent/outdoor-m7-walkthrough-panel` 自 `agent/outdoor-m7-walkthrough-persist`（aa1d7d0e）开，`merge --no-edit main` 零冲突 → `eb47492e`；五个切片一条分支
交付：`outdoor-walkthrough-board.tsx` + 5 条用例——11 行取自 `ACCEPTANCE_RULES` 的标题，每行三个按钮（看过/不构成通过/未看），`aria-pressed` 反映真实状态；**受控**：点只调 `onMark(id,state)`，外层不回传就还是原状态；进度行照搬 `summarizeWalkthrough().line`，整块不出现“可发布（”
验证（固定数据）：面板用例 5/5；`tsc --noEmit` 0 行
真实浏览器/云端：仍未验（9222 第三十一轮 down）
未完成：#2 真实搜索、#5 浏览器行为；面板接进 `outdoor-workflow-card.tsx`
```

- **UI 也先做受控件**：面板不持有记录本，才能在没有完整工作流的情况下单测（11 行 × 3 键全靠 props）。
- **“不下结论”要能被测试验到**：断言里直接写 `not.toContain("可发布（")`，比人工看图可靠。

### 2026-11-18 08:00 · 自动轮次 74 · 本地 main 一次性追上（工作区不再是 main）+ 记录本落盘

```text
日期时间（中国标准时间）及运行 ID：2026-11-18 08:00，自动轮次 74
批次 / 切片 / 状态：合并 + M7 / 记录本落盘 / 已交付（分支待 PR）
开工事实：HEAD = `a1fd523d`，**分支是 `agent/outdoor-scope-frost-walk-batch`（别人在改，不是 main）**，脏文件 6；local main = `c9706da5`，origin/main = `d3fb50e5`（落后 45 笔）
合并：`git merge-base --is-ancestor main origin/main` 为真 → 用 `git fetch origin main:main` **只更新 main ref**（c9706da5..d3fb50e5），不动工作区、不动别人分支；收工 `main = origin = d3fb50e5 div 0/0`
分支：`agent/outdoor-m7-walkthrough-persist` 从 `agent/outdoor-m7-walkthrough-hook`（800369c5）开，`merge --no-edit main` 零冲突 → `5c262efc`；四个切片合成一条待 PR 分支
交付：`outdoor-walkthrough-store.ts` + 8 条用例（`encodeBook`/`decodeBook`/`saveBook`/`loadBook`，键 `scendance.outdoor.walkthrough.v1`）：只认 1..11 与三档状态、版本不对/JSON 坏/存了数组一律当空、写入抛错返回 false、无 window 返回空。hook：初始 `useRef(loadBook())`，`recordWalkthrough()` 成功后 `saveBook()`（失败不影响继续标）
验证（固定数据）：落盘用例 8/8，hook 套件 61/61（新增断言：标完后 `localStorage` 里确实有 `#3`），`tsc --noEmit` **0 行**（基线那条 `gm-compass-host` 已随主干修好）
真实浏览器/云端：仍未验（9222 第三十轮 down）
未完成：#2 真实搜索、#5 浏览器行为；面板按钮；本地 main 已无差异
```

- **main 没被 check out 时，同步只需动 ref**：`git fetch origin main:main` 一次到位，既不用 stash 几十个脏文件，也不会把别人正在用的分支挤掉。
- **落盘的失败不能变成流程的失败**：`saveBook` 返回 false 只是“刷新会丢”，不是“标不上”，所以调用点不判断返回值。

### 2026-11-18 07:05 · 自动轮次 73 · 记录本接进 hook + 三个切片合成一条待 PR 分支

```text
日期时间（中国标准时间）及运行 ID：2026-11-18 07:05，自动轮次 73
批次 / 切片 / 状态：M7 / hook 接线与分支合并 / 已交付（分支待 PR）
开工事实：HEAD = main = `c9706da5`，origin/main = `dbc874c2`（落后 14 笔），脏文件 62（连续四轮不变）
合并（本地 main）：**第四次被同一批 WIP 挡住** —— 75 个入站文件里 59 个与脏文件重叠，`--ff-only` 报覆盖；不代人为用户 WIP 做取舍
合并（分支）：新开 `agent/outdoor-m7-walkthrough-hook`（自 `origin/main dbc874c2`），依次 `merge --no-edit` 了 `agent/outdoor-m7-browser-evidence` 与 `agent/outdoor-m7-walkthrough-book`，**两次 merge 零冲突**，树干净（`head=7fdb4ffa`）——三个切片现在只差一次 PR
交付：hook 新增 `walkthroughBook` ref 与 `recordWalkthrough(id, state)`（非法编号返回 `null`、不生效）/`walkthroughLine()`；`logReleaseStatus()` 改为带 `evidence: bookToRecord(...)` 与 `ledger: defaultLedger(record)`。hook 测试新增 1 条（标一条才算看过、非法编号不生效、行里不出现“可发布（”）
验证（固定数据）：hook 套件 61/61（含新 1 条）；`tsc` 余 1 行，仍是已归基线的 `gm-compass-host.test.tsx` 缺 `focusVenue`（行号 48→64 随主干变化，同一错误）
真实浏览器/云端：仍未验（9222 第二十九轮 down）
未完成：#2 真实搜索、#5 浏览器行为；记录本落盘；本地 main 追上 origin
```

- **碎片分支要及时合拢**：三个切片各自可 PR，但叠了三个分支就要合三次；merge（非 cherry-pick）成一条待 PR 分支，人只需点一次。
- **接线也要有断言**：只“能编译”不算接线完成，至少断言“标一条 → 进度行变化、非法编号不变”。

### 2026-11-18 06:10 · 自动轮次 72 · 走查记录本（只能往上标，不能下结论）

```text
日期时间（中国标准时间）及运行 ID：2026-11-18 06:10，自动轮次 72
批次 / 切片 / 状态：M7 / 走查记录本 / 已交付（分支待 PR，叠在 71 上）
开工事实：HEAD = main = `c9706da5`，origin/main = `eade0159`（落后 13 笔），脏文件 62（连续三轮不变）
合并：**第三次被同一批 WIP 挡住** —— 75 个入站文件里 59 个与脏文件重叠，`--ff-only` 报会覆盖本地改动。脏文件数量三轮不变（62/62/62）说明这批改动一直没提交；不代人为它做取舍，不 stash 后强行合。
交付：`frontend/components/room-organizer/lib/outdoor-walkthrough-book.ts` + 8 条用例——`emptyBook()` / `markSeen()`（不可变，非法编号 0/12/1.5/NaN 原样退回同一引用）/ `lookedCount()`（显式 `none` 仍算没看）/ `summarizeWalkthrough()`（一行话，11 条全 pass 也只说“看完了”）/ `bookToRecord()`（空白日期不写，交卡片回落常量）。分支基于 `agent/outdoor-m7-browser-evidence 16fde421`
验证（固定数据）：新用例 8/8。`tsc` 余 1 行，仍是已归基线的 `gm-compass-host.test.tsx`（轮次 71 已在 `origin/main` 干净树上复现同一错）
真实浏览器/云端：仍未验（9222 第二十八轮 down）
未完成：#2 真实搜索、#5 浏览器行为；记录本接 hook；本地 main 追上 origin
```

- **记录本与结论要分层**：“看过 11/11”是事实，“可发布”是判断；前者可以自动化，后者不行，所以记录本的输出里写死一句“仍需三类全绿（含真实云端）”。
- **非法输入不抛错、返回同一引用**：调用方用 `===` 就能判断“这一标没生效”，比 try/catch 更适合 React 事件处理。

### 2026-11-18 05:20 · 自动轮次 71 · 浏览器证据从常量改成可注入

```text
日期时间（中国标准时间）及运行 ID：2026-11-18 05:20，自动轮次 71
批次 / 切片 / 状态：M7 / 浏览器证据可注入 / 已交付（分支待 PR）
开工事实：HEAD = main = `c9706da5`，origin/main = `dabfbc34`（落后 11 笔），脏文件 62
合并：**仍未合** —— 68 个入站文件里 59 个与脏文件重叠，`--ff-only` 报 `Your local changes ... would be overwritten`；不 stash 这 59 个文件，分支从 `origin/main` 开
交付：`outdoor-release-status-card.ts` 新增 `BrowserEvidence` 三态、`WalkthroughRecord`、`browserEvidenceFrom()`、`evidenceAsOf()`；`ReleaseStatusInput.evidence?` 接入卡片与快照（`browser` 多一档 `pass`，仍升序）；`ledgerFromEvidence(ids, evidence?)` / `defaultLedger(evidence?)` 跟着走。新增 `outdoor-browser-evidence.test.ts` 6 条。对照表 §0 锚点 JSON 同步改（`browser.pass: []`）
验证（固定数据）：两份定向用例 44/44（状态卡 38 + 新 6）。`tsc` 余 1 行：`gm-compass-host.test.tsx` 缺 `focusVenue`——**已归为基线**：在 `origin/main dabfbc34` 的干净 worktree 上单跑 tsc 也是同一行、同一错误，不是本轮引入
真实浏览器/云端：仍未验（9222 第二十七轮 down）
未完成：#2 真实搜索、#5 浏览器行为；hook 接线 `recordWalkthrough()`；本地 main 追上 origin
```

- **“归为基线”要有干净树证据**：同一错误在 `origin/main` 的隔离 worktree 上单跑一遍能复现，才叫基线；否则就是自己引入的。
- **可注入不是把常量删掉**：不传记录时行为与以前一字不差，旧调用点与旧断言才不用改。

### 2026-11-18 02:30 · 自动轮次 68 · 合三笔（含一个脏文件重叠）+ 对照表立快照锚点

```text
日期时间（中国标准时间）及运行 ID：2026-11-18 02:30，自动轮次 68
批次 / 切片 / 状态：M7 / 对照表锚点 / 已交付（分支待 PR）
开工事实：main = d2ffb4e8，origin/main = 10a54bec（落后 3 笔：标注工具条五工具、图例墙体分组、台账锁 vitest 4.1.12）；脏文件 47 → 50
重叠：15 个入站文件里 `outdoor-plan-canvas.tsx` 与脏文件重叠 → 备份字节 → `git stash push -- <1 文件>`（50→49）→ `git merge --ff-only origin/main` → `git stash pop`（零冲突；pop 后 diff 78 行、无冲突标记）
分支追上：consolidated `git merge main` → `83937a92`，零冲突
交付（docs）：证据对照表顶部新增「§0 当前状态快照（锚点，轮次 68）」，贴 `statusCardSnapshot()` 默认台账输出的原样 JSON，并写明复跑命令与读法（`allGreen: 0` 是算出来的；`gate: {}` 不代表没跑）
验证：status-card 38/38（锚点 JSON 就是被断言的那份）；wt-r68 合并后 tsc 0 行
真实浏览器/云端：仍未验（9222 第二十四轮 down）
未完成：#2 真实搜索、#5 浏览器、快照实际打印对照、`pickVenueCandidate` 接线
```

- **锚点要贴在证据表顶部，不是埋在轮次记录里**：以后每轮 diff 它，比翻历史快。

### 2026-11-18 01:50 · 自动轮次 67 · 状态卡可对比快照

```text
日期时间（中国标准时间）及运行 ID：2026-11-18 01:50，自动轮次 67
批次 / 切片 / 状态：M7 / 状态快照 / 已交付（分支待 PR）
开工事实：HEAD = main = origin = d2ffb4e8（div 0/0）→ 无合并；9222 第二十三轮 down
问题：卡是给人看的一行行文本，两轮之间“到底变了什么”只能肉眼对
交付：`statusCardSnapshot(input)` —— 同样输入得到同样对象（数组升序、键序固定）
  · `cloud` 没台账时为 `null`，不写一串 0 冒充“都没过”
  · `gate` 没跑时是空对象 `{}`，不是三个 `false`
验证：status-card 34 → 38 条全过（含“同输入两次序列化逐字相同”）；另三个文件 24 条全过；wt-r67 的 tsc 0 行
真实浏览器/云端：仍未验
未完成：#2 真实搜索、#5 浏览器、快照入对照表、`pickVenueCandidate` 接线
```

- **把“没数据”写成 `null` 而不是 0**：0 是一个事实（真的没过），null 是“没测”——混了就会把未验当成结论。

### 2026-11-18 01:10 · 自动轮次 66 · 合成文档一笔 + 卡补“云端证据”行

```text
日期时间（中国标准时间）及运行 ID：2026-11-18 01:10，自动轮次 66
批次 / 切片 / 状态：M7 / 卡补云端证据行 / 已交付（分支待 PR）
开工事实：main = 9e3bb54d，origin/main = d2ffb4e8（落后 1 笔：台账复跑版本与锚点刷新规则）；重叠：2 个文件（均 docs）与 47 处脏文件零交集 → ff 成功；分支 merge main → 2bea56b2
问题：三类证据里“真实云端”一类在卡里**一个字都没有**，只写浏览器——等于默认那一类不存在
交付：新增 `cloudLine()`，卡里在浏览器证据行后插一行
  · 有台账：`· 云端证据：N 条通过 / M 条未验`（默认台账下为 0 / 11）
  · 没台账：`· 云端证据：未验（本次没带台账）`，不默默省行
验证：status-card 31 → 34 条全过；另三个文件 24 条全过；wt-r66 的 tsc 0 行
顺带修正：原有“五行固定结构”用例已名不副实（本来就 6 行），改为按行断言 7 行结构
真实浏览器/云端：仍未验（9222 第二十二轮 down）
拌了一下：wt-r66 又遇到 vitest 自建真 `node_modules`（只含 `.vite`），`mklink /J` 报已存在；改为逐文件删 → 逐目录 rmdir → 再 junction
未完成：#2 真实搜索、#5 浏览器、`pickVenueCandidate` 接线
```

- **三类里少写一类，等于默认它不存在**：卡不写云端，读卡的人就会以为只差浏览器。

### 2026-11-18 00:30 · 自动轮次 65 · 合四笔 + hook 默认带台账

```text
日期时间（中国标准时间）及运行 ID：2026-11-18 00:30，自动轮次 65
批次 / 切片 / 状态：M7 / hook 默认台账 / 已交付（分支待 PR）
开工事实：main = 0a59f7b0，origin/main = 9e3bb54d（落后 4 笔：walls 并入迁移总入口、GeoJSON/CSV 墙体导出、全量 vitest 基线台账）。重叠检查：9 个文件与 47 处脏文件零交集 → 直接 ff
合并：主工作树 `--ff-only` 成功；consolidated 分支 `git merge main` → `46ea97e8`，零冲突
交付：`FIXED_DATA_CASES = [2, 5]`（只写能点到测试文件的两条：#2 同名选择、#5 离线声明）+ `defaultLedger()`；hook 的 `logReleaseStatus()` 默认 `ledger: defaultLedger()`
验证：status-card 29 → 31 条全过；hook 套件 58/58；wt-r65 的 tsc 0 行
真实浏览器/云端：仍未验（9222 第二十一轮 down）
拌了一下：wt-r65 里没建 node_modules junction，测试报 `Cannot find package '@supabase/ssr'`；而 vitest 自己先在 worktree 建了个真目录（只含 `.vite` 缓存），导致 `mklink /J` 报“已存在”。按守卫要求逐文件删掉缓存目录后才建上 junction
未完成：#2 真实搜索、#5 浏览器、`pickVenueCandidate` 接线
```

- **worktree 里先删 vitest 自建的 `node_modules` 再 junction**：否则报“已存在”，而里面的包一个也没有。

### 2026-11-17 23:55 · 自动轮次 64 · 合 M2/M3 九笔 + 分支追上重跑门禁

```text
日期时间（中国标准时间）及运行 ID：2026-11-17 23:55，自动轮次 64
批次 / 切片 / 状态：收尾（合并 + 门禁复跑）/ 已交付
开工事实：main = 13258414，origin/main = 0a59f7b0（落后 9 笔：M2 walls 契约/注入/校验 + M3 plan 历史/导出地基）
合并（主工作树）：先算重叠——进来 16 个文件与 47 处脏文件**交集为空** → 直接 `git merge --ff-only origin/main` 成功，脏文件未动（仍 47）
分支追上：consolidated 分支 `git merge --no-edit main` → `dfdfd4fd`，零冲突
门禁（提交树 dfdfd4fd，隔离 worktree）：tsc 0 行 / `npm test -- outdoor` 56 文件 661 条全过（比上轮多 16 条，来自新 main 的 lib 用例）/ `npm run build` exit 0（62s）
真实浏览器/云端：仍未验（9222 第二十轮 down）
未完成：#2 真实搜索、#5 浏览器、hook 默认带台账、`pickVenueCandidate` 接线
```

- **先算交集再决定合并方式**：交集空就直接 ff，省掉备份→stash→pop 一整套。

### 2026-11-17 23:15 · 自动轮次 63 · 台账从证据快照生成（调用方只说一件事）

```text
日期时间（中国标准时间）及运行 ID：2026-11-17 23:15，自动轮次 63
批次 / 切片 / 状态：M7 / 台账自动生成 / 已交付（分支待 PR）
开工事实：HEAD = main = origin = 13258414（div 0/0）→ 无合并；9222 第十九轮 down
交付：`CASE_IDS`（1..11）+ `ledgerFromEvidence(fixedDataIds)`
  · 11 行整行铺开，缺行就等于在隐瞒缺口（不按“已知几条”缩短）
  · 浏览器列只认 `BROWSER_EVIDENCE` 快照（#2/#5 仍为 none）；云端列一条实证也没有 → 整列 none
  · 调用方只需说“哪几条有固定数据”，其余不再由人填
验证：status-card 25 → 29 条全过（含“11 条全给固定数据也算不出全绿”“卡里用生成台账时手填 5 也拦不住 0 条”）；另三个文件 24 条全过；wt-r63 的 tsc 0 行
真实浏览器/云端：仍未验
未完成：#2 真实搜索、#5 浏览器、`pickVenueCandidate` 接线、hook 默认带台账
```

- **能推出的事实就不要让人再报一遍**：调用方只报“有固定数据的用例号”，其余从快照推。

### 2026-11-17 22:40 · 自动轮次 62 · “三类全绿”改成算出来的（台账入参）

```text
日期时间（中国标准时间）及运行 ID：2026-11-17 22:40，自动轮次 62
批次 / 切片 / 状态：M7 / 全绿计数 / 已交付（分支待 PR）
开工事实：HEAD = main = origin = 13258414（div 0/0）→ 无合并；9222 第十八轮 down
问题：末行“三类全绿 N 条”一直是人填的 `allGreen`，和对照表完全可各写一数
交付：`CaseLedgerRow` + `summarizeLedger()`（固定数据有 + 浏览器 pass + 云端 pass 才算一条；partial 一律不算）
  · 卡新增 `ledger?: readonly CaseLedgerRow[]`；给了 ledger 就以它算，手填 `allGreen` 失效
  · 返回值同时给 `fixedOnly`（已有固定数据但没上过浏览器/云端）与 `total`
验证：status-card 20 → 25 条全过（含“11 条全 partial → 0 条全绿”“台账在手时忽略手填 9”）；另三个文件 24 条全过；wt-r62 的 tsc 0 行
真实浏览器/云端：仍未验
未完成：#2 真实搜索、#5 浏览器、台账自动生成、`pickVenueCandidate` 接线
```

- **数字要么算，要么写来源**：人填的“N 条”与表里的行数没有任何强制关系，早晚漂。

### 2026-11-17 22:00 · 自动轮次 61 · 空会话下的状态卡（空括号/光秃标签）

```text
日期时间（中国标准时间）及运行 ID：2026-11-17 22:00，自动轮次 61
批次 / 切片 / 状态：M7 / 状态卡空态 / 已交付（分支待 PR）
开工事实：HEAD = main = origin = 13258414（div 0/0）→ 无合并；9222 第十七轮 down
发现的问题（都是“没人填就直接拼字符串”留下的）：
  · 用例 0 条时仍写“可判 0 / 缺料 0 / 只能浏览器 0”，看不出下一步
  · 证据清单为空时留下一个空括号（）
  · 指标 text 为空时留下光秃的“· 指标：”
修法：新增 `listWithIds()`（空则只写“0 条”）；用例 0 条换成“还没有可判的用例（先跑一次会话再用）”；指标空则写“本次会话没有指标记录”
验证：status-card 16 → 20 条全过；另外三个自建文件 24 条全过；wt-r61 的 tsc 0 行
真实浏览器/云端：仍未验
未完成：#2 真实搜索、#5 浏览器、`pickVenueCandidate` 接线、三类全绿改计算
```

- **空态也是一种输出**：没人填的时候，卡片说的是“我还缺什么”，而不是一串 0 和一个空括号。

### 2026-11-17 21:25 · 自动轮次 60 · 状态卡直接吃门禁读数（少一道手抄）

```text
日期时间（中国标准时间）及运行 ID：2026-11-17 21:25，自动轮次 60
批次 / 切片 / 状态：M7 / 状态卡×读数合流 / 已交付（分支待 PR）
开工事实：HEAD = main = origin = 13258414（div 0/0）→ 无合并；9222 第十六轮 down
交付：`ReleaseStatusInput.reading?: GateReading`
  · 给了 reading 就用 `gateFactsForCard` 算门禁三项（不再靠手填布尔）
  · 并在门禁行下多一行 `· 读数：<readGates 的 line>`，把人话结论一起留下
  · 同时给 gate 与 reading 时以 reading 为准；不给 reading 时输出与以前一字不差
验证：status-card 13 → 16 条全过；gate-reading + venue + case5 共 24 条全过；wt-r60 的 tsc 0 行
真实浏览器/云端：仍未验
未完成：#2 真实搜索、#5 浏览器、hook 带读数、指标/零用例两条用例
```

- **两处真相不能各写一坑**：门禁行与读数行出自同一个 `readGates`，就不会出现卡说“通过”、读数说“未验”。

### 2026-11-17 20:50 · 自动轮次 59 · 合新 main（死代码清理）+ 分支追上去重跑门禁

```text
日期时间（中国标准时间）及运行 ID：2026-11-17 20:50，自动轮次 59
批次 / 切片 / 状态：收尾（合并 + 分支追上）/ 已交付并已推分支
开工事实：main = 3e376b41，origin/main = 13258414（落后 3 笔：死代码审计 + 删零引用 shadcn 原语 + 删未挂载组件）
合并（主工作树）：3 笔改动里有 3 个文件与我的 47 处脏文件重叠（space-browser.css / space-panel.tsx / room-organizer.tsx）
  → 先把这 3 个文件字节备份到 `.temp/r59-user-backup/` → `git stash push -- <3 文件>`（脏文件 47→44）→ `git merge --ff-only origin/main`（HEAD 13258414）→ `git stash pop`（无冲突，脏文件回到 47）
  → 验证用户 WIP 未丢：三文件 diff 仍是用户的改动（例：`sourceForLocation(readPlanGroundSource(), anchor.lng, anchor.lat)`），无冲突标记
分支追上：consolidated 分支 `git merge --no-edit main` → `48a3bffe`，零冲突
门禁（提交树 48a3bffe，隔离 worktree）：tsc 0 行 / `npm test -- outdoor` 56 文件 645 条全过 / `npm run build` exit 0（98s）
真实浏览器/云端：仍未验（9222 第十五轮 down）
未完成：#2 真实搜索、#5 浏览器、指定候选接线、面板按钮
```

- **脏文件与入站改动有重叠时，顺序不能省**：备份 → stash → ff → pop；pop 后不只看“有没有冲突”，还要抽一段 diff 确认用户写的东西还在。

### 2026-11-17 20:05 · 自动轮次 58 · 门禁读数自吞吐（真跑三项，顺手修掉带色输出读不到汇总行）

```text
日期时间（中国标准时间）及运行 ID：2026-11-17 20:05，自动轮次 58
批次 / 切片 / 状态：M7 / 门禁自吞吐 + 缺陷修复 / 已交付（分支待 PR）
开工事实：HEAD = main = origin = 3e376b41（div 0/0）；consolidated = fe94ab88；9222 第十四轮 down
做法：在 consolidated 分支的隔离 worktree 上跑三项门禁，把**原始输出真的喂给 readGates**，而不是手抄数字
三项结果（提交树 fe94ab88）：tsc 0 行 / `npm test -- outdoor` 56 文件 645 条全过 / `npm run build` exit 0（65s）；修完 ANSI 后再跑一遍：tsc 0 / build exit 0（44s）
自吞吐产出（原文）：`门禁：类型 过 / 用例 过 / 构建 过（三项门禁都绿，不等于可发布）`
发现的真缺陷：vitest 带 ANSI 颜色时 `Tests` 与数字之间夹转义码，原正则永远读不到汇总行 → 报“未验”。已加 stripAnsi 修复，并补 2 条带色用例（全绿与带失败两种）
另发现：用 `Tee-Object` 抓带色输出会把字符写坏（'e' 变 ESC），改成 `cmd /c "... > file 2>&1"` 直接重定向才保真
验证：gate-reading 10 → 12 条全过；三项门禁数字见上
未完成：#2 真实搜索、#5 浏览器、指定候选接线、面板按钮
```

- **门禁读数要先拿真输出喂自己**：一喂就暴露“带色输出读不到汇总行”，手抄数字永远不会发现。
- **抓带色输出别用 Tee-Object**：它会把字节写坏；用 `cmd /c "... > file"` 保真。

### 2026-11-17 19:20 · 自动轮次 57 · 状态卡接进 hook（一键打控制台）

```text
日期时间（中国标准时间）及运行 ID：2026-11-17 19:20，自动轮次 57
批次 / 切片 / 状态：M7 / hook 接入 / 已交付（分支待 PR）
开工事实：HEAD = main = origin = 3e376b41（div 0/0）；consolidated = f875ac62；9222 第十三轮 down
改动（只动 1 个文件 3 行）：hook 新增 `logReleaseStatus: () => logReleaseStatus({ rows: assessAcceptance(buildSessionReport(...)), metrics })` + 一行 import
验证：hook 套件 58/58；wt-r57 的 tsc 0 行；lint 只有别人 `app/error.test.ts` 的 import/order 旧告警（未动）
没做：没给 hook 加新用例（该文件是用户常改的热文件，改为靠现有 58 条 + tsc 兑现）
两次自损：① oldText 用了弯引号导致匹配不上（整批 abort，文件未变）；② 去掉末尾换行做替换，把两行并成了一行，读回发现后补回换行
未完成：#2 真实搜索、#5 浏览器、指定候选接线、面板按钮
```

- **替换行的 oldText 必须贴原文**：全角/弯引号、行尾换行都算字节；去掉一个换行就会把两行粘成一行。

### 2026-11-17 18:45 · 自动轮次 56 · 四条切片合成一条分支（降低待 PR 碎片）

```text
日期时间（中国标准时间）及运行 ID：2026-11-17 18:45，自动轮次 56
批次 / 切片 / 状态：M7 / 分支合并整理 / 已交付（分支待 PR）
开工事实：HEAD = main = origin = 3e376b41（div 0/0）→ 无合并；前四条分支（status-card / case5-offline / gate-reading / venue-same-name）自主推送以来一直未被合
做法：新建 `agent/outdoor-m7-consolidated`，从四个分支只 `git checkout <分支> -- <我自己的文件>` 搬代码（不 cherry-pick 别人改动、不动 hook），保留一个可评审 PR
内容（全在 `frontend/components/room-organizer/lib/`）：
  · outdoor-release-status-card.ts/.test.ts（状态卡 + 日志入口）
  · outdoor-gate-reading.ts/.test.ts（三项原始输出 → 一行结论；新增 gateFactsForCard 适配卡里字段名 typecheck）
  · outdoor-venue-candidates.ts/.test.ts（同名地点不猜着选）
  · outdoor-case5-offline.test.ts（离线/无路网固定数据）
  · 两处接起来：readGates → gateFactsForCard → 状态卡“门禁”行由真实读数决定
验证：四个文件 35/35 全过；wt-r56 的 tsc 0 行；真实浏览器/云端仍无（9222 第十二轮 down）
两次自损（同一种错，第二次才认出来）：改锚点时又把函数头（`function cell(...)`）当替换点换掉，造成函数体悬空；两次都是读文件后补回声明。教训：**锚点不要选函数声明行**。
未完成：#2 真实搜索、#5 浏览器、hook 接入、面板按钮；四条旧分支可关闭（内容已在本分支）
```

- **碎片分支不等于交付**：四个 PR 等人逐个合，不如一条自包含分支；但要只搬自己的文件，别把别人的改动带进来。

### 2026-11-17 15:00–16:10 · 正式站登录态走查第二轮（V2/V4/V5 复验；死结 3 与死结 4 已修并上线）

```text
日期时间（中国标准时间）及运行 ID：2026-11-17 15:00–16:10，正式站走查第二轮
批次 / 切片 / 状态：M7 主链走查（正式站，登录态）/ V1–V5 全链跑通，已交付
开工 HEAD：599b0310（轮次 46 文档收口）→ 收工 HEAD：be4fd029（v4.16.1，已推 main）
场景：杭州湖滨银泰in77 · 80 人发布会 · 户外广场 30×20 米 · 舞台/观众/签到台/主通路
正式站：https://scendance-scene-planner-ewz.pages.dev/?fresh=202611170800（登录态有效；旧拼写域名 scendance-scence-planner-ewz.pages.dev 在本机 curl 探测 TLS 握手失败）
部署：从 be4fd029 构建 → Pages 部署 9e2262b0（Production/main）
取证方式：内置浏览器逐步操作 + 分享面板「导出场地几何 GeoJSON」落盘后离线解析（ENU 平面坐标）
```

**整链结果：V1 → V2 → V3 → V4 → V5 在正式站登录态走通**

同一条正式站会话里依次跑完：V1 场地与范围（红线写进画布）→ V3 分区预览 → V2 主要入口与通道 → V4 物料复用 → V4 子动线 → V5 岗位点位。四个死结在这条链上逐个被撞出来、逐个修掉、逐个复验。

**V2 复验：主通道预览出提案，冲突降级成提示**

- 修之前的现象：点「预览主要入口与通道」整轮报「人行流线（湖滨路）与地图依据…建筑/障碍冲突」，连预览都拿不到，用户无从在画布上改。
- 真因（离线解码 OFM 瓦片 `14/13660/6746`）：冲突要素 `id=149544150` 是 **IN77 综合体自身的建筑多边形** —— 817 个环、覆盖整个地块、`render_height=5`、名字为空，第 20 环正好压在人行流线上。公开地图把综合体画成一整块多边形，站内步行街/广场/连廊全被包在里面，拿「场地自己的建筑」当障碍，主通道在任何综合体场馆都必然冲突。
- 修法（v4.15.6）：冲突判据从「离墙多近」换成「路线中心线是否真的走进建筑足迹内部」（`outdoorRouteInsideRingLength` 按 1m 采样量）；路网草案与建筑轮廓的打架**降级成提案级提示**，写清方位与穿楼长度（如「活动范围北西侧约 260m」）；**用户自己摆的物件压进建筑轮廓、挡住门前净空，仍然照旧硬拦**；范围外的建筑对流线不再硬拦，这是解死结的代价，物件越界占用仍然拦。
- 正式站复验：预览出提案 → 提示里列出打架的流线位置 → 确认写入画布 → **入口核对已应用**（延安路口确认可供本活动通行）。

**死结 3（v4.15.7）：需求分区对不上画布，整轮卡死**

- 现象：走查「按用途复用我的物料」这一步，界面反复报「“餐饮区”没有唯一对应分区，请选中并说明分区；未摆放物件」，用户怎么改清单都出不来提案。
- 真因不是用户写错：需求清单只能「按分区替换」、不能删区（协议里数量最小是 1），而「餐饮区」是上一轮留下的旧需求、**画布上根本没有这个分区** → 每一轮都撞同一堵墙，旧需求永远清不掉。
- 修法：把画布上的分区当权威。`splitNeedsByZone` 对一次账，唯一命中才算对得上；对不上的**跳过并如实报出** —— 新文案是「「餐饮区」不在画布上，这 1 条需求未摆放（没有在这些分区猜位置）；当前画布分区：舞台区、观众区、签到台；要保留请先在画布上补出该分区，再重新说明清单」；同时把对不上的需求**从需求清单里摘掉**，免得下一轮又报同一批。全部对不上时仍然拦，并把画布上真实分区名列出来。同名分区按「分不清是哪一个」同一口径处理。
- 顺带：岗位安排（V5）改用同一套判定，物件与岗位两个阶段不再各用一套口径。
- 先红后绿：临时把行为退回旧逻辑（对不上就整轮抛错），6 条新用例里 **4 条精确失败**；装回修复后该文件 21 条全绿，outdoor 全量 42 文件 482 条通过 480 条。
- 走查里物料名/分区名的错配也一并按真实库真名重写过一轮（舞台 1、扩声音箱 2、指示牌、折叠椅 80、垃圾桶 1），只用画布上已有的 3 个分区。

**死结 4（v4.16.1）：签到台没有 service 通道，服务人员永远排不出**

- 现象（正式站）：V5「预览岗位、人数与活动路径」报「“签到台”尚无同时满足入场与出场的后勤接驳，请先安排子流线/子入口」。
- **那条补救路径不成立**：重跑子动线（V-4a）仍然是同样的跳过 —— 报错让用户做的事，做了也没用。
- 真因（代码 + 正式站真实几何双证）：
  1. `outdoor-personnel-access.ts` 只收 `kind='pedestrian'` 且 audiences 显式含该人群的动线；OSM 主路网动线**没有 audiences** → 默认只含 visitors/staff/security，**service 不在内**；后勤流线 `kind='service'` 被整类排除 → service 图里一条动线都没有。
  2. `sub-entrance.ts` 的「离既有节点 15m 内不重复立口」规则把**整个分区**放弃：签到台唯一可用样本 (95.9, 245.9) 距「观众区口」(91.9, 245.8) 只有 **4m**，被 15m 去重整区跳过；其余样本出红线/压车行路/超 120m。
  3. 正式站图层清单佐证：分区 3 个（舞台区/观众区/签到台，签到台用途＝服务）、人行动线 6 条（**无签到台驳线**）、出入口 9 个（**无签到台口**）、后勤动线 2 条。签到台从来没拿到过 service 通道。
- 修法：
  - `sub-entrance.ts` 抽出 `buildZoneSpur`，新增**邻区口接驳规则**：样本被 15m 去重挡掉时不再放弃整个分区，改为接驳到那个既有口（节点复用、不重复立门，护栏照走）。
  - `outdoor-agent-planning.ts` 的 `proposeRoleWorkers` 改为局部 `working` 方案：某个分区没有这类岗位能走的通道时，先用同一套护栏补一条专用驳线再排岗；**只复用已确认的出入口**（`requireExistingPortal: true`），不自造新门 —— 否则单向流线那种只出不能入的区会因为多一个新节点而看起来也连通，既有守卫就被绕开了。补不出来才报错。
  - 新报错文案写清缺哪一类通道、能改做什么：「“{分区}”没有可用于{后勤/表演/安保}岗位的进出通道：现有动线里没有一条能让人既从入口进场、又从出口离场（可能是单向流线只出不能入、流线服务人群不含这类岗位、或这一区离人行流线太远），本区也没有已确认的子口可以接驳。请在画布上给“{分区}”补一条接驳线/子口（确认后即可排岗），或把这个岗位改到已有通道的分区；不会把岗位放到不连通的区域。」
  - 先红后绿：退回旧逻辑重跑，3 条新用例**精确失败**（旧代码整轮抛「尚无同时满足入场与出场的后勤接驳」、旧文案仍写着那条不成立的补救、邻区口旁边会多立一个重复的门）；装回修复后两个文件 29 条全绿。

**V4 子动线：已通**

舞台区驳线（3m，挂舞台区口）、观众区驳线（76.8m，观众区口 → 湖滨路）写入画布。

**V5 复验（部署后）：通过**

- 部署与核对：be4fd029 → Pages 9e2262b0（Production/main）。**每次刷新都要核对运行时 chunk 是否含本轮修复**：本地构建里修复标记落在 `3979-b0c04f395c00db4d.js`（含「分区接驳到相邻子口」「没有可用于」各 1 处），别名与新部署都 grep 到同一处标记才继续。
- 正式站重新加载后画布状态完整还原（已放置物件 106、3 分区、12 条动线、9 个出入口全在）→ **应用后刷新不丢**。
- 点「预览岗位、人数与活动路径」→ 出提案卡「按岗位、数量与通路安排人员」（不再报后勤接驳错）→ 「确认并应用这一版」→ 写入画布。
- **导出真实几何复核**（分享面板「导出场地几何 GeoJSON」，69 745 字节：boundary 1 / zone 3 / facility 83 / route 12 / node 9 / worker 3）：

| 项 | 结果 |
| --- | --- |
| worker | 保安｜观众区｜数量 2｜(20.8, 75.9)；服务人员｜签到台｜数量 2｜(95.9, 245.9)；舞台监督｜舞台区｜数量 1｜(-60.5, 313.5) |
| 新增 route | **签到台驳线**｜人行动线｜4 m｜(95.9, 245.9) → (91.9, 245.8)｜备注「AI 驳线提案：分区接驳到相邻子口（V-4a 死结 4 修正，不重复立口）」 |
| 出入口 | 仍是 9 个（**没有多立门**） |
| 人行动线 | 6 → 7 |
| 已放置物件 | 106 → 110（+1 条驳线 + 3 个岗位物件，人数写在岗位 count 上） |

- 三个岗位都落在能进能出的通道上：服务人员挂在新补的 4m 接驳线（离已确认的「观众区口」4m）；保安落在观众区内的湖滨路人行流线上；舞台监督落在舞台区南缘、已确认的湖滨路口旁 3m。岗位判定依据仍是「已确认节点 + 动线方向」这一层口径，**不是现场通行认证**。
- 结论：**V5 死结 4 关闭**，户外主链 V1–V5 在正式站整条跑通。

**用户偏好未采纳（如实记）**

「主通道改走场地北侧仁和路、观众从北门进场」**没有被采纳**：路网提案依旧按等级与长度选湖滨路，入口候选仍只有延安路口。本轮没有改选路与入口候选口径 —— 这条要等用户决定是改选路策略还是自己在画布上拉线。

**本轮交付**

- v4.15.6 / v4.15.7 / v4.16.1 三版已推 main（599b0310..be4fd029）；两个 `package.json` 与 CHANGELOG 同步，CHANGELOG 过 `scripts/check-changelog.mjs`。
- 门禁：定向 9 文件 117 条全绿；前端与仓库根 `tsc --noEmit` 均 0 行；outdoor 全量 43 文件 496 条通过 494 条；静态构建通过（产物 `frontend/.next-ci`）。

**基线上的既有问题（不是本轮引入）**

- `outdoor-plan-canvas.test.ts` 2 条失败（标签墨色、工人标签），在基线上同样失败。
- `lib/brand-tokens.test.ts` 失败；`scripts/release-gate.mjs` 引用了不存在的 `lib/style-plan.test.ts`。
- CHANGELOG v4.15.0–v4.15.4 共 25 处预存规范问题；**并行会话的 v4.16.0 条目本身有 3 处规范问题**（缺「边界与未做」、bullet 短于 45 字、整段 1179 字 < 1200）。
- 正式站旧拼写域名 `scendance-scence-planner-ewz.pages.dev` 在本机 curl 探测 TLS 握手失败（exit 35）；浏览器打开后落到 `scendance-scene-planner-ewz.pages.dev`，走查全程用后者。
- 并行会话持续推 main 并部署，**别名会在数分钟内多次切换 runtime**；每次刷新都要核对 chunk 标记，否则会拿别人的构建当验收对象。

**未验（不得当已验）**

- 账号物料库是空的（「还没有物料。」）：V4 物料复用用的是画布上已摆的物件与真实库真名，没有真实物料可复用；本轮**没有触发任何付费生成**。
- 画布仍是本机草稿（状态条：「项目已不存在或已被删除，当前画布仍是本机草稿」），云保存这一路没有验。
- 证据对照表 11 条用例里，#2 同名地点、#5 离线/无路网、#9 撤销回读仍未验；#8 只验到「应用后刷新不丢」，「应用中刷新」「双点确认」「切项目」未验。
- 用例 #10 仍缺服务端日志关联（模型通道 provider_error 的真实失败样本只有界面侧证据）。
- 入口候选口径、选路口径（仁和路/北门）本轮未改。

**方法学（留给下一轮）**

- **把正式站的真实几何导出来离线复现**：分享面板「导出场地几何 GeoJSON」→ 页面内 monkey-patch `URL.createObjectURL` 抓 blob → `fetch('http://127.0.0.1:8899/plan', {method:'POST', body:text})` 交给本机 Node 服务落盘 → 按 `site-plan-geojson.ts` 的 ENU 换算（anchorLat=30.25、anchorLng=120.163，`metersPerDegLng=cos(lat)*111319.49`、`111132.92`/度）还原平面坐标 → 逐样本重放。这套方法让「正式站报的错」和「本地跑出来的数」能逐字对上，是定位死结 3/4 的关键。
- **正式站报错里给的补救路径要先验一遍**：死结 4 的旧文案让用户「先安排子流线/子入口」，而重跑子动线根本补不出来 —— 报错文案本身可能就是错的，不能照着它给用户派活。


### 2026-11-17 00:20–01:20 · 正式站登录态走查 V1–V5（V1/V3 通过，V2 两个死结已修）

```text
日期时间（中国标准时间）及运行 ID：2026-11-17 00:20–01:20，正式站走查
批次 / 切片 / 状态：M7 主链走查（正式站，登录态）/ 已交付
开工 HEAD：c474966d（上一轮推 main 的 OFM 证据线）；远端同
场景：杭州湖滨银泰in77 · 80 人发布会 · 户外广场 30×20 米 · 舞台/观众/签到台/主通路
正式站：https://scendance-scence-planner-ewz.pages.dev（部署 efba7d11，已确认线上是新构建）
取证方式：内置浏览器 + 页面内 fetch 计数器 + `window.__ofmDebug` 诊断旁路（随本轮取证上线，取证后删除）
```

**V1 场地与范围：已通过**
- 地点搜索「杭州 IN77」出 6 条候选，候选 1「杭州湖滨银泰in77」带「有轮廓」标记（其余是 A区/E区/C3区/B区/湖滨银泰广场）。
- 选候选 → 场地确认卡（待你确认 / 我理解为「杭州湖滨银泰in77」，设为场地？）→ 点标题 → 任务卡进到「待你核对 · 核对具体活动范围」。
- 「确认并应用这一版」→ 地图上出现红色用地红线多边形，范围写进画布。
- **待恢复槽里的需求句被自动接回**：聊天里出现「地点和范围定了，接着你刚才那句继续。」，随即把「就在 IN77 里靠湖滨步行街入口、靠近西湖那一侧的室外广场；做 80 人发布会，户外广场 30×20 米，要有舞台、观众区、签到台和主通路」整句送去模型判断。

**V3 分区：已通过**
- 模型给出「计划 2 个步骤」审批卡（核对活动范围和已有分区 → 按活动用途和室内外依据生成分区预览），「批准并执行」后出分区预览：观众区 / 表演区 / 餐饮区 / 后勤带，80 人发布会 · 同时 80 人。
- 「确认并应用这一版」→「正在把「分区用途与室内外属性」写入画布…」→「已确认并应用「分区用途与室内外属性」」，地图上出现舞台区/观众区/餐饮区/后勤带/签到台 标签，任务自动推进到 V2「主要入口与通道」。

**证据线：非空，已实证**
- 网络上是 `tiles.openfreemap.org/planet` 200 + 4 块 z14 矢量瓦片 200，**不是** 9 路 `/api/site-context`（正式站边缘仍 503 / 20.3s 超时）。
- 诊断旁路读数：范围确认后 `enter(lng=120.163749, lat=30.25283, radiusM=342.9)` → `settled(roads=348, rings=1692, 两侧 fulfilled)` → **`features=108`**。
- 模型话术随之改变：从旧构建的「当前地图服务不可用且无可用广场轮廓」变成「**当前地图只有道路和建筑轮廓**」，说明要素真的喂进了模型。

**死结 1：确认窗口只有 60 秒（已修）**
- 现象：分区预览出来约 3 分钟后点「确认并应用这一版」→ 「地图或规划依据已更新，旧提案已失效，请重新生成」；点「重试」重新生成后 **1 秒内**点确认 → 成功写入画布。
- A/B 证据：失败那次确认时 OFM 重新 `enter`（证据缓存过期重拉），成功那次**没有** `enter`（命中 60s 缓存）。
- 根因：`lib/site-intelligence/snapshot.ts` 的 revision 签名把地图要素整个算进去，而要素带 `observedAt`（每次重拉都变），同一份地图因此算出新版本，提案的 `mapVersion` 必然失配。legacy `/api/site-context` 与 OFM 两条路都打这个时间戳 —— 这是老问题潜伏，OFM 证据线在正式站真的取到数据后被激活。
- 修法：观测时间不进版本签名（几何、范围、锚点、确认项照旧参与，地图真变了照样作废）。
- 红测证据：回退修复后重跑，新用例报 `expected 'p:1:134h8q423t2f4' to be 'p:1:80e1gh1dtnclp'`。

**死结 2：场地自己的建筑足迹当障碍（已修）**
- 现象：V2 预览「人行流线（湖滨路）」被判与地图依据冲突；点「重试」**确定性复现**（模型侧 200，结论一字不差）。
- 离线解码 OFM 瓦片 `14/13660/6746`：冲突要素 `id=149544150` 是 **IN77 综合体自身的建筑多边形** —— 817 个环、覆盖整个地块、`render_height=5`、`name` 为空；第 20 环正好压在人行流线上。
- 根因：OSM 把综合体画成一整块多边形，站内步行街/广场/连廊全被包在里面。拿「场地自己的建筑」当障碍，站内主通道在任何综合体场馆都必然冲突 —— V2 在这类场馆根本走不通。地图并不提供室内/连廊事实，也不能拿它反推「这里是室内、不可通行」。
- 修法：要素顶点落在你已确认的活动范围内、或这块建筑把范围中心整个包住 → 判为场地本体，不再当障碍；**活动范围之外的建筑仍然照旧阻断**。同时提示里写明「未计入不等于确认可通行」。
- 附带：MVT 的 `feature.id` 不是 OSM way id（OSM API 上 way 149544150 在西伯利亚，不是杭州），所以无名建筑给不出可核对的名字 → 无名时改显示「未命名建筑足迹」，不再甩一串内部编号。
- 红测证据：回退修复后重跑，新用例报「人行流线（湖滨路）与地图依据 osm:way/99 建筑/障碍冲突」。

**顺带记录（只记录，未改）**
- 任务卡变高后对话流不自动滚到底：`.ap-feed` 停在 scrollTop 1348（最大 1484），「确认并应用这一版」被裁在可视区外，`elementFromPoint` 命中的是聊天输入框 —— 人工点会点空处。
- 用例 #10 的真实失败样本已拿到：`conversation-api/assistant/chat/stream` 200，但界面报「当前Agent理解不可用（provider_error），规划未变」，如实显示、零写入。服务端问题，本次没动。
- 物料库是空的（「还没有物料。」），V4「按用途复用我的物料」没有真实物料可复用；本次没有触发任何付费生成。
- 画布是本机草稿（状态条：项目已不存在或已被删除，当前画布仍是本机草稿），云保存这一路没有验。

**本轮交付**
- 修 `frontend/lib/site-intelligence/snapshot.ts`：版本签名剔除观测时间。
- 修 `frontend/components/room-organizer/lib/outdoor-map-context.ts`：新增场地本体判定（`isVenueBuilding`）、可读障碍标签（`obstacleLabel`）、以及「未计入障碍」的诚实提示。
- 删 `frontend/components/room-organizer/lib/openfreemap-evidence.ts` 的临时诊断旁路（`window.__ofmDebug` / `console.warn`），证据线行为不变。
- 新增/更新用例：`site-intelligence.test.ts`（版本稳定性）、`outdoor-map-context.test.ts`（场地本体不阻断 / 范围外仍阻断）。
- 版本 4.15.4 → 4.15.5（两个 `package.json` 与 CHANGELOG 同步），CHANGELOG v4.15.5 条目过 `scripts/check-changelog.mjs`。

**门禁**
- 定向回归 5 文件 65 条全绿；outdoor 定向 35 文件 411 条，409 通过（失败的 2 条在基线 `c474966d` 上同样失败：`outdoor-plan-canvas` 标签墨色与工人标签，与本次改动无关）。
- 前端 `tsc --noEmit` 0 行，仓库根 `tsc --noEmit` 0 行。
- 静态导出 `npm run build` 通过（产物在 `.next-ci/`）。

**未验（不得当已验）**
- V4 物料复用、V4 子动线、V5 人物/refine-3d 未走完（物料库为空 + V2 在修复前被拦）。
- 用例 #2（两个同名地点）、#5（离线/无路网）、#7（过时的确认）、#8（刷新/双击/切项目）、#9（撤销回读）本轮未做。
- 修复后的 V2 复验与 V4/V5 续跑待部署后补。

### 2026-11-17 10:20 · 自动轮次 46 · 合并状态核对 + 「已知基线失败」清单校正

```text
日期时间（中国标准时间）及运行 ID：2026-11-17 10:20，自动轮次 46
批次 / 切片 / 状态：M7 / 基线与归属口径 / 已交付
开工事实：main = origin/main = 259aa136（div 0/0）；当前 checkout 是别人的分支 agent/outdoor-notice-and-choice-fix（cc48f210，已推 origin，等 PR）
合并：无需合并、无需推送。该分支按仓库规范（AGENTS.md：main 必须走 PR、不做自动化合并）不由我合；由人审 PR 后入 main
跑的地方：为不把别人的 WIP 带进提交，本轮全部操作在 `.temp/wt-main`（干净 main 的 worktree）里做
校验与结果：
  · `npm test -- components/room-organizer/hooks/use-outdoor-agent-workflow.react.test.tsx`（main）→ 47/47 全过，sub-routes 无失败
  · `git log --all -- '*outdoor-agent-http-contract*'` → 0 条；`git ls-tree main ...` 也查不到 → IN77 那条基线不可复现
结论：两条「已知基线失败」在 main 上均已失效，已在计划编写期基线段逐条标注校正，并写明以后判归属以当轮实测为准
未完成：真浏览器（9222 仍不通）、面板按钮（面板由另一会话在改）
```

- **过期基线比没有基线更危险**：它会把“别人修好了”误判成“又是旧账”，从而放过真实回归。
- **不在别人分支上做自己的提交**：换到 `main` 的独立 worktree 里做，提交自然落在 main，也不把别人 57 个未提交改动带进去。

### 2026-11-17 09:35 · 自动轮次 45 · M7 发版门禁复跑（提交树三项绿，工作树红已定位）

```text
日期时间（中国标准时间）及运行 ID：2026-11-17 09:35，自动轮次 45
批次 / 切片 / 状态：M7 / 门禁复跑 + 归属判定 / 已交付
开工 HEAD：396ad994；远端同（div 0/0），无需合并；9222 仍不通
跑法：干净 HEAD 隔离 worktree（.temp/wt-r45，node_modules 走 junction）跑门禁，工作树另跑一次做对照
结果（提交树）：
  · npx tsc --noEmit → 0 行
  · npm test -- outdoor → 50 文件 / 563 条全过（轮次 31 时为 34 文件 / 398 条）
  · NODE_OPTIONS=--max-old-space-size=8192 npm run build → exit 0，154 秒，✓ Compiled successfully in 41s
结果（工作树）：frontend tsc 9 行红，全在未跟踪的 replica-specs-{festivals-3,gov-1,...}.ts，错因统一：FacilityPlacement grid 变体要 dy，文件里没给
归属：这五份文件 git ls-files 查不到（未跟踪、别人的在途卡），不是我这几轮改的模块；不猜对方布局数值补 dy，只登记
交付：docs/plans/2026-11-16-outdoor-evidence-matrix.md 新增 §6「发版门禁复跑」（命令 + 实测结果 + 9 行红的归属 + 结论）
未完成：真浏览器（9222 三轮不通）、面板按钮
```

- **门禁要在提交树上跑，不能只在工作树上跑**：工作树里别人未跟踪的文件会把 tsc 拖红，从而把“能不能发”和“别人的草稿坏没坏”混成一件事。
- **不替别人补布局数值**：`dy` 是多少只有他那张卡知道，猜一个数只会把红改成错。

### 2026-11-17 08:45 · 自动轮次 44 · M7 合并后回归 + 对照表回写（9222 实测关闭）

```text
日期时间（中国标准时间）及运行 ID：2026-11-17 08:45，自动轮次 44
批次 / 切片 / 状态：M7 / 回归清扫 + 可判口径回写 / 已交付（文档类）
开工 HEAD：c4efceab；远端同（div 0/0）——上轮之后上游又合进了 5 个分支（docs/intelligence-gap-roadmap、fix/agent-run-hygiene、fix/quota-notice 等），确认 953f9f5b 仍在祖先链上，我的 8 个模块文件与测试都在
9222 探测：http://127.0.0.1:9222/json/version → 无法连接到远程服务器（端口未开），M7 的 6 条 browser-only 仍不可验
交付：
  · 合并后回归：8 个 M7 文件 77 条全过（turn-metrics 9 / trace-metrics 9 / turn-live 14 / metrics-book 13 / metrics-export 6 / session-report 7 / report-download 7 / selfcheck 12）
  · docs/plans/2026-11-16-outdoor-evidence-matrix.md 新增 §5：「可判口径」表（5 条 report / 6 条 browser，逐条写要出现什么信号）+ 复现命令 + 实测条数 + 9222 探测结果；结论仍写明 11 条 0 条全绿、门禁继续关闭
  · formatAcceptanceStatement（一行可粘进 PR 的验收声明，固定收尾「三类全绿 0 条，未验部分不作通过」）+ hook `acceptanceStatement()`；自检 12→15 条
验证：8 文件 77 条 → 自检改后 15 条（全过）；hook 套件 47/47（上游又加了 2 条）；hook 仍走 HEAD blob 替换 + cacheinfo（staged 实测 3 行）
未完成：真浏览器（9222 关）、面板按钮
不改的东西：工作树里别人的在途文件（venue-picker.*、replica-cases.*、learning-library/、assets/avatars/、MEMORY.md）一律未动
```

- **合并后第一件事是重跑自己的套件**：这次上游合了 5 个分支，8 文件 77 条仍全绿，才敢说“没被打破”。
- **对照表要能自己回答“缺什么”**：把“可判 / 只能浏览器”写进表里，比再写一句“未验”有用。

### 2026-11-17 08:05 · 自动轮次 43 · M7 发布前自检清单（可判 ≠ 通过）

```text
日期时间（中国标准时间）及运行 ID：2026-11-17 08:05，自动轮次 43
批次 / 切片 / 状态：M7 / 发布前自检 / 已交付
开工 HEAD：db9f1e7c；远端 ec65b677（领先 1 笔：路网流线与建筑足迹不再整轮拦死）
合并：ff-only 合并成功；重叠的用户 WIP 两个文件（outdoor-map-context.ts、frontend/package.json）先字节备份到 .temp/r43-user-backup → stash → merge → stash pop，无冲突标记，package.json 只被上游从 4.15.5 提到 4.15.6，用户其余改动保留（对 HEAD 仍有 7 行 diff）
交付：
  · lib/outdoor-acceptance-selfcheck.ts：ACCEPTANCE_RULES（11 条：5 条 source=report、6 条 browser）+ reportSignals（9 种可观测信号）+ assessAcceptance（ready/missing/browser-only）+ summarizeAssessment（可判/缺料/只能浏览器 三段文本）
  · 强约束：本模块**不产生通过结论**，浏览器类永远不给 ready；汇总末行固定写「可判 ≠ 通过」
  · hook 暴露 acceptanceCheck()（{rows, totals}）
验证：selfcheck 12/12；hook 套件 45/45（工作树）；hook 仍走 HEAD blob 替换 + cacheinfo（staged 实测 5 行）
未完成：6 条 browser-only 仍需 9222；面板仍不接按钮；对照表未回写当次结论
```

- **把“0 条全绿”变成可计算的另一面**：自检只能说“有料可判/缺料”，一旦它也敢下“通过”，就会成为下一份假证据。
- **合并前先看重叠文件**：这轮只有两个文件重叠，先备份再 stash，pop 回来一次就对。

### 2026-11-17 07:10 · 自动轮次 42 · M7 报告落成本地文件

```text
日期时间（中国标准时间）及运行 ID：2026-11-17 07:10，自动轮次 42
批次 / 切片 / 状态：M7 / 报告导出成文件 / 已交付
开工 HEAD：237823eb（开工时已被推进 3 笔，含 docs/46–47 规划真源与 E1 卡）；远端同（div 0/0），无需合并
交付：
  · lib/outdoor-report-download.ts：downloadSessionReport(report, deps?) → {ok, filename, reason?}；文件名用导出时刻（UTC）而不是“现在”，便于对账
  · 三件外部能力全可注入（createObjectURL / revokeObjectURL / anchorFactory）；无 API、建 URL 报错、拿不到锚点 均返 ok:false 不抛；无论成败都回收 blob URL（click 抛错也回收）
  · hook 暴露 downloadReport()（2 处接线）
验证：report-download 7/7；session-report 7/7；hook 套件 45/45（工作树）；隔离 worktree tsc 首次 3 行错（`exactOptionalPropertyTypes` 不认 `undefined` 传给可选函数属性，故 deps 三个字段写成 `| undefined`）→ 改后 0 行，三文件 55/55（干净 HEAD 上 hook 41 条）；hook 仍走 HEAD blob 替换 + cacheinfo（staged 实测 3 行）
本轮遇到的一件怪事（如实记）：开工后第一次跑 hook 套件直接报 “Failed to resolve import ../lib/outdoor-session-report”——上轮提交的 outdoor-session-report.ts / .test.ts 在工作树里被删了（git status 显示 D，index 里还在）。用 git restore --source=HEAD 把这两个自己的文件取回，重跑 3 文件 59/59。这不是本轮回归，但提醒：可能有别的会话也在改这个仓库。
未完成：文件还没接按钮（面板仍由另一个会话在动）；真实浏览器未验（需 9222）；发布前自检清单未做
```

- **下载这种“碰外部 API”的事，能注入就能验**：jsdom 没 `createObjectURL`、没真下载，就把三件能力做成参数，生产用浏览器实现。
- **文件名用导出时刻，不用 `Date.now()`**：两份报告只要时间戳一致就能逐字对账。

### 2026-11-17 06:25 · 自动轮次 41 · M7 会话报告（轨迹+指标一份导出）

```text
日期时间（中国标准时间）及运行 ID：2026-11-17 06:25，自动轮次 41
批次 / 切片 / 状态：M7 / 会话报告 / 已交付
开工 HEAD：70d962bb；远端同（div 0/0）
复现的毛病：两本簿子各导各的（轨迹一份 text、指标一份 text），工单里要贴两段、对不上轮次
交付：
  · lib/outdoor-session-report.ts：buildSessionReport({turns, metrics, now}) → {version, exportedAt, traces, metrics, text}；轨迹在上、空行、指标行；本层不新加字段
  · outdoor-turn-live 新增可选 traceBook：settle 时把这一轮记进轨迹簿（未收口不入簿）
  · hook 暴露 sessionReport()（4 处接线）
验证：session-report 7/7、turn-live 12→14；hook 套件 45/45（工作树，含用户新增用例）/ 41/41（干净 HEAD）；hook 仍走 HEAD blob 替换 + cacheinfo（staged 实测 6 行）；隔离 worktree tsc 0、三份合计 62/62
自损一条：确定性用例先挂——`trace()` 每次生成新 turnId（随机后缀），自己写用例时没注意到“输入是不确定的”，改成复用同一条轨迹。
未完成：报告还没落成文件；面板按钮待面板稳定；浏览器与云端未验
```

- **“导出两份”不等于“能对账”**：只有拼成一份、且共用同一时间戳，才对得上轮次。

### 2026-11-17 05:40 · 自动轮次 40 · M7 导出动作（面板按钮主动不做）

```text
日期时间（中国标准时间）及运行 ID：2026-11-17 05:40，自动轮次 40
批次 / 切片 / 状态：M7 / 导出动作 / 已交付（UI 入口未做，原因见下）
开工 HEAD：bd5cc60e；远端同（div 0/0）
交付：
  · lib/outdoor-metrics-export.ts：exportMetricsReport(summary, deps?) → { line, copied }；先打日志（一定成功），再尽力写剪贴板（无 API / Promise 被拒 / 同步抛错都退回只打日志），6/6
  · hook 暴露 exportMetrics()（一行接上）
为什么不做面板按钮：本轮去接面板时发现工作树版的标题栏已被用户重构（`新开会话` 区域变了，HEAD 的锚点在当前文件里已不存在）。若只改 HEAD，用户下次提交自己的面板会把按钮冲掉；若改工作树，就得替他改正在重构的 JSX。两种都不合适，所以先交可测的动作层，按钮等面板稳定。
验证：固定数据 export 6/6；hook 套件 45/45；hook 仍走 HEAD blob 单行替换后 cacheinfo（staged 3 行）
未完成：面板按钮、浏览器主流程（需 9222）、云端
```

- **发现目标正在被别人改，就换个交付物**：生插一个按钮不难，难的是不把别人正在改的东西弄乱；把动作层交掉，按钮留给面板稳定后。
- **剪贴板一定不能是唯一出路**：无 API、隐私模式、无手势都会失败，日志必须成功。

### 2026-11-17 04:55 · 自动轮次 39 · M7 指标只读导出

```text
日期时间（中国标准时间）及运行 ID：2026-11-17 04:55，自动轮次 39
批次 / 切片 / 状态：M7 / 只读导出入口（数据层）/ 已交付
开工 HEAD：0d25ae28；远端同（div 0/0）
交付：
  · lib/outdoor-metrics-book.ts 新增 summarizeMetrics(book, limit?) → { totals, rows, text }：不把簿子本体交出去
  · hook 返回 metricsSummary()（一行接上），3 行改动，不再影响行为
验证：固定数据 metrics-book 13/13（含 limit 只限行数不改汇总、空簿平均值 null）；hook 套件 45/45
提交处置：hook 属用户 WIP，HEAD blob 两处替换后 cacheinfo，staged 3 行
未完成：面板按钮（需浏览器可验再上）；主流程浏览器需 9222；云端无
```

- **拆成“可测的一层 + 一行接线”**：把汇总做成纯函数先测透，hook 里只剩一行，风险面小很多。

### 2026-11-17 04:00 · 自动轮次 38 · M7 指标簿进 hook（取消/失败终态）

```text
日期时间（中国标准时间）及运行 ID：2026-11-17 04:00，自动轮次 38
批次 / 切片 / 状态：M7 / 簿子接进 hook / 已交付
开工 HEAD：b44e3bd0；远端同（div 0/0）
交付：hook 共 6 行——`createMetricsBook()` 用 useRef 持住并传给 `createLiveTurn({ book })`；`cancel()` 结 `cancelled`；确认前地图依据核对失败那条 catch 结 `failed`
验证：hook 套件 45/45（本轮工作树实跑）；hook 仍属用户 WIP，HEAD blob 逐处替换后 cacheinfo，staged 实测 6 行
发现：`act()` 本身没有 try/catch（错误往调用方抛），所以“一轮失败”在这个 hook 里只能在地图核对 catch 与 cancel 两处收口；其余失败要在面板层结，已写进下一条操作。
未完成：簿子在内存里，没有任何入口能导出；浏览器实证需 9222
```

- **找不到 catch 就先改找得到的那两处**：`act()` 无 try/catch，与其猜，不如把 cancel 与地图核对失败这两个确定的终态先收口，剩下的写清楚在哪里。

### 2026-11-17 03:05 · 自动轮次 37 · M7 指标簿（可导出汇总）

```text
日期时间（中国标准时间）及运行 ID：2026-11-17 03:05，自动轮次 37
批次 / 切片 / 状态：M7 / 指标簿与汇总 / 已交付
开工 HEAD：2bdcff23；远端同（div 0/0）
交付：
  · lib/outdoor-metrics-book.ts：record/list/totals/clear；同 turnId 更新不新增；容量上限；次数求和、耗时只对有的轮次求均值；导出只拼白名单字段；formatMetricsTotals 一行汇总
  · outdoor-turn-live：可选 `book`，settle/log 自动记一笔；换轮时先结掉没收口的上一轮（不让簿子留“进行中”假记录）
  · hook：预览那一步从 settle 改成 log（一轮=发话→出预览→确认落盘，确认属同一轮，不应在预览时就封轮）
验证：
  · 固定数据：metrics-book 10/10、turn-live 12/12
  · 回归：hook 套件 45/45（本轮工作树实跑）
  · hook 属用户 WIP，仍用 HEAD blob 单行替换后 cacheinfo 提交，staged 实测只 1 行改
自损一条：先写了“出预览就 settle”，结果确认/落盘在终态之后被丢弃，appliedCount 永远是 0；靠簿子那条用例报出来，改成 log。
未完成：簿子还没在 hook 里新建（下一步）；浏览器实证仍需 9222
```

- **先想想“一轮”到底在哪结束**：预览不是终点，用户还要确认；把预览当终点，落盘永远记不到。

### 2026-11-17 02:10 · 自动轮次 36 · M7 指标接线（只写日志）

```text
日期时间（中国标准时间）及运行 ID：2026-11-17 02:10，自动轮次 36
批次 / 切片 / 状态：M7 / metricsFromTurnTrace 接进 hook / 已交付
开工 HEAD：12e1afb5；远端同（div 0/0，无需合并）
问题：hook 里根本没有 turn-trace/finishTurn，轨迹层只有测试在用 —— 所以“接到 finishTurn 之后”= 先把一轮的生命周期建起来
交付：
  · lib/outdoor-turn-live.ts：createLiveTurn() 提供 begin/markMap/attempt/markPreview/markConfirm/markApplied/settle/log/peek，每次调用一行，日志形如 [outdoor-metrics] model=1 map=1 confirm=0 applied=0 firstFeedback=2000 preview=2000 apply=null terminal=preview_ready turn=t-…
  · hook 接线 9 行：start() 开轮；offer() 标预览并收口；confirm() 记确认；应用成功后标落盘再补一行日志
  · 修了适配层一个真 bug：窗口末端只算 finishedAt+UI 时刻，会把“确认 2.4s、落盘 2.9s”裁掉；改为也纳入阶段打点（扫带测试先报出）
验证：
  · 固定轨迹：outdoor-turn-live 9/9；指标两层 18/18
  · 回归：use-outdoor-agent-workflow.react.test.tsx 43/43 全过
  · 提交：hook 属用户 WIP（且本轮期间又被用户改过，含 card-history-sync），用 HEAD blob + 只打自己的 9 行 → cacheinfo 提交；staged 实测只有 9 行新增
未完成：日志只在控制台，无导出；浏览器实证仍需 9222
```

- **先确认目标存在再动手**：“接到 finishTurn 之后”听起来是加一行，实际那个函数根本不存在；先查调用点，不假装接上。
- **用户在改的文件只提自己那几行**：用 HEAD 版重叠打补丁 + `--cacheinfo`，比直接 `git add` 安全；staged 后逐行看一遍才提。

### 2026-11-17 01:05 · 自动轮次 35 · 合并（OpenFreeMap 证据线）+ M7 轨迹适配层

```text
日期时间（中国标准时间）及运行 ID：2026-11-17 01:05，自动轮次 35
批次 / 切片 / 状态：M7 / 轨迹→指标适配层 / 已交付
开工 HEAD：58f67566；远端进 1 笔 c474966d（证据线改走 OpenFreeMap 客户端源）
合并：重叠 2 个用户在改的文件（outdoor-map-context.ts、frontend/package.json），走备份→stash→merge→pop：
  · package.json 唯一冲突在 version 行，取上游 4.15.4；用户 scripts 经逐项比对于备份完全一致
  · map-context.ts 送返回上游 + 用户改动（对 HEAD 仍有 31 行差异）
本轮交付：lib/outdoor-trace-metrics.ts + .test.ts
  · 阶段打点 → map_request / preview_ready / applied；attemptIds → 模型次数（只报次数，不造时刻）
  · 窗口末端取 max(finishedAt, UI 时刻)，因为气泡常在终态之后才渲染
  · 修正上轮预览口径：预览在确认之前时从开轮算（原实现会返回负值转 null）
验证：两个文件各 9/9（合计 18）；在隔离 worktree（干净 HEAD + 本轮提交）`tsc --noEmit` 0 行
自我挖出的错（已修）：
  · 首次提交把用户 WIP 的 `outdoor-map-context.ts` 与 `frontend/package.json` 一并带进去了（stash pop 与手工 `git add` 留下的暂存）——`reset --soft HEAD^` 后只重提自己的 4 个文件，用户的 scripts 与 map-context 改动仍在工作树（逐项比过）
未完成：还没接到界面（下一步）；浏览器主流程仍需 9222
```

- **语义先想清楚再写断言**：「确认→预览」在真实流程里两个顺序都有，第一版只写了后一种，被自己的用例拆穿。
- **合并且在用户在改的文件上就逐项比对**：package.json 只取版本行，scripts 一行行对备份。

### 2026-11-17 00:20 · 自动轮次 34 · 收尾 r33 推送 + M7 指标采集器

```text
日期时间（中国标准时间）及运行 ID：2026-11-17 00:20，自动轮次 34
批次 / 切片 / 状态：M7 / 指标采集器（固定数据）/ 已交付
开工 HEAD：19334be3（远端同）；先收尾 r33：证据对照表 + 进度提交推送 → 8f5f1b88
残留锁：r33 的锁（pid 28408）已确认进程不在，清掉后重写 r34
本轮交付：frontend/components/room-organizer/lib/outdoor-turn-metrics.ts + .test.ts
  · collectOutdoorTurnMetrics({startedAt, events, endedAt}) → { modelCalls, mapCalls, confirmations, appliedCount, firstUsefulFeedbackMs, previewMs, applyMs }
  · 窗口外事件不算；缺锚点给 null（不用 0 冒充）；同一毫秒 applied 去重；双击确认 confirmations=2 但 appliedCount=1
验证：定向测试 9/9；在途 tsc 的 8 行错全在用户 WIP 的 outdoor-plan-canvas.tsx，我的文件 0 条
未接线：还没从真实轨迹产事件（下一轮做）；未起 dev server
```

- **不把 0 当“瞬间完成”**：缺锚点一律 null，否则「没有反馈」会显示成「0ms 就给了反馈」。
- **双击确认要能看出来**：confirmations 与 appliedCount 分开统计，才看得出「多按了一下」。

### 2026-11-16 23:50 · 自动轮次 33 · 合并核对 + M7 三类证据对照表

```text
日期时间（中国标准时间）及运行 ID：2026-11-16 23:50，自动轮次 33
批次 / 切片 / 状态：M7 / 三类证据对照表 / 已交付
开工 HEAD：19334be3；远端同（div 0/0）
交付：docs/plans/2026-11-16-outdoor-evidence-matrix.md
取数：14 个测试文件，--reporter=json 逐文件计数，本轮实跑 148 条全绿（原始结果 .temp/r33-tests.json）
结论：11 条验收用例 **0 条三类全绿**；#1/#6/#11 已观测到明确未通过；#4 部分过；其余未验 → 已拦发布
指标：只有「重复输入 / 地图与模型调用次数 / 澄清次数」有局部数（轮次 21、轮次 27）；确认次数与耗时全部未采集
本回合中断：进度文档已改但未提交（锁残留为 r33），下一轮开头收尾
```

- **把“部分证据”与“通过”分开写**：对比表里 #1 有登录态浏览器实证，但组合需求那半边是断的，所以结论是未通过，不是部分通过就当过。

### 2026-11-16 07:40 · 自动轮次 32 · 合并核对 + M7 回退手册与阻断条件

```text
日期时间（中国标准时间）及运行 ID：2026-11-16 07:40，自动轮次 32
批次 / 切片 / 状态：M7 / 回退手册 + 四条发布阻断条件 / 已交付
开工 HEAD：f34d180e；远端同（div 0/0，无需合并）
交付：新增 docs/plans/2026-11-16-outdoor-release-rollback.md
实测（隔离 worktree .temp/wt-r32，无用户 WIP）：
  · 10 笔逐笔 `git revert -n`：只 935db271、3e9d2aba 零冲突；其余在 CHANGELOG/进度文档/agent-panel 上停
  · 代码级反向应用（不碰文档）：a7c6bc38、bb4b697c、935db271、3e9d2aba 零冲突；939b424b/596f1735/ef578988/7ddafd31/49af1360/243ea858 有冲突（位置已入表）
  · 端到端：反应用 bb4b697c → tsc 0 行、hook 套件 41/41 全过；代价=缺 brief.people 的旧草稿读不回（已写入手册并给“只退行为不退文件”的替代做法）
  · 四条阻断条件逐条给了判定信号 + 现有可验项 + 缺口（分流与双击/切项目都得浏览器）
收尾：worktree 已 rmdir junction 后 remove --force；未起 dev server
未完成：浏览器主流程（需 9222）、Edge 契约（B）、真实云端、生产验证
```

- **回退能力也要实测**：以前进度里只写“可按提交回退”，实测才发现 10 笔里 6 笔会冲突；现在手册直接告诉接手人哪几笔要手工。
- **把代价写进手册**：回退 v4.15.3 会把旧草稿又弄丢，替代方案是只退行为保留文件。

### 2026-11-16 06:35 · 自动轮次 31 · 合并收口 + M7 发版门禁

```text
日期时间（中国标准时间）及运行 ID：2026-11-16 06:35，自动轮次 31
批次 / 切片 / 状态：M7 / 发版门禁记录（typecheck + build + 定向回归）/ 已交付（本地）
开工 HEAD：e4e96d01；收工 HEAD 见推送结果
先解决合并：远端 3 笔（243ea858 拆思卡片 / 935db271 新轮清思卡 / 3e9d2aba 保留可见步骤编号），重叠仍是 agent-panel.tsx/.css 两个用户在改的文件
  · 做法同轮 30：字节备份 → stash → merge --no-edit → stash pop → 验无冲突标记；用户改动仍在（+8/−4 叠加态）
门禁结果：
  · npm run typecheck 0 错
  · npm run build 通过（默认 4096 堆 OOM，停陈旧 dev server 后 8192 堆一次过，产物扫描违规 0）
  · npm test -- outdoor → 34 文件 / 398 条全过
环境留痕：陈旧 dev server 子进程（pid 19180，2.8GB，端口已死）本轮已停；收工前无长跑进程
未完成：浏览器主流程、Edge 契约/权限/迁移（B）、真实云端
```

- **先看内存再怪代码**：第一次 build OOM 时，很容易写“构建坏了”；查进程才发现是个早就不响的 dev server 占着 2.8 GB。
- **门禁要写成别人能重跑的命令**，不只写“通过”：堆大小、停进程这两个前置都写进表里。

### 2026-11-16 05:25 · 自动轮次 30 · 合并收口 + M5 刷新恢复兼容

```text
日期时间（中国标准时间）及运行 ID：2026-11-16 05:25，自动轮次 30
批次 / 切片 / 状态：M5 / 刷新后恢复口径 / 已交付（固定数据 + hook 套件）
开工 HEAD：a7c6bc38；收工 HEAD：**47daf775**（已推，远端同；中途远端两次前进：7ddafd31 与 49af1360）
先解决合并：远端进 1 笔 7ddafd31（show live work and ask before executing a plan），与脏文件零重叠，ff-only 成功
复现的毛病（读代码 + 套件实跑）：
  · 旧 readState 一条铁律：字段不全就整份丢；早一点的草稿没有 brief.people，刷新后连分区物料一起丢
  · pendingLogin 与 pendingBoundary 只看结构不看版本：方案已变也能把输入框禁成“登录后继续”
本轮交付：
  · 新 lib/outdoor-flow-restore.ts：阶段不认识→退回 place（不全丢）；brief 三列表缺补空；completed 只留认识的并去重；登录等待按方案版本判过期；未确认边界只在结构不可用时丢（保留则仍是待确认）
  · hook 的 readState 改用它，并按当前方案版本传参
验证：
  · 固定数据：outdoor-flow-restore.test.ts 9/9
  · 回归：use-outdoor-agent-workflow.react.test.tsx **40/40 全过**（含“刷新后重新预览未确认候选，仍需显式确认才写入”）
  · 类型：frontend `tsc --noEmit` 0 行
自我挖出的两个错（已修）：
  · 第一版把 callbacks 引用提到 useRef 声明之前，整套 react 套件 40 个全挂（TDZ）；改成首次 render 用入参 bridge
  · 第一版把“方案版本不同的 pendingBoundary”也丢了，把“刷新后重新预览”那条用例跑挂；改成保留并仍需确认
未完成：双击确认/切活动/撤销的浏览器验收仍要登录态
两次合并的处置（含用户在途文件）：
  · 第一次 7ddafd31：与脏文件零重叠，ff-only 直成
  · 第二次 49af1360：忘了带 push 先推不了，且它改了 `agent-panel.tsx/.css` 两个用户正在改的文件（工作树版本与 HEAD、origin 都不同）
  · 做法：先把两个文件字节备份到 `.temp/r30-user-backup/`，`git stash push -- <两文件>`，`git merge --no-edit origin/main`（本地有本轮提交，所以不是 ff），`git stash pop` 回来
  · 验：stash pop 干净无冲突标记，两文件仍为“用户 WIP + 上游改动”的叠加态（+11/−4），用户内容一行未丢
```

- **自己挖的错自己扫**：抱错 TDZ 时先信基线结论（“只有 sub-routes 一条失败”），一跑发现 40 条全挂，立刻回到自己改的 36 行里找。
- **用户在改的文件不硬碰**：备份→stash→merge→pop→验标记，四步都留痕；宁可多写一行记录，也不赌“应该能自动合”。
- **先把套件跑绿再交**：改恢复逻辑影响面大，先跑 hook 的 40 条，才发现自己把“未确认候选重出”弄没了。
- **把自损写进记录**：两处自损（TDZ、边界被丢）都写清楚，后面接手的人不会以为是别人的回归。

### 2026-11-16 04:10 · 自动轮次 29 · 合并收口 + M5 幂等票号

```text
日期时间（中国标准时间）及运行 ID：2026-11-16 04:10，自动轮次 29
批次 / 切片 / 状态：M5 / 应用幂等（双击只写一次）/ 已交付（固定数据）；浏览器部分待登录态
开工 HEAD：ca3e143e；收工 HEAD 见推送结果
先解决合并：
  · 远端已进 3 笔（0cb48425 流式摘要、9d52da14 fixture 类型、e9fedccd 不再用 buffered JSON）
  · git fetch 连试 4 次全失败（网络），但远端对象本地已有 → git merge --ff-only origin/main 成功，HEAD=e9fedccd，无冲突、无丢失
  · 合并后工作树仍有 36 处用户在途改动（handoff、画布、贴纸、图例等），一个没动
M4 诊断（试了，没结论就停，不编）：
  · 重启 dev server（:3210，pid 3600）；playwright 运行时输入框尚未挂载（冷编译）导致 locator.fill 超时，没拿到 [diag-r29] 日志
  · 临时诊断 console.log 已删除，工作树无残留（agent-panel.tsx 当前只有本轮 3 个 hunk / 5 行）
  · M4 结论不变：分流要登录/模型，证据见轮次 28
本轮交付：
  · 新 lib/outdoor-apply-once.ts：以「任务 epoch + 基准版本」为票号，同一张票只放行一次，带容量上限与 release
  · 接入 confirmZoneProposal：基准版本校验通过后先投票，重复确认直接 return
  · 验证：npm test -- outdoor-apply-once.test.ts 6/6；隔离 worktree typedcheck 见下
未完成（不报成已验）：
  · 双击确认的真实浏览器验收（需先有一版分区预览 → 登录）
  · 刷新后旧预览不自动提交、撤销后回读（同属 M5，依赖同一登录态）
```

- **合并先试再报**：fetch 失败四次仍先试 ff-only，因为对象已在本地；真失败再报阻塞。
- **诊断没拿到就不吹**：M4 本轮没推进，写清“没拿到日志”，没把尝试当结论。
- **切片最小化**：只动“一版只落一次”这一件事，6 条固定数据测试，一个接入点。

### 2026-11-16 02:40 · 自动轮次 28 · 合并 + M4 外部阻塞取证 + v4.15.1

```text
日期时间（中国标准时间）及运行 ID：2026-11-16 02:40，自动轮次 28
批次 / 切片 / 状态：M4 前置切片（登录卡文案错位）/ **已交付**；M4 主体 **阻塞**
开工 HEAD：9b92e0d9；收工 HEAD：**f618880b**（已推，远端同；中途远端进到 ede46aba / e813b31e，两次快进+一次合并都在本轮内完成）
先解决合并（用户本轮要求）：
  · 远端 ede46aba（用户把 thoughts/流式那批在途改动提了），本地落后 1 笔
  · 工作树里 20 个脏文件与 origin/main 内容**逐字节相同**（hash-object 逐个比对 same_as_origin=20 / differs=0）
  · 两个上游新增文件（migrations/…agent_run_thoughts.sql、tests/assistant-chat-stream.test.ts）在本地是未跟踪副本，内容同样一致 → 先备份到 .temp/r28-new/ 再移除
  · `git checkout --` 18 个已跟踪脏文件 → `git merge --ff-only origin/main` 成功 → 重新校验 20 个文件 hash **bad=0**，无一行丢失
M4 取证（真实浏览器，1440×900，未登录，:3210）：
  · 范围确认成立（boundary=4，阶段=“分区用途与室内外依据”）后再发组合句 → NET=[]、zones/routes/facilities 全 0、无新气泡 → “说了等于没说”
  · 发「帮我分区」→ 同样零请求，但输入框变 disabled（placeholder=登录后继续这次选址）→ 说明分区分流走的是要登录的 `act()`，不是本地分区器
  · 点卡片「预览分区用途与室内外依据」→ 出 `GET /api/site-context?…`，卡片停在“正在处理”
  · 判断：M4 主体需可得登录态/模型服务；本轮不谎报进度，转做无依赖切片
本轮交付（可独立验收）：
  · 新 `lib/outdoor-login-copy.ts`（标题/正文/placeholder 三句同源）+ 4 条测试
  · `outdoor-workflow-card.tsx` 与 `panels/agent-panel.tsx` 接入：范围已确认 → “登录后继续这次设计”
  · 验证：`npm test -- outdoor-login-copy.test.ts` 4/4；真实浏览器 `AFTER_MSG={"placeholder":"登录后继续这次设计","disabled":true,"card":"登录后继续这次设计","mentionsDesign":true,"mentionsPlace":false}` → VERDICT=PASS（截图 .temp/m4-login-copy.png）
  · 回退：本轮一度改过 `zone-event-proposal.matchZoneCommand`（想让“人数+活动”走到本地分区），但实测分流根本到不了那里，属未验证改动，已 `git checkout --` 收回
  · 合并后又拿到一笔上游（e813b31e “show model summaries in outdoor planning”），与脏文件零重叠，`git merge --no-edit` 干净合入后推成功
  · 隔离 worktree typedcheck（.temp/wt-r28 @ f618880b + node_modules junction）→ `tsc --noEmit` **0 行**；工作树仍有用户在途的 `outdoor-plan-canvas.test.ts` 报错（`MEASURE_RULER_MIN_TICK_PX`/`formatLengthM` 未导入），属在途文件，不算本轮回归
遗留（必须写在下次开工前看）：
  · M4 主体未验收，也不是我能单独解开的：要么拿到可用登录态，要么把分区/组合预览改成不依赖模型的确定性路径（需要产品决策）
  · 两条已知基线失败未动：IN77 token 1024 vs 4096；sub-routes 2 米支线
```

- **合并前先量，不靠“应该没冲突”**：20 个文件逐个比 hash，确认工作树那份等于远端已提交那份，才去 checkout + ff。
- **一次验证失败就当证据**：本来想用匹配器修 M4，实测发现分流根本不进那个分支，于是收回改动，不去堆一个看起来能跑的补丁。
- **阻塞写清解除条件**：M4 要登录或确定性路径，二者都不是本轮能自行提供的。

### 2026-11-16 00:55 · 自动轮次 27 · M3 接线（分层指令落地 + 真实浏览器验收）

```text
日期时间（中国标准时间）及运行 ID：2026-11-16 00:55，自动轮次 27
批次 / 切片 / 状态：M3 / 分层指令接线 / **已验收**
工作目录 / 分支：仓库根 / main
开工 HEAD：796b3267（远端同步，div 0 0，无需合并）；收工 HEAD：**596f1735**（已推，远端同）
修改路径：
  · lib/outdoor-layered-task.ts（新）——把一句多层的话接成一件待办
  · lib/outdoor-layered-task.test.ts（新，8 条）
  · panels/agent-panel.tsx（只入 2 个 hunk：import 换行、退回气泡换成分层文案；文件里同存用户 WIP，未入索引）
  · package.json / frontend/package.json（4.14.0 → 4.15.0）、CHANGELOG.md、本文档
行为变化（用户可见）：
  · 旧：「还没定在哪。…这句我先留着。 下一步：在地图上选地点。」——后半句“最后再调通道”被吞
  · 新：「还没定在哪。…这句我先留着。 下一步：在地图上选地点。 后面还有：最后再调通道；这一步做完再接着做，现在不用决定。」
验证（三类分开记）：
  · 固定数据：`npm test -- outdoor-layered-task.test.ts` 8/8；连跑 instruction-layers + place-first 共 25/25
  · 真实浏览器（https://127.0.0.1:3210/editor，1440×900，未登录）：发「先摆摊位，最后再调通道」→ 气泡三层齐全，HAS_QUESTION=false，NET=[]（零 xhr/fetch），截图 `.temp/m3-wire1.png`
  · 真实云端：本轮不涉及
  · 隔离 worktree typedcheck：`git worktree add --detach .temp/wt-r27 596f1735` + node_modules junction → `npx tsc --noEmit` **0 行输出**（即本轮提交单独看零错），验完已 `rmdir` junction 并 `git worktree remove`
  · 为什么得用隔离 worktree：工作树里的用户在途改动（thoughts 特性、api.ts 守卫）会让 `tsc` 报错且错误集合在变（本轮中途 4 条→2 条），不能把别人的半成品算成本轮回归，也不能拿它阻住自己的提交
未提交/未做：
  · `agent-panel.tsx` 里用户正在做的“流式草稿上屏”（streamPreview 在 Provider 里、AgentPanel 用不到）本轮**没修没提交**，只在工作树里临时看得到；作者在改，我不抦
  · 环境口径虽已进 `LayeredTask.environment`，但目前只到待办层，尚未写进 brief.zones（属于 M4 的接线）
下次准确继续：M4 首切片——用已确认范围跑「200 人市集，签到靠近入口，留出通道」，记是否一次出预览、有无逐阶段追问
```

- **先量再做**：先确认这句话当前到底有没有生效（轮次 25 量出零请求零变化），再动接线。
- **只抽自己的 hunk**：`agent-panel.tsx` 同时有用户 13+/6- 的在途改动，本轮只把 2 个 hunk 入索引。
- **用户正在用这个文件**：本轮中途 tsc 错误集合在变（4 条 → 2 条），说明作者在保存；所以我只修自己的文件，不去搂用户的半成品，并把这件事写在这里避免下轮误判为回归。

### 2026-11-16 00:20 · 自动轮次 26 · 按用户口径纠正 M3 的样板句

```text
日期时间（中国标准时间）及运行 ID：2026-11-16 00:20，自动轮次 26
批次 / 切片 / 状态：M3 / 样板句与后置动作表纠正 / 已交付
工作目录 / 分支 / HEAD：仓库根 / main / 939b424b
修改路径：lib/instruction-layers.ts、lib/instruction-layers.test.ts（9 条重写）、lib/outdoor-agent-planning.ts（仅改注释）、本文档
用户反馈（本轮起因）：用户看到「无室内，后续是造墙」后直接说「这是什么乱七八糟的指令」，并给出真实口径：**要么就是室外的活动、搞集会**
判断：那句子是我当初把一段对话转述压扁出来的，既不是用户说法、也不是本产品场景；之前把它当 M3 的验收样板是错的
处置：
  · 解析层注释与 9 条用例全部改成室外集会口径（先摆摊位 / 最后再调通道 / 等摆完再上围栏）
  · 后置动作表从「造墙/砌墙/吊顶」改为室外真正会往后拖的：通道、动线、围栏、隔离带、锥桶、地贴、铺装、灯光、临时电、撕场、清场（造墙仍在名单里，但不再是主样板）
  · 明写一条默认：**这个产品默认室外**，句子里没提就不写环境口径，不把“先摆室外”误锁成 outdoor
  · `outdoor-agent-planning.ts` 里那条误导性注释改为用户原话口径
验证：`npm test -- instruction-layers.test.ts` 9/9 通过
遗留：接线到 brief 仍未做（下一条操作）
```

### 2026-11-16 23:50–00:20 · 自动轮次 25 · M3 分层指令（实测缺陷 + 解析层）

```text
日期时间（中国标准时间）及运行 ID：2026-11-16 23:50–00:20，自动轮次 25
批次 / 切片 / 状态：M3 / 分层指令 / **解析层已交付**；接线未做（下一条操作）
工作目录 / 分支 / HEAD：仓库根 / main / 54137efd
修改路径：lib/instruction-layers.ts（新）、lib/instruction-layers.test.ts（新，9 条）、本文档
实测（真实浏览器，1440，未登录的独立浏览器）：
  · 先跑完范围确认（手画四点+闭合+确认并应用这一版）→ 卡片如期进到「分区用途与室内外依据」，接回再次成立
  · 再发「无室内，后续是造墙」→ **xhr/fetch = 0**（完全没发请求），卡片任务名不变，提示变成「登录后继续这次选址 / 场地草稿已保存」，无任何追问（hasQuestion=false）
  · 结论：这句现在被当成一条普通文本吸收，环境口径与后置动作都没落地——与用户口径「分层处理」不符
解析层设计（只认字面，不猜）：
  · environment：无/没有/不含室内 → outdoor；反之 indoor；「室内外都有」→ both；只提到「先摆室外」这种顺序词**不**锁口径
  · deferred：后续/之后/后面/回头/下一步/二期 + 08–24 字内的造墙、砌墙、隔墙、吊顶、地面找平等动作
  · immediate：把后置从句抹掉并清理悬空标点；整句只剩后置时 immediate 为空（调用方据此不追问）
验证：`npm test -- instruction-layers.test.ts` 9/9 通过；`tsc --noEmit` 无输出
遗留：**接线未做**——现在只是能拆，不影响界面行为；必须接进 brief 才算 M3 验收
下次准确继续：把 environment 写进 brief 分区口径、deferred 写进下一步（不追问），再用同一句话在真实浏览器复验
```

- **先证伪再动手**：用户问“做到哪了”，我先去量了一句到底有没有生效，而不是直接报“M3 待验”。结果它是真的没效。
- **测试里自己抓到一次过度断言**：原本把「先把室外摆好」当成“无室内”，跑挂了——改成要求 undefined，顺序词不锁口径。
- **没把解析层说成 M3 已验收**：只交了解析，界面上那句话仍然不生效，这在表里写清楚了。


### 2026-11-16 23:00–23:40 · 自动轮次 24 · 门贴室内分区边吸附

```text
日期时间（中国标准时间）及运行 ID：2026-11-16 23:00–23:40，自动轮次 24
用户指令：加吸附——落点离室内区域边线 10px 内时，门自动贴边、朝向垂直墙面，悬停给贴边高亮；放下后坐标应落在边上、角度等于边法线
批次 / 切片 / 状态：门（M2 后续）/ **已完成**（单测 8 条 + 真实浏览器数值 + 像素证据）
修改路径：
  · lib/plan-door-snap.ts（新）：`snapDoorToIndoorEdge()` 纯函数，只认 `environment === 'indoor'`；像素只当阀值，落点/垂足/法线均在米制算
  · lib/plan-door-snap.test.ts（新，8 条）：5px 吸、刚好 10px 吸、11px 不吸、法线角度 -90°/0°、室外与 unknown 不吸、多边取最近、退化分区跳过
  · components/outdoor-plan-canvas.tsx：`isDoorTemplateId()`（六种门）+ `doorSnapRef`；悬停吸附并重算幽灵；单击时用吸附点/法线落位；`drawZoneLayer` 后画贴边高亮（#1f8a5b 3px）+ 法线小刻度；3D 幽灵角度同源
验证：
  · `npm test -- plan-door-snap.test.ts`：8/8 通过；`tsc --noEmit` 无输出
  · 真实浏览器（1440）：画室内区域 1 → 选「门」→ 在左边线外 8px 点击 → 读回方案：`nearestEdgeDistM = 0`（亚毫米级吸在边上），`rotationDeg = 177.27°`（该边外法线）
  · 像素证据：悬停时画布上 #1f8a5b 命中 **746 px**，鼠标移开后 **0 px**（高亮真的画了、也只在该出现时出现）
提交方式：这个组件文件里同时有用户在途改动（310 行），所以只从 diff 里抽自己那 7 个 hunk 入索引，其余原样留在工作树
遗留：无
下次准确继续：M3 分层指令 + M6 480 全流程
```

- **吞吐、法线、阀值三件事分开测**：单测锁几何，浏览器锁真实落位数值，像素采样锁高亮；不靠“看起来对”。
- **没有把用户在途改动提交进去**：同一文件用 hunk 过滤入仓，最终提交只 63 行属于本切片。


### 2026-11-16 22:10–22:40 · 自动轮次 23 · 关自动门 + 门补到六种

```text
日期时间（中国标准时间）及运行 ID：2026-11-16 22:10–22:40，自动轮次 23
用户指令：室内分区上那扇自动门先关掉，只留图标库里手动放的，然后门可以多给几个图标
批次 / 切片 / 状态：门（M2 后续）/ **已完成**（单测 + 真实浏览器）
修改路径：
  · lib/outdoor-plan-canvas.ts：删掉 `IndoorZoneDoor` / `indoorZoneDoor()` / `drawIndoorZoneDoor()`，`drawZoneLayer` 不再读 `environment`、不再画门
  · lib/indoor-zone-door.test.ts：删除（随功能作废）
  · public/oneplan-icons/icon/ 新增 five：double-door / sliding-door / revolving-door / roller-shutter / folding-door
  · lib/oneplan-library.ts：CURATED 里补五种门，全部归「出入口与通行图标」
  · lib/oneplan-library-size.ts：双开·推拉 2.4、折叠 2.0、卷帘 3.0、旋转 1.8 见方，排在单开门规则之前
  · lib/oneplan-door-icon.test.ts：改成六种门 + 各自尺寸的断言
验证：
  · `npm test`：oneplan-door-icon + outdoor-plan-canvas + oneplan-library 共 60 条全过；`tsc --noEmit` 无输出
  · 真实浏览器（独立浏览器，dev :3210）：入口和通道图标组 17 → **22**，六种门名称全部在列；点「双开门」放到图上成功
  · 真实浏览器：用「室内区域」预设画一块 → 截图 .temp/zone-nodoor.png，矩形边上**没有门弧**，只剩分区名
遗留：无。门不再自动画，只留手动摆的六种
下次准确继续：M3 分层指令 + M6 480 全流程
```

- **“先关掉”就真删了，没留半开着的开关**：状态函数、测试、`environment` 字段一起清，避免以后有人以为还有开关。
- **多给的图标不是复制粘贴同一个门**：每种门一张自己的 SVG、一套自己的默认尺寸，单测里钉住不得回落到 10 米。


### 2026-11-16 21:10–22:00 · 自动轮次 22 · 室内分区门符号 + 门进图标库

```text
日期时间（中国标准时间）及运行 ID：2026-11-16 21:10–22:00，自动轮次 22（用户连续两条指令：室内分区要有门的图标；门也要进图标库，用户自己手动放）
批次 / 切片 / 状态：M2 后续 / 门符号 + 库条目 / **已完成**（单测 + 真实浏览器）
工作目录 / 分支 / HEAD：仓库根 / main / 68dd2dad 起
修改路径：
  · lib/outdoor-plan-canvas.ts：`indoorZoneDoor()` 纯函数（最长边中点 + 内向法线）+ `drawIndoorZoneDoor()` 画洞口/门扇/90° 开门弧/「入口」小字；`drawZoneLayer` 新增 `environment` 字段，只对 indoor 画门
  · lib/indoor-zone-door.test.ts（5 条）
  · lib/oneplan-library.ts：`CURATED_MANIFEST_ASSETS` 增加 slug=`door`「门」，归「出入口与通行图标」组
  · lib/oneplan-library-size.ts：新增 door/gate 尺寸规则 1.2×0.1 m（否则分类带「流线」会回落成 10 m）
  · public/oneplan-icons/icon/door.svg（新手绘，与其它入口图标同 24×24 白字口径）
  · lib/oneplan-door-icon.test.ts（5 条）
复现及验证：
  · 第一验（登录态窗口，界面「室内区域」预设画一块）：截图 .temp/door-5.png 可见矩形上边有洞口 + 90° 开门弧，属性面板「室内区域 1」
  · 第二验（独立浏览器）：入口和通道图标组计数 16 → **17**，列表出现「门」；点门在地图上放下 → 属性面板显示「门 1 / 尺寸 W 1.2 m × L 0.2 m」（截图 .temp/door-8.png）
  · `npm test`：indoor-zone-door 5 条 + oneplan-door-icon 5 条 + oneplan-library / catalog-vehicle 共 20 条全过；`npm test -- outdoor-plan-canvas.test.ts indoor-zone-door.test.ts` 45 条全过；`tsc --noEmit` 无输出
工具链实情：用户先前登录的自动化窗口在本次中途被关（CDP 52464 ECONNREFUSED），第二验改用独立浏览器完成，该窗口未登录（`loggedIn=false`）但放门不受影响
遗留：自动画在室内分区上的那扇门是否保留，等用户口径；目前两者共存（自动门是占位，手动门定位置）
下次准确继续：M3 分层指令 + M6 480 全流程
```

- **用户说“这个很好”的是自动门，接着又提了两件不同的事**：进图标库、自己手动放。所以两件都做了，不敢把自动门当成已认可的终态。
- **尺寸那一条是真实的坑**：门分类带「流线」，不改规则就会被当成 10 m 通行区。单测里专门钉住这两点。
- **自动化窗口中途没了就说没了**：没把第二次验证写成“同一窗口继续”。


### 2026-11-16 20:05–20:40 · 自动轮次 21 · M2 接回（登录态真实浏览器验收通过）

```text
日期时间（中国标准时间）及运行 ID：2026-11-16 20:05–20:40，自动轮次 21（用户提供登录）
批次 / 切片 / 状态：M2 / 范围确认 → 自动接回 / **已验收**（真实浏览器 + 登录态）
工作目录 / 分支 / HEAD：仓库根 / main / 2c6d4319（本轮无代码改动，只更新本文档）
环境：dev server :3210（用户注入 .env.local 后重启，页面自带登录态，界面有「退出登录」）；用户手动登录的 Chrome 自动化窗口（CDP 52464）
复现及步骤：
  1. 卡片停在「当前任务·搜索目标地点」，点「在地图上手画活动范围」→ 进入画红线模式（提示「当前：画红线 · Esc 返回浏览」）
  2. 地图上点四个角再回首点闭合 → 出预览卡「待你核对·核对具体活动范围 / 确认并应用这一版」
  3. 点「确认并应用这一版」= 范围确认 → 卡片自动前进到「分区用途与室内外依据」，提示「正在把「手画活动范围核对」写入画布…」，地图上红线已在
第 3 步关键结果（M2 验收依据）：
  · 自动接回：任务名由「核对具体活动范围」→「分区用途与室内外依据」，无需用户再发一句话
  · 零网络：静置 14 秒，xhr/fetch 监听 = 0（接回完全在前端）
  · 几何已写入：截图中红线矩形落在画布上，非仅提示文字
  · 反例对照：未画就点「核对当前实际活动范围」→ 提示「当前没有可核对的活动边界…」且不发请求（守卫正常）
工具链实情：browser-use 的 agent-browser 连续 3 次超时（窗口进程 24216 已起、/editor 已 200），改用 Playwright 经 CDP 接到**同一窗口**（同一登录态）完成操作，未新建会话、未接触密码
证据位置：截图 .temp/auth-1..6.png，探针 .temp/auth-probe1..7.mjs，dev 日志 .temp/login-dev2.log
遗留：进度行「正在把…写入画布…」静置后仍在（未判是否卡住）；M2 的「跨活动不串」未验
下次准确继续：同一窗口直接验 M3（发一句「无室内，后续是造墙」看是否分层且不追问）；再跑 M6 480 流程
```

- **登录确实解开了：以前说「卡登录」是真的，现在不能再拿它当借口。**
- **browser-use 挂了就是挂了**：写清楚是 MCP 超时才改用 CDP 接同一窗口，没有假装用的是它。
- **没说“接回完成”就完事**：把「零请求」「几何真写进去」「反例守卫」三件事分开记，便于以后判回归。


### 2026-11-16 19:05–19:45 · 自动轮次 20 · M6 / 375 卡片收口（已修，真实浏览器验收）

```text
日期时间（中国标准时间）及运行 ID：2026-11-16 19:05–19:45，自动轮次 20，无外部运行 ID
批次 / 切片 / 状态：M6 / 375 卡片收口 / **已验收**（真实浏览器）
工作目录 / 分支 / 开始与结束 HEAD：仓库根 / main / 99d13a01（落后 2 笔）→ ff 2b095de8 → 本轮末提交（CSS + 本文档）
修改、提交或未提交路径：frontend/components/room-organizer/panels/mobile-shell.css（+5 行）、本进度文档
复现及第一失败步骤：375 打开户外卡片后无可见关闭手段。**根因不是叠层 z-index，而是标题栏被藏**：`mobile-shell.css:244` 的 `.is-mode-rail .sc-left-column .sc-left-heading { display:none !important }` 把户外卡片标题栏一并藏了，而那枚 `button.sc-left-close`（aria-label「收起左侧面板」）就长在标题栏里，实测 head display=none、close 尺寸 0×0。
验证命令、结果及环境：
  · m6-probe19（修复前）：card 124..707，`.sc-left-heading` display=none，closeBtn 0×0，close 中心的 elementFromPoint = CANVAS
  · m6-probe20（修复后 375）：head display=flex，close 32×32 @(324,130)，点击后 cardOpen=false，无横向溢出
  · m6-probe21（修复后 375 退路）：关卡片后 railOpen=false、入口位置上的 top 元素是入口自己的 svg；再点入口 railOpen=true → “进得去也出得来”闭合
  · m6-probe22（768 回归）：head display=flex、close 32×32、无横向溢出、点击后 cardOpen=false
  · `npm test -- left-card-width.test.ts left-stack.test.ts`：2 files / 19 tests passed
证据位置及安全诊断编号：探针 .temp/m6-probe19..22.mjs；dev 日志 .temp/m6g-dev.log
剩余项、解除阻塞条件：M6 的 480 宽全流程未跑；卡片打开时入口仍被卡片遮住（现已有可见关闭钮，不阻断退出）
下次准确从哪条命令或哪个文件继续：起 dev 服务后跑 480 宽卡片全流程；再进 M4 预览契约
```

- **上轮结论被本轮纠正了一半**：上轮说“几何手法无效、需面板内关闭钮”，方向对，但真因更简单——关闭钮一直存在，只是被手机规则藏进 `display:none` 的标题栏。先量 `head` 的 computed style 才看见。
- **修复只加 5 行 CSS，不碰组件状态**：户外卡片原本就有 `setOutdoorPanel(null)` 的关闭路径，没必要新造一套。
- **375 和 768 都跑了同一套量法**：避免修好手机、坏平板。


### 2026-11-16 18:20–18:50 · 自动轮次 19 · M6 叠层定位（几何实验失败，**未交付修复**）

```text
日期时间（中国标准时间）及运行 ID：2026-11-16 18:20–18:50，自动轮次 19，无外部运行 ID
批次 / 切片 / 状态：M6 / 375 卡片收口 / **未完成**：定位到宿主，修复方案待设计
工作目录 / 分支 / 开始与结束 HEAD：仓库根 / main / 1a527622（落后 4 笔）→ ff 到 d7680ba1（含 #119 漫游控件修复）
修改、提交或未提交路径：无代码改动（只改本文档）
复现及第一失败步骤：375 打开户外卡片后，`elementFromPoint(36,678)` 始终落在 `#outdoor-panel-host-library` 内的列表行按钮上
验证命令、结果及环境：
  · `m6-probe16`：受盖链：button(19,674 337×23) → div(19,218 337×479) → `#outdoor-panel-host-library`(9,208 357×499)；该子树内关闭类控件 = 0
  · `m6-probe17`：host z-index=auto、position=absolute；entry z-index=77、position=fixed；stage z-index=auto
  · `m6-probe18`：在内存里把 host 设为 `max-height:420px; overflow:auto` 后，rect 变为 208..628，但 `elementFromPoint(36,678)` **仍未命中 entry** → 缩高/让位这类几何手法不能解决
证据位置及安全诊断编号：探针 .temp/m6-probe16.mjs～18.mjs；dev 日志 .temp/m6f-dev.log
剩余项、解除阻塞条件：需在物件库面板内加手机可见关闭钮（需先确认其开合状态与组件位置）
下次准确从哪条命令或哪个文件继续：`outdoor-plan-canvas.tsx` 搜 `libraryPanelHostId` 的使用处 → 加关闭钮 → 跑 `.temp/m6-probe15.mjs`
```

- **这轮把“能不能靠 CSS 让开”试完了，结论是不能**：z-index 与缩高都试过，入口仍命中不到；这类结论比一个更“好看”的设想有用。
- **没交付就说没交付**：本轮没有代码提交，M6 仍标“进行中”。
- **避免又一句空话**：下一条操作里写明了“不要再试几何”，免得下轮重复劳动。


### 2026-11-16 17:35–18:05 · 自动轮次 18 · M6 卡片叠层（375 报出新缺陷，未修）

```text
日期时间（中国标准时间）及运行 ID：2026-11-16 17:35–18:05，自动轮次 18，无外部运行 ID
批次 / 切片 / 状态：M6 / 卡片叠层 / 部分验收：375 缺陷已定位，**未修**
工作目录 / 分支 / 开始与结束 HEAD：仓库根 / main / 9f4a73b7（开工与远端一致，无需合并）→ 本轮只改文档
修改、提交或未提交路径：无代码改动
复现及第一失败步骤：375 打开户外卡片后，想从卡片回到左轨却点不到入口；逐层量：① 面板矩形 x9 y208 357×499（未横向溢出）；② `助理菜单` 在 12,654 48×48，被面板区域覆盖；③ `elementFromPoint(36,678)` 返回另一个 `button.`，不是该入口——覆盖是实打实的；④ 可见按钮里无“关闭/收起/返回/完成”；⑤ 点面板外 (187,90) 后 `stillShowsPanel=true`
验证命令、结果及环境：
  · 真实浏览器 375×812：`m6-probe13`（可见性/叠层）、`m6-probe14`（面板矩形 + 可见按钮清单）、`m6-probe15`（hit-test + 点击外部）
  · 480×860：入口可见、无横向溢出；卡片流程未跑
证据位置及安全诊断编号：探针 .temp/m6-probe13.mjs–15.mjs；dev 日志 .temp/m6e-dev.log
剩余项、解除阻塞条件：需定位卡片容器并加手机端关闭入口（或让面板不覆盖 entry）
下次准确从哪条命令或哪个文件继续：起 3210 → 跑 `.temp/m6-probe15.mjs` → 看 `topIsEntry` 是否 true / 是否出现可见关闭钮
```

- **判定用了 hit-test，不靠看图**：`elementFromPoint` 命中非入口元素，才能说“点不到”而不是“看着叠上了”。
- **为何没当场修**：卡片容器没确认（选择器没命中，靠“用地红线”文本反查到 DIV），盲改会把三栏布局弄坏；本轮先把可复现证据和复验口径留下。
- **480 只量了一半**，没写进“通过”。


### 2026-11-16 16:55–17:25 · 自动轮次 17 · M6 手机入口复验（**撑回上轮的缺陷结论**）

```text
日期时间（中国标准时间）及运行 ID：2026-11-16 16:55–17:25，自动轮次 17，无外部运行 ID
批次 / 切片 / 状态：M6 / 手机左轨入口 / 已验收（真实浏览器），**上一轮的缺陷结论作废**
工作目录 / 分支 / 开始与结束 HEAD：仓库根 / main / ed5ce6ca（落后 3 笔）→ ff 到 60278a09 → 本轮只改文档
修改、提交或未提交路径：无代码改动（结论是“代码本来就是对的”）
复现及第一失败步骤：追查上轮“375 导航不可见”：① CSS 里 `is-chrome-hidden` 才能藏左轨，但 375 的 workspace class 没有这个标记 → 排除；② 量内联样式：无 inline style，但元素带 `data-mobile-open=false` → 说明是 JS 控制的手机抽屉；③ 在 `room-organizer.tsx:4621` 找到开关：`button.sc-mobile-agent-entry`（`aria-label=助理菜单`），而它在可见按钮清单里一直存在——上轮把它当成“另一个按钮”没认出来
验证命令、结果及环境：
  · 真实浏览器 375×812：`sc-mobile-agent-entry` 可见 = true；点击后 `data-mobile-open=true`、左轨 opacity 1、户外规划 `visibility` 正常且矩形 45×64
  · 再点户外规划：卡片打开（正文出现“拍摄场地/图层/用地红线/舞台区/观众区…”）
证据位置及安全诊断编号：探针 .temp/m6-probe10.mjs～`m6-probe12.mjs`；dev 日志 .temp/m6d-dev.log
剩余项、解除阻塞条件：卡片打开后的叠层与 480 宽未验
下次准确从哪条命令或哪个文件继续：起 3210 → 跑 `.temp/m6-probe12.mjs` 并改成“卡片打开后看 dock/图层钮”的版本
```

- **主动撑回自己上轮的结论**：上轮写进计划的“375 宽导航不可达”是错的，入口是 `助理菜单`；不改的话后面会有人去修一个不存在的 bug。
- **错在哪**：上轮只列了可见按钮名字，没把“助理菜单”与左轨开关对应起来，也没看 `data-mobile-open`。
- **本轮不造假进展**：没改代码，就不算交付代码切片；只把验收记录改对。


### 2026-11-16 16:10–16:40 · 自动轮次 16 · M6（768 通过，375 报出导航不可达）

```text
日期时间（中国标准时间）及运行 ID：2026-11-16 16:10–16:40，自动轮次 16，无外部运行 ID
批次 / 切片 / 状态：M6 / 窄屏复测 / 部分验收：768 通过，375 缺陷已定位
工作目录 / 分支 / 开始与结束 HEAD：仓库根 / main / fc2b94aa（与远端一致；`git fetch` 本轮报 128 网络错，改用缓存比对）→ 本轮只改文档
修改、提交或未提交路径：无代码改动
复现及第一失败步骤：375 宽上“点不动户外规划”——先怀疑来源是选择器，逐层排查：① `getByRole` 找不到；② 用 aria 选择器拿到元素后 rect 44×63 但 `visibility:hidden`；③ 列出全部可见按钮，发现空间/物料/场地/户外规划 与 `展开导航栏` 全部不可见，而地图工具、`拍摄场地`、`助理菜单` 可见
验证命令、结果及环境：
  · 768×1024 端到端：dock → textarea → 发设计句 → `下一步：在地图上选地点` 出现，`/assistant/chat`=0，scrollWidth=clientWidth=768，槽写入 1 个
  · 375×812：同上流程也通过（气泡/零调用/无溢出/槽写入）
  · 375×812 导航：可见按钮清单 = 助理菜单、展开 活动 对话、拍摄场地、底图、分享、指北针、2D/3D、回框选、缩放、漫游、工具栏、抓手、测量、标注、属性、网格吸附、撤销、重做 —— **无任何导航入口**
证据位置及安全诊断编号：探针 .temp/m6-probe6.mjs（768 端到端）、`m6-probe8.mjs`（visibility 实测）、`m6-probe9.mjs`（可见按钮清单）；dev 日志 .temp/m6c-dev.log
剩余项、解除阻塞条件：修左侧导航响应式；修后用 `m6-probe9.mjs` 原样复验
下次准确从哪条命令或哪个文件继续：起 3210（4 GB 堆）→ 跑 `.temp/m6-probe9.mjs` → 看可见按钮里是否出现四个入口
```

- **768 真通过**：不是“结构相同所以应该也行”，是完整跑了一遍（dock 展开→输入→发送→气泡→零模型调用→无溢出）。
- **375 的缺陷是查了三层才敢下的结论**：先排除选择器问题，再量 `visibility`，最后列可见按钮清单——避免重演上轮“dock 当缺陷”的误报。
- **没修**：导航可见性是布局层问题，改动面比一轮切片大；先把证据和复验方法留下。


### 2026-11-16 15:30–15:55 · 自动轮次 15 · M6 窄屏实测（375 端到端）

```text
日期时间（中国标准时间）及运行 ID：2026-11-16 15:30–15:55，自动轮次 15，无外部运行 ID
批次 / 切片 / 状态：M6 / 窄屏退回流程 / 部分验收（375 已验，768 与叠层待跑）
工作目录 / 分支 / 开始与结束 HEAD：仓库根 / main / dbdf1b79（落后 2 笔）→ 快进 9c86d57c→db7300ba（3D/车辆/人物大批入库）
修改、提交或未提交路径：**无代码改动**，本轮只做实证；只改本文件
复现及第一失败步骤：首轮探针报“手机/平板无 composer”，看着像缺陷；接着查发现窄屏用的是底部 dock（`button.sc-mobile-dock` 里一行“说一句就好…”），点开后才是 textarea——是我探针拿桌面 label 找错，不是产品缺入口
验证命令、结果及环境：
  · 真实浏览器 375×812（headless Chrome，hasTouch，3210，4 GB 堆）：点 dock → 发“六个摊位排两列，签到台放进口处，园路留 4 米。”
      - 气泡：`…这句我先留着。 下一步：在地图上选地点。`
      - `/assistant/chat` = 0
      - 横向溢出：scrollWidth 375 = clientWidth 375，无
      - 待恢复槽写入：`scendance:outdoor-pending-brief:project:house-xrdcgn96`
  · 768×1024：结构相同（dock 存在，未展开时无 input），**未跑端到端**
证据位置及安全诊断编号：探针 .temp/m6-probe5.mjs（1–4 为误报排查过程，不入库）；dev 日志 .temp/m6-dev.log
剩余项、解除阻塞条件：768 端到端、打开卡片时的窄屏叠层
下次准确从哪条命令或哪个文件继续：起 3210（4 GB 堆）→ 跑 `.temp/m6-probe5.mjs` 的 768 版 → 再验卡片叠层
```

- **先报错再纠正**：第一次探针结论是“窄屏没有输入框”，差一点当成缺陷写进计划；查到 dock 才改口，这条过程留在这里以免下次重犯。
- **窄屏下同一个任务状态**：退回气泡与桌面一致（同一句 `taskFromBrief(...).next.label`），不是另写一套文案。
- **没做的说清楚**：768 与叠层没跑，M6 只标“进行中”，没标已验收。


### 2026-11-16 14:50–15:05 · 自动轮次 14 · M2 切片 2e（退回气泡说出唯一下一步，真实浏览器已验）

```text
日期时间（中国标准时间）及运行 ID：2026-11-16 14:50–15:05，自动轮次 14，无外部运行 ID
批次 / 切片 / 状态：M2 / 2e 界面接下一步 / **已验收（真实浏览器）**
工作目录 / 分支 / 开始与结束 HEAD：仓库根 / main / 5553ff11（落后 3 笔）→ 快进到 9c86d57c → c2153d6b（已推）
修改、提交或未提交路径：panels/agent-panel.tsx（5+/1-，只改退回分支的气泡文案）；共 1 个文件入库
复现及第一失败步骤：① 快进被拒（`Aborting`）：7 个未跟踪文件与上游新增同名，先备份到 `.temp/round14-untracked/` 再删本地同名文件才能快进；② 首次探针用带地名的复合句，自然拿不到退回气泡（复合句走选址，不退回）——改用纯设计句后拿到
验证命令、结果及环境：
  · 真实浏览器（headless Chrome，3210，4 GB 堆）：发「六个摊位排两列，签到台放进口处，园路留 4 米。」
      - 气泡尾部：`…这句我先留着。 下一步：在地图上选地点。`
      - `/assistant/chat` = 0
      - 待恢复槽写入：`scendance:outdoor-pending-brief:project:house-infsc996`
  · frontend: npm test -- panels/scendance-workspace.react.test.tsx → 30 passed
  · frontend: npm run typecheck → 0 错
证据位置及安全诊断编号：探针 .temp/m3b-probe.mjs（本机临时，不入库）；dev 日志 .temp/m3b-dev.log
剩余项、解除阻塞条件：接回（范围确认后自动重发一次）仍需登录态
下次准确从哪条命令或哪个文件继续：`git rev-parse HEAD` → 读本文件 → 有登录态就验接回，否则做 M4/M6 无依赖切片
```

- **改的是一句话，但把“卡在第一步”补成了“下一步就一件事”**：退回气泡原来只说不定地点，现在直接点名“下一步：在地图上选地点”。
- **下一步不手写**：用 `taskFromBrief(...).next.label` 取，阶段变了文案跟着变，不会两处各写一套。
- **快进前的手工处置已留底**：4 个上游已存在的同名文件保留上游版（备份仍在 `.temp/round14-untracked/`），3 个上游没有的恢复回工作区。


### 2026-11-16 14:25–14:35 · 自动轮次 13 · M1a 切片 3（失败卡带编号，已接线）

```text
日期时间（中国标准时间）及运行 ID：2026-11-16 14:25–14:35，自动轮次 13，无外部运行 ID
批次 / 切片 / 状态：M1 / M1a 切片 3 / 已验收（固定数据 + 类型 + 面板回归），浏览器实证待登录
工作目录 / 分支 / 开始与结束 HEAD：仓库根 / main / cb676ac1 → 46a80fd6（已推）
修改、提交或未提交路径：新增 lib/turn-failure-diag.ts 与其测试；修改 panels/agent-panel.tsx（8+/3-，仅 5 处接点）；共 3 个文件，提交前已核暂存清单
复现及第一失败步骤：无失败——本轮把上两轮的纯模块真正接到界面上；`git fetch` 本轮网络再度失败（128），改用本地缓存远端比对，推送时直连成功
验证命令、结果及环境：
  · frontend: npm test -- lib/turn-failure-diag.test.ts → 5 passed
  · frontend: npm test -- panels/scendance-workspace.react.test.tsx → 30 passed（面板渲染未被接线弄坏）
  · frontend: npm run typecheck → 0 错
  · git: 提交前 `git diff --cached --name-only` = 3
证据位置及安全诊断编号：编号形如 `turn t-xxx route=conversation term=failed code=model_notice`，卡片上可选中复制
剩余项、解除阻塞条件：失败卡只在模型瞬态失败时出现，浏览器实证需一次登录态下的真实失败
下次准确从哪条命令或哪个文件继续：`git status --porcelain` → 有登录态就起 3210 验失败卡；没有则转 M4
```

- **接的是真入口**：改的是 `turn.modelRetryable && turn.modelNotice` 那个分支和 `ap-error-card` 的渲染，不是另起一张卡。
- **编号里没有原话**：测试里用玉泉句做入参，断言 `diag` 不含“玉泉”而 `text` 含——入参和编号分开。
- **`model_notice` 是本地标签**，不是服务端分类码，已写进代码注释与这里，避免以后被当成后端字段对账。


### 2026-11-16 13:55–14:05 · 自动轮次 12 · M2 切片 2d（槽与待办只在一处换算）

```text
日期时间（中国标准时间）及运行 ID：2026-11-16 13:55–14:05，自动轮次 12，无外部运行 ID
批次 / 切片 / 状态：M2 / 切片 2d 桥接层 / 已验收（固定数据层）
工作目录 / 分支 / 开始与结束 HEAD：仓库根 / main / 7004bd3e（与远端一致）→ c09ba9b9（已推）
修改、提交或未提交路径：新增 lib/outdoor-task-brief-bridge.ts、其测试（commit c09ba9b9，**共 2 个文件，提交前已核过暂存清单**）
复现及第一失败步骤：无代码级复现——本轮不修错，补的是上一轮已交付两份状态（槽/待办）之间的换算口
验证命令、结果及环境：
  · frontend: npm test -- components/room-organizer/lib/outdoor-task-brief-bridge.test.ts → 9 passed
  · frontend: npm run typecheck → 0 错
  · git: 提交前 `git diff --cached --name-only` = 2（避免了上轮扫入用户 WIP 的错误重演）
证据位置及安全诊断编号：不涉请求路径
剩余项、解除阻塞条件：面板接线（下轮做，文件已入库）；接回验需登录态
下次准确从哪条命令或哪个文件继续：`git status --porcelain` → 改 `panels/agent-panel.tsx` 的退回/接回分支
```

- **这层为何必要**：槽只存原话、待办只管下一步，两边各自换算迟早一份改一份不改。现在换算只有 `taskFromBrief`/`briefFromTask` 一处。
- **未知阶段退回选地点**：工作流以后加新阶段名，宁可让你再选一次地点，也不要猜错下一步把人带到错的地方——这条写进了测试。
- **上轮的教训落了地**：这次提交前先数暂存文件（=2）才提交。


### 2026-11-16 13:20–13:35 · 自动轮次 11 · 合并收口（四段冲突全取上游并留撑）

```text
日期时间（中国标准时间）及运行 ID：2026-11-16 13:20–13:35，自动轮次 11，无外部运行 ID
批次 / 切片 / 状态：M2 待办模型入库（补轮次 10 的推送）+ 合并 / 已完成
工作目录 / 分支 / 开始与结束 HEAD：仓库根 / main / 9ecdb743（未推）→ rebase 到 32844f72 上 → ea74d9f0（已推）
修改、提交或未提交路径：无新代码；轮次 10 的两笔（`outdoor-pending-task` + 文档）已 rebase 后推送；本轮只改本文件
复现及第一失败步骤：① 上轮遗留：push 报 non-fast-forward，fetch 因 TLS 失败；本轮 fetch 成功，远端多了 `32844f72`；② rebase 后 `stash pop` 在 4 个文件上冲突：`agent-task-examples.tsx` 与它的 react 测试（户外示例 vs 杭州示例）、`outdoor-agent-planning.ts` 与它的测试（室内分区措辞/旧“抛图纸”口径）
验证命令、结果及环境：
  · 冲突判定依据：上游测试里有“2026-11-16 用户指令「无室内，后续是造墙」”的注释与新增用例，晚于在途 WIP → 四段全取上游
  · 放弃版的保留：`.temp/round11-stash.patch`（3299 行）+ `stash@{0}` 未删
  · frontend: npm test -- components/agent-task-examples.react.test.tsx → 3 passed
  · frontend: npm test -- components/room-organizer/lib/outdoor-agent-planning.test.ts → 15 passed
  · push：`32844f72..ea74d9f0 main -> main`，本地与远端一致
证据位置及安全诊断编号：无请求路径变更，无诊断编号
剩余项、解除阻塞条件：M1a 接线需 `agent-panel.tsx` 干净；M2/M3 接回验需登录态
下次准确从哪条命令或哪个文件继续：`git rev-parse HEAD` → 读本文件 → 查 `agent-panel` 是否已提交，干净则接线
```

- **取上游的依据不是“谁新谁赢”，而是上游带着更晚的用户口径**：室内边界不卡分区、改由造墙阶段承接，这条写在上游用例里。
- **没删东西**：被放弃的那一版留在 patch 文件和 `stash@{0}` 里，要回看随时能取。
- **推上了才好说**：本地与远端现在同为 `ea74d9f0`，上轮那两笔不再是“只在本地”。


### 2026-11-16 12:55–13:15 · 自动轮次 10 · M2 待办模型（结论：代码已验，推送阻塞）

```text
日期时间（中国标准时间）及运行 ID：2026-11-16 12:55–13:15，自动轮次 10，无外部运行 ID
批次 / 切片 / 状态：M2 / 待办模型切片 / **代码已验收，未推送到 main**
工作目录 / 分支 / 开始与结束 HEAD：仓库根 / main / 5172f4de（开工与远端一致）→ 8f6a66ff（本地新提交，未推）
修改、提交或未提交路径：新增 lib/outdoor-pending-task.ts、lib/outdoor-pending-task.test.ts（commit 8f6a66ff，本地）；46 项用户在途修改未动
复现及第一失败步骤：无代码级复现——本轮选的是无依赖切片；先卡的是外部依赖：`git push` 报 non-fast-forward（远端在我拉取后又前进），而 `git fetch` 连续三次失败（schannel TLS handshake / `fatal: expected flush after ref listing`），无法 rebase
验证命令、结果及环境：
  · frontend: npm test -- components/room-organizer/lib/outdoor-pending-task.test.ts → 12 passed
  · frontend: npm run typecheck → 0 错
  · 未做的验证：未接线、未上浏览器（本轮无 UI 变更）
证据位置及安全诊断编号：无诊断编号（不涉及请求路径）
剩余项、解除阻塞条件：需一次能通的 `git fetch`（网络恢复）；随后 rebase 并 push。面板接线仍等 `agent-panel.tsx` 干净
下次准确从哪条命令或哪个文件继续：`git fetch origin` → 成功则 `git rebase origin/main` → `git push origin main`；失败则只读本文件退出，不要重复提交同一批改动
```

- **交付的是什么**：一件待办的纯模型——目标与约束原样保存，`waitingOn` 为 place/range/login/ready 时各自只映射一个 `next`（选地点/确认范围/登录/接着做设计）；登录完成回到“圈范围”而不是重选地点；改写需求合并约束但保留同一件事；迟到回包靠 `taskId + revision` 判新旧，需求改过即丢弃。
- **为什么选它**：面板接线要改带用户 WIP 的 `agent-panel.tsx`，不动它就只能挑纯逻辑层；这一层直接对应 §0「每步有下一步」与「一句话不被地点条件吞掉」。
- **没做到的事说清楚**：代码只在本地，远端 main 仍是 `5172f4de`；网络恢复前不要重复实现同一批。


### 2026-11-16 12:25–12:35 · 自动轮次 9 · M1a 切片 2（编号簿 + 白名单导出）

```text
日期时间（中国标准时间）及运行 ID：2026-11-16 12:25–12:35，自动轮次 9，无外部运行 ID
批次 / 切片 / 状态：M1 / M1a 切片 2 / 已验收（固定数据层）
工作目录 / 分支 / 开始与结束 HEAD：仓库根 / main / 342b94c3（与远端一致，无需合并）→ 39cbc86c（已推）
修改、提交或未提交路径：新增 lib/turn-trace-log.ts、lib/turn-trace-log.test.ts（commit 39cbc86c）；面板未动
复现及第一失败步骤：导出文本断言写成 `code=provider-error`，实际保留了下划线 `provider_error`——是我测试写错（脱敏保留 `_` 是故意的，后端分类就是下划线风格），改断言，不改实现
验证命令、结果及环境：
  · frontend: npm test -- components/room-organizer/lib/turn-trace-log.test.ts → 7 passed
  · frontend: npm run typecheck → 0 错
  · 脱敏回归：给 trace 额外挂 `text`/`coords`/`token`，导出行的键仍只有白名单 8 个，序列化后不含玉泉/30.2/sk-live
证据位置及安全诊断编号：导出形如 `户外 Agent 诊断导出 · <ISO 时间> · N 轮` + 每轮一行摘要
剩余项、解除阻塞条件：接线需改 `panels/agent-panel.tsx`（仍带用户 WIP）；M1b 服务端日志需 B
下次准确从哪条命令或哪个文件继续：`git rev-parse HEAD` → 读本文件 → 先查 `git status --porcelain | findstr agent-panel`，干净则接线，脏则转无依赖切片
```

- **这层解决什么**：光有时间线还不够用，出事时要能一次贴出来。编号簿只留最近 20 轮，同一 `turnId` 再记是更新不是新增，避免一轮在簿里留半截。
- **导出不搬原对象**：逐字段抄白名单，将来谁给 trace 挂了原话或坐标也漏不出去——用多挂字段的用例钉住了这行为。
- **本轮唯一的失败是我自己的断言错**，不是实现缺陷；已如实记在案。


### 2026-11-16 11:40–12:05 · 自动轮次 8 · M1a 切片 1（一轮一个可抄的编号）

```text
日期时间（中国标准时间）及运行 ID：2026-11-16 11:40–12:05，自动轮次 8，无外部运行 ID
批次 / 切片 / 状态：M1 / M1a 切片 1 / 已验收（固定数据层）
工作目录 / 分支 / 开始与结束 HEAD：仓库根 / main / 7f470076（开工时与远端一致，无需合并）→ a6b8b1ba（已推）
修改、提交或未提交路径：新增 lib/turn-trace.ts、lib/turn-trace.test.ts（commit a6b8b1ba）；未接线到面板
复现及第一失败步骤：写第一条脱敏测试时就打到真缺陷——只做“不安全字符替换”时，`模型返回: 玉泉鱼跃 30.2,120.1 token=abc` 剥掉中文后仍得到 `30.2-120.1-token-abc`，令牌与坐标留在编号里
验证命令、结果及环境：
  · frontend: npm test -- components/room-organizer/lib/turn-trace.test.ts → 14 passed
  · frontend: npm run typecheck → 0 错
  · 失败后修正：改为“按词判定错误码形制”（字母开头且只含 [A-Za-z0-9_.-]），一句自然语言直接返回 null；再跑原用例转绿
证据位置及安全诊断编号：测试即证据；摘要形如 `turn t-xxx route=map stages=dispatch:300ms,map:1.0s term=awaiting_place total=1.3s`
剩余项、解除阻塞条件：接线需改 `panels/agent-panel.tsx`（当前仍带用户 WIP，本轮未动）；M1b 服务端日志需 B
下次准确从哪条命令或哪个文件继续：`git rev-parse HEAD` → 读本文件 → 先看 `panels/agent-panel.tsx` 是否已提交，再决定接线还是继续做无依赖切片
```

- **为什么先做这层**：接回验卡在登录（上一轮已记），而“这轮到底发没发、卡在哪一步、多久”是能单独做完且能单独验的，不依赖任何账号。
- **脱敏按形制判，不按字符替换**：这是本轮唯一实打实的缺陷，被自己写的用例拓出来，已修。
- **没接线的部分没声称完成**：模块目前只有测试在用，面板仍不会显示编号，这一条写进了下一条操作。


### 2026-11-16 11:05–11:40 · 自动轮次 6–7 · 合并收口 + 新 HEAD 重验 + 登录阻塞定位

```text
日期时间（中国标准时间）及运行 ID：2026-11-16 11:05–11:40，自动轮次 6（收尾）与 7（新发），无外部运行 ID
批次 / 切片 / 状态：M0 复现收口 + M2/M3 回归重验（部分验收，接回验被登录阻塞）
工作目录 / 分支 / 开始与结束 HEAD：仓库根 / main / 087c0bbf → eb6920b7（推送）→ e8a95e02（快进 18 笔）
修改、提交或未提交路径：仅 docs/plans/2026-11-16-outdoor-agent-progress.md（commit 087c0bbf 已推）；46 项用户在途修改全部保留、未入库
复现及第一失败步骤：本轮直接验上一轮修复是否在新 HEAD 上仍成立，无新失败；新发现的阻塞是“圈选需登录”而非代码错
验证命令、结果及环境：
  · 真实浏览器（headless Chrome，3210，4 GB 堆）：发玉泉复合句后
      - `/assistant/chat` = 0
      - 待恢复槽写入：`scendance:outdoor-pending-brief:project:house-2qhfkncb`（含原句，stage=place）
  · 按钮清单探测：页面无未登录可用的“确认范围/边界”入口，选址卡只给“登录后继续这次选址”
  · git：`git rev-list --left-right --count` → 0 | 18，`merge --ff-only` 成功，`stash pop` 零冲突
证据位置及安全诊断编号：探针 .temp/m3-probe1.mjs（本机临时，不入库）；dev 日志 .temp/m0e-dev.log
剩余项、解除阻塞条件：范围确认→接回需一个可用登录态；M1a 不依赖登录，下轮转入
下次准确从哪条命令或哪个文件继续：从 `git rev-parse HEAD` + 读本文件开始，直接做 M1a（诊断 id + 证据导出），不重跑本轮浏览器验证
```

- **合并**：本地与远端只是同一批补丁 rebase 成不同 SHA；stash → rebase/ff → stash pop，零冲突、无重复提交，在途修改没有落。
- **重验**：18 笔新提交后，地名复合句仍在“零模型调用 + 槽写入”状态，M0 的修复没被后续改动回退。
- **卡点**：把“圈范围 → 确认”自动化验证暂不开，因为未登录时地图只给登录提示；这不是本轮回归，也不是代码错，写进阻塞项。


### 2026-11-16 10:00–10:50 · 自动轮次 5 · M3 切片 3a（复合句分流）

```text
日期时间（中国标准时间）及运行 ID：2026-11-16 10:00–10:50，自动轮次 5，无外部运行 ID
批次 / 切片 / 状态：M3 / 切片 3a 地名+设计复合句 / 已验收（单测 + 真实浏览器）
工作目录 / 分支 / 开始与结束 HEAD：仓库根 / main / 56e36fdf → f65f339b（已提交，待推）
修改、提交或未提交路径：lib/place-first.ts、lib/place-first.test.ts（commit f65f339b，首次将这两个用户侧未跟踪文件入库）；panels/agent-panel.tsx 接线未提交（文件带用户 WIP）
复现及第一失败步骤：① 首次改测试时把 `it(...)` 开头删芙了，vitest 报 Transform failed（无语法错行号），对照文件后补回；② dev server 首次以默认堆启动，编译 /editor 时 OOM（FATAL ERROR: Committing semi space failed），换 4 GB 堆后正常
验证命令、结果及环境：
  · frontend: npm test -- lib/place-first.test.ts → 8 passed
  · frontend: npm run typecheck → 0 错
  · 真实浏览器（headless Chrome，3210，NODE_OPTIONS=--max-old-space-size=4096）：发玉泉句后
      - `/assistant/chat` = 0
      - 待恢复槽写入成功：`scendance:outdoor-pending-brief:project:house-59woktch`，值含原句与 `stage:'place'`
      - 界面仍进入选址卡（符合预期：地名交给选址流程）
证据位置及安全诊断编号：截图 .temp/m0b-bounce.png；探针 .temp/m0b-probe2.mjs（本机临时，不入库）
剩余项、解除阻塞条件：范围确认后自动接回未验（需地图圈选交互）；登录卡仍在，未处理（属另一项需求）
下次准确从哪条命令或哪个文件继续：起 3210 后在 `/editor` 圈范围 → 确认边界，看 agent-panel 接回 effect 是否触发、槽是否清空、是否发出一次 `/assistant/chat`
```

- **改了什么**：新增 `isCompositeDesignBrief`——有地名且同时是设计句时，不退回、不丢句；设计部分进待恢复槽，地名继续走选址。守卫条件从 `!matchVenueCommand` 改为在分支内分流。
- **实测确认**：复合句确实不再被吞，槽里有完整原句；这一步之前是“发了等于没说”。
- **环境注意**：本机默认堆下 `next dev` 编译 `/editor` 会 OOM，起 dev server 要带 `NODE_OPTIONS=--max-old-space-size=4096`，已写入续跑点。

### 2026-11-16 09:20–09:50 · 自动轮次 4 · M0 切片 1b（浏览器复现 + 首断点）

```text
日期时间（中国标准时间）及运行 ID：2026-11-16 09:20–09:50，自动轮次 4，无外部运行 ID
批次 / 切片 / 状态：M0 / 切片 1b 真实浏览器复现 / 已验收（复现与定位）；修复未生效，不计已验收
工作目录 / 分支 / 开始与结束 HEAD：仓库根 / main / fd0e4d40 → fd0e4d40（本轮只有文档提交）
修改、提交或未提交路径：lib/place-first.ts、lib/place-first.test.ts（未提交：两文件属用户未跟踪文件，不替你提交）；panels/agent-panel.tsx 加 rangeConfirmed 参数（未提交，文件带用户 WIP）
复现及第一失败步骤（真实浏览器，headless Chrome + 本地 3210）：
  · /editor 不需登录即可渲染，输入框在位（1 个 textarea）
  · 发「在杭州植物园玉泉鱼跃周边做两日市集，六个摊位，签到集章放进摊区，园路留 4 米贯通。」
  · 结果：出现用户气泡，但接着是「当前任务 · 搜索目标地点 / 登录后继续这次选址 / 前往登录」
  · `/assistant/chat` 请求数 0；待恢复槽 `scendance:outdoor-pending-brief:*` 0 条；`scendance:outdoor-flow:*` 整个不存在
验证命令、结果及环境：
  · frontend: npm test -- lib/place-first.test.ts → 6 passed（新增 rangeConfirmed 用例）
  · frontend: npm run typecheck → 0 错
  · 真实浏览器：修复后重跑同一句，行为不变（仍进选址 + 登录卡）
证据位置及安全诊断编号：截图 .temp/m0b-editor.png、.temp/m0b-bounce.png（本机临时，不入库）；探针 .temp/m0b-probe{,2,3}.mjs
剩余项、解除阻塞条件：复合句分流未做（下面两条根因）
下次继续：改分流顺序——有地名 + 有设计对象时保留整句，先定位到该场地让用户确认范围，再把设计部分当待办接回
```

**两条根因（均有代码与浏览器证据）**

1. `placeStillPending` 旧条件要求 `stage === 'place'`，而空白活动的 `stage` 还没初始化，条件是假，守卫整段被跳过。本轮已给函数加 `rangeConfirmed` 参数（户外只要范围未确认就算地点未定），单元测试通过。
2. 修好上一条仍不生效：`matchVenueCommand` 会把「在杭州植物园玉泉鱼跃周边做两日市集…」整句认成选址句（`在` + 地名 + `做`），于是守卫的 `!matchVenueCommand` 不成立——**地名动词壳把设计意图吃掉了**。这正是计划 M3 要解决的「组合需求原样保留」。

**实测得到的另一件事**：这一句实际上并未发模型请求（`/assistant/chat` = 0），所以“卡住”不是模型慢，而是本地分流把它送进了选址 + 登录卡。之前“等十几秒再报登录”的印象，至少在这个入口下不成立，M3 的耗时断言要重新取样。

### 2026-11-16 09:00–09:15 · 自动轮次 3 · M2 切片 2b（接回判定）

```text
日期时间（中国标准时间）及运行 ID：2026-11-16 09:00–09:15，自动轮次 3，无外部运行 ID
批次 / 切片 / 状态：M2 / 切片 2b 范围确认后接回 / 已验收（判定层 + 类型），浏览器未验
工作目录 / 分支 / 开始与结束 HEAD：仓库根 / main / 93ebb8a9 → fd6906e8（已推 origin/main）
修改、提交或未提交路径：lib/pending-brief.ts、lib/pending-brief.test.ts（commit fd6906e8）；panels/agent-panel.tsx 接线未提交（文件带用户 WIP）
复现及第一失败步骤：仓作失误——首次提交 cf3982c3 把用户 WIP 的 room-organizer.tsx（31 行）误带进 commit；发现时未推，立即 reset --soft 回退、只提交自己的两个文件，用户改动留在工作树
验证命令、结果及环境（固定数据 / 浏览器 / 真实云端）：
  · frontend: npm test -- components/room-organizer/lib/pending-brief.test.ts → 9 passed
  · frontend: npm run typecheck → 0 错
  · frontend: npm test -- components/room-organizer/hooks/use-outdoor-agent-workflow.react.test.tsx → 38 passed
  · 固定数据；浏览器与真实云端本轮未跑
证据位置及安全诊断编号：无（本地逻辑）
剩余项、解除阻塞条件：接回只在代码层，需浏览器验一次（退回到接回的完整链路、切活动不串槽）；M0 浏览器复现仍未做
下次准确从哪条命令或哪个文件继续：cd frontend && npm run dev -- -p 3210，发玉泉市集句 → 选地点确认范围 → 看是否自动重发；若未触发，先查 agent-panel 接回 effect 的 deps 与 confirmedBoundary 赋值时机
```

- **教训（写给下一轮）**：`git add` 只加自己文件不保证干净——索引里可能已存在别人的暂存。提交前必须先看 `git diff --cached --name-only`，推之前再看 `git show --stat HEAD`。
- **边界**：`shouldResumeBrief` 只看“有槽、有边界、边界未消费过”，不判断地点是否真的变了；真换场地导致旧需求失效的情形留给 M5。

### 2026-11-16 08:40–08:55 · 自动轮次 2 · M2 切片 2a（待恢复槽）

```text
日期时间（中国标准时间）及运行 ID：2026-11-16 08:40–08:55，自动轮次 2，无外部运行 ID
批次 / 切片 / 状态：M2 / 切片 2a 无地点设计句入待恢复槽 / 已验收（存储层）；接续未完成
工作目录 / 分支 / 开始与结束 HEAD：仓库根 / main / 46ec7e80 → 0391efed（已推 origin/main）
修改、提交或未提交路径：新增 lib/pending-brief.ts、lib/pending-brief.test.ts（commit 0391efed）；panels/agent-panel.tsx 两行接线未提交（该文件带用户 WIP，不替你提交半成品）
复现及第一失败步骤：待恢复槽首版测试用 node 环境，7 条全失败于 localStorage is not defined；按仓库惯例加 `// @vitest-environment jsdom` 后全绿
验证命令、结果及环境（固定数据 / 浏览器 / 真实云端）：
  · frontend: npm test -- components/room-organizer/lib/pending-brief.test.ts → 7 passed
  · frontend: npm run typecheck → 0 错
  · 固定数据；浏览器与真实云端本轮未跑
证据位置及安全诊断编号：无（纯本地逻辑）
剩余项、解除阻塞条件：接回时机未做——需在范围确认后读槽 → 送入现有 send 入口 → 成功后清槽；M0 的浏览器复现仍未做
下次准确从哪条命令或哪个文件继续：`readPendingBrief(outdoorWorkflow.state.scope)` 接到 use-outdoor-agent-workflow 的 confirmedBoundary 变化后，或先做卡片“接着这句”预填
```

- **为什么先做存储层**：退回选址的分支现在只在气泡里说一句就把句子丢了，这是“卡在第一步”的根。存储层能独立验收，且不依赖浏览器登录与地图，夜里能稳定完成。
- **边界**：本轮只保证“写进去、读得回、不串活动、会过期”；能不能自动接回仍需下一轮，不算已交付。

### 2026-11-16 08:30–08:37 · 自动轮次 1 · M0 切片 1a（基线归一 + 首推）

```text
日期时间（中国标准时间）及运行 ID：2026-11-16 08:30–08:37，自动轮次 1，无外部运行 ID
批次 / 切片 / 状态：M0 / 切片 1a 基线归一与首推 / 已验收
工作目录 / 分支 / 开始与结束 HEAD：仓库根 / main / aab96e70 → 8ff699b8（已推 origin/main）
修改、提交或未提交路径：frontend/lib/outdoor-agent-http-contract.test.ts、tests/providers.test.ts（commit 8ff699b8）；进度与计划文件未提交
复现及第一失败步骤：① 根 typecheck 先在 tests/providers.test.ts:57 报 TS7053（对象字面量用 string 索引）；② 户外 HTTP 契约断言 max_completion_tokens 期望 1024，实际 4096
验证命令、结果及环境（固定数据 / 浏览器 / 真实云端）：
  · frontend: npm test -- lib/outdoor-agent-http-contract.test.ts → 4 passed（修后）
  · 根目录 npm run typecheck → 0 错（修后）
  · frontend npm run typecheck → 0 错
  · 根 npx --no-install vitest run tests/providers.test.ts tests/assistant-chat.test.ts --maxWorkers=1 → 48 passed / 1 failed
  · 前一轮同命令（修前）：lib/outdoor-agent-http-contract 1 failed，workflow react 全部通过（sub-routes 失败已不存在）
  · 均为固定数据；浏览器与真实云端本轮未跑
证据位置及安全诊断编号：无（本轮不涉真实请求）
剩余项、解除阻塞条件：assistant-chat.test.ts 旧 MiniMax 开关用例待定归属（预期 unavailable、实际 provider_error）；浏览器入口的位置接续复现未做，需起 dev server
下次准确从哪条命令或哪个文件继续：cd frontend && npm run dev -- -p 3210；开空白活动发「在杭州植物园玉泉鱼跃周边做两日市集，六个摊位，签到集章放进摊区，园路留 4 米贯通。」
```

- **结论 1**：`assistant-chat.ts:68` 明确将 outdoor_v1 的 completion 预算设为 4096，其余模式 1024；契约用例写死 1024 是旧断言，改断言不改代码。
- **结论 2**：用户侧已有三笔底图提交（149dec1e / 8a5f5848 / aab96e70）进入 main，基线不再是 f1c5a525；在途改动从 26 改 + 11 新增降为 22 改 + 7 新增。
- **未升版本**：本轮仅测试与类型修正，撑不起 CHANGELOG 规范（每版≥10 条用户可见变更、全文≥1200 字）；版本留给有用户可见改动的批次，按 minor/patch 两级升。

### 2026-11-16 08:12 · M0 基线固定（计划状态校正）

```text
日期时间（中国标准时间）及运行 ID：2026-11-16 08:12，无运行 ID（人工一轮）
批次 / 切片 / 状态：M0 基线固定 / 状态登记，进行中
工作目录 / 分支 / 开始与结束 HEAD：C:\Users\13266\.dsh\bot\workspace\Scendance2026 / main / f1c5a525 → f1c5a525
修改、提交或未提交路径：仅本进度文件（未提交）；在途改动见上节清单，未动业务代码
复现及第一失败步骤：未开始（本切片只固定基线）
验证命令、结果及环境：git rev-parse HEAD → f1c5a52544be7b4ee375af882b55784663c2e623；git status --porcelain → 26 M + 11 ??；git diff --stat → 26 files changed, 897 insertions(+), 138 deletions(-)
证据位置及安全诊断编号：无
剩余项、解除阻塞条件：需可用的本地工作台（3210/3211 未监听）与真实地图底图，才能跑浏览器入口复现
下次准确从哪条命令或哪个文件继续：起 dev 服务后，按「下一条操作」发首句，记录 agent-panel.tsx:3062 守卫分支的实际表现
```

### 2026-11-16 · 计划编写阶段的定向基线

- 前端在 `frontend` 下执行 `npm test -- lib/outdoor-agent-http-contract.test.ts lib/assistant-chat-http.test.ts components/room-organizer/hooks/use-outdoor-agent-workflow.react.test.tsx components/room-organizer/lib/place-first.test.ts components/room-organizer/lib/outdoor-place-handover.test.ts`。55 通过，2 失败。
- `lib/outdoor-agent-http-contract.test.ts` 的 IN77 契约用例在供应商请求参数处期望 token 上限 1024，收到了 4096。先核对现行契约及不同聊天模式的预期，再决定修断言还是代码。**（轮次 46 校正：此文件在 `main` 上不存在，且 `git log --all` 对它的历史为 0 条——它当年只是工作树里的未跟踪文件，现已不在。这条基线已失效，不要再拿来判归属。）**
- `use-outdoor-agent-workflow.react.test.tsx` 的组合用例在 `sub-routes` 处未生成 2 米人行支线预览。先核对测试固定场地与现行几何约束，保留越界和穿越保护区校验。以上两条是编写计划时已经存在的失败，根因归属待查。**（轮次 46 校正：在 `main`（259aa136）上该套件 47/47 全过，`sub-routes` 已无失败；这条基线也已失效。以后判归属请以当轮实测为准，不引用本段旧结论。）**
- 根目录 `npm test -- <文件>` 因脚本内含 `tests/` 意外运行全量，发生内存不足。后续用直接的 Vitest 文件过滤和 `--maxWorkers=1`。
- 根目录用 `npx --no-install vitest run tests/assistant-chat.test.ts tests/agent-events.test.ts --maxWorkers=1` 可复跑定向基线，本次用仓库内 Vitest 入口执行，33 通过，1 失败。`tests/assistant-chat.test.ts:19` 的旧 MiniMax 配置与独立产品开关用例期望 `unavailable`，实际得到 `provider_error`。先核对供应商选择与开关优先级再处理。
- 浏览器主流程、实际部署与服务端日志待 M0，以上 HTTP 用例使用本地测试处理器。

在此追加短记录。原始大日志和截图放本机临时目录，登记脱敏摘要和可重跑命令。

### 2026-11-16 09:38 · 车流/后勤二期（#117+#118）三子智能体并行，已验收

```text
日期时间（中国标准时间）及运行 ID：2026-11-16 09:38，无运行 ID（人工一轮，三子智能体并行：#117 实现 / #118 契约 / #120 复核）
批次 / 切片 / 状态：车流后勤二期纯函数层 / #117 车辆 follower 参数分档 + #118 车辆实体落盘契约对比 / 已验收（three 接线与 schema 落盘未动）
工作目录 / 分支 / 开始与结束 HEAD：C:\幕景\Scendance2026\.worktrees\people06-on-main / feat/people06-labor / 46ec7e80 → d0f3801d（期间快进合并 origin/main 新增 0391efed+d0f3801d，与本批零重叠）
修改、提交或未提交路径：新增 frontend/components/room-organizer/lib/vehicle-follower-profile.ts 与 .test.ts、docs/plans/2026-11-16-vehicle-entity-contract-118.md；#116/#119 既有未提交（flow-sim.ts/.test.ts、vehicle-types.ts/.test.ts、typed-suggestion.tsx、people-anim.ts/.test.ts）保持不动；全部未提交、未推
复现及第一失败步骤：#120 复核回执未回传，改由主控逐条抽查 10 项证据：发现 #118 文档消费面计数为旧口径（74 文件/196 处），实测 git grep 为 72 文件/222 处（38 生产+34 测试），plan-candidate-apply 行号 :165→:157，已改
验证命令、结果及环境（固定数据 / 浏览器 / 真实云端）：frontend 下 vitest run 定向 17 套件=166 通过 0 失败；npm run typecheck frontend 与根均 0 错；本地固定数据走查：cd frontend; npm run dev -- -p 3210 → Ready 7.7s、3199 代理复用、GET / =200（工作台标题正常）
证据位置及安全诊断编号：docs/plans/2026-11-16-vehicle-entity-contract-118.md（244 行，已发布为对话附件）；logs/dev-3210-out.log；无真实外部请求，无诊断编号
剩余项、解除阻塞条件：① 合并带入的上游 pending-brief.test.ts 7 例红：失败在裸 localStorage.clear()，Node 26.2.0 全局 webstorage 遮蔽 jsdom（--environment jsdom 仍复现）；仓库 .nvmrc=24.15.0，本机无 nvm 未复验，解除条件=钉住版本跑或上游加守卫，非本批引入；② plan-facility-models sweeper 缺 GLB 1 例基线遗留仍红；③ #118 A/B/C 待用户拍板后按文档 §6 迁移顺序落 schema；④ #117 3D 接线待真人值守验收
下次准确从哪条命令或哪个文件继续：cd C:\幕景\Scendance2026\.worktrees\people06-on-main\frontend; npm run dev -- -p 3210（已在本机运行）；#118 拍板后从 supabase/functions/_shared/site-plan.ts 的 planVehicleSchema 草图开始
```

### 2026-11-16 10:04 · #117 3D 接线 + #118 方案 B schema 落盘，已验收

```text
日期时间（中国标准时间）及运行 ID：2026-11-16 10:04，无运行 ID（人工一轮，用户授权：3D follower 接线 + 多做做）
批次 / 切片 / 状态：车流后勤二期 / #117 3D 接线（车体块占位）+ #118 方案 B schema 切片 / 已验收（前端读层、2D marker、AI 产车未动）
工作目录 / 分支 / 开始与结束 HEAD：C:\幕景\Scendance2026\.worktrees\people06-on-main / feat/people06-labor / d0f3801d → d0f3801d（未提交，无新提交）
修改、提交或未提交路径：新增 three/vehicle-flow.ts 与 .test.ts（6 例）；改 components/outdoor-plan-3d.tsx（plan-vehicle-flow 层 + 每帧步进 + 签名重建）；改 supabase/functions/_shared/site-plan.ts（planVehicleTypes/planVehicleSchema/可选 vehicles 数组/superRefine 三处校验）；tests/site-plan.test.ts +5 例；全部未提交、未推
复现及第一失败步骤：根 typecheck 报 tests/site-plan.test.ts:339 TS2322——测试助手用交叉类型拓宽 routes 与 samplePlan 的 kind 字面量类型冲突；改 Omit 拓宽后复跑 0 错
验证命令、结果及环境（固定数据 / 浏览器 / 真实云端）：frontend typecheck 0 错、根 typecheck 0 错；前端定向 18 文件 172 例全绿（含 vehicle-flow 6 例）；根 tests/site-plan.test.ts 21 例全绿（含车辆集合 5 例）；本地 3210 dev 热更新可走查
证据位置及安全诊断编号：无真实外部请求；3D 走查入口 http://localhost:3210（画 vehicle/service 流线看车体块沿线跑）
剩余项、解除阻塞条件：① #118 前端读层（PLAN_ENTITY_KEYS/plan-levels/保护/canvas 三入口）与 2D marker/图例/导出按文档 §6 步骤 2–3 逐步落；② AI 产车延后（候选带 vehicleIds 会被 strict 解析拒，fail-closed，不静默丢）；③ 上游 pending-brief 7 例红（Node 26 环境）与 sweeper 缺 GLB 1 例基线遗留不变
下次准确从哪条命令或哪个文件继续：cd frontend; npm run dev -- -p 3210 走查 3D 车体块；下一步按文档 §6 步骤 2 落前端读层（use-outdoor-agent-workflow.ts PLAN_ENTITY_KEYS + plan-levels.ts + outdoor-plan-protection.ts）
```

### 2026-11-16 10:30 · #121 前端读层 + #122 六个 2D 出口 + 3D 实体层 + 画布标记，已验收

```text
日期时间（中国标准时间）及运行 ID：2026-11-16 10:30，无运行 ID（人工一轮：#121 读层 / #122 导出面 两子智能体并行，#123 画布标记空转→主控自做）
批次 / 切片 / 状态：车流后勤二期 / #121 读层（提案合并·图层过滤·锚点保护）+ #122 图例/清单/CSV/GeoJSON/PNG/PDF + #123 画布只读标记 + 3D 实体实例层 / 已验收（选中·拖拽·删除、AI 产车未做）
工作目录 / 分支 / 开始与结束 HEAD：C:\幕景\Scendance2026\.worktrees\people06-on-main / feat/people06-labor / d0f3801d → 4802a43d（快进合并 origin/main 5 提交；因 canvas.tsx 与进度文档重叠，先 stash 再 ff-only 再 pop，零冲突）
修改、提交或未提交路径：新增 lib/vehicle-entities.ts(+test 6)、lib/vehicle-markers.ts(+test 7)、hooks/use-outdoor-agent-workflow.carry.test.ts；改 hooks/use-outdoor-agent-workflow.ts（PLAN_ENTITY_KEYS + carryList）、lib/plan-levels.ts(+test)、lib/outdoor-plan-protection.ts(+test)、lib/site-plan-{legend,inventory,csv,geojson,png,pdf}.ts(+test)、components/outdoor-plan-3d.tsx（plan-vehicle-entities 层：车型 GLB 优先、缺模型占位盒、签名重建、gen 防竞态）、components/outdoor-plan-canvas.tsx（drawVehicleMarkers 只读层 + 四张 Record<PlanInventoryKind> 补 vehicle）；全部未提交、未推
复现及第一失败步骤：① vehicleEntitySlots 用 -row*… 在 row=0 产出 -0，toEqual 与 0 不等→显式归零；② 切线角是数学角（π/2=北），测试里按「0=北」写反→改断言；③ 上游新增 PlanInventoryKind='vehicle' 使 canvas 四张映射表 TS2741 缺键→补面临时色/图标/图层行；④ drawVehicleMarkers 误传外层 View（lng/lat/zoom）→改为 filterPlanByLevel(plan, activeLevelIdRef.current)
验证命令、结果及环境（固定数据 / 浏览器 / 真实云端）：frontend typecheck 0 错、根 typecheck 0 错；前端定向 24 文件 248 通过，7 红仅 room-organizer-canvas-session.react（Node 26.2.0 无 --localstorage-file，全局 localStorage 遮蔽 jsdom）；加 NODE_OPTIONS=--localstorage-file 后该文件 + pending-brief 16/16、use-outdoor-agent-workflow.react 33/33 全绿→7 红与 33 红均环境级，非本批代码；本地 3210：合并后 Compiled 8.6s，GET / =200（标题正常）
证据位置及安全诊断编号：无真实外部请求；走查入口 http://localhost:3210（画 vehicle 流线 + 带 vehicles 的 plan 看 2D 标记与 3D 实体）；日志 logs/dev-3210-out.log
剩余项、解除阻塞条件：① 画布选中/拖拽/删除与「新增车辆」入口未做（需真人验收后再接编辑链路）；② AI 产车仍延后：plan-candidate-apply.ts 的 expected 只拼五类 id，候选带 vehicleIds 会被 strict 解析拒（fail-closed），接入前必须显式禁止服务端产车；③ 服务端契约（agent-contract.ts / site-plan-store.ts / site-plan-migrate.ts）需先部署再发前端写入；④ 停放点是否算设施、非车行线是否阻断保存待拍板；⑤ sweeper 缺 GLB 1 例基线遗留
下次准确从哪条命令或哪个文件继续：cd C:\幕景\Scendance2026\.worktrees\people06-on-main\frontend; npm run dev -- -p 3210（已在跑）；下一批从 components/outdoor-plan-canvas.tsx 的 drawVehicleMarkers 接命中/选中，或先部署 supabase 契约再说 AI 产车
```

```text
日期时间（中国标准时间）及运行 ID：2026-11-16 11:20–12:05
批次 / 切片 / 状态：人物资产管线（#131 加载器收口 / #132 清单 / #134 两档 LOD）——代码与产物完成，仅剩 R2 上传凭据
工作目录 / 分支 / 开始与结束 HEAD：.worktrees/people06-on-main / feat/people06-labor / eb6920b7（全程未提交、未推送）
修改、提交或未提交路径：three/glb-loader.ts（新增，接线 3 处：glb-assets.ts / people-model.ts:65 / scene-delivery.ts:437）；tools/aholo/compress-people.mjs（--preset hero|far + 修 spawn）；新增 tools/aholo/{inspect-people-glb,people-manifest,r2-upload,verify-people-lods}.mjs；docs/plans/2026-11-16-people-asset-pipeline.md
复现及第一失败步骤：① Node 26 + Windows 下 execFileSync('npx.cmd') 抛 EINVAL（禁止不带 shell 启 .cmd）→ 改走 node <npm-cli.js> exec --yes -- <cli>；② people-manifest.mjs 的 basename(name, name.length-4) 传了数字 → ERR_INVALID_ARG_TYPE → 改 name.slice(0,-4)；③ r2-upload.mjs 用 process.exit 退出触发 undici 断言 !(handle->flags & UV_HANDLE_CLOSING) → 改 process.exitCode
验证命令、结果及环境（固定数据 / 真实云端）：公开基址 HEAD 28 个 ID：27 个 200（合计 1004.7 MB）、1 个 404（LOCAL_HANFU_WALK_ID 9b9bb4da…）；curl -Z 并发 6 路下载 1004.7 MB / 394 s；compress-people far 全量 1004.7→41.2 MB（−95.9%）、hero 全量 1004.7→66.6 MB（−93.4%）；verify-people-lods 27/27 通过（hero 三角面与原始逐一相等、52 关节、2 clip）；people-manifest 27 资产 15 KB + --check 通过；frontend tsc 0；people-model/scene-delivery/glb-assets/people-anim 4 文件 64 通过；r2-upload --dry-run 规划 2 对象、--verify-only 准确报出线上仍是 41,870,312 B 与 lod1 404
证据位置及安全诊断编号：.cache/aholo（原始 27 个 + hero/ + far/ + people-manifest.json）；tools/aholo/*.mjs 可复跑；凭据零接触（脚本自读环境变量，输出不含密钥）
剩余项、解除阻塞条件：① R2 上传被阻：当前登录账号 913b868b… 未开通 R2（访问桶被重定向 /r2/plans，S3 端点 TLS 不通），需属于该桶账号的 R2 API Token（Access Key ID/Secret）或换账号登录；② 默认汉服 GLB 404，要么补传要么摘默认引用；③ 阈值仍为 48 MB / 90 s，建议 12 MB / 45 s，等上传回读通过后再改；④ people-manifest.json 未进仓库，等对象上云后再随前端提交
下次准确从哪条命令或哪个文件继续：在 .worktrees/people06-on-main 下 `node tools/aholo/r2-upload.mjs --hero .cache/aholo/hero --far .cache/aholo/far --dry-run` → 有凭据后加 `--env-file .env.local` → 再 `--verify-only` 全 OK 后改 frontend/components/room-organizer/lib/glb-limits.ts 的 LOCAL_WALK_MAX_FILE_BYTES 与 three/glb-assets.ts 的 TIMEOUT_MS
```


```text
日期时间（中国标准时间）及运行 ID：2026-11-16 12:40–13:10，retarget taskid=8038610
批次 / 切片 / 状态：人物资产管线（坐姿落仓）——27 个模型全部带坐姿循环，仅剩 R2 上传凭据
工作目录 / 分支 / 开始与结束 HEAD：.worktrees/people06-on-main / feat/people06-labor / eb6920b7（未提交、未推送）
修改、提交或未提交路径：新增 tools/aholo/{fetch-sit-clips,build-sit-assets,probe-animation-ids}.mjs；改 tools/aholo/lux3d-dev-proxy.mjs（/task 解析 outputs[].content 内层 JSON + 返回 actions[]，新增 ?shape=1 结构探针）；改 frontend/components/room-organizer/lib/character-generate.ts 与 .test.ts（预设改上游真实 id）
复现及第一失败步骤：① 3199 上的代理是当日 08:49 改代码前启动的旧进程，/retarget 回 404「未知接口」——但代理自身用 readEnvFile 从仓库根 .env.local 读 LUX3D_API_KEY、端口读 LUX3D_PROXY_PORT，故 `$env:LUX3D_PROXY_PORT='3200'; node tools/aholo/lux3d-dev-proxy.mjs` 即可起新实例，全程不碰密钥；② 原预设 id 是猜的：Sit_Idle_Loop / Stand_To_Sit / Sit_To_Stand 全被上游拒（unknown animation_id）；③ 用「候选 + 必不存在哨兵」逐条提交（整单必失败→零扣费）实探出真实 id：Sitting_Idle_Loop、Idle_Talking_Loop（连同 Idle_Loop/Walk_Loop），47 个候选里没有任何坐下/起身过渡；④ 任务 status=3 但 outputs 为空——上游把产物塞在 outputs[0].content 这段 JSON 字符串的 actions[].animationGlbUrl 里；⑤ 加 shapeOf 探针时误删 animationList 函数头导致 Illegal return，已修回
验证命令、结果及环境（固定数据 / 真实云端）：retarget 单条 Sitting_Idle_Loop 约 85 s，产物 39.99 MB / 52 关节 / 1 条 1.67 s 循环（~6 credits；三次被拒的 create 均 consumedCredits=0）；build-sit-assets 全量：合并 27（内部 clip animation_1 --as Sit_Idle_Loop，逐个断言 3 条 clip）→ far 801.7→41.7 MB（−94.8%）→ hero 801.7→67.1 MB（−91.6%，最大 3.54 MB）→ verify-people-lods 27/27（52 关节、3 clip、hero 三角面与原件逐一相等）→ people-manifest 27 资产新 hash；frontend tsc 0；character-generate 16 通过；probe-animation-ids 阳性对照 Idle_Loop/Walk_Loop 均通过（哨兵法成立）
证据位置及安全诊断编号：.cache/aholo/{sit/Sitting_Idle_Loop.glb, with-sit-20261116050039/, hero/, far/, people-manifest.json}；build-sit.log；凭据零接触，所有输出不含密钥
剩余项、解除阻塞条件：① R2 上传仍缺 f0273e54… 账号的 R2 API Token；② 阈值仍 48 MB / 90 s，等上传回读后改 12 MB / 45 s；③ 上游无坐下/起身过渡动作，过渡靠交叉淡入，若要真过渡只能外部 Mixamo FBX；④ people-manifest.json 待对象上云后随前端提交
下次准确从哪条命令或哪个文件继续：`node tools/aholo/r2-upload.mjs --hero .cache/aholo/hero --far .cache/aholo/far --dry-run` → 凭据就位后加 `--env-file .r2.env` → `--verify-only` 全 OK 后改 glb-limits.ts 的 LOCAL_WALK_MAX_FILE_BYTES 与 three/glb-assets.ts 的 TIMEOUT_MS
```


```text
日期时间（中国标准时间）及运行 ID：2026-11-16 13:20–13:55
批次 / 切片 / 状态：人物资产管线收口（R2 上传 + 阈值下调）——54 个对象已上云并回读校验，管线全绿
工作目录 / 分支 / 开始与结束 HEAD：.worktrees/people06-on-main / feat/people06-labor / eb6920b7（未提交、未推送）
修改、提交或未提交路径：tools/aholo/r2-upload.mjs（逐条容错 + 4 次退避重试 + 默认自动读仓库根 .r2.env）；.gitignore（加 .r2.env / !.r2.env.example）；frontend/components/room-organizer/lib/glb-limits.ts（LOCAL_WALK_MAX_FILE_BYTES 48→12 MB）；three/glb-assets.ts（TIMEOUT_MS 90→45 s）；docs/plans/2026-11-16-people-asset-pipeline.md
复现及第一失败步骤：① 首次上传前 11 个对象全 OK（200 + 回读字节一致，证明令牌与桶都对），第 12 个抛 ECONNRESET 且未捕获，整批中断 → 加 putWithRetry（网络错误与 5xx 退避 800/1600/3200 ms，共 4 次）与 headPublic 的 try/catch，单条失败只跳过不中断；② 对象数按 54 算（不是 58），hero 27 覆盖 + far 27 新增
验证命令、结果及环境（真实云端）：node tools/aholo/r2-upload.mjs --hero .cache/aholo/hero --far .cache/aholo/far → 54 个对象 108.88 MB 全部上传并回读一致；--verify-only → 54/54 OK（本地字节数 = 线上 Content-Length，lod1 路径齐全）；frontend tsc 0 错；in-place-walk / asset-lod / asset-manifest / character-generate 四文件 53 项全绿（无测试断言旧阈值）
证据位置及安全诊断编号：桶 scendance-assets（账号 f0273e54d22c215389dd6065a802ddae）；凭据仅存本机 .r2.env，git status --ignored 确认 !! .r2.env 被忽略；所有脚本输出不含密钥
剩余项、解除阻塞条件：① 前端实机验证未做：需在本地 3210 打开户外计划，确认 27 个角色能加载 3.5 MB 内新资产并播放坐姿；② people-manifest.json 保持为 .cache 构建产物（.cache/ 已被 git 忽略，代码里 parsePeopleAssetManifest 只有测试、无 fetch 消费方），等 loader 真正读取时再入库；③ 汉服 id 9b9bb4da… 已从 glb-limits.ts 白名单与常量一并摘除（残留引用 0，白名单 27 项，tsc 0，44 项测试通过）；④ 画布选中/拖拽/删除与车辆新增入口仍未做
下次准确从哪条命令或哪个文件继续：cd frontend && npm run dev -- -p 3210 → 打开户外计划看人物坐下；若资产加载报错，先查 three/glb-assets.ts 的 TIMEOUT_MS 与新阈值 12 MB 是否被缓存命中旧值
```

