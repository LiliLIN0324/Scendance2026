# Agent 框架选型与集成记录（2026-10-27）

背景：布置 Agent 此前为纯客户端规则状态机，对话失配即归零、陷入重复提问。2026-10-27 已落地规则加固（brief-agent.ts 记忆槽位 + 槽填充 + 防复读闸）并按本选型集成 Vercel AI SDK，真模型窗口就绪。

## 选型对比（2026-10 调研）

| 框架 | Stars/活跃度 | 核心抽象 | Deno/Edge | 单agent+工具+记忆+HITL 匹配度 | 引入成本 |
|---|---|---|---|---|---|
| **Vercel AI SDK**（`ai`） | ~27k★，周下载千万级 | `Agent` 接口 + 工具循环，`output`+zod 结构化输出、`needsApproval` 原生 HITL | ✅ 官方支持 Deno/Edge | ★★★★★ 四项全中 | 低 |
| **Mastra**（`@mastra/core`） | ~23-27k★，1.0 已发布（基于 AI SDK） | agent + 内置 memory + workflow suspend/resume | ✅ 官方列 Deno | ★★★★☆ 记忆最省事，框架重 | 中 |
| **LangGraph.js** | langchainjs ~25k★，LangGraph 1.0 GA | 状态图、`interrupt()`+checkpointer 的持久化 HITL（最强） | ⚠️ Deno 2 可跑但依赖树偏 Node | ★★★☆☆ 概念多，单 agent 偏重 | 中高 |
| **OpenAI Agents SDK JS** | ~3.8k★，活跃 | `Agent`/`run`、Session 记忆、`outputType` | ✅ 可跑 | ★★★☆☆ 绑 OpenAI provider | 低中 |
| **Claude Agent SDK** | 活跃但定位不同 | 内嵌 Claude Code，需子进程+文件系统 | ❌ Edge Functions 不可用 | ★☆☆☆☆ | 不适用 |
| **VoltAgent** | ~10.8k★ | agent/memory/tools/workflow | ⚠️ 主打 Node/Bun | ★★★☆☆ | 中 |
| **KaibanJS** | 量级小 | Kanban 式多 agent 编排 | 可跑 | ★★☆☆☆ 范式不匹配 | — |

**推荐**：首选 Vercel AI SDK（工具循环 + zod 结构化输出 + needsApproval HITL + Deno/Edge 支持 + 模型无关，可接 DeepSeek/Qwen/GLM）；备选 Mastra（需要内置语义记忆时）；排除 Claude Agent SDK（子进程跑不了 Edge）、LangGraph.js（单 agent 过度设计）、KaibanJS（多 agent 范式）。

## 集成落地（2026-10-27，已完成）

按首选方案集成。最终架构（v2）：**key 与模型调用全在 Supabase 后端**，与现有 `agent-runner`（DeepSeek 工具循环）共用 Tokendance 网关和同一把 secrets key；浏览器不接触 key。LLM 只管「听懂」，决策仍在纯函数状态机。

| 件 | 路径 | 职责 |
|---|---|---|
| 契约 | `supabase/functions/_shared/brief-extract-contract.ts` | 槽位 schema + `BRIEF_EXTRACT_PROMPT`（唯一事实源） |
| 后端端点 | `supabase/functions/_shared/api.ts` → `POST /brief/extract` | 复用 `chatRequest`（Tokendance 网关，`TOKENDANCE_API_KEY`）；未配 key 返回 `{enabled:false}`；模型抖动返回 `extraction:null` 不阻塞对话 |
| 会话方法 | `frontend/lib/backend-session.ts` → `briefExtract()` | 只读薄透传，不占租约 |
| Resolver | `frontend/lib/agent-resolver.ts` | 真模型优先、失败自动回退规则版 |
| 接缝 | `frontend/components/room-organizer/lib/brief-agent.ts` | `parseBriefTurn` 接受 `preExtraction`（含 `layoutMode`）注入，记忆合并/防复读/出方案闸门不变 |
| 面板 | `frontend/components/room-organizer/panels/agent-panel.tsx` | `send()` async 走 `resolveBriefTurn` |

（v1 曾在 Next server 端放 `/api/agent-turn` + AI SDK 提取，key 需本地 `.env.local`；按用户拍板统一收敛进 Supabase 后，已删除该层并卸载 `ai`/`@ai-sdk/openai` 依赖——模型调用不再经过 Next。）

### 启用方式

```
supabase secrets set TOKENDANCE_API_KEY=...        # 已有（agent-runner 同用），无需重复配
NEXT_PUBLIC_AGENT_ENABLED=1                        # frontend/.env.local，开真模型开关
```

模型与网关常量在 `supabase/functions/_shared/providers.ts`（`CHAT_API_KEY_ENV`/`CHAT_URL`/`CHAT_MODEL`）。不配 key 或开关不开即规则版，行为与集成前逐字一致。

### 验证

- `tsc --noEmit` 0 错；backend-session 72 + panel/brief-agent 34 测试全绿；eslint 改动文件 0 警告
- 未开开关路径：行为与集成前逐字一致；后端 404/未登录/模型失败均自动回退规则版

### 后续演进（窗口已留）

1. 工具循环：`/brief/extract` 升级为带上下文的会话端点（携带 messages 历史），前端 resolver 协议同步升级
2. HITL：沿用现有「确认布置」闸门；深度布置已有 agent-runner 工具循环 + submit_candidates 候选制
3. 会话记忆：跨会话记住已确认尺寸/人数（Supabase 持久化）
4. 生产部署：零额外工作——key 已在 Supabase secrets，端点随 scene-api 发布
