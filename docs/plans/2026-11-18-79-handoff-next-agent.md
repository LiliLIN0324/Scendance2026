# #79 剩余工作交接单（2026-11-18 晚 · 交给下一个 agent）

> 用途：把「不依赖真机的部分」做完之后，剩下需要真机 / 登录态 / 系统权限 / 人决策的事项按条目交清，下一个 agent 按单取证、回填、不越权判级。
> 边界：本单**不产生任何 `pass`**。三类证据（固定数据 / 真实浏览器 / 真实云端）不齐就是 `partial` 或 `blocked`；`n/a` 不能顶 `pass`。门禁解除只能由人签字。
> 关联：走查清单 `docs/plans/2026-11-18-79-walkthrough-checklist.md`；根因拆解 `docs/plans/2026-11-18-79-rootcause-and-gaps.md`；证据对照 `docs/plans/2026-11-16-outdoor-evidence-matrix.md`；构建复核 `docs/evidence/79/00/2026-11-18-live-build-review.md`。

## 0. 当前台账快照（2026-11-18 第三轮结束时）

| 用例 | 固定数据 | 真实浏览器 | 真实云端 | 结论 |
| --- | --- | --- | --- | --- |
| #2 两个同名地点 | 既有 8+21+28 条 | pass | pass（零写） | **三类全绿（11 条里第一条）** |
| #5 地图部分 / 离线 | 既有 7+13 条 | partial | 未声明 | **partial + 2 个已登记缺陷** |
| 其余 9 条 | 有固定数据 | 未验或部分 | 无 | 不计过 |

- 走查记录本（只存在本机浏览器 localStorage，按 origin 隔离）：
  - `scendance.outdoor.walkthrough.v1` = `{"v":1,"seen":{"2":"pass","5":"partial"}}`
  - `scendance.outdoor.walkthrough.cloud.v1` = `{"v":1,"pass":[2]}`
- 线上构建：c778 主包 `9150.98974b54efc4f8c2.js` 已确认含 #3 选路口径、#6 超时档、日期不跨轮三处修复（见构建复核证据）；**包内有代码不等于真机验收通过**。
- 技术门禁基线：Node 24.15.0 下定向 4 文件 46 例全过、`tsc --noEmit` exit 0；CHANGELOG v4.17.11 PASS（v4.15.x / v4.16.0 历史段问题不在本轮范围）。

## A. 真机走查：#3 / #6 / #7 / #8 / #9 / #11（另含 #4 / #10 缺口）

**状态**：需可交互、带非游客登录态的浏览器 + DevTools / HAR；本环境不具备。

**前置（清单 §0 预检，四项任一不过 → 记 `blocked`，不出 `pass` 行）**：运行环境与抓包手段、登录态刷新后仍在、账号物料库非空且云保存能读回 revision、断网与导出落盘手段。

**按顺序连跑（清单 §7）**：

| 用例 | 要取的证据 | 证据目录 | 判不过就登记 |
| --- | --- | --- | --- |
| #3 明确小改 | 复现输入、请求 id、提案卡上的路名与入口候选（点名路是否排前、否定路是否排除、找不到是否如实说明） | `docs/evidence/79/03/` | 改口未生效记 `fail`，附对话与提案快照 |
| #6 四类阻塞 | 未登录 / 暂未启用 / 额度不足 / 响应超时 四类各自的触发条件与界面文案；未登录只能在未登录态验 | `docs/evidence/79/06/` | 哪一类分不出来记 `fail` |
| #7 预览时说「等等」 | 旧票号 / 提案 id、旧确认被拒提示 DOM、新提案应用前后物件差异；应用写请求只一次、旧票零写 | `docs/evidence/79/07/` | 旧票仍能落内容记 `fail` |
| #8 三个子场景 | 8a 应用中刷新：终态一致、revision 不倒退；8b 双点确认：只落一次、物件不翻倍；8c 切项目：B 的 revision 不变、会话不串 | `docs/evidence/79/08/` | 重复写 / 物件翻倍 / 串项目记 `fail` |
| #9 撤销回读 | 撤销入口、撤销后物件数与几何、重开旧草稿对比；撤销若触发写，revision +1 且内容回基线 | `docs/evidence/79/09/` | 撤销后几何回不去记 `fail` |
| #11 导出与旧云 Run | CSV / PDF / 效果图 / GeoJSON 四件文件；PDF 墙线与图例对照；旧云 Run 真实请求 + run id + 结果；导出是本机产物，云端列记 `n/a（零写）`，不硬凑 pass | `docs/evidence/79/11/` | 格式打不开或计数不一致记 `fail` |
| #4 后半段 | 「再改预算或人数」的浏览器实证（前半段「先发设计句」已有部分证据） | `docs/evidence/79/04/` | — |
| #10 服务端日志关联 | 诊断编号与一次真实请求的服务端日志对上 | `docs/evidence/79/10/` | 需云端日志权限 |

**不许做**：不重跑 #1 全链（已有 2026-11-17 第二轮证据）；不用本机草稿画布冒充云项目；不在走查前手改 `BROWSER_EVIDENCE` 常量；代码修好不等于走查通过，#3 / #6 代码侧已修但真机未验之前照旧记 `partial` / `blocked`。

## B. #5 判 `pass`：手段 + 产品口径两件事都缺

**状态**：维持 `partial`；不具备系统级断网手段，且两个缺陷等产品口径。

1. **手段**：需要提权改 hosts / 系统代理，或换一个带 DevTools offline 的浏览器（页面级 `fetch`/`XHR`/`onLine` 注入盖不住 `<img>` 瓦片，「地图部分（瓦片）」那一格至今没验到）。取到断网前基线：本地 `scendance-outdoor-plan-v1:<projectId>` 与云端 revision；断网后零写证据三条件（写请求计数 0 / revision 不变 / 本地键不变）同时满足，云端键才能点。
2. **两个已登记缺陷（未修，归属文件见矩阵 §8.2）**：
   - 离线检索无降级文案，本地「最近选过」缓存冒充检索结果（`plan-place-search.tsx` + `place-search.ts`）。
   - 断网点确认后写入进行态约 1 分钟不收口，恢复网络也不补写、不报错（`use-outdoor-agent-workflow.ts` 应用链路）。
   - 这两条要先定产品口径：要不要加离线提示、进行态失败怎么落终态；口径定了才排修，修完再回到 #5 走查。

## C. #2 遗留：选中后的 `project` 读取证据

**状态**：上一轮抓取窗口漏了这一条。#2 的零写结论（20 个全 GET）是硬证据，但「选中后 project 读取」这一项按缺记处理。

**补法**：在规范域名上带登录态重跑一次 #2 流程，点选候选后抓 `scene-api` 的 project 读请求（路径 / 状态码 / 返回 revision），与零写计数一起补进 `docs/evidence/79/02/`；本用例不应有写，写请求计数必须仍为 0。

## D. 线上构建复核：本轮已闭合（留档，不是待办）

- 结论与方法见 `docs/evidence/79/00/2026-11-18-live-build-review.md`：c778 主包含三处修复标记。
- 下一轮若复核构建：先核对当前 runtime 哈希（别名会轮换），用完整超时文案 `服务商这次没在时限内返回` 作 #6 标记，别单搜「响应超时」（会撞上生成服务商的旧文案）；线上不发 source map，标识符被压缩，只能按中文文案 + 分支结构核对。

## E. 走查记录本落盘：换浏览器 / 清缓存就回退

**状态**：记录本只在 localStorage。两种可选做法，待定一个：

1. 在走查板加「导出记录」按钮，把 `seen` / `cloud` 导成 JSON 文件落 `docs/evidence/79/`；
2. 把当前快照提交成 `docs/evidence/79/walkthrough.json`，下一轮走查后随证据一起更新。

注意：归档的是记录本快照，不是 `pass` 结论本身；每条 pass 仍要在 `docs/evidence/79/<case>/` 下有原始证据支撑。

## F. 门禁签字：只能由人写

11 条三类全绿才解除发布门禁；技术门禁（tsc / 定向测试 / build）绿不替代走查门禁。本单与任何 agent 都不能写「门禁解除」。

## 复跑命令（本地，Node 24）

```bash
# Node 24 在 .tmp-node24/node-v24.15.0-win-x64；vitest 必须在 frontend 目录起
cd frontend
node node_modules/vitest/vitest.mjs run \
  components/room-organizer/lib/outdoor-browser-evidence.test.ts \
  components/room-organizer/lib/outdoor-walkthrough-book.test.ts \
  components/room-organizer/lib/outdoor-walkthrough-store.test.ts \
  components/room-organizer/components/outdoor-walkthrough-board.test.tsx
npm run typecheck
```

期望：4 文件 46 例全过；`tsc --noEmit` exit 0。
