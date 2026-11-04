# S4 清理与全量回归 — 盘点清单（分片 C · 只读前置审计）

> 审计日期：2026-11-04（快照口径，见下「活体漂移警告」）
> 审计员：分片 C 只读审计；全程未改任何代码、未跑任何命令（vitest / tsc / build / dev / git 一律未执行）。
> 仓库根：`C:\mujing\Scendance2026`；下文 file:line 均相对此根。
> 依据台账：`docs/plans/ia-role-rework-ledger-2026-11-04.md`（下称「台账」），S4 任务书见台账第 4 节、回归门见同节、:341 报错见第 3 节 E 组。

---

## 0. 活体漂移警告（先读）

**本次审计期间，主线程正在同一工作树上并行实施 S1.0，源码被实时改写。** 同一行在两次读取之间发生过变化，本清单所有 file:line 均为「审计快照」，S4 动手前必须复核：

| 证据 | 审计前快照（首轮读取） | 审计终扫（复核读取） |
|---|---|---|
| `frontend/components/room-organizer/panels/agent-panel.tsx:17` 图标 import | 含 `ChevronDown, ClipboardList, Inbox, Info`（19 个符号） | 已删至 16 个符号，四者被主线程移除 |
| `frontend/components/room-organizer/room-organizer.tsx:1968` | `aria-label="总控、Bingo、空间、物料"` | 已改为 `aria-label="活动、Bingo、空间、物料"` |
| `agent-panel.react.test.tsx` 旧 describe「总控内点名 agent」「总控的汇总结果卡」（旧 :791-838） | 存在（断言「总控 → 空间、物料」「分派结果」等） | 已被新块「S1 活动归位…假分派拆除」取代（现 :791、:820-826，改为断言旧控件消失） |
| `frontend` 全量 grep「总控」命中数 | 28 条（首轮） | 21 条（终扫，且全部为注释） |

**漂移结论：S1.0 源码在本审计开始前/期间已落地**（`AgentControlCard`、`dispatchRecords`、`talkTo`、`startTalk` 全仓 0 命中，grep 证据见任务一）。因此本清单的基调从「待 S1.0 落地后复核」改写为「**S1.0 源码已落地，以下为 S4 直接可执行的遗留盘点**」；每条仍保留复核动作，以防主线程继续改写。

---

## 1. 速览

| 任务 | 条数 | 最高风险 |
|---|---|---|
| 任务一 死 CSS | 3 族约 40 条规则（集中在 `agent-panel.css:402-493`） | 低：已全仓 0 JSX/TS 引用；唯一风险是误删与存活规则相邻的 `.ap-agent-surface`（`:398-401`） |
| 任务二 「总控」文案 | 表 A（用户可见）**0 条**；表 B（注释）21 条；docs 下 28 条/7 文件 | 低-中：frontend 已无用户可见「总控」；残留全是注释口径 |
| 任务三 import 候选 | 4 个图标符号（`Info/Inbox/ClipboardList/ChevronDown`）已被主线程移除；剩余 16 个全部仍在用 | 低：无需再动；仅需复核 export 是否还有消费者 |
| 任务四 :341 | setState-in-updater 实锚定在 `agent-panel.tsx:337-345`（`say`） | 中：StrictMode 下 updater 双调用，localStorage 与会话索引被重复写 |
| 任务五 回归规程 | vitest / tsc / build / dev 冒烟 / git 纪律 五段 | 中：node24 树内**无 npm.cmd**（待核验）；7 套件构成台账未枚举 |

---

## 2. 任务一：S1.0 后疑似死代码 CSS 选择器盘点

### 2.1 搜索方法与证据

- 搜索词：`ap-talk-faces|ap-via|ap-agent-control|ap-dispatch`，复核词：`ap-control-summary|ap-control-name|ap-control-info|ap-agent-links|ap-agent-link|ap-talk-face|ap-agent-card|ap-via`。
- 搜索范围：`frontend/` 全量（.tsx/.ts/.css），结果仅命中介于 `agent-panel.css` 与（首轮快照的）测试文件；终扫 51 条命中**全部**落在 `frontend/components/room-organizer/panels/agent-panel.css:402-493`，JSX/TS 零引用。
- 组件层对照：`AgentControlCard`、`dispatchRecords`、`talkTo`、`startTalk` 全仓 grep **0 命中**（搜索范围 `frontend/`）；当前 composer 在 `agent-panel.tsx:1944-1962` 为纯 textarea + 发送钮，无头像叠选；`Bubbles` 在 `agent-panel.tsx:1682-1690` 已不渲染 `bubble.to` 与 via/since 标签。
- `frontend/app/globals.css`、`frontend/components/room-organizer/panels/workbench-shelf.css`：对上述族名 grep 0 命中，无需追加文件（`workbench-shelf.css:642` 仅为注释提及「总控卡」，无选择器）。

### 2.2 死 CSS 表（文件：`frontend/components/room-organizer/panels/agent-panel.css`）

> 全部结论状态：**S1.0 落地后已死（当前零引用），待 S4 删除前复核**。删除区间建议：`:402-493`（连同其中注释行 :396、:407、:409、:437、:439、:466）。

| 族 | 选择器（行号） | 当前源码引用点 | 为何死 | 复核动作建议 |
|---|---|---|---|---|
| A. AgentControlCard 专属（必死） | `.ap-agent-card`（:402）；`.ap-agent-control`（:403-406、:408）；`.ap-control-summary`（:410）；`.ap-control-name`（:411-412）；`.ap-control-info` 全组（:413-424）；`.ap-agent-links`（:425）；`.ap-agent-link` 全组（:426-436、:462-465） | 零引用。grep 证据：全仓 `.ap-agent-card|.ap-agent-control|.ap-control-|.ap-agent-link` 仅命中本 CSS 文件自身，JSX/TS 0 命中（2026-11-04 终扫） | 载体 `AgentControlCard` 组件已随 S1.0 删除，全仓 0 命中 | 删除整族；注意**勿删**紧邻的存活规则 `.sc-agent-panel:focus`（:397）与 `.ap-agent-surface`（:398-401，`agent-panel.tsx:1921` 在用） |
| B. 假分派点名 / 头像叠选（必死） | `.ap-via`（:438）；`.ap-talk-faces`（:440）；`.ap-composer:has(.ap-talk-faces)`（:441）；`.ap-talk-face`/`-x`/`-more` 全组（:442-461） | 零引用。`.ap-talk-faces` 首轮仅测试文件引用（旧快照 `agent-panel.react.test.tsx:818`），终扫该测试块已被主线程删除，现 0 命中 | 载体为 composer 头像叠选与气泡收发标签，S1.0 已拆除（composer 现 `agent-panel.tsx:1944-1962`）；`Bubbles`（`agent-panel.tsx:1682-1690`）不再渲染 via 标签 | 删除整族；`.ap-composer` 本体存活（:1944），仅删 `:has(.ap-talk-faces)` 这一条 |
| C. 汇总台账卡（必死） | `.ap-dispatch`（:467-474）；`.ap-dispatch-label`（:475）；`.ap-dispatch-count`（:476-479）；`.ap-dispatch-caret`（:480-481）；`.ap-dispatch-list`（:482）；`.ap-dispatch-row`（:483-484）；`.ap-dispatch-faces`（:485-486）；`.ap-dispatch-body`（:487-491）；`.ap-dispatch-empty`（:492-493） | 零引用。grep 证据：全仓 `ap-dispatch` 仅命中本 CSS | 载体 `dispatchRecords` 汇总 `<details>` 卡已随 S1.0 删除（全仓 `dispatchRecords` 0 命中） | 删除整族 |

### 2.3 共用方核查（不可直接删的）

- 抽查结论：**未发现**上述族名与存活块共用的选择器。`.ap-feed`（容器，`agent-panel.tsx:1854`）、`.ap-composer`（:1944）、`.sc-rail-avatar`（多处）本体均存活，但引用它们的规则里只有「子孙/兄弟」选择器（如 `.ap-feed > .ap-agent-control`、`.ap-composer:has(.ap-talk-faces)`），随死载体一并失效，本体规则不受影响。
- 附带注释行（S4 随块删除）：`agent-panel.css:396`（「切到空间/物料/总控」）、`:407`、`:409`、`:437`（「总控内点名」）、`:439`、`:466`（「总控卡里的一行台账」）。

---

## 3. 任务二：全仓「总控」用户可见文案扫描

> 搜索词：`总控`；范围：`frontend/`（已排除 node_modules/out/.next/ia-board；本工具天然不会落到 junction）。
> **两轮快照**：首轮 28 命中 → 终扫 21 命中。差异由主线程实时改写造成（见 §0）。下表为**终扫口径**。

### 表 A · 用户可见（JSX 文本 / placeholder / aria-label / toast / 用户可见断言）

**0 条（frontend 范围内）。**

- 首扫曾命中 2 条用户可见残留，审计期间已被主线程处理：
  1. `room-organizer.tsx:1968` `aria-label="总控、Bingo、空间、物料"`（首轮快照）→ 终读已改为 `aria-label="活动、Bingo、空间、物料"`（`room-organizer.tsx:1968` 实读确认）。
  2. `agent-panel.react.test.tsx` 旧断言「总控 → 空间、物料」（旧 :822）→ 旧 describe 块已被替换为 S1.0 移除断言新块（现 :791、:820-826）。
- S4 处置建议：表 A 无需动作；若执行时复核发现主线程又引入新「总控」文案，door 新显示名统一用「活动」（台账 D1/Q1 口径）。

### 表 B · 非用户可见（代码注释 / CSS 注释 / 文档型注释）— 21 条，S4 统一口径

| # | file:line | 原文摘录 | S4 处置建议 |
|---|---|---|---|
| 1 | `frontend/app/globals.css:1056` | `/* 门洞也是四个 agent 之一：切到总控时跟其他三格一样，左侧一条绿。 */` | 「总控」→「活动」 |
| 2 | `frontend/app/globals.css:1165` | `/* 左轨四格的状态点：总控一直在线，下面三格有事才醒… */` | 同上 |
| 3 | `frontend/app/globals.css:1178` | `/* 总控那格是门厅标：点位跟着形体走… */` | 同上 |
| 4 | `frontend/components/room-organizer/panels/agent-panel.tsx:90` | `/** 旧总控假分派留下的历史字段：S1 起不再写入，仅为兼容旧会话回放而保留。 */` | 保留（描述 `Bubble.to` 残留，与任务四的遗留决策绑定） |
| 5 | `frontend/components/room-organizer/panels/agent-panel.tsx:1447` | `* 这些状态算「出了问题」。Bingo 那颗点与总控那格都靠它爆红。` | 「总控那格」→「活动那格」 |
| 6 | `frontend/components/room-organizer/panels/agent-panel.tsx:1742` | `* S1 起「活动」是唯一对话与布置生成入口；旧的总控假分派已拆除…` | 保留（正是新口径说明） |
| 7 | `frontend/components/room-organizer/panels/agent-panel.tsx:1769` | `/** 总控/空间/物料各自的对话区（Bingo 用自带的真对话，不传）。 */` | 「总控」→「活动」 |
| 8 | `frontend/components/room-organizer/panels/agent-panel.css:396` | `/* ── 四个 agent 共用一个面板：切到空间/物料/总控时… */` | 随死 CSS 块删除（任务一） |
| 9 | `frontend/components/room-organizer/panels/agent-panel.css:407` | `/* 总控卡住进对话流之后跟气泡同在一个 .ap-feed 里… */` | 随死 CSS 块删除 |
| 10 | `frontend/components/room-organizer/panels/agent-panel.css:437` | `/* 总控内点名：只标对话的收发双方… */` | 随死 CSS 块删除 |
| 11 | `frontend/components/room-organizer/panels/agent-panel.css:466` | `/* 汇总结果：总控卡里的一行台账… */` | 随死 CSS 块删除 |
| 12 | `frontend/components/room-organizer/panels/agent-chat.tsx:19` | `* 总控与 Bingo 走 AgentPanel 里那场真对话…` | 「总控」→「活动」 |
| 13 | `frontend/components/room-organizer/panels/agent-chat.tsx:56` | `// 和总控、Bingo、生成条同一份逐字提示…` | 同上 |
| 14 | `frontend/components/room-organizer/panels/agent-chat.tsx:60` | `// 总控与 Bingo 是 AgentPanel 里那场真对话…` | 同上 |
| 15 | `frontend/components/room-organizer/panels/agent-chat.tsx:147` | `{/* 物料这一格的左下角就是那颗生成物料星，和总控那格同一个入口… */}` | 同上 |
| 16 | `frontend/components/room-organizer/panels/agent-chat.css:2` | `* 空间 / 物料 / 总控 的底部对话。` | 同上 |
| 17 | `frontend/components/room-organizer/panels/agent-chat-store.ts:7` | `* （localStorage，按 agent 分线）。总控与 Bingo 那一场真实的对话走 AgentPanel…` | 同上 |
| 18 | `frontend/components/room-organizer/lib/lane-status.ts:6` | `* 总控一直在线；Bingo / 空间 / 物料 平时休眠着…` | 同上 |
| 19 | `frontend/components/room-organizer/panels/rail-lane-dot.tsx:11` | `* 总控例外：它一直在线，只有出错才爆红。` | 同上 |
| 20 | `frontend/components/room-organizer/panels/workbench-brand-toggle.tsx:9` | `* 总控那格常驻：状态点一直亮着（在线），出错才爆红。` | 同上 |
| 21 | `frontend/components/room-organizer/panels/workbench-shelf.css:642` | `与总控卡同一套容器：1px 细边、--r-md 圆角、paper 底、10px 12px 内边距。` | 「总控卡」→「活动卡」（此注释描述的容器规则存活，仅改注释） |

### docs/ 下「总控」汇总（不在 frontend 清理范围，仅计数）

终扫计数：**28 条 / 7 个文件**：

| 文件 | 条数 |
|---|---|
| `docs/design-spec-2026.md` | 3 |
| `docs/SCENDANCE-AI-HANDOFF-v2.0-2026-10-29.md` | 2 |
| `docs/plans/ia-role-rework-ledger-2026-11-04.md` | 6（台账自身引用新旧口径） |
| `docs/research/ia-2026-11-04/index.html` | 1 |
| `docs/SPACE-MATERIAL-CHAT-DESIGN.md` | 2 |
| `docs/visual-2026/design-spec-2026.html` | 7 |
| `docs/SCENDANCE-TASTE-IA-MEMO-2026-10-29.md` | 7 |

---

## 4. 任务三：AgentControlCard 删除后的未使用 import 候选

定义文件实读确认：`AgentControlCard` 即定义在 `agent-panel.tsx`（台账旧位置 :1771），现全仓 0 命中。

### 4.1 审计期间被主线程移除的 4 个图标符号（已完成，S4 复核即可）

import 行：`agent-panel.tsx:17`（来源 `@/components/solid-icons`）。

| 符号 | 首轮快照 import（旧行 :17） | 终扫状态 | 本文件删除前引用点 | 全仓其他文件引用计数（证据） | 结论 |
|---|---|---|---|---|---|
| `Info` | 在列 | 已从 :17 移除，本文件 0 使用 | 旧 AgentControlCard 内（组件已删，行号已不可考） | `\b(Info\|Inbox\|ClipboardList\|ChevronDown)\b` 全仓合计 34 命中 / 13 文件（含 `solid-icons.tsx` 自身 export 4 命中）；其余消费方：`select.tsx`(3)、`space-panel.tsx`(6)、`online-model-library.tsx`(3)、`share-menu.tsx`(2) 等 | 本文件专属可删（已删）；**其他文件仍在用，solid-icons 的 export 不得删** |
| `Inbox` | 在列 | 同上 | 同上 | 同上 | 同上 |
| `ClipboardList` | 在列 | 同上 | 同上 | 同上 | 同上 |
| `ChevronDown` | 在列 | 同上 | 同上 | 同上 | 同上 |

> 说明：四个符号的「删除前在本文件的具体使用行号」已随组件删除从工作树不可考；首轮快照仅能证明它们曾在 import 行。S4 若需逐符号对账，对照基线提交 `a87c156` 的 diff 即可，本审计不编造行号。

### 4.2 剩余 16 个 import 符号复核（全部仍在使用，不可删）

终扫 `agent-panel.tsx:17` 现列：`ArrowUp, Check, Clock, FileImage, Loader2, Map as MapIcon, MapPin, Maximize2, MessageCirclePlus, Minimize2, Palette, Paperclip, RotateCw, SquareDashed, X`。逐符号引用点（实读 grep）：

| 符号 | 本文件引用行 | 判定 |
|---|---|---|
| ArrowUp | :1960 | 在用 |
| Check | :1699、:1868 | 在用 |
| Clock | :1834 | 在用 |
| FileImage | :1685、:2091 | 在用 |
| Loader2 | :1699、:2093 | 在用 |
| MapIcon | :1541、:1567、:1586 | 在用 |
| MapPin | :1925 | 在用 |
| Maximize2 | :1643、:2085 | 在用 |
| MessageCirclePlus | :1843 | 在用 |
| Minimize2 | :1643、:2085 | 在用 |
| Palette | :1591 | 在用 |
| Paperclip | :1926 | 在用 |
| RotateCw | :1880 | 在用 |
| SquareDashed | :1542 | 在用 |
| X | :1644、:1676、:1848、:1949 | 在用 |

**结论：agent-panel.tsx 无需再删任何 import。** 另注：`Bubble.to` 数据模型残留（非 import）见 §5 与待核验清单第 4 条。

---

## 5. 任务四：`agent-panel.tsx:341` setState-in-render 只读分析

### 5.1 现状实锚（行号漂移说明）

台账记 `:341`。终扫实读，问题块落在 **`frontend/components/room-organizer/panels/agent-panel.tsx:337-345`**（`say` 的 useCallback），报错行现对齐 `:341 = persistBubbles(...)`：

```ts
// :337-345
const say = useCallback((bubble: Omit<Bubble, 'id'>) => {
  setBubbles(items => {
    const next = [...items.slice(-30), { id: uid(), ...bubble }];
    bubblesRef.current = next;                          // :340 ref 写入（副作用）
    persistBubbles(boundSessionId.current, next);       // :341 落盘 localStorage（副作用）
    touchActiveSessionRef.current();                    // :342 会话索引 emit（副作用）
    return next;
  });
}, [persistBubbles]);
```

### 5.2 触发组件与 state

- 组件：`LayoutAgentProvider`（`useAgent` 提供方，`say` 在其体内定义）；面板侧消费 state 为 `bubbles`。
- 被连带触发的外部 state：`useAssistantSessions` 模块级单例（`hooks/use-assistant-sessions.ts:62-64` 的 `snapshot`/`bodies` + `listeners`）。

### 5.3 根因

React 函数式 updater 必须纯。这里 updater 体内埋了三个副作用：
1. **`persistBubbles`（:341）**：`writeSessionBubbles` 写 localStorage + `replaceAssistantSessionBodies`（`use-assistant-sessions.ts:148-152`）改写模块级 `bodies` 单例。
2. **`touchActiveSessionRef.current()`（:342）**：`touchActiveSession`（`use-assistant-sessions.ts:204-210`）→ `commitIndex` → `replaceSnapshot` → `emit()`（:67-69）同步通知所有 `useSyncExternalStore` 订阅者 —— 即在「处理别的组件 setState 的 updater」的渲染期，驱动另一批组件重渲染，触发 React「Cannot update a component while rendering a different component」类告警；StrictMode 下 updater 双调用还会让落盘与索引 touch 各跑两次。
3. `bubblesRef.current = next`（:340）：ref 写在 updater 里同样不纯（虽后果最轻）。

诱因链条：`send`（:1232）→ `say`；切场 effect（:348-359）另走 `persistBubbles`，与本条共存。

### 5.4 修复候选（≥2，只分析不改）

| 候选 | 做法 | 改动面 | 风险 |
|---|---|---|---|
| A. updater 剥副作用，改在 `say` 体内顺序执行 | 依据 `bubblesRef.current`（:309 已每帧同步）算出 `next`，`setBubbles(next)` 传值；随后立即 `bubblesRef.current = next`、`persistBubbles(...)`、`touchActiveSession()` | 只动 `say` 一个函数（:337-345） | 快速连发两条 `say` 时 ref 尚未随 render 刷新会丢气泡——用「立即写 ref」规避；须与切场 effect（:348-359）共用同一 persist 并保持幂等 |
| B. 持久化移入 `useEffect` | updater 只算 `next`；新增 `useEffect` 监听 `[bubbles, boundSessionId]` 做落盘 + touch，首帧跳过 | 新增一个 effect，删 `say` 内两处副作用 | effect 在 paint 后跑；与切场 effect 的执行顺序需对齐（防旧场气泡先 persist 新场）；初始挂载多写一次需 skip |
| C. bubbles 并入 sessions 单例（远期） | 把 `bubbles` 从 `useState` 搬进 `useAssistantSessions` 的 `bodies` 单例，单源真相 | `LayoutAgentProvider`、`assistant-session-bodies`、所有读 `agent.bubbles` 的组件与 `assistant-session-bodies.test.ts` 全动 | 面最大，测试与持久化契约全改，不建议塞进 S4 |

### 5.5 为什么不在 S1/S2 夹带

1. 该报错**先于 S1 存在**（台账 E 组：「不在 P4 diff 内，单列修复」），与假分派拆除无因果；S1.0 diff 已含面板结构大改，夹带 persistence 重构会模糊回归归因。
2. 三道门红线（`onApplyCreative` 等）不经 `say`，但 `say` 的 persist 是会话落盘热链；按 A 或 B 修都必须配 `assistant-session-bodies` 测试回防，独立成刀、独立 commit 最安全。
3. 台账执行顺序要求每刀过同一组回归门；S4 任务书已点名此项为 S4 内容。

---

## 6. 任务五：S4 全量回归操作清单（书面规程，本轮未执行）

> 所有命令以 `C:\mujing\Scendance2026` 为仓库根；vitest/tsc/build 在 `frontend/` 下执行。基线数字（96/96、46/46）**来自台账第 4 节，S4 执行时必须实跑复核**。

### 6.1 工具链静态核对（本审计已核）

| 工具 | 路径 | 状态 |
|---|---|---|
| node24 | `C:\Users\endTree\.dsh\runtime\node24\node_modules\node\bin\node.exe` | ✅ 已静态存在 |
| npm / npm.cmd | node24 树内（根目录仅 `node_modules`；`node_modules\node\` 下无 npm 包）**未找到 npm.cmd** | ⚠️ 待核验（见待核验清单第 1 条） |
| vitest 入口 | `C:\mujing\Scendance2026\frontend\node_modules\.bin\vitest.cmd` | ✅ 已静态存在 |
| git | `"C:\Program Files\Git\cmd\git.exe"` | ✅ 已静态存在 |
| package.json scripts（已读 `frontend/package.json:8-16`） | `test`=`vitest run`、`typecheck`=`tsc --noEmit`、`build`=`node ../scripts/package-pages.mjs && next build`、`dev`=`node ../scripts/package-pages.mjs && node ../scripts/dev-with-amap-proxy.mjs` | ✅ 引用以此为准，不编 script 名 |

### 6.2 测试（回归门 1）

1. 全量：在 `frontend\` 下执行 `npm run test`（即 `vitest run`）；若 npm 未就绪，改用 `C:\mujing\Scendance2026\frontend\node_modules\.bin\vitest.cmd run`。**判据：exit 0**。
2. 定向复核 agent-panel：`... vitest.cmd run components/room-organizer/panels/agent-panel.react.test.tsx`。**判据：exit 0，基线 46/46（台账数字，实跑复核）**。
3. 「7 个 lib 套件」基线 96/96：台账第 4 节列名 6 个 —— `lib/bingo-feedback.test.ts`、`lib/bingo-status.test.ts`、`lib/review-pins.test.ts`、`lib/layout-review.test.ts`、`lib/review-share.test.ts`、`lib/review-copy.test.ts`（均在 `frontend/components/room-organizer/lib/` 下，已静态核实存在）；**第 7 个套件台账未枚举，以实跑输出为准**（待核验清单第 2 条）。
4. S4 新行为（删死 CSS、统一注释、修 :341）**先补测试再改代码**（回归门 1 末句）。

### 6.3 类型与构建（回归门 2）

5. `npm run typecheck`（= `tsc --noEmit`）。**判据：exit 0**。
6. `npm run build`（= `node ../scripts/package-pages.mjs && next build`，静态导出）。**判据：exit 0**。

### 6.4 `:3001 next dev` 浏览器冒烟（回归门 3，逐步操作单）

前置：`npm run dev`（真实脚本为 dev-with-amap-proxy，端口按台账 :3001）。

- **路径一 · 生成三道门**
  1. 活动脸输入框（`#ap-input`）说一句需求 → 点发送钮（aria-label「发送」）。
  2. **绿框预览门**：画布出现绿框新位，右栏出预览卡（`#plan-proposal`）。预期：未确认前场景不写盘。
  3. **唯一确认门**：点「确认布置」（`#step-cta`）。预期：一次落盘，无第二套确认钮。
  4. **撤销门**：走「撤回」文字链（`#cta-hint` 内）。预期：整体退回确认前状态。
- **路径二 · 评审评论 / 钉解决回流**
  1. 模式切到评审：点「打开客户评审」chip（`agent-panel.tsx:1899`）。
  2. 客户侧评论 → 钉点标记解决 → 回流制作者台账（Bingo 审计卡 `BingoAuditCard`，`agent-panel.tsx:1872`）。预期：计数与回执状态随动作变化。
- **路径三 · 四脸切换**
  1. 左轨依次切：活动（品牌钮 `WorkbenchBrandToggle`，`room-organizer.tsx:1967`）、Bingo（`BingoRailButton`）、空间（aria-label「空间」钮）、物料。
  2. 预期：仅活动脸有生成 chrome；Bingo 脸只剩评审入口；空间/物料为工具面（`agent-panel.tsx:1921-1931`）。
- 每路径预期「控制台无 setState-in-render 告警」（顺带验收任务四的修复效果）。

### 6.5 git 纪律（回归门 4，只写口令不执行）

7. 状态查看：`"C:\Program Files\Git\cmd\git.exe" -C C:\mujing\Scendance2026 status`。
8. 按切片本地 commit：`... git.exe -C C:\mujing\Scendance2026 add <本切片文件> && ... git.exe commit -m "S4: ..."`。
9. **不 push、不合 main 的自检口令**：执行 `... git.exe -C C:\mujing\Scendance2026 log origin/main..HEAD --oneline`（确认仅本地领先），且全程不出现 `push` / `merge main` / `checkout main` 动作；不绕 `onApplyCreative`（红线）。

---

## 7. 待核验清单（逐条编号）

1. **npm 来源**：node24 树内无 npm.cmd/node 包，S4 执行环境的 npm 来自 PATH 系统 npm 还是 `node.exe` 直跑 npm-cli.js，待执行人确认；vitest 可直跑 `.bin\vitest.cmd` 兜底。
2. **「7 个 lib 套件」构成**：台账仅点名 6 个（见 6.2），第 7 个与 96/96 分件构成待 S4 以实跑 vitest 输出核定。
3. **基线数字**：96/96 与 46/46 为台账口径，本审计受边界约束未实跑，S4 必须实跑复核。
4. **`Bubble.to` 残留处置**：`agent-panel.tsx:91`（类型字段）、`:102-116`（序列化往返）、`:1248`（send 内展开）、接口签名 `:256` 与实现 `:1232`（`to?: AgentId[]`）仍在；`assistant-session-bodies.ts:136-137` 还在做旧数据迁移（`assistant-session-bodies.test.ts:66,75` 有对应测试）。是「保留迁移、只删写入路径」还是「连迁移一并下」，待 S4 拍板。
5. **门洞钮三意**（台账 S4 列项、`globals.css:1056` 注释提及）：本轮未展开审计，属 S4 另一子项。
6. **node 版本口径**：`package.json:62` engines 要求 `>=24.15 <25 || >=26`；S4 执行人须确认调用的 node24 满足该区间。
7. **行号漂移**：本审计全程主线程在并行改写（见 §0），所有 file:line 为 2026-11-04 快照；S4 动手前对每个目标文件重新 grep 定位。

---

## 8. 边界合规自检

- 仅使用 Read/Grep/Glob/PowerShell 只读检查（`Test-Path`、目录列举）+ 本文件一次 Write；**未写 frontend 任何文件、未跑 git 命令、未起 dev server、未 npm install、未跑 vitest/tsc/build**。
- 未访问 `frontend\public\ia-board` junction，未访问 `C:\幕景\Scendance2026` 旧快照；grep 范围限 `frontend/` 与 `docs/`（docs 仅计数，未逐条展开）。
- 引用计数均来自真实 grep（搜索词与范围已注明）；npm 未找到处标「待核验」，未编造路径。
- 产物仅本文件，未写 index.md / s11-gallery-card.md / s2-review-audit.md。
