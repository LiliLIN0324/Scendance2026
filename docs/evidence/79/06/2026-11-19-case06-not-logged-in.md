# #6 用例 · 分支一：未登录（2026-11-19 第六轮）

> 口径：正式站 + 真实浏览器 + **无任何会话**（不注入 cookie、不注入 localStorage）
> 结论：**这一分支成立**——未登录时模型理解链路完全不通，界面如实退回，不发任何模型请求。

## 1. 环境

| 项 | 读数 |
| --- | --- |
| 站点 | `https://scendance-scene-planner-ewz.pages.dev/` |
| 会话 | 无（`document.cookie` 为空数组；无 `sb-wkhfvnzgopjdzxlmycks-auth-token`） |
| 认证请求 | **0 次**（netlog 中 `/auth/v1/*` 命中数 = 0；没有匿名签入、没有 token 刷新） |
| console error | 0 |

原始读数：`docs/evidence/79/06/2026-11-19-not-logged-in.json`；截图：`2026-11-19-not-logged-in.png`。

## 2. 三条关键读数

### 2.1 零模型请求

发出的两句都**没有**产生 `/assistant/chat` 或 `/assistant/chat/stream` 请求：

```
chatRequests（模型通道）: []
```

应用把消息接进了**待续需求槽**（pending brief），本地回：

> 「还没定在哪。先在地图上定地点、圈出可用范围，或直接说出城市/场馆/地址；地点定了再谈布置、动线和分区。**这句我先留着。** 下一步：在地图上选地点。」

这是设计内的"先要地点"分支（`outdoor-pending-task` / `pending-brief`），不是静默失败。

### 2.2 地点候选照样能检索（读路径不依赖登录）

```
GET 200 /api/amap-place?keywords=杭州 IN77&limit=6&center=…
GET 200 /api/tdt-area?keywords=杭州 IN77&limit=3&near=…
GET 200 /api/place-shape?name=杭州湖滨银泰in77&near=…
```

下拉里 6 条候选照常出现（`outdoor-place-search-option-0..5`）。**没有**任何 `scene-api` 调用——未登录时工作台不碰云端。

### 2.3 未登录时"设为场地"这步走不通，且说清了原因

场地确认卡上出现的是：

> 「我理解为『杭州湖滨银泰in77』，设为场地？ …」
> 「**没有候选，请补充城市或地址**」
> 「没搜到候选场地。换个说法再说一句，或点右栏『地图选址』手动圈。」

即：**未登录 → 走不了模型理解 → 候选无法与模型侧的场地识别对上 → 界面如实说"没有候选"**，而不是假装成功。

## 3. 与第五轮的差异（如实记录，不掩盖）

第五轮（`2026-11-18-case06-blocked.md`）观测到的未登录形态是"**输入框被禁** + 文案『登录后继续这次选址』"。本轮观测到的形态是"**输入框不禁**（placeholder 为常规提示），消息被接进待续需求槽、并给出『没有候选，请补充城市或地址』"。

两种形态的共同点：**零模型请求、零云端写、不假装成功**。差异原因待人确认（本轮用的是全新 profile + 未走登录卡入口；第五轮可能点过登录卡后停在另一种态）。

## 4. 判定

| 维度 | 结论 | 依据 |
| --- | --- | --- |
| 固定数据 | pass | `outdoor-login-copy` / `turn-failure-diag`（既有测试） |
| 真实浏览器 | **pass** | 零模型请求、零云端写、界面如实说明 |
| 真实云端 | n/a | 未登录时不触达云端（这正是被测行为） |
| 本分支结论 | **pass** | 四类阻塞中的第一类已单独触发并取证 |

## 5. 另外三类阻塞（尚未单独触发）

| 分支 | 触发条件 | 现状 |
| --- | --- | --- |
| 功能关闭 | `NEXT_PUBLIC_CONVERSATION_API_ENABLED=0`（前端构建变量）或云端 `CONVERSATION_API_ENABLED=0`（503 `CONVERSATION_API_DISABLED`） | **blocked**：需改构建变量或云端函数环境变量=部署级动作，未获授权 |
| 额度不足 | 上游返回 402 / body 含 `insufficient_quota`/`欠费`/`额度不足` | **blocked**：额度不是从表读的（`scene_private.budgets` 的上限已被 `20261003180000_unlimited_ai_usage.sql` 置空，改表无效）；只能把 `AGENT_CHAT_*` 槽指向一个返 402 的上游 = 云端环境变量改动 |
| 网络超时 | 服务端 25s 超时（`assistant-chat.ts:85` `timeoutMs` 默认 25000） | **blocked**：需把槽位指向一个 25s 不返回的上游 = 同样是云端环境变量改动 |

代码依据见 `docs/evidence/79/06/` 同目录的阻塞分支说明与 `supabase/functions/_shared/assistant-chat.ts`、`http.ts`、`agent-error-view.ts`。
