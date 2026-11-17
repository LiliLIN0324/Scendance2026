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


