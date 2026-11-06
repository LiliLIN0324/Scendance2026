# Research-B：走廊连通性与可达性建模规格

> 研究线子任务 B 交付物。只产规格，不改产品代码。
> 参考：Co-Layout (arXiv 2511.12474, *LLM-driven Co-optimization for Interior Layout*)；OptiScene / 3D-SynthPlace (NeurIPS 2025)。
> 写作日期：2026-11-06。

---

## 1. Co-Layout 走廊连通 / 可达性建模

### 1.1 网格离散方式

Co-Layout 沿用勒·柯布西耶「Modulor」模数，把整个单层楼面离散成 **2D 直角网格** `G = {(i, j) : 0 ≤ i < W, 0 ≤ j < L}`，其中 `W、L` 是楼面在模数单位下的宽、长。为支持非矩形楼面（如 L 形），引入室内子集 `G' ⊆ G`，把预留给户外 / 外墙 / 不可用的 cell 排除在外。

每个 cell `(i, j)` 上并行挂三类二元变量：

| 变量 | 含义 |
|---|---|
| `x_{i,j}^k ∈ {0,1}` | cell 是否被第 `k` 个房间占用 |
| `p_{i,j} ∈ {0,1}` | cell 是否属于走廊 |
| `f_{i,j}^{k,l} ∈ {0,1}` | cell 是否被 `k` 房间内第 `l` 件家具占用 |

邻接定义为 **4 邻域** `N(i,j) = {(i,j+1),(i,j-1),(i+1,j),(i-1,j)}`，方向集 `D = {E, W, S, N}`。家具的朝向用两个二元变量 `(σ, μ)` 编码成 4 个轴对齐方向；尺寸 `W_{k,l} × L_{k,l}` 由 LLM 给出后就近取整成 `ℓ_{k,l}^i × ℓ_{k,l}^j` 个 cell。

工程上可借用的事实：**cell 大小不需要固定物理米数**，只要在同一工况下用同一模数即可；Co-Layout 跑 12×10 粗网格 → 6×5 中网格（每粗 cell = 2×2 细 cell）→ 原分辨率 warm-start 这一 coarse-to-fine 策略。

### 1.2 空间排他（Non-Overlapping）

最底层的硬约束是 **cell 唯一归属**：

```
p_{i,j} + Σ_k x_{i,j}^k = 1,   ∀ (i,j) ∈ G'
```

家具在房间内部还有一层「不重叠」：

```
Σ_l f_{i,j}^{k,l} ≤ 1,   ∀ (i,j) ∈ G'
f_{i,j}^{k,l} ≤ x_{i,j}^k          （家具必须落在所属房间内）
Σ_{i,j} f_{i,j}^{k,l} = ℓ_{k,l}^i · ℓ_{k,l}^j   （面积守恒）
```

这一层对应我们当前代码里已有的「zone 不重叠、家具不压 zone、outOfBounds」，属于已解决问题。

### 1.3 走廊连通性（Corridor Connectivity）

Co-Layout 不用 BFS / A\* / 可见性图，而是用 **max-flow 流守恒** 直接在 IP 里表达「所有走廊 cell 必须从入口连通」。

先把「可通行 cell」合并成一个统一布尔量：

```
q_{i,j} = p_{i,j} + Σ_{k ∈ R_O} (x_{i,j}^k − Σ_l f_{i,j}^{k,l})
```

其中 `R_O` 是 LLM 判定的「开放房间」（无墙、如客厅），它们本身也算走廊网络的一部分。`q=1` 表示该 cell 人能走；`q=0` 表示是封闭房间或被家具压住。

然后在每两个相邻 cell `(i,j)` 与 `adj(i,j,d)` 之间加一条有向边，流变量 `flow_{i,j}^d ≥ 0`：

```
flow_{i,j}^d ≤ M · q_{i,j}
flow_{i,j}^d ≤ M · q_{adj(i,j,d)}
```

只有两端都是可通行 cell，这条边才能过流。最后是 **流量守恒**——把入口 `(i_e, j_e)` 当作唯一源：

```
outflow_{i,j} − inflow_{i,j} =
    Σ_{(i',j')∈G'} q_{i',j'},   if (i,j) = (i_e, j_e)          # 出口供给 = 全部通行 cell 数
    − q_{i,j},                   otherwise                        # 每个通行 cell 恰好消耗 1 单位
```

含义翻译成人话：**如果某些走廊 cell 与入口断开，守恒方程就无解**，IP 直接不可行。这比跑 BFS 再事后判 inf 更严格、也可向量化。

### 1.4 可达性（Accessibility）

「可达性」与「走廊连通」是两件事：前者要求**每个封闭房间至少有一个门**，后者要求**所有走廊段是一个连通网络**。

Co-Layout 给每个房间 `k` 引入二元辅助变量 `α_{i,j}^k`，表示 cell `(i,j)` 是房间 `k` 的「入口接点」：

```
Σ_{(i,j)} α_{i,j}^k ≥ 1                                # 每个房间至少 1 个入口
Σ_{(i',j') ∈ N(i,j) ∩ G'} q_{i',j'} ≥ α_{i,j}^k         # 入口邻接一个可通行 cell（走廊或开放室）
α_{i,j}^k ≤ x_{i,j}^k − Σ_l f_{i,j}^{k,l}               # 入口 cell 自身不能被家具压住
```

第三条很关键：它防止「门的位置被一张桌子顶死」，这是我们当前 flow-constraints 里没建模、但现场摆摊最常翻车的情形。

### 1.5 附加关系（对我们有参考价值）

- **邻接 (Adjacency)**：用类似的 `β` 变量强制指定 room pair 共享至少一条边界（例如「签到区必须紧贴休息区」）。
- **Privacy Sorting**：定义 `D_k = (1/A_k) Σ x_{i,j}^k · d_{i,j}`，`d_{i,j}` 是 cell 到入口的曼哈顿距离，然后加软约束 `D_{k_i} + θ_i ≥ D_{k_{i+1}}`——把「越私密的 zone 离入口越远」写成一条线性不等式。
- **房间矩形度 / 周长**：`E_rect = Σ_k (bbox_area_k − actual_cell_count_k)`、`E_perim = Σ_k Σ_{i,j} x_{i,j}^k · |N_out(i,j)|`——惩罚锯齿形和破碎房间，对应我们「zone 不要被切得七零八落」的偏好。

---

## 2. 对 `flow-constraints.ts` 的升级规格

### 2.1 现状对照

当前模块只输出「签到区前净宽」这一个标量。按 Co-Layout 的分层，我们至少缺三类信息：(a) **走廊是否连通**；(b) **入口到每个 zone 是否可达**；(c) **入口接点是否被家具压住**。

### 2.2 坐标系与 cell 约定（建议）

- 现场坐标系：舞台/场地长边沿 `z` 轴，**入口在 z 负方向**（与现网代码一致）；`x` 轴横向宽度。
- 选择 **cell 大小 = 0.3 m**（≈ 1 个 Modulor 模数的实际取值；人肩宽 0.5–0.6 m，0.3 可让「1.2 m 净宽」= 4 cells 直接整除）。
- 室内网格 `G'` = 场地矩形内、扣除外墙 / 禁区 / 已摆放家具 footprint 后的 cell 集合。
- 不再区分 `p`（走廊）与开放室：**我们所有非 zone cell 都算走廊**，简化成单层 `walkable(i,j)` 布尔图。

### 2.3 连通性判定算法选型

Co-Layout 用流守恒是为了把它塞进 IP 当硬约束；我们只做**事后评估**，不必上 LP。直接退化为 **4 邻接 BFS**：

1. 从入口 cell（z 最小、x = 场地中点）开始 BFS 遍历 `walkable` 图。
2. BFS 覆盖到的 cell 集合 = `reachable`。
3. 对每个 zone，取它的 footprint cell 集合 `Z_k`；若 `Z_k ∩ reachable = ∅` → 该 zone 完全不可达。
4. **最小通道净宽**：在 BFS 得到的每一条「从入口到 zone k」的最短路径上，沿路径法向（垂直于前进方向）量两侧被家具/zone 边界夹住的连续可走 cell 数 × 0.3 m；取所有候选路径中的最小值。这是对「path 净宽 ≥ 1.2 m」的近似，实现上可以简化成「在 BFS 路径 cell 上做膨胀检测：把路径 cell 向左右各膨胀 2 cells 是否仍在 `walkable` 内」。

### 2.4 函数签名建议（仅签名，不写实现）

```ts
// 几何原语（已存在或在 room-organizer 内可得）
type Vec2 = { x: number; z: number };

interface ZonePlacement {
  zoneId: string;          // e.g. "sign-in" | "lounge" | "round-table" | "booth"
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  kind: 'enclosed' | 'open';   // open = 不需门，本身可通行；enclosed = 需要入口接点
}

interface ObstacleRect {
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  ownerId: string;         // 家具或 zone id，用于报错时归因
}

interface EntranceSpec {
  // 入口在场地 z 最小边，横向中心点（单位：米）
  centerX: number;
  // 入口开门净宽（米），用于 BFS 起点扇区大小
  widthM: number;
}

// 连通性评估输出
interface CorridorConnectivityReport {
  // 整体：从入口能否走到场地内任一可通行 cell
  connected: boolean;
  // BFS 后剩余不可达的可通行 cell 面积（米²），用于加权扣分
  unreachableWalkableAreaM2: number;
  // 每个 enclosed zone 的可达性明细
  perZone: Array<{
    zoneId: string;
    reachable: boolean;             // zone footprint 至少 1 cell 与 reachable 相连
    minPathWidthM: number | null;   // 从入口到该 zone 的最窄路径净宽；不可达为 null
    pathWidthViolationM: number;    // max(0, 1.2 - minPathWidthM)，违反量
    blockedBy: string[];            // 堵住入口接点的 obstacle id 列表（为空 = 没堵）
  }>;
  // 指定 zone 对之间是否互相连通（用于「签到→休息」「签到→圆桌」）
  pairReachability: Array<{
    fromZoneId: string;
    toZoneId: string;
    connected: boolean;
  }>;
}

// 主函数
export function evaluateCorridorConnectivity(opts: {
  zones: ZonePlacement[];
  obstacles: ObstacleRect[];
  entrance: EntranceSpec;
  fieldBounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  cellSizeM?: number;               // 默认 0.3
  requiredPathWidthM?: number;      // 默认 1.2
}): CorridorConnectivityReport;
```

### 2.5 与现有 `flowPenalty` 的对接建议

- 现有 `flowPenalty` 是单一标量；新报告应拆成两个独立扣分项喂给 `plan-scoring.ts`（见 §3.3）：
  - `connectivityPenalty`：不可达的 enclosed zone 数 × 大权重；
  - `pathWidthPenalty`：`Σ_k max(0, requiredPathWidthM − minPathWidthM)` × 小权重。
- 保留「签到区前净宽」作为独立 UI 展示项，但**不再**把它当唯一 flow 指标。
- `blockedBy` 字段直接喂给 `plan-approve` 的「人话降级」通道：例如 `签到区入口被 booth-3 堵住`。

---

## 3. OptiScene / 3D-SynthPlace 目标函数参考

### 3.1 澄清：OptiScene 没有显式数学目标函数

OptiScene 是 LLM + SFT + 两阶段 DPO 的偏好对齐管线，**不像 Co-Layout 那样有一条加权的解析目标**。它的「优化目标」体现在三处：

1. **Meta-prompt 里的设计启发**（§3.3）；
2. **DPO 硬负样本注入的两类违规**：out-of-boundary、object-overlap；
3. **评估指标**：OOR（重叠面积比）、FID、GPT-4o 三维打分（Functionality / Furniture Layout / Aesthetics）、Usability Rate。

把它当作「人类设计师偏好的代用品」反推，等价的隐式目标项大致如下。

### 3.2 它的隐式目标项清单

| 项 | 含义 | 在 OptiScene 里的载体 |
|---|---|---|
| 碰撞 / 重叠惩罚 | 物体 footprint 不相交 | DPO-stage 2 硬负样本；评估 OOR |
| 越界惩罚 | 物体不能超出房间边界 | DPO-stage 2 硬负样本 |
| 贴边 / 靠墙奖励 | 大件贴墙放，让出中央空地 | Meta-prompt 第 (4)(5) 条：「objects at the edge」「parallel/perpendicular to walls」 |
| 功能分组 | 床–床头柜、桌–椅必须成组 | Meta-prompt 第 (7a)(7b) 条 |
| 面向关系 | 椅子面向桌子、沙发面向茶几 | Meta-prompt 第 (6) 条；Co-Layout 附录 B.2 的 `ν·Δξ ≥ 0` |
| 动线 / 可达 | 留出 circulation，不堵门 | Meta-prompt 第 (7c) 条「Traffic flow and accessibility」；下游机器人导航 SR/NE |
| 视觉平衡 / 疏密均匀 | 不要把大件全堆在角落 | GPT-4o Aesthetics 维度；Co-Layout 的 Distribution Balance |
| 离入口层级 | 私密区靠里、公开区靠外 | Co-Layout 的 Privacy Sorting（OptiScene 未显式，但 GPT-4o Functionality 维度间接覆盖） |

### 3.3 对照我们 `plan-scoring.ts` 现有 score

现有（hint 给出的口径）：

```
score = capacity − 2·skipped − 3·outOfBounds − flowPenalty
```

逐项对照：

| 现有项 | 覆盖了 OptiScene 哪一项 | 缺什么 |
|---|---|---|
| `capacity` | 房间/zone 容量达标（≈ Area Target） | 没区分「公区容量」和「私密容量」的优先级 |
| `−2·skipped` | 应摆的 zone 没摆（覆盖不全） | 没考虑「摆了但位置错」（如休息区放到离签到 8 m 外） |
| `−3·outOfBounds` | 越界惩罚 ✅ | 已对齐 DPO-stage 2 的 out-of-boundary 硬负样本 |
| `−flowPenalty` | 动线 / 可达 ⚠️ | **只算了签到前净宽，没算「每个 enclosed zone 是否可达」「path 净宽是否 ≥1.2 m」** |

**建议补的项**（按价值从高到低，仅建议、不在本子任务落地）：

1. `−w_1 · unreachableZones`：不可达的 enclosed zone 数（接 §2.4 `perZone[].reachable`）。
2. `−w_2 · Σ_k max(0, 1.2 − minPathWidthM_k)`：通道净宽不足的累计米数。
3. `−w_3 · blockedEntrances`：入口接点被家具压住的次数（直接对应 Co-Layout 可达性第三约束 `α ≤ x − f`）。
4. `+w_4 · frontageScore`：大件贴边程度——与 OptiScene「edge placement」对齐，对应 Co-Layout 的 `E_perim`。
5. `−w_5 · entryDistanceViolation`：把「签到区必须在入口第一排、圆桌区在签到区之后、休息区最深」编码成软不等式（Co-Layout Privacy Sorting 的摆摊版）。

权重初值留空，等对抗测试 A–H 跑完再定。

---

## 4. 关键发现（3 条）

1. **连通性与可达性是两条独立约束，不能互相替代**：Co-Layout 用流守恒（flow conservation）保证走廊网络整体连通，用 `α` 辅助变量保证每个封闭房间有一个**不被家具压住**的邻接入口。我们当前只算了「签到前净宽」，等于同时把这两条都省了——现场最常翻车的「booth 把休息区入口堵死」正是这条没建模。
2. **网格离散不必追求物理精度，cell = 0.3 m 即可**：Co-Layout 的 12×10 → 6×5 粗到细策略证明连通性对错几个 cell 不敏感；我们直接用 0.3 m cell（让 1.2 m 净宽整除成 4 cells）跑 BFS 足够，不需要真上 LP。
3. **OptiScene 没有显式加权目标，但它的 DPO 硬负样本清单本身就是一份「该扣分项」的参考答案**：out-of-boundary + object-overlap 我们已覆盖（`outOfBounds` / zone 不重叠），缺的是 **edge-placement 奖励、zone 间可达性、入口层级（Privacy Sorting）** 三类软项；这些恰好可以用 §2.4 的 `CorridorConnectivityReport` 直接喂进 score。
