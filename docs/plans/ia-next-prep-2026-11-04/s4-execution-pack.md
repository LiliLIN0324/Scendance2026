# S4 清理与回归 — 执行包（分片 C · 第二轮只读前置审计）

> 审计日期：2026-11-04（第二轮，在 `docs/plans/ia-s1-prep-2026-11-04/s4-cleanup-inventory.md` 上深化）
> 性质：纯只读审计，仅 Read/Grep/Glob/PowerShell 只读检查（Test-Path）；未写 frontend、未跑 git / vitest / tsc / build / dev / npm。
> 仓库根：`C:\mujing\Scendance2026`；file:line 均为**本轮实读**，较上轮快照普遍漂移 +1~3 行（见待核验 G7），S4 动手前必须重新 grep 定位。

---

## 速览

| 任务 | 结论一句话 | 风险 |
|---|---|---|
| 一、:341 三副作用 | 推荐 **A 档**（updater 剥副作用、say 体内顺序执行）：9 行改动、46 个测试零改写、只加 2 条回防用例 | 中 |
| 二、死 CSS | `agent-panel.css:402-493` 共 **54 条规则**逐条 grep 复核：JSX/TS **零引用**，可整段删；:397-401 存活块与 4 条注释边界已逐行标明 | 低 |
| 三、21 条注释 | 本轮实扫仍为 **21 条**（全注释、用户可见 0 条）：16 条改写、4 条随死块删、1 条保留历史口径 | 低 |
| 四、Bubble.to | 运行时证据支持**硬删（案①）**：UI 零写入方、渲染零消费、旧数据 normalize 逐字段容错、不崩溃；代价仅 2 条测试断言改写 | 低-中 |
| 五、回归规程 | 基线比对法落地：S4 failfiles 与仓根 `.s1-baseline-failfiles.txt`（16 文件）逐文件 diff，判据＝零新增文件/用例（≤45） | 中 |

基线数字本轮静态交叉复核：`agent-panel.react.test.tsx` 实数 **46 个 `it(` 块**（与台账 46/46 吻合）；`.s1-baseline.out.log` 实数 **45 条 FAIL 行**（与冻结基线 45/16 吻合）；`package.json:8-16` scripts 实读与上轮一致。

---

## 一、:341（实锚 `agent-panel.tsx:337-345`）三副作用修复详评

### 1.1 现状实锚（本轮实读，行号已复核）

```ts
// frontend/components/room-organizer/panels/agent-panel.tsx:337-345
const say = useCallback((bubble: Omit<Bubble, 'id'>) => {
  setBubbles(items => {
    const next = [...items.slice(-30), { id: uid(), ...bubble }];
    bubblesRef.current = next;                          // :340 副作用① ref 写入
    persistBubbles(boundSessionId.current, next);       // :341 副作用② 落盘+单例
    touchActiveSessionRef.current();                    // :342 副作用③ 同步 emit
    return next;
  });
}, [persistBubbles]);
```

关联事实（全部本轮实读）：

- `bubblesRef` 每 render 同步：`:310  bubblesRef.current = bubbles;`；`:309` 声明。
- `persistBubbles` 定义 `:331-335`：内部 `if (!sessionId) return;` 兜底（`:332`）→ `writeSessionBubbles(...)`（纯数据裁剪，`assistant-session-bodies.ts:43-60`）→ `replaceAssistantSessionBodies(written)`（`use-assistant-sessions.ts:148-152`：改写模块级 `bodies` 单例 + `writeAssistantSessionBodies` 写 localStorage）。**注意它本身不 emit**。
- `touchActiveSessionRef` 每 render 刷新（`:313-314`），指向 `use-assistant-sessions.ts:204-210 touchActiveSession` → `touchAssistantSession` → `commitIndex`（`:87-94`）→ `replaceSnapshot`（`:71-74`）→ `emit()`（`:67-69`）**同步调用全部 `useSyncExternalStore` 订阅者**（会话历史浮层等）。这是「渲染期驱动另一批组件重渲染」告警的直接来源。
- 切场 effect 共存于 `:348-360`：换 activeId 时 `persistBubbles(prevId, bubblesRef.current)`（`:353`）落旧场 → 换 `boundSessionId.current`（`:354`）→ `fromStoredBubbles(readSessionBubbles(...))` 载入新场（`:355-357`）→ 同步 ref 与 state（`:358-359`）。
- 调用链：`send`（`:1233`）→ `say`；UI 三处 `agent.send(...)`（`:1868`、`:1947`、`:1959`）。

### 1.2 A 档：updater 剥副作用、say 体内顺序执行（推荐）

改动轮廓（只动 `say`，`agent-panel.tsx:337-345`）：

```ts
const say = useCallback((bubble: Omit<Bubble, 'id'>) => {
  const prev = bubblesRef.current;               // :310 每帧已同步为最新 state
  const next = [...prev.slice(-30), { id: uid(), ...bubble }];
  bubblesRef.current = next;                   // 乐观写 ref：连发两句也不丢
  setBubbles(next);                             // 传值，不再有 updater 体
  persistBubbles(boundSessionId.current, next);  // 落盘（时机与原来同：同步）
  touchActiveSessionRef.current();              // emit 从「渲染期」挪到「事件/异步回调期」
}, [persistBubbles]);
```

- **StrictMode 双调用**：`say` 的调用点是事件 handler（composer submit/onGenerate）与异步 continuation（生成步骤回调），**不是** render-phase updater，React 不再双调。现状下 updater 双跑＝落盘与 touch 各跑两次（同值幂等、无可见差别）；修复后单跑，行为输出不变。
- **气泡顺序/连发**：连续两次 `say` 同一 tick 内，第二次基于「已乐观更新的 ref」计算，与原 updater 基于最新 state 等价（ref 每帧同步 state）；`slice(-30)` 裁剪语义不变、顺序不变、不丢。
- **与切场 effect（:348-360）交互**：零改动。effect 仍读 `bubblesRef.current` 落旧场——A 方案里 ref 由 `say` 即时写、由 effect `:358` 写，两个写入方语义与现状完全一致；effect 内无需任何调整。
- **boundSessionId 未就绪**：`persistBubbles` 内部 `:332` 早返回兜底，与现状相同。

### 1.3 B 档：持久化移入 useEffect

改动轮廓：`say` 瘦身为纯 `setBubbles(items => [...items.slice(-30), { id: uid(), ...bubble }])`；新增：

```ts
useEffect(() => {
  if (!assistantSessions.ready || !boundSessionId.current) return;
  persistBubbles(boundSessionId.current, bubbles);
  touchActiveSessionRef.current();
}, [bubbles, assistantSessions.ready, assistantSessions.activeId, persistBubbles]);
```

- **收益**：updater 彻底纯；emit 发生在 commit 后（effect），符合 React 对外部 store 更新的位置要求。
- **代价（新增风险面）**：
  1. **落盘延迟到 paint 后一帧**：`say` 到落盘之间窗口内崩溃/切场，气泡可能丢——现状是同步落盘（这是隐性的崩溃安全语义）。
  2. **与切场 effect 时序耦合**：切场瞬间，旧 effect 闭包 `bubbles` 与已切换的 `boundSessionId.current` 可能错位——需要双 effect 执行顺序对齐，否则可能「新场 loaded 气泡按旧 sessionId 落一次」或旧正文被空数组覆盖。
  3. **空袋删除分支**：`writeSessionBubbles` 空数组走 `:51-55` 删袋分支，恰好与「新开会话清空」语义吻合，但挂载首帧/切场加载完会多写一次，需要 skip 逻辑，容易写漏。
- **StrictMode**：effect 双跑幂等，但上述时序风险是 A 档没有的。

### 1.4 C 档：bubbles 并入 sessions 单例（远期，不进 S4）

把 `bubbles` 从 `useState` 搬进 `useAssistantSessions` 的 `bodies` 单例做单源真相。改动面覆盖 `LayoutAgentProvider`、`assistant-session-bodies`、所有读 `agent.bubbles` 的组件（`Bubbles` `:1683-1691` 等）与 `assistant-session-bodies.test.ts` 全部用例。持久化契约与测试全改，**不建议塞进 S4**（上轮结论本轮维持）。

### 1.5 对 46 个 agent-panel.react 用例的影响预判（读测试实锚）

测试文件实锚（本轮 grep `it(` = **46 块**）：

| 用例类别 | 实测锚点 | A 档影响 | B 档影响 |
|---|---|---|---|
| 会话气泡切换/清空 | `agent-panel.react.test.tsx:283-298`「restores 活动 bubbles when switching sessions and clears them on a new one」：send 一句 → 新开会话 → 断言消失 → 历史切回 → 断言回来 | **原样通过**（say→persist→effect 全链语义保持）；它就是 A 档的第一道回防 | **有时序风险**（effect 延迟落盘，新开会话点击时旧场可能尚未落盘，切回断言回来可能失败，要加 waitFor） |
| 预览不动画布草稿键 | `:198-212`：断言会话过程中画布草稿 localStorage 键不变 | 通过（say 写的是 `scendance.assistant-session-bodies.v1`，与画布草稿键本就隔离，A/B 都不改） | 通过 |
| 走 `send('...')` 的全部流程用例（T-03/T-04 等，约 20+ 块） | `:134-185`、`:189-217`、`:219-229` 等 | 通过（send 编排一行不动，say 只是内层落盘时机同步前移） | 大概率通过，但每块都可能需要补 `waitFor` 兜 effect 窗口 |
| 测试夹具 | `:10` import `resetAssistantSessionsStoreForTests`；`:127-128` 每条用例前 `localStorage.clear()` + 重置单例 | 不动 | 不动 |

**要新增的测试（先补后改）**：

1. 「发送后会话正文同步落盘」——在 send 一句后**不等待 DOM** 直接断言 localStorage bodies 键已含该气泡（锁 A 档的同步语义；B 档此断言会失败，正好当两档选择器）。
2. 「连发两句不丢」——连续 send 两句，断言两个气泡都在列表尾部（锁乐观 ref 语义）。
3. 可选：console.error spy 断言渲染期告警消失——jsdom 能否复现 React 开发态「Cannot update a component while rendering」告警**待核验**（React 告警多在开发态控制台输出，测试环境未必复现，抓不到不阻塞）。

**要改写的测试**：A 档**零改写**。B 档才需要给 `:283-298` 等块补 `waitFor`。

**对持久化契约的影响**：`writeSessionBubbles` / `replaceAssistantSessionBodies` / `touchActiveSession` 三个函数签名与行为**一行不动**；`assistant-session-bodies.test.ts` 4 块用例（`:29`、`:33-49`、`:51-78`、`:80-89`）零影响。A 档只是把调用点从 updater 体内挪到 say 函数体。

### 1.6 推荐与分步验证步骤

**推荐 A 档**。理由：①改动面最小（9 行）；②保持「落盘同步」现状语义，不给崩溃安全新增窗口；③与切场 effect 零时序耦合；④46 个现有用例零改写，只加 2 条回防。

分步验证顺序：

1. **先补测试**：在 `agent-panel.react.test.tsx` 加 §1.5 的用例 1、2（可选 3）。此时代码未改，用例 1（同步落盘）现状下应已通过、用例 2（连发不丢）现状下应已通过——作为行为锚；用例 3 若能抓到告警，先存住「红」。
2. **按 A 档改 `say`**（`:337-345`）。
3. 定向跑 `vitest run components/room-organizer/panels/agent-panel.react.test.tsx`：判据 46+2 全绿。
4. 定向跑 `vitest run components/room-organizer/lib/assistant-session-bodies.test.ts`：判据 4 块全绿。
5. 全量 vitest：failfiles 与仓根 `.s1-baseline-failfiles.txt` 比对（见 §五），判据零新增。
6. `npm run typecheck` exit 0、`npm run build` exit 0。
7. :3001 浏览器冒烟：活动脸连发两句需求（顺序对、不丢）→ 打开会话历史再切回（正文在）→ DevTools console 无 setState-in-render 告警。**第 7 步的 console 是本修复的最终验收**。

---

## 二、`agent-panel.css:402-493` 死规则逐条 grep 验证表

> 搜索范围：`frontend/`（.ts/.tsx/.css 全量；ripgrep 默认排除 node_modules/out/.next；本轮命中文件清单中无任何构建产物）。
> 搜索词族：`ap-agent-card|ap-agent-control|ap-control-*|ap-agent-link*|ap-via|ap-talk-face*|ap-dispatch*`。
> **本轮实跑结论：全部命中仅落在 `agent-panel.css` 自身，JSX/TS 零引用。**

### 2.1 逐条验证表（54 条规则）

| # | 选择器原文（css 行号） | TS/TSX 引用点 | 判定 | 备注 |
|---|---|---|---|---|
| 1 | `.ap-agent-card`（:402） | 零引用（搜索词 `ap-agent-card`） | 可删 | 载体 AgentControlCard 已随 S1.0 删除 |
| 2 | `.ap-agent-control`（:403-406） | 零引用 | 可删 | 同上 |
| 3 | `.ap-feed > .ap-agent-control`（:408） | 零引用（`.ap-feed` 本体存活于 `agent-panel.tsx:1856`、`agent-chat.tsx:108`、`member-chat.tsx:70`，但子孙 `.ap-agent-control` 已无） | 可删 | 只删此子孙选择器，`.ap-feed` 本体规则（css :85）保留 |
| 4 | `.ap-control-summary`（:410） | 零引用 | 可删 | |
| 5 | `.ap-control-name`（:411） | 零引用 | 可删 | |
| 6 | `.ap-control-name strong`（:412） | 零引用 | 可删 | |
| 7 | `.ap-control-info`（:413） | 零引用 | 可删 | |
| 8 | `.ap-control-info > summary`（:414） | 零引用 | 可删 | |
| 9 | `.ap-control-info > summary::-webkit-details-marker`（:415） | 零引用 | 可删 | |
| 10 | `.ap-control-info > div`（:416-419） | 零引用 | 可删 | |
| 11 | `.ap-control-info p`（:420） | 零引用 | 可删 | |
| 12 | `.ap-control-info dl`（:421） | 零引用 | 可删 | |
| 13 | `.ap-control-info dl > div`（:422） | 零引用 | 可删 | |
| 14 | `.ap-control-info dt`（:423） | 零引用 | 可删 | |
| 15 | `.ap-control-info dd`（:424） | 零引用 | 可删 | |
| 16 | `.ap-agent-links`（:425） | 零引用 | 可删 | |
| 17 | `.ap-agent-link`（:426-434） | 零引用 | 可删 | 含 :429-430 内嵌注释「多选只靠描边…」随块删 |
| 18 | `.ap-agent-link:hover`（:435） | 零引用 | 可删 | |
| 19 | `.ap-agent-link.is-active`（:436） | 零引用 | 可删 | |
| 20 | `.ap-via`（:438） | 零引用（Bubbles 渲染 `:1683-1691` 已不渲染 via 标签） | 可删 | |
| 21 | `.ap-talk-faces`（:440） | 零引用 | 可删 | |
| 22 | `.ap-composer:has(.ap-talk-faces)`（:441） | 零引用（`.ap-composer` 本体存活，见下） | 可删 | **只删这一条 :has 规则**，`.ap-composer` 本体规则（css :180-187、:204-205）保留 |
| 23 | `.ap-talk-face`（:442-445） | 零引用 | 可删 | |
| 24 | `.ap-talk-face + .ap-talk-face`（:446） | 零引用 | 可删 | |
| 25 | `.ap-talk-face .sc-rail-avatar`（:447） | 零引用（`.sc-rail-avatar` 本体存活，但仅在死载体下被引用） | 可删 | |
| 26 | `.ap-talk-face:hover, .ap-talk-face:focus-visible`（:448） | 零引用 | 可删 | |
| 27 | `.ap-talk-face:hover .sc-rail-avatar`（:449） | 零引用 | 可删 | |
| 28 | `.ap-talk-face-x`（:450-454） | 零引用 | 可删 | |
| 29 | `.ap-talk-face:hover .ap-talk-face-x, .ap-talk-face:focus-visible .ap-talk-face-x`（:455） | 零引用 | 可删 | |
| 30 | `.ap-talk-face:focus-visible`（:456） | 零引用 | 可删 | |
| 31 | `.ap-talk-face-more`（:457-461） | 零引用 | 可删 | |
| 32 | `.ap-agent-link:focus-visible`（:462） | 零引用 | 可删 | |
| 33 | `.ap-agent-link span`（:463） | 零引用 | 可删 | |
| 34 | `.ap-agent-link strong`（:464） | 零引用 | 可删 | |
| 35 | `.ap-agent-link small`（:465） | 零引用 | 可删 | |
| 36 | `.ap-dispatch`（:467） | 零引用（`dispatchRecords` 全仓 0 命中） | 可删 | |
| 37 | `.ap-dispatch > summary`（:468-472） | 零引用 | 可删 | |
| 38 | `.ap-dispatch > summary::-webkit-details-marker`（:473） | 零引用 | 可删 | |
| 39 | `.ap-dispatch > summary:focus-visible`（:474） | 零引用 | 可删 | |
| 40 | `.ap-dispatch-label`（:475） | 零引用 | 可删 | |
| 41 | `.ap-dispatch-count`（:476-479） | 零引用 | 可删 | |
| 42 | `.ap-dispatch-caret`（:480） | 零引用 | 可删 | |
| 43 | `.ap-dispatch[open] .ap-dispatch-caret`（:481） | 零引用 | 可删 | |
| 44 | `.ap-dispatch-list`（:482） | 零引用 | 可删 | |
| 45 | `.ap-dispatch-row`（:483） | 零引用 | 可删 | |
| 46 | `.ap-dispatch-row:hover`（:484） | 零引用 | 可删 | |
| 47 | `.ap-dispatch-faces`（:485） | 零引用 | 可删 | |
| 48 | `.ap-dispatch-faces .sc-rail-avatar + .sc-rail-avatar`（:486） | 零引用 | 可删 | |
| 49 | `.ap-dispatch-body`（:487） | 零引用 | 可删 | |
| 50 | `.ap-dispatch-body strong,`（:488） | 零引用 | 可删 | 多行选择器，与 #51 同删 |
| 51 | `.ap-dispatch-body small`（:489） | 零引用 | 可删 | （与 #50 共享一条声明头） |
| 52 | `.ap-dispatch-body strong`（:490） | 零引用 | 可删 | |
| 53 | `.ap-dispatch-body small`（:491） | 零引用 | 可删 | |
| 54 | `.ap-dispatch-empty`（:492）、`.ap-dispatch-empty svg`（:493） | 零引用 | 可删 | |

### 2.2 边界结论（为什么这些必须保留）

1. **`.sc-agent-panel:focus`（css :397）保留**：JSX 实锚 `agent-panel.tsx:1817`——`<aside id="agent-panel" className="sc-agent-panel" ... tabIndex={-1}>`。面板本体带 `tabIndex`，focus 态必须 reset outline，是存活规则。
2. **`.ap-agent-surface`（css :398-401）保留**：JSX 实锚 `agent-panel.tsx:1924`——`<div className={\`ap-agent-surface is-${activeAgent}\`}>`，空间/物料脸滚动容器；且 `:497-499` 还有 `.is-material`/`.is-space` 变体与 `+ .ap-chat` 兄弟规则在用。它是 :402 死块的**上邻存活块**，删除起点必须在 :402 之后开切、不得上吞。
3. **`.ap-composer` 本体（css :180-187、:204-205）保留**：JSX 三处存活——`agent-panel.tsx:1947`（活动 composer）、`agent-chat.tsx:113`（空间/物料 composer）、`member-chat.tsx:77`（成员聊天）。**只有 :441 `:has(.ap-talk-faces)` 这一条规则死**，它是 :440 起死块的一部分，随块删。
4. **区间内注释行随块处理**：
   - `:396` 注释「切到空间/物料/总控时…」——它领起的是 **:397-401 存活块**（四脸共用面板机制说明），**注释行保留、只改口径**（见 §三 #8），不随死块删。
   - `:407`（「总控卡住进对话流…」）、`:437`（「总控内点名…」）、`:466`（「总控卡里的一行台账…」）——这三条注释描述的规则全部必死，**随块删除、不另写**（见 §三 #9-11）。
5. **globals.css / workbench-shelf.css 本轮复核**：对七族名（`ap-agent-card|ap-agent-control|ap-control-|ap-agent-link|ap-via|ap-talk-face|ap-dispatch`）在 `frontend/app/globals.css` 与 `frontend/components/room-organizer/panels/workbench-shelf.css` 各跑一次 grep，**均 0 命中**——本轮复核仍零同类选择器，无需追加删除文件。`workbench-shelf.css:642` 仅为注释提及「总控卡」（见 §三 #21），非选择器。

### 2.3 删除执行轮廓（书面）

- 删除区间：`agent-panel.css` **:402-493 整段**，连同内嵌注释 :407、:409、:437、:439、:466、以及 :429-430 的内嵌多行注释。
- 保留：`:396` 注释（改词）、`:397`、`:398-401`，以及 :495-499 起的「物料/空间卡片」存活块。
- 动手前复核口令（书面，不执行）：对 §2.1 每个族名重跑 grep，确认 JSX/TS 仍 0 命中再删。

---

## 三、21 处「总控」注释逐条改写文案

> 本轮实扫：`grep 总控 frontend/` = **21 命中，全部为注释**（用户可见文案 0 条）。与上轮 21 条一致，但 agent-panel.tsx 内行号较上轮 +1（漂移）。统一新口径「活动」。

| # | file:line（本轮实读） | 原文 | 建议改写后文案 |
|---|---|---|---|
| 1 | `frontend/app/globals.css:1056` | `/* 门洞也是四个 agent 之一：切到总控时跟其他三格一样，左侧一条绿。 */` | `/* 门洞也是四个 agent 之一：切到活动时跟其他三格一样，左侧一条绿。 */` |
| 2 | `frontend/app/globals.css:1165` | `/* 左轨四格的状态点：总控一直在线，下面三格有事才醒、没事休眠，出错爆红。它是左轨唯一允许的点缀。 */` | `/* 左轨四格的状态点：活动一直在线，下面三格有事才醒、没事休眠，出错爆红。它是左轨唯一允许的点缀。 */` |
| 3 | `frontend/app/globals.css:1178` | `/* 总控那格是门厅标：点位跟着形体走，不贴着轨边。 */` | `/* 活动那格是门厅标：点位跟着形体走，不贴着轨边。 */` |
| 4 | `frontend/components/room-organizer/panels/agent-panel.tsx:91` | `/** 旧总控假分派留下的历史字段：S1 起不再写入，仅为兼容旧会话回放而保留。 */` | **随案①删除字段时此注释一并删**（见 §四）；若拍板案②保留迁移，改写为 `/** 旧假分派留下的历史字段：S1 起已不再写入；旧 localStorage 回放仅做兼容保留，UI 不渲染。 */` |
| 5 | `frontend/components/room-organizer/panels/agent-panel.tsx:1448` | `* 这些状态算「出了问题」。Bingo 那颗点与总控那格都靠它爆红。` | `* 这些状态算「出了问题」。Bingo 那颗点与活动那格都靠它爆红。` |
| 6 | `frontend/components/room-organizer/panels/agent-panel.tsx:1743` | `* S1 起「活动」是唯一对话与布置生成入口；旧的总控假分派已拆除，不做真多智能体调度台。` | **保留原样**——这是新口径的权威说明注释，「旧的总控假分派」是历史叙述，不应抹掉 |
| 7 | `frontend/components/room-organizer/panels/agent-panel.tsx:1770` | `/** 总控/空间/物料各自的对话区（Bingo 用自带的真对话，不传）。 */` | `/** 活动/空间/物料各自的对话区（Bingo 用自带的真对话，不传）。 */` |
| 8 | `frontend/components/room-organizer/panels/agent-panel.css:396` | `/* ── 四个 agent 共用一个面板：切到空间/物料/总控时，整栏变成对应卡片 ── */` | `/* ── 四个 agent 共用一个面板：切到空间/物料/活动时，整栏变成对应卡片 ── */`（注释行保留，领起 :397-401 存活块） |
| 9 | `frontend/components/room-organizer/panels/agent-panel.css:407` | `/* 总控卡住进对话流之后跟气泡同在一个 .ap-feed 里… */` | **随块删除 不另写** |
| 10 | `frontend/components/room-organizer/panels/agent-panel.css:437` | `/* 总控内点名：只标对话的收发双方… */` | **随块删除 不另写** |
| 11 | `frontend/components/room-organizer/panels/agent-panel.css:466` | `/* 汇总结果：总控卡里的一行台账… */` | **随块删除 不另写** |
| 12 | `frontend/components/room-organizer/panels/agent-chat.tsx:19` | `* 总控与 Bingo 走 AgentPanel 里那场真对话（同一个 agent、同一段气泡），这里不接管。` | `* 活动与 Bingo 走 AgentPanel 里那场真对话（同一个 agent、同一段气泡），这里不接管。` |
| 13 | `frontend/components/room-organizer/panels/agent-chat.tsx:56` | `// 和总控、Bingo、生成条同一份逐字提示，只是这格说场地/物料的事。` | `// 和活动、Bingo、生成条同一份逐字提示，只是这格说场地/物料的事。` |
| 14 | `frontend/components/room-organizer/panels/agent-chat.tsx:60` | `// 总控与 Bingo 是 AgentPanel 里那场真对话，这里不接管。` | `// 活动与 Bingo 是 AgentPanel 里那场真对话，这里不接管。` |
| 15 | `frontend/components/room-organizer/panels/agent-chat.tsx:147` | `{/* 物料这一格的左下角就是那颗生成物料星，和总控那格同一个入口、同一颗钮。 */}` | `{/* 物料这一格的左下角就是那颗生成物料星，和活动那格同一个入口、同一颗钮。 */}` |
| 16 | `frontend/components/room-organizer/panels/agent-chat.css:2` | `* 空间 / 物料 / 总控 的底部对话。` | `* 空间 / 物料 / 活动 的底部对话。` |
| 17 | `frontend/components/room-organizer/panels/agent-chat-store.ts:7` | `* （localStorage，按 agent 分线）。总控与 Bingo 那一场真实的对话走 AgentPanel 自己的…` | `* （localStorage，按 agent 分线）。活动与 Bingo 那一场真实的对话走 AgentPanel 自己的…` |
| 18 | `frontend/components/room-organizer/lib/lane-status.ts:6` | `* 总控一直在线；Bingo / 空间 / 物料 平时休眠着…` | `* 活动一直在线；Bingo / 空间 / 物料 平时休眠着…` |
| 19 | `frontend/components/room-organizer/panels/rail-lane-dot.tsx:11` | `* 总控例外：它一直在线，只有出错才爆红。` | `* 活动例外：它一直在线，只有出错才爆红。` |
| 20 | `frontend/components/room-organizer/panels/workbench-brand-toggle.tsx:9` | `* 总控那格常驻：状态点一直亮着（在线），出错才爆红。` | `* 活动那格常驻：状态点一直亮着（在线），出错才爆红。` |
| 21 | `frontend/components/room-organizer/panels/workbench-shelf.css:642` | `与总控卡同一套容器：1px 细边、--r-md 圆角、paper 底、10px 12px 内边距。` | `与活动卡同一套容器：1px 细边、--r-md 圆角、paper 底、10px 12px 内边距。`（此注释描述的容器规则存活，仅改注释词） |

### docs/ 下「总控」处置原则（本轮实扫 66 命中 / 9 文件）

实扫计数：`docs/` 下 66 命中 / 9 文件。其中 38 命中来自两份审计文档自身（`ia-s1-prep-2026-11-04/index.md` 5 条、`s4-cleanup-inventory.md` 33 条），属「描述清理动作」的元文本，不算残留；**其余 28 命中 / 7 文件**与上轮盘点一致：

| 文件 | 条数 |
|---|---|
| `docs/design-spec-2026.md` | 3 |
| `docs/SCENDANCE-AI-HANDOFF-v2.0-2026-10-29.md` | 2 |
| `docs/plans/ia-role-rework-ledger-2026-11-04.md` | 6 |
| `docs/research/ia-2026-11-04/index.html` | 1 |
| `docs/SPACE-MATERIAL-CHAT-DESIGN.md` | 2 |
| `docs/visual-2026/design-spec-2026.html` | 7 |
| `docs/SCENDANCE-TASTE-IA-MEMO-2026-10-29.md` | 7 |

处置原则（不逐条改）：

1. **不在 frontend 清理范围**，S4 不改这些文件。
2. 台账（6 条）与本执行包是「新旧口径对照」的权威，保留「总控」作历史名词引用是正确的。
3. 5 份老设计文档（design-spec、HANDOFF、TASTE-IA-MEMO、SPACE-MATERIAL-CHAT-DESIGN、visual design-spec）与 research 快照（1 条）：属设计史产物，**S4 仅在台账 §7 登记「docs 老文档保留历史口径」一行**，不逐字改写；若 owner 要求统一口径，另立 docs 刀，不夹进 S4。

---

## 四、Bubble.to / send(to?) 兼容链路完整核查

### 4.1 全链 grep 证据（本轮实读行号）

| 环节 | file:line | 现状 |
|---|---|---|
| 类型字段 | `agent-panel.tsx:91-92`：`/** 旧总控假分派留下的历史字段… */` + `to?: AgentId[];` | 声明在 |
| 落盘序列化 | `agent-panel.tsx:102-114 toStoredBubbles`：`:103` 解构 `to`、`:109` `...(to?.length ? { to } : {})` | 非空才写出 |
| 回放反序列化 | `agent-panel.tsx:116-117 fromStoredBubbles`：`:117` `...(to ? { to: [...to] } : {})` | 恢复进 Bubble |
| 发送签名 | `agent-panel.tsx:257`：`send(text: string, to?: AgentId[]): void;`（接口，注释 :255-256「to 为旧假分派参数…S4 随类型清理一并移除」） | 在 |
| 发送实现 | `agent-panel.tsx:1233`：`async function send(text: string, to?: AgentId[])`；`:1249` `say({ role: 'user', text: trimmed, ...(to?.length ? { to } : {}) })` | 透传到 user 气泡 |
| UI 写入方 | 全部调用点仅 3 处：`:1868 agent.send(sentence)`、`:1947 agent.send(draft)`、`:1959 agent.send(draft)` | **均只传 1 参，零写入方**（全 frontend grep `agent.send(` 实证；creative-studio.react.test.tsx:3026 的 `send('摆放桌子')` 是测试 harness 自有 send，非 agent.send） |
| 渲染消费 | `Bubbles` `:1683-1691`：只渲染 `text/image/meta/warn/amber/long/action` | **从不渲染 `to`** |
| 存储类型 | `assistant-session-bodies.ts:22`：`readonly to?: readonly ('door'|'bingo'|'space'|'material')[]` | 在 |
| 旧数据迁移 | `assistant-session-bodies.ts:136-141 normalizeStoredBubble`：`Array.isArray(record.to)` → 过滤合法 AgentId → 非空则挂回 | 旧 localStorage 的 to 被「过滤保留」 |
| 迁移测试 | `assistant-session-bodies.test.ts:66`：输入 `to: ['bingo', 'nope']`；`:75`：期望 `to: ['bingo']` | 钉死过滤行为 |

### 4.2 判定

1. **旧数据回放是否真的消费 to 字段？**——「保留但不消费」。`normalizeStoredBubble` 把旧 localStorage 里的 `to` 过滤后保留进内存 Bubble（`:136-141`），但 `Bubbles` 渲染（`:1683-1691`）与全 frontend 任何读取方都不读它。它是**只进不出**的元数据。
2. **删除字段后旧 localStorage 数据的兼容后果？**——**不崩溃、不静默判坏、丢的是本就不可见的元数据**。依据：`parseAssistantSessionBodies`（`:86-103`）与 `normalizeStoredBubble`（`:120-143`）是**逐字段容错**——旧 JSON 行里多出的 `to` 字段，删除类型后只是「没人捡」，不会导致整行 bubble 判坏（判坏的唯一条件是 `id` 非字符串/`role` 非法/`text` 非字符串）。运行时无影响。
3. **UI 是否确无写入方？**——是。3 个调用点全部单参（grep 实证），`:1249` 透传永远走不到 `to?.length` 非空分支。

### 4.3 两案工作项

**案① 连类型带迁移一起删（推荐）**：

| 文件 | 工作项 |
|---|---|
| `agent-panel.tsx` | 删 :91 注释、:92 `to?` 字段；:103 解构去掉 `to`、:109 写出行删；:117 反序列化 `fromStoredBubbles` 的 `to` 恢复删；:257 接口签名删 `to?`（:255-256 注释一并删）；:1233 实现签名删 `to?`、:1249 透传行简化为 `say({ role: 'user', text: trimmed })` |
| `assistant-session-bodies.ts` | :22 存储类型删 `to`；:136-141 迁移块删 |
| 测试 | `assistant-session-bodies.test.ts:66/:75`「drops corrupt rows on parse」用例改写：保留 corrupt-row 部分（空 id / 非法 role / null 行），删掉 `to: ['bingo','nope']` 输入与 `to: ['bingo']` 期望 |

**案② 保留只读迁移、只删写入路径**：

- 删 `agent-panel.tsx` 侧全部（字段、序列化、send 签名透传）；`assistant-session-bodies.ts:22` 类型与 :136-141 迁移**保留**。
- 后果：`StoredAssistantBubble.to` 永远只在 normalize 中进、无人读——从 `Bubble` 类型删了 `to` 后 `fromStoredBubbles` 也没处恢复，迁移产物成了**无人读的死数据**，比案①更拧巴，无真实收益。

### 4.4 推荐与理由

**推荐案①**。台账 §7 倾向「S4 随类型清理移除」，本轮静态证据支持硬删的运行时安全：①normalize 逐字段容错，旧 localStorage 不崩溃；②UI 零写入方、渲染零消费，删的是死链；③测试代价仅 2 处断言改写，可控。案②保留迁移但写入路径全删，兼容收益为零，反而留下「类型上有 to、内存里没人读」的长期困惑。**若 owner 想再保守一档**：案①先只删写入路径与 UI 类型（`agent-panel.tsx` 侧），`assistant-session-bodies.ts` 的存储类型与迁移留到下一刀——这是折中的案①.5，但不推荐长期维持。

---

## 五、S4 回归执行清单（书面规程）

> 所有命令以 `C:\mujing\Scendance2026` 为仓库根；vitest/tsc/build 在 `frontend/` 下执行。**本轮全部命令未执行**，仅为书面规程。

### 5.1 工具链静态核对（本轮 Test-Path 复核）

| 工具 | 路径 | 本轮状态 |
|---|---|---|
| node24 | `C:\Users\endTree\.dsh\runtime\node24\node_modules\node\bin\node.exe` | ✅ 存在 |
| vitest 兜底入口 | `C:\mujing\Scendance2026\frontend\node_modules\.bin\vitest.cmd` | ✅ 存在 |
| git | `"C:\Program Files\Git\cmd\git.exe"` | ✅ 存在 |
| `.next` 位置 | `C:\mujing\Scendance2026\frontend\.next`（仓根 `.next` 不存在） | ✅ 已静态核实 |
| package.json scripts（`:8-16` 实读） | `test=vitest run`、`typecheck=tsc --noEmit`、`build=node ../scripts/package-pages.mjs && next build`、`dev=node ../scripts/package-pages.mjs && node ../scripts/dev-with-amap-proxy.mjs` | ✅ 以此为准 |
| npm | node24 树内无 npm.cmd | ⚠️ 待核验（见待核验 G1） |

### 5.2 测试与基线比对法（重点）

1. **定向**：`...\frontend\node_modules\.bin\vitest.cmd run components/room-organizer/panels/agent-panel.react.test.tsx`——判据 exit 0、**46 + S4 新增用例全绿**。
2. **定向契约**：`vitest.cmd run components/room-organizer/lib/assistant-session-bodies.test.ts`——判据全绿（案①改写后按新断言）。
3. **全量**：`npm run test`（= `vitest run`）；npm 不可用时直跑 `vitest.cmd run`。
4. **导出本轮 failfiles**：全量输出里摘 `FAIL` 开头行，落到工作区临时文件（**不写仓根**，避免污染基线文件）。
5. **逐文件 diff**（PowerShell 形状，不执行）：

```powershell
# 在 frontend\ 下跑完全量、摘出 FAIL 行后：
Compare-Object `
  (Get-Content C:\mujing\Scendance2026\.s1-baseline-failfiles.txt) `
  (Get-Content <本轮导出的 failfiles 文件>)
```

- **通过判据**：`Compare-Object` 输出中**没有 `=>` 一侧的新文件**（即本轮失败文件 ⊆ 冻结基线 16 文件）；失败用例总数 ≤ 45（基线日志 `.s1-baseline.out.log` 本轮 grep 复核恰为 45 条 FAIL 行）。
- **基线口径结论**：S4 比对**以 `.s1-baseline-failfiles.txt`（16 文件）为准**。`.s1-full-failfiles.txt`（15 文件）是 S1.0 完工快照，与基线的**唯一差异是 `lib/share.test.ts`**（基线含、full 不含——S1.0 时它转绿）。它是已知环境性波动白名单成员：S4 执行时它若再次变红，**因它本就在 16 文件白名单内，不算新增**；若它保持转绿更好。两份文件不是两套基线，是「冻结基线 vs S1.0 完工快照」的关系。
- **白名单维护**：只允许 `lib/share.test.ts` 一类已在 16 文件名单内的环境性波动；任何名单外文件变红 = 红线，必须当刀修掉再 commit。

### 5.3 typecheck / build（回归门 2）

- `npm run typecheck`（= `tsc --noEmit`）：判据 **exit 0**。
- `npm run build`（= `node ../scripts/package-pages.mjs && next build`，静态导出）：判据 **exit 0**、Compiled successfully。

### 5.4 .next chunk 失配老办法

台账 §7 记录：构建与 dev 共用 `.next` 导致 chunk 失配。修法（按老办法）：

1. 停掉 :3001 dev server；
2. 删除 `C:\mujing\Scendance2026\frontend\.next` 目录（已静态核实存在；仓根无 `.next`，勿删错位置）；
3. 重跑 `npm run dev`；
4. 浏览器硬刷新 `http://localhost:3001/`。

### 5.5 :3001 浏览器冒烟操作单

前置：`npm run dev`（真实脚本 dev-with-amap-proxy），打开 `http://localhost:3001/`，开 DevTools Console。

1. **四脸切换**：左轨依次点 活动 / Bingo / 空间 / 物料，每脸停 2 秒。预期：面板随脸切换正常，无白屏。
2. **活动脸生成三道门**：
   - 输入框（`#composer`）说一句需求 → 发送钮；
   - **绿框预览门**：画布出绿框新位、右栏预览卡（`#plan-proposal`）出现；未确认前场景不写盘；
   - **唯一确认门**：点「确认布置」（`#step-cta` 类按钮），一次落盘、无第二套确认钮；
   - **撤销门**：走 `#cta-hint` 内「撤回」，整体退回确认前状态。
3. **Bingo 脸按 S2 后形态**：纯状态台（若 S2 已实施三钮：准备客户评审 / 导出评审包 / 立即体检），无自由生成输入框；有 `BingoAuditCard` 计数块。
4. **空间 / 物料面板**：切空间脸工具 chips 正常、切物料脸库面板正常。
5. **console 验收**：全程零报错；**无 "Cannot update a component while rendering a different component" / setState-in-render 类告警**——这是 :341 修复（§一）的浏览器最终验收。

### 5.6 git 纪律口令（只写不执行）

```powershell
# 状态
& "C:\Program Files\Git\cmd\git.exe" -C C:\mujing\Scendance2026 status
# 按切片本地 commit（按本切片实际改动文件逐个 add）
& "C:\Program Files\Git\cmd\git.exe" -C C:\mujing\Scendance2026 add <本切片文件>
& "C:\Program Files\Git\cmd\git.exe" -C C:\mujing\Scendance2026 commit -m "S4: ..."
# 自检：仅本地领先
& "C:\Program Files\Git\cmd\git.exe" -C C:\mujing\Scendance2026 log origin/main..HEAD --oneline
```

纪律：**不 push、不合 main、不 checkout main**；不绕 `onApplyCreative` 三道门（红线）。

---

## 待核验清单

1. **G1 npm 来源**：node24 树内无 npm.cmd，S4 执行人确认 npm 来自系统 PATH 还是 node.exe 直跑 npm-cli.js；vitest 可直跑 `.bin\vitest.cmd` 兜底（已静态存在）。
2. **G2「7 个 lib 套件」构成**：台账仅枚举 6 个（bingo-feedback / bingo-status / review-pins / layout-review / review-share / review-copy），第 7 个与 96/96 分件构成待 S4 以实跑 vitest 输出核定。
3. **G3 基线数字**：46 个 it 块、45 条 FAIL 行、16 文件名单本轮**静态**复核与台账吻合，但 S4 必须实跑复核。
4. **G4 Bubble.to 案①/②拍板**：本包推荐案①，待 owner 定（对应台账开放项 P5）。
5. **G5 门洞钮三意**：台账 S4 列项、`globals.css:1056` 注释提及，本轮未展开审计，属 S4 另一子项。
6. **G6 node 版本**：`package.json:62` engines 要求 `>=24.15 <25 || >=26`，S4 执行人须确认调用的 node24 满足该区间（未跑 `node -v`）。
7. **G7 行号漂移**：本轮实读 agent-panel.tsx 较上轮快照普遍 +1（`:90→:91`、`:256→:257`、`:1232→:1233`、`:1447→:1448`、`:1742→:1743`、`:1769→:1770`、composer `:1944→:1947`），说明工作树仍有轻微改写；S4 每刀动手前对目标文件重新 grep 定位。
8. **G8 告警可测性**：React「Cannot update a component while rendering」告警在 jsdom 测试环境能否复现未定；§一新增的 console.error spy 用例可能抓不到，抓不到不阻塞，以浏览器 console 验收为准。

---

## 边界合规自检

- **只读纪律**：全程仅 Read / Grep / Glob / PowerShell 只读检查（Test-Path、New-Item 仅在 docs 输出目录建目录）；**未写 frontend 任何文件、未跑 git、未起 dev server、未 npm install、未跑 vitest / tsc / build**。
- **禁区**：未访问 `frontend\public\ia-board` junction；未访问 `C:\幕景\Scendance2026` 旧快照。
- **grep 范围**：限 `frontend/` 与 `docs/`；ripgrep 默认排除 node_modules / out / .next，本轮所有命中清单中无构建产物。
- **产物**：仅本文件 `docs/plans/ia-next-prep-2026-11-04/s4-execution-pack.md`；未写 index.md、s3-entry-audit.md、s2-playbook-and-decisions.md。
- **引用计数**：46 it 块、45 FAIL 行、21 条「总控」、28+38 docs 命中、54 条 CSS 规则——均来自本轮真实 grep，搜索词与范围已在正文注明。
