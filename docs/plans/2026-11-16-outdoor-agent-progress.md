# 户外 Agent 强化执行进度

计划见 [户外 Agent 强化执行计划](2026-11-16-outdoor-agent-upgrade.md)。每轮执行先更新「当前续跑点」，完成后更新「执行记录」。所有状态以实际文件差异、提交和验收输出为准。

## 当前续跑点

- 总状态：计划编写阶段已完成；**M0 进行中**（浏览器入口复现未做），M2 已开工（切片 2a、2b 已交付）。M1、M3–M7 待开始。
- 验收口径：以计划 §0「用户口径」为准（不卡第一步 / 地图听懂人话 / 每步有下一步 / 会做设计 / 分层指令 / 一口气做完 / 可回看取证），优先级高于功能清单；任一不满足不得标已验收。
- 推送规则（2026-11-16 用户授权）：每轮验证通过即推 `main`，不 force；改动跨模块 → minor（当前 4.14.0 → 4.15.0），单点 → patch（4.14.0 → 4.14.1），两个 `package.json` 与 CHANGELOG 同步。**首次推送会把在途的 26 改 + 11 新增一起带上 main**，按模块拆成可回退的提交，不揉成一个。
- 调度现状：定时任务仍为 `*/30`（创建入口未返回可用的 automationId，按名更新返回 “Automation is unavailable”，未能改成 45 分钟）。文件侧要求「距上轮提交不足 40 分钟则本轮只核对退出」，实际节奏接近 45 分钟。
- 初始基线：`main` 在 `f1c5a525`，并带下列在途未提交改动。**本轮复现直接用这份工作树，不新建干净 checkout**——`place-first` 等守卫只存在于未提交文件里，干净检出会跑出与文档不符的另一种行为。
- 下一条操作：在浏览器里验一次真实接回（起 dev server 3210 → 空白活动发玉泉市集句 → 看退回气泡 + 待恢复槽写入 → 地图选地点、确认范围 → 看是否自动接着跑一次），并记 `/assistant/chat` 是否发出；同时确认切活动后槽不串。
- 执行位置、分支、当前 HEAD：`C:\Users\13266\.dsh\bot\workspace\Scendance2026`；`main`；HEAD `fd6906e8`（已推 `origin/main`，93ebb8a9..fd6906e8）。2026-11-16 09:12 实读。
- 未提交在途（本轮新增，因文件带用户 WIP，未单独提交）：`panels/agent-panel.tsx`——退回分支 `writePendingBrief(...)` 两行 + 范围确认后的接回 effect（`shouldResumeBrief` 门控、先清槽再发）。
- 已核实的第一失败点、实际后端部署及日志编号：待 M0。
- 协作依赖：当前工作区有未提交改动，服务端段由 B 主责。M1a 可独立推进，M1b/c 的最终服务端验收需对应环境和权限。

| 批次 | 状态 | 当前切片或验收证据 |
| --- | --- | --- |
| M0 固定复现 | 进行中 | 切片 1a 已交付：基线重取（HEAD 已从 f1c5a525 前进到 aab96e70，三笔底图提交来自用户侧）；确认 sub-routes 失败已不存在（41 过），token 断言已修；根与前端 typecheck 均 0 错。下一切片：浏览器入口复现地点接续。 |
| M1 诊断 | 待开始 | 先 M1a，再补服务端关联和双路径验收。 |
| M2 恢复需求 | 进行中 | 切片 2a：`pending-brief.ts` 按活动存原句（过期/隔离/坏数据，9 条测试）。切片 2b：`shouldResumeBrief` 按边界去重接回，面板侧已接线（未提交）。下一切片：浏览器验接回 + 跨活动不串。 |
| M3 分流与上下文 | 待开始 | 先固定真实入口行为，再调整地图数据访问。 |
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
