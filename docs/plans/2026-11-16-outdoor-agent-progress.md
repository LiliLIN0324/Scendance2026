# 户外 Agent 强化执行进度

计划见 [户外 Agent 强化执行计划](2026-11-16-outdoor-agent-upgrade.md)。每轮执行先更新「当前续跑点」，完成后更新「执行记录」。所有状态以实际文件差异、提交和验收输出为准。

## 当前续跑点

- 总状态：**M0 已收口**；**M1a 切片 1–3 已交付**（轮次 8–9、13，其中 13 已接进面板）；**M2 待办模型 + 槽桥接层已推送**；M2/M3 的接回验仍受登录阻塞。M4–M7 待开始。
- 验收口径：以计划 §0「用户口径」为准（不卡第一步 / 地图听懂人话 / 每步有下一步 / 会做设计 / 分层指令 / 一口气做完 / 可回看取证），优先级高于功能清单；任一不满足不得标已验收。
- 推送规则（2026-11-16 用户授权）：每轮验证通过即推 `main`，不 force；改动跨模块 → minor（当前 4.14.0 → 4.15.0），单点 → patch（4.14.0 → 4.14.1），两个 `package.json` 与 CHANGELOG 同步。**首次推送会把在途的 26 改 + 11 新增一起带上 main**，按模块拆成可回退的提交，不揉成一个。
- 调度现状：定时任务仍为 `*/30`（创建入口未返回可用的 automationId，按名更新返回 “Automation is unavailable”，未能改成 45 分钟）。文件侧要求「距上轮提交不足 40 分钟则本轮只核对退出」，实际节奏接近 45 分钟。
- 初始基线：`main` 在 `f1c5a525`，并带下列在途未提交改动。**本轮复现直接用这份工作树，不新建干净 checkout**——`place-first` 等守卫只存在于未提交文件里，干净检出会跑出与文档不符的另一种行为。
- 下一条操作：给失败卡/编号补一次真实浏览器实证——它只在模型瞬态失败时出现，需要一次能打到模型且允许失败的会话（登录态）；拿不到就改做 M4 预览契约或 M1c 查找说明等无依赖切片。
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
| M2 恢复需求 | 进行中（登录阻塞） | 切片 2a：`pending-brief.ts` 9 条。2b：`shouldResumeBrief` 按边界去重。2c：`outdoor-pending-task.ts` 待办模型 12 条。2d：`outdoor-task-brief-bridge.ts` 槽↔待办单一换算 9 条（未知阶段退回选地点、原话不改、往返不漂移）。待验（需登录）：接回一次、跨活动不串。 |
| M3 分流与上下文 | 进行中（登录阻塞） | 切片 3a：复合句保留整句、设计入槽，8 条测试通过；轮次 7 在新 HEAD 上重验仍零 `/assistant/chat`。下一切片同 M2，卡在圈选需登录。 |
| M4 组合预览 | 待开始 | 以首条代表需求和直接编辑为中心。 |
| M5 应用与恢复 | 待开始 | 补版本、应用幂等、撤销及中断验收。 |
| M6 工作台体验 | 待开始 | 桌面和窄屏按同一任务状态复测。 |
| M7 验收和发布准备 | 待开始 | 指标对照、真实云端、回退说明。 |

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

## 执行记录

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

```text
日期时间（中国标准时间）及运行 ID：
批次 / 切片 / 状态：
工作目录 / 分支 / 开始与结束 HEAD：
修改、提交或未提交路径：
复现及第一失败步骤：
验证命令、结果及环境（固定数据 / 浏览器 / 真实云端）：
证据位置及安全诊断编号：
剩余项、解除阻塞条件：
下次准确从哪条命令或哪个文件继续：
```
