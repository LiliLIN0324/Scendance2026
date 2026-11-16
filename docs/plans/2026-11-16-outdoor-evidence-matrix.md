# 三类证据对照表（M7.1）

- 实测时间：2026-11-16 轮次 33，HEAD `19334be3`
- 方法：把计划 §5 的 11 条验收用例逐条对到**现有可复跑的测试**（本轮实跑取数）与**真实浏览器记录**（取自进度文件各轮次实证）；缺的直说缺
- 三类口径：**固定数据**＝本地 Vitest；**真实浏览器**＝在 :3210/:3211 上跑出来的界面行为；**真实云端**＝真实请求 + 日志关联。任何一条只有固定数据的，都不算该用例通过

## 1. 逐条对照

本轮实跑 14 个文件、**148 条全绿**（`--reporter=json` 逐文件计数，原始结果 `.temp/r33-tests.json`）。

| # | 验收用例 | 固定数据（文件 / 条数） | 真实浏览器 | 真实云端 | 结论与缺口 |
| --- | --- | --- | --- | --- | --- |
| 1 | 空白项目输入组合需求，地图确认地点及范围 | `outdoor-event-turn` 3、`instruction-layers` 9、`outdoor-map-context` 7 | **部分（正式站走查，2026-11-17）**：组合句「在杭州 IN77 做设计，80 人发布会，户外广场 30×20 米…」→ 6 条地点候选（候选 1 带「有轮廓」）→ 场地确认卡 → 范围写进画布（红线）→ 待恢复槽里的需求句自动接回并送去模型 → 模型出「计划 2 个步骤」审批卡 → 分区预览确认写入画布；证据线 `features=108` | 无 | **部分通过**：组合需求那一半在正式站已通（轮次 28 的「零请求无气泡」不再复现）；但走查用的是本机草稿画布而非空白项目，且 V2/V4/V5 未走完，「空白项目」口径未完全覆盖 |
| 2 | 两个同名地点，地图选中其中一个 | `outdoor-venue-sync` 28（几何与身份投影）、`outdoor-project-store` 21（按项目隔离） | 无 | 无 | **未验**：需要把两个同名候选放进一次真实搜索 |
| 3 | 有范围、已选设施，发明确小改 | `instruction-layers` 9（分层拆分）、`outdoor-event-turn` 3 | **部分（正式站走查）**：范围确认后发「主通道改走场地北侧仁和路，别沿湖滨路走…」→ `conversation-api/assistant/chat/stream` 真的发出且 200 → 界面报「当前Agent理解不可用（provider_error），规划未变」，如实显示、零写入 | 无 | **部分**：真实改口请求已发出、模型通道确实被调用；但本轮模型侧失败，没拿到「小改生效」的结果，不能算这条用例通过 |
| 4 | 无范围先发设计句，再改预算或人数 | `outdoor-pending-task` 12、`pending-brief` 9 | **部分**：轮次 14 退回气泡给出唯一下一步且零 `/assistant/chat` | 无 | **部分**：只验了「先发设计句」；「再改预算或人数」没有浏览器实证 |
| 5 | 地图部分、离线或无路网 | `outdoor-map-context` 7（含过期 revision 拒绝）、`outdoor-walk-boundary` 13（点在边界内外） | 无 | 无 | **未验**：离线/断网只有代码路径，没有实测 |
| 6 | 未登录、功能关闭、额度不足、网络超时 | `outdoor-login-copy` 4、`turn-failure-diag` 5 | **部分**：轮次 28 观测到未登录时的登录门（输入框被禁、写「登录后继续这次选址」）；正式站走查另观测到第五类阻塞「模型通道 provider_error」（请求 200 但结果不可用，规划不变、如实告知） | 无 | **未通过**：四类阻塞仍未分别验；且未登录时该说的话被登录卡顶掉 |
| 7 | 待预览时说「等等」或过时的「确认」 | `outdoor-apply-once` 6（同一 epoch + 基准版本只放行一次） | 无 | 无 | **未验**：固定数据只证票号逻辑，没有真实点过 |
| 8 | 应用中刷新、双点确认、切项目 | `outdoor-flow-restore` 9、`outdoor-apply-once` 6、`outdoor-project-store` 21 | 无 | 无 | **未验**：三项都是浏览器行为；刷新恢复只有存储层证据 |
| 9 | 确认后撤销，重开旧草稿 | `outdoor-apply-once` 6、`turn-trace` 14 | 无 | 无 | **未验**：撤销链路没有回读实证 |
| 10 | 一条真实模型失败，一条纯本地成功 | `turn-failure-diag` 5、`turn-trace` 14（无身份字段） | **部分（正式站走查）**：真实失败样本已拿到 —— `conversation-api/assistant/chat/stream` 200 但界面报「当前Agent理解不可用（provider_error），规划未变」；同一次会话里纯本地分区预览成功产出并写入画布 | 无 | **部分**：两个样本都有了（失败如实显示、零写入；本地成功写入画布），但仍缺服务端日志关联，诊断编号没能与一次真实请求对上 |
| 11 | 普通聊天、室内布局、导出与旧云 Agent Run | 室内门/贴边：`plan-door-snap` 等（轮次 24 交付）；壳层：`indoor-zone-door` | **部分**：轮次 20 验了 375/768 手机壳与卡片收口，轮次 24 验了门贴边高亮 746 vs 0 px | 无 | **未通过**：这一条要证「户外升级不破坏既有行为」，导出与旧云 Agent Run 都没复跑 |

## 2. M7.1 要求的指标：现在只有两项有数

| 指标 | 现状 | 数据来源 |
| --- | --- | --- |
| 重复输入（同一句是否被要求再说一遍） | 局部有数：接回链 0 次 | 轮次 21/27 浏览器 |
| 地图与模型调用次数 | 局部有数：接回链 `xhr/fetch = 0`、退回气泡 `NET = []` | 轮次 21、轮次 27 |
| 澄清次数 | 局部有数：M3 气泡 `HAS_QUESTION = false`（不追问） | 轮次 27 |
| 确认次数 | 未采集 | — |
| 成功率 | 未采集（11 条用例里 0 条全绿，谈成功率没意义） | — |
| 首个有用反馈耗时 | 未采集 | — |
| 预览耗时 | 未采集 | — |

采集办法（下一轮可直接照做）：在 `:3210` 上用 `connectOverCDP` 起一次会话，包一层 `performance.mark` + `fetch` 计数器，把「键入→首个气泡」「确认→画布出现」两段分别记时；固定数据部分用 `vitest --reporter=json` 的 duration 落盘（本轮已产出一份）。

## 3. 现在能不能发

**不能。** 11 条里：0 条三类全绿，2 条（#4、#11）有部分浏览器证据，3 条（#1、#6、#11）已观测到明确未通过，其余未验。#1 与 #6 是主流程，按 M7 的阻断口径已经拦发布。

要转绿，最短路径是拿到一次可用的登录态（9222 调试端口），把 #1/#3/#7/#8/#9 一次会话连着跑完——这五条正好都在同一条链上（组合需求 → 小改 → 预览 → 应用 → 撤销）。

## 4. 每一项的复现命令

```bash
cd C:/Users/13266/.dsh/bot/workspace/Scendance2026/frontend
npx vitest run components/room-organizer/lib/outdoor-event-turn.test.ts \
  components/room-organizer/lib/instruction-layers.test.ts \
  components/room-organizer/lib/outdoor-pending-task.test.ts \
  components/room-organizer/lib/pending-brief.test.ts \
  components/room-organizer/lib/outdoor-map-context.test.ts \
  components/room-organizer/lib/outdoor-login-copy.test.ts \
  components/room-organizer/lib/outdoor-apply-once.test.ts \
  components/room-organizer/lib/outdoor-flow-restore.test.ts \
  components/room-organizer/lib/outdoor-project-store.test.ts \
  components/room-organizer/lib/turn-failure-diag.test.ts \
  components/room-organizer/lib/turn-trace.test.ts \
  components/room-organizer/lib/outdoor-layered-task.test.ts \
  components/room-organizer/lib/outdoor-venue-sync.test.ts \
  components/room-organizer/lib/outdoor-walk-boundary.test.ts \
  --reporter=json --outputFile=../.temp/r33-tests.json
# 期望：14 文件 / 148 条全过（本轮实测值）
```

## 5. 轮次 44 合并后回归与「可判口径」映射（2026-11-17）

上游合进 5 个分支（`docs/intelligence-gap-roadmap`、`fix/agent-run-hygiene`、`fix/quota-notice` 等）后，把 M7 自己那 8 个文件重跑了一遍：

```bash
cd C:/Users/13266/.dsh/bot/workspace/Scendance2026/frontend
npx vitest run \
  components/room-organizer/lib/outdoor-turn-metrics.test.ts \
  components/room-organizer/lib/outdoor-trace-metrics.test.ts \
  components/room-organizer/lib/outdoor-turn-live.test.ts \
  components/room-organizer/lib/outdoor-metrics-book.test.ts \
  components/room-organizer/lib/outdoor-metrics-export.test.ts \
  components/room-organizer/lib/outdoor-session-report.test.ts \
  components/room-organizer/lib/outdoor-report-download.test.ts \
  components/room-organizer/lib/outdoor-acceptance-selfcheck.test.ts
# 实测：8 文件 / 77 条全过（9 + 9 + 14 + 13 + 6 + 7 + 7 + 12）
```

`lib/outdoor-acceptance-selfcheck.ts` 把上表 11 条写成了可计算规则，但**它只判「有没有料」，不判「是否通过」**：

| 口径 | 用例 | 报告里要出现的信号 |
| --- | --- | --- |
| 可从报告找料（5 条） | #1 | 至少一轮 + 调过地图 + 出过预览 |
| | #3 | 出过预览 |
| | #4 | 观测到 `awaiting_place`（先要地点） |
| | #6 | 至少一条失败样本（终态 failed 或 errorCode 非空） |
| | #10 | 失败样本 + 成功预览各一 |
| 只能真实浏览器（6 条） | #2 #5 #7 #8 #9 #11 | 报告再全也不给「可判」，必须 9222 实跑 |

结论不变：**11 条依旧 0 条三类全绿**，发布门禁继续关闭。轮次 44 探过 `http://127.0.0.1:9222/json/version`，本机返回「无法连接到远程服务器」（端口未开），所以 #1/#3/#7/#8/#9 那条连贯链路仍未跑。
