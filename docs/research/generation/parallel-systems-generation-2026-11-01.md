# 同类系统横向调研：我们用 5 个系统交叉验证「生成架构」共性，并定位幕景缺的 3 个机制

> 目的：拿外部系统验证我们从 PetitMaker / oddeNova 提炼的共性，并找出幕景 3.0 还缺的机制。
> 范围：只读 + 网页检索；不装依赖、不改代码、不抄任何项目源码（含 AGPL / BUSL 项目，只提炼机制）。
> 证据等级：A = 读过源码/官方文档原文；B = 读过论文正文/README；C = 仅摘要或二手描述（在文中标注）。
> 2026-11-01。

---

## 1. 一页结论

### 1.1 我们的共性被独立验证到什么程度

提炼的共性：**自然语言 → 单一可校验工件（受限 DSL/IR）→ 确定性解释/求解 → 结构化拒绝回灌 → 一次终态提交 → 可读回摘要**。

| 共性环节 | 独立验证者（本节 5 个系统） | 结论 |
|---|---|---|
| 自然语言 → 单一受限工件 | LayoutGPT（CSS 风格布局文本）、Holodeck（LLM 只产房间/物件/空间关系 JSON）、SceneCraft（LLM 只产场景图 + Blender 脚本）、MAC-SQL（SQL） | **强验证**：4 个系统都不让 LLM 直接改世界，只让它写一种文本工件 |
| 确定性解释/求解 | Terraform（HCL → plan 图）、Holodeck（DFS/MILP 约束求解）、SceneCraft（关系打分函数做优化） | **强验证**：LLM 之后一定有一层"非 LLM 的确定性程序" |
| 结构化拒绝回灌 | MAC-SQL（SQLite error + exception class 回灌）、Terraform（tfdiags：severity/summary/detail/subject）、SceneCraft（VLM 指出未满足的约束） | **强验证**；但**回灌粒度**差异很大，见 §4.2 |
| 一次终态提交 | Terraform `apply`（唯一写状态通道）、MAC-SQL 最终 SQL、oddeNova `commit` | **强验证** |
| 可读回摘要 | Terraform `change_summary`（1 to add / 0 to change）、Holodeck 俯视图 + scene JSON 里的 `raw_*_plan`、SceneCraft 渲染图 | **强验证**，且都做到"人读一句 + 机器读一份"双通道 |
| 计划与执行分离 | Terraform（plan 文件 → apply）、Holodeck（计划 JSON → 生成器） | **强验证**；SceneCraft/LayoutGPT/MAC-SQL **没有**这一层，风险明显更高 |

**没被任何系统验证的**：我们"候选只推预览、确认前一个字节不写画布"（`onPreview` 只进 React state）——外部系统普遍没有"预览态"概念，Terraform 的 speculative plan 最接近（只描述不执行），可作为该机制的合法性背书，但没有可抄的实现。

### 1.2 我们缺的 3 条机制（按价值排序）

1. **计划工件（Plan Artifact）**：可存档、带内容指纹、带时效、apply 时二次比对的"这一版"对象。Terraform 的 saved plan 把 **配置快照 + 旧 state + 变量值 + 依赖锁** 一起钉进 zip（`planfile/writer.go`），apply 时从内嵌 state 起算并拒绝改参数（`backend_apply.go`）。幕景本地这份东西**不存在**：`PlanProposal` 只是内存快照序列，确认时用的是对象引用相等（`agent-panel.tsx:883`），既不能审计、也不能防"同值不同对象"或"放十分钟再点确认"。
2. **逐条诊断（Diagnostic）而不是整批抛错 + 一个 `blocked` 字符串**：Terraform 每个问题都是 `{severity, summary, detail, subject(range)}`，并同时出 `planned_change` / `change_summary` 机器可读事件流；MAC-SQL 把 `sqlite_error` 和 `exception_class` 原样回灌后再修。幕景服务端 `buildProposal` 遇到第一条坏命令就 `throw ApiError`（`ai.ts:109/110/129/134`），前端 `PlanProposal` 只有 `dropped: number` 和 `blocked: string|null`（`agent-proposal.ts:77-83`）——**丢了几件、为什么丢、能不能只修这几件，全都没有结构化载体**。
3. **布置前先算可行域与容量（硬约束掩码 + 容量账本）**：Holodeck 把边界/不重叠/贴墙/朝向写成 MILP 硬约束、把近/远/对齐写成软目标（`milp_utils.py`），SceneCraft 把"对齐/平行/邻近"翻译成打分函数再求最优；LayoutGPT 则用"越界率"指标事后度量。幕景 `proposePlan` 是槽位启发式 + 线性扫描，放不下就 `dropped`（`agent-proposal.ts:306/199-209`），**没有"这块地最多能坐多少人/放多少展位"的反算**，也没有把"主通道 ≥1.2m / 入口净空"变成生成前的硬掩码（这些规则现在只在体检里报 issue，`layout-review.ts:18-19`）。

一句话：外部系统告诉我们，**我们已经对了（语言→工件→确定性校验→一次提交），缺的是"工件的身份/时效""拒绝的可计算粒度""生成前的可行性"**。

---

## 2. 对比表

| 系统 | 输入归一化 / IR | 谁判合法性 | plan → approve → apply | 部分失败会计 | 人读回读 / 机器可读 | 许可 |
|---|---|---|---|---|---|---|
| **Terraform / OpenTofu** | HCL 配置 → `plans.Plan`（JSON 可导出）；saved plan = zip(tfplan + tfstate + tfstate-prev + tfconfig + lock) | 编译/规划器（core）：类型、引用、provider schema、precondition；apply 前再拒 `Errored`/不可应用 plan | **有，最强**：`plan -out` → 人工/CI approve → `apply PLANFILE`，且**不许改 `-var`**、不许改 `-target`（只告警） | `planned_change` 逐资源 + `change_summary{add,change,remove}` + `apply_errored` + `diagnostic` | 终端人读 + `-json` 流式事件（`ui` schema 版本化） | BUSL-1.1（Terraform）/ OpenTofu 另计 |
| **Holodeck**（AI2） | 自然语言 → GPT-4 产：房间规格、物件选择、空间关系约束（JSON）→ 生成器落成 scene JSON | 生成器 + 约束求解器（DFS / 可选 MILP，cvxpy） | 半有：计划 JSON 先落盘（`raw_*_plan`、`object_selection_plan`）再生成；无人工审批 | 弱：`ablate_placement` 无物件可放即 `None` 跳过；`used_assets` 跨变体去重 | 俯视 PNG + 可加载 Unity 的 scene JSON（含各阶段原始计划） | Apache-2.0 |
| **SceneCraft**（Google/Caltech） | 自然语言 → 场景图（资产节点 × 关系节点：对齐/平行/邻近）→ Blender Python 脚本 | **软**：每关系一个打分函数，优化总分；无硬校验器；靠 GPT-4V 看渲染图挑错 | 无 | 有指标：constraint pass rate（88.9 vs 基线 5.6） | 渲染图 + 脚本 + 技能库 | 论文 CC BY 4.0；**无官方代码** |
| **LayoutGPT**（UCSB） | 自然语言 + ICL 示例 → CSS 风格布局文本（`{length; width; left; top; orientation}`）→ 解析成对象列表 | **事后度量**：越界率、KL；解析失败静默跳过；无运行时拦截 | 无（布局 → 下游 GLIGEN/ATISS 生成） | 弱：`n_lines`/`n_furnitures` 计数；OOB 逐件记录溢出量 | 布局文本 + 评测脚本输出；每 prompt 生成 5 版降方差 | MIT |
| **MAC-SQL**（多智能体 Text-to-SQL） | 自然语言 + schema（Selector 先裁剪表/列并给值样例）→ SQL | **执行器**（SQLite）：真跑，抓 `sqlite.Error`；"空结果/含 None"也算需修 | 无（最终 SQL 即提交） | 有：`try_times`、`fixed` 标记；`MAX_ROUND=3` 轮上限 | 终端日志 + `pred` 字段；无结构化诊断对象 | **未声明许可**（仅提炼机制） |

> 读表要点：**只有 Terraform 同时具备"计划工件 + 审批门 + 不可变参数 + 机器可读事件 + 计数摘要"五件套**；3D 场景三家（Holodeck/SceneCraft/LayoutGPT）都把"合法性"外包给求解器/打分/指标，没有一家做了"计划存档 + apply 二次比对"。

---

## 3. 逐系统

### 3.1 Terraform（+ OpenTofu 文档）——"计划即工件"的完整样本

链接：<https://github.com/hashicorp/terraform> · plan 文档 <https://developer.hashicorp.com/terraform/cli/commands/plan> · OpenTofu plan 文档 <https://github.com/opentofu/opentofu/blob/main/website/docs/cli/commands/plan.mdx> · machine-readable UI <https://github.com/opentofu/opentofu/blob/main/website/docs/internals/machine-readable-ui.mdx>

1. **输入归一化 / IR**：不是自然语言，而是 HCL → `plans.Plan`（资源级 change 集合 + prior state + 变量值 + 目标地址）。saved plan 的物理结构在 `internal/plans/planfile/writer.go`：zip 里放 `tfplan`（计划本体）、`tfstate`（刷新后的基线）、`tfstate-prev`（上一次 apply 后的基线）、`tfconfig/`（配置快照）、`.terraform.lock.hcl`（依赖锁）。文档明确说 plan 文件"包含完整配置、所有计划变更的值、以及包括输入变量在内的全部 plan 选项"（plan.mdx `-out`）。
2. **谁判合法性**：Terraform Core 的 plan 阶段（类型/schema/引用/precondition/`check` 块），apply 阶段再拒一次"不可应用的 plan"：`context_apply.go` 里 `plan.Errored` → `Cannot apply failed plan`；`!plan.Applyable` 且 `Changes` 非空 → `Cannot apply non-applyable plan`。**回灌方式**：`tfdiags` 诊断（severity/summary/detail/subject 源范围），人读文本 + `-json` 事件流双通道。
3. **plan/apply 分离**：`plan -out=FILE` 产"可执行计划"，`apply FILE` 执行且**把传 plan 文件本身当作审批**（apply.mdx：`-auto-approve` 在传 saved plan 时被忽略，因为"传文件即批准"）。关键约束：**apply saved plan 时不许改非 ephemeral 变量**（`backend_apply.go`：`Can't change variable when applying a saved plan`）；`-target` 不一致只告警并忽略；`destroy`/`refresh-only` 模式不一致也告警。幂等/回滚：状态文件有 serial/lineage + 锁；apply 失败时 `applyState` 仍写回（"部分更新"是显式承认的），写 state 失败会落 `errored.tfstate` 并提示 `terraform state push`（`backend_apply.go` 的 `backupStateForError`）。
4. **部分失败会计 / 回读**：`planned_change`（每资源一条，带 action: create/update/replace/delete/noop 与 reason 枚举）、`change_summary{add,change,remove,operation}`、`apply_start/apply_complete/apply_errored`、`resource_drift`。人读侧 `Plan: 1 to add, 0 to change, 0 to destroy.`。`-detailed-exitcode` 把结果编码成 0/1/2（空 diff / 错 / 有 diff），可直接接 CI。
5. **比我们多什么 / 最值得补**：**plan 文件内嵌"当时的基线"**。因为 apply 从内嵌 state 起算，`plan` 之后世界变了就必须重 plan——这是"计划时效性"的工程解，不依赖时间戳 TTL。对应到我们：`PlanProposal` 应当内嵌 `baseHash`（内容哈希）+ 生成时的 `revision`，确认时比对；**且 apply 只接受"这张 plan 描述的那个候选"**，不允许"参数微调后套用旧计划"（我们尤其要防：改完人数/展位数量后，用旧候选点确认）。
   > 说明：Terraform 报错文本 "Saved plan is stale" 未在本次读到的源码里定位（BUSL 分支 2026 版可能已重构），因此只把它当"存在过期判定"的旁证，不当作已核实事实。

### 3.2 Holodeck（CVPR 2024，AI2）——LLM 只写"关系约束"，求解器负责摆

链接：<https://github.com/allenai/Holodeck> · <https://arxiv.org/abs/2312.09067> · 约束代码 `ai2holodeck/generation/milp_utils.py` · 主流程 `ai2holodeck/generation/holodeck.py`

1. **归一化 / IR**：自然语言 → GPT-4 产出"房间类型/尺寸、物件清单、物件间空间关系"（论文摘要："prompt GPT-4 to generate spatial relational constraints between objects and then optimize the layout to satisfy those constraints"）。IR 是 **scene JSON**：`rooms / walls / doors / windows / objects / small_objects / raw_doorway_plan / raw_window_plan / object_selection_plan` 等（`holodeck.py` 各 `generate_*` 把每阶段原始计划写回 scene）。工序是固定顺序：房间 → 墙 → 门 → 窗 → 选物件 → 地面物件 → 墙面物件 → 小物件 → 天花 → 灯光 → 分层 → skybox（`generate_scene`）。
2. **谁判合法性**：**约束求解器**。`milp_utils.py` 用 cvxpy 定义硬约束：房间边界（`create_boundary_constraints`）、两物不重叠（`create_nooverlap_constraints`）、朝向不得背墙（same）、贴边（`create_edge_constraints`，含"长边贴墙"分支）、相对方位（`create_relative_constraints` 的 left/right/side/in front of/behind），以及软目标（`create_distance_constraints` 的 near 最小化 L1 距离 / far 最大化）。求解器默认是 **DFS**，MILP 是可选项（`main.py --use_milp` 默认 `False`；README 明确"use DFS as the solver"）。LLM 在这一层没有否决权。
3. **plan/execute 分离**：有"计划先落盘"的味道——每阶段产 `raw_*_plan` 再交给下一阶段/求解器；`use_constraint` 开关可跑消融（关掉约束 = 随机摆放），说明"约束层"是可插拔的确定性组件。无人工审批、无回滚。
4. **部分失败会计 / 回读**：弱。`ablate_placement` 在"一件都没放下"时打印 `No object is placed, skip this scene` 并 `return None`；`generate_variants` 用 `used_assets` 把已用资产排掉，强制变体不重复；最终产出俯视 PNG（`get_top_down_frame`）+ 可被 Unity 加载的 scene JSON。**没有"拒绝计数账本"**。
5. **比我们多什么 / 最值得补**：**把"关系"当一等公民**。它不生成坐标，生成"餐桌旁边 / 舞台前面 / 沿墙对齐"，再由求解器落坐标。我们的 op 级 IR 只有 `add/move/rotate/...` 的绝对坐标，**没有"相对关系"表达**——这导致"座位成排对齐""展位沿通道两侧""签到台在入口右侧 2m"这类活动场地最常见的意图，只能靠启发式槽位硬编码。中价值：可给 `SceneScriptOp` 增 `place_row` / `anchor` 这类关系型 op（基线审计 §4.1 已提议），由编译器落成坐标。
- 另注：`milp_utils.py` 的约束建模有"硬/软分离"的干净范本（硬约束必须满足、软约束进目标函数），这正是我们 §4.3 要借的骨架。

### 3.3 SceneCraft（ICML 2024）——LLM 写脚本 + 渲染回看 + 技能库

链接：<https://arxiv.org/abs/2403.01248> · 项目页 <https://scenecraft.github.io/>（HTML 正文 <https://arxiv.org/html/2403.01248v1>）· 代码：**未找到官方仓库**（GitHub 检索只有第三方仿作）

1. **归一化 / IR**：自然语言 → **关系场景图** `G(s)=(资产 A, 关系 R, 边 E)`，关系含 proximity / alignment / parallelism 等（§2.2，附 B 有完整关系表）；再由 LLM-Coder 把图翻译成 **Blender Python 脚本**，脚本里把关系变成数值约束。
2. **谁判合法性**：**软约束 + 视觉复核**。每个关系一个打分函数 `F_r(布局, 参数) ∈ [0,1]`，全局目标是 `argmax Σ F_r`（式 4）；渲染后用 GPT-4V 当 critic，指出"哪些约束没满足"，回改脚本或场景图边（式 5）。**没有硬校验器**，也不保证约束全部满足——所以才有"constraint pass rate"这个指标（88.9，BlenderGPT 基线 5.6）。
3. **plan/execute 分离**：无。内循环 `N_inner` 次"写码→求解→渲染→批评→改码"，本身就是 plan 与 execute 混在一起。外循环做 **library learning**：把内循环里反复出现的改法（如"lamp 必须 grounded 在桌面"）抽成技能函数存库。
4. **部分失败会计 / 回读**：以指标形式存在（约束通过率、CLIP 分数、人工偏好），运行时不产"哪条被拒"的账。回读 = 渲染图（人/模型都看同一张图）。
5. **比我们多什么 / 最值得补**：**"改法"可以变成可复用资产（技能库）**——对应我们可把"主通道不够就整体右移 0.4m""签到台贴入口右侧"沉淀成命名宏，而不是每次重新启发式。另一个是**渲染回看**：我们已有 3D 预览与逐帧候选，但没有"渲染一帧 → 自动判问题"的闭环；对活动场地（挡视线、舞台遮挡、门被堵）有潜在价值，但成本高（需 VLM + 稳定渲染），列为**观望**而非本轮改动。
- **可信度限制**：无官方代码，以上全部来自论文 HTML，属 B 级。

### 3.4 LayoutGPT（NeurIPS 2023，UCSB）——最接近我们"文字布局"的失败样本

链接：<https://github.com/UCSB-AI/LayoutGPT>（MIT）· <https://arxiv.org/abs/2305.15393> · 代码 `run_layoutgpt_3d.py` / `eval_scene_layout.py`

1. **归一化 / IR**：自然语言（+ K 个相似房间的 ICL 示例）→ **CSS 风格布局文本**，模板写死在 prompt 里：`FURNITURE {length: ?; width: ?; height: ?; left: ?; top: ?; depth: ?; orientation: ? degrees;}`；`parse_3D_layout(line, unit)` 解析成对象列表。单位归一：`--normalize` 把房间按最短边缩放到 1，`--unit px` 再乘 256（`load_room_boxes`）。
2. **谁判合法性**：**没人判**。生成阶段只捕获 API 错误（5s 重试；上下文过长就 `top_k -= 1` 砍示例）；解析失败 `except ValueError: pass` 静默丢弃；几何合法性到评测阶段才量：`invalid_object_size()` 计算越界对象比例，并逐件记录"溢出多少米"（`invalid_objects` 里的溢出量元组），另有 KL 散度衡量类别分布。
3. **plan/execute 分离**：无；布局文本直接喂 GLIGEN（2D）/ ATISS（3D）生成。**没有"预览-确认"**，也没有回滚。
4. **部分失败会计 / 回读**：只有评测期指标（OOB rate、KL）与计数（`n_lines`、`n_furnitures`）；运行期没有账本。回读 = 布局文本本身 + 渲染图。README 说每个 prompt 生成 **5 版**以降方差——**"一版不够就多版"是它的稳健性手段**。
5. **比我们多什么 / 最值得补**：两点。① **单位归一化是显式开关**（px/m、normalize、regular_floor_plan），不是隐式约定——我们的 `PlanInput` 直接吃米制 `widthM/depthM`，但云端 `commands` 的 `position.x/z` 没有单位/原点声明，跨端（3D 生成、素材代理）容易错位；建议在 `scene-script` 契约里显式写 `unit: 'm'`、`origin: 'corner' | 'center'`、`axis: 'XZ'`。② 它的**失败是可度量的**：越界率、逐件溢出量。我们只有 `overlapCount`，缺"越界多少米、卡在哪条边"。
- **反面教材**：静默丢弃 + 无硬闸 = 幻觉坐标直接进下游。我们幸好有 `canApplyLayoutGeometry` 这道闸，绝不能退回"只报指标"。

### 3.5 MAC-SQL（COLING 2025）——"执行器当裁判 + 错误原样回灌"的最小闭环

链接：<https://github.com/wbbeyourself/MAC-SQL> · <https://arxiv.org/abs/2312.11242> · 代码 `core/agents.py`、`core/const.py`、`core/chat_manager.py`

1. **归一化 / IR**：自然语言 + 数据库 schema → **SQL**。归一化在 Selector：先给每张表/列打 `keep_all / drop_all / [列名...]` 的 JSON 决策（`selector_template`），把宽 schema 裁到 Top-6 列，再拼成带值样例的 DDL 风格描述；Decomposer 用 CoT 拆子问题再合成 SQL。
2. **谁判合法性**：**SQLite 执行器**。`Refiner._execute_sql` 真跑，捕 `sqlite3.Error` 返回 `{sql, data[:5], sqlite_error, exception_class}`；`_is_need_refine` 把"空结果""结果含 None"也判成要修（这是业务语义层，不是语法层）。回灌模板 `refiner_template` 把 `【old SQL】/【SQLite error】/【Exception class】` 三段原样塞回 prompt，要求"fixup old SQL and generate new SQL again"。
3. **plan/execute 分离**：无；`MAX_ROUND=3` 是外层 agent 轮数上限（`const.py`），`chat_manager.start` 最多跑 3 轮就退出；无幂等、无回滚。
4. **部分失败会计 / 回读**：有轻量账本：`try_times` 累加、`fixed` 标记本轮是否修过，日志落盘（`INIT_LOG__PATH_FUNC`）。**没有结构化诊断对象**，回灌就是一段自然语言 prompt。
5. **比我们多什么 / 最值得补**：**"错误分类"影响修复策略**：它把错误分成 `sqlite_error`（语法/语义）与 `exception_class`（如 `OperationalError`），并据此只在"值得修"时才再花一次调用（超时/空结果/None 各有不同处理）。我们的 repair 是"把 errors 数组整包丢回去，最多一次"（`agent-runner.ts:180-181`），**没有 code 分类**，模型只能猜哪个 op 坏了。这直接支撑 §4.2。

---

## 4. 可以直接补进幕景的 3 条改动

> 前置事实（均本轮读过源码）：本地 `PlanProposal` 定义在 `frontend/components/room-organizer/lib/agent-proposal.ts:68-96`；确认逻辑 `agent-panel.tsx:875-899`（引用相等在 883）；唯一落盘 `room-organizer.tsx:1627 onApplyCreative`；服务端命令 IR 与执行 `supabase/functions/_shared/ai.ts:42-51 / 60-135`（遇错即 `throw ApiError`）；云端 repair 上限 1 次在 `_shared/agent-runner.ts:180-181`，提示词里也写死"修复请求最多一次"（`ai.ts:37`）；体检已有码表与跳过原因可复用（`layout-review.ts:26-27 / 54-58`）。

### 改动 1（最高价值）：给本地提案发"计划工件"，确认时比对内容哈希 + 时效，落盘写审计

**借的机制**：Terraform saved plan（内嵌基线 + 不可改参 + apply 只认那张 plan）。

**改动面**

- 新增 `frontend/components/room-organizer/lib/plan-artifact.ts`（纯函数，无 store 依赖）：
  ```ts
  export interface PlanArtifact {
    id: string;                 // crypto.randomUUID()
    createdAt: number;
    expiresAt: number;          // createdAt + ttlMs，默认 10 分钟
    baseHash: string;           // 稳定哈希(base)：venue 尺寸 + 结构 + items 按 id 排序、坐标量化 1e-3
    layoutHash: string;         // 稳定哈希(最终 candidate)
    opDigest: string;           // 有 op 时哈希 op 序列；无 op 时用 layouts 差分摘要
    counts: { added: number; removed: number; moved: number; keptLocked: number; dropped: number; overlap: number };
  }
  export function makePlanArtifact(input: { base: RoomLayout; final: RoomLayout; proposal: PlanProposal; ttlMs?: number }): PlanArtifact;
  export function planIsApplicable(artifact: PlanArtifact, current: RoomLayout, now?: number):
    { ok: true } | { ok: false; reason: 'stale-base' | 'expired' | 'layout-mismatch' };
  ```
- `agent-proposal.ts`：`PlanProposal` 增可选 `artifact?: PlanArtifact`（纯增量，不动现有卡片）。
- `agent-panel.tsx:870` 生成时塞 `artifact`；`agent-panel.tsx:883` 把 `live.current !== proposalBase.current` 换成 `planIsApplicable(plan.artifact, live.current)`，失败走 `invalidateProposal('场地变了 / 这版超过 10 分钟')`。
- 确认成功后（`agent-panel.tsx:884` 之后）写一条审计：`{ planId, baseHash, layoutHash, counts, appliedAt, floorIndex }`，本地先落 `localStorage` 环形日志（或复用现有存档通道），云端在 `proposals.apply` 请求体加可选 `planId`（`api.ts:211-217` 的入参，服务端 `proposalRequestSchema` 加 optional 字段即可）。

**验收**

- 新增 `plan-artifact.test.ts`：① 同内容、不同对象引用 → `ok`；② 挪一件物料 → `stale-base`；③ 过 TTL → `expired`；④ 同一 artifact 第二次 confirm → 被拒（幂等）。
- 手测：出方案 → 改尺寸/拖一件 → 点"确认布置"必须提示重出，而不是把旧候选盖上去；日志里能按 `planId` 找到这次落盘。
- 回归：`agent-proposal` 26 例、`agent-panel` 相关用例不回归。

**风险**：稳定哈希必须处理浮点（量化）+ id 顺序，否则频繁误判 stale；TTL 要可配（活动筹备可能聊 3 分钟再点）；云端加 optional 字段需前后端同步发布（`frontend/AGENTS.md` 要求不另立 wire schema，必须改 `_shared/domain.ts` 并同步）。

### 改动 2：逐条诊断 + 计数摘要，替代"整批 422 + dropped 数"

**借的机制**：Terraform `tfdiags`（severity/summary/detail/subject）+ `change_summary`；MAC-SQL 的"错误分类回灌"。

**改动面**

- 新增 `supabase/functions/_shared/diagnostics.ts`：
  ```ts
  export type DiagnosticCode =
    | 'OUT_OF_BOUNDS' | 'OBJECT_NOT_FOUND' | 'OBJECT_LOCKED' | 'STRUCTURAL_COLLISION'
    | 'RESOURCE_NOT_FOUND' | 'RESOURCE_SIZE_REQUIRED' | 'INVALID_SELECTION'
    | 'CAPACITY_EXCEEDED' | 'NO_FEASIBLE_SLOT';
  export interface Diagnostic {
    severity: 'error' | 'warning';
    code: DiagnosticCode;
    opIndex?: number;            // 第几条命令；本地生成时可为空
    ids: string[];               // 涉及的物件/资源 id
    message: string;             // 一句人话
    hint?: string;               // 给模型的修法提示（"已放置的不要动"）
  }
  export function diagnoseCommand(cmd: Command, next: Scene, ctx: { selectedIds: readonly string[]; resources: readonly SceneResource[] }): Diagnostic | null;
  export function summarize(diags: readonly Diagnostic[]): { errors: number; warnings: number; byCode: Partial<Record<DiagnosticCode, number>>; accepted: number };
  ```
- `ai.ts` 的 `buildProposal`：把 `for (const c of commands)` 里的 `throw` 改成"逐条 `diagnoseCommand` → 跳过坏条 → 继续"；仅当 `accepted === 0 && diagnostics.some(d => d.severity === 'error')` 时抛 `ApiError(..., 422, { diagnostics })`。结构性冲突（`STRUCTURAL_COLLISION`）仍整批拒（这是"整版不可应用"，不该部分落地）。返回值从 `{scene, explanation, commands, warnings, ...}` 扩成加 `diagnostics`、`applied: { accepted: number; skipped: number }`。
- `agent-runner.ts:180-181`：把 `errors` 数组换成 `diagnostics`，`result` 增 `byCode` 计数；repair 上限保持 1 次（现有 `++repair>1` 不动）。
- 前端：`PlanProposal` 增 `diagnostics?: Diagnostic[]`；`agent-panel.tsx:748-752` 的 `say` 文案由 `summarize` 生成，例如"这版 42 件，3 件没放进去：2 件越界、1 件锁着"；`planLines` 按 code 分组，不再只报总数。

**验收**

- 单测 `ai.diagnostics.test.ts`：① move 指向不存在 id → 其余 9 条照常应用，返回 1 条 `OBJECT_NOT_FOUND`；② 一条越界 → `OUT_OF_BOUNDS` + 其余应用；③ 全坏才 422 且 body 带 `diagnostics`。
- 契约：`proposalRequestSchema` 新字段 optional，旧客户端不破；云端 `sceneHash` 仍与 candidate 一致（部分应用后的 candidate 就是最终写盘对象）。
- 前端回归：167 例生成相关套件；新增断言"3 件被拒时卡片出 3 条带 code 的行"。

**风险**：部分应用把"提案 = 一次事务"变成"可应用场景 + 未接管清单"，必须让 `apply` 与卡片预览指向同一个 candidate，否则预览与落盘不一致；诊断回灌可能诱导模型"硬凑坐标"，`hint` 必须写边界（"只修列出的这几条，已放置不许动"）；服务端与本地编译器要共用同一套 code，避免两套文案（建议前端从 `_shared/diagnostics.ts` 取类型）。

### 改动 3：布置前先算容量/可行域（硬约束掩码 + 容量账本），不再"放不下就 dropped"

**借的机制**：Holodeck 的硬/软约束分离与求解器；LayoutGPT 的单位/原点显式声明与"逐件溢出量"度量；ATISS 的"给定可接受位置区域再放"（README：object_suggestion 要求用户用 6 个数字给出合法包围盒；failure_correction 专门定位并挪动问题物件，<https://github.com/nv-tlabs/ATISS>）。

**改动面**

- 新增 `frontend/components/room-organizer/lib/venue-feasibility.ts`（纯函数，复用 `geometry.ts` / `floor-keep-out.ts` / `layout-review.ts` 常量）：
  ```ts
  export interface FeasibilityRules {
    aisleM: number;            // 主通道，默认 1.2（对齐 layout-review 口径）
    entranceClearanceM: number;// 入口净空，默认 1.5
    checkinClearanceM: number; // 签到台前缓冲，默认 2.0
    stageClearanceM: number;   // 舞台前净空，默认 1.5
    seatPulloutM: number;      // 复用 SEAT_PULLOUT_METERS = 0.45
  }
  export const DEFAULT_RULES: FeasibilityRules;
  export interface CapacityReport {
    usableAreaM2: number; lostToAisleM2: number;
    seatsMax: number; tablesMax: number; boothsMax: number;
    blockers: Array<{ kind: 'aisle' | 'entrance' | 'stage' | 'structure'; at: Vec2; wastedM2: number }>;
  }
  export function capacityOf(base: RoomLayout, rules: FeasibilityRules): CapacityReport;
  export function feasibleSlotsFor(base: RoomLayout, kind: 'seat' | 'table' | 'booth', rules: FeasibilityRules): Vec2[];
  ```
- `agent-proposal.ts:306 proposePlan`：先 `capacityOf(base, DEFAULT_RULES)`；若 `guests > seatsMax`，返回 `CAPACITY_EXCEEDED` 诊断（"这块地最多 68 座，差 12 座：减 12 座或去掉 2 个展位"）而不是静默少摆；摆放循环改用 `feasibleSlotsFor` 的候选点（相当于"动作掩码"），`tryAdd` 的二分降级（`agent-proposal.ts:199-209`）保留但必须记录"哪件、哪种原因"，原因枚举直接复用 `layout-review.ts:54-58` 的 `ReviewSkip.reason`（`locked` / `no-spot`，可扩 `capacity`）。
- 单位/原点：`scene-script` 契约（基线审计 §4.1 建议新增的 `_shared/scene-script-contract.ts`）里显式写 `unit: 'm' | 'cm'`、`origin: 'corner' | 'center'`、`axis: 'XZ'`，编译器负责换算（LayoutGPT 的 `--normalize` 教训）。

**验收**

- 单测 `venue-feasibility.test.ts`：12×9 场地、80 座需求 → `seatsMax` 稳定输出（固定排序/量化，不依赖 Map 迭代顺序）；`demand > seatsMax` → 恰好 1 条 `CAPACITY_EXCEEDED`，且 `added` 落在容量上限附近而非"静默少 30 件"；入口被展位占死 → `blockers[0].kind === 'entrance'`。
- 回归：`agent-proposal` 26 例、`geometry` 32 例、`collision` 27 例；新增 3 例（容量反算 / 通道与展位冲突 / 入口净空）。
- 性能：12×9 场地 `capacityOf` ≤ 16ms（主线程预算），否则按 `baseHash` 缓存。

**风险**：硬约束过严会让"80 人"永远失败——必须先返回"这块地最多能坐多少"再让用户选择（把失败变成选择题）；`capacityOf` 会引入**第二套几何口径**，必须与 `canApplyLayoutGeometry` 共用 `geometry.ts` 的 OBB 与 `floorKeepOut`，否则"算得出、放不下"；`seatPulloutM/aisleM` 与 `layout-review` 的常量要单一来源，避免体检说没问题、生成说放不下。

---

## 5. 存疑清单（没读到 / 只读到摘要的，明说）

1. **SceneCraft 无官方开源代码**：GitHub 检索只有第三方仿作（如 `Igalsr/SceneCraft`，与论文无关）；本文机制全部来自 arXiv HTML 正文（B 级）。"约束求解器"具体实现（scipy? 自研? 迭代次数 `N_inner` 取值）未读到。
2. **Holodeck 未逐行读 `floor_objects.py`（69KB）**：放置失败的精确重试/降级逻辑、失败后是否回填数量，未核实；本文只用 `holodeck.py` 的流程与 `milp_utils.py` 的约束定义（A 级）。另：MILP 是**可选且默认关闭**（默认 DFS），论文的"约束优化"未必是求解器最优解。
3. **Terraform "Saved plan is stale" 文案未在源码定位**：plan 文件内嵌 state（`reader.go`）与 apply 从 `plan.PriorState` 起算（`context_apply.go`）已核实；"过期 plan 拒绝"的具体代码位置未核，故只作为旁证。
4. **MAC-SQL 的 `MAX_ROUND=3` 是 agent 轮数上限**，不是"SQL 最多重试 3 次"；Refiner 自循环可能消耗多轮，实际 repair 次数未精确统计。仓库 **未声明 License**（GitHub API `license: null`），只提炼机制、未照抄。
5. **LayoutGPT 的 `parse_3D_layout` 未读**：只从调用处看到 `except ValueError: pass`（静默丢弃），解析器对非法值的具体行为未核；OOB 是评测指标而非运行时拦截。
6. **未覆盖的候选方向**：ATISS/DiffuScene 只读了 README（用作"可行域 + 失败件修正"旁证）；Vega-Lite/Chart agent、Shadertoy/GLSL agent、MusicGen/Magenta、Pulumi/OPA 策略即代码均**未读**（与"活动场地 3D 布置"相关性排序靠后）。若后续要补"策略即代码"（把"主通道 ≥1.2m"写成可版本化策略而不是 if 判断），OPA/Rego 与 Terraform `check` 块是最近的下一步。
7. **检索方式限制**：本次 `web_search` 后端不可用（keyless fallback 返回噪声），结论靠直连 GitHub raw/API + arXiv 页面获得，**没有做系统化检索**，因此可能漏掉同类的更新系统（如 2025 后的 text-to-scene agent）。建议下一轮用可用的检索后端补一次"近 12 个月 text→3D layout / venue planning"扫描。

---

## 附：证据索引（本轮实际打开的链接/文件）

- Holodeck：<https://github.com/allenai/Holodeck>；`ai2holodeck/generation/holodeck.py`、`milp_utils.py`、`main.py`、`LICENSE`（Apache-2.0）；论文 <https://arxiv.org/abs/2312.09067>
- SceneCraft：<https://arxiv.org/abs/2403.01248>、<https://arxiv.org/html/2403.01248v1>；项目页 <https://scenecraft.github.io/>
- LayoutGPT：<https://github.com/UCSB-AI/LayoutGPT>（MIT）；`run_layoutgpt_3d.py`、`eval_scene_layout.py`；论文 <https://arxiv.org/abs/2305.15393>
- MAC-SQL：<https://github.com/wbbeyourself/MAC-SQL>；`core/agents.py`、`core/const.py`、`core/chat_manager.py`；论文 <https://arxiv.org/abs/2312.11242>
- Terraform：<https://github.com/hashicorp/terraform>；`internal/plans/planfile/writer.go`、`reader.go`、`internal/backend/local/backend_apply.go`、`internal/terraform/context_apply.go`；文档 <https://developer.hashicorp.com/terraform/cli/commands/plan>
- OpenTofu（同语义、文档可直读）：`website/docs/cli/commands/plan.mdx`、`apply.mdx`、`website/docs/internals/machine-readable-ui.mdx`
- ATISS（旁证）：<https://github.com/nv-tlabs/ATISS>
- 本地基线：`docs/research/generation/scendance-generation-baseline-2026-11-01.md`、`docs/research/generation/petitmaker-construction-logic-2026-11-01.md`、`docs/research/generation/oddenova-music-generation-2026-11-01.md`
