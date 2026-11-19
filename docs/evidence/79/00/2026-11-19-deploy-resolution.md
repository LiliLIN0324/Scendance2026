# 部署缺口已闭合：scene-api v64 + 两条户外迁移（2026-11-19）

> 对应缺口：`2026-11-19-deploy-gap.md`。本文只记本轮实际做了什么、读到了什么、哪些仍没做。
> 结论：`PUT /outdoor-plans` 已由 **404 → 200**；`GET /outdoor-plans` 返回 **200 `[]`**；`revision` 可读写，#7 因此转 **pass**，#8b 云端见 1 条 `PUT 200`，#9 云端 CAS 直连验证为 **3→4、旧 revision 冲突不落库**。
> 仍不做：其余 8 条缺失迁移、`conversation-api` 部署、任何云端环境变量。

## 1. 部署前的只读确认

| 项 | 读数 |
| --- | --- |
| 线上 `scene-api` | 版本 **62**，2026-11-16T16:49:18Z |
| `scene_private.outdoor_plans` | `to_regclass(...)` = **NULL**（表不存在） |
| `scene_rpc` 变体 | 有 `scene_rpc_before_agent` / `_before_card_history` / `_before_preferences` 等；**没有** `scene_rpc_before_outdoor_plans` / `_before_outdoor_force`（可安全叠加） |
| 迁移历史 | `20261117180000` / `20261117190000` 均未记录 |

## 2. 实际执行

### 2.1 只应用两条户外迁移

`supabase db push --dry-run` 被三处“远端有、本地没有”的迁移历史挡住：

```
Remote migration versions not found in local migrations directory.
20261112191350 20261118181232 20261118181253
```

没有做 `migration repair --status reverted`（会改历史），改为定向执行：

```bash
# 在事务里只跑 20261117180000 + 20261117190000
supabase db query --linked -f <temp>/apply-outdoor-plans.sql

# 只把这两条记进历史
supabase migration repair --status applied 20261117180000 20261117190000 --linked
```

执行后：

```
table_exists = scene_private.outdoor_plans
scene_rpc_before_outdoor_force
scene_rpc_before_outdoor_plans
migration history: 20261117180000, 20261117190000 => applied
```

### 2.2 部署 `scene-api`

从**干净 worktree** `39fe35c8` 部署，避免把当前工作区未提交的 `_shared` 改动带上生产：

```bash
supabase --workdir <clean-worktree> functions deploy scene-api \
  --project-ref wkhfvnzgopjdzxlmycks --use-api
```

结果：

```
scene-api  ACTIVE  VERSION 64  2026-11-19T01:40:02Z
Deployed Functions on project wkhfvnzgopjdzxlmycks: scene-api
```

## 3. 部署后读数

### 3.1 直连冒烟（真实账号会话）

```
GET /functions/v1/scene-api/outdoor-plans  -> 200 []
scene_private.outdoor_plans                -> 可读，初始 0 行
```

### 3.2 真机链（#7 / #8b）

`case-07-08-09-chain-v2.mjs`，原始读数 `08/2026-11-19-v2-chain-07-08-09.json`：

| 步骤 | 读数 |
| --- | --- |
| #7 说「等等」 | 只有 1 条 `POST /conversation-api/assistant/chat/stream`；**零** `outdoor-plans` / `outdoor-history` 写；本机 plan 574B / zones 0 / boundary 12 不变 |
| #8b 双击确认 | 画布 **0→2 分区**，plan **574→1440B**；写请求恰好 2 条：`PUT /outdoor-history 200` + **`PUT /outdoor-plans 200`**；第二次点击时按钮已消失 |

### 3.3 云端 revision CAS（#9 支撑）

`case-07-08-09-cloud-revision.mjs`，原始读数 `08/2026-11-19-cloud-revision.json`：

| 操作 | 结果 |
| --- | --- |
| GET 当前行 | `revision: 3`，`planLen: 1440` |
| 用 `baseRevision: 3` 写入 | `200`，`{conflict:false, revision:4}` |
| 再用旧 `baseRevision: 3` 写入 | `200`，`{conflict:true, revision:4}`，**不落库、不递增** |
| 事后读表 | `revision: 4` |

> 边界：#9 的浏览器撤销/再应用证据仍沿用 `09/2026-11-19-case09-v2.json`（2/1438B → 0/574B → 2/1438B）；本轮没有把云端 CAS 直连读数冒充成同轮浏览器链读数，所以 #9 仍记 `partial`。

## 4. 对 #79 的影响

| 用例 | 变化 |
| --- | --- |
| #7 | 浏览器 pass + 云端零写 pass + 固定数据 → **pass**（2/11 中的第二条） |
| #8 | 8b 浏览器 pass + 1 条 `PUT 200`；8a/8c 未跑 → 仍 `partial` |
| #9 | 浏览器 pass + 云端 CAS pass，但同轮 revision 未取到 → 仍 `partial` |
| #1 / #3 / #4 / #5 | 端点已恢复，需按各自流程复跑；本轮未补 |
| #10 | 仍缺服务端日志权限 |
| #6 | 未登录分支已取证；额度/超时/功能关闭仍需环境变量 |

## 5. 回滚与备份

- 应用前已导出 `public,scene_private` schema 到临时目录（约 206 KB），未提交仓库。
- 迁移在单事务内执行；如函数层需回滚：
  1. `drop function public.scene_rpc(uuid,text,jsonb);`
  2. `alter function public.scene_rpc_before_outdoor_force(uuid,text,jsonb) rename to scene_rpc;`
  3. 如需回到最早版本，再 `drop function public.scene_rpc(...)` 并把 `scene_rpc_before_outdoor_plans` 改名回 `scene_rpc`。
- **未删除** `scene_private.outdoor_plans`；表内已有走查账号的测试行（`activity_id ee07ebcf-...`，revision 4）。

## 6. 刻意没做

- 没有应用其余 8 条缺失迁移（`agent_plan_candidates`、`agent_data_retention`、`project_trash`、`generation_ledger_close`、`provider_asset_size_ceiling`、`per_owner_active_generation`、`review_share_links` 等）；
- 没有部署 `conversation-api` / `generation-worker` / `reconstruction-worker`；
- 没有改任何云端环境变量；
- 没有为了让台账好看而把 #9 记成 pass。
