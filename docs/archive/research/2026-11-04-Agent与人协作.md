# Mirasim「Agent 与人」协作模式研究 + Scendance 落地改造清单

日期：2026-11-04 · 范围：只读研究 + 最小一步代码落地（未提交、未推送）

## 一句话结论

Mirasim 真正可借鉴的不是「更多 agent」，而是把 agent 当成**可被分派、可被复核、可被交接的团队成员**：工作单元是带编号的「事项」，状态是 `待办 → 进行中 → 待复核 → 已完成/已取消`，人只在「需要你」的节点介入，产物与证据回帖到原线程。Scendance 已经有「提案 → 预览 → 确认/撤回」的雏形（[agent-panel.tsx](file:///c:/Users/13266/.dsh/bot/workspace/Scendance2026/frontend/components/room-organizer/panels/agent-panel.tsx#L1774-L1803)），缺的是**事项身份、复核状态和决定记录**。本次先补这一环，不改协作层其余部分。

---

## 一、打开受限说明（不编造）

目标页 <https://mirasim.ai/spaces?space=space-2cf57> **未登录无法查看空间内部**：

- 用浏览器实际访问后立即跳转登录页，标题「Sign in | Mirasim」，正文为邮箱验证码 + GitHub / Google / X / passkey 登录；截图见 `.temp/shots/mirasim-space-2cf57.png`。
- 因此下文对「空间内部」的还原**不是截图观察**，而是来自同一产品的公开文档、写作文章与公开 Live Space；凡是推断的地方都标注为推断。

用于还原的信息源：

| 来源 | 用途 |
|---|---|
| <https://mirasim.ai/> | 产品定位与六条能力主张 |
| <https://mirasim.ai/writing/multiplayer-coding-agents> | 会话共享、权限、排队、@ 助手的作者自述 |
| <https://mirasim.ai/docs/team> | 角色权限表、会话共享、Collaborate、**Items 事项**全文 |
| <https://mirasim.ai/guide/zh/orchestrate> | Goal 目标阶段机、验收、哪些事在等你 |
| <https://mirasim.ai/live> | 公开空间结构：Sessions / Lobby 两个页签 |

---

## 二、Mirasim 的协作模型（按「关系」而不是按「功能」还原）

### 1. 角色：权限是「空间角色 + 会话归属」两层

| 角色 | 能做什么 |
|---|---|
| Owner | 全部；只有 owner 能任命/移除 admin；不可被降级、不可退出 |
| Admin | 更新应用、安装/更新 agent、配置模型、加人、改角色、移除人 |
| Collaborator | 用工作区、会话、终端；**不能**改凭证/模型/agent/设置 |
| Observer | 只看会话、文件、成员、聊天；**不能**发起或驱动会话；可在群里 @ 助手 |

关键点：**权限不是给 agent 的，是先给人、再由人决定 agent 能碰什么**。agent 的安装、模型、默认工作区由 owner/admin 配置；普通成员只能在会话里换模型。

### 2. 会话：默认私有，共享是显式动作

- 谁都能看别人的会话，但**默认只有创建者能发言**；其余人只读。
- 要一起开：会话顶部 `Share` → 「Share with members」；不想等授权就 `Request access` 或 `Fork a copy`。
- 一轮只跑一个 turn，其余消息进队列；每句话带发言人姓名与头像；owner 可确认后中止别人的 turn。
- 这是一套「**可见性默认放开、写权限默认收紧**」的设计，和我们「评审链接只读、编辑要授权」的直觉一致。

### 3. 事项（Item）：人机共用的最小工作单元

这是最值得抄的一层。事项不是聊天消息，而是有独立页面的对象：

| 字段 | 规则 |
|---|---|
| 编号 | T-1、T-2…，全局可引用 |
| 负责人 | **一个 owner，或没有 owner**；没有则等待认领（Claim），房间里任何人都能认领 |
| 分派 | `Assign` 转交，可附 handoff note |
| 协作者 | Collaborators：跟着它的线程、收到同样的状态变更与提问 |
| 状态 | To do / In progress / In review / Done / Canceled；由会话捡起但没人设置时默认 In progress |
| 子项 | 两层；可从描述里拆、也可挂已有事项；父项显示完成数 |
| 会话 | 在事项页 `New session`，发起人自己或**委派给 assistant**，并声明用途：Work / Research / **Review** / Compare / Split；助手答复回到事项；也可 `Link a session`；从会话回合添加的事项保留 `Origin` |
| 讨论 | 需要时才开一段讨论，不默认制造噪音 |
| 截止/里程碑 | 到期当天黄、逾期红；里程碑聚合事项进度 |

视图：`All / Mine / Collaborating / Sent / Done` + `Milestones`；列表可切看板，**拖卡片换列 = 改状态**。

### 4. Goal：带闸门的整件交付

阶段机（文档原文顺序）：

```
对齐中 → 待确认 → 确认启动 → 执行中 → 需要你 → 待验收 → 已完成
```

- **对齐中**：编排者把对话整理成可验证的预期结果与执行计划。
- **待确认**：人确认某一版「预期结果 + 证据要求 + 边界」后才开工；规格侧栏只读（预期结果、验收标准、范围、边界、不包含、关键决策与假设、未决问题），改目标回主对话说。
- **执行中**：任务关系图、看板、每项实时状态、关键路径。
- **需要你**：只有涉及**范围、安全、权限、不可逆后果**的决定才暂停，并显示它阻塞了多少执行单元。
- **待验收**：按证据核对验收标准，每个节点附产物、验证结果、执行记录。

### 5. 交接：结果必须回到发起处

- 群里 @ 某个 assistant → 它在空间里开一个会话干活 → **结果回到那条消息的 thread**，所有人看得到进度，任何人都能继续跟。
- 会话回合可 `Comment`，评论可 `Hand to agent`（作为你的一轮发进会话）或 `Resolve` 关闭。
- 消息可 `Send to session`；回合可 `Add as items…` 把答案里的几件事变成事项。
- 「For you」收 @ 我、回复我、我关注的 thread；侧栏顶部「等你处理」收所有停下来问人的会话。

### 6. 界面怎么把这些关系表达出来

- **状态在行首**：事项每行的最前面就是状态图标，点它改状态；看板四列直接对应四个状态。
- **归属可见**：负责人头像、协作者、来自哪个会话（Origin）、由谁分派（handoff note）。
- **在场感**：右侧工具条显示在场人的头像，小圆点=正在跑 turn，头像变暗=离开；点开卡片看角色、设备、最后活动、正在跑的会话。
- **待你处理是一个收件箱**，不是一个页面：侧栏顶部「等你处理」+「与我相关」+「我负责/我参与」。
- **复核发生在产物旁边**：在回合上评论、在事项页看证据，而不是另开一个「审批中心」。

---

## 三、值得借 vs 明确不做

| 值得借 | 理由 | Scendance 对应 |
|---|---|---|
| 事项化：编号 + 状态 + 负责人 + 来源会话 | 让「agent 干完没有、谁验的」有唯一载体，不再只活在气泡里 | 分派记录已有（`dispatchRecords`），但没有状态与决定 |
| 待复核（In review）作为独立状态 | 把「产出了」和「人认了」分开，避免 agent 产出即生效 | 现有「预览 → 确认布置」正是这个语义，但没有状态记录 |
| 验收靠证据 | 每个产物附校验结果，减少「感觉不对」的扯皮 | 已有 artifact 指纹、几何闸、diagnostics，可直接当证据 |
| 「需要你」只拦不可逆 | 减少打断，人只在写画布/覆盖/发布时停 | 现在确认写画布已经符合，但缺「哪些在等我」的汇总 |
| 会话默认只读、共享是显式动作 | 对外评审天然安全 | 评审链接已是只读，可复用到团队协作 |
| 结果回到发起处 | 防止「agent 在别处干完了我不知道」 | 现有气泡已经在同一场对话，保持即可 |

| 明确不做 | 理由 |
|---|---|
| 多会话/分支/worktree/终端工作台 | Scendance 是空间编辑器，不是代码 IDE；引入会让人先学工作台再干活 |
| 频道 + DM + thread + 表情的完整社交层 | 与「单屏可容纳、层级扁平」的既有约束冲突；有 @ 和评论就够 |
| 里程碑、到期日、席位计费、API app 市场 | 当前是单人/小团队的现场布置工具，没有这些的组织复杂度 |
| 目标自动拆分 + 编排 agent 自主跑整夜 | 布置强依赖现场判断与尺寸确认，自动跑完再验收的风险大于收益 |
| 四角色权限矩阵 | 现阶段只需「编辑者 / 只读观察者」两档，先不做 admin 任命链 |

---

## 四、Scendance 现状对照（四角色）

| 角色 | 现在能做什么 | 缺什么 |
|---|---|---|
| 总控 | 点名分派（气泡带 `to`）、汇总分派记录（`dispatchRecords`，[agent-panel.tsx](file:///c:/Users/13266/.dsh/bot/workspace/Scendance2026/frontend/components/room-organizer/panels/agent-panel.tsx#L1815-L1832)） | 分派没有编号/状态；结果只是「第一句回话」摘要；没有「谁验过」 |
| Bingo | 本地/云端提案 → 画布预览 → `确认布置` / `撤回` / `换一版`；确认才 `applyLayout`，可整体撤销（[confirmProposal](file:///c:/Users/13266/.dsh/bot/workspace/Scendance2026/frontend/components/room-organizer/panels/agent-panel.tsx#L1070-L1102)） | 确认/撤回**不留台账**；没有驳回原因；刷新后看不到「上次谁批的」 |
| 空间 | 场景模板、环境、结构参数入口（`spaceSlot`） | 没有「结构调整提案」这一产物形态，也没有复核 |
| 物料 | 素材库、生成、成套（`materialSlot`） | 生成即入库，没有「待复核」这一步；与布置提案的边界靠对话维持 |

结论：Bingo 的「预览 → 确认」是全产品最接近 Mirasim `In review` 的机制，**先把它台账化**，比新造一套审批 UI 更省、更一致。

---

## 五、改造清单（分四步，每步可独立验收）

### 第 0 步（本次执行）：复核台账

- **界面**：总控对话流里新增「复核记录」卡（默认无记录时不显示），列：请求原文、分派给谁、产物摘要、状态（待复核/已通过/已驳回/已作废）、时间。
- **数据结构**：`ReviewAttempt { id, requestId, request, to, agent, artifact, at, status, decidedAt?, note? }`，本机 `localStorage`，上限 30 条。
- **状态流转**：提案出现 → `pending`；点「确认布置」→ `approved`；点「撤回」→ `rejected`；被新消息/新一版顶掉 → `superseded`。
- **验收**：两条路径各走一遍并截图；刷新后记录仍在；`tsc` 与单测通过。
- **风险**：只在本机、跨会话共享一个列表；状态由现有按钮推断（不是新按钮），推断规则需单测锁住。

### 第 1 步：事项化（下一步）

- 分派那一句生成一条事项：编号 `T-n`、负责人（agent 或「待认领」）、来源会话、状态。
- 事项挂在总控卡的分派列表上，点开看产物；`Claim / Assign` 先只做「改负责人」。
- **验收**：同一句分派刷新后仍是一条事项，不因气泡重放而重复；状态与第 0 步台账一致。
- **风险**：现有气泡是唯一真相，事项若另存容易双写不一致；应让事项**从气泡派生**、只存决定。

### 第 2 步：证据与验收

- 每个待复核事项附：候选快照摘要（新增/撤掉/挪动/重叠/被拒原因）、几何闸结果、提案指纹、生成时间。
- 通过时把证据快照一并存档；驳回时必须选/说一个原因（先做「一句话原因」，不做表单）。
- **验收**：通过后能从台账回到那一版产物的摘要；提案过期（基线变了）时不能通过，台账记「作废」。
- **风险**：证据快照会变大；只存摘要与指纹，不存整份场景。

### 第 3 步：权限与「等你处理」

- 两档角色：编辑者 / 只读观察者；只读不能确认、不能撤回。
- 总控侧栏一个「等你处理」计数：待复核事项 + 阻塞中的提案。
- **验收**：只读账号点确认被拒并说明原因；待复核数与实际一致。
- **风险**：当前账号体系以单人为主，先别做 admin 任命链；只读态要覆盖画布与四个面板。

---

## 六、本次执行的取舍

- 只做第 0 步，不铺开事项/权限。
- 不新增确认/驳回按钮，复用现有「确认布置 / 撤回」，避免同一动作两个入口。
- 不改任何 `.css`；台账复用 `ap-card / ap-outcome / ap-outcome-label / ap-outcome-line / ap-small / ap-dispatch-list / ap-dispatch-row / ap-dispatch-body` 等既有类，未新增类名。
- `agent-panel.tsx` 只做增量：第 72 行新增 import；第 2008、2010 行新增两行挂载，不动既有结构。

---

## 七、第 0 步落地结果（已实现，未提交）

### 链路与状态机

```
人提出（总控点名 Bingo）→ agent 产出（预览提案）→ 待复核
   ├─ 点「确认布置」→ 已通过（写进画布）
   ├─ 点「撤回」    → 已驳回（物件不动）
   └─ 被新一版顶掉 / 提案失效 → 已作废
驳回后重来 = 新的一条记录，旧的「已驳回」保留不动。
```

记录的键是**请求气泡 id + 那一版的产物摘要**，不是文案匹配；`to` 字段快照了当时点名的 agent，因此「分派给谁」不会因为后来说话而漂移。

### 文件清单

| 文件 | 性质 | 说明 |
|---|---|---|
| [review-ledger.ts](file:///c:/Users/13266/.dsh/bot/workspace/Scendance2026/frontend/components/room-organizer/lib/review-ledger.ts) | 新增 | 类型、摘要、状态流转、持久化；纯函数为主 |
| [review-ledger.test.ts](file:///c:/Users/13266/.dsh/bot/workspace/Scendance2026/frontend/components/room-organizer/lib/review-ledger.test.ts) | 新增 | 第 0 步 12 条 + 第 1–2 步 11 条，共 23 条：摘要、顶掉、重复决定、落盘/驳回/作废反推、坏数据、事项编号、门禁、快照差分 |
| [agent-review-ledger.tsx](file:///c:/Users/13266/.dsh/bot/workspace/Scendance2026/frontend/components/room-organizer/panels/agent-review-ledger.tsx) | 新增 | 只读 `agent.proposal / state / bubbles`；总控展示，Bingo 页签静默挂载 |
| [agent-panel.tsx](file:///c:/Users/13266/.dsh/bot/workspace/Scendance2026/frontend/components/room-organizer/panels/agent-panel.tsx#L72) | 增量 | 第 72 行 import；[第 2008–2010 行](file:///c:/Users/13266/.dsh/bot/workspace/Scendance2026/frontend/components/room-organizer/panels/agent-panel.tsx#L2008-L2010) 挂载 |

### 验证证据

- `npx tsc --noEmit`：通过（无输出）。
- `npx vitest run …/review-ledger.test.ts`：**1 file / 23 tests 全过**（第 0 步 12 条 + 第 1–2 步新增 11 条）。
- Playwright 实测（独立端口 3216，隔离副本避免与并行任务共用 `.next`）：**PASS**，两条路径都走通。

状态流转记录（浏览器控制台/脚本日志原文摘录）：

```
09:02:50  pending  → 待复核 · 分派给 Bingo · 新增 1 件 · 撤掉 0 件 · 无重叠
09:02:56  approved → 已通过 · 新增 1 件 · 撤掉 0 件 · 无重叠 · 17:02
09:03:08  刷新后仍为 approved（localStorage 复读，02/03 号截图）
09:03:14  pending  → 后排加 10 把椅子（新增 10 件）
09:03:20  rejected → 已驳回 · 新增 10 件 · 撤掉 0 件 · 无重叠 · 17:03
09:03:28  pending  → 重来一版（新增 10 件，旧「已驳回」保留）
09:03:47  approved → 已通过；历史三条：通过 / 驳回 / 通过
```

截图（`.temp/shots/ledger/`）：

| 截图 | 内容 |
|---|---|
| `01-pending.png` / `01-pending-panel.png` | 提案预览 + 台账「待复核」 |
| `02-approved.png` | 点「确认布置」后「已通过」 |
| `03-after-reload.png` | 刷新后记录仍在 |
| `04-second-pending.png` | 第二次分派的「待复核」 |
| `05-rejected.png` | 点「撤回」后「已驳回」 |
| `06-rework-pending.png` | 驳回后重来的「待复核」 |
| `07-rework-approved.png` / `08-history-panel.png` | 重来后通过，三条历史并存 |

### 已知限制（不藏）

1. **只存在本机**：`localStorage`，上限 30 条，跨设备/团队不同步；下一步应落到后端并带 `session/project` 维度。
2. **决定是反推的**：从「提案消失 + 状态落点」推断通过/驳回，而不是显式事件。本地同步路径可靠（已由单测与实测锁住）；云端提案若在异步窗口里先清空再置 ready，存在误记风险，下一步应在 provider 里发出显式 `onReview` 事件。
3. **只覆盖 Bingo 提案**：空间/物料还没有「可复核产物」，因此台账暂时只对布置提案生效。
4. **展示只留最近 3 条**：完整 30 条仍在存储里，但没有独立的历史页。
5. 控制台有一条既有 React 告警（`AgentPanel` 在 `LayoutAgentProvider` 渲染期间被更新），台账所有写入都在 effect 内，未触碰该链路；建议合流时单独定位，不要在本次改动里顺手改。

## 八、第 1–3 步落地结果（未提交）

范围仍是台账这一条链路，没有另起面板；第 0 步的「分派 → 产出 → 确认/驳回 → 记入历史」原样保留。

### 第 1 步：事项化（真通了）

提案一出现，台账就把它落成一条带编号的事项，而不是只抄一句需求：

| 字段 | 来源 | 例 |
|---|---|---|
| `T-n` | 独立计数键 `…seq.v1`，跨刷新递增 | T-1 / T-2 / T-3 连续 |
| 负责人 | 请求气泡上的 `to`；没点名就是「待认领」 | 实测 T-3 显示「负责人 待认领」 |
| 目标 | 请求原话 + 提案件数事实，写成终态 | 「按『后排再加 10 把椅子…』：新增 10 件 · 撤掉 0 件，确认前画布保持原样」 |
| 验收点 | 可核对的事实，不是空话 | ①几何闸通过 ②画布与候选一致 ③锁定件不动 ④驳回=画布原样、记录保留 |
| agent 直接做 | 只读/候选态步骤 | 读懂需求、生成候选、几何闸与锁定件检查 |

清单验收里「刷新后同一句仍是一条」由「请求气泡 id + 持久化的在办 id」保证：实测刷新后仍是同一条 T-1 且只有 1 条记录，没有因气泡重放变成两条。

### 第 2 步：证据回帖（真通了）

决定落下时取「提案出现时的画布快照」与「决定后的画布」按 `itemId` 差分，证据写进同一行，不另做 UI：

- **通过 T-1**：`新增 1`，itemId `252a8175…`（提案报「新增 1 件」，画布实际也新增 1 件，数字对得上）
- **驳回 T-2**：画布 0 变化，证据照实写「人驳回，画布保持原样」，不冒充「改了 0 件」
- **重来通过 T-3**：`新增 10`，itemId `08dbd244…、9b910862… 等 10 件`
- 挪动件会在证据里写前后数值（`1.00,2.00 r0.00→1.00,3.00 r0.00`），已由单测锁住；本次实测流程只发生了新增，所以画布挪动数为 0。

单测覆盖：新增/撤掉/挪动三类差分、驳回说明、证据随决定归档。

### 第 3 步：权限与「等你处理」（一处真通，其余搭架子）

- **真通**：门禁由「这一版会不会写画布」推导（`proposalWrites > 0 → human`）。写画布的提案在台账顶部显示「待你处理 N」，行首标 `待你处理`，并列出「我已直接做：…」与「等你点头：确认布置 / 撤回」。实测待复核时标题为「复核记录 · 待你处理 1」，并随通过/驳回归零。
- **搭了架子**：没有账号/角色体系，尚未按 Owner/Admin/Collaborator/Observer 分权；`gate=agent`（零改动的纯结论）目前没有真实运行路径，只有单测覆盖。要做真权限，需要先有身份与项目成员数据，这一步不在本次范围。

### 验证与文件

- `npx tsc --noEmit`：通过。
- `npx vitest run …/review-ledger.test.ts`：**23/23 通过**。
- Playwright（独立端口 3216 / 隔离副本）：**PASS**，09:56–09:58 走完「通过 → 刷新 → 驳回 → 重来 → 通过」。

```
09:56:29  待你处理 · T-1 · 负责人 Bingo · 目标/验收 4 条已落
09:56:40  已通过 · 证据：新增 1 · itemId 252a8175…
09:57:14  刷新后同一条 T-1 + 证据仍在（无重复）
09:57:21  待你处理 · T-2（新增 10 件）
09:57:37  已驳回 · 证据：画布实际 0 变化 · 人驳回，画布保持原样
09:57:55  待你处理 · T-3 · 负责人 待认领（请求未点名）
09:58:08  已通过 · 证据：新增 10 · itemId 08dbd244… 等 10 件
```

改动文件：
- [review-ledger.ts](file:///c:/Users/13266/.dsh/bot/workspace/Scendance2026/frontend/components/room-organizer/lib/review-ledger.ts)：新增事项字段、门禁/目标/验收生成、快照差分、编号与在办 id 持久化
- [review-ledger.test.ts](file:///c:/Users/13266/.dsh/bot/workspace/Scendance2026/frontend/components/room-organizer/lib/review-ledger.test.ts)：+11 条
- [agent-review-ledger.tsx](file:///c:/Users/13266/.dsh/bot/workspace/Scendance2026/frontend/components/room-organizer/panels/agent-review-ledger.tsx)：展示事项与证据；新增 `layout` 只读快照
- [agent-panel.tsx](file:///c:/Users/13266/.dsh/bot/workspace/Scendance2026/frontend/components/room-organizer/panels/agent-panel.tsx#L2008-L2010)：仅在既有两行挂载上追加 `layout={layout}`，未改结构

截图：`01-pending.png`（事项+目标+验收+待你处理）、`02-approved.png`（通过+证据）、`05-rejected.png`（驳回证据）、`08-history-panel.png`（三条历史带证据）。

新增类名：**无**。仍复用 `ap-card / ap-outcome / ap-outcome-label / ap-outcome-line / ap-small / ap-dispatch-list / ap-dispatch-row / ap-dispatch-body`。

### 这一步没做到的（明确）

1. **缩略图没有**：证据只有件数、itemId、前后坐标，没有画布截图缩略；做图需要 canvas 截图与存储，不在本次范围。
2. **`gate=agent` 没有运行时样本**：Bingo 的提案都会写画布，纯结论型提案目前不产出可复核卡。
3. **没有角色权限**：只做了动作门禁，没有 Owner/Admin/Collaborator/Observer。
4. 仍是本机 `localStorage`、决定靠状态机反推、控制台既有 React 告警未处理（均与第 0 步限制一致）。

## 来源

- [Mirasim 首页](https://mirasim.ai/)
- [Multiplayer coding agents](https://mirasim.ai/writing/multiplayer-coding-agents)
- [Members and collaboration（含 Items）](https://mirasim.ai/docs/team)
- [定时任务与目标（Goal 阶段机）](https://mirasim.ai/guide/zh/orchestrate)
- [公开 Live Space](https://mirasim.ai/live)
- 目标空间（登录墙）：<https://mirasim.ai/spaces?space=space-2cf57>
