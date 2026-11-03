# 空间 / 物料 两个 chat 的设计

> 2026-11-02 · 状态：设计稿，未实现
> 配套：`docs/design-spec-2026.md`（视觉与交互规范）、`frontend/components/room-organizer/panels/agent-panel.tsx`（对话外壳）

## 一、为什么重做这两条线

总控已经改成和 Bingo 同一场对话（同一个 agent、同一段气泡、同一套下区），但空间和物料这两格的 chat 仍是本机的「假对话」：`frontend/components/room-organizer/panels/agent-chat.tsx` 收到一句话，回一句画布读数，没有任何动作。

这两格真正的价值有两件，而且互相拉扯：

1. **生成**——空间线要能生成/重建场地，物料线要能生成模型；
2. **库**——物料库（`assets/library/model` 下 529 个内置 GLB + 线上目录 + 收藏/自建标签 + 已生成模型）和空间库（10 套场景模板、云项目、留档环境包）是产品最硬的资产。

所以设计目标不是「把库换成 chat」，而是**让 chat 成为库的操作面**：库里能做的，说一句能做；库里值得逛的，仍然能逛。

## 二、三条硬约束

| # | 约束 | 出处 |
|---|---|---|
| 1 | 一个动作只留一个入口——chat 与库不能同时提供同一动作的两个入口 | design-spec §二.2 |
| 2 | 先预览、确认后才落盘——chat 的写动作一律走提案卡 | design-spec §五.4 |
| 3 | 生成要扣额度、要二次确认、可中断可续查 | `material-generate-dock.tsx:168-172, 199, 354-359` |

## 三、形态：每条线 = 对话面 + 库面 + 一条生成轨

```
┌ 左轨格 ─────────────────────────────────────────────┐
│  对话面  ap-feed / ap-composer / 提案卡 / 过程叙述   │  ← 复用 Bingo 那套
│            （说一句话做事）                          │
├─────────────────────────────────────────────────────┤
│  库面    现有面板原样保留，不加不减                   │  ← 还能逛
│            （空间：模板/环境/结构   物料：目录/收藏/生成）│
├─────────────────────────────────────────────────────┤
│  底部    场地 | 生成      库 | 生成                  │  ← 复用 LaneSwitch
└─────────────────────────────────────────────────────┘
```

- **对话面**复用 Bingo 的外壳（`agent-panel.tsx:1747-1845` 的 `conversation` 分支），不另起一套输入条与气泡。
- **库面**就是今天的 `SpacePanel`（`space-panel.tsx:53-87`）与 `ScendanceLibrary`（`scendance-workspace.tsx:142-155`），一屏之内不折叠、不进二级页。
- **底部切换**复用 `LaneSwitch`（`material-generate-dock.tsx:81-86`）。Bingo 是「布置 / 生成」，空间线是「场地 / 生成」，物料线是「库 / 生成」——形态一样，词不一样，因为两条线的已有资产一个叫场地、一个叫库。

**为什么库必须留着**：收藏、打标签、搜索、拖入是**浏览行为**，不是指令。chat 不接管浏览，浏览也不该被迫用嘴说。

## 四、空间 chat

### 4.1 能听懂的话 → 对应现有能力

| 人说 | 落到哪条现有能力 | 落不落盘 | 出什么卡 |
|---|---|---|---|
| 新建一个 12×9 的空间 | `createBlankVenue`（`space-panel.tsx:42`）+ 尺寸 | 确认后写画布 | 场地提案卡（尺寸 · 面积） |
| 这是宴会厅，按这几张照片建 | `onOpenRebuild` → `useReconstructionPanel`（`reconstruction-panel.tsx:211`） | 先出候选场地 | 重建候选卡 |
| 帮我找 XX 地点 | `agent.startMapVenuePicker` → `MapVenueOverlay` + 采集单 | 写画布 | 地图浮层 + 采集单 |
| 换成小酒馆那套模板 | `ScenePresetsPanel` | 写画布 | 模板卡 |
| 挂个公园的环境 | `EnvironmentPreview` 的 `onSelect` | 写画布背景 | 环境卡 |
| 场地改成 15×10 | `workingScale` / `applyLayout`（`workbench-agent.ts:319-337`） | 写画布 | 尺寸提案卡 |
| 按图纸估一下 | `isEstimateCommand` + `suggestDimsFromImageRatio`（`workbench-agent.ts:91-93, 231-239`） | 只读 | 估算回话（带「估的」后缀） |
| 这场地装得下 80 人吗 | 面积/席位读数 | 不落盘 | 回话 |

### 4.2 空间库面（保留原样）

场景模板 10 套 · 我的云项目/场地 · 仓库留档的环境包与本场取回的环境（`environment-preview.tsx:24-34`，仓库项标「样例·非本场」不许冒充本场）· 已建空间的结构微调。

### 4.3 空间线的三条边界

- 换场地是**替换**动作：当前布置会被清掉，所以一律先出提案卡，不静默换（`space-panel.tsx:63-69` 已有同样的确认）。
- 重建是慢任务：过程写在对话里（分步叙述），可停、可续查，生成完不自动落地。
- 生成场景（world）与生成物料是两条能力：world 生成完只提示「到「空间 · 环境」取回」，不塞进物料流程（`material-generate-dock.tsx:190`）。

## 五、物料 chat

### 5.1 能听懂的话 → 对应现有能力

| 人说 | 落到哪条现有能力 | 落不落盘 | 出什么卡 |
|---|---|---|---|
| 加两把椅子 | `parseMaterialRequest` + `MATERIAL_ALIASES`（8 类内置：`workbench-agent.ts:148-181`，单次上限 50 件） | 写画布 | 数量确认卡 |
| 有没有带靠背的椅子 | `filterOnlineModels`（中文名 / 子类 / 分类 / slug 全文，`online-models.ts:161-172`） | 不落盘，给候选 | 候选卡（带缩略图） |
| 做一个藤编屏风 | 生成轨 seed → `MaterialGenerateDock`（mode=text） | 生成物先回库 | 生成记录卡 |
| 照这张照片做一个 | 生成轨 seed → `MaterialGenerateDock`（mode=image） | 生成物先回库 | 生成记录卡 |
| 把 5 张圆桌换成方桌 | 画布批量替换（按名/材质筛） | 写画布 | 替换提案卡 |
| 出个物料清单 | `isMaterialListCommand`（`workbench-agent.ts:113-115`） | 不落盘 | 清单回话 |
| 把收藏里的椅子都加两张 | `material-library-meta` 的 favorites + `filterOnlineModels` | 写画布 | 候选卡 |
| 加物料（没点名要哪件） | `isGenericMaterialRequest` → 回一份可加清单 | 不落盘 | 清单回话 |

### 5.2 物料库面（保留原样）

线上模型库（分类 rail：全部/收藏/生成/自建标签 + 全库搜索，`online-model-library.tsx:229-247`）· 生成模型库 · 内置 GLB · 建模入口（`material-create-cell.tsx:99-111`）· 收藏与自建标签（`material-library-meta.ts`）。

### 5.3 物料线的三条边界

- 库里没有的，chat 不许编：检索必须查真索引（`assets/library/merged.json` → `loadOnlineModels()`），给不出就说给不出。
- 嘴能直接加的只有 8 类内置（`workbench-agent.ts:188` 的 `MATERIAL_REQUEST_HINT` 已经这么写）；其余要么检索库里现成的，要么走生成。
- 物料有件数上限：到顶就说「已达上限，请先删几件」，不静默少放（`online-model-library.tsx:189`）。

## 六、chat 与库的三条关系规则

1. **chat 不复制库**：检索走同一份索引，给的是候选卡；点一下进画布，与在库里点一下等价。
2. **库可以引用**：库面当前的搜索词、收藏、自建标签，chat 说得出（「把收藏里的椅子加两张」）。
3. **chat 的产物回库**：生成出来的东西带「生成」标签回到库（`material-create-cell.tsx:58-61` 已经是这个语义），再由人「放进场景」——生成物不是画布上的孤儿。

## 七、生成轨的纪律（沿用现有实现，不重写）

chat **不自己实现生成**，只把一句话翻译成生成轨的 seed，剩下全部交给 `MaterialGenerateDock`：

| 环节 | 现有实现 | chat 的责任 |
|---|---|---|
| 扣额度确认 | `CREDIT_CONFIRM_LABEL` 勾选（`material-create-cell.tsx:150-154`） | 不绕过 |
| 二次确认后提交 | `submitConfirmed`（`material-generate-dock.tsx:274-280`） | 不绕过 |
| 生成中可停 | 发送键原位变停止钮（`material-generate-dock.tsx:322-324`） | 不另做 |
| 可续查 | 「继续查询」按钮（`material-generate-dock.tsx:352`） | 不另做 |
| 超时 20 分钟 | 「查询满 20 分钟，已暂停。任务可能还在，不会再提交。」（`:199`） | 不另做 |
| 生成完 | 「放进场景」一颗钮（`:351`），**不自动落盘** | 不自动落盘 |

接线方式已经有现成口子：`onGenerateFill` seed 机制（`agent-panel.tsx:1674-1676`）——Bingo 栏的「+」菜单就是这么把生成物送进 dock 的。空间/物料直接复用。

## 八、工程落点

**直接复用**（不重写）：

- 对话外壳：`agent-panel.tsx` 的 `conversation` 分支（气泡、提案卡、过程叙述、composer）
- 底部切换：`LaneSwitch`（`material-generate-dock.tsx:81-86`）
- 生成轨：`MaterialGenerateDock` + `onGenerateFill` seed
- 进画布：`placeFromCatalog` / `placeCatalogItem` / `capturePlacement`
- 物料检索：`loadOnlineModels` / `filterOnlineModels` / `material-library-meta`
- 物料嘴加：`parseMaterialRequest` / `MATERIAL_ALIASES`
- 空间能力：`createBlankVenue` / `ScenePresetsPanel` / `EnvironmentPreview` / `startVenuePicker` / `startMapVenuePicker` / `onOpenRebuild` / `onOpenReference`
- 场地读数与尺寸：`workingScale` / `suggestDimsFromImageRatio` / `isEstimateCommand`

**需要新建**：

| 新件 | 位置 | 说明 |
|---|---|---|
| 空间意图解析 | `lib/space-intent.ts` | 纯函数，仿 `workbench-agent.ts` 的写法：先纯函数，再接 UI |
| 物料意图解析 | `lib/material-intent.ts` | 同上；能复用 `workbench-agent.ts` 的就复用，不重写一份 |
| chat 版检索 | `lib/catalog-chat.ts` | 把 `filterOnlineModels` + 收藏/标签包成 chat 可调用，返回候选 + 缩略图 + 来源 |
| 空间提案卡 | `panels/space-proposal-card.tsx` | 按 design-spec §五.4 提案卡规格：恰一颗绿钮，数字带来源行 |
| 物料候选卡 | `panels/material-candidate-card.tsx` | 同上；候选来自真索引，点一下进画布 |
| 面板接线 | `panels/agent-panel.tsx` | 空间/物料接进 `conversation` 分支；`chatSlot` 只留给确实需要独立对话的 |

**状态**：空间/物料现在没有自己的后端会话。第一版沿用 demo backend 的本地规则（与 `workbench-agent.ts` 同一套路），先把入口、卡、落盘纪律做出来，再接云端会话。

## 九、分三步实施

| 步 | 做什么 | 验收 |
|---|---|---|
| 1 · 架子 | 空间/物料接进统一对话外壳，下区给「场地/生成」「库/生成」切换，chat 先只读回读数 + 引导句 | 两格看起来和 Bingo 同一个聊天框；库面一点没变 |
| 2 · 取 | `catalog-chat` 检索 + 候选卡 + 一键进画布 | 「有没有带靠背的椅子」→ 给候选 → 点一下落画布，数量对得上 |
| 3 · 生 | chat → 生成 seed（复用 dock），生成物回库 | 「做一个藤编屏风」→ 扣额度确认 → 生成 → 出现在「生成」标签 → 「放进场景」 |

## 十、不做什么

- 不把收藏、打标签搬进 chat——浏览行为留在库面。
- 不给空间/物料开新的后端会话——先本地规则。
- 不让 chat 编造库里没有的物件——检索必须查真索引。
- 不让生成自动落盘——一律先预览/确认。
- 不新增左轨图标，不加第四种下区形态。

## 十一、待定的三件事

1. **空间线第一条腿叫「场地」还是「库」**？本稿写「场地」（那条腿是这块地本身），物料线写「库」。统一成「库 / 生成」也行，代价是空间线的库面叫法要跟着改。
2. **生成物的默认去处**：先回库再进画布（本稿如此），还是生成完直接进画布？回库更符合「库是资产面」，但多一步。
3. **空间/物料要不要各自留会话历史**，还是并进总控那一条统一看？现在这两格的历史只在本机 `localStorage` 里。
