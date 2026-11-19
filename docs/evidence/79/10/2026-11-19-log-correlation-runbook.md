# #10 · 服务端日志关联的可执行方案（2026-11-19）

> 口径：**只读 runbook**。本轮只读代码与文档，**没有登录 Supabase 控制台、没有调用 Management API、没有读取或写入任何用户数据、没有读取或打印任何 token、没有改云端配置**。
> 项目：`wkhfvnzgopjdzxlmycks`；涉及函数：`conversation-api`、`scene-api`。

## 0. 一句话结论

**精确关联现在做不到，弱关联现在就能做。**

- 代码里唯一「像编号」的东西是前端 `turnId` / `attemptId`（`turn-trace.ts`），但它**不出浏览器** —— `client/scene-client.ts` 的请求头只有 `Authorization` 与 `Content-Type`，没有把 turn id 带给服务端。`turn-failure-diag.ts` 的注释自己也写着「等 M1b 服务端日志接线后，同一编号才会在服务端事件里出现」，即**尚未接线**。
- 服务端只有**分类事件**，没有 id：`assistant_chat_failure`（`_shared/assistant-chat.ts:79`）、`generation_busy`（`_shared/backend.ts:38`）。
- 因此当前能落地的关联是：**「时间窗 + 函数名 + 事件名/状态码」**，配合界面文案做阳性/阴性对照。这条路径不需要改任何代码，只需要有人能读日志。
- **读日志的权限本轮未验证**（见第 2 节）：没有已认证的控制台会话，也没有 Management API 令牌；`supabase` CLI 本机不在 PATH。下一步一条命令见第 6 节。

## 1. 现有「编号 / 请求 id」到底落在哪

| 物件 | 生成处 | 形制 | 是否离开浏览器 | 能否与服务端日志对上 |
| --- | --- | --- | --- | --- |
| `turnId` | `frontend/components/room-organizer/lib/turn-trace.ts` `newTurnId()` | `t-<毫秒base36>-<4位hex>`，同毫秒内序号递增 | **否** | **否** |
| `attemptId` | 同文件 `newAttemptId()` / `beginAttempt()` | `a-<毫秒base36>-<4位hex>`，一次真实请求一个 | **否** | **否** |
| 失败卡上那行「编号」 | `turn-failure-diag.ts` `describeModelFailure()` → `summarizeTurn(trace)` | 单行：`turn t-… route=conversation stages=… term=failed total=… code=model_notice` | 只显示给用户，可手抄 | **否**（服务端没有同串） |
| 服务端分类事件 | `_shared/assistant-chat.ts:79` `console.warn('assistant_chat_failure',{slot,reason,…})` | 事件名 + `slot` / `reason` / 可选 `httpStatus` `providerCode` `finishReason` | —— | 这是**唯一**服务端侧可查的线索 |
| 另一个服务端事件 | `_shared/backend.ts:38` `console.warn(JSON.stringify({event:'generation_busy',actor,action,status,at}))` | 生成闸门专用，带 `actor` | —— | 与 #6 四类无关 |
| 平台自带调用标识 | Supabase Edge Functions 运行时 | 每次调用一行日志，控制台里带该次调用的执行/请求标识（**字段名以控制台实际显示为准，本轮未登录控制台，不作断言**） | —— | 能定位「哪一次调用」，但**不知道是用户点的哪一句** |

两个由此推出的硬结论：

1. **不能拿失败卡上的编号去日志里搜。** 搜不到不是日志丢了，是这个编号从来没发出去。
2. **反向也成立。** 日志里一条 `assistant_chat_failure` 无法指回某个用户、某一轮对话（这是刻意的隐私设计，不是缺陷）。

## 2. 三条日志读取路径与权限现状

| 路径 | 具体入口 | 本轮状态 | 需要什么 |
| --- | --- | --- | --- |
| Dashboard（首选，零额外凭据） | `https://supabase.com/dashboard/project/wkhfvnzgopjdzxlmycks/logs/edge-logs`，把 function 选成 `conversation-api`，时间窗按需收窄 | **未执行**（无已登录会话） | 项目成员/owner 的浏览器登录态 |
| Management API | `GET https://api.supabase.com/v1/projects/{ref}/analytics/endpoints/logs.all`，`Authorization: Bearer <PAT>`，用 `sql=` 传查询 | **未执行**（无令牌，且未读取任何本地令牌） | 一个有项目读权的 Personal Access Token。端点是公开文档口径，**本轮无令牌故未自证**；401/403 即无权限 |
| Supabase CLI | `supabase` 本机**不在 PATH**（实测），且 `functions` 子命令面向 serve/deploy/secrets，仓库内也没有任何「读远端日志」的封装（`grep` 无命中） | 不可用 | 先装 CLI；仍不解决读日志，只是方便设 secrets |

**结论：现在能不能做？** —— 能读日志的人（项目成员）**现在就能做**第 3 节的流程；作为助手的我**不能**，缺的是控制台登录态或一枚只读 PAT，属于必须人授权的凭据。

## 3. 关联方案：一条真实失败 + 一条纯本地成功

前置：页面已登录、`conversation-api` 已启用。准备一张表，边做边填。

| # | 时间（精确到秒） | 用户动作 | 界面结果 | 期望日志 |
| --- | --- | --- | --- | --- |
| P | t0 → t1 | 发一句会失败的（见 3.1） | 失败卡，记下 stamp 与正文 | 窗口内 `conversation-api` 有 `assistant_chat_failure` |
| N | t2 → t3 | 走纯本地分支（见 3.2） | 本地回话，无失败卡 | 同窗口 `conversation-api` **0 条** |

### 3.1 阳性：一条真实失败

任选一条**已经真实发生过**的失败，不要为了这条去改生产配置：

- 额度不足（若上游正好欠费）：界面「额度不足 / 该模型额度已用完或欠费…」→ 期望 `reason='quota_exhausted'` 且事件里带 `httpStatus`。
- 超时：界面「响应超时 / 服务商这次没在时限内返回…」→ 期望 `reason='timeout'`。
- 上游 4xx/5xx：界面「智能理解 / 这次问答没有完成…」→ 期望 `reason='http_error'` 且带 `httpStatus`。

操作：点一次 → 出卡后**立刻**记下本地时间（`t0` 点发送、`t1` 出卡）。查日志窗口 `[t0-10s, t1+10s]`。

查询条件（Dashboard 里怎么填，按控制台实际字段名调整）：

```
function  = conversation-api
时间窗    = 上述 t0-10s ~ t1+10s
文本匹配  = assistant_chat_failure
```

判读规则：

- 命中 1 条、`reason` 与界面档位一致 → **阳性成立**：界面分类 = 服务端分类。
- 命中 0 条但界面确实出了失败卡 → 说明失败发生在**到达模型层之前**（例如 401/403/503/参数校验），去查同窗口有没有 `error` 级或非 200 的记录，**不要记成「日志缺失」**。
- 命中多条 → 说明这一轮尝试了多个槽位（`slot` 不同），按 `slot` 分别记，属正常。

### 3.2 阴性：一条纯本地成功

用第六轮已观测到的**待续需求槽**分支：问一句还没有地点的话，界面本地回「…这句我先留着。下一步：在地图上选地点。」（见 `2026-11-19-case06-not-logged-in.md` §2.1）。

- 期望：**零** `/assistant/chat` 请求，因此同窗口 `conversation-api` 日志 **0 条**。
- 这条的价值：证明「日志里没有」不等于「日志坏了」，而是这一次真的没发请求。

**必须写明的前提**：第六轮那次同时处于**未登录**态，零请求部分归因于登录，不能直接搬到已登录态。所以已登录态下跑阴性对照时，要同时看一眼浏览器 Network 里 `/assistant/chat` 是否为 0 —— 若不为 0，这条对照作废，改用「失败前后各取一段空窗作对照」的弱形式。

### 3.3 交叉校验（不需要任何新权限）

拿失败卡的 `turn` 行（用户可抄）与日志条数做**计数级**对账，而不是 id 级：

- 用户抄一行 → 预期日志恰好 1 条（或按 `slot` 数条）。
- 用户抄三行 → 预期日志 3 条。
- 计数对不上，才是真问题（丢日志 / 多打日志 / 前端没真发）。

## 4. 弱关联能证明什么、不能证明什么

| 能 | 不能 |
| --- | --- |
| 这一次失败**是不是模型层**失败的（有/没有 `assistant_chat_failure`） | 这条日志属于哪个用户、哪一句原话 |
| 服务端分类与界面档位**是否一致** | 同一个 `turnId` 在服务端发生了什么（id 不存在） |
| 某分支（如待续需求槽）**确实没发请求** | 跨用户、跨设备的整链追踪 |
| 上游是超时、额度、还是 4xx/5xx（`reason` + `httpStatus`） | 上游具体回了什么 body（刻意不落日志） |

这条边界要写进签字材料：**#10 目前可交付的是「分类一致性 + 有无请求」级别，不是「一键凭编号查全链」级别。**

## 5. 要做精确关联的最小接线改动（本轮不执行）

按最小改动、且不引入隐私风险排序：

1. **前端带上编号**：`client/scene-client.ts` 的 `request()`（第 66-74 行构造 headers 处）在 `!isPublic` 分支里加一个头，值取当前 `attemptId`（形制已被 `turn-trace.ts` 约束成 `a-[a-z0-9-]+`，天然安全）。
2. **服务端接收并只打编号**：`_shared/api.ts` 的 `/assistant/chat` 分支读该头，用同一套白名单正则校验（形状不符就丢弃，不要回 400），再传给 `answerAssistantChat`。
3. **进分类事件**：`answerAssistantChat` 的 `diagnose()`（`assistant-chat.ts:78-80`）把校验后的编号作为额外字段写进 `console.warn('assistant_chat_failure', …)`。**只加编号，不加原话、不加用户 id、不加坐标。**
4. 之后失败卡上的 `turn …` 行才能直接在日志里搜到。

以上属于**产品代码改动**，需走正常评审与发布，本轮不碰。注意：`api.ts` 的 `/assistant/chat` 与 Edge Function 契约相关，按项目规范需要人 review。

## 6. 需人授权清单与「下一步一条命令」

### 6.1 需人授权

| 事项 | 性质 | 说明 |
| --- | --- | --- |
| 提供只读 PAT（或由人代跑查询） | 凭据授权 | 助手**不应**自行从磁盘/环境里找 token；本轮也没有找到或使用任何 token |
| 登录 Dashboard 查日志 | 账号操作 | 只有项目成员能做 |
| 第 5 节的接线改动 | 产品代码 | 需 review，本轮不写 |

### 6.2 下一步一条命令（只读、不碰日志、不碰用户数据、不打印 token）

先用**项目元数据**探一次权限基线：`200` = 这枚令牌有项目读权，可以继续查日志；`401/403` = 无权限，改走 Dashboard。

```
curl -sS -o NUL -w "%{http_code}\n" -H "Authorization: Bearer $env:SUPABASE_ACCESS_TOKEN" https://api.supabase.com/v1/projects/wkhfvnzgopjdzxlmycks
```

（Linux/macOS 把 `-o NUL` 换成 `-o /dev/null`，`$env:SUPABASE_ACCESS_TOKEN` 换成 `$SUPABASE_ACCESS_TOKEN`。令牌由人放进环境变量，助手不读取、不打印。）

拿到 `200` 之后才谈日志查询；若走 Dashboard，则直接用第 2 节的 URL，无需任何令牌。

## 7. 本轮没做的事（如实列出）

- 没登录 Supabase 控制台，没调用 Management API，没跑第 6.2 的命令。
- 没读取、没打印任何 token / 密钥 / 用户数据。
- 没改 `client/scene-client.ts`、`_shared/api.ts`、`_shared/assistant-chat.ts` 等任何产品代码。
- 没验证生产上 `conversation-api` 的实际日志条数与字段名——这需要第 2 节的权限。
