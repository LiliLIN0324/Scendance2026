# C1 真实生成执行记录（2026-11-17）

## 一句话结论

C1 判定 **BLOCKED**：提交请求被服务端在「建任务之前」的预检挡下（HTTP 503），**没有创建任务、没有 taskid、没有扣费**。
本轮「提交回执 + unknown 锁 + 不重提」的安全切片在正式站**线上实证通过**：回执落盘、按钮被锁、提示不重试、且只提交了一次。

## 结论分类依据

| 判定 | 条件 | 本次是否满足 |
| --- | --- | --- |
| PASS | 任务创建 + taskid 可查 + 扣费可核对 | 否（任务未创建） |
| BLOCKED | 任务已创建但金额不可见 | 否（任务根本没建） |
| 停止不重试 | 网络错误 / 结果未知 | **是**，已按红线停止，未二次提交 |

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
