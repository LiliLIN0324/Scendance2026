# S2「Bingo 转审校台」静态链路审计（分片 B）

- 审计日期：2026-11-04
- 审计基线：工作树实读（本审计执行时主线程 S1.0 已部分落地，非台账基线 a87c156 的纯改造前快照；凡与台账行号不一致处均就地注明漂移）
- 口径：只读静态审计，未跑 vitest / build / dev server；所有 file:line 相对仓库根 `C:\mujing\Scendance2026`
- 关联台账：`docs/plans/ia-role-rework-ledger-2026-11-04.md`（S2 任务书第 4 节、Q3 第 6 节）
- 关联灵感板：`docs/research/ia-2026-11-04/review-bingo-canvas-annotation-2026-11-04.md`

---

## 0. 速览结论

**链路通断（一句话）**：真正活着的客户评审闭环只有一条——分享菜单发 `#layout=` hash 链接 → 裸 `/review` 页落钉（localStorage `scendance-review-share-pins-v1`）→ 客户点「完成评审」写回执 → BingoAuditCard 按 `link:fnv1a(hash)` planKey 对齐读出钉数与回执；而 `/review/<uuid>` 评论页、`issueReviewShare` UUID 快照、旧侧栏评论、制作者侧画布钉状态机（reviewPins / ReviewIssuesCard / reviewSlot）都是代码在仓、生产无入口的「同场并存」，尚未接通。

**Q3 推荐（一句话）**：推荐「纯状态台 + 按钮组」而非精简输入条——因为当前体检（`reviewNow`）在 Bingo 脸上**唯一入口就是自由口令**（agent-panel.tsx:1295），摘 composer 前必须先把它按钮化；同时把「准备客户评审」「导出评审包」两个口令各落一个按钮，Bingo 脸不再保留任何自由文本输入。

---

## 1. 任务一：审校闭环全链路静态串审

### 1.1 文件清单与职责

| 文件（相对仓库根） | 职责 | 关键符号 file:line |
| --- | --- | --- |
| `frontend/app/review/page.tsx` | **裸 `/review` 路由（无 id）**：挂画内落钉富页 | `:1` import `@/components/review-share-page/review-share-page` |
| `frontend/app/review/[id]/page.tsx` | `/review/<id>` 路由：挂评论式只读页 | `:5` generateStaticParams id='local' |
| `frontend/app/review/[id]/review-link-client.tsx` | `/review/[id]` 客户端壳：从路径取 id、fallback 'local' | `:5` import `@/components/room-organizer/panels/review-share-page`；`:7-15` shareIdFromPath |
| `frontend/components/review-share-page/review-share-page.tsx` | **富钉页（活）**：hash/本机/示例三来源取 plan，画内落钉 + 完成评审写回执 | `load-plan.ts` 取 plan；`appendReviewSharePin/readReviewSharePins` 写钉；`markReviewReturned` 写回执 |
| `frontend/components/room-organizer/panels/review-share-page.tsx` | **评论式只读页（孤儿）**：读 UUID 快照 + 根评论线程，SVG 平面 | 仅被 `/review/[id]` 路由（review-link-client.tsx:5）与 share-menu.react.test.tsx:6 引用 |
| `frontend/components/review-share-page/load-plan.ts` | plan 来源解析：hash→`link:fnv1a(hash)`；本机→`local:id`/`local:fnv1a(指纹)`；demo→`sample:initial` | `REVIEW_SHARE_PATH='/review/'` :16；`reviewPlanKeyForClientUrl` :59；`readLocalReviewLayout`（键 `scendance-editor-local-v1`） :70 附近 |
| `frontend/components/review-share-page/share-pins.ts` | 客户端画内钉持久化：每 plan 80 条、40 份 plan 滚动 | `REVIEW_SHARE_PIN_STORAGE_KEY='scendance-review-share-pins-v1'` :16 |
| `frontend/components/review-share-page/review-return.ts` | 回执（完成评审）写入与「红环」判定 | `REVIEW_RETURN_STORAGE_KEY='scendance-review-share-return-v1'` :12；`reviewOrbShouldTurnRed` :54-55（**任意回执存在即红，不按 planKey 过滤**） |
| `frontend/components/review-share-page/review-plan-sheet.tsx` | 富钉页的平面画布组件：点物件/地面定锚、钉草稿浮层；复用制作者侧 `ReviewPinLayer` | 组件 props :27-49；`:22` import `ReviewPinLayer`、`:23` 引其 css |
| `frontend/components/review-share-page/comments.ts` | **旧侧栏评论存储（写端生产零调用）**：每 plan 80 条、单层回复 | `REVIEW_COMMENT_STORAGE_KEY='scendance-review-share-comments-v1'` :10；`readReviewComments` :53；`appendReviewComment` :69 |
| `frontend/components/room-organizer/lib/review-share.ts` | UUID 快照 + 根评论 + BingoMark 写入（local-demo 口径） | `REVIEW_SHARE_STORAGE='local-demo'` :18；`SHARE_PREFIX='scendance.reviewShare.v1.'` :20；`COMMENT_PREFIX='scendance.reviewComments.v1.'` :21；`MARK_KEY='scendance.reviewMark.v1'` :22；`MAX_MARKS=40`/`MAX_ITEMS=240`/`MAX_COMMENTS=80` :23-25；`issueReviewShare` :119；`reviewMarkFor` :142；`readReviewMarks` :147；`readReviewShare` :158；`listReviewComments` :164（线程过滤 :172 附近）；`addReviewComment` :177（满 80 抛错 :182；只允许回复根 :191 附近）；`rememberReviewLinkMark` :200-227 |
| `frontend/components/room-organizer/lib/bingo-feedback.ts` | 甲方反馈读端：优先 share-pins，回落旧评论；多 key 并集去重 | `reviewPlanKeysForBingoPlan` :46；`readBingoPlanFeedback` :56（去重键 `${key}:${pin.id}` :63）；`sharePinCount=primary.length` :70；回落 legacy :77-83；`feedbackSummaryLabel` :87-92；`mapSharePin` :98（author 硬编码「甲方钉评」）；`threadFromShareComments` :150（仅当 `isReviewShareId(plan.shareId)` :118）；`threadFromPageComments` :133 |
| `frontend/components/room-organizer/lib/bingo-status.ts` | 制作者侧 Bingo 台账读端：Marks + 回执 → phase/returned | `BINGO_MARK_KEY` :14；`BINGO_RETURN_KEY` :15；`BingoPlan` :25（`returned` :34）；`reviewReceiptHref` :66（UUID→`/review/<id>`，否则 `/review/`）；`readBingoSnapshot` :101；`receiptKeys=new Set([projectKey,shareId,reviewPlanKey])` :148；`returned: receipt!==null && receiptKeys.has(receipt.planKey)` :156 |
| `frontend/components/room-organizer/panels/bingo-audit-card.tsx` | Bingo 脸上的「甲方评审」只读卡：每 plan 一行 + 钉数徽标 + 回执徽标 | `BingoAuditCard` :25；空态 null :45；每 plan `readBingoPlanFeedback(plan)` :64；pinCount 徽标 :84 附近；storage/focus 监听 :32-43（行号以实读为准，台账记 :22-25 已漂移） |
| `frontend/components/room-organizer/lib/review-pins.ts` | 制作者侧画布钉状态机：open/resolved、筛选、相机飞行 | `REVIEW_PIN_TEXT_MAX=80` :6；`ReviewPinStatus` :8；`ReviewPinFilter` :9；`ReviewPin` :16（`status` :27）；`createReviewPin` :49；`pinAnchor` :73；`flyDestination` :88；`lerpReviewCamera` :108；`markPinResolved` :118；`pinsForFilter` :122；`countOpenPins` :126；`pinSubject` :130；`planPointToCanvas` :136；`placeComposer` :148 |
| `frontend/components/room-organizer/panels/review-pin-layer.tsx` | 钉层渲染：画布上标记 + 钉草稿表单（同时被制作者侧与富钉页复用） | pins.length===0 && !draft 时 return null（行号以实读为准） |
| `frontend/components/room-organizer/panels/mode-shell.tsx` | 评审/交付槽壳：`ReviewIssuesCard` :19-75（用 `countOpenPins` :40、`pinsForFilter` :41）；`DeliveryChecklistShell` :77-97；`WorkbenchModeCard` :119-159（review 门控 :144、delivery :157） |
| `frontend/components/room-organizer/lib/workbench-mode.ts` | 工作台模式收编：`WorkbenchMode` :2；`WORKBENCH_MODES` 仅 'layout' :10-12；`demoteLegacyMode` :19-23（review→open-share、delivery→open-checklist） |
| `frontend/components/room-organizer/room-organizer.tsx` | 主编排：发链接、开业务评审、钉提交、AgentPanel 挂载 | `issueReviewLink` :375-390（`encodeShareUrl`+`reviewShareHref`+`rememberReviewLinkMark`，`:382` 写 mark、`:385` shareId=projectKey）；`openBusinessWorkspace('review')` :436-445（只置 `leftMode='business'`+`reviewOpenRequest++`，**从不 setWorkbenchMode('review')**）；钉提交 :1430-1470 区；`reviewPins` 状态 :260 附近；`ReviewPinLayer` 挂载 :2123-2134（`onReviewAnchor` 仅 `workbenchMode==='review'` 时传入 :1055-1056/:1100-1101）；评审提示行 :2146（`workbenchMode==='review' && !pinDraft` 才显示）；AgentPanel 挂载 :2017-2040 区（`reviewSlot` 仅 `workbenchMode==='review'` :2017 附近） |
| `frontend/components/room-organizer/lib/layout-review.ts` | 体检引擎：6 类 issue / 6 类 fix | `ReviewIssueKind`（overlap/bounds/structure/seat-clearance/table-gap/entrance） :26；`ReviewFixKind` :27；`ReviewIssue` :36-43；`ReviewReport` :45-52；`ReviewFixResult` :60-68；`reviewLayout` :240-356；`proposeReviewFix` :583-587 |

### 1.2 两个同名 ReviewSharePage 的判定证据

**结论：两个路由都是活的，挂的是两个不同实现。**

- `/review/[id]/page.tsx`（app/review/[id]/page.tsx:5）→ `review-link-client.tsx:5` import **`@/components/room-organizer/panels/review-share-page`** → 评论式只读页（UUID 快照 + 根评论）。
- `/review`（裸）（app/review/page.tsx:1）import **`@/components/review-share-page/review-share-page`** → 画内落钉富页（hash/本机/示例）。

**另一个为何还在（证据）**：`issueReviewShare`（lib/review-share.ts:119）在全仓**无生产调用方**——grep 仅命中测试（bingo-feedback.test.ts:98、share-menu.react.test.tsx:131、review-share.test.ts:37）。生产「发评审链接」走的是 `issueReviewLink`（room-organizer.tsx:375）→ hash 链接，写的 mark 带 `reviewPlanKey='link:fnv1a(hash)'`。因此 `/review/<uuid>` 路由读的 `scendance.reviewShare.v1.<uuid>` 快照在生产里**无人写入**，该路由对生产用户实际不可达（除 Cloudflare 重写兜底 'local' 之外）。它还在的原因是：测试仍在直调 `issueReviewShare` 覆盖它（share-menu.react.test.tsx:129-152），属于「测试在测、生产不用」的孤儿链。

### 1.3 端到端链路图（活链 + 断链）

```
【活链 A：hash 钉评闭环（真接通）】
制作者：分享菜单「发评审链接」(share-menu.tsx:248)
  → issueReviewLink (room-organizer.tsx:375-390)
  → URL = /review/#layout=<deflate+base64url>（encodeShareUrl）
  → rememberReviewLinkMark 写 localStorage:
      'scendance.reviewMark.v1' (review-share.ts:227)
      { projectKey=本地 id, shareId=projectKey, reviewPlanKey='link:fnv1a(hash)', clientHref=hash URL }
        ↓ 同一浏览器
客户：打开 /review/#layout=... (app/review/page.tsx)
  → loadReviewPlan 解 hash (load-plan.ts)，planKey='link:fnv1a(hash)'
  → 落钉 appendReviewSharePin → 'scendance-review-share-pins-v1' [by planKey]
  → 「完成评审」→ markReviewReturned → 'scendance-review-share-return-v1' { planKey:'link:fnv1a(hash)' }
        ↓ 同一浏览器（audit 卡轮询 storage 事件 + focus）
制作者侧：BingoAuditCard (bingo-audit-card.tsx:25)
  → readBingoSnapshot (bingo-status.ts:101)：receiptKeys={projectKey,shareId,reviewPlanKey} (:148)
      → returned 判定 :156  ★ planKey 与 mark.reviewPlanKey 对齐 → 真接通
  → readBingoPlanFeedback (bingo-feedback.ts:56)：按 {reviewPlanKey,projectKey,shareId,clientHref 推导 key}
      读 share-pins (:63 去重) → pinCount 徽标 (:70)  ★ 真接通
```

```
【断链 B：UUID 评论闭环（孤儿）】
issueReviewShare (review-share.ts:119) 写 'scendance.reviewShare.v1.<uuid>'
  → 仅测试调用；生产无入口
/app/review/[id]/review-link-client.tsx:5 挂评论页 → 读不到任何生产快照
addReviewComment (review-share.ts:177) 写 'scendance.reviewComments.v1.<uuid>' → 生产无调用方
结论：整条 UUID 链（快照+根评论）只有测试在跑，是历史形态。
```

```
【断链 C：制作者侧画布钉状态机（同场并存）】
workbenchMode 状态 (room-organizer.tsx:338 附近)：
  selectWorkbenchMode('review'|'delivery') → demoteLegacyMode (workbench-mode.ts:19-23)
  → 永远返回 'layout'；review/delivery 从不落位
后果：
  · reviewSlot (agent-panel.tsx:1896 `{mode==='review' && reviewSlot}`) 永不渲染
  · ReviewIssuesCard (mode-shell.tsx:19) 永不出现
  · onReviewAnchor 不传 (room-organizer.tsx:1055-1056/1100-1101)
  · openPinDraftRef 早退 (:1436 附近)、评审提示行 (:2146) 永不显示
  · reviewPins (room-organizer.tsx:260) 仅内存态，无持久化、不被 bingo-feedback 读
结论：钉状态机代码完整（review-pins.ts 全 + 4 测试），但入口被 demoteLegacyMode 收编，
      当前是「接线在、门没开」。S2 决定 Bingo 脸进入路径时，这是要打开的门。
```

### 1.4 锚点映射真值表（哪些对齐是真接通）

| 锚点映射 | 持久化 key | 写方 | 读方 | 判定 |
| --- | --- | --- | --- | --- |
| 客户落钉 ↔ 审计卡 pinCount | `scendance-review-share-pins-v1`（by `link:fnv1a(hash)`） | 富钉页 `appendReviewSharePin` | `bingo-feedback.ts:56-70` | **真接通**（同一浏览器 local-demo 口径） |
| 客户回执 ↔ 审计卡 returned 徽标 | `scendance-review-share-return-v1` | 富钉页「完成评审」 | `bingo-status.ts:148-156` | **真接通**（planKey 对齐） |
| 回执 ↔ 制作者侧 AgentReopenCard 红环 | 同上 | 同上 | `reviewOrbShouldTurnRed` (review-return.ts:54-55) | **部分接通**：红环不按 planKey 过滤，任意回执（含 `sample:initial` demo）都亮——与 returned 徽标口径不一致 |
| 旧侧栏评论 ↔ 审计卡 legacyCount | `scendance-review-share-comments-v1` | **生产无写方** | `bingo-feedback.ts:133/150` | 仅靠测试喂数；`threadFromShareComments` 还要求 `shareId` 是 UUID（:118），而生产 mark 的 shareId=projectKey（room-organizer.tsx:385）→ 该分支生产永不触发 |
| 制作者侧 reviewPins ↔ 审计卡 | 无持久化（内存） | `commitReviewPin` (room-organizer.tsx:1430 区) | 无 | **未接通**：bingo-feedback 只读 share-pins/旧评论，不读制作者侧钉 |
| UUID 快照 ↔ `/review/<id>` 评论页 | `scendance.reviewShare.v1.<uuid>` | **生产无写方** | 评论页 | **断**（见 1.3-B） |
| 评论线程 parentId（只回复根，80 条上限） | `scendance.reviewComments.v1.<uuid>` | 仅评论页（孤儿路由） | `listReviewComments` :164 | 代码自洽但生产无流量 |

---

## 2. 任务二：agent-panel.tsx 内 Bingo 脸 JSX 清单

> 说明：工作树实读行号与台账基线（a87c156）已漂移——S1.0 已把生成 chrome 从 `bingo &&` 重挂到 `activity &&`（PlanHome 现挂 activity，agent-panel.tsx:1861），默认脸已为 `door`（:1753 `activeAgent = 'door'`），AGENT_META 中 door 已改名「活动」（:1747）。下表按**当前工作树**实读行号登记；台账基线行号一律待 S1.0 落地后复核。

会话判定（agent-panel.tsx）：
- `bingo = activeAgent === 'bingo'`（:1799 附近）
- `activity = activeAgent === 'door'`（:1801 附近）
- `conversation = bingo || activity`（:1803 附近）——composer 与会话头按 conversation 渲染，Bingo 与活动共用同一套气泡/输入条

### 2.1 S2 应保留（Bingo 脸审校态）

| 块名 | 起止行号（实读） | 当前门控 | 保留理由 |
| --- | --- | --- | --- |
| `BingoAuditCard` 挂载 | `:1873` `{bingo && <BingoAuditCard/>}` | 仅 bingo | 甲方评审只读台账，S2 核心面板（定义见 bingo-audit-card.tsx:25） |
| `Bubbles` 气泡流 | 挂载 `:1872`；定义 `:1682-1690` | `conversation` | 体检回执、口令回执、导出预览确认都靠气泡流显示；Bingo 与活动共用 |
| 会话头（头像/标题/关闭） | `:1817-1852`（关闭钮 :1846-1850） | `conversation` | 脸身份与收口；其中会话历史/新开会话钮已挂 activity（:1825 区），Bingo 脸当前不渲染 |
| 体检结果链（reviewNow 回执 + applyReviewFix 预览） | `reviewNow` 定义 `:481-501`；`proposeReviewFix` 调用 `:511/:515`；修复按钮经气泡 action | 由 send() 口令触发（:1295） | 体检是 Bingo 核心能力；S2 须把入口按钮化（见任务三） |
| 导出预览卡 `exportPreview` | 挂载 `:1912-1919` | `state.exportPreview`（非脸门控） | 「导出评审包」口令的落点卡；确认才触发导出 |
| 死但 S2 要决定去留：`reviewSlot` + ReviewIssuesCard + review chips 卡 | `:1896-1903`（slot）；mode-shell.tsx:19-75 | `workbenchMode==='review'`（当前永不成立） | S2 若给 Bingo 脸开「进入评审模式」的门，这里是现成槽；否则随 C 链一起收口 |
| composer 容器 | 挂载 `:1934-1963` | `conversation` | Q3 决定形态（保留精简输入条 or 纯状态台），见任务三 |

### 2.2 S2 应摘除 / 已被 S1.0 重挂（Bingo 脸布置生成态）

| 块名 | 起止行号（实读） | 当前门控（实读） | 台账基线门控 | 处置建议 |
| --- | --- | --- | --- | --- |
| `PlanHome` | 挂载 `:1861-1867`（定义 plan-flow.tsx） | `activity && mode==='layout'` | `bingo &&`（台账 :1947 附近） | S1.0 已摘 bingo；S2 复核不再反弹 |
| `ap-lead` 空态 lead | `:1857-1860`（`mode==='layout'`） | `conversation`（Bingo 脸也渲染） | 同 | **仍挂 bingo**：文案是「先说一句就行」布置语义，S2 需换成审校台空态 |
| `recap` 简报回显行 | `:1868`（`mode==='layout'`） | `conversation` | 同 | Bingo 脸显示布置 recap 语义错位，S2 摘或换 |
| `GenProgress` | 挂载 `:1877`；定义 `:1692-1705` | `activity && mode==='layout'` | bingo | S1.0 已摘 bingo |
| `ProposalCard` + plan-summary | 挂载 `:1882-1895`（ProposalCard 定义 `:1708-1738`） | `activity && mode==='layout'` | bingo | S1.0 已摘 bingo；reviewNow 修复预览复用 ProposalCard（:527-543 三道门），复用关系保留 |
| 会话历史 / 新开会话钮 | `:1825-1845`；`SessionHistoryOverlay` `:1854` | `activity` | bingo | S1.0 已摘 bingo |
| `StyleBundlePanel` | `:1936-1942` | `mode==='layout' && activity` | bingo | S1.0 已摘 bingo |
| `AgentCapabilityPrompts`（地图选址/按风格配一套 chips） | 挂载 `:1943`；定义 `:1581-1605` | `mode==='layout' && activity`（函数内 :1583 再判一次） | bingo | S1.0 已摘 bingo |
| composer placeholder 与建议词（布置语义残留） | placeholder `:1953`（三态文案）；`AGENT_INPUT_SUGGESTIONS` bingo 组 typed-suggestion.tsx:19 | `conversation` | 同 | S2 若保留输入条：bingo 组必须换成审校口令建议；若纯状态台：见任务三 |

---

## 3. 任务三：Q3 专项——Bingo 脸自由输入条去留

### 3.1 口令识别函数全量（grep 定义+调用）

识别函数定义在 `frontend/components/room-organizer/lib/workbench-agent.ts`：

| 函数 | 行号 | 正则（精简） | 触发动作（agent-panel.tsx send()） |
| --- | --- | --- | --- |
| `isStopCommand` | :77 | /停一下/停/ | :1243 stop/withdraw |
| `isGenerateCommand` | :83-88 | 换一版/出一版/生成布置… | :1304+ resolveBriefTurn → 生成链 |
| `isEstimateCommand` | :91-93 | 按图纸估… | :1261 estimateAndGenerate |
| `isReviewCommand` | :99-103 | 哪里有问题/体检/改一版/太挤/动线…（排除换一版类） | **:1295 reviewNow() —— 体检唯一入口** |
| `isClientReviewCommand` | :106-110 | 客户评审/评审包/发给客户/准备评审/给客户看/给甲方看（排除走一遍/漫游） | :1250-1254（非 layout 分支）与 :1297-1301（layout 分支）→ `callbacks.onOpenReview()` |
| `isMaterialListCommand` | :113-115 | 清单/物料表/多少件物料… | :1256 与 :1291 → replyMaterialList |
| `isCopyDraftCommand` | :118-120 | 文案/宣传语/朋友圈… | :1293 replyDraft |
| `isExportCommand` | :127-131 | 导出/交接/交付/搭建方/打包带走 | :1255 与 :1303 → proposeExport()（:1201-1203） |
| `isZoneCommand` | :134-136 | 换区/搬到…区 | :1294 replyZone |
| `isGenericMaterialRequest` | :184 | 加物料未点名 | :1292 MATERIAL_REQUEST_HINT |

send() 主分支结构（agent-panel.tsx）：
- 非 layout 模式（:1249-1258）：只认 clientReview / export / materialList 三个口令，其余一律回 fallback 文案——**这个分支已经是「审校模式白名单」雏形**。
- layout 模式（:1260-1357）：全口令 + 生成链。

creative-studio.tsx **没有自己的口令路由**：它只提供 `generate/exportActivity/prepareReview`（exportActivity :946-950 → exportActivityHandoff；prefillReview :1292 → buildReviewReference；ProjectReviewPanel 挂载 :1454）。所有口令收敛在 agent-panel.send()。

### 3.2 若移除 Bingo 脸 composer，会断什么

| 口令/动作 | 当前唯一入口？ | 摘掉 composer 后 |
| --- | --- | --- |
| 体检 `reviewNow`（:1295） | **是**（无按钮、无菜单入口） | **断**——必须补按钮 |
| 「准备客户评审」onOpenReview（:1297） | 否：业务评审 Tab 还可经左侧 business 面板进（creative-studio.tsx:1454 ProjectReviewPanel）；分享菜单「发评审链接」是另一入口 | 口令路径断，但功能可经导航到达；建议仍补按钮 |
| 「导出交接」proposeExport（:1303） | 否：分享菜单 shareActions.onExportHandoff（room-organizer.tsx:2188）→ handoffExportRequest 也能开导出确认卡 | 口令路径断，功能有替代入口；建议补按钮 |
| replyMaterialList / replyDraft / replyZone | 是（仅口令） | 断——这三条本就不属于审校台职责，断了是**好事** |
| 生成链（isGenerateCommand :1304） | 是（右栏唯一生成入口本就是说话，workbench-agent.ts:80 注释） | 断——但 Bingo 脸本就不该能生成（S1.0 已把生成 chrome 挂 activity，Bingo 脸打字却仍能触发生成链，这是当前同刀问题） |

### 3.3 「纯状态台 + 两口令钮」接线方案（推荐）

不动 onApplyCreative 三道门、不新增 wire schema。组件级落点：

1. **钮①「准备客户评审」**：落点 agent-panel.tsx:1873（BingoAuditCard 挂载点旁）。onClick 直接复用现有回调 `callbacks.onOpenReview()`（:1950 已传给 provider）→ openBusinessWorkspace('review')（room-organizer.tsx:436-445）。
2. **钮②「导出评审包」**：同区，onClick 复用现有 `proposeExport()`（:1201-1203，已在 provider 内）→ 弹 exportPreview 确认卡（:1912-1919）。
3. **钮③「体检布置」**（必要配套，否则体检断链）：同区，onClick 复用现有 `reviewNow()`（:481-501）。Q3 两口令口径外的第三钮，理由是它当前唯一入口就是口令（3.2），不补就是功能删除。
4. composer 容器（:1934-1963）：门控从 `conversation` 收窄为 `activity`（bingo 不渲染）；ghostVisible（:1791 附近）同步收窄。
5. `AGENT_INPUT_SUGGESTIONS` bingo 组（typed-suggestion.tsx:19）：随 composer 摘 bingo 脸而不再被读取，无需改文件；但若保留输入条则必须换文案。
6. send() 本身不改（活动脸继续全量）；bingo 脸不再触达 send() 的生成链分支。

需要改的 state/props/事件清单（仅登记，不写码）：
- agent-panel.tsx JSX 门控 :1944-1962（form 渲染条件）
- :1789-1791（activeAgent 取建议词/ghost 判定）
- 新增三钮的 onClick 绑定（均已存在，零新 state）
- 无 props 类型变更、无 wire schema 变更

### 3.4 取舍表

| 维度 | A 纯状态台 + 三钮（推荐） | B 保留精简输入条（bingo 分支白名单两口令） |
| --- | --- | --- |
| 与灵感板 §9-Q3 证据对齐 | 完全对齐（Figma/Frame.io 状态台） | 部分（仍留自由文本） |
| 改动面 | 改 composer 门控 + 加三钮（均复用现有函数） | 改 send() 加 bingo 脸口令白名单 + placeholder/建议词换文案 |
| 误触生成链 | Bingo 脸根本打不了字，彻底断 | 仍需在 send() 里拦非白名单口令，否则 Bingo 脸打字仍走 :1304 生成链（当前同刀问题不解决） |
| 气泡历史 | 保留（Bubbles 不动） | 保留 |
| 风险 | 体检按钮化是必须配套，漏了就是功能删除 | 「精简条」长期容易被重新塞回自由生成，违背 D3 |

**推荐：A。** 三钮是 B 方案里体检口令的按钮化前置，无论选哪套都躲不掉；A 把它一次做齐。

---

## 4. 任务四：测试资产静态盘点（用例数为实读计数）

| 测试文件 | 用例数（实读） | 覆盖行为 | 与 S2 链路的关系 |
| --- | --- | --- | --- |
| `frontend/components/room-organizer/lib/bingo-feedback.test.ts` | 5 个 it（:32/:55/:75/:95/:113） | share-pins 优先于旧评论；不同 reviewPlanKey 的 legacy 回落；uuid demo 评论；mark 上 clientUrl/reviewPlanKey 读取 | 直接覆盖审计卡读端；缺「钉 resolved 后计数口径」「同 key 下 pins+comments 并存去重冲突」 |
| `frontend/components/room-organizer/lib/bingo-status.test.ts` | 13 个 it（bingoPhase 3 + readBingoSnapshot 7 + clearBingoReceipt 2 + formatBingoTime 1） | phase 三态；mark 过滤（非 saved/非 needs-review/空 projectKey/非 uuid shareId 丢弃 :75-87）；receipt 按 planKey 匹配（:102-110）；坏回执降级 | 直接覆盖 returned 徽标；缺「生产 mark 的 shareId=projectKey（非 UUID）能否过 parsePlan」——实测 :80-86 用例显示空 projectKey 被丢、非 uuid shareId 反被保留，与生产写法 :385 的对齐关系待补断言 |
| `frontend/components/room-organizer/lib/review-pins.test.ts` | 4 个 it（:27/:37/:52/:67） | 80 字截断/空文丢弃；锚点跟随移动物件+相机飞行；open/resolved 筛选计数；composer 屏内定位 | 覆盖制作者侧钉状态机（断链 C 的引擎）；缺「钉持久化到 share-pins 的格式映射」（mapSharePin bingo-feedback.ts:98 无测试） |
| `frontend/components/room-organizer/lib/layout-review.test.ts` | 11 个用例槽（it.each ×5 展开后 16 个断言点）：reviewLayout 8 槽（:25/:35/:41/:54/:66/:87/:99/:112/:120）+ proposeReviewFix 3 槽（:139/:151/:160） | 6 类 issue 检出与 6 类 fix 预览；不改写入参；不冒充合规结论 | 体检引擎覆盖最厚；缺 reviewNow→applyReviewFix 经 ProposalCard 三道门的组件级测试 |
| `frontend/components/room-organizer/lib/review-share.test.ts` | 2 个 it（:36/:54） | UUID 快照冻除 handoff 字段/floorPlanImage；80 条上限与只回复根 | 孤儿链 B 仅存覆盖；生产无入口，S2 决定删留时此测试随之处置 |
| `frontend/components/room-organizer/lib/review-copy.test.ts` | 7 槽（it.each ×7 展开 13） | 简述参考拼装；空字段隐去；人数/面积无效值不打印；禁词清单（不冒充已发送/消防/合规） | 支撑 ProjectReviewPanel 预填（creative-studio.tsx:1292）；与 S2 链路间接相关 |
| `frontend/components/review-share-page/review-return.test.ts` | 2 个 it（:23/:36） | 回执写入+红环 class；坏回执/配额失败降级 | 缺「红环不按 planKey 过滤」口径测试（review-return.ts:54-55 与 bingo-status returned 口径不一致，1.4 已记） |
| `frontend/components/review-share-page/review-share-page.react.test.tsx` | 3 个 it（:61/:85/:99） | 示例 plan 落钉持久化+remount 仍在+完成评审写回执；hash 快照/本机 plan 两来源；切楼层/坏 hash 降级 | 活链 A 的唯一组件级覆盖；缺「钉 resolved 切换」「80 条钉上限 evict」「返回后制作者侧徽标联动」 |

附带（任务书点名外，grep 实见）：`comments.test.ts` 6 个 it（:36/:53/:61/:72/:81/:88）、`share-pins.test.ts` 2 个 it（:21/:30）、`load-plan.test.ts` 4 个 it（:28/:43/:53/:67）、`share-menu.react.test.tsx` 中评论页用例 1 个（:130）。

### 4.1 测试缺口清单（按闭环段落）

1. **发链接段**：issueReviewLink（room-organizer.tsx:375-390）零测试——mark 写入的 reviewPlanKey 与 share-pins by-plan key 的对齐关系（link:fnv1a）无断言；bingo-status.test.ts:63-73 只测 clientHref 形态，不测「发链接→甲方钉→审计卡 pinCount>0」全链。
2. **客户端钉段**：share-pins 的 80 条/plan 上限、40 份 plan 驱逐（share-pins.ts:17-18）无测试；钉 resolved 后 mapSharePin 透传（bingo-feedback.ts:98）无测试。
3. **回流段**：红环口径不一致（review-return.ts:54-55 vs bingo-status.ts:156）无测试；AgentReopenCard（agent-panel.tsx:1984-1995 区）无组件测试。
4. **口令段**：isClientReviewCommand/isExportCommand/isMaterialListCommand（workbench-agent.ts:106/127/113）无专门单测（待核验是否有 workbench-agent.test.ts）；send() 非 layout 白名单分支（agent-panel.tsx:1249-1258）无组件测试。
5. **体检段**：reviewNow/applyReviewFix 组件级无测试；体检修复预览复用 ProposalCard 三道门（:527-543）无测试。
6. **孤儿链**：UUID 链若 S2 决定收口（删 `/review/[id]` 或改造评论页），review-share.test.ts:36/:54 与 share-menu.react.test.tsx:130 需同步处置，无迁移测试。

---

## 5. 任务五：local-demo 边界与云端化预留（D7：本轮不实现 Supabase）

**现状边界（全部 localStorage，同浏览器演示口径）**：

| key | 文件:行 | 内容 |
| --- | --- | --- |
| `scendance.reviewShare.v1.<uuid>` | review-share.ts:20 | UUID 快照（孤儿链） |
| `scendance.reviewComments.v1.<uuid>` | review-share.ts:21 | UUID 根评论（孤儿链） |
| `scendance.reviewMark.v1` | review-share.ts:22 / bingo-status.ts:14 | Bingo 台账 marks（40 条上限） |
| `scendance-review-share-comments-v1` | comments.ts:10 | 旧侧栏评论（生产无写方） |
| `scendance-review-share-pins-v1` | share-pins.ts:16 | **活钉**（80/plan、40 plan） |
| `scendance-review-share-return-v1` | review-return.ts:12 / bingo-status.ts:15 | 回执（单条） |
| `scendance-editor-local-v1` | load-plan.ts:70 附近 | 本机布置（富钉页 local 来源） |

**适合预留接口注释的位置（只给建议，不写码）**：
- `review-share.ts:1-15`（文件头）：标注 REVIEW_SHARE_STORAGE='local-demo' 为演示口径、快照/评论未来迁云端的替换点。
- `share-pins.ts:1-6`：钉存储为本地演示，按 planKey 分区是天然云端表键。
- `review-return.ts:1-10`：回执单条写本地；云端化后按 planKey 关联。
- `load-plan.ts:1-8`：planKey 命名空间（`link:`/`local:`/`sample:`）已是分区键，云端化时保留。
- `comments.ts:16-23`：ReviewComment 加 `visibility: 'public'|'internal'` 是评论分级预留位（handoff 字段已在快照层剥除，review-share.test.ts:42-43 有断言）。

---

## 6. 待核验清单（逐条编号）

1. **S1.0 工作树 vs 基线 diff**：本审计实读到工作树已出现 S1.0 痕迹（默认脸 door:1753、PlanHome 挂 activity:1861、door 改名「活动」:1747、会话历史挂 activity:1825）；因禁 git 操作，未跑 diff 确认与主线程提交的对应关系，S1.0 落地后需复核本分片全部行号。
2. share-pins.test.ts 全文仅 2 个 it（:21/:30），80 条/40 plan 上限是否他处覆盖——待核验是否漏读（grep 已全文件扫描，仍只有 2 槽）。
3. 是否存在 workbench-agent.test.ts 覆盖口令识别函数——grep 未命中，待核验。
4. ProjectReviewPanel（creative-studio.tsx:1454）除 openBusinessWorkspace('review') 外的其他打开入口——待核验左侧 business 面板/rail 的实际可达路径。
5. 生产 mark 的 shareId=projectKey（room-organizer.tsx:385）能否通过 bingo-status parsePlan（:138 区）与 bingo-feedback threadFromShareComments 的 isReviewShareId 门（:118）——实测 bingo-status.test.ts:80-86 显示非 uuid shareId 的 mark 被保留，该行为是否有意为之待设计确认。
6. `/review` 裸路由与 `/review/<id>` 在 Cloudflare 重写（review-link-client.tsx:5 注释）下的实际到达行为——待冒烟，静态无法判定。
7. AgentReopenCard 红环（agent-panel.tsx:1984-1995 区）与 BingoAuditCard returned 徽标的口径不一致（任意回执即红 vs 按 planKey 过滤）——待产品确认是否同一语义。
8. 台账称 `bingo-audit-card.tsx:22-25`，实读 BingoAuditCard 函数起于 :25（注释头 :21-24）——行号漂移 3 行，已按实读登记。

---

## 7. 边界合规自检

- 只读操作：全程 Read/Grep/Glob，未写 frontend 任何文件，未跑 git/dev server/npm/vitest/build/tsc。
- 未访问 `frontend/public/ia-board`（评审 junction），未访问 `C:\幕景\Scendance2026` 旧快照。
- 产物仅本文件：`docs/plans/ia-s1-prep-2026-11-04/s2-review-audit.md`；未写 index.md / s11-gallery-card.md / s4-cleanup-inventory.md。
- 所有 file:line 为实读实钉；无法判定项一律进第 6 节待核验，未编造数字/URL/API。
