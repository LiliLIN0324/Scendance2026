# 02 · 交付与 Agent 能力：缺什么、按什么优先级补、怎么验收

> 范围：Golden Path 第④步（用 Agent 改方案）+ 最终方案交付链路（多角度效果图、场景漫游、物料清单、方案分享、客户评审、执行资料导出）。
> 证据写法：纯文本 `模块:行号`；`lib/`、`panels/`、`hooks/`、`three/` 均相对 `frontend/components/room-organizer/`，其余模块写全路径；完整路径见附录。
> 行号为审计时点 2026-11-04（`agent-panel.tsx`、`room-organizer.tsx` 当时正被并行任务修改；复核时优先按符号名定位，行号可能漂移）。
> 全程只读：未改源码/配置、未装依赖、未 commit/push。

---

## 结论（5 行）

1. **六项能力缺口**：多角度效果图、场景漫游、物料清单口径、方案分享、客户评审回传、执行资料导出——没有一项是从零开始，缺的是"同一件事多套口径、多处入口"。
2. **Agent 侧主缺口一条**：第④步缺"按对象/角色的增量命令" `plan.revise`（审计时点为 0；合并当日复核已部分落地，余下是补校验与验收收尾）。
3. **三个冲突**：物料清单 5 套口径（7 个出口）；导出入口 5 处；3 条死链路仍被当成现役能力。
4. **一个最高优先级**：物料清单收口为唯一计数点——它是唯一会"给客户看错数字"的项，成本 2、价值 4，且已有一半落地。
5. **排期**：P0 物料口径 + 机位册 + 分享文案 + Agent 增量命令收尾；P1 交付包/图纸接线 + 评审回执 V1；P2 评审同步（需后端）与漫游录制。

---

## 一、Agent 第④步能力审计

**第④步定义**：①选场景 → ②Lux3D 生成装置 → ③自动进场景 → **④用 Agent 改方案（加灯光、挪舞台）** → ⑤保存并生成可分享 3D 方案。本节只审 ④，①–③ 与 ⑤ 只作上下游契约说明。

**审计结论**：④ 缺的不是"更会聊天"，而是一条"按对象/角色做增量修改"的命令通道。可复用、不需要重做的四件事：

1. 只出候选、不写画布：`presentProposal()` 只调 `onPreview`，不 dispatch（`panels/agent-panel.tsx:864-883`）。
2. 确认才落盘：`confirmProposal()` 只调一次 `onApply(final)`（`panels/agent-panel.tsx:1005-1037`）。
3. 落盘进撤销栈：`onApplyCreative` 先 `commitHistoryNow()` 再 `applyLayout`（`room-organizer.tsx:1826-1834`），撤销一步整体退回（`hooks/use-history.ts:113-137`）。
4. 提案有内容身份与失效：`PlanArtifact` + 10 分钟 TTL + baseHash 比对（`lib/plan-artifact.ts:9,119-158`），画布一变就作废（`panels/agent-panel.tsx:789-801`）。

### 1.1 缺口审计表

| # | 缺口 | 现状 | 证据 | 影响 | 验收锚点 |
|---|---|---|---|---|---|
| 1 | 口述加"灯" | 口述可加的只有 8 类物料，词表里没有"灯"；目录里有 `lamp/floor-lamp/pendant-light`，Agent 词表不接 | `workbench-agent.ts:149-158`；`lib/constants.ts:111-112,134` | "加两盏舞台侧灯"落不到任何命令 | G1 |
| 2 | 按角色定位对象（舞台/灯/座椅） | 无角色索引，只能靠 `type/name` 猜；生成资产没有 `role` | `lib/agent-proposal.ts`（无 `SiteContext.roles`） | 同角色多件时无法消歧，只能整版重排 | G2 |
| 3 | 按 `itemId` 移动一件 | 审计时无移动命令；Agent 明确让用户在画布上手拖 | `panels/agent-panel.tsx:464-467` | "把舞台往西挪 1.5 m"退化为手动拖拽 | G1/G3 |
| 4 | 按 `assetId` 加一件（②的产物） | `AdditionRequest` 只有 `materialId/count`，无位置/朝向/`assetId` | `lib/agent-proposal.ts:432-435` | ②生成的装置进不了 ④ | G10 |
| 5 | 删除/替换一件 | 无 `remove`/`replace` 命令；唯一"重出一版"的 `proposePlan` 先清掉所有未锁旧物，再按 dining/desk-chair 两条写死脚本重摆 | `lib/agent-proposal.ts:323-428,334-338` | 改一件=重出一版，其余物件被重排 | G11 |
| 6 | 灯光位姿 | 无 `role:'light'` 的位姿策略（舞台两角/灯架/朝向舞台） | 同第 1 行 | 灯只能靠 1 m 网格扫空位，位置不可解释 | G3 |
| 7 | 舞台移动后的净距/视线 | 只有重叠/墙柱/边界 + 桌椅净距；无舞台-观众净距、无视线保留带 | `lib/layout-review.ts:303-344` | "别挡湖"无法校验，只能事后人看 | G4/G5 |
| 8 | 增量预览 | 有，但帧是整版快照，不是 op 列表 | `panels/agent-panel.tsx:864-883` | 可复用，按 op 顺序出帧即可 | G6 |
| 9 | 确认/撤销 | 有：一次 `applyLayout`，撤销一步整版退回 | `panels/agent-panel.tsx:1005-1037`；`hooks/use-history.ts:113-137` | 原样复用，不新增第二套历史 | G7 |
| 10 | 提案失效 | 有：TTL 10 分钟 + baseHash 比对 | `lib/plan-artifact.ts:9,119-158`；`panels/agent-panel.tsx:789-801` | 原样复用 | G8 |
| 11 | 资产解析失败 | 上游②已有；④只消费 `assetId`，缺结构化报错 | `lib/agent-proposal.ts`（无 `UNRESOLVED_ASSET`） | 会产出"半套灯光"的候选 | G10 |
| 12 | 锁定件保护 | 撤销栈保护锁定件，命令层未校验 | `lib/agent-proposal.ts`（无 `LOCKED_ITEM`） | 静默跳过或误改锁定件 | G9 |
| 13 | 一句话命中率 | "加两盏舞台侧灯，把舞台往西挪 1.5 米"不命中生成/加料/体检任一命令，最后回"这句我没接住" | `workbench-agent.ts:83-103,149-181`；`lib/brief-agent.ts:142-144` | 第④步主路径直接断 | G1 |

### 1.2 合并当日复核（只定位抽查，未跑测试）

| 复核项 | 结果 | 证据 |
|---|---|---|
| `plan.revise` | 已落地：`revisePlan` 按 `itemId`/角色挪、转、缩放、删、换色、加件；带 `bands` 保留带与冲突替代位 | `lib/agent-proposal.ts:524-620,789` |
| 文本 → 命令 | 已落地：`parseRevisionRequest` 识别挪/转/缩放/删/换色/加灯与"西侧 3 米景观带" | `workbench-agent.ts:191-355` |
| 提案卡接缝 | 已落地：`revisePlan` 已接入同一张预览/确认卡 | `panels/agent-panel.tsx:603-615` |
| `space.inspect` / `plan.check` | 未落地：全仓检索 0 命中；约束仍以 `RevisionConflictCode` 报，没有 `CheckReport` | `checkPlan`/`inspectSite` 无结果 |
| `replace` / `reserve` | 未落地：`PlanRevisionOp` 无替换与预留带 op | `lib/agent-proposal.ts:613` |

**口径**：上表 1.1 是**审计时点**的缺口，按当前代码应收窄为"缺 `plan.check`/`space.inspect` 与 `replace`/`reserve`，且增量命令未过验收（缩放 10% 实为 0.2×、'两盏'只加 1 盏）"。"第④步缺 `plan.revise`"的原始结论只保留在 §1.1（第 3、5 行），§五 不再复述，一句指回本条。

---

## 二、命令契约（第④步）

### 2.1 设计原则

1. **粗粒度**：动词级命令，不暴露"算一个点/查一个矩形"。
2. **纯函数**：命令只算候选或只读；落盘仍然只有 `confirmProposal → onApply`。
3. **复用提案**：写场景的命令都返回现有 `PlanProposal`，不定义第二套提案/确认结构。
4. **不猜**：景观侧、资产尺寸、对象角色缺失时返回 `needs`，不默认补值。
5. **确定性**：同一 `base + ops + seed` 必得同一候选，便于测试与撤销。

### 2.2 命令类型表（5 个）

| 命令 | 入参 | 出参 | 前置校验 | 副作用 | 可回滚性 |
|---|---|---|---|---|---|
| `space.inspect` | `{ base, floorIndex }` | `SiteContext`（含 `roles`、`existingIds`、`viewAnchors`、`keepOut`） | 楼层存在 | 无（只读） | 不需要 |
| `plan.revise` | `{ base, floorIndex, from?, ops, seed }` | `PlanProposal & { constraints }` | 若 `from` 存在则 `planIsApplicable` 通过；每个 `itemId/assetId` 可解析；锁定件不可动；结果过几何+约束 | 无（只算候选） | 撤回即丢弃；确认后整步撤销 |
| `plan.check` | `{ base, candidate, constraints }` | `CheckReport` | 候选楼层存在 | 无（只读） | 不需要 |
| `plan.compose` | `{ base, floorIndex, intent, assets, seed }` | 同上 | 场地已立；`sceneKind` 已知；要求"保留视线"时 `viewAnchors` 已知；资产全部解析 | 无（只算候选） | 撤回即丢弃；确认后整步撤销 |
| `asset.resolve` | `{ description, kind, sizeHintM? }` | `ResolvedAsset` 或结构化错误 | 描述非空；provider 可用；超时可失败 | 只写素材库，不写场景 | 场景无需回滚 |

说明：

- **④ 的主命令是 `plan.revise`**；"重新出一版"才走 `plan.compose`。
- `plan.apply` = 用户点"确认布置"，走现有 `confirmProposal`（`panels/agent-panel.tsx:1005-1037`）；`plan.withdraw` = 现有"撤回/停一下/不要了"（`:1076-1084,1147-1160`）；`plan.undo` = 现有撤销栈（`hooks/use-history.ts:113-137`）。
- `asset.resolve` 在 ④ 通常是**可选**：②/③ 已产出资产时直接用 `assetId`；只有用户临时说"再加一种灯"且库里没有时才调用。

### 2.3 动作枚举（英文名原样）

```ts
// 文本级（workbench-agent.ts）：只说"角色/方向/距离"，不带坐标
export type SceneKind = 'street-performance' | 'exhibition' | 'banquet' | 'classroom' | 'unknown';
export type ItemRole = 'stage' | 'light' | 'audio' | 'seat' | 'decor' | 'unknown';
export type Side = 'west' | 'east' | 'north' | 'south';
export type RevisionOp =
  | { op: 'add'; role: ItemRole; count: number; assetId?: string; near?: ItemRole; side?: Side; offsetM?: number }
  | { op: 'move'; target: ItemRole | string; deltaM?: { x?: number; z?: number }; toward?: Side }
  | { op: 'remove'; target: ItemRole | string }
  | { op: 'rotate'; target: ItemRole | string; degrees: number };

// 计算级（agent-proposal.ts）：解析成带 Pose/Rect 的 PlanOp
export type PlanOp =
  | { op: 'add'; assetId: string; role: ItemRole; pose: Pose }
  | { op: 'move'; itemId: string; pose: Pose }
  | { op: 'remove'; itemId: string }
  | { op: 'rotate'; itemId: string; rotation: number }
  | { op: 'replace'; itemId: string; assetId: string }
  | { op: 'reserve'; zone: Rect; clearHeightM: number };

export type CheckCode =
  | 'OVERLAP' | 'OUT_OF_BOUNDS' | 'WALL_CONFLICT' | 'KEEP_OUT'
  | 'VIEW_OCCLUDED' | 'CLEARANCE_STAGE_SEAT' | 'ROW_PITCH' | 'AISLE'
  | 'CAPACITY_SHORTFALL' | 'UNRESOLVED_ASSET' | 'LOCKED_ITEM' | 'TARGET_NOT_FOUND';
```

> 实现现状：代码用 `PlanRevisionOp`（`kind: 'move' | 'rotate' | 'scale' | 'remove' | 'recolor' | 'add'`），比契约多 `scale`/`recolor`、少 `replace`/`reserve`。以本文枚举为契约，多出的两个 op 视为扩展，不算冲突。

### 2.4 状态机（只扩展，不新增 phase）

复用现有 `idle → generating → paused/proposed → ready/edited/failed`（`panels/agent-panel.tsx:289`）：

| 当前 | 事件 | 下一状态 | 是否落盘 |
|---|---|---|---|
| idle | `space.inspect` / `plan.check` | idle | 否 |
| idle | `plan.revise` / `plan.compose` | generating | 否 |
| generating | 逐帧 `onPreview` 完成 | proposed | 否 |
| generating | `stop` | paused | 否 |
| paused | `resume` | generating | 否 |
| proposed | `confirm` | ready | 是，一次 `applyLayout` |
| proposed / paused | `withdraw` | idle | 否 |
| proposed | base 内容变化 / TTL 到期 | idle（提案作废） | 否 |
| proposed | `check` 出现 error | proposed（`blocked` 非空，确认禁用） | 否 |
| idle | `plan.revise` 找不到目标/资产 | failed（结构化原因） | 否 |

- `plan.revise` 的帧 = `base` + 每个 op 后的一帧；预览仍走 `presentProposal`，不新增播放器。
- 资产解析失败不进入 `proposed`，避免"半套灯光"的候选。
- 确认后第⑤步直接读这一版 `RoomLayout`；④ 不额外调用保存。

### 2.5 回滚与失效矩阵

| 阶段 | 用户动作 | 画布影响 | 撤销栈 |
|---|---|---|---|
| 未生成 | 撤回 | 无 | 不入栈 |
| 预览中 | 停一下 | 无，预览收回 | 不入栈 |
| 待确认 | 撤回 | 无，候选丢弃 | 不入栈 |
| 已确认 | 撤销一步 | 回到 `base`，整版一起退 | 消耗一步 |
| 提案过期/画布被改 | 自动 | 无 | 不入栈 |
| 资产解析失败 | 重试/换描述 | 无 | 不入栈 |

**明确不支持单条命令回滚**：落盘是整版 `applyLayout`，单命令 inverse 会引入第二套历史，违背"不另起一套"。要改其中一件，用 `plan.revise` 重算整版，再确认一次。

---

## 三、交付链路六项审计

> 六项判断：多角度效果图=部分有；场景漫游=部分有；物料清单=部分有且重复严重；方案分享=已有；客户评审=部分有；执行资料导出=已有但入口散。"现状/缺什么"为审计时点口径，落地变化见各项末行"复核"。

### 3.1 多角度效果图 — 部分有

| 项 | 现状 | 证据 | 缺什么 | 影响 |
|---|---|---|---|---|
| 单张 PNG 导出 | 有，视角＝跟随当前/整体/俯视/正面 | `panels/scendance-workspace.tsx:231-236`（`ANGLE_PRESETS` 仅 iso/top/front）、`:252-260`（`EXPORT_VIEWS`、`EXPORT_SCALES` 1/2/3×） | — | — |
| 同帧预览、换机位重抓 | 有；3D 导出临时改相机 + 临时抬 pixelRatio，完成恢复 | `panels/scendance-workspace.tsx:405-425`；`hooks/use-import-export.ts:87-129` | — | — |
| 成图命名 | `{项目}-效果图.png` | `hooks/use-import-export.ts:131-139` → `lib/file-io.ts:282` | 视角标签不进文件名 | 多角度图无法区分、无法排序 |
| 批量机位 + 图册 | 审计时无；2D 只允许 1× | `panels/scendance-workspace.tsx:533`（`disabled`） | 一次出 N 个机位、机位命名、图册/接触表 | "客户要的 3 个角度"＝3 次操作 + 手工命名 |
| 评审包补抓 | 可人工补抓最多 6 张，每张单独审批 | `panels/project-review-panel.tsx:171,176-183` | 与交付图册两套流程 | 人工成本高、口径不一 |
| 复核 | 机位册已落 4 机位（整体/俯视/正面/对角），不推导入口/主景人视 | `lib/shot-list.ts:15-20`；`room-organizer.tsx:1704-1708` | 5 机位设计中的入口人视/主景人视留 P1 | 验收按 4 张跑 |

### 3.2 场景漫游 — 部分有

| 项 | 现状 | 证据 | 缺什么 | 影响 |
|---|---|---|---|---|
| 编辑器第一人称漫游 | 有：PointerLockControls、进入/退出/边界钳制 | `hooks/use-walkthrough.ts:128,257-311`；`room-organizer.tsx:194` | — | — |
| 可行走范围 | 3DGS 场景取自 splat 元数据 `walkBounds` | `room-organizer.tsx:1338-1352` | 缺失时只能走预设机位 | 需明确禁用文案，不能静默失效 |
| 漫游中禁拖拽/悬停/框选 | 有，避免两套相机打架 | `three/drag-handlers.ts:221-223,340-341` | — | — |
| 客户侧漫游 | 只有轨道环绕 + 整体/俯视/客户视角 | `app/view/page.tsx:53`；`components/business/scene-preview.tsx:92,136-139` | 客户进不了漫游；无导览、无录制 | 交付演示少一半说服力 |
| 漫游状态下导出 | 未验证：导出卡只切 `CameraPreset`，不接管 PointerLock | `panels/scendance-workspace.tsx:520-538` | 导出圆钮需置灰 + ⓘ"先退出漫游" | 导出可能拍不到预期机位 |

### 3.3 物料清单 — 部分有，且五套口径

| 实现 | 口径 | 证据 | 缺什么 | 影响 |
|---|---|---|---|---|
| `downloadInventoryCsv` | 全楼层、逐件、含价格 | `lib/file-io.ts:119-149`（审计时未接线，全仓仅定义处一处引用） | 死代码 | 维护者误以为现役能力 |
| `deliveryMaterials` + `sceneDeliveryCsv` | 全楼层、按"资产+尺寸+颜色+来源"聚合 | `lib/scene-delivery.ts:38-55,113-116`；`panels/scene-delivery-panel.tsx:283` | — | — |
| 评审包 `renderMaterials` | 全楼层、按"物料+尺寸+颜色"聚合 | `lib/project-review.ts:394-412` | — | — |
| Agent"出物料清单" | **仅当前楼层**、按名字汇总 | `panels/agent-panel.tsx:379-439`（`:436` 提示去左栏导 CSV） | 未标"本层" | 与全量 CSV 数字天然对不上 |
| 发布卡片 `planOutline` | 全楼层、按品类 | `panels/share-menu.tsx:47-66` | 待替换为同一投影 | 同屏两套数字 |
| 发布页 `/view` 物料表 | 服务端发布快照 | `app/view/page.tsx:54-59` | 待替换 | 编辑器与发布页可能不一致 |
| 到场清单 `DeliveryChecklistShell` | 当前楼层、按名字 | `panels/mode-shell.tsx:77-97`；`room-organizer.tsx:2153-2155` | 标题缺楼层名 | 与全量 CSV 对不上 |
| 价格字段 | `price` 只服务 2D 平面与成就统计 | `canvas-2d/render.ts:991-994` | CSV 仍单列价格 | 假装存在报价能力 |

#### 3.3.1 本轮落地状态（2026-11-04）

单一数据源：`lib/deliverable-inventory.ts`（`groupInventory` 是唯一计数点，`customerInventory` / `summarizeInventory` 只做投影）。

| 出口 | 处理 | 说明 |
|---|---|---|
| `downloadInventoryCsv` | **已删除** | `lib/file-io.ts`；全仓 0 引用，含公式注入防护的 `csvField` 一并删除 |
| `deliveryMaterials` / `sceneDeliveryCsv` | **已收敛** | 改为消费 `deliverableInventory`；字段不变 |
| 评审包 `renderMaterials` | **已收敛** | 改为 `groupInventory(...acrossFloors) → customerInventory`；51 个测试回归通过 |
| Agent"出物料清单" | **已收敛** | `summarizeInventory(floorInventory(floor))`；仍只算当前层 |
| 到场清单 `DeliveryChecklistShell` | **已收敛** | 同上；`floorName` 显式传入 |
| 发布卡片 `planOutline` | **待替换（标注）** | 由分享任务占用，本轮不改；接线时切到 `customerInventory` |
| 发布页 `/view` 物料表 | **待替换（标注）** | view 链路冻结，以服务端发布快照为准；接线时切到同一模块 |

`price` 仍只服务 2D 平面/成就统计，任何交付清单都不读。

### 3.4 方案分享 — 已有

| 项 | 现状 | 证据 | 缺什么 | 影响 |
|---|---|---|---|---|
| 云端只读 `/view#token` | 已有：发布时冻结 revision，3D 场景 + 物料表 + 模型来源许可 + 二维码/复制/打开 | `room-organizer.tsx:393-409`；`panels/share-menu.tsx:126-133,196-222` | 语义差异只有卡片里一小段说明 | 用户混用两种链接 |
| 免登录 `/review#layout=` | 已有：只读 2D 平面 + 场内物件 + 画内钉，链接自包含 | `room-organizer.tsx:376-391`；`components/review-share-page/load-plan.ts:43-57,78-117` | 不含 3D/效果图/物料明细 | 客户以为看到的是"方案" |
| 发布卡片 | 已有：项目名/发布 badge/平面缩略图/主动作+二维码/四宫格次入口 | `panels/share-menu.tsx:186-253` | 没有"这一版含哪些交付物"的清单 | 版本与交付物对不上 |
| 资源签名 URL | 约 300 秒 TTL，超时进入"资源已到期" | `app/view/page.tsx:29,51-52` | 客户看超过 5 分钟即失败 | 需卡片 ⓘ 写明并给刷新路径 |

### 3.5 客户评审 — 部分有

| 项 | 现状 | 证据 | 缺什么 | 影响 |
|---|---|---|---|---|
| 客户页落钉 | 有点物件/地面落钉、钉汇总、完成评审 | `components/review-share-page/review-share-page.tsx:161-244` | 只写本机 localStorage | **创作者在另一台设备看不到** |
| 评审包离线 HTML | 有：需求/设计说明可勾选公开、平面 SVG、物料概览、最多 6 张审批画面、来源附录、可打印 PDF | `panels/project-review-panel.tsx:238-260`；`lib/project-review.ts:284-293,394-412,476-506` | — | — |
| 评审包本机库 | 有：最多 N 份、字节上限、草稿/下载/删除 | `panels/project-review-library.tsx:149-157,176-177` | — | — |
| 工作台议题卡 | 有：未解决/已解决、确认可进执行 | `panels/mode-shell.tsx:19-75` | `reviewPins` 是内存态，刷新即失 | 评审结果丢 |
| 评审链接内容 | 只有 2D 平面，不含 3D/效果图/物料明细 | `lib/bingo-status.ts:15`；`room-organizer.tsx:261,1453-1465` | 无回执、无同步 | 顾客信息不全、意见带不回来 |

### 3.6 执行资料导出 — 已有，入口散、命名乱

| 产物 | 现状 | 证据 | 缺什么 | 影响 |
|---|---|---|---|---|
| 活动交接 HTML / 执行时间表 HTML | 有，可打印；含需求/任务/工单/制作计划/点验、计划与实际时间 | `panels/scene-delivery-panel.tsx:273,275` | 无 manifest 汇总 | 不知道整套是否齐 |
| 活动安排 CSV / 执行清单 CSV / 物料清单 CSV | 有，三次独立下载 | `panels/scene-delivery-panel.tsx:279-283` | 无"按顺序导出" | 用户易漏项 |
| 场景 GLB | 有，带重载复检（节点数核对） | `lib/scene-delivery.ts:320-340`；`panels/scene-delivery-panel.tsx:216-218` | 含场景预设/入口扩展直接拒绝，UI 未给替代路径 | 客户以为文件坏了 |
| 场景 JSON、V3 备份 | 有；私有模型重开需授权 | `panels/scene-delivery-panel.tsx:281,286-289` | — | — |
| 图纸（按比例打印 / DXF） | 审计时能力已写好，仅测试引用，UI 不可达 | `lib/plan-export/print.ts:1-7`；`lib/plan-export/dxf.ts:67`；`blueprint.ts` 同样仅测试 | 接线入口 | 客户拿不到图纸 |
| 导出前置闸 | 有：点验/需求未读、项目变更、预览错误时禁用 | `panels/scene-delivery-panel.tsx:173-226` | — | — |
| 复核 | 图纸/清单已接线：`print`/`dxf`/`manifest` 进入同一导出面板 | `panels/scene-delivery-panel.tsx:176,217,234-235`；`lib/scene-delivery.ts:121-143` | ZIP 与模型打包仍不做 | 顺序下载会被浏览器拦截 |

---

## 四、重复入口与冲突

### 4.1 同一能力多处入口 / 多套统计口径

| # | 现象 | 涉及入口或口径 | 以哪份为准 | 为什么 |
|---|---|---|---|---|
| 1 | 物料清单 7 个出口、5 种口径 | `file-io` / `scene-delivery` / `project-review` / `agent-panel` / `share-menu` / `/view` / `mode-shell` | `lib/deliverable-inventory.ts`（`groupInventory` 唯一计数点） | 它带资产版本、来源、许可与采购状态，且与 GLB/场景 JSON 同源；死代码已删、5 处已收敛 |
| 2 | 截图 3 条路径 | `handleScreenshot`（仅测试）/ `exportRenderImage`（现役）/ `captureProjectReviewCanvas` | 保留后两条 | 即时导出走渲染帧、冻结进文件走评审抓图；前者无调用点 |
| 3 | GLB 2 条路径 | `downloadSceneAsGlb`（仅测试）/ `exportDeliveryGlb`（现役带复检） | 保留 `exportDeliveryGlb` | 唯一带节点数复检，另一条只有测试引用 |
| 4 | 分享 3 条路径 | `handleShareLink`（仅测试）/ `publishVersion` / `issueReviewLink` | 保留后两条并显式区分 | 前者死代码；后两者语义不同（云端 3D vs 免登录 2D） |
| 5 | 导出入口 5 处 | 画布导出圆钮 / 发布卡片四宫格 / 执行资料「导出」tab / 评审包 / Agent 对话文案 | 不合并入口，改"客户版 / 执行版"两条路径 | 用户按"给谁看"决策，不按文件类型；合并会拆掉现有工作流 |
| 6 | 命名 4 套 | `{项目}-效果图.png`；`{项目}_{标签}_{id}.csv`；`幕景_评审_{id}.html`；`{name}_inventory.csv` | 统一为 §5.0 的命名规则 | 下载目录可排序、可对应版本；slug 规则沿用 `lib/plan-export/download.ts:9-24` |
| 7 | 平面渲染 | 评审包复用 `layoutToSvg`；打印/DXF 审计时仅测试 | 以接线后的同一张导出卡为准 | 同一几何只应有一套渲染；复核已接线 |
| 8 | `plan.revise` 两处表述 | 03 说"没有"；路线图/体检说"已有，只修缩放与数量" | **以代码为准**（`lib/agent-proposal.ts:789`） | 代码已有 `revisePlan`，03 的"缺"只作为审计时点口径保留在 §1.1 |

### 4.2 文档结论冲突（逐条定裁）

| 冲突 | 说法 A | 说法 B | 裁决 | 为什么 |
|---|---|---|---|---|
| 03 是否存在 | 04 号路线图的输入清单称"03 不存在，Agent 缺口改以代码实测为准" | 03 实际存在 | **以 03 为准** | 03 实测 387 行、8 节，含 5 个命令类型的完整契约；04 的输入清单写错，其 ④ 结论粒度也更粗（只提 `moveItem/resizeItem` 两个动词） |
| 第④步缺什么 | 03：缺 `plan.revise` 整条命令通道 | 08/路线图：`plan.revise` 已存在，只修缩放/数量/文案 | **以代码为准，结论收窄** | `revisePlan` 已落地；剩余缺口是 `space.inspect`/`plan.check` 与 `replace`/`reserve`，加验收收尾 |
| 机位册几张 | 05 设计 5 张（整体/俯视/正面/入口人视/主景人视） | 实现 4 张（整体/俯视/正面/对角） | **以 4 张为验收，5 张为 P1** | 入口/主景人视要从场地几何推导，取景一偏就是"没有信息的图"；先给确定的 4 个检查角度 |
| 先做哪项 | 05 建议顺序：多角度效果图 → 物料清单收口 | 05 三个"必须先解决的冲突"：物料清单 5 套口径排第一 | **P0 同批，最高优先级取物料清单收口** | 执行上 1→2→3 同批、回归面小；但只有物料口径会产出"给客户看的错误数字"，属正确性风险，其余属功能缺失 |

---

## 五、最小设计

### 5.0 全局规则（所有交付项共用）

**命名**：

```
<项目名slug>_v<revision>_<类别>[_<楼层或序号>].<ext>
类别 ∈ 效果图 | 效果图册 | 物料清单 | 执行清单 | 活动交接 | 执行时间表 | 平面 | 评审回执
```

例：`西湖共创_v3_效果图_01-整体.png`、`西湖共创_v3_物料清单.csv`、`西湖共创_v3_平面_1F.dxf`。项目名去 `\\/:*?"<>|` 与空白（沿用 `lib/plan-export/download.ts:9-24` 的 slug 规则）；未命名项目用 `未命名活动`；未发布用 `v0`。

**界面**（沿用既有规范，不新造样式）：

- 不新增一级导航：客户版收进现有发布卡片，执行版收进现有执行资料「导出」tab；每项一张卡 + 一个主动作 + ⓘ 承担全部解释，不堆表单、不要求逐项勾选。
- **图标优先**：能只给图标的按钮就只给图标，但必须带 `aria-label`（与 `panels/share-menu.tsx:221-255` 一致）；文字标签只在需要消歧时出现。
- 卡片圆角用 `--r-md`（14px），描边 1px hair；编辑类卡片沿用 1.5px 描边语义：新增=绿、移动=琥珀虚线、删除=红，不新造色。
- 右轨按钮已由 13→15 个（`panels/scendance-workspace.tsx:356-358,489`），对应测试断言应改 15（`panels/scendance-workspace.react.test.tsx:216`）。

### 5.1 机位册（多角度效果图）

- **最小形态**：现有"导出效果图"弹层（`panels/scendance-workspace.tsx:524-538`）视角行末加一个图标钮（`View`/`GalleryVerticalEnd`，仅图标 + `aria-label="机位册"`）；选中后 CTA 从「导出 PNG」变「导出 4 张」；顺序抓图，避免同时抬 pixelRatio。
- **产出**：4 张 PNG（`01-整体` / `02-俯视` / `03-正面` / `04-对角`，2×）+ 1 份 `..._效果图册.html`（图片内联 data URL、无脚本、`@page A4`、可打印）。无水印、无内部字段。
- **文案**：ⓘ 写"4 张：整体 / 俯视 / 正面 / 对角，2×，PNG + 图册 HTML"；2D 视图下按钮置灰并给一句原因。
- **验收**：一次动作 ≤3 分钟产出 4 张命名正确、无黑边无 UI 的图；图册离线打开、A4 打印不横溢；文件名含机位名。
- **P1 增量**：补 `entry`（入口前 1.6 m、人眼 1.6 m）与 `stage`（首个 zone/最大物件质心）两个机位到 5 张。

### 5.2 物料清单（一个口径，三种视图）

- **唯一数据源**：`lib/deliverable-inventory.ts`；`summary`（品类×数量，发布卡片大纲/Agent 摘要，**必须带楼层范围**）、`customer`（名/规格/颜色/数量，隐藏采购状态与 SHA）、`execution`（全量字段，CSV/执行资料）。
- **最小交互**：不新建表单；执行"导出物料清单 CSV"不变；发布卡片大纲改读同一投影；Agent 首行改为「物料清单 · 本层（1F）· N 件 / 全场地 M 件」；到场清单标题补楼层名。
- **文案**：空场景出"还没有物料"空态，不产生只有表头的 CSV；客户版绝不出现价格/采购状态。
- **验收**：同屏三处数字一致（左栏 / Agent / CSV）；评审包与 `/view` 一致；删除价格列。

### 5.3 方案分享（双轨讲清，不合并）

- **最小形态**：发布卡片保持一张；两种链接旁各加 13px 图标 + 一行短标签，ⓘ 里放对照表：
  - 「云端方案页」`/view`：需登录发布，3D + 物料 + 版本冻结，适合正式发客户；
  - 「轻量评审页」`/review`：免登录，2D + 钉，适合快速收意见，**不含 3D/物料**。
- **文案**：复制时附带一行"项目名 v3 · 幕景"；ⓘ 写明"长时间未打开请刷新一次"（TTL 约 300 s）。
- **验收**：新用户不看文档能说清两个链接的区别；客户手机扫码 5 分钟内可看；不新增分享中心/密码保护/下载权限（P3）。

### 5.4 客户评审（先"回执可带走"，再"真同步"）

- **V1（无后端）**：`/review` 的"完成评审"旁加图标动作「导出评审回执」→ `..._评审回执_<planKey>.json`（钉文本/对象名/时间/完成态）；工作台议题卡加「导入回执」，并入 `reviewPins` 并标来源「客户」。
- **V2（需后端）**：发布 token 复用为评审 token，新增 `POST/GET /share/{token}/comments`（新表 + Edge Function）；`/review` 把 localStorage 降为离线缓存，按 pin id 去重。
- **复用**：`ReviewPin`（`lib/review-pins.ts:39-88`）、议题卡、离线 HTML 作无网兜底。
- **验收**：手机端 2 条钉 + 完成态可带回工作台并持久化（非仅内存）；planKey 不符明确提示"不是这一版"；V2 两台设备 60 s 内看到同一条钉。

### 5.5 执行资料（交付清单 + 接线图纸）

- **最小形态**：执行「导出」tab 顶部一张「交付包」卡：6 行图标清单（平面 SVG / 平面 PDF（打印）/ DXF / 物料 CSV / 执行 CSV / 活动交接 HTML），一行状态（齐/缺 + 原因收进 ⓘ），一个主动作「按顺序导出」。
- **产出**：上述文件（统一命名）+ `..._交付清单.csv`（文件名、类别、生成时间、件数、缺失原因）。无 ZIP 依赖时顺序下载。
- **文案**：点验未完成时主动作禁用并写明缺哪一项；场景含场馆预设时 GLB 行标"不支持，保留原文件"。
- **验收**：6 件产物命名一致、可离线打开；DXF 可被 CAD 打开且图层名可读；缺失项有原因；不做 ZIP 与模型资产打包。

### 5.6 场景漫游（导览优先，录制延后）

- **最小形态**：保留现有漫游入口；新增「导览」＝按机位册机位顺序飞行（当前 4 段、每段 3 s、空格暂停），复用 `flyDestination`/`lerpReviewCamera`（`lib/review-pins.ts:88-116`）与 `use-camera-fly`；漫游/导览激活时导出圆钮置灰并写"先退出漫游再导出"。
- **产出**：V1 无可下载文件（现场演示）；V2 用 `MediaRecorder` 录 `canvas.captureStream()` 15 s（WebM，Safari 明确不提供）。
- **验收**：演示中可完整走完 4 段（5 机位落地后 5 段）；退出后相机可正常编辑；`walkBounds` 缺失时明确禁用而非静默。

### 5.7 Agent 增量命令（第④步）

缺口与证据见 §1.1（`plan.revise`），此处只给最小形态：

- **只改两个文件**：`workbench-agent.ts` 补"灯/舞台/音响/挪/移到/往西/别挡"等词并输出 `RevisionOp[] + needs`；`agent-proposal.ts` 落 `inspectSite`、`revisePlan`、`checkPlan`、`lightPoses`、`viewCorridorBlocked`，扩展 `PlanProposal` 的可选 `constraints` 与 `ops`。`proposeAddition` 保留为兼容入口。
- **不改**：`agent-panel.tsx` 的确认/撤销主链、`room-organizer.tsx`、`site-capture.ts`、`use-splat-preview.ts`、`backend-adapter.ts`。
- **灯光位姿规则（最小实现）**：默认舞台两侧各一盏，沿长边两端内收 0.4 m（舞台宽 5 m → 中心左右各 2.1 m）；高 0.6 m（落地灯）或 2.4 m（灯架）；朝向舞台中心；落在硬保留带且高 >1.2 m → `VIEW_OCCLUDED`，换位或报错，不硬放。
- **文案**：`blocked` 非空时确认按钮消失（`panels/agent-panel.tsx:1724`）；提案过期播 `PLAN_OBSOLETE_COPY`（`:789-801`）；锁定件要说"锁着没动"，不静默跳过。
- **验收**：G1–G12（§七）；位移误差 ≤5 cm、缩放误差 ≤2%、新增数量与语义一致（"两盏"=2 盏）。

---

## 六、优先级与排期

评分：成本 1（低）–5（高）；客户价值 1–5；比值仅作排序参考。

| 优先级 | 能力项 | 成本 | 价值 | 比值 | 依赖 | 验收锚点 |
|---|---|---|---|---|---|---|
| **P0-1** | 物料清单收口（一个投影、三视图、删死代码与价格列、补楼层标注） | 2 | 4 | 2.0 | 无 | S2 |
| **P0-2** | 多角度效果图 / 机位册 | 2 | 5 | 2.5 | 无 | S1 |
| **P0-3** | 分享卡片讲清双轨（文案 + ⓘ 对照表） | 1 | 3 | 3.0 | 无 | S3 |
| **P0-4** | Agent 增量命令验收收尾（缩放/数量/文案 + `plan.check`） | 2 | 4 | 2.0 | 与 P0-1 分文件，可并行 | G1–G12 |
| **P1-1** | 执行资料交付清单 + 图纸接线 | 2 | 3 | 1.5 | P0-1（同一份清单） | S5 |
| **P1-2** | 客户评审回执（V1，无后端） | 2 | 4 | 2.0 | 无 | S4 |
| **P2-1** | 客户评审同步（V2，需后端） | 4 | 5 | 1.25 | P1-2 + 后端排期 | S4（双设备） |
| **P2-2** | 漫游导览（V1） | 3 | 3 | 1.0 | P0-2（复用机位） | S6 |
| **P2-3** | 漫游录制（V2） | 4 | 3 | 0.75 | P2-2 | S6 |

**执行建议**：

1. P0-1 → P0-2 → P0-3 同一批做（都改导出/清单相关文件，回归面小）；P0-4 与 P0-1 分文件，可并行。
2. P1-1 / P1-2 第二批；P2-1 单独排期（后端），不与前端批次混排。
3. P2-2 / P2-3 放最后，避免拖慢前四项。

**依赖关系**：`P0-1 → P1-1`（交付包复用同一份清单）；`P0-2 → P2-2`（导览复用机位序列）；`P1-2 → P2-1`（先能带回，再实时同步）；`P0-4` 独立于交付链，但需在 ⑤ 分享前完成，否则"改完的方案"与"分享的快照"仍会丢件。

---

## 七、验收场景

### 7.1 交付侧 S1–S6

前置：`frontend` 独立端口 dev（不动 3000），mock 后端自动登录 `dev@mock.local`；每个场景跑完留截图。

| ID | 前置 | 步骤（操作步数） | 期望 | 反例 |
|---|---|---|---|---|
| **S1** 多角度效果图 | 有 20+ 物件的 3D 场景，灯/天气为默认 | ①打开场景 ②点「导出效果图」→ 选「机位册」→ 2× ③点「导出 4 张」，等进度结束（**3 步**） | 4 张 `*_效果图_01-整体.png … 04-对角.png` + `*_效果图册.html`；每张无黑边、无 UI；图册离线打开齐全，A4 打印不横溢 | 2D 视图下机位册置灰；05 设计的 5 张（含入口人视/主景人视）未落地时不提交该两项 |
| **S2** 物料清单一致性 | 两层场地，1F 放 80 套桌椅、2F 放 10 把椅子 | ①看左栏「1F · 80 套」 ②问 Agent「出物料清单」→「本层 80 件 / 全场地 90 件」 ③导出物料 CSV 总 90（含资产版本/来源/采购状态）④评审包 HTML 90 且无采购状态、无 SHA ⑤发布 `/view` 90（**5 步**） | 4 处数字一致；空场地给"还没有物料"空态 | 只有表头的 CSV；客户版出现价格列 |
| **S3** 分享双轨 | 已保存项目 | ①发布 v3 → 扫码打开 `/view`，3D 可旋转、物料表与大纲一致 ②复制「轻量评审页」→ 无痕窗开 `/review#layout=`，2D + 物件 + 可落钉 ③看卡片 ⓘ（**3 步**） | ⓘ 能回答：要不要登录、含不含 3D、客户能不能留言；复制带"项目名 v3 · 幕景" | 客户打开超 5 分钟进入"资源已到期"而无说明 |
| **S4** 客户评审回执（V1） | 手机 + 工作台同项目 | ①手机落 2 条钉（物件+地面）→ 完成评审 → 导出回执 ②工作台议题卡「导入回执」 ③刷新工作台（**3 步**） | 议题出现 2 条、标"客户"来源、可标记已解决/退回布置；刷新后仍在（非仅内存） | planKey 不符时静默丢弃 |
| **S5** 执行资料交付包 | 需求、点验、活动任务已完成 | ①打开执行资料「导出」 ②点「按顺序导出」 ③离线逐个打开（**3 步**） | 得 `平面_1F.svg`、`平面_1F.dxf`、`物料清单.csv`、`执行清单.csv`、`活动交接.html`、`执行时间表.html`、`交付清单.csv`；DXF 图层名可读；数量与 S2 一致 | 点验未完成时主动作禁用但没写缺哪项；GLB 行未标"不支持" |
| **S6** 组合验收（P2-5 定义场景） | 同上 | ①机位册导出（3–4 张）②图册/物料清单打印 PDF ③发布 v3，把云端方案页发给客户（**3 步**） | 全程 ≤10 分钟，无需打开任何设置表单；客户能看 3D 与物料 | 中途要求下载/上传文件即判失败 |

### 7.2 Agent 侧 G1–G12

建议落在现有测试文件：`lib/agent-proposal.test.ts`、`lib/agent-revise.test.ts`、`lib/workbench-agent.test.ts`、`panels/agent-panel.react.test.tsx`、`hooks/agent-revise-history.react.test.ts`。现有用例 28 + 29 + 17 + 2 + 46 = 122 条；新增 G1–G12 只加不减。

| ID | 前置 | 步骤或输入 | 期望 |
|---|---|---|---|
| G1 解析增量 | 场景已有 `stage-1` | "加两盏舞台侧灯，把舞台往西挪 1.5 米，别挡湖。" | `ops` 含 `add ×2` + `move stage x-1.5`（解析为 `stage-1`）；约束含 `view-corridor west`；不误判为"出方案" |
| G2 角色定位 | `stage-1` 存在，30 把椅子 | `space.inspect` | `roles.stage=['stage-1']`；`roles.seat` 30 个；`viewAnchors` 西侧 3 m；`lockedIds=[]` |
| G3 增量组合 | G2 | `plan.revise` | 3 帧；舞台 `(-1.5,-6)`；灯 `(-3.6,-5.6)` / `(0.6,-5.6)` 朝舞台中心；椅/树不变；`errors=[]` |
| G4 保留带/视线负例 | G3 候选 | 舞台移到 `x=-8.0`（西缘 -10.5）；再把 3 m 高背景板移到 `x=-10` | 前者 `KEEP_OUT`、后者 `VIEW_OCCLUDED`；`blocked` 非空、确认禁用 |
| G5 净距负例 | G3 候选 | 第一排座椅移到 `z=-4.0`（净距 ≈0.28 m） | `CLEARANCE_STAGE_SEAT`，`stageSeatGapM≈0.28` |
| G6 预览不落盘 | G3 | 播完 3 帧后撤回 | `layoutStore` hash 与 `base` 相同；`onPreview` 收到 3 帧；撤回后仍相同 |
| G7 确认与撤销 | G3 | 确认一次，再撤销一步 | `onApply` 恰好 1 次；舞台位移 + 2 盏灯；撤销后 hash 回 `base` |
| G8 提案失效 | G3 已 proposed | 手动移动一棵树 | 提案自动作废；确认报 `PLAN_OBSOLETE_COPY`；画布不被写 |
| G9 锁定保护 | `stage-1.locked=true` | `plan.revise` 执行 `move` | `LOCKED_ITEM`，候选不变，明确播报 |
| G10 资产失败 | 灯资产解析不可用 | `plan.revise` 执行 `add light` | `UNRESOLVED_ASSET`，无半套候选，不写画布 |
| G11 二次修改 | G7 已确认 | "灯再往舞台中间靠 0.5 m" | 从已落盘版本起新提案；只动两盏灯；再确认后仍可撤销一步回到 G7 之前 |
| G12 ⑤ 交接 | G7 已确认 | 读保存/分享链路 | 最终 `RoomLayout` 含舞台新位置与两盏灯的 `assetId/glbUrl`；分享预览与画布一致，不新增保存入口 |

> G4/G5 需 `checkPlan` 先落地；G6–G9 可直接复用现有 `presentProposal` / `confirmProposal` / artifact 测试骨架。

---

## 八、风险与边界

| 风险 | 说明 | 处理 |
|---|---|---|
| 发布页资源 TTL | 签名 URL 约 300 s，超时显示"资源已到期" | ⓘ 写明；必要时加"刷新资源"主提示（已有按钮） |
| 3DGS 场景导出 | 漫游/截图依赖 splat 就绪与 `walkBounds` | 未就绪时禁用并给具体原因，不静默失败 |
| GLB 交付限制 | 含场景预设/建筑入口扩展直接拒绝 | 清单行标注"不支持"，给"保留原文件"替代 |
| 跨源纹理 | 截图前纹理未开 `crossOrigin` 会污染画布 | 沿用 `reviewSceneAssetsReady` 就绪门（`hooks/use-review-capture.ts:32-49`） |
| 评审同步一致性 | V1 回执可能重复导入 | 按 pin id 去重 + planKey 校验 |
| 多文件下载 | 浏览器可能拦截连续下载 | 首次提示"允许多个下载"；不做 ZIP |
| 定价字段 | `price` 只有 2D 平面/成就在用，交付清单不读，报价能力并不存在 | 物料 CSV 删除价格列，不假装有报价能力 |

**Agent / 交付边界（本轮只标注，不解决）**：

- ② Lux3D 的资产契约（`assetId/glbUrl/dims/role/mount`）未审计；④ 只按"最小字段"假设。③ 自动进场景后生成物是否带 `role` 未审计；若没有，`space.inspect` 只能按 `type/name` 推断，需在 ③ 补字段。
- 灯光的真实发光/光束是否随 GLB 呈现，取决于 Lux3D 与现有渲染链路；④ 只负责位姿，不设计渲染联动。场景级 `neutral/warm/cool` 预设（`lib/schema.ts:351`）不是逐灯装置，不能当作"加灯光"的实现。
- 场地是否已有结构化"景观/朝向"元数据：在 `lib/types.ts` 与两个目标文件中未找到；`site-capture.ts` 有镜头朝向，但属采集、不是场景约束。用户只说"别挡湖"时必须先问"湖在哪一侧"，不推断。
- 云端提案链路（`studio.preview` / `applyPreview`）未逐行审计；本文件只承诺本地 `revisePlan` 路径与既有 `onApply` 终点，不新增保存/发布入口。
- 交付侧不做：全景图、视频、HDR/景深渲染参数、ZIP、模型资产打包、新分享中心、密码保护、下载权限（P3）。

---

## 附录：涉及文件索引

| 文件:行号 | 作用 |
|---|---|
| frontend/components/room-organizer/lib/workbench-agent.ts:83-181,191-355 | 命令分派、8 类物料词表、增量命令解析 |
| frontend/components/room-organizer/lib/agent-proposal.ts:323-428,432-435,524-620,789 | `proposePlan` / `proposeAddition` / 增量 op 类型 / `revisePlan` |
| frontend/components/room-organizer/panels/agent-panel.tsx:289,603-615,789-801,864-883,1005-1037,1724 | 状态机、提案卡接缝、失效播报、预览、确认、blocked 隐藏确认 |
| frontend/components/room-organizer/lib/plan-artifact.ts:9,119-158 | 提案 TTL 10 分钟与 baseHash |
| frontend/components/room-organizer/hooks/use-history.ts:113-137 | 撤销栈（整版退回） |
| frontend/components/room-organizer/room-organizer.tsx:1826-1834,2153-2155 | `onApply` 落盘；到场清单接线 |
| frontend/components/room-organizer/lib/layout-review.ts:303-344 | 几何体检 |
| frontend/components/room-organizer/lib/constants.ts:111-112,134 | 灯目录（lamp / floor-lamp / pendant-light） |
| frontend/components/room-organizer/lib/shot-list.ts:15-29 | 4 机位定义与图册命名 |
| frontend/components/room-organizer/panels/scendance-workspace.tsx:231-260,405-425,520-538 | 机位预设、导出弹层、导出圆钮与按钮集 |
| frontend/components/room-organizer/hooks/use-import-export.ts:69-139,151-167,190 | 截图/渲染导出/死链路 |
| frontend/components/room-organizer/hooks/use-walkthrough.ts:128,257-311 | 第一人称漫游 |
| frontend/components/room-organizer/panels/share-menu.tsx:47-66,126-133,186-253 | 发布卡片、大纲、双链接 |
| frontend/components/review-share-page/review-share-page.tsx:161-244 | 客户评审页落钉/完成 |
| frontend/components/review-share-page/load-plan.ts:43-117 | 评审链接自包含加载 |
| frontend/app/view/page.tsx:29,51-59 | 云端只读页、静态度 TTL、物料表 |
| frontend/components/business/scene-preview.tsx:92,136-139 | 发布页轨道环绕与机位 |
| frontend/components/room-organizer/panels/project-review-panel.tsx:171-183,218-260 | 评审包补抓上限 6 张、评审包 UI |
| frontend/components/room-organizer/lib/project-review.ts:284-293,394-412,476-506 | 评审包 HTML、物料概览、CSP/打印样式 |
| frontend/components/room-organizer/lib/deliverable-inventory.ts:111-196 | 唯一计数点 `groupInventory` 与三种投影 |
| frontend/components/room-organizer/lib/scene-delivery.ts:38-55,113-143,320-340 | 交付物料、CSV、交付清单、GLB 复检 |
| frontend/components/room-organizer/panels/scene-delivery-panel.tsx:173-235,271-289 | 导出前置闸、交付包/图纸/清单接线 |
| frontend/components/room-organizer/lib/plan-export/download.ts:9-26 | slug 与下载助手 |
| frontend/components/room-organizer/lib/plan-export/print.ts:1-7 | `openPlanPrintWindow`（按比例打印） |
| frontend/components/room-organizer/lib/plan-export/dxf.ts:67 | `layoutToDxf` |
| frontend/components/room-organizer/panels/mode-shell.tsx:19-97 | 议题卡、到场清单 |
| frontend/components/room-organizer/lib/file-io.ts:282 | PNG 下载（`downloadDataUrlAsPng`） |
| frontend/components/room-organizer/lib/agent-revise.test.ts:1-180 | `plan.revise` 17 条契约 |
| frontend/components/room-organizer/hooks/agent-revise-history.react.test.ts:30-56 | 预览/确认/撤销整步 2 条契约 |

---

## 来源

- 本文件由两份中文调研合并：03《Agent 空间能力设计》（第④步审计、5 个命令类型契约、G1–G12）与 05《交付能力审计与设计》（六项交付能力、S1–S6、P0/P1/P2）。
- 合并日期 2026-11-04；原文件实测：03 共 387 行、25,322 字节，9 节（0–8）；05 共 316 行、28,004 字节，7 节（0–6）+ 附录。
- 去重口径：第④步"缺 `plan.revise`"只在 §1.1 保留一次，§5.7 一句指回，不再复述；重复的物料清单出口收口为一张表（§3.3 + §3.3.1），冲突裁决集中在 §4。
- 合并当日只做定位抽查（`revisePlan`、`shot-list.ts`、`deliverable-inventory.ts`、交付清单与图纸接线），未跑测试、未改任何源码。
