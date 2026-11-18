# 户外 Agent 批次验收结论（M0–M7 汇总，轮次 104）

- 生成：2026-11-19 · 分支 `agent/outdoor-m7-walkthrough-wire` @ `e8c234a8`
- 用途：一页回答「每批到底验收了没有、证据在哪、还差什么、谁去补」
- 口径：**固定数据**＝本地 Vitest；**真实浏览器**＝`:3210/:3211` 上跑出来的界面行为；**真实云端**＝真实请求 + 日志关联。三类缺一即不算该条通过
- 本页只汇总已有证据，**不产生新的通过结论**；数字来自代码常量与本目录三份计划文件，不手抄

## 一、批次结论

| 批次 | 结论 | 证据（可复跑） | 缺口与归属 |
| --- | --- | --- | --- |
| **M0** 固定复现 | **已收口** | `placeStillPending` 增加 `rangeConfirmed`；复合句不再被 `matchVenueCommand` 整句吃掉；浏览器重验零 `/assistant/chat` | 无 |
| **M1** 诊断 | **部分**（固定数据齐，浏览器未验） | `turn-trace` 14、`turn-trace-log` 7、`turn-failure-diag` 5；面板失败卡显示编号 | 真实失败下的浏览器实证需登录态 → **需 9222** |
| **M2** 恢复需求 | **已验收（接回链）** | `pending-brief` 9、`outdoor-pending-task` 12、`outdoor-task-brief-bridge` 9；轮次 21 登录态实跑：画范围→确认→红线写入，静置 14 秒 `xhr/fetch = 0` | 进度行滞留未判定；「跨活动不串」未验 → 需登录态 |
| **M3** 分流与上下文 | **部分**（解析层已交，接线未做） | `instruction-layers` 9（环境口径/后置动作/当前指令三层） | 轮次 25 实测「无室内，后续是造墙」被登录卡顶掉；接线到 brief 是下一步 → **我可做** |
| **M4** 组合预览 | **部分**（离线切片已交，在线模型路径未验） | 轮次 69：未登录时「帮我分区」「200 人市集…」本地模板出预览、零模型请求、确认才写 | 在线模型路径（九方位 proposeUseZones、局部小改）需登录态 → **需 9222** |
| **M5** 应用与恢复 | **部分** | `outdoor-apply-once` 6（同一 epoch + 基准版本只放行一次）、`outdoor-flow-restore` 9（旧草稿逐项取舍） | 双击确认 / 切换活动 / 撤销的真实浏览器验收 → **需 9222** |
| **M6** 工作台体验 | **已验收（375/768）** | 关闭钮 32×32、`cardOpen=false`、`railOpen=false`；768 无横向溢出 | 480 全流程未跑 → 需登录态；卡片打开时入口被盖住（判定为非缺陷） |
| **M7** 验收与发布准备 | **进行中（已拦发布）** | 31 门禁 / 32 回退手册 / 33 对照表 / 34–43 指标与自检 / 44 验收声明 / 45 门禁复跑 / 46 基线校正；本批 50 个切片见进度文件 | 11 条 **0 条三类全绿**；浏览器、云端两类全未验 → **需 9222 + 云端授权** |

## 二、11 条验收用例（逐条一行）

固定数据一列来自代码 `FIXED_DATA_EVIDENCE`（轮次 102 口径：有实存测试文件才算，轮次 103 用 `node:fs` 钉住文件存在）；浏览器/云端来自 `2026-11-16-outdoor-evidence-matrix.md` 的实证记录。

| # | 用例 | 固定数据 | 浏览器 | 云端 | 结论 |
| --- | --- | --- | --- | --- | --- |
| 1 | 空白项目输入组合需求，地图确认地点及范围 | `outdoor-event-turn`、`instruction-layers`、`outdoor-map-context` | 部分（正式站两轮整链跑通） | 无 | **部分**：用本机草稿画布而非空白项目 |
| 2 | 两个同名地点，地图选中其中一个 | `outdoor-venue-candidates`、`outdoor-venue-sync`、`outdoor-project-store` | 无 | 无 | **未验**：同名选择逻辑有 8 条，真实搜索未跑 |
| 3 | 有范围、已选设施，发明确小改 | `instruction-layers`、`outdoor-event-turn` | 部分（请求已发出，改口未被采纳） | 无 | **未通过** |
| 4 | 无范围先发设计句，再改预算或人数 | `outdoor-pending-task`、`pending-brief` | 部分（只验了「先发设计句」） | 无 | **部分** |
| 5 | 地图部分、离线或无路网 | `outdoor-case5-offline`、`outdoor-map-context`、`outdoor-walk-boundary` | 无 | 无 | **未验** |
| 6 | 未登录、功能关闭、额度不足、网络超时 | `outdoor-login-copy`、`turn-failure-diag` | 部分（登录门 + provider_error 两类） | 无 | **未通过**：四类阻塞未分别验 |
| 7 | 待预览时说「等等」或过时的「确认」 | `outdoor-apply-once` | 部分（过时确认已修，v4.15.5） | 无 | **部分**：「说等等」未验 |
| 8 | 应用中刷新、双点确认、切项目 | `outdoor-flow-restore`、`outdoor-apply-once`、`outdoor-project-store` | 部分（应用后刷新不丢） | 无 | **部分** |
| 9 | 确认后撤销，重开旧草稿 | `outdoor-apply-once`、`turn-trace` | 部分（有入口，未点击） | 无 | **未验** |
| 10 | 一条真实模型失败，一条纯本地成功 | `turn-failure-diag`、`turn-trace` | 部分（两类样本都有，缺日志关联） | 无 | **部分** |
| 11 | 普通聊天、室内布局、导出与旧云 Agent Run | `plan-door-snap`、`zones` | 部分（只验 GeoJSON 导出） | 无 | **未通过** |

## 三、总判断

**不能发。** 11 条里 0 条三类全绿；云端一类 11 条全部未验；浏览器只有部分证据，且 #3、#6、#11 已观测到明确未通过。

最短路径（需人给条件）：

1. **一次可用的登录态（9222 调试端口）**——把 #1/#3/#7/#8/#9 在同一条会话里连着跑完（组合需求 → 小改 → 预览 → 应用 → 撤销），这五条正好同链；
2. **#2、#5** 用真实搜索与断网场景各跑一次；
3. **云端一类**需真实云端请求 + 日志关联，agent 无授权。

我这边还能在无网络条件下推进的：M3 接线（解析层到 brief）、面板与报告的一致性自检——都属于打磨，不会把任何一条从「未验」变成「通过」。

## 四、复跑命令

```bash
cd C:/Users/13266/.dsh/bot/workspace/Scendance2026/frontend

# 全部户外/走查测试（70 文件）
npm test -- $(ls components/room-organizer/lib/outdoor-*.test.ts components/room-organizer/lib/*walkthrough*.test.ts \
  components/room-organizer/components/outdoor-*.test.tsx components/room-organizer/components/*walkthrough*.test.tsx \
  components/room-organizer/hooks/use-outdoor-agent-workflow.react.test.tsx)
# 期望：70 文件 / 764 测试全过（轮次 103 实测）

# 固定数据证据的文件存在性（轮次 103）
npm test -- components/room-organizer/lib/outdoor-fixed-data-evidence.test.ts

# 台账与卡片（固定数据 11 条、全绿 0 条）
npm test -- components/room-organizer/lib/outdoor-release-status-card.test.ts \
  components/room-organizer/lib/outdoor-release-gaps.test.ts

# 类型检查
npx tsc --noEmit    # 期望 0 行
```
