# 03 · Golden Path 第④步设计：Agent 空间操作与「预览—确认—执行」

> 范围：只审计 `workbench-agent.ts` 与 `agent-proposal.ts`，以及它们被 `agent-panel.tsx` 调用时的接缝。
> 约束：全程只读，未改源码/配置，未安装依赖，未 commit/push。
> Golden Path 第④步：①选场景 → ②Lux3D 生成装置 → ③自动进场景 → **④用 Agent 改方案（加灯光、挪舞台）** → ⑤保存并生成可分享的 3D 方案。
> 本文只覆盖 ④；①–③ 与 ⑤ 作为上下游契约说明，不展开实现。
> 日期：2026-11-04

---

## 0. 结论先行

**第④步真正缺的不是“更会聊天”，而是一条“按对象/角色做增量修改”的命令通道。**

今天已经能复用、且不需要重做的部分：

1. 只出候选、不写画布：`presentProposal()` 只调 `onPreview`，不 dispatch（`agent-panel.tsx:864-883`）。
2. 确认才落盘：`confirmProposal()` 只调一次 `onApply(final)`（`agent-panel.tsx:1005-1037`）。
3. 落盘进撤销栈：`onApplyCreative` 先 `commitHistoryNow()` 再 `applyLayout`（`room-organizer.tsx:1826-1834`），撤销一步整体退回（`hooks/use-history.ts:113-137`）。
4. 提案有内容身份与失效：`PlanArtifact` + 10 分钟 TTL + baseHash 比对（`plan-artifact.ts:9,119-158`），画布一变就作废（`agent-panel.tsx:789-801`）。

第④步今天**做不到**的三件事：

- **加灯光**：Agent 可口述加的只有 8 类物料，词表里没有“灯”；`FURNITURE_CATALOG` 虽有 `lamp/floor-lamp/pendant-light`，但 `MATERIAL_ALIASES` 不接（`workbench-agent.ts:149-158`、`constants.ts:111-112,134`）。
- **挪舞台**：没有“按 `itemId` 移动一件”的命令；Agent 目前会明确让用户“在画布上直接拖”（`agent-panel.tsx:464-467`）。
- **按对象改**：`proposeAddition` 只能同质加 8 类物料（无位置/朝向）；挪/删/换没有命令；唯一能“重出一版”的 `proposePlan` 会先清掉所有未锁旧物再按 dining/desk-chair 两条写死脚本重摆（`agent-proposal.ts:323-428,334-338`），不是第④步要的“保留其余、只动一件”。

**差 3 步**：

1. **可寻址的增量命令**：`plan.revise`（add / move / remove / rotate / reserve），支持 `itemId` 与 `assetId`。
2. **可计算的空间约束**：灯光/舞台的落位、朝向、净距、视线保留带（现有只有重叠/墙柱/边界 + 桌椅净距）。
3. **角色化资产入口**：舞台、灯、音箱从 ②/③ 进来时带 `role + assetId`，④ 才能说“把舞台挪西 1.5 m”“在舞台两角加灯”。

**最关键缺口：没有 `plan.revise`。** 它是第④步的主语；`proposeAddition` 只接受 `materialId × count`、朝向恒为 0、位置靠 1 m 网格扫描（`agent-proposal.ts:432-522`），`proposePlan` 是整版重算。没有它，“加灯光、挪舞台”只能退化成“重出一版”。

---

## 1. 第④步在 Golden Path 中的位置

| 步骤 | 谁做 | 输入 | 输出 | 本文 |
|---|---|---|---|---|
| ① 选场景 | 场景/空间 | 场景模板、环境、壳体 | `base: RoomLayout` | 假设已完成 |
| ② Lux3D 生成装置 | 物料/空间 + Lux3D | 一句描述 | `assetId`、`glbUrl`、`width/depth/height`、`role` | 假设已完成；接口未审计 |
| ③ 自动进场景 | 场景编排 | ②的资产 | 场景里已有舞台等物件，带 `itemId` | 假设已完成 |
| **④ Agent 改方案** | **Bingo（本文）** | `base` + 已有 `assetId` + 一句修改 | **最终 `RoomLayout`**，经预览/确认落盘 | **本文** |
| ⑤ 保存/分享 3D | 现有保存/发布链路 | ④落盘后的 `RoomLayout` | 云项目、只读分享链接 | 不新增入口 |

④ 的上下游契约：

- **上游（②/③）**：每个生成装置至少带 `assetId`、`glbUrl`、`width/depth/height`，并建议带 `role`（`stage` / `light` / `audio` / `seat` / `decor`）。`FurnitureItem` 已支持 `assetId/glbUrl/height/source`（`lib/types.ts:131-145`），缺的是“角色”索引。
- **下游（⑤）**：④ 的终点就是现有 `onApply`；④ 不新增保存/发布动作，也不新开确认流。⑤ 的持久化与分享沿用现有链路（本轮未审计）。

---

## 2. 现有能力审计（只列第④步相关）

### 2.1 ④ 的动词逐项对照

| # | ④ 的动词 | 今天 | 依据 |
|---|---|---|---|
| 1 | “加两把椅子”这类加物料 | 有，仅 8 类，自动找空位 | `MATERIAL_ALIASES` 149-158；`parseMaterialRequest` 167-181；`proposeAddition` 479-522 |
| 2 | “加两盏舞台侧灯” | 无 | 8 类里无灯；`FURNITURE_CATALOG` 有 `lamp/floor-lamp/pendant-light`（`constants.ts:111-112,134`），但 Agent 词表不接 |
| 3 | “加一个 ②生成的装置” | 无 | `AdditionRequest` 只有 `materialId/count`（`agent-proposal.ts:432-435`），没有 `assetId` |
| 4 | “把舞台往西挪 1.5 m” | 无 | 没有按 `itemId` 移动的命令；“换区/搬区”明确未实现，Agent 让用户手拖（`agent-panel.tsx:464-467`） |
| 5 | “删掉左边那盏灯” | 无 | 无删除命令；`proposePlan` 只能整版清场（`agent-proposal.ts:334-338`） |
| 6 | “把椅子换成折叠椅” | 无 | 无替换命令；物料面板的替换入口不在 Agent 命令链（未审计） |
| 7 | “重新出一版” | 有，但会清场并按固定脚本重摆 | `proposePlan` 323-428；`runLocal` 954-1001 |
| 8 | “看看哪里挤/挡路” | 有，只覆盖几何问题 | `reviewNow` 473-493；`layout-review.ts:303-344` |
| 9 | 只出候选、逐帧预览 | 有 | `presentProposal` 864-883 |
| 10 | 确认写盘 | 有 | `confirmProposal` 1005-1037；`onApply` 1020 |
| 11 | 撤销一步 | 有，整版退回 | `room-organizer.tsx:1826-1834`；`use-history.ts:113-137` |
| 12 | 画布一变，旧提案作废 | 有 | `plan-artifact.ts:144-158`；`agent-panel.tsx:789-801` |
| 13 | 提案待确认/生成中状态 | 部分 | `lane-status` 支持 busy/ask（13-16,55-58），但只上报 warn（`agent-panel.tsx:1881-1884`） |
| 14 | 场景级灯光预设 | 有，但只是 `neutral/warm/cool` | `schema.ts:351`；不是逐灯装置，别和“加舞台灯”混为一谈 |
| 15 | 3D 资产生成 | 不在 Bingo | `prepareAholoAsk` 只分流（`workbench-agent.ts:354-365`；`agent-panel.tsx:1258-1266`） |

### 2.2 一句话进系统后的现有路径

```
用户输入
  → isStopCommand / isGenerateCommand / isReviewCommand …（workbench-agent.ts:77-136）
  → prepareAholoAsk / parseMaterialRequest / 风格包 / 体检 …（agent-panel.tsx:1257-1284）
  → 都不是：resolveBriefTurn 走 brief-agent 槽位状态机（agent-panel.tsx:1296-1298）
  → “出方案”：runLocal → raiseVenue（立壳）→ proposePlan（整版候选）
  → presentProposal 逐帧 onPreview（不写画布）
  → confirmProposal → onApply（commitHistoryNow + applyLayout）
  → 撤销一步整体退回
```

第④步的输入“加两盏舞台侧灯，把舞台往西挪 1.5 米”在这条链路里**不会命中任何命令**：

- `isGenerateCommand` 不命中（只认“出方案/出一版/摆一版…”，`workbench-agent.ts:83-88`）；
- `parseMaterialRequest` 不命中（“灯”不在 8 类别名里，`workbench-agent.ts:149-181`）；
- `isReviewCommand` 不命中（没有“检查/挤/动线”等词，`workbench-agent.ts:99-103`）；
- 最后落到 `brief-agent`，因为没有新增活动/人数/尺寸槽位，回一句“这句我没接住”（`brief-agent.ts:142-144`）。

---

## 3. 能力 → 缺口表

| ④ 需要的能力 | 现状 | 缺口 | 最小落点 |
|---|---|---|---|
| 按角色定位对象（舞台/灯/座椅） | 无角色索引 | 只能靠 `type/name` 猜；生成资产没有 `role` | `agent-proposal.ts`：`SiteContext.roles` |
| 按 `itemId` 移动一件 | 无 | 无 `plan.revise` 的 `move` op | `agent-proposal.ts`：`revisePlan` |
| 按 `assetId` 加一件 | 无 | `AdditionRequest` 无 `assetId`、无 pose | `agent-proposal.ts`：`add` op |
| 删除/替换一件 | 无 | 无 `remove` / `replace` op | `agent-proposal.ts`：`revisePlan` |
| 灯光落位与朝向 | 无 | 无 `role:'light'` 的位姿策略（舞台两侧/灯架/朝向舞台） | `agent-proposal.ts`：`lightPoses` |
| 舞台移动后的净距/视线 | 部分 | 只有桌椅净距；无舞台-观众净距、无视线保留带 | `agent-proposal.ts`：`checkPlan` |
| 增量预览 | 有（整版帧） | 帧是整版快照，不是 op 列表；但可复用 | 无需重做，按 op 顺序生成帧 |
| 确认/撤销 | 有 | 无 | 原样复用 |
| 提案失效 | 有 | 无 | 原样复用 |
| 资产解析 | 上游已有（②） | ④ 只消费 `assetId`；解析失败要结构化报错 | `agent-proposal.ts`：`UNRESOLVED_ASSET` |

---

## 4. 命令契约（只围绕第④步）

### 4.1 设计原则

1. **粗粒度**：动词级命令，不暴露“算一个点/查一个矩形”。
2. **纯函数**：命令只算候选或只读；落盘仍然只有 `confirmProposal → onApply`。
3. **复用提案**：写场景的命令都返回现有 `PlanProposal`，不定义第二套提案/确认结构。
4. **不猜**：景观侧、资产尺寸、对象角色缺失时返回 `needs`，不默认补值。
5. **确定性**：同一 `base + ops + seed` 必得同一候选，便于测试与撤销。

### 4.2 命令表

| 命令 | 入参 | 出参 | 前置校验 | 副作用 | 可回滚性 |
|---|---|---|---|---|---|
| `space.inspect` | `{ base, floorIndex }` | `SiteContext`（含 `roles`、`existingIds`、`viewAnchors`、`keepOut`） | 楼层存在 | 无（只读） | 不需要 |
| `plan.revise` | `{ base, floorIndex, from?, ops, seed }` | `PlanProposal & { constraints }` | 若 `from` 存在则 `planIsApplicable` 通过；每个 `itemId/assetId` 可解析；锁定件不可动；结果过几何+约束 | 无（只算候选） | 撤回即丢弃；确认后整步撤销 |
| `plan.check` | `{ base, candidate, constraints }` | `CheckReport` | 候选楼层存在 | 无（只读） | 不需要 |
| `plan.compose` | `{ base, floorIndex, intent, assets, seed }` | 同上 | 场地已立；`sceneKind` 已知；要求“保留视线”时 `viewAnchors` 已知；资产全部解析 | 无（只算候选） | 撤回即丢弃；确认后整步撤销 |
| `asset.resolve` | `{ description, kind, sizeHintM? }` | `ResolvedAsset` 或结构化错误 | 描述非空；provider 可用；超时可失败 | 只写素材库，不写场景 | 场景无需回滚 |

说明：

- **④ 的主命令是 `plan.revise`**；“重新出一版”才走 `plan.compose`。
- `plan.apply` = 用户点“确认布置”，走现有 `confirmProposal`（`agent-panel.tsx:1005-1037`）。
- `plan.withdraw` = 现有“撤回/停一下/不要了”（`agent-panel.tsx:1076-1084,1147-1160`）。
- `plan.undo` = 现有撤销栈（`use-history.ts:113-137`）。
- `asset.resolve` 在第④步通常是**可选**：②/③ 已经产出资产时，④ 直接用 `assetId`；只有用户临时说“再加一种灯”且库里没有时才调用。

### 4.3 类型草案

```ts
// workbench-agent.ts —— 只做文本 → 意图/操作，不依赖 RoomLayout
export type SceneKind = 'street-performance' | 'exhibition' | 'banquet' | 'classroom' | 'unknown';
export type ItemRole = 'stage' | 'light' | 'audio' | 'seat' | 'decor' | 'unknown';

export interface ViewAnchor {
  side: 'north' | 'south' | 'east' | 'west';
  widthM: number;
  depthM: number;
  clearHeightM: number;   // 坐姿 1.2 / 站姿 1.6
  hardness: 'hard' | 'soft';
}

export type Side = 'west' | 'east' | 'north' | 'south';

// 文本级 op：只说“角色/方向/距离”，不带坐标；坐标由 agent-proposal 解析
export type RevisionOp =
  | { op: 'add'; role: ItemRole; count: number; assetId?: string; near?: ItemRole; side?: Side; offsetM?: number }
  | { op: 'move'; target: ItemRole | string; deltaM?: { x?: number; z?: number }; toward?: Side }
  | { op: 'remove'; target: ItemRole | string }
  | { op: 'rotate'; target: ItemRole | string; degrees: number };

export interface RevisePlan {
  ops: RevisionOp[];
  needs: Array<'target' | 'asset' | 'view-anchor' | 'pose'>;
  sourceText: string;
}
```

```ts
// agent-proposal.ts —— 纯计算，返回现有 PlanProposal
// 先把 RevisionOp 解析成带 Pose/Rect 的 PlanOp，再做目标消歧与位姿计算
export type PlanOp =
  | { op: 'add'; assetId: string; role: ItemRole; pose: Pose }
  | { op: 'move'; itemId: string; pose: Pose }
  | { op: 'remove'; itemId: string }
  | { op: 'rotate'; itemId: string; rotation: number }
  | { op: 'replace'; itemId: string; assetId: string }
  | { op: 'reserve'; zone: Rect; clearHeightM: number };

export interface SiteContext {
  width: number; depth: number;
  roles: Record<ItemRole, string[]>;   // 角色 → itemId
  occupied: Rect[];
  keepOut: Rect[];
  entrances: Rect[];
  existingIds: string[];
  lockedIds: string[];
  viewAnchors: ViewAnchor[];          // 只来自用户/场地元数据
  unknowns: string[];
}

export type CheckCode =
  | 'OVERLAP' | 'OUT_OF_BOUNDS' | 'WALL_CONFLICT' | 'KEEP_OUT'
  | 'VIEW_OCCLUDED' | 'CLEARANCE_STAGE_SEAT' | 'ROW_PITCH' | 'AISLE'
  | 'CAPACITY_SHORTFALL' | 'UNRESOLVED_ASSET' | 'LOCKED_ITEM' | 'TARGET_NOT_FOUND';
```

### 4.4 状态机（只扩展，不新增 phase）

复用现有 `idle → generating → paused/proposed → ready/edited/failed`（`agent-panel.tsx:289`）：

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

说明：

- `plan.revise` 的帧 = `base` + 每个 op 后的一帧；预览仍走 `presentProposal`，不新增播放器。
- 资产解析失败不进入 `proposed`，避免“半套灯光”的候选。
- 第④步确认后，第⑤步的保存/分享直接读这一版 `RoomLayout`；④ 不额外调用保存。

### 4.5 回滚与失效矩阵

| 阶段 | 用户动作 | 画布影响 | 撤销栈 |
|---|---|---|---|
| 未生成 | 撤回 | 无 | 不入栈 |
| 预览中 | 停一下 | 无，预览收回 | 不入栈 |
| 待确认 | 撤回 | 无，候选丢弃 | 不入栈 |
| 已确认 | 撤销一步 | 回到 `base`，整版一起退 | 消耗一步 |
| 提案过期/画布被改 | 自动 | 无 | 不入栈 |
| 资产解析失败 | 重试/换描述 | 无 | 不入栈 |

**明确不支持单条命令回滚**。现有落盘是整版 `applyLayout`，单命令 inverse 会引入第二套历史，违背“不另起一套”。要改其中一件，用 `plan.revise` 重算整版，再确认一次。

---

## 5. 示例推演：湖边街头音乐表演空间（第④步）

### 5.1 前置状态（①–③ 已完成）

- 场景来源：用户最初说 **“在这个湖边空地设计一个小型街头音乐表演空间，保留原来的景观视线。”** ①–③ 已据此完成选场景、生成装置、自动进场景；如果用户在 ④ 说“换一版”，才回退到 `plan.compose` 按这套场景意图重算。
- 场地：24 × 16 m 户外空地，原点居中，x 向东、z 向南。
- 湖在西侧；西边界内 3 m 为硬保留带（x ∈ [-12, -9]，全 z），西边界 3 棵树。
- ③ 自动进场景后，场景里已有舞台：`stage-1`，5 × 3 × 0.4 m，中心 `(0, -6)`，正面朝南。
- 观众区：5 排 × 6 座，第一排中心 `z = -3.0`，舞台到第一排净距 ≈1.3 m。
- ② 已生成 2 个候选灯光资产：`lux3d-stage-light-a`、`lux3d-stage-light-b`，0.4 × 0.4 × 0.6 m，`role='light'`。

### 5.2 用户第④步输入

> “加两盏舞台侧灯，把舞台往西挪 1.5 米，别挡湖。”

### 5.3 Agent 会查什么

1. `parseRevisionPlan` → `ops`：
   - `add` 灯 ×2（`role='light'`，位置待算）
   - `move` 舞台（角色 `stage`，解析后为 `stage-1`），目标 `x - 1.5`
   - 约束：`view-corridor west`、`clearHeight 1.2`
2. `space.inspect`：
   - `roles.stage = ['stage-1']`，`roles.seat = [30 个 id]`；
   - `existingIds` 含 3 棵树；
   - `viewAnchors` = 西侧 3 m 硬保留带；
   - `lockedIds` 空。
3. 目标消歧：只有 1 个 stage，直接命中；如果场景里有多件舞台，先问一句“哪一件”，不猜。

### 5.4 Agent 会算什么

`plan.revise` 按 op 顺序算 3 帧：

| 快照 | 内容 | 结果 |
|---|---|---|
| 帧 0 | 基线 | `base`（舞台在 `(0,-6)`，灯不在） |
| 帧 1 | `move stage-1` | 舞台中心 `(-1.5,-6)`；西边缘 `x=-4.0`，离保留带还有 5 m |
| 帧 2 | `add light ×2` | 灯 A `(-3.6,-5.6)`，朝舞台中心；灯 B `(0.6,-5.6)`，朝舞台中心；这是最终候选 |
| 校验（非帧） | `plan.check` | 对最终候选写 `CheckReport` |

灯光位姿规则（最小实现）：

- 默认“舞台两侧各一盏”，沿舞台长边两端内收 0.4 m（舞台宽 5 m → 中心左右各 2.1 m）；
- 高度 0.6 m（落地灯）或 2.4 m（灯架，取决于资产 `mount`）；
- 朝向 = 指向舞台中心；
- 若灯位落在视线保留带且高度 > 1.2 m → `VIEW_OCCLUDED`，换位或报错，不硬放。

`CheckReport`：

- `viewCorridorFree = true`（舞台与灯都在 x > -9）；
- `stageSeatGapM ≈ 1.3`（舞台只横向移动，前后净距不变）；
- 座位 30/30；
- 重叠 0；
- 灯的高度 0.6 m，不进视线硬闸。

### 5.5 Agent 会提什么方案

- 一段话：“舞台向西 1.5 m，两盏侧灯放在舞台两角、朝舞台中心；湖侧 3 m 仍空着。”
- 一张现有提案卡：3 帧预览 + 本次结果（改了 1 件、加了 2 件、0 件被拒）。
- 不新增卡片、不新增按钮。

### 5.6 用户确认后落哪些对象

一次 `applyLayout` 写入：

| 对象 | 变化 | 关键字段 |
|---|---|---|
| 舞台 `stage-1` | 位置 `(0,-6) → (-1.5,-6)` | `itemId` 不变，其他属性不变 |
| 灯 A | 新增 | `assetId=lux3d-stage-light-a`、`role='light'`、`position(-3.6,-5.6)`、朝向舞台中心 |
| 灯 B | 新增 | `assetId=lux3d-stage-light-b`、`role='light'`、`position(0.6,-5.6)`、朝向舞台中心 |
| 30 把椅子 | 不动 | 原 `itemId`、原位置 |
| 3 棵树 | 不动 | 原 `itemId`、原位置 |

撤销一步 → 舞台回到 `(0,-6)`，两盏灯消失，椅子与树不变。

第⑤步：这一版 `RoomLayout` 已通过 `onApply` 进入撤销栈，交给现有保存/分享链路；⑤ 的持久化与分享本轮未审计，④ 不额外触发保存或发布。

### 5.7 怎样保证“不挡景观视线”

1. **只认用户/场地元数据**：句子里只说“别挡湖”时，如果 `space.inspect` 没有 `viewAnchors`，先问“湖在哪一侧”，不推断。
2. **锚点转保留矩形**：`side + depthM + widthM` → 矩形；`hardness='hard'` 表示硬保留带，`hardness='soft'` 表示只保视线高度。
3. **硬带禁放、软带限高**：硬带内任何新增/移动物件只要 `height > 0.05 m` → `KEEP_OUT`；软带内 `height > clearHeightM` 且相交 → `VIEW_OCCLUDED`（坐姿 1.2 / 站姿 1.6）。
4. **既有景观是基线**：`existingIds` 默认保留、不参与“新增遮挡”判定；若用户要求“从入口能看见湖面”，再加射线采样，此时既有树也算遮挡。
5. **高件反向摆放**：舞台/背景板/灯架等高于阈值的物件，必须放在保留带的对侧；找不到合法位姿时返回 `NO_VIEW_SAFE_LAYOUT`，不硬放。
6. **确认前硬闸**：`CheckReport.errors` 非空 → `PlanProposal.blocked` 非空 → 确认按钮不出现（现有 UI 已在 `blocked` 时隐藏确认，`agent-panel.tsx:1724`）。

### 5.8 失败分支（必须可验收）

| 情况 | 期望 |
|---|---|
| 场景里没有舞台 | `TARGET_NOT_FOUND`，先问“要挪哪一件”，不整版重排 |
| 有 2 个以上舞台 | `needs=['target']`，问一句，不猜 |
| 灯资产未解析 | `UNRESOLVED_ASSET`，不产生半套候选 |
| 舞台往西挪 7 m（西边缘 -9.5）会压到保留带 | `KEEP_OUT`，给出“最多可挪 6.5 m”的边界 |
| 舞台被锁定 | `LOCKED_ITEM`，明确说“锁着没动”，不静默跳过 |
| 画布在预览后被手动改过 | 提案作废，确认时按 `PLAN_OBSOLETE_COPY` 播报（`agent-panel.tsx:789-801`） |

---

## 6. 验收测试场景（第④步）

建议落在现有测试文件：`agent-proposal.test.ts`、`workbench-agent.test.ts`、`agent-panel.react.test.tsx`。

| ID | 前置 | 步骤 | 期望 |
|---|---|---|---|
| G1 解析增量 | 场景已有 `stage-1` | 解析“加两盏舞台侧灯，把舞台往西挪 1.5 米，别挡湖。” | `ops` 含 `add ×2` + `move stage x-1.5`（解析后为 `stage-1`）；约束含 `view-corridor west`；没有误判成“出方案” |
| G2 角色定位 | `stage-1` 存在，30 把椅子 | `space.inspect` | `roles.stage=['stage-1']`；`roles.seat` 30 个；`viewAnchors` 西侧 3 m；`lockedIds=[]` |
| G3 增量组合 | G2 | `plan.revise` | 3 帧；舞台 `(-1.5,-6)`；灯 `(-3.6,-5.6)` / `(0.6,-5.6)` 朝舞台中心；椅子/树不变；`errors=[]` |
| G4 保留带/视线负例 | G3 的候选 | 把舞台移到 `x=-8.0`（西边缘 -10.5，进入硬保留带）；再把一个 3 m 高背景板移到 `x=-10` | 前者 `KEEP_OUT`，后者 `VIEW_OCCLUDED`；两种情况 `blocked` 非空、确认禁用 |
| G5 净距负例 | G3 的候选 | 把第一排座椅移到 `z=-4.0`（净距 ≈0.28 m） | `CLEARANCE_STAGE_SEAT`，`stageSeatGapM≈0.28` |
| G6 预览不落盘 | G3 | 播完 3 帧后撤回 | `layoutStore` hash 与 `base` 相同；`onPreview` 收到 3 帧；撤回后仍相同 |
| G7 确认与撤销 | G3 | 确认一次，再撤销一步 | `onApply` 恰好 1 次；舞台位移 + 2 盏灯；撤销后 hash 回 `base` |
| G8 提案失效 | G3 已 proposed | 手动移动一棵树 | 提案自动作废；确认报 `PLAN_OBSOLETE_COPY`；画布不被写 |
| G9 锁定保护 | `stage-1.locked=true` | `plan.revise` 执行 `move` | `LOCKED_ITEM`，候选不变，明确播报 |
| G10 资产失败 | 灯资产解析不可用 | `plan.revise` 执行 `add light` | `UNRESOLVED_ASSET`，无半套候选，不写画布 |
| G11 二次修改 | G7 已确认 | 再说“灯再往舞台中间靠 0.5 m” | 从已落盘版本起新提案；只动两盏灯；再确认后仍可撤销一步回到 G7 之前 |
| G12 ⑤ 交接 | G7 已确认 | 读保存/分享链路 | 最终 `RoomLayout` 含舞台新位置与两盏灯的 `assetId/glbUrl`；分享预览与画布一致（不新增保存入口） |

> G4/G5 需要 `checkPlan` 先落地；G6/G7/G8/G9 可直接复用现有 `presentProposal` / `confirmProposal` / artifact 测试骨架。

---

## 7. 落地边界（下一阶段）

**只改两个文件**：

- `workbench-agent.ts`：`parseRevisionPlan`（文本 → `RevisionOp[]` + `needs`）；补“灯/舞台/音响/挪/移到/往西/别挡”等词；保留现有 `parseBriefSentence` 作为场景级入口。
- `agent-proposal.ts`：`inspectSite`、`revisePlan`、`checkPlan`、`lightPoses`、`viewCorridorBlocked`；扩展 `PlanProposal` 的可选 `constraints` 与 `ops` 字段；`proposeAddition` 保留为兼容入口。

**不改**：`agent-panel.tsx` 的确认/撤销主链、`room-organizer.tsx`、`site-capture.ts`、`use-splat-preview.ts`、`backend-adapter.ts`。等 P0 落地后再接命令分发。

**外部依赖（本轮只标注，不解决）**：

- ② Lux3D 的资产契约（`assetId/glbUrl/dims/role/mount`）未审计；④ 只按“最小字段”假设。
- 灯光的真实发光/光束是否随 GLB 呈现，取决于 Lux3D 资产与现有渲染链路；④ 只负责位姿，不设计渲染联动。
- ③ 自动进场景后，生成物件是否带 `role` 元数据：未审计；如果没有，`space.inspect` 只能按 `type/name` 推断，需在 ③ 补一个 `role` 字段。
- ⑤ 保存/分享链路未逐行审计；本设计只保证 ④ 的终点是现有 `onApply`，不新增保存入口。

---

## 8. 不确定与未审计项

- 云端提案链路（`studio.preview` / `applyPreview`）未逐行审计，本设计只覆盖本地 `revisePlan` 路径。
- `layout-review.ts` 属于相邻模块，本设计只把它作为可复用校验器引用，未审计其全部边界。
- 灯光的场景级预设 `backendLighting` 只有 `neutral/warm/cool`（`schema.ts:351`），不是逐灯装置；不要把它当作“加灯光”的实现。
- 场地是否已有结构化的“景观/朝向”元数据：在 `lib/types.ts` 与两个目标文件中未找到；`site-capture.ts` 有镜头朝向，但属于采集，不是场景约束。**不确定后端是否已有字段。**
- “舞台”在当前 `EVENT_CATALOG` 中不存在（口述可加只有 8 类，`workbench-agent.ts:149-158`）；示例假设舞台由 ② Lux3D 生成并经 ③ 进场景，而不是内置物料。
