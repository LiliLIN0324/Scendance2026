# #6 用例 · 剩余三类阻塞的可执行触发 runbook（2026-11-19 第六轮）

> 口径：**只读 runbook**。本轮只读代码与文档，**没有改任何云端环境变量、没有部署、没有重新构建前端、没有提交**。
> 目的：把「功能关闭 / 额度不足 / 网络超时」三类的**触发点、开关名、当前值来源、最小改动、恢复步骤、预期界面文案**写成别人能照着做的一页纸，并说清每一步是否必须人授权。
> 已成立的一类见 `2026-11-19-case06-not-logged-in.md`（未登录，不再重跑）。

## 0. 一句话结论

| 分支 | 代码里能不能精确触发 | 生产上现在能不能取证 | 卡在哪 |
| --- | --- | --- | --- |
| 功能关闭 | 能，三个开关各有明确落点 | **不能** | 关 `CONVERSATION_API_ENABLED` = 改云端 secret；关 `NEXT_PUBLIC_CONVERSATION_API_ENABLED` = 重新构建并发布前端。两者都是部署级动作 |
| 额度不足 | 能，`402` 或上游 body 命中额度词即进 `quota_exhausted` | **不能** | 额度**不是**从 `scene_private.budgets` 读的（上限已被迁移置空），改表无效；唯一触发入口是把模型槽位指向一个稳定返 402 的上游 = 改云端 secret |
| 网络超时 | 能，服务端 `timeoutMs` 默认 25s | **不能** | 要真触发得让上游 25s 不返回 = 把槽位指向慢地址 = 改云端 secret |

三条都**不是产品缺陷**，是「缺一次被授权的部署窗口」。在此之前，三条的代码路径与分类事件已有**离线证据**（见第 5 节），可立即复跑。

## 1. 三条分支的代码事实

### 1.1 开关与错误码落点

| 层 | 精确名字 | 落点 | 行为 |
| --- | --- | --- | --- |
| 后端：整个对话函数 | `CONVERSATION_API_ENABLED` | `supabase/functions/_shared/conversation-api.ts:33` | `!=='1'` 时先走一次「已认证但不发模型」的探针（沿用 CORS/守卫/401），探针通过后返回 `503` + `{"error":{"code":"CONVERSATION_API_DISABLED"}}`（同文件 `:38`） |
| 后端：单条问答路由 | `ASSISTANT_CHAT_ENABLED` | `supabase/functions/_shared/api.ts` 的 `/assistant/chat` 分支 | `!=='1'` 时返回 **HTTP 200** + `{"status":"disabled","answer":null}` |
| 后端：需求提取守卫 | `BRIEF_REQUEST_GUARD` | `api.ts` 的 `/assistant/chat`、`/brief/extract` 分支 | 设成 `enforce` 时**先**返回 `503 BRIEF_GUARD_NOT_READY`，会盖住上面两条的观感，触发前必须先确认它为 off/未设 |
| 前端：是否连对话函数 | `NEXT_PUBLIC_CONVERSATION_API_ENABLED` | `frontend/lib/backend-session.ts:416` | `!=='1'` → `conversationClient()` 返回 `null` → 直接本地回 `{status:'disabled',answer:null}`（同文件 `:1738-1739`），**一个请求都不发** |

两个容易踩的点，写在这里免得下一个人重踩：

1. `conversation-api` 在自己内部把 `ASSISTANT_CHAT_ENABLED` 和 `BRIEF_CONVERSATION_ENABLED` 强制成 `'1'`（`conversation-api.ts:22-26`）。所以**只关 `ASSISTANT_CHAT_ENABLED` 打不到对话函数**，只会影响 `scene-api` 的 `/assistant/chat`。要关对话函数，开关就是 `CONVERSATION_API_ENABLED`。
2. `NEXT_PUBLIC_*` 是**编译期**变量（`docs/plans/2026-11-09-production-conversation.md:32`、`docs/plans/2026-11-09-正式站闭环验收清单.md:10`）。只改运行时环境变量不会生效，必须重新 `next build` + 重新发布。

### 1.2 额度不足的分类入口

`supabase/functions/_shared/http.ts` 的 `isUpstreamQuotaExhausted(status, bodyText)`：

```
status === 402  →  true
否则 bodyText.toLowerCase() 命中以下任一 → true
insufficient_quota / insufficient_credits / insufficient credits / insufficient balance /
balance insufficient / out of credit / out of credits / quota exceeded / quota exhausted /
no credits / 余额不足 / 余额已耗尽 / 账户余额不足 / 欠费 / 额度不足
```

命中后 `fetchJson` 抛 `ApiError('PROVIDER_QUOTA_EXHAUSTED', 402)`；`assistant-chat.ts` 的 catch 把它归成 `fail('quota_exhausted')`，并打一条分类事件；**不会**串到其它槽位。

### 1.3 超时的唯一来源

`supabase/functions/_shared/assistant-chat.ts`：`const timeoutMs = input.timeoutMs ?? 25000;`（约第 85 行），合法区间 `1..110000`，越界直接 `invalid`。

- `conversation-api` 的 `/assistant/chat` **不传** `timeoutMs` → 走默认 **25000ms**。
- 到点 `controller.abort()`，`Promise.race` 返回 `fail('timeout')`，与 `provider_error` 分开（`agent-panel.tsx:3068` 把 `timeout` 与 `provider_error` 都算可重试）。
- 这是**服务端到上游**的超时，不是浏览器到服务端的超时。浏览器侧断网不会产生 `status:'timeout'`，只会是 `NETWORK_ERROR`（另一档文案）。

### 1.4 界面文案（四类各有各的落点，不互相撞档）

`frontend/lib/agent-error-view.ts` → `agentErrorView(status)`；调用点在 `frontend/components/room-organizer/panels/agent-panel.tsx:3071`。

| `status` | 标签（stamp） | 正文（message） | 语气 |
| --- | --- | --- | --- |
| `disabled` / `unavailable` | 暂未启用 | 活动问答暂未启用，问题已保留。 | muted |
| `quota_exhausted` | 额度不足 | 该模型额度已用完或欠费，请在上方切换其它模型，或联系管理员充值。 | warn |
| `timeout` | 响应超时 | 服务商这次没在时限内返回，本次未执行；请稍后重试，或把这一句拆短一点再试。 | warn |
| `invalid` / 其它 | 智能理解 | 这次问答没有完成；服务商可能仍在处理或计费，请核对后再试。 | warn |

注意：`CONVERSATION_API_DISABLED`（503）走的是**后端错误路径**，不是 `{status:'disabled'}`。它要么被前端兜底成「智能理解」档，要么由 503 的 `backendFailureText` 出文案 —— 也就是说**「云端 503」和「前端关开关」在界面上不是同一张卡**，取证时不要混为一谈。

## 2. 分支 A · 功能关闭

### 2.1 变量与当前值来源（不打印值）

| 变量 | 当前值从哪来 | 本轮是否读到 |
| --- | --- | --- |
| `CONVERSATION_API_ENABLED` | Supabase 项目 `wkhfvnzgopjdzxlmycks` 的 Edge Function secrets（Dashboard → Project Settings → Edge Functions Secrets，或 `supabase secrets list`） | **未读**。仓库里只有文档值：`docs/plans/2026-11-09-production-conversation.md:24` 记 `1` |
| `NEXT_PUBLIC_CONVERSATION_API_ENABLED` | Cloudflare Pages 的**构建环境变量**（编译期） | **未读**。仓库里只有 `frontend/.env.example:12` 的示例值 `0`；没有生产构建记录能证明线上包是 `1` |
| `BRIEF_REQUEST_GUARD` | 同上 Edge Function secrets | **未读** |

本轮**没有**读取 `.env.local`、**没有**打印任何密钥（一次尝试枚举环境变量名的命令被运行时守卫拦下，未取得任何值）。

### 2.2 最小改动（二选一，都需要授权）

**路线 A1 —— 只关云端（可逆、影响立即生效、推荐用于验收）**

```
# 需人授权 + 需本机有 supabase CLI（本轮实测：CLI 不在 PATH，node v26.2.0 在）
supabase secrets set CONVERSATION_API_ENABLED=0 --project-ref wkhfvnzgopjdzxlmycks
```

- 生效方式：Edge Function 读 secrets 是每次调用时读，无需重新部署。
- 预期取证：已登录状态下发一句 → 收到 **503** `CONVERSATION_API_DISABLED`；日志里**没有** `assistant_chat_failure`（因为根本没到模型层）。
- 恢复：`supabase secrets set CONVERSATION_API_ENABLED=1 --project-ref wkhfvnzgopjdzxlmycks`，或直接在 Dashboard 里改回。
- 界面预期：**不是**「活动问答暂未启用」那张卡，而是 503 兜底/「智能理解」档。这条要如实记录，别按前端开关的文案去对。

**路线 A2 —— 只关前端（不碰云端函数，但等于发布一个降级包）**

1. 在 Cloudflare Pages 把 `NEXT_PUBLIC_CONVERSATION_API_ENABLED` 设为 `0`；
2. 重新构建并发布（`npm --prefix frontend run build` → 静态导出 `frontend/out`）；
3. 预期：输入框仍可输入，但**零 `/assistant/chat` 请求**，界面出「暂未启用 / 活动问答暂未启用，问题已保留。」；
4. 恢复：改回 `1` 并**再发布一次**（编译期变量，改回不重新构建不生效）。

> 代价提醒：A2 要占用一次正式站发布。若本轮目的是「取证」，A1 更小、更快回滚；A2 顺带能验证编译期开关确实被写进产物。

### 2.3 判定须知

`503 CONVERSATION_API_DISABLED` 与 `{status:'disabled'}` 是**两条不同的证据**，都能证明「功能关闭时界面如实退回、不发模型请求」，但对应**不同的开关**。取证表里要写清是哪一条。

## 3. 分支 B · 额度不足

### 3.1 为什么不能靠改表

`scene_private.budgets` 的上限已被 `20261003180000_unlimited_ai_usage.sql` 置空（前一轮已核），额度不再从那张表读。所以：**改数据库不会制造额度不足**。唯一入口是让上游返回 402 / 命中额度词。

### 3.2 触发方式（需授权；三选一，按影响面从小到大）

| 方式 | 要改什么 | 影响面 | 可逆性 |
| --- | --- | --- | --- |
| B1 换槽位指向「返 402 的桩」 | `AGENT_CHAT_BASE_URL` / `AGENT_CHAT_KEY` / `AGENT_CHAT_MODEL` 三项一起指向桩（代码要求 base+key+model 同时非空，否则归 `unavailable`） | 只影响走该槽的请求 | 记下原值即可回滚；但**原值含密钥，必须由人在密钥管理面里回填，不要抄进文档** |
| B2 用产品侧百炼槽 | `BAILIAN_PRODUCT_ENABLED=1` + `BAILIAN_PRODUCT_KEY` 指向一个已欠费的百炼 key | 面同上 | 同上 |
| B3 只借真实欠费 | 什么都不改，等某个真实上游欠费 | 不可控 | —— |

**明确写出：B1/B2 属于改云端 secret，本轮未执行、也不应由助手自行执行。** 另外路线 B1 会短暂把线上模型换成桩，**验收窗口内所有真实用户都会看到额度不足**，必须挑窗口并由负责人点头。

### 3.3 预期结果

- 服务端：`answerAssistantChat` 返回 `{status:'quota_exhausted',answer:null}`，HTTP 仍是 **200**（`api.ts` 的 `/assistant/chat` 直接 `respond(...)` 包一层）；日志一条 `assistant_chat_failure` 且 `reason='quota_exhausted'`，字段里有 `httpStatus`，**没有**上游 body、没有原话。
- 界面：标签「额度不足」，正文「该模型额度已用完或欠费，请在上方切换其它模型，或联系管理员充值。」，并带「重试云端理解」按钮。
- 不得出现：自动切到别的模型后成功（`assistant-chat.ts` 明确 quota 不跨槽）。

### 3.4 恢复

把 B1/B2 的三项/两项 secret 改回原值。**回填前先确认原值来源**（Dashboard 历史或密钥库），不要凭记忆重填。

## 4. 分支 C · 网络超时

### 4.1 触发方式

服务端等上游 25s。要真触发，就得让上游 25s 不返回：

- **C1（云端，需授权）**：把 `AGENT_CHAT_BASE_URL` 指到一个「接受连接但 30s 才回/不回」的地址。同 B1 的代价与窗口要求。
- **C2（本地，零云端、零密钥，推荐先做）**：本机起一个慢桩，然后在**本地**跑同一份 handler。本机没有 `supabase` CLI（实测不在 PATH），所以用 vitest 直接 import handler 更实际 —— 已有测试就是这么做的（见 5.2），也可以自己写一条临时用例把 `timeoutMs` 设成 5s 观察 `timeout` 分支。
- **C3（浏览器断网）**：**不是**这一档。断网走 `NETWORK_ERROR`，文案不同，别拿来冒充超时。

### 4.2 预期结果

- 服务端：`{status:'timeout',answer:null}`，HTTP 200；日志 `assistant_chat_failure` + `reason='timeout'`；不重试其它槽位。
- 界面：标签「响应超时」，正文「服务商这次没在时限内返回，本次未执行；请稍后重试，或把这一句拆短一点再试。」
- 计时：从点击到出卡约 25s（±2s）。**若明显短于 25s 就出这张卡，说明不是这条分支**，要去查 `PROVIDER_HTTP_ERROR` / `transport_error`。

### 4.3 恢复

同上：把 base URL 改回原值。C2 不需要恢复（本地进程退出即结束）。

## 5. 现在就能跑的两条离线证据（零云端、零密钥）

### 5.1 额度不足分支

```
npx vitest run tests/assistant-chat.test.ts tests/http-quota.test.ts
```

已核实的断言（读代码所得，未执行）：`tests/assistant-chat.test.ts:81-89` 用 `mockResolvedValue(new Response(secret,{status:402}))`，断言结果是 `{status:'quota_exhausted',answer:null}`、只调用一次、并断言 `console.warn('assistant_chat_failure', expect.objectContaining({slot:'custom',reason:'quota_exhausted',httpStatus:402}))`、且 warning 参数里不含上游 body。`tests/http-quota.test.ts:25-30` 断言 `fetchJson` 抛 `PROVIDER_QUOTA_EXHAUSTED` 且 details 不带 body。

### 5.2 超时分支

同一条命令里：`tests/assistant-chat.test.ts:101-103`，`fetcher` 返回一个永不 resolve 的 `Promise`，`timeoutMs:5`，断言 `{status:'timeout',answer:null}` 且只调用一次。

> 这两条证明的是「分支存在、分类正确、日志事件正确」，**不等于** #6 要求的「真实浏览器 + 真实云端取证」。验收表里必须分栏写，不能拿单测冒充实跑。

## 6. 建议执行顺序与授权清单

1. **先跑 5.1/5.2**（零风险，可立即做）。→ 确认分类与文案的代码路径没漂。
2. **再做 A1**（关 `CONVERSATION_API_ENABLED`，秒级可逆）。→ 拿 503 证据，随即恢复。
3. **最后做 B1 与 C1**（各占用一段线上模型窗口）。→ 两条可以合并进同一个授权窗口，但必须逐条记录「改了什么、改回什么、谁点的头」。

需要人明确点头的三件事：

| 动作 | 谁授权 | 为什么必须人授权 |
| --- | --- | --- |
| 改 `CONVERSATION_API_ENABLED` | 项目负责人 | 云端 secret = 生产运行配置 |
| 改 `AGENT_CHAT_*` / `BAILIAN_PRODUCT_*` 指向桩 | 项目负责人 | 会让线上所有用户看到额度不足/超时 |
| 改 `NEXT_PUBLIC_CONVERSATION_API_ENABLED` 并重新发布 | 项目负责人 | 等于发一版降级前端 |

## 7. 本轮没做的事（如实列出）

- 没改任何云端环境变量、没部署、没重新构建、没重新发布。
- 没读取 `.env.local`、没打印任何密钥或 token。
- 没在浏览器里重跑未登录分支（沿用 `2026-11-19-case06-not-logged-in.md`）。
- 没执行 5.1/5.2 的命令（只读了测试源码与断言，未跑）。
- 没验证三个开关在**生产**的当前值——仓库里没有生产构建记录，只能给出文档值。
