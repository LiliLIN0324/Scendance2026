# 侧边栏入口统一设计方案（讨论稿 · 2026-11-12，11-13 复核校正）

> 状态：规划讨论；首个代码改动（Bingo 徽标）已合入 main。后续按既定偏好本地攒好、tsc + 测试 + 真机验收通过后再一次性推 main，不逐小改开 PR。
> 对照素材：两张截图——收起轨图标列、展开态对话卡列表；设计依据 `docs/05-设计规范.md`（v2.5.12）与可视稿 `docs/visual-2026/design-spec-2026.html`。
>
> **本轮已拍板（2026-11-12）**：
> 1. Bingo 第一轮先恢复旧版「圆 + 圆内数字」形制，但本体保持 28px 与其他格同尺寸（草图变体 D），不退回旧版 40px 整圆；配色 / 双计数等细节第二轮再调；
> 2. 双计数：第一轮单计数（链接数 L，对齐旧版 `plans.length`）；评审链接数与画内钉未读数第二轮同时体现（方案见 §5.4）；
> 3. 第一格是**唯一 Agent**，产品定位名「**小景**」；代码现名本轮保留不动——轨钮可见名「总控」、面板头 `AGENT_META.door.name`「活动」，是否回改、何时回改留第二轮；其余入口按工具 / 动作族安排图标（§4）；
> 4. 候选草图：`docs/visual-2026/bingo-badge-sketch-2026-11-12.html`（旧版还原 + A/B/C/D 四版变体，可切换两套配色）；整栏草图 `docs/visual-2026/sidebar-rail-unification-sketch-2026-11-13.html`；图标候选对照 `docs/visual-2026/icon-options-sketch-2026-11-13.html`。
>
> **落地进展（2026-11-13，已随 main 合入）**：Bingo 轨钮已按变体 D 改回三态圆徽标——`panels/bingo-rail-button.tsx` 改读 `readBingoSnapshot`：待发空圆 / 待评圆内 L 数字（0 不画、>9 出 `9+`）/ 已回执勾形；圆体 28px 与其他槽同尺寸；移除 ball 形体与 `RailLaneDot`，状态与计数写进 `aria-label` / `data-tip`。配套改动：`app/globals.css` 增 `.sc-bingo-badge` 三态规则，`panels/mobile-shell.css` 28px 槽选择器纳入徽标，两个轨钮测试同步更新（旧 cube/pyramid、disc=3 断言一并校正为现状）。tsc 干净；bingo 5 文件 34 测试 + 轨钮头 7 测试通过。回执配色（旧版 err 红 vs 闭环 ok 绿）与双计数（画内钉未读数 P 进徽标）留第二轮；其余入口本轮未动。
>
> **第二轮已拍板（2026-11-13，口径拍板、本轮代码已落地）**：
> 1. 双计数走「主圆 + 右上小角标」式 4——**主圆出 P**（open 画内钉未读数），**角标出 L**（未回执链接数）；角标规格对齐 `.sc-rail-member-badge`：15px 圆、err 底白字 10px、右上角落位、2px 纸色描边。
> 2. 回执态取 R2：勾形闭环 + 角标出未读钉 P；L 已回执不再出；面板头由 Agent 另做未读提醒，责任到人。
> 3. 拍摄场地：图标 + 右下小胶囊「3D」副标；图标本体是否由自绘描边 SVG 换 `photo_camera` 随整栏方案定。
> 4. 空间维持现状 `grid_view`（`brick` 搁置）；户外维持现状 `public`，`map` / `explore` 后续再议。
>
> **第二轮落地（2026-11-13，随本次提交）**：`lib/bingo-feedback.ts` 增 `countOpenFeedbackPins`（`pinStatus !== 'resolved'` 计未闭环，旧侧栏无状态按未闭环计）；轨钮主圆 P、角标 L，回执态勾形 + 角标 P，`aria-label` / `data-tip` 拼入两份计数；拍摄按钮包进 `.sc-rail-capture-icon` 并挂 `.sc-rail-3d-tag`；测试重写为双计数 + 回执角标 + 3D 副标断言。整栏归位与三态配色仍未动。
>
> 仍待定：整栏归位甲 / 乙 / 丙；徽标三态配色 A 旧版（赭+红）/ B 闭环（红+绿）。第二轮对照板：`docs/visual-2026/rail-scheme-round2-2026-11-13.html`。

## 0. 范围与入口清单

> 2026-11-13 复核工作树后校正：代码里 `sc-mode-rail-primary` 实际有 **5 枚主轨钮 + 团队块**，比截图多一枚「户外规划」；空间 / 物料的轨钮图标已不是形体 PNG，而是 Material 图标（详见 §1.1）。

左栏从上到下（`room-organizer.tsx` 轨钮组装块 4198–4289）：

| # | 截图标题 | 代码入口 | 组件 / 落点 |
|---|---|---|---|
| 1 | 总控 / 活动（原名保留；「小景」改名搁置） | 门厅 Agent | `panels/workbench-brand-toggle.tsx`（`WorkbenchBrandToggle`） |
| 2 | Bingo | Bingo · 收反馈 | `panels/bingo-rail-button.tsx`（`BingoRailButton`） |
| 3 | 空间 | 空间卡片 | `room-organizer.tsx` 内联按钮（Material `LayoutGrid`） |
| 4 | 物料 | 物料卡片 | `room-organizer.tsx` 内联按钮（Material `Box`） |
| 5 | 拍摄场地 | 场地重建入口 | `room-organizer.tsx` 内联按钮（自绘 camera SVG，开关面板 `openCapturePanel` / `closeCapturePanel`，不是外链 `<a>`） |
| 6 | 户外规划 | 2D 地图 / 3D 场地接管 | `room-organizer.tsx` 内联按钮（Material `Globe`）；截图收起轨底部的「地球」即这枚 |
| 7 | 给自己留话 | 成员私信（自己） | `panels/rail-team-block.tsx`（`RailTeamBlock`，团队成员圆片组） |

截图里第六行空壳卡属于空态，不在本轮入口统一范围内，只在 §3.1 给一条处置规则。

## 1. 现状盘点（代码事实）

### 1.1 各入口现状（2026-11-13 按工作树实读校正）

| 入口 | 轨钮图标来源 | 状态表达 | 备注 |
|---|---|---|---|
| 总控 / 活动（door，原名保留） | `RailAvatar` form `door`，`public/assets/rail/door.png`，28px + 白眼跟随 | `RailLaneDot lane="door"` 9px 状态点 | 可见标签两处：轨钮 `workbench-brand-toggle.tsx:30`「总控」；面板头注册表 `agent-panel.tsx:3641` `AGENT_META.door.name`「活动」（面板 `aria-label`、h1、关闭钮 aria-label、移动端 dock 占位都由它派生）；其余「门厅」均为注释 / 测试名；改名「小景」搁置，本轮不动 |
| Bingo | `RailAvatar` form `ball`，`ball.png`，28px + 白眼 | `RailLaneDot lane="bingo"`；tone 来自 `bingoHeaderStatus(agent, mode)`（agent 状态机，不读 `bingo-status` 快照）；面板头状态靠换切图（`mascotOf`） | 旧版数字圆徽标已下线，数据层仍在（§2） |
| 空间 | **Material `LayoutGrid`**（`grid_view`），`solid-icons.tsx` 注册，26px | `RailLaneDot lane="space"` | 轨钮已是 Material；`cube.png` 与 `RailForm.cube` 只残留在 `AGENT_META.space.form` 和面板头 36px `RailAvatar` 里，轨钮上不再用 |
| 物料 | **Material `Box`**（`inventory_2`），26px | `RailLaneDot lane="material"` | 同上：`pyramid.png` / `RailForm.pyramid` 只留在面板头 |
| 拍摄场地 | **自绘描边 camera SVG**（`room-organizer.tsx:4241–4244`，stroke 1.6，26px） | 无状态点 | 未登记进设计规范图标表；与 Material 族不同族。`solid-icons.tsx` 已有 `Camera`（`photo_camera`）可替换 |
| 户外规划 | **Material `Globe`**（`public`），26px | 无状态点 | 2026-11-12 新增；展开态含 2D 地图与 3D 场地接管两种形态，按钮态按两者任一开启判定 |
| 给自己留话 | 成员头像圆片（`account-avatars`：预设照片或首字母，分色 tone） | 红色未读数字徽标 `.sc-rail-member-badge`（15px 圆，白字，`--err` 底，`9+` 截断） | 与团队面板同一片头像体系 |

### 1.2 对照截图看出的三类不一致

1. **图标四套来源**：door / ball 两枚手绘形体 PNG + 白眼，空间 / 物料 / 户外三枚 Material 实心图标，拍摄场地一枚自绘描边 SVG，成员位是头像圆片。设计规范 §一.4 禁「未登记的描边图标」「同一工具列混搭不同字形家族」；空间 / 物料已先一步切到 Material，与 §1.3 引用的旧四形体表述已脱节。
2. **卡片操作位不齐**：截图里第一格（总控 / 活动）挂了时钟 + 加号 + 关闭，空间挂了回形针 + 关闭，其余只有关闭；拍摄场地没有图标、只有标题 + 一行 meta；中间还有一张空卡。
3. **状态表达两套**：四个 agent 格用 9px 小圆点（`RailLaneDot`），成员位用红色数字圆徽标；Bingo 旧版的反馈计数圆徽标目前缺席；户外规划、拍摄场地两格没有状态表达。

### 1.2.1 工作树 / 测试漂移（本轮复核新增）

- `workbench-rail-head.react.test.tsx` 仍是旧四形体口径：第 29–30 行断言空间 / 物料轨钮含 `<RailAvatar form="cube" / "pyramid">`，第 34 行统计 `sc-rail-disc` 为 3 枚；当前源码轨钮已是 Material `LayoutGrid` / `Box` + 第 4 枚 `Globe`，断言与实现脱节，落地统一时要一并更新这些测试。
- `AGENT_META`（`agent-panel.tsx:3640`）是名字 / 形体 / role 的注册表：door `活动`、bingo `Bingo`、space `空间`、material `物料`；本轮改名搁置，`name` 字段保持不动，后续若再议改名，需同时改这里，面板头、aria-label、移动端 dock 占位才会一起跟上。
- 未提交 WIP（10 个已跟踪文件）是显示单位、漫游退出收口、网格吸附图标、设置菜单等，与轨栏图标无关；轨栏实现本身在工作树里是干净基线。

### 1.3 相关约束（摘自设计规范）

- §一.1 品牌绿 `#4A7C59` 全产品只允许两处：选中指示、发送键；语义色（ok `#4A7C59` / warn `#96651F` / err `#B4443C`）只做状态文字、状态点、描边，不做大色块。
- §一.4 通用 UI 图标统一本地 Material Symbols Rounded（FILL 1、weight 300），尺寸 16 / 20 / 24 / 32；左轨四入口用 `RailAvatar` 28px 形体、触达 40×40；角色形体与 PlotCraft 领域图形属例外。**注意**：规范这段仍按旧「四形体」写，工作树里空间 / 物料 / 户外已切 Material，规范补丁要把三族现状写进去（§7 第 1 步）。
- §一.2 同区字号不超过三档：标题 C1 14/22/500、辅助 P2 12/20 muted、标注 CAP 11/16/500；数字用 `tabular-nums`。
- §二.1 ghost 钮：透明、图标 ink-soft、hover plane；触达 ≥32×32。
- §二.4 选择器 icon 优先 + 卡片视觉；选中态 = 描边 ink-soft + 右上绿勾，不做绿底容器。
- §三.1 单行 ellipsis、两行 line-clamp；缺省图三态（加载 / 缺省 / 失败）比例底色不变。

## 2. 旧版 Bingo 圆徽标考古结论

### 2.1 出处

- 提交：`b9a9587`「左轨 Bingo/场地独立侧栏，Bingo 收甲方反馈 (#38)」（2026-10-31）。
- 包含该提交的 tag：`v2.3.0` → `v3.5.0`（之后重构为当前四形体 + 状态点体系）。
- 当时文件：
  - `frontend/components/room-organizer/panels/bingo-rail-button.tsx`（旧版，55 行）
  - `frontend/components/room-organizer/lib/bingo-status.ts`
  - `frontend/components/room-organizer/lib/bingo-feedback.ts`
  - `frontend/components/room-organizer/panels/bingo-panel.css`
  - `frontend/app/globals.css`（`.sc-bingo-ball` 段）

### 2.2 旧版三态与徽标形制

状态来自本机 localStorage 快照（`readBingoSnapshot`），三态 `BingoPhase`：

| 旧态 | 含义 | 旧版视觉 | 数字 |
|---|---|---|---|
| `to-send` 待发 | 还没发评审标记、也没有回执 | 中性 hair 描边、白纸底、faint 内圈 | 不显示 |
| `awaiting` 待评 | 有待评审链接 | warn `#96651F` 2px 描边 + 3px warn 16% 光晕；`data-count` 经 `::after` 出数字，13px/600 warn 色 | `plans.length`，仅待评时出 |
| `returned` 已回执 | 甲方完成评审写来回执 | err `#B4443C` 3px 描边 + 4px err 22% 光晕；内芯 err 圆点 | 不显示数字 |

旧版按钮本体是 40×40 正圆（`border-radius: 999px`），不是形体头像；数字直接画在圆里（`content: attr(data-count)`）。

### 2.3 现状：数据层还在，UI 被拆

- `lib/bingo-status.ts`、`lib/bingo-feedback.ts` 至今仍被 `panels/bingo-panel.tsx`、`panels/bingo-audit-card.tsx` 引用，测试 `bingo-status.test.ts` / `bingo-feedback.test.ts` 都在。
- 拆掉的只是轨钮上的徽标 UI。`agent-panel.tsx`（约 1567 行）注释明确写了当时的裁决：「禁把角标叠画在头像上，所以状态靠换图，不用徽标。」
- 可直接复用的现成能力：
  - `readBingoSnapshot(storage)` → `{ phase, plans, receipt }`
  - `bingoPhase(plans, hasReceipt)`、`bingoPhaseLabel(phase)`、`bingoBallLabel(snapshot)`
  - 画内钉未读数：`lib/review-pins.ts` 的 `countOpenPins(pins)`（open 计数，resolved 不计）
  - 现有状态轨：`lib/lane-status.ts`（`LaneId = door | bingo | space | material`，严重度 warn > busy > ask > idle）

### 2.4 与记忆的差异（已记裁决）

你记忆里是「圆里有数字，根据情况变红变绿」。旧版实际配色是：待评 = 赭（warn）、已回执 = 红（err），**没有绿态**。设计规范语义色里绿 = 成功 / 已闭环。

**本轮裁决**：先把旧版圆徽标形制改回来，配色与状态语义后面再调；§5.2 的红绿重映射表留作后续讨论稿，不阻塞第一轮恢复。

## 3. 统一卡片视觉

### 3.1 展开态 · 左列对话卡（各枚同一壳）

统一一行结构（收起时退化为 §3.2 的 64px 轨钮）：

```
[ 28 图标槽 ] [ 标题 C1 14/500 ink          ] [ 动作 ghost 钮组 ]
              [ 可选 meta P2 12/20 muted …   ] [ 关闭 × 最右      ]
```

- **卡片壳**：白底、1px `--hair`、`--r-md` 14、内边距 12/16；行高 44–48；列宽沿用 `left-card-width`（240–480，默认 320）。
- **图标槽**：28×28 左对齐、垂直居中，各枚同一基线；图标族分工见 §4。
- **文字列**：标题单行 ellipsis；meta 一行（如场地名「盐官潮乐之城」）P2 muted，同样单行截断；没有 meta 时不留空行。
- **动作钮组**：统一 ghost 体系——32×32 触达、16px 图标、ink-soft、hover plane；关闭钮恒在最右；其余动作（历史时钟 `schedule`、新建加号、附件 `attach_file`）按入口需要排在关闭钮左侧，不允许一行里混实心与描边两种字形。
- **选中态**：复用现有左缘 3px 绿条（`.sc-rail-disc.is-active::before`），不做绿底、不绿标题字。
- **空卡处置**：截图第六行空壳不留。无内容时按缺省图规则：`--plane` 底 + 1px hair-soft + faint 图标 + CAP 文案；加载中整块 plane 呼吸；失败换 err 描边 + ghost 重试（§三.1 / §三.2）。

### 3.2 收起态 · 64px 轨

- 40×40 触达、28 图形、标签 12/16（现状 `mobile-shell.css` 161–177）；图标槽与标签基线各枚对齐。
- 轨脚工具（保存态、设置、账户 / 素材库等）维持工具族，不与对话入口同高同列；「地球」是户外规划主轨钮，不算轨脚。

## 4. 统一图标体系

### 4.1 什么是「三族归位」

「族」= 图标按**语义来源**分成三类，不是把六种图形硬画成同一个样。「归位」= 每个入口按它代表的东西回到对应那一类；统一的是容器尺寸、视觉重量、配色规则，图形本身允许不同。

- **A 角色形体族**：代表一个 Agent / 角色，用手绘软形体 + 白眼，职责是「认人」。
- **B 通用工具族**：代表一个功能动作（打开资料、拍照、搜索…），用本地 Material Symbols 实心图标，职责是「认动作」。
- **C 人物头像族**：代表真实成员，用照片或首字母圆片，职责是「认身份」。

设计规范允许角色形体与领域图形作为例外存在。各入口按三族归位（2026-11-13 校正）：

| 族 | 入口 | 图形 | 规则 |
|---|---|---|---|
| A 角色形体 | 小景 door（唯一 Agent） | 复用 `RailAvatar` 28px + 白眼体系 | 轨钮上只保留这一枚形体；Bingo 按 D 方案退为 28px 状态圆徽标，不再占 ball 形体槽；`cube` / `pyramid` 两枚 PNG 与 `RailForm` 残留于 `AGENT_META` 与面板头 36px 头像，是否一起退成 Material 列入第二轮讨论，不在本轮动画法 |
| B 通用 UI | 空间（`grid_view`）、物料（`inventory_2`）、户外规划（`public`）、拍摄场地（待换 `photo_camera`） | 本地 Material Symbols 实心图标，`solid-icons.tsx` 注册 | 现状空间 / 物料 / 户外已是 Material；拍摄场地换掉自绘描边 SVG；28 槽内图形收至 78%–90% 视觉缩放，`currentColor` 取色；尺寸档对齐规范 20 / 24，现状 26px 一并核齐 |
| C 人物头像 | 给自己留话 | 保留 `account-avatars` 1:1 圆片（预设图 / 首字母 + tone 分色） | 与「团队与权限」面板头像同片同色，两处必然对得上 |

### 4.2 备选方案（不推荐，列出供讨论）

- **方案 2 · 全部 Material 同族**：唯一形体也退成实心图标，放弃角色身份。与品牌形体资产（§一.4 左轨入口、标志门厅）冲突，不推荐。
- **方案 3 · 给场地和人补软形体**：让各枚都长成 mascot。成本高，且人物头像有真实身份语义，不该被卡通形体覆盖，不推荐。

### 4.3 图标安排与成熟案例对照

定位：第一格小景是唯一 Agent，走身份槽；其余是工具 / 动作 / 真人入口，按族归位。成熟产品的通行分法与可借鉴点：

| 分组 | 我们的入口 | 成熟案例 | 可借鉴点 |
|---|---|---|---|
| 助手 / Agent 身份槽 | 小景 door | Slack 侧栏 bot 头像（圆角头像 + bot 标记）；Discord 机器人头像；Notion AI 条目 sparkle；ChatGPT 侧栏助手字形 | 助手位用圆角头像式形体，与下方工具图标在轮廓上分层；不与工具钮同一直方实心族 |
| 工具功能槽（同族实心） | 空间 `grid_view`、物料 `inventory_2`、拍摄场地 `photo_camera`、户外规划 `public` | VS Code 活动栏（同族实心、同尺寸、同视觉重量）；Linear 侧栏条目图标；Notion 侧栏页面 / 数据库 / 模板图标；Slack 频道列表 | 同一列工具钮用同一字形库、同一填充与尺寸档；图形只表达动作 / 对象，不带角色脸 |
| 状态 / 通知徽标 | Bingo D 圆 | iOS Messages、微信、Discord 未读圆；macOS 头像在线状态环；VS Code 活动栏条目计数 | 计数收进同一颗 28px 圆；闭环用勾形；状态色描边 + 轻光晕；不另起浮层角标 |
| 真人身份槽 | 给自己留话 | 微信 / Discord 私聊头像 + 未读圆；团队成员状态头像 | 头像族保留照片 / 首字母圆片；未读圆与 Bingo 徽标同形同尺寸，只配色不同 |
| 领域面板内部工具 | 户外面板工具栏 | 本项目已落地的 Lucide 线条族（`outdoor-plan-icons.ts`）；Figma / Miro 画布工具栏线条图标 | 面板内工具可走独立线条族作领域例外；不把这套线条拉进左轨 |

## 5. Bingo 圆数字徽标恢复方案

### 5.1 形态与定位（第一轮：变体 D · 同尺寸圆内数字）

- 第一轮走草图变体 D：保留旧版「圆内有数 / 圆内有勾」的识别，但本体就是 **28px** 圆，与其他三格形体槽同尺寸；**不退回旧版 40px 整圆**。注：第一轮「不在角上叠第二层徽标」的约束，已被第二轮双计数角标式（§5.4）有条件打开——仅用于承载第二个数 P/L，不叠状态色角标。
- 圆内数字 11px / 600，`tabular-nums`；计数为 0 不画；`>9` 显示 `9+`（沿用成员徽标截断规则）。
- 三态形制：待发 = hair 描边空圆；待评 = 状态色描边 + 圆内数字；已回执 = 状态色描边 + 勾形（不画数字）。
- 备选变体 A（28 形体不动、右上角叠 16px 角标数字圆，iOS / 微信风）仅在 D 落地后发现圆内数字挤到形体面部时再议；草图见 `docs/visual-2026/bingo-badge-sketch-2026-11-12.html`。
- 徽标本身 `aria-hidden`，状态与计数写进 `aria-label` 和 `data-tip` 人话；不能只靠颜色区分状态（§三.5 无障碍）。

### 5.2 状态表（后续讨论稿，第一轮不锁配色）

| 状态 | 数据来源 | 徽标建议 | 旧版对照 |
|---|---|---|---|
| 待发 `to-send` | 无评审标记、无回执 | 不画徽标（休眠） | 旧版中性描边 |
| 待评 `awaiting` | `plans.length > 0` 且无回执；或未闭环画内钉 > 0 | 待定：err 红底白字 / 旧版 warn 赭描边 + 赭字 | 旧版 warn 赭 |
| 已回执 `returned` | 有回执；或画内钉全部 resolved | 待定：ok 绿底白勾 / 旧版 err 红描边 + 红芯 | 旧版 err 红 |
| 出错 `warn` | `lane-status` 报 warn | err 描边 + 白字 `!`，不画数字 | 沿用现有出错爆红规则 |

> 留到第二轮定：① 已回执用绿还是沿用旧版红；② 待评用 err 红还是 warn 赭；③ 双计数在徽标上的呈现方式（§5.4）。

### 5.3 接线边界

- 只给 Bingo 格恢复数字徽标；第一格 / 空间 / 物料继续用 9px 状态点，不扩散数字徽标。
- 数据优先读现有 `readBingoSnapshot`；画内钉口径接反馈里的 open 钉；两路合并沿用 `lane-status` 的严重度排序，谁报的活儿谁撤。
- `bingo-status` 目前是 localStorage 本机记录，未接 Supabase；徽标先沿用本机口径，跨设备同步另立工单，不在本轮做。

### 5.4 双计数：链接数与钉数同时体现

两个口径先分开定义，避免后面混：

- **链接数 L**：待评方案数 = `plans.length`（评审链接已发出、尚未回执）。
- **钉数 P**：这些方案下未闭环的画内钉总数 = 对每个 plan 调 `readBingoPlanFeedback(plan)`，把 `pins` 里 `pinStatus === 'open'` 的条数求和；`resolved` 不计。

徽标上怎么同时放下两个数，三个方案（第二轮定，第一轮先只出旧版单计数）：

| 方案 | 徽标呈现 | 优点 | 代价 |
|---|---|---|---|
| **A（推荐先做）** | 圆内只出主数 **P**（未闭环钉，最紧急）；**L** 不进徽标，写进面板头摘要与 `data-tip` / `aria-label`：「链接 2 · 钉 5」 | 徽标保持 16–18px 清爽；主次分明；无障碍文案仍能读出两路 | 收起轨上一眼看不到链接数 |
| B 圆内双行 | 徽标放大到 20–22px，圆内上下两行小字：上钉下链，各自 `9+` 截断 | 轨上直接看到两路 | 圆内拥挤，小字号在移动端 dock 上可读性差 |
| C 双徽标叠加 | 主圆出钉数，角上再叠一颗小圆出链接数 | 两路都是独立视觉 | 双层徽标与「不叠角标」旧裁决冲突，视觉偏重 |

> 第一轮按旧版单计数落地（口径先用 L，与旧版 `data-count = plans.length` 对齐）。**第二轮裁决（2026-11-13）**：双计数采用角标式（草图式 4）——主圆 P、角标 L；原方案 A（P 进圆、L 进 tooltip）作为不挂角标的退路。回执勾形态是否仍带角标、三态配色仍待定；落地前 P 按 `readBingoPlanFeedback` 逐 plan 求 open 钉总和。

## 6. 逐入口讨论清单

1. **第一格（总控 / 活动，door）**：改名「小景」本轮搁置，保留原称呼（轨钮「总控」、`AGENT_META.door.name`「活动」），不做全量替换；内部 id `'door'` 不动。待议：历史时钟、新建加号这两个动作留在卡里还是收进面板头；称呼是否再议留到第二轮。
2. **Bingo**：第一轮先恢复旧版圆徽标；第二轮再定 §5.2 三态配色、§5.4 双计数呈现；徽标恢复后，面板头换切图（`mascotOf`）是否保留，还是头图也跟着状态走同一套语义色。
3. **空间**：轨钮已是 Material `grid_view`；待议是面板头 36px `cube.png` 形体是否也退成 Material，还是保留角色头；meta 行放什么——当前场景名、模板名，还是留空。
4. **物料**：轨钮已是 Material `inventory_2`；面板头 `pyramid.png` 同上待议；截图里的回形针附件动作，归属是物料卡还是输入条（参考 `attach_file` 已在输入区登记）。
5. **拍摄场地**：图标换 `photo_camera`；行为已是面板开关（`openCapturePanel` / `closeCapturePanel`），不是外链锚点；meta 是否展示当前场地名；选中态、`aria-current` 与其他入口保持同一行为。
6. **户外规划**：Material `public`；本轮先对齐图标尺寸与槽位基线；状态点 / meta 是否需要，第二轮随户外链路定。
7. **给自己留话**：头像族保留；未读数字徽标与 Bingo 数字徽标同形同尺寸，只配色不同；成员为空时的占位态沿用团队块现有 `is-placeholder`。

## 7. 落地顺序（待点头后）

1. **规范先行**：补 `docs/05-设计规范.md`——左轨入口三族表、徽标 token 与状态表，版本号 +0.1；可视稿 `design-spec-2026.html` 同步。
2. **组件落地**：统一卡片壳与图标族归位；第一格称呼保持原样；Bingo 按变体 D 接回 `bingo-status`（28px 圆内数字，不新建存储，第一轮单计数 L）。
3. **测试**：既有回归 `bingo-rail-button.react.test.tsx`、`rail-side-panels.react.test.tsx`、`rail-team-block` 相关用例；同步更新 `workbench-rail-head.react.test.tsx` 里过时的四形体 / 3 枚 disc 断言；新增徽标三态（待发 / 待评 / 已回执）单测与 `9+` 截断、aria-label 断言。
4. **验收**：tsc + 前端面板测试全绿；真机过三态——桌面 64px 收起轨、展开左卡、移动端 dock；通过后本地攒好一次性推 main，不拆小步开 PR。

## 8. 风险与边界

- 不新增左轨第四种下区形态（`docs/07-空间与物料Chat设计.md` 已定：空间 / 物料对话面复用 Bingo 外壳）。
- 品牌绿不进卡片底色；徽标一律走 L1 语义 token，组件 CSS 不写私有色值（§四.1）。
- 头像与角色形体属领域例外，不被通用 Material 图标库收编。
- 本轮只做左栏入口视觉与徽标；会话索引（`session-history-panel`）、面板内气泡与输入条不在范围内。

## 附录 · 考古索引

- 旧版提交：`b9a9587`（PR #38）；包含 tag `v2.3.0`–`v3.5.0`
- 旧版轨钮：`git show b9a9587:frontend/components/room-organizer/panels/bingo-rail-button.tsx`
- 旧版状态球样式：`git show b9a9587:frontend/app/globals.css`（`.sc-bingo-ball` / `[data-status]` / `[data-count]::after` / `.is-returned`）
- 现行数据层：`frontend/components/room-organizer/lib/bingo-status.ts`、`bingo-feedback.ts`
- 现行状态轨：`frontend/components/room-organizer/lib/lane-status.ts`
- 画内钉：`frontend/components/room-organizer/lib/review-pins.ts`（`countOpenPins` / `ReviewPinStatus = open | resolved`）
- 现行轨钮组装：`frontend/components/room-organizer/room-organizer.tsx` 4292–4375（`sc-mode-rail` → `sc-rail-head` → `sc-mode-rail-primary` → `RailTeamBlock`）
- 图标注册表：`frontend/components/solid-icons.tsx`（Material 映射，`Camera`=`photo_camera` 已登记）、`panels/material-symbol.tsx`（字形 / mask SVG 渲染）、`panels/kind-icons.tsx`（概念→图标统一映射）；户外面板内部工具钮用独立 Lucide 线条族 `components/outdoor-plan-icons.ts`（领域例外，不进左轨）
- 候选草图：`docs/visual-2026/bingo-badge-sketch-2026-11-12.html`（旧版还原 + 变体 A/B/C/D，配色可切换）；整栏统一草图：`docs/visual-2026/sidebar-rail-unification-sketch-2026-11-13.html`（收起轨 + 展开卡壳 + D 徽标三态 + 三族归位表 + 参考案例）；图标候选对照：`docs/visual-2026/icon-options-sketch-2026-11-13.html`（每入口多枚本地 Material 字形备选 + 风格方向 + 案例表）
- 基线核对（2026-11-13 二次复核）：分支已切回 `main`，HEAD = `origin/main` `6e73d28f`，0 ahead / 0 behind；较上次基线 `7d38fb57` 合入 24 个提交，主体是户外 2D/3D 规划链路、场地轮廓、偏好与单位、站点改版；**左轨入口结构与图标未变**（仍为 brand + Bingo / 空间 / 物料 / 拍摄场地 / 户外规划 + 团队块）。工作区仅 1 个已跟踪文件未提交：`components/outdoor-plan-3d.tsx`（户外在制品，非轨栏）；方案与草图文档已随 main 入库。
