# #7 待预览时说「等等」— 第五轮补充取证（2026-11-18）

> 第四轮 blocked 登记见 `2026-11-18-case07-blocked-no-proposal.md`。本轮在正式站带登录态会话 A（`house-uat5t1nz`「周末共创工作坊」）真正生成了待确认提案，跑完「说等等 → 旧票收场 → 新提案应用」半条链；**不构成 pass**，缺的三项见 §4。

## 1. 环境与基线

| 项 | 读数 |
| --- | --- |
| 站点 | `https://scendance-scene-planner-ewz.pages.dev/` |
| 登录态 | 有效；账户「沙金 · 丸子头」，团队「endTree的工作室 / 幕景」 |
| 活动 A | `house-uat5t1nz`「周末共创工作坊」；锚点 120.163749, 30.252830（gcj-02，lookup） |
| 应用前本地 plan | 键 `scendance-outdoor-plan-v1:house-uat5t1nz`，长度 **10 726**；boundary 12 / zones 3 / routes 9 / nodes 7 / facilities **0** / workers 0 |
| 全案统计（应用前截图） | 场地面积 99 935.9 m²；分区 3 · 设施 0；动线 9 条 · 全长 6057.9 m（人行 3802.1 / 车辆 1884 / 后勤 371.9）；出入口 7；人员 0 |

截图：`2026-11-18-r5-pre-apply-overview.png`（应用前全貌，设施 0）。

## 2. 第一版候选与「等等」指令（旧票收场）

1. 点「预览按分区摆放物料」生成第一版本地草案（**未**发起 scene-api 提案创建请求）。默认方案经面积收口：展示区 市集摊位 ×50、交流区 椅子 ×200、休息区 桌子 ×1 + 垃圾桶 ×2 + 指示牌 ×2；确认卡三按钮「确认并应用这一版 / 换一种排法 / 撤回预览」。
2. 未点确认，在主聊天框发送：「等等，先别应用这一版，我再核对一下分区。」
3. Agent 回执原文：

   > 好的，这版默认分区方案先不应用。你可以核对展示区、交流区、休息区的位置与范围，确认后告诉我要改哪一块或直接确认保留。

4. 旧确认卡整张被新回合顶掉、消失；设施计数仍为 **0**。

**旧票写请求对账**：该回合缓冲内只有一条 `conversation-api/assistant` 会话 POST（会话消息本身），**无 scene-api 场景写**（无 outdoor-plans / outdoor-history PUT）。

## 3. 新提案单次确认应用

- 聊天请求重出一版时模型路径失败（「当前没有可确认的提案…」），改为再点「预览按分区摆放物料」重出第二版候选（截图 `2026-11-18-r5-pending-card-second-pass.png`）。
- 单次点击「确认并应用这一版」→ 回执：

  > 已应用「按分区用途出的默认方案」。下一步：物件间隙的子入口与支线；也可直接补充要求或回退修改。

- 应用后本地 plan 回读：长度 **10 726 → 125 435**；facilities **0 → 255**（摊位 50 + 椅子 200 + 桌子 1 + 垃圾桶 2 + 指示牌 2，**无翻倍**）；boundary 12 / zones 3 / routes 9 / nodes 7 / workers 0 均未变；`updatedAt: 2026-11-18T15:54:47.636Z`。
- 缓冲内场景相关请求：`GET outdoor-history` + `PUT outdoor-history`（卡片历史后端副本，表 `scene_private.outdoor_card_history`，按 actor + projectId）；其余为 studios unread 轮询 OPTIONS/GET。**应用回合未观测到 outdoor-plans 本体写**。

## 4. 为什么仍是 partial（缺项，不顶 pass）

| 判据（清单 §2 #7） | 本轮是否取到 | 缺口 |
| --- | --- | --- |
| 旧票号 / 提案 id + 基准 revision | 否 | 户外提案身份在 React 内存态（`OutdoorWorkflowProposal {kind,label,base,mapVersion,epoch,next,…}`），DOM 与 localStorage 读不到；fiber 链未取到 epoch/base digest |
| 旧确认被拒的失效提示 DOM | 否 | 旧票是被新回合**顶掉**消失，不是点旧确认触发「旧提案已失效」分支；失效文案 DOM 未观察到 |
| 应用写请求只一次、revision +1 | 部分 | 应用回合只有一次 outdoor-history PUT（卡片副本）；规划本体 outdoor-plans 写未在应用窗口观测到；**revision 前后对照与响应体（revision/undoGroup）未读到**（网络缓冲读取后排空） |
| 旧票零写 | 是 | 「等等」回合零 scene-api 写，仅会话 POST |
| 应用前后物件/几何对比 | 是 | 设施 0→255，其余几何计数未变；无翻倍 |

## 5. 代码核实（架构事实，供下一轮对账）

- `outdoor-history` PUT 是**卡片历史副本**，不是规划本体 revision；契约见 `supabase/functions/_shared/api.ts:307-313`、`frontend/lib/backend-session.ts:940-947`、迁移 `20261117120000_outdoor_card_history.sql`。
- 规划本体有独立的 `outdoor-plans` 表与版本保护（`baseRevision` / conflict / force），契约见 `supabase/functions/_shared/api.ts:316-329`、`backend-session.ts:953-971`；本轮撤销回合观测到一次 `PUT outdoor-plans`（见 `../09/2026-11-18-case09-round5-supplement.md`）。
- 室内提案契约（`/projects/{id}/proposals/apply`，响应含 revision/scene/previousScene/undoGroup）**户外链路不走**；户外确认卡没有同构的提案 id 回读面。

## 6. 边界

- 本轮未伪造 pass；浏览器列记 `partial`，云端列 `none`。
- 本地 plan 为本机草稿；云端 revision 读数仍缺，不把本机计数冒充云端通过。
- 会话 A 的「延安路口」进出方向澄清本轮始终未回答（三选一：只能进 / 只能出 / 双向）。
