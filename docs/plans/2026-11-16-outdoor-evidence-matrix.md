# 三类证据对照表（M7.1）

- 实测时间：2026-11-16 轮次 33，HEAD `19334be3`
- 方法：把计划 §5 的 11 条验收用例逐条对到**现有可复跑的测试**（本轮实跑取数）与**真实浏览器记录**（取自进度文件各轮次实证）；缺的直说缺
- 三类口径：**固定数据**＝本地 Vitest；**真实浏览器**＝在 :3210/:3211 上跑出来的界面行为；**真实云端**＝真实请求 + 日志关联。任何一条只有固定数据的，都不算该用例通过

## 0. 当前状态快照（锚点，轮次 68）

下面这段是 `statusCardSnapshot()` 在「默认台账」下的输出，**逐字段被测试钉住**，不是手抄：

```json
{"evidenceAsOf":"2026-11-17 正式站走查第二轮","cases":{"total":11,"ready":0,"missing":5,"browserOnly":6},"browser":{"pass":[],"partial":[1,3,4,6,7,8,9,10,11],"none":[2,5]},"cloud":{"pass":0,"unverified":11},"gate":{},"allGreen":0}
```

- 复跑：`cd frontend && npm test -- components/room-organizer/lib/outdoor-release-status-card.test.ts`，看用例「默认台账下的快照一字段不多一字段不少」。
- 读法：`allGreen: 0` 是**算出来的**（三类全绿要固定数据 + 浏览器 pass + 云端 pass，目前没一条同时满足）；`gate: {}` 表示本次快照没带门禁读数，不代表门禁没跑过。
- 用途：以后每轮只需把新快照与这段 diff，“哪些数字变了”不再靠肉眼对表格。
- 这条锚点不是靠人看住的：`frontend/components/room-organizer/lib/outdoor-matrix-anchor.test.ts`（轮次 70）会读本文件 §0 的 JSON，与 `statusCardSnapshot(默认台账)` 逐字对比；锚点过期或手抄走样，测试直接红。
- 轮次 71 起 `browser` 多了 `pass` 档：证据可以由一份 `WalkthroughRecord` 传进来（`browserEvidenceFrom()`），不传就还是照本表抄的那份常量；`pass: []` 就是“一条走查通过的都没有”，不是没这项。

## 1. 逐条对照

本轮实跑 14 个文件、**148 条全绿**（`--reporter=json` 逐文件计数，原始结果 `.temp/r33-tests.json`）。

| # | 验收用例 | 固定数据（文件 / 条数） | 真实浏览器 | 真实云端 | 结论与缺口 |
| --- | --- | --- | --- | --- | --- |
| 1 | 空白项目输入组合需求，地图确认地点及范围 | `outdoor-event-turn` 3、`instruction-layers` 9、`outdoor-map-context` 7 | **部分（正式站走查，2026-11-17 两轮）**：组合句「在杭州 IN77 做设计，80 人发布会，户外广场 30×20 米…」→ 6 条地点候选（候选 1 带「有轮廓」）→ 场地确认卡 → 范围写进画布（红线）→ 待恢复槽里的需求句自动接回并送去模型 → 模型出「计划 2 个步骤」审批卡 → 分区预览确认写入画布；证据线 `features=108`；**第二轮把 V1→V2→V3→V4→V5 在同一条登录态会话里整条跑完**（V2 入口与通道 → V4 物料 → V4 子动线 → V5 岗位点位），并导出真实几何离线复核（69 745 字节：3 分区 / 12 动线 / 9 出入口 / 3 岗位） | 无 | **部分通过**：组合需求那一半在正式站已通（轮次 28 的「零请求无气泡」不再复现），主链也整条跑通了；但走查用的是本机草稿画布而非空白项目，账号物料库是空的（V4 物料复用没有真实物料可复用），「空白项目」口径未完全覆盖 |
| 2 | 两个同名地点，地图选中其中一个 | `outdoor-venue-sync` 28（几何与身份投影）、`outdoor-project-store` 21（按项目隔离）、`outdoor-venue-candidates` 8（同名选择） | **pass（2026-11-18 第三轮，正式站）**：先找到同名对——高德源对「街心公园」单源就有 4 条**名称完全相同**、坐标最远相距 89.8 km 的条目（北京海淀/大兴/密云/房山，id `B0FFMBT7FG`/`B000A6DCCD`/`B000A7Y99K`/`B000A81HKU`）；地图「搜地点」框键入后下拉 **4 条同名并存、一条没被合并**（第 5 条才是不同名的「庞各庄街心公园」）；点第 4 条（琉璃河）→ 回读 `scendance-place-recent-v1` 首条 = `B000A81HKU 116.019111,39.593152`，再点第 2 条（大兴）→ 首条 = `B000A6DCCD 116.338711,39.729027`，两次各命中各的、另一条没被误选；`plan.anchor` 未动（定位钉是纯视图辅助）。证据：`docs/evidence/79/02/` | **pass**：正式站 20 个 fetch/xhr **全是 GET、写请求计数 0**；云端读 `scene-api/studios/<id>/messages/unread` 200 ×5、检索读 `/api/amap-place` 200；console 0 error（1 条 three.js 精度 warning 与本用例无关） | **通过（11 条里第一条三类全绿）**：判据四条逐条满足；走查记录本已标 `seen{"2":"pass"}` + 云端键已声明。遗留：「选中后的 project 读取」没落进抓取窗口（按缺记处理）；HAR 导出本环境不具备 |
| 3 | 有范围、已选设施，发明确小改 | `instruction-layers` 9（分层拆分）、`outdoor-event-turn` 3 | **部分（正式站走查）**：范围确认后发「主通道改走场地北侧仁和路，别沿湖滨路走…」→ `conversation-api/assistant/chat/stream` 真的发出且 200 → 界面报「当前Agent理解不可用（provider_error），规划未变」，如实显示、零写入；**第二轮修完四个死结后复核：这条改口仍然没有被采纳**——路网依旧按等级与长度选湖滨路，入口候选仍只有延安路口 | 无 | **部分**：真实改口请求已发出、模型通道确实被调用；但两轮都没拿到「小改生效」的结果（第一次是模型侧 provider_error，第二次是改口没被采纳），不能算这条用例通过 |
| 4 | 无范围先发设计句，再改预算或人数 | `outdoor-pending-task` 12、`pending-brief` 9 | **部分**：轮次 14 退回气泡给出唯一下一步且零 `/assistant/chat` | 无 | **部分**：只验了「先发设计句」；「再改预算或人数」没有浏览器实证 |
| 5 | 地图部分、离线或无路网 | `outdoor-map-context` 7（含过期 revision 拒绝）、`outdoor-walk-boundary` 13（点在边界内外） | **partial（2026-11-18 第三轮，正式站）**：断网用**页面级请求失败注入**（覆写 fetch/XHR/onLine；本会话非管理员、内置浏览器无 DevTools offline、9222 非 CDP 端点 → **系统级断网做不到**）。读数：① 检索三条请求全被拦在出网前，但下拉**仍显示 2 条本地「最近选过」缓存、且零降级文案**；② Agent 回合失败如实报「这一步没做成 · 这次问答没有完成；服务商可能仍在处理或计费」+「重试云端理解」；③ 地图证据缺失如实报「本轮未取得地图依据，将使用已有规划和输入内容。」；④ 云端报「连接失败，草稿已保留，云端写入已暂停。」；⑤ 断网点「确认并应用这一版」→ 云端两条写请求在出网前被拦（服务端零写）、本地几何计数一条没变，但卡片卡在「正在把…写入画布…」约 1 分钟不收口；⑥ 恢复网络后**无任何静默重放**（唯一 POST 是 Supabase 会话 token 续期）。console **0 error**、页面未白屏。证据：`docs/evidence/79/05/` | **未声明**：写请求明确失败（未出网、服务端零写）+ 本地几何未变；但**云端 revision 没有前后对照读数**，且本地记录 `updatedAt` 被刷新过，按清单 §2「零写证据」的三个条件不满足，**云端键没点** | **部分（partial），并登记两个缺陷**：① **离线时地图检索没有降级文案，且本地缓存冒充检索结果**（`plan-place-search.tsx` + `place-search.ts` 的「失败回空数组」已知取舍）；② **断网下点确认，写入进行态不收口**（`use-outdoor-agent-workflow.ts` 应用链路的云端写失败没落终态提示）。缺口：底图瓦片走 `<img>`、未被注入覆盖，「地图部分」那一格没验到；HAR 导不出 |
| 6 | 未登录、功能关闭、额度不足、网络超时 | `outdoor-login-copy` 4、`turn-failure-diag` 5 | **部分**：轮次 28 观测到未登录时的登录门（输入框被禁、写「登录后继续这次选址」）；正式站走查另观测到第五类阻塞「模型通道 provider_error」（请求 200 但结果不可用，规划不变、如实告知） | 无 | **未通过**：四类阻塞仍未分别验；且未登录时该说的话被登录卡顶掉 |
| 7 | 待预览时说「等等」或过时的「确认」 | `outdoor-apply-once` 6（同一 epoch + 基准版本只放行一次） | **部分（正式站走查）**：真的撞到过「过时的确认」——分区预览出来约 3 分钟后点「确认并应用这一版」→ 报「地图或规划依据已更新，旧提案已失效」，点「重试」重新生成后 1 秒内确认成功；成因是**确认窗口只有 60 秒**（地图要素的观测时间进了版本签名，同一份地图算出新版本），已修（观测时间不进签名，v4.15.5） | 无 | **部分**：「过时的确认」这一半有真实浏览器证据且已修；「说等等」那一半仍未验（固定数据只证票号逻辑） |
| 8 | 应用中刷新、双点确认、切项目 | `outdoor-flow-restore` 9、`outdoor-apply-once` 6、`outdoor-project-store` 21 | **部分（正式站走查）**：刷新那一半有实证——V5 写入画布后重新加载页面，**已放置物件 110、3 分区、12 条动线、9 个出入口、3 个岗位全部还原**（应用后刷新不丢） | 无 | **部分**：四项都是浏览器行为，只验到「应用后刷新不丢」；「应用中刷新」「双点确认」「切项目」仍未验 |
| 9 | 确认后撤销，重开旧草稿 | `outdoor-apply-once` 6、`turn-trace` 14 | **部分（正式站走查）**：UI 上确实有撤回入口（提案卡上的「撤回预览」、属性卡里的「已应用当前对话提案，可整批撤销」），但本轮**没有点过**，没有回读证据 | 无 | **未验**：撤销链路没有回读实证 |
| 10 | 一条真实模型失败，一条纯本地成功 | `turn-failure-diag` 5、`turn-trace` 14（无身份字段） | **部分（正式站走查）**：真实失败样本已拿到 —— `conversation-api/assistant/chat/stream` 200 但界面报「当前Agent理解不可用（provider_error），规划未变」；同一次会话里纯本地分区预览成功产出并写入画布；第二轮把成功样本扩到**整条 V1→V5 主链**（V2 入口与通道 → V4 物料 → V4 子动线 → V5 岗位点位全部写入画布，导出真实几何离线复核） | 无 | **部分**：两个样本都有了（失败如实显示、零写入；本地成功写入画布且覆盖整条主链），但仍缺服务端日志关联，诊断编号没能与一次真实请求对上 |
| 11 | 普通聊天、室内布局、导出与旧云 Agent Run | 室内门/贴边：`plan-door-snap` 等（轮次 24 交付）；壳层：`indoor-zone-door` | **部分**：轮次 20 验了 375/768 手机壳与卡片收口，轮次 24 验了门贴边高亮 746 vs 0 px；第二轮走了**导出这一路**——分享面板「导出场地几何 GeoJSON」实测落盘 69 745 字节，离线解析出 3 分区 / 12 动线 / 9 出入口 / 3 岗位，与画布一致 | 无 | **未通过**：这一条要证「户外升级不破坏既有行为」，导出只验了 GeoJSON 一项，CSV/PDF/效果图没复跑，旧云 Agent Run 也没复跑 |

## 2. M7.1 要求的指标：现在只有两项有数

| 指标 | 现状 | 数据来源 |
| --- | --- | --- |
| 重复输入（同一句是否被要求再说一遍） | 局部有数：接回链 0 次 | 轮次 21/27 浏览器 |
| 地图与模型调用次数 | 局部有数：接回链 `xhr/fetch = 0`、退回气泡 `NET = []` | 轮次 21、轮次 27 |
| 澄清次数 | 局部有数：M3 气泡 `HAS_QUESTION = false`（不追问） | 轮次 27 |
| 确认次数 | 未采集 | — |
| 成功率 | 未采集（11 条用例里 0 条全绿，谈成功率没意义） | — |
| 首个有用反馈耗时 | 未采集 | — |
| 预览耗时 | 未采集 | — |

采集办法（下一轮可直接照做）：在 `:3210` 上用 `connectOverCDP` 起一次会话，包一层 `performance.mark` + `fetch` 计数器，把「键入→首个气泡」「确认→画布出现」两段分别记时；固定数据部分用 `vitest --reporter=json` 的 duration 落盘（本轮已产出一份）。

## 3. 现在能不能发

**不能。** 11 条里：**1 条三类全绿（#2，2026-11-18 第三轮）**、1 条部分（#5，有真实浏览器证据但判据只满足一半 + 两个缺陷）、2 条（#4、#11）有部分浏览器证据、3 条（#1、#6、#11）已观测到明确未通过，其余未验。#1 与 #6 是主流程，按 M7 的阻断口径已经拦发布。

要转绿，最短路径是把 #1/#3/#7/#8/#9 一次会话连着跑完——这五条正好都在同一条链上（组合需求 → 小改 → 预览 → 应用 → 撤销）。登录态已经不是瓶颈（2026-11-18 第三轮已能在正式站带登录态操作，见 §8）；瓶颈是**断网/HAR 手段缺失**（内置浏览器无 DevTools offline、非管理员无法改系统网络、无 CDP 端点），以及 #3/#6/#7/#8/#9 的真机链路本身还没跑。

## 4. 每一项的复现命令

```bash
cd C:/Users/13266/.dsh/bot/workspace/Scendance2026/frontend
npx vitest run components/room-organizer/lib/outdoor-event-turn.test.ts \
  components/room-organizer/lib/instruction-layers.test.ts \
  components/room-organizer/lib/outdoor-pending-task.test.ts \
  components/room-organizer/lib/pending-brief.test.ts \
  components/room-organizer/lib/outdoor-map-context.test.ts \
  components/room-organizer/lib/outdoor-login-copy.test.ts \
  components/room-organizer/lib/outdoor-apply-once.test.ts \
  components/room-organizer/lib/outdoor-flow-restore.test.ts \
  components/room-organizer/lib/outdoor-project-store.test.ts \
  components/room-organizer/lib/turn-failure-diag.test.ts \
  components/room-organizer/lib/turn-trace.test.ts \
  components/room-organizer/lib/outdoor-layered-task.test.ts \
  components/room-organizer/lib/outdoor-venue-sync.test.ts \
  components/room-organizer/lib/outdoor-walk-boundary.test.ts \
  --reporter=json --outputFile=../.temp/r33-tests.json
# 期望：14 文件 / 148 条全过（本轮实测值）
```

## 5. 轮次 44 合并后回归与「可判口径」映射（2026-11-17）

上游合进 5 个分支（`docs/intelligence-gap-roadmap`、`fix/agent-run-hygiene`、`fix/quota-notice` 等）后，把 M7 自己那 8 个文件重跑了一遍：

```bash
cd C:/Users/13266/.dsh/bot/workspace/Scendance2026/frontend
npx vitest run \
  components/room-organizer/lib/outdoor-turn-metrics.test.ts \
  components/room-organizer/lib/outdoor-trace-metrics.test.ts \
  components/room-organizer/lib/outdoor-turn-live.test.ts \
  components/room-organizer/lib/outdoor-metrics-book.test.ts \
  components/room-organizer/lib/outdoor-metrics-export.test.ts \
  components/room-organizer/lib/outdoor-session-report.test.ts \
  components/room-organizer/lib/outdoor-report-download.test.ts \
  components/room-organizer/lib/outdoor-acceptance-selfcheck.test.ts
# 实测：8 文件 / 77 条全过（9 + 9 + 14 + 13 + 6 + 7 + 7 + 12）
```

`lib/outdoor-acceptance-selfcheck.ts` 把上表 11 条写成了可计算规则，但**它只判「有没有料」，不判「是否通过」**：

| 口径 | 用例 | 报告里要出现的信号 |
| --- | --- | --- |
| 可从报告找料（5 条） | #1 | 至少一轮 + 调过地图 + 出过预览 |
| | #3 | 出过预览 |
| | #4 | 观测到 `awaiting_place`（先要地点） |
| | #6 | 至少一条失败样本（终态 failed 或 errorCode 非空） |
| | #10 | 失败样本 + 成功预览各一 |
| 只能真实浏览器（6 条） | #2 #5 #7 #8 #9 #11 | 报告再全也不给「可判」，必须 9222 实跑 |

结论不变：**11 条依旧 0 条三类全绿**，发布门禁继续关闭。轮次 44 探过 `http://127.0.0.1:9222/json/version`，本机返回「无法连接到远程服务器」（端口未开），所以 #1/#3/#7/#8/#9 那条连贯链路仍未跑。

## 6. 发版门禁复跑（轮次 45，2026-11-17）

上游合进 5 个分支后，把门禁在**隔离 worktree（干净 HEAD `396ad994`）**上重跑一遍；提交树与工作树各跑一次，是为了把「提交树能不能发」与「工作树为什么红」分开。

| 项 | 命令 | 结果 |
| --- | --- | --- |
| 类型（提交树） | `cd .temp/wt-r45/frontend && npx tsc --noEmit` | **0 行** |
| 户外套件（提交树） | `npm test -- outdoor` | **50 文件 / 563 条全过**（轮次 31 时为 34 文件 / 398 条） |
| 静态导出（提交树） | `NODE_OPTIONS=--max-old-space-size=8192 npm run build` | **exit 0**，154 秒，`✓ Compiled successfully in 41s` |
| 类型（当前工作树） | `cd frontend && npx tsc --noEmit` | **9 行红，全在未跟踪文件** |

工作树那 9 行全落在五份**未跟踪**的 `replica-specs-*.ts`（别人的在途卡）里，都是同一种错：

```text
replica-specs-festivals-3.ts(282,64): error TS2322: 属性 'dy' 缺失，但 FacilityPlacement 的 grid 变体要求它
replica-specs-gov-1.ts(29,78): 同上
```

归属判定：这五份文件 `git ls-files` 查不到（未跟踪），我未改动，也不是我这几轮改的模块；但**只要它们还在工作树里，任何人在工作树上跑门禁都会红**。不替对方补 `dy`（那是他的布局数值，不猜），只如实登记。

结论：**提交树三项全绿，可发；工作树红属未跟踪新卡，不归本轮改动。** 发布仍被 11 条验收用例（0 条三类全绿）拦住，与门禁技术状态无关。

## 7. 正式站走查第二轮：V1–V5 全链复验（2026-11-17）

正式站：`https://scendance-scene-planner-ewz.pages.dev/?fresh=202611170800`（登录态有效；旧拼写域名 `scendance-scence-planner-ewz.pages.dev` 在本机 curl 探测 TLS 握手失败，浏览器打开后落到前者）。部署：be4fd029 → Pages 9e2262b0（Production/main）。取证：内置浏览器逐步操作 + 分享面板导出真实几何后离线解析。

### 7.1 主链逐段结果

| 段 | 正式站实测 | 版本 | 证据 |
| --- | --- | --- | --- |
| V1 场地与范围 | 6 条地点候选 → 场地确认卡 → 红线写进画布 → 待恢复槽里的需求句自动接回 | v4.15.5 起 | 上一轮已通 |
| V3 分区预览 | 「计划 2 个步骤」审批卡 → 分区预览 → 写入画布（舞台区 / 观众区 / 签到台） | v4.15.5 起 | 上一轮已通 |
| V2 主要入口与通道 | 预览出提案（不再整轮报冲突）→ 打架流线降级成带方位与长度的提示 → 写入画布 → **入口核对已应用** | v4.15.6 | 本轮复验通过 |
| V4 物料复用 | 「餐饮区」对不上画布 → 跳过并如实报出（列出画布上真实分区）→ 其余分区照常排布，物料名按真实库真名 | v4.15.7 | 本轮复验通过 |
| V4 子动线 | 舞台区驳线（3 m）、观众区驳线（76.8 m）写入画布 | v4.15.7 起 | 本轮复验通过 |
| V5 岗位点位 | 修前报「“签到台”尚无同时满足入场与出场的后勤接驳」；修后出提案卡「按岗位、数量与通路安排人员」→ 写入画布 | v4.16.1 | 本轮复验通过 |

### 7.2 导出真实几何复核（部署后）

分享面板「导出场地几何 GeoJSON」→ 页面内 monkey-patch `URL.createObjectURL` 抓 blob → POST 到本机 Node 服务落盘 → 按 `site-plan-geojson.ts` 的 ENU 换算（anchorLat=30.25、anchorLng=120.163；`metersPerDegLng=cos(lat)*111319.49`、`111132.92`/度）还原平面坐标。

| 项 | 实测 |
| --- | --- |
| 导出体积 | 69 745 字节；boundary 1 / zone 3 / facility 83 / route 12 / node 9 / worker 3 |
| 岗位 | 保安｜观众区｜数量 2｜(20.8, 75.9)；服务人员｜签到台｜数量 2｜(95.9, 245.9)；舞台监督｜舞台区｜数量 1｜(-60.5, 313.5) |
| 新增动线 | 签到台驳线｜人行动线｜4 m｜(95.9, 245.9) → (91.9, 245.8)｜备注「分区接驳到相邻子口（V-4a 死结 4 修正，不重复立口）」 |
| 出入口 | 9 个（与修前相同 → **没有多立门**） |
| 计数变化 | 人行动线 6 → 7；已放置物件 106 → 110（+1 条驳线 + 3 个岗位物件，人数写在岗位 count 上） |
| 刷新后 | 110 物件 / 3 分区 / 12 动线 / 9 出入口 / 3 岗位全还原 |

三个岗位都落在能进能出的通道上：服务人员挂在新补的 4 m 接驳线（离已确认的「观众区口」4 m）；保安落在观众区内的湖滨路人行流线上；舞台监督落在舞台区南缘、已确认的湖滨路口旁 3 m。判定依据仍是「已确认节点 + 动线方向」这一层口径，不是现场通行认证。

### 7.3 四个死结的正式站证据与归属

| 死结 | 正式站现象 | 真因 | 修法 | 版本 |
| --- | --- | --- | --- | --- |
| 1 确认窗口只有 60 秒 | 预览出来约 3 分钟后点确认 → 「地图或规划依据已更新，旧提案已失效」 | 地图要素的 `observedAt` 进了 revision 签名，同一份地图算出新版本 | 观测时间不进版本签名 | v4.15.5 |
| 2 场地自己的建筑当障碍 | 「人行流线（湖滨路）与地图依据…建筑/障碍冲突」整轮否掉 | OSM 把 IN77 画成一整块 817 环建筑多边形，第 20 环压在人行流线上 | 范围内建筑判为场地本体；流线冲突降级成提示；物件越界仍硬拦 | v4.15.5 / v4.15.6 |
| 3 需求分区对不上画布 | 「“餐饮区”没有唯一对应分区，请选中并说明分区；未摆放物件」，改清单也没用 | 需求只能按分区替换、不能删区，画布上根本没有「餐饮区」 | 画布分区当权威：对不上就跳过 + 如实报出 + 从清单摘掉 | v4.15.7 |
| 4 签到台没有 service 通道 | 「“签到台”尚无同时满足入场与出场的后勤接驳，请先安排子流线/子入口」，且那条补救路径不成立 | service 只认显式 audiences 的 pedestrian 路；「离既有节点 15m 内不重复立口」把整个分区放弃（唯一可用样本离观众区口只有 4 m） | 邻区口接驳（复用节点、不重复立门）+ 岗位阶段只复用已确认口补一条专用驳线 | v4.16.1 |

四处都有「先红后绿」的用例证据：回退修复后新用例**精确失败**（3 / 3 / 4 / 3 条），装回修复后转绿。

### 7.4 这一轮没有拿到的

- 账号物料库是空的（V4 没有真实物料可复用）；画布仍是本机草稿（云保存这一路未验）；**没有触发任何付费生成**。
- 用户提的「主通道改走场地北侧仁和路、观众从北门进场」**未被采纳**：路网仍按等级与长度选湖滨路，入口候选仍只有延安路口。选路与入口候选口径本轮未改。
- #2 同名地点、#5 离线/无路网、#9 撤销回读，以及 #8 的「应用中刷新 / 双点确认 / 切项目」仍未验。
- 正式站旧拼写域名 TLS 握手失败；并行会话持续部署，**别名会在数分钟内多次切换 runtime** —— 每次刷新都要核对运行时 chunk 是否含本轮修复（本次修复标记在 `3979-b0c04f395c00db4d.js`）。

### 7.5 发布口径

结论不变：**11 条里仍然 0 条三类全绿**，发布门禁继续关闭。本轮把主链从「走两步就卡死」推到「整条跑通」，四个死结的真实原因与修法都落到代码、用例与文档上；剩下的缺口是浏览器行为类（应用中刷新 / 双点确认 / 切项目 / 撤销 / 同名地点 / 离线），以及空物料库与本机草稿这两个环境限制。

## 8. 第三轮走查：#2 全绿、#5 部分通过 + 两个缺陷（2026-11-18）

环境：正式站 `https://scendance-scene-planner-ewz.pages.dev/`（main `4fc210aa`，登录态有效），会话内置 Browser（Electron FilePanel）。
（规范域名。2026-11-18 订正：早期文档把这里写成 `scendance-scence-...`，该域名 DNS NXDOMAIN；检索载荷已在规范域名上复核，5 条 id/坐标一致。）
本轮按 `docs/plans/2026-11-18-79-walkthrough-checklist.md` 跑了 #2 与 #5 两条，证据落 `docs/evidence/79/02/` 与 `docs/evidence/79/05/`。

### 8.1 结果

| 用例 | 固定数据 | 真实浏览器 | 真实云端 | 结论 |
| --- | --- | --- | --- | --- |
| #2 两个同名地点 | 既有 8+21+28 条 | **pass** | **pass**（零写） | **通过——11 条里第一条三类全绿** |
| #5 地图部分 / 离线 | 既有 7+13 条 | **partial** | 未声明（revision 没前后读数） | **部分通过 + 2 个缺陷** |

走查记录本回填：`scendance.outdoor.walkthrough.v1` = `{"v":1,"seen":{"2":"pass","5":"partial"}}`；
`scendance.outdoor.walkthrough.cloud.v1` = `{"v":1,"pass":[2]}`；板面读数「已看 2/11（通过 1 / 不构成通过 1） / 未看 9」。
**门禁仍关**：11 条里只有 1 条全绿，剩余 10 条未过。

### 8.2 #5 带出的两个产品缺陷（已登记，未修）

1. **离线时地图检索没有降级文案，本地「最近选过」缓存冒充检索结果**。
   复现：断网 → 地图「搜地点」输入 → 下拉仍列出上轮点过的地点，且没有任何离线提示。
   归属：`components/room-organizer/components/plan-place-search.tsx` + `lib/place-search.ts`（「检索失败一律回空数组」是已知取舍）。
2. **断网下点「确认并应用这一版」，写入进行态不收口**。
   复现：断网 → 点确认 → 卡片停在「正在把「确认当前活动范围」写入画布…」约 1 分钟，不报失败也不说云端没写成；恢复网络后也不补写。
   归属：`hooks/use-outdoor-agent-workflow.ts` 的应用链路。

两条都**没有**在本轮修（走查只登记、不改产品；且都属于「要人决定口径」的行为改动）。

### 8.3 环境缺口（不是产品缺陷，但压住了可判口径）

| 缺口 | 实测 |
| --- | --- |
| 系统级断网 | 本会话非管理员；内置浏览器无 DevTools offline；9222 是 Edge 后台进程、非 CDP 端点 → 只能用页面级 fetch/XHR 注入 |
| HAR 导出 | 内置浏览器不提供 DevTools HAR → 改用「网络查询 + 页面内拦截记录」代替 |
| 底图瓦片降级 | 瓦片走 `<img>`（同源 `/api/carto-tiles`），不被注入覆盖 → #5 的「地图部分（瓦片）」那一格没验到 |
| 云端 revision 前后读数 | 断网前没记基线、恢复后没专门读 → #5 云端键没点 |

### 8.4 下一轮怎么跑才够

- #7 / #8 / #9 / #11 都在同一条链上（预览 → 应用 → 撤销 → 导出），正式站带登录态可以连着跑；
- #3（改口被采纳）与 #6（四类阻塞可分辨）代码侧已修（v4.17.9），需要在正式站各跑一次真机复核；
- 要把 #5 判成 pass，得先拿到**系统级断网**（提权改 hosts 或系统代理 / 换一个带 DevTools 的浏览器），
  否则只能维持 partial——这是「手段缺失」，不是产品过不了。

### 8.5 线上包核对与剩余交接（2026-11-18 晚）

线上 c778 构建主包 `9150.98974b54efc4f8c2.js` 已核对：#3 原话选路四分支、#6 超时单列档、日期不跨轮三态都在包内（证据 `docs/evidence/79/00/2026-11-18-live-build-review.md`）。包内含代码不等于真机验收通过；#3 / #6 仍按清单 §2 走真机复核。剩余待办（真机用例、#5 手段与口径、#2 project 读取补证、记录本落盘、门禁签字）逐项交接待见 `docs/plans/2026-11-18-79-handoff-next-agent.md`。

### 8.6 第四轮：#2 零写补证、#5 CDP 离线补证、#11 部分导出；#3/#6/#7/#8/#9 blocked（2026-11-18）

环境：同一正式站，会话内置产品浏览器（Chrome 147.0.7727.149），登录态有效；CDP 经浏览器后端可达。归档记录本快照 `docs/evidence/79/walkthrough.json`（本 profile 本地记录本为空，按 origin 隔离未继承另一 profile 的标记）。

| 用例 | 本轮结论 | 浏览器 | 云端 | 证据 |
| --- | --- | --- | --- | --- |
| #2 同名地点 | 维持 **pass**；补选中路径零写 | pass | pass（选中路径写请求 0、无 project 读） | `02/2026-11-18-case02-selection-readback.md` |
| #5 离线 | 维持 **partial**；CDP 网络栈离线补证，缺陷①再次复现 | partial | 仍未声明（revision 前后对照缺） | `05/2026-11-18-case05-cdp-offline-supplement.md` |
| #3 改口采纳 | **blocked**：场地边界未确认，提案未出 | 未取得 | 无 | `03/2026-11-18-case03-blocked.md` |
| #6 四类阻塞 | **blocked**：四档本轮均未分别触发 | 未取得 | 无 | `06/2026-11-18-case06-blocked.md` |
| #7 说等等 | **blocked**：会话内无待确认提案卡 | 未取得 | 无 | `07/2026-11-18-case07-blocked-no-proposal.md` |
| #8 刷新/双点/切项目 | **blocked**：无应用写可对账 | 未取得 | 无 | `08/2026-11-18-case08-blocked.md` |
| #9 撤销回读 | **blocked**：无已应用批次 | 未取得 | 无 | `09/2026-11-18-case09-blocked.md` |
| #11 导出 | **partial**：CSV/JSON/GLB/DXF/HTML 落盘且计数与画布一致（5 件 / 3 类）；PDF、效果图、旧云 Run blocked | partial | n/a（导出本机产物，零写） | `11/2026-11-18-case11-exports.md` |

本轮计数：**pass 1 / partial 5 / blocked 5 / fail 0**。门禁仍关；blocked 不计入全绿也不计失败。下一轮最短路径：先在一个项目里定地点、圈出边界 → 出待确认提案 → 按 #7 → #8b → #9 → #8a → #8c 连跑。
