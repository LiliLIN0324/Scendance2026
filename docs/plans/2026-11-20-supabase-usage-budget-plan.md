# Supabase 用量止血与 50 用户容量计划

日期：2026-11-20。状态：P0 已执行，P1 起待批。

本文只写当前可复现的事实与可执行步骤；每阶段做完必须贴真实命令输出，不能把步骤当证据。

## 0. 结论

1. 打爆额度的不是用户量（MAU 13），是**闲置页签的重复轮询**：同一份团队未读被两个常驻组件各开一个 20 秒定时器，面板打开时变三个。
2. 免费额度真正撑不住 50 用户的地方**不是调用次数而是出网流量**：13 个 MAU 已用 3.74GB / 5GB，按人均外推 50 用户约 14GB。
3. 所以顺序固定：先去掉重复与空转（不花钱）→ 50 人前把未读换 Realtime、素材换 CDN → 最后才考虑升级 Pro。

## 1. 事实快照（2026-11-20 实测）

| 项 | 实测值 | 来源 |
| --- | --- | --- |
| 本周期 Edge Function 调用 | 716,768 / 500,000（143%） | Dashboard 用量页 |
| 本周期 Egress | 3.74GB / 5GB（75%） | 同上 |
| 本周期 Log Ingestion | 3.45GB / 1GB（345%，计费自 2027 初开始） | 同上 |
| MAU | 13 | 同上 |
| 线上 cron 任务 | 仅 `agent-data-retention`（每天 03:30） | `select jobid,jobname,schedule,active from cron.job` |
| `scene-generation-poll` | **已于本日 unschedule**，返回 true | `select cron.unschedule('scene-generation-poll')` |
| `scene-reconstruction-poll` | 从未安装 | 同上查询结果 |
| `useTeamUnread` 调用点 | 3 处：`rail-team-block`、`rail-messages-button` 常驻；`messages-panel` 打开时 | 代码检索 |
| `useOfficialUnread` 调用点 | 1 处常驻：`rail-messages-button` | 代码检索 |
| 客户查看器 `/view/` | 无轮询，一次读取 + 本地到期计时 | `frontend/app/view/page.tsx` |
| Realtime | 前端零使用 | 代码检索无 `.channel(` |
| 服务端租约 TTL | 90 秒，前端 30 秒续期（3 倍余量） | `supabase/migrations/20261002060304_scene_core.sql` |

单页签闲置成本（推算，按代码间隔计算）：

| 来源 | 现状 | 说明 |
| --- | --- | --- |
| 团队未读 ×2 常驻 | 6 次/分钟 | 同一份数据问两遍 |
| 官方未读 ×1 常驻 | 3 次/分钟 | |
| 合计 | **9 次/分钟 ≈ 12,960 次/天** | 页面挂着不动也照打 |

## 2. 通过标准

| 指标 | 目标 |
| --- | --- |
| 新周期（12-02 起）Edge 调用 | ≤ 500,000 |
| 单页签闲置成本 | ≤ 2 次/分钟 |
| 出网流量 | 免费期内 ≤ 5GB；50 用户前完成 CDN 化 |
| 12-20 前 | 上述两项均有实测证据，不触发 402 |

## 3. 阶段

### P0 止血（已完成）

- `cron.unschedule('scene-generation-poll')`：每天省 1,440 次。
- 代价：新生成任务不再自动推进，会停在 `queued`；恢复用 `supabase/ops/install-generation-cron.sql`。
- 本项只占超额量的 6%，不解决主因。

### P1 前端去重与挂起（不改行为、只改频率）

| # | 改动 | 文件 | 预期 |
| --- | --- | --- | --- |
| 1 | 团队未读合并成模块级单定时器 + 订阅广播（沿用 `notifyUnreadChanged` 的既有模式） | `frontend/components/room-organizer/lib/team-messages.ts` | 6→3 次/分钟 |
| 2 | 未读类轮询加 `document.hidden` 暂停，回到前台立刻补拉一次 | 同上 + `lib/official-notices.ts` | 后台成本→0 |
| 3 | 官方未读 20s→60s | `frontend/components/room-organizer/lib/official-notices.ts` | 3→1 次/分钟 |
| 4 | 租约续期挂起：不可见时停、回前台立即续 | `frontend/lib/backend-session.ts` | 只影响闲置页签 |
| 5 | 私信 5s→10s（仅窗口打开时生效，优先级最低） | `lib/team-messages.ts` | 每窗口减半 |

不改：90 秒锁 TTL 与 30 秒续期比例（拉到 60 秒只剩 1.5 倍余量，会丢锁）。

验证：`npm --prefix frontend run typecheck`、`npm --prefix frontend run test`（应含未读相关用例）、本机预览开关页签各一次并观察 Network 面板。

### P2 服务端条件触发

把生成轮询改成「库里有活才发请求」，不再 24 小时空敲：

```sql
select cron.schedule('scene-generation-poll','* * * * *',$job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'scene_project_url') || '/functions/v1/generation-worker',
    headers := jsonb_build_object('Content-Type','application/json',
                                  'Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'scene_worker_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  )
  where exists (
    select 1 from scene_private.generation_jobs
     where state in ('queued','submitting','submitted','processing','archiving','submit_unknown')
  );
$job$);
```

状态集合与 `supabase/ops/verify-generation-closure.sql` 一致。验证：无任务时 `net._http_response` 不再新增；造一条 queued 任务后一分钟内被接单。

### P3 50 用户容量（12-02 前定方案，不必立即上线）

| 项 | 做法 | 触发条件 |
| --- | --- | --- |
| 未读/私信 | 换成 Realtime `broadcast`，前端不再定时问 | 常驻页签 > 10 |
| 3D 素材 | GLB / 点云 / 场景包走 R2 + CDN，长缓存；不塞 Supabase Storage | 当前即可做，流量主因 |
| 只读查看器 | 保持零轮询，素材必须吃 CDN 缓存，禁止加任何心跳 | 一直 |
| 生成任务 | P2 的条件触发已够，无需再改 | — |
| 升级 Pro | 排在 P1/P2/P3 之后；以升级页实际额度为准 | 免费额度仍不够时 |

### P4 治理

- 把本文 §1 的用量口径固化进现有文档（不新增主目录文件）。
- 每次发布后核对一次 Dashboard 的三个数字：调用、Egress、Log。
- 新增加任何 `setInterval` 都必须回答：页面不可见时停不停？会不会重复实例？

## 4. 50 用户容量模型

假设：50 人 × 每天在线 2 小时 = 6,000 页签·分钟/天（假设值，须用真实数据校准）。

| 方案 | 每页签每分钟 | 每天 | 每月 |
| --- | --- | --- | --- |
| 现状 | 9 | 54,000 | 约 162 万（超 3 倍） |
| 仅 P1 | 4 | 24,000 | 约 72 万（仍超） |
| P1 + 可见性暂停（按 40% 可见） | ~1.6 | ~9,600 | 约 29 万（安全） |
| P1 + 暂停 + Realtime | ~0.1 常驻 | 操作型为主 | 约 5–10 万（宽裕） |

出网流量（按 3.74GB / 13 MAU ≈ 0.29GB 人均外推）：50 用户约 14GB，免费 5GB 必然打穿 —— 这是 P3 里素材 CDN 化的唯一理由。

## 5. 回滚

| 改动 | 回滚 |
| --- | --- |
| cron | 重跑 `supabase/ops/install-generation-cron.sql`（幂等） |
| 前端轮询 | 单文件回滚；无数据迁移、无契约变更 |
| Realtime | 保留原轮询代码路径，用开关切回 |

## 6. 刻意不做

- 不升级 Pro 来盖住重复请求（会随用户数线性变贵）。
- 不动 90 秒锁 TTL / 30 秒续期比例。
- 不新增消息入口、不合并两套消息 UI（产品决策另议，不在本计划内）。
- 不建第二组织分流额度。
- 不 commit、不 push，除非单独获批。
