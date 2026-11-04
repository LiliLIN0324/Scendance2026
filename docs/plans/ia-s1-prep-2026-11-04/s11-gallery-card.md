# S1.1「活动开场画廊」审计 + 施工卡（分片 A）

> 日期：2026-11-04
> 范围：只读前置审计。审计对象 `frontend/components/room-organizer/panels/local-activities-panel.tsx` 及其 CSS、测试、数据流 lib、全仓挂载点。
> 证据口径：全部行号为本次实读工作树的真实行号（Windows，`C:\mujing\Scendance2026` 活仓库）。导演台账 `docs/plans/ia-role-rework-ledger-2026-11-04.md` 的锚点已发生漂移，漂移清单见 §5 与 §8。
> 重要前提：审计进行期间主线程正在同树实施 S1.0，`agent-panel.tsx` 被实时改写（同一 grep 间隔内 `talkTo` 从有到无）。凡受 S1.0 影响的判断均已标注「待 S1.0 落地后复核」。

---

## 1. 审计结论速览

- **是否存在生产挂载点：不存在。** `LocalActivitiesPanel` 在整个 `frontend/` 下只被两个测试文件 import（`local-activities-panel.react.test.tsx:13`、`creative-studio.react.test.tsx:23`，后者仅测试内 harness 用法 `:1637`），生产树零 import、零 JSX。组件 prop 注释自述的两个历史挂载点（「rail 的新建活动 popover」`mode='create'`、「账号面板的项目列表」`mode='list'`，见 `local-activities-panel.tsx:22,26`）均已退役：`account-team-panel.tsx:3-8` 现在只 import 团队数据，不再挂本面板。
- **核心风险**：
  1. 组件本身是「功能完整但生产不可达」的孤儿——290 行测试、174 行 lib、42 行封面模块都在为一个没人挂载的面板服务；S1.1 的第一件事不是重写，是**接线挂载**。
  2. 挂载宿主 `agent-panel.tsx` 正被 S1.0 同刀改写（见 §5），S1.1 若并行改同一 `ap-feed` 区域（现 `agent-panel.tsx:1854-1919`）有直接冲突风险。
  3. 「打开一个旧活动」的完整事务链（归档当前 → 读旧档 → restoreBackup）已经写好且有 15 组测试覆盖，但链路起点（点卡动作）目前藏在卡片内一个 28px 高的小按钮里（`local-activities-panel.tsx:225`），画廊化的主要工作是**交互层改造**而非数据流改造。
- **一句话结论**：S1.1 = 把孤儿面板接进活动脸（door）+ 把列表改造成卡网格 + 整卡直入（复用现有 `switchActivity` 事务，不弹新建向导）。数据流、封面体系、测试资产全部可复用，不需要新建存储。

---

## 2. 组件现状审计

### 2.1 Props 全表

组件签名：`local-activities-panel.tsx:40`；接口定义 `:18-29`。

| prop | 类型 | 含义 | 当前传参方（file:line） |
|---|---|---|---|
| `layout` | `RoomLayout`（`:19`） | 当前打开画布布局；`layout.id` 是 scope 与「当前卡」判定依据 | 测试：`local-activities-panel.react.test.tsx:60,77,80,93,110,131,142`；`creative-studio.react.test.tsx:1637`。**生产：无** |
| `actions` | `LocalProjectBackupActions`（`:20`，类型定义 `creative-studio.tsx:55-58`） | `prepareBackup(options?): Promise<string>` / `restoreBackup(candidate): Promise<void>` / `undoRestore(): Promise<void>` / `backupPending: boolean` / `canUndoRestore: boolean` | 同上。生产侧 Provider 实现：`creative-studio.tsx:436`（`restoreBackup`），Context 取值 `useLocalProjectBackup()`（`creative-studio.tsx:89`） |
| `disabled` | `boolean`，默认 `false`（`:21,40`） | 总闸；参与 `locked` 判定（`:109`）与 token 签发（`:111`） | 测试 `:60`；生产：无 |
| `mode` | `'all' \| 'create' \| 'list'`（`:23`） | 三态分支，见 §2.2 | 测试 `:77`（create）、`:80,93,110,131,142`（list）；生产：无 |
| `currentStatus` | `string`，默认 `''`（`:25,40`） | 印在「当前卡」副行的保存状态（如「有改动待保存」），`:214` 拼接 | 测试 `:93`；生产：无（历史调用方已不可考） |
| `isActivityVisible` | `(projectId: string) => boolean`，默认恒 `true`（`:27,40`） | 团队过滤：账号面板隐藏他队活动（注释 `:26`）；当前画布永不被滤掉（`local-activities-panel.tsx:174` 只滤 archives） | 测试 `:110-111`；生产：无 |
| `onComplete` | `() => void` 可选（`:28`） | 切换事务成功收尾后回调（`:158`） | 测试 `:54,60`；生产：无 |

### 2.2 mode 三态分支行为

分支开关在 `local-activities-panel.tsx:41`：`showCreate = mode !== 'list'`，`showList = mode !== 'create'`。

| mode | 创建表单 | 归档列表 | 证据 |
|---|---|---|---|
| `'all'`（默认） | 显示 | 显示 | 表单 `:183-197`；列表 `:198-230` |
| `'create'`（原 rail popover） | 仅表单 | 不显示（`:70` 不触发 `refresh`，`:74` 不订阅命名空间） | `:183` 的 `showCreate &&` |
| `'list'`（原账号列表） | 不显示 | 仅列表 | `:198` 的 `showList &&` |

创建表单内部（`:187-196`）：活动名称输入（`maxLength=MAX_NAME_LENGTH`，schema `lib/schema.ts:46` = **200**）+ 两个 radio（`'empty'` 空场地 10×8 / `'reuse-layout'` 沿用当前布置，`:191-192`）+ 提交按钮「新建活动」（`:194`）。

### 2.3 完整数据流

**读列表**
- `refresh()`（`:56-67`）调 `listLocalActivities()`（lib `local-activities.ts:114-129`）：读 `source-storage` 复合键命名空间 `'local-activity'`（`local-activities.ts:13`）全部记录 + `readActivityCovers()`（封面模块 `activity-cover.ts:20-27`）；按 `archivedAt` 倒序（`local-activities.ts:127`）；坏记录进 `unreadableProjectIds`（`:125`）。
- 命名空间订阅自动刷新（`:74`）：`subscribeSourceNamespace(namespace, listener)`（`source-storage.ts:77-79`）——任何面板实例写完归档都会触发列表重读。
- 旧档补封面 effect（`:76-84`）：列表里当前 scope 的旧档若无封面，调 `ensureActivityCover(scope)`（`activity-cover.ts:37-42`）当场补拍。
- 当前画布即时定格 effect（`:86-96`）：`IntersectionObserver` 观察本面板 section，可见时 `captureStageCover()`（`stage-cover.ts:11-13`）拍一张活 3D 图，存 state 覆盖「当前卡」缩略图（`:176-177`）。

**写 / 切换事务** `switchActivity(targetId?)`（`:129-170`）：
1. 名称校验（`:130`，新建时）→ `begin()` 发操作 token（`:110-117`），token 绑定 epoch/scope/permissionEpoch（`:112-113`）。
2. `actions.prepareBackup()`（`:134`）——Provider 侧（`creative-studio.tsx:436` 起的 `restoreBackup` 同族链路）先 flush 当前需求与资料，产出完整 V3 备份文本。
3. 拍封面（`:137`，在场景交换前拍出去的画布）→ `archiveLocalActivity(text, scope, assertCurrent)`（`:138`；lib `local-activities.ts:70-92`）：原生提交 + 独立回读比对（`:87-90`），点验账册合并防旧快照抹掉事实（`:78-82`）→ `saveActivityCover(scope, cover)`（`:139`；`activity-cover.ts:30-34`，封面写失败不影响归档）。
4. 分支：打开旧档 `readLocalActivity(targetId)`（`:144`；lib `local-activities.ts:94-97`）／新建 `createLocalActivityBackup(archived.layout, name, mode)`（`:146`；lib `local-activities.ts:161-174`：新 id `house-${crypto.randomUUID()}`（`:165`），`empty` 模式用 INITIAL_LAYOUT 空地面（`:168`），`reuse-layout` 剥离 notes/handoff/designBook/backend 等（`:132-158`），**brief 与点验账册强制 absent**（`:172-173`）——新活动绝不带入旧业务数据）。
5. `parseLocalProjectBackupJson`（`:147`）→ `assertCurrent` 复核（`:149`）→ `actions.restoreBackup(candidate)`（`:153`）走 Provider 完整恢复事务（含撤销点，`creative-studio.tsx:116` 的 `undoPoint` 结构）。
6. 收尾闸（`:155-159`）：token 仍活 + permissionEpoch 未变 + scope 命中才显示「已打开」并调 `onComplete`；中断/被抢占一律不报错、保留输入（`:160-164`）。

**判定口径事实**
- 「当前卡」= `layout.id` 命中列表第一条（`:207`），副本从归档列表剔除（`:174`）。
- `identityMissing`（`:107`）：当前活动无 `layout.id` 时禁止一切新建/打开，并显式报错（`:182`）。
- `locked`（`:109`）= disabled || 无编号 || 忙（`working` 或 `actions.backupPending`，`:108`）。
- 存储口径：**本地**。归档 = `source-storage` 命名空间（IndexedDB 域），封面 = 独立命名空间 `'local-activity-cover'`（`activity-cover.ts:5`），上限 400KB（`:7`）；不碰 Supabase（D7）。云端项目列表是另一套：`app/projects/page.tsx:11,54` 走 `workspace-api` 的 Studio/ProjectSummary，与本面板无关。

---

## 3. CSS 现状（`local-activities-panel.css`，33 行）

| 类名 | 职责 | 行号 |
|---|---|---|
| `.sc-local-activities` | 根容器：grid、gap 16px、12px 字号 | `:1` |
| `.sc-activity-group` | 分组卡：paper 底 + hair 边 + 10px 圆角 | `:2` |
| `.sc-activity-head` / `h3` / `.sc-settings-title` | 分组头：标题 + 计数 chip + 刷新钮 | `:3-5` |
| `.sc-activity-form` / `.sc-field` / `.sc-local-activities-modes` / `.sc-activity-create` | 创建表单区（名称输入、radio 行、提交钮） | `:6-14` |
| `.sc-activity-refresh` | 刷新按钮（28×28 幽灵钮） | `:15-17` |
| `.sc-activity-status` | 状态/空态/进度行文案 | `:18` |
| **`.sc-local-activities-list`** | **已是卡网格**：`repeat(auto-fill,minmax(190px,1fr))`、gap 12px、padding 12px | `:20` |
| `.sc-local-activities-list li` | **已是卡**：纵向 flex、paper 底、hair 边、10px 圆角 | `:21` |
| `.sc-activity-thumb` | 封面区：`aspect-ratio:320/190`、plane 底 | `:22` |
| `.sc-activity-thumb-image` / `-canvas` / `-empty` | 封面图 / PlanThumb 平面缩略图 / 空态 FolderOpen 占位 | `:23-25` |
| `.sc-activity-current` | 「当前」角标（ink 底 paper 字胶囊） | `:26` |
| `.sc-activity-card-body` | 卡身：名称（两行截断 `:29`）+ 副行（一行省略 `:30`） | `:27-30` |
| `.sc-activity-open` | 「打开」小按钮（28px 高、hair 边幽灵钮） | `:31` |
| 媒体查询 | 480px 以下收 padding | `:33` |

**可直接复用为画廊网格的部分**：网格轨道（`:20`）、卡容器（`:21`）、320:190 封面区（`:22`）、封面对象裁切（`:24`）、名称两行截断（`:29`）、副行省略（`:30`）——**骨架已经是画廊**，不是列表。

**缺口（S1.1 要补）**：
1. 没有「整卡可点」的视觉态（hover/pressed/focus-visible）；现在只有内嵌小按钮 `:31` 是可点区。
2. 没有状态短词 chip 样式（现成 token：品牌绿 `--wk-green*`，`globals.css:105-107`）。
3. 没有「＋新建活动」拼贴卡（dashed border tile）样式。
4. 空态（无任何归档）只有一行灰字（`:229`），没有引导拼贴。
5. 全部消费 token：`--wk-paper/--wk-hair/--wk-ink/--wk-plane/--wk-plane-deep/--sc-muted/--sc-line/--wk-muted/--faint`（别名定义 `app/globals.css:95-107,515-516`）——**不引入新色系的约束天然满足**。

---

## 4. 测试现状（`local-activities-panel.react.test.tsx`，290 行，单 describe `:72`）

用例级清单（15 组）：

| # | 用例 | 行号 | 覆盖点 |
|---|---|---|---|
| 1 | mode 三态切分：create 只见表单、list 只见列表 | `:73-83` | mode 分支（§2.2） |
| 2 | 当前画布固定第一卡；同 scope 归档去重；currentStatus 上卡 | `:85-100` | `:174,177,207-215` |
| 3 | `isActivityVisible` 滤掉他队活动且不入计数；当前卡不被滤 | `:102-117` | `:174` |
| 4 | 面板进入视口时活拍 3D 定格（mock IntersectionObserver + `registerStageCover`） | `:119-135` | `:86-96` |
| 5 | 封面图优先于 PlanThumb 平面缩略图；刷新后切换 | `:137-151` | `:218-222` |
| 6 | it.each(['empty','reuse-layout'])：先归档当前、新活动无旧 brief/点验/任务/设计簿 | `:153-172` | 新建全事务 |
| 7 | prepare/archive/readback/restore 各段失败都保留姓名输入、不报成功 | `:174-187` | 失败闸 `:160-164` |
| 8 | 连点「打开」只发一次归档；归档完成后才读目标并恢复 | `:189-202` | token 防重入 |
| 9 | 不可读归档告警；损坏目标拒绝且不动当前活动与原列表 | `:204-214` | `:205` + 读失败 |
| 10 | 布局编辑 / A→B→A / 卸载三种中断都使旧 token 失效 | `:216-232` | epoch 闸 `:97-105` |
| 11 | disabled / 缺编号 / backupPending 三闸直接拒提交 | `:234-244` | `:108-111` |
| 12 | 恢复落回无关活动时不触发 onComplete | `:246-254` | `:155-159` |
| 13 | Provider 同步换 scope、恢复后才 resolve 时 onComplete 只调一次 | `:256-268` | 收尾时序 |
| 14 | 恢复先 resolve、父级后渲染 scope 时通知保留 | `:270-280` | 通知闸 `:233` |
| 15 | disabled A→B→A 期间完成的恢复被抑制且姓名保留 | `:282-289` | permissionEpoch |

**盲区（S1.1 新测试要补的）**：
- 没有任何「整卡点击」用例（现有点击只打 `:225` 小按钮的 aria-label）。
- 没有「新建拼贴卡 → 内联命名 → 直进」路径用例。
- 没有状态短词（齐/缺、副行词）的渲染断言。
- 没有「组件挂在活动脸（door）才出现、Bingo 脸不出现」的宿主级用例。
- 没有列表为空时引导拼贴的用例。
- 没有「点卡打开旧档时不经过 create 表单/wizard」的显式断言（现用例 8 间接覆盖事务，未覆盖「不弹表单」的形态）。

---

## 5. 生产挂载点核查（全仓引用证据表）

| 引用点 | file:line | 性质 |
|---|---|---|
| 组件定义 | `panels/local-activities-panel.tsx:18,40` | 定义本体 |
| CSS 自引用 | `panels/local-activities-panel.tsx:16` | 样式 import |
| 本面板测试 import + 全部渲染 | `panels/local-activities-panel.react.test.tsx:13,60,77,80,93,110,131,142` | **测试引用** |
| creative-studio 测试 import + harness 渲染 | `panels/creative-studio.react.test.tsx:23,1637` | **测试引用**（验证 Provider actions 与面板联动） |
| 历史挂载自述（prop 注释） | `local-activities-panel.tsx:22,26` | 注释，对应实现已不存在 |
| `account-team-panel.tsx` | `:3-8` 仅 import 团队数据/头像/InfoTip | **不挂载本面板**（'list' 模式历史调用方已退役） |
| rail popover / 新建活动入口 | 全仓 grep「新建活动」仅命中 `local-activities-panel.tsx:185,187,194` 与云端页 `app/projects/page.tsx:145` | **生产树无 rail popover**（'create' 模式历史调用方已退役） |
| 样式类消费方 | grep `sc-activity|sc-local-activities` 全仓：仅本面板 tsx + css | **无第二消费方** |

**结论：生产零挂载。** 完整生产出口链（供挂载选址）：`app/page.tsx`（`export default function Page(): null`，`:1-3`）→ `app/editor/page.tsx:1` 只是 `export { default } from '../page'` → 真实壳在 `components/workspace-shell.tsx:102` 渲染 `<RoomOrganizer>` → `room-organizer.tsx:1942` `CreativeStudioProvider` 包裹 → `:1946` `LayoutAgentProvider` → `:2017` `<AgentPanel .../>`（slot 体系：`spaceSlot`/`materialSlot`/`chatSlot`/`reviewSlot`/`deliverySlot`）。

**S1.0 漂移实况（待 S1.0 落地后复核）**：
- 台账锚点 vs 实读：AGENT_META 台账 `:1742-1749` → 实读 `agent-panel.tsx:1745-1750`（door 已改名「活动」`role「活动需求、布置生成与方案确认」`，`:1746`）；AgentPanel 默认 activeAgent 台账说 `'bingo'`（原 `:1827`）→ 实读签名默认已改 `activeAgent = 'door'`（`:1752`）；PlanHome 台账 `:1947` bingo 门控 → 实读 `:1860` 已改为 `activity && mode === 'layout'` 门控（`:1860-1866`）；假分派三件套（`AgentControlCard`/`dispatchRecords`/`talkTo`）全仓 grep **零命中**，composer 已回到 `agent.send(draft)`（`:1943,1955`）。
- **未落的一刀**：`room-organizer.tsx:217` 仍是 `useState<AgentId>('bingo')`——room 级默认脸还没翻到 door。S1.1 画廊的可见性直接依赖这一刀：翻面前用户首屏是 Bingo 脸，画廊不在首屏。

**挂载建议（位置 + 理由）**：
- 首选：**`AgentPanel` 活动脸的 `ap-feed` 顶部**（实读 `agent-panel.tsx:1854` 的 feed div 内、`:1860` PlanHome 之前），新增一个条件渲染 `{activity && mode === 'layout' && <ActivitiesGalleryMount .../>}`。
- 理由：
  1. AgentPanel 已在 `CreativeStudioProvider`（`room-organizer.tsx:1942`）内部，新包装组件内直接 `useLocalProjectBackup()`（`creative-studio.tsx:89`）取 actions——与测试 harness `creative-studio.react.test.tsx:1637` 同一接法，零 prop 穿洞。
  2. AgentPanel 已通过 `useRoomEditor()` 拿 `layout`（`agent-panel.tsx:1774`），`disabled` 可取既有保存/忙状态（待 S1.0 落地后复核取值源）。
  3. 门控 `activity` 天然把画廊关在 door 脸；Bingo 脸（S2 审校）不受污染，空间/物料脸（S3）也不进。
  4. 与 PlanHome 的关系正好互补：PlanHome 只在 `layout === INITIAL_LAYOUT` 时出现（`plan-flow.tsx:156-159`）——新建空活动后画廊仍在，PlanHome 在其下方出现，「选卡进工作台 → 一句话出方案」形成完整冷启动链。
- 备选（若不想动 AgentPanel 纯度）：走 slot 体系，在 `room-organizer.tsx:2017` AgentPanel 上传一个 `activityGallerySlot`，由 room 级组装后传入。代价：多一层 prop 与 room-organizer 同树冲突面，不推荐。

---

## 6. S1.1 分步施工卡

### 6.1 目标形态

- 封面卡网格进活动脸：每卡三要素 = **封面图（320:190）/ 活动名 / 状态短词**。
- 点卡整卡一键进入该活动工作台，**不弹 create 表单、不弹配置向导**；「打开」小按钮退化为卡面内可去的次要目标。
- 网格末尾一张「＋ 新建活动」拼贴卡：点击就地展开极简命名（名称必填 200 字内），默认 `empty` 空场地，提交即复用现有创建事务。
- 状态短词候选（事实可支撑）：物件数（`itemCount`，`local-activities.ts:123`）+ `齐/缺`（现成函数 `mode-shell.tsx:14-16` `dossierStatus`，itemCount>0 即齐）+ 相对归档时间（现 `archivedStamp` `local-activities-panel.tsx:34-38` 是完整日期，画廊可压成「x 天前」，格式函数小改即可）。

### 6.2 组件改法分步（落点全部 file:line）

**A. 挂载接线（新增）**
1. 新增轻量包装组件（建议放 `panels/` 下新文件，如 `activities-gallery-mount.tsx`）：内部 `useLocalProjectBackup()` 取 actions（`creative-studio.tsx:89`），`useRoomEditor()` 取 layout（照 `agent-panel.tsx:1774` 的取法），渲染 `<LocalActivitiesPanel mode="list" layout={layout} actions={actions} .../>`。**mode 定为 `'list'`**——画廊只要网格，创建表单不在此形态。
2. 在 `agent-panel.tsx:1854` feed 内、`:1860` PlanHome 之前挂条件渲染：`{activity && mode === 'layout' && <ActivitiesGalleryMount/>}`。
   - **待 S1.0 落地后复核**：此处 S1.0 正在改写（feed 区 `:1854-1919` 与门控 `:1860`），插入点以合并后的实际行号为准。

**B. 面板内改造（改 `local-activities-panel.tsx`）**
3. **整卡可点**：归档 `li`（`:216-227`）改为整卡点击 = 现有 `switchActivity(activity.projectId)`（`:225` 的 handler 原样上移到卡容器）；保留「打开」小按钮或直接删（删按钮时同步删 CSS `.sc-activity-open` `:31` 与测试 `:99` 的按钮断言）。新增 hover/focus-visible 态（CSS §3 缺口 1）。**不要动 `switchActivity` 事务本体**（`:129-170`）——它就是「直入」的安全通道。
4. **删「当前卡」在网格中的重复渲染（建议）**：挂到活动脸后，画布本身就是当前活动，`:207-215` 的「当前」第一卡退化为冗余；可保留为「继续当前」锚点卡（保留 badge `:212`）或精简——列为设计决策，倾向**保留但视觉弱化**（当前活动仍需一眼定位）。
5. **新建拼贴卡**：在 `showList` 分支（`:198-230`）列表末尾追加一张 `li`（dashed tile），点击展开内联命名输入 + 提交；提交复用 `create(event)`（`:171`）与 `switchActivity()`（`:129`，targetId 缺省即新建）。**mode='list' 下 `showCreate` 为 false，表单不渲染**——拼贴卡要在 list 分支内自行实现极简表单，不依赖现有 `:183-197` 的 create group。
   - **不要动**：`createLocalActivityBackup` 的名称必填校验（`local-activities.ts:163`）不能绕过——「一键新建无名称」在 lib 层会抛错；若要「免命名」需另起 lib 变更（**列入开放项，不在本刀**）。
6. **状态短词上卡**：副行（`:214` 当前卡、`:224` 归档卡）由「N 个物件 · 日期」改为短词结构：如 `齐 · N 件` + 相对时间；`dossierStatus`（`mode-shell.tsx:14`）可直接 import 复用。
7. **空态**：`!listLoading && !archives.length`（`:229`）的一行灰字，改为「只有当前活动」引导文案 + 拼贴卡已在网格内，文案瘦身。

**C. 不要动什么（红线）**
- `switchActivity` 的 token/epoch/permissionEpoch 闸（`:110-128,155-164`）与 Provider `restoreBackup` 事务（`creative-studio.tsx:436` 起）——三道门（`onPreview` 绿框 → `onApplyCreative` 唯一确认 → 撤销）接线一行不碰（台账红线 E 组）。
- 归档读写 lib（`local-activities.ts`）、封面 lib（`activity-cover.ts`/`stage-cover.ts`）的任何存储键与字节上限（400KB `activity-cover.ts:7`、8MiB 备份口径见 `docs/plans/local-project-backup.md:7`）。
- `mode='create'/'all'` 分支（`:183-197`）的保留语义——rail popover 虽已退役，形态保留给后续「新建入口」复用，不在本刀删。

### 6.3 视觉约束

- 只用现有 token：`--wk-paper/--wk-hair/--wk-ink/--wk-plane/--wk-plane-deep/--sc-muted/--sc-line/--wk-green*`（`globals.css:95-107,515-516`）。状态短词的「齐」用 `--wk-green`、「缺」用 `--sc-muted` 或现有错误系（不新定义色值）。
- 不引入新依赖：封面链（`captureStageCover`/`PlanThumb`）均为现有件；网格轨道已是 `auto-fill minmax(190px,1fr)`（css `:20`），画廊放大卡面只需调 minmax 下限（如 `220px`）与 aspect-ratio（`:22` 已是 320/190）。

### 6.4 测试计划（新增/改写，挂在现有测试文件）

1. **挂载形态**：门控断言——activity 脸渲染画廊网格、Bingo/space/material 脸不渲染（宿主级，新包装组件测试）。
2. **渲染卡片数**：mock `listLocalActivities` 返回 N 条 + 当前卡，断言网格 `listitem` 数 = N + 1（+ 新建拼贴卡 = N + 2）。
3. **整卡直入**：点击归档卡任意位置（非小按钮）→ `prepareBackup`/`archiveLocalActivity`/`readLocalActivity`/`restoreBackup` 按序各一次；断言**新建表单（aria-label「新建活动」）未出现**。
4. **状态短词**：itemCount>0 显示「齐」、0 显示「缺」；名称/副行截断仍在。
5. **新建拼贴卡路径**：点拼贴卡 → 内联输入名称 → 提交 → 走现有创建事务（复用现用例 6 的断言骨架 `:153-172`）；空名提交仍被拒。
6. **回归现用例**：现 15 组（§4）中凡依赖「打开小按钮」断言的（用例 2 `:99`、用例 8 `:193`、用例 9 `:210`）按整卡交互改写；事务时序用例（7/10/12-15）**一行不改**。

### 6.5 风险与回归点

- **同树冲突**：插入点 `agent-panel.tsx` ap-feed 区是 S1.0 主战场（漂移实况见 §5）。施工纪律：S1.0 合并后再落 S1.1 插入行；包装组件独立新文件，把对 AgentPanel 的改动压到一行条件渲染。
- **本地备份兼容**：画廊只读 `listLocalActivities`（`local-activities.ts:114`）与封面命名空间；不写新存储键。旧归档（无封面）靠 `:76-84` 补拍 + `activity-cover.ts:37` 现有机制兜底，数据格式零迁移。
- **三道门确认点**：画廊「打开旧活动」走 `restoreBackup`（= 文件恢复同一事务，含撤销点 `creative-studio.tsx:116`），**不是**绕过 `onApplyCreative` 的第二条落盘路径；施工后回归门要过：绿框预览、唯一确认、撤销整体退回三条主路径各一次（台账 §4 回归门）。
- **首屏可见性依赖**：`room-organizer.tsx:217` 默认脸仍是 `'bingo'`——S1.0 翻门之前，画廊不进首屏（待 S1.0 落地后复核）。
- **IntersectionObserver 双拍**：面板自带活拍 effect（`:86-96`）与 PlanThumb 的懒绘制（`plan-thumb.tsx:75-91`）都基于 IntersectionObserver，挂进常驻左栏后 observer 数量增加，无逻辑风险，但视觉冒烟要确认定格不闪。

---

## 7. 灵感板对标要点（来源：`docs/research/ia-2026-11-04/activity-ai-workbench-gallery-2026-11-04.md`）

1. **Notion Templates（§2，`:52-71`）**：选模板 = 唯一动作按钮，无中间配置表单。→ 直接支撑「点卡直入、不弹 create wizard」（本卡 §6.1）。
2. **Airtable Gallery View（§3，`:75-95`）**：卡 = 封面图置顶 + 标题 + 2~3 个关键字段；卡面不堆全字段。→ 卡面三要素（封面/活动名/状态短词）的解剖依据；封面可换 = 现有 `captureStageCover` 机制（灵感板 `:94` 已锚定）。
3. **tuijian（§1，`:20-48`）**：卡片点选代替空白输入框；「追问收成摘要再生成」。→ S1.1 不做多轮问卷（灵感板 `:40` 已判过重）；画廊冷启动卡行已被 PlanHome chips（`plan-flow.tsx:14-28`）承接。
4. **Figma File Browser（§4，`:99-118`）**：Recents 最近网格 + Drafts 草稿箱分区；缩略图网格是标准形态。→ 归档按 `archivedAt` 倒序（`local-activities.ts:127`）已是 Recents 语义；草稿/归档分区列为后置（本刀不做）。
5. **Miro Dashboard（§5，`:122-142`）**：每卡操作收进「…」溢出菜单，卡面不堆按钮。→ 现有「打开」小按钮上卡面，S1.1 整卡可点后按钮退场；后续删除/重命名动作才走溢出菜单（后置）。
6. **Framer AI（§6，`:146-168`）**：对话是 refine 通道、画布是结果本体；三道门接线不动。→ 画廊进活动脸后与 PlanHome/composer 同屏的形态依据。
7. **Linear 进度（§10，`:242-261`）**：进度 = 分状态短词，不是 wizard n/4。→ 「齐/缺」短词（`mode-shell.tsx:14`）的直接理论依据；更细的三盘完成度列为开放设计项（灵感板 `:260` 已声明台账无现成锚点）。

---

## 8. 待核验清单

1. `room-organizer.tsx:217` 默认脸翻到 `'door'` 后，AgentPanel 首屏是否即画廊（待 S1.0 落地后复核）。
2. S1.0 合并后 `agent-panel.tsx` ap-feed 实际行号与插入点（本卡 §6.2-A-2 的 `:1854/:1860` 为本次实读快照）。
3. `disabled` 在挂载宿主的取值源（保存错误/忙状态的现成 state，实读待 S1.0 树定稿后确认）。
4. 「当前卡」在网格中保留 vs 精简的设计决策（§6.2-B-4）待 owner 拍板。
5. 状态短词是否要显示 brief 是否已填写：`LocalActivitySummary`（`local-activities.ts:15-24`）目前**不暴露** brief 状态，要显示需改 lib 列表输出——本刀不做，待核验价值。
6. 新建拼贴卡「免命名」诉求（`createLocalActivityBackup` `local-activities.ts:163` 强制非空名）是否列入后续 lib 变更。
7. 云端活动库（`app/projects/page.tsx` 走 workspace-api）与本地面板的边界文案：画廊是否需要一个「云端项目」入口（D7 已声明云端化后置，S1.1 保持本机口径并诚实标注）。
8. 历史 `currentStatus`/`isActivityVisible`/`onComplete` 三个 prop 的原生产调用方已不可考（全仓仅测试在用）；若 S1.1 不再需要团队过滤，`isActivityVisible` 是否保留待复核。
