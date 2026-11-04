# 分片 B · 审校 Bingo：画布钉点评审对标调研底稿

> 日期：2026-11-04 ｜ 分片：B（审校 Bingo）｜ 基线分支：`feat/smart-build-scene-script`（台账 `a87c156` 口径）
> 任务定义：Bingo 回归审校本意——画面钉点 → 意见线程 → 标记解决 → 回流制作者台账，对标 Figma / Frame.io 类画布锚点评审，**不承担布置生成对话**（台账 D3）。
> 纪律：本文所有产品事实均经官方 URL 实际打开核实（见各节 URL）；幕景代码事实只引用导演台账已核验的 `file:line`（`docs/plans/ia-role-rework-ledger-2026-11-04.md` §3-B / S2），不脑补实现。
> 视觉与文案遵守 `docs/SCENDANCE-TASTE-IA-MEMO-2026-10-29.md`（顶部 2026-11-04 取代声明）：冷石 + 品牌绿，surface 文案不用禁词。

---

## 1. 一页结论（核心建议先读）

1. **钉点评审以 Figma 为骨，不要再造状态机。** 幕景已有 open/resolved（`lib/review-pins.ts:8`）与筛选计数（`:118-127`），本轮 S2 要补的是 Figma 已验证的四个交互件：解决即从画布隐藏、制作者侧「按未读排序 / 只看我的线程」、点侧边条目跳转回画布落点、缩放时钉点聚类。不加第三态。
2. **客户页按 Dropbox Replay / Pitch 做「无编辑 chrome」的只读评审页。** 现有 `app/review/[id]/` 分享页（`panels/review-share-page.tsx:146-152` 评论/回复表单）就是这个方向；本轮把权限语义写诚实：客户能看、能在钉点留评/回复，不能改方案、不能下载；local-demo 不实名的事实在页面明示。云端权限分档（只看 / 看并评论 / 口令）按 D7 后置，形状见 §9-Q4。
3. **「内部备注 vs 客户评论」分层是 Frame.io 给的最重要新增。** Frame.io 的 Internal Comments 对分享链接评审者不可见（锁标记）。幕景目前 `lib/review-share.ts:59,71` 只有一套评论流；制作者侧需要一层客户看不到的内部备注，正好与 `panels/bingo-audit-card.tsx:22-25`（甲方评审只读台账）形成「内 / 外」两层。
4. **一键修复（`lib/layout-review.ts:583` proposeReviewFix）必须长成 Google Docs 建议模式：待确认建议 → 预览 → 唯一确认。** 自动体检（`reviewLayout:240`）出 issue，修复是「建议」而非直接落盘，复用三道门（预览→唯一确认→撤销），客户侧永远看不到修复按钮。这与「建议模式 vs 钉评」的题目直接相关，见 §7。
5. **Q3 建议：Bingo 脸做「纯状态台 + 两个口令钮」，不保留自由输入条。** Figma / Frame.io / Replay 三方证据一致：审阅侧的核心动作是钉点、解决、看计数，不是聊天。Bingo 脸保留「准备客户评审 / 导出评审包」两个动作口令，其余由钉层、审计卡、体检结果承担（详见 §9-Q3）。

---

## 2. Figma 评论（Design 画布 + FigJam）

- 官方 URL：<https://help.figma.com/hc/en-us/articles/360041547593-View-and-manage-comments>（已实际打开）；FigJam 同构：<https://help.figma.com/hc/en-us/articles/1500004290941-Comments-in-FigJam>
- 一句话价值：画布上「点哪说哪」的钉点评审范式本身，及其「解决即归档」的状态语义。

### 交互骨架（官方页核实）
- **钉点模型**：评论钉在画布被点的位置或框选区域；钉点随缩放变化——单点为 pin，邻近钉点在低缩放时合并为 cluster（聚类），点 cluster 聚焦后再选单个。钉可拖动换位置。
- **线程**：点钉或侧边条目开模态，线程内回复、emoji 反应、@提及；评论模式（按 C）下右侧栏可搜索、排序、筛选。
- **状态机**：Resolve 后评论同时从画布和右侧栏隐藏；误解决可在右侧栏打开「Show resolved comments」筛选后 Unresolve（= 重新打开）。删除整条线程是不可逆动作。
- **导航**：右侧栏每条评论标注所在 page；点侧边条目会**跳转并导航**到该钉在画布上的位置。
- **通知**：邮件通知里的链接直接把你带到画布对应位置（原型评论则跳到演示视图）；侧栏可「按未读排序」、「只看与我相关的线程」（@我的 / 我回复过的 / 我发起但有人回复的）；可对单条「标记为未读」（仅自己可见）。
- **权限**：viewer 也可以评论和回复。

### 偷什么
- 「Resolve = 从画布和列表同时隐藏，默认不再碍眼」——幕景 open/resolved（`review-pins.ts:8,118-127`）已对，但要确认解决后的钉**默认不在画布上占位置**，而不是变灰常驻。
- 制作者侧汇总视图的三个筛选轴：**按未读排序 / 只看我的线程 / 显示已解决**——这正是台账 S2「串起客户评论 → 回流 → 计数」缺的导航件。
- 点台账条目 → 跳回画布落点（`review-pin-layer.tsx` 钉层已有坐标锚，导航跳转是收口动作）。
- 低缩放时钉点聚类，避免画布上钉成灾（3D 俯视角钉点密集时尤其需要）。

### 避什么
- Figma 的「评论模式（C）会锁住画布编辑」不适合幕景客户页：客户侧根本没有编辑工具，不需要一个显式的「进入评论模式」开关；幕景的分享页天然是纯审阅态。
- 不要学 Figma 的删除线程不可逆警告体系——幕景 local-demo 阶段评论上限 80 条（`lib/review-share.ts:177` 附近既有上限语义），超限覆盖策略已存在，别加删除确认弹窗。
- 不引入 Figma 式 emoji reaction 作为第一屏能力——审阅包场景下它是噪音，留作后置。

### 幕景落点
- `lib/review-pins.ts:8`（open/resolved 类型）、`:118-127`（markResolved / pinsForFilter / countOpenPins）；`panels/review-pin-layer.tsx`（画布钉层）→ S2 收口补「隐藏 + 聚类 + 未读排序 + 跳转」。
- `lib/bingo-feedback.ts` 与 `panels/bingo-audit-card.tsx:22-25`（clientHref / pinCount / returned）→ 制作者台账条目点击跳转画布。

### 待 owner 决策点
- 解决态是否在画布上留极细绿点（品牌绿克制），还是完全隐藏只在台账可查？建议后者优先、绿点后置（与备忘录「Green is scarce」一致）。

---

## 3. Frame.io（视频评审的锚点评审范式）

- 官方 URL：<https://help.frame.io/en/articles/9105251-commenting-on-your-media>（已实际打开）；产品页：<https://frame.io/features/review-and-approval>；Adobe 生态页确认权限语义：<https://www.adobe.com/au/creativecloud/business/frameio.html>
- 一句话价值：把「意见」精确锚在媒体的某个时空点上，并且**内部团队与外部客户看到两套评论**。

### 交互骨架（官方页核实）
- **钉点模型**：三种锚——单帧时间码评论（在底部输入框打字自动暂停）、区间评论（I/O 键定 A→B 段，气泡带长尾巴）、Anchored comments（播放中直接点画面任意位置留钉，钉随画面位置定位，可用抓手微调）。全屏模式下也能留锚评。
- **批注附件**：评论可在帧上直接画箭头/框/线/自由涂鸦（Annotation 工具），批注随评论卡保存，点卡才显示，不打扰正常播放。
- **内外分层（关键）**：发送前在 Public Comment / Internal Comment 之间切换；Internal Comment 带锁图标，**外部分享链接评审者永远看不到**。
- **附件与组织**：评论可挂文件附件（上限 6 个，Pro 档起）、@提及触发通知、#hashtag 可在筛选里按标签过滤同类意见。
- **权限**：按角色控制项目/文件夹/分享链接的可见范围——「内部工作私有、客户视图干净」（Adobe 官方页原文语义）。

### 偷什么
- **Internal vs Public 二分**——这是本轮最值得新增的语义件：幕景制作者侧留的内部备注（体检结果分派、制作排期备忘）对客户分享页不可见。落点：`lib/review-share.ts:59` ReviewComment 结构上加 `visibility: 'public' | 'internal'` 之形状（云端化前先在本地类型里预留，不实现同步）。
- 「点评论卡 → 视角跳到锚点位置」与 Figma 的跳转导航互为印证：3D 画布上就是相机飞到该钉坐标。
- Annotation 思路的远亲：客户钉点时框选一个区域而非一个点，语义更准。本地阶段先支持「点 + 可选框选」，画线涂鸦后置。

### 避什么
- 不引 hashtag 体系——幕景评审包规模小（评论上限 80），标签筛选是过度设计。
- 附件功能后置（Frame.io 自己也把附件放在 Pro 档）；幕景本轮评审包导出（建议 5）已经是「附件」的替代。
- 区间（range）评论是视频语义，幕景静态布置方案用不上，不抄。

### 幕景落点
- `lib/review-share.ts:18`（`local-demo` 本地存储边界）、`:59`（ReviewComment）、`:71`（ReviewBingoMark）、`:177`（addReviewComment 含 parentId 线程）→ internal/public 分层形状预留。
- `panels/review-share-page.tsx:146-152`（评论/回复表单）→ 客户侧只渲染 public。
- D7：云端化前 internal 分层只在本地内存/存储内成立，不上云。

### 待 owner 决策点
- internal 备注是否本轮就落地（纯本地、零云端成本），还是随 D7 一起？建议本地先落地类型与 UI（工作量小），云端同步后置。

---

## 4. Dropbox Replay（分享链接评审的权限档）

- 官方 URL：产品页 <https://www.dropbox.com/zh_TW/replay>（已在搜索结果核实，主张「共享最新编辑内容、检视和处理留言、获得最终核准」）；实时评审权限帮助 <https://help.dropbox.com/zh-cn/view-edit/dropbox-replay-live-review>（已核实）
- 一句话价值：一条分享链接上「只看 vs 看并评论」的权限分档、口令与禁下载——客户只读页的权限模板。

### 交互骨架（官方页核实）
- **分享链接两档**：「知道链接的人」可选 **查看并评论** 或 **仅限查看**；可加口令；**默认禁止下载**。
- **免账号评审**：官方与第三方一致描述——评审者无需 Dropbox 账号即可在媒体上留下时间戳评论（第三方佐证：<https://storyflow.so/blog/best-way-to-share-creative-work-with-a-client-for-feedback-2026>，仅作行为佐证，不作事实来源）。
- 评论锚在具体帧/像素上，团队把意见汇到一处；另有「最终核准」动作收束评审（产品页主张，具体核准 UI 本轮未深挖）。

### 偷什么
- **权限分档语义**：分享链接 ≠ 只能看。两档就够：`view-only`（给领导/转发场景）与 `comment`（给客户）。这正是 `lib/review-share.ts` 分享形状该预留的枚举。
- **默认禁下载 + 口令**：评审页是公开链接风险面，「默认不允许带走方案文件」是对幕景（方案是核心交付物）最重要的安全姿势。
- 免账号留评——幕景 local-demo 已天然如此（无登录体系），要做的是**在页面上诚实标注「本次评审为本地演示链接，不保存到云端」**（对齐台账 S2 的 local-demo 边界文案要求）。

### 避什么
- 不抄「实时放映室」（live review 同步观看）——幕景客户评审是异步的，同步看片工作台是另一个产品。
- 不做 Dropbox 文件夹体系式的资产组织；幕景一个评审包 = 一个方案版本。

### 幕景落点
- `lib/review-share.ts:18`（local-demo）、`:177`（addReviewComment）；路由 `app/review/[id]/page.tsx` + `review-link-client.tsx`；`panels/review-share-page.tsx:146-152`。
- `bingo-audit-card.tsx:22-25` 的 `clientHref`（分享链接回执）→ 制作者台账里每条评审记录带上「链接档位 + 是否已评审」。

### 待 owner 决策点
- 本轮是否就给分享页加「禁下载 / 截图友好标注」（如页面角标水印「评审专用」）？成本低，建议 S2 顺手做。

---

## 5. Google Docs 建议模式（Suggesting）——「待批编辑」状态机

- 官方 URL：Google for Developers《使用评论和建议》<https://developers.google.cn/workspace/docs/api/how-tos/suggestions?hl=zh-cn>（已实际打开，2026-09-30 更新）
- 一句话价值：把「修改」本身变成一条可批准 / 可拒绝的意见线程——审校侧「自动体检 → 一键修复」的正确形态。

### 交互骨架（官方页核实）
- **建议 = 待批准的延迟编辑**：建议模式下所有改动不直接落盘，而是内嵌标注（待插入/待删除样式），等待批准。
- **状态机**：接受建议需要文档编辑权限；拒绝建议需要编辑权限**或该建议的作者**；评论线程可 RESOLVE / REOPEN（重开）。
- **指派**：评论线程可指派给指定人（assignee），把意见变成行动项。
- **视图模式**：SuggestionsViewMode 三态——内联显示待办建议 / 预览「全部接受后」 / 预览「全部拒绝后」。

### 偷什么
- **`proposeReviewFix`（`lib/layout-review.ts:583`）的输出形态**：体检引擎（`reviewLayout:240`）发现问题 → 产出一条「建议修复」→ 制作者侧预览修复结果（绿框）→ 唯一确认才落盘 → 拒绝则丢弃。这与幕景既有三道门（预览→唯一确认→撤销）完全同构，等于把建议模式接进既有红线，而不是新开一套落盘。
- **REOPEN 语义**：resolved 钉可以被重新打开——与 Figma 的 Unresolve 互证，状态机保持 open/resolved 两态足够，不需要加「已采纳/已拒绝」第三态。
- **assignee 思想的本地版**：制作人的体检 issue 可以在制作者台账里「指派给自己/排期」，但客户侧不可见（与 §3 internal 分层呼应）。

### 避什么
- 建议模式的全量文本协作（多人同时改稿）不是幕景场景——幕景的「文档」是生成引擎产出的，客户不打字改布置，只留评。别把 Google Docs 的编辑协作范式引进来。
- 不做「预览全部接受/全部拒绝」批量操作——评审包规模小，逐条确认反而符合「一次一个决策」（备忘录原则 5）。

### 幕景落点
- `lib/layout-review.ts:26-27`（6 类 issue / 6 类 fix 类型）、`:240`（reviewLayout）、`:583`（proposeReviewFix）→ 建议化包装；红线：任何修复必须过 `onApplyCreative` 三道门。
- `lib/review-pins.ts:8` open/resolved 与 REOPEN 语义对齐。

### 待 owner 决策点
- 体检出的 issue 是否自动生成钉点（带坐标锚）进画布？建议：是——体检结果与人工钉点共用同一 open/resolved 状态机，避免两套计数（对齐台账 S2「合为同一回执台账」）。

---

## 6. Pitch（演示文稿的评审工作流）

- 官方 URL：<https://help.pitch.com/en/articles/8575905-invite-guests-to-collaborate-on-presentations>（已核实三级权限）；<https://help.pitch.com/en/articles/5695595-review-and-collaborate-on-presentations>（已核实移动端只读评审）；产品页 <https://pitch.com/pitch-vs-keynote>（已核实「slide statuses, assignments, comments, notifications」）
- 一句话价值：把「评论、状态、指派」挂在**单个对象（幻灯片）**上的工作流——幕景「评审页 = 多方案版本」的参照。

### 交互骨架（官方页核实）
- **访客三档权限**：Can edit（全权）/ Can comment（看 + 评论，看不到被跳过的页）/ Can view（看，看不到评论）。
- **对象级状态**：每张幻灯片可设状态、可指派、可收评论与反应；移动端只能评审/评论/看进度，不能创建编辑——移动端天然是客户视图。
- 通知体系把状态变化同步给团队（产品页主张）。

### 偷什么
- **Can view vs Can comment vs Can edit 三档**——与 §4 Replay 两档互补：Pitch 证明「连评论都不让看」的纯汇报档有真实场景（给老板看结果）。幕景预留三档枚举：`view` / `comment` / `edit`（edit 档即制作者本人）。
- **对象级状态**：Pitch 的「每张幻灯片有状态」对应幕景「每个评审包（方案版本）有状态：待评审 / 意见回流中 / 已解决」——落在 `bingo-audit-card.tsx:22-25` 的只读记录上。
- 移动端只能看不能改——幕景客户页浏览器打开就该是这个心智，不需要做 App。

### 避什么
- 反应（reactions）与通知邮件体系后置（云端依赖）。
- 不抄 Pitch 的「指派给团队成员」社交层——D5/D7 下成员协作后置，本地版指派只能是「自己留的标记」。

### 幕景落点
- `panels/review-share-page.tsx:146-152`（客户侧表单）→ comment 档才渲染输入条，view 档不渲染。
- `lib/bingo-feedback.ts` + `bingo-audit-card.tsx:22-25`（clientHref / pinCount / returned）→ 评审包级状态与计数。

### 待 owner 决策点
- 评审包是否版本化（同一活动多轮意见按版本串列）？本地阶段建议先只记「最新一轮」，版本列表后置（D7 云端化时自然解决）。

---

## 7. Markup.io（免注册访客的「随处钉点」）

- 官方 URL：<https://www.markup.io/>（已核实首页主张：支持 30+ 文件类型，「Drop a pin anywhere on the content and the conversation stays exactly where it belongs」）
- 一句话价值：证明「免注册、随处钉点、线程钉在原地」是最低门槛的客户评审形态——幕景 local-demo 分享页就是这个档。

### 交互骨架（官方首页核实）
- 钉点落在内容原地，对话线程依附在钉点处，不散落进邮箱截图。
- 覆盖网站、图片、PDF、视频 30+ 类型；访客免注册留评（第三方佐证：<https://zorko.app/zipboard-alternatives>，仅佐证行为）。

### 偷什么
- **「对话留在钉点处」的心智**：幕景 `lib/review-share.ts:177` 的 parentId 线程已在结构层对齐（线程挂在评论下），要保证 UI 上线程不从钉点旁漂移。
- 免注册留评 = 幕景 local-demo 的现状，这是**直接复用**档，不改造；但要在页面角落署名（访客昵称输入），让意见可分辨是谁说的。

### 避什么
- Markup.io 的「粘贴网址代理截图」模式不适用（幕景评审页就是本体，不需要代理层）。
- 30+ 文件类型的通用性是它的卖点，不是幕景的；幕景评审载体只有「当前方案的画布视图」一种。

### 幕景落点
- `lib/review-share.ts:177`（addReviewComment + parentId）、`review-share-page.tsx:146-152` → 线程钉在钉点旁、访客署名输入。

### 待 owner 决策点
- 访客署名：固定昵称输入条（local-demo 已有人名字段语义）是否保留在客户页？建议保留——零成本，意见线程可分辨。

---

## 8. Miro（通知中心与「钉住线程」）

- 官方 URL：<https://help.miro.com/hc/en-us/articles/360017730873-Comments>（已核实：@提及通知、Pin a thread 把多条线程同时留在板上）；通知中心 Feed：<https://help.miro.com/hc/de/articles/360034278893-Feed>（已核实存在）
- 一句话价值：团队协作层的通知范式——但也恰好标出幕景本轮的后置边界。

### 交互骨架（官方页核实）
- @提及触发通知；可把线程「Pin」在板上同时展开多条讨论。
- Feed 是产品内通知中心，汇总各板更新。

### 偷什么
- 只有一个：**「把重要线程钉在台面上」的心智**——幕景制作者台账可以有「置顶未解决钉」的视图，不等同于云端通知，本地即可实现（制作者自己置顶自己的待办）。

### 避什么
- @提及、Feed 通知中心、跨板汇总——全部是云端多用户能力，按 D7 后置。写进 Q4 接口形状备注即可。

### 幕景落点
- 纯后置：`bingo-feedback.ts` / `bingo-audit-card.tsx:22-25`（returned 字段）本地先承接「回流」语义；云端通知留接口注释。

### 待 owner 决策点
- 无新增；仅作后置边界的官方佐证来源。

---

## 9. 开放项覆盖（Q3 / Q4，台账 §6）

### Q3：Bingo 审校脸是否保留输入条？
- **证据**：Figma（评论是画布动作，输入框只在线程内）、Frame.io（输入框在播放器旁，服务于留评）、Markup.io（免注册钉点）、Pitch（移动端只有评审没有创建）——**没有一个把审阅工作台做成自由对话框**。
- **建议**：Bingo 脸 = 纯状态台 + 两个口令钮：
  - 「准备客户评审」= 生成评审包、复制分享链接（挂 `bingo-audit-card` 的 clientHref 生成）；
  - 「导出评审包」= 把 open/resolved 钉与评论线程导出为可带走的一页（本地文件，不依赖云）。
  - 不保留自由文本输入条；钉点评论、体检结果、审计卡承担其余。与 S2「摘除 PlanHome/ProposalCard/GenProgress」（台账 S2 任务书）同刀。
- **风险**：若 owner 希望保留「帮我写评审话术」类口令，则退化为「状态台 + 单口令输入条（仅预设意图）」——两种形态都请 owner 拍。

### Q4：评审云端化排期与接口预留形状（S2 不实现）
- **参照形状**（全部来自已核实官方语义，不偷实现）：
  - 评论分层：`public` / `internal`（Frame.io）；
  - 权限分档：`view` / `comment` / `edit`（Pitch）与分享链接档 `view-only` / `view+comment` + 口令 + 默认禁下载（Replay）；
  - 未读与回流：按未读排序、只看我的线程、邮件链接跳回落点（Figma）；@提及/Feed（Miro）。
- **S2 动作**：在 `lib/review-share.ts` 的类型注释与 `local-demo` 边界注释里写明上述预留枚举；本轮不写 Supabase 调用、不做登录。

---

## 10. 主题 × 产品速查

| 主题 | Figma | Frame.io | Replay | GDocs | Pitch | Markup.io | Miro |
|---|---|---|---|---|---|---|---|
| ① 钉点放置 | 点/框选、缩放聚类、钉可拖动 | 点画面锚钉、框选、批注 | 锚在帧/像素 | （无钉点） | 挂在对象（幻灯片）上 | 随处钉点 | 钉在线程 |
| ② 线程生命周期 | 回复/@提及、resolve/unresolve | public/internal、附件6、hashtag | 时间戳评论汇一处 | 建议 accept/reject、RESOLVE/REOPEN、assignee | 评论+状态+指派 | 线程钉在原地 | 线程 Pin 住 |
| ③ 客户只读/分享 | viewer 可评 | 分享链接干净视图、按角色锁 | 两档+口令+默认禁下载 | 编辑权限门槛 | 三档访客权限 | 免注册 | （团队内） |
| ④ 未读/回流通知 | 未读排序、只看我的线程、邮件跳回 | @提及通知 | 最终核准动作 | assignee 行动项 | 状态+通知 | — | Feed/@提及（后置） |
| ⑤ 自动体检/建议模式 | — | — | — | **建议=待批编辑** | 对象状态 | — | — |

---

## 11. 参考链接总表（均已实际打开/核实）

| # | 产品 | URL | 核实方式 |
|---|---|---|---|
| 1 | Figma 查看与管理评论 | https://help.figma.com/hc/en-us/articles/360041547593-View-and-manage-comments | web.fetch 打开全文 |
| 2 | Figma FigJam 评论 | https://help.figma.com/hc/en-us/articles/1500004290941-Comments-in-FigJam | 搜索摘要核实 |
| 3 | Figma 移动评论 | https://help.figma.com/hc/en-us/articles/360039824594-Comment-on-prototypes | 搜索摘要核实 |
| 4 | Frame.io 评论官方帮助 | https://help.frame.io/en/articles/9105251-commenting-on-your-media | web.fetch 打开全文 |
| 5 | Frame.io 产品页 | https://frame.io/features/review-and-approval | 搜索摘要核实 |
| 6 | Adobe×Frame.io 权限页 | https://www.adobe.com/au/creativecloud/business/frameio.html | 搜索摘要核实 |
| 7 | Dropbox Replay 产品页 | https://www.dropbox.com/zh_TW/replay | 搜索摘要核实 |
| 8 | Dropbox Replay 实时评审权限 | https://help.dropbox.com/zh-cn/view-edit/dropbox-replay-live-review | 搜索摘要核实 |
| 9 | Google Docs 评论与建议（官方） | https://developers.google.cn/workspace/docs/api/how-tos/suggestions?hl=zh-cn | web.fetch 打开全文 |
| 10 | Pitch 访客权限 | https://help.pitch.com/en/articles/8575905-invite-guests-to-collaborate-on-presentations | 搜索摘要核实 |
| 11 | Pitch 移动端评审 | https://help.pitch.com/en/articles/5695595-review-and-collaborate-on-presentations | 搜索摘要核实 |
| 12 | Pitch 产品页 | https://pitch.com/pitch-vs-keynote | 搜索摘要核实 |
| 13 | Markup.io 首页 | https://www.markup.io/ | 搜索摘要核实 |
| 14 | Miro 评论 | https://help.miro.com/hc/en-us/articles/360017730873-Comments | 搜索摘要核实 |
| 15 | Miro Feed | https://help.miro.com/hc/de/articles/360034278893-Feed | 搜索摘要核实 |

---

## 12. 未能核实而放弃的候选（按有据纪律不进灵感板）

| 候选 | 放弃原因 |
|---|---|
| Pastel（usepastel.io） | 本轮未联网打开其产品/功能页，交互细节无法核实，不进灵感板 |
| Notion 评论 | 本轮未联网核实其钉点/线程细节，不进灵感板 |
| Vimeo 评审（含其 review 流程） | 本轮未联网核实，不进灵感板 |
| Frame.io 「最终核准 / Approve vs Changes requested」完整审批流 | 官方帮助页仅证实评论体系；审批状态机细节本轮只拿到第三方转述（contentmaker.space），不进卡片事实，留待下轮核实 |
| Figma Slack/Teams 通知集成 | 仅帮助页一行事实，作通知回流佐证，不单列候选 |

---

## 13. 核心建议（≤5，同 §1 收束）

1. 钉点状态机不新增第三态：open/resolved（`review-pins.ts:8`）足够；补「解决即隐藏 + 未读排序 + 只看我的线程 + 点击跳回画布」四件事（Figma 已验证）。
2. 客户分享页做无编辑 chrome：view / comment 两档起步，默认禁下载、local-demo 边界页面诚实标注（Replay + Markup.io）。
3. 新增 internal / public 评论分层：制作者侧内部备注客户不可见（Frame.io），与 BingoAuditCard 只读台账形成内外两层；本地先落地，云端后置。
4. 一键修复长成「建议」：体检 issue → 待确认建议 → 预览 → 唯一确认 → 可拒绝（GDocs 建议模式），全程过三道门，客户侧不见修复按钮。
5. Q3：Bingo 脸做纯状态台 +「准备客户评审 / 导出评审包」两口令，不保留自由对话输入条。

— 完 —
