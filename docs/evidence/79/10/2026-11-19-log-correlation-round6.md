# #10 · 服务端日志关联（第六轮补证，2026-11-19）

> 口径：正式项目 `wkhfvnzgopjdzxlmycks` 的只读日志查询；使用本机已登录的 Supabase CLI 凭据，令牌只在内存中使用，未打印、未落盘。
> 结论：**服务端日志已可读，#10 从 `blocked` 推到 `partial`，仍不记 pass**。已找到一条真实 `assistant_chat_failure`，并拿到 #1 `invalid` 的“有请求、无模型事件”阴性对照；但仍缺同一轮的 UI 失败卡与纯本地成功的时间戳对照。

## 1. 入口：旧 `logs.all` 已下线，新 `logs` 走 ClickHouse

2026-11-19 实测：

| 入口 | 结果 |
| --- | --- |
| `GET /v1/projects/{ref}/analytics/endpoints/logs.all?sql=...` | **410 Gone**，正文明确写 `The logs.all endpoint has been removed. Use GET /v1/projects/{ref}/analytics/endpoints/logs` |
| `GET /v1/projects/{ref}/analytics/endpoints/logs?sql=...&iso_timestamp_start=...&iso_timestamp_end=...` | **200**，返回统一 `logs` 表 |

新入口的硬约束（来自 Supabase changelog + 实测）：

- SQL 必须是 **ClickHouse 方言**；
- 统一表名 `logs`，用 `source` 列区分来源（`edge_logs` / `function_edge_logs` / `function_logs` / `auth_logs` / …）；
- `iso_timestamp_start` / `iso_timestamp_end` 必须成对给，范围不超过 24 小时；不给则只查最近 1 分钟；
- 旧表名 `function_logs` 不能直接当新入口的 `FROM` 表；新入口里它是 `source = 'function_logs'`。

权限基线：`GET /v1/projects/{ref}` 返回 **200**；日志查询返回 **200**。令牌没有出现在任何输出或证据文件里。

## 2. 阳性：一条真实模型失败

在整个可查窗口 `2026-11-19T00:00:00Z`–`05:00:00Z` 内，`event_message LIKE '%assistant_chat_failure%'` **只有 1 条**：

```
2026-11-19T01:54:29.450Z  source=function_logs
assistant_chat_failure { slot: "openai-next", reason: "invalid_shape" }
```

原始读数：`2026-11-19-logs-assistant-failures.json`。

把窗口收窄到 `01:54:15Z`–`01:54:45Z`，同一条链的请求/事件顺序是：

| 时间（UTC） | 层 | 读数 |
| --- | --- | --- |
| 01:54:24.564 | `function_edge_logs` | `OPTIONS 204 /functions/v1/conversation-api/assistant/chat/stream` |
| 01:54:27.285 | `function_edge_logs` | `POST 200` 同一路径 |
| **01:54:29.450** | **`function_logs`** | **`assistant_chat_failure { slot: "openai-next", reason: "invalid_shape" }`** |
| 01:54:36.848 | `function_edge_logs` | `OPTIONS 204` 同一路径（重试） |
| 01:54:40.235 | `function_edge_logs` | `POST 200` 同一路径（重试） |

原始读数：`2026-11-19-logs-invalid-shape-window.json`。

这证明了三件事：

1. 服务端分类事件**确实会落**，不是“日志里永远没有”；
2. `reason` 能落到 `invalid_shape` 这一档，和代码里的 `diagnose(slot,'invalid_shape')` 对得上；
3. 失败后客户端**没有静默丢弃**，40 秒内又发了一次请求；但服务端日志没有 turn id，无法把这两次请求和界面上的某一张卡逐字绑定。

**边界**：现有证据里没有 09:54 本地时刻的 UI 截图/JSON，因此不能把这条事件冒充成“同轮 UI 卡已对照”。它只能作为**服务端阳性**。

## 3. 阴性：#1 的 `invalid` 是模型前失败，服务端没有事件

#1 复跑时，分区用途回合返回「输入需调整」；对应窗口 `03:23:45Z`–`03:24:30Z` 的日志是：

```
03:24:00.538  function_edge_logs  OPTIONS 204 .../conversation-api/assistant/chat/stream
03:24:02.442  function_edge_logs  POST 200    .../conversation-api/assistant/chat/stream
03:24:13.145  function_edge_logs  OPTIONS 204 .../conversation-api/assistant/chat/stream
03:24:13.836  function_edge_logs  POST 200    .../conversation-api/assistant/chat/stream
```

**0 条** `assistant_chat_failure`。原始读数：`2026-11-19-logs-invalid-input.json`。

代码对得上：`supabase/functions/_shared/assistant-chat.ts:84` 在请求 schema 失败、命中链接/隐私信息时直接 `return fail('invalid')`，**不调用 `diagnose`**；因此 HTTP 仍是 200，但不会有 `assistant_chat_failure`。这解释了为什么 #1 的 UI 出了「输入需调整」，日志里却只有 200：

- 不是日志坏了；
- 不是模型层失败；
- 是**模型调用前的输入校验失败**，按设计没有分类事件。

这条对 #10 的价值：证明“日志里没有”必须结合代码路径解释，不能直接判成“丢日志”。

## 4. 当前能证明 / 不能证明

| 能 | 不能 |
| --- | --- |
| 服务端日志可读，新 `logs` 入口可用 | 用失败卡上的 `turn t-…` 编号直接搜日志 |
| 01:54:29Z 发生过一次 `openai-next / invalid_shape` | 这条事件对应哪个用户、哪一句原话 |
| 该事件前后有同一路径的 200 请求与一次重试 | 同一轮的 UI 卡与事件 id 级绑定 |
| #1 `invalid` 窗口有 POST 200、零分类事件，符合模型前校验 | 把“零事件”当成所有失败都无日志 |
| `source` + 时间窗 + 事件名可做弱关联 | 跨用户、跨设备的全链追踪 |

## 5. 判定

| 维度 | 结论 | 依据 |
| --- | --- | --- |
| 固定数据 | pass | 事件名/字段/时间窗可复跑 |
| 真实浏览器 | partial | 有 #1 的 UI 失败卡；但没有 01:54 同轮 UI 卡 |
| 真实云端 | **partial** | 已读真实日志并找到真实事件；缺同轮 UI 对照与纯本地成功样本 |
| 本条结论 | **partial** | 从 blocked 前进一格，不记 pass |

要推到 pass，还差两格：

1. 在一条**已知时间**的 UI 失败卡旁边，查到同窗口的 `assistant_chat_failure`，并记录 `reason` 与界面档位一致；
2. 在一条**已知时间**的纯本地成功（例如 #4 的无范围退回）旁边，证明同窗口 `conversation-api` 请求为 0，且日志查询本身正常。

`turnId` 仍然不出浏览器，所以即使补齐这两格，也只能做到「时间窗 + 分类一致性」，做不到「一键凭编号查全链」。

## 6. 原始文件

- `2026-11-19-logs-assistant-failures.json`：00:00–05:00Z 全部 `assistant_chat_failure`，仅 1 条。
- `2026-11-19-logs-invalid-shape-window.json`：01:54:15–01:54:45Z 请求/事件顺序。
- `2026-11-19-logs-invalid-input.json`：03:23:45–03:24:30Z #1 `invalid` 窗口，0 条分类事件。
