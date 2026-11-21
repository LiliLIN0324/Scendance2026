# #79 门禁走查 · 逐条收尾方案（手把手版，2026-11-20）

> 目标：把台账从 **3/11 全绿** 推到 **11/11**，最后由人签字。本方案逐条写清：判据、现状、还差什么、谁来做、人工照点步骤、证据落点。
> 纪律：固定数据 ✅ **且** 真实浏览器 pass **且** 真实云端 pass 三类齐才 pass；partial 不算过；n/a 不顶 pass；agent 不代签、不伪造证据。

> **2026-11-21 定稿口径（先于下文）**：分支已重建到新 `main` `cd344d2a`，工作树 `.worktrees/79-closure-v2`，旧 `.worktrees/79-closure` 仅备份。本轮可控项已清完；#3/#5/#9/#10 真机样本挂「待模型回合」，产品项入 backlog；台账 3 pass / 8 partial、`pending-human`。下文旧路径、Node24 前置与逐条 B/C/D 路线为 2026-11-20 历史记录，现状以台账 `baseline`、清单 §八 为准。

## 1. 当前看板（`walkthrough.json`，`npm run check:79` 自洽）

| # | 用例 | 浏览器 | 云端 | 结论 | 路线 |
| --- | --- | --- | --- | --- | --- |
| 1 | 空白项目 + 组合需求 + 地图确认地点及范围 | ✅ | ✅ | **pass** | 签字复核即可 |
| 2 | 两个同名地点选其一 | ✅ | ✅ | **pass** | 签字复核即可 |
| 7 | 待预览时说「等等」/过时确认 | ✅ | ✅ | **pass** | 签字复核即可 |
| 3 | 有范围、已选设施，发明确小改 | partial | blocked | partial | A 真机轮次 + D 模型路由定性 |
| 4 | 无范围先发设计句，再改预算/人数 | partial | pass | partial | A 真机读数 + 同轮写读 |
| 5 | 地图部分、离线或无路网 | partial | blocked | partial | A 拦截探针 + 失败文案（与 #10 同源） |
| 6 | 未登录 / 功能关闭 / 额度不足 / 超时 | partial | n/a | partial | **B 部署前置（必须人授权）** |
| 8 | 应用中刷新 / 双点确认 / 切项目 | partial | partial | partial | A 补核 500/竞态；**C 产品补热切换入口** |
| 9 | 确认后撤销，重开旧草稿 | pass | blocked | partial | A 聚焦探针；**D 人工定性根因** |
| 10 | 一条真实模型失败 + 一条纯本地成功 | partial | partial | partial | A 补手画台架落位样本 + 失败卡逐字 |
| 11 | 普通聊天 / 室内布局 / 导出 / 旧 Agent Run | partial | n/a | partial | A 效果图弹窗；**B PDF 人工另存；C 产品补 run 列表** |

路线定义：**A** = agent 下一轮持有效会话可独立取证；**B** = 必须人做/授权；**C** = 必须产品补入口；**D** = 待人工或产品定性，不靠跑脚本变绿。

## 2. 前置环境（每轮开工先核）

- 工作树：`C:\幕景\Scendance2026\.worktrees\79-closure-v2`，分支 `feat/79-closure-v2`（旧 `.worktrees/79-closure` / `feat/79-jieyu-closure` 为备份）。
- Node：旧 `.tmp-node24` 目录已不存在；系统 `node` v22.23.2 在线，纯 JS / 门禁 / 探测脚本直接用系统 `node`，前端测试在 `frontend/` 下 `npx vitest run`；脚本只认 CLI flag `--use-env-proxy`（`NODE_USE_ENV_PROXY` 无效）。
- 代理：mixed `http://127.0.0.1:7897`，control `http://127.0.0.1:39798`；当前节点 🇭🇰香港-IEPL 03；`*.pages.dev` 直连 bypass。
- 会话：走查账号 `walkthrough-79@scendance.test`；access 约 1 小时，过期用 `.temp/refresh-session.mjs` 一次性换新（旧 refresh 作废），换新后复核 `/auth/v1/user` 200。
- 站点：`https://scendance-scene-planner-ewz.pages.dev/`；项目 REF `wkhfvnzgopjdzxlmycks`。
- 纪律：不同时开多个会写云端的浏览器（防污染 revision/netlog）；证据只存键名/邮箱/id，不存 token 值；不 `git add -A`；不部署、不打 tag、不推 main，攒齐一次性推。

## 3. 逐条卡片

### #3 有范围、已选设施，发明确小改 — partial

**判据**：在已应用方案（有边界/分区/设施）基线上发小改 → 模型出**可核对候选**（不是静默应用）→ 确认/取消后 plan 有可见差异 → 云端 PUT 或零写有据；小改前后 counts 可对照。

**现状（2026-11-20 实测）**：
- 基线 A：`3eb2…/house-8z42f0xm`，rev13，zones4 / boundary12 / nodes1 / routes0 / 2589B。
- 发「主通道改走场地北侧，别沿湖滨路走，留一条宽通道连通两个出入口」→ `assistant/chat/stream` POST 200；模型「已读画布 4 个分区 · 0 项设施 / 正在处理 · 摆放物料」，30s 内**未出路线候选**；按钮仅「重试 / 预览摆放物料 / 检索真实库」均 disabled，无路线确认钮。
- 本机 zones4 / routes0 / 2589B 不变；云端 rev13→14 为例行副本同步，counts 不变；无 outdoor-plans 路线写。

**还差**：一条能落到路线/设施候选的小改前后对照（候选文案 + 地图位置 + 确认后差异 + 云端写/零写）。

**谁来做**：
- **A（agent）**：下一轮先在基线上补选 1 件设施，再换命中本地词表的措辞（「排一下流线」「自动排入口」）触发路线提案；若走通道走向改写句仍只回物料/场地核验，如实记 blocked，不把 200 当成功。
- **D（待定性）**：源码已定位本地入口 `proposeRoutePlan` 只劫持 `matchRouteCommand` 固定词表（排流线/画流线/生成流线/自动排流线/排一下线/自动排入口出入口，route-proposal.ts:29）；「改主通道走向/别沿某路/留宽通道」不命中，进模型主链被归物料核验。前置：已有锚点 + 边界≥3 + 可读路网。需产品/模型侧确认是否扩展本地改写指令或把通道走向句路由到路线提案。

**人工照点（若你自己跑）**：打开 A 方案 → 左侧素材库先放 1 件桌椅到分区内 → 聊天发「把主通道挪到场地北侧，留出 ≥3m 宽通道连两个入口」→ 等候选卡出现，看是否有路线预览钮 → 截图候选前后 counts。

**证据落点**：`03/2026-11-20-case03-route-turn.json`（本轮）；新证据 `03/<date>-case03-<slug>.{json,md,png}`。

---

### #4 无范围先发设计句，再改预算/人数 — partial（cloud 已 pass）

**判据**：空白无范围首句留存 `guests/zones` 为 brief，中性待续提示（不挂范围红卡）；第二条人数/预算变更不误拦；plan 不被破坏；带边界草稿同轮浏览器写读一致。

**现状**：
- 第二条人数变更不误拦：正式站 v7 真机复核 redCard=false、中性提示、plan 0/0/167B、零写。
- `brief.guests=200 / zones=2` 留存由 React 回归用例离线锁定（`use-outdoor-agent-workflow.react.test.tsx` 末尾「无边界时先发设计句」单跑 1 passed）。
- 缺口：2026-11-20 持久槽探针（`04/2026-11-20-case04-brief-read.json`）两轮后 `assistant-brief-memory.v1` 无条目，headcount/event/zoneNeeds 只在 React 内存/气泡；空白序列未走到选点→分区→应用；缺带边界草稿上的同轮写读对照。源码入口：唯一写入口 `saveMemory`（agent-panel.tsx 1086-1096），模型回合 3674 落槽、本地抽取分支 3254/3259/3431/3434 落槽，守卫分支提前返回不落槽；需会话内存旁证区分条目缺失属守卫返回/id 空/fence 拦/schema 拒/抽取未填。

**谁来做**：
- **A（agent）**：真机探针读持久 brief 槽时一并抓 boundSessionId、turn.resolution、saveMemory 返回值等会话旁证，区分未落槽原因；在带边界草稿上复跑人数变更，做同轮浏览器写读。
- 无强外部前置，主要是真机轮次。

**人工照点**：新空白会话发「做 200 人发布会，签到台放西侧入口，留出通道」→ 看任务卡是中性「先确认范围」还是红卡 → 再发「人数改 150，保持分区」→ 看画布与人数提示是否被误拦。

**证据落点**：`04/` 既有 v7 等；新证据 `04/<date>-case04-<slug>.{json,md,png}`。

---

### #5 地图部分、离线或无路网 — partial

**判据**：离线窗口本机方案零变化、无写；瓦片/路网部分失败时界面有明确提示；Agent 回合失败文案逐字记录；带边界草稿云端 revision 可读。

**现状**：
- CDP `setOffline` 驻内存窗口：地点检索无候选、本机方案零变化、无写请求；恢复后无静默重放。
- **离线缓存已定性**：线上包无 Service Worker 壳；setOffline 后 reload 落 `chrome-error://chromewebdata/`，localStorage 被拒读，离线窗口 /studios 请求 0、无缓存条目、零写。旧 11-19 的 200 是 SPA 驻内存读数，不算缓存命中。
- 在线旁证：`/studios` 200 count1 owner；带边界 revision 直连旁证 A rev13 / B rev4 均 200 found。
- 缺口：地图部分瓦片拦截场景、Agent 失败文案逐字、同轮浏览器写读对照。

**谁来做**：
- **A（agent）**：用 Playwright `route` 只拦高德瓦片域名、保留 `/api/amap-place`，观察界面提示文案与本机方案；抓一次真实 Agent 失败文案（与 #10 同一窗口）。
- 地图部分/无路网若产品本就无降级提示，记为产品缺口，不硬凑 pass。

**证据落点**：`05/2026-11-19-offline-readings.json`、`05/2026-11-20-studios-online-baseline.json`、`05/2026-11-20-offline-cache-probe.json`；新证据 `05/<date>-case05-<slug>.json`。

---

### #6 未登录 / 功能关闭 / 额度不足 / 网络超时 — partial（cloud n/a）

**判据**：四类各自如实退回、不假装成功；未登录已单独取证。

**现状**：
- 未登录：零认证调用、零模型请求、界面如实退回（无候选，请补城市/地址）。
- 离线单测：402 quota_exhausted（不跨槽、不泄漏 body、分类 402）与 timeout（永不 resolve、timeoutMs5、仅一次调用）断言通过；唯一失败是 product opt-in 缺 key 档位（main 基线）。
- **A1 功能关闭：云端已取证并安全回滚**（`06/2026-11-20-case06-a1-disabled.json`）：置 `CONVERSATION_API_ENABLED=0` 后带登录态 POST `/functions/v1/conversation-api/assistant/chat` → HTTP 503 `CONVERSATION_API_DISABLED`，未调模型、零方案写；随即回滚 =1，list digest 复核基线一致、探测键不存在、其余受关注键未变。设备恢复后只读复核：线上 32 键与离线前快照逐条比对，无增删、无漂移。注意这是后端 503 路径，不等同前端 `{status:'disabled'}`「活动问答暂未启用」卡；关闭后的浏览器兜底卡文案本轮未录制。
- 缺口：402 额度（B1）/ 超时（C1）两类**按 §六 异常分支豁免口径**，以离线分支单测 + 源码走查为证据，不要求在真实云端制造受控故障（不另备公网桩）；#6 剩余仅前端兜底卡文案未录制。档位转 pass 待人工复核。

**源码口径（豁免证据的一部分）**：
- 请求带 `provider:'minimax'` 钉死槽位（pinned 时 `rest=[]`，不跨槽；quota_exhausted/timeout 不进兜底重试）。
- 源码判定：`assistant-chat.ts:92-97` 选槽、`:111-114` 三件齐全/URL 校验、`:201-206` 分类；`providers.ts:223-224` URL 拼 `/chat/completions`、`Bearer customKey`；`chat-provider.ts:41-42` minimax 判定。402 或 body 命中额度词→`quota_exhausted`；超 timeoutMs 默认 25000ms Abort→`timeout`。浏览器断网走 `NETWORK_ERROR` 另一档，不冒充服务端 timeout。

**早期桩备料（已取消，不执行；留作若未来要真机故障样本时的参考）**：
- 早期曾评估只把 `AGENT_CHAT_BASE_URL` 指向公网 https 桩、KEY/MODEL/PROFILE 不动，桩返 402（B1）或挂 >25s（C1），回滚写回反推 base 原值并 digest 复核；非密钥原值已 SHA256 对照确认：base `https://api.minimax.cn/v1`、model `MiniMax-M3.1-Flash`、profile `minimax`；百炼 base `https://dashscope.aliyuncs.com/compatible-mode/v1`、model `qwen3.8-max`；仅两个随机 KEY 不可反推。vm 云主机是隔离沙箱，不能充当公网桩。按 §六 豁免，该前置不再需要。

**谁来做**：
- **B（人工）**：确认 §六 豁免是否生效；若不豁免，才需另备公网可达的 402/慢桩或隔离测试项目里的欠费 key / 慢上游，并在短窗口逐条「改了什么/改回什么」记录，KEY 全程不动。
- **A（agent）**：维护离线分支测试与源码走查证据；不部署、不发布，不用本地 route mock 冒充线上 402/超时，不自动把 #6 升 pass。

**证据落点**：`06/2026-11-19-case06-not-logged-in.*`、`06/2026-11-20-offline-branch-tests.json`、`06/2026-11-19-case06-trigger-runbook.md`、`06/2026-11-20-case06-a1-disabled.json`。

---

### #8 应用中刷新 / 双点确认 / 切项目 — partial

**判据**：8a 刷新留存；8b 双点只应用一次；8c 项目隔离（不串指纹、回切留存）；三类证据齐。

**现状**：
- **8a 已取证**：刷新前后同槽 `house-8z42f0xm`，zones4/boundary12/nodes1/2589B 逐项一致，revision 10→11 例行同步，重载后本机无新写。
- **8b 已取证**：间隔 <300ms 双点，第二次按钮已消失，分区 0→2、方案 574→1440B 只应用一次；写 2 条（history 200 + plans 200）。
- **8c 退化对照已取证**：adopt B（`78b5…/house-vb5f3okg`，zones0/12/1/909B，无 A 四分区名）→ 清槽重载 → 再 adopt A（zones4/12/1/2589B 四分区齐全）；本地按 projectId 分槽互不覆盖，云端两份快照独立 200。

**还差 / 谁来做**：
- **A**：核 8c-b 里 1 条 500 响应的端点 URL（本轮未留存，归属待核）；8a in-flight 竞态（PUT 未落库瞬间刷新）时机难控，可尝试但不强制。
- **C（产品/前端补热切换入口，纯前端、不新增后端端点）**：当前工作台没有两个云端活动间的同上下文切换入口；recover 弹层只在 `fresh`（本机无草稿）时出现一次。可复用既有通道落地，不另起栈：
  - 列表：`listAdoptableActivities(controller)`（outdoor-plan-adoption.ts:51）读 `listOutdoorPlans`；
  - 接管：`adoptOutdoorActivity(controller, activity)` 拉回整份落本机槽，返回 `{ projectId }`；
  - 不换页切换：`onOutdoorProjectSwitch` 通道（workspace-shell.tsx:158-167）只换 `outdoorProjectId` + `projectEpoch` 重挂画布 + URL `?project=&mode=outdoor` replaceState；
  - 弹层：复用 `OutdoorCloudRecover`（纯展示+onPick/onDismiss），文案 props 化——切换语境标题「切换活动」、描述「选另一份云端活动，当前本机草稿保留在自己的槽里」，不要写「这台设备没有本机草稿。
  - **已落地（2026-11-20，本地未提交）**：`OutdoorCloudRecover` 增加可选 `title`/`description` props，默认找回口径文案与原行为不变；`outdoor-cloud-recover.test.tsx` 补一条覆盖自定义文案用例（5 passed），前端 `tsc --noEmit` exit 0。
  - **未做（下一切片，需连同入口一起落地，避免无调用方死代码）**：① 切换事件通道（对称 `requestOutdoorProjectSwitch`）；② workspace-shell 常驻触发态 + 监听后 `listAdoptableActivities` 打开同一弹层、`handleRecoverPick` 复用 adopt 换 projectId/epoch；③ 顶栏/面板入口按钮；④ 补 react 测试（切换语境 adopt 后 projectId 切换、当前草稿槽不被清）。
  - 改动点候选：workspace-shell 常驻触发态 + 列活动回调；顶栏/面板入口按钮；弹层文案 props；补 react 测试（切换语境 adopt 后 projectId 切换、当前草稿槽不被清）。
  - 待确认：切换前是否需要提示未保存草稿；冲突（baseRevision 不一致）沿用 adoption 既有静默退回口径。
- **D（待核口径）**：adopt 落本机后 overlay flushSave 例行推后端副本、revision +1（B rev3→4、A rev12→13→14）。源码已定性：adopt 只读+写本机（adoption.ts 63-94），副本由 overlay pushOutdoorPlan 带 baseRevision 推送（sync.ts 33-39），+1 是后端版本保护；待人工核对的是「adopt 未做本地编辑、内容与云端一致时先推一次副本并 +1」是否符合预期。

**证据落点**：`08/v10/`、`08/v11/`（含 case08c-a / direct-a / b）。

---

### #9 确认后撤销，重开旧草稿 — partial（browser pass / cloud blocked）

**判据**：同轮 应用 → 撤销 → 重做/再应用 → 云端重开，每步 counts + PUT/GET revision 对照；撤销**真正回退**持久化方案（不只是清选中态）。

**现状**：
- v10：先展开底部折叠工具条 `oc-dock`；`#tool-undo` exists=true / disabled=false（canUndo=true），`#tool-redo` 初 disabled；点撤销两次后本机仍 zones4/nodes1/2589B，分区与入口**未在持久化方案上回退**；redo 随后启用并点击复原，counts 不变；云端撤销段例行保存 rev11/12、重做 rev13。
- 源码静态排查：提案/场地/路线应用均 `commitPlan` 入栈（仅 `adoptPlan` 直设不入栈）；撤销句柄与禁用态同源；回喂链路未见把 prev 覆盖回 next 的分支。**根因未定位**。

**谁来做**：
- **A（agent）**：聚焦探针读撤销前后 `historyCount/redoCount` 布尔、`#tool-undo/#tool-redo` disabled 态、栈帧实体计数旁证（historyRef 不对外暴露，只能 canUndo/canRedo + DOM 旁证），区分是提案异步提交与栈帧顺序错位、还是产品/链路缺陷。
- **D（人工定性）**：文案「已应用当前对话提案，可整批撤销」与实际撤销行为是否一致；回退态例行推云端 revision+1 是否设计口径。手工放入口快照能否单独撤销，未在持久化方案上验证。

**证据落点**：`09/v4…v10/`；新探针 `09/v11/2026-11-20-case09-v11-undo-probe.json`。

---

### #10 一条真实模型失败 + 一条纯本地成功 — partial

**判据**：真实失败轮 UI 卡逐字 + 日志分类 + 时间窗弱关联；另一条纯本机编辑同窗 **0** 云端请求。

**现状**：
- 日志（ClickHouse 只读）：近 24h `assistant_chat_failure` 16 条（invalid_shape 14、http_error 503 2），均无 turnId/user id；01:54:29.450Z `openai-next / invalid_shape`。
- 匿名在线基线：无登录门禁、聊天框未禁用；选工具/画布点击阶段同窗 0 supabase 请求、0 consoleError；入口节点因匿名草稿无边界（inRing 门槛）未落位，entrances=0/167B，不算成功本机编辑。
- 登录态加载即有 1 条例行 PUT，纯本地 0 请求样本必须在匿名/离线 context 取。
- 源码旁证：失败卡编号来自本地 turn-trace、errorCode 固定 `model_notice`（turn-failure-diag.ts 24-35），注释声明服务端日志接线（M1b）完成前编号不会出现在服务端事件；本地 metrics-book turnId 与服务端日志 turnId 非同标识。

**还差**：一次落位生效的本机编辑 + 同窗 0 写样本；01:54 同轮 UI 失败卡逐字。

**谁来做**：
- **A（agent）**：补手画边界台架——离线/匿名 context 内画一条闭合边界 → 选入口工具 → 边界内单击落位 → 记 0 云端请求与本机 counts；失败卡逐字随 #5 同一真实失败窗口抓。
- **边界（不越界）**：前后端 trace 编号未接线（M1b 待产品做），浏览器拿不到服务端 turnId，只能时间窗 + 分类一致性弱关联，不伪造编号全链。

**证据落点**：`10/2026-11-20-logs-assistant-failures-24h.json`、`10/2026-11-20-anon-local-edit-baseline.json`；新证据 `10/<date>-case10-<slug>.json`。

---

### #11 普通聊天 / 室内布局 / 导出 / 旧云 Agent Run — partial（cloud n/a）

**判据**：效果图导出真实落盘；PDF 人工另存；旧 run 可从 UI 进入并与 DB 读数对照。

**现状**：
- 旧证：CSV 157B、GeoJSON 1444B；CSV/JSON/GLB/DXF/HTML 第五轮证据。
- 旧 run：DB 4 条（2026-11-11，3 complete + 1 failed/AGENT_DEADLINE）。
- **本轮 UI 探定**：账户菜单 → 所有方案可达；项目墙仅本机草稿卡「周末共创工作坊」（disabled · 未上传）+ 新方案占位，无云端旧 run 可双击；AgentRunPanel 归档只存组件内存最近 5 条、不写库；线上无 GET agent-runs 端点。效果图源码定性：选项弹窗 `#tool-export-panel` 与其按钮 `#tool-export` 整段被 `!outdoorEditing` 包裹（scendance-workspace.tsx 1211-1231，`outdoorEditing = outdoor != null` :566），户外方案态恒 true、弹窗不渲染（有内容/3D 态同样不渲染）；户外 PNG 走 `exportPlanPng` 一键本地快照（outdoor-plan-overlay.tsx 812-820，取末位 canvas、300dpi，函数体内无云端写），PDF 走同组件 `printDeck()`。

**还差 / 谁来做**：
- **A（agent）**：室内布局态（非户外）真机走一次选项弹窗，记录视角/画质/机位册选项与下载帧；户外分享面板「效果图」PNG 下载帧 + 同窗 0 写旁证**已取证（v13：4 条导出条目 enabled，PNG 597871B，writes=[]，方案不变）**；仍需准备导出文件校验（尺寸/格式）。
- **B（必须人）**：PDF 打印对话框另存为人工步骤，不声称自动导出。
- **C（产品）**：补云端 Agent Run 列表/回看入口；否则旧 run 只能 DB 读，UI 路径不可达。

**证据落点**：`11/2026-11-19-exports.json`、`11/2026-11-19-old-agent-run.json`、`11/2026-11-20-case11-ui-probe.json` + 项目墙截图。

## 4. 推荐执行顺序（串行，不并开写云端的浏览器）

1. **A 类先清**：#4 本机 brief 读数 → #5 瓦片拦截探针 → #10 手画边界 0 写样本 → #9 撤销聚焦探针 → #3 路线候选再试 → #11 效果图弹窗（有内容方案时）。
2. **D 类定性**：#9 撤销根因、#8c 副本同步口径，随探针结果交你拍板。
3. **B 类等人工**：#6 按 §六 豁免待人工确认生效（不再等桩/部署）；#11 PDF 打印另存需人手动存盘，拿到明确指示再动。
4. **C 类记产品缺口**：#8c 热切换、#11 run 列表，列入产品待办，不在本轮硬凑。

## 5. 每补完一条的台账顺序

1. 写该条 evidence MD + 原始 JSON + 截图；
2. 更新 `walkthrough.json`：`browser / cloud / conclusion / evidence / readings / gap`；
3. 同步 `2026-11-19-signoff-checklist.md` 对应行；
4. 跑 `npm run check:79`，确认计数自洽；
5. 证据显式 add（不 `git add -A`），攒齐后一次性推 main。

## 6. 收尾签字清单（全部满足才可解除门禁）

- [ ] 11 条 `conclusion=pass`；
- [ ] 每条有真实浏览器证据；需云端的有真实 PUT/GET 或重开证据；
- [ ] `check:79` 输出 `pass 11 / partial 0 / blocked 0 / fail 0`；
- [ ] `walkthrough.json` 的 `signoff.status` 由人签字（agent 不代签）；
- [ ] 仍未做的事与产品缺口单列清楚。
