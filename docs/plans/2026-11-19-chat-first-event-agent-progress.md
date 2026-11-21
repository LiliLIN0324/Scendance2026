# 执行进度台账：聊天驱动完整活动设计

计划正本：`docs/plans/2026-11-19-chat-first-event-agent-execution.md`
调度：每 15 分钟一轮，2026-11-19 15:00（+08:00）为硬截止。
台账用途：轮次之间唯一共享状态。每轮先读本文件，只做「当前轮」一格，写完再退出。

## 0. 基线（2026-11-19 13:5x 建立，第 0 轮）

- 仓库：`C:/Users/13266/.dsh/bot/workspace/Scendance2026`，分支 `main`
- HEAD：`76f6fed7`（2026-11-19 13:53:39 +0800，feat(frontend): 示例场景可移动可移除，扫描落位改为地图点选后生效）
- 他人未提交改动（必须原样保留，不得 stash 丢弃、不得 `git add -A`）：
  - `M docs/INDEX.md`
  - `M scripts/check-oneplan-artifacts.mjs`
  - `?? docs/plans/2026-11-19-chat-first-event-agent-execution.md`
- 本地无 `codex/*` 分支；开工时如需分支，从当前 HEAD 新建，不动 main 上他人工作树改动。
- 生产/测试域（HANDOFF 记录，未复核）：`https://scendance-scene-planner-ewz.pages.dev`。本轮不做部署、不推送、不发布。

### 0.1 计划中入口路径的实测校正

计划第 1 节给的多数路径缺 `components/room-organizer/` 前缀，实际位置如下（已实测存在）：

| 计划写法 | 实际路径 |
| --- | --- |
| `frontend/components/room-organizer/panels/agent-panel.tsx` | 同（OK） |
| `panels/agent-bubbles.tsx` | `frontend/components/room-organizer/panels/agent-bubbles.tsx`（OK） |
| `components/outdoor-workflow-card.tsx` | `frontend/components/room-organizer/components/outdoor-workflow-card.tsx` |
| `hooks/use-outdoor-agent-workflow.ts` | `frontend/components/room-organizer/hooks/use-outdoor-agent-workflow.ts` |
| `lib/outdoor-agent-understanding.ts` | `frontend/components/room-organizer/lib/outdoor-agent-understanding.ts` |
| `lib/venue-research.ts` / `wedding-venue-catalog.ts` / `place-search.ts` | `frontend/components/room-organizer/lib/…` |
| `lib/outdoor-agent-planning.ts` / `outdoor-draft-design.ts` / `outdoor-event-logic.ts` / `outdoor-map-context.ts` | `frontend/components/room-organizer/lib/…` |
| `frontend/lib/event-brief.ts` | 同（OK） |
| `supabase/functions/_shared/domain.ts`、`site-plan.ts` | 同（OK） |
| `supabase/functions/_shared/client/scene-client.ts` | `client/scene-client.ts`（仓库根下） |

### 0.2 范围决策（覆盖计划原文）

- **2026-11-19 14:0x，用户指令「没有公益 公益去掉」**：本任务只做 **婚礼单一完整案例**。公益案例（原第 5 节 T7、第 6 节 B、第 7 节 public-benefit 目录与 ≥20 张截图要求、第 8 节「两条脚本」）已从计划正本删除或标注取消，不作为验收项，也不计入缺口。以下批次状态表中 T7 标为「已取消」。
- 后续轮次不得自行恢复公益案例；也不得把「只做婚礼」当成“跨活动类型通用性已验证”——通用性留给第 9 节后续升级。
- 定时任务提示词本身未含「公益」字样（只写 T0–T8 顺序与第 8 节验收），因此无需改提示词；范围以本台账与计划正本为准。注：本轮无 `automation_list` 能力，拿不到 automationId，故未改任务本体。

## 1. 批次状态

> **2026-11-19 15:40 用户指令「没有让你停止哦」**：15:00 截止口径作废，恢复推进；后续轮次按正常流程做增量，不再走“已过 15:00 只收口”分支。截止报告保留为历史快照，不当作终点。定时任务提示词里仍写死 15:00 截止（无 automationId 改不了），若在定时轮次里命中该分支，以本行为准：**继续推进，不自停**。
>
> - 2026-11-19 15:30 已过截止，无新动作（HEAD 仍 `76f6fed7`，工作树 9 项未提交变更与收口时一致；无 automationId，未能关闭定时任务）。
> - 2026-11-19 16:15 定时轮触发，无新动作。用户 16:0x 已明确「别浪费时间了。就这样。」→ 以停止推进为准，后续轮次同样只记一行、不改代码、不重写报告。当时状态：本地 `004c24ed`（已推送过），`origin/main` 已被并行会话推进到 `646ce4c3`（本地落后，未拉取），工作树 27 项变更（含他人 pdfjs 在途）。

| 批次 | 状态 | 本轮证据 |
| --- | --- | --- |
| T0 现状与范围 | **完成**（14:18，产出 `docs/plans/2026-11-19-chat-first-event-agent-t0-baseline.md`；3 项“未核实”留 T1 首轮） | 站点 Production `Source=76f6fed`＝本地 HEAD；G1–G9 缺口均有文件:行落点 |
| T1 连续对话底座 | **T1-a✅ T1-b✅ T1-d✅ T1-d2✅ T1-e✅ 已落码**；T1-c 的进度整合仍单独跟踪 | T1-e 本轮补齐共用监督设置、按实际改动分级、写入前重查与恢复保护；见 T1 施工方案收口记录 | T0 三项未核实已复核，其中「固定推荐」修正为 6 条本地目录 `WEDDING_VENUES` |
| T2 搜索与资料理解 | 本会话已落码：可配置网页搜索、文档读取与来源、多模态转发 | 搜索密钥未配置；用户同意先接可配置服务，未部署；见 [接手记录](../archive/plan/2026-11-19-agent-t2-t3-handoff.md) |
| T3 无手画范围 | 本会话已落码：草地候选、明确假设的概念范围、聊天调整、依据随方案保留 | 用户要求停止验收直接推进，未执行 T3 测试/网站验收；见接手记录 |
| T4 婚礼完整布局 | 未开始 | — |
| T5 个人级安排 | 未开始 | — |
| T6 联动与交付 | 未开始 | — |
| ~~T7 公益活动迁移~~ | **已取消**（2026-11-19 用户指令） | 计划第 0/5/6/7/8/10 节已同步收窄，见 0.2 |
| T8 目标网站与报告 | 未开始 | — |

## 2. 轮次记录

每轮追加一段，格式固定：

```
### 轮 NN · HH:MM 开始 / HH:MM 结束
- 目标：
- 实际动作（命令/文件/行）：
- 结果与证据：
- 未做/阻塞：
- 下一轮起点：
```

### 轮 00 · 13:5x（建台账，无代码动作）
- 目标：建立跨轮共享状态与基线。
- 实际动作：`git rev-parse/log/status`、入口路径实测、写本文件。
- 结果与证据：HEAD `76f6fed7`；3 项他人未提交改动；计划中 10 个入口路径需加 `components/room-organizer/` 前缀。
- 未做：T0 的卡片盘点、能力缺口表、数据归属图均未开始。
- 下一轮起点：T0——盘点 `agent-panel.tsx` / `outdoor-workflow-card.tsx` 的卡片渲染入口与重复状态，产出缺口→代码入口表。

### 轮 01 · 14:01 开始 / 14:0x 结束
- 目标：按用户本轮新指令收窄案例范围——「没有公益 公益去掉」。
- 实际动作：
  1. `Select-String` 全量定位计划正本中「公益」5 处；
  2. 编辑 `docs/plans/2026-11-19-chat-first-event-agent-execution.md` 共 10 处：第 0 节总指令加范围覆盖句；第 5 节 T7 行改为「已取消」、T8 依赖 T2–T7→T2–T6；第 5 节末句删「第二案例」；第 6 节标题改「婚礼单一案例」；第 6 节 B 六条脚本整节替换为取消说明；第 7 节目录删 `public-benefit`、「两条案例各 10 节点 ≥20 张」→「婚礼 10 节点 ≥10 张」；第 8 节「两条脚本」→「婚礼脚本」、「两条从头使用步骤」→「一条」；第 10 节开工提示改「只完成婚礼一个完整案例」、T0–T8 加「T7 已取消」；
  3. 复验 `Select-String 公益|第二案例|public-benefit|T7|两条`：余下命中全部是取消说明本身，无残留执行项。
- 结果与证据：计划正本已无公益执行项；台账 0.2 + 批次表同步。命令可复现：`Select-String -Path docs/plans/2026-11-19-chat-first-event-agent-execution.md -Pattern "公益|第二案例|public-benefit|T7|两条"`。
- 未做/阻塞：本轮未推进 T0 代码盘点（用户指令优先，单轮只做一个增量）。无 `automation_list` 能力 → 拿不到 automationId，定时任务提示词未改（不影响，提示词不含公益字样）。
- 下一轮起点：仍为 T0——盘点 `agent-panel.tsx` / `outdoor-workflow-card.tsx` 的卡片渲染入口与重复状态，产出缺口→代码入口表（只做婚礼链路）。

### 轮 02 · 14:06 开始 / 14:18 结束
- 目标：执行 T0（现状与范围），产出可开工的缺口→代码入口表。
- 实际动作：
  1. 读 `AGENTS.md`、`frontend/AGENTS.md`（子目录规范：契约用 `_shared/domain.ts` + `client/scene-client.ts`，不另建 wire schema）；
  2. 卡片盘点：`agent-panel.tsx` 的 12 处挂载点（4024/4562/4693/4707/4708/4710/4718/4721/4728/4737/4745/4824/2128）、`outdoor-workflow-card.tsx` 的 8 阶段分支与 6 处手画/搜索按钮、`agent-bubbles.tsx` 228 行；
  3. 缺口取证：`_shared/*.ts` 全文计数 `web_search|serper|tavily|customsearch` = 0、`mammoth|pdfjs|pdf-parse` = 0；`lib/` 无 rostor/guest/attach 模块；
  4. 数据归属：读 `outdoor-project-store.ts`(250)、`venue-facts-storage.ts`(71)、`seating-allocation.ts`(1 行再导出)、`event-brief.ts`(388)、`event-operations.ts`(125)；
  5. 目标站点：`curl -I` 200；清空代理变量后 `wrangler pages deployment list` 读到 Production 最新部署 `Source 76f6fed`、16 分钟前；`git ls-remote` 确认 origin/main 同哈希。
- 结果与证据：T0 文档 8 节全部落到实测文件:行；重复状态 4 条（同一主卡两处挂载 4693/4707、同阶段四份描述、`StageThumb` 占位插画 61/414、`agent-confirm-cards.tsx:31/62` 失败卡）。
- 未做/阻塞：目标站点登录态未核实（本轮无浏览器能力）；“固定推荐按钮”“待解决事项卡”“成果记录卡”三项未核实，列 T1 首轮；未跑测试（T0 只读），未改产品代码。
- 下一轮起点：T1 首轮——复核上述 3 项 + 把 `agent-panel.tsx:4693/4707` 的双位置挂载与 4718/4745 重复进度收成一个当前状态（先出改动方案，再动代码）。

### 轮 03 · 14:30 开始 / 14:4x 结束
- 目标：T1 首轮——复核 T0 留下的 3 项「未核实」，并对卡片重复/插画/失败卡出可执行方案。
- 实际动作：
  1. 复核固定推荐：`agent-confirm-cards.tsx`+`venue-picker.tsx` 无硬编码列表；根因在 `lib/wedding-venue-catalog.ts`（`WEDDING_VENUES` 6 条：西湖园林/西子宾馆（草坪）/柳莺里/夕上·虎跑1934/金溪山庄（草坪）…，`findWeddingVenues`(97)、`rebuiltSceneRefs`(120)），唯一引用方 `outdoor-agent-understanding.ts:14`；
  2. 复核待解决事项：只有 `outdoor-task-card.tsx:23` 的 `blocked:'需要补充'` 状态标签，无缺项清单卡；
  3. 复核成果记录：导出预览卡存在（`agent-panel.tsx:620` 渲染、`2942-2989` 意图与确认，含「确认前不下载」口径），缺版本/截图/变更摘要；
  4. 查测试覆盖：`panels/agent-confirm-cards.tsx` **无专属测试**，相关断言在 `agent-panel.react.test.tsx`；
  5. 写 `docs/plans/2026-11-19-chat-first-event-agent-t1-plan.md`：T1-a 失败卡（低）/ T1-b 双挂载合并（中）/ T1-c 三份进度合一（中高）/ T1-d 插画换真实缩略（中）/ T1-e 审批降级（中高），每项附文件行、改法、验证命令、风险与顺序（a→d→b→c→e）。
- 结果与证据：**修正 T0 一条结论**——「固定推荐几个酒店」不是按钮，是 6 条本地目录＋关键字匹配，属 T2 真实检索的替换对象。
- 未做/阻塞：本轮**未落产品代码**。原因：14:30 开工、账上只剩 <20 分钟，T1 任一项都要改 `agent-panel.tsx`(5030)/`outdoor-workflow-card.tsx`(1089) 并同步 `agent-panel.react.test.tsx` 断言；冻结前改到一半会留下“测试红＋卡位置错乱”的工作树。另：HANDOFF 已记载 panel 套件有存量基线失败（267 过/185 败），本轮不拿它当验证基线。
- 下一轮起点：T1-a——先跑现有候选文案断言确认基线，改 `agent-confirm-cards.tsx:31/62` 为「试了什么/已保留/下一步」，再补 2 条断言。

### 轮 04 · 14:45 开始 / 14:5x 结束
- 目标：落 T1-a（失败卡说清「试了什么/已保留/下一步」），带验证。
- 实际动作：
  1. 先查测试引用：`Select-String` 全仓 `*.test.ts(x)` 无「没搜到候选场地」「都不是，换个说法」断言 → 改文案不会惊醒既有断言；
  2. 改 `frontend/components/room-organizer/panels/agent-confirm-cards.tsx`：`:31` 单行失败文案 → 两段（「没搜到匹配「{query}」的场地。当前方案没有改动：已确认的场地、边界和分区都原样保留。」+「下一步可以：① 换关键词或加城市名 ② 右栏「地图选址」手动圈 ③ 先按当前场地往下做」）；`:62` 「都不是，换个说法」→「都不合适，按条件再找」；
  3. 新建 `panels/agent-confirm-cards.react.test.tsx`（首行 `// @vitest-environment jsdom`，仓库约定：vitest 默认 node 环境，React 用例逐文件 opt-in）；
  4. 首跑失败 `ReferenceError: document is not defined`（漏了 jsdom 注释，非产品代码错）→ 补注释后复跑绿。
- 结果与证据：`npm --prefix frontend run test -- --run agent-confirm-cards` → `Test Files 1 passed (1) / Tests 2 passed (2)`，Duration 14.97s。新增断言：无候选时两句都在且旧甩锅句不再出现；有候选时拒绝按钮文案为「都不合适，按条件再找」。
- 未做/阻塞：未跑 `agent-panel.react.test.tsx`（HANDOFF 记载该套件有存量基线失败 267 过/185 败，跑它只会产出噪声）；未改产品数据流（T1-a 只动渲染文案，不碰写入）。
- 下一轮起点：T1-d（`StageThumb` 占位插画换真实缩略、无真实数据就不渲染），或若已过 15:00 则收口。

### 轮 05 · 15:00 开始 / 15:0x 结束（收口）
- 目标：按硬截止规则收口，不改产品代码。
- 实际动作：
  1. `Get-Date` = 2026-11-19 15:00:08 > 15:00 → 进收口分支；
  2. `git status --porcelain` 确认工作树：`M docs/INDEX.md`（他人）、`M scripts/check-oneplan-artifacts.mjs`（他人）、`M frontend/…/agent-confirm-cards.tsx`（本轮 T1-a）、`?? docs/plans/`×5（含报告）、`?? …/agent-confirm-cards.react.test.tsx`（本轮 T1-a）；HEAD 仍为 `76f6fed7`，未提交；
  3. 写 `docs/plans/2026-11-19-chat-first-event-agent-cutoff-report.md`；
  4. 尝试关定时任务：**未执行**——没有 automationId（创建回执只返回文案，无 id），且 tool_search 无 `automation_list`；`automation_update` 的 update 动作强制要求 automationId，不能猜。
- 结果与证据：截止报告 6 节（结论/已完成/未完成/阻塞/下一步/时间账）；未满足计划第 8 节的事项已逐条列明，未写成通过。
- 未做/阻塞：定时任务未关闭（无 id），后续仍会每 15 分钟触发，落入收口分支。
- 下一轮起点：无（任务已在截止线停止）；若用户重新授权继续，从 T1-d 接手。

### 轮 06 · 15:35 开始 / 15:48 结束
- 目标：用户取消停止指令（「没有让你停止哦」）→ 恢复推进，落 T1-d。
- 实际动作：
  1. 读 `outdoor-workflow-card.tsx` 卡片上幅区域，确认 `StageThumb`(61) + `ThumbBase`(24) 共 145 行是自绘示意 SVG，全仓无测试断言、面板无专属渲染测试；
  2. 用行标记删除第 24–168 行（两个占位图组件整块）；把 414 行的 `<StageThumb stage=…/>` 换成一行简洁状态 `<p className="ap-task-caption">{STAGE_CAPTIONS[flow.state.stage]}</p>`；文件 1095 → 950 行；
  3. 首次替换误写成 `/*`，用按行索引重写修好（残留检查 StageThumb|ThumbBase|`/*` = 0）；
  4. 新建 `components/outdoor-workflow-card.react.test.tsx`（jsdom + flow stub），断言 place 阶段有状态句、无 `.ap-task-map` 与「地图缩略示意」，zones 阶段同样无示意地图；stub 首跑因 `models: []` 触发 `choices.map` 而红 → 改 `models: null` 后绿。
- 结果与证据：`npm run typecheck` → 0 输出（0 错）；`npm run test -- --run outdoor-workflow-card` → `Test Files 1 passed / Tests 2 passed`，6.93s；`npx eslint outdoor-workflow-card.tsx` → 无输出（0 问题）。
- 未做/阻塞：未做真实轮廓缩略（需把 boundary 几何从 hook 暴露到 flow，属跨文件改动，留给 T1-d2）；T1-b/c/e 未动。
- 下一轮起点：T1-b（`agent-panel.tsx:4693/4707` 双挂载合并，先确认滚动锚点）；或先做 T1-d2（真实轮廓缩略）。

### 轮 07 · 15:50 开始 / 15:59 结束（用户指定 T1-d2）
- 目标：把 boundary 几何从 hook 暴露到 flow，让卡片画真实范围轮廓，跑 typecheck 与卡片测试。
- 实际动作：
  1. `hooks/use-outdoor-agent-workflow.ts`：新增 `boundaryRing: PlanPoint[] | null` 状态，新增 800ms 轮询 effect（读 `bridge().getPlan().boundary`，过 `checkBoundaryRing` 才收，JSON 比对不变不 setState），并在 return 对象 `drawnZones` 旁导出；
  2. `components/outdoor-workflow-card.tsx`：新增 `BoundaryThumb`——等比缩放至 320×150、Y 轴翻转、`polygon` 描边，面积用鞋带公式、尺寸用包围盒；上幅改为「有合法环（≥3 点）画真轮廓，否则回落一句阶段状态句」；补 `PlanPoint` 类型导入并修好 import/order 告警（卡片文件 eslint 现 0 问题）；
  3. `outdoor-workflow-card.react.test.tsx` 扩到 4 例：无环时无 `.ap-boundary-thumb`、无 polygon；30×20 m 方环时 polygon 存在且文案为「4 个点 · 30.0 × 20.0 m · 600 ㎡」；place/zones 均无 `.ap-task-map`。
- 结果与证据：`npm run typecheck` → 0 输出（0 错）；`npm run test -- --run outdoor-workflow-card` → `Tests 4 passed (4)`，8.72s；`npx eslint outdoor-workflow-card.tsx` → 无输出。
- 中间修错两处（非产品缺陷）：① 测试 stub 里误把 `drawnZones` 替换成 `boundaryRing` 导致缺字段，已补回；② 我写的一条断言「真轮廓出现时不再出现阶段图注」是错的——卡体本身就有 place 阶段正文，已删该断言而非改产品。
- 未做：未在真实画布目检（无浏览器能力，未截图）；`boundaryRing` 只在合法环时非空，用户尚未画范围时卡片仍是状态句（符合计划“无依据不造假”）。
- 下一轮起点：T1-b（`agent-panel.tsx:4693/4707` 双挂载合并，先确认 `beforeLatestQuestion` 滚动锚点）。

### 轮 08 · 16:01 开始 / 16:05 结束（用户授权 merge）
- 目标：按用户指令「merge」把 origin/main 合入本地 main。
- 实际动作：
  1. 先查重叠：`git diff --name-only main...origin/main`（28 文件）∩ 我的脏文件（6 个）= 空 → 可带脏工作树合并；
  2. 只读试合并 `git merge-tree --write-tree --name-only main origin/main` → 单树 oid、exit 0、无冲突；
  3. `git merge --no-edit origin/main` → `Merge made by the 'ort' strategy`，合并提交 `004c24ed`；
  4. 合并后校验：`git rev-list --left-right --count main...origin/main` = `3  0`；我的 T1-a/T1-d2 改动仍在工作树（`BoundaryThumb` 2 处、新拒绝文案 1 处）。
- 结果与证据：定向测试 `npm run test -- --run outdoor-workflow-card agent-confirm-cards` → `2 files / 6 tests passed`，8.89s。
- **阻塞（非本轮引入）**：合并后 `npm run typecheck` 报 1 错——`components/room-organizer/lib/agent-documents.ts(60,51)`：`isEvalSupported` 不在 pdfjs `DocumentInitParameters` 里。取证：该文件 `git ls-files` 无记录、不在 origin/main、最后写入 16:02:52（在合并之后），且 `frontend/package.json` 有未提交的 `pdfjs-dist ^6.5.438`/`fflate` 新增——**属并行会话在途的文档解析工作，不是合并产物，也不是我的文件**；本轮未动它。
- 未做：未推送（需用户明确授权）；远端新增的 garbage/依赖入库状态未审计。
- 下一轮起点：T1-b（`agent-panel.tsx` 双挂载合并；注意远端本轮刚改过该文件 +4 行）。

### 轮 09 · 16:16 开始 / 16:20 结束（用户：继续改，T1-b 正在做）
- 目标：推进 T1-b（主工作流卡双位置挂载合并）。
- 实际动作：
  1. 开工核对发现 **T1-b 已在工作树里实现**（非本轮、非我）：`agent-panel.tsx` 只留底部一处 `{outdoorWorkflowCard}`，`Bubbles` 已删 `beforeLatestQuestion` prop（含声明、ReactNode import、渲染槽），`waitingOutdoorReply` 改为传 `replyPending` 给卡；注释标注「T1-b」，编号与本计划一致；
  2. 核实滚动锚点：`agent-panel.tsx:4501` 钉底、`4512` pin、`4514` ResizeObserver、`4518` MutationObserver 均在；`beforeLatestQuestion` 全仓残留 0；
  3. 验证：`npm run test -- --run agent-bubbles` → 1/1 绿（该测试已被同步改成「最新问题仍是最后一格」）；`--run outdoor-workflow-card` → 4/4 绿；
  4. 修正一行注释：原文写「等待态卡片压成一行」，实际只把卡内思考记录设 `compact`，卡片主体不折叠——已按事实改写，避免后人照注释误判。
- 结果与证据：T1-b 行为（单处挂载 + 钉底滚动 + 无 prop 残留）有测试与代码位置双证。
- 未做/阻塞：**未在真实浏览器验证“卡不跳位”的观感**（无浏览器能力）。**T1-c/T1-e 暂不开工**：`agent-panel.tsx`（+60 行）、`agent-bubbles.tsx`、`venue-research.ts`、`functions/api/venue-research.ts`、`agent-documents.ts` 均为并行会话在途文件，同一区域再改必撞；本轮只做了 1 行注释修正，不碰他们的 hunk。
- 下一轮起点：避开 agent-panel 区，改做 lib 层可独立验证的 T3/T4 切片（`outdoor-agent-planning.ts`、`outdoor-map-context.ts` 当前无他人改动）；或等并行会话提交后再回 T1-c。

## 3. 硬约束（每轮自查）

- 不推送、不部署、不合并 main、不删他人未提交改动；`codex/` 分支内本地提交可以。
- 只跑定向验证（能证明当前改动的最小集合），不默认全量测试。
- 截图、报告、`manifest.json` 只在真实目标站点跑通后产出；没有真实操作就不产出截图类"证据"。
- 第 8 节全部满足才算"完整交付"；否则如实写关卡与缺口，不把 mock 当闭环。

## 本会话接手：T2 → T3（2026-11-19）

用户直接要求从 T2 开工；搜索服务先做可配置接入。随后用户明确“不用验收。就继续做下一个”，已停止构建和验收，直接实现 T3。该指令覆盖旧截止/停止快照，不代表覆盖用户取消公益案例的决定。本会话仍只推进婚礼链路。具体修改、限制与已有证据见 `2026-11-19-agent-t2-t3-handoff.md`。
