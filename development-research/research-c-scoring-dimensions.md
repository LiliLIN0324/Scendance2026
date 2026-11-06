# 研究线 C — 打分维度 / Solver 接口 / 活动引擎数据结构对照

> 范围：只产规格，不改产品代码。
> 对照基线（已读源码，2026-11-06）：
> - `frontend/lib/plan-scoring.ts`：`generateScoredPlans(annotations, opts?)` → `ScoredPlan[]`（固定三档 sparse/balanced/dense），`pickRecommendedPlan(plans)` 取最高分（并列 balanced>sparse>dense）。打分公式：`score = capacitySeats - 2*skipped.length - 3*outOfBounds + flowPenalty + overlapPenalty`。
> - `frontend/lib/plan-annotation.ts`：`PlanAnnotation{id, kind:'zone'|'route'|'measure', label, geometry:rect|polyline|measure, stageNo, zoneType?}`；`ZoneSemanticType = 'roundtable'|'checkin'|'photo'|'rest'`。
> - `frontend/lib/plan-approve.ts`：`FurnitureSpec{type,name,category,width,depth,height,color,icon}`；`ZoneFurniturePlacement{spec,x,z,rotation,zoneId,zoneType}`；`planZones(annotations, density)` 返回 `{placements, skipped}`，skipped 带中文人话原因。

---

## 1. RoomCraft 打分维度表

### 1.1 RoomCraft AI 实际打分维度（来源：adrianmoreno-dev.com/proyecto/roomcraft-ai）

RoomCraft AI（Python + FastAPI + Simulated Annealing）把「多版布局」当组合优化问题跑，每版输出一个 0–100 分，并给 Top 5 排名。维度分成**硬约束（违反即 infeasible）**和**软约束（计入分数）**两类。

| 类别 | 维度 | 测量方法 | 阈值 / 权重 |
|---|---|---|---|
| 硬约束 | 家具越界 | 每件家具包围盒 vs 房间矩形 | 越界即 infeasible，不进入排名 |
| 硬约束 | 家具重叠 | 两两 AABB 相交检测 | 相交即 infeasible |
| 硬约束 | 遮挡门 | 门 90° 开门弧（90cm 半径扇区）内不得有家具 | 命中即 infeasible |
| 硬约束 | 最小通道 | 任意两件家具净间距 ≥ 通道下限 | < 60cm 即 infeasible |
| 软约束 | 人体工学 | 床两侧预留、沙发朝向观看面、桌椅高差 | 加权扣分（具体系数在 SA 目标函数里，未公开） |
| 软约束 | 自然采光 | 家具到窗的距离 / 被遮挡面积 | 计入「luz natural」子分 |
| 软约束 | 功能组团 | 沙发组、床组、餐桌组内部聚集度 | 计入「agrupación funcional」子分 |
| 软约束 | 动线贯通 | 主通道净宽、门到使用区可达性 | 计入「circulación」子分 |
| 输出 | 总分 | circulación + luz + ergonomía 归一到 0–100 | Top 5 每版带数值拆解 |
| 可视化 | 冲突叠加 | 红区 = 冲突，绿区 = 合格通道，家具间距离 cm 标注 | PDF  metric 表：总分 / 最小通道 / 采光利用率 / 冲突数 |

通用人体工学参考（来源：artandarchitecture.org、refinedspace.net、interioratoz.com）：
- 餐桌高 73–76cm（我们用 0.75m ✓）；椅座高（popliteal）≈ 43cm；
- 圆桌 4 人用直径 ≈ 120cm（我们 TABLE_DIAMETER=1.2 ✓）；每人桌边宽 60cm；
- 椅后舒适活动空间 ≥ 36in（≈ 91cm），最低能侧身过 ≈ 60cm；
- 单人通行净宽 ≈ 61cm；双人交汇 ≈ 107–122cm；91cm 需一人侧身。

### 1.2 对照我们 plan-scoring.ts 的 gap

我们当前只算了 5 个量：`capacitySeats` / `skipped.length` / `outOfBounds` / `flowPenalty` / `overlapPenalty`。对照 RoomCraft 的维度表：

| RoomCraft 维度 | 我们有没有 | gap |
|---|---|---|
| 越界（硬） | ✅ `outOfBounds`（zone rect + 0.05m 外扩 / 场地 ±room/2） | 已有，但只数件数，没分「zone 越界」vs「单件越界」 |
| 重叠（硬） | ⚠️ 只测 zone 之间重叠（`detectZoneOverlap`） | 没测家具两两 AABB 重叠——我们靠 grid 间距保证，没显式检测 |
| 门遮挡（硬） | ❌ | 没有门 / 出入口概念，`checkinBlocked` 只判签到台被堵，不判门弧 |
| 最小通道（硬） | ⚠️ `flow.aisleWidthM` 走罚分不是硬卡 | 60cm 硬下限没卡；1.2m / 1.5m 是软阈值 |
| 人体工学（软） | ❌ | 桌高 0.75m 是硬编码常量，没作为维度打分；椅后活动空间没测 |
| 自然采光（软） | ❌ | 没有窗 annotation，没法算 |
| 功能组团（软） | ❌ | 不奖励签到→圆桌区、打卡→休息区的邻近度 |
| 动线贯通（软） | ⚠️ `flowPenalty`（-2/-5/-8 三档） | 只有扣分项，没有「动线好」的正分 |
| 0–100 归一 + 子分拆解 | ❌ | 我们 score 是裸整数（capacitySeats - ...），UI 没法说「动线 82/采光 0/人体 0」 |
| 冲突红/绿可视化 | ❌ | reasons 是文字，没结构化 violation 列表给画布叠加 |

### 1.3 我们应该加的人体工学项清单（按 ROI 排序）

1. **椅后活动空间 ≥ 0.6m**：餐椅/工作椅背到最近障碍（另一桌、zone 边、背景墙）的净距。< 0.6m 扣分，< 0.3m 判 infeasible。
2. **签到台前排队深度 ≥ 1.5m**：签到台朝向宾客那一侧，到 zone 边 / 第一件宾客家具的净距。当前我们只测通道 `aisleWidthM`，没测台前排队纵深。
3. **主通道双人交汇 ≥ 1.22m**：当前 normalPassable 阈值 1.2m、轮椅 1.5m。建议把「双人交汇」独立成一档 1.22m，理由是人体工学参考里双人交汇 107–122cm。
4. **桌高合规校验**：把 `SPEC.roundtable.table.height = 0.75`、`SPEC.checkin.desk.height = 0.75` 从常量变成打分维度输出（「桌高 0.75m 符合正餐高度」），后续 audienceHint 命中「站立用餐/酒会」时切到 1.05m 高桌。
5. **门 / 出入口弧遮挡**：annotation 增加 door/wall-attachment 类型后，测 90cm 开门弧内有无家具。这是 archi R311 egress 的简化版。
6. **签到→圆桌区邻近度正分**：checkin zone 中心到最近 roundtable zone 中心距离 ≤ 8m 给正分（当前全是扣分）。
7. **0–100 归一 + 子分**：把 capacitySeats / flow / ergonomics 各自归一到 0–100，加权出总分，UI 能说「容量 90 / 动线 65 / 人体 70」。

---

## 2. archi TreemapSolver 工具接口形状

### 2.1 archi 的工具链（来源：github.com/dreliq9/archi + lobehub.com/mcp/dreliq9-archi）

archi 是 MCP server，21 个工具分 5 类。核心是「Agent 说需求 → `arch_add_room` 触发 TreemapSolver 自动摆位置 → 每次调用 LiveValidator 同步返回 violations」。

**Agent 输入 schema（按工具）：**

| 工具 | 关键入参 | 校验 |
|---|---|---|
| `arch_create_building` | lot 尺寸（width/depth）、setbacks | lot 尺寸 `> 0`，数值范围约束 |
| `arch_add_floor` | stories | `1..10` 枚举范围 |
| `arch_add_room` | `room_type`（Literal 枚举：kitchen/bedroom/bathroom/...）、adjacency hints、minimum dimensions | 拼错 `"kitcen"` 在入参层就被 Pydantic 拒掉，不进 graph |
| `arch_add_opening` | `opening_type`（Literal：door/window/archway）、所在墙、位置 | Literal 枚举校验 |
| `interior_place_furniture` | 家具类型、所在 room_id、位置、朝向 | 参数化家具带 clearance 检测 |
| `query_check_code` / `query_get_violations` | 无（跑当前 BuildingGraph） | 只读 |

**Solver / 输出 schema（Pydantic envelope，同时给人读文本 + 机器读 JSON）：**

每个 `arch_*` 工具返回：
```
{
  "result": {
    "building_id": "...",
    "room_id" | "floor_id" | "opening_id": "...",
    "violation_counts": { "egress": 0, "min_dim": 1, ... },
    "violations": [
      { "code": "R311", "message": "Bedroom 2 egress path blocked", "severity": "error" }
    ],
    "placements": [ ... ]   // TreemapSolver 算出来的房间 / 家具位置
  }
}
```

- `query_get_room` 返回：dimensions + furniture list + violations
- `query_get_plan` 返回：SVG（带 violation overlay）
- TreemapSolver 行为：**不拒绝，只重排**——尊重 setbacks / adjacency hints / minimum dimensions，把房间重新塞进 lot

**错误码 / violation 枚举（archi 实际用的是 IRC code ref）：**

| code | 含义 |
|---|---|
| R311 | Egress — 每间有人房间必须经门到达外门 |
| R304 | 最小房间尺寸 — 有人房间 ≥ 7ft，非有人 ≥ 5ft |
| R303.1 | 自然通风 — 可开窗面积 ≥ 地板面积 4% |
| R303.4 | 机械通风 — 厨房/浴室排气或可开窗 |
| （structural spans） | 楼板搁栅跨度 vs 木材等级表 |

注意：archi **没有**显式的 `infeasible` / `over-constrained` / `zone-too-small` 枚举——它的设计哲学是「每次调用都返回当前 violations，Agent 自己迭代修」，而不是一锤子报错。这跟我们「zone 太小直接 skipped 并给中文原因」的思路不同。

### 2.2 对照我们 `generateScoredPlans` / `pickRecommendedPlan` 的 gap

| archi 形状 | 我们当前 | gap |
|---|---|---|
| 入参 Literal 枚举校验，拼错前置拒掉 | `ZoneSemanticType` 是 TS 联合，但 `plan-approve` 里 `ann.zoneType ?? 'roundtable'` 静默兜底 | 未知 zoneType 应该返回一个 `E_UNKNOWN_ZONE_TYPE` warning，而不是悄悄当 roundtable（对应主会话 step 3「未知 zone 类型人话降级」） |
| 数值范围约束（lot>0, stories 1..10） | `roomSize.width/height` 只查 `Number.isFinite` | width/height ≤ 0 应返回 warning 而非当 undefined |
| 每次调用都返回 violations envelope | 我们返回 `ScoredPlan`（含 reasons 字符串数组）+ `ZonePlanSkipped`（含 reason 字符串） | 没有机器可读的 violation 列表（code + severity + message），reasons 是给人读的 |
| violation 带 code ref（R311） | 我们 reasons 是中文自由文本 | 建议加 `code` 字段：`E_OUT_OF_BOUNDS` / `E_ZONE_TOO_SMALL` / `E_FLOW_NARROW` / `E_EGRESS_BLOCKED` / `E_ZONE_OVERLAP` / `E_UNKNOWN_ZONE_TYPE` |
| 状态化 BuildingGraph 跨调用持久 | 我们每次从 annotations 纯重算 | MVP 可接受，但缺「本次改动引入了哪些新 violation」的 diff |
| `pickRecommendedPlan` 空数组 throw | `if (plans.length === 0) throw new Error(...)` | archi 风格应该返回一个带 violation 的空结果 envelope，而不是 throw（React 层 catch 体验差） |
| TreemapSolver 重排而非拒绝 | 我们 zone 太小直接 skipped 整块 | 可以考虑「缩小家具配方重试」（如圆桌桌数从 3→2→1），而不是整块跳过 |
| `query_get_violations` 只读查询 | 无 | 缺一个轻量函数：给定 annotations + roomSize，只返回 violation 列表不跑 placements |

---

## 3. OpenEventCAD 活动引擎数据结构

### 3.1 venue / zone / item 字段枚举（来源：openeventcad.com 官网 + 内置 demo 截图）

OpenEventCAD 是浏览器端 2D 活动策划引擎，JSON 可导入导出。从 UI 能反推出的核心实体：

**Venue（场地）：**
- 类型枚举：`indoor_room`（预设房间）/ `tent` / `tent_addon` / `custom`（My Venues 手绘）
- 预设 indoor_room 命名 = 尺寸（英尺）：`10x10, 10x20, 10x30, 15x15, 15x20, 15x30, 20x20, 20x30, 20x40, 30x30, 30x40, 30x50, 30x60, 40x40, 40x60`
- 字段：`{id, kind, width_ft, depth_ft, wall_attachments: WallAttachment[]}`
- WallAttachment：`{kind: 'door'|'opening', wall: 'north'|'south'|'east'|'west', position_along_wall_ft, width_ft}`
- 可进入 venue editing 模式画自定义几何

**Inventory Item（家具库条目）：**
- 分类枚举（左侧栏）：`tables.high_top / tables.round / tables.rectangle / tables.other`、`chairs_stools`、`grouped_seating`、`lounge`、`bars_others`、`fencing_lights`、`equipment`、`pipe_drape`、`flooring`
- 具名 footprint 示例：`"6'×30\" Banquet Table"`、`"8'×30\" Banquet Table"`、`"5'×36\" Farm Table"`
- 字段：`{id, category, name, width_ft, depth_ft, height_ft, color, icon, user_defined: boolean}`
- Settings 里有 `Show item heights` 开关 → 确认 item 有 height 字段

**Placed Item（画布上的放置实例）：**
- 字段：`{inventory_id, x_ft, y_ft, rotation_deg, label?, locked?: bool, layer: string}`
- Grouped Seating（复合件）：`{template: 'chair_rows'|'table_set', spacing_ft, aisle_ft, facing: 'stage'|'aisle', pattern: 'theater'|'banquet'|'u_shape', count}`
- Drawn Run（管线类）：`{kind: 'pipe_drape'|'fence'|'bistro_light', path: Polyline[], height_ft?}`
- Flooring/Stage：`{kind: 'flooring'|'stage', x, y, width, depth, stage_attachments?}`
- Saved Layout Group：可复用的多件集合

**其他：**
- Layers：`{id, name, items_ref, visible, locked, order, reference_image?}`（参考图可独立层、调透明度、锁定）
- Settings：`{grid_ft_per_square: 10, snap_ft: 1, dark_mode, show_item_heights}`
- File：JSON import/export 作为 portable project file
- Inventory Key / Print：按类目出 counts（pipe&drape runs / fence / light runs / flooring / seating）

### 3.2 对照我们 `PlanAnnotation` / `FurnitureSpec` 的 gap

| OpenEventCAD 概念 | 我们当前 | gap |
|---|---|---|
| Venue 对象（尺寸 + 墙 + 门/开口） | `RoomSize{width, height}` 只有两个数 | 没有门位置、没有墙、没有 wall attachment。eR311 / 门弧遮挡无从测起 |
| 具名 inventory 库（"6'×30\" Banquet Table"） | `SPEC` 对象硬编码在 plan-approve.ts（4 种 zone × 1–2 件家具） | 没有可扩展家具目录；用户不能加自己的桌子 |
| Grouped Seating 模板（theater/banquet/u-shape + spacing/aisle/facing） | 我们 `gridRoundtable` 程序化生成，pitch 来自 density | 没有「模板」概念，没法复用一套排椅布局 |
| Drawn Run（pipe&drape / fence / bistro light 沿 polyline） | `route` annotation 是 polyline 但只作参考线，不会变成可摆放物品 | 管线类物品没有 placeable 实体 |
| Item height 字段 | `FurnitureSpec.height` 有（0.75/0.9/2.0）但从不参与打分 | 没有视线遮挡判断（如 2.0m 背景墙挡住后排视线） |
| Layers（参考图 / 物品 / 场地分层、可见、锁定） | 无 | 画布没有图层概念 |
| Label / 备注 / 交接 sheet | `PlanAnnotation.label` 有，但没 print / inventory key 统计 | 没有「按类目出 counts」的交接输出 |
| Saved Layout Group | 无 | 不能把一套圆桌布局存成模板复用 |
| 用户自定义 Venue / Inventory（My Venues / My Inventory） | 无 | SPEC 是 `as const` 硬编码 |
| 单位：英尺 | 我们用米 | 不是 gap，但活动行业默认英尺，未来导出要注意 |

---

## 4. 三条关键发现（TL;DR）

1. **RoomCraft 给我们的最大启发不是「更多分」，而是「硬/软约束分离 + 子分拆解」**：我们现在把所有东西揉进一个裸整数 score（capacitySeats - 2*skipped - 3*oob + flowPenalty + overlapPenalty），UI 没法说「这版动线 82、人体 70、容量 90」。建议下一批把 score 拆成 `{capacity, flow, ergonomics, light?}` 四个 0–100 子分加权，并把「椅后 0.6m / 签到台前 1.5m / 双人交汇 1.22m」三个最容易落地的人体工学项先加上。

2. **archi 的真正可抄之处是「每次调用都返回 violation envelope」，不是 TreemapSolver 本身**：我们 `planZones` 一遇到 zone 太小就整块 skipped + 中文 reason，`pickRecommendedPlan` 空数组直接 throw。archi 的范式是入参 Literal 枚举前置校验 + 返回带 code 的 violations（R311 / R304 ...）让 Agent 自己迭代。对应到我们：给 `ScoredPlan` 加一个 `violations: {code, severity, message}[]`（code 用 `E_OUT_OF_BOUNDS` / `E_ZONE_TOO_SMALL` / `E_FLOW_NARROW` / `E_UNKNOWN_ZONE_TYPE` ...），未知 zoneType 不再静默兜底成 roundtable，而是返回 warning。

3. **OpenEventCAD 告诉我们活动行业的数据模型比我们当前的「zone rect + 4 种 zoneType」厚一层**：它有 venue（带 door/opening wall attachment）、具名 inventory 库（"6'×30\" Banquet Table"）、grouped seating 模板（theater/banquet/u-shape）、drawn run 管线类、layers、saved groups。我们当前 `PlanAnnotation` 只有 zone/route/measure 三种 geometry，`FurnitureSpec` 是硬编码常量。下一批如果要做「门弧遮挡」「视线遮挡」「管线摆放」，都得先补 venue 上的 wall/door 字段和 inventory 可扩展目录——这是数据结构债，不是打分公式债。
