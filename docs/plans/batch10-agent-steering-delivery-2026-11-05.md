# 第 10 批交付：运行中改道（steering）全链路

日期 2026-11-05｜依据 `docs/plans/petitmaker-agent-teardown-2026-11-05.md` §10 第 2 条

## 为什么要它

幕景一次运行最长 6 轮。用户在第 1 步就看出读法不对时，原来只有「取消重发」一条路——重发会作废已付出的轮数与已通过的候选。谷地工坊把这做成了运行条输入框（占位文案「为下一步添加备注」），幕景的账面第 8 批已有 `steerNotes` 字段与按钮，但**没有任何消费方**：写进去，没人取。

## 改了什么（7 文件 +80 行）

| 层 | 文件 | 动作 |
|---|---|---|
| 库 | `supabase/migrations/20261105130000_agent_run_steering.sql` | `agent_runs` 加 `steer_notes`（待取队列，取走即清）与 `steer_total`（收过的总数，单调递增）；`agent_view` 输出 `steerTotal`；`agent_rpc_before_activity_tasks` 加 `note` 分支 |
| 服务 | `_shared/agent-runner.ts` | 每轮模型调用**之前** `call('take_notes')`，把取到的备注以 user 消息注入，措辞写明「后说的盖过先说的，优先于最初需求」与冲突处理方式 |
| 路由 | `_shared/api.ts` | `POST /projects/:id/agent-runs/:runId/notes`，`note` 1–500 字，返回 202 |
| 契约 | `_shared/agent-contract.ts` | `agentRunSchema` 加可选 `steerTotal`（活动任务运行没有这条通道，缺省 0） |
| 客户端 | `frontend/lib/backend-session.ts` | `steerAgentRun(runId, note)` |
| 界面 | `panels/creative-studio.tsx` | 轮询循环每拍把待送备注交给服务端；失败（`AGENT_RUN_STOPPED`）如实说「这趟已经收尾，备注没有生效」 |
| 界面 | `panels/agent-chat-store.ts`、`agent-run-panel.tsx` | `steerDelivered` 用服务端绝对值；面板分「已送达 N 条 · 下一轮思考前生效」与「还有 M 条待送达」两截 |

## 三条设计判据

1. **送达 ≠ 生效。** 备注进的是队列，工作线程在**下一次模型调用前**取走。所以界面只说「已送达，下一轮思考前生效」，不说「已应用」。
2. **已结束就拒收。** `note` 分支放在 `claim` 守卫**之前**（送备注的人不是工作线程，没有也不该有 claim），任务已收尾直接 `AGENT_RUN_STOPPED`；前端据此诚实报因，不亮假绿灯。
3. **送达数是服务端绝对值。** 轮询会重复读到同一 `steerTotal`，设绝对值才不会越滚越大；`steer_notes` 是「还没送到」，两者混成一个数会让用户以为写进去了。

队列上限 8 条，超出丢最早一条——运行只剩几轮，留最新的要求才有意义。

## 验证

- `tests/agent-steering.test.ts` 3 例：送达后队列清空且 `steerTotal` 递增；任务已收尾写备注回 `AGENT_RUN_STOPPED`；超出 8 条丢最早。
- `frontend/.../agent-run-panel.react.test.tsx` 新增 4 例：`steerDelivered` 是绝对值；已送达与待送达分两截显示；只有待送达时不说「已送达」；送走之后只剩送达读数。
- 相关后端 83 例全过（`agent-steering` 3 + `agent-runs` 42 + `activity-task-runs` 38）。
