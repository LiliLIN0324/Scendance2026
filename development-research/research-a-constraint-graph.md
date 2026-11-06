# 研究线 A：约束图结构与 grounded planning 分工

> 研究对象：FlairGPT（arXiv 2501.04648）+ OpenAI Cookbook《Evaluating Grounded Spatial Reasoning with GPT-5.5》。
> 目的：为 Scendance2026 第 12 批之后的「标注→家具」升级提供数据结构与分工参考。
> 阅读对象：后续承接实现任务的同学；本文只产规格，不含实现代码。

---

## 1. FlairGPT 约束图结构

### 1.1 论文原文怎么组织

FlairGPT 把室内设计拆成三阶段：

1. **Language Phase**：LLM 依次产出 ① 房间参数（尺寸、门/窗/插座位置）② 按重要性排序的 zone 列表 `Z = {z1..zk}`（此时还不做空间划分）③ 每个 zone 的 primary object（focal）④ 每个 zone 的 secondary object（floor-based 补充件）⑤ tertiary object（挂墙/挂顶/桌面/地毯）⑥ inter-object + intra-object 自然语言约束，最后由 LLM 自清洗（合并、去重、拆复合、删矛盾）。
2. **Translation Phase**：作者给出一个「blank」cost function 库（只有函数签名 + docstring + 示例，不含实现），让 LLM 把每条自然语言约束 map 到库里的一个函数；匹配不上就丢弃，参数不对就安全返回 cost=0。
3. **Optimization Phase**：SLSQP 分层求解——先放 primary（含 balanced + wall_attraction），用 primary 中心做 Voronoi 得到 zone；再逐 zone 放 secondary（加 zone_membership 惩罚）；最后一次性放 tertiary（同 type 不重叠 + on_wall）。

### 1.2 节点类型枚举

| 类别 | FlairGPT 节点 | 含义 |
|---|---|---|
| 房间边界 | room (w, l, h=3m 默认) | 固定边界条件 |
| 固定物 | door / window / socket | 有位置、朝向、宽度，约束其他物体避让 |
| 功能区 | zone z_i（Voronoi 动态生成） | 由 primary 中心推导，不是预先画死的矩形 |
| 主家具 | primary object（每 zone 1 件，含 w/l，不含 h） | 锚点，决定 zone 中心 |
| 次家具 | secondary object（floor-based，含所属 zone） | 围绕 primary 补功能 |
|  tertiary | tertiary object（type ∈ wall/ceiling/surface/floor） | 挂在主/次家具或墙面上，每件只有一条约束 |

### 1.3 边类型枚举（成对出现，无向）

- **intra-object 边**：物体 ↔ 房间固定物 / 墙。典型边名：`next_to_wall`、`away_from_fixed_object(door|window|socket, min_dist)`、`accessible(sides=[...])`（哪几侧必须留空）。
- **inter-object 边**：物体 ↔ 物体。典型边名：`near_to`、`far_from`、`not_face`（如镜子不对床）、`between`（床在两个床头柜之间）。
- **默认硬边**（不依赖 LLM 输出，优化器内置）：`no_overlap`（含门摆动区）、`in_bounds`、`aligned`（朝向对齐 cardinal）、`balanced`（重心落在房间中心）、`wall_attraction`（避免家具悬浮在中央）、`zone`（secondary 不漂出所属 Voronoi 区）、`on_wall`（挂墙件必须贴墙且避开门/窗）。

### 1.4 约束类型枚举（cost function 库抽样）

`ind_next_to_wall` / `ind_away_from_fixed_object(door|window|socket, min_dist)` / `ind_accessible(sides)` / `ind_in_region(zone)` / `on_wall` / `no_overlap` / `in_bounds` / `aligned` / `balanced` / `wall_attraction` / `zone_membership`。每条约束在优化期是可加权项（λ 可调），不是硬筛。

### 1.5 我们仓现状 vs FlairGPT 对照表

| 维度 | FlairGPT | 仓内现状（文件:行） | Gap |
|---|---|---|---|
| 节点：房间固定物 | door/window/socket 一等公民，参与 cost | 标注层完全没有门/窗/插座概念（`plan-annotation.ts` 只有 zone/route/measure 三种 kind） | 缺房间固定物节点，所有「避门/避窗」约束无处落地 |
| 节点：功能区 | zone 由 primary 中心 Voronoi 动态推导 | zone 是用户手绘矩形，是死的边界（`plan-annotation.ts:30-33` rect 几何） | 手绘矩形 → 无法在家具落位后反推 zone，也无法表达「zone 内放几件后重心在哪」 |
| 节点：家具分层 | primary / secondary / tertiary 三层 | 每 zoneType 写死一套模板，无分层（`plan-approve.ts:62-78` SPEC 表） | 圆桌=primary 但椅子没有作为 secondary 显式建模；签到台后那把工作椅其实是 secondary，目前和签到台同优先级 |
| 节点：tertiary | 挂墙/挂顶/桌面/地毯四类，每件一条约束 | 完全缺席（`plan-approve.ts` 只有 floor-based） | 背景墙、绿植、吊顶灯、地毯都没法表达 |
| 边：intra-object | 物体↔墙/门/窗/插座，含 accessible sides | 只在 `plan-approve.ts:113-136` 硬编码最小 zone 尺寸阈值（如「圆桌区至少 1.9×1.9」），不是边 | 没有「这件家具哪几侧必须留 0.6m 通行」的可声明边 |
| 边：inter-object | 对象两两关系（near/far/not_face/between） | 完全缺席——planZones 是 zone-by-zone 独立网格，不看其他 zone | 「签到台不能正对主舞台」「休息区长椅不能背对着打卡墙」这类跨 zone 关系无法表达 |
| 边：route/通道 | cost 项 `pathway`（medial axis 净空）在评估期 | `flow-constraints.ts` 只盯「入口→签到区」一条通道，且只报一个最小 aisleWidthM | 缺 zone↔zone 通道图，主通道外的通道（roundtable→photo、checkin→rest）不评估 |
| 约束形态 | cost function 库，LLM 自然语言→函数映射，可加权 | 硬编码阈值 + 人话 skipped.reason（`plan-approve.ts:108-135`） | 没有可插拔 cost 库，新增约束要改 if/else |
| 求解方式 | SLSQP 分层全局优化，多初值取最优 | zone-by-zone 网格 + 后续 `settlePlacement` 局部平移 | 跨 zone 冲突（A zone 的桌子压到 B zone 边缘）只能等 settle 事后挪 |

---

## 2. OpenAI grounded planning 分工

### 2.1 Cookbook 原文的分工写法

任务：空 floorplan 图 + SOP（`constraints.json`）+ 家具 catalog → 结构化 `raw_layout.json`。

**两次 LLM 调用、三层评估、一道 deterministic 修复链**：

1. **第一次 LLM（grounding）**：只看图，输出房间语义——哪些墙/门/楼梯/分区、每个空间的 `semantic_type`、client brief 要求的 `required_spaces` 覆盖情况、所有 `assumptions`（如「南侧双开门视为主入口」）。这一步不出家具。
2. **第二次 LLM（furnish）**：在已接地的 semantic zone 之上，结合 `required_objects` 和 catalog 尺寸，输出 `furniture_placements[]`——每件含 type / center / dim / orthogonal rotation（只允许 0/90/180/270）/ zone_membership / grouping / rationale / confidence。同时输出 `feasibilityJudgment` 和 `unsatisfiedConstraints[]`。
3. **三层 eval（分开打分，不合并）**：
   - **validity（deterministic hard gate）**：墙碰撞、对象重叠、是否落在声明 zone 内、是否越界——唯一 pass/fail。
   - **grounded_program（semantic score）**：GPT 判「房间识别是否忠于原图、程序是否符合 brief」——打分不 pass/fail。
   - **reference_similarity（deterministic gold）**：有黄金 JSON 时对照 zone 一致性 + 家具数量 + 容差内的位置邻近度——benchmark 用，不 hard reject。
4. **Deterministic repair 链**：orthogonal-rotation search → local repair → joint-repack fallback。机械错误由代码修，不再回去烦 LLM。
5. **Rendering 是下游 inspection**：GPT Image 2 按 spec 渲图给人看，但 source of truth 是 spec，不是图。

### 2.2 关键设计原则（Takeaways 原文）

- **模型不自我验证**：spec 先落成机器可检查 JSON，再被独立 eval stack 拆成 semantic / mechanical / reference 三层分别诊断。
- **模型管语义，代码管几何**：GPT 擅长「读模糊几何、分配房间程序、提出连贯布局」；确定性代码擅长「边界检查、碰撞、净空、旋转、repack」。
- **Hard/soft 约束分级**：`spatial_constraints[]` 里每条都标 `enforcement: "hard" | "soft"`（如主通道净空 48in=hard，cluster size 4/6=soft）。
- **Run 15 落点**：GPT 出 grounded plan → 一次模型 repair zone-bounds → deterministic geometry 清掉 desk/storage 残留碰撞 → 达成 `completed_valid`。

### 2.3 我们仓现状 vs Cookbook 分工对照

| Cookbook 步骤 | 仓内对应 | Gap |
|---|---|---|
| 第一次 LLM grounding（房间语义 + assumptions） | `plan-annotation.ts` 用户手绘 zone（等价于人做了 grounding）；第 12 批三版打分是 LLM 在打分但不出 grounding spec | 没有显式的「grounding JSON」输出（zone 语义、assumptions、required_spaces 覆盖表） |
| 第二次 LLM furnish（结构化 placements） | `planZones` 是纯函数网格（`plan-approve.ts:91`），不是 LLM 调用；家具列表由 zoneType 查表生成 | 没有 LLM 参与「这件 zone 该放几件、放哪、为什么」——所有 rationale 都是写死的模板 |
| Spec 含 feasibilityJudgment + unsatisfiedConstraints | 有 `skipped[]`（`plan-approve.ts:51-55`）但只含「没摆下的 zone」，不含「摆下了但违反了哪条约束」 | 缺 unsatisfiedConstraints 列表；flow-constraints 的 violations 是事后算的，没回灌进 spec |
| Validity hard gate（deterministic） | `applyLayoutCommandWithRefusals`（`room-organizer.tsx:3029`）：OUT_OF_BOUNDS / WALL_INTERSECTION / BBOX_OVERLAP / FLOOR_OUT_OF_RANGE | ✅ 已有，且是真硬筛 |
| Grounded program score（semantic） | 无 | 没有「这版方案是否读懂了场地/是否符合客户 brief」的独立打分 |
| Deterministic repair 链 | `settlePlacement`（`room-organizer.tsx:3038`）：BFS 可达性 + 最小平移收敛 | ✅ 已对应 Cookbook 的 local repair；但没有 orthogonal-rotation search 和 joint-repack fallback |
| Rendering 是下游 | 画布实时渲染 | ✅ 已对应 |
| Hard/soft 约束分级 | `flow-constraints.ts` 里 1.2m / 1.5m 是硬阈值，没标 soft | 缺 enforcement 字段，所有违规一刀切扣分 |

---

## 3. 对我们的升级建议（每条一句话）

1. **plan-annotation 应增加「约束边」类型**（zone↔zone 的相邻/遮挡/可达关系，以及 zone↔door/window 的绑定），目前只有孤立 zone 矩形 + route 折线，跨 zone 关系无处声明。
2. **FurnitureSpec 应从「每 zoneType 写死模板」升级为 primary/secondary/tertiary 三层 + 房间固定物节点**，并接 FlairGPT 式 cost function 库（next_to_wall / away_from_fixed_object / accessible_sides / no_overlap / in_zone），替代现在硬编码的 1.9×1.9、2.6×1.4 阈值。
3. **onApprove 链路应拆成两次 LLM 调用**：先 grounding 出 semantic zone 表 + assumptions + required_spaces 覆盖度，再在已接地的 zone 上 furnish；当前 planZones 是一次性纯函数网格，没有显式 grounding 输出可审。
4. **落家具前应输出 Cookbook 式 spec-first 评估**：在 applyLayout 之前显式列 `feasibilityJudgment / unsatisfiedConstraints / assumptions`，三层分开打分（validity 硬筛 / grounded_program 语义分 / reference 对照分），而不是只靠 refusals + settlePlacement 修复。
5. **flow-constraints 应从「只盯签到区一条通道」扩展为 zone 可达图**（checkin→roundtable、roundtable→photo、photo→rest 两两通道），每条独立报净空并标 hard/soft，而不是现在只报一个最小 aisleWidthM。

---

## 附：引用来源

- FlairGPT 原文（HTML 全文）：https://arxiv.org/html/2501.04648v1
- FlairGPT 项目页：https://flairgpt.github.io/
- OpenAI Cookbook grounded spatial reasoning ipynb：https://github.com/openai/openai-cookbook/blob/main/examples/multimodal/grounded_spatial_reasoning_layouts.ipynb
