# 部署缺口证据：正式站前端已写云端副本，后端没有对应端点

> 记录时间：2026-11-19 · 站点：`https://scendance-scence-planner-ewz.pages.dev/`（正式站，实际域名 `scendance-scene-planner-ewz.pages.dev`）
> 项目：`wkhfvnzgopjdzxlmycks`（Supabase）
> 结论：**这不是代码缺陷，是"前端已上线、后端未上线"的部署错配**。它直接卡住 #7 / #8 / #9 的"真实云端"一栏。

## 1. 三条硬读数

### 1.1 线上 Edge Function 版本落后于 main

| 函数 | 版本 | 最近部署时间（UTC） | 部署版本是否含户外副本端点 |
| --- | --- | --- | --- |
| `scene-api` | 62 | 2026-11-16T16:49:18Z | **否** |
| `conversation-api` | 56 | 2026-11-16T12:21:09Z | 不适用 |
| `generation-worker` | 32 | 2026-11-17T11:40:30Z | 不适用 |
| `reconstruction-worker` | 28 | 2026-11-13T19:48:18Z | 不适用 |

取数方式：Supabase 管理 API `GET /v1/projects/wkhfvnzgopjdzxlmycks/functions`。

直接验证线上函数体（`GET /v1/projects/{ref}/functions/scene-api/body`，19 109 101 字节）：

- 含 `outdoor-history` → **true**
- 含 `outdoor-plans` → **false**

即：线上 `scene-api` 有 `/outdoor-history`，**没有 `/outdoor-plans`**。

而 `/outdoor-plans` 与 `/outdoor-history` 出自**同一提交** `d53228b6`（2026-11-17 04:25 +08:00，`feat(outdoor): 活动跨设备不丢——云端副本/版本冲突二选一/找回列表/卡片历史后端化/本机免登录`）。线上函数部署于 2026-11-16 16:49Z = **北京时间 2026-11-17 00:49**，早于该提交进入 main。

### 1.2 正式站前端确实在调这个端点

线上懒加载包 `/_next/static/chunks/3609-8f591ef09eadf2e7.js`（841 309 字节）内含 `outdoor-plans` 与 `outdoor-history` 两个路径。

前端调用点：`frontend/lib/backend-session.ts:984 / 988 / 1001`（`listOutdoorPlans` / `getOutdoorPlan` / `saveOutdoorPlan`），线上运行时代码与之同源。

### 1.3 真机跑出来的 404（不是推断）

正式站 + 真实账号 + 真实浏览器会话，本轮实测请求流水：

```
GET 200 /functions/v1/scene-api/outdoor-plans
PUT 404 /functions/v1/scene-api/outdoor-plans
GET 200 /functions/v1/scene-api/outdoor-history?projectId=project%3Ahouse-r9hqp47b
GET 200 /functions/v1/scene-api/studios
GET 200 /functions/v1/scene-api/assets
GET 200 /functions/v1/scene-api/preferences
GET 404 /functions/v1/scene-api/studios/{id}/settings
```

`PUT /outdoor-plans` 的响应体（真实云端返回）：

```json
{"error":{"code":"ROUTE_NOT_FOUND"}}
```

即：**前端确实在把户外方案副本推云端，服务端直接 404**。按 `frontend/components/room-organizer/components/outdoor-plan-overlay.tsx:686-714` 的设计，例行失败是静默的（只在版本冲突时提示），所以界面上看不到任何异常——这正是它此前没被发现的原因。

## 2. 数据库侧同样落后

仓库 `supabase/migrations/` 共 52 个文件，真实云端**已应用 44 个，缺 10 个**：

```
20261112180000_agent_plan_candidates.sql
20261116130000_agent_data_retention.sql
20261117180000_outdoor_plans.sql          ← 户外副本表（outdoor_plans）在这里建
20261117190000_outdoor_plans_force.sql     ← outdoor-plan.put 的 force 豁免
20261117200000_project_trash.sql
20261117201000_studio_trash_guard.sql
20261118100000_generation_ledger_close.sql
20261118160000_provider_asset_size_ceiling.sql
20261118170000_per_owner_active_generation.sql
20261119120000_review_share_links.sql
```

直接查库确认：

```sql
select to_regclass('scene_private.outdoor_plans')::text;  -- => null（表不存在）
```

并尝试走已上线的 RPC 分发器：

```
POST /rest/v1/rpc/scene_rpc {"p_actor":"<uuid>","p_action":"outdoor-plan.list","p_data":{}}
→ 400 {"code":"P0001","message":"PROJECT_NOT_FOUND"}
```

→ 户外副本动作在当前 `scene_rpc` 链上不可达。

## 3. 对 #79 门禁的影响

| 用例 | 影响 |
| --- | --- |
| #7 / #8 / #9 | "真实云端"一栏要读 `outdoor_plans.revision` 前后对照。当前表不存在、端点 404 → 该栏只能记 `blocked`（部署缺口），**不能记 pass** |
| #5 | 同理：离线前后要读云端 revision 做"零写"对照，现只能读请求流水（出网前被拦 / 服务端 404） |
| #1 / #4 | 浏览器一栏可独立成立（地点候选、场地确认、红线入画布、零模型请求退回气泡都已实测） |
| #2 | 不受影响，仍是唯一三类全绿 |

## 4. 要补的两件事（需要人授权）

1. **部署 Edge Functions**：把 main 的 `scene-api` / `conversation-api` 发到 `wkhfvnzgopjdzxlmycks`（当前版本落后 3 天）。
2. **应用缺失的 10 条迁移**（其中 `20261117180000` / `20261117190000` 是户外副本表与 force 豁免）。

本轮**没有做**这两件事——仓库规范要求迁移与 Edge Functions 变更走人 review，且未获部署授权时不做部署。
授权后，本文件 §1.3 的 `PUT /outdoor-plans 404` 应当变为 200 且响应体含 `revision`，届时 #7/#8/#9 的云端一栏才有可能补齐。

## 5. 复跑命令

```bash
node docs/evidence/79/tools/case-07-08-09-chain-v2.mjs     # 真机链路，HAR 与截图落在 docs/evidence/79/0{7,8,9}/
node .temp/probe-db3.mjs                                     # 表/列/行读数（管理 API 只读 SQL）
```
