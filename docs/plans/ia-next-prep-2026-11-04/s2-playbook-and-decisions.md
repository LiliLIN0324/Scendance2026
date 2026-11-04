# S2「Bingo 转审校台」可执行任务书 + 待拍板决策简报（分片 B 第二刀）

- 日期：2026-11-04（S1.0 已完工后的工作树实读）
- 性质：只读前置审计产物——把上轮 `docs/plans/ia-s1-prep-2026-11-04/s2-review-audit.md` 的静态结论转成施工顺序与决策输入；**不替 owner 做产品决定**
- 证据口径：全部 file:line 为本轮实读复核（S1.0 后行号已按当前树重钉，上轮审计行号失效处就地注明）
- 关联：导演台账 `docs/plans/ia-role-rework-ledger-2026-11-04.md`（§4 S2 任务书、§6 Q3/Q4、§7 S1.0 完工记录）

---

## 速览

- **施工项 7 个**（T1–T7，编号即建议顺序）；**待拍板决策 5 个**：Q3 两案、reviewSlot 开门/封堵、双 ReviewSharePage 关系、UUID 孤儿链删留、红环口径（Q4 排期为接口形状注释级，不实现）。
- **最长依赖链一句话**：三钮（T1，体检按钮化）必须先于 composer 收窄（T2）落地，否则 `reviewNow()` 在 Bingo 脸唯一入口是口令（agent-panel.tsx:1295）、摘框即删功能；双页关系（T4）与孤儿链删留（T5）互相咬合，须同一刀决定。
- **本轮复核修正上轮两条结论**：① `workbench-agent.test.ts` 真实存在且已覆盖全部口令识别函数（上轮 §6-3「待核验」关闭）；② 体检组件级测试已有底子（agent-panel.react.test.tsx T-03 :188-258，经口令 `send('看看哪里有问题')` 驱动），缺的是「按钮直达」与三钮用例，不是从零补。

---

## 一、开门/封堵任务书（T1–T7）

> 通用约定：每项末尾「回滚点」指 git 粒度回退锚（本审计不执行 git，由执行人按切片 commit 粒度回退）。红线复述：不绕 `onApplyCreative` 三道门、不新增 wire schema、不引新依赖。

### T1 三钮化（体检 / 准备客户评审 / 导出评审包）——强制前置，先补测试

- **现状**：
  - `reviewNow()` 定义于 `agent-panel.tsx:481-501`，当前在 Bingo 脸的唯一入口是 send() layout 分支口令 `isReviewCommand`（`:1295`）。
  - `proposeExport()` 定义于 `:1196`；send() 内 `isExportCommand` 调用点 `:1255`（非 layout 分支）与 `:1303`（layout 分支）。
  - `callbacks.onOpenReview` 签名 `:196`，room-organizer 侧接线 `:1950` → `openBusinessWorkspace('review')`（`room-organizer.tsx:436-445`，只置 business 左栏 + reviewOpenRequest++，从不 setWorkbenchMode）。
  - BingoAuditCard 挂载点 `agent-panel.tsx:1873`（`{bingo && <BingoAuditCard/>}`）。
  - exportPreview 确认卡 `:1912-1919`（状态门控，非脸门控，复用即弹）。
- **改动形状**：
  1. 在 `:1873` 同一 `{bingo && ...}` 块内、BingoAuditCard **上方**新增一条三钮行（建议 class 复用 `.ap-chips` 既有样式，零新 CSS）：
     - 钮①「立即体检」onClick 直接调 `agent.reviewNow()`（该函数已在 agent value 上暴露，`:481` 闭包内）；
     - 钮②「准备客户评审」onClick 调 `agent.callbacks.onOpenReview()`（同 `:1899` 现有「打开客户评审」钮的接线形状，不新写回调）；
     - 钮③「导出评审包」onClick 调 `agent.previewExport()`（即 `proposeExport`，provider 已暴露于 `:1427`）→ 弹 `:1912` 确认卡，仍走「确认导出」才落交付，不跳级。
  2. **零新 state、零 props 变更**；气泡流 `Bubbles`（`:1872`）不动，体检回执照旧经气泡显示。
- **影响面**：仅 agent-panel.tsx 一个文件的 JSX 一个插入块。
- **配套测试**（先写，见 §四）：Bingo 脸渲染三钮；点「立即体检」不打字即出现「不是合规审查」回执（镜像 T-03 :189-216 的断言但走按钮）；点钮②调 `callbacks.onOpenReview`；点钮③出现 `#export-preview` 且只有「确认导出」触发 handoff（复用 :402-411 现有断言形状）。
- **回滚点**：单 commit 仅含三钮插入块 + 新测试。

### T2 composer 收窄到 activity + Bingo 残留布置语义清理

- **现状（本轮实读）**：
  - composer 整块门控 `agent-panel.tsx:1934` `{conversation && <> ... </>}`（`:1963` 收尾），含 form#composer `:1944-1962`、SuggestionGhost `:1952`、textarea#ap-input `:1953`（三态 placeholder：generating / review / delivery / 默认布置例句）。
  - `ghostVisible` `:1791` = `mode==='layout' && !draft.trim() && !generating`；`suggestion` `:1789` = `useSuggestion(AGENT_INPUT_SUGGESTIONS[activeAgent])`；bingo 组建议词仍为布置例句（`typed-suggestion.tsx:19`：「80 人发布会…」「按墨金发布配一套」「按奶油会客配一套」）。
  - ap-lead 空态 `:1857-1860` 门控 `mode==='layout' && bubbles.length===0 && state!=='generating'`——**无脸条件**，Bingo 脸空会话时也渲染「先说一句就行」布置话术。
  - recap 回显行 `:1868` 门控 `mode==='layout' && planShown`——同样无脸条件。
  - 会话头 `:1817-1852` 已 activity 化（历史/新开 `:1825-1845` 挂 activity），Bingo 脸仅剩头像/标题/关闭，不动。
- **改动形状**：
  1. `:1934` 门控 `conversation` → `activity`（bingo 不再渲染 form/Ghost/textarea）。**send() 一行不改**（`:1944` form submit、`:1956` Enter 分支照旧服务活动脸）。
  2. `:1857` ap-lead 门控补 `activity &&`，或改挂 `bingo &&` 的审校台空态文案（如「甲方钉评与回执在下面台账」——文案待 owner 定，审计只给位置）。
  3. `:1868` recap 行门控补 `activity &&`（planShown 本就由生成链驱动，补门控只防同 store 跨脸串显）。
  4. `typed-suggestion.tsx:19` bingo 组：composer 摘除后该键不再被渲染读取；若 T2 同期不留输入条，bingo 组可整行删除或改为审校话术占位（标注 S4 清类型时一并处理）。
  5. `:1953` placeholder 的 review/delivery 两分支：若 T3 走「开门」路径（workbenchMode 真能变 review），保留；走「封堵」路径则成死分支，标注即可，不本刀删。
- **影响面**：agent-panel.tsx 门控两行 + typed-suggestion.tsx 一组；**必须先过 T1**，否则体检断链。
- **配套测试**：翻写 `agent-panel.react.test.tsx:807-818`——该用例当前断言 Bingo 脸「共用输入框仍在」（`getByLabelText('告诉 Agent 要改的')`），T2 后断言反转为 null；活动脸输入框仍在（对照 :769-789 用例不反弹）。
- **回滚点**：门控一行可独立 revert。

### T3 reviewSlot 门处置（两路径择一，待拍板——见 §二·决策 D1）

**路径甲·开门**（让 review/delivery 重新可达，制作侧钉状态机上岗）：

- 现状锚：`workbench-mode.ts:19-23` `demoteLegacyMode`（review→`'open-share'` :20；delivery→`'open-checklist'` :21）；`room-organizer.tsx:363-374` `selectWorkbenchMode` 把 `open-share` 转成 `setShareOpenRequest++`（:366）、从不 setWorkbenchMode('review')。
- 改动形状：
  1. `workbench-mode.ts:19` 返回值联合类型加第三分支（如 `'enter-review'`），review 不再重定向到分享弹窗；
  2. `room-organizer.tsx:363-374` 对应分支改为 `setWorkbenchMode('review'); setWorkbenchModeSerial(+1);`，并补一个 Bingo 脸/左轨入口（现有左轨 `WORKBENCH_MODES` 仅 layout，`:10-12`）——入口位置属设计决定（建议挂 T1 三钮旁第四钮「进入画布钉评」，或复用 Business 面板）；
  3. 下游接线全部现成、**无需新码**：`agent-panel.tsx:1896` `{mode==='review' && reviewSlot}` 渲染 ReviewIssuesCard、`:1869` 评审 divider、`:1897-1903` 评审 chips 卡自然点亮；`room-organizer.tsx:1056/:1101` onReviewAnchor 传参、`:1436` openPinDraft 早退条件、`:2146` 评审提示行、`:2123` ReviewPinLayer 全部由 `workbenchMode==='review'` 门控自动激活；`mode-shell.tsx:19-75` ReviewIssuesCard 与 `:144` WorkbenchModeCard 门控原样复用。
- 收益：制作侧画布钉（reviewPins 内存态 :260、commitReviewPin :1430 区、reviewMarks :1471）从「接线在、门没开」变成真功能；与客户侧 share-pins 形成「制作钉+甲方钉」双轨。
- 代价：reviewPins 仍无持久化（`bingo-feedback.ts` 不读它），开了门也只是内存工作态，要入审计卡需另补读端（超出 S2，记 S3+）。

**路径乙·封堵**（继续封门，评审只走分享链接，死接线随刀删除）：

- 现状锚：reviewSlot 链全部门控 `workbenchMode==='review'`，而该状态恒为 'layout'（demote 收编），即全链生产零渲染。
- 改动形状：
  1. `agent-panel.tsx`：删 reviewSlot prop（`:1756` 声明）、`:1896` 挂载、`:1897-1903` 评审 chips 卡、`:1869` 评审 divider、`:1870` delivery divider 对照处置；
  2. `room-organizer.tsx`：删 `:2017-2027` reviewSlot 传参与 `:2027-2028` deliverySlot 传参、`:1056/:1101` onReviewAnchor、`:1436` 早退、`:1471` reviewMarks、`:260` reviewPins 状态机及 commit/focus 配套（`:1447` 起一区）、`:2146` 提示行；
  3. `mode-shell.tsx`：ReviewIssuesCard（:19-75）与 DeliveryChecklistShell（:77-97）整组件删除或随 prop 一起瘦化；
  4. **保留**：`lib/review-pins.ts` 状态机本体——`share-pins.ts:8-14` 与富钉页 `review-plan-sheet.tsx` 复用它，不能删；`lib/layout-review.ts` 体检引擎独立，不动。
- 收益：死代码清零，agent-panel 门控语义与「评审走分享链接」的 D 系列定位一致。
- 代价：制作侧画布钉交互永久放弃（若 owner 认为「制作者先在自己画布钉一轮再发给客户」是真需求，此路径即砍功能）。

- **影响面**：路径甲 2 文件小改；路径乙 3 文件中等删减。**配套测试**：路径甲补「selectWorkbenchMode('review') 后 reviewSlot 渲染 + onReviewAnchor 接通」组件用例；路径乙删 review-pins 依赖组件的相关桩（review-pins.test.ts :27-67 保留，测的是 lib）。
- **回滚点**：门控改动与删除分别独立 commit，可单回。

### T4 双 ReviewSharePage 目标关系（待拍板——见 §二·决策 D3）

- **现状（本轮实读）**：
  - 裸 `/review`：`app/review/page.tsx:1` import `@/components/review-share-page/review-share-page`（富钉页，活，hash/local/sample 三来源）；
  - `/review/[id]`：`app/review/[id]/review-link-client.tsx:5` import `@/components/room-organizer/panels/review-share-page`（评论式只读页，孤儿，读 UUID 快照）。
- **三案改动形状**：
  - **甲·合并**（推荐方向由审计给，非定论）：删 `app/review/[id]/` 路由目录与 panels 版组件，富钉页支持 pathname 带 id 时按 id 读快照（load-plan.ts 加 id 分支）；文件移动 = `review-link-client.tsx` 废弃、panels/review-share-page.tsx 废弃；
  - **乙·只留富钉页**：同甲删除范围，id 路由 301 到裸 `/review`（Cloudflare 重写层处理，待冒烟 E3）；
  - **丙·双留分工**：裸 `/review` 钉评富页（甲方现场用），`/review/[id]` 留作「发布后只读存档页」——但需先解决快照无人写入问题（见 T5），否则维持死页。
- **影响面**：路由 1–2 个目录 + 组件 1 个；与 T5 强耦合。
- **回滚点**：路由目录删除可 git revert 整体恢复。

### T5 UUID 孤儿链删留（待拍板——与 T4 同刀）

- **现状（本轮实读）**：`issueReviewShare` `review-share.ts:119` 生产零调用方；全仓 grep 仅命中：`review-share.test.ts:37/:55`、`share-menu.react.test.tsx:131`、`bingo-feedback.test.ts:6/:98`。快照键 `SHARE_PREFIX` :20、评论键 `COMMENT_PREFIX` :21、`addReviewComment` :177、`listReviewComments` :164、`readReviewShare` :158。
- **删除路线工作项**：
  1. 删 `issueReviewShare` / `readReviewShare` / `listReviewComments` / `addReviewComment` 及 `SHARE_PREFIX`/`COMMENT_PREFIX`；保留 `MARK_KEY`（:22，rememberReviewLinkMark :200-227 是活链 A 在写）；
  2. 同步处置测试：`review-share.test.ts` 两个 it（:36/:54）整文件删；`share-menu.react.test.tsx:129-152` describe 删（连带 :4 的 import）；`bingo-feedback.test.ts:6/:98` 的 uuid demo 用例改写或删（该用例喂的是 `threadFromShareComments` 回退分支，`bingo-feedback.ts:118/:150` 连带删）；
  3. `bingo-status.ts:145` `SHARE_ID.test(shareId) ? reviewPlanHref(shareId) : '/review/'` 的 UUID 分支标注为遗留兼容。
- **保留收口路线工作项**：
  1. `review-share.ts:18` `REVIEW_SHARE_STORAGE='local-demo'` 文件头注释升级为「冻结：生产无入口，仅测试与云化预留接口读取，禁止新增调用方」；
  2. 组件/函数全量加 `@deprecated local-demo frozen` 注释；不删测试，作为 T7 Q4 接口形状的 local-demo 实现演示保留。
- **回滚点**：删除路线按「lib 函数 / 测试 / 回退分支」三个 commit 拆。

### T6 红环口径统一（待拍板——见 §二·决策 D2）

- **现状（本轮实读）**：`review-return.ts:54-56` `reviewOrbShouldTurnRed(record) = record !== null`（任意回执即红，含 sample demo 回执，`:8-9` 注释自承「球也不按 planKey 过滤」）；`bingo-status.ts:148/:156` `returned: receiptKeys.has(receipt.planKey)`（按 planKey 对齐）。两口径并存 = AgentReopenCard 红环与 BingoAuditCard 「已回执」徽标可能对同一状态显示不一致。
- **改动形状**见 §二·D2 两选项。
- **回滚点**：纯函数签名级改动，单 commit。

### T7 Q4 Supabase 接口形状预留（仅注释/类型，不实现）

- **改动形状**：见 §三。只加 `interface` 声明与文件头注释，零实现体、零新依赖。
- **回滚点**：注释级，随时 revert。

---

## 二、决策简报（一律待 owner 拍板；审计推荐仅为输入）

### D1 Q3：Bingo 脸自由输入条去留（方案 A vs B）

> 注：台账 §6 已记「Q3【已决定 2026-11-04】纯状态台+三钮」；本简报按任务要求重列两案损益供复核，最终以 owner 本轮拍板为准。上轮审计推荐 **A**（s2-review-audit.md §3.4）。

| 口令/动作（本轮复核行号） | 现状唯一入口 | 方案 A 纯状态台+三钮 | 方案 B 保留精简输入条（bingo 白名单两口令） |
|---|---|---|---|
| 体检 `reviewNow`（agent-panel.tsx:481，send 调用点 :1295） | **是**（仅口令） | 钮①「立即体检」直达（T1） | 白名单放行 `isReviewCommand`（workbench-agent.ts:99-103） |
| 准备客户评审 `onOpenReview`（:196，调用点 :1251/:1298） | 否（Business 面板 / 分享菜单另有入口） | 钮②直达；口令路径断 | 白名单放行 `isClientReviewCommand`（:106-110） |
| 导出交接 `proposeExport`（:1196，调用点 :1255/:1303） | 否（分享菜单 onExportHandoff :2188 另有入口） | 钮③直达；口令路径断 | 白名单放行 `isExportCommand`（:127-131） |
| replyMaterialList / replyDraft / replyZone（:1256/:1293/:1294 区） | 是 | **断**（本就非审校职责，断是好事） | 断（白名单不放行） |
| 生成链 `isGenerateCommand`（workbench-agent.ts:83-88，send :1304 区） | Bingo 脸打字仍可触发 | **根治**（无输入框，物理断链） | **不根治**：须在 send() bingo 分支逐口令拦截，漏拦即走生成链 |
| 改动量 | 三钮插入（T1）+ composer 门控一行（T2） | send() 加 bingo 脸白名单分支 + placeholder（:1953）+ bingo 建议词（typed-suggestion.tsx:19）换审校话术 |
| 误触生成链风险 | 零 | 持续存在（拦截面长期维护） |
| 与 D3 定位（Bingo 不做布置生成，对标 Figma/Frame.io 状态台） | 完全契合 | 留自由文本，易被重新塞回生成，违背 D3 |

**共同前置（两案都躲不掉）**：体检按钮化——T1 的钮①是 A 的三钮之一，也是 B 方案下体检口令的兜底入口；顺序上 T1 先于一切。

### D2 红环 vs returned 徽标口径

- **选项 R1 向红环看齐**（任意回执即「已回执」）：删 `bingo-status.ts:148` 的 planKey 对齐，`returned` 直读回执存在性。改动小，但跨 plan 串显（A 活动的回执会让 B 活动徽标亮），与「同 planKey」的数据模型背离。
- **选项 R2 向 planKey 看齐**（推荐方向）：`review-return.ts:54` `reviewOrbShouldTurnRed(record, currentPlanKey)` 加参，调用方 AgentReopenCard（:1974 区，bingoHeaderStatus）传当前 planKey；红环语义与徽标统一为「本方案收到回执」。改动点：review-return.ts 函数签名 + 测试（review-return.test.ts :23/:36）+ AgentReopenCard 取当前 planKey 一处。
- 另注：demo 样本回执（`sample:initial`）当前也亮红环，R2 下应顺带过滤——是否计入本刀待拍板。

### D3 双 ReviewSharePage 关系（见 T4 三案）

待拍板：合并 / 只留富钉页 / 双留分工。审计提示：丙案「双留」必须先回答 `/review/[id]` 的快照谁来写（当前生产零写入方），否则就是把死页合法化为产品决策。

### D4 UUID 孤儿链删留（见 T5 两路线）

待拍板：删除（连带 3 测试文件处置）vs 冻结保留（加 deprecated 注释，留作 Q4 接口的 local-demo 演示实现）。与 D3 强耦合：若 D3 选合并/只留富钉页，D4 自然走删除路线。

### D5 Q4 排期窗口（仅定形状，见 §三）

待拍板：S2 是否连「接口形状注释」一起留（审计建议：留，零成本；不实现），还是等 Q4 排期定了再补。

---

## 三、Q4 Supabase 接口形状（建议签名，命名为建议非定论，不写实现体）

> 原则：现有 localStorage 函数原样保留为 local-demo 实现，接口先行；云化时替换实现，调用方签名不动。

| 预留位置（本轮实读行号） | 建议接口/签名 | 现有 local-demo 适配方式 |
|---|---|---|
| `share-pins.ts:16`（REVIEW_SHARE_PIN_STORAGE_KEY :16、80/plan :17、40 plan :18） | `interface ReviewPinRepository { list(planKey: string): Promise<ReviewPin[]>; append(planKey: string, draft: ReviewPinDraft): Promise<AppendReviewSharePinResult> }` | 现有 `appendReviewSharePin`/`readReviewSharePins` 包一层 async 即成 LocalReviewPinRepository；byPlan 即天然 planKey 分区表键 |
| `review-return.ts:12`（REVIEW_RETURN_STORAGE_KEY :12、mark :19、read :36） | `interface ReviewReturnRepository { mark(planKey: string): Promise<{ok:true}>; read(planKey: string): Promise<ReviewReturn \| null> }` | 现存储为单条记录，云化按 planKey 关联；注意 R2 拍板后 read 本就按 planKey 取，形状顺势对齐 |
| `review-share.ts:20-22`（SHARE_PREFIX/COMMENT_PREFIX/MARK_KEY） | `interface ReviewShareRepository { issue(layout, origin): Promise<{snapshot,url}>; comments(shareId): Promise<ReviewComment[]>; addComment(shareId, input): Promise<ReviewComment> }`；`interface BingoMarkRepository { remember(mark): Promise<void>; list(): Promise<BingoMark[]> }` | issueReviewShare/readReviewShare/listReviewComments/addReviewComment（:119/:158/:164/:177）与 rememberReviewLinkMark（:200-227）整体包 async；D4 若选冻结路线，此接口即冻结函数的云化替身注释位 |
| `load-plan.ts`（planKey 命名空间 `link:`/`local:`/`sample:`，上轮审计 :59/:70 一带） | 不加接口，文件头注释「planKey 即云端分区键，云化时保留命名空间前缀」 | 现有三来源解析不动 |
| `bingo-feedback.ts:46/:56`（readBingoPlanFeedback 多 key 并集去重） | 不改接口形状；注释「去重键 `${key}:${pin.id}`（:63）即未来跨表 join 键」 | 读端聚合 local repo，云化时换 repo 不换聚合逻辑 |

---

## 四、测试计划（先补测试再改代码，顺序写死）

### 4.1 本轮复核修正（相对上轮 §4）

- `workbench-agent.test.ts` **真实存在**：已覆盖 isClientReviewCommand（:207-213）、isExportCommand（:188-194）、isMaterialListCommand（:177-186）、isReviewCommand（:197-204）——上轮「口令函数无专门单测」缺口关闭，不补。
- 体检组件级测试**已有底子**：`agent-panel.react.test.tsx` T-03（:188-258）经 `send('看看哪里有问题')` 驱动 reviewNow→修复预览→三道门→撤回/确认全链。缺的是「不经打字、按钮直达」的镜像用例。

### 4.2 新增/翻写用例（落点文件 + 断言要点）

| 时机 | 落点文件 | 用例形状 | 断言要点 |
|---|---|---|---|
| T1 前（先写） | `agent-panel.react.test.tsx` 新增 describe「S2 Bingo 审校台」 | Bingo 脸渲染三钮 | 三钮各可点；点「立即体检」**不打字**即出现「不是合规审查」（镜像 T-03 :194）；点「准备客户评审」断言 `callbacks.onOpenReview` 调用；点「导出评审包」出现 `#export-preview`（:1912）且只有「确认导出」触发 handoff（复用 :402-411 断言形状） |
| T2 前（先写） | 同文件翻写 `:807-818` | Bingo 脸 composer 摘除 | `activeAgent="bingo"` 下 `queryByLabelText('告诉 Agent 要改的')` 为 null；`activeAgent="door"` 下输入框仍在（对照 :769-789）；Bingo 脸不再渲染 ap-lead「先说一句就行」（:1857） |
| T6 后（R2 路线） | `review-share-page/review-return.test.ts`（现 :23/:36 两 it） | planKey 过滤 | 回执 planKey ≠ 当前 planKey 时红环为 false；相等时为 true；坏回执/配额失败降级沿用现断言 |
| T3 路径甲 | `agent-panel.react.test.tsx` 新增 | selectWorkbenchMode('review') 后 reviewSlot 渲染 ReviewIssuesCard、onReviewAnchor 接通 | 未打开时与现状一致（恒 layout） |
| T5 删除路线 | 删 `review-share.test.ts` 整文件（:36/:54 两 it）；删 `share-menu.react.test.tsx:129-152` describe；改写 `bingo-feedback.test.ts:6/:98` | 见 T5 工作项 |

### 4.3 保持不动的现有资产

`bingo-status.test.ts`（returned 徽标 planKey 匹配 :102-110）、`review-pins.test.ts`（:27/:37/:52/:67，lib 仍被 share-pins 复用）、`layout-review.test.ts`（引擎最厚）、`review-copy.test.ts`、`review-share-page.react.test.tsx`（:61/:85/:99 活链 A 组件覆盖）、`comments.test.ts`/`share-pins.test.ts`/`load-plan.test.ts`。

---

## 五、待核验清单

1. **ui() 测试 helper 默认脸**：`agent-panel.react.test.tsx` 顶部 `ui()` 渲染器传入的 activeAgent 默认值未本轮精读，新增三钮用例前须确认其默认脸为活动 door，避免 Bingo 用例被活动脸干扰。
2. **AgentReopenCard/bingoHeaderStatus 精确行**：红环取当前 planKey 的调用点本轮仅定位到组件起 :1974，`bingoHeaderStatus` 定义体内未逐行核（上轮记 :1984-1995 区），T6 动工前重新 grep。
3. **share-pins 80 条/40 plan 驱逐**：仍仅 `share-pins.test.ts:21/:30` 两槽（上轮 T1），本轮未补——删除路线若动 share-pins 须先补驱逐用例。
4. **`/review/[id]/page.tsx` generateStaticParams**（上轮记 :5 id='local'）本轮未复读，T4 动路由前核。
5. **Cloudflare 重写**下裸 `/review` 与 `/review/[id]` 实际到达行为（E3）：静态无法判定，留 :3001/部署冒烟。
6. **bingo-status parsePlan 对生产 mark（shareId=projectKey 非 UUID）的保留行为**（上轮 P4）：本轮复核 :134-158 仍按 shareId 非空即收，该行为是否有意为之待 owner 确认（上轮 P4 延续）。
7. **T3 路径甲的入口位置**：`WORKBENCH_MODES`（workbench-mode.ts:10-12）现仅 layout，开门后「谁来调 selectWorkbenchMode('review')」无现成控件，属设计输入，施工前定。

---

## 六、边界合规自检

- 只读操作：全程 Read/Grep/Glob/PowerShell 只读查询；未写 frontend 任何文件，未跑 git / dev server / npm / vitest / build / tsc。
- 未访问 `frontend/public/ia-board`，未访问旧快照 `C:\幕景\Scendance2026`。
- 产物仅本文件：`docs/plans/ia-next-prep-2026-11-04/s2-playbook-and-decisions.md`；未写 index.md、s3-entry-audit.md、s4-execution-pack.md。
- 所有决策项（D1 Q3 两案、D2 红环口径、D3 双页关系、D4 孤儿链删留、D5 Q4 排期）均标「待 owner 拍板」；审计推荐意见均注明「上轮审计推荐/审计提示」，不冒充定论。
- 行号全部本轮实读复核；上轮审计行号失效处（如 bingo a100、workbench-agent.test.ts 存在性）已就地修正；无法判定项入第五节待核验，未编造。
