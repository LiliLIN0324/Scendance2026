# 新建会话 / 新建活动状态残留与入口失效 · 待修问题备注（2026-11-23）

> 来源：R8 正式站干净链路实测（线上 Cloudflare Pages 站端）。本文是**问题与线索备注，非已修方案**；行号对应当前 main，动手前先按符号 Grep 复核。
> 被测环境：`https://scendance-scene-planner-ewz.pages.dev/editor`，浏览器本机会话；对照源码为本地 `main`。线上部署 bundle 是否落后 main 尚未最终定性（见 §4-N3）。
> 关联背景：会话 scope 双源收敛见 [`2026-11-21-b1-session-scope-decouple.md`](2026-11-21-b1-session-scope-decouple.md)；场地轮廓供给见 [`2026-11-23-place-outline-supply-plan.md`](2026-11-23-place-outline-supply-plan.md)。

## 0. 一句话结论

为复测分区草案 / 主流线（动线·节点）/ 物料布置三段，需要一个干净基线活动。实测发现：**「新开会话」只换聊天正文、不清方案阶段状态；「新建活动」本机几何槽干净，但旧需求句标题与边界任务卡刷新后仍残留回灌；账户「新方案」的场地选择弹层在线上打不开**。三条都会让用户误以为"已经重新开始"，实际旧上下文还挂在界面上。

## 1. 复现前置

1. 登录正式站，打开一个已有对话与任务阶段的活动（本轮对照活动：含需求句、人数答复、边界段任务卡）。
2. 观察左栏：会话标题、渐进任务卡、下一句建议、输入草稿、画布计数（用地红线 / 分区·设施 / 动线 / 物料）。
3. 分别走两条新建路径：头部「新开会话」（MessageCirclePlus）；活动面板「新建活动」卡片。
4. 另从 账户菜单 → 所有方案 → 「＋新方案」触发场地选择弹层。

## 2. 问题清单

### N1 新开会话未清方案阶段状态（标题 / 任务卡 / 建议 / 草稿仍挂旧项目）

**现象（实测）**

- 点「新开会话」后，聊天气泡清空，但顶部会话标题、渐进任务卡、建议条、方案标签仍停留在旧项目状态。
- 旧活动 `80c3158d-498a-41b1-a15e-5611029add91` 实测：会话索引两条，`activeId=ses-d436f5e0…`（空会话，bodies 无条目），旧 `ses-7d19957e…` 保留 5 条消息（原句 / 人数反问 / 人数答复 / 回执 / 纸面起稿），可从历史切回。
- 语义上会话挂在同一项目 scope 下，用户预期"新对话=全新起点"，但旧阶段状态没有跟着清空，感知为"对话没更新"。

**源码线索（符号检索为准）**

- 按钮：`panels/agent-panel.tsx` 头部「新开会话」`onClick` → `assistantSessions.openSession()`；仅当 `created.verifiedFresh` 才调 `agent.acceptFreshSession(id)`。
- `hooks/use-assistant-sessions.ts` `openSession()`：只新建 / 切换 activeId；旧会话 bodies 保留，不删除。
- `panels/agent-panel.tsx` `acceptFreshSession(id)`：只置 `freshSessionProof` 标记，**不重置 brief / phase / proposal / 标题 / 建议轮播 / 输入草稿**。
- 空间 / 阶段重置走的是另一条 `reviewDialogueHistory()`（同文件，历史核对路径），新开会话未调用它。

**影响**

- 同项目多会话时，旧需求句标题、旧任务阶段、旧建议串到新会话；用户基于残留状态继续输入，容易把旧上下文当新基线。
- 自动测算 / 提案若读取未清空的 brief，可能沿旧方案继续出建议。

**建议方向（待评估，不代定实现）**

- 新开会话时同步重置：brief、阶段 phase、proposal、建议轮播、输入草稿、会话标题占位；或在 UI 明确标注"同项目继续，旧方案保留"，避免误以为已全新开始。
- 区分"换一条聊天"与"清空本项目方案"两个动作，入口文案 / 行为对齐。
- 补一条组件级断言：新开会话后，feed 正文、标题、任务卡、建议不携带上一会话文本。

**验收口径**

- 点「新开会话」后：无旧用户 / agent 气泡；标题回占位；任务卡回到该活动初始阶段；建议与草稿清空；旧会话仍可从历史切回（不丢数据）。

### N2 新建活动几何槽干净，但旧标题 / 任务卡残留并在刷新后回灌

**现象（实测）**

- 活动面板「新建活动」建成新活动 `394e2174-37e5-4859-bf28-b9e926bb0d56`：editor-local 为 10×8 空白，floor items / walls 空、entrances 空、roof none。
- 本机 localStorage **没有任何键含该活动 id**；无 outdoor-flow、无 bodies、无 sessions 记录，bodyCount 0，几何计数全 0（红线 / 分区 / 设施 / 动线 / 节点 / 人员）。
- **但刷新页面后界面仍残留**：`.ap-session-head` 旧需求句标题「我想在临安青山湖水上森林…」；`.ap-card-head` 边界任务卡「当前任务 · 核对具体活动范围」。输入框已空，建议回到默认例句轮播。
- 全局最近地点 `scendance-place-recent-v1` 残留上一场地「青山湖水上森林」，未按活动隔离。
- 疑似活动身份已切换，但会话 scope / 标题 / 阶段仍读旧会话（与 B1 scope 双源问题同族，待复核）。

**源码线索（符号检索为准）**

- `panels/creative-studio.tsx` `createFreshActivity()`：本机活动分支 `adoptRestoredBrief(proposedId, undefined)` 清 brief；团队 / 云项目分支 `openNewProjectForActivity()` 建空白云项目后整页 `location.assign('/editor/?project=…')`。
- `room-organizer.tsx`：户外规划槽跟活动 id 走（2026-11-17 修过"新建活动复制旧项目"），显式云项目按外壳 id 取规划，本机默认壳体落到当前活动。
- 待查：整页跳转后，新项目加载时会话标题 / 任务卡 / 建议是从云端 scene 快照回灌，还是未按新活动 id 隔离的全局 / 内存 state；最近地点缓存的活动隔离口径。

**影响**

- 新活动本机几何干净，但界面层旧上下文残留，刷新后仍在；同上，误导用户基线已全新。
- 若残留标题 / 阶段被后续提案读取，可能沿旧场地继续推演。

**建议方向（待评估）**

- 新建活动链路把会话标题、任务阶段、proposal、query 草稿、最近地点等按新活动 id 初始化；加载新活动以空基线为准，不回灌上一活动 state。
- 复核云项目整页跳转后的恢复路径：新项目 scene 应为空基线，会话 / 阶段不继承旧项目。
- 补断言：新建活动刷新后，标题、任务卡、建议、最近地点均不出现上一活动文本。

**验收口径**

- 新建活动 → 刷新：标题为活动默认名 / 占位；任务卡回到初始选址阶段；无旧场地名与旧流程节点；画布计数全 0。

### N3 账户「新方案」场地选择弹层打不开（新建空白活动的直入口失效）

**现象（实测）**

- 账户菜单 → 所有方案 → 「＋新方案」点击后，账户对话框关闭，但场地选择弹层未在视觉上出现。
- DOM 残留 `.sc-venue-overlay` 空壳：`visibility:hidden`、`display:flex`、z-index 45、`innerText` 空；`.sc-venue-picker` 同隐藏。
- URL 带 `?new=1` 进入时，参数被 useEffect 消费删除后，弹层仍隐藏。
- 手动 `dispatchEvent('scendance:start-new-project', { cancelable: true })` 未被工作台有效接管。
- 仓库无独立 `/projects` 管理页路由；这是新建空白活动的唯一直入口。
- 已加载的静态 chunk 未检索到 `start-new-project` / `venuePickerOpen` / `sc-venue-picker` / `sc-file-new` / 「从空白开始」/ `ensureDefaultOutdoorProject` 等串；工作台代码在未列出的按需 chunk 内，**bundle 是否落后 main 待最终定性**。

**源码线索（符号检索为准）**

- `panels/agent-panel.tsx` `VenuePickerOverlay`：window 监听 `scendance:start-new-project` → `startVenuePicker()`；读 `?new=1` 直接开 picker；`!agent.venuePickerOpen` 时应 `return null`（线上却存在隐藏空壳 DOM，与本地源码不符）。
- `panels/cloud-panel.tsx` 「新方案」按钮：派发 cancelable 事件；`dispatchEvent` 返回 false（监听器已 preventDefault）= 被 picker 接管并关对话框；返回 true = 未接管，走"当前画布另存为云端项目"兜底。
- `room-organizer.tsx` 挂载 `<VenuePickerOverlay/>`。
- `hooks/use-dialog-focus.ts` 不操作 visibility（hidden 不来自该 hook）。

**影响**

- 用户无法从账户面板直接进入"从空白开始"的选址流程；未接管时兜底会把当前画布另存，可能把旧方案带进新项目。
- 干净基线只能绕到活动面板「新建活动」，入口路径不一致。

**建议方向（待评估）**

- 先复核线上部署版本与 main 的差异：按需 chunk 映射、console / network 挂起请求，确认是部署旧版本还是运行时监听未挂上。
- 若为代码缺陷：核对 overlay 挂载树与事件监听 provider 是否同树；弹层未接管时不应静默落到当前画布另存兜底，需给出可感知的失败回执。
- 补一条端到端 / 组件断言：点「新方案」后 picker 可见，空白选项可选并进入空基线。

**验收口径**

- 「新方案」点击后场地选择弹层可见；选「从空白开始」→ 开始规划，进入无旧上下文的空基线；未接管兜底路径有明确回执，不默默复制当前画布。

## 3. 相关实测事实（供排障对照，非新需求）

- 本轮被测语料（A 案）：「我想在临安青山湖水上森林办一场下午的瑜伽疗愈活动：签到领手环和驱蚊贴，然后游园集卡打卡五个点，接着做瑜伽和冥想静躺，最后大合影、兑礼品。」人数口径：约 40 人，30–50 人区间（素材无官方人数，据现场照片估算）。
- 轮廓链路：该场地线上 `/api/place-shape` 三路抢答全落空（`shape:null`），未出真实多边形；详见 [`2026-11-23-place-outline-supply-plan.md`](2026-11-23-place-outline-supply-plan.md)，与本文新建状态残留是两条独立问题。
- 本地证据（截图 / 原始读数，未入库）：`docs/evidence/agent-live-test-2026-11-22/`（`docs/evidence/*` 默认 gitignore，仅白名单子目录放行）。

## 4. 边界与红线

- 本文只备注问题与线索，**未改任何生产码 / 测试 / 迁移 / 函数契约**。
- 不动几何基线与渲染导出链（AGENTS.md 第六节硬边界）：`scan-placement.ts`、`furniture-builders.ts`、`use-import-export.ts`、`use-splat-preview.ts`、`splat-preview.ts`、`room-organizer.tsx`、`scendance-workspace.tsx`；确需改动先补测试再动手。
- 会话 scope 收敛与 B1 切片成套推进，不可拆两半（见 B1 文档 §1.4）；tracker 源、壳体 scope、agent-panel / creative-studio 比对点同批改。
- DB 迁移、Edge Function 契约、共享库写入仍需人 review。

## 5. 待复核 / 未验证项

1. 线上 bundle 是否落后 main（按需 chunk 映射 + console/network 待查）；N3 定性为"部署旧版本"还是"运行时缺陷"。
2. N2 残留标题 / 任务卡的持久来源：云端 scene 快照回灌，还是未按活动隔离的全局 / 内存 state。
3. 全局最近地点 `place-recent` 是否应按活动 / 场地隔离。
4. N1 / N2 修复后，需在真实浏览器 + 云端链路复测干净基线，再续跑分区 / 动线 / 物料三段观测。
