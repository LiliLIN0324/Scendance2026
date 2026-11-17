# 户外 Agent 强化执行进度

计划见 [户外 Agent 强化执行计划](2026-11-16-outdoor-agent-upgrade.md)。每轮执行先更新「当前续跑点」，完成后更新「执行记录」。所有状态以实际文件差异、提交和验收输出为准。

## 当前续跑点

- 总状态：**M0 已收口**；**M1a 1–3 已交付**；**M2 已验到退回气泡唯一下一步**（桌面与 375/768 均通过）；**M6 已开工**：768 端到端通过；375 原报“左侧导航不可见”经 D1-verify 实测为探针误报（`助理菜单` 展开后空间/物料/场地/户外规划四项均可达，console 0 错误）。M2/M3 接回验仍受登录阻塞。M4/M5/M7 待开始。
- 验收口径：以计划 §0「用户口径」为准（不卡第一步 / 地图听懂人话 / 每步有下一步 / 会做设计 / 分层指令 / 一口气做完 / 可回看取证），优先级高于功能清单；任一不满足不得标已验收。
- 推送规则（2026-11-16 用户授权）：每轮验证通过即推 `main`，不 force；改动跨模块 → minor（当前 4.14.0 → 4.15.0），单点 → patch（4.14.0 → 4.14.1），两个 `package.json` 与 CHANGELOG 同步。**首次推送会把在途的 26 改 + 11 新增一起带上 main**，按模块拆成可回退的提交，不揉成一个。
- 调度现状：定时任务仍为 `*/30`（创建入口未返回可用的 automationId，按名更新返回 “Automation is unavailable”，未能改成 45 分钟）。文件侧要求「距上轮提交不足 40 分钟则本轮只核对退出」，实际节奏接近 45 分钟。
- 初始基线：`main` 在 `f1c5a525`，并带下列在途未提交改动。**本轮复现直接用这份工作树，不新建干净 checkout**——`place-first` 等守卫只存在于未提交文件里，干净检出会跑出与文档不符的另一种行为。
- 下一条操作：B2-run / C1 需真人（登录态、样例项目、积分生成）；375 导航已实测非缺陷，不再改 CSS。
- 并行工作树（2026-11-16 19:05 实读，`fix/outdoor-walk-control` @ `b997da81`，未提交、未推）：OFM TileJSON 共享缓存已不再绑调用方 AbortSignal；证据线同一版本的并发 `load` 合成一次 `fetchOfmEvidence`。aholo 同一任务号 / 同一 metaUrl 并发只打一次代理，GLB 缓存键按落盘 URL 里的资产 UUID 对齐。分享受众分栏、圆形罗盘、漫游修复都在这份工作树里。本轮只补记，没有改这些代码。375 导航仍是下一条产品修复。
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
| M2 恢复需求 | 进行中（部分已验） | 2a：`pending-brief.ts` 9 条。2b：`shouldResumeBrief` 按边界去重。2c：`outdoor-pending-task.ts` 12 条。2d：`outdoor-task-brief-bridge.ts` 9 条。**轮次 14：退回气泡已带唯一下一步，真实浏览器实证通过（零 `/assistant/chat`）。** 待验（需登录）：范围确认后自动接回一次、跨活动不串。 |
| M3 分流与上下文 | 进行中（登录阻塞） | 切片 3a：复合句保留整句、设计入槽，8 条测试通过；轮次 7 在新 HEAD 上重验仍零 `/assistant/chat`。下一切片同 M2，卡在圈选需登录。 |
| M4 组合预览 | 待开始 | 以首条代表需求和直接编辑为中心。 |
| M5 应用与恢复 | 待开始 | 补版本、应用幂等、撤销及中断验收。 |
| M6 工作台体验 | 进行中（375 误报已澄清） | 375/768 端到端退回流程已通（气泡带下一步、零 `/assistant/chat`、无横向溢出、槽写入）。375 导航实测：`助理菜单` 展开后空间/物料/场地/户外规划四项均可见，点空间能开左卡并收起菜单，console 0 错误；原“整组不可见”是探针未展开菜单。 |
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

### 2026-11-16 16:45 · 新基底 60278a09 复核（V1 浏览器复验 + 定向回归）

```text
日期时间：2026-11-16 16:45，本地主树 / HEAD 60278a09（PR #118 merge）
批次 / 切片 / 状态：基线复核，无代码改动
三提交在位核对：22175027（子线判死修复）、9c86d57c（3D 车辆巡游层+岗位标签）、0c904b54（补回 focus-place-search/outdoor-place-handover）均在 main 历史
定向回归：road-network 11 + sub-entrance 5 + carry 6 + plan-traffic-layer 14 + workflow.react 38 = 74 passed / 0 failed，exit 0；含此前唯一红的「个人库复用→子线岗位→3D 替换/上传/生成」用例
浏览器复验（本地 3002 主树 dev，匿名态）：打开 /editor 渲染正常，console 无 error（仅 WebGL 精度 warning + camera-clamp debug）；发纯设计句「六个摊位排两列，签到台放进口处，园路留 4 米。」→ 气泡「…这句我先留着。下一步：在地图上选地点」，/assistant/chat=0，待恢复槽 house-y4ry0n56 写入原句 stage=place。V1 本地分流/入槽/唯一下一步在新基底未被回退
卡点留痕：搜索地点检索框被侧栏 h1 坐标遮挡（bu 探针 obscured，非产品缺陷）；检索候选与圈范围确认仍归登录态回源段，本轮未走。线上 Pages chunk 已重构建；子线修复无可搜字符串标记，线上是否含只能页面点「子线」验到
```

- 八阶段枚举在位（use-outdoor-agent-workflow.ts：place/scope/zones/main-routes/objects/sub-routes/people/refine-3d）；子线回退 `findSpur(preferredSamples)` 无解再回退边界采样，室内不回退。
- V2/V3 落库证据来自此前轮次，本轮仅测试回归；V4 objects→sub-routes 页面链路、V5 人物坐姿实机/车辆编辑入口仍未在本轮浏览器走查。

### 2026-11-16 17:10 · 正式站登录态 V1–V5 走查（pages.dev，project house-uat5t1nz）

```text
环境：https://scendance-scene-planner-ewz.pages.dev/，已登录，模型槽 Tokendance 网关（deepseek-v4.1-flash）；锚点 120.163749,30.25283（杭州湖滨 in77 一带）
V1 place/scope：检索出 6 条 in77 候选；选候选→场地确认卡→「确认并应用这一版」写边界；确认后接回待恢复槽原句并发出 chat。落库：confirmedBoundary 锚点+多边形在位 ✓
V3 zones：首包 Agent 理解 timeout（规划未变，出重试卡）；重试后分区预览（展示区 exhibition / 交流区 audience / 休息区 service），确认落库 zones=3 ✓
V2 main-routes：主线预览铺到地图（绿人流 / 蓝界外候选 / 黑待核对入口），确认落库 routes=9、nodes=7 ✓
V4 objects：点「预览按用途复用我的物料」→ **conversation-api 始终未发起**（conv=[]），流程卡在前置 site-context 结构化上下文：该接口持续 inflight（函数侧 15s 截止应回 503，浏览器侧未收到终态/无独立超时），任务卡回「重试」；facilities=0、objects=0、brief.items=[]。手动检索「展板」未出候选列表；GLB 原位导入入口在位（≤10MB 仅本会话不上传）
V4 sub-routes / V5 people/refine-3d：被 objects 阶段卡住，未走到；brief.people=[]
```

**卡点定性（外部数据源，非前端崩溃/契约破裂）：**

- `/api/site-context` 直探两次均 **503**（3.6s / 14.8s）；`/api/road-network` 同坐标 20.3s 读超时。两函数上游都是同一组公共 Overpass 端点（maps.mail.ru / overpass-api.de / lz4），从 Pages 边缘不可达或超时；函数 fail-closed 返回空要素 + `structured_map_source_unavailable`，不虚构建筑/入口。
- V3 首包模型 timeout 属偶发慢包，重试可恢复；V4 未走到模型——前置 site-context 挂起把流程挡住，conversation-api 未发起。`scene-api/studios` 多次 200；console 仅一条 503 resource，无 JS 崩溃。
- 状态机推进正常：place→scope→zones→main-routes→objects 各阶段边界/分区/路线都持久化成功；断在 objects 的前置地图上下文抓取，不在去耦合链路，也不在模型槽。
- 待解：① Overpass 公共源在边缘不可达——评估 site-context/road-network 是否改走与底图同源的 OpenFreeMap transportation（参照底图 32844f72 口径），或加可用兜底；② 前端对 site-context 挂起/503 缺独立超时与降级（空上下文也应允许明确报错或放行模型，而非无限 inflight）；③ 模型首包 timeout 阈值与重试口径；④ 物料库「展板」无候选需核对该账号库内是否真有匹配（scene-api/studios 200，但前端未渲染列表，归属待定）。

### 2026-11-16 17:35 · 证据线（site-context）接 OpenFreeMap 客户端源，函数 Overpass 退后手

```text
环境：本地主树 C:\幕景\Scendance2026，分支 fix/outdoor-walk-control；前端 Node24（node-v24.22.3），vitest 4.1.12
背景：32844f72 已把前端路网 fetchRoadNetwork 改成「OFM 客户端瓦片优先、服务端 Overpass 兜底」，所以 V2 主线能出；证据线（喂模型上下文 + 建筑/障碍安全校验）仍直连挂掉的 /api/site-context，没有 OFM 优先分支，V4 objects 卡在这里。
决策：沿用同一口径给证据线加 OFM 客户端适配器；不在 Pages Function 内加 MVT 解码依赖（函数无独立 package.json 打包，解码放前端）；函数 Overpass 保留为 fail-closed 后手。
本轮有意文件（提交只 add 这些）：
- 新增 frontend/components/room-organizer/lib/openfreemap-evidence.ts：复用 fetchOpenFreeMapRoads（GCJ 折线）+ fetchOpenFreeMapBuildings（WGS 环），Promise.allSettled 各自独立失败；道路转 ENU(GCJ)、建筑环转 ENU(WGS)，复用 site-intelligence 的 toLocal/isValidGeometry/boundedRadius；要素为空返回 null（交上层退函数兜底）；产出 MapEvidenceResult，status partial、complete false、scope gcj-02 + anchor + radiusM，warnings 如实标注入口/障碍/开放空间/室内连接未知。
- 新增 openfreemap-evidence.test.ts：4 例（要素转换与 scope / 双源空返 null / 单源失败不拖累 / 退化几何丢弃）。
- 改 outdoor-map-context.ts：plan.anchor 存在时先 fetchOfmEvidence，异常或空再走原 loader.load（semanticEndpoint /api/site-context）；cached 缓存逻辑不变。
- 改 openfreemap-buildings.ts：未导出的 LngLatRing 接口加 export。
未碰：functions/api/site-context.ts、road-network.ts（仍 Overpass 后手）；并行在途 scendance-workspace.tsx + 测试不回灌。
验证：
- 定向套件全绿：evidence 4 + context 7 + roads 10 + road-network 11 + site-intelligence 24 + site-context-api 5 + workflow.react 38 + sub-entrance 5 + carry 6 + plan-traffic-layer 14。
- 前端 tsc --noEmit EXIT=0（先递归清 *.tsbuildinfo，NODE_OPTIONS 6144）。
- 浏览器直探 OFM：TileJSON https://tiles.openfreemap.org/planet 0.5s 可达；瓦片模板 …/planet/20261101_080013_pt/{z}/{x}/{y}.pbf；vector_layers 含 building、transportation、transportation_name、park、landuse、landcover、waterway、poi、place 等。
未做 / 待解：
- 本地 dev 缺登录态，端到端 V4 objects→sub-routes→people/refine-3d 未在本轮真机走查；需部署 Pages 后用登录态复核证据线是否非空、物件阶段能发 conversation-api。
- 函数端 site-context/road-network 仍直连 Overpass；坏窗口时返回空/503，前端已有空容错，是否进一步切同源或退役函数端待评估。
- OFM park/landuse/landcover 开放空间候选本轮未接入 evidence；适配器目前只产出 road + building；entrance/barrier 不在 planet 这两个图层，保持 unknown + warning。
- 模型槽：tokendance 本轮确认有额度可出回复；deepseek-flash 余额耗尽、bailian 欠费（模型不是本轮卡点）。
```

### 2026-11-16 18:40 · 户外漫游 walk 模式 bug 修复（fix/outdoor-walk-control）

```text
已发现并已修的具体 bug：
1. 指针锁永久被拒时，单击画布仍会 requestPointerLock，与室内 use-walkthrough 脱节，移动端/内嵌 WebView 反复刷 pointerlockerror。
2. 再次进漫游时 lockedOnceRef 未清零，冷启动相位误判为 unlocked。
3. 退出漫游只恢复相机 position、不恢复 OrbitControls.target，环绕中心残留步行期偏移，退出后第一帧 update() 甩视角。
4. WASD 瞬时满速、无加减速；失焦/退锁后 smooth 输入未清零，回页会短暂滑步。
5. 2D/3D 切换未同步收口 outdoorWalkActive，依赖 outdoor3dTakeover effect 晚一拍，存在指针锁残留窗口。

改动文件：
- frontend/components/room-organizer/hooks/use-outdoor-walk.ts
- frontend/components/room-organizer/hooks/use-outdoor-walk.react.test.ts
- frontend/components/room-organizer/room-organizer.tsx

测试（Node v24.22.3 vitest 4.1.12）：
- use-outdoor-walk.react.test.ts + walk-engage + outdoor-walk-boundary + walk-view-modes → 4 files / 36 passed / 0 failed
- 证据：.verify-walk-agent.txt
```

### 2026-11-16 18:42 · 分享面板按受众分栏（fix/outdoor-walk-control）

```text
信息架构：先分「发给客户 / 送评审方 / 内部协作」。每栏都有方案网页（发布当前版本 / 复制链接 / 打开）和 3D 漫游（生成漫游链接 / 复制 / 打开 / 重新生成）。导出改为 PNG / CSV / GeoJSON 勾选，底部「导出 N 项资料」。发布后右侧出方案预览和二维码。状态行仍是方案网页 / 3D 漫游 / 评审。评审链接在送评审方与内部协作；交接 / 资料 / 到场清单只在内部协作。沿用 onPublish、onGenerateShareLink、onIssueReviewLink 与既有导出回调。

改动文件：
- frontend/components/room-organizer/panels/share-menu.tsx
- frontend/components/room-organizer/panels/share-menu.react.test.tsx
- frontend/app/globals.css（受众页签选中态，压过工具弹层按钮的 !important 底色）

测试命令：
C:\Users\endTree\tools\node-v24.22.3-win-x64\node.exe .\node_modules\vitest\vitest.mjs run components/room-organizer/panels/share-menu.react.test.tsx
工作目录：frontend
结果：Test Files 1 passed (1)，Tests 9 passed (9)，Duration 4.40s，exit 0
复跑 18:45：同一命令，Test Files 1 passed (1)，Tests 9 passed (9)，Duration 8.46s，exit 0
```

### 2026-11-16 19:03–19:05 · 进度补记（OFM 缓存、aholo 去重、分享 / 罗盘 / 漫游）

```text
日期时间（中国标准时间）及运行 ID：2026-11-16 19:03–19:05，无外部运行 ID
批次 / 切片 / 状态：工作树核对与补记 / 代码保持未提交现状 / 定向测试 15 文件通过，证据并发夹具 3 例红
工作目录 / 分支 / 开始与结束 HEAD：C:\幕景\Scendance2026 / fix/outdoor-walk-control / b997da81 → b997da81（本轮只改本文件）
修改、提交或未提交路径：仅 docs/plans/2026-11-16-outdoor-agent-progress.md。下列修复已在工作树，本轮没有再改它们，也没有提交。
验证命令、结果及环境：frontend 下
  C:\Users\endTree\tools\node-v24.22.3-win-x64\node.exe .\node_modules\vitest\vitest.mjs run
  openfreemap-tiles.test.ts、outdoor-map-context.concurrency.test.ts、outdoor-map-context.test.ts、
  openfreemap-evidence.test.ts、aholo-assets.test.ts、aholo-model-placement.test.ts、
  three/glb-assets.test.ts、three/plan-model-layer.test.ts、share-menu.react.test.tsx、
  gm-compass.test.tsx、gm-compass-bearing.test.ts、use-outdoor-walk.react.test.ts、
  walk-engage.test.ts、outdoor-walk-boundary.test.ts、walk-view-modes.test.ts、plan-tile-cache.test.ts
  vitest 4.1.12：Test Files 1 failed | 15 passed (16)；Tests 3 failed | 163 passed (166)；Duration 33.61s；exit 1
  唯一失败文件：outdoor-map-context.concurrency.test.ts（3/3）。并发开始时 fetchOfmEvidence 次数断言已过，AbortError 断言已过；随后上下文 status 为 unavailable，夹具期望 partial。
剩余项：把并发夹具的 scope.anchor 改成与 createStarterOutdoorPlan 相同的平湖秋月锚点（120.1460368, 30.2521924）后再看第二次 load 是否仍只打一次 OFM。375 宽左侧导航仍按上一条操作修。
下次准确从哪条命令或哪个文件继续：修 375 导航，或先改 outdoor-map-context.concurrency.test.ts 的锚点再复跑该文件。
```

**OFM 缓存（已在工作树）**

- `openfreemap-tiles.ts`：模块级 TileJSON Promise 不再把某一个调用方的 `AbortSignal` 传进 `fetch`。调用方取消只拒绝自己的等待；共享请求失败会清空缓存以便重试。`openfreemap-tiles.test.ts` 5 例在本轮 15 个通过文件里。
- `outdoor-map-context.ts`：同一 plan 版本并发 `load` 只 `invalidate` 一次，并共用一条 `fetchOfmEvidence`；这条共享请求不绑调用方 signal。证据 `ready` / `partial` 写入 60 秒缓存。17:35 的证据适配器仍在，`openfreemap-evidence.test.ts` 与原 `outdoor-map-context.test.ts` 本轮同批通过。
- 并发测试 3 例红的原因：夹具 `scope.anchor` 写成 `{lng:120, lat:30}`，方案锚点是平湖秋月 `120.1460368, 30.2521924`。`buildSiteSnapshot` 因锚点不一致拒收证据，`mapStatus` 变成 `failed`，适配器因此返回 `unavailable`。这不是 TileJSON 又被 AbortSignal 毒死。

**aholo 去重（已在工作树）**

- `aholo-assets.ts`：`importAholoAsset` 按任务号（无任务号则按 URL）合并 in-flight；已落盘的任务号直接复用，不再打代理。
- `aholo-model-placement.ts`：同一 `metaUrl` 的 `loadAholoSceneMeters` 合并 in-flight。
- `three/glb-assets.ts`：`glbCacheKeyForUrl` 把 `/asset/<uuid>.glb` 收成资产 UUID，与 `ensureGlbAsset(assetId, url)` 同一键。`plan-model-layer.ts` 与 `outdoor-plan-3d.tsx` 的场景模型按这个键加载。
- 同批加载顺序：`useGlbAssets` 先加载当前楼层，其它楼层放 `requestIdleCallback`（无则 `setTimeout`）。`use-scene-effects.ts` 传入 `activeFloorIndex`。
- 本轮 `aholo-assets`、`aholo-model-placement`、`glb-assets`、`plan-model-layer` 均在通过的 15 个文件里。

**分享 / 罗盘 / 漫游（已在工作树；分享与漫游五条详见 18:42、18:40）**

- 分享：受众分栏与 18:42 记录一致。本轮 `share-menu.react.test.tsx` 仍在通过文件中。`globals.css` 另有受众页签选中态。
- 罗盘：`GmCompass` + `GmCompassHost` 挂进已有 `.oc-gm-compass-wrap`，原 `#tool-compass` 留在 DOM 里并被挡住。左箭头 `orbit(+π/2)`，右箭头 `orbit(-π/2)`，点针回正北，拖动按手指转角。2D 画布与 3D API 都提供 `getBearing` / `orbitByDelta` / `resetNorth`。方位非 0 时 `plan-tile-cache` 的 `cullPad` 按 `tileOverflowPad` 向外扩瓦片。`scendance-workspace.tsx` 未改。形状记录见 `docs/COMPASS_TURN_ARROWS_PLAN.md`（18:52 接上、19:00 短月牙）。本轮 `gm-compass.test.tsx` 与 `gm-compass-bearing.test.ts` 通过；`plan-tile-cache.test.ts` 通过（`cullPad` 缺省 0，北朝上裁剪与原来相同）。
- 漫游：18:40 的五条仍在（永久拒锁不再单击重试、再次进入清 `lockedOnceRef`、退出恢复 Orbit target、WASD 平滑且失焦清零、2D/3D 切换先关 `outdoorWalkActive`）。工作树里 `outdoor-plan-3d.tsx` 另有：步行时保存并恢复 OrbitControls 的 enabled / zoom / pan / rotate / mouseButtons 和画布 `touchAction`；鸟瞰档先退出指针锁。比例尺罗盘在步行时跟 `yaw`。本轮 `use-outdoor-walk.react.test.ts`、`walk-engage.test.ts`、`outdoor-walk-boundary.test.ts`、`walk-view-modes.test.ts` 通过。

### 2026-11-16 20:30–20:55 · 切片 A：工作树体检（fix/outdoor-walk-control）

```text
日期时间（中国标准时间）：2026-11-16 20:30–20:55，无外部运行 ID
批次 / 切片 / 状态：切片 A 工作树体检 / 未提交、未 push / 当前红绿已核
工作目录 / 分支 / HEAD：C:\幕景\Scendance2026 / fix/outdoor-walk-control / b997da81（HEAD 未动）
本轮修改路径：8 个文件，均只修测试或类型，未改产品行为（见下）
```

**工作树规模**：已跟踪 42 个文件、+3189 / −670；未跟踪里与本轮相关的新组件 / 测试 / 文档与交接文档第 8 节一致。`.verify-*`、`.tmp-*`、`.g1-reports/`、`ia-mapping/_shots/` 仍是噪声，未纳入。

**diff 体检结论**

- 合同未动：`route-bridge`、`site-plan`、`outdoor-task-progress`、物料生成入参本轮 `git diff` 为空；`panels/scendance-workspace.tsx` 本体未被本批改动（只改了它的测试）。
- OFM：`openfreemap-tiles.ts` 共享 TileJSON 已与调用方 `AbortSignal` 脱钩，取消只拒绝该路；失败只在仍占缓存位时清空。`outdoor-map-context.ts` 用 `lastInvalidateKey` 防止同版本反复 `invalidate`，并用 `inflightEvidence` 合并同 `project + 边界 + 版本` 的请求；共享请求不绑调用方 signal。
- 漫游：`use-outdoor-walk.ts` 进场同步保存机位 / 四元数 / Orbit target，退出恢复并清阻尼；`orbitHoldRef` 防退出清理与鸟瞰还原互相覆盖；输入框内 WASD 不走路、方向键不滚页；障碍盒与第三人称回拉走 `walk-collision`。
- 2D 罗盘：`bearingRef` 独立于 View，平移 / 缩放不清方位；`getBearing` / `orbitByDelta` / `resetNorth` 是新增 bridge 方法，不改既有签名；`cullPad` 缺省 0，北朝上时裁剪与原来一致。
- 分享：受众分栏、空态、二维码三态（生成中 / 成功 / 画不出）、导出勾选都落在 `share-menu.tsx`；`shareExportPlan` 只决定 PNG 走规划快照还是 3D 帧，不改既有导出回调。
- 样式：`globals.css` 新增的 `--pegman-*`、`@keyframes sc-pegman-pickup` 各只有一处定义；后出现的 `#tool-walk` / `.oc-gm-walk` 规则是覆盖底色与影子，注释已说明 `background` 简写顺序，未见互相打架。
- `git diff --check` 干净；仅 `bingo-rail-button.tsx` 有 LF/CRLF 警告（交接文档已记）。
- OFM 调试仍在：`openfreemap-evidence.ts` 的 `debug()` / `window.__ofmDebug` 与 `console.warn`，按交接文档留到真机验收后再删。

**测试（Node24，frontend 目录，`--maxWorkers=1`）**

```text
命令：node node_modules/vitest/vitest.mjs run <交接第 5 节 35 个文件> --maxWorkers=1 --testTimeout=15000
结果：Test Files 35 passed (35)；Tests 371 passed (371)；Duration 42.27s；exit 0
```

- 默认 5s 超时下连跑两次，两次各只有 1 例红，且不是同一例：第一次 `share-menu.react.test.tsx`，第二次 `scendance-workspace.react.test.tsx`（`Error: Test timed out in 5000ms`）。两文件单独复跑分别 17/17、33/33 通过，属重 React 文件在同批运行时的环境超时，不是断言失败；批量门槛改用 `--testTimeout=15000` 后全绿。
- 首轮另有 2 例真红，已修：
  1. `gm-walk-motion.test.ts` 直接读 CRLF 的 `globals.css` 却按 `\n` 找选择器 → 读取后统一换行再断言。
  2. `use-annotate-draw-shortcuts.react.test.ts` 的 contenteditable 用例红：jsdom 不实现 `isContentEditable`，输入框守卫漏掉 contenteditable 容器 → `isTypingTarget` 增加 `closest('[contenteditable]...')`；测试改用 `setAttribute('contenteditable','true')` 建标准标记。

**tsc --noEmit**

```text
命令：node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json
首跑：10 个错误 / 5 个文件（annotate-draw-tools.test.tsx、gm-compass-host.test.tsx x2、
      outdoor-map-context.concurrency.test.ts x3、share-menu.react.test.tsx、glb-assets.ts x2）
修后：无输出，exit 0
```

- `glb-assets.ts` 是产品代码里唯一的类型错：`texture.image` 联合类型上直接读 `.close()`；改为 `'close' in image` 收窄到 `ImageBitmap | OffscreenCanvas`，行为不变。
- 其余为测试夹具类型：`getByRole` 返回 `HTMLElement` 与 `HTMLButtonElement[]` 的 `indexOf`、部分句柄断言缺 `as unknown as`、`fetch` mock 未声明参数导致 `calls[0]` 成空元组、`qrcode.toString` 重载取到 `void` 返回。

**代理测试**

```text
命令：node --test tools/aholo/lux3d-dev-proxy.test.mjs
结果：tests 221 / pass 221 / fail 0；duration 1.74s
```

**本轮动过的文件**

```text
frontend/components/room-organizer/components/gm-walk-motion.test.ts
frontend/components/room-organizer/components/annotate-draw-tools.test.tsx
frontend/components/room-organizer/components/gm-compass-host.test.tsx
frontend/components/room-organizer/hooks/use-annotate-draw-shortcuts.ts
frontend/components/room-organizer/hooks/use-annotate-draw-shortcuts.react.test.ts
frontend/components/room-organizer/lib/outdoor-map-context.concurrency.test.ts
frontend/components/room-organizer/panels/share-menu.react.test.tsx
frontend/components/room-organizer/three/glb-assets.ts
```

**仍缺（未因本轮变绿而消失）**

- 真机 / 浏览器视觉验收全部未做：罗盘弯箭头、右下角控件堆、pegman、左栏、绘图五工具、分享三受众、漫游碰撞与穿地、OFM Network 证据、aholo 多模型加载。
- OFM 调试代码仍在，验收通过后才删；`.verify-ofm-evidence.test.ts` 仍不要提交。
- 提交白名单未列；`bingo-rail-button.tsx` 换行待统一。
- 未 commit / 未 push / 未开 PR / 未部署。

### 2026-11-16 21:05–21:15 · 新 main 研究与道具动作 A1

```text
origin/main = 7ddafd31，比 b997da81 多 26 个提交；HEAD 仍是 main 的祖先。
新 main 主线：室内分区门符号（六种门）+ 10px 贴边吸附；分层指令；流式摘要；ApplyOnce。
门是设施符号，不是墙体开口；分区自动门已被 2417ff5b 关掉；出入口仍是 PlanNode 的另一套数据。
main 里没有按评分选「最佳/备选」道具的代码；现有是每设施最多 5 个模型候选 + 新生成模型置顶。
feat/people06-labor（8bf2f68f）另有坐姿 clip、E 键交互注册表与两档 LOD，尚未进 main。
```

- 新增 `lib/prop-interactions.ts` + `prop-interactions.test.ts`：道具 → seat / table / stage / booth / display / barrier / plant / vehicle / unknown；坐具复用 `seat-placement`，椅子给 sit、桌子给 talk、舞台给 wave、围栏/绿植/垃圾桶不注册交互。
- 命令：Node24 vitest 单文件；结果 9 passed；`tsc --noEmit` 无输出。
- 队列与合并风险写入 `docs/plans/2026-11-16-main-sync-and-prop-actions.md`。
- 已建 15 分钟定时任务「Scendance 15min 续跑：道具动作与验收」，下一项 A2 接 `outdoor-interactables`；积分生成 C1 明确不自动跑。

### 2026-11-16 21:15–21:20 · 道具动作 A2（接进户外可交互）

```text
文件：lib/outdoor-interactables.ts、lib/outdoor-interactables.test.ts、components/outdoor-plan-3d.tsx
结果：坐具仍走 seatInteractables（坐面高 / 眼高 / 落座回调不变）；桌 / 摊位 / 展柜 / 舞台新增「交谈 · 名称」「挥手 · 名称」条目；围栏 / 绿植 / 车辆保留原名，不冒充可交互动作。
测试：prop-interactions 9 + outdoor-interactables 13 + use-outdoor-walk 19 + walk-collision 37 = 78 passed；tsc --noEmit 无输出。
```

- `outdoor-plan-3d.tsx` 的注册表改成 `propInteractables(facilities)`：seat 条目绑 `toggleSeatEntry`，其余绑 `onInteract`；不再重复注册。「交谈 / 挥手」目前只是提示文案与注册条目，真正播人物动作等 A3。
- 定时任务首次运行（21:17）失败，提示「无法完成操作」；原因待查，优先怀疑自动化运行时的权限 / 外部路径（提示词里含 `C:\Users\endTree\Downloads` 与外部 node 路径）。

### 2026-11-16 21:22–21:26 · A2 复核修正与合并冲突图

```text
复核（子智能体）：无 P0；P1 三条已修。
修正：propInteractables 先 normalize ref = ref ?? modelOverride ?? templateId；
      去掉「标签单独判坐具」分支，避免 kind=facility 却给「坐下」缺 seat 元数据；
      断言补强：围栏 barrier / 绿植 plant / 垃圾桶、集装箱 unknown，并新增 templateId / modelOverride 生产路径用例。
测试：prop-interactions 9 + outdoor-interactables 14 = 23 passed；tsc --noEmit 无输出。
补：去「亭」出摊位词、服务台归桌、餐车归售卖摊位；prop-interactions 10 例，合计 24 passed。
```

- 子智能体冲突图：main 的 `09ad68aa` / `2417ff5b` / `54137efd` 与本地罗盘改动**无真文本冲突**，同函数不同行段；`54137efd` 的 tsx 7 个 hunk `git apply --check` 全过（最大偏移 +42）。
- 合并顺序建议：先提交/收口本地罗盘 WIP → `09ad68aa` → `2417ff5b`（必须成对按序，2417 删 09ad 的自动门）→ `54137efd`。
- 数据仍两套：门 = `PlanFacility`（六种 door templateId）；出入口 = `PlanNode`（entry/exit/both）；`plan-door-snap` 只读 `zone.environment`，不与 nodes 同步。
- 已新建定时任务「Scendance 续跑 v2（15分钟·工作区内）」：`5,20,35,50 * * * *`，只引用工作区文档，失败不重试、不自动扣积分。旧任务「Scendance 15min 续跑：道具动作与验收」仍启用但无 `automationId`，需在 UI 手动删除。

### 2026-11-16 21:30–21:33 · A3 属性卡只读交互提示

```text
文件：lib/prop-interactions.ts（新增 propInteractionSummary）
      components/outdoor-plan-canvas.tsx（属性卡标题下加读条）
      lib/prop-interactions.test.ts（+1 例）
口径：ref = modelOverride ?? templateId；只读展示，不可交互的道具不出条。
显示：可交互：坐下 · 木质餐椅 / 交谈 · 长桌 / 挥手 · 舞台；右侧「漫游中按 E」。
测试：prop-interactions 11 + outdoor-interactables 14 = 25 passed；tsc --noEmit 无输出。
未动：panels/scendance-workspace.tsx 本体、合同字段、routeBridge 签名。
```

### 2026-11-16 21:36–21:38 · B1 门吸附冲突图与 cherry-pick 顺序

```text
性质：只读研究 + 文档，不改代码，未跑 vitest / tsc。
结论：origin/main 三笔门提交与本地罗盘/旋转改动无真文本冲突；
      54137efd 的 tsx 7 个 hunk 对当前脏树 git apply --check 全过（最大偏移 +42）。
顺序：先收口本地罗盘 WIP（需终树授权）→ 09ad68aa → 2417ff5b（必须紧跟）→ 54137efd。
风险：10px 阈值用未旋转坐标，旋转下距离不变；合完手测贴边与法线方向。
数据：门 = PlanFacility（六种 door templateId）；出入口 = PlanNode；plan-door-snap 不读 nodes。
```

- B1 详情已写入 `docs/plans/2026-11-16-main-sync-and-prop-actions.md` 的「§B1 门吸附 × 本地罗盘冲突图」。
- 未执行 cherry-pick、commit、push；等终树明确说「合」。

### 2026-11-16 21:42–21:45 · B2 真机验收清单

```text
性质：只读整理 + 文档，不改代码，未跑 vitest / tsc。
交付：docs/plans/2026-11-16-main-sync-and-prop-actions.md §B2
覆盖：OFM Network / 分享三受众 / 罗盘弯箭头 / 漫游碰撞 / aholo 多模型。
每项含：前置条件、操作步骤、通过标准、取证方式、BLOCKED 口径。
状态：清单已交付，实机未执行；不把清单完成当成验收通过。
```

- 新增未打勾项 `B2-run`：需登录态与样例项目，在真人浏览器里逐项打勾并留证。
- 本次未启动 dev server、未开浏览器、未发布分享、未加载真实 aholo 资源。

### 2026-11-16 21:50–21:54 · D1 375 宽左侧导航复核

```text
性质：只读复核 + 文档，不改代码，未跑 vitest / tsc。
结论：原报告把桌面轨内的「展开导航栏」当成移动端入口；
      375 实际可见入口是独立的「助理菜单」（sc-mobile-agent-entry）；
      探针可见清单里已有它，但未先点开，所以四个导航项处于预期隐藏态。
代码链：room-organizer.tsx:475 / 4541 / 4651–4666；mobile-shell.css:10–12 / 150–185。
剩余：点开「助理菜单」后仍不可见，再查 main 是否带 is-chrome-hidden 与 computed style。
```

- 新增未打勾项 `D1-verify`：375 宽点一次 `助理菜单`，确认空间/物料/场地/户外规划可达；未复验前不改全局 `.is-chrome-hidden`。
- 本轮未启动 dev server、未开浏览器，未把静态复核当成真机结论。

### 2026-11-16 21:56–22:00 · D1-verify 375 宽实测（误报确认）

```text
环境：3210 dev（Node24）+ 本机 Chrome，Playwright 375×812，/editor?r=1。
初始：main 无 is-chrome-hidden；左轨 data-mobile-open=false / visibility:hidden；助理菜单 visible=true；四项导航 visible=false。
点助理菜单：左轨 open=true / visibility:visible；空间、物料、场地、户外规划四项全部 visible=true。
点空间：main 变 has-left-column；左轨收起；四项回到 visible=false（预期）；助理菜单仍可见；consoleErrors=0。
结论：原“375 左侧导航整组不可见”是探针未展开菜单导致的误报；无需改 CSS。
```

- D1 与 D1-verify 均已打勾；没有业务代码改动。
- 临时 dev、Playwright 脚本、日志与截图在验证后清理，不进入工作树。

### 2026-11-16 22:05–22:12 · E1 people06 接入图（只读研究）

```text
性质：只读研究 + 文档，不改代码，未跑 vitest / tsc。
对象：origin/feat/people06-labor @ 8bf2f68f。
结论：当前工作树已与分支同文的部分：seat-placement / walk-seat / interact-registry / use-walk-avatar；
      当前树已有坐姿抬升、sit clip、E 键注册表、户外 seat 切换。
真正缺口：person-action-state.ts 不存在；people-anim 缺 setPersonAction / personActionState；
      outdoor-plan-3d 的 onInteract 只有定义、无调用方；propInteractables 未携带 personAction；
      户外岗位 avatar 的 talk 被置 null；wave/emote 没有 clip，只能回退 idle。
不能做：整支 merge、整文件覆盖 outdoor-plan-3d、把 talk:null 当已支持交谈。
交付：docs/plans/2026-11-16-main-sync-and-prop-actions.md §E1（含模块表 + 最小接入顺序）。
```

- E1 已打勾；仍是研究项，没有“挥手已接通”这类功能交付。
- 下一步若继续：先接玩家 avatar 的 talk/wave，再接 NPC；无 clip 前只保留文案。

### 2026-11-16 22:18–22:28 · E2 main 剩余提交冲突图（只读研究）

```text
性质：只读研究 + 文档，不改代码，未跑 vitest / tsc。
对象：origin/main = 7ddafd31，比 b997da81 多 26 个提交。
重叠：只有 5 个文件（4 个代码 + 进度文档）。
检查：4 个代码文件的整份 main diff 都能应用到当前脏树：
      mobile-shell.css 1 hunk，offset +8；
      outdoor-plan-canvas.tsx 7 hunk，offset +2/-8/-14/+43；
      agent-panel.css 2 hunk，offset +4；
      agent-panel.tsx 14 hunk，offset ≤1。
注意：PowerShell 管道直接喂 git apply 会因编码假报 patch does not apply；
      本次用 UTF-8 临时文件复测，旧“+42”更新为 +43。
真正风险：agent-panel.tsx 依赖流式后端、Supabase migration、分层指令/ApplyOnce/登录文案新模块；
      不能只拿一个文件。outdoor-plan-canvas.tsx 能落，但门吸附与本地罗盘需同轮测试手测。
交付：docs/plans/2026-11-16-main-sync-and-prop-actions.md §E2。
```

- E2 已打勾；未执行 cherry-pick / merge / commit，仍等终树说「合」。
- 发现 main 的 `2c6d4319` 修的是 375 户外卡片标题栏被收起、卡片压住唯一入口；这与 D1「整组不可见是误报」不矛盾，是另一个已修状态。

### 2026-11-16 22:26–22:31 · E3 person-action-state 纯函数落地

```text
性质：代码切片，新增纯函数 + 单测；不接场景、不改现有播放逻辑。
新增：frontend/components/room-organizer/lib/person-action-state.ts
      frontend/components/room-organizer/lib/person-action-state.test.ts
口径：缺片段回退 idle；idle 也缺返回 null；wave/emote 归一次性动作。
验证：vitest 1 file / 6 tests passed；tsc --noEmit TSC_EXIT=0。
边界：people-anim / use-walk-avatar / outdoor-plan-3d 均未改，当前无生产 import。
```

- E3 已打勾；这是“动作解析地基”，不是“挥手已接通”。
- 下一步：把 `personAction` 挂到道具条目，或先给玩家 avatar 接 talk/wave；仍需单独一轮。

### 2026-11-16 22:30–22:34 · E4 可交互条目携带 personAction

```text
性质：数据层代码切片；不接 E 键播放、不改座位行为。
改动：interact-registry.ts 的 InteractableEntry 新增可选 personAction；
      outdoor-interactables.ts 的 seat→sit、桌/摊位/展柜→talk、舞台→wave，惰性道具不带；
      outdoor-interactables.test.ts 补断言。
验证：outdoor-interactables 14 + prop-interactions 11 + person-action-state 6 = 31 passed；
      interact-registry 11 passed；tsc --noEmit TSC_EXIT=0。
边界：outdoor-plan-3d 没有消费 entry.personAction，E 键仍只出提示/切座位。
```

- E4 已打勾；这是“知道该播什么”，不是“已经播了”。
- 下一步 E5：给玩家 avatar 接 talk/wave（或按 entry.personAction 调最近 NPC）；需单独一轮并补场景测试。

### 2026-11-16 22:36–22:40 · E5/E6 人物动作 API 与道具 E 键

```text
性质：代码切片；接 NPC 动作，不改座位行为。
E5：people-anim 新增 setPersonAction / personActionState / setNearestPersonAction；
    playClip 改用 resolvePersonAction，缺片段回退 idle。
E6：outdoor-plan-3d 的非座位条目按 entry.personAction 找最近静止 NPC
    （talk/wave，半径 3.2 m）；无目标/缺片段出 1.8 s 动作提示；座位仍 toggleSeatEntry。
验证：people-anim 12 + outdoor-interactables 14 + interact-registry 11 = 37 passed；
      tsc --noEmit TSC_EXIT=0。
核心回归：10 个相关文件 147 passed（含 glb-assets / use-outdoor-walk / walk-collision / walk-seat）。
边界：未做浏览器 E2E；户外玩家仍是胶囊体，不会播 talk/wave；
      wave/emote 无 clip，实际回退 idle 并提示“暂时没有该动作片段”。
```

- E5、E6 已打勾；这是“NPC 能响应道具动作”，不是“玩家 avatar 已会挥手”。
- 交接状态与手测步骤已写入计划文档 §F；下一步可做：玩家 avatar 换 GLB（需处理 LOD/加载/漫游相机），或补 crowd 的 talk/wave clip 注册。

### 2026-11-16 22:49 · E7 户外玩家 avatar 接 GLB 只读可行性

```text
性质：只读研究，不改代码、不跑测试。
目的：为“玩家 avatar 换 GLB”铺路，避免直接搬室内 hook。
```

- 校正：`useWalkAvatar` 不是死代码，室内漫游已在 `room-organizer.tsx:3065-3066` 用它；户外 `OutdoorPlan3D` 的玩家仍是 `CapsuleGeometry` + `SphereGeometry`（1001-1013），主循环只摆位（2122-2131）。
- 新发现（优先修）：户外 crowd 注册时写死 `talk: null`（1114）。E6 的桌/摊位 E 会回退 idle，然后出“这个人物暂时没有该动作片段”；测试假实例自带 talk，没覆盖这个真实注册项。不能用 idle 冒充交谈。
- 资产边界：`createWalkAvatar` 只返回 idle/walk/sit，不返回 talk；本地 `people.glb` 有 idle/talk/walk、无 sit；people06 云端 27 个角色文档记录为 Idle/Walk/Sit 三条，talk 是否存在需逐个验。
- 接入建议：新增 `three/outdoor-player-avatar.ts` 专用控制器（不搬 `useWalkAvatar` 的游客/打招呼语义），先做纯控制器 + 单测；再接 `OutdoorPlan3D`，用 `walkRole` 入参和场景 generation 管生命周期。站立/落座 y 都要加 `PLAN_LAYER_BASE_Y=0.052`，否则脚会沉 5.2 cm。
- 已知边界：没有做代码、没有跑浏览器；E7a/E7b/E7c 已列入计划队列。详细证据与验收口径见计划文档 §E7。

- 下一步建议：先做 E7a 控制器（纯单测、不接场景），再修 E6 的 talk 空片段；wave 仍无资产，不冒充。

### 2026-11-16 22:53–22:55 · E7a 户外玩家 avatar 控制器

```text
性质：新代码切片；纯控制器 + 单测，不接 OutdoorPlan3D，不改生产入口。
新增：frontend/components/room-organizer/three/outdoor-player-avatar.ts
      frontend/components/room-organizer/three/outdoor-player-avatar.test.ts
口径：加载失败/缺 idle/walk 返回 null；成功才入场景；初始 idle + 隐藏；
      站立脚底 baseY=0.052；落座用 sitHeadY 对齐；缺 sit 不沉地；
      thirdPerson 控制显隐；dispose 停 mixer + 移出场景 + 释放模型。
验证：vitest 1 file / 6 tests passed；tsc --noEmit TSC_EXIT=0。
边界：没有生产 import、没有接场景、没有浏览器 E2E；talk/wave/LOD 未做。
```

- E7a 已打勾；这是“可接场景的控制器”，不是“户外玩家已经显示 GLB”。
- 下一步 E7b：在 `OutdoorPlan3D` 的 avatarGroup 上加载控制器，从 `room-organizer.tsx` 传当前 `walkRole`；保留胶囊体失败兜底。

### 2026-11-16 23:08 · E7b 户外玩家 avatar 接场景 / E7c talk 核验

```text
性质：生产接线 + 资产只读核验；不改合同字段、routeBridge、SitePlanData。
改动：outdoor-plan-3d.tsx 新增 walkRole 入参、sceneEpoch 加载 effect、胶囊体兜底；
      room-organizer.tsx 传 assetId / glbUrl / name；walkFrameRef 改用 OutdoorWalkFrame。
口径：GLB 加载成功才隐藏胶囊体；失败/加载中/缺角色保留占位；
      换角色只重载 avatar，不重建地图；第一人称/鸟瞰/接管 NPC 时控制器隐藏。
E7c：16 个 labor crowd GLB 逐个解析 JSON chunk，全部只有 Idle_Loop / Walk_Loop；
      27 个角色清单记录为 Idle/Walk/Sit，无 Idle_Talking_Loop。
      保留 talk: null 与缺片段提示，不把“交谈/挥手”写成已接通，只补证据注释。
验证：outdoor-player-avatar 7 passed（新增 dispose 后挂新角色）；
      核心回归 11 文件 154 passed；tsc --noEmit TSC_EXIT=0。
边界：没有浏览器 E2E；没有真实 crowd GLB 视觉验收；玩家模型在 3D 场景建立后预加载。
```

- E7b / E7c 已打勾；E7c 是“核验后决定不接线”，不是“交谈已能播放”。
- 队列剩 `B2-run`、`C1` 两项真人门：前者需登录样例项目逐项走查，后者需真人在场并授权积分。

### 2026-11-16 23:14 · B2-run 只读预检（E7b 后补检查）

```text
性质：只读；不改代码、不跑浏览器、不打勾 B2-run。
结论：B2.4 原清单只覆盖碰撞/机位，缺 E7b 玩家 GLB 检查；已在计划 §B2.4a 补 5 条 + 1 条可选。
路径：户外 3D 接管 -> 左侧「物料」漫游角色分组选人 -> 进漫游 -> HUD/F5 切第三人称。
选择器：outdoor-walk-hud / outdoor-walk-view / outdoor-interact-hint / outdoor-action-note。
注意：sc-walk-avatar-controls 是室内 walkthrough，不是户外换角色入口。
边界：仍需真人登录、样例项目和浏览器；C1 积分仍未动。
```

- 本轮没有可安全执行的代码项，因此没有重跑测试；上一次已验证 154 例 + tsc 0。
- `B2-run` 仍未打勾；等真人按 §B2.4a 实机走查后再记 PASS / FAIL / BLOCKED。

### 2026-11-16 23:19 · C1 生成额度跑通只读预检

```text
性质：只读；不改代码、不点击生成、不消耗额度、不打勾 C1。
校正入口：属性卡三格打开的是左栏统一生成面板 GenerationSheetHost（room-organizer.tsx:4678），
  不是 outdoor-facility-generate.tsx；后者无生产引用，仅自身测试引用。
提交链：generation-sheet.tsx -> submitModelJob -> controller.createGenerationJob(..., crypto.randomUUID(), ...)。
额度闸门：generationNeedsCredit 对文字/图片 true、导入 GLB false；勾选「消耗额度」后主按钮才亮。
记录点：scendance:facility-generate-links 的 taskid；面板提示不显示 task id。
计费：项目 AI 预算 reserved_cents/committed_cents，actual_cents 在 requests 表；
  客户端 GET /jobs 无 actual_cents，UI 不显示具体金额；C1 扣费需管理端，或确认 provider_usage 含费用。
风险：网络中断无 unknown 锁/requestId 持久化；成功后 link 无 projectId；
  提交失败 staged link 不清；旧弹窗虽有回执锁但未挂载。
结论：C1 仍未打勾；真人按计划 §C1 执行卡只跑一次；金额不可见时记 BLOCKED，不写 PASS。
边界：未跑测试（无代码改动）；未登录、未提交、未扣费。
```

- 本轮只完成 C1 预检文档收尾，未执行 C1。
- 队列仍是 18/20；剩余 `B2-run`、`C1` 两项真人门。
