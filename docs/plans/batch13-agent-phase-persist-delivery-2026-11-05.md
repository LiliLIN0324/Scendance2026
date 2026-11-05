# 第 13 批交付：阶段落库 + 运行条主标题换成阶段

日期 2026-11-05｜接第 11 批（阶段化进度）

## 为什么要再走一步

第 11 批把阶段算进了进度字符串：`第 2/4 阶段 · 定落点 · 第 3/6 轮`。这解决「看得懂」，但没解决「读得回」——运行条顶卡要单独显示「第 2/4 阶段 · 定落点」，就得有字段，不能靠解析最后一行文案；刷新页面重新读档也要接得上。

## 改了什么

| 层 | 改动 |
|---|---|
| 库 `20261105150000_agent_run_phase.sql` | `agent_runs` 加 `phase`（可空，带四值约束）；`agent_view` 输出 `phase`；`start` 时初始化 survey；`step` / `progress` 分支都接受 `phase` 并只前进（`coalesce(p_data->>'phase', phase)`） |
| `_shared/agent-progress.ts` | `AGENT_PHASES` 成为唯一次序表，`AgentPhase` 从它派生——新增阶段只改一处 |
| `_shared/agent-runner.ts` | `call('step')` 与 `call('progress')` 都带上当前阶段 |
| `_shared/agent-contract.ts` | `agentRunSchema.phase` 可空（活动任务运行与老记录没有这条） |
| 前端账本 | `AgentRunState.phase` + `setAgentPhase`，照抄云端真值，前端不自己推进 |
| 运行条 | 主标题 = 「第 N/4 阶段 · 名称」，副行 = 这一段做什么 + 用时/第 N 轮/步数；拿不到阶段就只写「正在思考」，**不拿轮数顶替** |

## 判据

- **可空且不顶替。** 老记录、活动任务运行、本机规则模式都没有阶段读数。这时界面上不出现「阶段」二字，也不拿「第 3 轮」冒充——机器账不是工作进度。
- **前端不推进。** 阶段只前进由服务端保证；界面若自己按工具名推一次，刷新后会与云端不一致，看起来像进度倒流。
- **轮数不删，只降级。** 6 轮是真实硬上限，用户需要这个预算读数；它从主标题退到副行。

## 验证

- 后端：`tests/agent-space-tools.test.ts` 真跑一轮，断言落库的 `run.phase === 'deliver'`；`agent-runs` / `agent-steering` / `agent-progress` 共 49 例全过。
- 前端：`agent-run-panel.react.test.tsx` 17 例，含「主标题是阶段」「拿不到阶段就不写阶段、也不拿轮数顶替」。
- 全量 730 例：并发满载下 3 例既有负载敏感用例（`config` / `hunyuan-config` / `merged-library`）超时，三个合跑 73/73 全过，与本批无关。

## 事故记录（已处理）

同批出现过一份 `20261105140000_agent_run_phase.sql`，内容是把改道迁移整份复制再加 `phase` 列。两份先后执行会让 `add column` 撞列，把本地服务与依赖它的四个测试文件全打挂。已删除重复文件，并让两份迁移的加列都带 `if not exists`；阶段这一份改为在改道迁移的完整接续版上追加字段（同一个函数只保留一份定义）。
