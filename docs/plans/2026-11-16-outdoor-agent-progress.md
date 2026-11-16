# 户外 Agent 强化执行进度

计划见 [户外 Agent 强化执行计划](2026-11-16-outdoor-agent-upgrade.md)。每轮执行先更新「当前续跑点」，完成后更新「执行记录」。所有状态以实际文件差异、提交和验收输出为准。

## 当前续跑点

- 总状态：**M0 已收口**；**M1a 1–3 已交付**；**M2/M3 已验收**；**M6 375/768 已验**；**M4 阻塞（分区分流仍要登录/模型，证据见轮次 28）**；**M5 进行中**（幂等票号 + 刷新恢复已交）；**M7 进行中**（轮次 31 门禁、轮次 32 回退手册、轮次 33 三类证据对照表：11 条用例 0 条全绿、3 条已观测到未通过）。
- 验收口径：以计划 §0「用户口径」为准（不卡第一步 / 地图听懂人话 / 每步有下一步 / 会做设计 / 分层指令 / 一口气做完 / 可回看取证），优先级高于功能清单；任一不满足不得标已验收。
- 推送规则（2026-11-16 用户授权）：每轮验证通过即推 `main`，不 force；改动跨模块 → minor（当前 4.14.0 → 4.15.0），单点 → patch（4.14.0 → 4.14.1），两个 `package.json` 与 CHANGELOG 同步。**首次推送会把在途的 26 改 + 11 新增一起带上 main**，按模块拆成可回退的提交，不揉成一个。
- 调度现状：定时任务仍为 `*/30`（创建入口未返回可用的 automationId，按名更新返回 “Automation is unavailable”，未能改成 45 分钟）。文件侧要求「距上轮提交不足 40 分钟则本轮只核对退出」，实际节奏接近 45 分钟。
- 初始基线：`main` 在 `f1c5a525`，并带下列在途未提交改动。**本轮复现直接用这份工作树，不新建干净 checkout**——`place-first` 等守卫只存在于未提交文件里，干净检出会跑出与文档不符的另一种行为。
- 下一条操作：对照表已落定（`docs/plans/2026-11-16-outdoor-evidence-matrix.md`），下一步做里面「现在只有两项有数」的指标采集：把「键入→首个气泡」与「确认→画布出现」两段计时做成可重复的探针脚本（`.temp/r34-metrics.mjs`，`connectOverCDP`）；无 9222 时先交脚本与未登录可跑的基线（计数 fetch、记录卡片文本变化时间），不编造耗时。首条命令 `cd frontend; npm test -- components/room-organizer/lib/turn-trace.test.ts`。
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
| M7 验收和发布准备 | 进行中（已拦发布） | **轮次 31 门禁**（typecheck 0 / build 过 / 34 文件 398 条）。**轮次 32 回退手册**（仅 4 笔可代码级干净反应用）。**轮次 33 三类证据对照表**：14 文件 148 条本轮全绿；11 条验收用例 **0 条三类全绿**，#1/#6/#11 已观测到未通过，#4 部分过，其余未验 → 已经拦下发布。剩：指标采集（确认次数/耗时）、浏览器主流程（需 9222）、服务端查询说明（B）。 |

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
- `lib/outdoor-agent-http-contract.test.ts` 的 IN77 契约用例在供应商请求参数处期望 token 上限 1024，收到了 4096。先核对现行契约及不同聊天模式的预期，再决定修断言还是代码。
- `use-outdoor-agent-workflow.react.test.tsx` 的组合用例在 `sub-routes` 处未生成 2 米人行支线预览。先核对测试固定场地与现行几何约束，保留越界和穿越保护区校验。以上两条是编写计划时已经存在的失败，根因归属待查。
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

