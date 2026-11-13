---
name: scendance-model-chain
description: 幕景(Scendance) 模型链路的排障与改造手册：UI 聊天不出话/罐头回答/「未通过校验」/要换供应商/要加模型槽位/要改超时与兜底顺序/要给新模型做选型评测时使用。含生产实际字节与代码的差异、profile 级 provider 选择（chat-provider.ts）、conversation-api 主动掐断兜底链的那一行、materialQueries 严格 schema 陷阱、以及"用真实契约跑选型 bench"的方法与可信边界。仓库 C:\幕景\Scendance2026，Supabase 项目 wkhfvnzgopjdzxlmycks。
metadata:
  category: product
  repo: C:\幕景\Scendance2026
  verified_at: 2026-11-14
  verified_head: 21a05ef8
---

# 幕景模型链路：排障与改造

## 动手前先跑一遍自检（这份文档会过期，代码不会）

文档里的行号、测试名、结论都是**某一个时点**的快照；这个仓库推进很快（本次会话期间 HEAD 就动过十几次，我还亲眼见过一个已打的补丁被回滚）。所以**先自检再相信它**：

```powershell
cd <仓库>\.dsh\skills\scendance-model-chain\bench
node sync-contract.mjs      # 顺带告诉你：契约副本是否还跟仓库同步、hoist 在不在
```

然后按下面三条核对文档是否还成立（任一不成立就以代码为准，并顺手更新文档）：

```powershell
# 1) 兜底链是否仍被 conversation-api 主动掐掉
Select-String -Path supabase\functions\_shared\conversation-api.ts -Pattern 'retry unrelated|TOKENDANCE_API_KEY'
# 2) 请求级 provider 选择是否仍是那 6 个 id
Select-String -Path supabase\functions\_shared\chat-provider.ts -Pattern 'CHAT_PROVIDER_IDS'
# 3) 契约是否仍是 strict 槽位 schema
Select-String -Path supabase\functions\_shared\brief-extract-contract.ts -Pattern 'briefSlotSchema.strict'
```

## 先读这一条（最容易踩的认知错误）

**「代码里的」不等于「线上跑的」。** 这个项目同一个文件有三个版本会互相打架：

| 版本 | 怎么拿 |
|---|---|
| **DEPLOYED（线上真身）** | `npx supabase functions download <name> --project-ref wkhfvnzgopjdzxlmycks --use-api` |
| **HEAD（已提交）** | `git show HEAD:supabase/functions/...` |
| **工作区（在途改动）** | 磁盘上直接读，可能还没提交、也可能正被另一个 agent/编辑器改 |

排查任何"线上不对"的问题，**先锚定 DEPLOYED 的字节**，否则会对着工作区里一份还没部署的代码推理。
注意：`download` 遇到 `source/assets/library/merged.json` 会 stderr 报错并非零退出，属**部分解包**（`_shared/*.ts` 通常已完整），不要因此认为下载失败。

## 分层定位（按症状走）

```
UI 聊天(带历史) ──▶ conversation-api/brief/extract ─┐
单发理解        ──▶ scene-api/brief/extract ─────────┤ 同一份 _shared/api.ts
                                                    ▼
                              请求级 provider 选择（2026-11 新增）
                              未指定 → 逐级兜底链
```

**判断"是不是模型真的没跑"**：`enabled:false` 且 ~1 秒内返回 = 开关/配置问题；`enabled:true, extraction:null, reason:...` = 模型跑了但失败，`reason` 逐字就是答案。

## 三个开关（缺一个就出罐头回答）

| secret | 作用 | 缺失症状 |
|---|---|---|
| `BRIEF_CONVERSATION_ENABLED=1` | UI 多轮对话放行 | 快返 `enabled:false` |
| `CONVERSATION_API_ENABLED=1` | 该函数总开关 | 直接不可用 |
| provider 三件套 `BASE_URL/KEY/MODEL` | 供应商凭据 | `MODEL_PROVIDER_INCOMPLETE` |

## 兜底链的真相：链是好的，但被一个 wrapper 掐了

`_shared/api.ts` 里的多供应商视图链是完整可用的（bailian → AGENT_CHAT_* → Tokendance → DeepSeek，前一级失败自动切下一级）。

但 `_shared/conversation-api.ts` 里有这么一行（**故意**，上面有注释 `Do not ... retry unrelated providers`）：

```ts
if(minimax&&['TOKENDANCE_API_KEY','DEEPSEEK_API_KEY'].includes(key))return '';
```

`AGENT_CHAT_PROFILE=minimax` 时它把第 3、4 层的凭据抹成空串 ⇒ 默认链塌成 1 次尝试。
**后果**：MiniMax 一挂，前端就降到本地规则引擎 = 用户看到的"罐头回答"。

还有一批测试**锁死**了这个行为。2026-11-14 实测：**全 tests 目录共 79 处** `toHaveBeenCalledOnce`，其中与本议题相关的集中在 3 个文件（合计 17 处）。自己数：

```powershell
cd <仓库>
Get-ChildItem tests -Filter *.test.ts | Select-String toHaveBeenCalledOnce | Group-Object Filename |
  Sort-Object Count -Descending | Select-Object Count,Name -First 10
```

最关键的几条：

- `tests/conversation-minimax-route.test.ts` — "brief failure makes only one MiniMax attempt…"
- `tests/brief-conversation-api.test.ts` — "fails closed if incomplete" / "sends exactly one provider request"
- `tests/brief-extract-api.test.ts` — "没有可用供应商时如实报首选供应商的失败原因，不静默"

**想恢复自动兜底，这不是 bug 修复，是产品决策**：要同批改这些测试，并接受"降级后模型身份/计费会变"（提示词还要求模型逐字自报型号）。

## 换 / 加供应商：不要再动那一行了

`_shared/chat-provider.ts` 提供**请求级槽位选择**，这是正当路径（2026-11-14 时已提交，commit `922aa7bb`）：

```ts
export const CHAT_PROVIDER_IDS = ['default','bailian','minimax','custom','tokendance','deepseek'] as const;
```

- 请求体带 `provider: "deepseek"` ⇒ `chatProviderView()` 清空其它槽位，**只打这一家、失败如实报错**。
- 不带（`default`）⇒ 沿用逐级兜底链。
- 前端只能在**已配置**的槽位间选（`chatProviderConfigured()` 只校验字段存在，不证明额度/权限）。
- `bailian` 槽位不可用于 agent 工具循环（`chatProviderAgentTools()` 返回 false）；`minimax` 需要 `MINIMAX_AGENT_TOOLS_ENABLED=1`。

**加一个新供应商** = 配置 `BASE_URL/KEY/MODEL` 三件套，**不用改代码** —— 但有硬约束（`providers.ts:133`）：

```
AGENT_CHAT_PROFILE 只接受 'minimax' 或 'bailian-qwen'，其它值直接 503 MODEL_PROVIDER_PROFILE_INVALID
```

所以要接任意 OpenAI 兼容端点（DeepSeek 官方、自建网关、本地代理都算），必须 **`AGENT_CHAT_PROFILE` 留空**，让它走 `custom` 分支；填了别的值不是"没生效"，是**直接报错**。

`custom` 端点的 URL 校验（`providers.ts:141-142`）：
- `https:` 随便（但不能有 username/password/query/hash）
- `http:` **只允许** `localhost` / `127.0.0.1` / `[::1]` 三个主机名
- 选 `bailian-qwen` 时额外钉死：必须阿里云 dashscope 标准域名 + 路径必须 `/compatible-mode/v1`（`providers.ts:146-151`）

## 契约陷阱：一个键放错层，整轮作废

`brief-extract-contract.ts` 里 `briefSlotSchema` 是 `.strict()`：模型把 envelope 的 `materialQueries` 写进 `extraction` 里，**整轮丢弃**（实测 45 个模型一轮里出现 14 次）。

**修法（注意：截至 2026-11-14 这个修法并不在仓库里，别以为已经有了）**：在 `parseBriefConversation` 的归一化处、strict schema **之前**，把嵌套的 `materialQueries` 提到 envelope；envelope 已有值优先；**不削弱**逐字证据校验（`normalizedIncludes` 那套判据原样保留）。

参考实现（当时验证过：5 轮获救 / 0 回归；样本级回放 121 条）：

```ts
const raw = input && typeof input === 'object' && !Array.isArray(input) ? (input as Record<string, unknown>) : null;
const rawSlot = raw?.extraction;
const hoisted = rawSlot && typeof rawSlot === 'object' && !Array.isArray(rawSlot) && Object.prototype.hasOwnProperty.call(rawSlot, 'materialQueries')
  ? (() => { const next = { ...(rawSlot as Record<string, unknown>) }; const nested = next.materialQueries; delete next.materialQueries;
      return { ...raw, extraction: next, materialQueries: raw?.['materialQueries'] ?? nested }; })()
  : raw;
const normalized = hoisted ? { ...hoisted, extraction: normalizeBriefMobility(hoisted.extraction) } : input;
```

落这个改动时，配套要有：一条断言"嵌套能被提上来"、一条"envelope 优先"、一条"证据不逐字时仍然拒绝"，并确认 `brief-conversation-api.test.ts` / `brief-extract-api.test.ts` 里原有的失败数**没有增加**（那两个文件有 3 条与本次无关的预存在失败）。

契约里其他硬规则（改提示词/换模型前必须知道）：
- `evidence` 必须**逐字**是用户原话子串（空白/全半角差异走 `normalizedIncludes`，但**不是**改写也认）
- 输出含 `<think>` 或 `finish_reason ≠ stop` 直接作废
- 推理型模型不适合直接接 brief

## 用真实契约做模型选型（方法 + 可信边界）

**不要**凭感觉选模型。这个 skill 自带一套可直接跑的 bench（`bench/` 目录，自包含、无需网络外的依赖）：

```powershell
cd <仓库>\.dsh\skills\scendance-model-chain\bench
node sync-contract.mjs                 # 先从仓库源码现场生成可执行契约副本（必做）
node bench.mjs --models=trae/deepseek-v4.1-flash,qodercn/qfmodel --cases=c1,c5
node bench.mjs --concurrency=4         # 不带 --models 就跑全部候选项
```

- `sync-contract.mjs` **必须先生成**：它把 `supabase/functions/_shared/brief-extract-contract.ts` 复制成可执行的 `contract.real.ts`（只改写前两行 import）。**契约一改就要重跑**，否则你会拿过期规则给模型打分——这种错误最隐蔽。
- 打分用的是契约里真实的 `parseBriefConversation` / `parseModelBrief`：严格 JSON、逐字证据、无 `<think>`、`finish_reason=stop`、字段值正确。
- 换端点：`BENCH_BASE` / `BENCH_KEY` 环境变量可指向任意 OpenAI 兼容端点（例如直连官方去测生产模型）。
- 倍率标签是可选的：`bench/catalog.json` 只是给模型贴 `x0.08 / 免费` 这类标签用的快照，**不入库**（`bench/.gitignore` 已忽略，300+KB 且会过期）。要用就现拉一份：

  ```powershell
  # 仅当你想在报表里看到倍率时才需要
  $k = (Get-Content "$env:USERPROFILE\.dsh\openai-gateway\api-key" -Raw).Trim()
  Invoke-WebRequest 'http://127.0.0.1:8326/v1/models' -Headers @{Authorization="Bearer $k"} `
    | Select-Object -ExpandProperty Content | Set-Content bench\catalog.json -Encoding utf8
  ```
  没有它 bench 照常跑，只是倍率列显示 `no tag`。

**可信边界（很重要）**：每条消息 × 2 个提示词 = 10 个样本时，**±1 个样本就是 ±10%**。
所以：
- ✅ 只用它**筛掉明显不合格**的（0~3/10 那类）
- ❌ **不要**用它给 8/10 和 9/10 排序——那是噪声，重跑一次顺序就变（实测过：同一批 12 个模型隔一轮复测，7 个掉 1-2 个样本）
- 需要细排序就把样本量提到 30-50 条/模型

另一个坑：**同一模型换一条通道路径，提示词可能被通道改写**（实测某渠道把 1400+ prompt token 压到 208-248，回复完全跑偏），所以"某渠道下测出的分数"不能代表"直连官方的分数"。

## 本地免费渠道网关（个人用途，别上生产）

本机有一个 Channel Pack 提供的 OpenAI 兼容网关：

```
base URL : http://127.0.0.1:8326/v1
key      : %USERPROFILE%\.dsh\openai-gateway\api-key
model id : 渠道/模型   例如 trae/deepseek-v4.1-flash
```

**能不能给产品用**：托管 Supabase 的 Edge Function 里的 `127.0.0.1` 是**它自己的容器**，打不到你本机；而这个网关只绑回环（`netstat` 里是 `127.0.0.1:8326` 而非 `0.0.0.0`）。

**这里有个专门坑人的设计**：`providers.ts:141` 的 URL 白名单**显式允许** `http://127.0.0.1`，所以把 `AGENT_CHAT_BASE_URL` 填成本机地址时，**配置校验会通过、运行时才失败**——很容易误判成"key 写错了"而反复重试。反过来 `host.docker.internal` 这类主机名会被同一行拒掉（它不在那三个允许的主机名里）。

要用只能走 HTTPS 隧道，并接受：个人账号额度按自然日重置、登录会过期、上游声明 prompt 可能被记录（**不能送用户数据**）、无 SLA。

## 部署（有两个坑）

```powershell
npx supabase functions deploy conversation-api --project-ref wkhfvnzgopjdzxlmycks --use-api --yes
```

1. **必须 `--use-api`**（本地 bundler 走 Deno，本机 IPv6 优先会被 registry 拒连）。
2. **`--yes` 必须给**（非终端环境下 CLI 会拒绝确认、什么都不改就退出）。
3. `functions deploy` 打包的是**磁盘当前状态**，会把工作区所有在途改动一起发上去——要用干净 worktree 隔离，只发你想发的东西。
4. 部署后 `supabase/config.toml` 的 `[functions.conversation-api] verify_jwt = false` 必须保留，丢了会全站 401。

## 诊断顺序（照着做，别跳）

1. 先看前端症状分四类：罐头/「尚未配置」/「未通过校验」/完全无响应（客户端 115s 超时或登录态丢了）。
2. 拿用户会话直接打 `POST /functions/v1/conversation-api/brief/extract`，看返回的 `enabled` 与 `reason`。
3. `npx supabase secrets list --project-ref <ref>` 只核对名称与 digest（CLI 不给值），确认开关与 provider 三件套存在。
4. 改配置：`npx supabase secrets set KEY=value` —— **立即生效，不用重新部署**。
5. 改了提示词/契约代码才需要重新部署，且两个函数都要发（只发一个会出现"我测是好的、用户看的是旧的"）。
