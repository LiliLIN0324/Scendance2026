# IA 重划 S1 前置只读审计 · 总索引（hub）

> 日期：2026-11-04
> 仓库：`C:\mujing\Scendance2026`（分支 `feat/smart-build-scene-script`，台账基线提交 `a87c156`）
> 性质：三份并行只读前置审计的集成索引，服务主线程正在实施的 S1.0 及后续 S1.1 / S2 / S4。
> 证据口径：全部结论以工作树实读 `file:line` 为凭；本轮未运行 vitest / tsc / build / dev server，未做任何 git 操作。

---

## 0. 最重要的前提：这是一次「活体审计」

审计执行期间，主线程正在同一工作树并行落地 S1.0，三份文档都记录到同一行被实时改写。集成验收时的哈希比对显示：审计窗口期 frontend 仅 **4 个文件**发生变化，且全部是 S1.0 预期内文件，无审计污染、无新增文件：

- `components/room-organizer/panels/agent-panel.tsx`
- `components/room-organizer/panels/agent-panel.react.test.tsx`
- `components/room-organizer/panels/typed-suggestion.tsx`
- `components/room-organizer/room-organizer.tsx`

集成验收（审计结束后）实测确认的 S1.0 落地状态：

| 项 | 现状（验收时实读） | 证据 |
|---|---|---|
| door 显示名 | 已改名「活动」，id 字符串 `'door'` 保留 | `agent-panel.tsx:1746` 区、`agent-panel.tsx:1802` `const activity = activeAgent === 'door'` |
| AgentPanel 默认脸 | 已是 `'door'` | `agent-panel.tsx:1753` 签名默认值 |
| room 级默认脸 | **已翻为 `'door'`**（分片 A 审计时此处仍是 `'bingo'`，验收时确认主线程已落刀） | `room-organizer.tsx:217` `useState<AgentId>('door')` |
| 生成 chrome 门控 | PlanHome 已挂 `activity && mode === 'layout'` | `agent-panel.tsx:1861` |
| 假分派三件套 | `AgentControlCard` / `dispatchRecords` / `talkTo` / `startTalk` 全仓 grep 零命中 | 三份文档交叉验证 |
| 用户可见「总控」 | frontend 范围内 **0 条**，残留 21 条全是注释 | 见 s4 文档 §3 |

**纪律**：三份分文档中的行号均为各自审计时点的快照；主线程仍在改写，任何一刀动工前必须对目标文件重新 grep 定位（全局待核验项 G1）。

---

## 1. 三份产物索引

| 文件 | 分片 | 服务切片 | 一句话内容 |
|---|---|---|---|
| `s11-gallery-card.md` | A | S1.1 活动开场画廊 | 孤儿面板全量审计 + 封面卡网格/整卡直入分步施工卡（约 240 行） |
| `s2-review-audit.md` | B | S2 Bingo 转审校台 | 评审全链路一活两断、bingo 脸 JSX 保留/摘除清单、Q3 输入条方案、测试缺口（约 286 行） |
| `s4-cleanup-inventory.md` | C | S4 清理与回归 | 死 CSS 三族约 40 条、总控文案扫描、import 候选、:341 根因、全量回归操作单（约 280 行） |

---

## 2. 跨分片关键发现（集成视角）

### 2.1 S1.0 现状：源码主体已落地，剩余是联调与冒烟

- 假分派拆除、改名、生成 chrome 换脸、默认脸翻转均已在工作树可见；分片 C 终扫时用户可见「总控」已清零，四个专属图标 import 也已由主线程移除。
- 唯一需要主线程自查的是**收尾一致性**而非补刀：`room-organizer.tsx:217` 验收时已翻门，建议首屏冒烟确认画廊/活动脸落点（详见 §4 第 0 步）。

### 2.2 S1.1 画廊：不是新建工程，是「接线 + 交互层改造」（分片 A）

1. **生产零挂载**：`LocalActivitiesPanel` 全 frontend 仅两个测试文件 import（`local-activities-panel.react.test.tsx:13`、`creative-studio.react.test.tsx:23,1637`），生产树零 JSX——功能完整的孤儿组件。
2. **骨架已是画廊**：`.sc-local-activities-list` 已是 `repeat(auto-fill,minmax(190px,1fr))` 卡网格（`local-activities-panel.css:20`），320:190 封面区、名称两行截断齐备；封面体系（3D 定格 400KB 上限 + 旧档自动补拍 + PlanThumb 兜底）已完整。
3. **「点卡直入不弹向导」无需新事务**：现有 `switchActivity()`（`local-activities-panel.tsx:129-170`）已含 prepareBackup→归档→读旧档→restoreBackup 完整事务与 token/epoch 防重入闸，15 组测试覆盖；把小按钮 handler（`:225`）上移为整卡 onClick 即可，事务本体一行不动。
4. **推荐挂载点**：AgentPanel 活动脸 `ap-feed` 顶部、PlanHome（`agent-panel.tsx:1861`）之前，门控 `activity && mode==='layout'`；新建独立包装组件直接 `useLocalProjectBackup()` 取 actions，零 prop 穿洞，对 AgentPanel 的改动压到一行条件渲染。
5. 两个硬事实约束：新建活动强制非空名（`local-activities.ts:163`），「免命名」需另立 lib 变更，不在 S1.1；`LocalActivitySummary` 不输出 brief 状态，状态短词先用现成 `itemCount` + `dossierStatus('齐/缺')`（`mode-shell.tsx:14-16`）。

### 2.3 S2 审校：真正活着的闭环只有一条，制作者侧钉状态机「接线在、门没开」（分片 B）

1. **两个同名 ReviewSharePage 都是活路由、两套实现**：裸 `/review`（`app/review/page.tsx:1`）挂画内落钉富页，是当前真客户页；`/review/[id]`（`review-link-client.tsx:5`）挂 panels 版评论页。
2. **一活两断**：
   - 活链＝hash 钉评：分享菜单 `issueReviewLink`（`room-organizer.tsx:375-390`）发 `#layout=` 链接 → 客户钉写 `scendance-review-share-pins-v1` → 回执 → BingoAuditCard 按 `link:fnv1a(hash)` planKey 对齐读 pinCount/returned，端到端真接通（同浏览器 localStorage 口径）。
   - 断链一：UUID 评论链 `issueReviewShare`（`review-share.ts:119`）生产零调用方，仅 3 处测试在喂，整条快照+评论链是孤儿。
   - 断链二：制作者侧画布钉状态机（review-pins / ReviewIssuesCard / reviewSlot）代码完整，但 `demoteLegacyMode`（`workbench-mode.ts:19-23`）把 workbenchMode 永远收编为 `'layout'`，reviewSlot（`agent-panel.tsx:1896` 区）等入口当前全部不可达——S2 要决定的是「开哪扇门」。
3. **Q3 推荐「纯状态台 + 三钮」**（注意：台账 Q3 原文是「两口令」，分片 B 论证第三钮躲不掉）：体检 `reviewNow()` 当前在 Bingo 脸的**唯一入口就是自由口令**（`agent-panel.tsx:1295`），摘 composer 前不先按钮化等于删功能；三钮全部复用现成函数（`onOpenReview` / `proposeExport` / `reviewNow`），落在 BingoAuditCard 挂载点（`:1873`）旁，零新 state、不碰三道门、不新增 wire schema。
4. **一处语义口径不一致待产品拍板**：AgentReopenCard 红环「任意回执即亮」（`review-return.ts:54-55`），returned 徽标却按 planKey 过滤（`bingo-status.ts:156`）。
5. Bingo 脸仍可打字触发生成链（`workbench-agent.ts` 口令路由收敛在 `agent-panel.send()`），与 S1.0 后「Bingo 不做布置生成」的定位冲突，纯状态台方案可根治。

### 2.4 S4 清理：死代码边界干净，:341 是唯一需要设计的修复（分片 C）

1. **死 CSS 可整段删**：`agent-panel.css:402-493` 三族约 40 条规则（`.ap-agent-control*` / `.ap-via`/`.ap-talk-face*` / `.ap-dispatch*`）全仓 JSX/TS 零引用；存活的 `.sc-agent-panel:focus`（`:397`）与 `.ap-agent-surface`（`:398-401`）紧邻，删除边界已标明；globals.css、workbench-shelf.css 无同类残留。
2. **「总控」frontend 终扫 21 命中全是注释**（ts/tsx 12 条已逐一核验均为注释，css 9 条），用户可见 0 条；docs 下另有 28 条/7 文件仅需统一口径。
3. **import 无需再动**：`Info/Inbox/ClipboardList/ChevronDown` 已被主线程移除且本文件零使用，但全仓 13 文件仍在用，solid-icons 的 export 不得删；剩余 16 个图标逐符号核过全部在用。
4. **:341 实锚＝`say` 的 updater 内三副作用**（`agent-panel.tsx:337-345`）：ref 写入、`persistBubbles` 落盘、`touchActiveSession` 同步 emit 埋在函数式 setState 里，StrictMode 双调用；给了三档修复候选，推荐 updater 剥副作用或 useEffect 同步，独立成刀。
5. **数据模型遗留待拍板**：`Bubble.to` 类型/序列化/`send(to?)` 参数仍在但无写入方，旧 localStorage 迁移（`assistant-session-bodies.ts:136-137`）带测试，「连迁移一起下」还是「保留迁移只删写入」需 S4 定。
6. 回归规程已按 `package.json:8-16` 真实 scripts 写好（`test=vitest run` / `typecheck=tsc --noEmit` / `build=package-pages.mjs && next build`）；node24 树内**未找到 npm.cmd**，vitest 可直跑 `node_modules\.bin\vitest.cmd` 兜底。

---

## 3. 给主线程的接刀顺序建议

```
S1.0 收尾冒烟（当前）
  └─ 首屏确认：room 级默认脸已翻 door（room-organizer.tsx:217），活动脸首屏 chrome 正确；
     跑既有回归门（分文档 s4 §6 的书面规程），假分派零命中已由本轮审计交叉确认。

S2 Bingo 转审校（建议先于 S1.1，二者同在 agent-panel.tsx 动刀，串行避冲突）
  1. 先定 Q3：推荐纯状态台+三钮，体检钮是强制前置（否则 reviewNow 断入口）。
  2. 开门决策：demoteLegacyMode 收编下的 reviewSlot/ReviewIssuesCard 是打开还是收口，
     连同 UUID 孤儿评论链（issueReviewShare）的删留一起拍板；动它前先处置对应 3 处测试。
  3. 统一红环/returned 口径（产品确认项 P3）。
  4. composer 门控由 conversation 收窄为 activity，bingo 脸生成链顺手根治。

S1.1 活动画廊（S1.0 定稿后落刀）
  1. 新建独立包装组件（activities-gallery-mount），AgentPanel 只加一行条件渲染，
     插入点以 S1.0/S2 合并后的实际行号重新 grep（ap-feed/PlanHome 区）。
  2. 整卡 handler 上移复用 switchActivity，事务与三道门接线不碰；CSS 只补交互态/chip/拼贴卡。
  3. 先补宿主级门控与整卡直入测试，再改组件；现 15 组事务测试一行不改。

S4 清理回归（最后，独立 commit）
  1. 删 agent-panel.css:402-493（动手前重新 grep 复核零引用）；21 条注释统一口径。
  2. :341 独立一刀修，配 assistant-session-bodies 测试回防，不夹带在前面任何一刀。
  3. Bubble.to 与旧迁移处置按拍板结果执行。
  4. 全量回归：vitest（基线 96/46 需实跑复核）→ tsc --noEmit → build → :3001 三条冒烟路径。
```

红线复述：任何一刀不得绕过 `onApplyCreative` 三道门、不新增第二套落盘/wire schema、不引入新色系；Supabase 云端化按 D7 全程后置。

---

## 4. 汇总待核验清单（合并三份分文档，去重后按主题分组）

**G. 行号与 diff（全局，动工前必做）**
- G1 三份分文档全部 file:line 为审计快照，S1.0 仍在改写；每刀动手前重新 grep 定位。（A§8-2/3、B§6-1/8、C§7-7）
- G2 禁 git 约束下未核对工作树与主线程提交的对应 diff，待主线程自行 `git status/diff` 确认。（B§6-1）

**P. 产品/设计拍板项**
- P1 画廊「当前卡」在网格中保留弱化还是精简（A§8-4）。
- P2 新建拼贴卡「免命名」诉求是否立项 lib 变更（现名校验 `local-activities.ts:163` 强制非空）（A§8-6）。
- P3 红环任意回执即亮 vs returned 按 planKey 过滤，两套口径是否统一（B§6-7）。
- P4 生产 mark 的 `shareId=projectKey`（非 UUID）与 bingo-status 解析行为是否有意为之（B§6-5）。
- P5 `Bubble.to` 及旧 localStorage 迁移是否连迁移一起下线（C§7-4）。
- P6 画廊是否需要云端项目入口（D7 后置，本轮保持本机口径）（A§8-7）；brief 状态上卡是否值得改 lib 列表输出（A§8-5）。
- P7 画廊旧 props `currentStatus/isActivityVisible/onComplete` 无生产调用方，包装层是否保留（A§8-8）。

**T. 测试缺口（静态盘点结论，未运行）**
- T1 share-pins 的 80 条/40 plan 上限驱逐仅见 2 个测试槽，覆盖是否他处补足（B§6-2）。
- T2 未找到 workbench-agent.test.ts，口令识别函数无专门单测，待核验（B§6-3）。
- T3 「7 个 lib 套件」台账仅枚举 6 个，第 7 个构成与 96/96、46/46 基线待实跑核定（C§7-2/3）。
- T4 ProjectReviewPanel 除 openBusinessWorkspace 外的其他可达入口待核（B§6-4）。
- T5 各分文档列出的闭环测试缺口（发链接段、回流段、体检组件级、孤儿链迁移）见 s2 §4.1。

**E. 环境与冒烟**
- E1 node24 树内无 npm.cmd，S4 执行人确认 npm 来源；可直跑 vitest.cmd 兜底（C§7-1）。
- E2 核对 node24 满足 engines `>=24.15 <25 || >=26`（`package.json:62`）（C§7-6）。
- E3 裸 `/review` 与 `/review/[id]` 在 Cloudflare 重写下的实际到达行为需 :3001/部署冒烟，静态无法判定（B§6-6）。
- E4 门洞钮三意（台账 S4 列项）本轮未展开审计（C§7-5）。

**已在集成验收时关闭的旧待核验**
- ~~A§8-1：`room-organizer.tsx:217` 默认脸翻门~~ → 验收时实读已为 `'door'`；转为首屏冒烟项（见 §3 第 0 步）。

---

## 5. 集成验收记录（hub 独立抽查，非采信子代理自报）

- 产物清点：`docs/plans/ia-s1-prep-2026-11-04/` 下仅四份 md（含本索引），无越界文件。
- 哈希比对：审计窗口 frontend 仅 4 个 S1.0 预期文件变化、零新增，排除审计方写入污染。
- 承重结论抽查（全部通过）：
  - `LocalActivitiesPanel` 全仓引用仅测试 2 文件（grep 实证）；画廊网格 CSS `:20` 与封面区 `:22` 逐条属实。
  - 死 CSS 类名在全部 .ts/.tsx 零引用；`agent-panel.css:397-402` 存活/死亡边界与分文档一致，死块终于 `:493`。
  - 「总控」ts/tsx 12 条命中逐一查看均为注释；计数 21 与分文档一致。
  - 双评审路由 import 指向、`demoteLegacyMode`（`workbench-mode.ts:19-23`）、`issueReviewShare` 仅测试调用，均实证。
  - `say` 副作用块（`agent-panel.tsx:337-345`）、口令函数行号（`workbench-agent.ts:77-136` 共 9 个）、`reviewNow` 唯一口令入口（`:1295`）、BingoAuditCard 门控（`:1873`）、package.json scripts，逐条与分文档吻合。
- 边界合规：四份产物全部落在指定目录；未写 frontend、未访问 `frontend/public/ia-board` junction 与旧快照 `C:\幕景\Scendance2026`、未运行禁止命令。
