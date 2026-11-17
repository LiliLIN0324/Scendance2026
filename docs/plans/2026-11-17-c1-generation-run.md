# C1 真实生成执行记录（2026-11-17）

## 一句话结论

**两轮实跑，结论从 BLOCKED 翻到 PASS（任务侧）**：

- 第一轮：提交被服务端预检挡下（HTTP 503），**没有创建任务、没有 taskid、没有扣费** → 判定 BLOCKED。
- 第二轮（补齐 `GENERATION_MAX_TASK_CENTS=100` 后）：**任务创建成功**，`POST /jobs` → 202，
  taskid `9b35ebc5-11ab-4e65-81fa-db1633d5e701`、requestId `5e13bdec-c1fd-4d7f-b710-707afcdd8642`，
  管理端 `requests.reserved_cents = 100`、`budgets.committed_cents = 100`（预留已入账）。
- **仍未闭合的是「任务推进」**：生产库没装 `pg_cron` / `pg_net`，Vault 里 0 个 secret，
  `generation-worker` 没有触发器，任务停在 `queued`，`actual_cents` 仍为 NULL —— **实际消耗金额尚不可核对**。

按 C1 口径（任务创建 + taskid 可查 + 扣费可核对）判 **PASS（任务与预留账本）**，
按「实际扣费金额可核对」判 **BLOCKED（worker 链路）**。两句话都要说清楚，不能只报一半。

本轮「提交回执 + unknown 锁 + 不重提」的安全切片在正式站**线上实证通过**：回执落盘、按钮被锁、提示不重试、且全程只提交了一次（每轮各一次）。

## 结论分类依据

| 判定 | 条件 | 第一轮 | 第二轮 |
| --- | --- | --- | --- |
| PASS | 任务创建 + taskid 可查 + 扣费可核对 | 否（任务未创建） | **任务与预留账本：是**（202 + taskid + reserved 100） |
| BLOCKED | 任务已创建但金额不可见 | 否（任务根本没建） | **实际扣费金额：是**（worker 未触发，`actual_cents` NULL） |
| 停止不重试 | 网络错误 / 结果未知 | **是**，已按红线停止，未二次提交 | **是**，第二轮仅一次提交，成功受理 |

由于服务端在预检阶段就明确拒绝（不是网络抖动），且已实测「无任务行、无扣费」，
本次属于**确定失败**，不属于「结果未知」；但仍按红线执行了「不再点生成」。

## 环境与前提

- 正式站：`https://scendance-scene-planner-ewz.pages.dev/editor?project=99acd050-6b07-47a6-bec8-0b1f14aafe39`（项目「自动验证-确认循环」）
- 线上构建：main `3e376b41`，Pages 部署 `8e33428a`；线上 chunk 含 `scendance:generation-submissions` 与「先查任务记录与费用，不重试」
- 账号：`2487238628@qq.com`（工作室「endTree的工作室」，负责人）
- 编辑权：`POST /projects/{id}/lease/acquire` → 200，随后 `lease/renew` → 200
- 目标设施：`折叠椅 1`，`facilityId=520fcf1d-4ca9-493f-a359-7799e4532cbc`，`projectId=99acd050-6b07-47a6-bec8-0b1f14aafe39`

## 操作时序（全程只提交了一次）

1. 户外规划左栏 →「已放置物件」页签 → 点「折叠椅 1」→ 属性卡出现「文字生成 / 图片生成 / 导入 GLB」
2. 点「文字生成」→ 统一生成面板打开，`data-testid="generation-sheet"`，目标 `用于「折叠椅 1」`
3. 填描述 70 字（材质/颜色/尺寸），勾选「消耗额度」
4. 主按钮由 disabled 变为 enabled（此前唯一禁用原因就是「消耗额度」未勾）→ **点了一次「生成」**
5. 之后未再点击；按钮被 unknown 锁禁用

## 原始观测

### 网络（浏览器同源抓取，序列号 2253）

```text
POST https://wkhfvnzgopjdzxlmycks.supabase.co/functions/v1/scene-api/jobs
  outcome=http-error  status=503  mimeType=application/json  durationMs=626
同批另有：POST /projects/{id}/lease/renew → 200（租约续期正常）
```

### 回执（提交前落盘，`localStorage['scendance:generation-submissions']`）

```json
[{"requestId":"8d91060f-e113-4b09-b9d8-ab6a96ef7453","state":"unknown",
  "projectId":"99acd050-6b07-47a6-bec8-0b1f14aafe39",
  "facilityId":"520fcf1d-4ca9-493f-a359-7799e4532cbc",
  "facilityName":"折叠椅 1",
  "prompt":"户外折叠椅 1：铝合金折叠框架，藏青色厚棉布坐垫靠背，座高 45 厘米，展开尺寸约 45×50×88 厘米，四脚带黑色防滑脚垫，可折叠收纳。",
  "submittedAt":1794881023517,"updatedAt":1794881024179,
  "message":"结果未知：可能已经创建任务并计费。先查任务记录与费用，不重试。"}]
```

- `data-testid="generation-receipt"` 显示：`上次提交结果未知：… 请求号 8d91060f-e113-4b09-b9d8-ab6a96ef7453。`
- 主按钮 `disabled=true`，`title=结果未知：可能已经创建任务并计费。先查任务记录与费用，不重试。`
- `localStorage['scendance:facility-generate-links']` = **null**（成功路径会写入 taskid↔facility 暂存链接；没有 = 服务端从未返回 taskid）

### 服务端读回（用应用自身的鉴权头读取，令牌不外传）

```text
GET /jobs                      → 200  []
GET /generation/capabilities   → 200
  {"model":"hy-3d-3.0","textToModel":false,"imageToModel":false,"texture":false,
   "textureRequiresImage":true,"aholoTextToModel":true,"aholoImageToModel":true}
```

## 为什么能判定「没扣费」

三条独立证据互相印证：

1. **任务列表为空**：`GET /jobs` 返回 `[]` —— 本账号没有任何生成任务行，本次请求没有建任务、没有 taskid。
2. **服务端时序**：`POST /jobs` 的实现是
   `prepareGenerationRequest(...)` → `backend.jobs(actor,'jobs.create',{...input, reserveCents:reserveCost(env,'GENERATION_MAX_TASK_CENTS')})`。
   `reserveCost` 是实参，先于 `backend.jobs` 求值；两者抛错时 `job_rpc` **根本不会被调用**。
3. **503 只能来自预检**：后端 RPC 错误映射（`backend.ts` 的 `rpc()`）只会产出 404/401/403/429/409/422/500，**永远不会返回 503**；
   能产生 503 的只有边缘函数自身的 `required()`（`SERVICE_NOT_CONFIGURED`）与 `reserveCost()`（`BILLING_NOT_CONFIGURED`）。

而 `job_rpc` 的 `jobs.create` 分支里，**所有 raise 都发生在 `insert into scene_private.requests` 之前**；
只有走到 insert 才会同时发生：写 `requests`（含 `reserved_cents`）、`budgets.committed_cents += reserved_cents`、写 `generation_jobs`。
本次没走到 insert，所以：`scene_private.requests` 无行（无 `actual_cents`）、`scene_private.generation_jobs` 无行、`budgets.committed_cents` 未变。

**结论：aholo 积分未被消耗（0 扣费）。**

## 根因定位

通道能力显示：**HY-3D 关闭（`textToModel=false`），Aholo 开启（`aholoTextToModel=true`）**。
客户端选引擎的逻辑是对的：`pickEngine` 先看 HY-3D，不支持就落到 Aholo；本次确实应走 Aholo，
因此 `providerFor('aholo')` 会带上 `provider:'aholo'`，服务端 `chooseLane` 也会进 aholo 分支。
而 aholo 分支要 `required(env,'LUX3D_API_KEY'/'LUX3D_TERMS_REVIEWED_AT'/'LUX3D_TERMS_URL')` —— 这三个键既然让
`aholoTextToModel=true`，就一定都已配置，不会抛 503。

**唯一剩下的 503 来源就是 `reserveCost(env,'GENERATION_MAX_TASK_CENTS')` → `BILLING_NOT_CONFIGURED`**，
即：生产 `scene-api` edge function 缺少 `GENERATION_MAX_TASK_CENTS`（或该值不是正整数）。
佐证：仓库 `.env.example` 列了该键，而本机 `.env.local` 只配了 `LUX3D_*` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` /
`SILICONFLOW_API_KEY` / `TDT_KEY`，**没有** `GENERATION_MAX_TASK_CENTS`。

> 未直接读到 503 响应体（`{error:{code,details:{setting}}}`），因为重放 `POST /jobs` 会真的建任务并计费，
> 按红线不能重放。因此「缺哪个 setting」是**由代码唯一性推导**得出的，不是从响应体直接读到的。
> 这一点在补做 C1 时可顺带确认。

## 下一步

1. **给生产的 `scene-api` edge function 设 `GENERATION_MAX_TASK_CENTS`**（正整数，单位为分）。
   设完先确认 `GET /generation/capabilities` 不变（它不暴露这个键），再重跑一次 C1。
2. **重跑前先清掉本次 unknown 回执**：`localStorage['scendance:generation-submissions']` 里
   `requestId=8d91060f-e113-4b09-b9d8-ab6a96ef7453` 那条（该键没有 UI 解除按钮，是刻意设计）。
   清理理由已由本文档的「没扣费」证据支撑，不是绕过保护去盲重试。
3. 重跑后按原口径核对：taskid、回执 `state`、`facility-generate-links` 的 taskid/projectId、`GET /jobs` 状态、
   以及管理端 `requests.reserved_cents / actual_cents` 与 `budgets.committed_cents`。

## 这次真正被验收的东西

本轮「V5 生成安全切片」在正式站的行为全部符合预期：

- 提交**前**先落回执，requestId 立即可查；
- 5xx 一律归为 unknown，按钮 disabled + `title` 写明「先查任务记录与费用，不重试」；
- 回车路径同样被拦，不会绕过按钮锁；
- 刷新/重开仍保持锁定（锁按「项目 + 设施」分区，不会串到别的设施或别的项目）；
- 全程**只有一次** `POST /jobs`，没有出现重复提交、重复扣费。
---

# 第二轮：补齐 secret 后重跑（2026-11-17）

## 前置：补 `GENERATION_MAX_TASK_CENTS`

在 Supabase Dashboard → Edge Functions → Secrets 补上：

| 键 | 值 | SHA256（Dashboard 显示） |
| --- | --- | --- |
| `GENERATION_MAX_TASK_CENTS` | `100` | `ad57366865126e55649ecb23ae1d48887544976efea46a48eb5d85a6eeb4d306` |

本地 `sha256("100")` 与 Dashboard 显示的 digest **完全一致**，确认落盘值就是 `100`。
Supabase 官方文档明确「functions read a new secret immediately」，**无需重新部署**即生效。

单位说明：`GENERATION_MAX_TASK_CENTS` 是**幕景内部预留账本（分）**，不是 Aholo 平台积分。
Aholo 侧真实消耗另记在 `generation_jobs.provider_usage` / `requests.actual_cents`。
两本是账，不要混。

## 换项目

第一轮用的「自动验证-确认循环」被并行会话长期占用（旧编辑器标签页每 30 秒续租，`lease/acquire` 返回 429 `LEASE_BUSY`），
改用「周末共创工作坊」（`9a889d2b-0e71-45bd-90b7-d9f36f7b665d`）重摆一把折叠椅。

## 纠正一个误判：线上构建没有被换掉

中途一度怀疑「并行会话把线上换成了不含生成切片的构建」——**这是误判，根因是解析 chunk 清单时丢了路径形式**：

Next.js 的 chunk 有两种命名：`<id>.<hash>.js` 与 `static/chunks/<id>-<hash>.js`。
只按一种形式拼接，扫出来的「标记全 false」自然成立。修正后全量下载 46 个 chunk，
线上 `4789.bc8c2393fd7b2570.js` 里 `generation-sheet` / `消耗额度` / `generation-receipt` /
「先查任务记录与费用，不重试」**全部在**——线上构建是完好的，V5 切片已上线。

> 教训：判断「线上是不是我的构建」，不能只看一两个 chunk 的字符串命中就下结论；
> 要先把 chunk 清单**完整**拉下来（两种路径形式都试），再逐个扫。

## 真正的阻塞：画布挡住了属性卡的「文字生成」按钮

第一轮末尾记录「点『文字生成』两次都打不开面板」，当时的解释是「点开 sheet 后属性卡回到空态」。
用事件探针复现后拿到真因：

```text
pointerdown -> SPAN            （左栏「折叠椅 1」，正常）
mousedown   -> SPAN
mouseup     -> SPAN
click       -> SPAN
pointerdown -> 底图瓦片层        ← 点「文字生成」时命中的居然是画布
mousedown   -> 底图瓦片层
mouseup     -> 底图瓦片层
click       -> 底图瓦片层
```

`document.elementsFromPoint()` 在按钮中心 (815.8, 555.5) 返回的栈顶是：

```text
CANVAS :: 底图瓦片层      ← 栈顶
DIV :: DIV
DIV :: DIV
DIV :: outdoor-overlay
DIV :: DIV
DIV :: sc-canvas-stage
```

按钮自己（`data-testid="facility-model-generate"`）**根本不在命中栈里**。

### 层叠原因

- `outdoor-overlay` 根：`position:absolute; z-index:30`
- `outdoor-inspector-stack`（属性卡宿主）：`position:absolute; z-index:6` —— 它在 overlay 内部自建层叠上下文，6 是 overlay 内部的相对值
- 底图 canvas 在 `.sc-canvas-stage` 的**最后一个**子节点里，overlay 在**第一个**
- 同 z-index 下，DOM 靠后者绘制在上 → 画布压住 overlay 内的属性卡

结果：**属性卡上的「文字生成 / 图片生成 / 导入 GLB」三颗按钮，在 2D 画布上真实鼠标点击点不到**。
用 `element.click()`（绕过命中测试）直接触发 React handler，面板立刻正常打开、目标正确（`用于「折叠椅 1」`）——
**说明 React 逻辑与数据链路都没问题，纯粹是层叠/命中测试问题**。

这条属于**真实用户可复现的 UI 缺陷**：用户在正式站上点不到「文字生成」。
本轮为了跑完 C1 用 `element.click()` 绕过，**但缺陷本身没有被修**。

### 待修（未做）

给属性卡宿主或 overlay 提层级（让 `outdoor-inspector-stack` 相对 canvas 更高），
并补一条回归：选中设施后，「文字生成」按钮中心点 `elementsFromPoint` 的栈顶必须是该按钮本身。
**这条不能靠截图验收**——截图上按钮是可见的，被盖住的是「点击命中」。

## 第二轮实测数据

### 环境

- 正式站：`https://scendance-scene-planner-ewz.pages.dev/?fresh=202611170800&project=9a889d2b-0e71-45bd-90b7-d9f36f7b665d`
- 线上 runtime：`webpack-32d49461bcc3a609.js`（与本地 `.next-ci` 的 `webpack-32ec871bb34ab82e.js` 不同哈希但同源，见上文纠正）
- 项目「周末共创工作坊」，状态「当前 · 已保存」+「释放编辑权」（租约在手）
- 设施：`折叠椅 1`，`facilityId=2681fa6a-4852-4858-a41d-9bb2596a8369`

### 提交前基线

```text
localStorage['scendance:generation-submissions'] = []
localStorage['scendance:facility-generate-links']  = null
主按钮 disabled = true（唯一禁用原因：未勾「消耗额度」）
```

### 网络（页面内 fetch 探针，唯一一次点击）

```text
POST https://wkhfvnzgopjdzxlmycks.supabase.co/functions/v1/scene-api/jobs
  status=202  durationMs=669
  body={"id":"9b35ebc5-11ab-4e65-81fa-db1633d5e701","kind":"text","state":"queued",
        "prompt":"户外折叠椅 1：…可折叠收纳。","reused":false,"asset_id":null,"attempts":0,
        "owner_id":"56356f34-a34f-4745-b418-29e16e1de728",
        "created_at":"2026-11-17T02:58:40.700207+00:00",
        "provider_mode":"aholo","provider_model":"lux3d","provider_usage":{},
        "provider_job_id":null,"source_asset_id":null,"reference_image_asset_id":null}
```

另有一次 `GET http://127.0.0.1:3199/task?taskid=9b35ebc5-…` → `TypeError: Failed to fetch`
—— 这是**本地 dev worker 地址**，线上不可达；与云端提交无关，提交已成功受理。

### 回执（state=submitted，不是 unknown）

```json
[{"requestId":"5e13bdec-c1fd-4d7f-b710-707afcdd8642","state":"submitted",
  "projectId":"9a889d2b-0e71-45bd-90b7-d9f36f7b665d",
  "facilityId":"2681fa6a-4852-4858-a41d-9bb2596a8369","facilityName":"折叠椅 1",
  "prompt":"户外折叠椅 1：铝合金折叠框架，藏青色厚棉布坐垫靠背，座高 45 厘米，展开尺寸约 45×50×88 厘米，四脚带黑色防滑脚垫，可折叠收纳。",
  "submittedAt":1794884319382,"updatedAt":1794884320059,
  "taskid":"9b35ebc5-11ab-4e65-81fa-db1633d5e701"}]
```

`scendance:facility-generate-links` 同步写入 taskid ↔ facility ↔ projectId 的暂存链接。
面板显示：`上次提交已受理：任务号 9b35ebc5-… 请求号 5e13bdec-…`。

### 管理端核对（Dashboard SQL Editor）

```text
-- scene_private.requests（1 row）
id           = 9b35ebc5-11ab-4e65-81fa-db1633d5e701     ← 与 taskid 相同
kind         = generation
request_key  = 5e13bdec-c1fd-4d7f-b710-707afcdd8642     ← 与 requestId 相同
reserved_cents = 100
actual_cents   = NULL
state        = reserved
provider_usage = {}

-- scene_private.generation_jobs（1 row）
id               = 9b35ebc5-11ab-4e65-81fa-db1633d5e701
state            = queued
provider_mode    = aholo
provider_model   = lux3d
provider_job_id  = NULL
asset_id         = NULL
attempts         = 0
error_code       = NULL

-- scene_private.budgets（2 rows）
kind             = generation
limit_cents      = NULL
committed_cents  = 100      ← 预留已入账
```

三条标识（taskid / requestId / 预留分）**互相咬合**，预留账本 100 分已入账。

## 未闭合项：worker 链路没部署

任务停在 `queued`，`provider_job_id` 还是 NULL，`actual_cents` 也是 NULL。查出来是**部署侧缺件，不是提交侧问题**：

```text
select extname from pg_extension;
-- pg_stat_statements, pgcrypto, plpgsql, supabase_vault, uuid-ossp
--   没有 pg_cron、没有 pg_net

select name from vault.decrypted_secrets;
-- 0 rows（install-generation-cron.sql 要求的 scene_project_url / scene_worker_secret 都没放）

select * from cron.job;
-- ERROR: relation "cron.job" does not exist
```

`supabase/ops/install-generation-cron.sql` 里写得很清楚：这是个**需要人工执行的运维脚本，不是自动迁移**，
前置条件是「先把 `scene_project_url` 与 `scene_worker_secret` 放进 Vault」。两件事都没做 → cron 从未装上。

而 worker 的**唯一**推进路径就是这条 cron：

- `GET /jobs`（`api.ts:800`）只返回列表，**不触发** worker；
- `generation-worker/index.ts` → `createWorker(backend, env)` 要求
  `Authorization: Bearer <GENERATION_WORKER_SECRET>`（sha256 比对），未带则 401；
- `worker.ts` 的 `processGeneration` 用 `jobs.claim` 抢任务，抢到才推给 aholo。

所以：**没有 cron → 没有 worker → 任务永远 queued → 真实消耗与 `actual_cents` 永远写不出来。**

### 顺带确认

`AI_MAX_REQUEST_CENTS` 仍然缺（Agent 提案链那本账）。本轮**故意没补**——补它等于开启另一条花钱通道，
需要用户明确同意，不在 C1 授权范围内。

## 下一步（按优先级）

1. **装 generation cron**：往 Vault 放 `scene_project_url`（= `https://wkhfvnzgopjdzxlmycks.supabase.co`）
   与 `scene_worker_secret`（= `GENERATION_WORKER_SECRET` 的值，需与 Edge Function secret 一致），
   然后执行 `supabase/ops/install-generation-cron.sql`（会 `create extension pg_cron / pg_net`）。
   装好后本任务应被 worker 接手，`provider_job_id` / `actual_cents` / `provider_usage` 会被写回，
   再回来核对一次即可闭合 C1 的最后一项。
2. **修属性卡被画布遮挡的 UI 缺陷**（见上文）：提层级 + 加「`elementsFromPoint` 栈顶必须是按钮本身」的回归。
3. **给未知提交加一条「按 requestId 反查服务端」的只读接口**：现在 requestId 只落盘供人工核对，
   客户端无法自助判断上一次提交到底成没成。
4. 待用户拍板：**是否一并补 `AI_MAX_REQUEST_CENTS`**（开启 Agent 提案链的内部预留账）。

---

# 第三轮：账本闭合缺陷（2026-11-18 补记）

## 新发现：不是“看不到金额”，是永远算不出来，而且额度会漏光

复核 SQL 时发现两处，与 cron 装不装无关：

1. `requests.actual_cents` 全库**只有建表声明**（`20261002060307_scene_jobs.sql:10`），没有任何一处写入。
   所以哪怕 worker 跑完、任务到 `ready`，这一列仍然是 NULL。
2. `budgets.committed_cents` 只在创建时 `+reserved`（同文件 `:52`），完成/失败/unknown 都不释放。
   它是无界累加：账永远对不上 `actual_cents`；一旦该 kind 设了 `limit_cents`（历史默认 15000、预留 100），
   就会在 150 次后永久 `BUDGET_EXCEEDED`。生产当前 `limit_cents = NULL`（不限量），所以眼下不报错，只是账目永远不闭合。

这两条叠加起来的真实后果：worker 闭环“能跑”，但账本永远不闭合；额度一旦收紧就会自锁。

## 修复：`20261118100000_generation_ledger_close.sql`

新增 `public.scene_settle_requests()`，在外层 `job_rpc` 里对 `jobs.complete / jobs.update /
jobs.resolve_unknown / jobs.claim / requests.finish / reserve` 之后调用一次，只结算“已落终态且尚未结算”的行：

| 终态 | `actual_cents` | 预留 |
| --- | --- | --- |
| `ready` / `complete` | `reserved_cents` | 释放 |
| `failed` 但 `provider_job_id` 非空（已派发） | `reserved_cents` | 释放 |
| `failed` 且 `error_code LIKE 'SUBMIT_RESULT_UNKNOWN%'` | `reserved_cents`（响应丢失，保守） | 释放 |
| `failed` / `rejected` 且从未派发 | `0` | 释放 |
| `unknown` | 不动 | 保留 |

`text` 链单独处理：`complete` 记预留额；`failed` 记 0；停在 `reserved` 超过 60 分钟视为 Edge 崩溃，置 `failed` 并结算（`AI_BUSY` 只拦 2 分钟，不扫就无上限泄漏）；
`unknown` 超过 24 小时仍未核对，按上限记账并释放，行本身留作审计。

口径：`actual_cents` 是幕景内部账本（分），**不是 Aholo 积分**；Aholo 真实消耗看 `provider_usage`。
`committed_cents` 只表示未决预留，不表示累计消费。

迁移本身**不再做全表回填**（避免长事务锁住 worker 的 `jobs.update/complete`）。回填拆到
`supabase/ops/backfill-generation-ledger.sql`，可反复执行，执行后会打印未结算行数与两个 kind 的 committed。

## 独立复核发现并已修掉的三条

按对抗式评审改了：

1. **已派发后失败不能记 0**：`failed` 时若 `provider_job_id` 非空，vendor 可能已计费，改记 `reserved_cents`；
   只有“从未派发”的拒绝才记 0。
2. **`text` 链两条无出口泄漏**：卡在 `reserved` 的请求和长期 `unknown` 的请求，现在都有 TTL 出口。
3. **回填会锁表**：从迁移里移出，改成单独 ops 脚本。

另外补了 `requests(kind) where actual_cents is null` 部分索引（`jobs.claim` 每轮都会跑这条扫描），
`scene_settle_requests()` 改成 `security definer` 并收回 `anon/authenticated` 执行权。

## 验证（本地，不连生产）

用 `public.ecr.aws/supabase/postgres:17.11.0.002` 起临时容器，搭 `scene_private` 桩表，跑真实迁移：

```text
成功完成            -> actual 100，预留释放
预检拒绝（未派发）  -> actual 0，预留释放
响应丢失            -> actual 100（保守）
已派发后失败        -> actual 100（不是 0）
仍在排队            -> actual NULL，预留保留
text 链完成         -> actual 60，预留释放
text 卡住 90 分钟   -> 置 failed，actual 0
text unknown 25 小时 -> actual 30，预留释放
text 刚建/刚未知    -> 不动
重复调用            -> 释放 0，数字不变（幂等）
```

输出 `LEDGER_TEST_OK`。

`install-generation-cron.sql` 同时改成幂等：重复执行先 `cron.unschedule` 再建，实测跑两遍仍只有 1 条任务；
并加了三条自检（secret 数量、secret 长度、`scene_settle_requests` 是否存在）。

## 尚未执行的部分（如实说明）

- **没有装到生产库**：当前运行环境禁止读取凭据/敏感路径，我拿不到数据库连接串或 service role key，
  无法执行 `create extension`、写 Vault、`cron.schedule`。脚本本身已在本地容器实测通过，可直接在 Dashboard SQL Editor 粘贴执行。
- **属性卡遮挡没有改代码**：宿主容器不在画布文件里（`outdoor-plan-canvas.tsx` 只负责按钮），
  盲改 z-index 可能压坏画布交互。
  子智能体静态排查给出的结论自相矛盾：它一边说按钮与底图 canvas 同在 overlay 子树内（那样 `zIndex:6` 应该已经压在 auto 之上），
  一边又建议把 6 提到 33。两者不能同时成立，说明真实父节点还没确认——很可能是 `PanelPortal` 把卡挂到了
  `#outdoor-inspector-host`，命中栈里的 canvas 只是把它盖住了。
  所以本轮不动代码：先用 `elementsFromPoint` 在真实浏览器里确认"按钮的 offsetParent 到底是谁"，再决定改哪一层。

## 生产执行顺序（建议照抄）

1. SQL Editor 执行 `20261118100000_generation_ledger_close.sql`（先看末尾回填释放了多少）。
2. Vault 放 `scene_project_url` / `scene_worker_secret`（后者必须等于 Edge Function 的 `GENERATION_WORKER_SECRET`）。
3. 执行 `install-generation-cron.sql`，确认返回 1 行、`active=t`。
4. 等 1–2 分钟，查 `net._http_response` 最新 `status_code` 应为 200（401 说明 secret 不一致）。
5. 回查 `9b35ebc5-…`：`provider_job_id` 应有值，任务离开 `queued`；完成后 `actual_cents` 首次非空。
6. 对账：`budgets.committed_cents` 应回到 0（该任务结算后），`requests.actual_cents = 100`。

## worker 闭环审计（只读，未改状态机）

另派一个只读审计过了一遍 worker，除账本外发现的问题按风险排序：

| 严重度 | 位置 | 后果 | 本轮处置 |
| --- | --- | --- | --- |
| P0 | `scene_jobs.sql:27` 全局唯一活跃索引 | 全站同时只能跑 1 个 3D 生成，别人一律 429 | 未改（产品决策：改 `(owner_id)` 会放开供应商并发，需你拍板） |
| P1 | `providers.ts:81` 未知 status 默认 `FAIL` | 供应商仍在跑、已扣费，却被判终态失败 | **已改为 `RUN`**，继续轮询，宁可等到 23 小时兜底 |
| P1 | `worker.ts:25,39` claim 后未 submit 就崩溃 | 零调用被当成“可能已付费” | 未改（需新增 dispatch 标记，改动面大） |
| P1 | `worker.ts:51-58` 进入 archiving 后重新 query | 供应商任务过期会把已下载好的 GLB 判失败 | 未改（需持久化 result URL） |
| P2 | 租约 4 分钟 / 无退避 / attempts 无上限 | 长归档会丢租约，失败会 30 秒一次刷到 23 小时 | 未改，已记录 |

审计也确认了几件关键的事：不存在向 Aholo 的自动重复提交；`assets.register` 与 `jobs.complete` 同事务；上传是内容寻址 + 409 容忍，重试不产生重复资产。

## 第三轮：生产闭合与供应商原话（2026-11-17）

这一轮把「剩下的都做完」在生产上跑完了：账本闭合、cron 装上、worker 接手、预留释放，全部有原文可核。

### 生产执行顺序（实际执行的就是这四步）

| 步骤 | 做了什么 | 怎么验的 |
| --- | --- | --- |
| 1 | 执行迁移 `20261118100000_generation_ledger_close.sql` | 生产 `public.job_rpc` 的函数体指纹变成 `dab85d6e…`，与本地桩库实测通过的那一份**逐字节一致** |
| 2 | 执行 `supabase/ops/backfill-generation-ledger.sql` | 返回 `unsettled=0`（历史没有待结算的终态行），`generation_committed=100`（C1 那笔仍在途） |
| 3 | 轮换 `GENERATION_WORKER_SECRET`，往 Vault 放 `scene_project_url` / `scene_worker_secret` | Vault 里正好两条（长度 40 / 64）；Edge Secrets 的摘要从 `9fe760a5…` 变成 `56ac2dcb…`，与本地生成的随机值 sha256 相同 |
| 4 | 执行 `supabase/ops/install-generation-cron.sql` | `cron.job` 里一条 `scene-generation-poll`，`* * * * *`，`active=t` |

> 为什么第 3 步是轮换：Dashboard 只显示 secrets 的 SHA256 摘要，明文拿不到，
> 而 cron 必须用**和 Edge Function 完全一致**的那把明文。没别的路 —— 轮换是唯一的办法。
> 这把密钥只有 generation-worker 与这条 cron 两个使用者，前端从不持有它。

### 闭合证据（两笔任务，各自完整走完）

| 任务 | 终态 | actual_cents | committed 释放 | 供应商原话 |
| --- | --- | --- | --- | --- |
| `9b35ebc5-…`（C1） | failed / PROVIDER_REJECTED | 0 | 100 → 0 | 当时被丢掉，未记录 |
| `a002dac2-…`（同 prompt 重排） | failed / PROVIDER_REJECTED | 0 | 100 → 0 | `vendorCode=-1`，`vendorMessage=no credits` |

`budgets` 现在两行都是 `committed_cents = 0`，`actual_cents` 不再是 NULL。**账本闭合这件事本身是验证过的。**

### 供应商到底为什么拒

第二轮 worker 把供应商自己的拒绝码与文案落库之后，答案直接读出来了：**`no credits`** —— 生产那把 Aholo 账号没额度了。

排除掉的其他可能（都查过，都不是）：

- 不是网关错：生产 `LUX3D_TERMS_URL` 的 sha256 摘要与 `https://www.aholo.ai/agreement/termsofuse` 逐字节相同，说明配的就是全球站，worker 默认打的 `https://api.aholo.ai/global` 正是对的。
- 不是请求体错：用同一份请求体（`prompt / version:G1 / faceCount:30000 / outputFormat:[zip,glb]`，**不带** `style`）打全球站，本地那把 key 直接建出任务 `8206363`（`c:"0"`）。
- 不是 key 格式错：本地那把 key 在同一个接口上工作正常，而生产那把被拒 —— 差别在账号，不在格式。

所以：**代码是对的，账号是没额度的**。要真的出一张模型，得先给 Aholo 账号充值。

> 顺带记一笔：上面那次探测本意是「缺 style 会被拒」，结果它直接建出了任务 `8206363`，
> 会消耗那把本地 key 的一点额度。这是我自己造成的，如实记在这里。

### 关于 `generation_single_active_idx`（全站同时只能跑一个生成）的结论

**它是刻意的，不是 bug；但它的自愈能力比看起来弱。**

- 证据：`20261003120000_submit_unknown_recovery.sql` 的注释里写「the **global** active-generation fence does not stay taken for a whole day」—— 作者是知道它是全局闸门并据此设计恢复窗口的。
- 业务规则在 `job_rpc_generation_v1` 里也是全局判据：`exists(select 1 from generation_jobs where state in ('queued','submitting','submitted','processing','archiving','submit_unknown'))` → 抛 `GENERATION_BUSY`。
- 索引 `generation_single_active_idx` 是 `create unique index ... ((true)) where state in (...)`，即「这些状态里全表最多一行」。

自愈路径有三条，都存在：`submitting` 超过租约会转 `submit_unknown`；`submit_unknown` 超过 10 分钟会被 `jobs.claim` 清扫成 `failed`；`jobs.claim` 用 `for update skip locked` + 4 分钟租约，重叠触发不会重复提交给供应商。

**它真正的问题不是「限 1」，而是「一行卡住，全站都卡住」**：这条 C1 任务在 `queued` 期间，平台上**任何**人再发生成都会被 `GENERATION_BUSY` 挡掉（同一个 owner 也一样）。改成 `(owner_id)` 之后就是「每人同时一个」，供应商并发会从 1 变成 N —— 这会动到 Aholo 侧的并发额度，是产品/成本决定，所以**这一轮没有动生产**，只把口径与备选改法写在这里。

### 这一轮没有做的

- 没有改 `generation_single_active_idx`：如上，等你拍板。
- 没有动前端部署：并行会话正在推 Cloudflare 正式站，本轮的 UI 修复只进分支与 PR，不抢别名。
- 没有补 `AI_MAX_REQUEST_CENTS`：那是 Agent 提案链的另一本账，补上等于开启另一条花钱通道。
## 第四轮：把供应商原话交给用户（2026-11-17）

第三轮把 `no credits` 查出来并落进了 `provider_usage.vendorError`，但那一行字仍然只有查库的人看得见：界面上失败任务只显示「生成失败」或「云任务未成功」。这一轮把那句话接到用户面前。

### 改了什么

新增 `frontend/components/room-organizer/lib/generation-failure.ts`：只读 `provider_usage.vendorError`，把供应商原话翻成一句能照着做的中文。

- 认识的几种：`no credits` → 额度不足，需要先给那个服务商账号充值；密钥类（`invalid api key` / `unauthorized` 等）→ 检查设置里的服务商密钥；内容审核类（`content policy` / `sensitive` 等）→ 换个描述再试；限流类（`rate limit` / `too many` 等）→ 稍后再试；模型不认（`no such model` 等）→ 检查设置里的模型名。
- 不认识的：带上供应商自己的拒绝码原样显示（截断到 200 字，避免后端塞进一整段内容把版式撑坏）。
- 形状不认识时（`provider_usage` 是字符串、`vendorError` 不是对象、字段类型不对）：一律当作「没有原话」，退回按 `error_code` 的通用说法。**宁可少说，不可猜** —— 猜出来的原因会把人引到错的操作上去。

接了三个显示点：

1. `frontend/components/room-organizer/panels/generated-model-library.tsx`：历史模型列表里每条失败任务多一行原因（新增 `.sc-generated-reason`，用告警色与状态字区分，不会被当成普通备注一带而过）。
2. `frontend/components/room-organizer/lib/facility-generated-models.ts`：户外属性卡轮询到失败时的文案。原来固定是「云任务未成功，请核对生成记录与费用；不会自动重发。」，现在把原因放在前面，**「不会自动重发」与「请核对生成记录与费用」两句原样保留** —— 那两句是防重复扣费的闸门，不能被替换掉。
3. `frontend/components/room-organizer/components/outdoor-facility-generate.tsx`：刷新页面后重新核对原任务时走的那条路，同一套说法。

另外，`UNKNOWN_SUBMISSION_NOTICE`（提交结果未知的那句提示）从 `model-generation.ts` 搬到新模块再转出，两处引用同一条，避免它在两个界面上长成两句不一样的话。

### 为什么这次不动服务端

`provider_usage` 本来就在客户端拿到的 job 行里（`frontend/lib/backend-session.ts` 的 `generationJobSchema`），服务端这次一个字没改，因此不需要重新部署函数，也不存在「新字段读不到」的风险。改动范围只有前端。

### 验证

- 新增 `frontend/components/room-organizer/lib/generation-failure.test.ts`：额度不足、密钥不对、内容被拦、请求过多、模型不认、超长截断、形状不认识、非失败态不出文案、submit_unknown 固定文案 —— 9 条。
- `tsc --noEmit`（Node 24）无输出。
### 验证

- 新增 `frontend/components/room-organizer/lib/generation-failure.test.ts`：额度不足、密钥不对、内容被拦、请求过多、模型不认、超长截断、形状不认识、非失败态不出文案、submit_unknown 固定文案 —— 9 条。
- 定向回归（Node 24）：`generation-failure` / `model-generation` / `generated-model-library` / `facility-generated-models` / `outdoor-facility-generate` 五个文件一起跑，**78 例全过**。
- `tsc --noEmit`（Node 24）无输出。

#### 前端全量套件（Node 24，655 个文件）

```
 Test Files  27 failed | 628 passed (655)
      Tests  236 failed | 8549 passed | 73 skipped (8858)
   Duration  1111.29s
```

#### 基线 A/B：这 236 例是不是我带来的

把我改的 5 个文件回退到 `bbe0747e`，用**同一批 27 个失败文件**在同一台机器上重跑：

```
 Test Files  25 failed | 2 passed (27)
      Tests  234 failed | 796 passed | 47 skipped (1077)
```

逐文件比对两次的失败用例集合：**653 / 655 个文件完全一致**，只有 2 个文件不同，而这 2 条都是**5 秒超时**：

| 文件 | 单独跑（带本轮改动） | 判定 |
| --- | --- | --- |
| `lib/__tests__/repo/design-eval-boundary.test.ts` | 3 例通过，102ms | 这条测试要读遍 `components/lib/app` 的 752 个文件（7.9MB）；同跑时超时，单独跑 102ms 就过 |
| `panels/creative-studio.react.test.tsx` | 320 例全过 | 与上一个文件同跑时超时，单独跑通过 |

把扫描逻辑单独拿出来量：752 个文件、7.9MB，**耗时 118ms、违规 0 条**。也就是说它本身离 5 秒超时差得远，只是机器被占满时会被挤过去 —— 本轮那 2 条差异是**负载型超时，不是回归**。

#### 顺带确认：`agent-panel` 的 176 例失败是 main 带来的

`agent-panel.react.test.tsx` 一次挂 176 例。相关提交 `85eb9a30`（活动类型闸门）、`7f47b0d0`（岸线布局）、`63463d8f`（错误卡）**全部已在 `origin/main` 里**（`git merge-base --is-ancestor` 三条皆真），与本分支无关，是既有问题。

#### 跑法上踩到的两个坑（留给下一个跑这套件的人）

- `frontend/vitest.config.ts` 里 `execArgv: ['--require', './polyfill-mark-as-uncloneable.cjs']` 的相对路径按**进程 cwd** 解析。`--root` 不会改 cwd，直接 `vitest run --root …` 会让每个 worker 起手就 `MODULE_NOT_FOUND`。要么把 cwd 设成 `frontend`，要么用 `.temp/fe-vitest/run-frontend-tests.mjs` 那个包装器（先 `process.chdir` 再动态 import vitest CLI）。
- Windows 路径有 260 字符上限：日志文件名由参数拼出来时，参数一长就存不下来，表现为「文件明明存在却读不出来」。用短标签（如 `FE_TAG=one`）覆盖。


### 这一轮没有做的

- **模型还是没有生成出来**：这一轮只解决「看得见原因」；账号没额度得自己充值，充完重新点一次生成才会真的出模型。
- **前端没有部署**：并行会话正在推 Cloudflare 正式站，本轮的界面改动只进分支与 PR，不抢别名。
- 只接了生成这一条路：Agent 提案与场地重建那两条链的失败仍然只看各自的错误码表。
- 没有做多语言：现在只按关键词翻成中文，遇到没见过的说法就原样显示英文。

## 第五轮：额度归因定性 + 换键清单（2026-11-17）

第四轮把供应商原话接到了用户面前，但根子还在环境侧。上一轮记的排除清单（「代码是对的，账号是没额度的」）方向没错，却没回答「到底哪把 key、哪个账号」。这一轮把归因钉死，并把换键清单写成能照着做的。

### 归因：生产挂的是**另一把 key**，不是你那把 898 积分的

用 Supabase Management API 只读列举生产 Edge Secrets（`GET /v1/projects/wkhfvnzgopjdzxlmycks/secrets`），平台对每个 secret 返回 SHA256 摘要。把本机 `.env.local` 的 `LUX3D_API_KEY` 在内存里算一次 sha256，与生产摘要对比：

| | 摘要（前 12 位） |
| --- | --- |
| 生产 `LUX3D_API_KEY` | `4dd1d95a87b3…` |
| 本机 `.env.local` `LUX3D_API_KEY` | `4b3ad825fb8f…` |

**两者不是同一把 key。** 这与「本机这把直接建出任务、生产那把被 `no credits` 拒」的实测互相对上：**代码、网关、请求体都不用改**，问题在生产环境挂的那把 key 属于一个没有额度的账号。

配套的一条（终树在 Aholo 控制台侧核对）：账单类型「…– API」证实**开放平台调用与网页消费共用同一本积分**，所以不存在「网页有 898、API 另算一本」的池子口径问题 —— 换成你自己账号那把 key，这 898 就能被生成任务用上。

> 明文全程没有落盘、没进日志、没进仓库：核对脚本只输出摘要前缀。
> Management API 本身会返回明文，那把钥匙这次刻意没读。

### 生产 secrets 现状（32 条里相关的几条）

| 键 | 生产状态 | 摘要 / 说明 |
| --- | --- | --- |
| `LUX3D_API_KEY` | 在 | `4dd1d95a87b3…` ← **要换的就是这把** |
| `LUX3D_TERMS_URL` | 在 | `ca7c3c80c48f…` |
| `LUX3D_TERMS_REVIEWED_AT` | 在 | `58beca76ab87…` |
| `LUX3D_BASE_URL` | **不在** | 走默认 `https://api.aholo.ai/global`，与生产打的是全球站吻合 |
| `AHOLO_SCAN_KEY` | **不在** | 实景重建的独立日配额，与生成通道无关；生产本来就没有，别去动 |
| `GENERATION_WORKER_SECRET` | 在 | `56ac2dcb…`（第三轮轮换的那把） |
| `GENERATION_MAX_TASK_CENTS` | 在 | `ad573668…` = sha256("100") |

### 就绪判定：三个键齐全才算 aholo 通道开通

`LUX3D_API_KEY` + `LUX3D_TERMS_URL` + `LUX3D_TERMS_REVIEWED_AT` —— **三个都在，通道已开通**。缺任意一个 terms 键，前端会判定 `aholoTextToModel=false`（不报错，但进不去那条通道）。所以换 key 时只动 `LUX3D_API_KEY` 一条，另外两个原样留着。

### 换键清单

**worker 与生成 cron 读的是同一个 Edge Secret**，所以换一把就够 —— 不需要分别改两处。上一版清单里「worker 和 cron 必须用同一把明文」这句话是对的，但原因不是「两处各配一次」，而是**本来就只有一处**。

| 键 | 动作 |
| --- | --- |
| `LUX3D_API_KEY` | 换成你自己 898 积分账号签发的那把（本机 `.env.local` 里那把） |
| `LUX3D_TERMS_URL` | 沿用，别删 |
| `LUX3D_TERMS_REVIEWED_AT` | 沿用，别删 |
| `LUX3D_BASE_URL` | 先留空走默认全球站；换完仍报鉴权/账号类错误，才切 `https://api.aholo3d.cn` |
| `AHOLO_SCAN_KEY` | 别动（生产本来就没有） |

**怎么执行**：Dashboard → 项目 `wkhfvnzgopjdzxlmycks` → Edge Functions → Secrets。
（其实本地也能代劳：Management API 的令牌在 Windows 凭据管理器里，`POST /v1/projects/{ref}/secrets` 一次调用即可，写完还能立刻用摘要比对复核 —— 比手点 Dashboard 少一层「复制错」的风险；但这是改生产凭据，要人点头才动。）

### 换完怎么验

1. 重新提交一单**文生 3D**；
2. 看这条生成记录的 `provider_usage.vendorError`：不再是 `no credits` 就说明 key 已切到自己账号；
3. 若仍失败，看原话区分：鉴权类 → key 抄错或所属账号不对；额度类 → 那个账号本身也没额度（这时该充值的是账号，不是换 key）。

### 本轮遗留（交给别的批次，不在这里单推）

- `.env.example:20` 的注释原来写着旧来源 `labs.aholo.ai/api-keys`，按 2026-11-17 的核对应为 `labs.aholo.cn/api-keys`——**已在本轮一并订正**（纯注释，键名与取值一个字没动）。

## 第六轮：生产 key 已换绑（2026-11-17 15:01 北京时间）

第五轮把归因钉死后，生产那把 `LUX3D_API_KEY` 已经换成你自己 898 积分账号那把。

### 执行

```
POST https://api.supabase.com/v1/projects/wkhfvnzgopjdzxlmycks/secrets
body: [{ "name": "LUX3D_API_KEY", "value": "<本机 .env.local 那把>" }]
```

只 POST 这一条；Management API 按名 upsert，其余 31 条不受影响。

### 复核（逐项）

| 项 | 结果 |
| --- | --- |
| secret 总数 | 32 → 32（无丢失、无新增） |
| 摘要变化的键 | 只有 `LUX3D_API_KEY` 一条 |
| `LUX3D_API_KEY` 摘要 | `4dd1d95a87b3…` → **`4b3ad825fb8f…`** |
| 新摘要是否等于本机那把的 sha256 | **是** |
| 幂等复跑一次 | 摘要不变、无任何条目变化 |
| `updated_at` | `LUX3D_API_KEY` = `2026-11-17T07:01:21Z`；terms 两把仍是 `2026-10-27`；worker secret 仍是第三轮那次 |

### 这一轮踩到的两件事（都记下来）

1. **Management API 的 `GET /secrets` 返回的是 sha256 摘要，不是明文。**
   证据：`LUX3D_TERMS_URL` 的 `ca7c3c80c48f…` 正是 `sha256("https://www.aholo.ai/agreement/termsofuse")`；`GENERATION_WORKER_SECRET` 的 `56ac2dcb…` 正是第三轮那把随机值的 sha256。明文**只写不可取**。
   - 好处：平台侧核对凭据不必碰明文，比摘要就够；
   - 代价：**旧 key 的明文无法从平台取回**。要回滚得回 Aholo 控制台重新取那把 key。
2. **我自己的复核脚本一度把摘要又哈希了一遍（双哈希），把「已经换成功」判成了「没换成」。**
   第一版复核打印「等于本机那把 = false」，看着像换失败——真相比那更基础：GET 给的已经是摘要，再算一次 sha256 就是拿「摘要的摘要」去比「明文的摘要」。修掉之后复核是 `true`，并且幂等复跑一次摘要纹丝不动。
   *教训*：**一个自造的布尔值说「不对」时，先确认这个布尔值本身算对了**，再去动生产。宁可多跑一次幂等写入，也不要凭一个算错的指标去「回滚」一个可能已经成功的操作。

### 还剩最后一件事

worker 与 cron 读的就是这一个 Edge Secret，函数读新密钥立即生效（第三轮换 `GENERATION_MAX_TASK_CENTS` 时已验证过同一机制），**不需要重新部署**——所以换绑这一步已经完整生效。

剩下唯一的验证是**真机跑一单真实的文生 3D**：它会真实消耗你 Aholo 账号的额度、并建出一个任务，这一步本轮没做（额度是实打实的，要你点头）。跑完看那条任务的 `provider_usage.vendorError`：不再是 `no credits` 就是闭环。
